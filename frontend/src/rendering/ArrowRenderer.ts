import * as THREE from 'three/webgpu';
import type { Direction } from '@/types';

/** Pool size per direction */
export const ARROW_POOL_SIZE = 80;

const DIRECTIONS: Direction[] = ['left', 'down', 'up', 'right'];

/**
 * Vibrant DDR-arcade colors per direction.
 * These drive all three render layers (body + glow + highlight).
 */
export const DIRECTION_COLORS: Record<Direction, THREE.Color> = {
  left:  new THREE.Color(0xff1177),  // hot pink / magenta
  down:  new THREE.Color(0x1144ff),  // royal blue
  up:    new THREE.Color(0x00ddff),  // bright cyan
  right: new THREE.Color(0xffcc00),  // gold / yellow
};

// CCW rotation (radians) around Z to reorient an up-pointing arrow
const DIRECTION_QUATS: Record<Direction, THREE.Quaternion> = {
  up:    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),
  left:  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0,  Math.PI / 2)),
  down:  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0,  Math.PI)),
  right: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)),
};

// Reusable objects — avoid GC pressure in the hot render path
const _mat   = new THREE.Matrix4();
const _pos   = new THREE.Vector3();
const _color = new THREE.Color();

// Per-layer uniform scales — applied in the instance matrix
const _scaleGlow = new THREE.Vector3(1.28, 1.28, 1);  // outer glow ring
const _scaleBody = new THREE.Vector3(1.00, 1.00, 1);  // main body
const _scaleHL   = new THREE.Vector3(0.52, 0.52, 1);  // inner highlight sheen

// Layer opacity weights (additive blending; outer ring reads as direction×GLOW_W)
const GLOW_W = 0.28;   // dim ring border
const BODY_W = 0.72;   // full-bright main color
const HL_W   = 0.55;   // white-tinted center sheen

/**
 * Classic DDR-style chunky arrow pointing in +Y, centered at origin.
 *
 * Shape: wide arrowhead with a visible shoulder "step" down into a short,
 * broad body/stem.  Proportions chosen to match the chunky vintage DDR look:
 * nearly as wide as the column gap, with a stubby tail.
 *
 *          *            ← tip      (0,    0.42)
 *         * *
 *        *   *
 *  *    *     *    *   ← outer shoulders (±0.44, 0.06)
 *  *  *         *  *   ← inner shoulders (±0.28, 0.06) — shoulder step
 *     *         *      ← body sides
 *     *  * * *  *      ← base      (±0.28, -0.26)
 */
function createArrowGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const aw   = 0.44;   // arrowhead half-width at shoulders
  const ah   = 0.42;   // tip height above center
  const bw   = 0.28;   // body (stem) half-width  — wide for chunkiness
  const bh   = 0.26;   // body depth below center — short for chunkiness
  const sy   = 0.06;   // shoulder Y — positive so the step notch is visible

  shape.moveTo(  0,  ah);
  shape.lineTo( aw,  sy);   // right outer shoulder
  shape.lineTo( bw,  sy);   // step in → right inner shoulder
  shape.lineTo( bw, -bh);   // right base corner
  shape.lineTo(-bw, -bh);   // left  base corner
  shape.lineTo(-bw,  sy);   // step in → left  inner shoulder
  shape.lineTo(-aw,  sy);   // left  outer shoulder
  shape.closePath();

  return new THREE.ShapeGeometry(shape);
}

/**
 * Manages three InstancedMesh layers per direction (glow + body + highlight)
 * to produce the classic DDR chunky multi-tone arrow look:
 *
 *   • Glow ring  (scale 1.28, dim):  soft dark border ring
 *   • Body       (scale 1.00, full): main bright direction color
 *   • Highlight  (scale 0.52, bright white): inner sheen / center glow
 *
 * All layers use additive blending; color intensity encodes "opacity" so that
 * black = invisible.  Only dirty directions are flushed to the GPU each frame.
 *
 * Public API is unchanged from the single-layer version.
 */
export class ArrowRenderer {
  private readonly scene: THREE.Scene;
  private readonly geometry: THREE.ShapeGeometry;

  // Three render layers
  private readonly glowMeshes = new Map<Direction, THREE.InstancedMesh>();
  private readonly bodyMeshes = new Map<Direction, THREE.InstancedMesh>();
  private readonly hlMeshes   = new Map<Direction, THREE.InstancedMesh>();

  private readonly freePool   = new Map<Direction, number[]>();
  private readonly posX       = new Map<Direction, Float32Array>();
  private readonly posY       = new Map<Direction, Float32Array>();
  private readonly opacities  = new Map<Direction, Float32Array>();
  // Tracks exactly which pool slots changed this frame instead of iterating
  // all 80 slots per direction.  Reduces setMatrixAt/setColorAt calls by ~95%
  // during typical gameplay (only 5-20 active arrows out of 80 slots).
  private readonly dirtySlots = new Map<Direction, Set<number>>();

  constructor(scene: THREE.Scene) {
    this.scene    = scene;
    this.geometry = createArrowGeometry();
    for (const dir of DIRECTIONS) {
      this.initDirection(dir);
    }
  }

  private makeMesh(scale: THREE.Vector3): THREE.InstancedMesh {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(this.geometry, mat, ARROW_POOL_SIZE);
    mesh.count = ARROW_POOL_SIZE;
    mesh.frustumCulled = false;

    // Park all instances off-screen
    _pos.set(0, -1000, 0);
    const q = new THREE.Quaternion(); // identity — will be overridden per-direction in update
    _mat.compose(_pos, q, scale);
    for (let i = 0; i < ARROW_POOL_SIZE; i++) {
      mesh.setMatrixAt(i, _mat);
      mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  private initDirection(dir: Direction): void {
    const glowMesh = this.makeMesh(_scaleGlow);
    const bodyMesh = this.makeMesh(_scaleBody);
    const hlMesh   = this.makeMesh(_scaleHL);

    // Add to scene in depth order: glow behind, body middle, highlight front
    this.scene.add(glowMesh);
    this.scene.add(bodyMesh);
    this.scene.add(hlMesh);

    this.glowMeshes.set(dir, glowMesh);
    this.bodyMeshes.set(dir, bodyMesh);
    this.hlMeshes.set(dir, hlMesh);

    const px   = new Float32Array(ARROW_POOL_SIZE);
    const py   = new Float32Array(ARROW_POOL_SIZE);
    const ops  = new Float32Array(ARROW_POOL_SIZE);
    const free: number[] = [];

    for (let i = 0; i < ARROW_POOL_SIZE; i++) {
      px[i]  = 0;
      py[i]  = -1000;
      ops[i] = 0;
      free.push(i);
    }

    this.freePool.set(dir, free);
    this.posX.set(dir, px);
    this.posY.set(dir, py);
    this.opacities.set(dir, ops);
    this.dirtySlots.set(dir, new Set());
  }

  // ---------------------------------------------------------------------------
  // Pool API
  // ---------------------------------------------------------------------------

  allocate(dir: Direction): number {
    const free = this.freePool.get(dir)!;
    return free.length > 0 ? free.pop()! : -1;
  }

  release(dir: Direction, id: number): void {
    if (id < 0 || id >= ARROW_POOL_SIZE) return;
    this.posX.get(dir)![id]      = 0;
    this.posY.get(dir)![id]      = -1000;
    this.opacities.get(dir)![id] = 0;
    this.dirtySlots.get(dir)!.add(id);
    this.freePool.get(dir)!.push(id);
  }

  // ---------------------------------------------------------------------------
  // Per-instance setters — lazy, flushed in update()
  // ---------------------------------------------------------------------------

  setPosition(dir: Direction, id: number, x: number, y: number): void {
    this.posX.get(dir)![id] = x;
    this.posY.get(dir)![id] = y;
    this.dirtySlots.get(dir)!.add(id);
  }

  setOpacity(dir: Direction, id: number, opacity: number): void {
    this.opacities.get(dir)![id] = Math.max(0, Math.min(1, opacity));
    this.dirtySlots.get(dir)!.add(id);
  }

  setVisible(dir: Direction, id: number, visible: boolean): void {
    this.setOpacity(dir, id, visible ? 1 : 0);
  }

  // ---------------------------------------------------------------------------
  // Frame update — flush dirty directions to GPU
  // ---------------------------------------------------------------------------

  update(): void {
    for (const dir of DIRECTIONS) {
      const slots = this.dirtySlots.get(dir)!;
      if (slots.size === 0) continue;

      const glowMesh = this.glowMeshes.get(dir)!;
      const bodyMesh = this.bodyMeshes.get(dir)!;
      const hlMesh   = this.hlMeshes.get(dir)!;
      const base     = DIRECTION_COLORS[dir];
      const quat     = DIRECTION_QUATS[dir];
      const px       = this.posX.get(dir)!;
      const py       = this.posY.get(dir)!;
      const ops      = this.opacities.get(dir)!;

      for (const i of slots) {
        const o = ops[i];
        const x = px[i];
        const y = py[i];

        // Glow ring — behind body, dim direction color
        _pos.set(x, y, -0.01);
        _mat.compose(_pos, quat, _scaleGlow);
        glowMesh.setMatrixAt(i, _mat);
        _color.setRGB(base.r * o * GLOW_W, base.g * o * GLOW_W, base.b * o * GLOW_W);
        glowMesh.setColorAt(i, _color);

        // Body — main color
        _pos.set(x, y, 0);
        _mat.compose(_pos, quat, _scaleBody);
        bodyMesh.setMatrixAt(i, _mat);
        _color.setRGB(base.r * o * BODY_W, base.g * o * BODY_W, base.b * o * BODY_W);
        bodyMesh.setColorAt(i, _color);

        // Highlight — small bright white-tinted center sheen
        _pos.set(x, y, 0.01);
        _mat.compose(_pos, quat, _scaleHL);
        hlMesh.setMatrixAt(i, _mat);
        // Blend toward white: lerp direction color to white at HL_W intensity
        const hr = (base.r * 0.4 + 0.6) * o * HL_W;
        const hg = (base.g * 0.4 + 0.6) * o * HL_W;
        const hb = (base.b * 0.4 + 0.6) * o * HL_W;
        _color.setRGB(hr, hg, hb);
        hlMesh.setColorAt(i, _color);
      }
      slots.clear();

      glowMesh.instanceMatrix.needsUpdate = true;
      bodyMesh.instanceMatrix.needsUpdate = true;
      hlMesh.instanceMatrix.needsUpdate   = true;
      if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
      if (hlMesh.instanceColor)   hlMesh.instanceColor.needsUpdate   = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.geometry.dispose();
    for (const dir of DIRECTIONS) {
      for (const map of [this.glowMeshes, this.bodyMeshes, this.hlMeshes]) {
        const mesh = map.get(dir);
        if (mesh) {
          (mesh.material as THREE.Material).dispose();
          this.scene.remove(mesh);
        }
      }
    }
    this.glowMeshes.clear();
    this.bodyMeshes.clear();
    this.hlMeshes.clear();
  }
}

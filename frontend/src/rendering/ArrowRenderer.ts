import * as THREE from 'three/webgpu';
import type { Direction } from '@/types';

/** Pool size per direction — must be large enough for active arrows + 2 trail instances each */
export const ARROW_POOL_SIZE = 80;

const DIRECTIONS: Direction[] = ['left', 'down', 'up', 'right'];

/** Neon color per direction (matches PRD Section 4.4) */
export const DIRECTION_COLORS: Record<Direction, THREE.Color> = {
  left: new THREE.Color(0xff00ff),  // magenta
  down: new THREE.Color(0x00ffff),  // cyan
  up: new THREE.Color(0x00ff88),    // green
  right: new THREE.Color(0xff8800), // orange
};

// CCW rotation (radians) around Z to reorient an up-pointing arrow
const DIRECTION_QUATS: Record<Direction, THREE.Quaternion> = {
  up: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),
  left: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
  down: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
  right: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)),
};

// Reusable objects — avoid GC pressure in the hot render path
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

/**
 * Procedural chevron arrow shape pointing in +Y, centered at origin.
 * Total extents: 0.9 × 0.9 world units.
 *
 *        *          ← tip  (0, 0.45)
 *       ***
 *      *   *
 * *   *     *   *   ← shoulders (±0.45, 0)
 * *   *     *   *
 *     *     *       ← inner shoulders (±0.20, 0)
 *     * * * *       ← body
 *     *     *
 *     * * * *       ← base (±0.20, -0.45)
 */
function createArrowGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const aw = 0.45; // arrowhead half-width
  const ah = 0.45; // tip height above center
  const bw = 0.20; // body half-width
  const bh = 0.45; // body depth below center

  shape.moveTo(0, ah);
  shape.lineTo(aw, 0);
  shape.lineTo(bw, 0);
  shape.lineTo(bw, -bh);
  shape.lineTo(-bw, -bh);
  shape.lineTo(-bw, 0);
  shape.lineTo(-aw, 0);
  shape.closePath();

  return new THREE.ShapeGeometry(shape);
}

/**
 * Manages four InstancedMeshes (one per direction) with a fixed-size object
 * pool per direction.  Arrows glow via additive blending: encoding "opacity"
 * as per-instance color intensity means a black instance is invisible while a
 * full-brightness instance emits its neon color onto the scene.
 *
 * Usage:
 *   const id = arrows.allocate('left');       // claim a free instance
 *   arrows.setPosition('left', id, x, y);     // world-space XY
 *   arrows.setOpacity('left', id, 1.0);        // 0 = invisible, 1 = full glow
 *   arrows.update();                            // flush to GPU (once per frame)
 *   ...
 *   arrows.release('left', id);                // return to pool
 */
export class ArrowRenderer {
  private readonly scene: THREE.Scene;
  private readonly geometry: THREE.ShapeGeometry;
  private readonly meshes = new Map<Direction, THREE.InstancedMesh>();
  private readonly freePool = new Map<Direction, number[]>();
  private readonly posX = new Map<Direction, Float32Array>();
  private readonly posY = new Map<Direction, Float32Array>();
  private readonly opacities = new Map<Direction, Float32Array>();
  private readonly dirty = new Map<Direction, boolean>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geometry = createArrowGeometry();
    for (const dir of DIRECTIONS) {
      this.initDirection(dir);
    }
  }

  private initDirection(dir: Direction): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(this.geometry, material, ARROW_POOL_SIZE);
    mesh.count = ARROW_POOL_SIZE;
    mesh.frustumCulled = false; // we manage culling ourselves

    const px = new Float32Array(ARROW_POOL_SIZE);
    const py = new Float32Array(ARROW_POOL_SIZE);
    const ops = new Float32Array(ARROW_POOL_SIZE);
    const free: number[] = [];
    const quat = DIRECTION_QUATS[dir];

    for (let i = 0; i < ARROW_POOL_SIZE; i++) {
      // Park off-screen with zero color (invisible in additive blending)
      px[i] = 0;
      py[i] = -1000;
      ops[i] = 0;

      _pos.set(0, -1000, 0);
      _mat.compose(_pos, quat, _scale);
      mesh.setMatrixAt(i, _mat);
      mesh.setColorAt(i, new THREE.Color(0, 0, 0));

      free.push(i);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.meshes.set(dir, mesh);
    this.freePool.set(dir, free);
    this.posX.set(dir, px);
    this.posY.set(dir, py);
    this.opacities.set(dir, ops);
    this.dirty.set(dir, false);

    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------------------
  // Pool API
  // ---------------------------------------------------------------------------

  /** Claim a free arrow instance. Returns its index, or -1 if pool exhausted. */
  allocate(dir: Direction): number {
    const free = this.freePool.get(dir)!;
    return free.length > 0 ? free.pop()! : -1;
  }

  /** Return an instance to the pool and hide it immediately. */
  release(dir: Direction, id: number): void {
    if (id < 0 || id >= ARROW_POOL_SIZE) return;
    this.posX.get(dir)![id] = 0;
    this.posY.get(dir)![id] = -1000;
    this.opacities.get(dir)![id] = 0;
    this.dirty.set(dir, true);
    this.freePool.get(dir)!.push(id);
  }

  // ---------------------------------------------------------------------------
  // Per-instance setters (all lazy — flushed in update())
  // ---------------------------------------------------------------------------

  setPosition(dir: Direction, id: number, x: number, y: number): void {
    this.posX.get(dir)![id] = x;
    this.posY.get(dir)![id] = y;
    this.dirty.set(dir, true);
  }

  setOpacity(dir: Direction, id: number, opacity: number): void {
    this.opacities.get(dir)![id] = Math.max(0, Math.min(1, opacity));
    this.dirty.set(dir, true);
  }

  setVisible(dir: Direction, id: number, visible: boolean): void {
    this.setOpacity(dir, id, visible ? 1 : 0);
  }

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------

  /**
   * Flush dirty instance data to the GPU.  Call exactly once per frame, before
   * rendering.  Only directions that changed since the last update are touched.
   */
  update(): void {
    for (const dir of DIRECTIONS) {
      if (!this.dirty.get(dir)) continue;

      const mesh = this.meshes.get(dir)!;
      const base = DIRECTION_COLORS[dir];
      const quat = DIRECTION_QUATS[dir];
      const px = this.posX.get(dir)!;
      const py = this.posY.get(dir)!;
      const ops = this.opacities.get(dir)!;

      for (let i = 0; i < ARROW_POOL_SIZE; i++) {
        _pos.set(px[i], py[i], 0);
        _mat.compose(_pos, quat, _scale);
        mesh.setMatrixAt(i, _mat);

        // Encode opacity as color intensity — black = invisible in additive blend
        const o = ops[i];
        _color.setRGB(base.r * o, base.g * o, base.b * o);
        mesh.setColorAt(i, _color);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.dirty.set(dir, false);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.geometry.dispose();
    for (const [, mesh] of this.meshes) {
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
    }
    this.meshes.clear();
  }
}

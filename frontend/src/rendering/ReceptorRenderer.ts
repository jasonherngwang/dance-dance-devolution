import * as THREE from 'three/webgpu';
import type { Direction, JudgmentType } from '@/types';
import { DIRECTION_COLORS } from './ArrowRenderer';

const DIRECTIONS: Direction[] = ['left', 'down', 'up', 'right'];

/** World-space Y of the static step-zone row */
export const RECEPTOR_Y = 3.5;

/** World-space X position per direction — matches ArrowRenderer column layout */
export const COLUMN_X: Record<Direction, number> = {
  left:  -1.5,
  down:  -0.5,
  up:     0.5,
  right:  1.5,
};

// ---------------------------------------------------------------------------
// Breathing animation
// ---------------------------------------------------------------------------
const BREATH_FREQ = 1.2;   // Hz
const BREATH_BASE = 0.35;  // minimum opacity
const BREATH_AMP  = 0.20;  // swings 0.15 → 0.55

// ---------------------------------------------------------------------------
// Flash durations (milliseconds)
// ---------------------------------------------------------------------------
const FLASH_MS: Partial<Record<JudgmentType, number>> = {
  perfect: 260,
  great:   200,
};

const RIPPLE_DURATION_MS = 420;

// CCW rotation around Z to orient each receptor (same as ArrowRenderer)
const DIRECTION_ROTATION: Record<Direction, number> = {
  up:    0,
  left:  Math.PI / 2,
  down:  Math.PI,
  right: -Math.PI / 2,
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Filled arrow shape (same vertices as ArrowRenderer) — used for ghost receptors.
 */
function createArrowShape(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  // Match ArrowRenderer proportions for visual consistency
  const aw = 0.44, ah = 0.42, bw = 0.28, bh = 0.26, sy = 0.06;
  shape.moveTo(  0,  ah);
  shape.lineTo( aw,  sy);
  shape.lineTo( bw,  sy);
  shape.lineTo( bw, -bh);
  shape.lineTo(-bw, -bh);
  shape.lineTo(-bw,  sy);
  shape.lineTo(-aw,  sy);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * Closed arrow outline for ripple effects.
 * Uses THREE.Line (WebGPU-compatible) with the first point repeated at the
 * end to close the loop — THREE.Line is not supported in the WebGPU renderer.
 */
function createOutlineGeometry(): THREE.BufferGeometry {
  const aw = 0.44, ah = 0.42, bw = 0.28, bh = 0.26, sy = 0.06;
  const pts = [
    new THREE.Vector3(  0,  ah, 0),
    new THREE.Vector3( aw,  sy, 0),
    new THREE.Vector3( bw,  sy, 0),
    new THREE.Vector3( bw, -bh, 0),
    new THREE.Vector3(-bw, -bh, 0),
    new THREE.Vector3(-bw,  sy, 0),
    new THREE.Vector3(-aw,  sy, 0),
    new THREE.Vector3(  0,  ah, 0), // repeat first point to close the path
  ];
  return new THREE.BufferGeometry().setFromPoints(pts);
}

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface FlashState {
  startTime: number;   // performance.now()
  judgment: JudgmentType;
}

interface ActiveRipple {
  startTime: number;
  line: THREE.Line;
}

// ---------------------------------------------------------------------------
// ReceptorRenderer
// ---------------------------------------------------------------------------

/**
 * Renders four static receptor arrows at the step zone (RECEPTOR_Y) as filled
 * semi-transparent ghost arrows, plus a horizontal step-zone bar.
 *
 * API:
 *   const receptors = new ReceptorRenderer(scene);
 *   receptors.update(performance.now() / 1000);
 *   receptors.flashReceptor('left', 'perfect');
 *   receptors.dispose();
 */
export class ReceptorRenderer {
  private readonly scene: THREE.Scene;
  private readonly arrowGeometry: THREE.ShapeGeometry;
  private readonly outlineGeometry: THREE.BufferGeometry;

  private readonly meshes = new Map<Direction, THREE.Mesh>();
  private readonly flashStates = new Map<Direction, FlashState>();


  // Pool of pre-allocated ripple LineLoops (Perfect hits only)
  private readonly ripplePool: THREE.Line[] = [];
  private readonly activeRipples: ActiveRipple[] = [];
  private static readonly RIPPLE_POOL_SIZE = 8;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.arrowGeometry = createArrowShape();
    this.outlineGeometry = createOutlineGeometry();

    // Step-zone bar removed per design preference

    // Pre-allocate ripple pool
    for (let i = 0; i < ReceptorRenderer.RIPPLE_POOL_SIZE; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(this.outlineGeometry, mat);
      line.visible = false;
      scene.add(line);
      this.ripplePool.push(line);
    }

    for (const dir of DIRECTIONS) {
      this.initReceptor(dir);
    }
  }

  private initReceptor(dir: Direction): void {
    const mat = new THREE.MeshBasicMaterial({
      color: DIRECTION_COLORS[dir].clone(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    mat.opacity = BREATH_BASE;

    const mesh = new THREE.Mesh(this.arrowGeometry, mat);
    mesh.position.set(COLUMN_X[dir], RECEPTOR_Y, 0.05);
    mesh.rotation.z = DIRECTION_ROTATION[dir];

    this.scene.add(mesh);
    this.meshes.set(dir, mesh);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Pre-warm the WebGPU render pipeline for ripple lines.
   *
   * Receptor arrow meshes are always visible so their pipelines compile on the
   * first frame.  Ripple THREE.Line objects start visible=false and would stall
   * the first Perfect judgment frame.  Call once after construction.
   */
  prewarm(): void {
    const ripple = this.ripplePool[0];
    if (!ripple) return;
    ripple.visible = true;
    ripple.scale.setScalar(0.001);
    setTimeout(() => {
      ripple.visible = false;
      ripple.scale.setScalar(1);
    }, 100);
  }

  flashReceptor(direction: Direction, judgment: JudgmentType): void {
    if (judgment === 'miss') return;

    this.flashStates.set(direction, {
      startTime: performance.now(),
      judgment,
    });

    if (judgment === 'perfect') {
      const ripple = this.ripplePool.find(r => !r.visible);
      if (ripple) {
        ripple.visible = true;
        ripple.position.set(COLUMN_X[direction], RECEPTOR_Y, 0.1);
        ripple.rotation.z = DIRECTION_ROTATION[direction];
        ripple.scale.setScalar(1.0);
        const mat = ripple.material as THREE.LineBasicMaterial;
        mat.opacity = 0.85;
        mat.color.setHex(0xffffff);
        this.activeRipples.push({ startTime: performance.now(), line: ripple });
      }
    }
  }

  update(time: number): void {
    const now = performance.now();
    const breath = BREATH_BASE + BREATH_AMP * Math.sin(time * BREATH_FREQ * Math.PI * 2);

    for (const dir of DIRECTIONS) {
      const mesh = this.meshes.get(dir)!;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const flash = this.flashStates.get(dir);

      if (flash) {
        const duration = FLASH_MS[flash.judgment] ?? 0;
        const t = duration > 0 ? Math.min((now - flash.startTime) / duration, 1.0) : 1.0;

        if (t >= 1.0) {
          this.flashStates.delete(dir);
          mat.color.copy(DIRECTION_COLORS[dir]);
          mat.opacity = breath;
        } else {
          const ease = 1 - t * t;
          const base = DIRECTION_COLORS[dir];

          if (flash.judgment === 'perfect') {
            mat.color.setRGB(1, 1, 1);
            mat.opacity = BREATH_BASE + ease * 0.65;
          } else {
            mat.color.setRGB(
              base.r + (1 - base.r) * ease * 0.55,
              base.g + (1 - base.g) * ease * 0.55,
              base.b + (1 - base.b) * ease * 0.55,
            );
            mat.opacity = BREATH_BASE + ease * 0.45;
          }
        }
      } else {
        mat.color.copy(DIRECTION_COLORS[dir]);
        mat.opacity = breath;
      }
    }

    // Animate expanding ripples (Perfect only)
    for (let i = this.activeRipples.length - 1; i >= 0; i--) {
      const ripple = this.activeRipples[i];
      const t = Math.min((now - ripple.startTime) / RIPPLE_DURATION_MS, 1.0);

      if (t >= 1.0) {
        ripple.line.visible = false;
        this.activeRipples.splice(i, 1);
      } else {
        ripple.line.scale.setScalar(1.0 + t * 1.5);
        (ripple.line.material as THREE.LineBasicMaterial).opacity = 0.85 * (1 - t * t);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.arrowGeometry.dispose();
    this.outlineGeometry.dispose();

    for (const [, mesh] of this.meshes) {
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
    }
    for (const ripple of this.ripplePool) {
      (ripple.material as THREE.Material).dispose();
      this.scene.remove(ripple);
    }
    this.meshes.clear();
    this.activeRipples.length = 0;
  }
}

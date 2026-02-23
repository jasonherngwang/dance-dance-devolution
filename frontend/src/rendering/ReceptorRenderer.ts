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
const BREATH_BASE = 0.30;  // minimum opacity
const BREATH_AMP  = 0.18;  // swings 0.12 → 0.48

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
 * Seven-vertex arrow outline — same shape as ArrowRenderer, up-pointing.
 * Shared by all LineLoop instances (outlines + ripples).
 */
function createOutlineGeometry(): THREE.BufferGeometry {
  const aw = 0.45, ah = 0.45, bw = 0.20, bh = 0.45;
  const pts = [
    new THREE.Vector3( 0,  ah, 0),
    new THREE.Vector3( aw,  0, 0),
    new THREE.Vector3( bw,  0, 0),
    new THREE.Vector3( bw, -bh, 0),
    new THREE.Vector3(-bw, -bh, 0),
    new THREE.Vector3(-bw,  0, 0),
    new THREE.Vector3(-aw,  0, 0),
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
  line: THREE.LineLoop;
}

// ---------------------------------------------------------------------------
// ReceptorRenderer
// ---------------------------------------------------------------------------

/**
 * Renders four static receptor outlines at the step zone (RECEPTOR_Y).
 *
 * API:
 *   const receptors = new ReceptorRenderer(scene);
 *   // call once per frame in the animation loop:
 *   receptors.update(performance.now() / 1000);
 *   // on player input / judgment:
 *   receptors.flashReceptor('left', 'perfect');
 *   // cleanup:
 *   receptors.dispose();
 */
export class ReceptorRenderer {
  private readonly scene: THREE.Scene;
  private readonly geometry: THREE.BufferGeometry;

  private readonly outlines = new Map<Direction, THREE.LineLoop>();
  private readonly flashStates = new Map<Direction, FlashState>();

  // Pool of pre-allocated ripple LineLoops (Perfect hits only)
  private readonly ripplePool: THREE.LineLoop[] = [];
  private readonly activeRipples: ActiveRipple[] = [];
  private static readonly RIPPLE_POOL_SIZE = 8;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geometry = createOutlineGeometry();

    // Pre-allocate ripple pool
    for (let i = 0; i < ReceptorRenderer.RIPPLE_POOL_SIZE; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.LineLoop(this.geometry, mat);
      line.visible = false;
      scene.add(line);
      this.ripplePool.push(line);
    }

    for (const dir of DIRECTIONS) {
      this.initReceptor(dir);
    }
  }

  private initReceptor(dir: Direction): void {
    const mat = new THREE.LineBasicMaterial({
      color: DIRECTION_COLORS[dir].clone(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    mat.opacity = BREATH_BASE;

    const line = new THREE.LineLoop(this.geometry, mat);
    line.position.set(COLUMN_X[dir], RECEPTOR_Y, 0);
    line.rotation.z = DIRECTION_ROTATION[dir];

    this.scene.add(line);
    this.outlines.set(dir, line);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Trigger a visual response on a receptor.
   * - perfect → bright white flash + expanding ripple
   * - great   → bright color tint flash (no ripple)
   * - miss    → no positive flash (handled elsewhere)
   */
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
        ripple.position.set(COLUMN_X[direction], RECEPTOR_Y, 0);
        ripple.rotation.z = DIRECTION_ROTATION[direction];
        ripple.scale.setScalar(1.0);
        const mat = ripple.material as THREE.LineBasicMaterial;
        mat.opacity = 0.85;
        mat.color.setHex(0xffffff);
        this.activeRipples.push({ startTime: performance.now(), line: ripple });
      }
    }
  }

  /**
   * Animate receptors. Call exactly once per frame before rendering.
   * @param time - elapsed time in **seconds** (e.g. `performance.now() / 1000`)
   */
  update(time: number): void {
    const now = performance.now();
    const breath = BREATH_BASE + BREATH_AMP * Math.sin(time * BREATH_FREQ * Math.PI * 2);

    for (const dir of DIRECTIONS) {
      const line = this.outlines.get(dir)!;
      const mat = line.material as THREE.LineBasicMaterial;
      const flash = this.flashStates.get(dir);

      if (flash) {
        const duration = FLASH_MS[flash.judgment] ?? 0;
        const t = duration > 0 ? Math.min((now - flash.startTime) / duration, 1.0) : 1.0;

        if (t >= 1.0) {
          this.flashStates.delete(dir);
          mat.color.copy(DIRECTION_COLORS[dir]);
          mat.opacity = breath;
        } else {
          // Quadratic ease-out: starts fast, settles gently
          const ease = 1 - t * t;
          const base = DIRECTION_COLORS[dir];

          if (flash.judgment === 'perfect') {
            // Pure white flash — clearly distinct from Great
            mat.color.setRGB(1, 1, 1);
            mat.opacity = BREATH_BASE + ease * 0.70;
          } else {
            // Great: color tinted toward white
            mat.color.setRGB(
              base.r + (1 - base.r) * ease * 0.55,
              base.g + (1 - base.g) * ease * 0.55,
              base.b + (1 - base.b) * ease * 0.55,
            );
            mat.opacity = BREATH_BASE + ease * 0.48;
          }
        }
      } else {
        // Breathing glow
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
        // Expand from 1× to 2.5×, fade out with ease-in
        ripple.line.scale.setScalar(1.0 + t * 1.5);
        (ripple.line.material as THREE.LineBasicMaterial).opacity = 0.85 * (1 - t * t);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.geometry.dispose();
    for (const [, line] of this.outlines) {
      (line.material as THREE.Material).dispose();
      this.scene.remove(line);
    }
    for (const ripple of this.ripplePool) {
      (ripple.material as THREE.Material).dispose();
      this.scene.remove(ripple);
    }
    this.outlines.clear();
    this.activeRipples.length = 0;
  }
}

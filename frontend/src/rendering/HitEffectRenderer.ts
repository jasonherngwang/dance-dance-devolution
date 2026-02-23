import * as THREE from 'three/webgpu';
import type { Direction, JudgmentType } from '@/types';
import { COLUMN_X, RECEPTOR_Y } from './ReceptorRenderer';

// ---------------------------------------------------------------------------
// Pool sizes
// ---------------------------------------------------------------------------

const PARTICLE_POOL = 240; // shared pool for all in-flight particles (increased for hype mode)
const MISS_X_POOL = 8;     // pool of pre-allocated red-X stamps

// ---------------------------------------------------------------------------
// Hype level particle multipliers: 0=1×, 1=1.25×, 2=1.5×, 3=2×
// ---------------------------------------------------------------------------

const HYPE_PARTICLE_MULT = [1.0, 1.25, 1.5, 2.0] as const;

// ---------------------------------------------------------------------------
// Color palettes (additive blending: color intensity encodes brightness)
// ---------------------------------------------------------------------------

const PERFECT_COLORS = [0xffdd00, 0xffffff, 0xff9900, 0xffffaa]; // gold / white
const GREAT_COLORS   = [0x0088ff, 0x44ccff, 0x0044cc, 0x88eeff]; // blue / cyan

// ---------------------------------------------------------------------------
// Internal state shapes
// ---------------------------------------------------------------------------

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;    // seconds remaining
  maxLife: number;
  r: number;       // base color components (premultiplied by particle color)
  g: number;
  b: number;
}

interface MissX {
  active: boolean;
  life: number;
  maxLife: number;
  xs: THREE.LineSegments;
}

// ---------------------------------------------------------------------------
// Exported result type for camera shake
// ---------------------------------------------------------------------------

export interface ShakeResult {
  shakeX: number;
  shakeY: number;
}

// ---------------------------------------------------------------------------
// HitEffectRenderer
// ---------------------------------------------------------------------------

/**
 * GPU-driven hit effect system for rhythm game feedback.
 *
 * - Perfect → gold/white particle explosion (80–120 sparks)
 * - Great   → blue/cyan particle burst (40 sparks)
 * - Miss    → red X stamp + screen shake (5 frames)
 *
 * All particles use additive blending (color intensity = opacity).
 * Uses a fixed-size object pool — zero allocation during gameplay.
 *
 * Usage:
 *   const fx = new HitEffectRenderer(scene);
 *   // On judgment:
 *   fx.triggerHitEffect('left', 'perfect');
 *   // In animation loop:
 *   const { shakeX, shakeY } = fx.update(dt);
 *   camera.position.x = baseCamX + shakeX;
 *   camera.position.y = baseCamY + shakeY;
 *   // Cleanup:
 *   fx.dispose();
 */
export class HitEffectRenderer {
  private readonly scene: THREE.Scene;

  // Particle InstancedMesh (tiny square sparks)
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly particles: Particle[];
  private readonly freePool: number[]; // indices of available particle slots

  // Miss X geometry shared across the pool
  private readonly xGeometry: THREE.BufferGeometry;
  private readonly missXPool: MissX[];

  // Screen shake state
  private shakeFrames = 0;

  // Current hype level (0–3) set externally to scale particle counts
  private _hypeLevel: 0 | 1 | 2 | 3 = 0;

  // Scratch objects — reused every frame to avoid GC pressure
  private readonly _pos   = new THREE.Vector3();
  private readonly _quat  = new THREE.Quaternion(); // identity
  private readonly _scale = new THREE.Vector3();
  private readonly _mat   = new THREE.Matrix4();
  private readonly _color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // -------------------------------------------------------------------------
    // Particle InstancedMesh — tiny squares, one per spark
    // -------------------------------------------------------------------------
    const pGeo = new THREE.PlaneGeometry(0.08, 0.08);
    const pMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,            // white base multiplied by setColorAt() per instance
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, PARTICLE_POOL);
    this.particleMesh.frustumCulled = false;

    // Park all instances off-screen and invisible
    this._pos.set(0, -1000, 0);
    this._scale.setScalar(0.001);
    this._mat.compose(this._pos, this._quat, this._scale);
    const black = new THREE.Color(0, 0, 0);
    for (let i = 0; i < PARTICLE_POOL; i++) {
      this.particleMesh.setMatrixAt(i, this._mat);
      this.particleMesh.setColorAt(i, black);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    scene.add(this.particleMesh);

    // Particle JS state
    this.particles = Array.from({ length: PARTICLE_POOL }, () => ({
      active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, r: 0, g: 0, b: 0,
    }));
    this.freePool = Array.from({ length: PARTICLE_POOL }, (_, i) => i);

    // -------------------------------------------------------------------------
    // Miss X pool — LineSegments forming a red cross
    // -------------------------------------------------------------------------
    this.xGeometry = this.buildXGeometry();
    this.missXPool = [];

    for (let i = 0; i < MISS_X_POOL; i++) {
      const xMat = new THREE.LineBasicMaterial({
        color: 0xff2020,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const xs = new THREE.LineSegments(this.xGeometry, xMat);
      xs.visible = false;
      scene.add(xs);
      this.missXPool.push({ active: false, life: 0, maxLife: 0, xs });
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Set the current hype level (0–3) to scale particle counts.
   * Call this whenever the player's combo crosses a threshold.
   *   0 = baseline (< 10 combo)
   *   1 = 10+ combo  → 1.25× particles
   *   2 = 25+ combo  → 1.5×  particles
   *   3 = 50+ combo  → 2×    particles
   */
  setHypeLevel(level: 0 | 1 | 2 | 3): void {
    this._hypeLevel = level;
  }

  /**
   * Trigger a hit effect at the receptor for the given direction and judgment.
   * Particle counts are scaled by the current hype level.
   * Safe to call at any time (including from inside the animation loop).
   */
  triggerHitEffect(direction: Direction, judgment: JudgmentType): void {
    const x = COLUMN_X[direction];
    const y = RECEPTOR_Y;
    const mult = HYPE_PARTICLE_MULT[this._hypeLevel];

    if (judgment === 'perfect') {
      const base = 80 + Math.floor(Math.random() * 41); // 80–120 base
      const count = Math.min(Math.round(base * mult), PARTICLE_POOL);
      this.spawnBurst(x, y, count, PERFECT_COLORS, 4.5, 0.55);
    } else if (judgment === 'great') {
      const count = Math.min(Math.round(40 * mult), PARTICLE_POOL);
      this.spawnBurst(x, y, count, GREAT_COLORS, 3.5, 0.45);
    } else {
      // miss
      this.spawnMissX(x, y);
      this.shakeFrames = 5; // shake for 5 frames (~83ms at 60fps)
    }
  }

  /**
   * Advance particle simulation by `dt` seconds and compute camera shake offset.
   * Call exactly once per frame, before rendering.
   *
   * @param dt  Delta time in seconds since last frame
   * @returns   {shakeX, shakeY} world-space camera offset for this frame
   */
  update(dt: number): ShakeResult {
    let dirty = false;

    // Advance all active particles
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.life -= dt;

      if (p.life <= 0) {
        // Recycle: hide and return to pool
        p.active = false;
        this.freePool.push(i);

        this._pos.set(0, -1000, 0);
        this._scale.setScalar(0.001);
        this._mat.compose(this._pos, this._quat, this._scale);
        this.particleMesh.setMatrixAt(i, this._mat);
        this._color.setRGB(0, 0, 0);
        this.particleMesh.setColorAt(i, this._color);
        dirty = true;
        continue;
      }

      // Physics: constant velocity + downward gravity
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 6.0 * dt;

      // Visual: shrink and fade as life expires
      const t = p.life / p.maxLife; // 1 → 0
      const scale = 0.04 + t * 0.10;

      this._pos.set(p.x, p.y, 0);
      this._scale.setScalar(scale);
      this._mat.compose(this._pos, this._quat, this._scale);
      this.particleMesh.setMatrixAt(i, this._mat);

      // Encode opacity in color intensity (additive blend: black = invisible)
      this._color.setRGB(p.r * t, p.g * t, p.b * t);
      this.particleMesh.setColorAt(i, this._color);

      dirty = true;
    }

    if (dirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }

    // Animate miss X stamps
    for (const mx of this.missXPool) {
      if (!mx.active) continue;
      mx.life -= dt;
      if (mx.life <= 0) {
        mx.active = false;
        mx.xs.visible = false;
      } else {
        const t = mx.life / mx.maxLife;
        // Fade out + slight scale expansion for a "stamp" feel
        (mx.xs.material as THREE.LineBasicMaterial).opacity = 0.9 * t;
        mx.xs.scale.setScalar(1.0 + (1 - t) * 0.5);
      }
    }

    // Camera shake: random offset per frame, decays over shakeFrames
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeFrames > 0) {
      // Intensity decreases linearly as frames tick down
      const intensity = this.shakeFrames / 5;
      shakeX = (Math.random() - 0.5) * 0.18 * intensity;
      shakeY = (Math.random() - 0.5) * 0.12 * intensity;
      this.shakeFrames--;
    }

    return { shakeX, shakeY };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    (this.particleMesh.geometry as THREE.BufferGeometry).dispose();
    (this.particleMesh.material as THREE.Material).dispose();
    this.scene.remove(this.particleMesh);

    this.xGeometry.dispose();
    for (const mx of this.missXPool) {
      (mx.xs.material as THREE.Material).dispose();
      this.scene.remove(mx.xs);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Spawn a radial burst of particles from (cx, cy).
   *
   * @param cx        World X center
   * @param cy        World Y center
   * @param count     Number of particles to spawn (limited by pool)
   * @param colors    Array of hex colors (chosen randomly per particle)
   * @param speed     Base speed in world-units/second
   * @param maxLifeBase  Maximum lifetime in seconds (randomized per particle)
   */
  private spawnBurst(
    cx: number,
    cy: number,
    count: number,
    colors: number[],
    speed: number,
    maxLifeBase: number,
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.freePool.length === 0) break; // pool exhausted — skip remaining

      const idx = this.freePool.pop()!;
      const p = this.particles[idx];

      const angle = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7); // speed jitter ±70%
      const hex = colors[Math.floor(Math.random() * colors.length)];

      // Unpack hex color into linear RGB (stored as float 0–1)
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8)  & 0xff) / 255;
      const b = ( hex        & 0xff) / 255;

      p.active  = true;
      p.x       = cx + (Math.random() - 0.5) * 0.20;
      p.y       = cy + (Math.random() - 0.5) * 0.20;
      p.vx      = Math.cos(angle) * s;
      p.vy      = Math.sin(angle) * s;
      p.maxLife = maxLifeBase * (0.4 + Math.random() * 0.6); // lifetime jitter
      p.life    = p.maxLife;
      p.r       = r;
      p.g       = g;
      p.b       = b;
    }
  }

  /** Claim a miss X from the pool and activate it at (x, y). */
  private spawnMissX(x: number, y: number): void {
    const mx = this.missXPool.find(m => !m.active);
    if (!mx) return;

    mx.active  = true;
    mx.maxLife = 0.35;
    mx.life    = 0.35;

    mx.xs.position.set(x, y, 0);
    mx.xs.scale.setScalar(1.0);
    (mx.xs.material as THREE.LineBasicMaterial).opacity = 0.9;
    mx.xs.visible = true;
  }

  /** Build a ± diagonal X geometry (two line segments). */
  private buildXGeometry(): THREE.BufferGeometry {
    const s = 0.28;
    const positions = new Float32Array([
      -s, -s, 0,   s,  s, 0, // diagonal ↗
       s, -s, 0,  -s,  s, 0, // diagonal ↖
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }
}

import * as THREE from "three/webgpu";
import type { Direction, JudgmentType } from "@/types";
import { COLUMN_X, RECEPTOR_Y } from "./ReceptorRenderer";
import { DIRECTION_COLORS } from "./ArrowRenderer";

// ---------------------------------------------------------------------------
// Pool sizes
// ---------------------------------------------------------------------------

const PARTICLE_POOL = 400;
const MISS_X_POOL = 8;
const SHOCKWAVE_POOL = 12; // expanding ring bursts
const FLASH_POOL = 8; // instant bright pop at hit point
const BEAM_POOL = 12; // vertical laser beams for high combos

// ---------------------------------------------------------------------------
// Hype level particle multipliers: 0=1×, 1=1.4×, 2=1.8×, 3=2.5×
// ---------------------------------------------------------------------------

const HYPE_PARTICLE_MULT = [1.0, 1.4, 1.8, 2.5] as const;

// ---------------------------------------------------------------------------
// Color palettes (additive blending: color intensity encodes brightness)
// ---------------------------------------------------------------------------

const PERFECT_COLORS = [0xff007f, 0x00ffff, 0xffcc00, 0x0044ff, 0xffffff]; // 2000s PS2 Perfect (Pink/Cyan/Gold)
const GREAT_COLORS = [0xaaff00, 0x00ffff, 0x00aa33, 0xaaffcc, 0xffffff]; // 2000s PS2 Great (Lime/Cyan)

// ---------------------------------------------------------------------------
// Internal state shapes
// ---------------------------------------------------------------------------

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  g: number;
  b: number;
}

interface MissX {
  active: boolean;
  life: number;
  maxLife: number;
  xs: THREE.LineSegments;
}

interface Shockwave {
  mesh: THREE.Mesh;
  active: boolean;
  life: number;
  maxLife: number;
}

interface PopFlash {
  mesh: THREE.Mesh;
  active: boolean;
  life: number;
  maxLife: number;
  peakOpacity: number;
}

interface Beam {
  mesh: THREE.Mesh;
  active: boolean;
  life: number;
  maxLife: number;
  peakOpacity: number;
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

export class HitEffectRenderer {
  private readonly scene: THREE.Scene;

  // Particle InstancedMesh
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly particles: Particle[];
  private readonly freePool: number[];

  // Miss X pool
  private readonly xGeometry: THREE.BufferGeometry;
  private readonly missXPool: MissX[];

  // Shockwave ring pool
  private readonly shockwaves: Shockwave[];

  // Pop flash pool
  private readonly popFlashes: PopFlash[];

  // Beam pool
  private readonly beams: Beam[];

  // Camera shake state
  private shakeFrames = 0;
  private shakeIntensity = 0.18;

  private _hypeLevel: 0 | 1 | 2 | 3 = 0;
  private _mobileFactor = 1.0;

  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat = new THREE.Matrix4();
  private readonly _color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // -------------------------------------------------------------------------
    // Particle InstancedMesh
    // -------------------------------------------------------------------------
    const pGeo = new THREE.PlaneGeometry(0.1, 0.1);
    const pMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, PARTICLE_POOL);
    this.particleMesh.frustumCulled = false;

    this._pos.set(0, -1000, 0);
    this._scale.setScalar(0.001);
    this._mat.compose(this._pos, this._quat, this._scale);
    const black = new THREE.Color(0, 0, 0);
    for (let i = 0; i < PARTICLE_POOL; i++) {
      this.particleMesh.setMatrixAt(i, this._mat);
      this.particleMesh.setColorAt(i, black);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor)
      this.particleMesh.instanceColor.needsUpdate = true;
    scene.add(this.particleMesh);

    this.particles = Array.from({ length: PARTICLE_POOL }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
      r: 0,
      g: 0,
      b: 0,
    }));
    this.freePool = Array.from({ length: PARTICLE_POOL }, (_, i) => i);

    // -------------------------------------------------------------------------
    // Miss X pool
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

    // -------------------------------------------------------------------------
    // Shockwave ring pool
    // -------------------------------------------------------------------------
    const ringGeo = new THREE.RingGeometry(0.88, 1.0, 40);
    this.shockwaves = [];
    for (let i = 0; i < SHOCKWAVE_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.position.z = 0.2;
      scene.add(mesh);
      this.shockwaves.push({ mesh, active: false, life: 0, maxLife: 0 });
    }

    // -------------------------------------------------------------------------
    // Pop flash pool — bright filled disc at hit point
    // -------------------------------------------------------------------------
    const discGeo = new THREE.CircleGeometry(1.0, 32);
    this.popFlashes = [];
    for (let i = 0; i < FLASH_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(discGeo, mat);
      mesh.visible = false;
      mesh.position.z = 0.15;
      scene.add(mesh);
      this.popFlashes.push({
        mesh,
        active: false,
        life: 0,
        maxLife: 0,
        peakOpacity: 0,
      });
    }

    // -------------------------------------------------------------------------
    // Beam pool — vertical laser beams for high combos
    // -------------------------------------------------------------------------
    const beamGeo = new THREE.PlaneGeometry(0.8, 40);
    // Move origin to bottom of the beam so it shoots upward
    beamGeo.translate(0, 20, 0);
    this.beams = [];
    for (let i = 0; i < BEAM_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.position.z = 0.05; // Slightly behind flashes
      scene.add(mesh);
      this.beams.push({
        mesh,
        active: false,
        life: 0,
        maxLife: 0,
        peakOpacity: 0,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Pre-warm WebGPU render pipelines for hit effects.
   *
   * Makes one instance of each pool type briefly visible (at near-zero scale)
   * so the GPU compiles their render pipelines during the 3-second countdown
   * rather than on first use at GO!, which would stall that frame.
   *
   * Call once right after construction, before the animation loop starts.
   */
  prewarm(): void {
    const toRestore: THREE.Object3D[] = [];
    const showTemp = (obj: THREE.Object3D) => {
      obj.visible = true;
      obj.scale.setScalar(0.001);
      toRestore.push(obj);
    };

    if (this.shockwaves[0]) showTemp(this.shockwaves[0].mesh);
    if (this.popFlashes[0]) showTemp(this.popFlashes[0].mesh);
    if (this.missXPool[0]) showTemp(this.missXPool[0].xs);
    if (this.beams[0]) showTemp(this.beams[0].mesh);

    // Hide after a few animation frames — enough for pipeline compilation.
    setTimeout(() => {
      for (const obj of toRestore) {
        obj.visible = false;
        obj.scale.setScalar(1);
      }
    }, 100);
  }

  setHypeLevel(level: 0 | 1 | 2 | 3): void {
    this._hypeLevel = level;
  }

  setMobileFactor(factor: number): void {
    this._mobileFactor = Math.max(0.1, Math.min(1.0, factor));
  }

  triggerHitEffect(direction: Direction, judgment: JudgmentType): void {
    const x = COLUMN_X[direction];
    const y = RECEPTOR_Y;
    const mult = HYPE_PARTICLE_MULT[this._hypeLevel] * this._mobileFactor;
    const dirColor = DIRECTION_COLORS[direction].getHex();

    if (judgment === "perfect") {
      const base = 250 + Math.floor(Math.random() * 51); // increased base particles 250-300
      const count = Math.min(Math.round(base * mult), PARTICLE_POOL);
      this.spawnBurst(x, y, count, [...PERFECT_COLORS, dirColor], 9.0, 0.7);
      this.spawnShockwave(x, y, dirColor, 0.3, 1.0); // fast inner ring
      this.spawnShockwave(x, y, 0xffffff, 0.4, 0.9); // slower outer ring
      this.spawnShockwave(x, y, dirColor, 0.55, 0.7); // trailing ring
      this.spawnPopFlash(x, y, dirColor, 0.12, 0.9);

      // Add beams for high hype levels
      if (this._hypeLevel >= 2) {
        this.spawnBeam(x, -5, dirColor, 0.3, 0.8);
      }
      if (this._hypeLevel >= 3) {
        this.spawnBeam(x, -5, 0xffffff, 0.2, 1.0); // Extra bright core beam
      }

      this.shakeFrames = 2 + this._hypeLevel * 1;
      this.shakeIntensity = 0.05 + this._hypeLevel * 0.015;
    } else if (judgment === "great") {
      const count = Math.min(Math.round(120 * mult), PARTICLE_POOL);
      this.spawnBurst(x, y, count, [...GREAT_COLORS, dirColor], 7.0, 0.55);
      this.spawnShockwave(x, y, dirColor, 0.28, 0.85);
      this.spawnShockwave(x, y, 0xffffff, 0.38, 0.65);
      this.spawnPopFlash(x, y, dirColor, 0.1, 0.6);
      this.shakeFrames = 2 + this._hypeLevel;
      this.shakeIntensity = 0.03 + this._hypeLevel * 0.01;
    } else {
      // miss
      this.spawnMissX(x, y);
      this.shakeFrames = 3;
      this.shakeIntensity = 0.08;
    }
  }

  update(dt: number): ShakeResult {
    let dirty = false;

    for (let i = 0; i < PARTICLE_POOL; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.life -= dt;

      if (p.life <= 0) {
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

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 8.0 * dt; // stronger gravity for snappier arc

      const t = p.life / p.maxLife; // 1 → 0
      // Start large, shrink to almost nothing — more dramatic "pop"
      const scale = 0.02 + t * 0.22;

      this._pos.set(p.x, p.y, 0.1);
      this._scale.setScalar(scale);
      this._mat.compose(this._pos, this._quat, this._scale);
      this.particleMesh.setMatrixAt(i, this._mat);

      // Brightness spikes at start, fades out — use t^0.5 for slower fade-in feel
      const brightness = Math.pow(t, 0.5);
      this._color.setRGB(p.r * brightness, p.g * brightness, p.b * brightness);
      this.particleMesh.setColorAt(i, this._color);

      dirty = true;
    }

    if (dirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor)
        this.particleMesh.instanceColor.needsUpdate = true;
    }

    // Animate shockwave rings
    for (const sw of this.shockwaves) {
      if (!sw.active) continue;
      sw.life -= dt;
      if (sw.life <= 0) {
        sw.active = false;
        sw.mesh.visible = false;
      } else {
        const t = 1 - sw.life / sw.maxLife; // 0 → 1 (expansion progress)
        const eased = 1 - (1 - t) * (1 - t); // ease-out
        sw.mesh.scale.setScalar(0.15 + eased * 4.0); // 0.15 → 4.15
        const opacity = (sw.life / sw.maxLife) * 0.8;
        (sw.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      }
    }

    // Animate pop flashes
    for (const pf of this.popFlashes) {
      if (!pf.active) continue;
      pf.life -= dt;
      if (pf.life <= 0) {
        pf.active = false;
        pf.mesh.visible = false;
      } else {
        const t = pf.life / pf.maxLife; // 1 → 0
        // Expand quickly while fading
        const scale = 0.4 + (1 - t) * 1.5; // expand a bit more
        pf.mesh.scale.setScalar(scale);
        (pf.mesh.material as THREE.MeshBasicMaterial).opacity =
          t * t * pf.peakOpacity;
      }
    }

    // Animate beams
    for (const b of this.beams) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        b.mesh.visible = false;
      } else {
        const t = b.life / b.maxLife; // 1 -> 0
        // Beams shrink horizontally as they fade out
        b.mesh.scale.set(t, 1, 1);
        (b.mesh.material as THREE.MeshBasicMaterial).opacity =
          t * b.peakOpacity;
      }
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
        (mx.xs.material as THREE.LineBasicMaterial).opacity = 0.9 * t;
        mx.xs.scale.setScalar(1.0 + (1 - t) * 0.5);
      }
    }

    // Camera shake
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeFrames > 0) {
      const intensity = (this.shakeFrames / 6) * this.shakeIntensity;
      shakeX = (Math.random() - 0.5) * 2 * intensity;
      shakeY = (Math.random() - 0.5) * 2 * intensity;
      this.shakeFrames--;
    }

    return { shakeX, shakeY };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private spawnBurst(
    cx: number,
    cy: number,
    count: number,
    colors: number[],
    speed: number,
    maxLifeBase: number,
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.freePool.length === 0) break;

      const idx = this.freePool.pop()!;
      const p = this.particles[idx];

      const angle = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.75);
      const hex = colors[Math.floor(Math.random() * colors.length)];

      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;

      p.active = true;
      p.x = cx + (Math.random() - 0.5) * 0.15;
      p.y = cy + (Math.random() - 0.5) * 0.15;
      p.vx = Math.cos(angle) * s;
      p.vy = Math.sin(angle) * s;
      p.maxLife = maxLifeBase * (0.35 + Math.random() * 0.65);
      p.life = p.maxLife;
      p.r = r;
      p.g = g;
      p.b = b;
    }
  }

  private spawnShockwave(
    x: number,
    y: number,
    colorHex: number,
    maxLife: number,
    peakOpacity: number,
  ): void {
    const sw = this.shockwaves.find((s) => !s.active);
    if (!sw) return;
    sw.active = true;
    sw.maxLife = maxLife;
    sw.life = maxLife;
    sw.mesh.position.set(x, y, 0.2);
    sw.mesh.scale.setScalar(0.15);
    (sw.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    (sw.mesh.material as THREE.MeshBasicMaterial).opacity = peakOpacity;
    sw.mesh.visible = true;
  }

  private spawnPopFlash(
    x: number,
    y: number,
    colorHex: number,
    maxLife: number,
    peakOpacity: number,
  ): void {
    const pf = this.popFlashes.find((f) => !f.active);
    if (!pf) return;
    pf.active = true;
    pf.maxLife = maxLife;
    pf.life = maxLife;
    pf.peakOpacity = peakOpacity;
    pf.mesh.position.set(x, y, 0.15);
    pf.mesh.scale.setScalar(0.4);
    (pf.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    (pf.mesh.material as THREE.MeshBasicMaterial).opacity = peakOpacity;
    pf.mesh.visible = true;
  }

  private spawnBeam(
    x: number,
    y: number,
    colorHex: number,
    maxLife: number,
    peakOpacity: number,
  ): void {
    const b = this.beams.find((beam) => !beam.active);
    if (!b) return;
    b.active = true;
    b.maxLife = maxLife;
    b.life = maxLife;
    b.peakOpacity = peakOpacity;
    b.mesh.position.set(x, y, 0.05); // Set origin bottom
    b.mesh.scale.set(1, 1, 1);
    (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    (b.mesh.material as THREE.MeshBasicMaterial).opacity = peakOpacity;
    b.mesh.visible = true;
  }

  private spawnMissX(x: number, y: number): void {
    const mx = this.missXPool.find((m) => !m.active);
    if (!mx) return;
    mx.active = true;
    mx.maxLife = 0.35;
    mx.life = 0.35;
    mx.xs.position.set(x, y, 0);
    mx.xs.scale.setScalar(1.0);
    (mx.xs.material as THREE.LineBasicMaterial).opacity = 0.9;
    mx.xs.visible = true;
  }

  private buildXGeometry(): THREE.BufferGeometry {
    const s = 0.28;
    const positions = new Float32Array([
      -s,
      -s,
      0,
      s,
      s,
      0,
      s,
      -s,
      0,
      -s,
      s,
      0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    return geo;
  }

  public dispose(): void {
    // Dipose InstancedMesh
    if (this.particleMesh) {
      this.particleMesh.geometry.dispose();
      (this.particleMesh.material as THREE.Material).dispose();
      this.scene.remove(this.particleMesh);
    }

    // Dispose X Marks
    this.missXPool.forEach((mx) => {
      mx.xs.geometry.dispose();
      if (Array.isArray(mx.xs.material)) {
        mx.xs.material.forEach((mat) => mat.dispose());
      } else {
        mx.xs.material.dispose();
      }
      this.scene.remove(mx.xs);
    });

    // Dispose Shockwaves
    this.shockwaves.forEach((sw) => {
      sw.mesh.geometry.dispose();
      (sw.mesh.material as THREE.Material).dispose();
      this.scene.remove(sw.mesh);
    });

    // Dispose Flashes
    this.popFlashes.forEach((pf) => {
      pf.mesh.geometry.dispose();
      (pf.mesh.material as THREE.Material).dispose();
      this.scene.remove(pf.mesh);
    });

    // Dispose Beams
    this.beams.forEach((b) => {
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      this.scene.remove(b.mesh);
    });
  }
}

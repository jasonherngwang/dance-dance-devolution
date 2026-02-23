import * as THREE from 'three/webgpu';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** World-Y of the "horizon" — matches RECEPTOR_Y in ReceptorRenderer */
const HORIZON_Y = 3.5;
/** World-Y of the grid floor bottom (safely below visible area) */
const BOTTOM_Y = -5.5;
/** Half-width of the grid in world units (wider than any expected viewport) */
const SCREEN_HALF_WIDTH = 11;

// Perspective formula:  screen_y = HORIZON_Y - GRID_C / z
// where z is the "depth" of the floor line (z_near = close, z_far = far away)
const GRID_Z_NEAR = 0.8;
const GRID_Z_FAR = 42.0;
/** C such that z=GRID_Z_NEAR maps to BOTTOM_Y */
const GRID_C = GRID_Z_NEAR * (HORIZON_Y - BOTTOM_Y);

/** Number of animated horizontal grid lines */
const GRID_H_COUNT = 18;
/** Number of vertical (radial) grid lines converging to vanishing point */
const GRID_V_COUNT = 11;
/** Scroll speed (perspective-space units per second) */
const GRID_SCROLL_SPEED = 3.0;

/** Number of ambient background particles */
const AMBIENT_COUNT = 45;
/** Number of pre-allocated beat-pulse rings */
const PULSE_RING_COUNT = 4;

// Brightness per hype level (0–3)
const GRID_BRIGHTNESS = [0.22, 0.32, 0.48, 0.70] as const;
const AMBIENT_SPEED_MULT = [1.0, 1.4, 1.8, 2.5] as const;

// ---------------------------------------------------------------------------
// Ambient particle state
// ---------------------------------------------------------------------------

interface AmbientParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  g: number;
  b: number;
  phase: number; // for opacity sine wave
}

// ---------------------------------------------------------------------------
// Beat-pulse ring state
// ---------------------------------------------------------------------------

interface PulseRing {
  mesh: THREE.Mesh;
  active: boolean;
  life: number;   // seconds elapsed
  maxLife: number;
}

// ---------------------------------------------------------------------------
// Reusable scratch objects (no per-frame allocation)
// ---------------------------------------------------------------------------

const _mat4 = new THREE.Matrix4();
const _col  = new THREE.Color();

// ---------------------------------------------------------------------------
// BackgroundRenderer
// ---------------------------------------------------------------------------

/**
 * Background visuals for the rhythm game (Issue 14):
 *
 * • Animated Tron-style perspective grid (horizontal lines scroll toward viewer,
 *   vertical lines converge to vanishing point at the receptor row).
 * • Ambient floating particles — subtle, neon-colored, slow drift.
 * • Beat-reactive radial glow — expanding ring pulse on beat events.
 * • Combo-level intensity scaling — grid brightness and particle speed increase
 *   with hype level (0–3, matching HitEffectRenderer).
 *
 * All objects are placed at z = -1 (behind game elements at z = 0).
 * Uses additive blending throughout for the neon glow look.
 *
 * Usage:
 *   const bg = new BackgroundRenderer(scene);
 *   // In animation loop:
 *   bg.update(dt, realElapsed);
 *   // On beat:
 *   bg.pulseOnBeat();
 *   // On combo change:
 *   bg.setComboLevel(level); // 0|1|2|3
 *   // Cleanup:
 *   bg.dispose();
 */
export class BackgroundRenderer {
  private readonly scene: THREE.Scene;

  // --- Grid ---
  private gridGeom!: THREE.BufferGeometry;
  private gridMesh!: THREE.LineSegments;
  private gridPositions!: Float32Array;
  private gridColors!: Float32Array;
  private gridScrollZ = 0; // animation offset in perspective-z space

  // --- Ambient particles ---
  private ambientMesh!: THREE.InstancedMesh;
  private ambientParticles!: AmbientParticle[];

  // --- Beat pulse rings ---
  private pulseRings!: PulseRing[];
  private pulseRingIdx = 0; // next ring to reuse

  // --- State ---
  private comboLevel: 0 | 1 | 2 | 3 = 0;
  private gridBrightness: number = GRID_BRIGHTNESS[0];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this._initGrid();
    this._initAmbientParticles();
    this._initPulseRings();
  }

  // ---------------------------------------------------------------------------
  // Initialisation helpers
  // ---------------------------------------------------------------------------

  private _initGrid(): void {
    const lineCount = GRID_H_COUNT + GRID_V_COUNT;
    // 2 endpoints × 3 floats (x, y, z) per line
    this.gridPositions = new Float32Array(lineCount * 2 * 3);
    this.gridColors    = new Float32Array(lineCount * 2 * 3);

    this.gridGeom = new THREE.BufferGeometry();
    this.gridGeom.setAttribute('position', new THREE.BufferAttribute(this.gridPositions, 3));
    this.gridGeom.setAttribute('color',    new THREE.BufferAttribute(this.gridColors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    this.gridMesh = new THREE.LineSegments(this.gridGeom, mat);
    this.gridMesh.position.z = -1;
    this.scene.add(this.gridMesh);

    // Populate static vertical lines (they don't change shape, only colour)
    this._updateVerticalLines();
  }

  private _initAmbientParticles(): void {
    // Small square sprites for ambient dust
    const planeGeo = new THREE.PlaneGeometry(0.07, 0.07);

    const mat = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    this.ambientMesh = new THREE.InstancedMesh(planeGeo, mat, AMBIENT_COUNT);
    this.ambientMesh.position.z = -0.9;
    // Hide all initially — positions set in _randomiseParticle
    this.ambientMesh.count = AMBIENT_COUNT;
    this.scene.add(this.ambientMesh);

    this.ambientParticles = [];

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const p: AmbientParticle = { x: 0, y: 0, vx: 0, vy: 0, r: 0, g: 0, b: 0, phase: 0 };
      this._randomiseParticle(p, true);
      this.ambientParticles.push(p);
    }
  }

  private _initPulseRings(): void {
    this.pulseRings = [];

    // Use a ring geometry: inner radius close to 0 so it looks like a thin expanding disc edge
    const geo = new THREE.RingGeometry(0.9, 1.0, 48);

    for (let i = 0; i < PULSE_RING_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00ffee,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = -0.8;
      mesh.visible = false;
      this.scene.add(mesh);
      this.pulseRings.push({ mesh, active: false, life: 0, maxLife: 0.55 });
    }
  }

  // ---------------------------------------------------------------------------
  // Particle helpers
  // ---------------------------------------------------------------------------

  /** Randomise (or re-randomise) a particle. If `spread` is true the particle
   *  can be placed anywhere in the viewport; otherwise it starts at the bottom. */
  private _randomiseParticle(p: AmbientParticle, spread: boolean): void {
    p.x = (Math.random() * 2 - 1) * SCREEN_HALF_WIDTH;
    p.y = spread
      ? (Math.random() * (HORIZON_Y - BOTTOM_Y) + BOTTOM_Y)
      : BOTTOM_Y - Math.random() * 2;

    // Gentle upward drift with small horizontal wander
    const speed = 0.3 + Math.random() * 0.5;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;

    // Neon colour: cyan, magenta, or white
    const roll = Math.random();
    if (roll < 0.4) {
      p.r = 0.0; p.g = 0.8; p.b = 0.9;  // cyan
    } else if (roll < 0.7) {
      p.r = 0.9; p.g = 0.0; p.b = 0.9;  // magenta
    } else {
      p.r = 0.6; p.g = 0.9; p.b = 1.0;  // ice-white
    }

    p.phase = Math.random() * Math.PI * 2;
  }

  // ---------------------------------------------------------------------------
  // Grid update helpers
  // ---------------------------------------------------------------------------

  /** Compute the world-Y of a horizontal grid line at perspective depth z. */
  private _perspY(z: number): number {
    return HORIZON_Y - GRID_C / z;
  }

  /** Write a single line segment (two endpoints) into the flat arrays.
   *  @param idx  Line index (0-based)
   *  @param x0,y0  Start vertex
   *  @param x1,y1  End vertex
   *  @param r,g,b  Color (same for both endpoints) */
  private _writeLine(
    idx: number,
    x0: number, y0: number,
    x1: number, y1: number,
    r: number, g: number, b: number,
  ): void {
    const v = idx * 6; // 2 verts × 3 components
    this.gridPositions[v + 0] = x0; this.gridPositions[v + 1] = y0; this.gridPositions[v + 2] = 0;
    this.gridPositions[v + 3] = x1; this.gridPositions[v + 4] = y1; this.gridPositions[v + 5] = 0;
    this.gridColors[v + 0] = r; this.gridColors[v + 1] = g; this.gridColors[v + 2] = b;
    this.gridColors[v + 3] = r; this.gridColors[v + 4] = g; this.gridColors[v + 5] = b;
  }

  /** Update the GRID_V_COUNT vertical (radial) lines.  Called only when
   *  brightness changes because their shape is static. */
  private _updateVerticalLines(): void {
    const base = GRID_H_COUNT; // vertical lines follow horizontal lines in the buffer
    for (let i = 0; i < GRID_V_COUNT; i++) {
      const t = i / (GRID_V_COUNT - 1);
      const xBottom = -SCREEN_HALF_WIDTH + t * 2 * SCREEN_HALF_WIDTH;
      // Colour is slightly dimmer than horizontal lines
      const bright = this.gridBrightness * 0.65;
      // Fade toward horizon (top) to reinforce the perspective illusion
      this._writeLine(
        base + i,
        0, HORIZON_Y,              // vanishing point
        xBottom, BOTTOM_Y,        // bottom of screen
        0, bright * 0.6, bright,  // cyan-ish
      );
    }
  }

  /** Rebuild horizontal grid lines using current scroll offset. */
  private _updateHorizontalLines(): void {
    const zRange = GRID_Z_FAR - GRID_Z_NEAR;
    const br = this.gridBrightness;

    for (let i = 0; i < GRID_H_COUNT; i++) {
      // Base z for this line (evenly distributed in perspective-z space)
      const baseZ = GRID_Z_NEAR + zRange * (i / GRID_H_COUNT);
      // Animated z — wrap within [GRID_Z_NEAR, GRID_Z_FAR)
      let z = GRID_Z_NEAR + ((baseZ - GRID_Z_NEAR + this.gridScrollZ) % zRange);
      if (z < GRID_Z_NEAR) z += zRange;

      const y = this._perspY(z);
      if (y > HORIZON_Y || y < BOTTOM_Y) continue; // outside view — skip (will be black anyway)

      // Opacity: lines further away (larger z) are dimmer (fade to nothing at horizon)
      const depthT = (z - GRID_Z_NEAR) / zRange; // 0 = near (bright), 1 = far (dim)
      const lineBr  = br * (1.0 - depthT * 0.82);

      // Colour: cyan (#00FFEE equivalent), with slight blue shift for distant lines
      const r = 0;
      const g = lineBr * (0.85 - depthT * 0.4);
      const b = lineBr;

      this._writeLine(
        i,
        -SCREEN_HALF_WIDTH, y,
         SCREEN_HALF_WIDTH, y,
        r, g, b,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Set hype / combo level (0–3).  Affects grid brightness, particle speed. */
  setComboLevel(level: 0 | 1 | 2 | 3): void {
    if (level === this.comboLevel) return;
    this.comboLevel = level;
    this.gridBrightness = GRID_BRIGHTNESS[level];
    // Immediately update vertical lines' brightness (horizontal updated each frame)
    this._updateVerticalLines();
    this.gridGeom.attributes['color'].needsUpdate = true;
  }

  /** Trigger a radial beat-pulse glow at the screen centre. */
  pulseOnBeat(): void {
    const ring = this.pulseRings[this.pulseRingIdx % PULSE_RING_COUNT];
    this.pulseRingIdx++;

    ring.active = true;
    ring.life = 0;
    ring.mesh.scale.setScalar(0.15);
    ring.mesh.visible = true;
    (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
  }

  /**
   * Advance background simulation by `dt` seconds.
   * @param dt         Frame delta time (seconds, capped by caller)
   * @param realElapsed Monotonically increasing seconds since start (for oscillations)
   */
  update(dt: number, realElapsed: number): void {
    this._updateGrid(dt);
    this._updateAmbientParticles(dt, realElapsed);
    this._updatePulseRings(dt);
  }

  // ---------------------------------------------------------------------------
  // Per-frame update helpers
  // ---------------------------------------------------------------------------

  private _updateGrid(dt: number): void {
    this.gridScrollZ += dt * GRID_SCROLL_SPEED;
    // Wrap within z range to avoid floating-point drift over long sessions
    const zRange = GRID_Z_FAR - GRID_Z_NEAR;
    if (this.gridScrollZ > zRange) this.gridScrollZ -= zRange;

    this._updateHorizontalLines();
    // Vertical line colours may change with brightness — update them too
    this._updateVerticalLines();

    this.gridGeom.attributes['position'].needsUpdate = true;
    this.gridGeom.attributes['color'].needsUpdate    = true;
  }

  private _updateAmbientParticles(dt: number, realElapsed: number): void {
    const speedMult = AMBIENT_SPEED_MULT[this.comboLevel];

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const p = this.ambientParticles[i];

      // Move
      p.x += p.vx * dt * speedMult;
      p.y += p.vy * dt * speedMult;

      // Respawn if off-screen (top or sides)
      if (p.y > HORIZON_Y + 0.5 || p.x < -SCREEN_HALF_WIDTH - 0.5 || p.x > SCREEN_HALF_WIDTH + 0.5) {
        this._randomiseParticle(p, false);
      }

      // Opacity oscillates gently
      const opacityBase = 0.08 + 0.12 * this.comboLevel * 0.25;
      const opacity = (opacityBase + 0.05 * Math.sin(realElapsed * 1.5 + p.phase)) *
                      (0.5 + 0.5 * this.comboLevel * 0.33);
      const finalOpacity = Math.max(0.04, Math.min(0.35, opacity + this.comboLevel * 0.06));

      // Build instance matrix (position + scale)
      const scale = 0.6 + this.comboLevel * 0.15;
      _mat4.makeScale(scale, scale, 1);
      _mat4.setPosition(p.x, p.y, 0);
      this.ambientMesh.setMatrixAt(i, _mat4);

      // Set colour (additive — multiply rgb by opacity to encode alpha)
      _col.setRGB(p.r * finalOpacity, p.g * finalOpacity, p.b * finalOpacity);
      this.ambientMesh.setColorAt(i, _col);
    }

    this.ambientMesh.instanceMatrix.needsUpdate = true;
    if (this.ambientMesh.instanceColor) this.ambientMesh.instanceColor.needsUpdate = true;
  }

  private _updatePulseRings(dt: number): void {
    for (const ring of this.pulseRings) {
      if (!ring.active) continue;

      ring.life += dt;
      const t = ring.life / ring.maxLife; // 0 → 1

      if (t >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }

      // Ease-out expansion: fast at start, slows down
      const eased = 1 - (1 - t) * (1 - t);
      const scale = 0.15 + eased * 4.5;   // expands to ~4.65 world-unit radius
      ring.mesh.scale.setScalar(scale);

      // Opacity fades out from 0.7 → 0
      const opacity = 0.7 * (1 - t);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.gridMesh.geometry.dispose();
    (this.gridMesh.material as THREE.Material).dispose();
    this.scene.remove(this.gridMesh);

    this.ambientMesh.geometry.dispose();
    (this.ambientMesh.material as THREE.Material).dispose();
    this.scene.remove(this.ambientMesh);

    for (const ring of this.pulseRings) {
      ring.mesh.geometry.dispose();
      (ring.mesh.material as THREE.Material).dispose();
      this.scene.remove(ring.mesh);
    }
  }
}

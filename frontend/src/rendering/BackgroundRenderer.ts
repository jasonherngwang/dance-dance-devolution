import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_HALF_WIDTH = 11;
const HORIZON_Y = 3.5;
const BOTTOM_Y = -5.5;

/** Concentric ring settings — DDR-style psychedelic expanding circles */
const RING_SEGMENTS = 64; // vertices per ring
const RING_COUNT = 18; // pre-allocated ring meshes
const RING_MAX_RADIUS = 9; // world units — rings wrap at this radius
const RING_BASE_SPEED = 1.6; // world units per second at base combo level

/** Hype-level scaling */
const RING_SPEED_MULT = [1.0, 1.35, 1.75, 2.4] as const;
const RING_BRIGHTNESS = [0.28, 0.42, 0.58, 0.85] as const;
const AMBIENT_SPEED_MULT = [1.0, 1.4, 1.8, 2.5] as const;

const AMBIENT_COUNT = 40;
const PULSE_RING_COUNT = 4;

// DDR-authentic ring color palette: blue/cyan dominant (classic DDR 2nd Mix blue)
const RING_COLORS: [number, number, number][] = [
  [0.0, 0.55, 1.0], // bright blue
  [0.0, 0.85, 1.0], // cyan-blue
  [0.1, 0.3, 1.0], // royal blue
  [0.0, 1.0, 0.9], // cyan-teal
  [0.35, 0.0, 1.0], // blue-violet (accent)
  [0.0, 0.7, 0.8], // steel teal
];

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface ConcentricRing {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  radius: number;
  colorIdx: number;
}

interface AmbientParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  g: number;
  b: number;
  phase: number;
}

interface PulseRing {
  mesh: THREE.Mesh;
  active: boolean;
  life: number;
  maxLife: number;
}

// ---------------------------------------------------------------------------
// Scratch objects (no per-frame allocation)
// ---------------------------------------------------------------------------

const _mat4 = new THREE.Matrix4();
const _col = new THREE.Color();

// ---------------------------------------------------------------------------
// Helper — unit circle geometry shared by all ring lines
// ---------------------------------------------------------------------------

function createCircleGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

// ---------------------------------------------------------------------------
// BackgroundRenderer
// ---------------------------------------------------------------------------

/**
 * DDR-style psychedelic background for the rhythm game:
 *
 * • Animated concentric rings — expand from center outward, cycling through
 *   a DDR-authentic color palette (purple, hot pink, teal, magenta…).
 * • Ambient floating particles — purple/pink/teal drifting upward.
 * • Beat-reactive radial glow — expanding ring burst on beat events.
 * • Combo-level intensity scaling — rings speed up and brighten with hype.
 *
 * All objects are placed at z = -1 (behind game elements at z = 0).
 * Uses additive blending throughout.
 */
export class BackgroundRenderer {
  private readonly scene: THREE.Scene;

  // --- Concentric rings ---
  private readonly circleGeom: THREE.BufferGeometry;
  private readonly rings: ConcentricRing[] = [];

  // --- Ambient particles ---
  private ambientMesh!: THREE.InstancedMesh;
  private ambientParticles!: AmbientParticle[];

  // --- Beat pulse rings ---
  private pulseRings!: PulseRing[];
  private pulseRingIdx = 0;

  // --- State ---
  private comboLevel: 0 | 1 | 2 | 3 = 0;
  private ringBrightness: number = RING_BRIGHTNESS[0];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.circleGeom = createCircleGeometry();
    this._initConcentricRings();
    this._initAmbientParticles();
    this._initPulseRings();
  }

  // ---------------------------------------------------------------------------
  // Initialisation helpers
  // ---------------------------------------------------------------------------

  private _initConcentricRings(): void {
    for (let i = 0; i < RING_COUNT; i++) {
      const colorIdx = i % RING_COLORS.length;
      const [cr, cg, cb] = RING_COLORS[colorIdx];
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(cr, cg, cb),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(this.circleGeom, mat);
      line.position.z = -1;

      // Stagger initial radii so rings are evenly distributed
      const initRadius = (i / RING_COUNT) * RING_MAX_RADIUS;
      line.scale.setScalar(Math.max(initRadius, 0.01));
      mat.opacity =
        initRadius > 0 ? this._ringOpacity(initRadius) * RING_BRIGHTNESS[0] : 0;

      this.scene.add(line);
      this.rings.push({ line, mat, radius: initRadius, colorIdx });
    }
  }

  private _initAmbientParticles(): void {
    const planeGeo = new THREE.PlaneGeometry(0.08, 0.08);
    const mat = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.ambientMesh = new THREE.InstancedMesh(planeGeo, mat, AMBIENT_COUNT);
    this.ambientMesh.position.z = -0.9;
    this.ambientMesh.count = AMBIENT_COUNT;
    this.scene.add(this.ambientMesh);

    this.ambientParticles = [];
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const p: AmbientParticle = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        r: 0,
        g: 0,
        b: 0,
        phase: 0,
      };
      this._randomiseParticle(p, true);
      this.ambientParticles.push(p);
    }
  }

  private _initPulseRings(): void {
    this.pulseRings = [];
    const geo = new THREE.RingGeometry(0.9, 1.0, 48);
    for (let i = 0; i < PULSE_RING_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x0088ff,
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
  // Helpers
  // ---------------------------------------------------------------------------

  /** Smooth opacity envelope: fade in → full → fade out as ring expands. */
  private _ringOpacity(radius: number): number {
    const t = radius / RING_MAX_RADIUS;
    if (t < 0.12) return t / 0.12;
    if (t > 0.72) return 1 - (t - 0.72) / 0.28;
    return 1;
  }

  private _randomiseParticle(p: AmbientParticle, spread: boolean): void {
    p.x = (Math.random() * 2 - 1) * SCREEN_HALF_WIDTH;
    p.y = spread
      ? Math.random() * (HORIZON_Y - BOTTOM_Y) + BOTTOM_Y
      : BOTTOM_Y - Math.random() * 2;

    const speed = 0.3 + Math.random() * 0.5;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;

    // DDR palette: purple, hot pink, teal
    const roll = Math.random();
    if (roll < 0.35) {
      p.r = 0.6;
      p.g = 0.1;
      p.b = 1.0; // purple
    } else if (roll < 0.65) {
      p.r = 1.0;
      p.g = 0.0;
      p.b = 0.6; // hot pink
    } else {
      p.r = 0.0;
      p.g = 0.8;
      p.b = 0.9; // teal
    }
    p.phase = Math.random() * Math.PI * 2;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Set hype/combo level (0–3). Affects ring brightness and speed. */
  setComboLevel(level: 0 | 1 | 2 | 3): void {
    if (level === this.comboLevel) return;
    this.comboLevel = level;
    this.ringBrightness = RING_BRIGHTNESS[level];
  }

  /** Trigger a beat-pulse glow at the screen center. */
  pulseOnBeat(): void {
    const ring = this.pulseRings[this.pulseRingIdx % PULSE_RING_COUNT];
    this.pulseRingIdx++;
    ring.active = true;
    ring.life = 0;
    ring.mesh.scale.setScalar(0.15);
    ring.mesh.visible = true;
    // Cycle through DDR beat colors
    const beatColors = [0x0088ff, 0x00aaff, 0x00ccff, 0x44aaff];
    (ring.mesh.material as THREE.MeshBasicMaterial).color.setHex(
      beatColors[this.pulseRingIdx % beatColors.length],
    );
    (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;
  }

  /**
   * Advance background simulation by `dt` seconds.
   * @param dt          Frame delta time (seconds, capped by caller)
   * @param realElapsed Monotonically increasing seconds since start
   */
  update(dt: number, realElapsed: number): void {
    this._updateConcentricRings(dt);
    this._updateAmbientParticles(dt, realElapsed);
    this._updatePulseRings(dt);
  }

  // ---------------------------------------------------------------------------
  // Per-frame update helpers
  // ---------------------------------------------------------------------------

  private _updateConcentricRings(dt: number): void {
    const speed = RING_BASE_SPEED * RING_SPEED_MULT[this.comboLevel];
    const br = this.ringBrightness;

    for (const ring of this.rings) {
      ring.radius += speed * dt;

      // Wrap back to center and cycle to next color
      if (ring.radius >= RING_MAX_RADIUS) {
        ring.radius = ring.radius % RING_MAX_RADIUS;
        ring.colorIdx = (ring.colorIdx + 1) % RING_COLORS.length;
      }

      const [cr, cg, cb] = RING_COLORS[ring.colorIdx];
      const op = this._ringOpacity(ring.radius) * br;

      ring.line.scale.setScalar(Math.max(ring.radius, 0.01));
      ring.mat.opacity = op;
      ring.mat.color.setRGB(cr * br, cg * br, cb * br);
    }
  }

  private _updateAmbientParticles(dt: number, realElapsed: number): void {
    const speedMult = AMBIENT_SPEED_MULT[this.comboLevel];

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const p = this.ambientParticles[i];
      p.x += p.vx * dt * speedMult;
      p.y += p.vy * dt * speedMult;

      if (
        p.y > HORIZON_Y + 0.5 ||
        p.x < -SCREEN_HALF_WIDTH - 0.5 ||
        p.x > SCREEN_HALF_WIDTH + 0.5
      ) {
        this._randomiseParticle(p, false);
      }

      const opacityBase = 0.08 + 0.12 * this.comboLevel * 0.25;
      const opacity =
        (opacityBase + 0.05 * Math.sin(realElapsed * 1.5 + p.phase)) *
        (0.5 + 0.5 * this.comboLevel * 0.33);
      const finalOpacity = Math.max(
        0.04,
        Math.min(0.35, opacity + this.comboLevel * 0.06),
      );
      const scale = 0.6 + this.comboLevel * 0.15;

      _mat4.makeScale(scale, scale, 1);
      _mat4.setPosition(p.x, p.y, 0);
      this.ambientMesh.setMatrixAt(i, _mat4);

      _col.setRGB(p.r * finalOpacity, p.g * finalOpacity, p.b * finalOpacity);
      this.ambientMesh.setColorAt(i, _col);
    }

    this.ambientMesh.instanceMatrix.needsUpdate = true;
    if (this.ambientMesh.instanceColor)
      this.ambientMesh.instanceColor.needsUpdate = true;
  }

  private _updatePulseRings(dt: number): void {
    for (const ring of this.pulseRings) {
      if (!ring.active) continue;

      ring.life += dt;
      const t = ring.life / ring.maxLife;

      if (t >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }

      const eased = 1 - (1 - t) * (1 - t);
      ring.mesh.scale.setScalar(0.15 + eased * 4.5);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.circleGeom.dispose();
    for (const ring of this.rings) {
      ring.mat.dispose();
      this.scene.remove(ring.line);
    }
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

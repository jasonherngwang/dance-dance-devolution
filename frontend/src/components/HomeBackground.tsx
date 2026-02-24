/**
 * HomeBackground – animated WebGPU neon-particle canvas for the landing page.
 *
 * Features:
 *  • 180 floating neon particles (InstancedMesh, additive blending) that slowly
 *    drift with gentle velocity wander and opacity oscillation.
 *  • Periodic radial pulse rings that expand and fade (every ~3.5 s).
 *  • Bloom post-processing via Three.js TSL pipeline (same as gameplay).
 *  • Lazy-initialised (100 ms setTimeout) so HTML content renders first.
 *  • Transparent renderer background — the existing CSS vignette / scanline
 *    overlays in HomeScreen show through correctly.
 *  • Graceful no-op on non-WebGPU browsers (falls back to CSS-only background).
 *
 * Usage: drop <HomeBackground /> anywhere in HomeScreen — it positions itself
 * fixed to the viewport, pointer-events-none, behind all other content.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PARTICLE_COUNT = 300;
const PULSE_RING_COUNT = 5;
const PULSE_INTERVAL = 3.5; // seconds between auto-pulses

// Camera half-height (world units) — determines scale / spread of particles
const HALF_H = 6;

/** Neon colour palette: [r, g, b] in linear 0-1 space */
const NEON_COLORS: [number, number, number][] = [
  [0.0, 1.0, 1.0], // cyan
  [1.0, 0.0, 1.0], // magenta
  [0.0, 1.0, 0.4], // neon green
  [1.0, 0.5, 0.0], // orange
  [0.7, 0.7, 1.0], // cool white / blue-white
];

// ---------------------------------------------------------------------------
// Internal state types (not exported)
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  maxSpeed: number;
  phase: number; // phase offset for opacity sin-wave
  r: number;
  g: number;
  b: number;
}

interface PulseRing {
  mesh: THREE.Mesh;
  active: boolean;
  life: number;
  maxLife: number;
}

// Reusable scratch objects — avoids per-frame allocation
const _mat4 = new THREE.Matrix4();
const _col = new THREE.Color();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HomeBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Bail out silently on non-WebGPU browsers; CSS background remains visible
    if (
      typeof navigator === "undefined" ||
      !("gpu" in navigator) ||
      !navigator.gpu
    )
      return;

    let renderer: THREE.WebGPURenderer | null = null;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let resizeObserver: ResizeObserver | null = null;

    // Mutable animation state — captured inside init() closure
    let particles: Particle[] = [];
    let ambientMesh: THREE.InstancedMesh | null = null;
    let pulseRings: PulseRing[] = [];
    let pulseRingIdx = 0;
    let timeSinceLastPulse = 0;
    let elapsed = 0;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function makeParticle(halfW: number, halfH_: number): Particle {
      const [r, g, b] =
        NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
      const speed = 0.15 + Math.random() * 0.25;
      const angle = Math.random() * Math.PI * 2;
      return {
        x: (Math.random() - 0.5) * halfW * 2,
        y: (Math.random() - 0.5) * halfH_ * 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        maxSpeed: speed * 1.8,
        phase: Math.random() * Math.PI * 2,
        r,
        g,
        b,
      };
    }

    function triggerPulse(pulseRingsList: PulseRing[]): void {
      const ring = pulseRingsList[pulseRingIdx % PULSE_RING_COUNT];
      pulseRingIdx++;
      ring.life = 0;
      ring.active = true;
      ring.mesh.visible = true;
      ring.mesh.scale.set(0.01, 0.01, 1);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
    }

    // ------------------------------------------------------------------
    // Async initialisation (deferred so HTML renders first)
    // ------------------------------------------------------------------

    async function init(): Promise<void> {
      if (disposed) return;

      renderer = new THREE.WebGPURenderer({ antialias: false, alpha: true });
      await renderer.init();

      if (disposed) {
        renderer.dispose();
        renderer = null;
        return;
      }

      const W = container!.clientWidth;
      const H = container!.clientHeight;
      const aspect = W / H;
      const halfW = HALF_H * aspect;

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(W, H);
      renderer.setClearColor(0x000000, 0); // fully transparent clear

      const canvas = renderer.domElement;
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      container!.appendChild(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(
        -halfW,
        halfW,
        HALF_H,
        -HALF_H,
        0.1,
        100,
      );
      camera.position.z = 10;

      // ── Ambient particles ─────────────────────────────────────────────
      const planeGeo = new THREE.PlaneGeometry(0.24, 0.24);
      const planeMat = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });

      ambientMesh = new THREE.InstancedMesh(planeGeo, planeMat, PARTICLE_COUNT);
      ambientMesh.position.z = 0;
      scene.add(ambientMesh);

      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push(makeParticle(halfW, HALF_H));
      }

      // ── Pulse rings ───────────────────────────────────────────────────
      const ringGeo = new THREE.RingGeometry(0.88, 1.0, 72);
      pulseRings = [];

      for (let i = 0; i < PULSE_RING_COUNT; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x00ddff,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(ringGeo, mat);
        mesh.position.z = -0.1;
        mesh.visible = false;
        scene.add(mesh);
        pulseRings.push({ mesh, active: false, life: 0, maxLife: 2.0 });
      }

      // First pulse fires shortly after canvas is ready
      setTimeout(() => {
        if (!disposed) triggerPulse(pulseRings);
      }, 600);

      // ── Bloom post-processing ─────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RPClass =
        (THREE as any).RenderPipeline ?? (THREE as any).PostProcessing;
      const pipeline = new RPClass(renderer);
      const scenePass = pass(scene, camera);
      const sceneNode = scenePass.getTextureNode("output");
      const bloomNode = bloom(sceneNode, 0.7, 0.5, 0.65);
      pipeline.outputNode = sceneNode.add(bloomNode);

      // ── Animation loop ────────────────────────────────────────────────
      let lastTime = performance.now();

      renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        elapsed += dt;
        timeSinceLastPulse += dt;

        // Auto-pulse trigger
        if (timeSinceLastPulse > PULSE_INTERVAL) {
          timeSinceLastPulse = 0;
          triggerPulse(pulseRings);
        }

        // ── Update particles ──────────────────────────────────────────
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const p = particles[i];

          p.x += p.vx * dt;
          p.y += p.vy * dt;

          // Gentle velocity wander (random walk)
          p.vx += (Math.random() - 0.5) * 0.004;
          p.vy += (Math.random() - 0.5) * 0.004;

          // Wrap around world edges based on current camera frustum
          if (p.x > camera.right + 0.8) p.x = camera.left - 0.8;
          else if (p.x < camera.left - 0.8) p.x = camera.right + 0.8;
          if (p.y > camera.top + 0.8) p.y = camera.bottom - 0.8;
          else if (p.y < camera.bottom - 0.8) p.y = camera.top + 0.8;

          // Speed clamp ONLY strictly applied
          const len = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (len > p.maxSpeed) {
            // Apply drag to gradually return to normal speed instead of hard snapping
            p.vx += (p.vx * 0.95 - p.vx) * dt * 10;
            p.vy += (p.vy * 0.95 - p.vy) * dt * 10;
          }

          // Opacity: gentle sine oscillation (0.35 – 0.95)
          const opacity =
            0.35 + 0.6 * (0.5 + 0.5 * Math.sin(elapsed * 1.2 + p.phase));

          _mat4.makeTranslation(p.x, p.y, 0);
          ambientMesh!.setMatrixAt(i, _mat4);
          _col.setRGB(p.r * opacity, p.g * opacity, p.b * opacity);
          ambientMesh!.setColorAt(i, _col);
        }

        ambientMesh!.instanceMatrix.needsUpdate = true;
        if (ambientMesh!.instanceColor)
          ambientMesh!.instanceColor.needsUpdate = true;

        // ── Update pulse rings ────────────────────────────────────────
        for (const ring of pulseRings) {
          if (!ring.active) continue;
          ring.life += dt;

          if (ring.life >= ring.maxLife) {
            ring.active = false;
            ring.mesh.visible = false;
            continue;
          }

          const t = ring.life / ring.maxLife;
          const eased = 1 - (1 - t) * (1 - t); // ease-out quad
          const radius = HALF_H * 2.2 * eased; // expand to ~2× screen half-height

          ring.mesh.scale.set(radius, radius, 1);
          (ring.mesh.material as THREE.MeshBasicMaterial).opacity =
            (1 - t) * 0.45;
        }

        pipeline.render();
      });

      resizeObserver = new ResizeObserver(() => {
        if (!renderer || disposed) return;
        const W2 = container!.clientWidth;
        const H2 = container!.clientHeight;
        const halfW2 = HALF_H * (W2 / H2);

        camera.left = -halfW2;
        camera.right = halfW2;
        camera.updateProjectionMatrix();
        renderer.setSize(W2, H2);
      });
      resizeObserver.observe(container!);

      // Store cleanup function for event listeners (pointer removed)
      (container as any)._cleanupEvents = () => {};
    }

    // Defer init so the browser paints the HTML content first
    timer = setTimeout(() => {
      init().catch(console.error);
    }, 100);

    // ------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------
    return () => {
      disposed = true;
      clearTimeout(timer);
      resizeObserver?.disconnect();

      if ((container as any)?._cleanupEvents) {
        (container as any)._cleanupEvents();
      }

      renderer?.setAnimationLoop(null);
      const canvas = renderer?.domElement;
      if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
      renderer?.dispose();
      renderer = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0"
      style={{ zIndex: 0, pointerEvents: "none" }}
    />
  );
}

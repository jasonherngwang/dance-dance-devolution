import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { ArrowRenderer } from '@/rendering/ArrowRenderer';
import { ReceptorRenderer } from '@/rendering/ReceptorRenderer';
import { ArrowScrollManager } from '@/rendering/ArrowScrollManager';
import { HitEffectRenderer } from '@/rendering/HitEffectRenderer';
import { TimingEngine } from '@/engine/TimingEngine';
import { InputHandler } from '@/engine/InputHandler';
import { JudgmentDisplay } from './JudgmentDisplay';
import type { Direction, JudgmentType, Note } from '@/types';

function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu !== null;
}

// ---------------------------------------------------------------------------
// Demo chart — cycles through all four directions, 1 note every 0.5 s for 16 s
// ---------------------------------------------------------------------------
const DEMO_DURATION = 16; // seconds before looping
const DEMO_DIRS: Direction[] = ['left', 'down', 'up', 'right'];

function buildDemoNotes(): Note[] {
  const notes: Note[] = [];
  // Quarter-note pattern at 0.5-second intervals
  for (let i = 0; i * 0.5 < DEMO_DURATION; i++) {
    notes.push({
      time: i * 0.5,
      type: 'tap',
      direction: DEMO_DIRS[i % DEMO_DIRS.length],
    });
  }
  // Add a few jumps (two simultaneous arrows) at every 4-note boundary
  for (let i = 4; i * 0.5 < DEMO_DURATION; i += 8) {
    notes.push({
      time: i * 0.5,
      type: 'tap',
      direction: ['left', 'right'],
    });
  }
  return notes.sort((a, b) => a.time - b.time);
}

const DEMO_NOTES = buildDemoNotes();

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const webGPUSupported = isWebGPUAvailable();

  // Stable ref for the judgment text trigger — set by JudgmentDisplay on mount
  const judgmentTriggerRef = useRef<((j: JudgmentType, d: Direction) => void) | null>(null);

  useEffect(() => {
    if (!webGPUSupported || !containerRef.current) return;

    const container = containerRef.current;

    // Renderer
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080810);

    // Orthographic camera sized to viewport (viewHeight = 10 world units)
    const VIEW_HEIGHT = 10;
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.OrthographicCamera(
      (-VIEW_HEIGHT * aspect) / 2,
      (VIEW_HEIGHT * aspect) / 2,
      VIEW_HEIGHT / 2,
      -VIEW_HEIGHT / 2,
      0.1,
      1000,
    );
    camera.position.z = 10;

    // Resize handler
    function onResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const a = w / h;
      camera.left   = (-VIEW_HEIGHT * a) / 2;
      camera.right  = (VIEW_HEIGHT * a) / 2;
      camera.top    = VIEW_HEIGHT / 2;
      camera.bottom = -VIEW_HEIGHT / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    window.addEventListener('resize', onResize);

    // -------------------------------------------------------------------------
    // Timing engine (Issue 8) — drives the song clock
    // -------------------------------------------------------------------------
    const timingEngine = new TimingEngine();
    timingEngine.loadNotes(DEMO_NOTES);
    timingEngine.play(0); // start free-running clock at t=0

    // -------------------------------------------------------------------------
    // Arrow system (Issue 5) + Scroll manager (Issue 7)
    // -------------------------------------------------------------------------
    const arrowRenderer = new ArrowRenderer(scene);
    const scrollManager = new ArrowScrollManager(arrowRenderer);
    scrollManager.scrollMultiplier = 2;
    scrollManager.loadChart(DEMO_NOTES);

    // Report auto-misses to the timing engine so notes aren't re-judged
    scrollManager.onMiss = (noteIndex, dir) => {
      timingEngine.markJudged(noteIndex, dir);
    };

    // -------------------------------------------------------------------------
    // Receptor system (Issue 6)
    // -------------------------------------------------------------------------
    const receptorRenderer = new ReceptorRenderer(scene);

    // -------------------------------------------------------------------------
    // Hit effects + particles (Issue 12)
    // -------------------------------------------------------------------------
    const hitEffects = new HitEffectRenderer(scene);

    // -------------------------------------------------------------------------
    // Keyboard input (Issue 9) — wired into timing engine + hit effects
    // -------------------------------------------------------------------------
    const inputHandler = new InputHandler();
    inputHandler.enable();

    inputHandler.onInput = (direction: Direction, timestamp: number) => {
      const result = timingEngine.judge(direction, timestamp);
      if (!result) return; // no note in window — empty press

      const { judgment } = result;
      hitEffects.triggerHitEffect(direction, judgment);
      receptorRenderer.flashReceptor(direction, judgment);
      judgmentTriggerRef.current?.(judgment, direction);
    };

    // -------------------------------------------------------------------------
    // Game loop — song clock driven by TimingEngine
    // -------------------------------------------------------------------------
    const loopStart = performance.now();
    let lastFrameTime = performance.now();

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 1000, 0.05); // cap at 50ms to avoid spiral
      lastFrameTime = now;

      const songTime = timingEngine.getCurrentTime();

      // Demo loop: restart when we reach the end of the chart
      if (songTime >= DEMO_DURATION) {
        timingEngine.play(0);
        timingEngine.resetJudgments();
        scrollManager.loadChart(DEMO_NOTES);
      }

      // Update scroll system (sets positions/opacities on arrowRenderer)
      scrollManager.update(songTime);

      // Flush dirty arrow instances to GPU
      arrowRenderer.update();

      // Animate receptors (uses raw elapsed time for breathing frequency)
      const realElapsed = (now - loopStart) / 1000;
      receptorRenderer.update(realElapsed);

      // Advance particle simulation — get camera shake offset for this frame
      const { shakeX, shakeY } = hitEffects.update(dt);

      // Apply shake offset to camera (base position is x=0, y=0)
      camera.position.x = shakeX;
      camera.position.y = shakeY;

      renderer.render(scene, camera);
    });

    return () => {
      inputHandler.dispose();
      timingEngine.dispose();
      scrollManager.dispose();
      arrowRenderer.dispose();
      receptorRenderer.dispose();
      hitEffects.dispose();
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [webGPUSupported]);

  if (!webGPUSupported) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-game-bg">
        <div className="max-w-md px-6 text-center">
          <div className="mb-4 text-5xl">⚠</div>
          <h2 className="mb-3 text-2xl font-bold text-neon-cyan">WebGPU Not Supported</h2>
          <p className="text-game-text-dim">
            This game requires WebGPU. Please use Chrome 113+, Edge 113+, or another browser with
            WebGPU enabled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Three.js canvas container */}
      <div ref={containerRef} className="absolute inset-0" />
      {/* HTML judgment text overlay */}
      <JudgmentDisplay
        onRegisterTrigger={(fn) => { judgmentTriggerRef.current = fn; }}
      />
    </div>
  );
}

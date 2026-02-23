import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { ArrowRenderer } from '@/rendering/ArrowRenderer';
import { ReceptorRenderer } from '@/rendering/ReceptorRenderer';
import { ArrowScrollManager } from '@/rendering/ArrowScrollManager';
import type { Direction, Note } from '@/types';

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
      camera.left = (-VIEW_HEIGHT * a) / 2;
      camera.right = (VIEW_HEIGHT * a) / 2;
      camera.top = VIEW_HEIGHT / 2;
      camera.bottom = -VIEW_HEIGHT / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    window.addEventListener('resize', onResize);

    // -------------------------------------------------------------------------
    // Arrow system (Issue 5) + Scroll manager (Issue 7)
    // -------------------------------------------------------------------------
    const arrowRenderer = new ArrowRenderer(scene);
    const scrollManager = new ArrowScrollManager(arrowRenderer);
    scrollManager.scrollMultiplier = 2; // default DDR 2× speed
    scrollManager.loadChart(DEMO_NOTES);

    // Log auto-misses so the acceptance criteria can be verified in DevTools
    scrollManager.onMiss = (noteIndex, dir) => {
      console.debug(`[ArrowScrollManager] Auto-miss: note ${noteIndex} dir=${dir}`);
    };

    // -------------------------------------------------------------------------
    // Receptor system (Issue 6)
    // -------------------------------------------------------------------------
    const receptorRenderer = new ReceptorRenderer(scene);

    // -------------------------------------------------------------------------
    // Simulated song clock — loops over DEMO_DURATION
    // -------------------------------------------------------------------------
    const clockStart = performance.now();
    let prevSongTime = -1;

    // Game loop
    renderer.setAnimationLoop((msTime) => {
      const realElapsed = ((msTime as number) - clockStart) / 1000;
      const songTime = realElapsed % DEMO_DURATION;

      // Detect loop wrap → reload chart so nextNoteIndex resets
      if (songTime < prevSongTime) {
        scrollManager.loadChart(DEMO_NOTES);
      }
      prevSongTime = songTime;

      // Update scroll system (sets positions/opacities on arrowRenderer)
      scrollManager.update(songTime);

      // Flush dirty arrow instances to GPU
      arrowRenderer.update();

      // Animate receptors
      receptorRenderer.update(realElapsed);

      renderer.render(scene, camera);
    });

    return () => {
      scrollManager.dispose();
      arrowRenderer.dispose();
      receptorRenderer.dispose();
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

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}

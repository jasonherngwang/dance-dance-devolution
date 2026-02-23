import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { ArrowRenderer } from '@/rendering/ArrowRenderer';
import { ReceptorRenderer } from '@/rendering/ReceptorRenderer';
import type { Direction } from '@/types';

function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu !== null;
}

// DDR column layout — world-space X positions, 1-unit apart
const COLUMNS: { dir: Direction; x: number }[] = [
  { dir: 'left', x: -1.5 },
  { dir: 'down', x: -0.5 },
  { dir: 'up', x: 0.5 },
  { dir: 'right', x: 1.5 },
];

// Demo flash sequence: alternate perfect/great across all four receptors
const DEMO_FLASH_INTERVAL = 1.4; // seconds between flashes
const DEMO_SEQUENCE: Array<{ dir: Direction; judgment: 'perfect' | 'great' }> = [
  { dir: 'left',  judgment: 'perfect' },
  { dir: 'down',  judgment: 'great'   },
  { dir: 'up',    judgment: 'perfect' },
  { dir: 'right', judgment: 'great'   },
];

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
    // Arrow system — Issue 5 demo
    // -------------------------------------------------------------------------
    const arrowRenderer = new ArrowRenderer(scene);

    // Show one full-brightness arrow per direction at y = 0
    for (const { dir, x } of COLUMNS) {
      const id = arrowRenderer.allocate(dir);
      if (id >= 0) {
        arrowRenderer.setPosition(dir, id, x, 0);
        arrowRenderer.setOpacity(dir, id, 1.0);
      }
    }

    // Show a second set at y = -2 with dimmed opacity to demonstrate pool + opacity
    for (const { dir, x } of COLUMNS) {
      const id = arrowRenderer.allocate(dir);
      if (id >= 0) {
        arrowRenderer.setPosition(dir, id, x, -2);
        arrowRenderer.setOpacity(dir, id, 0.35);
      }
    }

    arrowRenderer.update();

    // -------------------------------------------------------------------------
    // Receptor system — Issue 6
    // -------------------------------------------------------------------------
    const receptorRenderer = new ReceptorRenderer(scene);

    // Demo state: cycle flash sequence to show perfect vs great visuals
    let lastFlashTime = 0;
    let flashIndex = 0;

    // Game loop
    renderer.setAnimationLoop((msTime) => {
      const t = (msTime as number) / 1000; // seconds

      // Demo: fire a receptor flash every DEMO_FLASH_INTERVAL seconds
      if (t - lastFlashTime > DEMO_FLASH_INTERVAL) {
        lastFlashTime = t;
        const entry = DEMO_SEQUENCE[flashIndex % DEMO_SEQUENCE.length];
        receptorRenderer.flashReceptor(entry.dir, entry.judgment);
        flashIndex++;
      }

      arrowRenderer.update();
      receptorRenderer.update(t);
      renderer.render(scene, camera);
    });

    return () => {
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

import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
// bloom is exported from the TSL display module (three/addons maps to three/examples/jsm)
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * Manages the WebGPU post-processing pipeline:
 * - Bloom (always on, subtle) — makes neon emissive materials glow
 *
 * Vignette and screen flash are handled as CSS overlays in ScreenEffects.tsx
 * since they don't require scene-level rendering.
 *
 * Usage: replace `renderer.render(scene, camera)` with `postProcessing.render()`.
 */
export class PostProcessingManager {
  // RenderPipeline replaced PostProcessing in Three.js r183; both available in three/webgpu
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipeline: any;
  private disposed = false;

  constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const RenderPipelineClass = (THREE as any).RenderPipeline ?? (THREE as any).PostProcessing;
    this.pipeline = new RenderPipelineClass(renderer);

    // Scene render pass → get the colour output texture
    const scenePass = pass(scene, camera);
    const scenePassColor = scenePass.getTextureNode('output');

    // Bloom: bloom(input, strength, radius, threshold)
    // Subtle settings: only very bright neon pixels bloom; avoids polluting dark bg
    const bloomPass = bloom(scenePassColor, 0.4, 0.5, 0.85);

    this.pipeline.outputNode = scenePassColor.add(bloomPass);
  }

  /** Call once per frame in the animation loop (replaces renderer.render). */
  render(): void {
    if (!this.disposed) {
      this.pipeline.render();
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}

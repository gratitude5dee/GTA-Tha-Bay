import { PerspectiveCamera, REVISION, Scene, WebGPURenderer } from 'three/webgpu';
import type { RenderBackend } from '@dv/shared';

/**
 * Minimal renderer host (M00). One WebGPURenderer; WebGL2 fallback is automatic inside three, and
 * `forceWebGL` selects it explicitly (?gl=1, XR emulation on the Quest policy).
 * M01c grows this into the full facade (device loss, XR swap, menu scene, tier selection).
 *
 * Active backend in three@0.186.1: after `init()` the renderer replaces `renderer.backend` with the
 * fallback when WebGPU is unavailable; `backend.isWebGPUBackend === true` marks the WebGPU backend and
 * `backend.isWebGLBackend === true` the WebGL2 one (renderers/webgpu/WebGPUBackend.js, webgl-fallback/WebGLBackend.js).
 */
export interface RendererHostInit {
  canvas: HTMLCanvasElement;
  /** Force the WebGL2 backend. */
  forceWebGL: boolean;
  /** Set `renderer.xr.enabled` before `init()` (required for XR). */
  xr: boolean;
}

interface BackendFlags {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
}

export const THREE_REVISION: string = REVISION;

export class RendererHost {
  readonly renderer: WebGPURenderer;
  readonly backend: RenderBackend;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 100);
  /** Frames rendered by the animation loop (flat or XR). */
  frames = 0;
  /** Frames rendered while an XR session was presenting. */
  xrFrames = 0;

  private constructor(renderer: WebGPURenderer, backend: RenderBackend) {
    this.renderer = renderer;
    this.backend = backend;
  }

  static async create(init: RendererHostInit): Promise<RendererHost> {
    const renderer = new WebGPURenderer({
      canvas: init.canvas,
      antialias: false,
      forceWebGL: init.forceWebGL,
      powerPreference: 'high-performance',
    });
    // XR must be enabled before init() so the right context and binding are created.
    if (init.xr) renderer.xr.enabled = true;
    await renderer.init();
    const flags = renderer.backend as unknown as BackendFlags;
    let backend: RenderBackend;
    if (flags.isWebGPUBackend === true) backend = 'webgpu';
    else if (flags.isWebGLBackend === true) backend = 'webgl2';
    else throw new Error('renderer-host: unknown backend after init()');
    const host = new RendererHost(renderer, backend);
    host.startLoop();
    return host;
  }

  private startLoop(): void {
    this.renderer.setAnimationLoop(() => {
      this.frames += 1;
      if (this.renderer.xr.isPresenting) this.xrFrames += 1;
      this.renderer.render(this.scene, this.camera);
    });
  }

  get isPresenting(): boolean {
    return this.renderer.xr.isPresenting;
  }
}

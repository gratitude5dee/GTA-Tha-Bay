/**
 * Frame pacing on GPU fences for the WebGL2 backend (QA builds; BD-FIX-CI7-F03).
 *
 * A browser's compositor keeps a page at most a frame or two ahead of its GPU: requestAnimationFrame waits until the GPU has taken
 * the last frames. Headless Chromium with Vulkan compositing (the `chromium-webgpu` project: SwiftShader through Vulkan) gives no such
 * back-pressure to WebGL: the loop runs at about 6 frames a second while SwiftShader draws 2 or 3, and the frames it has not drawn
 * queue in the GPU process. When the page closes, that process still works off the queue, and until it has, the browser cannot make
 * the next browser context: Playwright's `newContext` for the next test in the worker waited 10 to 65 s here, on a bare WebGL page as
 * much as on the game (`Target.createBrowserContext`), and a test with the default 30 s budget timed out while setting up its context.
 *
 * The pacer does what that compositor would do: a frame starts only when the GPU has finished the frame `depth` frames back, so at most
 * `depth` frames wait in the GPU queue. A skipped frame is a frame the compositor would not have offered.
 */
export interface FenceGl {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly SYNC_STATUS: number;
  readonly UNSIGNALED: number;
  fenceSync(condition: number, flags: number): WebGLSync | null;
  getSyncParameter(sync: WebGLSync, pname: number): unknown;
  deleteSync(sync: WebGLSync | null): void;
  flush(): void;
}

/** Frames that may wait in the GPU queue before the next one is held back. */
export const GPU_PACE_DEPTH = 2;

export class GpuPacer {
  private readonly ring: WebGLSync[] = [];
  /** Frames held back because the GPU had not finished the frame `depth` frames earlier. */
  held = 0;

  constructor(
    private readonly gl: FenceGl,
    private readonly depth = GPU_PACE_DEPTH,
  ) {}

  /** True when this frame should start: fewer than `depth` frames are still on the GPU. */
  ready(): boolean {
    while (this.ring.length >= this.depth) {
      const oldest = this.ring[0] as WebGLSync;
      if (this.gl.getSyncParameter(oldest, this.gl.SYNC_STATUS) === this.gl.UNSIGNALED) {
        this.held += 1;
        return false;
      }
      this.gl.deleteSync(oldest);
      this.ring.shift();
    }
    return true;
  }

  /** After the frame's draw calls: a fence behind them, flushed so the GPU starts on them now. */
  submitted(): void {
    const fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (fence) this.ring.push(fence);
    this.gl.flush();
  }

  /** Drops every fence (the context is about to go away, or the host stops pacing). */
  dispose(): void {
    for (const f of this.ring) this.gl.deleteSync(f);
    this.ring.length = 0;
  }
}

import { describe, expect, it } from 'vitest';
import { GpuPacer, GPU_PACE_DEPTH, type FenceGl } from '../../src/platform/gpu-pacer.ts';

/** A GL whose fences signal only when the test says the GPU finished them. */
function fakeGl(): FenceGl & { done(n: number): void; live: Set<number>; flushes: number } {
  let next = 1;
  let finished = 0;
  const live = new Set<number>();
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    UNSIGNALED: 0x9118,
    SIGNALED: 0x9119,
    flushes: 0,
    live,
    fenceSync: () => {
      const id = next++;
      live.add(id);
      return id as unknown as WebGLSync;
    },
    getSyncParameter: (s: WebGLSync) => ((s as unknown as number) <= finished ? 0x9119 : 0x9118),
    deleteSync: (s: WebGLSync | null) => void live.delete(s as unknown as number),
    flush: () => {
      gl.flushes += 1;
    },
    done: (n: number) => {
      finished = n;
    },
  };
  return gl;
}

describe('GpuPacer', () => {
  it('lets frames start until GPU_PACE_DEPTH frames wait on the GPU, then holds until the oldest is drawn', () => {
    const gl = fakeGl();
    const p = new GpuPacer(gl);
    for (let i = 0; i < GPU_PACE_DEPTH; i++) {
      expect(p.ready()).toBe(true);
      p.submitted();
    }
    expect(gl.flushes).toBe(GPU_PACE_DEPTH);
    // Neither frame is drawn: the next frame is held, as often as it is asked.
    expect(p.ready()).toBe(false);
    expect(p.ready()).toBe(false);
    expect(p.held).toBe(2);
    // The first frame is drawn: one more may start, and its fence is released.
    gl.done(1);
    expect(p.ready()).toBe(true);
    expect(gl.live.has(1)).toBe(false);
    p.submitted();
    expect(p.ready()).toBe(false);
    gl.done(3);
    expect(p.ready()).toBe(true);
    expect(p.held).toBe(3);
  });

  it('never holds a GPU that keeps up, and dispose releases every fence', () => {
    const gl = fakeGl();
    const p = new GpuPacer(gl);
    for (let i = 1; i <= 50; i++) {
      expect(p.ready()).toBe(true);
      p.submitted();
      gl.done(i);
    }
    expect(p.held).toBe(0);
    expect(gl.live.size).toBeLessThanOrEqual(GPU_PACE_DEPTH);
    p.dispose();
    expect(gl.live.size).toBe(0);
  });
});

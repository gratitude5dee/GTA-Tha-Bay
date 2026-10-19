import { describe, expect, it } from 'vitest';
import { Lanes, laneLimits, type Priority } from '../../src/assets/store/lanes.ts';

function gated(): { run: () => Promise<void>; release: () => void } {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { run: () => p, release };
}

describe('Lanes', () => {
  it('limits are now 8, soon 16 on desktop and 8 on mobile or XR, idle 2', () => {
    expect(laneLimits(false)).toEqual({ now: 8, soon: 16, idle: 2 });
    expect(laneLimits(true)).toEqual({ now: 8, soon: 8, idle: 2 });
  });

  it('occupancy of each lane never exceeds its limit and queued jobs start as slots free', async () => {
    const lanes = new Lanes(laneLimits(false));
    const gates: Array<ReturnType<typeof gated>> = [];
    const handles: Array<Promise<void>> = [];
    const counts: Record<Priority, number> = { now: 30, soon: 40, idle: 10 };
    for (const lane of ['now', 'soon', 'idle'] as const) {
      for (let i = 0; i < counts[lane]; i++) {
        const g = gated();
        gates.push(g);
        handles.push(lanes.schedule(lane, g.run).promise);
      }
    }
    expect(lanes.occupancy()).toEqual({ now: 8, soon: 16, idle: 2 });
    expect(lanes.queued()).toEqual({ now: 22, soon: 24, idle: 8 });
    // Release everything in waves; occupancy stays within limits the whole time.
    for (let wave = 0; wave < 20; wave++) {
      for (const g of gates) g.release();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(handles);
    expect(lanes.peak).toEqual({ now: 8, soon: 16, idle: 2 });
    expect(lanes.occupancy()).toEqual({ now: 0, soon: 0, idle: 0 });
  });

  it('promote moves a queued job to a higher lane; a running job is unaffected', async () => {
    const lanes = new Lanes({ now: 1, soon: 1, idle: 1 });
    const hold = gated();
    lanes.schedule('soon', hold.run); // occupies the single soon slot
    const order: string[] = [];
    const queued = lanes.schedule('soon', async () => void order.push('queued'));
    expect(lanes.queued().soon).toBe(1);
    queued.promote('now');
    await queued.promise;
    expect(order).toEqual(['queued']);
    expect(lanes.queued()).toEqual({ now: 0, soon: 0, idle: 0 });
    hold.release();
  });

  it('a failing task frees its slot', async () => {
    const lanes = new Lanes({ now: 1, soon: 1, idle: 1 });
    const bad = lanes.schedule('now', () => Promise.reject(new Error('boom')));
    const good = lanes.schedule('now', () => Promise.resolve(7));
    await expect(bad.promise).rejects.toThrow('boom');
    expect(await good.promise).toBe(7);
  });
});

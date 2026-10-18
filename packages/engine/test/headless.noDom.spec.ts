import { describe, expect, it, vi } from 'vitest';
import type { InputFrame } from '@dv/shared';
import { createHeadlessSim } from '../src/headless/index.ts';
import { ecsChurnConfig, setupEcsChurn } from './scenarios/ecs-churn.ts';

function frame(tick: number): InputFrame {
  return {
    tick, buttons: tick & 3, pressed: 0, released: 0, moveX: 0, moveY: 127, throttle: 0, brake: 0, steer: 0,
    camYaw: 0, camPitch: 0, context: 0, device: 0,
  };
}

describe('headless sim without a DOM', () => {
  it('boots with window, document and navigator.xr undefined and steps 600 ticks', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', {});
    try {
      expect(typeof window).toBe('undefined');
      expect(typeof document).toBe('undefined');
      expect((globalThis as { navigator?: { xr?: unknown } }).navigator?.xr).toBeUndefined();
      const sim = createHeadlessSim(ecsChurnConfig(), (s) => setupEcsChurn(s, { entities: 200 }));
      sim.step(600);
      expect(sim.tick).toBe(600);
      expect(sim.hash()).toMatch(/^[0-9a-f]{16}$/);
      expect(sim.stats.tick).toBe(600);
      expect(sim.ecs.entityCount).toBe(201);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('snapshot() then restore() at tick 300 and a re-run give the same hash at tick 600', () => {
    const setup = (s: Parameters<typeof setupEcsChurn>[0]) => setupEcsChurn(s, { entities: 200 });
    const sim = createHeadlessSim(ecsChurnConfig(), setup);
    sim.step(300);
    const hash300 = sim.hash();
    const snap = sim.snapshot();
    sim.step(300);
    const hash600 = sim.hash();

    // Same sim, rolled back.
    sim.restore(snap);
    expect(sim.tick).toBe(300);
    expect(sim.hash()).toBe(hash300);
    sim.step(300);
    expect(sim.hash()).toBe(hash600);

    // A fresh sim built by the same setup, loaded from the snapshot.
    const other = createHeadlessSim(ecsChurnConfig(), setup);
    other.restore(snap);
    expect(other.hash()).toBe(hash300);
    other.step(300);
    expect(other.hash()).toBe(hash600);

    // The snapshot is a pure function of state.
    const a = createHeadlessSim(ecsChurnConfig(), setup);
    a.step(300);
    expect(Array.from(a.snapshot())).toEqual(Array.from(snap));
  });

  it('input frames reach the systems for the tick that is about to run', () => {
    const seen: number[] = [];
    const sim = createHeadlessSim(ecsChurnConfig(), ({ core, services }) => {
      core.addSystem({
        id: 'test.input', owner: 'S01', stage: 1, order: 0,
        run: ({ tick }) => {
          const f = services.input;
          if (f) seen.push((f.tick === tick ? 1 : 0) + f.buttons * 2);
        },
      });
    });
    sim.step(4, frame);
    expect(seen).toEqual([1, 3, 5, 7]);
    sim.step(1);
    expect(sim.services.input).toBeNull();
    expect(seen.length).toBe(4);
  });
});

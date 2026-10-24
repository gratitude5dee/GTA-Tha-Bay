import { describe, expect, it } from 'vitest';
import { EcsWorld, SimCore, TimeScaleError, createSimServices } from '../src/sim/index.ts';
import { testConfig } from './helpers.ts';

function core(opts = {}): SimCore {
  const cfg = testConfig();
  return new SimCore(cfg, new EcsWorld(), createSimServices(cfg.seed), opts);
}

const frames = (c: SimCore, n: number): number => {
  let ticks = 0;
  for (let i = 0; i < n; i++) ticks += c.advance(1 / 60, 1, false).ticks;
  return ticks;
};

describe('SimCore.setSandboxScale (AC-4)', () => {
  it('2 runs 120 ticks in 60 frames, 0.25 runs 15, and back to 1 runs 60', () => {
    const c = core();
    c.setSandboxScale(2);
    expect(frames(c, 60)).toBe(120);
    c.setSandboxScale(0.25);
    expect(frames(c, 60)).toBe(15);
    c.setSandboxScale(1);
    expect(frames(c, 60)).toBe(60);
  });

  it('an unlisted scale throws TimeScaleError and leaves the scale alone', () => {
    const c = core();
    expect(() => c.setSandboxScale(3)).toThrow(TimeScaleError);
    expect(frames(c, 60)).toBe(60);
  });

  it('the page timeScale check is unchanged: 2 throws without sandbox or debug', () => {
    expect(() => core().advance(1 / 60, 2, false)).toThrow(TimeScaleError);
    expect(() => core({ sandbox: true }).advance(1 / 60, 2, false)).not.toThrow();
  });

  it('the state hash at tick 240 is equal at scale 2 and at scale 1', () => {
    const a = core();
    a.setSandboxScale(2);
    frames(a, 120);
    const b = core();
    frames(b, 240);
    expect(a.tick).toBe(240);
    expect(b.tick).toBe(240);
    expect(a.stateHash()).toBe(b.stateHash());
  });
});

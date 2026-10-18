import { describe, expect, it } from 'vitest';
import { MAX_FRAME_DT, MAX_TICKS_PER_FRAME, SIM_DT, SimStage } from '@dv/shared';
import { EcsWorld, SimCore, TimeScaleError, createSimServices } from '../src/sim/index.ts';
import { testConfig } from './helpers.ts';

function core(opts = {}, cfg = testConfig()): SimCore {
  return new SimCore(cfg, new EcsWorld(), createSimServices(cfg.seed), opts);
}

describe('accumulator (C02 rules 1, 3, 4)', () => {
  it('constants: 9 ticks fit in the 0.15 s clamp', () => {
    expect(MAX_TICKS_PER_FRAME).toBe(Math.floor(MAX_FRAME_DT / SIM_DT + 1e-9));
    expect(SimStage.Commands).toBe(0);
    expect(SimStage.Publish).toBe(9); // const enum values survive the build
  });

  it('advance(0.5, 1, false) runs exactly 9 ticks, drops 0.35 s, alpha in [0, 1)', () => {
    const c = core();
    const r = c.advance(0.5, 1, false);
    expect(r.ticks).toBe(9);
    expect(c.tick).toBe(9);
    expect(Math.abs(c.loopStats.droppedSec - 0.35)).toBeLessThan(1e-9);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
    expect(c.loopStats.overruns).toBe(1);
    expect(c.loopStats.ticksLastFrame).toBe(9);
  });

  it('60 calls of advance(1/60) run 60 ticks in total', () => {
    const c = core();
    let total = 0;
    for (let i = 0; i < 60; i++) total += c.advance(1 / 60, 1, false).ticks;
    expect(total).toBe(60);
    expect(c.tick).toBe(60);
    expect(c.loopStats.droppedSec).toBe(0);
  });

  it('a 144 Hz frame rate averages 60 ticks per second and alpha is the remainder', () => {
    const c = core();
    let total = 0;
    let alpha = 0;
    for (let i = 0; i < 144 * 10; i++) {
      const r = c.advance(1 / 144, 1, false);
      total += r.ticks;
      alpha = r.alpha;
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThan(1);
    }
    expect(Math.abs(total + alpha - 600)).toBeLessThan(1e-6);
    expect(c.loopStats.droppedSec).toBe(0);
  });

  it('paused runs 0 ticks and keeps the accumulator', () => {
    const c = core();
    c.advance(1 / 120, 1, false); // half a tick banked
    const before = c.advance(0, 1, false).alpha;
    const r = c.advance(5, 1, true);
    expect(r.ticks).toBe(0);
    expect(r.alpha).toBe(before);
    expect(c.tick).toBe(0);
    expect(c.loopStats.droppedSec).toBe(0);
    expect(c.advance(1 / 120, 1, false).ticks).toBe(1);
  });

  it('timeScale 2 throws outside sandbox or debug sessions and doubles time inside them', () => {
    expect(() => core().advance(1 / 60, 2, false)).toThrow(TimeScaleError);
    expect(() => core().advance(1 / 60, 0.5, false)).toThrow(TimeScaleError);
    expect(() => core().advance(1 / 60, 3, false)).toThrow(TimeScaleError);
    expect(core({ sandbox: true }).advance(1 / 60, 2, false).ticks).toBe(2);
    expect(core({ debug: true }).advance(1 / 60, 2, false).ticks).toBe(2);
    const half = core({ sandbox: true });
    expect(half.advance(1 / 60, 0.5, false).ticks).toBe(0);
    expect(half.advance(1 / 60, 0.5, false).ticks).toBe(1);
  });

  it('ignores negative and non-finite dt', () => {
    const c = core();
    expect(c.advance(-1, 1, false).ticks).toBe(0);
    expect(c.advance(NaN, 1, false).ticks).toBe(0);
    expect(c.advance(Infinity, 1, false).ticks).toBe(0);
    expect(c.tick).toBe(0);
  });

  it('stepOnce runs one tick regardless of the accumulator; startTick offsets the counter', () => {
    const c = core({}, testConfig({ startTick: 100 }));
    c.stepOnce();
    expect(c.tick).toBe(101);
    expect(c.ctx.tick).toBe(100);
  });

  it('hashEvery publishes lastHash on its cadence', () => {
    const c = core({}, testConfig({ hashEvery: 5 }));
    for (let i = 0; i < 4; i++) c.stepOnce();
    expect(c.lastHash).toBeNull();
    c.stepOnce();
    expect(c.lastHash?.tick).toBe(5);
    expect(c.lastHash?.hex).toBe(c.stateHash());
    expect(c.lastHash?.hex).toMatch(/^[0-9a-f]{16}$/);
  });

  it('LoopStats reports tick durations from the injected clock', () => {
    let t = 0;
    const c = core({ now: () => (t += 2) });
    for (let i = 0; i < 20; i++) c.stepOnce();
    const s = c.loopStats;
    expect(s.tick).toBe(20);
    expect(s.tickMsP50).toBe(2);
    expect(s.tickMsP99).toBe(2);
  });
});

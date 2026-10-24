import { describe, expect, it } from 'vitest';
import { Fnv64, RngStreams } from '@dv/shared';
import {
  CLOCK_CONFIG, EcsWorld, HALF_SECONDS_PER_DAY, HALF_SECONDS_PER_MINUTE, HOLD_T, SimCore, WorldClock, createSimServices, type ClockConfig,
} from '../src/sim/index.ts';
import { testConfig } from './helpers.ts';

const AT_ZERO: ClockConfig = { ...CLOCK_CONFIG, start: { hour: 0, weather: 'clear' } };

/** Recorded from the merged base (before M04e1 touched clock.ts): the clock resource hash after three game days on seed 7. */
const NEVER_HELD_HASH = '88c4c38660d971f7';

const resourceHash = (c: WorldClock): string => {
  const h = new Fnv64();
  c.resource().hash(h);
  return h.hex();
};

function counted(seed: number): { clock: WorldClock; draws: () => number } {
  const streams = new RngStreams(seed);
  const rng = streams.get('weather');
  const clock = new WorldClock(streams, AT_ZERO);
  let n = 0;
  const orig = rng.nextU32.bind(rng);
  rng.nextU32 = (): number => {
    n++;
    return orig();
  };
  return { clock, draws: () => n };
}

function simWithClock(seed = 7): { core: SimCore; clock: WorldClock } {
  const core = new SimCore(testConfig({ seed }), new EcsWorld(), createSimServices(seed));
  const clock = new WorldClock(core.services.rng, AT_ZERO);
  core.addResource(clock.resource());
  core.addSystem(clock.system());
  core.services.clock = clock;
  return { core, clock };
}

describe('WorldClock.holdWeather (AC-2)', () => {
  it('holds the preset for ten game hours without a single weather draw', () => {
    const { clock, draws } = counted(7);
    clock.holdWeather('rain');
    expect(clock.weather().changeAtT).toBe(HOLD_T);
    expect(clock.weather().blend).toBe(0);
    for (let i = 1; i <= 72_000; i++) {
      clock.step();
      if (i % 7_200 === 0) {
        expect(clock.env().weather).toBe('rain');
        expect(clock.env().next).toBe('rain');
        expect(clock.env().blend).toBe(0);
      }
    }
    expect(draws()).toBe(0);
    expect(clock.now().t).toBe(72_000);
  });

  it('setHour keeps the hold; forceWeather replaces the preset and keeps the hold', () => {
    const { clock, draws } = counted(7);
    clock.holdWeather('rain');
    clock.setHour(3);
    expect(clock.weather().changeAtT).toBe(HOLD_T);
    expect(clock.env().weather).toBe('rain');
    clock.forceWeather('golden', 0);
    expect(clock.env()).toMatchObject({ weather: 'golden', next: 'golden' });
    clock.forceWeather('smoke', 300);
    expect(clock.env()).toMatchObject({ weather: 'smoke', next: 'smoke', blend: 0 });
    for (let i = 0; i < 20_000; i++) clock.step();
    expect(clock.env().weather).toBe('smoke');
    expect(clock.held).toBe(true);
    expect(draws()).toBe(0);
  });

  it('a save and load at step 36,000 continues to the same resource hash as the uninterrupted run', () => {
    const full = simWithClock();
    full.clock.holdWeather('rain');
    let snap: Uint8Array | null = null;
    for (let i = 1; i <= 72_000; i++) {
      full.core.stepOnce();
      if (i === 36_000) snap = full.core.serialize();
    }
    const resumed = simWithClock();
    resumed.core.restore(snap as Uint8Array);
    expect(resumed.clock.held).toBe(true);
    for (let i = 36_001; i <= 72_000; i++) resumed.core.stepOnce();
    expect(resourceHash(resumed.clock)).toBe(resourceHash(full.clock));
    expect(resumed.core.stateHash()).toBe(full.core.stateHash());
  });

  it('holdWeather(null) draws exactly 2 values and the next change is 20 to 40 game minutes away', () => {
    const { clock, draws } = counted(7);
    clock.holdWeather('rain');
    for (let i = 0; i < 1_000; i++) clock.step();
    const before = draws();
    clock.holdWeather(null);
    expect(draws() - before).toBe(2);
    expect(clock.held).toBe(false);
    const { changeAtT } = clock.weather();
    const t = clock.now().t;
    expect(changeAtT - t).toBeGreaterThanOrEqual(20 * HALF_SECONDS_PER_MINUTE);
    expect(changeAtT - t).toBeLessThanOrEqual(40 * HALF_SECONDS_PER_MINUTE);
    expect(clock.env().next).not.toBe('rain');
  });

  it('releasing a clock that is not held draws nothing and changes nothing', () => {
    const { clock, draws } = counted(7);
    const before = resourceHash(clock);
    const base = draws();
    clock.holdWeather(null);
    expect(draws()).toBe(base);
    expect(resourceHash(clock)).toBe(before);
  });

  it('a held clock takes the same path through lock: the lock still sets hour and weather', () => {
    const { clock } = counted(7);
    clock.holdWeather('rain');
    clock.lock('m', 5, 'clear');
    expect(clock.env()).toMatchObject({ weather: 'clear', next: 'clear' });
    expect(clock.held).toBe(true);
  });
});

describe('a clock that is never held (AC-3)', () => {
  it('has the recorded resource hash after three game days on seed 7', () => {
    const c = new WorldClock(new RngStreams(7), AT_ZERO);
    for (let i = 0; i < 3 * HALF_SECONDS_PER_DAY; i++) c.step();
    expect(resourceHash(c)).toBe(NEVER_HELD_HASH);
  });
});

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { RngStreams, weekdayOf, type WeatherPreset } from '@dv/shared';
import {
  BLEND_MAX, CLOCK_CONFIG, EcsWorld, HALF_SECONDS_PER_DAY, HALF_SECONDS_PER_HOUR, HALF_SECONDS_PER_MINUTE, SimCore, WEATHER_PRESETS, WorldClock,
  createSimServices, darkAt, hourOfT, installClock, nightAt, type ClockConfig,
} from '../src/sim/index.ts';
import { testConfig } from './helpers.ts';

const AT_ZERO: ClockConfig = { ...CLOCK_CONFIG, start: { hour: 0, weather: 'clear' } };
const SEED = 0xc0ffee;

const clockAt0 = (seed = SEED): WorldClock => new WorldClock(new RngStreams(seed), AT_ZERO);

function simWithClock(seed = SEED, cfg: ClockConfig = AT_ZERO): { core: SimCore; clock: WorldClock } {
  const c = testConfig({ seed });
  const core = new SimCore(c, new EcsWorld(), createSimServices(seed));
  const clock = new WorldClock(core.services.rng, cfg);
  core.addResource(clock.resource());
  core.addSystem(clock.system());
  core.services.clock = clock;
  return { core, clock };
}

describe('config/clock.json', () => {
  it('validates against config/schemas/clock.schema.json', () => {
    const read = (p: string): object => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')) as object;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('config/schemas/clock.schema.json'));
    expect(validate(read('config/clock.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it('has curves that start and end equal (the day wraps without a jump) and a row for every preset', () => {
    for (const c of [CLOCK_CONFIG.night, CLOCK_CONFIG.dark]) {
      expect(c[0]?.[0]).toBe(0);
      expect(c[c.length - 1]?.[0]).toBe(24);
      expect(c[0]?.[1]).toBe(c[c.length - 1]?.[1]);
    }
    expect(Object.keys(CLOCK_CONFIG.presets).sort()).toEqual([...WEATHER_PRESETS].sort());
  });
});

describe('WorldClock time (AC-2)', () => {
  it('60 ticks advance t by 60 (30 game seconds)', () => {
    const c = clockAt0();
    expect(c.now()).toEqual({ t: 0, rate: 1, paused: false, lockedBy: null });
    for (let i = 0; i < 60; i++) c.step();
    expect(c.now().t).toBe(60);
  });

  it('172,800 ticks are one game day and weekdayOf steps from 0 to 1', () => {
    const c = clockAt0();
    expect(weekdayOf(c.now().t)).toBe(0);
    for (let i = 0; i < HALF_SECONDS_PER_DAY - 1; i++) c.step();
    expect(weekdayOf(c.now().t)).toBe(0);
    expect(c.env().hour).toBeCloseTo(24, 3);
    c.step();
    expect(c.now().t).toBe(HALF_SECONDS_PER_DAY);
    expect(weekdayOf(c.now().t)).toBe(1);
    expect(c.env().hour).toBe(0);
  });

  it('weekdayOf wraps after seven days', () => {
    expect(weekdayOf(7 * HALF_SECONDS_PER_DAY)).toBe(0);
    expect(weekdayOf(7 * HALF_SECONDS_PER_DAY - 1)).toBe(6);
  });

  it('pause(true) stops t and pause(false) resumes it', () => {
    const c = clockAt0();
    c.step();
    c.pause(true);
    for (let i = 0; i < 100; i++) c.step();
    expect(c.now()).toMatchObject({ t: 1, paused: true });
    c.pause(false);
    c.step();
    expect(c.now().t).toBe(2);
  });

  it("lock('m1', 21) sets hour 21; unlock('m2') is ignored; unlock('m1') releases", () => {
    const c = clockAt0();
    c.lock('m1', 21);
    expect(c.env().hour).toBe(21);
    expect(c.now().lockedBy).toBe('m1');
    for (let i = 0; i < 50; i++) c.step();
    expect(c.env().hour).toBe(21); // a lock holds the time
    c.unlock('m2');
    expect(c.now().lockedBy).toBe('m1');
    c.lock('m2', 3, 'rain'); // a second owner is refused while a lock stands
    expect(c.env().hour).toBe(21);
    expect(c.now().lockedBy).toBe('m1');
    c.unlock('m1');
    expect(c.now().lockedBy).toBeNull();
    c.step();
    expect(c.now().t).toBe(21 * HALF_SECONDS_PER_HOUR + 1);
  });

  it('lock with a weather replaces the preset at once; setHour and forceWeather are ignored while locked', () => {
    const c = clockAt0();
    c.lock('m1', undefined, 'karl-fog');
    expect(c.env()).toMatchObject({ weather: 'karl-fog', next: 'karl-fog' });
    c.setHour(5);
    c.forceWeather('rain', 10);
    expect(c.env()).toMatchObject({ hour: 0, weather: 'karl-fog', next: 'karl-fog' });
    c.unlock('m1');
    c.setHour(5);
    expect(c.env().hour).toBe(5);
  });

  it('setHour keeps the day, wraps out-of-range hours and keeps the weather schedule where it was', () => {
    const c = clockAt0();
    for (let i = 0; i < 1000; i++) c.step();
    const before = c.weather();
    c.setHour(13.5);
    expect(c.env().hour).toBe(13.5);
    c.setHour(25);
    expect(c.env().hour).toBe(1);
    c.setHour(-1);
    expect(c.env().hour).toBe(23);
    c.setHour(0);
    const after = c.weather();
    expect(after.changeAtT - c.now().t).toBe(before.changeAtT - 1000);
    expect(after.current).toBe(before.current);
    expect(after.next).toBe(before.next);
  });

  it('forceWeather blends to the preset over the given seconds, then the preset is current', () => {
    const c = clockAt0();
    c.forceWeather('rain', 20); // 40 half-seconds = 40 ticks
    expect(c.env()).toMatchObject({ weather: 'clear', next: 'rain', blend: 0, rain: 0 });
    for (let i = 0; i < 20; i++) c.step();
    expect(c.env().blend).toBeGreaterThan(BLEND_MAX * 0.45);
    expect(c.env().blend).toBeLessThan(BLEND_MAX * 0.55);
    expect(c.env().rain).toBeGreaterThan(80);
    expect(c.env().rain).toBeLessThan(120);
    for (let i = 0; i < 20; i++) c.step();
    expect(c.env().weather).toBe('rain');
    expect(c.env().rain).toBe(CLOCK_CONFIG.presets.rain.rain);
  });

  it('forceWeather with 0 seconds switches at once, even on a paused clock', () => {
    const c = clockAt0();
    c.pause(true);
    c.forceWeather('karl-fog', 0);
    expect(c.env()).toMatchObject({ weather: 'karl-fog', next: 'karl-fog', blend: 0, fogBankM: CLOCK_CONFIG.presets['karl-fog'].fogBankM });
  });

  it('the Karl preset raises the marine layer, the rain preset the rain', () => {
    const c = clockAt0();
    c.forceWeather('karl-fog', 2);
    for (let i = 0; i < 4; i++) c.step();
    expect(c.env()).toMatchObject({ weather: 'karl-fog', fogBankM: CLOCK_CONFIG.presets['karl-fog'].fogBankM, rain: 0 });
  });
});

describe('night and dark (AC-2)', () => {
  const KEY_HOURS = [0, 5, 6.5, 9, 13, 17, 19.5, 21.5];

  it('are continuous across every key hour, the curve knots and midnight', () => {
    const knots = [...CLOCK_CONFIG.night, ...CLOCK_CONFIG.dark].map((p) => p[0]);
    for (const h of [...KEY_HOURS, ...knots]) {
      for (const f of [nightAt, darkAt]) {
        const a = f(h - 1e-6 < 0 ? h + 24 - 1e-6 : h - 1e-6);
        const b = f(h + 1e-6 >= 24 ? h - 24 + 1e-6 : h + 1e-6);
        expect(Math.abs(a - b)).toBeLessThan(1e-4);
      }
    }
  });

  it('change by less than 0.01 between samples 30 game seconds apart, over a whole day', () => {
    let prev = { n: nightAt(0), d: darkAt(0) };
    for (let t = 1; t <= HALF_SECONDS_PER_DAY; t += 60) {
      const h = hourOfT(t);
      const cur = { n: nightAt(h), d: darkAt(h) };
      expect(Math.abs(cur.n - prev.n)).toBeLessThan(0.01);
      expect(Math.abs(cur.d - prev.d)).toBeLessThan(0.01);
      prev = cur;
    }
  });

  it('are dark at 02:00, light at 13:00, and the lights are on at 19:00 and off at 08:00', () => {
    expect(nightAt(2)).toBe(1);
    expect(nightAt(13)).toBe(0);
    expect(darkAt(19)).toBeGreaterThan(0.4);
    expect(darkAt(8)).toBe(0);
    expect(nightAt(6.5)).toBeCloseTo(0.5, 6);
    expect(nightAt(19.5)).toBeCloseTo(0.5, 6);
  });

  it('are read from the clock env at the hour of the day', () => {
    const c = clockAt0();
    c.setHour(21.5);
    expect(c.env()).toMatchObject({ hour: 21.5, night: 1 });
    expect(c.env().dark).toBe(1);
  });
});

describe('weather schedule (AC-3)', () => {
  interface Change { t: number; current: WeatherPreset; next: WeatherPreset }

  function run(clock: WorldClock, ticks: number, into: Change[] = []): Change[] {
    let last = clock.weather().changeAtT;
    for (let i = 0; i < ticks; i++) {
      clock.step();
      const w = clock.weather();
      if (w.changeAtT !== last) {
        into.push({ t: clock.now().t, current: w.current, next: w.next });
        last = w.changeAtT;
      }
    }
    return into;
  }

  it('is identical on two runs of three game days, every interval within 20 to 40 game minutes', () => {
    const a = clockAt0();
    const b = clockAt0();
    const sa = run(a, 3 * HALF_SECONDS_PER_DAY);
    const sb = run(b, 3 * HALF_SECONDS_PER_DAY);
    expect(sa).toEqual(sb);
    expect(sa.length).toBeGreaterThan(3 * 24 * 1.4); // at least one change every 40 minutes, 36 on average
    const first = a.weather();
    expect(first.changeAtT).toBeGreaterThan(3 * HALF_SECONDS_PER_DAY);
    // Each change lands exactly on the previous changeAtT; the gaps are the drawn intervals.
    let prev = 0;
    const lo = CLOCK_CONFIG.intervalGameMinutes.min * HALF_SECONDS_PER_MINUTE;
    const hi = CLOCK_CONFIG.intervalGameMinutes.max * HALF_SECONDS_PER_MINUTE;
    const times = sa.map((c) => c.t);
    // The first change belongs to the interval drawn at construction.
    const startInterval = times[0] as number;
    expect(startInterval).toBeGreaterThanOrEqual(lo);
    expect(startInterval).toBeLessThanOrEqual(hi);
    prev = startInterval;
    for (const t of times.slice(1)) {
      expect(t - prev).toBeGreaterThanOrEqual(lo);
      expect(t - prev).toBeLessThanOrEqual(hi);
      prev = t;
    }
    // Every change is to a different preset.
    for (const c of sa) expect(c.current).not.toBe(c.next);
  });

  it('is the same from a checkpoint taken at day 1.5: sequence, change times and state hashes', () => {
    const full = simWithClock();
    const hashes: string[] = [];
    const ticks = 3 * HALF_SECONDS_PER_DAY;
    const mid = Math.floor(1.5 * HALF_SECONDS_PER_DAY);
    let snap: Uint8Array | null = null;
    const seqFull: Change[] = [];
    let last = full.clock.weather().changeAtT;
    for (let i = 1; i <= ticks; i++) {
      full.core.stepOnce();
      const w = full.clock.weather();
      if (w.changeAtT !== last) {
        seqFull.push({ t: full.clock.now().t, current: w.current, next: w.next });
        last = w.changeAtT;
      }
      if (i === mid) snap = full.core.serialize();
      if (i >= mid && i % 20_000 === 0) hashes.push(full.core.stateHash());
    }
    hashes.push(full.core.stateHash());
    expect(snap).not.toBeNull();

    const resumed = simWithClock();
    resumed.core.restore(snap as Uint8Array);
    expect(resumed.clock.now().t).toBe(mid);
    const seqResumed: Change[] = [];
    last = resumed.clock.weather().changeAtT;
    const hashes2: string[] = [];
    for (let i = mid + 1; i <= ticks; i++) {
      resumed.core.stepOnce();
      const w = resumed.clock.weather();
      if (w.changeAtT !== last) {
        seqResumed.push({ t: resumed.clock.now().t, current: w.current, next: w.next });
        last = w.changeAtT;
      }
      if (i % 20_000 === 0) hashes2.push(resumed.core.stateHash());
    }
    hashes2.push(resumed.core.stateHash());
    expect(seqResumed).toEqual(seqFull.filter((c) => c.t > mid));
    expect(hashes2).toEqual(hashes);
  });

  it('a different seed changes the sequence', () => {
    const a = run(clockAt0(SEED), 2 * HALF_SECONDS_PER_DAY);
    const b = run(clockAt0(SEED + 1), 2 * HALF_SECONDS_PER_DAY);
    expect(b).not.toEqual(a);
  });

  it('the clock is part of the state hash and of the checkpoint', () => {
    const a = simWithClock();
    const b = simWithClock();
    expect(a.core.stateHash()).toBe(b.core.stateHash());
    a.clock.setHour(12);
    expect(a.core.stateHash()).not.toBe(b.core.stateHash());
    a.core.stepOnce();
    const bytes = a.core.serialize();
    const c = simWithClock();
    c.core.restore(bytes);
    expect(c.clock.now()).toEqual(a.clock.now());
    expect(c.clock.weather()).toEqual(a.clock.weather());
    expect(c.core.stateHash()).toBe(a.core.stateHash());
  });

  it('Karl the Fog is drawn more often in the morning and the evening than at night', () => {
    // Count the presets that arrive at each hour band over many days of a fixed seed.
    const clock = clockAt0();
    const band = { morning: 0, evening: 0, night: 0, all: 0 };
    let last = clock.weather().changeAtT;
    for (let i = 0; i < 40 * HALF_SECONDS_PER_DAY; i++) {
      clock.step();
      const w = clock.weather();
      if (w.changeAtT !== last) {
        last = w.changeAtT;
        const h = hourOfT(w.changeAtT);
        band.all++;
        if (w.next === 'karl-fog') {
          if (h >= 4 && h < 10) band.morning++;
          else if (h >= 17 && h < 22) band.evening++;
          else band.night++;
        }
      }
    }
    expect(band.all).toBeGreaterThan(900);
    // 11 of 24 hours are biased; with weight 14 x 3 against 14 the biased hours carry the larger share of the Karl draws.
    expect(band.morning + band.evening).toBeGreaterThan(band.night * 1.3);
  });
});

describe('installClock', () => {
  it('registers the resource and the Rules-stage system and publishes the clock in services', () => {
    const cfg = testConfig();
    const core = new SimCore(cfg, new EcsWorld(), createSimServices(cfg.seed));
    const clock = installClock(core);
    expect(core.services.clock).toBe(clock);
    const t0 = clock.now().t;
    core.stepOnce();
    expect(clock.now().t).toBe(t0 + 1);
    expect(() => core.addResource(clock.resource())).toThrow(/already registered/);
  });
});

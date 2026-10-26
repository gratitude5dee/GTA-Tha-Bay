/**
 * The game clock and the weather schedule (C06 `WorldClockApi`; 01-engine-save-modes.md "Time-of-day and weather clock"; M02b2).
 *
 * `t` counts integer game half-seconds since day 0 (a Monday, 00:00). One tick advances `t` by `rate` = 1, which is 30 game seconds
 * per real second at 60 Hz; a game day is 172,800 half-seconds. The weather is a schedule over `t`:
 *
 *  - `current` is the preset in force, `next` the one arriving at `changeAtT`. The blend (u16) rises linearly from 0 at
 *    `blendStartT` to 65,535 at `changeAtT`; at `changeAtT` `next` becomes `current` and the stream `weather` draws the following
 *    preset and the length of the interval (20 to 40 game minutes). Karl the Fog is more likely in the morning and the evening
 *    (config/clock.json `hourBias`).
 *  - `lock` freezes `t` (and with it the schedule) for one owner; only that owner releases. `pause` freezes `t` for everyone.
 *    `setHour` moves `t` within the day and shifts the schedule by the same amount, so setting the hour never changes the weather.
 *  - `night` and `dark` are piecewise-linear in the hour of day. Every operation is +, -, *, / or a comparison: no transcendental
 *    `Math.*`, no `Date`, so the sim and the sky agree on both.
 *
 * The clock is a hashed, checkpointed resource (`clockResource`), runs at `SimStage.Rules` and is read through `env()`, which the
 * Publish stage puts in the snapshot side block (key `env`). Sandbox "sync to system time" is a main-thread `setHour` call.
 */
import { SimStage, type Fnv64, type RngStreams, type SystemDef } from '@dv/shared';
import type { EnvState, WeatherPreset, WeatherState, WorldClockApi, WorldClockState } from '@dv/shared';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import type { SimCore } from '../loop/sim-core.ts';
import type { SimResource } from '../services.ts';
import clockJson from '../../../../../config/clock.json';

export const HALF_SECONDS_PER_DAY = 172_800;
export const HALF_SECONDS_PER_HOUR = 7_200;
export const HALF_SECONDS_PER_MINUTE = 120;
/** The u16 range of `WeatherState.blend`. */
export const BLEND_MAX = 65_535;

/** `changeAtT` of a clock whose weather is held (M04e1): no change is ever due, so the schedule draws nothing. */
export const HOLD_T = Number.MAX_SAFE_INTEGER;

export const WEATHER_PRESETS: readonly WeatherPreset[] = ['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'];

type Curve = readonly (readonly [number, number])[];

export interface ClockConfig {
  schema: 'clock/1';
  start: { hour: number; weather: WeatherPreset };
  intervalGameMinutes: { min: number; max: number };
  defaultBlendGameMinutes: number;
  presets: Record<WeatherPreset, { weight: number; fogBankM: number; rain: number }>;
  hourBias: readonly { preset: WeatherPreset; fromHour: number; toHour: number; mul: number }[];
  night: Curve;
  dark: Curve;
  /** Phone shortcuts that follow the marine-layer day (M04e1): an hour and, optionally, a held preset. */
  sandboxShortcuts?: readonly { id: string; hour: number; weather?: WeatherPreset }[];
}

export const CLOCK_CONFIG: ClockConfig = clockJson as unknown as ClockConfig;

/** The stream the weather draws come from (C02 1.1). */
export const WEATHER_STREAM = 'weather';
/** The name of the clock resource in the state hash. */
export const CLOCK_RESOURCE = 'clock';
export const CLOCK_SYSTEM_ID = 'engine.clock.step';

/** Value of a piecewise-linear curve of [hour, value] points at `hour`; the ends hold. Only +, -, *, / and comparisons. */
export function curveAt(curve: Curve, hour: number): number {
  const first = curve[0] as readonly [number, number];
  if (hour <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i] as readonly [number, number];
    if (hour <= b[0]) {
      const a = curve[i - 1] as readonly [number, number];
      const span = b[0] - a[0];
      return span <= 0 ? b[1] : a[1] + (b[1] - a[1]) * ((hour - a[0]) / span);
    }
  }
  return (curve[curve.length - 1] as readonly [number, number])[1];
}

/** Hour of the day, 0 <= h < 24, of a time in half-seconds. */
export function hourOfT(t: number): number {
  return (t - Math.floor(t / HALF_SECONDS_PER_DAY) * HALF_SECONDS_PER_DAY) / HALF_SECONDS_PER_HOUR;
}

/** `night` (0 day .. 1 night) at an hour of day. */
export const nightAt = (hour: number, cfg: ClockConfig = CLOCK_CONFIG): number => curveAt(cfg.night, hour);
/** `dark` (0 lights off .. 1 lights on) at an hour of day. */
export const darkAt = (hour: number, cfg: ClockConfig = CLOCK_CONFIG): number => curveAt(cfg.dark, hour);

const presetIndex = (p: WeatherPreset): number => WEATHER_PRESETS.indexOf(p);

export class WorldClock implements WorldClockApi {
  private t: number;
  private paused = false;
  private lockedBy: string | null = null;
  private current: WeatherPreset;
  private next: WeatherPreset;
  private blendStartT = 0;
  private changeAtT = 0;
  private readonly defaultBlendT: number;

  /**
   * @param streams the session's named RNG streams. The clock asks for the `weather` stream at each draw instead of keeping it,
   *   because a checkpoint restore replaces the stream objects.
   */
  constructor(private readonly streams: RngStreams, readonly cfg: ClockConfig = CLOCK_CONFIG) {
    this.defaultBlendT = cfg.defaultBlendGameMinutes * HALF_SECONDS_PER_MINUTE;
    this.t = Math.round(cfg.start.hour * HALF_SECONDS_PER_HOUR);
    this.current = cfg.start.weather;
    this.next = cfg.start.weather;
    this.changeAtT = this.t;
    this.schedule(this.t);
  }

  // ---- WorldClockApi -----------------------------------------------------------------------------------------------------

  now(): Readonly<WorldClockState> {
    return { t: this.t, rate: 1, paused: this.paused, lockedBy: this.lockedBy };
  }

  /** The weather state (C06 `WeatherState`): presets, blend, the next change and the blended marine-layer height and rain. */
  weather(): Readonly<WeatherState> {
    const blend = this.blend();
    return { current: this.current, next: this.next, blend, changeAtT: this.changeAtT, ...this.mixed(blend) };
  }

  env(): Readonly<EnvState> {
    const hour = hourOfT(this.t);
    const blend = this.blend();
    const m = this.mixed(blend);
    return {
      hour, night: nightAt(hour, this.cfg), dark: darkAt(hour, this.cfg), weather: this.current, next: this.next, blend, fogBankM: m.fogBankM, rain: m.rain,
    };
  }

  /** Sets the hour of the current day (0 <= h < 24; other values wrap). Ignored while a lock holds the time. */
  setHour(h: number): void {
    if (this.lockedBy !== null) return;
    this.moveToHour(h);
  }

  pause(on: boolean): void {
    this.paused = on;
  }

  /**
   * Holds the time (and with it the weather schedule) for `by`: `hour` moves it first, `weather` replaces the preset at once.
   * A second owner is ignored while a lock stands; the same owner may lock again to change the hour or the weather.
   */
  lock(by: string, hour?: number, weather?: WeatherPreset): void {
    if (by === '' || (this.lockedBy !== null && this.lockedBy !== by)) return;
    this.lockedBy = by;
    if (hour !== undefined) this.moveToHour(hour);
    if (weather !== undefined) {
      this.current = weather;
      this.next = weather;
      this.blendStartT = this.t;
    }
  }

  /** Releases the lock when `by` holds it; any other caller is ignored. */
  unlock(by: string): void {
    if (this.lockedBy === by) this.lockedBy = null;
  }

  /**
   * Blends to `w` over `blendSec` game seconds; 0 switches at once, even on a paused clock. Ignored while a lock stands. The blend
   * runs on the clock, so a paused clock holds it where it is.
   */
  forceWeather(w: WeatherPreset, blendSec: number): void {
    if (this.lockedBy !== null) return;
    if (this.held) {
      // A held clock swaps the preset at once and stays held.
      this.current = w;
      this.next = w;
      this.blendStartT = this.t;
      return;
    }
    if (!(blendSec > 0)) {
      this.current = w;
      this.next = w;
      this.blendStartT = this.t;
      this.changeAtT = this.t + 1;
      return;
    }
    // A blend past the half has effectively arrived: start the new one from there so the sky does not swing back.
    if (this.blend() * 2 > BLEND_MAX) this.current = this.next;
    this.next = w;
    this.blendStartT = this.t;
    this.changeAtT = this.t + Math.max(1, Math.round(blendSec * 2));
  }

  /** True while a preset is held (`changeAtT` is the sentinel). */
  get held(): boolean {
    return this.changeAtT === HOLD_T;
  }

  /**
   * Engine-internal (not on `WorldClockApi`). `w` holds that preset until released: `current = next = w`, no change is ever due and
   * the `weather` stream is not drawn from. `null` releases a hold with one `schedule` call (two draws); it does nothing when the
   * clock is not held.
   */
  holdWeather(w: WeatherPreset | null): void {
    if (w === null) {
      if (this.held) this.schedule(this.t);
      return;
    }
    this.current = w;
    this.next = w;
    this.blendStartT = this.t;
    this.changeAtT = HOLD_T;
  }

  // ---- the tick ----------------------------------------------------------------------------------------------------------

  /** One tick: advance the time and take every weather change that is due. A paused or locked clock does nothing. */
  step(): void {
    if (this.paused || this.lockedBy !== null) return;
    this.t += 1;
    while (this.t >= this.changeAtT) {
      this.current = this.next;
      this.schedule(this.changeAtT);
    }
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------

  /** From the change at `at`: draw the length of the next interval, then the preset that arrives at its end. */
  private schedule(at: number): void {
    const rng = this.streams.get(WEATHER_STREAM);
    const lo = this.cfg.intervalGameMinutes.min * HALF_SECONDS_PER_MINUTE;
    const hi = this.cfg.intervalGameMinutes.max * HALF_SECONDS_PER_MINUTE;
    const interval = lo + (rng.nextU32() % (hi - lo + 1));
    this.changeAtT = at + interval;
    this.blendStartT = this.changeAtT - Math.min(this.defaultBlendT, interval);
    this.next = this.pick(this.current, this.changeAtT);
  }

  /** A preset other than `current`, by weight; the hour bias applies at the hour the change arrives. */
  private pick(current: WeatherPreset, arriveT: number): WeatherPreset {
    const hour = hourOfT(arriveT);
    const weights: number[] = [];
    let total = 0;
    for (const p of WEATHER_PRESETS) {
      let w = p === current ? 0 : this.cfg.presets[p].weight;
      for (const b of this.cfg.hourBias) if (b.preset === p && hour >= b.fromHour && hour < b.toHour) w *= b.mul;
      weights.push(w);
      total += w;
    }
    if (total <= 0) return current;
    let r = this.streams.get(WEATHER_STREAM).nextU32() % total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] as number;
      if (r < w) return WEATHER_PRESETS[i] as WeatherPreset;
      r -= w;
    }
    return current;
  }

  private moveToHour(h: number): void {
    const day = Math.floor(this.t / HALF_SECONDS_PER_DAY);
    const hh = h - Math.floor(h / 24) * 24;
    const to = day * HALF_SECONDS_PER_DAY + Math.round(hh * HALF_SECONDS_PER_HOUR);
    const delta = to - this.t;
    this.t = to;
    if (this.changeAtT !== HOLD_T) this.changeAtT += delta;
    this.blendStartT += delta;
  }

  /** u16 blend of `current` to `next` at the present time. */
  private blend(): number {
    if (this.changeAtT === HOLD_T) return 0;
    if (this.t <= this.blendStartT) return 0;
    if (this.t >= this.changeAtT) return BLEND_MAX;
    return Math.round(((this.t - this.blendStartT) / (this.changeAtT - this.blendStartT)) * BLEND_MAX);
  }

  private mixed(blend: number): { fogBankM: number; rain: number } {
    const a = this.cfg.presets[this.current];
    const b = this.cfg.presets[this.next];
    const f = blend / BLEND_MAX;
    return { fogBankM: a.fogBankM + (b.fogBankM - a.fogBankM) * f, rain: Math.round(a.rain + (b.rain - a.rain) * f) };
  }

  // ---- hashed, checkpointed state ----------------------------------------------------------------------------------------

  resource(): SimResource {
    return {
      name: CLOCK_RESOURCE,
      hash: (h: Fnv64) => {
        h.f64(this.t).u8(this.paused ? 1 : 0).str(this.lockedBy ?? '').u8(presetIndex(this.current)).u8(presetIndex(this.next));
        h.f64(this.blendStartT).f64(this.changeAtT);
      },
      save: (w: ByteWriter) => {
        w.f64(this.t);
        w.u8(this.paused ? 1 : 0);
        w.str(this.lockedBy ?? '');
        w.u8(presetIndex(this.current));
        w.u8(presetIndex(this.next));
        w.f64(this.blendStartT);
        w.f64(this.changeAtT);
      },
      load: (r: ByteReader) => {
        this.t = r.f64();
        this.paused = r.u8() !== 0;
        const by = r.str();
        this.lockedBy = by === '' ? null : by;
        this.current = WEATHER_PRESETS[r.u8()] ?? 'clear';
        this.next = WEATHER_PRESETS[r.u8()] ?? 'clear';
        this.blendStartT = r.f64();
        this.changeAtT = r.f64();
      },
    };
  }

  /** The Rules-stage system that steps the clock. */
  system(): SystemDef {
    return { id: CLOCK_SYSTEM_ID, owner: 'S01', stage: SimStage.Rules, order: 900, run: () => this.step() };
  }
}

/** Creates the clock on the session's `weather` stream, registers its resource and its system, and puts it in `services.clock`. */
export function installClock(core: SimCore, cfg: ClockConfig = CLOCK_CONFIG): WorldClock {
  const clock = new WorldClock(core.services.rng, cfg);
  core.addResource(clock.resource());
  core.addSystem(clock.system());
  core.services.clock = clock;
  return clock;
}

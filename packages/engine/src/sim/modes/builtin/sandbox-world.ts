/**
 * The sandbox's world controls (M04e1): weather hold, game hour, world speed, blackout and density. The settings arrive as
 * `sandbox.set` paths (`applyWorldSetting`), the shortcuts and the system-clock sync as `mode.cmd {mode: 'sandbox'}` actions
 * (`runSandboxAction`). Each setting has one storage place (the table in the M04e1 file) and makes exactly one engine call; the
 * calls sit in `try/catch` like the pursuit calls, because a build may lack the clock, the traffic control or the port.
 * Pure sim code in the C02 lint scope: no `Date`, no timers. Wall time enters only through the `time.sync` action.
 */
import type { JsonObject, JsonValue, ModeContext, SandboxSlice, SimEvent, WeatherPreset } from '@dv/shared';
import { CLOCK_CONFIG, WEATHER_PRESETS } from '../../world/clock.ts';
import { TELEPORT_ACTIONS } from './sandbox-teleport.ts';
import { VEHICLE_ACTIONS } from './sandbox-vehicles.ts';

/** What the sandbox needs of the engine beyond C06: the weather hold and the world speed (both engine-internal). */
export interface SandboxWorldPort {
  holdWeather(w: WeatherPreset | null): void;
  setTimeScale(s: 0.25 | 0.5 | 1 | 2): void;
}

export const WEATHER_PRESET = 'sandbox.weather.preset';
export const WEATHER_HOLD = 'sandbox.weather.hold';
export const TIME_HOUR = 'sandbox.time.hour';
export const TIME_PAUSED = 'sandbox.time.paused';
export const TIME_SYNC = 'sandbox.time.sync';
export const WORLD_SCALE = 'sandbox.world.timeScale';
export const WORLD_BLACKOUT = 'sandbox.world.blackout';
export const DENSITY_PREFIX = 'sandbox.world.density.';
export const DENSITY_KINDS = ['traffic', 'ped', 'parked'] as const;
export type DensityKind = (typeof DENSITY_KINDS)[number];
export const DENSITY_LEVELS: readonly number[] = [0, 0.35, 1, 1.5];
export const SCALES: readonly number[] = [0.25, 0.5, 1, 2];
/** The owner string every world call of the sandbox passes. */
export const SANDBOX_OWNER = 'sandbox';
/** The view-model key of the world controls. */
export const WORLD_VM = 'mode.sandbox.world';

/** The action names `mode.cmd {mode: 'sandbox'}` understands. */
export const SANDBOX_ACTIONS = ['time.shortcut', 'time.sync', 'world.reset', ...TELEPORT_ACTIONS, ...VEHICLE_ACTIONS] as const;
export type SandboxAction = (typeof SANDBOX_ACTIONS)[number];

/** True for a path this module owns (valid or not): the generic toggle behaviour never sees them. */
export function isWorldPath(path: string): boolean {
  return path.startsWith('sandbox.weather.') || path.startsWith('sandbox.time.') || path.startsWith('sandbox.world.');
}

const guard = (f: () => void): void => {
  try {
    f();
  } catch {
    // no clock, no traffic control or no port in this build
  }
};

const isHour = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 23.5 && v * 2 === Math.round(v * 2);

/** The stored density level of a kind (1 = normal). */
export function densityOf(s: SandboxSlice, kind: DensityKind): number {
  const v = s.toggles[`${DENSITY_PREFIX}${kind}`];
  return typeof v === 'number' ? v : 1;
}

/** The held preset, or null when the weather follows the schedule ("Natural"). */
export function heldWeather(s: SandboxSlice): WeatherPreset | null {
  return s.toggles[WEATHER_HOLD] === true && WEATHER_PRESETS.includes(s.weather) ? s.weather : null;
}

export function liveHour(ctx: ModeContext, s: SandboxSlice): number {
  try {
    const c = ctx.clock as { env?: () => { hour: number } };
    if (typeof c.env === 'function') return Math.floor(c.env().hour * 100) / 100;
  } catch {
    // no clock
  }
  return s.clock.hour;
}

/** Sends `mode.sandbox.world` (the controls' view model). */
export function publishWorld(ctx: ModeContext, s: SandboxSlice, online: boolean): void {
  const scale = s.toggles[WORLD_SCALE];
  const view = {
    weather: heldWeather(s),
    hour: liveHour(ctx, s),
    paused: s.clock.paused,
    sync: s.clock.syncSystemTime,
    timeScale: typeof scale === 'number' ? scale : 1,
    blackout: s.toggles[WORLD_BLACKOUT] === true,
    density: { traffic: densityOf(s, 'traffic'), ped: densityOf(s, 'ped'), parked: densityOf(s, 'parked') },
    shortcuts: (CLOCK_CONFIG.sandboxShortcuts ?? []).map((x) => x.id),
    online,
  };
  ctx.ui.patch(WORLD_VM, view as unknown as JsonValue);
}

/** Puts every world effect of the sandbox back: weather schedule, speed, traffic overrides, and the pause the sandbox set. */
export function releaseWorld(ctx: ModeContext, s: SandboxSlice, port: SandboxWorldPort | null): void {
  guard(() => port?.holdWeather(null));
  guard(() => port?.setTimeScale(1));
  guard(() => ctx.world.traffic.release(SANDBOX_OWNER));
  if (s.clock.paused || s.clock.syncSystemTime) guard(() => ctx.clock.pause(false));
}

/** Applies the stored state: the hold, the pause or sync (with the hour), the speed, the blackout and the densities. */
export function applyStoredWorld(ctx: ModeContext, s: SandboxSlice, port: SandboxWorldPort | null): void {
  const held = heldWeather(s);
  if (held !== null) guard(() => port?.holdWeather(held));
  if (s.clock.paused || s.clock.syncSystemTime) {
    guard(() => ctx.clock.setHour(s.clock.hour));
    guard(() => ctx.clock.pause(true));
  }
  const scale = s.toggles[WORLD_SCALE];
  if (typeof scale === 'number' && scale !== 1 && SCALES.includes(scale)) guard(() => port?.setTimeScale(scale as 0.25 | 0.5 | 2));
  if (s.toggles[WORLD_BLACKOUT] === true) guard(() => ctx.world.traffic.setBlackout(true, SANDBOX_OWNER));
  for (const kind of DENSITY_KINDS) {
    const d = densityOf(s, kind);
    if (d !== 1) guard(() => ctx.world.traffic.setDensity(kind, d, SANDBOX_OWNER));
  }
}

function setPreset(s: SandboxSlice, v: number, port: SandboxWorldPort | null): void {
  if (v < 0) {
    s.toggles[WEATHER_HOLD] = false;
    guard(() => port?.holdWeather(null));
    return;
  }
  const w = WEATHER_PRESETS[v] as WeatherPreset;
  s.weather = w;
  s.toggles[WEATHER_HOLD] = true;
  guard(() => port?.holdWeather(w));
}

function setHour(ctx: ModeContext, s: SandboxSlice, v: number): void {
  s.clock.hour = v;
  if (s.clock.syncSystemTime) {
    s.clock.syncSystemTime = false;
    const paused = s.clock.paused;
    guard(() => ctx.clock.pause(paused));
  }
  guard(() => ctx.clock.setHour(v));
}

/**
 * Applies one of the world paths. Returns false (and writes nothing) for a value outside its set or a path under the three world
 * prefixes that is not in the table; the caller falls back to the generic toggle for every other path. A path in the table that is
 * valid returns true and has published the view model.
 */
export function applyWorldSetting(ctx: ModeContext, s: SandboxSlice, path: string, v: boolean | number, port: SandboxWorldPort | null, online: boolean): boolean {
  const dk = path.startsWith(DENSITY_PREFIX) ? path.slice(DENSITY_PREFIX.length) : '';
  switch (path) {
    case WEATHER_PRESET:
      if (typeof v !== 'number' || !Number.isInteger(v) || v < -1 || v > WEATHER_PRESETS.length - 1) return false;
      setPreset(s, v, port);
      break;
    case TIME_HOUR:
      if (!isHour(v)) return false;
      setHour(ctx, s, v);
      break;
    case TIME_PAUSED:
      if (typeof v !== 'boolean') return false;
      s.clock.paused = v;
      if (!s.clock.syncSystemTime) guard(() => ctx.clock.pause(v));
      break;
    case TIME_SYNC:
      if (typeof v !== 'boolean') return false;
      s.clock.syncSystemTime = v;
      if (v) guard(() => ctx.clock.pause(true));
      else {
        const paused = s.clock.paused;
        guard(() => ctx.clock.pause(paused));
      }
      break;
    case WORLD_SCALE:
      if (typeof v !== 'number' || !SCALES.includes(v)) return false;
      s.toggles[path] = v;
      guard(() => port?.setTimeScale(v as 0.25 | 0.5 | 1 | 2));
      break;
    case WORLD_BLACKOUT:
      if (typeof v !== 'boolean') return false;
      s.toggles[path] = v;
      guard(() => ctx.world.traffic.setBlackout(v, SANDBOX_OWNER));
      break;
    default:
      if (!(DENSITY_KINDS as readonly string[]).includes(dk)) return false;
      if (typeof v !== 'number' || !DENSITY_LEVELS.includes(v)) return false;
      s.toggles[path] = v;
      guard(() => ctx.world.traffic.setDensity(dk as DensityKind, v, SANDBOX_OWNER));
  }
  publishWorld(ctx, s, online);
  return true;
}

/** `world.reset`: every world control back to its default and every sandbox override released. */
function resetWorld(ctx: ModeContext, s: SandboxSlice, port: SandboxWorldPort | null): void {
  releaseWorld(ctx, s, port);
  for (const k of Object.keys(s.toggles)) if (k === WEATHER_HOLD || k.startsWith('sandbox.world.')) delete s.toggles[k];
  s.clock.paused = false;
  s.clock.syncSystemTime = false;
}

function parse(e: SimEvent): { name: string; args: JsonObject } | null {
  if (e.t !== 'mode.cmd' || e.s === undefined) return null;
  let msg: { mode?: unknown; name?: unknown; args?: unknown };
  try {
    msg = JSON.parse(e.s) as typeof msg;
  } catch {
    return null;
  }
  if (msg.mode !== 'sandbox' || typeof msg.name !== 'string') return null;
  const a = msg.args;
  return { name: msg.name, args: typeof a === 'object' && a !== null && !Array.isArray(a) ? (a as JsonObject) : {} };
}

/**
 * Runs one `mode.cmd {mode: 'sandbox'}` event for the running sandbox. Unknown names and bad arguments are ignored. The dispatcher
 * has already refused the command while online; the check here is for a direct event.
 */
export function runSandboxAction(ctx: ModeContext, s: SandboxSlice, e: SimEvent, port: SandboxWorldPort | null, online: boolean): void {
  const m = parse(e);
  if (m === null || online || !(SANDBOX_ACTIONS as readonly string[]).includes(m.name)) return;
  switch (m.name as SandboxAction) {
    case 'time.shortcut': {
      const id = m.args['id'];
      const sc = typeof id === 'string' ? (CLOCK_CONFIG.sandboxShortcuts ?? []).find((x) => x.id === id) : undefined;
      if (!sc) return;
      if (!applyWorldSetting(ctx, s, TIME_HOUR, sc.hour, port, online)) return;
      if (sc.weather !== undefined) applyWorldSetting(ctx, s, WEATHER_PRESET, WEATHER_PRESETS.indexOf(sc.weather), port, online);
      return;
    }
    case 'time.sync': {
      const hour = m.args['hour'];
      if (!s.clock.syncSystemTime || typeof hour !== 'number' || !Number.isFinite(hour) || hour < 0 || hour >= 24) return;
      guard(() => ctx.clock.setHour(hour));
      publishWorld(ctx, s, online);
      return;
    }
    case 'world.reset':
      resetWorld(ctx, s, port);
      publishWorld(ctx, s, online);
      return;
    default:
      // the teleport and spot actions run in `sandbox-teleport.ts` (M04e2), the car actions in `sandbox-vehicles.ts` (M04e3)
      return;
  }
}

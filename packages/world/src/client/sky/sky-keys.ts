/**
 * The keyframed sky (02-world-living.md section 6; M02b2). `config/world/sky-keys.json` holds six presets with a row at each of
 * eight key hours; `evaluateSky` interpolates the rows by hour (wrapping at midnight), blends the current and the next preset by the
 * sim's u16 blend, and returns the shared uniforms. It is pure, so the tests run in Node; the dome, fog, rain and night code only
 * read its result.
 */
import skyKeysJson from '../../../../../config/world/sky-keys.json';
import { SKY_KEY_HOURS, type SkyInput, type SkyKeysFile, type SkyKeysRow, type SkyPresetId, type SkyUniforms, type Vec3 } from './types.ts';

export const SKY_PRESET_IDS: readonly SkyPresetId[] = ['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'];

/** Sunrise and sunset (design values): the sun is above the horizon between them. */
export const SUNRISE_HOUR = 6.5;
export const SUNSET_HOUR = 19.5;
/** Noon elevation of the sun at the equinox for San Francisco, degrees. */
export const NOON_ELEVATION_DEG = 52;
/** The moon stands opposite the sun at this share of the sun's strength. */
export const MOON_STRENGTH = 0.4;
/** The marine-layer height at which the Karl share of the fog is full, metres. */
export const BANK_FULL_M = 240;

const BLEND_MAX = 65_535;
const DEG = Math.PI / 180;

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Structural check of a parsed `sky-keys/1` file; returns the problems found (empty when the file is usable). */
export function skyKeysErrors(raw: unknown): string[] {
  const errors: string[] = [];
  const f = raw as Partial<SkyKeysFile> | null;
  if (!f || typeof f !== 'object') return ['not an object'];
  if (f.schema !== 'sky-keys/1') errors.push(`schema is ${String(f.schema)}, expected sky-keys/1`);
  if (!Array.isArray(f.hours) || f.hours.join(',') !== SKY_KEY_HOURS.join(',')) errors.push(`hours must be ${SKY_KEY_HOURS.join(', ')}`);
  for (const id of SKY_PRESET_IDS) {
    const rows = f.presets?.[id];
    if (!Array.isArray(rows) || rows.length !== SKY_KEY_HOURS.length) {
      errors.push(`preset ${id} needs ${SKY_KEY_HOURS.length} rows`);
      continue;
    }
    rows.forEach((r: SkyKeysRow, i) => {
      for (const k of ['skyTop', 'skyBottom', 'sunColor', 'ambient', 'fogColor'] as const) if (!isVec3(r[k])) errors.push(`${id}[${i}].${k} is not a vec3`);
      for (const k of ['sunSize', 'fogNearM', 'fogFarM', 'exposure', 'cloudCover', 'windowLit', 'starAlpha'] as const) if (!isNum(r[k])) errors.push(`${id}[${i}].${k} is not a number`);
      if (isNum(r.fogNearM) && isNum(r.fogFarM) && r.fogFarM <= r.fogNearM) errors.push(`${id}[${i}] fogFarM must exceed fogNearM`);
    });
  }
  return errors;
}

/** The committed keys, checked once at load. */
export const SKY_KEYS: SkyKeysFile = (() => {
  const errors = skyKeysErrors(skyKeysJson);
  if (errors.length > 0) throw new Error(`config/world/sky-keys.json is invalid: ${errors.slice(0, 5).join('; ')}`);
  return skyKeysJson as unknown as SkyKeysFile;
})();

const lerp = (a: number, b: number, t: number): number => (t >= 1 ? b : a + (b - a) * t);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Mixes two rows; `t` 0 gives `a`. */
export function mixRows(a: SkyKeysRow, b: SkyKeysRow, t: number): SkyKeysRow {
  return {
    skyTop: lerp3(a.skyTop, b.skyTop, t),
    skyBottom: lerp3(a.skyBottom, b.skyBottom, t),
    sunColor: lerp3(a.sunColor, b.sunColor, t),
    sunSize: lerp(a.sunSize, b.sunSize, t),
    ambient: lerp3(a.ambient, b.ambient, t),
    fogColor: lerp3(a.fogColor, b.fogColor, t),
    fogNearM: lerp(a.fogNearM, b.fogNearM, t),
    fogFarM: lerp(a.fogFarM, b.fogFarM, t),
    exposure: lerp(a.exposure, b.exposure, t),
    cloudCover: lerp(a.cloudCover, b.cloudCover, t),
    windowLit: lerp(a.windowLit, b.windowLit, t),
    starAlpha: lerp(a.starAlpha, b.starAlpha, t),
  };
}

/** The row of a preset at an hour of day (0 <= hour < 24; other values wrap): linear between the key hours, wrapping at midnight. */
export function rowAt(file: SkyKeysFile, preset: SkyPresetId, hourIn: number): SkyKeysRow {
  const rows = file.presets[preset];
  const hours = file.hours;
  const hour = hourIn - Math.floor(hourIn / 24) * 24;
  let i = hours.length - 1;
  for (let k = 0; k < hours.length; k++) {
    if ((hours[k] as number) <= hour) i = k;
  }
  const h0 = hours[i] as number;
  const j = (i + 1) % hours.length;
  const h1 = j === 0 ? 24 : (hours[j] as number);
  const t = h1 > h0 ? (hour - h0) / (h1 - h0) : 0;
  return mixRows(rows[i] as SkyKeysRow, rows[j] as SkyKeysRow, t);
}

/**
 * Direction towards the sun in ENU (x east, y up, +z south) at an hour of day: azimuth angle `a = pi (h - 6.5) / 13`, elevation
 * `52 deg * sin a`, so the sun rises in the east at 06:30, stands south at noon and sets in the west at 19:30. A unit vector.
 * The spec gives the day half only; the night half carries on from `a = pi` at 19:30 to `a = 2 pi` at 06:30 the next morning at the
 * same rate (the sun goes round below the horizon, the moon opposite it goes round above), so the direction is continuous at
 * midnight and the sun is below the horizon between sunset and sunrise (BD-M02b2-02).
 */
export function sunDirection(hourIn: number): Vec3 {
  const hour = hourIn - Math.floor(hourIn / 24) * 24;
  const a = hour >= SUNRISE_HOUR && hour <= SUNSET_HOUR
    ? (Math.PI * (hour - SUNRISE_HOUR)) / (SUNSET_HOUR - SUNRISE_HOUR)
    : Math.PI + (Math.PI * ((hour < SUNRISE_HOUR ? hour + 24 : hour) - SUNSET_HOUR)) / (24 - SUNSET_HOUR + SUNRISE_HOUR);
  const e = NOON_ELEVATION_DEG * DEG * Math.sin(a);
  return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
}

/** The weight of the Karl marine layer at ENU x: 1 west of -1,500 m (Richmond, Sunset, Ocean Beach), 0.35 east of 2,500 m, linear between. */
export function bankWeight(x: number): number {
  if (x <= -1500) return 1;
  if (x >= 2500) return 0.35;
  return 1 - (0.65 * (x + 1500)) / 4000;
}

/** Evaluates the whole sky for one frame. */
export function evaluateSky(file: SkyKeysFile, env: SkyInput): SkyUniforms {
  const t = clamp01(env.blend / BLEND_MAX);
  const a = rowAt(file, env.weather, env.hour);
  const row = env.next === env.weather || t === 0 ? a : mixRows(a, rowAt(file, env.next, env.hour), t);
  return {
    uNight: env.night,
    uDark: env.dark,
    uSunDir: sunDirection(env.hour),
    uSunColor: row.sunColor,
    uFogColor: row.fogColor,
    uFogNear: row.fogNearM,
    uFogFar: row.fogFarM,
    uSkyTop: row.skyTop,
    uSkyBottom: row.skyBottom,
    uAmbient: row.ambient,
    uExposure: row.exposure,
    uWet: clamp01(env.wet),
    uRain: clamp01(env.rain / 255),
    uBlackout: env.blackout ? 1 : 0,
    uBank: clamp01(env.fogBankM / BANK_FULL_M),
    uStars: (Math.max(0, env.night - 0.3) / 0.7) * row.starAlpha,
    uSunSize: row.sunSize,
    uWindowLit: row.windowLit,
    uCloud: row.cloudCover,
  };
}

/** The uniform values as one flat list, in a fixed order (tests compare consecutive frames component by component). */
export function flattenUniforms(u: SkyUniforms): number[] {
  return [
    u.uNight, u.uDark, ...u.uSunDir, ...u.uSunColor, ...u.uFogColor, u.uFogNear, u.uFogFar, ...u.uSkyTop, ...u.uSkyBottom, ...u.uAmbient,
    u.uExposure, u.uWet, u.uRain, u.uBlackout, u.uBank, u.uStars, u.uSunSize, u.uWindowLit, u.uCloud,
  ];
}

/** Names of the flat components, same order as `flattenUniforms`. */
export const UNIFORM_COMPONENTS: readonly string[] = [
  'uNight', 'uDark', 'uSunDir.x', 'uSunDir.y', 'uSunDir.z', 'uSunColor.r', 'uSunColor.g', 'uSunColor.b', 'uFogColor.r', 'uFogColor.g', 'uFogColor.b',
  'uFogNear', 'uFogFar', 'uSkyTop.r', 'uSkyTop.g', 'uSkyTop.b', 'uSkyBottom.r', 'uSkyBottom.g', 'uSkyBottom.b', 'uAmbient.r', 'uAmbient.g', 'uAmbient.b',
  'uExposure', 'uWet', 'uRain', 'uBlackout', 'uBank', 'uStars', 'uSunSize', 'uWindowLit', 'uCloud',
];

/** Relative luminance of a linear RGB triple (Rec. 709 weights). */
export const luminance = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

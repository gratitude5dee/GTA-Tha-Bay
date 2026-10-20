/**
 * The sun of the look pass (M02e): colour, intensity and exposure from M02b2's `SkyUniforms`. Pure, so the tests run in Node.
 *
 * The colour comes from an air-mass model: the Kasten-Young air mass of the sun's elevation, and a per-channel optical depth from the
 * preset's `rayleigh` and `turbidity` (look.json), so the sun is white at noon, gold in the afternoon and red at the horizon. The
 * preset's authored `sunColor` (the keys of M02b2) only sets how much light the weather lets through (`max` of its channels:
 * clear 1.0, Karl fog 0.18). The sun light is off when the sun is at or below the horizon; the moon takes over at night by M02b2's
 * rule (`moonUp = smooth(-0.02, 0.12, -sunY) * night`). `exposure = uExposure x exposureBias[tier]`.
 */
import type { QualityTierId } from '@dv/shared';
import type { SkyPresetId, SkyUniforms } from '../sky/types.ts';
import { LOOK, type LookFile } from './config.ts';

/** Intensity of a full sun on a `DirectionalLight` (M02b2 used 2.8 for the single static light; the look keeps the scale). */
export const SUN_LIGHT = 3.0;
/** Moonlight intensity at full moon strength (M02b2's `MOON_INTENSITY`). */
export const MOON_LIGHT = 0.55;
export const MOON_COLOR: readonly [number, number, number] = [0.55, 0.65, 1.0];

/** Per-channel optical depth at unit air mass for `rayleigh` 1 (red, green, blue), and the turbidity haze per unit of turbidity. */
const RAYLEIGH_TAU: readonly [number, number, number] = [0.0299, 0.0503, 0.1088];
const HAZE_TAU: readonly [number, number, number] = [0.0008, 0.0009, 0.001];

export interface SunState {
  /** Linear RGB, unit luminance (the intensity carries the strength). */
  color: [number, number, number];
  /** Light intensity (scene units of a `DirectionalLight`): the sun by day, the moon by night, 0 in between. */
  intensity: number;
  /** The light comes from the moon (the direction is the sun's, flipped). */
  moon: boolean;
  /** `uExposure x exposureBias[tier]`. */
  exposure: number;
  /** 0..1 strength of the sun alone (what the shadows follow). */
  sunUp: number;
  /** Elevation of the sun above the horizon, radians (negative below). */
  elevation: number;
  /** Kasten-Young air mass (0 below the horizon). */
  airMass: number;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const luma = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Kasten-Young (1989) relative air mass for an elevation in radians; the sun at the horizon is 38. */
export function airMass(elevationRad: number): number {
  const deg = (Math.max(0, elevationRad) * 180) / Math.PI;
  return 1 / (Math.sin(Math.max(0, elevationRad)) + 0.50572 * (deg + 6.07995) ** -1.6364);
}

/** Transmittance of the atmosphere towards the sun for the preset's turbidity and rayleigh scale. */
export function transmittance(m: number, rayleigh: number, turbidity: number): [number, number, number] {
  const t = (c: number): number => Math.exp(-(rayleigh * (RAYLEIGH_TAU[c] as number) * 1 + turbidity * (HAZE_TAU[c] as number) * 10) * m);
  return [t(0), t(1), t(2)];
}

export function sunState(env: Readonly<SkyUniforms>, preset: SkyPresetId, tier: QualityTierId, look: LookFile = LOOK, next: SkyPresetId = preset, blend = 0): SunState {
  const y = Math.max(-1, Math.min(1, env.uSunDir[1]));
  const elevation = Math.asin(y);
  const exposure = env.uExposure * look.exposureBias[tier];
  const sunUp = smooth(0, 0.12, y);
  // The air model blends with the next preset the way the keys do.
  const turb = look.sky.turbidity[preset] + (look.sky.turbidity[next] - look.sky.turbidity[preset]) * blend;
  const ray = look.sky.rayleigh[preset] + (look.sky.rayleigh[next] - look.sky.rayleigh[preset]) * blend;
  const moonUp = smooth(-0.02, 0.12, -y) * env.uNight;
  if (sunUp > 0) {
    const m = airMass(elevation);
    const t = transmittance(m, ray, turb);
    const zenith = transmittance(1, ray, turb);
    // Share of the light the weather lets through: the authored sun colour's strongest channel (clear noon 1.0).
    const pass = Math.max(env.uSunColor[0], env.uSunColor[1], env.uSunColor[2]);
    const l = luma(t);
    const color: [number, number, number] = l > 0 ? [t[0] / l, t[1] / l, t[2] / l] : [1, 1, 1];
    return { color, intensity: SUN_LIGHT * pass * (l / luma(zenith)) * sunUp, moon: false, exposure, sunUp, elevation, airMass: m };
  }
  return { color: [...MOON_COLOR], intensity: MOON_LIGHT * moonUp, moon: true, exposure, sunUp: 0, elevation, airMass: 0 };
}

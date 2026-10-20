/**
 * AC-4 (M02e): `sunState` sampled every 60 game seconds over 24 hours for each preset moves no colour, intensity or exposure
 * component by more than 0.05 (normalized); the sun light is off outside 06:30 to 19:30 as in M02b2; exposure is `uExposure x
 * exposureBias`; the sun is white at noon, gold in the afternoon and red at the horizon.
 */
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { darkAt, nightAt } from '@dv/engine/sim';
import { LOOK } from '../src/client/look/config.ts';
import { MOON_COLOR, MOON_LIGHT, SUN_LIGHT, airMass, sunState, transmittance } from '../src/client/look/sun.ts';
import { SKY_KEYS, SKY_PRESET_IDS, SUNRISE_HOUR, SUNSET_HOUR, evaluateSky } from '../src/client/sky/sky-keys.ts';
import type { SkyInput, SkyPresetId } from '../src/client/sky/types.ts';

const MAX_STEP = 0.05;

const uniforms = (hour: number, preset: SkyPresetId) =>
  evaluateSky(SKY_KEYS, { hour, night: nightAt(hour), dark: darkAt(hour), weather: preset, next: preset, blend: 0, fogBankM: 0, rain: 0, wet: 0, blackout: false } satisfies SkyInput);

const state = (hour: number, preset: SkyPresetId, tier: QualityTierId = 'desktop') => sunState(uniforms(hour, preset), preset, tier);

/** The components the AC measures: the light's colour times its intensity (what the shader receives), the intensity and the exposure. */
const components = (hour: number, preset: SkyPresetId): number[] => {
  const s = state(hour, preset);
  return [s.color[0] * s.intensity, s.color[1] * s.intensity, s.color[2] * s.intensity, s.intensity, s.exposure];
};

describe('sunState (AC-4)', () => {
  it.each(SKY_PRESET_IDS)('%s: no component moves by more than 0.05 (normalized) per 60 game seconds over 24 hours', (preset) => {
    // Normalized by the largest value the component takes over the day.
    const max: number[] = [1e-9, 1e-9, 1e-9, 1e-9, 1];
    for (let h = 0; h < 24; h += 0.05) components(h, preset).forEach((v, i) => void (max[i] = Math.max(max[i] as number, Math.abs(v))));
    let prev = components(0, preset);
    let worst = 0;
    for (let s = 60; s <= 24 * 3600; s += 60) {
      const cur = components((s % (24 * 3600)) / 3600, preset);
      cur.forEach((v, i) => void (worst = Math.max(worst, Math.abs(v - (prev[i] as number)) / (max[i] as number))));
      prev = cur;
    }
    expect(worst).toBeLessThan(MAX_STEP);
  });

  it('the sun light is off outside sunrise and sunset, as in M02b2, and on in between', () => {
    for (const preset of SKY_PRESET_IDS) {
      for (let h = 0; h < 24; h += 0.1) {
        const s = state(h, preset);
        if (h < SUNRISE_HOUR || h > SUNSET_HOUR) expect(s.moon, `${preset} ${h.toFixed(1)}`).toBe(true);
        if (h < SUNRISE_HOUR || h > SUNSET_HOUR) expect(s.sunUp).toBe(0);
        if (h > SUNRISE_HOUR + 0.5 && h < SUNSET_HOUR - 0.5) expect(s.moon).toBe(false);
      }
    }
    expect(state(13, 'clear').intensity).toBeGreaterThan(0.8 * SUN_LIGHT);
    // The moon: night, M02b2's colour, at most its light.
    const night = state(1, 'clear');
    expect(night.moon).toBe(true);
    expect(night.intensity).toBeLessThanOrEqual(MOON_LIGHT + 1e-9);
    expect(night.intensity).toBeGreaterThan(0.5 * MOON_LIGHT);
    expect(night.color).toEqual([...MOON_COLOR]);
  });

  it('exposure equals uExposure times the tier bias', () => {
    for (const tier of Object.keys(LOOK.exposureBias) as QualityTierId[]) {
      const u = uniforms(13, 'clear');
      expect(sunState(u, 'clear', tier).exposure).toBeCloseTo(u.uExposure * LOOK.exposureBias[tier], 12);
    }
    const biased = { ...LOOK, exposureBias: { ...LOOK.exposureBias, desktop: 0.8 } };
    expect(sunState(uniforms(13, 'clear'), 'clear', 'desktop', biased).exposure).toBeCloseTo(0.8, 12);
  });

  it('is white at noon, warmer in the afternoon and red at the horizon (air mass and turbidity)', () => {
    const rgb = (h: number): number[] => state(h, 'clear').color;
    const redness = (c: number[]): number => (c[0] as number) / (c[2] as number);
    expect(redness(rgb(13))).toBeLessThan(1.4);
    expect(redness(rgb(17.5))).toBeGreaterThan(redness(rgb(13)));
    expect(redness(rgb(19.2))).toBeGreaterThan(redness(rgb(17.5)));
    expect(redness(rgb(19.2))).toBeGreaterThan(3);
    // Haze takes more of the blue: the same sun at the same height and the same Rayleigh scale is warmer in hazier air.
    const hazy = { ...LOOK, sky: { ...LOOK.sky, turbidity: { ...LOOK.sky.turbidity, clear: 12 }, rayleigh: { ...LOOK.sky.rayleigh } } };
    expect(redness(sunState(uniforms(15, 'clear'), 'clear', 'desktop', hazy).color)).toBeGreaterThan(redness(state(15, 'clear').color));
  });

  it('Kasten-Young air mass: 1 at the zenith, 38 at the horizon', () => {
    expect(airMass(Math.PI / 2)).toBeCloseTo(1, 1);
    expect(airMass(0)).toBeGreaterThan(30);
    expect(airMass(0)).toBeLessThan(40);
    const t = transmittance(1, 1.6, 2.2);
    for (const c of t) expect(c).toBeGreaterThan(0.7);
  });

  it('the weather lets less light through: Karl fog at noon is a fraction of a clear noon', () => {
    expect(state(13, 'karl-fog').intensity).toBeLessThan(0.3 * state(13, 'clear').intensity);
  });
});

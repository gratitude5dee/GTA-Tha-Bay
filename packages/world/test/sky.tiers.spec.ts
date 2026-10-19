/**
 * AC-5 (tiers): the per-tier configuration equals the 02-world-living.md section 6 matrix. The expected values below are the
 * matrix text, written out a second time on purpose.
 */
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { SKY_TIERS, skyConfigFor } from '../src/client/sky/tiers.ts';
import { createAtmosphereAdapter } from '../src/client/sky/atmosphere.ts';
import { headlightsOn } from '../src/client/sky/night.ts';

const MATRIX: Record<QualityTierId, {
  fog: string; clouds: string; streaks: number; overlay: boolean; style: string; wetness: string; decals: number; atmosphere: number; budgetMs: number; lighting: string;
}> = {
  'desktop-ultra': { fog: 'height', clouds: 'volumetric', streaks: 20_000, overlay: false, style: 'volume', wetness: 'roughness+albedo', decals: 32, atmosphere: 2, budgetMs: 3.0, lighting: 'direct' },
  desktop: { fog: 'height', clouds: 'painted', streaks: 6_000, overlay: false, style: 'volume', wetness: 'albedo', decals: 32, atmosphere: 1, budgetMs: 1.0, lighting: 'direct' },
  'xr-visionpro': { fog: 'height', clouds: 'painted', streaks: 600, overlay: false, style: 'head', wetness: 'albedo', decals: 8, atmosphere: 1, budgetMs: 0.6, lighting: 'probe-grid' },
  mobile: { fog: 'linear', clouds: 'painted', streaks: 800, overlay: true, style: 'volume', wetness: 'albedo', decals: 16, atmosphere: 1, budgetMs: 0.6, lighting: 'probe-grid' },
  'mobile-low': { fog: 'linear', clouds: 'gradient', streaks: 0, overlay: true, style: 'none', wetness: 'none', decals: 0, atmosphere: 0, budgetMs: 0.3, lighting: 'probe-grid' },
  'xr-quest': { fog: 'linear-fade', clouds: 'gradient', streaks: 600, overlay: false, style: 'head', wetness: 'none', decals: 0, atmosphere: 0, budgetMs: 0.3, lighting: 'probe-grid' },
};

const TIERS = Object.keys(MATRIX) as QualityTierId[];

describe('the sky feature matrix (AC-5)', () => {
  it('has a row for each of the six tiers', () => {
    expect(Object.keys(SKY_TIERS).sort()).toEqual([...TIERS].sort());
  });

  it.each(TIERS)('%s: fog kind, rain streaks, wetness, decal cap and atmosphere level equal the matrix', (tier) => {
    const want = MATRIX[tier];
    const c = skyConfigFor(tier);
    expect(c.fog).toBe(want.fog);
    expect(c.clouds).toBe(want.clouds);
    expect(c.rain.streaks).toBe(want.streaks);
    expect(c.rain.overlay).toBe(want.overlay);
    expect(c.rain.style).toBe(want.style);
    expect(c.wetness).toBe(want.wetness);
    expect(c.decalCap).toBe(want.decals);
    expect(c.atmosphereLevel).toBe(want.atmosphere);
    expect(c.skyGpuBudgetMs).toBe(want.budgetMs);
    expect(c.lighting).toBe(want.lighting);
    expect(c.windows).toBe(true);
    expect(c.lamps).toBe(true);
  });

  it('roughness follows the wetness only on desktop-ultra; splashes only there too', () => {
    for (const t of TIERS) {
      expect(skyConfigFor(t).wetRoughness).toBe(t === 'desktop-ultra');
      expect(skyConfigFor(t).rain.splashes).toBe(t === 'desktop-ultra');
    }
  });

  it('desktop-ultra uses the desktop sky until an adapter lands: the slot is an interface only', () => {
    expect(skyConfigFor('desktop-ultra').adapter).toBe(true);
    expect(createAtmosphereAdapter({ enabled: true, level: 2 })).toBeNull();
    expect(createAtmosphereAdapter({ enabled: false, level: 2 })).toBeNull();
    expect(skyConfigFor('desktop').adapter).toBe(false);
  });

  it('the governor knob: level 0 is the cheap look, a ceiling is honoured, tiers without the knob stay as listed', () => {
    const low = skyConfigFor('desktop', 0);
    expect(low.level).toBe(0);
    expect(low.clouds).toBe('gradient');
    expect(low.rain.streaks).toBe(3000);
    expect(low.decalCap).toBe(16);
    expect(skyConfigFor('desktop', 2).level).toBe(1); // a desktop tier's ceiling is 1
    expect(skyConfigFor('desktop-ultra', 2).level).toBe(2);
    expect(skyConfigFor('desktop-ultra', 1).adapter).toBe(false);
    expect(skyConfigFor('mobile-low', 2)).toMatchObject({ level: 0, clouds: 'gradient', decalCap: 0 });
    expect(skyConfigFor('xr-quest', 0).rain.streaks).toBe(600);
  });

  it('the headlight signal is uDark > 0.4', () => {
    expect(headlightsOn(0.4)).toBe(false);
    expect(headlightsOn(0.41)).toBe(true);
  });
});

/**
 * The per-tier feature matrix of 02-world-living.md section 6, as data (M02b2). Nothing else in the sky code branches on a tier id:
 * `skyConfigFor` turns the tier and the governor's `atmosphereLevel` into the configuration the dome, fog, rain and night code build
 * from. Changing a tier's look is an edit to this table (the risk plan for `mobile-low` is a config edit).
 */
import type { QualityTierId } from '@dv/shared';

export type CloudKind = 'volumetric' | 'painted' | 'gradient';
export type FogKind = 'height' | 'linear' | 'linear-fade';
export type WetnessKind = 'roughness+albedo' | 'albedo' | 'none';
export type RainStyle = 'volume' | 'head' | 'none';
export type LightingKind = 'direct' | 'probe-grid';

export interface SkyTierRow {
  /** Sky: the dome always; `atmosphere` marks the takram adapter slot (desktop-ultra only; an interface until M10d2). */
  atmosphere: boolean;
  clouds: CloudKind;
  fog: FogKind;
  rain: {
    /** Streak count at full rain. */
    streaks: number;
    /** `volume`: a box of streaks around the camera; `head`: a small volume near the head (XR). */
    style: RainStyle;
    /** A screen-space streak overlay. */
    overlay: boolean;
    splashes: boolean;
  };
  wetness: WetnessKind;
  /** Pool-of-light decals near the player (at most). */
  decalCap: number;
  /** The governor knob `atmosphereLevel`: its ceiling on this tier (0 means the tier has no knob). */
  atmosphereLevel: 0 | 1 | 2;
  /** Design GPU budget of the whole sky, milliseconds (the dagger column of the matrix). */
  skyGpuBudgetMs: number;
  lighting: LightingKind;
}

export const SKY_TIERS: Readonly<Record<QualityTierId, SkyTierRow>> = {
  'desktop-ultra': {
    atmosphere: true, clouds: 'volumetric', fog: 'height', rain: { streaks: 20_000, style: 'volume', overlay: false, splashes: true },
    wetness: 'roughness+albedo', decalCap: 32, atmosphereLevel: 2, skyGpuBudgetMs: 3.0, lighting: 'direct',
  },
  desktop: {
    atmosphere: false, clouds: 'painted', fog: 'height', rain: { streaks: 6_000, style: 'volume', overlay: false, splashes: false },
    wetness: 'albedo', decalCap: 32, atmosphereLevel: 1, skyGpuBudgetMs: 1.0, lighting: 'direct',
  },
  'xr-visionpro': {
    atmosphere: false, clouds: 'painted', fog: 'height', rain: { streaks: 600, style: 'head', overlay: false, splashes: false },
    wetness: 'albedo', decalCap: 8, atmosphereLevel: 1, skyGpuBudgetMs: 0.6, lighting: 'probe-grid',
  },
  mobile: {
    atmosphere: false, clouds: 'painted', fog: 'linear', rain: { streaks: 800, style: 'volume', overlay: true, splashes: false },
    wetness: 'albedo', decalCap: 16, atmosphereLevel: 1, skyGpuBudgetMs: 0.6, lighting: 'probe-grid',
  },
  'mobile-low': {
    atmosphere: false, clouds: 'gradient', fog: 'linear', rain: { streaks: 0, style: 'none', overlay: true, splashes: false },
    wetness: 'none', decalCap: 0, atmosphereLevel: 0, skyGpuBudgetMs: 0.3, lighting: 'probe-grid',
  },
  'xr-quest': {
    atmosphere: false, clouds: 'gradient', fog: 'linear-fade', rain: { streaks: 600, style: 'head', overlay: false, splashes: false },
    wetness: 'none', decalCap: 0, atmosphereLevel: 0, skyGpuBudgetMs: 0.3, lighting: 'probe-grid',
  },
};

/** What the sky builds on one tier at one governor level. */
export interface SkyConfig extends SkyTierRow {
  tier: QualityTierId;
  /** The governor level in force (clamped to the tier's ceiling). */
  level: 0 | 1 | 2;
  /** Night windows and street lamps are on every tier. */
  windows: true;
  lamps: true;
  /** Roughness follows the wetness only where the matrix says so. */
  wetRoughness: boolean;
  /** The takram adapter may run (level 2 on a tier that has the slot). */
  adapter: boolean;
}

/**
 * The configuration of a tier at the governor's `atmosphereLevel` (a tier without the knob stays as the matrix lists it). Level 0
 * on a tier with the knob is the cheap look: gradient sky, half the streaks and decals. Level 1 is the matrix row; level 2 adds the
 * adapter slot where the tier has one.
 */
export function skyConfigFor(tier: QualityTierId, atmosphereLevel?: number): SkyConfig {
  const row = SKY_TIERS[tier];
  const ceil = row.atmosphereLevel;
  const asked = atmosphereLevel === undefined ? ceil : Math.max(0, Math.min(ceil, Math.round(atmosphereLevel)));
  const level = (ceil === 0 ? 0 : asked) as 0 | 1 | 2;
  const reduced = ceil > 0 && level === 0;
  return {
    ...row,
    rain: reduced ? { ...row.rain, streaks: Math.floor(row.rain.streaks / 2) } : { ...row.rain },
    clouds: reduced ? 'gradient' : row.clouds,
    decalCap: reduced ? Math.floor(row.decalCap / 2) : row.decalCap,
    atmosphere: row.atmosphere && level >= 2,
    atmosphereLevel: ceil === 0 ? 0 : level,
    tier,
    level,
    windows: true,
    lamps: true,
    wetRoughness: row.wetness === 'roughness+albedo',
    adapter: row.atmosphere && level >= 2,
  };
}

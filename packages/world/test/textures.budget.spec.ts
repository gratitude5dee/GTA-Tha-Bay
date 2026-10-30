/**
 * AC-5 (M10d0): each tier stays within the byte budgets of `config/world/surface-textures.json` (download and GPU) and within 5 % of its
 * `maxTextureMB`; a device that transcodes to RGBA8 drops mip levels until it fits; the budgets are never raised (planMipDrops).
 */
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { TIERS } from '@dv/engine/platform/tier-config';
import { LOOK, TIER_IDS, lookProfileFor } from '../src/client/look/config.ts';
import { MAP_NAMES, SURFACE_TEXTURES, TIER_VARIANT, boundSets, mapsOf, textureModeFor, type MapName } from '../src/client/textures/config.ts';
import { planMipDrops, type MipEntry } from '../src/client/textures/surface-textures.ts';

const MIB = 1024 * 1024;
const root = (p: string): URL => new URL(`../../../${p}`, import.meta.url);

interface Spec { stats: Record<string, { texMaxPx: number; texGpuBytes: number }> }
const dirOf = (set: string, map: MapName): string => `assets/src/texture/pbr.${set}.${map}`;

/** The files and statistics of the tier's bound sets for its mode. */
function tierLoad(tier: QualityTierId): { download: number; gpu: number; rgba8: MipEntry[] } {
  const mode = textureModeFor(tier, lookProfileFor(tier, true, LOOK), true);
  const variant = TIER_VARIANT[tier];
  let download = 0;
  let gpu = 0;
  const rgba8: MipEntry[] = [];
  for (const set of boundSets()) {
    for (const map of mapsOf(mode)) {
      download += statSync(root(`${dirOf(set, map)}/${variant}.ktx2`)).size;
      const spec = JSON.parse(readFileSync(root(`${dirOf(set, map)}/asset.json`), 'utf8')) as Spec;
      gpu += spec.stats[variant]?.texGpuBytes ?? 0;
      const px = spec.stats[variant]?.texMaxPx ?? 0;
      const mips: number[] = [];
      for (let s = px; s >= 1; s = Math.floor(s / 2)) mips.push(s * s * 4);
      rgba8.push({ key: `${set}.${map}`, mipBytes: mips });
    }
  }
  return { download, gpu, rgba8 };
}

describe('the byte budgets of the surface textures', () => {
  it.each(TIER_IDS)('%s: download and GPU bytes are within the budget, and the budget within 5 %% of maxTextureMB', (tier) => {
    const b = SURFACE_TEXTURES.budgets[tier];
    const load = tierLoad(tier);
    expect(load.download).toBeLessThanOrEqual(b.downloadMB * MIB);
    expect(load.gpu).toBeLessThanOrEqual(b.gpuMB * MIB);
    expect(b.gpuMB).toBeLessThanOrEqual(0.05 * TIERS[tier].budget.memory.maxTextureMB + 1e-9);
  });

  it('loads nothing on the XR tiers and albedo alone on mobile-low', () => {
    expect(tierLoad('xr-quest')).toMatchObject({ download: 0, gpu: 0 });
    expect(tierLoad('xr-visionpro')).toMatchObject({ download: 0, gpu: 0 });
    expect(tierLoad('mobile-low').rgba8.every((e) => e.key.endsWith('.albedo'))).toBe(true);
  });

  it.each(TIER_IDS)('%s: transcoded to RGBA8 the maps drop mip levels until they fit', (tier) => {
    const b = SURFACE_TEXTURES.budgets[tier];
    const { rgba8 } = tierLoad(tier);
    const plan = planMipDrops(rgba8, b.gpuMB * MIB);
    if (rgba8.length === 0) {
      expect(plan.fits).toBe(true);
      return;
    }
    expect(plan.fits).toBe(true);
    expect(plan.bytes).toBeLessThanOrEqual(b.gpuMB * MIB);
    for (const e of rgba8) expect(plan.drops[e.key]).toBeLessThan(e.mipBytes.length);
  });

  it('desktop RGBA8 needs a dropped mip, mobile-low RGBA8 needs none', () => {
    const d = tierLoad('desktop').rgba8;
    const full = d.reduce((a, e) => a + e.mipBytes.reduce((x, y) => x + y, 0), 0);
    expect(full).toBeGreaterThan(SURFACE_TEXTURES.budgets.desktop.gpuMB * MIB);
    expect(Object.values(planMipDrops(d, SURFACE_TEXTURES.budgets.desktop.gpuMB * MIB).drops).some((n) => n > 0)).toBe(true);
    const low = tierLoad('mobile-low').rgba8;
    expect(Object.values(planMipDrops(low, SURFACE_TEXTURES.budgets['mobile-low'].gpuMB * MIB).drops).every((n) => n === 0)).toBe(true);
  });
});

describe('planMipDrops', () => {
  const e = (key: string, ...mips: number[]): MipEntry => ({ key, mipBytes: mips });

  it('drops the top mip of the largest entry first and stops when the sum fits', () => {
    const plan = planMipDrops([e('a', 400, 100, 25), e('b', 100, 25)], 300);
    expect(plan.drops).toEqual({ a: 1, b: 0 });
    expect(plan.bytes).toBe(250);
    expect(plan.fits).toBe(true);
  });

  it('leaves every entry one level and reports that it does not fit when the budget is too small', () => {
    const plan = planMipDrops([e('a', 400, 100), e('b', 100, 25)], 10);
    expect(plan.drops).toEqual({ a: 1, b: 1 });
    expect(plan.fits).toBe(false);
  });

  it('changes nothing when everything fits', () => {
    expect(planMipDrops([e('a', 10, 2)], 100)).toEqual({ drops: { a: 0 }, bytes: 12, fits: true });
  });

  it('knows the three map names', () => {
    expect(MAP_NAMES).toEqual(['albedo', 'normal', 'orm']);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  C13_VERSION,
  FLAT_LADDER,
  FLAT_TIER_OF,
  VARIANT_FALLBACK,
  type QualityTierId,
  type TierBudget,
} from '../src/platform/c13.ts';

const budgets = JSON.parse(
  readFileSync(new URL('../../../config/tier-budgets.json', import.meta.url), 'utf8'),
) as { c13: string; tiers: Record<QualityTierId, TierBudget> };

const TIERS: readonly QualityTierId[] = [
  'desktop-ultra',
  'desktop',
  'mobile',
  'mobile-low',
  'xr-quest',
  'xr-visionpro',
];

// 11-platform.md 4.5, rows "Render objects" and "Triangles" (per view-pass for XR).
const TABLE_RENDER_OBJECTS: Record<QualityTierId, number> = {
  'desktop-ultra': 900,
  desktop: 600,
  mobile: 150,
  'mobile-low': 100,
  'xr-quest': 150,
  'xr-visionpro': 200,
};
const TABLE_TRIANGLES: Record<QualityTierId, number> = {
  'desktop-ultra': 6_000_000,
  desktop: 4_000_000,
  mobile: 1_000_000,
  'mobile-low': 600_000,
  'xr-quest': 750_000,
  'xr-visionpro': 1_500_000,
};

describe('C13 tier data', () => {
  it('config version matches the contract version', () => {
    expect(budgets.c13).toBe(C13_VERSION);
  });

  it('covers exactly the six tiers', () => {
    expect(Object.keys(budgets.tiers).sort()).toEqual([...TIERS].sort());
    expect(Object.keys(VARIANT_FALLBACK).sort()).toEqual([...TIERS].sort());
  });

  for (const tier of TIERS) {
    describe(tier, () => {
      const chain = VARIANT_FALLBACK[tier];

      it('chain starts with its own tier and ends at mobile-low', () => {
        expect(chain[0]).toBe(tier);
        expect(chain[chain.length - 1]).toBe('mobile-low');
      });

      it('never goes upward on FLAT_LADDER', () => {
        const rank = chain
          .map((id) => (FLAT_LADDER as readonly string[]).indexOf(id))
          .filter((i) => i >= 0);
        for (let i = 1; i < rank.length; i += 1) {
          expect(rank[i]!).toBeGreaterThan(rank[i - 1]!);
        }
        expect(new Set(chain).size).toBe(chain.length);
      });

      it('budget frame time matches the target fps', () => {
        const b = budgets.tiers[tier];
        expect(Math.abs(b.frame.frameBudgetMs - 1000 / b.frame.targetFps)).toBeLessThanOrEqual(0.1);
        expect(b.frame.minFps).toBeLessThanOrEqual(b.frame.targetFps);
        expect(b.frame.targetFps).toBeLessThanOrEqual(b.frame.maxFps);
      });

      it('render object and triangle limits equal the 4.5 table', () => {
        const b = budgets.tiers[tier];
        expect(b.render.maxRenderObjects).toBe(TABLE_RENDER_OBJECTS[tier]);
        expect(b.render.maxTriangles).toBe(TABLE_TRIANGLES[tier]);
      });

      it('memory thresholds and AI rate are the fixed values', () => {
        const b = budgets.tiers[tier];
        expect(b.memory.softPct).toBe(85);
        expect(b.memory.hardPct).toBe(95);
        expect(b.sim.aiHz).toBe(30);
        expect(b.sim.simHz).toBe(60);
      });
    });
  }

  it('XR tiers are not on the flat ladder and map to a flat tier for menus', () => {
    for (const id of FLAT_LADDER) expect(id.startsWith('xr-')).toBe(false);
    expect(FLAT_TIER_OF['xr-quest']).toBe('mobile-low');
    expect(FLAT_TIER_OF['xr-visionpro']).toBe('mobile');
  });

  it('Vision Pro renders two view passes', () => {
    expect(budgets.tiers['xr-visionpro'].render.viewPasses).toBe(2);
    expect(budgets.tiers['xr-quest'].render.viewPasses).toBe(1);
  });
});

/**
 * AC-2 (plans): every plan's r0, r2, physics radius and upload cap equal `config/tier-budgets.json` (the C13 `WorldLimits` and
 * `sim.physicsRadiusM`), `config/world/streaming.json` validates against its schema, and the plan table keeps the order of the
 * rings (r0 <= r1 <= r2).
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { STREAMING, basePlan } from '../src/sim/streaming/plan.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const budgets = read('config/tier-budgets.json') as {
  tiers: Record<QualityTierId, { world: { streamingRadiusM: number; buildingDrawDistanceM: number; altitudeBoostM: number; maxChunkUploadBytes: number | null }; sim: { physicsRadiusM: number } }>;
};

const TIERS = Object.keys(STREAMING.tiers) as QualityTierId[];

describe('config/world/streaming.json', () => {
  it('validates against config/schemas/world-streaming.schema.json', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(read('config/schemas/world-streaming.schema.json') as object);
    const ok = validate(read('config/world/streaming.json'));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('has a row for every tier of config/tier-budgets.json', () => {
    expect(TIERS.sort()).toEqual(Object.keys(budgets.tiers).sort());
  });

  it.each(TIERS)('%s: r0, r2, boost, physics radius and upload cap equal the C13 budget table', (tier) => {
    const plan = basePlan(tier);
    const b = budgets.tiers[tier];
    expect(plan.r0M).toBe(b.world.streamingRadiusM);
    expect(plan.r2M).toBe(b.world.buildingDrawDistanceM);
    expect(plan.altitudeBoostM).toBe(b.world.altitudeBoostM);
    expect(plan.physicsM).toBe(b.sim.physicsRadiusM);
    expect(plan.uploadBytes).toBe(b.world.maxChunkUploadBytes);
  });

  it.each(TIERS)('%s: the rings are ordered and the physics radius sits inside the ambient radius', (tier) => {
    const p = basePlan(tier);
    expect(p.r0M).toBeLessThanOrEqual(p.r1M);
    expect(p.r1M).toBeLessThanOrEqual(p.r2M);
    expect(p.physicsM).toBeLessThanOrEqual(p.ambientM);
    expect(p.resident.l0).toBeGreaterThanOrEqual(p.resident.l1);
    expect(p.resident.l1).toBeGreaterThanOrEqual(p.resident.l2);
  });

  it('keeps the 2 MB per frame cap on mobile-low and xr-quest only', () => {
    expect(basePlan('mobile-low').uploadBytes).toBe(2 * 1024 * 1024);
    expect(basePlan('xr-quest').uploadBytes).toBe(2 * 1024 * 1024);
    for (const t of ['desktop-ultra', 'desktop', 'mobile', 'xr-visionpro'] as const) expect(basePlan(t).uploadBytes).toBeNull();
  });
});

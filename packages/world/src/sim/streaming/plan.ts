/**
 * The streaming plan (02-world.md section 3 and 4): per tier, the radii of the three render levels, the ambient and physics radii,
 * the resident caps and the upload cap, read from `config/world/streaming.json` (r0, r2, physics and upload equal the C13
 * `WorldLimits` of `config/tier-budgets.json`; a unit test checks it). Pure; C02 lint applies.
 */
import type { QualityTierId } from '@dv/shared';
import streamingJson from '../../../../../config/world/streaming.json';

export interface StreamingPlan {
  tier: QualityTierId;
  /** L0 (z=9 chunk), L1 (z=7 tile) and L2 (z=5 block) outer radii, metres. */
  r0M: number;
  r1M: number;
  r2M: number;
  /** Added to r2 at full altitude (flight, high free cam). */
  altitudeBoostM: number;
  ambientM: number;
  physicsM: number;
  resident: { l0: number; l1: number; l2: number };
  /** Bytes per frame the upload gate may release; null = no byte cap (one chunk per frame still holds). */
  uploadBytes: number | null;
}

export interface StreamingTierRow {
  r0M: number;
  r1M: number;
  r2M: number;
  altitudeBoostM: number;
  ambientM: number;
  physicsM: number;
  resident: { l0: number; l1: number; l2: number };
  uploadBytes: number | null;
}

export interface StreamingConfig {
  schema: 'world-streaming/1';
  lookAheadS: number;
  dirWeights: { ahead: number; side: number; behind: number };
  unloadFactor: number;
  pressureSteps: number[];
  lodBiasPerStep: number;
  altitudeBoost: { fromAglM: number; fullAglM: number };
  inFlight: { p0: number; l0: number; l1: number; l2: number };
  retry: { firstMs: number; maxMs: number; maxAttempts: number };
  tiers: Record<QualityTierId, StreamingTierRow>;
}

export const STREAMING: StreamingConfig = streamingJson as unknown as StreamingConfig;

/** The governor knobs and the memory-pressure step that scale the rings (C13 `DynamicQuality`, 11-platform.md 5.6). */
export interface StreamingKnobs {
  /** 0 = nominal, + = coarser (C13 range 0..2). */
  lodBias: number;
  /** Scales r1 and r2 (0.5 .. 1). */
  buildingDistanceScale: number;
  /** Index into `pressureSteps`: 0 nominal, then one step down per memory-pressure response. */
  pressureStep: number;
  /** Altitude of the focus above the ground, metres: the boost to r2 fades in between `fromAglM` and `fullAglM`. */
  altitudeAglM: number;
}

export const NOMINAL_KNOBS: StreamingKnobs = { lodBias: 0, buildingDistanceScale: 1, pressureStep: 0, altitudeAglM: 0 };

/** The base plan of a tier, without knobs. */
export function basePlan(tier: QualityTierId): StreamingPlan {
  const t = STREAMING.tiers[tier];
  return { tier, ...t, resident: { ...t.resident } };
}

/**
 * The plan under the knobs. `lodBias` (0 = nominal, + = coarser) shrinks the L0 and L1 rings by `1 / (1 + 0.15 x bias)`: a coarser
 * bias hands the ring to the next level sooner (Builder decision BD-M02b1-02; the spec's "scales the ring radii by 1 + 0.15 x bias"
 * reads as the factor of that change). `buildingDistanceScale` scales r1 and r2. A memory-pressure step scales the render rings and
 * the ambient radius, never the physics radius. The altitude boost adds to r2 between `fromAglM` and `fullAglM` above the ground.
 */
export function planFor(tier: QualityTierId, knobs: StreamingKnobs = NOMINAL_KNOBS): StreamingPlan {
  const base = basePlan(tier);
  const step = STREAMING.pressureSteps[Math.min(Math.max(0, knobs.pressureStep), STREAMING.pressureSteps.length - 1)] as number;
  const bias = 1 / (1 + STREAMING.lodBiasPerStep * Math.max(0, knobs.lodBias));
  const bd = Math.min(1, Math.max(0.25, knobs.buildingDistanceScale));
  const a = STREAMING.altitudeBoost;
  const boost = base.altitudeBoostM * Math.min(1, Math.max(0, (knobs.altitudeAglM - a.fromAglM) / (a.fullAglM - a.fromAglM)));
  return {
    ...base,
    r0M: base.r0M * step * bias,
    r1M: base.r1M * step * bias * bd,
    r2M: (base.r2M + boost) * step * bd,
    ambientM: base.ambientM * step,
  };
}

/** Whether a tier's rings are those of a plan with these knobs (used by tests to compare a plan against the C13 budget table). */
export const isNominal = (k: StreamingKnobs): boolean => k.lodBias === 0 && k.buildingDistanceScale === 1 && k.pressureStep === 0 && k.altitudeAglM <= STREAMING.altitudeBoost.fromAglM;

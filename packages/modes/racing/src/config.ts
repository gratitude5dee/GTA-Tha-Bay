/**
 * `config/racing.json` (RacingConfig, 06-racing-data.md 4.6), bundled so the sim worker needs no fetch. The JSON is the only source of
 * the numbers; the schema `config/schemas/racing.schema.json` checks it in CI (`config.spec.ts`).
 */
import type { Difficulty, QualityTierId, RaceKind } from '@dv/shared';
import racingJson from '../../../../config/racing.json';

export interface TierCap { rivals: number; policeCars: number; cullM: number; skidSegments: number; envProbe: 'grid' | 'baked'; wheelBlur: boolean; sparkParticles: number }

export interface RacingConfig {
  schema: 1;
  tierCaps: Record<QualityTierId, TierCap>;
  models: { m1PromoteM: number; m1DemoteM: number; m1MaxActive: Record<QualityTierId, number> };
  ai: {
    lookaheadBaseM: number; lookaheadPerMps: number; speedFactorMin: number; speedFactorMax: number; brakeMarginMax: number; mistakePerCorner: number;
    overtakeGapM: number; overtakeHoldSec: number; recoverStuckSec: number; offRouteTeleportM: number; thinkHz: number;
  };
  rubberBand: { maxPct: number; gapScaleM: number; freezeLastPct: number; difficulty: Record<Difficulty, number>; underdogNitro: number; powerCapPct: number };
  nitro: {
    nearMissM: number; nearMissKph: number; draftWindowSec: number; draftLateralM: number; draftKph: number;
    perfectStartWindowSec: number; perfectStartNitroPct: number;
  };
  damage: {
    vThreshold: number; k: number; engineShareFront: number; spikePuncture: number; landingVy: number; repairKitPct: number; bustRepairPct: number;
    difficulty: Record<Difficulty, number>;
  };
  race: {
    countdownTicks: number; gridAutoTicks: number; jumpStartM: number; jumpStartPenaltySec: number; wrongWayWarnM: number; wrongWayRespawnSec: number;
    stuckResetSec: number; resetPenaltySec: number; flipResetSec: number; resetHoldSec: number; gateTolerantY: number; defaultGateWidthM: number;
    minGateWidthM: number; autoGateEveryM: number; autoGateTurnDeg: number;
  };
  drift: { minAngleDeg: number; chainBreakSec: number; comboStep: number; comboMax: number; wallPenalty: number };
  progression: {
    repThresholds: number[]; classRepLevel: { C: number; B: number; A: number; S: number }; purseDollars: Record<'D' | 'C' | 'B' | 'A' | 'S', number>;
    placeMult: number[]; medalMult: number[];
  };
  replay: { maxInputsBytes: number; maxTrackBytes: number; maxDurationSec: number; keyframeEveryTicks: number };
  photo: { radiusM: number; fovDeg: [number, number]; exposureEv: [number, number]; filters: number };
  xr: { allowKinds: RaceKind[]; vignetteBoostPerYawRate: number };
}

export const RACING_CONFIG: Readonly<RacingConfig> = racingJson as unknown as RacingConfig;

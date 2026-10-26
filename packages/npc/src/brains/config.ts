/**
 * The knobs of the agency layer, read from `config/npc.json` (04-npc-builder.md sections C8 and C9; M06c). Sim code, so the file is
 * imported as data and nothing here touches the clock or the DOM.
 */
import npcConfig from '../../../../config/npc.json';
import type { QualityTierId } from '@dv/shared';

export interface BrainConfig {
  lod: { aRadiusM: number; bRadiusM: number; aEveryAiTicks: number; bEveryAiTicks: number; hysteresisM: number };
  /** Brains at LOD A the tier may run at once. */
  caps: Readonly<Record<QualityTierId, number>>;
  brains: {
    walkMps: number; runMps: number; arriveM: number; snapLagM: number; lookRadiusM: number;
    threatRadiusM: number; threatHoldS: number; fleeS: number; fleeMinM: number;
    scheduleBase: number; priorityStep: number; greetMax: number; holdScore: number; talkScore: number;
    intentScore: { low: number; med: number; high: number };
    animSeconds: { min: number; max: number }; sleepSeconds: { min: number; max: number };
    smartObjectSlots: number; wanderM: number;
  };
  barks: {
    entityCooldownS: number; tagCooldownS: number; maxAudible: number; radiusM: number;
    subtitleMinS: number; subtitlePerCharS: number; fillerTalkRadiusM: number; fillerTalkCooldownS: number;
  };
  intent: { clientTimeoutMs: number; maxNearby: number; offTiers: readonly string[] };
  throttles: {
    intentMinSecondsPerNpc: number; intentMaxInFlight: number; intentMaxPerMinute: number;
    intentTriggerRadiusM: number; intentTriggerTrust: number; worldEventRadiusM: number;
  };
  cacheTtls: { intentSeconds: number };
}

export const BRAIN_CONFIG: BrainConfig = {
  lod: npcConfig.lod,
  caps: npcConfig.caps.lodABrains as Record<QualityTierId, number>,
  brains: npcConfig.brains,
  barks: npcConfig.barks,
  intent: npcConfig.intent,
  throttles: npcConfig.throttles,
  cacheTtls: npcConfig.cacheTtls,
};

/** Sim ticks per second (C02) and per AI step (30 Hz). */
export const SIM_HZ = 60;
export const AI_STEP_TICKS = 2;
/** Seconds as sim ticks, rounded up so a one second wait is never shorter. */
export const secondsToTicks = (s: number): number => Math.ceil(s * SIM_HZ);

/** The LOD-A cap of a tier; an unknown tier gets the smallest cap. */
export function lodCap(tier: QualityTierId | string, cfg: BrainConfig = BRAIN_CONFIG): number {
  const v = (cfg.caps as Record<string, number>)[tier];
  return typeof v === 'number' ? v : Math.min(...Object.values(cfg.caps));
}

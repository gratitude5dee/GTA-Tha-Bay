/**
 * `ScheduleSystem` (04-npc-builder.md section C8; M06c): picks the active schedule block with `scheduleAt` and keeps the per-day random
 * stream. The stream is seeded from `(world seed, NPC id, game day)`, so a brain makes the same choices on the same day of the same world
 * whatever the player did on the day before. Sim code; C02 lint applies.
 */
import { ctrU32 } from '@dv/shared';
import type { Activity, ScheduleBlock } from '@dv/shared/contracts/c10-npc';
import { HALF_SECONDS_PER_DAY, scheduleAt } from '@dv/shared/npc';
import type { NpcAgent } from './agent.ts';

export interface ScheduleResult {
  index: number;
  block: ScheduleBlock;
  activity: Activity;
  /** The block differs from the one the previous step saw. */
  changed: boolean;
}

/** The game day of a clock value. */
export const gameDayOf = (clockT: number): number => Math.floor(Math.max(0, clockT) / HALF_SECONDS_PER_DAY);

/** The seed of a brain's stream for one day. */
export const dayStreamSeed = (worldSeed: number, npcId: string, day: number): number => ctrU32(worldSeed, `npc:${npcId}`, day);

/** Re-seeds the agent's stream when the game day changed since the last step. */
export function rollDay(a: NpcAgent, worldSeed: number, clockT: number): boolean {
  const day = gameDayOf(clockT);
  if (day === a.gameDay) return false;
  a.gameDay = day;
  a.rng.seed(dayStreamSeed(worldSeed, a.id, day));
  return true;
}

/** Looks up the block active at `clockT` and records it on the agent. */
export function scheduleStep(a: NpcAgent, clockT: number): ScheduleResult {
  const { index, block } = scheduleAt(a.soul, clockT);
  const changed = index !== a.block;
  a.block = index;
  return { index, block, activity: block.activity, changed };
}

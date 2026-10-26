/**
 * `UtilitySystem` (04-npc-builder.md section C8; M06c): scores the interrupts that may replace what the schedule says and picks a winner.
 *
 *  - schedule  `scheduleBase + priorityStep * priority`: a priority 9 block (sleep) scores 0.95, a priority 1 block 0.55;
 *  - threat    `0.3 + 0.7 * closeness` while a threat is live and within `threatRadiusM`; a block that is not interruptible scales it by 0.6,
 *              so a sleeper wakes only for a threat on top of it;
 *  - greet     the player within `lookRadiusM`: `greetMax * closeness * (0.5 + 0.5 * |trust| / 100)`, only in an interruptible block;
 *  - intent    the hero's LLM intent while it holds: `intentScore[urgency]`, only in an interruptible block;
 *  - hold      a mission lock: `holdScore`, above everything but a conversation;
 *  - talk      an open conversation: `talkScore`.
 * The current winner gets a 0.05 bonus so a score that hovers on a boundary does not flap, and an earlier `UTILITY` index wins a tie.
 * Sim code; C02 lint applies.
 */
import { dsqrt } from '@dv/shared';
import type { ScheduleBlock } from '@dv/shared/contracts/c10-npc';
import { UTILITY, UTILITY_COUNT, type BrainEnv, type NpcAgent, type UtilityKind } from './agent.ts';
import type { BrainConfig } from './config.ts';

const STICKY = 0.05;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function utilityStep(a: NpcAgent, block: ScheduleBlock, env: BrainEnv, cfg: BrainConfig): UtilityKind {
  const b = cfg.brains;
  const s = a.scores;
  for (let i = 0; i < UTILITY_COUNT; i++) s[i] = -1;
  s[UTILITY.Schedule] = b.scheduleBase + b.priorityStep * block.priority;
  const interruptible = block.interruptible;

  if (a.talking) s[UTILITY.Talk] = b.talkScore;
  if (a.locks > 0) s[UTILITY.Hold] = b.holdScore;

  const th = a.threat;
  if (th && th.until > env.tick) {
    const dx = th.x - a.x;
    const dz = th.z - a.z;
    const closeness = clamp01(1 - dsqrt(dx * dx + dz * dz) / b.threatRadiusM);
    if (closeness > 0) s[UTILITY.Flee] = (0.3 + 0.7 * closeness) * (interruptible ? 1 : 0.6);
  }

  const it = a.intent;
  if (it && interruptible && (it.block >= 0 ? it.block === a.block : it.until > env.tick)) {
    s[UTILITY.Intent] = it.urgency === 2 ? b.intentScore.high : it.urgency === 1 ? b.intentScore.med : b.intentScore.low;
  }

  const p = env.player;
  if (p && interruptible) {
    const dx = p.x - a.x;
    const dz = p.z - a.z;
    const closeness = clamp01(1 - dsqrt(dx * dx + dz * dz) / b.lookRadiusM);
    if (closeness > 0) {
      const trust = Math.abs(env.trust(a.id));
      s[UTILITY.Greet] = b.greetMax * closeness * (0.5 + 0.5 * (trust > 100 ? 100 : trust) / 100);
    }
  }

  let best: UtilityKind = UTILITY.Schedule;
  let bestScore = -2;
  for (let i = 0; i < UTILITY_COUNT; i++) {
    const v = (s[i] as number) + (i === a.winner && (s[i] as number) >= 0 ? STICKY : 0);
    if (v > bestScore) {
      bestScore = v;
      best = i as UtilityKind;
    }
  }
  return best;
}

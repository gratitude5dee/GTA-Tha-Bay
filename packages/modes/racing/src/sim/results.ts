/**
 * Results of a race (06-racing.md 2.13, D-S06-04; M07a2): place, medals, purse and Rep. Pure.
 *
 *  - Medals come from the event's `medals` seconds (par x 1.25, 1.12, 1.04).
 *  - The purse is the event's own cash reward (or the class purse) times the place multiplier (1.0, 0.6, 0.35, 0.2, 0.1), times the
 *    first-time medal bonus (x1.0, 1.25, 1.5, 2.0 for the medal reached) the first time that medal is earned. A DNF pays nothing.
 *  - Rep is the event's Rep reward times the place multiplier.
 *  - A pursuit pays its bounty (points x cents a point) and the event's cash reward when it ends in `evade`.
 *  - An embedded run (story) pays nothing here: the mission pays its own rewards, so the purse is never paid twice.
 */
import type { RaceDef, VehicleClass } from '@dv/shared';
import type { RacingConfig } from '../config.ts';
import { medalsFor } from './telemetry.ts';

const CLASS_ORDER: readonly VehicleClass[] = ['D', 'C', 'B', 'A', 'S'];

/** The event's class: the highest of its `classLimit`, class D without one. */
export function eventClass(def: Pick<RaceDef, 'classLimit'>): VehicleClass {
  let best = 0;
  for (const c of def.classLimit ?? []) best = Math.max(best, CLASS_ORDER.indexOf(c));
  return CLASS_ORDER[best] as VehicleClass;
}

export interface ResultInput {
  def: RaceDef;
  cfg: RacingConfig['progression'];
  outcome: 'finish' | 'dnf';
  ms: number;
  place: number;
  /** The best medal already won on this event. */
  prevMedals: 0 | 1 | 2 | 3;
  embedded: boolean;
  /** A pursuit that ended in evade. */
  evaded?: boolean;
  bountyCents?: number;
}

export interface RaceRewards { medals: 0 | 1 | 2 | 3; cashCents: number; rep: number; firstMedal: boolean }

const placeMult = (cfg: RacingConfig['progression'], place: number): number => cfg.placeMult[Math.max(0, Math.min(cfg.placeMult.length - 1, place - 1))] ?? 0;

export function computeRewards(i: ResultInput): RaceRewards {
  const { def, cfg } = i;
  const timed = def.kind !== 'pursuit';
  const medals: 0 | 1 | 2 | 3 = i.outcome === 'finish' && timed ? medalsFor(def, i.ms) : 0;
  const firstMedal = medals > i.prevMedals;
  if (i.embedded || (i.outcome !== 'finish' && !(def.kind === 'pursuit' && (i.bountyCents ?? 0) > 0))) return { medals, cashCents: 0, rep: 0, firstMedal };
  let cash = 0;
  let rep = 0;
  const cashReward = def.rewards.find((r) => r.kind === 'cash' && (r.place === undefined || r.place === 1));
  const repReward = def.rewards.find((r) => r.kind === 'rep' && (r.place === undefined || r.place === 1));
  const classPurse = (cfg.purseDollars[eventClass(def) as 'D' | 'C' | 'B' | 'A' | 'S'] ?? 0) * 100;
  if (def.kind === 'pursuit') {
    cash = i.bountyCents ?? 0;
    if (i.evaded) {
      cash += cashReward?.cents ?? 0;
      rep = repReward?.rep ?? 0;
    }
  } else if (i.outcome === 'finish') {
    const m = placeMult(cfg, i.place);
    cash = Math.round((cashReward?.cents ?? classPurse) * m);
    rep = Math.round((repReward?.rep ?? 60) * m);
    if (firstMedal) cash = Math.round(cash * (cfg.medalMult[medals] ?? 1));
  }
  return { medals, cashCents: cash, rep, firstMedal };
}

/** Rep level 1 to 20 from the total Rep (`progression.repThresholds`). */
export function repLevel(cfg: RacingConfig['progression'], rep: number): number {
  let lv = 1;
  for (let i = 0; i < cfg.repThresholds.length; i++) if (rep >= (cfg.repThresholds[i] as number)) lv = i + 1;
  return lv;
}

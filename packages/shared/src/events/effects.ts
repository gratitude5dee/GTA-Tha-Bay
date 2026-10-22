/** Effects and follow-ups (08-tycoon-events.md sections 4 and 5). */
import { sampleDist } from './dist.ts';
import { ctrFloat } from './rng.ts';
import {
  EFFECT_LIMITS,
  MAX_CHAIN_DEPTH,
  MUL_MAX,
  MUL_MIN,
  isModifierMetric,
  type EffectSpec,
  type EventHost,
  type EventState,
  type EventTotals,
  type FollowUp,
} from './types.ts';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Strength of an effect at `week` (section 4): 1, `1 - t/D`, or `s <- s * (1 - 2/D)` once per elapsed week. Pure in `week`. */
export function strengthAt(e: { spec: EffectSpec; startWeek: number; endWeek: number }, week: number): number {
  if (e.spec.k !== 'metric') return 1;
  const D = Math.max(1, e.endWeek - e.startWeek);
  const t = Math.max(0, week - e.startWeek);
  if (e.spec.decay === 'none') return 1;
  if (e.spec.decay === 'linear') return Math.max(0, 1 - t / D);
  let s = 1;
  const f = 1 - 2 / D;
  for (let i = 0; i < t; i++) s = s * f;
  return Math.max(0, s);
}

/**
 * Applies a list of effects of instance `iid`. `kBase` keeps the distribution streams of different lists apart
 * (`evd:<iid>:<kBase + index>`). `capCashLoss` bounds a negative cash `add` by `EFFECT_LIMITS` (onFire effects only).
 */
export function applyEffects<S>(s: S, ev: EventState, host: EventHost<S>, iid: number, specs: readonly EffectSpec[] | undefined, kBase: number, capCashLoss: boolean): void {
  if (!specs) return;
  const week = host.week(s);
  const seed = host.seed(s);
  specs.forEach((spec, i) => {
    const stream = `evd:${iid}:${kBase + i}`;
    switch (spec.k) {
      case 'metric': {
        let v = sampleDist(spec.dist, seed, stream);
        if (isModifierMetric(spec.metric)) {
          ev.active.push({ eid: ev.nextEid++, iid, spec, sampled: v, startWeek: week, endWeek: week + Math.max(1, spec.durationWeeks), strength: 1 });
          return;
        }
        if (capCashLoss && spec.metric === 'cash' && spec.op === 'add' && v < 0) {
          const cash = host.metric(s, 'cash');
          const burn = host.metric(s, 'burnWeek');
          const limit = Math.max(EFFECT_LIMITS.cashLossFrac * Math.max(0, cash), EFFECT_LIMITS.cashLossBurnWeeks * Math.max(0, burn));
          v = -Math.min(-v, Math.floor(limit));
        }
        host.applyStock(s, spec.metric, spec.op, v);
        return;
      }
      case 'flag':
        host.setFlag(s, spec.key, spec.value, week + spec.durationWeeks);
        return;
      case 'staff':
        host.applyStaff(s, spec, Math.max(0, Math.round(sampleDist(spec.count, seed, stream))));
        return;
      case 'round':
        host.applyRound(s, spec);
        return;
    }
  });
}

/** Rolls the follow-ups of a fired instance once (section 5.1); the survivors join `pending`. */
export function scheduleFollowUps<S>(s: S, ev: EventState, host: EventHost<S>, iid: number, fus: readonly FollowUp[] | undefined, depth: number, kBase: number): void {
  if (!fus || depth + 1 > MAX_CHAIN_DEPTH) return;
  const week = host.week(s);
  const seed = host.seed(s);
  fus.forEach((fu, i) => {
    const stream = `evf:${iid}:${kBase + i}`;
    if (ctrFloat(seed, stream, 0) >= fu.p) return;
    const span = fu.delayWeeks[1] - fu.delayWeeks[0] + 1;
    const delay = fu.delayWeeks[0] + Math.floor(ctrFloat(seed, stream, 1) * span);
    ev.pending.push({ dueWeek: week + delay, defId: fu.eventId, depth: depth + 1, fromIid: iid });
  });
}

/**
 * Drops finished effects, expires flags and returns the modifier totals of this week (section 4). Multipliers combine by product and
 * clamp to [0.2, 5]; adds combine by sum. Idempotent within a week.
 */
export function tickEffects<S>(s: S, ev: EventState, host: EventHost<S>): EventTotals {
  const week = host.week(s);
  host.expireFlags?.(s);
  ev.active = ev.active.filter((e) => e.endWeek > week);
  const mul: Record<string, number> = {};
  const add: Record<string, number> = {};
  for (const e of ev.active) {
    if (e.spec.k !== 'metric') continue;
    const st = strengthAt(e, week);
    e.strength = st;
    const m = e.spec.metric;
    if (e.spec.op === 'mul') mul[m] = (mul[m] ?? 1) * (1 + (e.sampled - 1) * st);
    else add[m] = (add[m] ?? 0) + e.sampled * st;
  }
  for (const k of Object.keys(mul)) mul[k] = clamp(mul[k] as number, MUL_MIN, MUL_MAX);
  const totals: EventTotals = { mul, add };
  ev.totals = totals;
  return totals;
}

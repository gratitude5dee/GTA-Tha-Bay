/** A small host for the engine tests: a bag of numbers and flags, a week counter and a seed. Not part of the shipped code. */
import { emptyEventState, type EffectSpec, type EventDef, type EventHost, type EventState, type MetricId, type MetricOrDerived } from '../types.ts';

export interface FixtureState {
  seed: number;
  week: number;
  startWeekOfYear: number;
  metrics: Record<string, number>;
  flags: Record<string, number | boolean>;
  until: Record<string, number>;
  ev: EventState;
  staff: { op: string; role: string | undefined; n: number }[];
  rounds: string[];
  stockLog: { id: string; op: string; v: number }[];
}

export function newFixtureState(seed = 1, metrics: Record<string, number> = {}): FixtureState {
  return {
    seed,
    week: 0,
    startWeekOfYear: 0,
    metrics: { cash: 100_000_000, users: 1000, hype: 30, reputation: 50, morale: 60, founderMorale: 60, techDebt: 20, climate: 0, burnWeek: 100_000, ...metrics },
    flags: {},
    until: {},
    ev: emptyEventState(),
    staff: [],
    rounds: [],
    stockLog: [],
  };
}

const LIMITS: Partial<Record<MetricId, [number, number]>> = {
  hype: [0, 100], reputation: [0, 100], morale: [0, 100], founderMorale: [0, 100], techDebt: [0, 100], climate: [-1, 1], users: [0, 1_000_000],
};

export const fixtureHost: EventHost<FixtureState> = {
  metric: (s, id: MetricOrDerived) => s.metrics[id] ?? 0,
  flag: (s, key) => s.flags[key],
  applyStock(s, id, op, v) {
    s.stockLog.push({ id, op, v });
    const cur = s.metrics[id] ?? 0;
    let next = op === 'mul' ? cur * v : cur + v;
    const lim = LIMITS[id];
    if (lim) next = Math.min(lim[1], Math.max(lim[0], next));
    s.metrics[id] = next;
  },
  applyStaff(s, e: Extract<EffectSpec, { k: 'staff' }>, n) {
    s.staff.push({ op: e.op, role: e.role, n });
  },
  applyRound(s, e) {
    s.rounds.push(e.op);
  },
  setFlag(s, key, v, untilWeek) {
    s.flags[key] = v;
    s.until[key] = untilWeek;
  },
  expireFlags(s) {
    for (const k of Object.keys(s.until)) {
      if ((s.until[k] as number) <= s.week) {
        delete s.until[k];
        delete s.flags[k];
      }
    }
  },
  seed: (s) => s.seed,
  week: (s) => s.week,
  startWeekOfYear: (s) => s.startWeekOfYear,
};

/** A def with neutral defaults; tests override what they need. */
export function def(id: string, over: Partial<EventDef> = {}): EventDef {
  return { id, family: 'business', scope: 'tycoon', mtthWeeks: 40, modifiers: [], requires: [], cooldownWeeks: 0, severity: 1, ...over };
}

/**
 * Types of the shared random-event engine (08-tycoon-events.md section 2, verbatim) plus additive members, each recorded as a
 * `BD-M09a2-*` row in `spec/11-decision-log-builder.md`: `EventDef.disabled`, `EventState.totals`, `EventHost.hazardMul` and
 * `expireFlags`, and the derived metric `burnWeek`.
 */
export type EventFamily = 'business' | 'political' | 'natural' | 'cultural' | 'market' | 'system';
export type MetricId =
  | 'cash' | 'users' | 'hype' | 'reputation' | 'morale' | 'founderMorale' | 'techDebt' | 'climate' // stocks: applied once
  | 'cacMul' | 'churnMul' | 'arpuMul' | 'payRateMul' | 'devPowerMul' | 'burnMul' | 'multipleMul' | 'wageMul'; // modifiers: applied each week while active
export type Dist =
  | { k: 'fixed'; v: number }
  | { k: 'uniform'; lo: number; hi: number }
  | { k: 'normal'; mu: number; sigma: number; clamp: [number, number] } // Irwin-Hall(12): sum of 12 uniforms - 6; exact ops only
  | { k: 'lognormal'; mu: number; sigma: number; clamp: [number, number] }; // exp via detmath.exp
export type MetricOrDerived = MetricId | 'arr' | 'runwayWeeks' | 'headcount' | 'week' | 'productQuality' | 'valuationRef' | 'founderControl' | 'burnWeek' | `sector:${string}`;
export type Predicate =
  | { m: MetricOrDerived; op: '<' | '<=' | '>' | '>=' | '=='; v: number }
  | { flag: string; eq?: number | boolean } // eq omitted = flag set
  | { season: [fromWeekOfYear: number, toWeekOfYear: number] } // wraps year end
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };
export type EffectSpec =
  | { k: 'metric'; metric: MetricId; op: 'mul' | 'add'; dist: Dist; durationWeeks: number; decay: 'none' | 'linear' | 'geometric' }
  | { k: 'flag'; key: string; value: number | boolean; durationWeeks: number }
  | { k: 'staff'; op: 'poach' | 'quit' | 'inject'; role?: 'eng' | 'design' | 'growth' | 'sales' | 'ops'; count: Dist }
  | { k: 'round'; op: 'withdrawOffers' | 'cutTerms'; frac?: number }; // used by finance chains (part B section 9)
export interface FollowUp {
  eventId: string;
  delayWeeks: [number, number];
  p: number;
}
export interface EventChoice {
  id: string;
  cost?: EffectSpec[];
  effects: EffectSpec[];
  followUps?: FollowUp[];
  tags?: ('legacy' | 'risky')[];
  requires?: Predicate[];
}
export interface EventDef {
  id: string;
  family: EventFamily;
  scope: 'tycoon' | 'business' | 'both';
  /** Mean time to happen at factor 1, in weeks. 0 = never rolled (chain and system events). */
  mtthWeeks: number;
  modifiers: { when: Predicate; factor: number }[]; // multiplicative on the hazard rate
  requires: Predicate[];
  minWeek?: number;
  cooldownWeeks: number;
  exclusiveGroup?: string;
  severity: 1 | 2 | 3 | 4 | 5;
  onFire?: EffectSpec[];
  followUps?: FollowUp[]; // applied when it fires, before any choice
  choices?: EventChoice[];
  defaultChoiceId?: string; // present = a choice event (pauses unless auto-resolved)
  art?: string; /* C07 AssetRef `ui/ty-card-<id>` */
  /** BD-M09a2-01: a disabled def is validated but never rolled and never scheduled. */
  disabled?: boolean;
}
export interface EventInstance {
  iid: number;
  defId: string;
  firedWeek: number;
  chainDepth: number;
  origin: 'roll' | 'chain' | 'system';
  deadlineWeek?: number;
}
export interface ActiveEffect {
  eid: number;
  iid: number;
  spec: EffectSpec;
  sampled: number;
  startWeek: number;
  endWeek: number;
  strength: number;
}
export interface EventTotals {
  mul: Record<string, number>;
  add: Record<string, number>;
}
export interface EventState {
  nextIid: number;
  nextEid: number;
  inbox: EventInstance[];
  pending: { dueWeek: number; defId: string; depth: number; fromIid: number }[];
  active: ActiveEffect[];
  cooldownUntil: Record<string, number>;
  counts: Record<string, number>;
  /** BD-M09a2-02: modifier totals of the current week, written by `tickEffects` (absent = neutral). */
  totals?: EventTotals;
}
export interface EventHost<S> {
  // each domain adapts its state
  metric(s: S, id: MetricOrDerived): number;
  flag(s: S, key: string): number | boolean | undefined;
  applyStock(s: S, id: MetricId, op: 'mul' | 'add', v: number): void;
  applyStaff(s: S, e: Extract<EffectSpec, { k: 'staff' }>, sampled: number): void;
  applyRound(s: S, e: Extract<EffectSpec, { k: 'round' }>): void;
  setFlag(s: S, key: string, v: number | boolean, untilWeek: number): void;
  seed(s: S): number;
  week(s: S): number;
  startWeekOfYear(s: S): number;
  /** Multiplier on every hazard rate (hardcore runs); 1 when absent. */
  hazardMul?(s: S): number;
  /** Clears flags whose `untilWeek` has passed; called once a week by `tickEffects`. */
  expireFlags?(s: S): void;
}
export interface EventEngine<S> {
  roll(s: S, ev: EventState, defs: readonly EventDef[], host: EventHost<S>): EventInstance[]; // once per week
  choose(s: S, ev: EventState, iid: number, choiceId: string, defs: readonly EventDef[], host: EventHost<S>): void;
  autoResolve(s: S, ev: EventState, defs: readonly EventDef[], host: EventHost<S>): void; // inbox items past deadline
  tickEffects(s: S, ev: EventState, host: EventHost<S>): { mul: Record<string, number>; add: Record<string, number> }; // modifier totals this week
}

export const MAX_NEW_EVENTS_PER_WEEK = 2;
export const SEVERE_GAP_WEEKS = 8;
export const CHOICE_DEADLINE_WEEKS = 2;
export const MAX_CHAIN_DEPTH = 4;
export const FACTOR_MIN = 0.1;
export const FACTOR_MAX = 8;
export const MUL_MIN = 0.2;
export const MUL_MAX = 5;
/** Key of `cooldownUntil` that holds the end of the severity-4+ gap. */
export const SEVERE_KEY = '*severe';

export const STOCK_METRICS: readonly MetricId[] = ['cash', 'users', 'hype', 'reputation', 'morale', 'founderMorale', 'techDebt', 'climate'];
export const MODIFIER_METRICS: readonly MetricId[] = ['cacMul', 'churnMul', 'arpuMul', 'payRateMul', 'devPowerMul', 'burnMul', 'multipleMul', 'wageMul'];
export const isModifierMetric = (m: MetricId): boolean => MODIFIER_METRICS.includes(m);

/**
 * Bounds of one event's cash loss (section 5.3): at runtime at most 40 % of current cash or 12 weeks of burn, whichever is larger;
 * `staticLossCents` is the load-time bound on the smallest value an `onFire` cash effect can sample.
 */
export const EFFECT_LIMITS = { cashLossFrac: 0.4, cashLossBurnWeeks: 12, staticLossCents: 50_000_000 } as const;

export function emptyEventState(): EventState {
  return { nextIid: 1, nextEid: 1, inbox: [], pending: [], active: [], cooldownUntil: {}, counts: {} };
}

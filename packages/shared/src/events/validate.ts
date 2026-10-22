/**
 * Content validator of the event catalog (08-tycoon-events.md section 5.5). Pure: the caller passes the locale and the asset
 * lookups. Each problem carries a rule id; errors fail the load, warnings do not.
 */
import { distBounds } from './dist.ts';
import { EFFECT_LIMITS, MAX_CHAIN_DEPTH, type Dist, type EffectSpec, type EventDef, type FollowUp, type Predicate } from './types.ts';

export type EventRule =
  | 'dup-id'
  | 'bad-field'
  | 'unknown-followup'
  | 'chain-cycle'
  | 'missing-lockey'
  | 'cash-limit'
  | 'bad-default'
  | 'bad-dist'
  | 'bad-predicate'
  | 'art-unresolved';

export interface EventIssue {
  rule: EventRule;
  id: string;
  detail: string;
}
export interface EventValidation {
  errors: EventIssue[];
  warnings: EventIssue[];
}
export interface ValidateOptions {
  hasKey(key: string): boolean;
  /** Absent = art refs are not checked. Unresolved refs are warnings until M09b1. */
  hasArt?(ref: string): boolean;
}

export const titleKey = (id: string): string => `tycoon.events.${id}.title`;
export const bodyKey = (id: string): string => `tycoon.events.${id}.body`;
export const choiceKey = (id: string, choiceId: string): string => `tycoon.events.${id}.c.${choiceId}`;

/** Every LocKey a def needs. */
export function eventKeys(d: EventDef): string[] {
  const keys = [titleKey(d.id), bodyKey(d.id)];
  for (const c of d.choices ?? []) keys.push(choiceKey(d.id, c.id));
  return keys;
}

const METRICS = new Set([
  'cash', 'users', 'hype', 'reputation', 'morale', 'founderMorale', 'techDebt', 'climate',
  'cacMul', 'churnMul', 'arpuMul', 'payRateMul', 'devPowerMul', 'burnMul', 'multipleMul', 'wageMul',
  'arr', 'runwayWeeks', 'headcount', 'week', 'productQuality', 'valuationRef', 'founderControl', 'burnWeek',
]);

function distOk(d: Dist): boolean {
  if (typeof d !== 'object' || d === null) return false;
  switch (d.k) {
    case 'fixed':
      return Number.isFinite(d.v);
    case 'uniform':
      return Number.isFinite(d.lo) && Number.isFinite(d.hi) && d.lo <= d.hi;
    case 'normal':
    case 'lognormal':
      return Number.isFinite(d.mu) && Number.isFinite(d.sigma) && d.sigma >= 0 && Array.isArray(d.clamp) && d.clamp.length === 2 && d.clamp[0] <= d.clamp[1];
    default:
      return false;
  }
}

function predicateOk(p: Predicate): boolean {
  if (typeof p !== 'object' || p === null) return false;
  if ('m' in p) return (METRICS.has(p.m) || p.m.startsWith('sector:')) && ['<', '<=', '>', '>=', '=='].includes(p.op) && Number.isFinite(p.v);
  if ('flag' in p) return typeof p.flag === 'string' && p.flag !== '';
  if ('season' in p) return Array.isArray(p.season) && p.season.length === 2 && p.season.every((n) => Number.isInteger(n) && n >= 1 && n <= 52);
  if ('all' in p) return Array.isArray(p.all) && p.all.every(predicateOk);
  if ('any' in p) return Array.isArray(p.any) && p.any.every(predicateOk);
  if ('not' in p) return predicateOk(p.not);
  return false;
}

function followUpTargets(d: EventDef): FollowUp[] {
  const out: FollowUp[] = [...(d.followUps ?? [])];
  for (const c of d.choices ?? []) out.push(...(c.followUps ?? []));
  return out;
}

export function validateEvents(defs: readonly EventDef[], opts: ValidateOptions): EventValidation {
  const errors: EventIssue[] = [];
  const warnings: EventIssue[] = [];
  const err = (rule: EventRule, id: string, detail: string): void => void errors.push({ rule, id, detail });
  const byId = new Map<string, EventDef>();
  for (const d of defs) {
    if (byId.has(d.id)) err('dup-id', d.id, 'id is not unique');
    byId.set(d.id, d);
  }

  for (const d of defs) {
    if (!/^[a-z]+\.[a-z0-9_]+$/.test(d.id)) err('bad-field', d.id, 'id must look like family.name');
    if (!Number.isFinite(d.mtthWeeks) || d.mtthWeeks < 0) err('bad-field', d.id, 'mtthWeeks must be >= 0');
    if (![1, 2, 3, 4, 5].includes(d.severity)) err('bad-field', d.id, 'severity must be 1..5');
    if (!Number.isInteger(d.cooldownWeeks) || d.cooldownWeeks < 0) err('bad-field', d.id, 'cooldownWeeks must be an integer >= 0');
    for (const m of d.modifiers) {
      if (!(m.factor > 0) || !predicateOk(m.when)) err('bad-predicate', d.id, 'modifier needs factor > 0 and a valid predicate');
    }
    for (const p of d.requires) if (!predicateOk(p)) err('bad-predicate', d.id, 'invalid requires predicate');

    // follow-ups
    for (const fu of followUpTargets(d)) {
      if (!byId.has(fu.eventId)) err('unknown-followup', d.id, `follow-up ${fu.eventId} does not exist`);
      if (!(fu.p >= 0 && fu.p <= 1) || fu.delayWeeks[0] > fu.delayWeeks[1] || fu.delayWeeks[0] < 0) err('bad-field', d.id, `follow-up ${fu.eventId} has a bad p or delay`);
    }

    // effects
    const lists: [string, readonly EffectSpec[] | undefined][] = [['onFire', d.onFire]];
    for (const c of d.choices ?? []) {
      lists.push([`${c.id}.cost`, c.cost]);
      lists.push([`${c.id}.effects`, c.effects]);
      for (const p of c.requires ?? []) if (!predicateOk(p)) err('bad-predicate', d.id, `choice ${c.id} has an invalid requires predicate`);
    }
    for (const [where, list] of lists) {
      for (const e of list ?? []) {
        if (e.k === 'metric') {
          if (!distOk(e.dist)) err('bad-dist', d.id, `${where}: invalid distribution`);
          else if (where === 'onFire' && e.metric === 'cash' && e.op === 'add' && distBounds(e.dist)[0] < -EFFECT_LIMITS.staticLossCents) {
            err('cash-limit', d.id, `onFire cash loss ${distBounds(e.dist)[0]} exceeds EFFECT_LIMITS (${EFFECT_LIMITS.staticLossCents})`);
          }
          if (!Number.isInteger(e.durationWeeks) || e.durationWeeks < 0) err('bad-field', d.id, `${where}: durationWeeks`);
        } else if (e.k === 'staff') {
          if (!distOk(e.count)) err('bad-dist', d.id, `${where}: invalid staff count`);
        }
      }
    }

    // choices
    if (d.choices && d.choices.length > 0) {
      const def = d.choices.find((c) => c.id === d.defaultChoiceId);
      if (!def) err('bad-default', d.id, 'a choice event needs a defaultChoiceId that names one of its choices');
      else if ((def.requires ?? []).length > 0) err('bad-default', d.id, 'the default choice must always be available');
    } else if (d.defaultChoiceId !== undefined) err('bad-default', d.id, 'defaultChoiceId without choices');

    // strings and art
    for (const k of eventKeys(d)) if (!opts.hasKey(k)) err('missing-lockey', d.id, `missing LocKey ${k}`);
    if (d.art !== undefined && opts.hasArt && !opts.hasArt(d.art)) warnings.push({ rule: 'art-unresolved', id: d.id, detail: `art ${d.art} is not in the asset catalog` });
  }

  // chain cycles without a cooldown anywhere on the cycle
  const state = new Map<string, number>(); // 1 = on stack, 2 = done
  const stack: string[] = [];
  const visit = (id: string): void => {
    state.set(id, 1);
    stack.push(id);
    const d = byId.get(id);
    for (const fu of d ? followUpTargets(d) : []) {
      if (!byId.has(fu.eventId)) continue;
      const st = state.get(fu.eventId);
      if (st === 1) {
        const cycle = stack.slice(stack.indexOf(fu.eventId));
        if (!cycle.some((n) => (byId.get(n)?.cooldownWeeks ?? 0) > 0)) err('chain-cycle', fu.eventId, `cycle ${cycle.join(' -> ')} -> ${fu.eventId} has no cooldown (chain depth limit ${MAX_CHAIN_DEPTH})`);
      } else if (st === undefined) visit(fu.eventId);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const d of [...defs].sort((a, b) => (a.id < b.id ? -1 : 1))) if (!state.has(d.id)) visit(d.id);

  return { errors, warnings };
}

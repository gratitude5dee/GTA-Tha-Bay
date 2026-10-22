/**
 * The event engine (08-tycoon-events.md sections 3 to 5): hazard rolls on counter draws, severity-ordered weekly cap, chains,
 * choice events with a deadline. Generic over the host state `S`; knows nothing about cap tables or the UI.
 */
import { detmath } from '../detmath.ts';
import { applyEffects, scheduleFollowUps, tickEffects } from './effects.ts';
import { allHold, evalPredicate } from './predicate.ts';
import { ctrFloat } from './rng.ts';
import {
  CHOICE_DEADLINE_WEEKS,
  FACTOR_MAX,
  FACTOR_MIN,
  MAX_NEW_EVENTS_PER_WEEK,
  SEVERE_GAP_WEEKS,
  SEVERE_KEY,
  type EventChoice,
  type EventDef,
  type EventEngine,
  type EventHost,
  type EventInstance,
  type EventState,
} from './types.ts';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Fire probability of one week: `p = 1 - exp(-factor / mtth)` (section 3, step 2). */
export const hazardP = (factor: number, mtthWeeks: number): number => 1 - detmath.exp(-(factor / mtthWeeks));

/** Product of the modifier factors whose predicate holds, clamped to [0.1, 8]. */
export function hazardFactor<S>(def: EventDef, s: S, host: EventHost<S>): number {
  let f = 1;
  for (const m of def.modifiers) if (evalPredicate(m.when, s, host)) f = f * m.factor;
  return clamp(f, FACTOR_MIN, FACTOR_MAX);
}

const groupKey = (g: string): string => `grp:${g}`;

function groupBusy(ev: EventState, defs: ReadonlyMap<string, EventDef>, def: EventDef, week: number): boolean {
  const g = def.exclusiveGroup;
  if (g === undefined) return false;
  if ((ev.cooldownUntil[groupKey(g)] ?? 0) > week) return true;
  for (const i of ev.inbox) if (defs.get(i.defId)?.exclusiveGroup === g) return true;
  return false;
}

interface Candidate {
  def: EventDef;
  depth: number;
  origin: 'roll' | 'chain';
}

function fire<S>(s: S, ev: EventState, host: EventHost<S>, c: Candidate): EventInstance {
  const week = host.week(s);
  const { def } = c;
  const inst: EventInstance = { iid: ev.nextIid++, defId: def.id, firedWeek: week, chainDepth: c.depth, origin: c.origin };
  ev.counts[def.id] = (ev.counts[def.id] ?? 0) + 1;
  ev.cooldownUntil[def.id] = week + def.cooldownWeeks;
  if (def.severity >= 4) ev.cooldownUntil[SEVERE_KEY] = week + SEVERE_GAP_WEEKS;
  if (def.exclusiveGroup !== undefined) ev.cooldownUntil[groupKey(def.exclusiveGroup)] = week + Math.max(1, def.cooldownWeeks);
  applyEffects(s, ev, host, inst.iid, def.onFire, 0, true);
  scheduleFollowUps(s, ev, host, inst.iid, def.followUps, c.depth, 50);
  if (def.choices && def.choices.length > 0) {
    inst.deadlineWeek = week + CHOICE_DEADLINE_WEEKS;
    ev.inbox.push(inst);
  }
  return inst;
}

/** Once a week: pending chain events that are due, then the hazard roll of every eligible def; returns the instances that fired. */
export function roll<S>(s: S, ev: EventState, defList: readonly EventDef[], host: EventHost<S>): EventInstance[] {
  const week = host.week(s);
  const seed = host.seed(s);
  const defs = new Map<string, EventDef>();
  for (const d of defList) defs.set(d.id, d);
  const cands: Candidate[] = [];

  // chain events that are due (they ignore the MTTH roll and the cooldown)
  const keep: EventState['pending'] = [];
  const due: { p: EventState['pending'][number]; i: number }[] = [];
  ev.pending.forEach((p, i) => {
    if (p.dueWeek <= week) due.push({ p, i });
    else keep.push(p);
  });
  ev.pending = keep;
  due.sort((a, b) => a.p.dueWeek - b.p.dueWeek || a.i - b.i);
  for (const { p } of due) {
    const def = defs.get(p.defId);
    if (!def || def.disabled === true) continue;
    if (!allHold(def.requires, s, host) || groupBusy(ev, defs, def, week)) continue;
    if (cands.some((c) => c.def.id === def.id)) continue;
    cands.push({ def, depth: p.depth, origin: 'chain' });
  }

  // hazard rolls, ascending id
  const rate = host.hazardMul ? host.hazardMul(s) : 1;
  const sorted = [...defList].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const def of sorted) {
    if (def.disabled === true || def.mtthWeeks <= 0) continue;
    if (week < (def.minWeek ?? 0) || (ev.cooldownUntil[def.id] ?? 0) > week) continue;
    if (!allHold(def.requires, s, host) || groupBusy(ev, defs, def, week)) continue;
    const factor = hazardFactor(def, s, host);
    const p = hazardP(factor * rate, def.mtthWeeks);
    if (ctrFloat(seed, `ev:${def.id}`, week) < p && !cands.some((c) => c.def.id === def.id)) cands.push({ def, depth: 0, origin: 'roll' });
  }

  // weekly cap: highest severity first, ties by id; one severity 4+ event per SEVERE_GAP_WEEKS
  cands.sort((a, b) => b.def.severity - a.def.severity || (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0));
  const fired: EventInstance[] = [];
  const chosenGroups = new Set<string>();
  for (const c of cands) {
    const severe = c.def.severity >= 4;
    const g = c.def.exclusiveGroup;
    const blocked =
      fired.length >= MAX_NEW_EVENTS_PER_WEEK ||
      (severe && (ev.cooldownUntil[SEVERE_KEY] ?? 0) > week) ||
      (g !== undefined && chosenGroups.has(g));
    if (blocked) {
      ev.counts['suppressed'] = (ev.counts['suppressed'] ?? 0) + 1;
      continue;
    }
    if (g !== undefined) chosenGroups.add(g);
    fired.push(fire(s, ev, host, c));
  }
  return fired;
}

/** True when the choice may be taken now (its `requires` hold). */
export function choiceAllowed<S>(c: EventChoice, s: S, host: EventHost<S>): boolean {
  return allHold(c.requires, s, host);
}

export function choose<S>(s: S, ev: EventState, iid: number, choiceId: string, defList: readonly EventDef[], host: EventHost<S>): void {
  const at = ev.inbox.findIndex((i) => i.iid === iid);
  if (at < 0) throw new Error(`events: no inbox item ${iid}`);
  const inst = ev.inbox[at] as EventInstance;
  const def = defList.find((d) => d.id === inst.defId);
  const choice = def?.choices?.find((c) => c.id === choiceId);
  if (!def || !choice) throw new Error(`events: ${inst.defId} has no choice ${choiceId}`);
  ev.inbox.splice(at, 1);
  applyEffects(s, ev, host, iid, choice.cost, 100, false);
  applyEffects(s, ev, host, iid, choice.effects, 200, false);
  scheduleFollowUps(s, ev, host, iid, choice.followUps, inst.chainDepth, 300);
  ev.counts[`${def.id}.c.${choiceId}`] = (ev.counts[`${def.id}.c.${choiceId}`] ?? 0) + 1;
}

/** Takes `defaultChoiceId` for every inbox item whose deadline has come. */
export function autoResolve<S>(s: S, ev: EventState, defList: readonly EventDef[], host: EventHost<S>): void {
  const week = host.week(s);
  for (const inst of [...ev.inbox]) {
    if (inst.deadlineWeek === undefined || inst.deadlineWeek > week) continue;
    const def = defList.find((d) => d.id === inst.defId);
    if (def?.defaultChoiceId === undefined) continue;
    choose(s, ev, inst.iid, def.defaultChoiceId, defList, host);
  }
}

export function createEventEngine<S>(): EventEngine<S> {
  return { roll, choose, autoResolve, tickEffects };
}

export { tickEffects };

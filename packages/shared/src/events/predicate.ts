/** Predicate evaluator (08-tycoon-events.md section 2). */
import type { EventHost, Predicate } from './types.ts';

const cmp = (a: number, op: '<' | '<=' | '>' | '>=' | '==', b: number): boolean => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b);

/** True when `week` (1..52) lies in the season; `[from, to]` wraps the year end when `from > to`. */
export const inSeason = (week: number, from: number, to: number): boolean => (from <= to ? week >= from && week <= to : week >= from || week <= to);

export function evalPredicate<S>(p: Predicate, s: S, host: EventHost<S>): boolean {
  if ('m' in p) return cmp(host.metric(s, p.m), p.op, p.v);
  if ('flag' in p) {
    const f = host.flag(s, p.flag);
    if (p.eq === undefined) return f !== undefined && f !== false && f !== 0;
    if (f === undefined) return p.eq === false || p.eq === 0;
    if (typeof p.eq === 'boolean') return typeof f === 'boolean' ? f === p.eq : (f !== 0) === p.eq;
    return f === p.eq;
  }
  if ('season' in p) {
    const woy = ((((host.startWeekOfYear(s) + host.week(s)) % 52) + 52) % 52) + 1;
    return inSeason(woy, p.season[0], p.season[1]);
  }
  if ('all' in p) {
    for (const q of p.all) if (!evalPredicate(q, s, host)) return false;
    return true;
  }
  if ('any' in p) {
    for (const q of p.any) if (evalPredicate(q, s, host)) return true;
    return false;
  }
  return !evalPredicate(p.not, s, host);
}

export function allHold<S>(ps: readonly Predicate[] | undefined, s: S, host: EventHost<S>): boolean {
  if (ps === undefined) return true;
  for (const p of ps) if (!evalPredicate(p, s, host)) return false;
  return true;
}

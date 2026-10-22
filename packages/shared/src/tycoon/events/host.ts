/**
 * `TycoonEventHost`: maps the engine's metrics, flags, staff and round effects onto `CompanyState` (08-tycoon-events.md section 2
 * and 4). Built per content because some mappings need the sector and the balance.
 *
 * Derived flags read by predicates (BD-M09a2-04): `hasSales`, `termSheetOpen` (an offer on the table), `termSheetClosing`
 * (an accepted round that has not closed), `cashNegative`. Flags set by effects live in `CompanyState.flags` together with
 * `until.<key>` (the week they expire).
 */
import { ctrU32 } from '../../rng.ts';
import { clamp, headcount, netBurnWeek, roleCount, runwayWeeks, sectorOf, valuationRef } from '../company.ts';
import { removeEmployee, syncMorale } from '../people.ts';
import type { EffectSpec, EventHost, MetricId, MetricOrDerived } from '../../events/types.ts';
import { MODIFIER_METRICS } from '../../events/types.ts';
import type { CompanyState, Employee, TycoonContent } from '../types.ts';

const UNTIL = 'until.';

export function createTycoonHost(c: TycoonContent): EventHost<CompanyState> {
  return {
    metric(s, id: MetricOrDerived): number {
      switch (id) {
        case 'cash': return s.cash;
        case 'users': return s.users;
        case 'hype': return s.hype;
        case 'reputation': return s.reputation;
        case 'morale': return s.morale;
        case 'founderMorale': return s.founderMorale;
        case 'techDebt': return s.techDebt;
        case 'climate': return s.climate;
        case 'arr': return 12 * s.mrr;
        case 'runwayWeeks': return runwayWeeks(s, c);
        case 'headcount': return headcount(s);
        case 'week': return s.week;
        case 'productQuality': return s.productQuality;
        case 'valuationRef': return valuationRef(s, c);
        case 'founderControl': return s.board.founderControl ? 1 : 0;
        case 'burnWeek': return Math.max(0, netBurnWeek(s, c));
        default:
          if (id.startsWith('sector:')) return s.setup.sector === id.slice(7) ? 1 : 0;
          if ((MODIFIER_METRICS as readonly string[]).includes(id)) return s.events.totals?.mul[id] ?? 1;
          return 0;
      }
    },
    flag(s, key) {
      switch (key) {
        case 'hasSales': return roleCount(s.team, 'sales') > 0;
        case 'termSheetOpen': return s.meetings.some((m) => m.phase === 'offer');
        case 'termSheetClosing': return s.meetings.some((m) => m.phase === 'closing');
        case 'cashNegative': return s.cash < 0;
        default: return s.flags[key];
      }
    },
    applyStock(s, id: MetricId, op, v) {
      const set = (cur: number): number => (op === 'mul' ? cur * v : cur + v);
      switch (id) {
        case 'cash': s.cash = Math.round(set(s.cash)); return;
        case 'users': s.users = clamp(set(s.users), 0, sectorOf(s, c).tam); return;
        case 'hype': s.hype = clamp(set(s.hype), 0, 100); return;
        case 'reputation': s.reputation = clamp(set(s.reputation), 0, 100); return;
        case 'techDebt': s.techDebt = clamp(set(s.techDebt), 0, 100); return;
        case 'founderMorale': s.founderMorale = clamp(set(s.founderMorale), 0, 100); s.morale = syncMorale(s); return;
        case 'climate': s.climate = clamp(set(s.climate), -1, 1); return;
        case 'morale':
          if (s.team.length === 0) s.founderMorale = clamp(set(s.founderMorale), 0, 100);
          else for (const e of s.team) e.morale = clamp(set(e.morale), 0, 100);
          s.morale = syncMorale(s);
          return;
        default:
          return; // modifiers are active effects, never stocks
      }
    },
    applyStaff(s, e: Extract<EffectSpec, { k: 'staff' }>, n) {
      for (let i = 0; i < n; i++) {
        if (e.op === 'inject') {
          const role = e.role ?? 'eng';
          const id = `ev-e${s.week}-${i}-${s.team.length}`;
          const emp: Employee = { id, role, skill: 5, salaryYr: c.archetypes.roleBaseYrCents[role], optionShares: 0, hiredWeek: s.week, morale: c.balance.setup.teamMorale, name: 'Guest Hire' };
          if (s.team.length < c.balance.sim.maxEmployees) s.team.push(emp);
          continue;
        }
        const pool = s.team.filter((x) => e.role === undefined || x.role === e.role);
        if (pool.length === 0) return;
        let pick: Employee;
        if (e.op === 'poach') {
          pick = pool.reduce((a, b) => (b.skill > a.skill ? b : a));
        } else pick = pool[ctrU32(s.setup.seed, `evs:${s.week}:${i}`, 0) % pool.length] as Employee;
        removeEmployee(s, c, pick.id);
      }
      s.morale = syncMorale(s);
    },
    applyRound(s, e: Extract<EffectSpec, { k: 'round' }>) {
      if (e.op === 'cutTerms') {
        const frac = e.frac ?? 0.15;
        const m = s.meetings.find((x) => x.phase === 'closing') ?? s.meetings.find((x) => x.phase === 'offer');
        if (m?.offer) m.offer = { ...m.offer, preMoney: Math.round(m.offer.preMoney * (1 - frac)) };
        return;
      }
      for (const m of s.meetings) if (m.phase === 'offer' || m.phase === 'closing') m.phase = 'withdrawn';
      s.termSheets = [];
      if (s.awaiting === 'meeting') s.awaiting = null;
    },
    setFlag(s, key, v, untilWeek) {
      s.flags[key] = v;
      s.flags[UNTIL + key] = untilWeek;
    },
    expireFlags(s) {
      for (const k of Object.keys(s.flags)) {
        if (!k.startsWith(UNTIL)) continue;
        if ((s.flags[k] as number) <= s.week) {
          delete s.flags[k];
          delete s.flags[k.slice(UNTIL.length)];
        }
      }
    },
    seed: (s) => s.setup.seed,
    week: (s) => s.week,
    startWeekOfYear: (s) => s.setup.startWeekOfYear,
    hazardMul: (s) => (s.setup.hardcore ? c.balance.hardcore.eventMul : 1),
  };
}

const cache = new WeakMap<TycoonContent, EventHost<CompanyState>>();
/** One host per content object. */
export function hostFor(c: TycoonContent): EventHost<CompanyState> {
  let h = cache.get(c);
  if (!h) {
    h = createTycoonHost(c);
    cache.set(c, h);
  }
  return h;
}

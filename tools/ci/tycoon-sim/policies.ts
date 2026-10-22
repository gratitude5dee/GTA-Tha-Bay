/**
 * Bot policies of the Tycoon balance tool (08-tycoon-events.md section 8; P-9 "every system has a bot").
 *
 * A policy reads only `PolicyView` and emits only `Command`s, so a bot run goes through the same validation as the UI. The harness
 * calls `decide` repeatedly within a week until the company no longer waits for an answer and the policy has nothing more to say.
 * Random choices use a counter stream (`CtrRng`), never `Math.random`.
 */
import { ctrFloat } from '../../../packages/shared/src/events/rng.ts';
import type { Command, PolicyView, RoleId } from '../../../packages/shared/src/tycoon/index.ts';

/** A deterministic stream: the n-th draw is a pure function of `(seed, stream, n)`. */
export class CtrRng {
  private n = 0;
  constructor(private readonly seed: number, private readonly stream: string) {}
  next(): number {
    return ctrFloat(this.seed, this.stream, this.n++);
  }
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)] as T;
  }
}

export interface Policy {
  id: string;
  decide(view: PolicyView, rng: CtrRng): Command[];
}

const KINDS = ['safe', 'seed', 'a', 'b', 'c'] as const;
type Kind = (typeof KINDS)[number];

/** ARR (cents) at which a policy starts the raise for a stage. */
const STAGE_ARR: Record<Kind, number> = { safe: 0, seed: 25_000_000, a: 150_000_000, b: 800_000_000, c: 3_000_000_000 };
/** Smallest raise target (cents) per stage; the amount band of a fund is 0.6 to 1.25 of it. */
const STAGE_TARGET: Record<Kind, number> = { safe: 15_000_000, seed: 150_000_000, a: 800_000_000, b: 2_500_000_000, c: 6_000_000_000 };
const STAGE_MAX: Record<Kind, number> = { safe: 15_000_000, seed: 500_000_000, a: 2_500_000_000, b: 6_000_000_000, c: 9_600_000_000 };
/** The dilution a founder aims at per stage (the centre of the envelope's dilution band). */
const STAGE_DILUTION: Record<Kind, number> = { safe: 0, seed: 0.18, a: 0.2, b: 0.15, c: 0.09 };

/** The raise target for a stage: sized to the valuation so the round lands near the dilution the envelope centres on. */
export function raiseTarget(kind: Kind, valuationRef: number): number {
  const d = STAGE_DILUTION[kind];
  if (d === 0) return STAGE_TARGET[kind];
  const sized = Math.round((valuationRef * d) / (1 - d));
  return Math.min(STAGE_MAX[kind], Math.max(STAGE_TARGET[kind], sized));
}

function nextKind(v: PolicyView): Kind | null {
  if (v.closedRounds.length === 0) return v.safes === 0 ? 'safe' : 'seed';
  const last = v.closedRounds[v.closedRounds.length - 1] as Kind;
  const i = KINDS.indexOf(last);
  return i >= 0 && i < KINDS.length - 1 ? (KINDS[i + 1] as Kind) : null;
}

interface Template {
  id: string;
  alloc: [number, number, number];
  /** Share of the sustainable weekly budget spent on marketing. */
  marketing: number;
  /** Hire while the runway after the hire stays above this. */
  hireRunway: number;
  /** Start a raise when the runway falls below this. */
  raiseRunway: number;
  /** Also start a raise when ARR passes the stage trigger. */
  raiseOnArr: boolean;
  crunchWhenMvp: boolean;
  /** Sell or accept an offer at or above this valuation (cents). */
  sellAt: number;
  /** Hold the Series C until the valuation reaches this (cents) unless the runway is short: a round at a $1B post-money wins. */
  holdCUntil: number;
  eventStyle: 'safe' | 'risky' | 'frugal';
}

const ROLE_ORDER: RoleId[] = ['eng', 'eng', 'growth', 'sales', 'design', 'ops', 'eng', 'growth', 'sales', 'ops'];

/** The fixed table of safe choices (section 8, `median`). */
const SAFE_TABLE: Record<string, string> = {
  'biz.competitor_launch': 'hold',
  'biz.engineer_poached': 'counter',
  'biz.outage': 'postmortem',
  'biz.cloud_bill_spike': 'absorb',
  'biz.founder_burnout': 'rest_week',
  'biz.security_incident': 'disclose',
  'pol.payroll_tax': 'pay',
  'pol.ai_ordinance': 'wait',
  'pol.city_grant': 'apply',
  'nat.blackout': 'wait_it_out',
  'cul.endorsement': 'sign',
  'cul.meme_moment': 'let_it_ride',
  'vc.retrade': 'accept_cut',
};
const RISKY_TABLE: Record<string, string> = { ...SAFE_TABLE, 'biz.competitor_launch': 'match', 'cul.meme_moment': 'engage', 'biz.outage': 'shrug', 'biz.founder_burnout': 'push_on' };
const FRUGAL_TABLE: Record<string, string> = { ...SAFE_TABLE, 'cul.endorsement': 'decline', 'pol.payroll_tax': 'pay', 'biz.competitor_launch': 'hold', 'nat.blackout': 'wait_it_out' };

function answerEvents(v: PolicyView, t: Template): Command[] {
  const table = t.eventStyle === 'risky' ? RISKY_TABLE : t.eventStyle === 'frugal' ? FRUGAL_TABLE : SAFE_TABLE;
  const out: Command[] = [];
  for (const item of v.inbox) {
    let want = table[item.defId] ?? item.defaultChoiceId;
    if (item.defId === 'biz.acquisition_offer') want = v.valuationRef >= t.sellAt ? 'accept' : 'decline';
    const c = item.choices.find((x) => x.id === want && x.allowed);
    out.push({ t: 'resolveEvent', iid: item.iid, choiceId: c ? c.id : item.defaultChoiceId });
  }
  return out;
}

function pickVc(v: PolicyView, rawPool: readonly string[]): string | null {
  const r = v.raise;
  if (!r || rawPool.length === 0) return null;
  return rawPool[r.meetingsHeld % rawPool.length] ?? null;
}

function template(t: Template, vcInfo: (id: string) => { min: number; max: number; bias: number } | undefined): Policy {
  return {
    id: t.id,
    decide(v, rng): Command[] {
      void rng;
      if (v.phase === 'ended') return [];
      // 1. what the clock waits for
      if (v.awaiting === 'event') return answerEvents(v, t);
      if (v.awaiting === 'board') return [{ t: 'boardVote', motion: 'approveBudget' }];
      if (v.awaiting === 'bridge') return [{ t: 'bridge', accept: true }];
      if (v.awaiting === 'meeting') return v.meeting ? [{ t: 'accept', meetingId: v.meeting.id }] : [];
      const out: Command[] = [];
      if (v.inbox.length > 0) out.push(...answerEvents(v, t));

      // 2. the first week: the allocation starts the MVP
      if (v.phase === 'idea') return [{ t: 'setAllocation', features: t.alloc[0], refactor: t.alloc[1], infra: t.alloc[2] }];
      const launched = v.phase === 'launched';

      // 3. exits
      if (launched && v.canListPublic) return [{ t: 'goPublic' }];
      if (launched && v.canSell && v.valuationRef >= t.sellAt) return [{ t: 'exploreSale' }];

      // 4. founder and allocation
      if (v.founderMorale < 35 && v.focus !== 'rest') out.push({ t: 'setFocus', focus: 'rest' });
      else if (v.founderMorale > 70 && v.focus === 'rest') out.push({ t: 'setFocus', focus: 'product' });
      if (t.crunchWhenMvp) {
        const want = v.phase === 'mvp' && v.founderMorale > 50;
        if (want !== v.crunch) out.push({ t: 'setCrunch', on: want });
      }
      if (v.techDebt > 60 && v.allocation.refactor < 40) out.push({ t: 'setAllocation', features: 40, refactor: 45, infra: 15 });
      else if (v.techDebt < 35 && v.allocation.refactor >= 40) out.push({ t: 'setAllocation', features: t.alloc[0], refactor: t.alloc[1], infra: t.alloc[2] });

      // 5. marketing: a share of what the company can sustain
      if (launched) {
        const sustainable = Math.max(0, v.cash / Math.max(1, t.hireRunway) + v.revenueWeek - (v.expenseWeek - v.marketing));
        const cap = 2 * Math.max(v.cash / 8, (v.mrr * 12) / 52);
        const want = v.cash < 0 || v.runwayWeeks < 8 ? 0 : Math.floor(Math.min(cap, t.marketing * sustainable));
        if (Math.abs(want - v.marketing) > Math.max(2_000, 0.1 * v.marketing)) out.push({ t: 'setMarketing', perWeek: want });
      }

      // 6. raise
      const kind = nextKind(v);
      if (kind !== null && v.raise === null && v.raiseSpacingOk && !v.closing && v.meeting === null) {
        const arrOk = t.raiseOnArr && v.arr >= STAGE_ARR[kind] && (kind !== 'safe' || launched) && (kind !== 'c' || v.valuationRef >= t.holdCUntil);
        if (arrOk || v.runwayWeeks < t.raiseRunway) out.push({ t: 'startRaise', kind, targetCents: raiseTarget(kind, v.valuationRef) });
      }
      if (v.raise !== null && v.meeting === null && !v.closing) {
        const W = v.raise.targetCents;
        const pool = v.raise.vcPool.filter((id) => {
          const d = vcInfo(id);
          return d !== undefined && d.min <= W * 1.25 && d.max >= W * 0.6;
        }).sort((a, b) => (vcInfo(b)?.bias ?? 0) - (vcInfo(a)?.bias ?? 0) || (a < b ? -1 : 1));
        const vc = pickVc(v, pool);
        if (vc !== null) out.push({ t: 'scheduleMeeting', vcId: vc });
      }

      // 7. hiring
      if (v.offersPending === 0 && v.raise === null) {
        const hired = v.headcount - 1;
        const role = ROLE_ORDER[hired % ROLE_ORDER.length] as RoleId;
        const cands = v.market.filter((m) => m.role === role).sort((a, b) => b.skill / b.askYr - a.skill / a.askYr);
        const c = cands[0];
        if (c) {
          const burnAfter = v.expenseWeek - v.revenueWeek + c.askYr / 52;
          const runwayAfter = burnAfter <= 0 ? 999 : v.cash / burnAfter;
          if (runwayAfter >= t.hireRunway && v.cash > 0) out.push({ t: 'hireOffer', candidateId: c.id, salaryYr: c.askYr, optionBp: 30 });
        }
      }
      return out;
    },
  };
}

export type VcInfoFn = (id: string) => { min: number; max: number; bias: number } | undefined;

export const MEDIAN_TEMPLATE: Template = { id: 'median', alloc: [60, 25, 15], marketing: 0.35, hireRunway: 38, raiseRunway: 40, raiseOnArr: true, crunchWhenMvp: false, sellAt: 1_000_000_000_000, holdCUntil: 70_000_000_000, eventStyle: 'safe' };
export const AGGRESSIVE_TEMPLATE: Template = { id: 'aggressive', alloc: [85, 5, 10], marketing: 0.7, hireRunway: 35, raiseRunway: 60, raiseOnArr: true, crunchWhenMvp: true, sellAt: 1_000_000_000_000, holdCUntil: 70_000_000_000, eventStyle: 'risky' };
export const FRUGAL_TEMPLATE: Template = { id: 'frugal', alloc: [55, 30, 15], marketing: 0.35, hireRunway: 80, raiseRunway: 16, raiseOnArr: false, crunchWhenMvp: false, sellAt: 1_000_000_000_000, holdCUntil: 0, eventStyle: 'frugal' };

/** Uniform over legal commands, with an action chance of 0.25 per week; events are resolved by a uniform choice. */
function randomPolicy(vcInfo: VcInfoFn): Policy {
  return {
    id: 'random',
    decide(v, rng): Command[] {
      if (v.phase === 'ended') return [];
      if (v.awaiting === 'event') {
        return v.inbox.map((i) => ({ t: 'resolveEvent', iid: i.iid, choiceId: rng.pick(i.choices.filter((c) => c.allowed)).id }));
      }
      if (v.awaiting === 'board') return [{ t: 'boardVote', motion: rng.next() < 0.5 ? 'approveBudget' : 'ignore' }];
      if (v.awaiting === 'bridge') return [{ t: 'bridge', accept: rng.next() < 0.5 }];
      if (v.awaiting === 'meeting') return v.meeting ? [rng.next() < 0.5 ? { t: 'accept', meetingId: v.meeting.id } : { t: 'walk', meetingId: v.meeting.id }] : [];
      if (v.phase === 'idea') {
        const f = 40 + rng.int(41);
        const r = rng.int(100 - f + 1);
        return [{ t: 'setAllocation', features: f, refactor: r, infra: 100 - f - r }];
      }
      if (v.raise !== null && v.meeting === null && !v.closing && v.raise.vcPool.length > 0 && rng.next() < 0.5) {
        const pool = v.raise.vcPool.filter((id) => vcInfo(id) !== undefined);
        return [{ t: 'scheduleMeeting', vcId: rng.pick(pool) }];
      }
      if (rng.next() >= 0.25) return [];
      const launched = v.phase === 'launched';
      const choices: Command[] = [];
      const f = 30 + rng.int(61);
      const r = rng.int(100 - f + 1);
      choices.push({ t: 'setAllocation', features: f, refactor: r, infra: 100 - f - r });
      if (launched) choices.push({ t: 'setMarketing', perWeek: Math.floor(rng.next() * 400_000) });
      choices.push({ t: 'setPrice', level: rng.pick(['low', 'standard', 'premium'] as const) });
      choices.push({ t: 'setFocus', focus: rng.pick(['product', 'growth', 'rest'] as const) });
      choices.push({ t: 'setCrunch', on: rng.next() < 0.5 });
      const cand = v.market.length > 0 ? rng.pick(v.market) : undefined;
      if (cand) choices.push({ t: 'hireOffer', candidateId: cand.id, salaryYr: cand.askYr, optionBp: rng.int(100) });
      if (v.raise === null && v.raiseSpacingOk) {
        const k = rng.pick(KINDS);
        choices.push({ t: 'startRaise', kind: k, targetCents: STAGE_TARGET[k] });
      }
      if (v.canSell) choices.push({ t: 'exploreSale' });
      if (v.canListPublic) choices.push({ t: 'goPublic' });
      return [rng.pick(choices)];
    },
  };
}

/** The four shipped policies for a content set (the VC table is read from it). */
export function shippedPolicies(vcInfo: VcInfoFn): Record<string, Policy> {
  return {
    median: template(MEDIAN_TEMPLATE, vcInfo),
    aggressive: template(AGGRESSIVE_TEMPLATE, vcInfo),
    frugal: template(FRUGAL_TEMPLATE, vcInfo),
    random: randomPolicy(vcInfo),
  };
}

export const POLICY_IDS = ['median', 'aggressive', 'frugal', 'random'] as const;

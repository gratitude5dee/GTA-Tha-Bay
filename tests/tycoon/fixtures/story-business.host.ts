/**
 * The fixture host of the story-business proof (08-tycoon-events.md section 7, M09a2): a taqueria, a record shop or a co-working
 * space as `EventHost<BusinessState>`. The mapping is the one the spec gives; the real wiring is M05e1 in `@dv/mode-story`.
 *
 *   cash <-> till, users <-> weekly footfall, reputation <-> business reputation, morale <-> staff morale,
 *   arpuMul <-> ticket size, burnMul <-> cost multiplier, devPowerMul <-> output, flag officeClosed <-> shop closed.
 *   hype, techDebt, climate, multipleMul, wageMul, cacMul, churnMul, payRateMul, cap-table and round effects are no-ops.
 */
import {
  emptyEventState,
  type EffectSpec,
  type EventHost,
  type EventState,
  type MetricId,
  type MetricOrDerived,
} from '../../../packages/shared/src/events/index.ts';

export interface BusinessState {
  seed: number;
  week: number;
  till: number;
  footfall: number;
  reputation: number;
  staffMorale: number;
  staff: number;
  shopClosed: boolean;
  /** Modifier totals the shop reads: ticket size, cost and output multipliers. */
  ticketMul: number;
  costMul: number;
  outputMul: number;
  flags: Record<string, number | boolean>;
  until: Record<string, number>;
  ev: EventState;
}

/** Metrics the business does not model: an effect on them must leave the state alone. */
export const UNMAPPED: readonly MetricId[] = ['hype', 'techDebt', 'climate', 'founderMorale', 'multipleMul', 'wageMul', 'cacMul', 'churnMul', 'payRateMul'];

export interface Ignored {
  stock: number;
  round: number;
  flagsOther: number;
}

export function newBusiness(seed: number): BusinessState {
  return {
    seed,
    week: 0,
    till: 400_000,
    footfall: 600,
    reputation: 55,
    staffMorale: 65,
    staff: 5,
    shopClosed: false,
    ticketMul: 1,
    costMul: 1,
    outputMul: 1,
    flags: {},
    until: {},
    ev: emptyEventState(),
  };
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** A host that counts what it dropped, so the test can tell "ignored" from "never tried". */
export function storyBusinessHost(ignored: Ignored): EventHost<BusinessState> {
  return {
    metric(s, id: MetricOrDerived) {
      switch (id) {
        case 'cash': return s.till;
        case 'users': return s.footfall;
        case 'reputation': return s.reputation;
        case 'morale': return s.staffMorale;
        case 'headcount': return s.staff;
        case 'week': return s.week;
        case 'burnWeek': return 20_000;
        case 'arr': return s.till * 2;
        case 'cacMul': case 'churnMul': case 'payRateMul': case 'wageMul': case 'multipleMul': return 1;
        case 'arpuMul': return s.ticketMul;
        case 'burnMul': return s.costMul;
        case 'devPowerMul': return s.outputMul;
        default: return 0;
      }
    },
    flag: (s, key) => s.flags[key],
    applyStock(s, id, op, v) {
      const set = (cur: number): number => (op === 'mul' ? cur * v : cur + v);
      switch (id) {
        case 'cash': s.till = Math.round(set(s.till)); return;
        case 'users': s.footfall = clamp(set(s.footfall), 0, 100_000); return;
        case 'reputation': s.reputation = clamp(set(s.reputation), 0, 100); return;
        case 'morale': s.staffMorale = clamp(set(s.staffMorale), 0, 100); return;
        default: ignored.stock++;
      }
    },
    applyStaff(s, e: Extract<EffectSpec, { k: 'staff' }>, n) {
      if (e.op === 'inject') s.staff += n;
      else s.staff = Math.max(1, s.staff - n);
    },
    applyRound() {
      ignored.round++;
    },
    setFlag(s, key, v, untilWeek) {
      if (key === 'officeClosed') {
        s.shopClosed = v === true || v === 1;
        s.until[key] = untilWeek;
      } else ignored.flagsOther++;
      s.flags[key] = v;
    },
    expireFlags(s) {
      for (const k of Object.keys(s.until)) {
        if ((s.until[k] as number) <= s.week) {
          delete s.until[k];
          delete s.flags[k];
          if (k === 'officeClosed') s.shopClosed = false;
        }
      }
    },
    seed: (s) => s.seed,
    week: (s) => s.week,
    startWeekOfYear: () => 0,
  };
}

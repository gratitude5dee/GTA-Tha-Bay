/**
 * Run setup (08-tycoon.md section 5.8): `setupFromSeed` fills every unchosen field deterministically, `newRun` builds week 0.
 */
import { ctrU32 } from '../rng.ts';
import { emptyEventState } from '../events/types.ts';
import { initialCapTable } from './finance/index.ts';
import { ctrFloat } from './rand.ts';
import type { CompanyState, FounderArchetype, RunSetup, TycoonContent } from './types.ts';

const FOUNDERS: readonly FounderArchetype[] = ['engineer', 'hustler', 'designer'];

/**
 * Fills a `RunSetup` from the seed. The spec signature is `(seed, opts?)`; the content argument is added (BD-M09a1-07) because the
 * thesis deal and the two version strings come from the content.
 */
export function setupFromSeed(seed: number, opts: Partial<RunSetup> | undefined, content: TycoonContent): RunSetup {
  const o = opts ?? {};
  const u = seed >>> 0;
  const unlocked = Object.keys(content.sectors).filter((k) => k === 'b2b-saas');
  const deal = content.theses.map((t) => t.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const thesis = o.thesis ?? (deal[ctrU32(u, 'setup:thesis', 0) % deal.length] as string);
  return {
    seed: u,
    sector: o.sector ?? ((unlocked[0] ?? 'b2b-saas') as RunSetup['sector']),
    thesis,
    founder: o.founder ?? (FOUNDERS[ctrU32(u, 'setup:founder', 0) % FOUNDERS.length] as FounderArchetype),
    coFounder: o.coFounder ?? ctrU32(u, 'setup:cofounder', 0) % 2 === 1,
    startWeekOfYear: o.startWeekOfYear ?? ctrU32(u, 'setup:week', 0) % 52,
    hardcore: o.hardcore ?? false,
    ...(o.autoResolveEvents === true ? { autoResolveEvents: true as const } : {}),
    preset: o.preset ?? 'standard',
    contentVersion: content.contentVersion,
    balanceVersion: content.balanceVersion,
  };
}

export function newRun(setup: RunSetup, content: TycoonContent): CompanyState {
  const sec = content.sectors[setup.sector];
  if (!sec) throw new Error(`tycoon: unknown sector ${setup.sector}`);
  const b = content.balance;
  const founders = setup.coFounder ? 2 : 1;
  const climate = (ctrFloat(setup.seed, 'climate', 0) * 2 - 1) * b.setup.climateSpread;
  return {
    v: 1,
    setup,
    week: 0,
    phase: 'idea',
    awaiting: null,
    cash: b.setup.startCashCents,
    users: 0,
    payingUsers: 0,
    mrr: 0,
    arpuMonth: sec.arpuMonthCents,
    churnMonthly: sec.churn0,
    cac: sec.cac0Cents,
    marketing: 0,
    priceLevel: 'standard',
    mvpProgress: 0,
    featurePoints: 0,
    productQuality: 0,
    techDebt: 0,
    hype: b.setup.hype,
    reputation: b.setup.reputation,
    climate,
    morale: b.setup.founderMorale,
    founderMorale: b.setup.founderMorale,
    allocation: { ...b.setup.allocation },
    focus: 'product',
    crunch: false,
    office: 'garage',
    team: [],
    market: [],
    offers: [],
    capTable: initialCapTable(setup.coFounder),
    meetings: [],
    termSheets: [],
    raise: null,
    board: { seats: Array.from({ length: founders }, () => 'founder' as const), founderControl: true, missedTargets: 0, nextMeetingWeek: null, lastTargetArrGrowth: 0 },
    events: emptyEventState(),
    flags: {},
    mrrHistory: [],
    profitableStreak: 0,
    negativeCashWeeks: 0,
    dividendEarnedCents: 0,
    result: null,
  };
}

/**
 * `replay` and `verifyRun` (08-tycoon.md section 3.3 and 4.6): a run is a pure function of `(setup, choices)`.
 * `choices` are applied in `(week, seq)` order before the `stepWeek` of their week. The clock holds while the company is
 * `awaiting` something; a recorded choice resolves it in the same week.
 */
import { choiceAllowed } from '../events/engine.ts';
import { canonicalize } from '../json.ts';
import { applyCommand } from './commands.ts';
import { hashCompany, expensesWeek, mrrGrowth13, revenueWeek, roleCount, runwayWeeks, valuationRef } from './company.ts';
import { hostFor } from './events/host.ts';
import { newRun } from './setup.ts';
import { stepWeek } from './step.ts';
import { ROLES, type AwaitingKind, type ChoiceRecord, type CompanyState, type Phase, type RoleId, type RunResult, type RunSetup, type TermSheetEnvelope, type TycoonContent } from './types.ts';

export { hashCompany };

export class ReplayError extends Error {
  constructor(message: string) {
    super(`tycoon replay: ${message}`);
    this.name = 'ReplayError';
  }
}

export interface ReplayOutcome {
  state: CompanyState;
  result: RunResult | null;
  hash: string;
}

const sorted = (choices: readonly ChoiceRecord[]): ChoiceRecord[] =>
  choices.map((c, i) => ({ c, i })).sort((a, b) => a.c.week - b.c.week || a.c.seq - b.c.seq || a.i - b.i).map((x) => x.c);

/** Replays a run. With `untilWeek` it stops once `state.week` reaches it (commands of that week are applied first). `onWeek` sees the state after each completed week. */
export function replay(setup: RunSetup, choices: readonly ChoiceRecord[], content: TycoonContent, untilWeek?: number, onWeek?: (state: CompanyState) => void): ReplayOutcome {
  const state = newRun(setup, content);
  const list = sorted(choices);
  let i = 0;
  const applyWeek = (): void => {
    while (i < list.length && (list[i] as ChoiceRecord).week <= state.week) {
      const ch = list[i] as ChoiceRecord;
      i++;
      if (ch.week < state.week) throw new ReplayError(`choice for week ${ch.week} arrived after week ${state.week} began`);
      if (state.phase === 'ended') continue;
      const r = applyCommand(state, ch.cmd, content);
      if (!r.ok) throw new ReplayError(`week ${ch.week} seq ${ch.seq} ${ch.cmd.t}: ${r.error.code}`);
    }
  };
  for (;;) {
    applyWeek();
    if (state.phase === 'ended') break;
    if (untilWeek !== undefined && state.week >= untilWeek) break;
    if (state.awaiting !== null) break;
    stepWeek(state, content);
    onWeek?.(state);
  }
  return { state, result: state.result, hash: hashCompany(state) };
}

/**
 * Checks a claimed result against the replay of `(setup, choices)`. `contentVersion` means the run was recorded against other
 * content or balance than this build holds, so it cannot be checked here; `mismatch` means the replay disagrees or fails.
 */
export function verifyRun(setup: RunSetup, choices: readonly ChoiceRecord[], claimed: RunResult, content: TycoonContent): 'ok' | 'mismatch' | 'contentVersion' {
  if (setup.contentVersion !== content.contentVersion || setup.balanceVersion !== content.balanceVersion) return 'contentVersion';
  try {
    const out = replay(setup, choices, content);
    if (out.result === null) return 'mismatch';
    return canonicalize(out.result) === canonicalize(claimed) ? 'ok' : 'mismatch';
  } catch (e) {
    if (e instanceof ReplayError) return 'mismatch';
    throw e;
  }
}

/** Read model for the UI and for bots. */
export interface PolicyView {
  week: number;
  phase: Phase;
  awaiting: AwaitingKind | null;
  cash: number;
  mrr: number;
  arr: number;
  users: number;
  headcount: number;
  runwayWeeks: number;
  valuationRef: number;
  quality: number;
  techDebt: number;
  hype: number;
  reputation: number;
  climate: number;
  founderMorale: number;
  poolAvailable: number;
  raiseKind: string | null;
  openMeetingId: string | null;
  growth13: number;
  /** BD-M09a2-06: the read model grew with what the bots (and later the UI) need; every field is derived from the state. */
  expenseWeek: number;
  revenueWeek: number;
  marketing: number;
  focus: CompanyState['focus'];
  crunch: boolean;
  allocation: CompanyState['allocation'];
  roleCount: Record<RoleId, number>;
  offersPending: number;
  /** Candidates on the market that have no offer yet. */
  market: { id: string; role: RoleId; skill: number; askYr: number }[];
  /** Choice events waiting for an answer. */
  inbox: { iid: number; defId: string; defaultChoiceId: string; choices: { id: string; allowed: boolean }[] }[];
  meeting: { id: string; vcId: string; kind: string; amount: number; preMoney: number; envelope: TermSheetEnvelope | null } | null;
  closing: boolean;
  raise: { kind: string; targetCents: number; vcPool: string[]; meetingsHeld: number } | null;
  /** True when `startRaise` would pass the spacing rule. */
  raiseSpacingOk: boolean;
  safes: number;
  /** Kinds of the priced rounds that closed. */
  closedRounds: string[];
  canSell: boolean;
  canListPublic: boolean;
  officeClosed: boolean;
}

export function policyView(s: CompanyState, c: TycoonContent): PolicyView {
  return {
    week: s.week,
    phase: s.phase,
    awaiting: s.awaiting,
    cash: s.cash,
    mrr: s.mrr,
    arr: 12 * s.mrr,
    users: Math.floor(s.users),
    headcount: s.team.length + (s.setup.coFounder ? 2 : 1),
    runwayWeeks: runwayWeeks(s, c),
    valuationRef: valuationRef(s, c),
    quality: s.productQuality,
    techDebt: s.techDebt,
    hype: s.hype,
    reputation: s.reputation,
    climate: s.climate,
    founderMorale: s.founderMorale,
    poolAvailable: s.capTable.pool.authorized - s.capTable.pool.granted,
    raiseKind: s.raise ? s.raise.kind : null,
    openMeetingId: s.meetings.find((m) => m.phase === 'offer')?.id ?? null,
    growth13: mrrGrowth13(s, c),
    expenseWeek: expensesWeek(s, c),
    revenueWeek: revenueWeek(s, c),
    marketing: s.marketing,
    focus: s.focus,
    crunch: s.crunch,
    allocation: s.allocation,
    roleCount: Object.fromEntries(ROLES.map((r) => [r, roleCount(s.team, r)])) as Record<RoleId, number>,
    offersPending: s.offers.length,
    market: s.market.filter((x) => !s.offers.some((o) => o.candidateId === x.id)).map((x) => ({ id: x.id, role: x.role, skill: x.skill, askYr: x.askYr })),
    inbox: s.events.inbox.flatMap((i) => {
      const d = c.events.find((e) => e.id === i.defId);
      if (!d?.choices || d.defaultChoiceId === undefined) return [];
      return [{ iid: i.iid, defId: i.defId, defaultChoiceId: d.defaultChoiceId, choices: d.choices.map((ch) => ({ id: ch.id, allowed: choiceAllowed(ch, s, hostFor(c)) })) }];
    }),
    meeting: s.meetings.find((m) => m.phase === 'offer' && m.offer)
      ? (() => {
          const m = s.meetings.find((x) => x.phase === 'offer' && x.offer) as CompanyState['meetings'][number];
          const o = m.offer as NonNullable<typeof m.offer>;
          return { id: m.id, vcId: m.vcId, kind: m.kind, amount: o.amount, preMoney: o.preMoney, envelope: m.envelope };
        })()
      : null,
    closing: s.meetings.some((m) => m.phase === 'closing'),
    raise: s.raise ? { kind: s.raise.kind, targetCents: s.raise.targetCents, vcPool: s.raise.vcPool, meetingsHeld: s.raise.meetingsHeld } : null,
    raiseSpacingOk: s.raise === null && s.week >= (typeof s.flags['lastRaiseEnd'] === 'number' ? (s.flags['lastRaiseEnd'] as number) : -1000) + c.balance.raise.spacingWeeks,
    safes: s.capTable.safes.length,
    closedRounds: s.capTable.rounds.filter((r) => r.closedWeek !== null).map((r) => r.kind),
    canSell: s.phase === 'launched' && valuationRef(s, c) >= c.balance.end.acquisitionMinCents,
    canListPublic: s.phase === 'launched' && 12 * s.mrr >= c.balance.end.ipoArrCents && s.flags['ipoWindow'] === true,
    officeClosed: s.flags['officeClosed'] === true,
  };
}

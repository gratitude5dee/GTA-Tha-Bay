/**
 * Win, lose, insolvency and score (08-tycoon.md sections 5.10 and 5.11).
 * Win kinds end with a score from the founder's waterfall payout at the exit value; loss kinds score the payout at that moment.
 */
import { settleSafes, waterfall } from './finance/index.ts';
import { hashCompany, headcount, valuationRef } from './company.ts';
import type { CompanyState, EndKind, RunResult, TycoonContent } from './types.ts';

const WIN_TIER: Partial<Record<EndKind, RunResult['tier']>> = { acquisition: 'acq', unicorn: 'unicorn', ipo: 'ipo', ramen: 'ramen' };

/** What the founders take home if the company is sold for `exitValueCents` (net proceeds). */
export function founderPayout(s: CompanyState, exitValueCents: number): number {
  const E = Math.max(0, Math.floor(exitValueCents));
  const table = settleSafes(s.capTable, E);
  const p = waterfall(E, table);
  let n = 0;
  for (const h of table.holders) if (h.kind === 'founder') n += p.byHolder[h.id] ?? 0;
  return n;
}

export function scoreOf(c: TycoonContent, payoutCents: number, retained: number, legacyTags: number): number {
  const e = c.balance.end;
  return Math.floor(payoutCents / e.scoreCentsDiv) + e.retainedEmployeeScore * retained + e.legacyTagScore * Math.min(e.legacyTagMax, legacyTags);
}

/**
 * Ends the run: computes the result from the state as it stands, stores it, sets the phase to `ended`.
 * `exitValueCents` defaults by kind: the valuation reference for ipo, ramen, ousted, burnout and quit; 0 for insolvent.
 */
export function finishRun(s: CompanyState, c: TycoonContent, kind: EndKind, exitValueCents?: number): RunResult {
  if (s.result) return s.result;
  const win = kind === 'acquisition' || kind === 'unicorn' || kind === 'ipo' || kind === 'ramen' || kind === 'miniWin';
  const exit = exitValueCents ?? (kind === 'insolvent' ? 0 : valuationRef(s, c));
  const payout = founderPayout(s, exit);
  const retained = s.team.length;
  const legacy = typeof s.flags['legacyTags'] === 'number' ? (s.flags['legacyTags'] as number) : 0;
  const stateHash = hashCompany(s);
  const result: RunResult = {
    kind,
    win,
    week: s.week,
    founderPayoutCents: payout,
    exitValueCents: exit,
    score: scoreOf(c, payout, retained, legacy),
    tier: WIN_TIER[kind] ?? null,
    arrCents: 12 * s.mrr,
    headcountAtEnd: headcount(s),
    legacyTags: Math.min(c.balance.end.legacyTagMax, legacy),
    stateHash,
  };
  s.result = result;
  s.phase = 'ended';
  s.awaiting = null;
  return result;
}

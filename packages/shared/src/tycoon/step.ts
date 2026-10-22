/**
 * `stepWeek`: one in-game week in the order of 08-tycoon.md section 5.2.
 *  1. due items (offers, term-sheet expiry, round closings, raise expiry)
 *  2. events (an empty list until M09a2)
 *  3. product, users, revenue, costs, cash
 *  4. hiring market, morale and attrition, founder
 *  5. hype, reputation and climate drift
 *  6. board
 *  7. win and lose checks, `week += 1`, `awaiting`
 */
import { addSafe, boardSeatsFor, priceRound, type Safe } from './finance/index.ts';
import { clamp, devPower, expensesWeek, mrrGrowth13, mods, priceFactor, revenueWeek, sectorOf, skillSum } from './company.ts';
import { finishRun } from './end.ts';
import { boardStep, founderStep, moraleAndAttrition, recomputeControl, refreshMarket, resolveOffers, syncMorale } from './people.ts';
import type { CompanyState, EndKind, StepResult, TycoonContent } from './types.ts';

interface PendingEnd {
  kind: EndKind;
  exit?: number;
}

function closeEffects(s: CompanyState, c: TycoonContent, kind: string, closedWeek: number): void {
  s.hype = clamp(s.hype + 8, 0, 100);
  s.founderMorale = clamp(s.founderMorale + c.balance.founder.roundClose, 0, 100);
  s.flags['lastRaiseEnd'] = closedWeek;
  s.flags['lastRoundKind'] = kind;
  s.raise = null;
}

/** Closes accepted rounds whose two weeks are over: cash arrives and the cap table changes (08-tycoon-finance.md section 9). */
function closeRounds(s: CompanyState, c: TycoonContent): PendingEnd | null {
  let end: PendingEnd | null = null;
  for (const m of s.meetings) {
    // The money arrives in the step that ends at `closeWeek` (accepted in week w, closed at w + 2).
    if (m.phase !== 'closing' || m.closeWeek === null || m.closeWeek > s.week + 1 || !m.offer) continue;
    const t = m.offer;
    const cw = m.closeWeek;
    if (m.kind === 'safe') {
      const safe: Safe = { id: `safe-${m.id}`, investorId: `vc:${m.vcId}`, amount: t.amount, signedWeek: cw, type: 'cap', postMoneyCap: t.preMoney };
      const r = addSafe(s.capTable, safe);
      if ('table' in r) {
        s.capTable = r.table;
        s.cash += t.amount;
        m.phase = 'closed';
        closeEffects(s, c, 'safe', cw);
      } else m.phase = 'withdrawn';
      continue;
    }
    const seats = boardSeatsFor(m.kind, t.boardSeat);
    const r = priceRound(s.capTable, { preMoney: t.preMoney, amount: t.amount, poolTargetBp: t.poolTargetBp }, { id: m.id, kind: m.kind, week: cw, leadInvestorId: `vc:${m.vcId}`, liq: t.liq, boardSeats: seats });
    if (!('table' in r)) {
      // CAPTABLE_INVARIANT or infeasible terms at close: the round is aborted and no cash moves.
      m.phase = 'withdrawn';
      continue;
    }
    r.round.week = m.startedWeek;
    r.round.closedWeek = cw;
    s.capTable = r.table;
    s.cash += t.amount - r.legalFeeCents;
    m.phase = 'closed';
    for (let i = 0; i < seats; i++) s.board.seats.push(`vc:${m.vcId}`);
    recomputeControl(s);
    const post = t.preMoney + t.amount;
    const prev = typeof s.flags['lastPost'] === 'number' ? (s.flags['lastPost'] as number) : null;
    const down = prev !== null && post < prev;
    s.flags['lastPost'] = post;
    s.flags['lastRoundDown'] = down;
    if (down) {
      for (const e of s.team) e.morale = clamp(e.morale + c.balance.hiring.moraleDownRound, 0, 100);
      s.hype = clamp(s.hype - 10, 0, 100);
    }
    closeEffects(s, c, m.kind, cw);
    if (s.board.nextMeetingWeek === null) s.board.nextMeetingWeek = cw + c.balance.sim.boardIntervalWeeks;
    s.board.lastTargetArrGrowth = (c.balance.board.targets as Record<string, number>)[m.kind] ?? c.balance.board.targets.seed;
    if (end === null && post >= c.balance.end.unicornPostMoneyCents) end = { kind: 'unicorn', exit: post };
  }
  return end;
}

/** A raise that has no open or closing meeting ends when its meetings are used up or its weeks have run out. */
function expireRaise(s: CompanyState, c: TycoonContent): void {
  const r = s.raise;
  if (r === null) return;
  const busy = s.meetings.some((m) => m.raiseId === r.id && (m.phase === 'offer' || m.phase === 'closing'));
  if (busy) return;
  const rc = c.balance.raise;
  if (r.meetingsHeld >= rc.maxMeetings || s.week - r.startedWeek >= rc.focusWeeksBase + rc.maxMeetings - 1) {
    s.raise = null;
    s.flags['lastRaiseEnd'] = s.week;
  }
}

export function stepWeek(s: CompanyState, c: TycoonContent): StepResult {
  if (s.phase === 'ended') return { week: s.week, events: [], awaiting: null, ended: s.result };
  if (s.awaiting !== null) return { week: s.week, events: [], awaiting: s.awaiting, ended: null };

  const cc = c.balance.company;
  const sec = sectorOf(s, c);
  const m = mods(s, c);
  let end: PendingEnd | null = null;

  // 1. due items
  resolveOffers(s, c);
  s.termSheets = s.termSheets.filter((t) => t.validUntilWeek >= s.week);
  for (const mt of s.meetings) {
    if (mt.phase === 'offer' && mt.envelope && mt.envelope.validUntilWeek < s.week) mt.phase = 'withdrawn';
  }
  end = closeRounds(s, c);
  expireRaise(s, c);

  // 2. events: none in M09a1

  // 3. product, market, revenue, costs
  const wasLaunched = s.phase === 'launched';
  const dp = devPower(s, c);
  const af = s.allocation.features / 100;
  const ar = s.allocation.refactor / 100;
  if (s.phase === 'mvp') {
    s.mvpProgress += dp;
    if (s.mvpProgress >= sec.mvpPoints) {
      s.phase = 'launched';
      s.hype = clamp(s.hype + cc.launchHype, 0, 100);
      s.users = cc.launchUsers;
    }
  } else if (s.phase === 'launched') {
    s.featurePoints += dp * af;
  }
  if (s.phase === 'mvp' || s.phase === 'launched') {
    s.techDebt = clamp(s.techDebt + (cc.debtFeature * (dp * af)) / 10 - (cc.debtRefactor * (dp * ar)) / 10, 0, 100);
  }
  if (wasLaunched) {
    const fa = c.archetypes.founders[s.setup.founder];
    const growth = skillSum(s.team, 'growth');
    const ops = skillSum(s.team, 'ops');
    const sales = skillSum(s.team, 'sales');
    const F = s.featurePoints;
    const target = (100 * F) / (F + sec.featureHalf) - cc.debtQualityWeight * Math.max(0, s.techDebt - cc.debtQualityStart) + fa.qualityBonus;
    s.productQuality = clamp(s.productQuality + cc.qualityRate * (target - s.productQuality), 0, 100);
    s.cac = sec.cac0Cents * m.cacMul * fa.cacMul * (1 - Math.min(cc.cacGrowthCap, cc.cacGrowthSkill * growth)) * (1 + s.users / (cc.cacSaturation * sec.tam));
    const acquired = s.marketing / s.cac;
    const organic = s.users * sec.k * (s.productQuality / 100) * (0.5 + s.hype / 200) * (1 - s.users / sec.tam);
    const price = priceFactor(s, c);
    s.churnMonthly = sec.churn0 - Math.min(cc.churnOpsCap * sec.churn0, cc.churnOpsSkill * ops) + cc.churnPriceWeight * (price - 1);
    const churned = (s.users * s.churnMonthly * m.churnMul) / cc.monthWeeks;
    s.users = clamp(s.users + acquired + organic - churned, 0, sec.tam);
    const payRate = sec.payRate * m.payRateMul * (cc.payQualityBase + s.productQuality / 200) * (1 + cc.paySalesSkill * sales) * (1 - cc.payPriceWeight * (price - 1));
    s.payingUsers = s.users * Math.min(1, Math.max(0, payRate));
    s.mrr = Math.round(s.payingUsers * s.arpuMonth * price * m.arpuMul);
  }
  const burn = expensesWeek(s, c) - revenueWeek(s, c);
  const burnCents = Math.round(burn);
  s.cash -= burnCents;
  s.flags['netBurn'] = burnCents;
  const arr = 12 * s.mrr;
  s.profitableStreak = burnCents < 0 && arr >= c.balance.end.ramenArrCents ? s.profitableStreak + 1 : 0;

  // insolvency (section 5.10)
  let awaiting: CompanyState['awaiting'] = null;
  if (s.cash < 0) {
    s.negativeCashWeeks += 1;
    if (end === null && (s.flags['bridgeUsed'] === true || s.negativeCashWeeks >= c.balance.end.insolvencyWeeks)) end = { kind: 'insolvent', exit: 0 };
    else if (s.negativeCashWeeks === 1 && s.flags['bridgeUsed'] !== true) awaiting = 'bridge';
  } else s.negativeCashWeeks = 0;

  // 4. hiring market, morale, founder
  refreshMarket(s, c);
  moraleAndAttrition(s, c);
  const burnout = founderStep(s, c);
  if (burnout && end === null) end = { kind: 'burnout' };

  // 5. hype, reputation, climate
  s.hype = clamp(s.hype + cc.hypeRate * (cc.hypeMean - s.hype), 0, 100);
  s.reputation = clamp(s.reputation + (burnCents < 0 ? cc.reputationUp : -cc.reputationDown), 0, 100);
  s.climate = clamp(s.climate * cc.climateDecay, -1, 1);

  s.mrrHistory.push(s.mrr);
  if (s.mrrHistory.length > 14) s.mrrHistory.shift();
  s.morale = syncMorale(s);

  // 6. board (a bridge offer goes first; the meeting then follows next week)
  s.week += 1;
  if (end === null && awaiting === null) {
    const b = boardStep(s, c, mrrGrowth13(s, c));
    if (b === 'ousted') end = { kind: 'ousted' };
    else if (b === 'meeting') awaiting = 'board';
  }

  // 7. win and lose
  if (end === null && s.profitableStreak >= c.balance.end.ramenWeeks) end = { kind: 'ramen' };
  if (end !== null) {
    const r = finishRun(s, c, end.kind, end.exit);
    return { week: s.week, events: [], awaiting: null, ended: r };
  }
  s.awaiting = awaiting;
  return { week: s.week, events: [], awaiting, ended: null };
}

/**
 * `applyCommand`: validates a player command and applies it. A command that fails returns a typed `CommandError` and leaves the
 * state untouched (the state hash is unchanged). 08-tycoon.md section 4.4 for the rules; negotiation is the M09a1 stub of
 * 08-tycoon-finance.md section 9: `startRaise`, `scheduleMeeting` (the envelope midpoint at mood 50), then `accept` or `walk`.
 */
import { choiceAllowed, choose as chooseEvent } from '../events/engine.ts';
import { hostFor } from './events/host.ts';
import { addSafe, termSheetEnvelope, type EnvelopeCompany, type RoundKind, type VcProfile } from './finance/index.ts';
import { poolAvailable } from './finance/index.ts';
import { headcount, runwayWeeks, valuationRef } from './company.ts';
import { finishRun } from './end.ts';
import { fireEmployee, offerResolveWeek, optionSharesFor, pendingOptionShares } from './people.ts';
import type { Command, CommandErrorCode, CommandResult, CompanyState, MeetingState, TycoonContent } from './types.ts';

const err = (code: CommandErrorCode, detail?: string): CommandResult => ({ ok: false, error: detail === undefined ? { code } : { code, detail } });
const OK: CommandResult = { ok: true };
const isInt = (n: number): boolean => Number.isInteger(n);

function liveDevPhase(s: CompanyState): boolean {
  return s.phase === 'mvp' || s.phase === 'launched';
}

function vcProfile(c: TycoonContent, id: string): VcProfile | null {
  const d = c.archetypes.vcs.find((v) => v.id === id);
  if (!d) return null;
  return { id: d.id, style: d.style, valuationBias: d.valuationBias, checkMin: d.checkMin, checkMax: d.checkMax, predatoryAllowed: d.predatoryAllowed, redFlags: d.redFlags };
}

export function envelopeCompany(s: CompanyState, c: TycoonContent, kind: RoundKind, targetCents: number): EnvelopeCompany {
  return {
    week: s.week,
    round: kind,
    targetCents,
    valuationRef: valuationRef(s, c),
    reputation: s.reputation,
    techDebt: s.techDebt,
    hype: s.hype,
    runwayWeeks: runwayWeeks(s, c),
    founderControl: s.board.founderControl,
  };
}

function openMeeting(s: CompanyState): MeetingState | undefined {
  return s.meetings.find((m) => m.phase === 'offer');
}

export function applyCommand(s: CompanyState, cmd: Command, c: TycoonContent): CommandResult {
  if (s.phase === 'ended') return err('ENDED');
  const b = c.balance;
  switch (cmd.t) {
    case 'setAllocation': {
      const { features, refactor, infra } = cmd;
      if (![features, refactor, infra].every((n) => isInt(n) && n >= 0 && n <= 100)) return err('ALLOCATION_RANGE');
      if (features + refactor + infra !== 100) return err('ALLOCATION_SUM', String(features + refactor + infra));
      s.allocation = { features, refactor, infra };
      if (s.phase === 'idea') s.phase = 'mvp';
      return OK;
    }
    case 'setMarketing': {
      if (!liveDevPhase(s)) return err('PHASE');
      if (!isInt(cmd.perWeek) || cmd.perWeek < 0) return err('MARKETING_CAP', 'negative');
      const cap = b.company.marketingCapMul * Math.max(s.cash / b.company.marketingCapCashDiv, s.mrr / b.company.monthWeeks);
      if (cmd.perWeek > cap) return err('MARKETING_CAP', String(Math.floor(cap)));
      s.marketing = cmd.perWeek;
      return OK;
    }
    case 'setPrice':
      s.priceLevel = cmd.level;
      return OK;
    case 'setFocus':
      s.focus = cmd.focus;
      return OK;
    case 'setCrunch':
      s.crunch = cmd.on;
      return OK;
    case 'setOffice': {
      if (headcount(s) < b.company.officeUnlock[cmd.tier]) return err('OFFICE_LOCKED');
      s.office = cmd.tier;
      return OK;
    }
    case 'hireOffer': {
      if (!liveDevPhase(s)) return err('PHASE', 'hire needs an MVP in progress');
      const cand = s.market.find((x) => x.id === cmd.candidateId);
      if (!cand || s.offers.some((o) => o.candidateId === cmd.candidateId)) return err('NO_CANDIDATE');
      if (!isInt(cmd.salaryYr) || cmd.salaryYr <= 0 || !isInt(cmd.optionBp) || cmd.optionBp < 0 || cmd.optionBp > 500) return err('OFFER_RANGE');
      if (s.team.length + s.offers.length >= b.sim.maxEmployees) return err('OFFER_RANGE', 'team is full');
      if (optionSharesFor(s, cmd.optionBp) + pendingOptionShares(s) > poolAvailable(s.capTable)) return err('POOL_EXHAUSTED');
      s.offers.push({ candidateId: cand.id, salaryYr: cmd.salaryYr, optionBp: cmd.optionBp, resolveWeek: offerResolveWeek(s, c, cand.id) });
      return OK;
    }
    case 'fire': {
      if (!s.team.some((e) => e.id === cmd.employeeId)) return err('NO_EMPLOYEE');
      fireEmployee(s, c, cmd.employeeId);
      return OK;
    }
    case 'startRaise': {
      if (!liveDevPhase(s)) return err('PHASE');
      if (s.raise !== null) return err('RAISE_ACTIVE');
      const last = typeof s.flags['lastRaiseEnd'] === 'number' ? (s.flags['lastRaiseEnd'] as number) : -1000;
      if (s.week < last + b.raise.spacingWeeks) return err('RAISE_SPACING', String(last + b.raise.spacingWeeks));
      if (!isInt(cmd.targetCents) || cmd.targetCents <= 0) return err('RAISE_TARGET');
      const pool = c.archetypes.vcs.filter((v) => v.stages.includes(cmd.kind)).map((v) => v.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (pool.length === 0) return err('NO_VC');
      s.raise = { id: `r${s.week}${cmd.kind}`, kind: cmd.kind, targetCents: cmd.targetCents, startedWeek: s.week, meetingsHeld: 0, vcPool: pool };
      return OK;
    }
    case 'scheduleMeeting': {
      const r = s.raise;
      if (r === null) return err('NO_RAISE');
      if (!r.vcPool.includes(cmd.vcId)) return err('NO_VC');
      if (r.meetingsHeld >= b.raise.maxMeetings || s.meetings.some((m) => m.raiseId === r.id && m.startedWeek === s.week)) return err('MEETING_LIMIT');
      if (openMeeting(s) || s.meetings.some((m) => m.phase === 'closing')) return err('MEETING_STATE');
      const vc = vcProfile(c, cmd.vcId);
      if (!vc) return err('NO_VC');
      const competing = s.termSheets.filter((t) => t.vcId !== cmd.vcId && t.validUntilWeek >= s.week).length;
      const env = termSheetEnvelope(envelopeCompany(s, c, r.kind, r.targetCents), vc, s.climate, competing, 50, b.finance);
      r.meetingsHeld += 1;
      const base = { id: `m${s.meetings.length + 1}`, raiseId: r.id, vcId: cmd.vcId, kind: r.kind, mood: 50, startedWeek: s.week, closeWeek: null, clamped: [] as string[] };
      if ('pass' in env || env.walkAway !== null) {
        s.meetings.push({ ...base, phase: 'passed', envelope: 'pass' in env ? null : env, offer: null });
        return OK;
      }
      s.meetings.push({ ...base, phase: 'offer', envelope: env, offer: { ...env.midpoint, liq: { ...env.midpoint.liq } } });
      s.termSheets.push(env);
      s.awaiting = 'meeting';
      return OK;
    }
    case 'accept': {
      const m = s.meetings.find((x) => x.id === cmd.meetingId);
      if (!m) return err('NO_MEETING');
      if (m.phase !== 'offer' || !m.offer) return err('MEETING_STATE');
      const t = m.offer;
      if (m.kind === 'safe') {
        const probe = addSafe(s.capTable, { id: `probe-${m.id}`, investorId: `vc:${m.vcId}`, amount: t.amount, signedWeek: s.week, type: 'cap', postMoneyCap: t.preMoney });
        if (!('table' in probe)) return err('SAFE_STACK_LIMIT');
      } else if (t.preMoney * 10_000 - t.poolTargetBp * (t.preMoney + t.amount) <= 0) return err('TERMS_INFEASIBLE');
      m.phase = 'closing';
      m.closeWeek = s.week + b.raise.closeWeeks;
      s.awaiting = null;
      return OK;
    }
    case 'walk': {
      const m = s.meetings.find((x) => x.id === cmd.meetingId);
      if (!m) return err('NO_MEETING');
      if (m.phase !== 'offer') return err('MEETING_STATE');
      m.phase = 'withdrawn';
      s.termSheets = s.termSheets.filter((t) => t.vcId !== m.vcId);
      s.awaiting = null;
      return OK;
    }
    case 'answerQuestion':
    case 'askMore':
    case 'counter':
    case 'bringCompetitor':
    case 'sleepOnIt':
    case 'vcSpoke':
      return err('NOT_AVAILABLE', 'negotiation beyond the automatic midpoint arrives in M09b2');
    case 'resolveEvent': {
      const inst = s.events.inbox.find((i) => i.iid === cmd.iid);
      if (!inst) return err('NO_EVENT');
      const choice = c.events.find((d) => d.id === inst.defId)?.choices?.find((x) => x.id === cmd.choiceId);
      if (!choice) return err('NO_CHOICE');
      const host = hostFor(c);
      if (!choiceAllowed(choice, s, host)) return err('CHOICE_LOCKED');
      chooseEvent(s, s.events, cmd.iid, cmd.choiceId, c.events, host);
      if (s.awaiting === 'event' && s.events.inbox.length === 0) s.awaiting = null;
      return OK;
    }
    case 'boardVote': {
      if (s.awaiting !== 'board') return err('NOT_AWAITING');
      if (cmd.motion === 'ignore' && s.flags['boardMissed'] === true) s.reputation = Math.max(0, s.reputation - b.board.ignoreReputation);
      s.flags['boardMissed'] = false;
      s.awaiting = null;
      return OK;
    }
    case 'exploreSale': {
      if (s.phase !== 'launched') return err('PHASE');
      const v = valuationRef(s, c);
      if (v < b.end.acquisitionMinCents) return err('NO_BUYER', String(v));
      finishRun(s, c, 'acquisition', v);
      return OK;
    }
    case 'goPublic': {
      if (s.phase !== 'launched') return err('PHASE');
      if (12 * s.mrr < b.end.ipoArrCents || s.flags['ipoWindow'] !== true) return err('IPO_CLOSED');
      finishRun(s, c, 'ipo', valuationRef(s, c));
      return OK;
    }
    case 'acceptExit':
      return err('NO_OFFER');
    case 'bridge': {
      if (s.awaiting !== 'bridge') return err('NOT_AWAITING');
      if (!cmd.accept) {
        finishRun(s, c, 'insolvent', 0);
        return OK;
      }
      const burn = typeof s.flags['netBurn'] === 'number' ? Math.max(0, s.flags['netBurn'] as number) : 0;
      const amount = Math.max(b.end.bridgeMinCents, burn * b.end.bridgeBurnWeeks);
      s.capTable.safes.push({ id: 'bridge1', investorId: 'vc:bridge', amount, signedWeek: s.week, type: 'discount', discountBp: b.end.bridgeDiscountBp });
      s.cash += amount;
      s.flags['bridgeUsed'] = true;
      s.negativeCashWeeks = 0;
      s.awaiting = null;
      return OK;
    }
    case 'endRun':
      finishRun(s, c, 'quit');
      return OK;
  }
}


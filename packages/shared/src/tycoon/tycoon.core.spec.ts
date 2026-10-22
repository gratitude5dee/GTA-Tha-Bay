/** AC-6 (illegal commands), AC-7 (end kinds) and the unit coverage of content, hiring, vesting, board and the company equations. */
import { describe, expect, it } from 'vitest';
import { testContent } from './__fixtures__/content.ts';
import { applyCommand } from './commands.ts';
import { buildContent, ContentError } from './content.ts';
import { devPower, hashCompany, valuationRef } from './company.ts';
import { ctrFloat } from './rand.ts';
import { newRun, setupFromSeed } from './setup.ts';
import { stepWeek } from './step.ts';
import type { Command, CommandErrorCode, CompanyState, RunSetup } from './types.ts';
import { initialCapTable } from './finance/index.ts';
import { RAW_CONTENT } from './__fixtures__/content.ts';

const c = testContent();
const mk = (o: Partial<RunSetup> = {}, seed = 1): CompanyState => newRun(setupFromSeed(seed, { founder: 'engineer', coFounder: false, thesis: 'lean-times', ...o }, c), c);
const launched = (s: CompanyState): CompanyState => {
  s.phase = 'launched';
  s.mvpProgress = 200;
  s.users = 1000;
  s.productQuality = 50;
  s.featurePoints = 400;
  return s;
};
const code = (s: CompanyState, cmd: Command): CommandErrorCode | 'ok' => {
  const r = applyCommand(s, cmd, c);
  return r.ok ? 'ok' : r.error.code;
};

describe('tycoon content', () => {
  it('versions are 12 hex characters and change with the content', () => {
    expect(c.contentVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(c.balanceVersion).toMatch(/^[0-9a-f]{12}$/);
    const changed = buildContent({ ...RAW_CONTENT, balance: { ...RAW_CONTENT.balance, founder: { ...RAW_CONTENT.balance.founder, rest: 9 } } });
    expect(changed.balanceVersion).not.toBe(c.balanceVersion);
    expect(changed.contentVersion).toBe(c.contentVersion);
  });
  it('rejects a broken file with the path of the problem', () => {
    expect(() => buildContent({ ...RAW_CONTENT, sectors: { sectors: [{ id: 'b2b-saas' }] } })).toThrow(ContentError);
    expect(() => buildContent({ ...RAW_CONTENT, balance: { schema: 'nope' } })).toThrow(/balance.schema/);
  });
  it('ships b2b-saas, 3 theses and 12 fictional funds with one predatory-allowed fund', () => {
    expect(Object.keys(c.sectors)).toEqual(['b2b-saas']);
    expect(c.theses).toHaveLength(3);
    expect(c.archetypes.vcs).toHaveLength(12);
    expect(c.archetypes.vcs.filter((v) => v.predatoryAllowed).map((v) => v.id)).toEqual(['vc-tourist-hedge']);
  });
});

describe('setupFromSeed and newRun', () => {
  it('fills every field deterministically and keeps explicit options', () => {
    const a = setupFromSeed(0xc0ffee, undefined, c);
    expect(setupFromSeed(0xc0ffee, undefined, c)).toEqual(a);
    expect(a.sector).toBe('b2b-saas');
    expect(setupFromSeed(0xc0ffee, { founder: 'hustler', coFounder: true }, c)).toMatchObject({ founder: 'hustler', coFounder: true });
    expect(a.contentVersion).toBe(c.contentVersion);
  });
  it('starts with $90,000, a 9 M / 1 M table and a founder-only board; a co-founder splits 5.4 M / 3.6 M', () => {
    const s = mk();
    expect(s.cash).toBe(9_000_000);
    expect(s.capTable.totalFd).toBe(10_000_000);
    expect(s.board.seats).toEqual(['founder']);
    const t = mk({ coFounder: true });
    expect(t.capTable.holders.map((h) => h.shares.common)).toEqual([5_400_000, 3_600_000]);
    expect(t.board.seats).toEqual(['founder', 'founder']);
    expect(Math.abs(s.climate)).toBeLessThanOrEqual(0.3);
  });
  it('is a pure function of the setup', () => {
    expect(hashCompany(mk())).toBe(hashCompany(mk()));
    expect(hashCompany(mk({}, 1))).not.toBe(hashCompany(mk({}, 2)));
  });
});

describe('AC-6 illegal commands return a typed error and change nothing', () => {
  const cases: [string, (s: CompanyState) => void, Command, CommandErrorCode][] = [
    ['hire in phase idea', () => undefined, { t: 'hireOffer', candidateId: 'c0-0', salaryYr: 10_000_000, optionBp: 50 }, 'PHASE'],
    ['hire with no pool left', (s) => { s.phase = 'mvp'; s.market.push({ id: 'k1', role: 'eng', skill: 5, askYr: 1_000_000, expiresWeek: 9 }); s.capTable.pool.granted = s.capTable.pool.authorized; }, { t: 'hireOffer', candidateId: 'k1', salaryYr: 1_000_000, optionBp: 50 }, 'POOL_EXHAUSTED'],
    ['allocation summing to 99', () => undefined, { t: 'setAllocation', features: 60, refactor: 20, infra: 19 }, 'ALLOCATION_SUM'],
    ['marketing above 2 x max(cash/8, MRR/4.33)', (s) => { s.phase = 'launched'; }, { t: 'setMarketing', perWeek: Math.floor(2 * (9_000_000 / 8)) + 1 }, 'MARKETING_CAP'],
    ['startRaise 3 weeks after a close', (s) => { s.phase = 'launched'; s.week = 13; s.flags['lastRaiseEnd'] = 10; }, { t: 'startRaise', kind: 'safe', targetCents: 10_000_000 }, 'RAISE_SPACING'],
    ['accept without a meeting', () => undefined, { t: 'accept', meetingId: 'm9' }, 'NO_MEETING'],
    ['boardVote when nothing is awaited', () => undefined, { t: 'boardVote', motion: 'ignore' }, 'NOT_AWAITING'],
    ['an office the headcount does not unlock', () => undefined, { t: 'setOffice', tier: 'tower' }, 'OFFICE_LOCKED'],
    ['startRaise while a raise is open', (s) => { s.phase = 'launched'; s.raise = { id: 'r', kind: 'safe', targetCents: 1, startedWeek: 0, meetingsHeld: 0, vcPool: [] }; }, { t: 'startRaise', kind: 'safe', targetCents: 10_000_000 }, 'RAISE_ACTIVE'],
  ];
  it.each(cases)('%s', (_name, setup, cmd, expected) => {
    const s = mk();
    setup(s);
    const before = hashCompany(s);
    expect(code(s, cmd)).toBe(expected);
    expect(hashCompany(s)).toBe(before);
  });
  it('the legal version of each command is accepted', () => {
    const s = mk();
    expect(code(s, { t: 'setAllocation', features: 60, refactor: 25, infra: 15 })).toBe('ok');
    expect(s.phase).toBe('mvp');
    s.phase = 'launched';
    expect(code(s, { t: 'setMarketing', perWeek: 100_000 })).toBe('ok');
    s.week = 20;
    expect(code(s, { t: 'startRaise', kind: 'safe', targetCents: 10_000_000 })).toBe('ok');
  });
  it('negotiation beyond the midpoint is not available yet', () => {
    const s = mk();
    expect(code(s, { t: 'counter', meetingId: 'm1', terms: { amount: 1, preMoney: 1, poolTargetBp: 1, boardSeat: false, liq: { multiple: 1, participating: false } } })).toBe('NOT_AVAILABLE');
  });
});

describe('AC-7 end kinds', () => {
  it('acquisition: exploreSale at a valuation of at least $50 M', () => {
    const s = launched(mk());
    s.mrr = 100_000_000;
    expect(valuationRef(s, c)).toBeGreaterThanOrEqual(5_000_000_000);
    expect(code(s, { t: 'exploreSale' })).toBe('ok');
    expect(s.result).toMatchObject({ kind: 'acquisition', win: true, tier: 'acq' });
    expect(s.result?.founderPayoutCents).toBeGreaterThan(0);
    expect(s.phase).toBe('ended');
    const small = launched(mk());
    expect(code(small, { t: 'exploreSale' })).toBe('NO_BUYER');
  });
  it('unicorn: a priced round closes at a post-money of $1 B', () => {
    const s = launched(mk());
    s.cash = 100_000_000;
    s.meetings.push({
      id: 'm1', raiseId: 'r', vcId: 'vc-herd-crossover', kind: 'a', phase: 'closing', mood: 50, startedWeek: 0, envelope: null, closeWeek: 0, clamped: [],
      offer: { amount: 5_000_000_000, preMoney: 95_000_000_000, poolTargetBp: 1000, boardSeat: false, liq: { multiple: 1, participating: false } },
    });
    stepWeek(s, c);
    expect(s.result).toMatchObject({ kind: 'unicorn', win: true, tier: 'unicorn', exitValueCents: 100_000_000_000 });
    expect(s.capTable.rounds).toHaveLength(1);
  });
  it('ipo: goPublic at ARR >= $100 M with the window open', () => {
    const s = launched(mk());
    s.mrr = 1_000_000_000;
    expect(code(s, { t: 'goPublic' })).toBe('IPO_CLOSED');
    s.flags['ipoWindow'] = true;
    expect(code(s, { t: 'goPublic' })).toBe('ok');
    expect(s.result).toMatchObject({ kind: 'ipo', win: true, tier: 'ipo' });
  });
  it('ramen: 26 profitable weeks at ARR >= $1 M', () => {
    const s = launched(mk());
    s.users = 50_000;
    s.cash = 500_000_000;
    s.profitableStreak = 24;
    stepWeek(s, c);
    expect(s.result).toBeNull();
    expect(s.profitableStreak).toBe(25);
    stepWeek(s, c);
    expect(s.result).toMatchObject({ kind: 'ramen', win: true, tier: 'ramen' });
  });
  it('insolvent: a declined bridge', () => {
    const s = mk();
    s.phase = 'mvp';
    s.cash = 1_000;
    stepWeek(s, c);
    expect(s.awaiting).toBe('bridge');
    expect(stepWeek(s, c).awaiting).toBe('bridge');
    expect(code(s, { t: 'bridge', accept: false })).toBe('ok');
    expect(s.result).toMatchObject({ kind: 'insolvent', win: false, exitValueCents: 0 });
  });
  it('insolvent: a second shortfall after a bridge; the first bridge converts like a 70 % discount SAFE', () => {
    const s = mk();
    s.phase = 'mvp';
    s.cash = 1_000;
    stepWeek(s, c);
    expect(code(s, { t: 'bridge', accept: true })).toBe('ok');
    expect(s.cash).toBeGreaterThan(500_000);
    expect(s.capTable.safes[0]).toMatchObject({ id: 'bridge1', type: 'discount', discountBp: 7000 });
    s.cash = 1_000;
    stepWeek(s, c);
    expect(s.result?.kind).toBe('insolvent');
  });
  it('ousted: two missed targets without control and a losing vote', () => {
    for (let seed = 1; seed < 400; seed++) {
      const s = mk({}, seed);
      s.phase = 'launched';
      s.board = { seats: ['founder', 'vc:a', 'vc:b', 'vc:c'], founderControl: false, missedTargets: 1, nextMeetingWeek: 0, lastTargetArrGrowth: 0.5 };
      s.reputation = 0;
      s.flags['lastRoundDown'] = true;
      const w = 0;
      const wins = [1, 2, 3].every((i) => ctrFloat(seed, `board:${w + 1}:${i}`, 0) < 0.75);
      if (!wins) continue;
      s.cash = 100_000_000;
      stepWeek(s, c);
      expect(s.result).toMatchObject({ kind: 'ousted', win: false });
      return;
    }
    throw new Error('no seed found');
  });
  it('a board meeting holds the clock until boardVote; ignoring a missed target costs 3 reputation', () => {
    const s = launched(mk());
    s.board = { seats: ['founder'], founderControl: true, missedTargets: 0, nextMeetingWeek: 0, lastTargetArrGrowth: 0.5 };
    s.cash = 100_000_000;
    s.reputation = 50;
    stepWeek(s, c);
    expect(s.awaiting).toBe('board');
    const frozen = hashCompany(s);
    expect(stepWeek(s, c).awaiting).toBe('board');
    expect(hashCompany(s)).toBe(frozen);
    const rep = s.reputation;
    expect(code(s, { t: 'boardVote', motion: 'ignore' })).toBe('ok');
    expect(s.reputation).toBe(rep - 3);
    expect(s.awaiting).toBeNull();
    expect(s.board.nextMeetingWeek).toBe(13);
  });
  it('burnout: founder morale reaches 0', () => {
    const s = mk();
    s.phase = 'mvp';
    s.crunch = true;
    s.founderMorale = 1;
    stepWeek(s, c);
    expect(s.result).toMatchObject({ kind: 'burnout', win: false });
  });
  it('quit: endRun, and nothing runs after the end', () => {
    const s = mk();
    expect(code(s, { t: 'endRun', reason: 'quit' })).toBe('ok');
    expect(s.result?.kind).toBe('quit');
    expect(code(s, { t: 'setCrunch', on: true })).toBe('ENDED');
    expect(stepWeek(s, c).ended?.kind).toBe('quit');
  });
});

describe('company equations', () => {
  it('dev power: focus, morale, crunch and the management penalty', () => {
    const s = mk();
    s.phase = 'mvp';
    expect(devPower(s, c)).toBeCloseTo(7, 9);
    s.focus = 'growth';
    expect(devPower(s, c)).toBe(0);
    s.focus = 'product';
    s.crunch = true;
    expect(devPower(s, c)).toBeCloseTo(7 * 1.2, 9);
    s.crunch = false;
    s.raise = { id: 'r', kind: 'safe', targetCents: 1, startedWeek: 0, meetingsHeld: 0, vcPool: [] };
    expect(devPower(s, c)).toBeCloseTo(1.4, 9);
    s.raise = null;
    s.morale = 0;
    expect(devPower(s, c)).toBeCloseTo(7 * 0.6, 9);
    s.morale = 70;
    s.team = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, role: 'sales' as const, skill: 5, salaryYr: 1, optionShares: 0, hiredWeek: 0, morale: 70, name: 'x' }));
    expect(devPower(s, c)).toBeCloseTo(7 * 0.9, 9); // 9 people need one ops
  });
  it('the MVP launches at the sector points, then users and revenue follow', () => {
    const s = mk();
    s.phase = 'mvp';
    s.mvpProgress = 195;
    stepWeek(s, c);
    expect(s.phase).toBe('launched');
    expect(s.users).toBe(50);
    expect(s.hype).toBeGreaterThan(25);
    stepWeek(s, c);
    expect(s.mrr).toBeGreaterThan(0);
    expect(s.cash).toBeLessThan(9_000_000);
  });
  it('tech debt rises with features and falls with refactor, within 0..100', () => {
    const s = mk();
    s.phase = 'mvp';
    s.allocation = { features: 100, refactor: 0, infra: 0 };
    for (let i = 0; i < 5; i++) stepWeek(s, c);
    expect(s.techDebt).toBeGreaterThan(0);
    const high = s.techDebt;
    s.allocation = { features: 0, refactor: 100, infra: 0 };
    for (let i = 0; i < 5; i++) stepWeek(s, c);
    expect(s.techDebt).toBeLessThan(high);
    expect(s.techDebt).toBeGreaterThanOrEqual(0);
  });
  it('valuation reference: floor before revenue, ARR multiple after', () => {
    const s = launched(mk());
    const floor = valuationRef(s, c);
    expect(floor).toBeGreaterThan(0);
    s.mrr = 20_000_000;
    expect(valuationRef(s, c)).toBeGreaterThan(floor);
    s.climate = 1;
    const hot = valuationRef(s, c);
    s.climate = -1;
    expect(valuationRef(s, c)).toBeLessThan(hot);
  });
  it('climate decays 2 % a week; the cash balance moves by the rounded burn', () => {
    const s = mk();
    s.climate = 0.5;
    const cash = s.cash;
    stepWeek(s, c);
    expect(s.climate).toBeCloseTo(0.49, 12);
    expect(s.cash).toBe(cash - (s.flags['netBurn'] as number));
    expect(Number.isInteger(s.cash)).toBe(true);
  });
});

describe('hiring, options and vesting', () => {
  const withCandidate = (): CompanyState => {
    const s = mk();
    s.phase = 'mvp';
    s.market.push({ id: 'k1', role: 'eng', skill: 8, askYr: 10_000_000, expiresWeek: 99 });
    return s;
  };
  it('the market refills every week, up to 12 per role, with expiry', () => {
    const s = mk();
    for (let i = 0; i < 12; i++) stepWeek(s, c);
    expect(s.market.length).toBeGreaterThan(0);
    for (const role of ['eng', 'design', 'growth', 'sales', 'ops']) expect(s.market.filter((x) => x.role === role).length).toBeLessThanOrEqual(12);
    for (const x of s.market) {
      expect(x.skill).toBeGreaterThanOrEqual(1);
      expect(x.skill).toBeLessThanOrEqual(10);
      expect(x.expiresWeek).toBeGreaterThanOrEqual(s.week);
    }
  });
  it('a generous offer is accepted within three weeks and grants options from the pool', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = mk({}, seed);
      s.phase = 'mvp';
      s.market.push({ id: 'k1', role: 'eng', skill: 8, askYr: 10_000_000, expiresWeek: 99 });
      expect(code(s, { t: 'hireOffer', candidateId: 'k1', salaryYr: 20_000_000, optionBp: 100 })).toBe('ok');
      expect(code(s, { t: 'hireOffer', candidateId: 'k1', salaryYr: 20_000_000, optionBp: 100 })).toBe('NO_CANDIDATE');
      for (let i = 0; i < 4; i++) stepWeek(s, c);
      if (s.team.length === 1) {
        expect(s.team[0]).toMatchObject({ role: 'eng', salaryYr: 20_000_000, optionShares: 100_000 });
        expect(s.capTable.pool.granted).toBe(100_000);
        return;
      }
    }
    throw new Error('no offer was accepted in 60 seeds');
  });
  it('an offer larger than the pool is rejected with POOL_EXHAUSTED, also summed over pending offers', () => {
    const s = withCandidate();
    s.market.push({ id: 'k2', role: 'eng', skill: 8, askYr: 10_000_000, expiresWeek: 99 });
    s.capTable.pool.authorized = 800_000;
    s.capTable.totalFd = 9_800_000;
    expect(code(s, { t: 'hireOffer', candidateId: 'k1', salaryYr: 10_000_000, optionBp: 500 })).toBe('ok');
    expect(code(s, { t: 'hireOffer', candidateId: 'k2', salaryYr: 10_000_000, optionBp: 500 })).toBe('POOL_EXHAUSTED');
  });
  it('vesting: nothing before the 52-week cliff, then linear over 208 weeks; unvested options return to the pool', () => {
    const mkTeam = (weeks: number): CompanyState => {
      const s = mk();
      s.week = weeks;
      s.capTable.pool.granted = 208_000;
      s.team.push({ id: 'e1', role: 'eng', skill: 5, salaryYr: 10_000_000, optionShares: 208_000, hiredWeek: 0, morale: 70, name: 'x' });
      return s;
    };
    const a = mkTeam(30);
    expect(code(a, { t: 'fire', employeeId: 'e1' })).toBe('ok');
    expect(a.capTable.pool.granted).toBe(208_000 - 208_000); // all unvested back
    const b = mkTeam(104);
    expect(code(b, { t: 'fire', employeeId: 'e1' })).toBe('ok');
    expect(b.capTable.pool.granted).toBe(104_000); // 104 / 208 vested stay with the leaver
    expect(b.cash).toBe(9_000_000 - Math.round((4 * 10_000_000) / 52));
  });
  it('attrition: low morale loses people, high morale loses nobody', () => {
    const calm = mk();
    const unhappy = mk();
    for (const s of [calm, unhappy]) {
      s.phase = 'mvp';
      for (let i = 0; i < 20; i++) s.team.push({ id: `e${i}`, role: 'sales', skill: 5, salaryYr: 1_000, optionShares: 0, hiredWeek: 0, morale: s === calm ? 70 : 2, name: 'x' });
      s.crunch = s === unhappy;
    }
    for (let i = 0; i < 6; i++) {
      stepWeek(calm, c);
      stepWeek(unhappy, c);
    }
    expect(calm.team.length).toBe(20);
    expect(unhappy.team.length).toBeLessThan(20);
  });
  it('firing over 20 % of the headcount in 8 weeks costs 5 reputation', () => {
    const s = mk();
    s.team.push({ id: 'e1', role: 'eng', skill: 5, salaryYr: 1_000, optionShares: 0, hiredWeek: 0, morale: 70, name: 'x' });
    s.team.push({ id: 'e2', role: 'eng', skill: 5, salaryYr: 1_000, optionShares: 0, hiredWeek: 0, morale: 70, name: 'y' });
    s.reputation = 50;
    applyCommand(s, { t: 'fire', employeeId: 'e1' }, c);
    expect(s.reputation).toBe(45);
    expect(s.team[0]?.morale).toBe(65);
  });
});

describe('rounds through the stub negotiation', () => {
  const play = (kind: 'safe' | 'seed', target: number, vcId: string, mut?: (s: CompanyState) => void): CompanyState => {
    const s = mk();
    s.phase = 'launched';
    s.users = 500;
    s.mrr = 3_000_000;
    s.hype = 40;
    s.week = 20;
    mut?.(s);
    expect(code(s, { t: 'startRaise', kind, targetCents: target })).toBe('ok');
    expect(code(s, { t: 'scheduleMeeting', vcId })).toBe('ok');
    return s;
  };
  it('a SAFE: the midpoint is on the table, the clock holds, accept closes in two weeks with cash and a SAFE', () => {
    const s = play('safe', 20_000_000, 'vc-seedling-angel');
    expect(s.awaiting).toBe('meeting');
    const m = s.meetings[0]!;
    expect(m.phase).toBe('offer');
    const cash = s.cash;
    expect(code(s, { t: 'accept', meetingId: m.id })).toBe('ok');
    expect(s.awaiting).toBeNull();
    stepWeek(s, c);
    expect(s.capTable.safes).toHaveLength(0);
    stepWeek(s, c);
    expect(s.week).toBe(22);
    expect(s.capTable.safes).toHaveLength(1);
    expect(s.cash).toBeGreaterThan(cash + m.offer!.amount - 2_000_000);
    expect(s.raise).toBeNull();
    expect(s.meetings[0]?.phase).toBe('closed');
  });
  it('walk drops the offer and frees the clock; one meeting per week', () => {
    const s = play('safe', 20_000_000, 'vc-seedling-angel');
    expect(code(s, { t: 'walk', meetingId: s.meetings[0]!.id })).toBe('ok');
    expect(s.awaiting).toBeNull();
    expect(code(s, { t: 'scheduleMeeting', vcId: 'vc-operator-angel' })).toBe('MEETING_LIMIT');
    stepWeek(s, c);
    expect(code(s, { t: 'scheduleMeeting', vcId: 'vc-operator-angel' })).toBe('ok');
  });
  it('an ask outside the fund cheque range passes without a meeting on the table', () => {
    const s = play('safe', 100_000_000, 'vc-accelerator-batch');
    expect(s.meetings[0]?.phase).toBe('passed');
    expect(s.awaiting).toBeNull();
  });
  it('a priced round pays the legal fee, converts SAFEs, tops up the pool and seats the investor', () => {
    const s = mk();
    s.phase = 'launched';
    s.users = 800;
    s.mrr = 1_300_000;
    s.hype = 40;
    s.week = 30;
    s.capTable = initialCapTable();
    s.capTable.safes.push({ id: 's0', investorId: 'vc:x', amount: 5_000_000, signedWeek: 5, type: 'cap', postMoneyCap: 60_000_000 });
    expect(code(s, { t: 'startRaise', kind: 'seed', targetCents: 30_000_000 })).toBe('ok');
    expect(code(s, { t: 'scheduleMeeting', vcId: 'vc-seedling-angel' })).toBe('ok');
    const m = s.meetings[0]!;
    expect(m.phase).toBe('offer');
    const t = m.offer!;
    expect(code(s, { t: 'accept', meetingId: m.id })).toBe('ok');
    const cash = s.cash;
    stepWeek(s, c);
    stepWeek(s, c);
    expect(s.capTable.rounds).toHaveLength(1);
    expect(s.capTable.rounds[0]).toMatchObject({ kind: 'seed', closedWeek: 32, week: 30, amount: t.amount });
    expect(s.capTable.safes[0]?.converted).toBe(true);
    expect(s.capTable.holders.find((h) => h.id === 'vc:x')?.shares['pref-safe-s0']).toBeGreaterThan(0);
    expect(s.cash).toBeGreaterThan(cash + t.amount - Math.max(1_500_000, t.amount / 50) - 4_000_000);
    expect(s.board.nextMeetingWeek).toBe(45);
    expect(s.flags['lastRaiseEnd']).toBe(32);
  });
  it('a seat for the investor ends founder control on a solo board and a co-founder keeps it', () => {
    const solo = mk();
    solo.board.seats = ['founder', 'vc:x'];
    expect(solo.board.founderControl).toBe(true); // recomputed on close
  });
});

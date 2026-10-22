/**
 * Hiring, vesting, morale, attrition, founder and board (08-tycoon-finance.md section 13). All draws are counter draws.
 */
import { ctrU32 } from '../rng.ts';
import { mulDivFloor, poolAvailable } from './finance/index.ts';
import { clamp, headcount } from './company.ts';
import { ctrFloat, ctrNormal } from './rand.ts';
import { ROLES, type Candidate, type CompanyState, type Employee, type TycoonContent } from './types.ts';

/** Option shares an offer of `optionBp` of the fully diluted count is worth now. */
export const optionSharesFor = (s: CompanyState, optionBp: number): number => mulDivFloor(optionBp, s.capTable.totalFd, 10_000);

/** Option shares promised by offers that have not resolved yet. */
export function pendingOptionShares(s: CompanyState): number {
  let n = 0;
  for (const o of s.offers) n += optionSharesFor(s, o.optionBp);
  return n;
}

function nextSeq(s: CompanyState, key: string): number {
  const n = (typeof s.flags[key] === 'number' ? (s.flags[key] as number) : 0) + 1;
  s.flags[key] = n;
  return n;
}

function personName(s: CompanyState, c: TycoonContent, id: string): string {
  const { first, last } = c.archetypes.names;
  const f = first[ctrU32(s.setup.seed, `name:${id}`, 0) % first.length] ?? 'Ari';
  const l = last[ctrU32(s.setup.seed, `name:${id}`, 1) % last.length] ?? 'Alder';
  return `${f} ${l}`;
}

/** Weekly refresh of the candidate market (section 13.1, point 1). */
export function refreshMarket(s: CompanyState, c: TycoonContent): void {
  const h = c.balance.hiring;
  s.market = s.market.filter((x) => x.expiresWeek > s.week || s.offers.some((o) => o.candidateId === x.id));
  ROLES.forEach((role, ri) => {
    let count = 0;
    for (const x of s.market) if (x.role === role) count++;
    for (let slot = 0; slot < h.perRolePerWeek; slot++) {
      const idx = ri * h.perRolePerWeek + slot;
      const stream = `hire:${s.week}:${idx}`;
      if (ctrFloat(s.setup.seed, stream, 0) >= h.appearP) continue;
      if (count >= h.poolPerRole) continue;
      const skill = clamp(Math.round(ctrNormal(s.setup.seed, stream, 1, h.skillMean, h.skillSd) + s.reputation / h.reputationDiv), 1, 10);
      const base = c.archetypes.roleBaseYrCents[role];
      const cand: Candidate = {
        id: `c${s.week}-${idx}`,
        role,
        skill,
        askYr: Math.round(base * (h.askBase + h.askSlope * skill) * (1 + h.askClimate * s.climate)),
        expiresWeek: s.week + h.expiryWeeks,
      };
      s.market.push(cand);
      count++;
    }
  });
}

/** Offer resolution (section 13.1, point 2): due offers are accepted or declined. Returns nothing; the state is updated. */
export function resolveOffers(s: CompanyState, c: TycoonContent): void {
  const h = c.balance.hiring;
  const due = s.offers.filter((o) => o.resolveWeek <= s.week);
  if (due.length === 0) return;
  s.offers = s.offers.filter((o) => o.resolveWeek > s.week);
  for (const o of due) {
    const cand = s.market.find((x) => x.id === o.candidateId);
    s.market = s.market.filter((x) => x.id !== o.candidateId);
    if (!cand) continue;
    const a = h.accept;
    const p = clamp(a.base + a.salarySlope * (o.salaryYr / cand.askYr - 1) + Math.min(a.optionCap, o.optionBp / a.optionDiv) + s.reputation / a.reputationDiv, a.min, a.max);
    if (ctrFloat(s.setup.seed, `hireo:${cand.id}`, 1) >= p) continue;
    const shares = optionSharesFor(s, o.optionBp);
    if (shares > poolAvailable(s.capTable) || s.team.length >= c.balance.sim.maxEmployees) continue;
    s.capTable.pool.granted += shares;
    const id = `e${nextSeq(s, 'empSeq')}`;
    const e: Employee = { id, role: cand.role, skill: cand.skill, salaryYr: o.salaryYr, optionShares: shares, hiredWeek: s.week, morale: c.balance.setup.teamMorale, name: personName(s, c, id) };
    s.team.push(e);
  }
}

/** Resolve week of a new offer: 1 to 3 weeks (counter draw). */
export function offerResolveWeek(s: CompanyState, c: TycoonContent, candidateId: string): number {
  const h = c.balance.hiring;
  return s.week + h.offerMinWeeks + Math.floor(ctrFloat(s.setup.seed, `hireo:${candidateId}`, 0) * h.offerSpanWeeks);
}

/** Removes an employee: unvested options return to the pool, vested ones stay with the leaver as common (section 13.1, point 3). */
export function removeEmployee(s: CompanyState, c: TycoonContent, id: string): Employee | null {
  const i = s.team.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const e = s.team[i] as Employee;
  s.team.splice(i, 1);
  const h = c.balance.hiring;
  const weeks = s.week - e.hiredWeek;
  const vested = weeks < h.cliffWeeks ? 0 : Math.floor((e.optionShares * Math.min(weeks, h.vestWeeks)) / h.vestWeeks);
  s.capTable.pool.granted -= e.optionShares - vested;
  return e;
}

/** `fire`: severance, morale and the over-20 % rule (section 13.1, point 5). */
export function fireEmployee(s: CompanyState, c: TycoonContent, id: string): boolean {
  const before = headcount(s);
  const e = removeEmployee(s, c, id);
  if (!e) return false;
  const h = c.balance.hiring;
  s.cash -= Math.round((h.severanceWeeks * e.salaryYr) / 52);
  for (const t of s.team) t.morale = clamp(t.morale + h.moraleFire, 0, 100);
  s.flags[`fired.${s.week}`] = ((s.flags[`fired.${s.week}`] as number | undefined) ?? 0) + 1;
  let recent = 0;
  for (const k of Object.keys(s.flags)) {
    if (!k.startsWith('fired.')) continue;
    const w = Number(k.slice(6));
    if (s.week - w <= h.fireWindowWeeks) recent += s.flags[k] as number;
    else delete s.flags[k];
  }
  if (recent > h.fireShare * before) s.reputation = clamp(s.reputation - h.fireReputation, 0, 100);
  return true;
}

/** Morale reversion, crunch, attrition; refreshes the team mean (section 13.1, point 4). */
export function moraleAndAttrition(s: CompanyState, c: TycoonContent): void {
  const h = c.balance.hiring;
  const leavers: string[] = [];
  for (const e of s.team) {
    e.morale = e.morale + h.moraleRevert * (c.balance.company.moraleRef - e.morale);
    if (s.crunch) e.morale += h.moraleCrunch;
    e.morale = clamp(e.morale, 0, 100);
    if (e.morale < h.attritionBelow) {
      const p = ((h.attritionBelow - e.morale) / h.attritionBelow) * h.attritionRate;
      if (ctrFloat(s.setup.seed, `attr:${s.week}:${e.id}`, 0) < p) leavers.push(e.id);
    }
  }
  for (const id of leavers) removeEmployee(s, c, id);
  s.morale = syncMorale(s);
}

export function syncMorale(s: CompanyState): number {
  if (s.team.length === 0) return s.founderMorale;
  let n = 0;
  for (const e of s.team) n += e.morale;
  return n / s.team.length;
}

/** Founder morale (section 13.2). Returns true when it reached 0 (burnout). */
export function founderStep(s: CompanyState, c: TycoonContent): boolean {
  const f = c.balance.founder;
  if (s.crunch) s.founderMorale += f.crunch;
  if (s.focus === 'rest') s.founderMorale += f.rest;
  s.founderMorale = clamp(s.founderMorale, 0, 100);
  return s.founderMorale <= 0;
}

// ---------------------------------------------------------------------------------------------------------------- board

export function recomputeControl(s: CompanyState): void {
  let founders = 0;
  let others = 0;
  for (const seat of s.board.seats) {
    if (seat === 'founder') founders++;
    else others++;
  }
  s.board.founderControl = founders > others;
}

/** Result of the board check of a week. `ousted` ends the run; `meeting` holds the clock until `boardVote`. */
export function boardStep(s: CompanyState, c: TycoonContent, mrrGrowth: number): 'none' | 'meeting' | 'ousted' {
  const nm = s.board.nextMeetingWeek;
  if (nm === null || s.week < nm) return 'none';
  const b = c.balance.board;
  const missed = mrrGrowth < s.board.lastTargetArrGrowth;
  s.board.missedTargets = missed ? s.board.missedTargets + 1 : 0;
  s.flags['boardMissed'] = missed;
  recomputeControl(s);
  const lastKind = typeof s.flags['lastRoundKind'] === 'string' ? s.flags['lastRoundKind'] : 'seed';
  s.board.nextMeetingWeek = nm + c.balance.sim.boardIntervalWeeks;
  const target = (b.targets as Record<string, number>)[String(lastKind)] ?? b.targets.seed;
  s.board.lastTargetArrGrowth = target;
  if (missed && s.board.missedTargets >= 2 && !s.board.founderControl) {
    const down = s.flags['lastRoundDown'] === true ? 1 : 0;
    const p = clamp(b.oust.perMiss * s.board.missedTargets + b.oust.reputation * (1 - s.reputation / 100) + b.oust.downRound * down, 0, b.oust.max);
    let votes = 0;
    s.board.seats.forEach((seat, i) => {
      if (seat === 'founder') return;
      if (ctrFloat(s.setup.seed, `board:${s.week}:${i}`, 0) < p) votes++;
    });
    if (votes * 2 > s.board.seats.length) return 'ousted';
  }
  return 'meeting';
}

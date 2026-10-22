/**
 * Company equations of Business Tycoon (08-tycoon.md section 5.3, 5.4 and 5.7): dev power, product, market, revenue, costs,
 * valuation reference, hash. Only `+ - * /`, `Math.floor/round/min/max/abs` here; no `Math.pow`, no `**`, no transcendentals.
 */
import { fnv64Hex } from '../hash.ts';
import { canonicalize } from '../json.ts';
import type { CompanyState, Employee, FounderArchetype, RoleId, SectorDef, TycoonContent } from './types.ts';

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export interface RunMods {
  cacMul: number;
  churnMul: number;
  payRateMul: number;
  arpuMul: number;
  devPowerMul: number;
  burnMul: number;
  multipleMul: number;
}

/** The run multipliers of the thesis card (1 for any missing key). Events add their own in M09a2. */
export function mods(s: CompanyState, c: TycoonContent): RunMods {
  const t = c.theses.find((x) => x.id === s.setup.thesis);
  const m = t?.mods ?? {};
  return {
    cacMul: m.cacMul ?? 1,
    churnMul: m.churnMul ?? 1,
    payRateMul: m.payRateMul ?? 1,
    arpuMul: m.arpuMul ?? 1,
    devPowerMul: m.devPowerMul ?? 1,
    burnMul: m.burnMul ?? 1,
    multipleMul: m.multipleMul ?? 1,
  };
}

export const sectorOf = (s: CompanyState, c: TycoonContent): SectorDef => {
  const d = c.sectors[s.setup.sector];
  if (!d) throw new Error(`tycoon: unknown sector ${s.setup.sector}`);
  return d;
};

export const founderCount = (s: CompanyState): number => (s.setup.coFounder ? 2 : 1);
export const headcount = (s: CompanyState): number => s.team.length + founderCount(s);

export function skillSum(team: readonly Employee[], role: RoleId): number {
  let n = 0;
  for (const e of team) if (e.role === role) n += e.skill;
  return n;
}
export const roleCount = (team: readonly Employee[], role: RoleId): number => {
  let n = 0;
  for (const e of team) if (e.role === role) n++;
  return n;
};

export function founderDev(s: CompanyState, c: TycoonContent): number {
  const a = c.archetypes.founders[s.setup.founder as FounderArchetype];
  return a.devPower + (s.setup.coFounder ? c.balance.company.cofounderDev : 0);
}

/** Dev power of a week (section 5.3). */
export function devPower(s: CompanyState, c: TycoonContent): number {
  const b = c.balance.company;
  let focusFactor = s.focus === 'product' ? 1 : 0;
  if (s.raise !== null) focusFactor = focusFactor * b.raiseFocus;
  let eng = 0;
  let design = 0;
  for (const e of s.team) {
    if (e.role === 'eng') eng += e.skill;
    else if (e.role === 'design') design += e.skill;
  }
  const raw = founderDev(s, c) * focusFactor + b.engWeight * eng + b.designWeight * design;
  const moraleF = b.moraleBase + b.moraleSlope * Math.min(1, s.morale / b.moraleRef);
  const crunchF = s.crunch ? b.crunchMul : 1;
  let dp = raw * moraleF * crunchF * mods(s, c).devPowerMul;
  const missingOps = Math.max(0, Math.floor(headcount(s) / b.opsPerHeads) - roleCount(s.team, 'ops'));
  for (let i = 0; i < missingOps; i++) dp = dp * b.opsPenalty;
  return dp;
}

export const priceFactor = (s: CompanyState, c: TycoonContent): number => c.balance.company.priceMul[s.priceLevel];

/** Revenue per week from the current MRR. */
export const revenueWeek = (s: CompanyState, c: TycoonContent): number => s.mrr / c.balance.company.monthWeeks;

/** Salaries, infrastructure, marketing and office for one week, times the thesis burn multiplier (BD-M09a1-05). */
export function expensesWeek(s: CompanyState, c: TycoonContent): number {
  const b = c.balance.company;
  const sec = sectorOf(s, c);
  let salaries = (c.balance.setup.founderSalaryYrCents * founderCount(s)) / 52;
  for (const e of s.team) salaries += e.salaryYr / 52;
  const infra = s.users * sec.infraPerUserWeekCents * (1 - b.infraReduction * Math.min(1, s.allocation.infra / b.infraFullAlloc));
  return (salaries + infra + s.marketing + b.office[s.office]) * mods(s, c).burnMul;
}

/** Net burn per week in cents (negative when profitable). */
export const netBurnWeek = (s: CompanyState, c: TycoonContent): number => expensesWeek(s, c) - revenueWeek(s, c);

export function runwayWeeks(s: CompanyState, c: TycoonContent): number {
  const burn = typeof s.flags['netBurn'] === 'number' ? (s.flags['netBurn'] as number) : netBurnWeek(s, c);
  if (burn <= 0) return 999;
  return Math.max(0, Math.floor(s.cash / burn));
}

/** Valuation reference of section 5.4, in cents. */
export function valuationRef(s: CompanyState, c: TycoonContent): number {
  const v = c.balance.valuation;
  const sec = sectorOf(s, c);
  const arr = 12 * s.mrr;
  const old = s.mrrHistory.length >= 14 ? (s.mrrHistory[s.mrrHistory.length - 14] as number) : 0;
  const g13 = old < v.minOldMrrCents ? 0 : s.mrr / old - 1;
  const growthMod = 1 + v.growthWeight * clamp(g13, v.growthMin, v.growthMax);
  const hypeMod = v.hypeBase + s.hype / v.hypeDiv;
  const base = arr * sec.multiple * growthMod * hypeMod * (1 + v.climateWeight * s.climate) * mods(s, c).multipleMul;
  const floor = v.floorBaseCents * (1 + headcount(s)) * (v.floorHypeBase + s.hype / 100) * (s.phase === 'launched' ? v.floorLaunchMul : 1);
  return Math.round(Math.max(base, floor));
}

/** 13-week MRR growth (0 when the older value is below the floor). */
export function mrrGrowth13(s: CompanyState, c: TycoonContent): number {
  const old = s.mrrHistory.length >= 14 ? (s.mrrHistory[s.mrrHistory.length - 14] as number) : 0;
  return old < c.balance.valuation.minOldMrrCents ? 0 : s.mrr / old - 1;
}

/** FNV-1a 64 over the canonical JSON of the whole state, 16 lowercase hex digits (two u32 lanes). */
export function hashCompany(s: CompanyState): string {
  return fnv64Hex(canonicalize(s));
}

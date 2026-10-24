/**
 * Deterministic term-sheet envelope (08-tycoon-finance.md section 8). A pure function of sim state: no randomness, no
 * transcendentals. The LLM never sees a number outside it and the sim never accepts one.
 */
import type { Cents, LiqPref, RoundKind, Terms } from './types.ts';

export type VcStyle = 'standard' | 'hardball' | 'founder_friendly' | 'herd' | 'contrarian';
export type RedFlag = 'noFounderControl' | 'lowRunway' | 'highTechDebt';

export interface VcProfile {
  id: string;
  style: VcStyle;
  /** -1..1 */
  valuationBias: number;
  checkMin: Cents;
  checkMax: Cents;
  predatoryAllowed: boolean;
  redFlags: RedFlag[];
}

export interface EnvelopeCompany {
  week: number;
  round: RoundKind;
  /** The raise target W in cents. */
  targetCents: Cents;
  /** valuationRef of part A section 5.4, in cents. */
  valuationRef: Cents;
  reputation: number;
  techDebt: number;
  hype: number;
  runwayWeeks: number;
  founderControl: boolean;
}

export interface TermSheetEnvelope {
  vcId: string;
  round: RoundKind;
  validUntilWeek: number;
  amount: [Cents, Cents];
  preMoney: [Cents, Cents];
  poolTargetBp: [number, number];
  boardSeat: boolean | 'negotiable';
  liq: LiqPref;
  safeCap?: [Cents, Cents];
  /** At most 1,500 (15 %). */
  fomoBonusBp: number;
  midpoint: Terms;
  walkAway: { reason: 'ask_too_high' | 'ask_too_low' | 'red_flag' | 'mood_floor'; ok: false } | null;
}

export interface Pass {
  pass: true;
  reason: 'ask_too_high' | 'ask_too_low' | 'valuation_gap' | 'dilution_gap';
}

/** Constants of `config/tycoon.balance.json` under `finance` (section 8; schema `tycoon.balance.v1`). */
export interface FinanceConfig {
  valLoBase: number;
  valHiBase: number;
  biasWeight: number;
  climateWeight: number;
  fomoPerSheet: number;
  fomoCap: number;
  amountLo: number;
  amountHi: number;
  dilutionTarget: { seed: number; a: number; b: number; c: number };
  dilutionLo: number;
  dilutionHi: number;
  pool: { seed: [number, number]; a: [number, number]; b: [number, number]; c: [number, number] };
  predatoryClimate: number;
  predatoryRunwayWeeks: number;
  predatoryLure: number;
  predatoryLiq: LiqPref;
  walk: { reputation: number; techDebt: number; mood: number };
  validWeeks: number;
  styleShift: { hardball: number; founder_friendly: number; herdWithRival: number; herdAlone: number; contrarianLowHype: number; contrarianHypeBelow: number };
  moodBase: number;
  /** Closing takes this many weeks. */
  closingWeeks: number;
}

export const DEFAULT_FINANCE: FinanceConfig = {
  valLoBase: 0.8,
  valHiBase: 1.1,
  biasWeight: 0.1,
  climateWeight: 0.1,
  fomoPerSheet: 0.06,
  fomoCap: 0.15,
  amountLo: 0.6,
  amountHi: 1.25,
  dilutionTarget: { seed: 0.18, a: 0.2, b: 0.15, c: 0.12 },
  dilutionLo: 0.75,
  dilutionHi: 1.35,
  pool: { seed: [800, 1200], a: [1000, 1200], b: [500, 800], c: [300, 500] },
  predatoryClimate: -0.3,
  predatoryRunwayWeeks: 12,
  predatoryLure: 0.1,
  predatoryLiq: { multiple: 2, participating: true },
  walk: { reputation: 20, techDebt: 80, mood: 10 },
  validWeeks: 2,
  styleShift: { hardball: -0.15, founder_friendly: 0.15, herdWithRival: 0.1, herdAlone: -0.1, contrarianLowHype: 0.1, contrarianHypeBelow: 30 },
  moodBase: 50,
  closingWeeks: 2,
};

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (lo: number, hi: number, t: number): number => Math.round(lo + (hi - lo) * t);

function redFlagTrue(f: RedFlag, c: EnvelopeCompany): boolean {
  switch (f) {
    case 'noFounderControl':
      return !c.founderControl;
    case 'lowRunway':
      return c.runwayWeeks < 12;
    case 'highTechDebt':
      return c.techDebt > 60;
  }
}

/** Board seats a closed round of this kind adds when the VC gets its seat (section 5, board row). */
export function boardSeatsFor(kind: RoundKind, seat: boolean): number {
  if (!seat) return 0;
  return kind === 'a' ? 1 : kind === 'b' || kind === 'c' ? 2 : 0;
}

export function termSheetEnvelope(
  company: EnvelopeCompany,
  vc: VcProfile,
  climate: number,
  competing: number,
  mood: number,
  cfg: FinanceConfig = DEFAULT_FINANCE,
): TermSheetEnvelope | Pass {
  const kind = company.round;
  // 3. amount band
  const W = company.targetCents;
  const aLo = Math.max(Math.round(cfg.amountLo * W), vc.checkMin);
  const aHi = Math.min(Math.round(cfg.amountHi * W), vc.checkMax);
  if (aLo > aHi) return { pass: true, reason: cfg.amountLo * W > vc.checkMax ? 'ask_too_high' : 'ask_too_low' };

  // 2. valuation band with FOMO
  const n = competing > 0 ? competing : 0;
  const fomo = Math.min(cfg.fomoCap, cfg.fomoPerSheet * n);
  const fomoBonusBp = Math.round(10_000 * fomo);
  const V = company.valuationRef;
  const shift = cfg.biasWeight * vc.valuationBias + cfg.climateWeight * climate;
  let vLo = V * (cfg.valLoBase + shift);
  let vHi = V * (cfg.valHiBase + shift) * (1 + fomo);

  let preLo: number;
  let preHi: number;
  let poolBand: [number, number] = [0, 0];
  let safeCap: [Cents, Cents] | undefined;
  const aMid = (aLo + aHi) / 2;
  if (kind === 'safe') {
    preLo = Math.round(vLo);
    preHi = Math.round(vHi);
    if (preLo > preHi || preHi <= 0) return { pass: true, reason: 'valuation_gap' };
    safeCap = [preLo, preHi];
  } else {
    // 4. dilution band intersected with the valuation band
    const d = cfg.dilutionTarget[kind];
    const dLo = aMid * (1 / (cfg.dilutionHi * d) - 1);
    const dHi = aMid * (1 / (cfg.dilutionLo * d) - 1);
    vLo = Math.max(vLo, dLo);
    vHi = Math.min(vHi, dHi);
    if (vHi <= 0 || vLo > vHi) return { pass: true, reason: Math.max(V * (cfg.valLoBase + shift), 0) > dHi ? 'dilution_gap' : 'valuation_gap' };
    preLo = Math.round(vLo);
    preHi = Math.round(vHi);
    poolBand = cfg.pool[kind];
  }

  // 6. liquidation preference: only a predatory-allowed VC under stress offers the lure
  const stressed = climate < cfg.predatoryClimate || company.runwayWeeks < cfg.predatoryRunwayWeeks;
  const predatory = vc.predatoryAllowed && stressed && kind !== 'safe';
  const liq: LiqPref = predatory ? { ...cfg.predatoryLiq } : { multiple: 1, participating: false };
  if (predatory) {
    preLo = Math.round(preLo * (1 + cfg.predatoryLure));
    preHi = Math.round(preHi * (1 + cfg.predatoryLure));
  }

  // 5. board
  const boardSeat: boolean | 'negotiable' = kind === 'a' ? 'negotiable' : kind === 'b' || kind === 'c' ? true : false;

  // 7. position inside the band
  const s = cfg.styleShift;
  let styleShift = 0;
  switch (vc.style) {
    case 'hardball':
      styleShift = s.hardball;
      break;
    case 'founder_friendly':
      styleShift = s.founder_friendly;
      break;
    case 'herd':
      styleShift = n > 0 ? s.herdWithRival : s.herdAlone;
      break;
    case 'contrarian':
      styleShift = company.hype < s.contrarianHypeBelow ? s.contrarianLowHype : 0;
      break;
    case 'standard':
      break;
  }
  const t = clamp01(0.5 + (mood - cfg.moodBase) / 100 + styleShift);
  const midBoard = typeof boardSeat === 'boolean' ? boardSeat : t < 0.5;
  const midpoint: Terms = {
    amount: lerp(aLo, aHi, t),
    preMoney: lerp(preLo, preHi, t),
    poolTargetBp: kind === 'safe' ? 0 : lerp(poolBand[0], poolBand[1], t),
    boardSeat: midBoard,
    liq,
  };

  // 8. walk-away
  let walkAway: TermSheetEnvelope['walkAway'] = null;
  if (company.reputation < cfg.walk.reputation || company.techDebt > cfg.walk.techDebt || vc.redFlags.some((f) => redFlagTrue(f, company))) walkAway = { reason: 'red_flag', ok: false };
  else if (mood < cfg.walk.mood) walkAway = { reason: 'mood_floor', ok: false };

  const env: TermSheetEnvelope = {
    vcId: vc.id,
    round: kind,
    validUntilWeek: company.week + cfg.validWeeks,
    amount: [aLo, aHi],
    preMoney: [preLo, preHi],
    poolTargetBp: poolBand,
    boardSeat,
    liq,
    fomoBonusBp,
    midpoint,
    walkAway,
  };
  if (safeCap) env.safeCap = safeCap;
  return env;
}

/** Clamps a proposal into the envelope field by field (section 11, point 3). Returns the clamped terms and the names of the fields changed. */
export function clampTerms(p: Terms, env: TermSheetEnvelope): { terms: Terms; clamped: string[] } {
  const clamped: string[] = [];
  const c = (name: string, v: number, [lo, hi]: [number, number]): number => {
    const r = v < lo ? lo : v > hi ? hi : v;
    if (r !== v) clamped.push(name);
    return r;
  };
  const amount = c('amount', p.amount, env.amount);
  const preMoney = c('preMoney', p.preMoney, env.preMoney);
  const poolTargetBp = c('poolTargetBp', p.poolTargetBp, env.poolTargetBp);
  let boardSeat = p.boardSeat;
  if (env.boardSeat === false && boardSeat) {
    boardSeat = false;
    clamped.push('boardSeat');
  }
  if (env.boardSeat === true && !boardSeat) {
    boardSeat = true;
    clamped.push('boardSeat');
  }
  if (p.liq.multiple !== env.liq.multiple || p.liq.participating !== env.liq.participating) clamped.push('liq');
  return { terms: { amount, preMoney, poolTargetBp, boardSeat, liq: { ...env.liq } }, clamped };
}

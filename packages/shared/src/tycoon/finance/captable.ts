/**
 * Cap table, post-money SAFE conversion and priced round with option-pool shuffle (08-tycoon-finance.md sections 3 to 5).
 *
 * All share counts are integers. `a * b / c` that can pass 2^53 goes through `mulDivFloor` / `mulDivCeil`; the ratios that only feed
 * a floor (`amount / cap`) use IEEE doubles with + - * / only, which are bit-stable across engines (C02 rule 2).
 */
import { mulDivCeil, mulDivFloor } from './muldiv.ts';
import {
  BASE_FOUNDER_SHARES,
  BASE_POOL_SHARES,
  MAX_CONVERT_ITERATIONS,
  SAFE_STACK_F_LIMIT,
  roundClass,
  safeClass,
  type CapTable,
  type Cents,
  type FinanceError,
  type Holder,
  type LiqPref,
  type PricedRound,
  type RoundKind,
  type Safe,
  type ShareClass,
} from './types.ts';

const fail = (code: FinanceError['code'], detail?: string): FinanceError => (detail === undefined ? { ok: false, code } : { ok: false, code, detail });

/** The base table of the spec: founder 9,000,000 common (a co-founder splits it 5.4 M / 3.6 M), pool 1,000,000, FD0 10,000,000. */
export function initialCapTable(coFounder = false): CapTable {
  const holders: Holder[] = coFounder
    ? [
        { id: 'f1', kind: 'founder', shares: { common: 5_400_000 } },
        { id: 'f2', kind: 'founder', shares: { common: BASE_FOUNDER_SHARES - 5_400_000 } },
      ]
    : [{ id: 'f1', kind: 'founder', shares: { common: BASE_FOUNDER_SHARES } }];
  return { holders, pool: { authorized: BASE_POOL_SHARES, granted: 0 }, safes: [], rounds: [], totalFd: BASE_FOUNDER_SHARES + BASE_POOL_SHARES };
}

export function cloneTable(t: CapTable): CapTable {
  return {
    holders: t.holders.map((h) => ({ id: h.id, kind: h.kind, shares: { ...h.shares } })),
    pool: { authorized: t.pool.authorized, granted: t.pool.granted },
    safes: t.safes.map((s) => ({ ...s })),
    rounds: t.rounds.map((r) => ({ ...r, liq: { ...r.liq }, invested: { ...r.invested } })),
    totalFd: t.totalFd,
  };
}

export function poolAvailable(t: CapTable): number {
  return t.pool.authorized - t.pool.granted;
}

/** Shares held by holders, all classes (the pool is not included). */
export function issuedShares(t: CapTable): number {
  let n = 0;
  for (const h of t.holders) for (const k of Object.keys(h.shares)) n += h.shares[k as ShareClass] ?? 0;
  return n;
}

/** Fully diluted count before any round: issued + the whole pool (granted and available). */
export function fdCount(t: CapTable): number {
  return issuedShares(t) + t.pool.authorized;
}

/** Share invariant (section 2, rule 5): holders + pool.available + pool.granted === totalFd. Returns an error value; `throwing` turns it into an exception for tests. */
export function assertConserved(t: CapTable, throwing = false): FinanceError | null {
  const sum = issuedShares(t) + poolAvailable(t) + t.pool.granted;
  let bad: string | null = null;
  if (sum !== t.totalFd) bad = `sum ${sum} !== totalFd ${t.totalFd}`;
  else if (t.pool.granted < 0 || t.pool.granted > t.pool.authorized) bad = 'pool out of range';
  else
    for (const h of t.holders)
      for (const k of Object.keys(h.shares)) {
        const v = h.shares[k as ShareClass] ?? 0;
        if (!Number.isInteger(v) || v < 0) bad = `holder ${h.id} class ${k} has ${v}`;
      }
  if (bad === null) return null;
  if (throwing) throw new Error(`CAPTABLE_INVARIANT: ${bad}`);
  return fail('CAPTABLE_INVARIANT', bad);
}

export function holderOf(t: CapTable, id: string, kind: Holder['kind']): Holder {
  let h = t.holders.find((x) => x.id === id);
  if (!h) {
    h = { id, kind, shares: {} as Record<ShareClass, number> };
    t.holders.push(h);
  }
  return h;
}

const bySigned = (a: Safe, b: Safe): number => (a.signedWeek !== b.signedWeek ? a.signedWeek - b.signedWeek : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface Effective {
  safe: Safe;
  cap: Cents | null;
  disc: number;
}

/** Resolves caps and discounts. An MFN SAFE takes the lowest cap and the best (lowest) discountBp among SAFEs signed after it (BD-M09a1-03). */
function resolve(safes: Safe[]): Effective[] {
  const sorted = [...safes].sort(bySigned);
  return sorted.map((s, i) => {
    if (s.type === 'mfn') {
      let cap: Cents | null = null;
      let disc = 10_000;
      for (let j = i + 1; j < sorted.length; j++) {
        const o = sorted[j] as Safe;
        if (o.postMoneyCap !== undefined && (cap === null || o.postMoneyCap < cap)) cap = o.postMoneyCap;
        if (o.discountBp !== undefined && o.discountBp < disc) disc = o.discountBp;
      }
      return { safe: s, cap, disc };
    }
    const cap = s.type === 'cap' || s.type === 'capDiscount' ? (s.postMoneyCap ?? null) : null;
    const disc = s.type === 'discount' || s.type === 'capDiscount' ? (s.discountBp ?? 10_000) : 10_000;
    return { safe: s, cap, disc };
  });
}

function stackF(eff: Effective[]): number {
  let F = 0;
  for (const e of eff) if (e.cap !== null && e.cap > 0) F += e.safe.amount / e.cap;
  return F;
}

/** Adds a SAFE, or returns `SAFE_STACK_LIMIT` when the capped SAFEs would reach F >= 0.5. The table is not touched on error. */
export function addSafe(t: CapTable, safe: Safe): { ok: true; table: CapTable } | FinanceError {
  if (!(safe.amount > 0) || !Number.isInteger(safe.amount)) return fail('BAD_INPUT', 'amount');
  const open = t.safes.filter((s) => s.converted !== true);
  const eff = resolve([...open, safe]);
  if (stackF(eff) >= SAFE_STACK_F_LIMIT) return fail('SAFE_STACK_LIMIT');
  const next = cloneTable(t);
  next.safes.push({ ...safe });
  return { ok: true, table: next };
}

export interface RoundInput {
  preMoney: Cents;
  amount: Cents;
  /** Available pool as bp of post-money FD. */
  poolTargetBp: number;
}

export interface Conversion {
  ok: true;
  sharesBySafe: Record<string, number>;
  iterations: number;
  /** Pre-money fully diluted count including the top-up; 0 when no round was given. */
  X: number;
  /** Top-up shares. */
  T: number;
  /** Total SAFE shares. */
  N: number;
  fd0: number;
}

/**
 * Converts every open SAFE at the close of a round (section 4). With `round === null` only the cap shares are computed (TV-1, TV-2).
 * `iterations` counts the passes in which a share count changed; it is 0 when every cap binds.
 */
export function convertSafes(t: CapTable, round: RoundInput | null): Conversion | FinanceError {
  const open = t.safes.filter((s) => s.converted !== true);
  const fd0 = fdCount(t);
  const poolAvail = poolAvailable(t);
  const issuedGranted = fd0 - poolAvail;
  const eff = resolve(open);
  const F = stackF(eff);
  if (F >= SAFE_STACK_F_LIMIT) return fail('SAFE_STACK_LIMIT');

  const capShares: number[] = eff.map((e) => (e.cap !== null && e.cap > 0 ? Math.floor((fd0 * (e.safe.amount / e.cap)) / (1 - F)) : 0));
  let shares = [...capShares];
  let iterations = 0;
  let X = 0;
  let T = 0;

  const solveX = (N: number): { X: number; T: number } | FinanceError => {
    if (round === null) return { X: 0, T: 0 };
    const B = issuedGranted + N;
    const den = round.preMoney * 10_000 - round.poolTargetBp * (round.preMoney + round.amount);
    if (!(den > 0)) return fail('TERMS_INFEASIBLE');
    let x = mulDivCeil(B, round.preMoney * 10_000, den);
    let top = x - fd0 - N;
    if (top < 0) {
      top = 0;
      x = fd0 + N;
    }
    return { X: x, T: top };
  };

  let N = shares.reduce((a, b) => a + b, 0);
  let sol = solveX(N);
  if ('ok' in sol) return sol;
  if (round !== null) {
    for (;;) {
      const next = eff.map((e, i) => {
        const priced = mulDivFloor(e.safe.amount, sol_X(sol) * 10_000, e.disc * round.preMoney);
        return Math.max(capShares[i] as number, priced);
      });
      let changed = false;
      for (let i = 0; i < next.length; i++) if (next[i] !== shares[i]) changed = true;
      if (!changed) break;
      iterations++;
      if (iterations > MAX_CONVERT_ITERATIONS) return fail('BAD_INPUT', 'SAFE conversion did not converge');
      shares = next;
      N = shares.reduce((a, b) => a + b, 0);
      const s2 = solveX(N);
      if ('ok' in s2) return s2;
      sol = s2;
    }
    X = sol.X;
    T = sol.T;
  }
  const sharesBySafe: Record<string, number> = {};
  eff.forEach((e, i) => {
    sharesBySafe[e.safe.id] = shares[i] as number;
  });
  return { ok: true, sharesBySafe, iterations, X, T, N, fd0 };
}

function sol_X(s: { X: number; T: number }): number {
  return s.X;
}

export interface RoundContext {
  id: string;
  kind: Exclude<RoundKind, 'safe'>;
  week: number;
  leadInvestorId: string;
  liq: LiqPref;
  boardSeats: number;
}

export interface PricedResult {
  ok: true;
  table: CapTable;
  round: PricedRound;
  conversion: Conversion;
  X: number;
  T: number;
  newShares: number;
  postFd: number;
  priceMicros: number;
  /** Legal cost debited from cash at close: max(1,500,000 cents, 2 % of the amount). */
  legalFeeCents: Cents;
}

export const LEGAL_FEE_MIN_CENTS = 1_500_000;

/** Prices a round: converts the open SAFEs, tops up the pool, issues the new shares (section 5). The input table is not touched. */
export function priceRound(t: CapTable, input: RoundInput, ctx: RoundContext): PricedResult | FinanceError {
  if (!(input.preMoney > 0) || !(input.amount > 0) || input.poolTargetBp < 0) return fail('BAD_INPUT');
  const den0 = input.preMoney * 10_000 - input.poolTargetBp * (input.preMoney + input.amount);
  if (!(den0 > 0)) return fail('TERMS_INFEASIBLE');
  const conv = convertSafes(t, input);
  if ('ok' in conv && conv.ok === false) return conv;
  const c = conv as Conversion;
  const X = c.X;
  const T = c.T;
  const newShares = mulDivFloor(input.amount, X, input.preMoney);
  const priceMicros = mulDivFloor(input.preMoney, 10_000, X);
  const next = cloneTable(t);
  for (const s of next.safes) {
    if (s.converted === true) continue;
    const n = c.sharesBySafe[s.id] ?? 0;
    const h = holderOf(next, s.investorId, 'investor');
    h.shares[safeClass(s.id)] = (h.shares[safeClass(s.id)] ?? 0) + n;
    s.converted = true;
  }
  next.pool.authorized += T;
  const lead = holderOf(next, ctx.leadInvestorId, 'investor');
  const cls = roundClass(ctx.kind);
  lead.shares[cls] = (lead.shares[cls] ?? 0) + newShares;
  next.totalFd = fdCount(next) + 0;
  const round: PricedRound = {
    id: ctx.id,
    kind: ctx.kind,
    week: ctx.week,
    closedWeek: ctx.week,
    preMoney: input.preMoney,
    amount: input.amount,
    poolTargetBp: input.poolTargetBp,
    newShares,
    topUpShares: T,
    priceMicros,
    liq: { ...ctx.liq },
    boardSeats: ctx.boardSeats,
    leadInvestorId: ctx.leadInvestorId,
    invested: { [ctx.leadInvestorId]: input.amount },
  };
  next.rounds.push(round);
  const bad = assertConserved(next);
  if (bad) return bad;
  const legal = Math.max(LEGAL_FEE_MIN_CENTS, mulDivFloor(input.amount, 2, 100));
  return { ok: true, table: next, round, conversion: c, X, T, newShares, postFd: next.totalFd, priceMicros, legalFeeCents: legal };
}

/**
 * Converts every open SAFE at a notional price (no new money): used by exits and by the exit slider, where SAFEs that never met a
 * priced round must still take part in the waterfall (BD-M09a1-06). `preMoney` is the notional pre-money; the pool is not topped up.
 */
export function settleSafes(t: CapTable, preMoney: Cents): CapTable {
  const open = t.safes.filter((s) => s.converted !== true);
  if (open.length === 0) return t;
  // The notional price never falls below 4x the SAFE money, so a near-empty exit does not mint absurd share counts.
  const floor = open.reduce((a, s) => a + 4 * s.amount, 1);
  const conv = convertSafes(t, { preMoney: Math.max(floor, preMoney), amount: 0, poolTargetBp: 0 });
  if ('ok' in conv && conv.ok === false) return t;
  const c = conv as Conversion;
  const next = cloneTable(t);
  for (const s of next.safes) {
    if (s.converted === true) continue;
    const n = c.sharesBySafe[s.id] ?? 0;
    const h = holderOf(next, s.investorId, 'investor');
    h.shares[safeClass(s.id)] = (h.shares[safeClass(s.id)] ?? 0) + n;
    s.converted = true;
  }
  next.totalFd = fdCount(next);
  return next;
}

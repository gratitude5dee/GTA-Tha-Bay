/**
 * Finance types of Business Tycoon (08-tycoon-finance.md section 3 and 8). Money is integer cents, shares are integers,
 * percentages inside finance are basis points (10,000 = 100 %). Pure data; no IO.
 */
export type Cents = number;
export type ShareClass = 'common' | `pref-${string}`;
export type RoundKind = 'safe' | 'seed' | 'a' | 'b' | 'c';
export interface Holder {
  id: string;
  kind: 'founder' | 'employee' | 'investor' | 'advisor';
  shares: Record<ShareClass, number>;
}
export interface PoolState {
  authorized: number;
  granted: number;
}
export interface Safe {
  id: string;
  investorId: string;
  amount: Cents;
  signedWeek: number;
  type: 'cap' | 'discount' | 'mfn' | 'capDiscount';
  postMoneyCap?: Cents;
  discountBp?: number;
  sideLetterProRata?: false;
  /** BD-M09a1-02: set once the SAFE has become a `pref-safe-<id>` class; the waterfall reads its preference from the SAFE. */
  converted?: boolean;
}
export interface LiqPref {
  multiple: 1 | 1.5 | 2;
  participating: boolean;
}
export interface PricedRound {
  id: string;
  kind: Exclude<RoundKind, 'safe'>;
  week: number;
  closedWeek: number | null;
  preMoney: Cents;
  amount: Cents;
  poolTargetBp: number;
  newShares: number;
  topUpShares: number;
  priceMicros: number;
  liq: LiqPref;
  boardSeats: number;
  leadInvestorId: string;
  invested: Record<string, Cents>;
}
export interface CapTable {
  holders: Holder[];
  pool: PoolState;
  safes: Safe[];
  rounds: PricedRound[];
  totalFd: number;
}
export interface Terms {
  amount: Cents;
  preMoney: Cents;
  poolTargetBp: number;
  boardSeat: boolean;
  liq: LiqPref;
}

export type FinanceErrorCode = 'TERMS_INFEASIBLE' | 'SAFE_STACK_LIMIT' | 'CAPTABLE_INVARIANT' | 'BAD_INPUT';
export interface FinanceError {
  ok: false;
  code: FinanceErrorCode;
  detail?: string;
}

export const BASE_FOUNDER_SHARES = 9_000_000;
export const BASE_POOL_SHARES = 1_000_000;
export const BASE_FD = 10_000_000;
export const SAFE_STACK_F_LIMIT = 0.5;
export const MAX_CONVERT_ITERATIONS = 16;

/** The class name a SAFE converts into. */
export const safeClass = (id: string): ShareClass => `pref-safe-${id}`;
export const roundClass = (kind: Exclude<RoundKind, 'safe'>): ShareClass => `pref-${kind}`;

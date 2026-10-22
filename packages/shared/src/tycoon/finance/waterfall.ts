/**
 * Liquidation waterfall at exit (08-tycoon-finance.md section 6). Pari passu among preferred; non-participating classes convert
 * when their share of the residual beats their preference; participating classes take the preference and join the residual.
 * Rounding remainder cents go to common (the founder holder first). `sum(payouts) === E` always.
 */
import { mulDivFloor } from './muldiv.ts';
import type { CapTable, Cents, ShareClass } from './types.ts';

export type ExitKind = 'acquisition' | 'ipo' | 'unicorn' | 'liquidation';

export interface ClassInfo {
  cls: ShareClass;
  shares: number;
  invested: Cents;
  /** Preference in cents: multiple x invested. */
  pref: Cents;
  participating: boolean;
}

export interface Payouts {
  total: Cents;
  byClass: Record<string, Cents>;
  byHolder: Record<string, Cents>;
  /** Non-participating classes that converted to common. */
  converted: ShareClass[];
}

/** Holder key for exercised options (granted pool shares, treated as vested common at zero strike). */
export const OPTIONS_HOLDER = '@options';

/** The preferred classes of a table with their shares, invested amounts and preference. Sorted by class name. */
export function preferredClasses(t: CapTable): ClassInfo[] {
  const shares = new Map<string, number>();
  for (const h of t.holders)
    for (const k of Object.keys(h.shares)) {
      if (k === 'common') continue;
      shares.set(k, (shares.get(k) ?? 0) + (h.shares[k as ShareClass] ?? 0));
    }
  const out: ClassInfo[] = [];
  for (const [cls, n] of shares) {
    if (n <= 0) continue;
    let invested = 0;
    let mult2 = 2;
    let participating = false;
    if (cls.startsWith('pref-safe-')) {
      const s = t.safes.find((x) => `pref-safe-${x.id}` === cls);
      invested = s ? s.amount : 0;
    } else {
      const kind = cls.slice('pref-'.length);
      for (const r of t.rounds) {
        if (r.kind !== kind) continue;
        invested += r.amount;
        mult2 = Math.round(r.liq.multiple * 2);
        participating = r.liq.participating;
      }
    }
    out.push({ cls: cls as ShareClass, shares: n, invested, pref: mulDivFloor(invested, mult2, 2), participating });
  }
  out.sort((a, b) => (a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : 0));
  return out;
}

/** Common shares: founders, employees and advisors holding common, plus the granted options. */
export function commonShares(t: CapTable): number {
  let n = t.pool.granted;
  for (const h of t.holders) n += h.shares.common ?? 0;
  return n;
}

/** a/b < c/d for positive denominators, exact. */
function ratioLess(a: number, b: number, c: number, d: number): boolean {
  return BigInt(a) * BigInt(d) < BigInt(c) * BigInt(b);
}

export function waterfall(E: Cents, t: CapTable, _exitKind: ExitKind = 'acquisition'): Payouts {
  if (!Number.isInteger(E) || E < 0) throw new RangeError('waterfall: E must be a non-negative integer');
  const classes = preferredClasses(t);
  const common = commonShares(t);
  const nonPart = classes.filter((c) => !c.participating).sort((a, b) => (ratioLess(a.pref, a.shares, b.pref, b.shares) ? -1 : ratioLess(b.pref, b.shares, a.pref, a.shares) ? 1 : a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : 0));
  const part = classes.filter((c) => c.participating);
  const m = nonPart.length;

  let chosen = 0;
  let owed = 0;
  let paid = 0;
  let R = E;
  let resShares = 0;
  const attempt = (tt: number): boolean => {
    owed = 0;
    for (let i = tt; i < m; i++) owed += (nonPart[i] as ClassInfo).pref;
    for (const c of part) owed += c.pref;
    paid = Math.min(E, owed);
    R = E - paid;
    resShares = common;
    for (let i = 0; i < tt; i++) resShares += (nonPart[i] as ClassInfo).shares;
    for (const c of part) resShares += c.shares;
    if (tt === 0) return true;
    const c = nonPart[tt - 1] as ClassInfo;
    // R / resShares >= pref / shares  <=>  R * shares >= pref * resShares
    return BigInt(R) * BigInt(c.shares) >= BigInt(c.pref) * BigInt(resShares);
  };
  for (let tt = m; tt >= 0; tt--) {
    if (attempt(tt)) {
      chosen = tt;
      break;
    }
  }
  attempt(chosen);

  const byClass: Record<string, number> = {};
  let distributed = 0;
  const converting = new Set<string>();
  for (let i = 0; i < chosen; i++) converting.add((nonPart[i] as ClassInfo).cls);
  const owing = classes.filter((c) => !converting.has(c.cls));
  const owedTotal = owing.reduce((a, c) => a + c.pref, 0);
  for (const c of classes) {
    let v = 0;
    if (!converting.has(c.cls) && owedTotal > 0) v += paid >= owedTotal ? c.pref : mulDivFloor(paid, c.pref, owedTotal);
    if ((converting.has(c.cls) || c.participating) && resShares > 0) v += mulDivFloor(R, c.shares, resShares);
    byClass[c.cls] = v;
    distributed += v;
  }
  const commonPay = E - distributed;
  byClass['common'] = commonPay;

  // Split each class among its holders: floor pro rata, remainder to the first founder (or first holder) of the class.
  const byHolder: Record<string, number> = {};
  const add = (id: string, v: number): void => {
    byHolder[id] = (byHolder[id] ?? 0) + v;
  };
  const splitClass = (cls: string, total: number): void => {
    const parts: { id: string; kind: string; n: number }[] = [];
    for (const h of t.holders) {
      const n = h.shares[cls as ShareClass] ?? 0;
      if (n > 0) parts.push({ id: h.id, kind: h.kind, n });
    }
    if (cls === 'common' && t.pool.granted > 0) parts.push({ id: OPTIONS_HOLDER, kind: 'employee', n: t.pool.granted });
    const sum = parts.reduce((a, p) => a + p.n, 0);
    if (sum === 0) return;
    parts.sort((a, b) => (a.kind === 'founder' && b.kind !== 'founder' ? -1 : b.kind === 'founder' && a.kind !== 'founder' ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let given = 0;
    for (const p of parts) {
      const v = mulDivFloor(total, p.n, sum);
      add(p.id, v);
      given += v;
    }
    add((parts[0] as { id: string }).id, total - given);
  };
  for (const c of classes) splitClass(c.cls, byClass[c.cls] as number);
  if (commonPay > 0 && common === 0) {
    // No common at all (not reachable with a founder in the table); give the cents to the first holder so the sum holds.
    add(t.holders[0]?.id ?? OPTIONS_HOLDER, commonPay);
  } else splitClass('common', commonPay);

  return { total: E, byClass, byHolder, converted: nonPart.slice(0, chosen).map((c) => c.cls) };
}

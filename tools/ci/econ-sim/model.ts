/**
 * The ledger model of C06 `EconomyApi` semantics (M04d; 13-qa.md 3.9): integer cents, idempotent keys, a debit never takes the
 * balance below zero, and the tycoon dividend counter capped at $10,000 per game week (DL-134). CI tooling in Node, outside the
 * C02 lint scope, but seeded and reproducible all the same.
 */

/** Knobs a mutant turns (`tools/ci/mutants/econ/*.ts` export `patch(deps)`); a real run uses `DEFAULT_MODEL_DEPS`. */
export interface ModelDeps {
  /** Cents added to every credit on top of the amount asked for. Must be 0. */
  creditBias: number;
  /** The weekly dividend counter cap, cents. $10,000 (DL-134). */
  weeklyDividendCapCents: number;
}

export const WEEKLY_DIVIDEND_CAP_CENTS = 1_000_000;

export const DEFAULT_MODEL_DEPS: ModelDeps = { creditBias: 0, weeklyDividendCapCents: WEEKLY_DIVIDEND_CAP_CENTS };

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

function assertCents(cents: number, what: string): void {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new LedgerError(`${what}: ${cents} is not a non-negative integer number of cents`);
}

export interface LedgerEntry {
  key: string;
  /** Signed cents applied. */
  cents: number;
}

export class Ledger {
  private bal = 0;
  private readonly applied = new Map<string, number>();
  readonly entries: LedgerEntry[] = [];

  constructor(private readonly deps: ModelDeps = DEFAULT_MODEL_DEPS, startCents = 0) {
    assertCents(startCents, 'start balance');
    this.bal = startCents;
  }

  get balance(): number {
    return this.bal;
  }

  /** Credits `cents` once per `key`; a replay of the key returns the first result and changes nothing. Returns the cents applied. */
  credit(key: string, cents: number): number {
    assertCents(cents, `credit ${key}`);
    const seen = this.applied.get(key);
    if (seen !== undefined) return seen;
    const add = cents + this.deps.creditBias;
    this.bal += add;
    this.applied.set(key, add);
    this.entries.push({ key, cents: add });
    return add;
  }

  /** Debits `cents` once per `key` when the balance covers it; otherwise nothing changes. Returns the cents applied (0 when refused). */
  debit(key: string, cents: number): number {
    assertCents(cents, `debit ${key}`);
    const seen = this.applied.get(key);
    if (seen !== undefined) return -seen;
    if (cents > this.bal) return 0;
    this.bal -= cents;
    this.applied.set(key, -cents);
    this.entries.push({ key, cents: -cents });
    return cents;
  }

  /** Sum of the applied entries; equals `balance - start` for a ledger that started at zero. */
  entrySum(): number {
    let s = 0;
    for (const e of this.entries) s += e.cents;
    return s;
  }
}

/** Credits the dividend of game week `week`: the gross amount, capped at the weekly counter. Returns the cents applied. */
export function creditDividend(ledger: Ledger, week: number, grossCents: number, deps: ModelDeps = DEFAULT_MODEL_DEPS): number {
  assertCents(grossCents, `dividend week ${week}`);
  return ledger.credit(`div:${week}`, Math.min(grossCents, deps.weeklyDividendCapCents));
}

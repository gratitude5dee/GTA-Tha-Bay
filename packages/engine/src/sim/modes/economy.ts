import type { EconomyApi, StorySlice, Tick, UiBridge } from '@dv/shared';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import type { SimResource } from '../services.ts';

/** C06 economy rules: money is integer cents; tycoon dividends into the story wallet cap at $10,000 per in-game week. */
export const DIVIDEND_REASON = 'tycoon.dividend';
export const DIVIDEND_CAP_CENTS = 1_000_000;
const HALF_SECONDS_PER_WEEK = 172_800 * 7;
const LEDGER_MAX = 512;
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface LedgerEntry {
  tick: Tick;
  cents: number;
  reason: string;
}

export interface EconomyOptions {
  /** The story wallet this economy moves (`StorySlice.wallet`). The object is read live, so a profile switch is picked up. */
  wallet(): StorySlice['wallet'];
  tick(): Tick;
  /** Game half-seconds (the clock's `t`); the week window of the dividend cap. Defaults to the tick. */
  clockT?(): number;
  ui?: UiBridge;
  /** Called after every change of the wallet (the autosave policy marks the story dirty). */
  onChange?(): void;
  /** Called the first time the economy is used, so the owner registers its hashed resource only for sessions that need it. */
  onFirstUse?(): void;
}

/**
 * `EconomyApi` over `StorySlice.wallet.cashCents`. `credit` and `debit` are idempotent by key: a key that was applied answers its
 * first result again and changes nothing; a debit above the balance returns false, is not recorded and may be retried. Dividends
 * (`reason` `tycoon.dividend`) are capped per game week; the part above the cap is not credited, and a credit entirely above it is
 * refused.
 */
export class EconomyImpl implements EconomyApi {
  private readonly applied = new Map<string, boolean>();
  private readonly ledger: LedgerEntry[] = [];
  private used = false;
  private dividendWeek = -1;
  private dividendCents = 0;

  constructor(private readonly o: EconomyOptions) {}

  balance(): number {
    return this.o.wallet().cashCents;
  }

  credit(cents: number, reason: string, idemKey: string): boolean {
    if (!Number.isSafeInteger(cents) || cents <= 0) return false;
    const seen = this.applied.get(idemKey);
    if (seen !== undefined) return seen;
    let amount = cents;
    if (reason === DIVIDEND_REASON) {
      const week = Math.floor((this.o.clockT ? this.o.clockT() : this.o.tick()) / HALF_SECONDS_PER_WEEK);
      if (week !== this.dividendWeek) {
        this.dividendWeek = week;
        this.dividendCents = 0;
      }
      amount = Math.min(cents, DIVIDEND_CAP_CENTS - this.dividendCents);
      if (amount <= 0) return false;
      this.dividendCents += amount;
    }
    this.touch();
    this.o.wallet().cashCents += amount;
    this.record(idemKey, true, amount, reason);
    return true;
  }

  debit(cents: number, reason: string, idemKey: string): boolean {
    if (!Number.isSafeInteger(cents) || cents <= 0) return false;
    const seen = this.applied.get(idemKey);
    if (seen !== undefined) return seen;
    const w = this.o.wallet();
    if (cents > w.cashCents) return false;
    this.touch();
    w.cashCents -= cents;
    this.record(idemKey, true, -cents, reason);
    return true;
  }

  ledgerSince(tick: Tick): LedgerEntry[] {
    return this.ledger.filter((e) => e.tick >= tick).map((e) => ({ ...e }));
  }

  /** Pushes the wallet to the HUD view model (`hud.wallet`). */
  publish(): void {
    const w = this.o.wallet();
    this.o.ui?.patch('hud.wallet', { cashCents: w.cashCents, streetCred: w.streetCred, techClout: w.techClout });
  }

  get ledgerSize(): number {
    return this.ledger.length;
  }

  private touch(): void {
    if (this.used) return;
    this.used = true;
    this.o.onFirstUse?.();
  }

  private record(key: string, ok: boolean, signed: number, reason: string): void {
    this.applied.set(key, ok);
    this.ledger.push({ tick: this.o.tick(), cents: signed, reason });
    if (this.ledger.length > LEDGER_MAX) this.ledger.shift();
    this.publish();
    this.o.onChange?.();
  }

  /** The hashed, checkpointed state: the applied keys (sorted), the ledger and the dividend window. The balance is in the story slice. */
  resource(): SimResource {
    return {
      name: 'economy',
      hash: (h) => {
        h.f64(this.balance()).u32(this.ledger.length).f64(this.dividendWeek).u32(this.dividendCents);
        for (const k of [...this.applied.keys()].sort(byStr)) h.str(k);
      },
      save: (w: ByteWriter) => {
        w.f64(this.balance());
        w.i32(this.dividendWeek);
        w.u32(this.dividendCents);
        const keys = [...this.applied.keys()].sort(byStr);
        w.u32(keys.length);
        for (const k of keys) w.str(k);
        w.u32(this.ledger.length);
        for (const e of this.ledger) {
          w.u32(e.tick);
          w.f64(e.cents);
          w.str(e.reason);
        }
      },
      load: (r: ByteReader) => {
        this.o.wallet().cashCents = r.f64();
        this.dividendWeek = r.i32();
        this.dividendCents = r.u32();
        this.applied.clear();
        for (let n = r.u32(); n > 0; n--) this.applied.set(r.str(), true);
        this.ledger.length = 0;
        for (let n = r.u32(); n > 0; n--) this.ledger.push({ tick: r.u32(), cents: r.f64(), reason: r.str() });
        this.used = true;
      },
    };
  }
}

/** The pursuit director's `WalletPort` on the economy: the bust fine is a debit with the director's idempotency key (M03c). */
export function economyWallet(e: EconomyApi): { cash(): number; debit(cents: number, reason: string, idemKey: string): boolean; credit(cents: number, reason: string, idemKey: string): boolean } {
  return {
    cash: () => e.balance(),
    debit: (cents, reason, idemKey) => e.debit(cents, reason, idemKey),
    credit: (cents, reason, idemKey) => e.credit(cents, reason, idemKey),
  };
}

export interface FareCharge {
  cents: number;
  kind: string;
  idemKey: string;
}

/**
 * The transit `FareSink` (M03b2) with a late-bound target. The world module takes this object at its start; `bind` points it at the
 * economy when the modes module has one. `calls` keeps the distinct charges (the ride QA reads them). A fare is a debit with the
 * ride service's key `fare:<kind>:<tick>:<from>:<to>`; a wallet that cannot pay leaves the fare unpaid (the ride still happens).
 */
export class ForwardingFareSink {
  readonly calls: FareCharge[] = [];
  private readonly seen = new Set<string>();
  private target: EconomyApi | null = null;

  bind(economy: EconomyApi | null): void {
    this.target = economy;
  }

  charge(cents: number, kind: string, idemKey: string): void {
    if (this.seen.has(idemKey)) return;
    this.seen.add(idemKey);
    this.calls.push({ cents, kind, idemKey });
    this.target?.debit(cents, `fare:${kind}`, idemKey);
  }
}

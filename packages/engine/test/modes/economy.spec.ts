import { describe, expect, it } from 'vitest';
import { Fnv64 } from '@dv/shared';
import { ByteReader, ByteWriter } from '../../src/sim/bytes.ts';
import { DIVIDEND_CAP_CENTS, DIVIDEND_REASON, EconomyImpl, ForwardingFareSink, economyWallet, freshSlices } from '../../src/sim/modes/index.ts';
import { MemoryWallet } from '../../src/sim/pursuit/index.ts';
import { SimUiBridge } from '../../src/sim/ui/bridge.ts';

function make(): { e: EconomyImpl; clock: { t: number }; tick: { n: number }; ui: SimUiBridge; wallet: { cashCents: number; streetCred: number; techClout: number } } {
  const slices = freshSlices();
  const clock = { t: 0 };
  const tick = { n: 0 };
  const ui = new SimUiBridge();
  const e = new EconomyImpl({ wallet: () => slices.story.wallet, tick: () => tick.n, clockT: () => clock.t, ui });
  return { e, clock, tick, ui, wallet: slices.story.wallet };
}

/** AC-4: `engine/economy.idempotent`. */
describe('EconomyApi', () => {
  it('credit twice with one key raises the balance once; an over-debit is false and leaves no ledger entry', () => {
    const { e, tick } = make();
    tick.n = 5;
    expect(e.credit(500, 'r', 'k1')).toBe(true);
    expect(e.credit(500, 'r', 'k1')).toBe(true);
    expect(e.balance()).toBe(500);
    expect(e.debit(900, 'fine', 'k2')).toBe(false);
    expect(e.balance()).toBe(500);
    expect(e.ledgerSince(0)).toEqual([{ tick: 5, cents: 500, reason: 'r' }]);
    tick.n = 9;
    expect(e.debit(200, 'fare', 'k3')).toBe(true);
    expect(e.debit(200, 'fare', 'k3')).toBe(true);
    expect(e.balance()).toBe(300);
    expect(e.ledgerSince(6)).toEqual([{ tick: 9, cents: -200, reason: 'fare' }]);
    // a refused debit may be retried once there is money
    expect(e.debit(900, 'fine', 'k2')).toBe(false);
    e.credit(1000, 'r', 'k4');
    expect(e.debit(900, 'fine', 'k2')).toBe(true);
    expect(e.balance()).toBe(400);
  });

  it('only whole positive cents are accepted', () => {
    const { e } = make();
    expect(e.credit(0, 'r', 'a')).toBe(false);
    expect(e.credit(-5, 'r', 'b')).toBe(false);
    expect(e.credit(1.5, 'r', 'c')).toBe(false);
    expect(e.debit(Number.NaN, 'r', 'd')).toBe(false);
    expect(e.balance()).toBe(0);
  });

  it('caps tycoon dividends at $10,000 per in-game week and starts a new window on the next Monday', () => {
    const { e, clock } = make();
    expect(e.credit(DIVIDEND_CAP_CENTS - 100, DIVIDEND_REASON, 'd1')).toBe(true);
    expect(e.credit(500, DIVIDEND_REASON, 'd2')).toBe(true);          // 100 of 500 fit
    expect(e.balance()).toBe(DIVIDEND_CAP_CENTS);
    expect(e.credit(1, DIVIDEND_REASON, 'd3')).toBe(false);
    expect(e.credit(700, 'mission.reward', 'm1')).toBe(true);       // other money is not capped
    expect(e.balance()).toBe(DIVIDEND_CAP_CENTS + 700);
    clock.t = 172_800 * 7;                                          // the next Monday 00:00
    expect(e.credit(900, DIVIDEND_REASON, 'd4')).toBe(true);
    expect(e.balance()).toBe(DIVIDEND_CAP_CENTS + 1600);
  });

  it('publishes hud.wallet on every change', () => {
    const { e, ui } = make();
    e.credit(250, 'r', 'k');
    ui.flushTick();
    const patch = ui.takeOutbox()?.patches.find((p) => p.k === 'hud.wallet');
    expect(patch?.v).toEqual({ cashCents: 250, streetCred: 0, techClout: 0 });
  });

  it('binds the pursuit WalletPort (bust fine) and the transit FareSink through the same API with their keys', () => {
    const { e } = make();
    e.credit(10_000, 'seed', 'seed');
    const wallet = economyWallet(e);
    expect(wallet.cash()).toBe(10_000);
    expect(wallet.debit(2_500, 'bust.fine', 'bust:7:1')).toBe(true);
    expect(wallet.debit(2_500, 'bust.fine', 'bust:7:1')).toBe(true);   // the same key: charged once
    expect(e.balance()).toBe(7_500);
    expect(wallet.debit(9_000, 'bust.fine', 'bust:8:1')).toBe(false);   // the director then takes the fine down to what is held
    const sink = new ForwardingFareSink();
    sink.charge(300, 'robotaxi', 'fare:robotaxi:10:a:b');            // unbound: recorded, nobody pays
    expect(e.balance()).toBe(7_500);
    sink.bind(e);
    sink.charge(350, 'bay-rail', 'fare:bay-rail:11:c:d');
    sink.charge(350, 'bay-rail', 'fare:bay-rail:11:c:d');
    expect(e.balance()).toBe(7_150);
    expect(sink.calls.map((c) => c.idemKey)).toEqual(['fare:robotaxi:10:a:b', 'fare:bay-rail:11:c:d']);
    expect(e.ledgerSince(0).map((l) => l.reason)).toEqual(['seed', 'bust.fine', 'fare:bay-rail']);
  });

  it('the pursuit QA wallet op moves an economy-backed wallet to the asked balance', () => {
    const { e } = make();
    const w = economyWallet(e);
    // what pursuit/qa.ts does for a wallet that is not a MemoryWallet
    expect(w instanceof MemoryWallet).toBe(false);
    expect('credit' in w).toBe(true);
    w.credit(4_000, 'qa', 'qa:wallet:1:4000');
    expect(w.cash()).toBe(4_000);
  });

  it('keeps its state through the resource save and load, and hashes it', () => {
    const a = make();
    a.e.credit(1_000, 'r', 'k1');
    a.e.debit(100, 'r', 'k2');
    const res = a.e.resource();
    expect(res.name).toBe('economy');
    const w = new ByteWriter();
    res.save(w);
    const b = make();
    b.e.resource().load(new ByteReader(w.toBytes()));
    expect(b.e.balance()).toBe(900);
    expect(b.e.debit(100, 'r', 'k2')).toBe(true);   // the applied key came with it: not charged again
    expect(b.e.balance()).toBe(900);
    expect(b.e.ledgerSince(0)).toHaveLength(2);
    const h1 = new Fnv64();
    const h2 = new Fnv64();
    res.hash(h1);
    b.e.resource().hash(h2);
    expect(h1.hex()).toBe(h2.hex());
  });
});

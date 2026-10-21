/** M04d AC-8: the economy harness. */
import { describe, expect, it } from 'vitest';
import { checkSection, loadBands, percentile, validateBands } from '../econ-sim/bands.ts';
import { ECON_SEED, main, runEconSuite, simulateSection } from '../econ-sim/index.ts';
import { creditDividend, DEFAULT_MODEL_DEPS, Ledger, LedgerError } from '../econ-sim/model.ts';
import { BASE_SECTION } from '../econ-sim/sections/base.ts';

describe('econ-sim ledger model', () => {
  it('credits a week of dividends above $10,000 as exactly 1,000,000 cents', () => {
    const l = new Ledger();
    expect(creditDividend(l, 1, 1_534_567)).toBe(1_000_000);
    expect(l.balance).toBe(1_000_000);
    // a week under the cap is credited whole
    expect(creditDividend(l, 2, 250_000)).toBe(250_000);
    expect(l.balance).toBe(1_250_000);
  });

  it('is idempotent per key and refuses fractions, negatives and overdrafts', () => {
    const l = new Ledger();
    l.credit('a', 100);
    expect(l.credit('a', 100)).toBe(100);
    expect(l.balance).toBe(100);
    expect(l.debit('s', 500)).toBe(0);
    expect(l.debit('s', 40)).toBe(40);
    expect(l.debit('s', 40)).toBe(40);   // a replay returns the first result
    expect(l.balance).toBe(60);
    expect(() => l.credit('b', 1.5)).toThrow(LedgerError);
    expect(() => l.credit('c', -1)).toThrow(LedgerError);
    expect(l.entrySum()).toBe(60);
  });

  it('an empty ledger holds nothing', () => {
    const l = new Ledger();
    expect(l.balance).toBe(0);
    expect(l.entrySum()).toBe(0);
  });
});

describe('econ-sim suite', () => {
  it('prints the self-test line, passes every band and exits 0', () => {
    const r = runEconSuite();
    expect(r.lines).toContain('self-test: out-of-band fixture rejected');
    expect(r.lines.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    expect(r.lines).toContain('base exact.capWeek = 1000000 (want 1000000)');
    expect(r.lines).toContain('base: every band passes');
    expect(r.lines[0]).toContain(`seed 0x${ECON_SEED.toString(16)}`);
    expect(r.ok).toBe(true);
  });

  it('the same seed gives the same percentile table', () => {
    const a = simulateSection(BASE_SECTION, DEFAULT_MODEL_DEPS, 100);
    const b = simulateSection(BASE_SECTION, DEFAULT_MODEL_DEPS, 100);
    expect(a).toEqual(b);
    expect(simulateSection(BASE_SECTION, DEFAULT_MODEL_DEPS, 100, ECON_SEED + 1)).not.toEqual(a);
  });

  it('a harness whose band check accepts everything is reported: an accepting fixture fails the self-test', () => {
    const accepting = { v: 1, unit: 'cents', sections: { base: { exact: {}, policies: {} } } };
    const r = runEconSuite({ fixture: accepting, runs: 20 });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('ACCEPTED');
  });

  it('the out-of-band fixture is rejected by checkSection', () => {
    const result = simulateSection(BASE_SECTION, DEFAULT_MODEL_DEPS, 50);
    const fixture = validateBands(JSON.parse(JSON.stringify({ v: 1, unit: 'cents', sections: { base: { exact: { capWeek: 1000001 }, policies: { saver: { endBalance: { p50: [0, 1] } } } } } })));
    expect(checkSection(result, fixture.sections['base'] as never).length).toBe(2);
  });

  it('bands validate against the schema; a bad file is rejected', () => {
    expect(() => loadBands()).not.toThrow();
    expect(() => validateBands({ v: 1, unit: 'dollars', sections: {} })).toThrow(/schema/);
    expect(() => validateBands({ v: 1, unit: 'cents', sections: { base: { exact: {}, policies: { saver: { endBalance: { p50: [1] } } } } } })).toThrow(/schema/);
  });

  it('percentile is nearest rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it('check:balance without --suite also prints the tycoon pending line; an unknown suite exits 2', () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      expect(main([])).toBe(0);
      expect(logs).toContain('tycoon: pending: lands in M09a2');
      logs.length = 0;
      expect(main(['--suite', 'econ'])).toBe(0);
      expect(logs).not.toContain('tycoon: pending: lands in M09a2');
    } finally {
      console.log = orig;
    }
    const err = console.error;
    console.error = () => undefined;
    try {
      expect(main(['--suite', 'nope'])).toBe(2);
    } finally {
      console.error = err;
    }
  });
});

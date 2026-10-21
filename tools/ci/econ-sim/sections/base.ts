/**
 * Section `base` (M04d): what the economy holds before any content exists. Income is the tycoon dividend counter (capped at
 * $10,000 per game week, DL-134); there is no mission income yet (Act 1 brings its section with M05c1, racing with M07b2, Acts 2
 * and 3 with M05e2 and M05f2). Sinks are a flat share of the balance by policy.
 *
 * `probes` are exact checks: each runs against the model with the deps under test and returns cents, which
 * `config/econ-bands.json` pins exactly.
 */
import { creditDividend, Ledger, type ModelDeps } from '../model.ts';

export interface EconSection {
  id: string;
  /** Game weeks per simulated run. */
  weeks: number;
  /** One week's gross dividend in cents, from a uniform draw `u` in [0, 1) and a second `v`. */
  grossDividend(u: number, v: number): number;
  probes: Readonly<Record<string, (deps: ModelDeps) => number>>;
}

export const BASE_SECTION: EconSection = {
  id: 'base',
  weeks: 52,
  // A quarter of the weeks pay nothing; the rest pay $2,000 to $18,000, so some weeks run into the $10,000 cap.
  grossDividend: (u, v) => (u < 0.25 ? 0 : 200_000 + Math.floor(v * 1_600_001)),
  probes: {
    // A week whose dividends would reach $15,345.67 credits exactly $10,000.
    capWeek: (deps) => {
      const l = new Ledger(deps);
      creditDividend(l, 1, 1_534_567, deps);
      return l.balance;
    },
    // A ledger with no entries holds nothing and sums to nothing.
    emptyLedger: (deps) => {
      const l = new Ledger(deps);
      return l.balance + l.entrySum();
    },
    // The same key twice credits once.
    idempotentReplay: (deps) => {
      const l = new Ledger(deps);
      l.credit('k', 500);
      l.credit('k', 500);
      return l.balance;
    },
  },
};

export const SECTIONS: Readonly<Record<string, EconSection>> = { base: BASE_SECTION };

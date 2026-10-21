/**
 * Economy harness (M04d; 13-qa.md 3.9): `pnpm check:balance [-- --suite econ|tycoon]`.
 *
 * Monte-Carlo over the ledger model (`model.ts`): per section, N seeded runs per spending policy, percentile tables compared with
 * `config/econ-bands.json`, plus exact probes (the weekly dividend cap, the empty ledger, idempotent keys). Same seed, same
 * table: the seed is printed. A built-in self-test runs first: the out-of-band fixture must be rejected, or the command fails.
 * Section content arrives with content: Act 1 (M05c1), racing (M07b2), Acts 2 and 3 (M05e2, M05f2). The tycoon suite is M09a2.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { streams } from '../../../packages/shared/src/rng.ts';
import { isMain, toolsRoot } from '../lib/common.ts';
import { args } from '../run.ts';
import {
  checkSection, loadBands, percentile, validateBands, METRICS, PERCENTILES,
  type BandFailure, type EconBands, type Metric, type Percentile, type SectionResult,
} from './bands.ts';
import { creditDividend, DEFAULT_MODEL_DEPS, Ledger, type ModelDeps } from './model.ts';
import { POLICIES, weeklySpend, type PolicyId } from './policies.ts';
import { SECTIONS, type EconSection } from './sections/base.ts';

/** Master seed of the harness; the stream of a section is `econ:<section>`. */
export const ECON_SEED = 0xec0a01;
export const RUNS_PER_POLICY = 1000;

type Table = Record<Metric, Record<Percentile, number>>;

/** N runs of one policy through one section: percentile tables of the end balance and the total income. */
export function simulatePolicy(section: EconSection, policy: PolicyId, deps: ModelDeps, runs = RUNS_PER_POLICY, seed = ECON_SEED): Table {
  const rng = streams(seed).get(`econ:${section.id}`);
  const ends: number[] = [];
  const incomes: number[] = [];
  for (let r = 0; r < runs; r++) {
    const ledger = new Ledger(deps);
    let income = 0;
    for (let week = 1; week <= section.weeks; week++) {
      const gross = section.grossDividend(rng.nextFloat(), rng.nextFloat());
      income += creditDividend(ledger, week, gross, deps);
      const spend = weeklySpend(policy, ledger.balance);
      if (spend > 0) ledger.debit(`sink:${week}`, spend);
    }
    if (ledger.balance !== ledger.entrySum()) throw new Error(`${section.id}/${policy}: balance ${ledger.balance} differs from the entry sum ${ledger.entrySum()}`);
    ends.push(ledger.balance);
    incomes.push(income);
  }
  const table = {} as Table;
  for (const [metric, list] of [['endBalance', ends], ['totalIncome', incomes]] as const) {
    const sorted = [...list].sort((a, b) => a - b);
    table[metric] = { p10: percentile(sorted, 10), p50: percentile(sorted, 50), p90: percentile(sorted, 90) };
  }
  return table;
}

export function simulateSection(section: EconSection, deps: ModelDeps, runs = RUNS_PER_POLICY, seed = ECON_SEED): SectionResult {
  const exact: Record<string, number> = {};
  for (const [name, probe] of Object.entries(section.probes)) exact[name] = probe(deps);
  const policies: SectionResult['policies'] = {};
  for (const p of POLICIES) policies[p] = simulatePolicy(section, p, deps, runs, seed);
  return { exact, policies };
}

export interface EconRun {
  ok: boolean;
  lines: string[];
}

export interface EconOptions {
  /** Model knobs; a mutant passes its patched deps (`tools/ci/mutants/econ`). */
  deps?: ModelDeps;
  bands?: EconBands;
  /** Fixture the self-test must see rejected. */
  fixture?: unknown;
  runs?: number;
}

const FIXTURE_PATH = path.join(toolsRoot, 'tools', 'ci', 'econ-sim', 'fixtures', 'out-of-band.json');

/** The economy suite: self-test, then every section that has bands. */
export function runEconSuite(opts: EconOptions = {}): EconRun {
  const deps = opts.deps ?? DEFAULT_MODEL_DEPS;
  const runs = opts.runs ?? RUNS_PER_POLICY;
  const lines: string[] = [`econ: seed 0x${ECON_SEED.toString(16)}, ${runs} runs per policy, policies ${POLICIES.join(', ')}`];
  let ok = true;

  // Self-test: bands that cannot hold must fail, or the comparison is not looking.
  const fixture = validateBands(opts.fixture ?? JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));
  const fixtureSection = fixture.sections['base'];
  const base = SECTIONS['base'];
  if (!fixtureSection || !base) throw new Error('econ self-test needs section base and its out-of-band fixture');
  const rejected = checkSection(simulateSection(base, DEFAULT_MODEL_DEPS, Math.min(runs, 50)), fixtureSection);
  if (rejected.length === 0) {
    lines.push('self-test: out-of-band fixture ACCEPTED (the band check is vacuous)');
    return { ok: false, lines };
  }
  lines.push('self-test: out-of-band fixture rejected');

  const bands = opts.bands ?? loadBands();
  for (const [id, sectionBands] of Object.entries(bands.sections)) {
    const section = SECTIONS[id];
    if (!section) {
      lines.push(`section ${id}: no section file in tools/ci/econ-sim/sections`);
      ok = false;
      continue;
    }
    const result = simulateSection(section, deps, runs);
    const failures: BandFailure[] = checkSection(result, sectionBands);
    for (const [name, want] of Object.entries(sectionBands.exact)) lines.push(`${id} exact.${name} = ${result.exact[name]} (want ${want})`);
    for (const policy of POLICIES) {
      const t = result.policies[policy];
      if (!t) continue;
      lines.push(`${id} ${policy}: ` + METRICS.map((m) => `${m} ` + PERCENTILES.map((p) => `${p}=${t[m][p]}`).join(' ')).join(' | '));
    }
    if (failures.length) {
      ok = false;
      for (const f of failures) lines.push(`FAIL ${id} ${f.where}: got ${f.got}, want ${f.want}`);
    } else lines.push(`${id}: every band passes`);
  }
  return { ok, lines };
}

export function main(argv: readonly string[] = args()): number {
  const i = argv.indexOf('--suite');
  const suite = i >= 0 ? argv[i + 1] : undefined;
  if (suite !== undefined && suite !== 'econ' && suite !== 'tycoon') {
    console.error(`check:balance: unknown suite '${suite}'; known: econ, tycoon`);
    return 2;
  }
  let status = 0;
  if (suite === undefined || suite === 'econ') {
    const r = runEconSuite();
    for (const l of r.lines) console.log(l);
    if (!r.ok) status = 1;
  }
  if (suite === undefined || suite === 'tycoon') console.log('tycoon: pending: lands in M09a2');
  return status;
}

if (isMain(import.meta.url)) process.exit(main());

/**
 * `pnpm tycoon:sim` (08-tycoon-events.md section 8): Monte-Carlo runs of the bot policies on the Tycoon content, the band table,
 * the report and the regression guard.
 *
 *   pnpm tycoon:sim -- --runs 10000 --policy median,aggressive,frugal,random --seed-base 1 --out tests/tycoon/report.json
 *   pnpm tycoon:sim -- --runs 2000 --policy median --seed-base 1 --sweep finance.dilutionTarget.seed=0.14:0.22:0.02
 *   pnpm tycoon:sim -- --trace run=123          one run, week by week
 *   pnpm tycoon:baseline                        rewrites tests/tycoon/baseline.json (2000 runs per policy, seed base 1)
 *
 * Flags: --content <dir> --balance <file> --bands <file> --events <file> (extra event file) --bot <module> (extra policy)
 * --bands-only (print the table, write nothing) --no-baseline (skip the regression guard) --check-baseline.
 * Exit code 1 when a band fails, the baseline guard fails or a self-test is vacuous.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain, toolsRoot } from '../lib/common.ts';
import { args } from '../run.ts';
import { baselineJson, baselineOf, BASELINE_PATH, branchCommitMessages, checkBaseline, loadBaseline } from './baseline.ts';
import { bandTable, evaluateBands, failingBands, loadBands, type BandResult, type BandsFile } from './bands.ts';
import { POLICY_IDS, type Policy } from './policies.ts';
import { aggregate, reportJson, stripTimings, summaryTable, type PolicyReport, type Report } from './report.ts';
import { buildPolicies, loadContent, playPolicyRuns, replayMatches, type BalanceFixture, type RunRecord } from './run.ts';

export const DEFAULT_RUNS = 2000;
export const DETERMINISM_RUNS = 200;

export interface SuiteOptions {
  runs: number;
  policies: string[];
  seedBase: number;
  root?: string;
  contentDir?: string;
  balanceFile?: string;
  extraEventFiles?: string[];
  extraPolicies?: Policy[];
  /** Dotted-path patches over the loaded content (a sweep sets one). */
  patch?: Record<string, unknown>;
  determinismRuns?: number;
  bands?: BandsFile;
}

export interface SuiteResult {
  report: Report;
  bands: BandResult[];
  ok: boolean;
}

function readFixture(opts: SuiteOptions): BalanceFixture {
  if (!opts.balanceFile) return {};
  const file = path.isAbsolute(opts.balanceFile) ? opts.balanceFile : path.join(opts.root ?? toolsRoot, opts.balanceFile);
  const j = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  return j['schema'] === 'tycoon.balance.v1' ? {} : (j as BalanceFixture);
}

/** Runs the policies and builds the report; the bands are evaluated by the caller (or by `runSuite`). */
export function simulate(opts: SuiteOptions): { report: Report; records: Record<string, RunRecord[]>; contents: ReturnType<typeof buildPolicies> } {
  const loadOpts = {
    ...(opts.root !== undefined ? { root: opts.root } : {}),
    ...(opts.contentDir !== undefined ? { contentDir: opts.contentDir } : {}),
    ...(opts.balanceFile !== undefined ? { balanceFile: opts.balanceFile } : {}),
    ...(opts.extraEventFiles !== undefined ? { extraEventFiles: opts.extraEventFiles } : {}),
    ...(opts.patch !== undefined ? { patch: opts.patch } : {}),
  };
  const content = loadContent(loadOpts);
  const fixture = readFixture(opts);
  const set = buildPolicies(content, fixture.perPolicy, opts.extraPolicies ?? []);
  const t0 = Date.now();
  const records: Record<string, RunRecord[]> = {};
  const policies: Record<string, PolicyReport> = {};
  for (const id of opts.policies) {
    const e = set.policies[id];
    if (!e) throw new Error(`tycoon-sim: unknown policy '${id}'; known: ${Object.keys(set.policies).join(', ')}`);
    const p0 = Date.now();
    records[id] = playPolicyRuns(e.content, e.policy, opts.runs, opts.seedBase);
    policies[id] = { ...aggregate(records[id] as RunRecord[]), wallTimeMs: Date.now() - p0 };
  }
  const report: Report = {
    schema: 'tycoon.report.v1',
    contentVersion: content.contentVersion,
    balanceVersion: content.balanceVersion,
    runsPerPolicy: opts.runs,
    seedBase: opts.seedBase,
    policies,
    wallTimeMs: Date.now() - t0,
  };
  return { report, records, contents: set };
}

/** B10: the first runs of the first policy are executed twice and replayed from `(setup, choices)`. */
export function determinismCheck(opts: SuiteOptions, report: Report, records: Record<string, RunRecord[]>, set: ReturnType<typeof buildPolicies>): NonNullable<Report['determinism']> {
  const id = opts.policies[0] as string;
  const n = Math.min(opts.determinismRuns ?? DETERMINISM_RUNS, opts.runs);
  if (n <= 0) return { runsChecked: 0, twiceIdentical: true, replayMismatches: 0 };
  const e = set.policies[id];
  if (!e) return { runsChecked: 0, twiceIdentical: false, replayMismatches: 0 };
  const first = (records[id] as RunRecord[]).slice(0, n);
  const second = playPolicyRuns(e.content, e.policy, n, opts.seedBase);
  const a = JSON.stringify(stripTimings({ ...report, policies: { [id]: aggregate(first) } }));
  const b = JSON.stringify(stripTimings({ ...report, policies: { [id]: aggregate(second) } }));
  let mismatches = 0;
  for (const r of first) if (!replayMatches(e.content, r)) mismatches++;
  return { runsChecked: n, twiceIdentical: a === b, replayMismatches: mismatches };
}

/** Simulates, checks determinism and replay, and evaluates the bands. */
export function runSuite(opts: SuiteOptions): SuiteResult {
  const sim = simulate(opts);
  const report = sim.report;
  report.determinism = determinismCheck(opts, report, sim.records, sim.contents);
  const bands = evaluateBands(report, opts.bands ?? loadBands());
  return { report, bands, ok: failingBands(bands).length === 0 };
}

/**
 * The `pnpm check:balance` tycoon suite: `DV_BALANCE_RUNS` (default 2,000) runs per shipped policy, seed base 1, the band table,
 * the regression guard. Returns the log lines and whether the gate is green.
 */
export function runTycoonGate(env: NodeJS.ProcessEnv = process.env): { ok: boolean; lines: string[] } {
  const runs = Number(env['DV_BALANCE_RUNS'] ?? DEFAULT_RUNS);
  const res = runSuite({ runs, policies: [...POLICY_IDS], seedBase: 1 });
  const lines = [`tycoon: seed base 1, ${runs} runs per policy, policies ${POLICY_IDS.join(', ')}, content ${res.report.contentVersion}, balance ${res.report.balanceVersion}`];
  lines.push(...summaryTable(res.report), ...bandTable(res.bands));
  const g = checkBaseline(res.report, loadBaseline(), branchCommitMessages(env));
  lines.push(g.message);
  const summary = env['GITHUB_STEP_SUMMARY'];
  if (summary) appendFileSync(summary, `### Tycoon balance (${runs} runs per policy)\n\n\`\`\`\n${[...summaryTable(res.report), '', ...bandTable(res.bands)].join('\n')}\n\`\`\`\n`);
  return { ok: res.ok && g.ok, lines };
}

// ---------------------------------------------------------------------------------------------------------------- sweep and trace

export function parseSweep(spec: string): { key: string; values: number[] } {
  const m = /^([^=]+)=(-?[\d.]+):(-?[\d.]+):(-?[\d.]+)$/.exec(spec);
  if (!m) throw new Error(`tycoon-sim: --sweep wants key=from:to:step, got '${spec}'`);
  const [from, to, step] = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (!(step > 0) || to < from) throw new Error(`tycoon-sim: bad sweep range '${spec}'`);
  const values: number[] = [];
  for (let v = from; v <= to + step / 1000; v += step) values.push(Math.round(v * 1e6) / 1e6);
  return { key: m[1] as string, values };
}

/** A sweep key is a path into the balance unless it names another content file. */
export const sweepPath = (key: string): string => (/^(balance|sectors|theses|archetypes)\./.test(key) ? key : `balance.${key}`);

function trace(opts: SuiteOptions, index: number): string[] {
  const { records } = simulate({ ...opts, runs: index + 1, policies: [opts.policies[0] as string] });
  const r = (records[opts.policies[0] as string] as RunRecord[])[index];
  if (!r) return ['no such run'];
  const lines = [`run ${index} seed ${r.seed} ended ${r.kind} in week ${r.weeks} score ${r.score} hash ${r.hash}`];
  for (const f of r.fired) lines.push(`  week ${f.week} ${f.defId} (${f.origin}${f.healthy ? '' : ', not healthy'})`);
  for (const c of r.choices) lines.push(`  choice week ${c.week}.${c.seq} ${JSON.stringify(c.cmd)}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------- main

function opt(a: readonly string[], name: string): string | undefined {
  const i = a.indexOf(name);
  return i >= 0 ? a[i + 1] : undefined;
}

export async function main(argv: readonly string[] = args()): Promise<number> {
  const runs = Number(opt(argv, '--runs') ?? process.env['DV_BALANCE_RUNS'] ?? DEFAULT_RUNS);
  const policies = (opt(argv, '--policy') ?? POLICY_IDS.join(',')).split(',').filter(Boolean);
  const seedBase = Number(opt(argv, '--seed-base') ?? 1);
  const bandsFile = opt(argv, '--bands');
  const extra: Policy[] = [];
  const botFile = opt(argv, '--bot');
  if (botFile) {
    const mod = (await import(pathToFileURL(path.resolve(toolsRoot, botFile)).href)) as { policy?: Policy };
    if (!mod.policy) throw new Error(`tycoon-sim: ${botFile} must export 'policy'`);
    extra.push(mod.policy);
  }
  const base: SuiteOptions = {
    runs,
    policies: [...policies, ...extra.map((p) => p.id).filter((id) => !policies.includes(id))],
    seedBase,
    extraPolicies: extra,
    ...(opt(argv, '--content') ? { contentDir: opt(argv, '--content') as string } : {}),
    ...(opt(argv, '--balance') ? { balanceFile: opt(argv, '--balance') as string } : {}),
    ...(opt(argv, '--events') ? { extraEventFiles: [opt(argv, '--events') as string] } : {}),
    ...(bandsFile ? { bands: loadBands(path.resolve(toolsRoot, bandsFile)) } : {}),
  };

  const traceSpec = opt(argv, '--trace');
  if (traceSpec) {
    const m = /^run=(\d+)$/.exec(traceSpec);
    if (!m) throw new Error(`tycoon-sim: --trace wants run=<index>, got '${traceSpec}'`);
    for (const l of trace(base, Number(m[1]))) console.log(l);
    return 0;
  }

  const sweep = opt(argv, '--sweep');
  if (sweep) {
    const { key, values } = parseSweep(sweep);
    for (const v of values) {
      const res = runSuite({ ...base, patch: { [sweepPath(key)]: v }, determinismRuns: 0 });
      console.log(`\n== ${key} = ${v} ==`);
      for (const l of summaryTable(res.report)) console.log(l);
      for (const l of bandTable(res.bands.filter((b) => b.id !== 'B10'))) console.log(l);
    }
    return 0;
  }

  const res = runSuite(base);
  console.log(`tycoon: ${runs} runs per policy, seed base ${seedBase}, policies ${base.policies.join(', ')}, content ${res.report.contentVersion}, balance ${res.report.balanceVersion}`);
  for (const l of summaryTable(res.report)) console.log(l);
  for (const l of bandTable(res.bands)) console.log(l);
  let ok = res.ok;
  const out = opt(argv, '--out');
  if (out && !argv.includes('--bands-only')) {
    mkdirSync(path.dirname(path.resolve(toolsRoot, out)), { recursive: true });
    writeFileSync(path.resolve(toolsRoot, out), reportJson(res.report));
    console.log(`wrote ${out}`);
  }
  if (argv.includes('--write-baseline')) {
    writeFileSync(BASELINE_PATH, baselineJson(baselineOf(res.report)));
    console.log(`wrote ${path.relative(toolsRoot, BASELINE_PATH)} (${runs} runs per policy, seed base ${seedBase})`);
    return ok ? 0 : 1;
  }
  if (!argv.includes('--no-baseline') && !argv.includes('--bands-only')) {
    const g = checkBaseline(res.report, loadBaseline(), branchCommitMessages());
    console.log(g.message);
    if (!g.ok) ok = false;
  }
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) {
    appendFileSync(summary, `### Tycoon balance\n\n\`\`\`\n${[...summaryTable(res.report), '', ...bandTable(res.bands)].join('\n')}\n\`\`\`\n`);
  }
  return ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code), (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  });
}

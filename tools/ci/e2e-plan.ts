/**
 * e2e shard plan by measured minutes (BD-FIX-CI-DURSHARD-01). Playwright's `--shard=i/n` cuts the suite by test count over the sorted
 * file names, so the desktop cases on CI's software GL (minutes each) sit next to each other and one shard ran past the 60-minute
 * limit while another took 10 (runs 41294114576, 41300642892). This script packs the tests of one project into `n` shards by their
 * minutes from `tests/e2e/shard-timings.json` and writes the tests of shard `i` as a Playwright `--test-list` file:
 *
 *   tsx tools/ci/e2e-plan.ts plan --project <p> --shards <n> --shard <i> --out <file> [--workers 2] [--print]
 *   tsx tools/ci/e2e-plan.ts timings <log>... [--write]
 *
 * `plan` lists the project's tests (`playwright test --list --reporter=json`), keeps every test of a file that runs a serial group
 * together, and assigns the units longest first to the shard whose wall-clock bound grows least (`shardBound`: a shard's workers take
 * the next test in file order, so its longest unit may start last), so every test lands in exactly one shard. A test with no measured minutes takes the median of its file's measured tests, else of the
 * project's (desktop titles and other titles apart: a desktop case costs minutes on software GL). `--print` prints every shard's
 * estimate. `timings` reads the list reporter's lines (`✓  3 [project] › file:line:col › titles (2.1m)`) from CI job logs
 * (`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`), takes the longest attempt of each test and averages it over the logs, and
 * with `--write` replaces those entries of the table (others are kept).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { args, repoRoot } from './run.ts';
import { isMain } from './lib/common.ts';

export const TIMINGS_FILE = path.join(repoRoot, 'tests', 'e2e', 'shard-timings.json');
/** Playwright's test-list delimiter; a title that holds it cannot be named in a list. */
const SEP = '›';

export interface ListedTest {
  /** The spec file the test belongs to (its file suite), relative to the test directory. */
  spec: string;
  /** Where the test is declared (a helper file for tests a helper declares), relative to the test directory. */
  file: string;
  /** Describe titles, then the test title. */
  titles: string[];
}

export interface Unit {
  key: string;
  tests: ListedTest[];
  minutes: number;
}

export interface Timings {
  note: string;
  projects: Record<string, Record<string, number>>;
}

interface JsonSpec {
  title: string;
  file: string;
  tests: { projectName: string }[];
}
interface JsonSuite {
  title: string;
  file: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}
export interface JsonReport {
  suites: JsonSuite[];
}

export const testKey = (t: ListedTest): string => `${t.file} ${SEP} ${t.titles.join(` ${SEP} `)}`;
export const listLine = (project: string, t: ListedTest): string => `[${project}] ${SEP} ${testKey(t)}`;
/** A title no test has: its line only makes Playwright load the spec file (a list loads only the files it names). */
export const LOAD_ONLY = 'e2e-plan: load this file for the tests its helpers declare';

/**
 * The test-list lines of a shard. Playwright 1.64 loads only the files a list names and matches a line against the declaring file of
 * a test, so a test a helper declares (`look-fixes-helpers.ts`) needs a second line naming its spec file with `LOAD_ONLY`.
 */
export function shardLines(project: string, units: readonly Unit[]): string[] {
  const tests = units.flatMap((u) => u.tests);
  const loads = [...new Set(tests.filter((t) => t.file !== t.spec).map((t) => t.spec))].sort();
  return [...tests.map((t) => listLine(project, t)), ...loads.map((spec) => `[${project}] ${SEP} ${spec} ${SEP} ${LOAD_ONLY}`)];
}

/** The project's tests in a `--list --reporter=json` report; throws on a title a test list cannot name. */
export function collectTests(report: JsonReport, project: string): ListedTest[] {
  const out: ListedTest[] = [];
  const walk = (s: JsonSuite, spec: string, titles: string[]): void => {
    for (const sp of s.specs ?? []) {
      if (!sp.tests.some((t) => t.projectName === project)) continue;
      const all = [...titles, sp.title];
      for (const title of all) {
        if (title.includes(SEP) || title.trim() !== title || title === '')
          throw new Error(`${sp.file}: the title "${title}" cannot be named in a Playwright test list (empty, outer spaces or "${SEP}")`);
      }
      out.push({ spec, file: sp.file, titles: all });
    }
    for (const c of s.suites ?? []) walk(c, spec, [...titles, c.title]);
  };
  for (const file of report.suites) walk(file, file.file, []);
  // A list line matches every test whose title path starts with its titles, so one test's path must not begin another's.
  const paths = new Set(out.map((t) => testKey(t)));
  for (const t of out)
    for (let n = 1; n < t.titles.length; n++) {
      const prefix = testKey({ ...t, titles: t.titles.slice(0, n) });
      if (paths.has(prefix)) throw new Error(`"${prefix}" names a test and begins the path of "${testKey(t)}": a test list cannot tell them apart`);
    }
  return out;
}

const DESKTOP = /\bdesktop\b|\bdesktop-ultra\b/;
const median = (xs: number[]): number | undefined => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Minutes of each test: measured, else the median of its file's measured tests of its kind, else the project's, else 1. */
export function estimator(tests: readonly ListedTest[], measured: Readonly<Record<string, number>>): (t: ListedTest) => number {
  const kind = (t: ListedTest): string => (DESKTOP.test(t.titles.join(' ')) ? 'desktop' : 'other');
  const byFile = new Map<string, number[]>();
  const byProject = new Map<string, number[]>();
  for (const t of tests) {
    const m = measured[testKey(t)];
    if (m === undefined) continue;
    const f = `${t.spec}|${kind(t)}`;
    byFile.set(f, [...(byFile.get(f) ?? []), m]);
    byProject.set(kind(t), [...(byProject.get(kind(t)) ?? []), m]);
  }
  return (t) => measured[testKey(t)] ?? median(byFile.get(`${t.spec}|${kind(t)}`) ?? []) ?? median(byProject.get(kind(t)) ?? []) ?? 1;
}

/** A file runs a serial group when its source (or a helper that declares its tests) configures one. */
export function isSerialSource(src: string): boolean {
  return /mode:\s*['"]serial['"]|describe\.serial\b/.test(src);
}

/**
 * The scheduling units: every test of a spec file with a serial group as one unit (the group shares state and runs on one worker),
 * every other test alone; tests whose list lines coincide (one helper declaring the same titles for two spec files) stay together.
 */
export function unitsOf(tests: readonly ListedTest[], serial: (t: ListedTest) => boolean, minutes: (t: ListedTest) => number): Unit[] {
  const units = new Map<string, Unit>();
  for (const t of tests) {
    const key = serial(t) ? `serial ${t.spec}` : testKey(t);
    const u = units.get(key) ?? { key, tests: [], minutes: 0 };
    u.tests.push(t);
    u.minutes += minutes(t);
    units.set(key, u);
  }
  return [...units.values()];
}

/**
 * A shard's wall-clock bound on `workers` workers that take the next test in file order (Graham's bound for list scheduling): its
 * minutes over the workers plus (1 - 1/workers) of its longest unit, which may start last.
 */
export function shardBound(units: readonly Unit[], workers: number): number {
  const load = units.reduce((a, u) => a + u.minutes, 0);
  return load / workers + (1 - 1 / workers) * Math.max(0, ...units.map((u) => u.minutes));
}

/**
 * Longest unit first, each onto the shard whose bound grows least (ties: the smaller load, then the lower shard), so no shard's bound
 * is far above the others'. One array of units per shard; every unit lands in exactly one.
 */
export function pack(units: readonly Unit[], shards: number, workers: number): Unit[][] {
  if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(workers) || workers < 1) throw new Error(`bad shape ${shards} x ${workers}`);
  const out: Unit[][] = Array.from({ length: shards }, () => []);
  const load = Array.from({ length: shards }, () => 0);
  const longest = Array.from({ length: shards }, () => 0);
  const order = [...units].sort((a, b) => b.minutes - a.minutes || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const u of order) {
    let best = 0;
    let bestBound = Infinity;
    for (let i = 0; i < shards; i++) {
      const bound = ((load[i] as number) + u.minutes) / workers + (1 - 1 / workers) * Math.max(longest[i] as number, u.minutes);
      if (bound < bestBound - 1e-9 || (Math.abs(bound - bestBound) <= 1e-9 && (load[i] as number) < (load[best] as number))) {
        best = i;
        bestBound = bound;
      }
    }
    load[best] = (load[best] as number) + u.minutes;
    longest[best] = Math.max(longest[best] as number, u.minutes);
    (out[best] as Unit[]).push(u);
  }
  return out;
}

/** Parses list-reporter lines from CI logs: { project -> { key -> minutes } }, the longest attempt per log, averaged over logs. */
export function timingsFromLogs(logs: readonly string[]): Record<string, Record<string, number>> {
  const sums: Record<string, Record<string, { total: number; n: number }>> = {};
  const line = /(?:✓|✘)\s+\d+\s+\[([^\]]+)\]\s+›\s+(\S+?):\d+:\d+\s+›\s+(.*?)(?:\s+\(retry #\d+\))?\s+\((\d+(?:\.\d+)?)(ms|s|m|h)\)\s*$/;
  const unit: Record<string, number> = { ms: 1 / 60000, s: 1 / 60, m: 1, h: 60 };
  for (const log of logs) {
    const best: Record<string, Record<string, number>> = {};
    for (const l of log.split('\n')) {
      const m = line.exec(l);
      if (!m) continue;
      const [, project, file, titles, v, u] = m as unknown as [string, string, string, string, string, string];
      const key = `${file.replace(/^tests\/e2e\//, '')} ${SEP} ${titles}`;
      const mins = Number(v) * (unit[u] as number);
      const p = (best[project] ??= {});
      p[key] = Math.max(p[key] ?? 0, mins);
    }
    for (const [project, keys] of Object.entries(best))
      for (const [key, mins] of Object.entries(keys)) {
        const s = ((sums[project] ??= {})[key] ??= { total: 0, n: 0 });
        s.total += mins;
        s.n += 1;
      }
  }
  return Object.fromEntries(
    Object.entries(sums).map(([p, keys]) => [p, Object.fromEntries(Object.entries(keys).map(([k, s]) => [k, Math.round((s.total / s.n) * 100) / 100]))]),
  );
}

export function readTimings(file = TIMINGS_FILE): Timings {
  return JSON.parse(readFileSync(file, 'utf8')) as Timings;
}

function listProject(project: string): JsonReport {
  const bin = path.join(repoRoot, 'node_modules', '.bin', 'playwright');
  const r = spawnSync(bin, ['test', '--list', '--reporter=json', `--project=${project}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`playwright --list exited ${String(r.status)}: ${r.stderr}`);
  return JSON.parse(r.stdout) as JsonReport;
}

function main(): number {
  const [cmd, ...rest] = args();
  if (cmd === 'timings') {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { write: { type: 'boolean', default: false } } });
    const parsed = timingsFromLogs(positionals.map((f) => readFileSync(f, 'utf8')));
    for (const [p, keys] of Object.entries(parsed)) console.log(`${p}: ${Object.keys(keys).length} tests, ${Object.values(keys).reduce((a, b) => a + b, 0).toFixed(1)} min`);
    if (values.write) {
      const t = readTimings();
      for (const [p, keys] of Object.entries(parsed)) t.projects[p] = Object.fromEntries(Object.entries({ ...t.projects[p], ...keys }).sort(([a], [b]) => (a < b ? -1 : 1)));
      writeFileSync(TIMINGS_FILE, `${JSON.stringify(t, null, 2)}\n`);
    }
    return 0;
  }
  if (cmd !== 'plan') {
    console.error('usage: e2e-plan.ts plan --project <p> --shards <n> --shard <i> --out <file> [--workers 2] [--print] | timings <log>... [--write]');
    return 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      project: { type: 'string' },
      shards: { type: 'string' },
      shard: { type: 'string' },
      out: { type: 'string' },
      workers: { type: 'string', default: '2' },
      print: { type: 'boolean', default: false },
    },
  });
  const project = values.project ?? '';
  const shards = Number(values.shards);
  const shard = Number(values.shard);
  const workers = Number(values.workers);
  if (!project || !(shard >= 1 && shard <= shards)) {
    console.error(`e2e-plan: need --project and 1 <= --shard <= --shards (got ${String(values.shard)} of ${String(values.shards)})`);
    return 2;
  }
  const tests = collectTests(listProject(project), project);
  const minutes = estimator(tests, readTimings().projects[project] ?? {});
  const testDir = path.join(repoRoot, 'tests', 'e2e');
  const serialFiles = new Map<string, boolean>();
  const serialOf = (f: string): boolean => {
    if (!serialFiles.has(f)) serialFiles.set(f, isSerialSource(readFileSync(path.join(testDir, f), 'utf8')));
    return serialFiles.get(f) as boolean;
  };
  const plan = pack(unitsOf(tests, (t) => serialOf(t.spec) || serialOf(t.file), minutes), shards, workers);
  const mine = plan[shard - 1] ?? [];
  const lines = shardLines(project, mine);
  if (values.out) writeFileSync(values.out, `# ${project} shard ${shard}/${shards} (tools/ci/e2e-plan.ts)\n${lines.join('\n')}\n`);
  const total = (us: Unit[]): number => us.reduce((a, u) => a + u.minutes, 0);
  if (values.print)
    plan.forEach((us, i) =>
      console.log(`shard ${i + 1}: ${us.reduce((a, u) => a + u.tests.length, 0)} tests, ${total(us).toFixed(1)} test-min, longest unit ${Math.max(0, ...us.map((u) => u.minutes)).toFixed(1)}, bound ${shardBound(us, workers).toFixed(1)} min`),
    );
  console.log(`e2e-plan: ${project} shard ${shard}/${shards}: ${mine.reduce((a, u) => a + u.tests.length, 0)} of ${tests.length} tests, ${total(mine).toFixed(1)} test-min, at most about ${shardBound(mine, workers).toFixed(1)} min on ${workers} workers`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());

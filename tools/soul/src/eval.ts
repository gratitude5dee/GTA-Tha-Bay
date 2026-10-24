/**
 * npc:eval (M06a4): the in-character evaluation harness of 04-npc-builder.md section C6.
 *
 *   pnpm npc:eval -- [--soul <id|all>] [--suite redteam|golden|probes|all] [--replay | --live | --record | --write-synthetic]
 *                    [--recordings <dir>] [--out <dir>] [--run <name>]
 *
 *  --replay           (default) answers come from packages/npc/evals/recordings, keyed by the sha256 of the request body. Deterministic; runs in CI.
 *  --live             asks the model with the `ci-evals` key (ANTHROPIC_EVALS_KEY), then the Sonnet judge through the Batch API.
 *                     Without the key: prints `SKIP npc:eval --live: ANTHROPIC_EVALS_KEY not set` and exits 0.
 *  --record           like --live, and stores every answer as a recording (replacing the synthetic ones).
 *  --write-synthetic  rewrites the hand-written synthetic recordings from the `reply` fields of the suites. Run it after a soul, the rules
 *                     block, the turn schema or a suite changes.
 * Exit code 1 when a deterministic check fails, a recording is missing or the golden rate is under 90 %. Judge gates are reports until M10c.
 * Reports go to tests/reports/npc-evals/<run>/<npcId>.json and summary.json.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { compileRealNames } from '../../../packages/shared/src/assets/gates/names.ts';
import type { RealNameMatcher } from '../../../packages/shared/src/assets/gates/names.ts';
import { compileSoul } from '../../../packages/shared/src/npc/compile.ts';
import { anthropicBatchJudge, anthropicModel } from '../../../packages/npc/evals/live.ts';
import { runEvals, writeSynthetic } from '../../../packages/npc/evals/runner.ts';
import { parseBuilderProbes, parseGolden, parseRedteam, validateSuites } from '../../../packages/npc/evals/suites.ts';
import type { EvalMode, EvalSoul, Recording, RecordingFile, RecordingStore, RunReport, SuiteName, Suites } from '../../../packages/npc/evals/types.ts';
import { loadRealSide } from '../../ci/names-lint.ts';
import { args } from '../../ci/run.ts';
import { isMain } from '../../ci/lib/common.ts';
import { loadRules, readJson, soulRoot } from './common.ts';
import { soulPathFor } from './compile.ts';

export const EVALS_DIR = 'packages/npc/evals';
export const REPORT_DIR = 'tests/reports/npc-evals';

/** File-backed recordings: `<dir>/<npcId>.json`, entries sorted by key so a rewrite changes only what changed. */
export class FileRecordings implements RecordingStore {
  private readonly files = new Map<string, RecordingFile>();
  private readonly dirty = new Set<string>();
  constructor(private readonly dir: string) {}

  private file(npcId: string): RecordingFile {
    let f = this.files.get(npcId);
    if (f === undefined) {
      const p = path.join(this.dir, `${npcId}.json`);
      f = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as RecordingFile) : { schema: 'npc-eval-recordings/1', npcId, entries: {} };
      this.files.set(npcId, f);
    }
    return f;
  }
  get(npcId: string, key: string): Recording | undefined {
    return this.file(npcId).entries[key];
  }
  put(npcId: string, key: string, rec: Recording): void {
    this.file(npcId).entries[key] = rec;
    this.dirty.add(npcId);
  }
  /** Replaces the entries of a soul with exactly those put since `reset` (used by --write-synthetic so stale keys disappear). */
  reset(npcId: string): void {
    this.files.set(npcId, { schema: 'npc-eval-recordings/1', npcId, entries: {} });
    this.dirty.add(npcId);
  }
  save(): number {
    mkdirSync(this.dir, { recursive: true });
    for (const npcId of this.dirty) {
      const f = this.file(npcId);
      const sorted: Record<string, Recording> = {};
      for (const k of Object.keys(f.entries).sort()) sorted[k] = f.entries[k] as Recording;
      writeFileSync(path.join(this.dir, `${npcId}.json`), `${JSON.stringify({ ...f, entries: sorted }, null, 1)}\n`);
    }
    return this.dirty.size;
  }
}

/** The suites under `<evals>/`: redteam/*.yaml, golden/<npcId>.yaml, builder-probes.yaml. */
export function loadSuites(evals: string): Suites {
  const redteam = [];
  const rdir = path.join(evals, 'redteam');
  if (existsSync(rdir)) {
    for (const name of readdirSync(rdir).filter((n) => n.endsWith('.yaml')).sort()) redteam.push(...parseRedteam(readFileSync(path.join(rdir, name), 'utf8'), `redteam/${name}`));
  }
  const bp = path.join(evals, 'builder-probes.yaml');
  const probes = existsSync(bp) ? parseBuilderProbes(readFileSync(bp, 'utf8')) : [];
  const golden = new Map<string, ReturnType<typeof parseGolden>>();
  const gdir = path.join(evals, 'golden');
  if (existsSync(gdir)) {
    for (const name of readdirSync(gdir).filter((n) => n.endsWith('.yaml')).sort()) {
      const g = parseGolden(readFileSync(path.join(gdir, name), 'utf8'), `golden/${name}`);
      golden.set(g.npc, g);
    }
  }
  return { redteam, probes, golden };
}

/** The active souls of the roster as the harness plays them. */
export function loadEvalSouls(root: string, only: readonly string[] | null): { rulesText: string; souls: EvalSoul[] } {
  const rules = loadRules(root);
  const roster = readJson<{ entries: { id: string; soul: string; status: string }[] }>(root, 'content/npcs/roster.json');
  const souls: EvalSoul[] = [];
  for (const e of roster.entries) {
    if (e.status !== 'active' || (only !== null && !only.includes(e.id))) continue;
    const out = compileSoul(readFileSync(soulPathFor(root, e.soul), 'utf8'), rules);
    const c = out.compiled;
    souls.push({
      id: e.id,
      promptB: out.promptTxt,
      compiled: c as EvalSoul['compiled'],
      persona: {
        name: c.name,
        shortBio: c.shortBio,
        register: c.speech.register,
        lexicon: c.speech.lexicon.map((l) => l.term),
        catchphrases: c.speech.catchphrases,
        avoid: c.speech.avoid,
      },
    });
  }
  return { rulesText: rules.text, souls };
}

function realNames(env: NodeJS.ProcessEnv): RealNameMatcher[] | null {
  const file = loadRealSide(env['DV_NAMES_REAL_JSON']);
  return file === null ? null : compileRealNames(file.entries);
}

export function formatSummary(r: RunReport): string[] {
  const lines = [`npc:eval ${r.mode} run ${r.run}: ${r.ok ? 'PASS' : 'FAIL'}`];
  for (const s of r.souls) {
    lines.push(`  ${s.npcId}${s.synthetic ? ' (synthetic recordings)' : ''}: ${s.ok ? 'ok' : 'FAIL'}`);
    for (const g of s.gates) lines.push(`    ${g.pass ? 'pass' : g.kind === 'report' ? 'note' : 'FAIL'} ${g.name}: ${g.value}`);
    for (const suite of s.suites) for (const f of suite.failures.slice(0, 5)) lines.push(`    ${f.id}: ${f.check} ${f.detail}`);
    if (!s.judge.ran) lines.push(`    judge: ${s.judge.reason ?? 'not run'}`);
  }
  return lines;
}

export interface EvalCliOptions {
  root: string;
  soul: string;
  suite: string;
  mode: EvalMode | 'write-synthetic';
  recordings?: string | undefined;
  out?: string | undefined;
  run?: string | undefined;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

export async function runEvalCli(o: EvalCliOptions): Promise<number> {
  const evalsDir = path.join(o.root, EVALS_DIR);
  const wanted: SuiteName[] = o.suite === 'all' ? ['redteam', 'golden', 'probes'] : [o.suite as SuiteName];
  if (!wanted.every((s) => s === 'redteam' || s === 'golden' || s === 'probes')) {
    o.log(`npc:eval: unknown suite "${o.suite}" (redteam, golden, probes or all)`);
    return 1;
  }
  if ((o.mode === 'live' || o.mode === 'record') && !o.env['ANTHROPIC_EVALS_KEY']) {
    o.log(`SKIP npc:eval --${o.mode}: ANTHROPIC_EVALS_KEY not set`);
    return 0;
  }
  const only = o.soul === 'all' ? null : o.soul.split(',');
  const { rulesText, souls } = loadEvalSouls(o.root, only);
  if (souls.length === 0) {
    o.log(`npc:eval: no active soul matches "${o.soul}"`);
    return 1;
  }
  const suites = loadSuites(evalsDir);
  const problems = validateSuites(suites, souls.map((s) => s.id));
  if (problems.length > 0) {
    for (const p of problems.slice(0, 20)) o.log(`npc:eval: ${p}`);
    return 1;
  }
  const recordings = new FileRecordings(path.resolve(o.root, o.recordings ?? `${EVALS_DIR}/recordings`));

  if (o.mode === 'write-synthetic') {
    for (const s of souls) recordings.reset(s.id);
    const n = writeSynthetic({ run: 'synthetic', rulesText, souls, suites, wanted: ['redteam', 'golden', 'probes'], recordings, names: null });
    recordings.save();
    o.log(`npc:eval: wrote ${n} synthetic recordings for ${souls.length} souls to ${path.relative(o.root, path.resolve(o.root, o.recordings ?? `${EVALS_DIR}/recordings`))}`);
    return 0;
  }

  const key = o.env['ANTHROPIC_EVALS_KEY'];
  const live = o.mode === 'live' || o.mode === 'record';
  const run = o.run ?? `${o.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const report = await runEvals({
    mode: o.mode,
    run,
    rulesText,
    souls,
    suites,
    wanted,
    recordings,
    ...(live && key ? { model: anthropicModel(key), judge: anthropicBatchJudge(key) } : {}),
    names: realNames(o.env),
  });
  if (o.mode === 'record') recordings.save();

  const outDir = path.resolve(o.root, o.out ?? REPORT_DIR, run);
  mkdirSync(outDir, { recursive: true });
  for (const s of report.souls) writeFileSync(path.join(outDir, `${s.npcId}.json`), `${JSON.stringify(s, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify({ run, mode: report.mode, ok: report.ok, souls: report.souls.map((s) => ({ npcId: s.npcId, ok: s.ok, gates: s.gates })) }, null, 2)}\n`);
  for (const l of formatSummary(report)) o.log(l);
  o.log(`npc:eval: report written to ${path.relative(o.root, outDir)}`);
  return report.exitCode;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: args(),
    options: {
      root: { type: 'string' },
      soul: { type: 'string', default: 'all' },
      suite: { type: 'string', default: 'all' },
      replay: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      record: { type: 'boolean', default: false },
      'write-synthetic': { type: 'boolean', default: false },
      recordings: { type: 'string' },
      out: { type: 'string' },
      run: { type: 'string' },
    },
  });
  const mode: EvalCliOptions['mode'] = values['write-synthetic'] ? 'write-synthetic' : values.record ? 'record' : values.live ? 'live' : 'replay';
  const code = await runEvalCli({
    root: path.resolve(values.root ?? soulRoot),
    soul: values.soul,
    suite: values.suite,
    mode,
    recordings: values.recordings,
    out: values.out,
    run: values.run,
    env: process.env,
    log: (l) => console.log(l),
  });
  process.exit(code);
}

if (isMain(import.meta.url)) void main();

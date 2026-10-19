/**
 * perf:verify (11-platform-perf.md section 5, M01c). Judges a device `perf.json` against the tier budget:
 *
 *   tsx tools/ci/perf-verify.ts <perf.json> --tier <id> [--checklist <file>] [--counts-only]
 *
 * It asserts: counts and memory at or under the tier budget (per view pass); medianMs <= frameBudgetMs x 1.05; p95Ms <= x 1.5;
 * over50ms <= durationS / 60 (XR: over2xBudget); errors.gpuLost == 0; boot at or under its budgets; every checklist
 * expectation. One line per assertion; exit 1 when any fails. `--counts-only` keeps the counts and memory rows, the rows
 * that stay valid on a software renderer (frame times from SwiftShader are never asserted).
 *
 * M00d `--auto`: the tier comes from the report's `tier`, and the checklist from the path convention
 * `.../<M##>/<device>/perf.json` -> `<checklist-dir>/<M##>-<device>.json` (`--checklist-dir`, default tools/ci/checklists).
 * A missing checklist fails with `no checklist for <M##>-<device>`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DeviceChecklist, Expectation, PerfReport, QualityTierId, TierBudget } from '../../packages/shared/src/index.ts';
import { args } from './run.ts';
import { isMain, readJson, toolsRoot } from './lib/common.ts';
import Ajv2020 from 'ajv/dist/2020.js';

export interface VerifyLine {
  ok: boolean;
  /** Dotted metric name, e.g. `counts.renderObjectsMax`. */
  id: string;
  text: string;
}

export interface VerifyOptions {
  tier: QualityTierId;
  checklist?: DeviceChecklist;
  countsOnly?: boolean;
}

const TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];
export const MEDIAN_FACTOR = 1.05;
export const P95_FACTOR = 1.5;

interface BudgetFile {
  tiers: Record<QualityTierId, TierBudget>;
}

export function loadBudget(tier: QualityTierId, root: string = toolsRoot): TierBudget {
  const file = readJson<BudgetFile>(path.join(root, 'config', 'tier-budgets.json'));
  const b = file.tiers[tier];
  if (!b) throw new Error(`unknown tier ${tier}`);
  return b;
}

let validator: ((data: unknown) => string[]) | null = null;
/** Schema errors of a PerfReport against tools/ci/schemas/perf-report.v1.json; empty means valid. */
export function perfReportErrors(report: unknown): string[] {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(readJson(path.join(toolsRoot, 'tools', 'ci', 'schemas', 'perf-report.v1.json')));
    validator = (data) => (validate(data) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`));
  }
  return validator(report);
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function le(id: string, label: string, value: number, limit: number, note = ''): VerifyLine {
  const ok = value <= limit + 1e-9; // 33.3 x 1.5 is 49.949999999999996 in floating point
  return { ok, id, text: `${label} ${fmt(value)} ${ok ? '<=' : '>'} ${fmt(limit)}${note ? ` (${note})` : ''}` };
}

/** Reads a dotted path such as `frames.p95Ms` from a report. */
export function metricOf(report: unknown, metric: string): unknown {
  let cur: unknown = report;
  for (const key of metric.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function expectation(report: PerfReport, e: Expectation): VerifyLine {
  const v = metricOf(report, e.metric);
  const id = `checklist.${e.metric}`;
  if (v === undefined || v === null) return { ok: false, id, text: `${e.metric} is missing (expected ${e.op} ${String(e.value)})` };
  let ok: boolean;
  if (e.op === '==') ok = v === e.value;
  else if (typeof v === 'number' && typeof e.value === 'number') ok = e.op === '<=' ? v <= e.value : v >= e.value;
  else ok = false;
  return { ok, id, text: `${e.metric} ${String(v)} ${e.op} ${String(e.value)}${ok ? '' : ' (not met)'}` };
}

export function verifyReport(report: PerfReport, o: VerifyOptions, budgetIn?: TierBudget): VerifyLine[] {
  const b = budgetIn ?? loadBudget(o.tier);
  const lines: VerifyLine[] = [];
  const t = o.tier;
  lines.push({
    ok: report.tier === t,
    id: 'tier',
    text: report.tier === t ? `report tier ${report.tier} matches --tier` : `report tier ${report.tier} differs from --tier ${t}`,
  });

  const c = report.counts;
  lines.push(le('counts.renderObjectsMax', 'render objects max', c.renderObjectsMax, b.render.maxRenderObjects, `${t} budget per view pass`));
  lines.push(le('counts.trianglesMax', 'triangles max', c.trianglesMax, b.render.maxTriangles, `${t} budget per view pass`));
  if (c.gpuDrawCmdsMax === null) lines.push({ ok: true, id: 'counts.gpuDrawCmdsMax', text: 'gpu draw commands not reported (WebGPU backend)' });
  else lines.push(le('counts.gpuDrawCmdsMax', 'gpu draw commands max', c.gpuDrawCmdsMax, b.render.maxGpuDrawCmds));
  lines.push(le('counts.texturesMB', 'texture MB', c.texturesMB, b.memory.maxTextureMB));
  lines.push(le('counts.gpuResourcesMB', 'gpu resource MB', c.gpuResourcesMB, b.memory.maxGpuResourceMB));
  lines.push(le('memory.accountedHeapMBMax', 'accounted heap MB max', report.memory.accountedHeapMBMax, b.memory.maxAccountedHeapMB));
  lines.push(le('memory.mediaMBMax', 'media MB max', report.memory.mediaMBMax, b.memory.maxMediaMB));
  if (report.memory.webContentEstMB !== null && b.memory.maxWebContentMB !== null) {
    lines.push(le('memory.webContentEstMB', 'web content MB estimate', report.memory.webContentEstMB, b.memory.maxWebContentMB));
  }
  lines.push({
    ok: report.errors.gpuLost === 0,
    id: 'errors.gpuLost',
    text: `gpu device losses ${report.errors.gpuLost} ${report.errors.gpuLost === 0 ? '==' : '!='} 0`,
  });

  if (!o.countsOnly) {
    const f = report.frames;
    const budget = b.frame.frameBudgetMs;
    lines.push(le('frames.medianMs', 'median frame ms', f.medianMs, budget * MEDIAN_FACTOR, `frame budget ${fmt(budget)} x ${MEDIAN_FACTOR}`));
    lines.push(le('frames.p95Ms', 'p95 frame ms', f.p95Ms, budget * P95_FACTOR, `frame budget ${fmt(budget)} x ${P95_FACTOR}`));
    const allowed = report.scenario.durationS / 60;
    if (b.render.viewPasses === 2 || t.startsWith('xr-')) {
      lines.push(le('frames.over2xBudget', 'frames over 2x budget', f.over2xBudget, allowed, `durationS ${report.scenario.durationS} / 60`));
    } else {
      lines.push(le('frames.over50ms', 'frames over 50 ms', f.over50ms, allowed, `durationS ${report.scenario.durationS} / 60`));
    }
    if (report.boot.warmBootToPlayableS !== null) {
      lines.push(le('boot.warmBootToPlayableS', 'warm boot s', report.boot.warmBootToPlayableS, b.boot.warmBootToPlayableS));
    }
    if (report.boot.coldDownloadMB !== null) lines.push(le('boot.coldDownloadMB', 'cold download MB', report.boot.coldDownloadMB, b.boot.coldBootDownloadMB));
    for (const step of o.checklist?.steps ?? []) for (const e of step.expect ?? []) lines.push(expectation(report, e));
  }
  return lines;
}

export interface VerifyResult {
  ok: boolean;
  lines: string[];
}

/** File-level entry used by the CLI and by check:perf: schema first, then the assertions. */
export function verifyFile(file: string, o: VerifyOptions): VerifyResult {
  const out: string[] = [];
  let report: unknown;
  try {
    report = readJson(file);
  } catch (e) {
    return { ok: false, lines: [`FAIL  ${file}: cannot read (${e instanceof Error ? e.message : String(e)})`] };
  }
  const errors = perfReportErrors(report);
  if (errors.length > 0) {
    return { ok: false, lines: errors.map((m) => `FAIL  schema ${m}`) };
  }
  const lines = verifyReport(report as PerfReport, o);
  for (const l of lines) out.push(`${l.ok ? 'PASS' : 'FAIL'}  ${l.text}`);
  return { ok: lines.every((l) => l.ok), lines: out };
}

/** `.../<M##>/<device>/perf.json` -> `<M##>-<device>`; null when the path does not follow the convention. */
export function checklistIdOf(file: string): string | null {
  const parts = path.resolve(file).split(path.sep);
  const device = parts[parts.length - 2];
  const milestone = parts[parts.length - 3];
  if (!device || !milestone || !/^M\d{2}(?:[a-z]\d?)?$/.test(milestone)) return null;
  return `${milestone}-${device}`;
}

export interface AutoResolution {
  tier?: QualityTierId;
  checklistFile?: string;
  checklistId?: string;
  error?: string;
}

/** Resolves --auto for a report file: tier from the report, checklist from the path convention. */
export function resolveAuto(file: string, checklistDir: string): AutoResolution {
  let report: unknown;
  try {
    report = readJson(file);
  } catch (e) {
    return { error: `cannot read ${file} (${e instanceof Error ? e.message : String(e)})` };
  }
  const tier = (report as { tier?: unknown }).tier;
  if (typeof tier !== 'string' || !TIERS.includes(tier as QualityTierId)) return { error: 'report has no valid tier' };
  const id = checklistIdOf(file);
  if (!id) return { error: `path ${file} does not follow .../<M##>/<device>/perf.json` };
  const checklistFile = path.join(checklistDir, `${id}.json`);
  if (!existsSync(checklistFile)) return { tier: tier as QualityTierId, checklistId: id, error: `no checklist for ${id}` };
  return { tier: tier as QualityTierId, checklistFile, checklistId: id };
}

function main(): void {
  const argv = args();
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = argv.find((a, i) => !a.startsWith('--') && !['--tier', '--checklist', '--checklist-dir'].includes(argv[i - 1] ?? ''));
  let tier = flag('--tier') as QualityTierId | undefined;
  let checklistFile = flag('--checklist');
  if (argv.includes('--auto')) {
    if (!file || !existsSync(file)) {
      console.error(`perf:verify: ${file ?? '<perf.json>'} not found`);
      process.exit(2);
    }
    const auto = resolveAuto(file, flag('--checklist-dir') ?? path.join(toolsRoot, 'tools', 'ci', 'checklists'));
    if (auto.error) {
      console.error(`perf:verify --auto: ${auto.error}`);
      process.exit(1);
    }
    tier = auto.tier;
    checklistFile = auto.checklistFile;
    console.log(`perf:verify --auto tier=${auto.tier} checklist=${auto.checklistId}.json`);
  }
  if (!file || !tier || !TIERS.includes(tier)) {
    console.error('usage: perf:verify -- <perf.json> (--tier <desktop-ultra|desktop|mobile|mobile-low|xr-quest|xr-visionpro> | --auto [--checklist-dir <dir>]) [--checklist <file>] [--counts-only]');
    process.exit(2);
  }
  if (!existsSync(file)) {
    console.error(`perf:verify: ${file} not found`);
    process.exit(2);
  }
  const checklist = checklistFile ? readJson<DeviceChecklist>(checklistFile) : undefined;
  const result = verifyFile(file, { tier, ...(checklist ? { checklist } : {}), countsOnly: argv.includes('--counts-only') });
  console.log(`perf:verify ${file} --tier ${tier}${argv.includes('--counts-only') ? ' --counts-only' : ''}`);
  for (const l of result.lines) console.log(`  ${l}`);
  const failed = result.lines.filter((l) => l.startsWith('FAIL')).length;
  console.log(failed === 0 ? 'perf:verify passed' : `perf:verify failed (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (isMain(import.meta.url)) main();

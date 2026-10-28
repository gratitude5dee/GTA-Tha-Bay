/**
 * genai:spike. Budget-capped staff CLI spike (M00c): one original test character through sheet -> mesh -> rig on fal,
 * cutscene shots and provider clips, recording what research could not verify. Metadata only reaches the repo.
 *
 *   tsx tools/assets/genai-spike.ts --plan                          offline: steps, registry keys, status, estimates
 *   tsx tools/assets/genai-spike.ts --run [--only C1,C3] [--keep] [--skip-blocked]
 *                                                                   no FAL_KEY: writes the skip record, zero network calls
 *   tsx tools/assets/genai-spike.ts --verify                        offline: results.json, schema, ledger cap, U-items
 *
 * Writes only research/genai-spike/*, research/genai-spike-results.md and .spike/ (git-ignored). Steps run one at a
 * time (fal concurrency 2 on new accounts). Env: FAL_KEY, DV_SPIKE_CAP_MICROS, DV_SPIKE_SELF_PHOTO, DV_SPIKE_SELF_CONSENT.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { lineCapMicros } from '../../packages/shared/src/genai/lines.ts';
import type { GenAiRegistry } from '../../packages/shared/src/genai/registry.ts';
import { args } from '../ci/run.ts';
import { isMain, readJson, sha256Hex, toolsRoot } from '../ci/lib/common.ts';
import { download, findOutputs, runQueued, type FetchFn, type QueueRun } from './lib/fal-queue.ts';
import { cropPanels, probeC2pa, probeGlb, probeMedia, toolsAvailable } from './lib/media-probe.ts';
import {
  checkCallable, microsToUsd, planFindings, planFit, planTotalMicros, resolveKey, SpikeLedger,
  type LedgerFile, type PlanStep, type SpikeEnv, type SpikePlan,
} from './lib/spike-ledger.ts';

export type StepStatus = 'ok' | 'failed' | 'skipped' | 'refused' | 'not_run';
export type Outcome = 'answered' | 'partly' | 'unanswered' | 'skipped';

export interface OutputRow {
  name: string; contentType: string | null; fileSize: number; contentLengthHeader: boolean | null; sha256: string;
  media: Record<string, unknown> | null; c2pa: { present: boolean | null; method: 'c2patool' | 'heuristic'; detail: string } | null;
}

export interface StepResult {
  id: string; title: string; kind: 'fal' | 'local'; status: StepStatus; reason: string | null;
  registryKey: string | null; endpointId: string | null; registryStatus: string | null; estimateMicros: number;
  requestId: string | null; queueWaitMs: number | null; runMs: number | null; httpStatus: number | null; errorType: string | null;
  omittedParams: string[]; acceptedParams: string[]; storeIo0: boolean; retrievable: boolean | null;
  outputs: OutputRow[]; notes: string[];
}

export interface UItemResult { id: string; outcome: Outcome; detail: string }

export interface SpikeResults {
  schema: 'spike-results/1'; status: 'skipped' | 'partial' | 'complete'; reason: string | null; env: SpikeEnv;
  capMicros: number; ledgerTotalMicros: number; ranAt: string | null; tools: { ffprobe: boolean; c2patool: boolean };
  steps: StepResult[]; uItems: UItemResult[];
}

export interface Paths { root: string; researchDir: string; outDir: string; resultsJson: string; ledgerJson: string; bonesJson: string; notesJson: string; resultsMd: string }

export function pathsFor(root: string): Paths {
  const researchDir = path.join(root, 'research', 'genai-spike');
  return {
    root, researchDir, outDir: path.join(root, '.spike', 'out'),
    resultsJson: path.join(researchDir, 'results.json'), ledgerJson: path.join(researchDir, 'ledger.json'),
    bonesJson: path.join(researchDir, 'meshy-bones.json'), notesJson: path.join(researchDir, 'operator-notes.json'),
    resultsMd: path.join(root, 'research', 'genai-spike-results.md'),
  };
}

/** The plan file with its cap taken from the `spike` line of config/guardrails.yaml (M10d0, DL-741); plan.json no longer holds a cap. */
export function loadPlan(root: string): SpikePlan {
  const raw = readJson<Omit<SpikePlan, 'capMicros' | 'plannedMaxMicros'>>(path.join(root, 'tools', 'assets', 'spike', 'plan.json'));
  const cap = lineCapMicros('spike');
  return { ...raw, capMicros: cap, plannedMaxMicros: cap };
}

/** Sections of briefs.md by `## name` heading. */
export function parseBriefs(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of md.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    out[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan

export function renderPlan(plan: SpikePlan, reg: GenAiRegistry): string[] {
  const lines = [`genai:spike plan (${plan.steps.length} steps, env ${plan.env})`];
  const fit = planFit(plan, reg);
  const verdictOf = new Map(fit.steps.map((f) => [f.id, f]));
  for (const s of plan.steps) {
    const keys = s.kind === 'local' ? ['local'] : [s.registryKey, ...(s.alsoRegistryKeys ?? [])].map((k) => k ?? '?');
    const r = s.registryKey && s.kind === 'fal' ? resolveKey(reg, s.registryKey) : undefined;
    const status = s.kind === 'local' ? '-' : (r?.status ?? 'unresolved');
    const v = verdictOf.get(s.id);
    const mark = v?.verdict === 'refused' ? `refused ${v.code ?? ''}` : v?.verdict === 'over-cap' ? 'over cap' : v?.verdict === 'local' ? '-' : 'fits';
    lines.push(`  ${s.id.padEnd(3)} ${keys.join(' + ').padEnd(56)} ${status.padEnd(8)} ${microsToUsd(s.estimateMicros).padStart(6)}  ${mark.padEnd(8)} ${s.title}`);
  }
  const total = planTotalMicros(plan);
  const ids = (f: typeof fit, k: string): string => f.steps.filter((x) => x.verdict === k).map((x) => x.id).join(' ') || 'none';
  const noBlocked = planFit(plan, reg, { skipBlocked: true });
  lines.push(`total estimate ${microsToUsd(total)} (${total} micros); the spike line is ${microsToUsd(plan.capMicros)} (${plan.capMicros} micros)`);
  lines.push(`--run: reserves at most ${microsToUsd(fit.reservableMicros)}; under the line: ${ids(fit, 'fits')}; refused before reserving: ${ids(fit, 'refused')}; over the line: ${ids(fit, 'over-cap')}`);
  lines.push(`--run --skip-blocked: reserves at most ${microsToUsd(noBlocked.reservableMicros)}; under the line: ${ids(noBlocked, 'fits')}; skipped: ${ids(noBlocked, 'skipped')}; over the line: ${ids(noBlocked, 'over-cap')}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------
// Param tokens

export class MissingInput extends Error {}

function dataUri(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', glb: 'model/gltf-binary' };
  return `data:${mime[ext] ?? 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;
}

function findLocal(outDir: string, stepId: string, name: string): string {
  const dir = path.join(outDir, stepId);
  const exact = path.join(dir, name);
  if (existsSync(exact)) return exact;
  const ext = path.extname(name);
  const alt = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort()[0] : undefined;
  if (alt) return path.join(dir, alt);
  throw new MissingInput(`no local output ${stepId}/${name}; run ${stepId} first`);
}

export interface TokenCtx { briefs: Record<string, string>; outDir: string; env: Record<string, string | undefined> }

export function resolveParams(params: Record<string, unknown>, ctx: TokenCtx): Record<string, unknown> {
  const one = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.startsWith('@brief:')) {
        const b = ctx.briefs[v.slice(7)];
        if (!b) throw new MissingInput(`brief ${v.slice(7)} not found`);
        return b;
      }
      if (v.startsWith('@file:')) {
        const [id, ...rest] = v.slice(6).split('/');
        return dataUri(findLocal(ctx.outDir, id ?? '', rest.join('/')));
      }
      if (v.startsWith('@files:')) {
        const [id, ...rest] = v.slice(7).split('/');
        const names = rest.join('/').split(',');
        return names.map((n) => dataUri(findLocal(ctx.outDir, id ?? '', n)));
      }
      if (v === '@selfPhoto') {
        const p = ctx.env.DV_SPIKE_SELF_PHOTO;
        if (!p || !existsSync(p)) throw new MissingInput('DV_SPIKE_SELF_PHOTO does not point to a file');
        return [dataUri(p)];
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(one);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, one(x)]));
    return v;
  };
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, one(v)]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Run

export interface RunDeps {
  root: string;
  plan: SpikePlan;
  registry: GenAiRegistry;
  briefs: Record<string, string>;
  env: Record<string, string | undefined>;
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  only?: string[];
  keep?: boolean;
  skipBlocked?: boolean;
  pollMs?: number;
  retryBackoffMs?: number[];
  log?: (line: string) => void;
}

function blankStep(s: PlanStep, patch: Partial<StepResult> = {}): StepResult {
  return {
    id: s.id, title: s.title, kind: s.kind, status: 'not_run', reason: null, registryKey: s.registryKey, endpointId: null,
    registryStatus: null, estimateMicros: s.estimateMicros, requestId: null, queueWaitMs: null, runMs: null, httpStatus: null,
    errorType: null, omittedParams: [], acceptedParams: [], storeIo0: !!s.storeIo0, retrievable: null, outputs: [], notes: [], ...patch,
  };
}

export function skipRecord(plan: SpikePlan, tools: { ffprobe: boolean; c2patool: boolean }, reason: string): SpikeResults {
  return {
    schema: 'spike-results/1', status: 'skipped', reason, env: plan.env, capMicros: plan.capMicros, ledgerTotalMicros: 0, ranAt: null, tools,
    steps: plan.steps.map((s) => blankStep(s, { status: 'not_run', reason })),
    uItems: plan.uItems.map((u) => ({ id: u.id, outcome: 'skipped' as const, detail: reason })),
  };
}

function loadJsonIf<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, v: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
}

const MEDIA_TYPES = /^(video|audio)\//;
const C2PA_TYPES = /^(video|audio|image)\//;

async function execFalStep(deps: RunDeps, s: PlanStep, ledger: SpikeLedger, paths: Paths, key: string): Promise<StepResult> {
  const { registry: reg, plan } = deps;
  const res = blankStep(s);
  const keys = [s.registryKey, ...(s.alsoRegistryKeys ?? [])].filter((k): k is string => !!k);
  const runs: { endpointId: string; status: string; params: Record<string, unknown> }[] = [];
  let params: Record<string, unknown>;
  try {
    params = resolveParams(s.params, { briefs: deps.briefs, outDir: paths.outDir, env: deps.env });
  } catch (e) {
    return { ...res, status: 'skipped', reason: (e as Error).message };
  }
  for (const k of keys) {
    const r = resolveKey(reg, k);
    if (!r) return { ...res, status: 'failed', reason: `registry key ${k} does not resolve` };
    const verdict = checkCallable(reg, r.endpointId, r.status, plan.env);
    if (!verdict.ok) return { ...res, endpointId: r.endpointId, registryStatus: r.status, status: 'refused', reason: `${verdict.code}: ${verdict.detail}`, errorType: verdict.code };
    if (deps.skipBlocked && r.status === 'blocked') return { ...res, endpointId: r.endpointId, registryStatus: r.status, status: 'skipped', reason: '--skip-blocked: endpoint is blocked' };
    runs.push({ endpointId: r.endpointId, status: r.status, params });
  }
  const first = runs[0];
  if (!first) return { ...res, status: 'failed', reason: 'no endpoint' };
  const reserve = ledger.reserve(s.id, s.estimateMicros);
  if (!reserve.ok) return { ...res, endpointId: first.endpointId, registryStatus: first.status, status: 'refused', reason: `${reserve.code}: ${reserve.detail}`, errorType: reserve.code };

  const qdeps = { key, fetch: deps.fetch, sleep: deps.sleep, now: deps.now, lifecycleHeader: plan.lifecycleHeader, pollMs: deps.pollMs ?? 2000, retryBackoffMs: deps.retryBackoffMs ?? [2000, 4000, 8000, 16000] };
  let last: QueueRun | undefined;
  let completed = false;
  const dropped = new Set<string>();
  for (const r of runs) {
    let p = r.params;
    let run = await runQueued(qdeps, r.endpointId, p, { storeIo0: !!s.storeIo0 });
    const droppable = (s.droppable ?? []).filter((d) => d in p);
    if (run.httpStatus === 422 && run.requestId === null && droppable.length > 0) {
      droppable.forEach((d) => dropped.add(d));
      p = Object.fromEntries(Object.entries(p).filter(([k]) => !dropped.has(k)));
      run = await runQueued(qdeps, r.endpointId, p, { storeIo0: !!s.storeIo0 });
    }
    last = run;
    res.notes.push(`${r.endpointId}: HTTP ${run.httpStatus}${run.errorType ? ` ${run.errorType}` : ''}`);
    if (run.result !== null && run.retrievable && !run.errorType) {
      completed = true;
      await collectOutputs(deps, s, res, run, paths, r.status);
    }
  }
  if (!last) return { ...res, status: 'failed' };
  res.endpointId = first.endpointId;
  res.registryStatus = first.status;
  res.requestId = last.requestId;
  res.queueWaitMs = last.queueWaitMs;
  res.runMs = last.runMs;
  res.httpStatus = last.httpStatus;
  res.retrievable = last.requestId ? last.retrievable : null;
  res.omittedParams = [...dropped];
  res.acceptedParams = (s.droppable ?? []).filter((d) => d in first.params && !dropped.has(d));
  if (last.retries429 > 0) res.notes.push(`429 retries: ${last.retries429}`);
  if (completed) res.status = 'ok';
  else {
    res.status = 'failed';
    res.errorType = last.errorType;
    res.reason = last.error ?? last.errorType ?? 'no result';
  }
  return res;
}

async function collectOutputs(deps: RunDeps, s: PlanStep, res: StepResult, run: QueueRun, paths: Paths, status: string): Promise<void> {
  const dir = path.join(paths.outDir, s.id);
  mkdirSync(dir, { recursive: true });
  const deleteAfter = (status === 'blocked' && !deps.keep) || s.id === 'R1';
  for (const o of findOutputs(run.result)) {
    const d = await download(deps.fetch, o);
    if ('error' in d) {
      res.notes.push(`download ${o.name}: ${d.error}`);
      continue;
    }
    const file = path.join(dir, `${d.name}.${d.ext}`);
    writeFileSync(file, d.bytes);
    const media = d.contentType && MEDIA_TYPES.test(d.contentType) ? (probeMedia(d.bytes, d.ext) as unknown as Record<string, unknown>) : null;
    const c2pa = d.contentType && C2PA_TYPES.test(d.contentType) ? probeC2pa(d.bytes, d.ext) : null;
    res.outputs.push({ name: `${d.name}.${d.ext}`, contentType: d.contentType, fileSize: d.fileSize, contentLengthHeader: d.contentLengthHeader, sha256: d.sha256, media, c2pa });
    if (deleteAfter) rmSync(file, { force: true });
  }
  if (deleteAfter) res.notes.push(s.id === 'R1' ? 'outputs deleted after probing (real-person photo)' : 'blocked endpoint: output deleted after probing (use --keep to retain locally)');
}

async function execLocalStep(s: PlanStep, paths: Paths): Promise<StepResult> {
  const res = blankStep(s);
  if (s.id === 'C2') {
    const src = findLocal(paths.outDir, 'C1', 'images.0.png');
    const crops = cropPanels(readFileSync(src), 4);
    const dir = path.join(paths.outDir, 'C2');
    mkdirSync(dir, { recursive: true });
    for (const c of crops) {
      writeFileSync(path.join(dir, `${c.name}.png`), c.png);
      res.outputs.push({ name: `${c.name}.png`, contentType: 'image/png', fileSize: c.png.length, contentLengthHeader: null, sha256: sha256Hex(c.png), media: { width: c.width, height: c.height }, c2pa: null });
    }
    return { ...res, status: 'ok' };
  }
  if (s.id === 'C5') {
    const dir = path.join(paths.outDir, 'C4');
    const glbs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.glb')).sort() : [];
    if (glbs.length === 0) throw new MissingInput('no GLB under .spike/out/C4; run C4 first');
    const probes: Record<string, unknown> = {};
    for (const g of glbs) {
      const bytes = new Uint8Array(readFileSync(path.join(dir, g)));
      probes[g] = await probeGlb(bytes);
      res.outputs.push({ name: g, contentType: 'model/gltf-binary', fileSize: bytes.length, contentLengthHeader: null, sha256: sha256Hex(bytes), media: null, c2pa: null });
    }
    writeJson(paths.bonesJson, { schema: 'meshy-bones/1', note: 'Metadata from the M00c spike probe; aliases are a proposal for bay_rig_v1, reviewed by a human (gate H4).', files: probes });
    return { ...res, status: 'ok' };
  }
  return { ...res, status: 'failed', reason: `no local executor for ${s.id}` };
}

export async function runSpike(deps: RunDeps): Promise<SpikeResults> {
  const { plan } = deps;
  const log = deps.log ?? ((): void => undefined);
  const paths = pathsFor(deps.root);
  const tools = toolsAvailable();
  const key = deps.env.FAL_KEY;
  if (!key) {
    const rec = skipRecord(plan, tools, 'FAL_KEY not set');
    writeJson(paths.resultsJson, rec);
    writeJson(paths.ledgerJson, new SpikeLedger(plan.capMicros).toFile());
    writeFileSync(paths.resultsMd, renderResultsMd(rec, plan));
    log('SKIP genai:spike: FAL_KEY not set; no network calls made');
    return rec;
  }
  const capEnv = Number(deps.env.DV_SPIKE_CAP_MICROS);
  const cap = Number.isInteger(capEnv) && capEnv > 0 ? Math.min(capEnv, plan.capMicros) : plan.capMicros;
  const priorLedger = loadJsonIf<LedgerFile>(paths.ledgerJson);
  const ledger = new SpikeLedger(cap, priorLedger?.entries ?? []);
  const prior = loadJsonIf<SpikeResults>(paths.resultsJson);
  const byId = new Map<string, StepResult>();
  if (prior && prior.status !== 'skipped') for (const s of prior.steps) byId.set(s.id, s);
  const selected = (id: string): boolean => !deps.only || deps.only.includes(id);
  let stopped: string | null = null;

  for (const s of plan.steps) {
    if (!selected(s.id)) {
      if (!byId.has(s.id)) byId.set(s.id, blankStep(s, { reason: 'not selected in this run' }));
      continue;
    }
    if (stopped) {
      byId.set(s.id, blankStep(s, { reason: stopped }));
      continue;
    }
    const optionalEnv = s.optional?.env.filter((e) => !deps.env[e]) ?? [];
    if (optionalEnv.length > 0) {
      byId.set(s.id, blankStep(s, { status: 'skipped', reason: `optional step: ${optionalEnv.join(', ')} not set` }));
      continue;
    }
    const failedDep = s.dependsOn.find((d) => {
      const r = byId.get(d);
      return r !== undefined && r.status !== 'ok' && !(deps.only && !deps.only.includes(d) && r.status === 'not_run');
    });
    if (failedDep) {
      byId.set(s.id, blankStep(s, { status: 'skipped', reason: `dependency ${failedDep} did not complete` }));
      continue;
    }
    log(`${s.id}: ${s.title}`);
    let r: StepResult;
    try {
      r = s.kind === 'local' ? await execLocalStep(s, paths) : await execFalStep(deps, s, ledger, paths, key);
    } catch (e) {
      r = e instanceof MissingInput ? blankStep(s, { status: 'skipped', reason: e.message }) : blankStep(s, { status: 'failed', reason: (e as Error).message });
    }
    byId.set(s.id, r);
    log(`${s.id}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    if (r.errorType === 'BUDGET') stopped = `run ended after the BUDGET refusal on ${s.id}`;
    writeJson(paths.ledgerJson, ledger.toFile());
  }

  const steps = plan.steps.map((s) => byId.get(s.id) ?? blankStep(s));
  const notes = loadJsonIf<Record<string, string>>(paths.notesJson) ?? {};
  const allOk = steps.every((s) => s.status === 'ok' || (s.status === 'skipped' && !!plan.steps.find((p) => p.id === s.id)?.optional));
  const results: SpikeResults = {
    schema: 'spike-results/1', status: allOk ? 'complete' : 'partial', reason: stopped, env: plan.env, capMicros: cap,
    ledgerTotalMicros: ledger.totalMicros, ranAt: new Date(deps.now()).toISOString(), tools, steps,
    uItems: deriveUItems(plan, steps, notes),
  };
  writeJson(paths.resultsJson, results);
  writeJson(paths.ledgerJson, ledger.toFile());
  writeFileSync(paths.resultsMd, renderResultsMd(results, plan));
  return results;
}

// ---------------------------------------------------------------------------------------------------------------------
// U-items

export function deriveUItems(plan: SpikePlan, steps: StepResult[], notes: Record<string, string>): UItemResult[] {
  const step = (id: string): StepResult | undefined => steps.find((s) => s.id === id);
  const ok = (id: string): boolean => step(id)?.status === 'ok';
  const why = (id: string): string => {
    const s = step(id);
    return s ? `${id} ${s.status}${s.reason ? `: ${s.reason}` : ''}` : `${id} missing`;
  };
  const mediaOutputs = steps.flatMap((s) => s.outputs.filter((o) => o.c2pa));
  const rows: UItemResult[] = plan.uItems.map((u): UItemResult => {
    const note = notes[u.id];
    const missing = u.needs.filter((n) => !ok(n));
    const needSkipped = (detail: string): UItemResult => ({ id: u.id, outcome: 'skipped', detail });
    switch (u.id) {
      case 'U-AST-1':
      case 'U-ENG-7':
        return ok('C5') ? { id: u.id, outcome: 'partly', detail: 'bone names, hierarchy, finger/jaw/face flags and clip names are in meshy-bones.json; the clip licence text is read from the Meshy page by a human (gate H4)' } : needSkipped(`not run: ${why('C5')}`);
      case 'U-AST-2':
        return ok('C3') ? { id: u.id, outcome: 'partly', detail: 'C3 accepted the four crops in the order front, left, back, right; whether the mesh honours that order needs a human look at the model' } : needSkipped(`not run: ${why('C3')}`);
      case 'U-AST-3': {
        const a1 = step('A1');
        if (!a1 || a1.status !== 'ok') return needSkipped(`not run: ${why('A1')}`);
        const cl = steps.flatMap((s) => s.outputs).filter((o) => o.contentLengthHeader !== null);
        const withHeader = cl.filter((o) => o.contentLengthHeader).length;
        return { id: u.id, outcome: 'answered', detail: `with X-Fal-Store-IO: 0 the result was ${a1.retrievable ? 'retrievable' : 'not retrievable'} via response_url; Content-Length present on ${withHeader} of ${cl.length} CDN downloads` };
      }
      case 'U-AST-4': {
        if (mediaOutputs.length === 0) return needSkipped('no media output was probed');
        const present = mediaOutputs.filter((o) => o.c2pa?.present).length;
        const heuristic = mediaOutputs.some((o) => o.c2pa?.method === 'heuristic');
        return { id: u.id, outcome: heuristic ? 'partly' : 'answered', detail: `${present} of ${mediaOutputs.length} outputs carry a C2PA manifest (${heuristic ? 'heuristic byte scan where c2patool is absent' : 'c2patool'})` };
      }
      case 'U-AST-7':
        return note ? { id: u.id, outcome: 'answered', detail: note } : { id: u.id, outcome: ok('K1') ? 'unanswered' : 'skipped', detail: 'operator enters the invoice line in research/genai-spike/operator-notes.json' };
      case 'U-AST-8': {
        const r1 = step('R1');
        if (!r1 || r1.status === 'skipped' || r1.status === 'not_run') return needSkipped(r1?.reason ?? 'R1 not run');
        return { id: u.id, outcome: 'answered', detail: r1.notes.join('; ') || r1.status };
      }
      case 'U-AST-14': {
        const a1 = step('A1');
        if (!a1 || a1.status !== 'ok') return needSkipped(`not run: ${why('A1')}`);
        return { id: u.id, outcome: 'partly', detail: `TTS container ${a1.outputs[0]?.contentType ?? 'unknown'}; the iOS decode test is a device check in M01c` };
      }
      case 'U-AST-17':
      case 'U-S03-1':
        return note ? { id: u.id, outcome: 'answered', detail: note } : { id: u.id, outcome: missing.length === 0 ? 'unanswered' : 'skipped', detail: missing.length === 0 ? 'human note pending in research/genai-spike/operator-notes.json' : `not run: ${missing.join(', ')}` };
      case 'U-S03-3': {
        const vs = ['V1', 'V2', 'V3', 'V4', 'V5'].map(step).filter((s): s is StepResult => !!s && s.status !== 'skipped' && s.status !== 'not_run');
        if (vs.length === 0) return needSkipped('no video step ran');
        const detail = vs.map((s) => `${s.id}: accepted [${s.acceptedParams.join(', ')}] omitted [${s.omittedParams.join(', ')}]`).join('; ');
        return { id: u.id, outcome: vs.length === 5 ? 'answered' : 'partly', detail };
      }
      default:
        return { id: u.id, outcome: 'unanswered', detail: missing.length === 0 ? 'no rule' : `not run: ${missing.join(', ')}` };
    }
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Results page

const cell = (v: unknown): string => String(v ?? '-').replace(/\|/g, '/').replace(/\n/g, ' ');

export function renderResultsMd(r: SpikeResults, plan: SpikePlan): string {
  const out: string[] = ['# GenAI spike results (M00c)', ''];
  out.push(`Status: **${r.status}**${r.reason ? ` (${r.reason})` : ''}. Env \`${r.env}\`. Ledger ${microsToUsd(r.ledgerTotalMicros)} of cap ${microsToUsd(r.capMicros)}${r.ranAt ? `. Run at ${r.ranAt}` : ''}.`);
  out.push(`Tools: ffprobe ${r.tools.ffprobe ? 'present' : 'absent'}, c2patool ${r.tools.c2patool ? 'present' : 'absent'}. Metadata only: no media, no fal CDN URLs, no keys.`, '');
  out.push('## Steps', '', '| Step | Title | Endpoint | Registry | Status | Request | Queue ms | Run ms | HTTP | error_type | Reason |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of r.steps) {
    out.push(`| ${s.id} | ${cell(s.title)} | ${cell(s.endpointId ?? s.registryKey)} | ${cell(s.registryStatus)} | ${s.status} | ${cell(s.requestId)} | ${cell(s.queueWaitMs)} | ${cell(s.runMs)} | ${cell(s.httpStatus)} | ${cell(s.errorType)} | ${cell(s.reason)} |`);
  }
  const outputs = r.steps.flatMap((s) => s.outputs.map((o) => ({ step: s.id, o })));
  out.push('', '## Outputs', '');
  if (outputs.length === 0) out.push('None.');
  else {
    out.push('| Step | File | Content type | Bytes | Content-Length header | Container | Codec | Resolution | fps | Audio | C2PA |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { step, o } of outputs) {
      const m = (o.media ?? {}) as { container?: string; video?: { codec: string; width: number; height: number; fps: number | null }; audio?: { codec: string } | null };
      out.push(`| ${step} | ${cell(o.name)} | ${cell(o.contentType)} | ${o.fileSize} | ${cell(o.contentLengthHeader)} | ${cell(m.container)} | ${cell(m.video?.codec)} | ${m.video ? `${m.video.width}x${m.video.height}` : '-'} | ${cell(m.video?.fps)} | ${cell(m.audio?.codec ?? (m.video ? 'none' : '-'))} | ${o.c2pa ? `${o.c2pa.present === null ? '?' : o.c2pa.present ? 'yes' : 'no'} (${o.c2pa.method})` : '-'} |`);
    }
  }
  out.push('', '## U-items', '', '| Item | Question | Outcome | Detail |', '|---|---|---|---|');
  for (const u of r.uItems) out.push(`| ${u.id} | ${cell(plan.uItems.find((p) => p.id === u.id)?.question)} | ${u.outcome} | ${cell(u.detail)} |`);
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Verify

export function verifyResults(root: string, plan: SpikePlan): string[] {
  const p = pathsFor(root);
  const problems: string[] = [];
  const results = loadJsonIf<SpikeResults>(p.resultsJson);
  if (!results) return [`${path.relative(root, p.resultsJson)} is missing or not JSON; run --run first`];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(readJson(path.join(toolsRoot, 'tools', 'assets', 'schemas', 'spike-results-1.schema.json')));
  if (!validate(results)) for (const e of validate.errors ?? []) problems.push(`results.json ${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
  const ledger = loadJsonIf<LedgerFile>(p.ledgerJson);
  if (!ledger) problems.push('ledger.json is missing');
  else {
    const sum = ledger.entries.filter((e) => e.outcome === 'submitted').reduce((a, e) => a + e.estimateMicros, 0);
    if (ledger.totalMicros !== sum) problems.push(`ledger total ${ledger.totalMicros} differs from its entries (${sum})`);
    const cap = lineCapMicros('spike');
    if (ledger.totalMicros > cap) problems.push(`ledger total ${ledger.totalMicros} micros passes ${cap.toLocaleString('en-US')} (the spike line)`);
    if (ledger.capMicros !== cap) problems.push(`ledger cap ${ledger.capMicros} is not the spike line ${cap.toLocaleString('en-US')}`);
    if (results.capMicros !== cap) problems.push(`results cap ${results.capMicros} is not the spike line ${cap.toLocaleString('en-US')}`);
  }
  for (const u of plan.uItems) {
    const row = results.uItems?.find((r) => r.id === u.id);
    if (!row) problems.push(`U-item ${u.id} has no outcome`);
    else if (row.outcome === 'skipped' && !row.detail) problems.push(`U-item ${u.id} is skipped without a reason`);
  }
  for (const s of plan.steps) if (!results.steps?.some((r) => r.id === s.id)) problems.push(`step ${s.id} has no row`);
  if (!existsSync(p.resultsMd)) problems.push('research/genai-spike-results.md is missing');
  else if (/fal\.media|fal\.run\/files|storage\.googleapis\.com/.test(readFileSync(p.resultsMd, 'utf8'))) problems.push('results page contains a fal CDN URL');
  if (/fal\.media|fal\.run\/files|storage\.googleapis\.com/.test(readFileSync(p.resultsJson, 'utf8'))) problems.push('results.json contains a fal CDN URL');
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: args(),
    options: {
      plan: { type: 'boolean', default: false }, run: { type: 'boolean', default: false }, verify: { type: 'boolean', default: false },
      only: { type: 'string' }, keep: { type: 'boolean', default: false }, 'skip-blocked': { type: 'boolean', default: false }, root: { type: 'string' },
    },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  const plan = loadPlan(root);
  const registry = readJson<GenAiRegistry>(path.join(root, 'config', 'genai-endpoints.json'));
  const findings = planFindings(plan, registry);
  if (findings.length > 0) {
    findings.forEach((f) => console.error(`genai:spike: ${f}`));
    process.exit(1);
  }
  if (values.plan) {
    renderPlan(plan, registry).forEach((l) => console.log(l));
    process.exit(0);
  }
  if (values.verify) {
    const problems = verifyResults(root, plan);
    problems.forEach((p) => console.error(`genai:spike --verify: ${p}`));
    console.log(problems.length === 0 ? 'genai:spike --verify: ok' : `genai:spike --verify: ${problems.length} problems`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
  if (values.run) {
    const briefs = parseBriefs(readFileSync(path.join(root, 'tools', 'assets', 'spike', 'briefs.md'), 'utf8'));
    const results = await runSpike({
      root, plan, registry, briefs, env: process.env, fetch: (u, i) => fetch(u, i), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(),
      ...(values.only ? { only: values.only.split(',').map((x) => x.trim()) } : {}), keep: values.keep, skipBlocked: values['skip-blocked'], log: (l) => console.log(l),
    });
    console.log(`genai:spike --run: ${results.status}; ledger ${microsToUsd(results.ledgerTotalMicros)} of ${microsToUsd(results.capMicros)}`);
    process.exit(0);
  }
  console.error('usage: genai:spike -- --plan | --run [--only C1,C3] [--keep] [--skip-blocked] | --verify');
  process.exit(2);
}

if (isMain(import.meta.url)) void main();

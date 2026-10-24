/**
 * `pnpm assets:gen prewarm` (M05c3): plan, and with `--live` run, the generation of Act 1's cutscene clips (group G1 of
 * spec/domains/03-story-cutscenes.md section D9.1) inside a hard line of USD 16.
 *
 * The CLI never calls fal. `--live` posts the planned keys to route 28 of our Worker (`POST /api/v1/admin/cutscenes/prewarm`,
 * `OPS_TOKEN`) and polls route 27; the Worker's gate, governor and single-flight object do the rest. Everything with a side effect
 * (network, files, clock, ledger, the index rebuild) goes through `PrewarmPorts`, so the tests run it with none of them.
 *
 * Order of checks, each before the next can spend: flags, provider gate (ADR-GENAI-01), cache check (HEAD, R-ENG-03), sheet
 * gate, estimate against the line, programme headroom, C2PA guard, then the submission.
 */
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { estimateRequest, usd } from './estimate.ts';
import { endpointMatches, missingSheets, providerGate, resignGuard, type ResignProbe, type SheetsLock } from './gates.ts';
import { renderReport, type ReportRow } from './report.ts';

export type RowStatus = 'planned' | 'ready' | 'sheet_missing' | 'over_line' | 'stale_endpoint';

export interface PlanRow {
  ref: string;
  key: string;
  status: RowStatus;
  estimateMicros: number;
  runningMicros: number;
  detail?: string;
}

export interface Plan {
  rows: PlanRow[];
  providerKey: string;
  totalMicros: number;
  capMicros: number;
}

/** The group a priority number walks. Priority 1 is G1, the nine Act 1 refs (`m.a1.*`); the sample mission is not part of it. */
export const GROUP_G1 = /^cut\.story\.m\.a1\./;

export interface PrewarmOptions {
  release: string;
  priority: number;
  capMicros: number;
  live: boolean;
  env: 'staging' | 'prod';
  report: boolean;
  offline: boolean;
  /** Test inputs and overrides. */
  requestsFile?: string;
  registryFile?: string;
  sheetsFile?: string;
  mediaBase?: string;
  apiBase?: string;
  /** Poll interval and overall timeout for route 27 after a submission. */
  pollMs?: number;
  timeoutMs?: number;
}

export interface LedgerPort {
  /** The programme cap of a vendor (`budget_program.cap_usd_micros`), or null when no row exists. */
  capMicros(vendor: string): Promise<number | null>;
  /** Sum of `genai_ledger.usd_micros` for a vendor, optionally one kind and rows since an epoch ms. */
  spentMicros(vendor: string, filter?: { kind?: string; sinceMs?: number }): Promise<number>;
}

export interface WorkerPort {
  /** Route 28 for at most 50 keys. */
  prewarm(keys: string[]): Promise<CutsceneStatus[]>;
  /** Route 27. */
  status(key: string): Promise<CutsceneStatus>;
}

export interface PrewarmPorts {
  log(line: string): void;
  /** Reads a repository-relative or absolute text file; null when it does not exist. */
  readText(file: string): string | null;
  writeText(file: string, text: string): void;
  /** `true`: the manifest exists (HEAD 200); `false`: HEAD 404. Anything else throws. */
  isReady(key: string): Promise<boolean>;
  /** Null when the database is not reachable from here. */
  ledger: LedgerPort | null;
  resign: ResignProbe;
  /** Null when `OPS_TOKEN` is not set. */
  worker: WorkerPort | null;
  rebuildIndex(release: string): Promise<number>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** The request and registry defaults. */
  defaults: { requests(release: string): string; registry: string; sheets: string; reportFile(release: string): string };
}

interface RequestsFile {
  schema?: string;
  release?: string;
  requests: CutsceneRequest[];
}

function loadRequests(o: PrewarmOptions, p: PrewarmPorts): CutsceneRequest[] {
  const file = o.requestsFile ?? p.defaults.requests(o.release);
  const text = p.readText(file);
  if (text === null) throw new Error(`no requests file at ${file}; run pnpm assets:cutscene-index -- --release ${o.release} first`);
  const raw = JSON.parse(text) as RequestsFile | CutsceneRequest[];
  const list = Array.isArray(raw) ? raw : raw.requests;
  if (!Array.isArray(list)) throw new Error(`${file}: expected { requests: [...] }`);
  return list;
}

function loadRegistry(o: PrewarmOptions, p: PrewarmPorts): GenAiRegistry {
  const file = o.registryFile ?? p.defaults.registry;
  const text = p.readText(file);
  if (text === null) throw new Error(`no registry at ${file}`);
  return JSON.parse(text) as GenAiRegistry;
}

function loadSheets(o: PrewarmOptions, p: PrewarmPorts): SheetsLock {
  const text = p.readText(o.sheetsFile ?? p.defaults.sheets);
  if (text === null) return { schema: 'sheets-lock/1', sheets: {} };
  const raw = JSON.parse(text) as SheetsLock;
  return raw;
}

/** The refs of the group, in index order. */
export function groupRefs(requests: readonly CutsceneRequest[], priority: number): CutsceneRequest[] {
  return requests.filter((r) => r.priority === priority && (priority !== 1 || GROUP_G1.test(r.ref)));
}

export interface PlanInputs {
  requests: readonly CutsceneRequest[];
  registry: GenAiRegistry;
  sheets: SheetsLock;
  capMicros: number;
  /** Cache check: true when the manifest of the key exists. */
  isReady: (key: string) => Promise<boolean>;
  offline: boolean;
}

/** Computes the plan. Throws when the provider gate fails: the caller checks `providerGate` first. */
export async function buildPlan(i: PlanInputs): Promise<Plan> {
  const gate = providerGate(i.registry);
  if (!gate.ok) throw new Error(gate.line);
  const rows: PlanRow[] = [];
  let running = 0;
  let stopped = false;
  for (const req of i.requests) {
    const row = (status: RowStatus, estimateMicros: number, detail?: string): PlanRow => ({
      ref: req.ref, key: req.key, status, estimateMicros, runningMicros: running, ...(detail !== undefined ? { detail } : {}),
    });
    // 1. cache check: a published manifest is done whatever the sheets, the line or the provider say.
    if (!i.offline && (await i.isReady(req.key))) {
      rows.push(row('ready', 0));
      continue;
    }
    // 2. sheet gate: a cast member without approved crops cannot be keyed to its sheet, so nothing is spent.
    const missing = missingSheets(req, i.sheets);
    if (missing.length > 0) {
      rows.push(row('sheet_missing', 0, missing.join(', ')));
      continue;
    }
    // 3. the key names an endpoint; a provider switch since the index build means the index is stale.
    if (!endpointMatches(req, gate.entry)) {
      rows.push(row('stale_endpoint', 0, `${req.keyInput.endpoint} is not an endpoint of ${gate.key}`));
      continue;
    }
    // 4. estimate against the line: the first ref that would pass it stops the walk.
    const est = estimateRequest(req, gate.entry);
    if (stopped || running + est.totalMicros > i.capMicros) {
      stopped = true;
      rows.push(row('over_line', est.totalMicros));
      continue;
    }
    running += est.totalMicros;
    rows.push(row('planned', est.totalMicros));
  }
  return { rows, providerKey: gate.key, totalMicros: running, capMicros: i.capMicros };
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

export function formatPlan(plan: Plan): string[] {
  const out = [`plan: provider ${plan.providerKey}, line ${usd(plan.capMicros)}`];
  out.push(`${pad('ref', 30)} ${pad('key', 12)} ${pad('status', 14)} ${padL('estimate', 12)} ${padL('running', 12)}`);
  for (const r of plan.rows) {
    const status = r.status === 'ready' ? 'skip: ready' : r.status === 'planned' ? 'planned' : `skip: ${r.status}`;
    out.push(`${pad(r.ref, 30)} ${pad(r.key.slice(0, 12), 12)} ${pad(status, 14)} ${padL(String(r.estimateMicros), 12)} ${padL(String(r.runningMicros), 12)}${r.detail ? `  (${r.detail})` : ''}`);
  }
  out.push(`total planned: ${plan.totalMicros} micros (${usd(plan.totalMicros)}) of ${plan.capMicros}`);
  return out;
}

export interface RunResult {
  /** Process exit code. */
  code: number;
  plan?: Plan;
  /** Final state per submitted key (live only). */
  states?: Record<string, CutsceneStatus['state']>;
}

const MAX_KEYS_PER_CALL = 50;

/** Writes `docs/releases/<tag>/cutscenes.md`. */
function writeReport(o: PrewarmOptions, p: PrewarmPorts, rows: ReportRow[], provider: string | null, deltaMicros: number | null): void {
  p.writeText(p.defaults.reportFile(o.release), renderReport({ release: o.release, provider, rows, deltaMicros }));
}

export async function runPrewarm(o: PrewarmOptions, p: PrewarmPorts): Promise<RunResult> {
  // flags
  if (o.offline && o.live) {
    p.log('refused: --offline cannot be combined with --live (an offline plan has no cache check)');
    return { code: 1 };
  }
  if (o.priority !== 1) {
    p.log(`pending: priority ${o.priority} groups (fighter finishers, racing intros) land in M10b`);
    return { code: 0 };
  }
  const all = loadRequests(o, p);
  const requests = groupRefs(all, o.priority);
  const registry = loadRegistry(o, p);

  // provider gate: nothing is estimated, fetched or spent without a cleared provider; every ref plays its DirectorScript
  const gate = providerGate(registry);
  if (!gate.ok) {
    p.log(gate.line);
    if (o.report) {
      writeReport(o, p, requests.map((r) => ({ ref: r.ref, key: r.key, generated: false, note: 'no cleared provider' })), null, null);
      p.log(`report: ${p.defaults.reportFile(o.release)}`);
    }
    return { code: 0 };
  }

  const plan = await buildPlan({ requests, registry, sheets: loadSheets(o, p), capMicros: o.capMicros, isReady: (k) => p.isReady(k), offline: o.offline });
  for (const line of formatPlan(plan)) p.log(line);

  // programme headroom
  let headroom: number | null = null;
  if (!o.offline && p.ledger !== null) {
    const cap = await p.ledger.capMicros('fal');
    if (cap !== null) headroom = cap - (await p.ledger.spentMicros('fal'));
  }
  p.log(headroom === null ? 'headroom: unknown (no ledger access from here)' : `headroom: ${headroom} micros (${usd(headroom)}) left in the fal programme`);

  const planned = plan.rows.filter((r) => r.status === 'planned');
  const reportRows = (ready: ReadonlySet<string>, failed: ReadonlyMap<string, string>): ReportRow[] =>
    requests.map((r) => {
      const row = plan.rows.find((x) => x.key === r.key);
      if (row?.status === 'ready' || ready.has(r.key)) return { ref: r.ref, key: r.key, generated: true, note: '' };
      const why = failed.get(r.key) ?? (row?.status === 'planned' ? 'not generated in this run' : row?.status === 'sheet_missing' ? `sheet missing: ${row.detail ?? ''}` : (row?.status ?? 'not planned').replace('_', ' '));
      return { ref: r.ref, key: r.key, generated: false, note: why };
    });

  if (!o.live) {
    if (o.report) {
      writeReport(o, p, reportRows(new Set(), new Map()), plan.providerKey, null);
      p.log(`report: ${p.defaults.reportFile(o.release)}`);
    }
    return { code: 0, plan };
  }

  // live: every refusal below happens before the first submission
  const guard = await resignGuard(o.env, true, p.resign);
  if (!guard.ok) {
    p.log(guard.line);
    return { code: 1, plan };
  }
  if (p.worker === null) {
    p.log('SKIP prewarm --live: OPS_TOKEN not set');
    return { code: 0, plan };
  }
  if (headroom === null) {
    p.log('refused: the programme headroom is unknown, so the line cannot be checked against the fal cap (set SUPABASE_URL and SUPABASE_SECRET_KEY on the operator workstation)');
    return { code: 1, plan };
  }
  if (plan.totalMicros > headroom) {
    p.log(`refused: the plan (${plan.totalMicros} micros) is larger than the programme headroom (${headroom} micros)`);
    return { code: 1, plan };
  }
  if (planned.length === 0) {
    p.log('nothing to submit: every key is ready, gated or over the line');
    if (o.report) writeReport(o, p, reportRows(new Set(), new Map()), plan.providerKey, 0);
    return { code: 0, plan, states: {} };
  }

  const startedAt = p.now();
  const keys = planned.map((r) => r.key);
  const states: Record<string, CutsceneStatus['state']> = {};
  const reasons = new Map<string, string>();
  for (let i = 0; i < keys.length; i += MAX_KEYS_PER_CALL) {
    for (const st of await p.worker.prewarm(keys.slice(i, i + MAX_KEYS_PER_CALL))) {
      states[st.key] = st.state;
      if (st.reason !== undefined) reasons.set(st.key, st.reason);
    }
  }
  p.log(`submitted ${keys.length} key(s) through route 28`);

  // poll route 27 until every key is ready or failed (or blocked/absent: the Worker refused it)
  const deadline = p.now() + (o.timeoutMs ?? 45 * 60_000);
  const open = (): string[] => keys.filter((k) => states[k] === 'pending' || states[k] === undefined);
  while (open().length > 0 && p.now() < deadline) {
    await p.sleep(o.pollMs ?? 15_000);
    for (const k of open()) {
      const st = await p.worker.status(k);
      states[k] = st.state;
      if (st.reason !== undefined) reasons.set(k, st.reason);
    }
  }
  for (const r of planned) p.log(`  ${r.ref}  ${r.key.slice(0, 12)}  ${states[r.key] ?? 'unknown'}${reasons.has(r.key) ? ` (${reasons.get(r.key)})` : ''}`);
  const readySet = new Set(keys.filter((k) => states[k] === 'ready'));
  const failed = new Map(keys.filter((k) => states[k] !== 'ready').map((k) => [k, `${states[k] ?? 'unknown'}${reasons.has(k) ? ` (${reasons.get(k)})` : ''}`] as const));

  // rebuild the release index so the ready keys are entries; the others keep their DirectorScript
  const code = await p.rebuildIndex(o.release);
  if (code !== 0) p.log(`warning: the index rebuild exited ${code}; run pnpm assets:cutscene-index -- --release ${o.release} --media <base>`);

  if (o.report) {
    const delta = p.ledger !== null ? await p.ledger.spentMicros('fal', { kind: 'cutscene', sinceMs: startedAt }) : null;
    writeReport(o, p, reportRows(readySet, failed), plan.providerKey, delta);
    p.log(`report: ${p.defaults.reportFile(o.release)}`);
    if (delta !== null) p.log(`ledger delta (kind cutscene) since this run started: ${delta} micros (${usd(delta)})`);
  }
  return { code: failed.size > 0 ? 1 : 0, plan, states };
}

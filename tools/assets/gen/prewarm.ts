/**
 * `pnpm assets:gen prewarm` (M05c3): plan the generation of Act 1's cutscene clips (group G1 of
 * spec/domains/03-story-cutscenes.md section D9.1) inside a hard line of USD 16, and write the release's cutscene report.
 *
 * The CLI never calls fal and in M05c3 it never submits anything: `--live` stops at a refusal because Workers Free has no
 * transcoder (DL-OWN-08, DL-750); M05c4 replaces that step with the submission and hand-off. Everything with a side effect
 * (network, files, ledger) goes through `PrewarmPorts`, so the tests run it with none of them.
 *
 * Order of checks, each before the next can touch the network: flags, provider gate (ADR-GENAI-01), C2PA guard, the
 * `--live` refusal; then the sheet gate, cache check (HEAD, then route 27, R-ENG-03), estimate against the line and the
 * programme headroom.
 */
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { estimateRequest, usd } from './estimate.ts';
import { EMPTY_SHEETS, NO_TRANSCODER_LINE, endpointMatches, missingSheets, parseSheetsLock, providerGate, resignGuard, type ResignProbe, type SheetsLock } from './gates.ts';
import { renderReport, type ReportRow } from './report.ts';

export type RowStatus = 'planned' | 'ready' | 'pending' | 'sheet_missing' | 'over_line' | 'stale_endpoint';

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
  /** A Worker configuration file read instead of services/edge/wrangler.jsonc (tests). */
  wranglerFile?: string;
}

export interface LedgerPort {
  /** The programme cap of a vendor (`budget_program.cap_usd_micros`), or null when no row exists. */
  capMicros(vendor: string): Promise<number | null>;
  /** Sum of `genai_ledger.usd_micros` for a vendor. */
  spentMicros(vendor: string): Promise<number>;
}

export interface PrewarmPorts {
  log(line: string): void;
  /** Reads a repository-relative or absolute text file; null when it does not exist. */
  readText(file: string): string | null;
  writeText(file: string, text: string): void;
  /** `true`: the manifest exists (HEAD 200); `false`: HEAD 404. Anything else throws. */
  isReady(key: string): Promise<boolean>;
  /** Route 27 of our Worker (public, read only). Null when no API host is known. */
  status: ((key: string) => Promise<CutsceneStatus>) | null;
  /** Null when the database is not reachable from here. */
  ledger: LedgerPort | null;
  resign: ResignProbe;
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
  return text === null ? EMPTY_SHEETS : parseSheetsLock(text);
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
  /** Route 27 for a key whose manifest is absent; null skips the check. */
  status: ((key: string) => Promise<CutsceneStatus>) | null;
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
    // 1. cache check: a published manifest is done whatever the sheets, the line or the provider say. A key whose manifest is
    // missing but which route 27 reports as pending is already in flight and is not planned a second time.
    if (!i.offline) {
      if (await i.isReady(req.key)) {
        rows.push(row('ready', 0));
        continue;
      }
      if (i.status !== null && (await i.status(req.key)).state === 'pending') {
        rows.push(row('pending', 0));
        continue;
      }
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
    const status = r.status === 'planned' ? 'planned' : `skip: ${r.status}`;
    out.push(`${pad(r.ref, 30)} ${pad(r.key.slice(0, 12), 12)} ${pad(status, 14)} ${padL(String(r.estimateMicros), 12)} ${padL(String(r.runningMicros), 12)}${r.detail ? `  (${r.detail})` : ''}`);
  }
  out.push(`total planned: ${plan.totalMicros} micros (${usd(plan.totalMicros)}) of ${plan.capMicros}`);
  return out;
}

export interface RunResult {
  /** Process exit code. */
  code: number;
  plan?: Plan;
}

/** Writes `docs/releases/<tag>/cutscenes.md`. */
function writeReport(o: PrewarmOptions, p: PrewarmPorts, rows: ReportRow[], provider: string | null): void {
  p.writeText(p.defaults.reportFile(o.release), renderReport({ release: o.release, provider, rows }));
  p.log(`report: ${p.defaults.reportFile(o.release)}`);
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
  const requests = groupRefs(loadRequests(o, p), o.priority);
  const registry = loadRegistry(o, p);

  // 1. provider gate: nothing is estimated, fetched or spent without a cleared provider; every ref plays its DirectorScript
  const gate = providerGate(registry);
  if (!gate.ok) {
    p.log(gate.line);
    if (o.report) writeReport(o, p, requests.map((r) => ({ ref: r.ref, key: r.key, generated: false, note: 'no cleared provider' })), null);
    return { code: 0 };
  }

  // 2. C2PA guard, 3. no transcoder on Workers Free: both read files only, so both come before the first network call
  if (o.live) {
    const guard = await resignGuard(o.env, true, p.resign);
    if (!guard.ok) {
      p.log(guard.line);
      return { code: 1 };
    }
    p.log(NO_TRANSCODER_LINE);
    return { code: 0 };
  }

  const plan = await buildPlan({ requests, registry, sheets: loadSheets(o, p), capMicros: o.capMicros, isReady: (k) => p.isReady(k), status: p.status, offline: o.offline });
  for (const line of formatPlan(plan)) p.log(line);

  // programme headroom (omitted offline)
  if (!o.offline) {
    let headroom: number | null = null;
    if (p.ledger !== null) {
      const cap = await p.ledger.capMicros('fal');
      if (cap !== null) headroom = cap - (await p.ledger.spentMicros('fal'));
    }
    p.log(headroom === null ? 'SKIP headroom: SUPABASE_SECRET_KEY (and SUPABASE_URL) not set; headroom: unknown (no ledger access from here)' : `headroom: ${headroom} micros (${usd(headroom)}) left in the fal programme`);
  }

  if (o.report) {
    // Every ref plays its DirectorScript unless its manifest is already published.
    const rows: ReportRow[] = requests.map((r) => {
      const row = plan.rows.find((x) => x.key === r.key);
      if (row?.status === 'ready') return { ref: r.ref, key: r.key, generated: true, note: '' };
      const why = row?.status === 'sheet_missing' ? `sheet missing: ${row.detail ?? ''}` : (row?.status ?? 'not planned').replace('_', ' ');
      return { ref: r.ref, key: r.key, generated: false, note: why };
    });
    writeReport(o, p, rows, plan.providerKey);
  }
  return { code: 0, plan };
}

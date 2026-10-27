/**
 * `pnpm assets:gen prewarm` (M05c3, M05c4): plan the generation of Act 1's cutscene clips (group G1 of
 * spec/domains/03-story-cutscenes.md section D9.1) inside a hard line of USD 16, submit the plan with `--live`, and write the
 * release's cutscene report.
 *
 * The CLI never calls fal. `--live` posts the planned keys to route 28 of our Worker (`OPS_TOKEN`), which runs the fal-facing steps and
 * hands each output off (Workers Free has no transcoder, DL-OWN-08); `--finish` (finish.ts) then transcodes and re-signs on the
 * operator's workstation. Everything with a side effect (network, files, ledger) goes through `PrewarmPorts`, so the tests run it with none.
 *
 * Order of checks, each before the next can touch the network: flags, provider gate (ADR-GENAI-01), C2PA guard; then the sheet gate,
 * cache check (HEAD, route 27 and `handoff.json`, R-ENG-03), estimate against the line and the programme headroom; then, with `--live`,
 * the submission.
 */
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { estimateRequest, usd } from './estimate.ts';
import { EMPTY_SHEETS, endpointMatches, missingSheets, parseSheetsLock, providerGate, resignGuard, type ResignProbe, type SheetsLock } from './gates.ts';
import { renderReport, type ReportInput, type ReportRow } from './report.ts';

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
  /** Sum of `genai_ledger.usd_micros` for a vendor, or for one kind of it (`cutscene`). */
  spentMicros(vendor: string, kind?: string): Promise<number>;
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
  /**
   * `--live` (M05c4): one call to route 28 with the keys, answering the per-key states. Null when `OPS_TOKEN` is not set: the run then
   * prints a SKIP line and submits nothing.
   */
  submit?: ((keys: string[]) => Promise<CutsceneStatus[]>) | null;
  /** True when `PRIVATE cutscenes-orig/<key>/handoff.json` exists. Null without the private-bucket pair (`R2_PRIVATE_*`). */
  hasHandoff?: ((key: string) => Promise<boolean>) | null;
  /** Test inputs for the poll loop; default: the system clock. */
  clock?: { now(): number; sleep(ms: number): Promise<void> };
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
  /** A key with a `handoff.json` was paid for already and waits for `--finish`: it is `skip: pending` at $0 (M05c4). */
  hasHandoff?: ((key: string) => Promise<boolean>) | null;
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
      if (i.hasHandoff && (await i.hasHandoff(req.key))) {
        rows.push(row('pending', 0, 'handed off: run --finish'));
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
function writeReport(o: PrewarmOptions, p: PrewarmPorts, rows: ReportRow[], provider: string | null, ledgerDelta?: ReportInput['ledgerDelta']): void {
  p.writeText(p.defaults.reportFile(o.release), renderReport({ release: o.release, provider, rows, ...(ledgerDelta !== undefined ? { ledgerDelta } : {}) }));
  p.log(`report: ${p.defaults.reportFile(o.release)}`);
}

/** How a live key ended for the run: `ready` (a manifest), `handed_off` (waits for --finish), `failed` (failed or blocked), `pending` (still going when the poll stopped). */
export type LiveOutcome = 'ready' | 'handed_off' | 'failed' | 'pending';

export const POLL_INTERVAL_MS = 30_000;
/** Without the private-bucket pair the run cannot see a hand-off, so it stops polling after this long and prints the keys for `--finish`. */
export const POLL_LIMIT_NO_PRIVATE_MS = 30 * 60 * 1000;
/** With the pair every key ends in a manifest, a hand-off or a failure; this only bounds a run that would otherwise never return. */
export const POLL_LIMIT_MS = 4 * 60 * 60 * 1000;

const realClock = { now: (): number => Date.now(), sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)) };

/** `--live`: route 28 for the planned keys, then route 27 until each is ready or failed, or has its handoff.json. */
async function submitAndPoll(keys: string[], p: PrewarmPorts, log: (l: string) => void): Promise<Map<string, LiveOutcome>> {
  const clock = p.clock ?? realClock;
  const out = new Map<string, LiveOutcome>();
  const answered = await p.submit!(keys);
  const counts = new Map<string, number>();
  for (const st of answered) counts.set(st.state, (counts.get(st.state) ?? 0) + 1);
  log(`route 28: ${keys.length} key(s) submitted (${[...counts].map(([s, n]) => `${s} ${n}`).join(', ')})`);
  const open = new Set(keys);
  const limit = p.hasHandoff ? POLL_LIMIT_MS : POLL_LIMIT_NO_PRIVATE_MS;
  const started = clock.now();
  for (;;) {
    for (const key of [...open]) {
      const st = p.status ? await p.status(key) : null;
      if (st?.state === 'ready') out.set(key, 'ready');
      else if (st?.state === 'failed' || st?.state === 'blocked') out.set(key, 'failed');
      else if (p.hasHandoff && (await p.hasHandoff(key))) out.set(key, 'handed_off');
      else continue;
      open.delete(key);
    }
    if (open.size === 0) break;
    if (clock.now() - started >= limit) {
      for (const key of open) out.set(key, 'pending');
      break;
    }
    await clock.sleep(POLL_INTERVAL_MS);
  }
  return out;
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

  // 2. C2PA guard: reads files only, so it comes before the first network call
  if (o.live) {
    const guard = await resignGuard(o.env, true, p.resign);
    if (!guard.ok) {
      p.log(guard.line);
      return { code: 1 };
    }
  }

  if (o.live && !o.offline && !p.hasHandoff) p.log('SKIP handoff check: the private-bucket pair (R2_PRIVATE_*), CLOUDFLARE_ACCOUNT_ID or rclone is missing; a key handed off earlier is still skipped by route 27 while its state holds');
  const plan = await buildPlan({
    requests, registry, sheets: loadSheets(o, p), capMicros: o.capMicros, isReady: (k) => p.isReady(k), status: p.status, hasHandoff: p.hasHandoff ?? null, offline: o.offline,
  });
  for (const line of formatPlan(plan)) p.log(line);

  // programme headroom (omitted offline)
  let headroom: number | null = null;
  if (!o.offline) {
    if (p.ledger !== null) {
      const cap = await p.ledger.capMicros('fal');
      if (cap !== null) headroom = cap - (await p.ledger.spentMicros('fal'));
    }
    p.log(headroom === null ? 'SKIP headroom: SUPABASE_SECRET_KEY (and SUPABASE_URL) not set; headroom: unknown (no ledger access from here)' : `headroom: ${headroom} micros (${usd(headroom)}) left in the fal programme`);
  }

  // 3. --live: submit exactly the planned keys through route 28, then wait for each to be ready, failed or handed off
  let outcomes: Map<string, LiveOutcome> | null = null;
  let ledgerDelta: ReportInput['ledgerDelta'];
  let code = 0;
  if (o.live) {
    const planned = plan.rows.filter((r) => r.status === 'planned').map((r) => r.key);
    if (planned.length === 0) {
      p.log('live: nothing to submit (every key is ready, pending, or held back by a gate)');
    } else if (headroom !== null && plan.totalMicros > headroom) {
      p.log(`refused: the plan costs ${plan.totalMicros} micros, over the ${headroom} micros left in the fal programme; nothing was submitted`);
      return { code: 1, plan };
    } else if (!p.submit) {
      p.log('SKIP live: OPS_TOKEN not set; nothing was submitted');
    } else {
      const before = p.ledger !== null ? await p.ledger.spentMicros('fal', 'cutscene') : null;
      outcomes = await submitAndPoll(planned, p, p.log);
      const count = (s: LiveOutcome): string[] => [...outcomes!].filter(([, v]) => v === s).map(([k]) => k);
      p.log(`live: ready ${count('ready').length}, handed off ${count('handed_off').length}, failed ${count('failed').length}, still pending ${count('pending').length}`);
      if (count('handed_off').length > 0) p.log(`next: pnpm assets:gen prewarm -- --release ${o.release} --env ${o.env} --finish   (${count('handed_off').length} key(s) wait for the off-edge finish)`);
      if (count('pending').length > 0) p.log(`still pending after the poll limit; pass them to --finish when their handoff.json exists: ${count('pending').map((k) => k.slice(0, 12)).join(', ')}`);
      if (count('failed').length > 0) code = 1;
      if (before !== null) {
        const after = await p.ledger!.spentMicros('fal', 'cutscene');
        ledgerDelta = { kind: 'cutscene', micros: after - before };
        p.log(`ledger delta (fal, kind cutscene): ${after - before} micros (${usd(after - before)}); genai_ledger is exported nightly, so a delta of 0 can mean the export has not run yet`);
      } else {
        p.log('SKIP ledger delta: SUPABASE_SECRET_KEY (and SUPABASE_URL) not set');
      }
    }
  }

  if (o.report) {
    // Every ref plays its DirectorScript unless its manifest is already published.
    const rows: ReportRow[] = requests.map((r) => {
      const row = plan.rows.find((x) => x.key === r.key);
      const live = outcomes?.get(r.key);
      if (row?.status === 'ready' || live === 'ready') return { ref: r.ref, key: r.key, generated: true, note: '' };
      if (live === 'handed_off') return { ref: r.ref, key: r.key, generated: false, note: 'handed off, waits for --finish' };
      if (live === 'failed') return { ref: r.ref, key: r.key, generated: false, note: 'generation failed' };
      const why = row?.status === 'sheet_missing' ? `sheet missing: ${row.detail ?? ''}` : row?.status === 'pending' && row.detail ? row.detail : (row?.status ?? 'not planned').replace('_', ' ');
      return { ref: r.ref, key: r.key, generated: false, note: why };
    });
    writeReport(o, p, rows, plan.providerKey, ledgerDelta);
  }
  return { code, plan };
}

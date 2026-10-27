/**
 * pnpm assets:gen <subcommand> (M05c3, M05c4).
 *
 *   pnpm assets:gen prewarm -- --release <tag> [--priority 1] [--cap-micros <n>] [--live] [--env staging|prod] [--report]
 *                              [--requests <file>] [--registry <file>] [--sheets <file>] [--offline]
 *   pnpm assets:gen prewarm -- --release <tag> --finish [--env staging|prod] [--ffmpeg native|docker]
 *   pnpm assets:gen prewarm -- --finish --local <orig.mp4> --out <dir> [--ffmpeg native|docker]
 *
 * `prewarm` is the only subcommand; `plan`, `run` and `gate` print `pending: lands in M10a1` and exit 0.
 * The CLI has no code path that calls fal: it reads files, HEADs our media host, reads route 27 of our Worker and the spend ledger,
 * and with `--live` posts the planned keys to route 28 (`OPS_TOKEN`). `--finish` transcodes and re-signs the handed-off keys on this
 * workstation (finish.ts). Secrets (names only): SUPABASE_URL and SUPABASE_SECRET_KEY for the ledger reads; OPS_TOKEN for route 28;
 * R2_PRIVATE_ACCESS_KEY_ID, R2_PRIVATE_SECRET_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID for the private bucket; C2PA_CERT_CHAIN_PEM and
 * C2PA_KEY_PEM for the re-signer. Absent ones print a SKIP line (and the dependent step does not run).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import { stripJsonc } from '../../ci/deploy.ts';
import { args, repoRoot } from '../../ci/run.ts';
import { createRcloneUploader, rcloneEnv, spawnRunner, type RcloneUploader, type Runner } from '../src/uploader-rclone.ts';
import { inspectSignature, loadC2pa, UNTRUSTED } from '../../ci/c2pa-read.ts';
import { C2paNodeSignPort } from './c2pa-sign-port.ts';
import { DEFAULT_CAP_MICROS } from './estimate.ts';
import { FfmpegTranscodePort } from './ffmpeg-port.ts';
import { PRIVATE_VARS, privateRcloneEnv, runFinish, type FinishPorts } from './finish.ts';
import type { ResignProbe } from './gates.ts';
import { runPrewarm, type LedgerPort, type PrewarmOptions, type PrewarmPorts } from './prewarm.ts';

export const PENDING_SUBCOMMANDS: readonly string[] = ['plan', 'run', 'gate'];
const WRANGLER = 'services/edge/wrangler.jsonc';

type FetchFn = typeof fetch;

interface WranglerVars {
  vars?: Record<string, string>;
  env?: Record<string, { vars?: Record<string, string> }>;
}

/** The `vars` of the Worker build for an environment: the top level is production, `env.staging` is staging. */
export function workerVars(env: 'staging' | 'prod', root: string = repoRoot, wranglerFile?: string): Record<string, string> {
  const file = wranglerFile !== undefined ? path.resolve(root, wranglerFile) : path.join(root, WRANGLER);
  const cfg = JSON.parse(stripJsonc(readFileSync(file, 'utf8'))) as WranglerVars;
  return (env === 'prod' ? cfg.vars : cfg.env?.['staging']?.vars) ?? {};
}

/** The re-sign switch of the repository's Worker build for the environment (the build the operator deploys). */
export function wranglerResignProbe(root: string = repoRoot, wranglerFile?: string): ResignProbe {
  return {
    resignOn(env) {
      const v = workerVars(env, root, wranglerFile)['C2PA_RESIGN'];
      return Promise.resolve(v === undefined ? null : v === '1');
    },
  };
}

/** PostgREST reads of `budget_program` and `genai_ledger` with the service key. */
export function postgrestLedger(o: { url: string; key: string; fetch: FetchFn }): LedgerPort {
  const headers = { apikey: o.key, Authorization: `Bearer ${o.key}` };
  const get = async (pathAndQuery: string, range?: string): Promise<unknown[]> => {
    const res = await o.fetch(`${o.url.replace(/\/+$/, '')}/rest/v1/${pathAndQuery}`, { headers: { ...headers, ...(range ? { Range: range, 'Range-Unit': 'items' } : {}) } });
    if (!res.ok) throw new Error(`ledger read ${pathAndQuery.split('?')[0]} failed: HTTP ${res.status}`);
    return (await res.json()) as unknown[];
  };
  return {
    async capMicros(vendor) {
      const rows = (await get(`budget_program?vendor=eq.${encodeURIComponent(vendor)}&select=cap_usd_micros`)) as { cap_usd_micros: number }[];
      return rows[0]?.cap_usd_micros ?? null;
    },
    async spentMicros(vendor, kind) {
      const q = `genai_ledger?vendor=eq.${encodeURIComponent(vendor)}${kind !== undefined ? `&kind=eq.${encodeURIComponent(kind)}` : ''}&select=usd_micros&order=id`;
      let sum = 0;
      for (let from = 0; ; from += 1000) {
        const page = (await get(q, `${from}-${from + 999}`)) as { usd_micros: number }[];
        for (const r of page) sum += r.usd_micros;
        if (page.length < 1000) return sum;
      }
    },
  };
}

/** Route 27 of the Worker: public, read only. */
export function httpStatus(o: { api: string; fetch: FetchFn }): (key: string) => Promise<CutsceneStatus> {
  const base = o.api.replace(/\/+$/, '');
  return async (key) => {
    const res = await o.fetch(`${base}/api/v1/cutscenes/${key}`);
    if (!res.ok) throw new Error(`route 27 answered HTTP ${res.status}`);
    return (await res.json()) as CutsceneStatus;
  };
}

/** Route 28 of the Worker: staff only (`OPS_TOKEN`). One call carries the keys; the answer lists their states. */
export function httpSubmit(o: { api: string; token: string; fetch: FetchFn }): (keys: string[]) => Promise<CutsceneStatus[]> {
  const base = o.api.replace(/\/+$/, '');
  return async (keys) => {
    const res = await o.fetch(`${base}/api/v1/admin/cutscenes/prewarm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
    if (res.status !== 202) throw new Error(`route 28 answered HTTP ${res.status}`);
    return ((await res.json()) as { keys: CutsceneStatus[] }).keys;
  };
}

/** The bucket the PRIVATE binding names in the Worker build of an environment. */
export function privateBucketName(target: 'staging' | 'prod', root: string = repoRoot, wranglerFile?: string): string {
  const file = wranglerFile !== undefined ? path.resolve(root, wranglerFile) : path.join(root, WRANGLER);
  const cfg = JSON.parse(stripJsonc(readFileSync(file, 'utf8'))) as { r2_buckets?: { binding: string; bucket_name: string }[]; env?: Record<string, { r2_buckets?: { binding: string; bucket_name: string }[] }> };
  const list = (target === 'prod' ? cfg.r2_buckets : cfg.env?.['staging']?.r2_buckets) ?? [];
  const name = list.find((b) => b.binding === 'PRIVATE')?.bucket_name;
  if (name === undefined) throw new Error(`no PRIVATE bucket in the ${target} Worker configuration`);
  return name;
}

/** The private bucket through rclone, or null (with the reason) when the pair, the account or the binary is missing. */
export function privateRemote(i: { env: NodeJS.ProcessEnv; target: 'staging' | 'prod'; root?: string; wranglerFile?: string | undefined; run: Runner }): { remote: RcloneUploader } | { skip: string } {
  const missing = PRIVATE_VARS.filter((v) => !i.env[v]);
  if (missing.length > 0) return { skip: `${missing.join(', ')} not set` };
  const probe = i.run('rclone', ['version'], rcloneEnv(privateRcloneEnv(i.env)));
  if (probe.status !== 0) return { skip: 'rclone binary not found' };
  return { remote: createRcloneUploader({ bucket: privateBucketName(i.target, i.root, i.wranglerFile), env: privateRcloneEnv(i.env), run: i.run }) };
}

export interface DefaultPortsInput {
  root?: string;
  env: NodeJS.ProcessEnv;
  fetch: FetchFn;
  log: (line: string) => void;
  target: 'staging' | 'prod';
  mediaBase?: string | undefined;
  apiBase?: string | undefined;
  /** Test input: a Worker configuration file read instead of services/edge/wrangler.jsonc. */
  wranglerFile?: string | undefined;
  /** False for `--offline`: no ledger, no network at all. */
  network: boolean;
  /** Test input: replaces the rclone process. */
  run?: Runner | undefined;
}

export function defaultPorts(i: DefaultPortsInput): PrewarmPorts {
  const root = i.root ?? repoRoot;
  const vars = workerVars(i.target, root, i.wranglerFile);
  const media = (i.mediaBase ?? vars['HOST_MEDIA'] ?? '').replace(/\/+$/, '');
  const api = i.apiBase ?? vars['HOST_API'] ?? '';
  const abs = (f: string): string => (path.isAbsolute(f) ? f : path.join(root, f));

  let ledger: LedgerPort | null = null;
  if (i.network) {
    const url = i.env['SUPABASE_URL'] ?? vars['SUPABASE_URL'];
    const key = i.env['SUPABASE_SECRET_KEY'];
    if (url && key) ledger = postgrestLedger({ url, key, fetch: i.fetch });
  }
  // M05c4: the hand-off check reads the private bucket, and only when its pair, the account and rclone are there; route 28 needs the staff token.
  let hasHandoff: PrewarmPorts['hasHandoff'] = null;
  if (i.network) {
    const priv = privateRemote({ env: i.env, target: i.target, root, wranglerFile: i.wranglerFile, run: i.run ?? spawnRunner });
    if ('remote' in priv) hasHandoff = (key) => Promise.resolve(priv.remote.list(`cutscenes-orig/${key}/`).includes('handoff.json'));
  }
  const token = i.env['OPS_TOKEN'];
  return {
    log: i.log,
    readText: (f) => (existsSync(abs(f)) ? readFileSync(abs(f), 'utf8') : null),
    writeText: (f, text) => {
      mkdirSync(path.dirname(abs(f)), { recursive: true });
      writeFileSync(abs(f), text);
    },
    async isReady(key) {
      if (media === '') throw new Error('no media host for the cache check; pass --media <base url>');
      const res = await i.fetch(`${media}/cutscenes/${key}/manifest.json`, { method: 'HEAD' });
      if (res.ok) return true;
      if (res.status === 404) return false;
      throw new Error(`cache check of ${key.slice(0, 12)} answered HTTP ${res.status}`);
    },
    ledger,
    resign: wranglerResignProbe(root, i.wranglerFile),
    status: i.network && api !== '' ? httpStatus({ api, fetch: i.fetch }) : null,
    submit: i.network && api !== '' && token ? httpSubmit({ api, token, fetch: i.fetch }) : null,
    hasHandoff,
    defaults: {
      requests: (release) => `.private/releases/${release}/cutscene-requests.json`,
      registry: 'config/genai-endpoints.json',
      sheets: '.private/sheets.lock.json',
      reportFile: (release) => `docs/releases/${release}/cutscenes.md`,
    },
  };
}

export interface FinishCliOptions {
  finish: boolean;
  local?: string;
  out?: string;
  ffmpeg: 'native' | 'docker';
}

export function parsePrewarmArgs(argv: readonly string[]): PrewarmOptions & FinishCliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      release: { type: 'string' },
      priority: { type: 'string', default: '1' },
      'cap-micros': { type: 'string', default: String(DEFAULT_CAP_MICROS) },
      live: { type: 'boolean', default: false },
      finish: { type: 'boolean', default: false },
      local: { type: 'string' },
      out: { type: 'string' },
      ffmpeg: { type: 'string', default: 'native' },
      env: { type: 'string', default: 'staging' },
      report: { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      requests: { type: 'string' },
      registry: { type: 'string' },
      sheets: { type: 'string' },
      media: { type: 'string' },
      api: { type: 'string' },
      wrangler: { type: 'string' },
    },
  });
  if (values.local !== undefined && !values.finish) throw new Error('--local needs --finish');
  if (values.finish && values.live) throw new Error('--finish and --live are separate runs: submit with --live, then finish');
  if (!values.release && values.local === undefined) throw new Error('--release <tag> is required');
  if (values.env !== 'staging' && values.env !== 'prod') throw new Error('--env must be staging or prod');
  if (values.ffmpeg !== 'native' && values.ffmpeg !== 'docker') throw new Error('--ffmpeg must be native or docker');
  const cap = Number(values['cap-micros']);
  if (!Number.isInteger(cap) || cap < 0) throw new Error('--cap-micros must be a non-negative integer');
  const priority = Number(values.priority);
  if (![1, 2, 3, 4].includes(priority)) throw new Error('--priority must be 1 to 4');
  return {
    release: values.release ?? 'local',
    priority,
    capMicros: cap,
    live: values.live,
    env: values.env,
    report: values.report,
    offline: values.offline,
    finish: values.finish,
    ffmpeg: values.ffmpeg,
    ...(values.local ? { local: values.local } : {}),
    ...(values.out ? { out: values.out } : {}),
    ...(values.requests ? { requestsFile: values.requests } : {}),
    ...(values.registry ? { registryFile: values.registry } : {}),
    ...(values.sheets ? { sheetsFile: values.sheets } : {}),
    ...(values.media ? { mediaBase: values.media } : {}),
    ...(values.api ? { apiBase: values.api } : {}),
    ...(values.wrangler ? { wranglerFile: values.wrangler } : {}),
  };
}

/** A PEM exported on one line keeps its newlines as the two characters `\n`; put the real ones back. */
const pem = (v: string): string => (v.includes('\n') ? v : v.replace(/\\n/g, '\n'));

/** Everything `--finish` touches, bound to the real tools. Tests pass their own `run`, `transcode` and `sign`. */
export interface CliDeps {
  run?: Runner;
  clock?: FinishPorts['clock'];
  makeTranscode?: FinishPorts['makeTranscode'];
  makeSign?: FinishPorts['makeSign'];
  pollMs?: number;
  pollLimitMs?: number;
}

export function finishPorts(o: PrewarmOptions & FinishCliOptions, env: NodeJS.ProcessEnv, fetchFn: FetchFn, log: (l: string) => void, deps: CliDeps = {}): FinishPorts {
  const vars = workerVars(o.env, repoRoot, o.wranglerFile);
  const api = o.apiBase ?? vars['HOST_API'] ?? '';
  const token = env['OPS_TOKEN'];
  const run = deps.run ?? spawnRunner;
  return {
    log,
    env,
    makeRemote: () => {
      const r = privateRemote({ env, target: o.env, wranglerFile: o.wranglerFile, run });
      if ('skip' in r) throw new Error(r.skip);
      return r.remote;
    },
    makeTranscode: deps.makeTranscode ?? (() => new FfmpegTranscodePort({
      mode: o.ffmpeg,
      origC2pa: async (file) => {
        try {
          const info = await inspectSignature(await loadC2pa(), file, 'video/mp4');
          if (!info.present) return 'absent';
          if (info.codes.some((c) => c !== UNTRUSTED)) return 'invalid';
          return info.codes.includes(UNTRUSTED) ? 'valid-untrusted' : 'valid';
        } catch {
          return 'absent';
        }
      },
    })),
    makeSign: deps.makeSign ?? (() => new C2paNodeSignPort({ certChainPem: pem(env['C2PA_CERT_CHAIN_PEM'] ?? ''), keyPem: pem(env['C2PA_KEY_PEM'] ?? '') })),
    api: api !== '' && token ? { prewarm: httpSubmit({ api, token, fetch: fetchFn }), status: httpStatus({ api, fetch: fetchFn }) } : null,
    clock: deps.clock ?? { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    ...(deps.pollMs !== undefined ? { pollMs: deps.pollMs } : {}),
    ...(deps.pollLimitMs !== undefined ? { pollLimitMs: deps.pollLimitMs } : {}),
  };
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, fetchFn: FetchFn = fetch, log: (l: string) => void = (l) => console.log(l), deps: CliDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    log('usage: pnpm assets:gen prewarm -- --release <tag> [--live | --finish] [--env staging|prod] [--report] [--offline]');
    return 2;
  }
  if (PENDING_SUBCOMMANDS.includes(sub)) {
    log('pending: lands in M10a1');
    return 0;
  }
  if (sub !== 'prewarm') {
    log(`assets:gen: unknown subcommand ${sub}`);
    return 2;
  }
  let options: PrewarmOptions & FinishCliOptions;
  try {
    options = parsePrewarmArgs(rest);
  } catch (e) {
    log(`assets:gen prewarm: ${(e as Error).message}`);
    return 2;
  }
  try {
    if (options.finish) return (await runFinish({ release: options.release, env: options.env, ffmpeg: options.ffmpeg, ...(options.local !== undefined ? { local: options.local } : {}), ...(options.out !== undefined ? { out: options.out } : {}) }, finishPorts(options, env, fetchFn, log, deps))).code;
    const ports = defaultPorts({ env, fetch: fetchFn, log, target: options.env, mediaBase: options.mediaBase, apiBase: options.apiBase, wranglerFile: options.wranglerFile, network: !options.offline, run: deps.run });
    if (deps.clock !== undefined) ports.clock = deps.clock;
    return (await runPrewarm(options, ports)).code;
  } catch (e) {
    log(`assets:gen prewarm: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(args()).then((c) => process.exit(c), (e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

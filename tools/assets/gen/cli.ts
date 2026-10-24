/**
 * pnpm assets:gen <subcommand> (M05c3).
 *
 *   pnpm assets:gen prewarm -- --release <tag> [--priority 1] [--cap-micros <n>] [--live] [--env staging|prod] [--report]
 *                              [--requests <file>] [--registry <file>] [--sheets <file>] [--offline]
 *
 * `prewarm` is the only subcommand in M05c3; `plan`, `run` and `gate` print `pending: lands in M10a1` and exit 0.
 * The CLI has no code path that calls fal: it reads files, HEADs our media host, calls our Worker (routes 27 and 28) and reads
 * the spend ledger. Secrets (names only): OPS_TOKEN for route 28; SUPABASE_URL and SUPABASE_SECRET_KEY for the headroom read.
 * Absent, `--live` prints `SKIP ... not set` and exits 0 (OPS_TOKEN) or refuses (no headroom).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import { stripJsonc } from '../../ci/deploy.ts';
import { args, repoRoot } from '../../ci/run.ts';
import { DEFAULT_CAP_MICROS } from './estimate.ts';
import type { ResignProbe } from './gates.ts';
import { runPrewarm, type LedgerPort, type PrewarmOptions, type PrewarmPorts, type WorkerPort } from './prewarm.ts';

export const PENDING_SUBCOMMANDS: readonly string[] = ['plan', 'run', 'gate'];
const WRANGLER = 'services/edge/wrangler.jsonc';

type FetchFn = typeof fetch;

interface WranglerVars {
  vars?: Record<string, string>;
  env?: Record<string, { vars?: Record<string, string> }>;
}

/** The `vars` of the Worker build for an environment: the top level is production, `env.staging` is staging. */
export function workerVars(env: 'staging' | 'prod', root: string = repoRoot): Record<string, string> {
  const cfg = JSON.parse(stripJsonc(readFileSync(path.join(root, WRANGLER), 'utf8'))) as WranglerVars;
  return (env === 'prod' ? cfg.vars : cfg.env?.['staging']?.vars) ?? {};
}

/** The re-sign switch of the repository's Worker build for the environment (the build the operator deploys). */
export function wranglerResignProbe(root: string = repoRoot): ResignProbe {
  return {
    resignOn(env) {
      const v = workerVars(env, root)['C2PA_RESIGN'];
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
    async spentMicros(vendor, filter) {
      let q = `genai_ledger?vendor=eq.${encodeURIComponent(vendor)}&select=usd_micros&order=id`;
      if (filter?.kind !== undefined) q += `&kind=eq.${encodeURIComponent(filter.kind)}`;
      if (filter?.sinceMs !== undefined) q += `&ts=gte.${encodeURIComponent(new Date(filter.sinceMs).toISOString())}`;
      let sum = 0;
      for (let from = 0; ; from += 1000) {
        const page = (await get(q, `${from}-${from + 999}`)) as { usd_micros: number }[];
        for (const r of page) sum += r.usd_micros;
        if (page.length < 1000) return sum;
      }
    },
  };
}

/** Routes 28 and 27 of the Worker, authenticated with the staff token. */
export function httpWorker(o: { api: string; token: string; fetch: FetchFn }): WorkerPort {
  const base = o.api.replace(/\/+$/, '');
  return {
    async prewarm(keys) {
      const res = await o.fetch(`${base}/api/v1/admin/cutscenes/prewarm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
      if (res.status !== 202) throw new Error(`route 28 answered HTTP ${res.status}`);
      return ((await res.json()) as { keys: CutsceneStatus[] }).keys;
    },
    async status(key) {
      const res = await o.fetch(`${base}/api/v1/cutscenes/${key}`);
      if (!res.ok) throw new Error(`route 27 answered HTTP ${res.status}`);
      return (await res.json()) as CutsceneStatus;
    },
  };
}

export interface DefaultPortsInput {
  root?: string;
  env: NodeJS.ProcessEnv;
  fetch: FetchFn;
  log: (line: string) => void;
  target: 'staging' | 'prod';
  mediaBase?: string | undefined;
  apiBase?: string | undefined;
  /** False for `--offline`: no ledger, no network at all. */
  network: boolean;
}

export function defaultPorts(i: DefaultPortsInput): PrewarmPorts {
  const root = i.root ?? repoRoot;
  const vars = workerVars(i.target, root);
  const media = (i.mediaBase ?? vars['HOST_MEDIA'] ?? '').replace(/\/+$/, '');
  const api = i.apiBase ?? vars['HOST_API'] ?? '';
  const abs = (f: string): string => (path.isAbsolute(f) ? f : path.join(root, f));

  let ledger: LedgerPort | null = null;
  if (i.network) {
    const url = i.env['SUPABASE_URL'] ?? vars['SUPABASE_URL'];
    const key = i.env['SUPABASE_SECRET_KEY'];
    if (url && key) ledger = postgrestLedger({ url, key, fetch: i.fetch });
    else i.log('SKIP ledger headroom: SUPABASE_SECRET_KEY (and SUPABASE_URL) not set');
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
    resign: wranglerResignProbe(root),
    worker: token && api ? httpWorker({ api, token, fetch: i.fetch }) : null,
    rebuildIndex(release) {
      const r = spawnSync('pnpm', ['assets:cutscene-index', '--', '--release', release, '--media', media], { cwd: root, stdio: 'inherit' });
      return Promise.resolve(r.status ?? 1);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    defaults: {
      requests: (release) => `.private/releases/${release}/cutscene-requests.json`,
      registry: 'config/genai-endpoints.json',
      sheets: '.private/sheets.lock.json',
      reportFile: (release) => `docs/releases/${release}/cutscenes.md`,
    },
  };
}

export function parsePrewarmArgs(argv: readonly string[]): PrewarmOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      release: { type: 'string' },
      priority: { type: 'string', default: '1' },
      'cap-micros': { type: 'string', default: String(DEFAULT_CAP_MICROS) },
      live: { type: 'boolean', default: false },
      env: { type: 'string', default: 'staging' },
      report: { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      requests: { type: 'string' },
      registry: { type: 'string' },
      sheets: { type: 'string' },
      media: { type: 'string' },
      api: { type: 'string' },
    },
  });
  if (!values.release) throw new Error('--release <tag> is required');
  if (values.env !== 'staging' && values.env !== 'prod') throw new Error('--env must be staging or prod');
  const cap = Number(values['cap-micros']);
  if (!Number.isInteger(cap) || cap < 0) throw new Error('--cap-micros must be a non-negative integer');
  const priority = Number(values.priority);
  if (![1, 2, 3, 4].includes(priority)) throw new Error('--priority must be 1 to 4');
  return {
    release: values.release,
    priority,
    capMicros: cap,
    live: values.live,
    env: values.env,
    report: values.report,
    offline: values.offline,
    ...(values.requests ? { requestsFile: values.requests } : {}),
    ...(values.registry ? { registryFile: values.registry } : {}),
    ...(values.sheets ? { sheetsFile: values.sheets } : {}),
    ...(values.media ? { mediaBase: values.media } : {}),
    ...(values.api ? { apiBase: values.api } : {}),
  };
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, fetchFn: FetchFn = fetch, log: (l: string) => void = (l) => console.log(l)): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    log('usage: pnpm assets:gen prewarm -- --release <tag> [--live] [--env staging|prod] [--report] [--offline]');
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
  let options: PrewarmOptions;
  try {
    options = parsePrewarmArgs(rest);
  } catch (e) {
    log(`assets:gen prewarm: ${(e as Error).message}`);
    return 2;
  }
  try {
    const ports = defaultPorts({ env, fetch: fetchFn, log, target: options.env, mediaBase: options.mediaBase, apiBase: options.apiBase, network: !options.offline });
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

/**
 * Smoke test for a deployed (or local) tha-bay-web.
 *
 *   tsx tools/ci/check-smoke.ts <url> [--version <id>] [--worker <name>]
 *
 * GET / and GET /api/v1/health, with header assertions. With --version the request carries
 * `Cloudflare-Workers-Version-Overrides: <worker>="<id>"` so a version at 0 % can be exercised before it takes traffic.
 * --worker defaults to tha-bay-web (use tha-bay-web-staging for the staging Worker) for the override header.
 *
 * The asset catalog (BD-FU-A03): GET /asset-catalog.json (the C07 `CatalogPointer` built into the Worker's static assets), then
 * GET /media/<key> of the catalog it names (DL-713's media route), whose bytes must match the pointer's `bytes` and `sha256`, and a
 * HEAD of every variant of `data/world-index` when the catalog has one. A pointer whose catalog the media route does not serve fails
 * the smoke, naming the operator step that uploads it (`pnpm assets:publish -- --env <env>`, M01d; the env from --worker, else from the
 * URL host, else "staging or prod", see `smokeMediaEnv`): a client of that version would boot
 * without its world. A 503 from the media route is its kill switch (`MEDIA_ROUTE` "off", DL-713) and is reported as a warning only, so
 * that the switch can still be deployed.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { args } from './run.ts';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISOLATION: ReadonlyArray<[string, string]> = [
  ['cross-origin-opener-policy', 'same-origin'],
  ['cross-origin-embedder-policy', 'require-corp'],
  ['cross-origin-resource-policy', 'same-origin'],
];

export function overrideHeader(worker: string, version: string): string {
  return `${worker}="${version}"`;
}

export interface SmokeOptions {
  version?: string | undefined;
  worker?: string | undefined;
  fetchImpl?: typeof fetch;
  /** Findings that do not fail the smoke (the media route's kill switch). */
  warn?: (message: string) => void;
}

/** The media env (`assets:publish --env`) of a Worker: the staging Worker publishes to staging, every other one to prod. */
export function mediaEnvOf(worker: string): 'staging' | 'prod' {
  return worker.endsWith('-staging') ? 'staging' : 'prod';
}

export type SmokeMediaEnv = 'staging' | 'prod' | 'staging or prod';

/**
 * The media env the failure message names: from --worker when given; else from the URL host, where a host containing
 * `tha-bay-web-staging` is the staging Worker (its workers.dev host, or a Workers Preview `pr-N-tha-bay-web-staging.<sub>.workers.dev`);
 * else it cannot be told from the URL (a custom domain, localhost) and the message says "staging or prod".
 */
export function smokeMediaEnv(base: string, worker?: string): SmokeMediaEnv {
  if (worker !== undefined) return mediaEnvOf(worker);
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return 'staging or prod';
  }
  return host.includes('tha-bay-web-staging') ? 'staging' : 'staging or prod';
}

interface Pointer {
  key: string;
  sha256: string;
  bytes: number;
}

function isPointer(v: unknown): v is Pointer {
  const p = v as Record<string, unknown> | null;
  return (
    typeof p === 'object' && p !== null && p['schema'] === 'asset-catalog-pointer/1' && typeof p['key'] === 'string' && typeof p['sha256'] === 'string' && typeof p['bytes'] === 'number'
  );
}

/** Returns the list of failed assertions; empty means the smoke test passed. */
export async function smoke(base: string, options: SmokeOptions = {}): Promise<string[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  if (options.version) headers['Cloudflare-Workers-Version-Overrides'] = overrideHeader(options.worker ?? 'tha-bay-web', options.version);
  const problems: string[] = [];

  const get = async (p: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response | null> => {
    try {
      return await doFetch(new URL(p, base), { method, headers, redirect: 'manual' });
    } catch (error) {
      problems.push(`${method} ${p} failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  const isolation = (p: string, res: Response): void => {
    for (const [name, want] of ISOLATION) {
      const got = res.headers.get(name);
      if (got?.toLowerCase() !== want) problems.push(`${p} ${name}: want ${want}, got ${got ?? 'absent'}`);
    }
  };

  const home = await get('/');
  if (home) {
    void home.body?.cancel();
    if (home.status !== 200) problems.push(`/ status ${home.status}, want 200`);
    isolation('/', home);
  }

  const health = await get('/api/v1/health');
  if (health) {
    if (health.status !== 200) problems.push(`/api/v1/health status ${health.status}, want 200`);
    isolation('/api/v1/health', health);
    if (!UUIDV7.test(health.headers.get('x-request-id') ?? '')) problems.push('/api/v1/health X-Request-Id is not a UUIDv7');
    try {
      const body = (await health.json()) as { ok?: unknown };
      if (body.ok !== true) problems.push('/api/v1/health body.ok is not true');
    } catch {
      problems.push('/api/v1/health body is not JSON');
    }
  }

  await catalog(get, problems, smokeMediaEnv(base, options.worker), options.warn ?? ((m) => console.warn(`check:smoke WARN ${m}`)));
  return problems;
}

type Get = (p: string, method?: 'GET' | 'HEAD') => Promise<Response | null>;

/** The pointer, the catalog it names on the media route, and the world index's variants (BD-FU-A03). */
async function catalog(get: Get, problems: string[], env: SmokeMediaEnv, warn: (m: string) => void): Promise<void> {
  const flag = env === 'staging or prod' ? '<staging or prod>' : env;
  const which = env === 'staging or prod' ? ' (the env of the Worker behind this URL; pass --worker to name it)' : '';
  const publish = `run the operator step \`pnpm assets:publish -- --env ${flag}\` (M01d)${which}, which uploads the catalog and its objects to the ${env} media bucket, then deploy again`;
  const res = await get('/asset-catalog.json');
  if (!res) return;
  if (res.status !== 200) {
    void res.body?.cancel();
    problems.push(`/asset-catalog.json status ${res.status}, want 200 (the build ships the catalog pointer from apps/web/public)`);
    return;
  }
  let pointer: unknown;
  try {
    pointer = await res.json();
  } catch {
    pointer = null;
  }
  if (!isPointer(pointer)) {
    problems.push('/asset-catalog.json is not an asset-catalog-pointer/1');
    return;
  }
  const path = `/media/${pointer.key}`;
  const media = await get(path);
  if (!media) return;
  if (media.status === 503) {
    void media.body?.cancel();
    warn(`${path} answered 503: the media route is switched off (MEDIA_ROUTE "off", DL-713); the catalog was not checked`);
    return;
  }
  if (media.status !== 200) {
    void media.body?.cancel();
    problems.push(`/asset-catalog.json names ${pointer.key}, but GET ${path} answered ${media.status}: clients of this version would boot without their world. Before this check can pass, ${publish}`);
    return;
  }
  const bytes = new Uint8Array(await media.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== pointer.bytes || sha !== pointer.sha256) {
    problems.push(`${path} is ${bytes.byteLength} bytes with sha256 ${sha}, but /asset-catalog.json wants ${pointer.bytes} bytes and ${pointer.sha256}; ${publish}`);
    return;
  }
  let parsed: { entries?: Record<string, { variants?: Record<string, { key?: unknown } | undefined> } | undefined> } | null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as typeof parsed;
  } catch {
    problems.push(`${path} is not JSON`);
    return;
  }
  const index = parsed?.entries?.['data/world-index'];
  for (const v of Object.values(index?.variants ?? {})) {
    if (typeof v?.key !== 'string') continue;
    const head = await get(`/media/${v.key}`, 'HEAD');
    if (head && head.status !== 200) problems.push(`the catalog's data/world-index variant ${v.key} answered HEAD ${head.status}, want 200; ${publish}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { version: { type: 'string' }, worker: { type: 'string' } },
    allowPositionals: true,
  });
  const url = positionals[0];
  if (!url) {
    console.error('usage: check-smoke.ts <url> [--version <id>] [--worker <name>]');
    return 2;
  }
  console.log(`check:smoke ${url}${values.version ? ` version=${values.version}` : ''}`);
  const problems = await smoke(url, { version: values.version, worker: values.worker });
  for (const p of problems) console.error(`check:smoke FAIL ${p}`);
  if (problems.length === 0) console.log('check:smoke ok');
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(args()).then((code) => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

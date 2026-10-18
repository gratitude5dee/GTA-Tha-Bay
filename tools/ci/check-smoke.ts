/**
 * Smoke test for a deployed (or local) tha-bay-web.
 *
 *   tsx tools/ci/check-smoke.ts <url> [--version <id>] [--worker <name>]
 *
 * GET / and GET /api/v1/health, with header assertions. With --version the request carries
 * `Cloudflare-Workers-Version-Overrides: <worker>="<id>"` so a version at 0 % can be exercised before it takes traffic.
 * --worker defaults to tha-bay-web (use tha-bay-web-staging for the staging Worker).
 */
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
}

/** Returns the list of failed assertions; empty means the smoke test passed. */
export async function smoke(base: string, options: SmokeOptions = {}): Promise<string[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  if (options.version) headers['Cloudflare-Workers-Version-Overrides'] = overrideHeader(options.worker ?? 'tha-bay-web', options.version);
  const problems: string[] = [];

  const get = async (p: string): Promise<Response | null> => {
    try {
      return await doFetch(new URL(p, base), { headers, redirect: 'manual' });
    } catch (error) {
      problems.push(`GET ${p} failed: ${error instanceof Error ? error.message : String(error)}`);
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
  return problems;
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

/**
 * Cloudflare deploys for the tha-bay-web Worker.
 *
 *   tsx tools/ci/deploy.ts preview   [--name <preview-name>]   Workers Preview of the staging Worker
 *   tsx tools/ci/deploy.ts prod      [--env staging]           wrangler deploy (M00a replaces this with versions + smoke)
 *   tsx tools/ci/deploy.ts bootstrap                           first deploy of tha-bay-web-staging and tha-bay-web (operator, Admin token)
 *
 * Without CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID every mode prints a SKIP line and exits 0;
 * `preview` then also removes any stale test-results/preview-url.txt so a later --from check skips too.
 * Only Workers named tha-bay-* are ever deployed; the account holds unrelated Workers that must not be touched.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { args, repoRoot } from './run.ts';

export const PREVIEW_URL_FILE = 'test-results/preview-url.txt';
const WRANGLER_CONFIG = path.join(repoRoot, 'services/edge/wrangler.jsonc');
const DIST_INDEX = path.join(repoRoot, 'apps/web/dist/index.html');

export type Mode = 'preview' | 'prod' | 'bootstrap';

/** Removes // and /* *\/ comments outside of strings so wrangler.jsonc can be read with JSON.parse. */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
    } else if (c === '"') {
      inString = true;
      out += c;
      i += 1;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Every Worker name in the config (top level and per environment). */
export function workerNames(configText: string): string[] {
  const cfg = JSON.parse(stripJsonc(configText)) as { name?: string; env?: Record<string, { name?: string }> };
  const names = cfg.name ? [cfg.name] : [];
  for (const env of Object.values(cfg.env ?? {})) if (env.name) names.push(env.name);
  return names;
}

export function assertOwnWorkers(): void {
  const names = workerNames(readFileSync(WRANGLER_CONFIG, 'utf8'));
  const foreign = names.filter((n) => !n.startsWith('tha-bay-'));
  if (names.length === 0 || foreign.length > 0) {
    throw new Error(`refusing to deploy: Worker names must start with tha-bay- (found ${foreign.join(', ') || 'none'})`);
  }
}

/**
 * Finds a preview URL in wrangler output. `wrangler preview --json` is in open beta and its shape is not
 * documented in the ledger (UNVERIFIED), so this accepts one JSON document, NDJSON, or plain text, prefers
 * keys that look like a preview URL, and otherwise takes the first https URL on workers.dev.
 */
export function parsePreviewUrl(output: string): string | null {
  const urls: Array<{ url: string; score: number }> = [];
  const visit = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (/^https:\/\//.test(value)) urls.push({ url: value, score: /preview/i.test(key) ? 2 : /url/i.test(key) ? 1 : 0 });
    } else if (Array.isArray(value)) {
      for (const v of value) visit(v, key);
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  const tryParse = (text: string): void => {
    try {
      visit(JSON.parse(text), '');
    } catch {
      /* not JSON */
    }
  };
  tryParse(output.trim());
  if (urls.length === 0) for (const line of output.split('\n')) if (line.trim().startsWith('{')) tryParse(line.trim());
  if (urls.length === 0) {
    for (const m of output.matchAll(/https:\/\/[^\s"'<>)]+/g)) urls.push({ url: m[0], score: /workers\.dev/.test(m[0]) ? 1 : 0 });
  }
  const best = urls.filter((u) => /workers\.dev/.test(u.url)).sort((a, b) => b.score - a.score)[0];
  return best?.url ?? null;
}

export function previewName(env: NodeJS.ProcessEnv, explicit: string | undefined): string {
  if (explicit) return explicit;
  const pr = env['PR_NUMBER'] ?? /^refs\/pull\/(\d+)\//.exec(env['GITHUB_REF'] ?? '')?.[1];
  if (pr) return `pr-${pr}`;
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  return branch.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'local';
}

function hasCredentials(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env['CLOUDFLARE_API_TOKEN']) && Boolean(env['CLOUDFLARE_ACCOUNT_ID']);
}

function wrangler(wranglerArgs: string[]): { status: number; out: string } {
  const res = spawnSync('pnpm', ['--filter', '@dv/edge', 'exec', 'wrangler', ...wranglerArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout}${res.stderr}`;
  process.stdout.write(res.stdout);
  process.stderr.write(res.stderr);
  return { status: res.status ?? 1, out };
}

function ensureDist(): void {
  if (existsSync(DIST_INDEX)) return;
  console.log('apps/web/dist is missing; running pnpm build first');
  const res = spawnSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit' });
  if (res.status !== 0) throw new Error('pnpm build failed');
}

function preview(name: string): number {
  ensureDist();
  mkdirSync(path.join(repoRoot, 'test-results'), { recursive: true });

  // Primary path: Workers Preview of the staging Worker (open beta in wrangler 4.151.1).
  const first = wrangler(['preview', '--env', 'staging', '--name', name, '--json']);
  let url = first.status === 0 ? parsePreviewUrl(first.out) : null;
  let pathTaken = 'wrangler-preview';

  if (!url) {
    // CI-R01 fallback: a Version Preview URL on the staging Worker, which holds no production data.
    console.warn(`wrangler preview did not yield a URL (exit ${first.status}); falling back to versions upload --preview-alias ${name}`);
    const second = wrangler(['versions', 'upload', '--env', 'staging', '--preview-alias', name]);
    if (second.status !== 0) {
      console.error('deploy:preview failed on both paths');
      return 1;
    }
    url = parsePreviewUrl(second.out);
    pathTaken = 'versions-upload-preview-alias';
  }
  if (!url) {
    console.error('deploy:preview: no preview URL found in wrangler output');
    return 1;
  }
  writeFileSync(path.join(repoRoot, PREVIEW_URL_FILE), `${url}\n`);
  console.log(`deploy:preview ok path=${pathTaken} name=${name} url=${url}`);
  return 0;
}

function prod(extra: string[]): number {
  ensureDist();
  return wrangler(['deploy', ...extra]).status;
}

function bootstrap(): number {
  ensureDist();
  console.log('deploy:bootstrap: first deploy of tha-bay-web-staging, then tha-bay-web (idempotent)');
  const staging = wrangler(['deploy', '--env', 'staging']);
  if (staging.status !== 0) return staging.status;
  return wrangler(['deploy']).status;
}

export function main(argv: string[], env: NodeJS.ProcessEnv): number {
  const [mode, ...rest] = argv;
  if (mode !== 'preview' && mode !== 'prod' && mode !== 'bootstrap') {
    console.error('usage: deploy.ts <preview|prod|bootstrap> [--name <n>] [--env staging]');
    return 2;
  }
  const { values } = parseArgs({ args: rest, options: { name: { type: 'string' }, env: { type: 'string' } }, allowPositionals: true });

  if (!hasCredentials(env)) {
    if (mode === 'preview') rmSync(path.join(repoRoot, PREVIEW_URL_FILE), { force: true });
    console.log(`SKIP deploy:${mode}: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set`);
    return 0;
  }
  assertOwnWorkers();
  if (mode === 'preview') return preview(previewName(env, values.name));
  if (mode === 'prod') return prod(values.env ? ['--env', values.env] : []);
  return bootstrap();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(args(), process.env));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

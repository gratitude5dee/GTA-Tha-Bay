/**
 * Cloudflare deploys for the tha-bay-web Worker.
 *
 *   tsx tools/ci/deploy.ts preview   [--name <preview-name>]   Workers Preview of the staging Worker
 *   tsx tools/ci/deploy.ts preview   --sweep-closed            delete the Previews of closed PRs and their branches (nightly, M00d)
 *   tsx tools/ci/deploy.ts prod      [--env staging] [--dry-run] [--url <u>] [--do-lifecycle | --auto-lifecycle [--base <ref>]]
 *                                                              versions upload -> 0 % -> smoke -> 100 % -> rollback on failure
 *   tsx tools/ci/deploy.ts bootstrap                           first deploy of tha-bay-web-staging and tha-bay-web (operator, Admin token)
 *
 * Without CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID every mode prints a SKIP line and exits 0;
 * `preview` then also removes any stale test-results/preview-url.txt so a later --from check skips too.
 * Only Workers named tha-bay-* are ever deployed; the account holds unrelated Workers that must not be touched.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { collectChanges, evaluate } from './check-do-migrations.ts';
import { decideDoLifecycle, type GitRun } from './deploy-decide.ts';
import { planProd, readTextIfExists, runProd, type Exec, type ProdOptions } from './deploy-prod.ts';
import { checkOdblOffer, prepareWorldRelease, releaseKeyOf, type ReleaseIo } from './world-release.ts';
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

/** The Preview name a branch run gets (`previewName` without a PR). */
export function branchSlug(branch: string): string {
  return branch.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'local';
}

export function previewName(env: NodeJS.ProcessEnv, explicit: string | undefined): string {
  if (explicit) return explicit;
  const pr = env['PR_NUMBER'] ?? /^refs\/pull\/(\d+)\//.exec(env['GITHUB_REF'] ?? '')?.[1];
  if (pr) return `pr-${pr}`;
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  return branchSlug(branch);
}

export interface SweepRunner {
  /** `gh` with these arguments; `null` when the binary is not installed. */
  gh(ghArgs: string[]): { status: number; out: string } | null;
  wrangler(wranglerArgs: string[]): { status: number; out: string };
}

const NOT_FOUND = /not found|does not exist|no such preview|could not find|404/i;

/**
 * Stale-Preview sweep (M00d, DL-658). No command lists Previews (U-QA-9), so the names are derived from GitHub:
 * every closed PR gives `pr-<N>` (a PR run) and the slug of its head branch (a branch run). "not found" counts as
 * success; any other failure is logged and the sweep continues; it fails only when every delete failed for a reason
 * other than "not found".
 */
export function sweepClosed(runner: SweepRunner, log: (line: string) => void = console.log): number {
  const listed = runner.gh(['pr', 'list', '--state', 'closed', '--limit', '200', '--json', 'number,headRefName']);
  if (!listed) {
    log('SKIP deploy:preview --sweep-closed: gh not found');
    return 0;
  }
  if (listed.status !== 0) {
    log(`deploy:preview --sweep-closed: gh pr list failed (exit ${listed.status}); nothing swept`);
    return 1;
  }
  let prs: { number: number; headRefName: string }[];
  try {
    prs = JSON.parse(listed.out) as { number: number; headRefName: string }[];
  } catch {
    log('deploy:preview --sweep-closed: gh output is not JSON; nothing swept');
    return 1;
  }
  const names = new Set<string>();
  for (const pr of prs) {
    names.add(`pr-${pr.number}`);
    if (pr.headRefName) names.add(branchSlug(pr.headRefName));
  }
  let deleted = 0;
  let missing = 0;
  let failed = 0;
  for (const name of names) {
    const res = runner.wrangler(['preview', 'delete', '--env', 'staging', '--name', name, '--skip-confirmation']);
    if (res.status === 0) deleted++;
    else if (NOT_FOUND.test(res.out)) missing++;
    else {
      failed++;
      log(`deploy:preview --sweep-closed: delete ${name} failed (exit ${res.status}); continuing`);
    }
  }
  log(`deploy:preview --sweep-closed: ${names.size} names, ${deleted} deleted, ${missing} not found, ${failed} failed`);
  return names.size > 0 && failed === names.size ? 1 : 0;
}

function realRunner(): SweepRunner {
  return {
    gh(ghArgs) {
      const res = spawnSync('gh', ghArgs, { cwd: repoRoot, encoding: 'utf8', env: process.env });
      if (res.error) return null;
      return { status: res.status ?? 1, out: res.stdout };
    },
    wrangler(wranglerArgs) {
      const res = spawnSync('pnpm', ['--filter', '@dv/edge', 'exec', 'wrangler', ...wranglerArgs], { cwd: repoRoot, encoding: 'utf8', env: process.env });
      return { status: res.status ?? 1, out: `${res.stdout}${res.stderr}` };
    },
  };
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

function git(gitArgs: string[]): string {
  return spawnSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
}

const gitRun: GitRun = (gitArgs) => {
  const res = spawnSync('git', [...gitArgs], { cwd: repoRoot, encoding: 'utf8' });
  return { status: res.status ?? 1, out: res.stdout ?? '' };
};

type ProdFlags = {
  env?: string | undefined;
  url?: string | undefined;
  'do-lifecycle'?: boolean | undefined;
  'auto-lifecycle'?: boolean | undefined;
  base?: string | undefined;
};

/**
 * `--auto-lifecycle` (push, tag and manual runs, where no PR label exists): take the `wrangler deploy` path when the
 * commits being deployed hold a Durable Object lifecycle change, as `check:do-migrations` judges them. `--do-lifecycle`
 * or DV_DO_LIFECYCLE=1 (the PR-label path) still forces it without looking.
 */
export function resolveDoLifecycle(env: NodeJS.ProcessEnv, values: ProdFlags): boolean {
  const decision = decideDoLifecycle(
    {
      explicit: Boolean(values['do-lifecycle']) || env['DV_DO_LIFECYCLE'] === '1',
      auto: Boolean(values['auto-lifecycle']) || env['DV_AUTO_LIFECYCLE'] === '1',
      base: values.base ?? env['DV_DEPLOY_BASE'],
      eventBefore: env['DV_EVENT_BEFORE'],
      refType: env['GITHUB_REF_TYPE'],
      eventName: env['GITHUB_EVENT_NAME'],
    },
    gitRun,
    (base) => evaluate(collectChanges(repoRoot, base)).lifecycle,
  );
  console.log(`deploy:prod lifecycle decision: ${decision.reason}`);
  return decision.doLifecycle;
}

/**
 * Worker secrets that ride with a version upload (`--secrets-file`, DL-679). Each is read from the environment (GitHub repository secrets in CI)
 * and written to `$RUNNER_TEMP/secrets.json` with mode 0600; one that is absent or empty is left out, never written as an empty string.
 * `PLAY_TOKEN_HMAC` and `QUOTA_NET_SALT_SECRET` are in the Worker's `secrets.required` (M06a1), `PLAY_TOKEN_HMAC_PREV` is optional (rotation window).
 * `ANTHROPIC_API_KEY` (M06a3, workspace `npc-runtime`) is required by the production config only; staging runs recorded streams.
 */
export const WORKER_SECRETS = ['PLAY_TOKEN_HMAC', 'PLAY_TOKEN_HMAC_PREV', 'QUOTA_NET_SALT_SECRET', 'ANTHROPIC_API_KEY'] as const;
const REQUIRED_WORKER_SECRETS: readonly (typeof WORKER_SECRETS)[number][] = ['PLAY_TOKEN_HMAC', 'QUOTA_NET_SALT_SECRET'];

export function buildSecretsJson(env: NodeJS.ProcessEnv): { json: string; missing: string[] } {
  const out: Record<string, string> = {};
  for (const name of WORKER_SECRETS) {
    const v = env[name];
    if (v !== undefined && v !== '') out[name] = v;
  }
  return { json: `${JSON.stringify(out)}\n`, missing: REQUIRED_WORKER_SECRETS.filter((n) => out[n] === undefined) };
}

/** Options for the versions-based deploy; exported so tests and --dry-run share them. */
export function prodOptions(env: NodeJS.ProcessEnv, values: { env?: string | undefined; url?: string | undefined; 'do-lifecycle'?: boolean | undefined }): ProdOptions {
  const tmp = env['RUNNER_TEMP'] ?? os.tmpdir();
  const sha = (env['GITHUB_SHA'] ?? git(['rev-parse', 'HEAD']) ?? '').slice(0, 12) || 'local';
  const title = (git(['log', '-1', '--pretty=%s']) || 'manual deploy').slice(0, 100);
  const workerName = values.env === 'staging' ? 'tha-bay-web-staging' : 'tha-bay-web';
  return {
    env: values.env,
    workerName,
    sha12: sha,
    title,
    secretsFile: path.join(tmp, 'secrets.json'),
    url: values.url ?? env['SMOKE_URL'],
    doLifecycle: Boolean(values['do-lifecycle']) || env['DV_DO_LIFECYCLE'] === '1',
    outputFile: path.join(tmp, 'wrangler-output.ndjson'),
  };
}

function summary(line: string): void {
  const file = process.env['GITHUB_STEP_SUMMARY'];
  if (file) writeFileSync(file, `${line}\n`, { flag: 'a' });
}

function prod(o: ProdOptions): number {
  const exec: Exec = (cmd, extraEnv) => {
    const [bin, ...rest] = cmd;
    const res = spawnSync(bin!, rest, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(res.stdout);
    process.stderr.write(res.stderr);
    return { status: res.status ?? 1, out: `${res.stdout}${res.stderr}` };
  };
  const key = releaseKeyOf(o.env);
  const io: ReleaseIo = {
    read: (rel) => (existsSync(path.join(repoRoot, rel)) ? readFileSync(path.join(repoRoot, rel), 'utf8') : null),
    write: (rel, text) => {
      mkdirSync(path.dirname(path.join(repoRoot, rel)), { recursive: true });
      writeFileSync(path.join(repoRoot, rel), text);
    },
  };
  const result = runProd(o, {
    exec,
    world: {
      before: () => prepareWorldRelease(io, key, (l) => console.log(`deploy:prod ${l}`)),
      afterBuild: () => checkOdblOffer(io, key, 'apps/web/dist/credits.json'),
    },
    build: () => spawnSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit' }).status ?? 1,
    writeSecrets: (file) => {
      mkdirSync(path.dirname(file), { recursive: true });
      const { json, missing } = buildSecretsJson(process.env);
      if (missing.length > 0) console.warn(`deploy:prod: required Worker secrets not in the environment: ${missing.join(', ')} (versions upload fails without them unless the Worker already holds them)`);
      writeFileSync(file, json, { mode: 0o600 });
    },
    readOutputFile: readTextIfExists,
    configUrl: () => {
      const cfg = JSON.parse(stripJsonc(readFileSync(WRANGLER_CONFIG, 'utf8'))) as {
        vars?: Record<string, string>;
        env?: Record<string, { vars?: Record<string, string> }>;
      };
      return (o.env ? cfg.env?.[o.env]?.vars?.['HOST_API'] : cfg.vars?.['HOST_API']) ?? 'http://localhost:8788';
    },
    log: (line) => console.log(`deploy:prod ${line}`),
  });
  console.log(`deploy:prod ${result.code === 0 ? 'ok' : 'FAILED'}: ${result.message}`);
  if (result.newVersion) summary(`**${o.workerName}** version \`${result.newVersion}\` (${o.sha12}): ${result.message}`);
  if (result.rolledBack) console.log(`deploy:prod rolled back to ${result.oldVersion}`);
  return result.code;
}

/** Printed after bootstrap: the routes block to add to wrangler.jsonc once Q-15 names the domain (09-backend-ops.md section 1.2). */
const CUSTOM_DOMAIN_NOTE = `deploy:bootstrap: no custom domain yet (Q-15). Once the domain is chosen, add to the top-level config
and set workers_dev to false there:
  "routes": [ { "pattern": "<domain>", "custom_domain": true }, { "pattern": "id.<domain>", "custom_domain": true } ]
and replace the HOST_* vars (HOST_MEDIA is the Worker's own /media route, DL-713; HOST_UGC is still a placeholder; a media.<domain> replaces the route's value). The version-affinity Transform Rule is created before the first gradual split (M12a).`;

/** Queues of the web Worker (M06a1); `wrangler queues create` is repeated safely, an existing queue is not an error. */
export const QUEUE_NAMES = ['tha-bay-jobs', 'tha-bay-spend', 'tha-bay-jobs-staging', 'tha-bay-spend-staging'] as const;

function ensureQueues(): number {
  for (const name of QUEUE_NAMES) {
    const res = wrangler(['queues', 'create', name]);
    if (res.status !== 0 && !/already exists|\b11009\b/i.test(res.out)) {
      console.error(`deploy:bootstrap: could not create queue ${name}`);
      return res.status || 1;
    }
  }
  return 0;
}

function bootstrap(): number {
  ensureDist();
  const queues = ensureQueues();
  if (queues !== 0) return queues;
  console.log('deploy:bootstrap: first deploy of tha-bay-web-staging, then tha-bay-web (idempotent)');
  const staging = wrangler(['deploy', '--env', 'staging']);
  if (staging.status !== 0) return staging.status;
  const prodDeploy = wrangler(['deploy']);
  if (prodDeploy.status === 0) console.log(CUSTOM_DOMAIN_NOTE);
  return prodDeploy.status;
}

export function main(argv: string[], env: NodeJS.ProcessEnv): number {
  const [mode, ...rest] = argv;
  if (mode !== 'preview' && mode !== 'prod' && mode !== 'bootstrap') {
    console.error('usage: deploy.ts <preview|prod|bootstrap> [--name <n>] [--env staging]');
    return 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      env: { type: 'string' },
      'dry-run': { type: 'boolean' },
      url: { type: 'string' },
      'do-lifecycle': { type: 'boolean' },
      'auto-lifecycle': { type: 'boolean' },
      base: { type: 'string' },
      'sweep-closed': { type: 'boolean' },
    },
    allowPositionals: true,
  });

  if (mode === 'prod' && values['dry-run']) {
    assertOwnWorkers();
    const o = prodOptions(env, { ...values, 'do-lifecycle': resolveDoLifecycle(env, values) });
    console.log(`deploy:prod --dry-run (${o.workerName}); no network, nothing is executed`);
    for (const line of planProd(o)) console.log(line);
    return 0;
  }

  if (!hasCredentials(env)) {
    if (mode === 'preview') rmSync(path.join(repoRoot, PREVIEW_URL_FILE), { force: true });
    console.log(`SKIP deploy:${mode}: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set`);
    return 0;
  }
  assertOwnWorkers();
  if (mode === 'preview' && values['sweep-closed']) return sweepClosed(realRunner());
  if (mode === 'preview') return preview(previewName(env, values.name));
  if (mode === 'prod') return prod(prodOptions(env, { ...values, 'do-lifecycle': resolveDoLifecycle(env, values) }));
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

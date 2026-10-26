/**
 * Checks on a served build or on apps/web/dist.
 *
 *   tsx tools/ci/check-dist.ts headers <url> | --serve <url> | --from <file>
 *   tsx tools/ci/check-dist.ts coi     <url> | --serve <url> | --from <file>
 *   tsx tools/ci/check-dist.ts bundle  [--dist <dir>] [--forbid-qa] [--module-ids <file>]
 *   tsx tools/ci/check-dist.ts icons   [--dist <dir>]
 *   tsx tools/ci/check-dist.ts limits  [--dist <dir>]   Workers static-asset limits only (25 MiB per file, 20,000 files; F-018)
 *
 * --serve <url>  runs the Playwright webServer command on the port of <url>, waits for the port, checks, then stops what it started.
 *                A server already listening on that port is refused, never reused (BD-FIX-SEC-02: it may be a `pnpm dev` Worker holding
 *                live secrets); to check a server you started yourself, pass its <url> without --serve.
 * --from <file>  reads the URL from the file; prints SKIP and exits 0 when the file does not exist.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { args, repoRoot } from './run.ts';
import { scrubProcessEnv } from './secret-env.ts';
import { ASSET_COUNT_LIMIT, ASSET_FILE_LIMIT_BYTES, MIB, assetLimitFailures, assetStats, listFiles } from './lib/asset-limits.ts';
import { checkModuleIds } from './lib/module-ids.ts';

/** The shell chunk budget of 10-ui.md section 2.7: 120 KiB gzip. */
const SHELL_GZIP_LIMIT_BYTES = 120 * 1024;

const PRECACHE_LIMIT_BYTES = 6 * MIB; // matches maximumFileSizeToCacheInBytes in apps/web/vite.config.ts

type Mode = 'headers' | 'coi' | 'bundle' | 'icons' | 'limits';

const failures: string[] = [];
function ok(label: string): void {
  console.log(`  ok    ${label}`);
}
function fail(label: string, detail: string): void {
  failures.push(`${label}: ${detail}`);
  console.log(`  FAIL  ${label}: ${detail}`);
}
function expect(cond: boolean, label: string, detail: string): void {
  if (cond) ok(label);
  else fail(label, detail);
}

// ---------------------------------------------------------------------------------------------
// target resolution and local server

async function isListening(u: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: u.hostname, port: Number(u.port) || 80 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

type WebServer = { command: string; timeout?: number; env?: Record<string, string> };

/** The Playwright webServer command, timeout and env (the env pins the country the local Worker sees, BD-FIX-CI-02). */
async function webServerCommand(): Promise<{ command: string; timeout: number; env: Record<string, string> }> {
  const mod = (await import(path.join(repoRoot, 'playwright.config.ts'))) as { default: { webServer?: WebServer | WebServer[] } };
  const ws = mod.default.webServer;
  const first = Array.isArray(ws) ? ws[0] : ws;
  if (!first) throw new Error('playwright.config.ts has no webServer');
  return { command: first.command, timeout: first.timeout ?? 120_000, env: first.env ?? {} };
}

async function withServer<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const u = new URL(url);
  if (await isListening(u)) {
    throw new Error(
      `a server is already listening on ${u.host}; --serve never reuses one (BD-FIX-SEC-02: it may hold live secrets). Stop it, pick a free port, or pass the URL without --serve to check that server.`,
    );
  }
  // The web server starts without a live secret (BD-FIX-SEC-01) and on the port of <url> (playwright.config.ts reads DV_E2E_PORT).
  scrubProcessEnv({ label: `check-dist --serve` });
  process.env['DV_E2E_PORT'] = u.port || '80';
  const { command, timeout, env } = await webServerCommand();
  console.log(`starting: ${command}`);
  const child = spawn('sh', ['-c', command], { cwd: repoRoot, detached: true, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'] });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  try {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await isListening(u)) break;
      if (child.exitCode !== null) throw new Error(`web server exited early with code ${child.exitCode}`);
      if (Date.now() > deadline) throw new Error(`web server did not listen on ${u.host} within ${timeout} ms`);
      await new Promise((r) => setTimeout(r, 500));
    }
    return await fn();
  } finally {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// headers

const ISOLATION: ReadonlyArray<[string, string]> = [
  ['cross-origin-opener-policy', 'same-origin'],
  ['cross-origin-embedder-policy', 'require-corp'],
  ['cross-origin-resource-policy', 'same-origin'],
];

// M05b1 (DL-191): the Report-Only policy of spec/05 section 1.3 and its companions on app documents and Worker responses.
const REPORT_ONLY_DIRECTIVES = ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "object-src 'none'", "frame-ancestors 'none'", 'report-to csp'];

function expectDocumentSecurityHeaders(res: Response, label: string): void {
  const csp = res.headers.get('content-security-policy-report-only') ?? '';
  expect(csp !== '', `${label} has Content-Security-Policy-Report-Only`, 'absent');
  expect(!csp.includes('%') && !csp.includes('<'), `${label} CSP has no unsubstituted placeholder`, csp.slice(0, 80));
  for (const d of REPORT_ONLY_DIRECTIVES) expect(csp.includes(d), `${label} CSP has ${d}`, csp.slice(0, 120));
  const reporting = res.headers.get('reporting-endpoints');
  expect(reporting === 'csp="/api/v1/reports/browser"', `${label} Reporting-Endpoints names route 4`, `got ${reporting ?? 'absent'}`);
  const nosniff = res.headers.get('x-content-type-options');
  expect(nosniff === 'nosniff', `${label} X-Content-Type-Options: nosniff`, `got ${nosniff ?? 'absent'}`);
  const referrer = res.headers.get('referrer-policy');
  expect(referrer === 'strict-origin-when-cross-origin', `${label} Referrer-Policy: strict-origin-when-cross-origin`, `got ${referrer ?? 'absent'}`);
}

async function get(base: string, pathname: string): Promise<Response> {
  const res = await fetch(new URL(pathname, base), { redirect: 'manual' });
  void res.body?.cancel();
  return res;
}

async function checkHeaders(base: string): Promise<void> {
  console.log(`check:headers ${base}`);
  const home = await fetch(new URL('/', base));
  const html = await home.text();
  const hashed = /\/assets\/[^"'\s]+\.js/.exec(html)?.[0];
  expect(hashed !== undefined, 'index.html references a hashed /assets/*.js', 'no /assets/*.js script in /');

  const isolated = ['/', '/sw.js', '/manifest.webmanifest', ...(hashed ? [hashed] : [])];
  for (const p of isolated) {
    const res = await get(base, p);
    expect(res.status === 200, `${p} status 200`, `got ${res.status}`);
    for (const [name, want] of ISOLATION) {
      const got = res.headers.get(name);
      expect(got?.toLowerCase() === want, `${p} ${name}: ${want}`, `got ${got ?? 'absent'}`);
    }
  }

  expectDocumentSecurityHeaders(await get(base, '/'), '/');

  if (hashed) {
    const res = await get(base, hashed);
    const cc = res.headers.get('cache-control');
    expect(cc === 'public, max-age=31556952, immutable', `${hashed} Cache-Control immutable`, `got ${cc ?? 'absent'}`);
  }

  const sw = await get(base, '/sw.js');
  const swCc = sw.headers.get('cache-control') ?? '';
  expect(!/immutable/.test(swCc), '/sw.js is not immutable', `got ${swCc}`);

  // M00e: /account redirects to the island, which is the only non-isolated document.
  const bare = await get(base, '/account');
  expect(bare.status === 308, '/account answers 308', `got ${bare.status}`);
  expect((bare.headers.get('location') ?? '').endsWith('/account/'), '/account Location ends in /account/', `got ${bare.headers.get('location') ?? 'absent'}`);
  expect(bare.headers.get('cross-origin-embedder-policy') === null, '/account redirect has no COEP', `got ${bare.headers.get('cross-origin-embedder-policy') ?? ''}`);

  const account = await get(base, '/account/');
  expect(account.status === 200, '/account/ status 200', `got ${account.status}`);
  expect(account.headers.get('cross-origin-embedder-policy') === null, '/account/ has no COEP', `got ${account.headers.get('cross-origin-embedder-policy') ?? ''}`);
  expect(account.headers.get('cross-origin-opener-policy') === null, '/account/ has no COOP', `got ${account.headers.get('cross-origin-opener-policy') ?? ''}`);
  expect(account.headers.get('content-security-policy-report-only') === null, '/account/ has no Report-Only CSP (its own allowlist)', 'present');

  // M00a: Worker responses carry the isolation headers in code, not through _headers.
  const health = await get(base, '/api/v1/health');
  expect(health.status === 200, '/api/v1/health status 200', `got ${health.status}`);
  for (const [name, want] of ISOLATION) {
    const got = health.headers.get(name);
    expect(got?.toLowerCase() === want, `/api/v1/health ${name}: ${want}`, `got ${got ?? 'absent'}`);
  }
  expectDocumentSecurityHeaders(health, '/api/v1/health');
  const rid = health.headers.get('x-request-id') ?? '';
  expect(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(rid), '/api/v1/health X-Request-Id is a UUIDv7', `got ${rid || 'absent'}`);

  // Route 4 receives the Report-Only violations: 204 for a csp-violation body (451 from outside the allowed region is not a failure here).
  const report = await fetch(new URL('/api/v1/reports/browser', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/reports+json' },
    body: JSON.stringify([{ type: 'csp-violation', url: new URL('/', base).href, body: { effectiveDirective: 'img-src', blockedURL: 'inline', documentURL: new URL('/', base).href, disposition: 'report' } }]),
  });
  void report.body?.cancel();
  if (report.status === 451) console.log('SKIP route 4 check: 451 region_blocked from this location');
  else expect(report.status === 204, 'POST /api/v1/reports/browser (csp-violation) answers 204', `got ${report.status}`);
}

// ---------------------------------------------------------------------------------------------
// cross-origin isolation after a service-worker-served reload

async function checkCoi(base: string): Promise<void> {
  console.log(`check:coi ${base}`);
  const { chromium, webkit } = await import('@playwright/test');
  for (const [name, type] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const browser = await type.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(base, { waitUntil: 'load' });
      const first = await page.evaluate(() => self.crossOriginIsolated);
      expect(first === true, `${name}: crossOriginIsolated on first load`, `got ${String(first)}`);

      const registered = await page
        .evaluate(async () => {
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<null>((r) => setTimeout(() => r(null), 20_000)),
          ]);
          return reg !== null;
        })
        .catch(() => false);
      expect(registered, `${name}: service worker active`, 'navigator.serviceWorker.ready did not resolve');
      if (!registered) continue;

      await page
        .waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 10_000 })
        .catch(() => undefined);
      await page.reload({ waitUntil: 'load' });
      const state = await page.evaluate(() => ({
        isolated: self.crossOriginIsolated,
        controlled: navigator.serviceWorker.controller !== null,
        workerStart: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.workerStart ?? 0,
      }));
      expect(state.controlled, `${name}: service worker controls the reloaded page`, 'controller is null');
      expect(state.isolated === true, `${name}: crossOriginIsolated after the service-worker reload`, `got ${String(state.isolated)}`);
      console.log(`        ${name}: navigation workerStart=${state.workerStart.toFixed(1)} ms`);
    } finally {
      await browser.close();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// bundle and icons (apps/web/dist)

function distDir(value: string | undefined): string {
  const dir = path.resolve(repoRoot, value ?? 'apps/web/dist');
  if (!existsSync(dir)) {
    console.error(`dist not found: ${dir}; run pnpm build`);
    process.exit(2);
  }
  return dir;
}

/** Identifiers of the engine QA harness (M04d, AC-9). */
export const QA_HARNESS_IDS = ['CanonicalRunner', 'BotDriver', 'registerBot'] as const;
/** The QA network shaper (M02f1): its error messages carry this marker; production chunks hold none, a QA build holds it. */
export const NET_SHAPER_IDS = ['dv-net-shaper'] as const;
/** The story autoplayer and the headless missions scenario (M05a2, AC-11): strings in their messages, absent from production chunks. */
export const STORY_QA_IDS = ['story.autoplayer', "suite 'missions'"] as const;

function checkBundle(dist: string, forbidQa: boolean, moduleIdsFile?: string): void {
  console.log(`check:bundle ${path.relative(repoRoot, dist)}`);
  const files = listFiles(dist);
  expect(files.length <= ASSET_COUNT_LIMIT, `file count ${files.length} <= ${ASSET_COUNT_LIMIT}`, 'too many static assets');
  const sizes = files.map((f) => ({ f, size: statSync(f).size }));
  const over = sizes.filter((s) => s.size > ASSET_FILE_LIMIT_BYTES);
  expect(over.length === 0, 'every file <= 25 MiB', over.map((o) => path.relative(dist, o.f)).join(', '));

  const swPath = path.join(dist, 'sw.js');
  expect(existsSync(swPath), 'sw.js exists', 'missing dist/sw.js');
  if (existsSync(swPath)) {
    const sw = readFileSync(swPath, 'utf8');
    const urls = [...sw.matchAll(/["']?url["']?\s*:\s*"([^"]+)"/g)].map((m) => m[1]!).filter((u) => !u.startsWith('http'));
    expect(urls.length > 0, 'sw.js has precache entries', 'no precache entries found');
    const tooBig = urls.filter((u) => {
      const file = path.join(dist, u.replace(/^\//, ''));
      return existsSync(file) && statSync(file).size > PRECACHE_LIMIT_BYTES;
    });
    expect(tooBig.length === 0, `no precache entry over 6 MiB (${urls.length} entries)`, tooBig.join(', '));
    // M01e: packs never go through the service worker or the Cache API (D-16); the QA mirror stays out of the precache.
    const mirrored = urls.filter((u) => /(^|\/)media-local\//.test(u));
    expect(mirrored.length === 0, 'media-local is not in the precache', mirrored.join(', '));
  }

  // M04b1 (AC-13): the shell chunk (state machine, registry, kit, i18n and Preact) stays at 120 KiB gzip or less, and every page is a lazy chunk.
  const shellChunks = files.filter((f) => /\/assets\/shell-[^/]+\.js$/.test(f));
  const pageChunks = files.filter((f) => /\/assets\/page-[^/]+\.js$/.test(f));
  // A dist without any built script (the stub of the third_party test) has no shell to measure.
  if (files.some((f) => /\/assets\/[^/]+\.js$/.test(f))) {
    expect(shellChunks.length === 1, 'one shell chunk', `found ${shellChunks.length}`);
    for (const f of shellChunks) {
      const gz = gzipSync(readFileSync(f)).length;
      expect(gz <= SHELL_GZIP_LIMIT_BYTES, `shell chunk <= 120 KiB gzip (${(gz / 1024).toFixed(1)} KiB)`, path.relative(dist, f));
    }
    expect(pageChunks.length >= 4, `pages are separate lazy chunks (${pageChunks.length})`, 'fewer than 4 page chunks');
  }

  const js = files.filter((f) => f.endsWith('.js'));
  const hasBridge = js.some((f) => readFileSync(f, 'utf8').includes('__dvBridge'));
  const hasIwer = js.some((f) => readFileSync(f, 'utf8').includes('installRuntime'));
  console.log(`        build kind: ${hasBridge ? 'qa' : 'production'}`);
  // M04d: the QA harness (CanonicalRunner, BotDriver, registerBot) is in QA builds only. The names are minified away as identifiers,
  // so the harness carries them in its error messages; a production chunk must hold none, a QA build must hold them.
  const harness = QA_HARNESS_IDS.filter((id) => js.some((f) => readFileSync(f, 'utf8').includes(id)));
  if (hasBridge) expect(harness.length === QA_HARNESS_IDS.length, 'the QA build contains the QA harness', `missing: ${QA_HARNESS_IDS.filter((id) => !harness.includes(id)).join(', ')}`);
  else expect(harness.length === 0, 'production chunks contain no CanonicalRunner, BotDriver or registerBot', `found: ${harness.join(', ')}`);
  const shaper = NET_SHAPER_IDS.filter((id) => js.some((f) => readFileSync(f, 'utf8').includes(id)));
  if (hasBridge) expect(shaper.length === NET_SHAPER_IDS.length, 'the QA build contains the QA network shaper', `missing: ${NET_SHAPER_IDS.filter((id) => !shaper.includes(id)).join(', ')}`);
  else expect(shaper.length === 0, 'production chunks contain no QA network shaper', `found: ${shaper.join(', ')}`);
  if (!hasBridge) {
    const story = STORY_QA_IDS.filter((id) => js.some((f) => readFileSync(f, 'utf8').includes(id)));
    expect(story.length === 0, 'production chunks contain no story autoplayer or missions scenario', `found: ${story.join(', ')}`);
    expect(!existsSync(path.join(dist, 'qa', 'mission-preview.html')), 'production build has no mission preview page', 'dist/qa/mission-preview.html exists');
  }
  if (forbidQa) {
    expect(!hasBridge, 'production build has no __dvBridge', 'QA bridge found in a production build');
    expect(!hasIwer, 'production build has no IWER emulator', 'IWER found in a production build');
  }
  // M06a3: the Anthropic SDK runs in the Worker only; no build of the client, QA or production, may carry it (an Anthropic key is check:secrets').
  const hasSdk = js.some((f) => readFileSync(f, 'utf8').includes('@anthropic-ai/sdk'));
  expect(!hasSdk, 'no @anthropic-ai/sdk in the client bundle', 'the Anthropic SDK was found in a client chunk');
  // M00f: nothing under third_party/ may be bundled (DL-618). The build writes the module-id list.
  const bad = checkModuleIds(repoRoot, moduleIdsFile ? path.resolve(repoRoot, moduleIdsFile) : undefined);
  expect(bad.length === 0, 'no bundled module under third_party/', bad.join('; '));
  const total = sizes.reduce((n, s) => n + s.size, 0);
  console.log(`        ${files.length} files, ${(total / 1024).toFixed(0)} KiB`);
}

/** The Workers static-asset limits alone, with a message that names the limit (the Preview workflow's step, BD-PW-01). */
function checkLimits(dist: string): void {
  console.log(`check:limits ${path.relative(repoRoot, dist)}`);
  const stats = assetStats(dist);
  const largest = stats.largest ? `${stats.largest.file} ${(stats.largest.bytes / MIB).toFixed(2)} MiB` : 'n/a';
  console.log(`        ${stats.files.length} files (limit ${ASSET_COUNT_LIMIT}), ${(stats.totalBytes / MIB).toFixed(1)} MiB, largest ${largest} (limit ${ASSET_FILE_LIMIT_BYTES / MIB} MiB)`);
  const bad = assetLimitFailures(stats);
  for (const m of bad) fail('Workers static-asset limits', m);
  if (bad.length === 0) ok('within the Workers static-asset limits');
}

function checkIcons(dist: string): void {
  console.log(`check:icons ${path.relative(repoRoot, dist)}`);
  const manifestPath = path.join(dist, 'manifest.webmanifest');
  expect(existsSync(manifestPath), 'manifest.webmanifest exists', 'missing');
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { icons?: Array<{ src: string; sizes: string; purpose?: string }> };
  const icons = manifest.icons ?? [];
  for (const icon of icons) expect(existsSync(path.join(dist, icon.src.replace(/^\//, ''))), `icon ${icon.src} exists`, 'file missing');
  expect(icons.some((i) => i.purpose === 'maskable'), 'a maskable icon is declared', 'no maskable icon');
  expect(icons.some((i) => i.sizes === '512x512'), 'a 512x512 icon is declared', 'no 512x512 icon');
  expect(icons.some((i) => i.sizes === '192x192'), 'a 192x192 icon is declared', 'no 192x192 icon');
  expect(existsSync(path.join(dist, 'icons/apple-touch-icon-180x180.png')), 'apple touch icon exists', 'missing');
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const [mode, ...rest] = args();
  if (mode !== 'headers' && mode !== 'coi' && mode !== 'bundle' && mode !== 'icons' && mode !== 'limits') {
    console.error('usage: check-dist.ts <headers|coi|bundle|icons|limits> [url | --serve <url> | --from <file> | --dist <dir> | --forbid-qa]');
    process.exit(2);
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      serve: { type: 'string' },
      from: { type: 'string' },
      dist: { type: 'string' },
      'forbid-qa': { type: 'boolean' },
      'module-ids': { type: 'string' },
    },
  });
  const m: Mode = mode;

  if (m === 'bundle') checkBundle(distDir(values.dist), values['forbid-qa'] === true, values['module-ids']);
  else if (m === 'icons') checkIcons(distDir(values.dist));
  else if (m === 'limits') checkLimits(distDir(values.dist));
  else {
    const run = m === 'headers' ? checkHeaders : checkCoi;
    if (values.from !== undefined) {
      const file = path.resolve(repoRoot, values.from);
      if (!existsSync(file)) {
        console.log(`SKIP check:${m}: ${values.from} absent`);
        return;
      }
      await run(readFileSync(file, 'utf8').trim());
    } else if (values.serve !== undefined) {
      const url = values.serve;
      await withServer(url, () => run(url));
    } else if (positionals[0] !== undefined) {
      await run(positionals[0]);
    } else {
      console.error(`check:${m} needs <url>, --serve <url> or --from <file>`);
      process.exit(2);
    }
  }

  if (failures.length > 0) {
    console.error(`check:${m} failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check:${m} passed`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});

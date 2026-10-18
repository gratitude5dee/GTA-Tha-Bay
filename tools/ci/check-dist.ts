/**
 * Checks on a served build or on apps/web/dist.
 *
 *   tsx tools/ci/check-dist.ts headers <url> | --serve <url> | --from <file>
 *   tsx tools/ci/check-dist.ts coi     <url> | --serve <url> | --from <file>
 *   tsx tools/ci/check-dist.ts bundle  [--dist <dir>] [--forbid-qa]
 *   tsx tools/ci/check-dist.ts icons   [--dist <dir>]
 *
 * --serve <url>  runs the Playwright webServer command (or reuses a server already listening on that
 *                port), waits for the port, checks, then stops what it started.
 * --from <file>  reads the URL from the file; prints SKIP and exits 0 when the file does not exist.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { args, repoRoot } from './run.ts';

const MIB = 1024 * 1024;
const PRECACHE_LIMIT_BYTES = 6 * MIB; // matches maximumFileSizeToCacheInBytes in apps/web/vite.config.ts
const ASSET_FILE_LIMIT_BYTES = 25 * MIB; // Workers static assets, per file [F-018]
const ASSET_COUNT_LIMIT = 20_000; // Free plan limit, enforced for both plans

type Mode = 'headers' | 'coi' | 'bundle' | 'icons';

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

async function webServerCommand(): Promise<{ command: string; timeout: number }> {
  const mod = (await import(path.join(repoRoot, 'playwright.config.ts'))) as {
    default: { webServer?: { command: string; timeout?: number } | Array<{ command: string; timeout?: number }> };
  };
  const ws = mod.default.webServer;
  const first = Array.isArray(ws) ? ws[0] : ws;
  if (!first) throw new Error('playwright.config.ts has no webServer');
  return { command: first.command, timeout: first.timeout ?? 120_000 };
}

async function withServer<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const u = new URL(url);
  if (await isListening(u)) {
    console.log(`reusing the server already listening on ${u.host}`);
    return fn();
  }
  const { command, timeout } = await webServerCommand();
  console.log(`starting: ${command}`);
  const child = spawn('sh', ['-c', command], { cwd: repoRoot, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
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

  if (hashed) {
    const res = await get(base, hashed);
    const cc = res.headers.get('cache-control');
    expect(cc === 'public, max-age=31556952, immutable', `${hashed} Cache-Control immutable`, `got ${cc ?? 'absent'}`);
  }

  const sw = await get(base, '/sw.js');
  const swCc = sw.headers.get('cache-control') ?? '';
  expect(!/immutable/.test(swCc), '/sw.js is not immutable', `got ${swCc}`);

  const account = await get(base, '/account/');
  expect(account.headers.get('cross-origin-embedder-policy') === null, '/account/ has no COEP', `got ${account.headers.get('cross-origin-embedder-policy') ?? ''}`);
  expect(account.headers.get('cross-origin-opener-policy') === null, '/account/ has no COOP', `got ${account.headers.get('cross-origin-opener-policy') ?? ''}`);
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

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function distDir(value: string | undefined): string {
  const dir = path.resolve(repoRoot, value ?? 'apps/web/dist');
  if (!existsSync(dir)) {
    console.error(`dist not found: ${dir}; run pnpm build`);
    process.exit(2);
  }
  return dir;
}

function checkBundle(dist: string, forbidQa: boolean): void {
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
  }

  const js = files.filter((f) => f.endsWith('.js'));
  const hasBridge = js.some((f) => readFileSync(f, 'utf8').includes('__dvBridge'));
  const hasIwer = js.some((f) => readFileSync(f, 'utf8').includes('installRuntime'));
  console.log(`        build kind: ${hasBridge ? 'qa' : 'production'}`);
  if (forbidQa) {
    expect(!hasBridge, 'production build has no __dvBridge', 'QA bridge found in a production build');
    expect(!hasIwer, 'production build has no IWER emulator', 'IWER found in a production build');
  }
  const total = sizes.reduce((n, s) => n + s.size, 0);
  console.log(`        ${files.length} files, ${(total / 1024).toFixed(0)} KiB`);
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
  if (mode !== 'headers' && mode !== 'coi' && mode !== 'bundle' && mode !== 'icons') {
    console.error('usage: check-dist.ts <headers|coi|bundle|icons> [url | --serve <url> | --from <file> | --dist <dir> | --forbid-qa]');
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
    },
  });
  const m: Mode = mode;

  if (m === 'bundle') checkBundle(distDir(values.dist), values['forbid-qa'] === true);
  else if (m === 'icons') checkIcons(distDir(values.dist));
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

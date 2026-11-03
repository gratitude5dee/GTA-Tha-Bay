// TEMPORARY profiling spec (M10d4 main-thread repair); never committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { SMALL_VIEWPORT } from './engine-helpers.ts';
import type { W } from './markings-helpers.ts';

const CONFIGS = (process.env.KIT_CONFIGS ?? 'desktop:1,desktop:0').split(',');
const REPEAT = Number(process.env.KIT_REPEAT ?? 1);
const LABEL = process.env.KIT_LABEL ?? 'x';
const SECS = Number(process.env.KIT_SECS ?? 60);
const CROWD = process.env.KIT_CROWD !== '0';

for (let rep = 0; rep < REPEAT; rep++) for (const cfg of CONFIGS) {
const [TIER, ART] = cfg.split(':') as [string, string];
test(`kit profile ${cfg} #${rep} @kit-profile`, async ({ page, browserName }, info) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __prof: { lt: [number, number][]; gaps: [number, number][]; reveal?: number; lastFrame?: number } };
    w.__prof = { lt: [], gaps: [] };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__prof.lt.push([e.startTime, e.duration]);
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // WebKit: no long tasks
    }
    // GL calls that can block the main thread: links, compiles, status queries, uploads (calls over 2 ms, and every link)
    const glog: [string, number, number][] = [];
    (w.__prof as unknown as { gl: typeof glog }).gl = glog;
    for (const proto of [WebGL2RenderingContext.prototype as unknown as Record<string, unknown>]) {
      for (const name of ['linkProgram', 'getProgramParameter', 'getShaderParameter', 'compileShader', 'texImage2D', 'texSubImage2D', 'texStorage2D', 'generateMipmap', 'bufferData', 'bufferSubData', 'readPixels', 'clientWaitSync', 'getError', 'useProgram', 'getUniformBlockIndex', 'getActiveUniform', 'getAttribLocation', 'getUniformLocation']) {
        const orig = proto[name] as ((...a: unknown[]) => unknown) | undefined;
        if (typeof orig !== 'function') continue;
        proto[name] = function (this: unknown, ...a: unknown[]): unknown {
          const t = performance.now();
          try {
            return orig.apply(this, a);
          } finally {
            const d = performance.now() - t;
            if (d > 2 || name === 'linkProgram') glog.push([name, t, d]);
          }
        };
      }
    }
    const loop = (t: number): void => {
      const p = w.__prof;
      if (p.lastFrame !== undefined && t - p.lastFrame > 50) p.gaps.push([p.lastFrame, t - p.lastFrame]);
      p.lastFrame = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    new MutationObserver(() => {
      if (document.documentElement.dataset['dvWorld'] === 'revealed' && w.__prof.reveal === undefined) w.__prof.reveal = performance.now();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-dv-world'] });
  });
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?play=sandbox&tier=${TIER}&debug=1${ART === '0' ? '&art=0' : ''}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  const trace = process.env.KIT_TRACE === '1' && browserName === 'chromium';
  const traceFile = `/tmp/m10d4mt-prof/trace-${LABEL}-${TIER}-art${ART}-${Date.now()}.json`;
  if (trace) {
    await page.context().browser()!.startTracing(page, {
      path: traceFile,
      categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8.execute', 'disabled-by-default-v8.cpu_profiler', 'gpu', 'toplevel'],
    });
  }
  const t0 = Date.now();
  let crowdDone = !CROWD;
  let readyAt: number | null = null;
  const end = t0 + SECS * 1000;
  let readyWall: number | null = null;
  while (Date.now() < end || (ART !== '0' && process.env.KIT_UNTIL_READY === '1' && (readyWall === null || Date.now() < readyWall + 15_000) && Date.now() < t0 + 300_000)) {
    if (!crowdDone) {
      const st = (await page.evaluate(() => (window as unknown as W).__dvBridge.world.call('state'))) as { topology?: boolean } | null;
      if (st?.topology) {
        const r = (await page.evaluate(() => (window as unknown as W).__dvBridge.world.call('crowd', { n: 12 }))) as { placed: number } | null;
        if ((r?.placed ?? 0) > 3) crowdDone = true;
      }
    }
    if (readyAt === null) {
      const s = await page.evaluate(() => ((window as unknown as W).__dvBridge.world.peds() as unknown as { art?: { state: string } } | null)?.art?.state);
      if (s === 'ready' || s === 'failed') {
        readyAt = await page.evaluate(() => performance.now());
        readyWall = Date.now();
      }
    }
    await page.waitForTimeout(1000);
  }
  if (trace) await page.context().browser()!.stopTracing();
  const out = await page.evaluate(() => {
    const w = window as unknown as { __prof: { lt: [number, number][]; gaps: [number, number][]; reveal?: number } };
    const m = performance.getEntriesByType('measure').filter((e) => e.name.startsWith('dv-')).map((e) => [e.name, e.startTime, e.duration] as const);
    const peds = (window as unknown as W).__dvBridge.world.peds() as unknown as { near: number; far: number; art?: { state: string } } | null;
    return { lt: w.__prof.lt, gaps: w.__prof.gaps, reveal: w.__prof.reveal, gl: (w.__prof as unknown as { gl: unknown }).gl, measures: m, now: performance.now(), peds: peds ? { near: peds.near, far: peds.far, state: peds.art?.state } : null };
  });
  const dir = `/tmp/m10d4mt-prof`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${LABEL}-${browserName}-${TIER}-art${ART}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify({ tier: TIER, art: ART, browser: browserName, project: info.project.name, crowd: CROWD, readyAt, ...out }));
  console.log(`profile written: ${file}`);
});
}

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { expect, test, type Page } from '@playwright/test';
import { CLIENT_TELEMETRY_NAMES, type PerfReport, type TelemetryBatch } from '../../packages/shared/src/index.ts';

interface Bridge {
  backend(): string | null;
  tier(): string;
  depthPolicy(): string;
  signals(): { userAgent: string };
  memory(): { gpuMB: number };
  perf: {
    run(id: string, o?: { durationS?: number; warmupS?: number }): Promise<PerfReport>;
    report(): PerfReport | null;
    info(): { meterTrianglesMax: number; infoTrianglesMax: number; meterRenderObjectsMax: number; frames: number } | null;
  };
}

async function waitForPlatform(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __dvBridge?: { platform?: unknown } }).__dvBridge?.platform !== undefined, undefined, { timeout: 90_000 });
}

const bridge = <T>(page: Page, fn: (b: Bridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.platform)`) as Promise<T>;

test.describe('renderer host @renderer-host', () => {
  test('?tier=desktop picks the tier and the backend; ?gl=1 forces WebGL2 on the WebGPU project @renderer-host', async ({ page }, testInfo) => {
    // On the DV_WORLD build the bridge appears after the world boot (BD-M02b1-14): about 35 s of software GL at the desktop tier.
    test.setTimeout(120_000);
    const webgpuProject = testInfo.project.name === 'chromium-webgpu';
    await page.goto(webgpuProject ? '/?gl=1&tier=desktop' : '/?tier=desktop');
    await waitForPlatform(page);
    expect(await bridge(page, (b) => b.backend())).toBe('webgl2');
    expect(await bridge(page, (b) => b.tier())).toBe('desktop');
    expect(['reversed', 'standard']).toContain(await bridge(page, (b) => b.depthPolicy()));
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  });

  test('chromium-webgpu without ?gl=1 reports its real backend (webgpu with DV_EXPECT_WEBGPU=1)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgpu', 'WebGPU is only attempted on the SwiftShader WebGPU project');
    await page.goto('/?tier=desktop');
    await waitForPlatform(page);
    const backend = await bridge(page, (b) => b.backend());
    expect(['webgpu', 'webgl2']).toContain(backend);
    if (process.env.DV_EXPECT_WEBGPU === '1') expect(backend).toBe('webgpu');
  });

  test('boots to a working tier without ?tier= (the benchmark picks one) and persists the decision', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForPlatform(page);
    const tier = await bridge(page, (b) => b.tier());
    expect(['desktop-ultra', 'desktop', 'mobile', 'mobile-low']).toContain(tier);
    const stored = await page.evaluate(
      () =>
        new Promise<{ tier?: string; source?: string; v?: number } | null>((resolve) => {
          const req = indexedDB.open('dv-platform');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('tier-decision')) return resolve(null);
            const get = db.transaction('tier-decision', 'readonly').objectStore('tier-decision').get('current');
            get.onsuccess = () => resolve((get.result as { tier?: string; source?: string; v?: number } | undefined) ?? null);
            get.onerror = () => resolve(null);
          };
          req.onerror = () => resolve(null);
        }),
    );
    expect(stored?.v).toBe(1);
    expect(stored?.tier).toBe(tier);
    expect(stored?.source).toBe('auto-benchmark');
  });
});

test.describe('perf meter @perf-meter', () => {
  test('graybox-walk: the meter agrees with renderer.info within 10 % and the report validates @perf-meter', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'AC-6 runs on chromium-webgl2');
    test.setTimeout(180_000);
    await page.goto('/?tier=desktop&perf=1');
    await waitForPlatform(page);
    await expect(page.locator('#dv-perf-hud')).toBeVisible();

    const report = await page.evaluate(`window.__dvBridge.platform.perf.run('graybox-walk', { durationS: 10 })`) as PerfReport;
    expect(report.scenario.id).toBe('graybox-walk');
    expect(report.scenario.durationS).toBe(10);
    expect(report.scenario.seed).toBe(0xc0ffee);
    expect(report.tier).toBe('desktop');
    expect(report.backend).toBe('webgl2');
    expect(report.frames.count).toBeGreaterThan(0);

    const info = (await bridge(page, (b) => b.perf.info())) as NonNullable<ReturnType<Bridge['perf']['info']>>;
    console.log(`perf-meter: frames=${info.frames} meterTris=${info.meterTrianglesMax} infoTris=${info.infoTrianglesMax} objects=${info.meterRenderObjectsMax}`);
    expect(info.infoTrianglesMax).toBeGreaterThan(0);
    expect(info.meterTrianglesMax).toBeGreaterThan(0);
    const ratio = info.meterTrianglesMax / info.infoTrianglesMax;
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    expect(ratio).toBeLessThanOrEqual(1.1);
    expect(report.counts.trianglesMax).toBe(info.meterTrianglesMax);
    expect(report.counts.renderObjectsMax).toBeGreaterThan(0);
    expect(report.counts.renderObjectsMax).toBeLessThanOrEqual(600);
    expect(report.counts.gpuDrawCmdsMax).not.toBeNull();

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync('tools/ci/schemas/perf-report.v1.json', 'utf8')));
    const ok = validate(report);
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
    expect(await bridge(page, (b) => b.perf.report())).toEqual(report);
  });

  test('the HUD Export button downloads perf.json and notes.json', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'runs once, on chromium-webgl2');
    test.setTimeout(120_000);
    await page.goto('/?tier=mobile-low&perf=1');
    await waitForPlatform(page);
    await page.evaluate(`window.__dvBridge.platform.perf.run('graybox-walk', { durationS: 3, warmupS: 1 })`);
    const downloads: Array<{ name: string; text: string }> = [];
    page.on('download', (d) => {
      void d.createReadStream().then(async (stream) => {
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c as Buffer);
        downloads.push({ name: d.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    await page.locator('#dv-perf-export').click();
    await expect.poll(() => downloads.map((d) => d.name).sort(), { timeout: 20_000 }).toEqual(['notes.json', 'perf.json']);
    const notes = JSON.parse(downloads.find((d) => d.name === 'notes.json')?.text ?? '{}') as { userAgent: string; signals: { userAgent: string }; tier: string; estimate: unknown };
    expect(notes.userAgent).toContain('Mozilla');
    expect(notes.signals.userAgent).toBe(notes.userAgent);
    expect(notes.tier).toBe('mobile-low');
    // M01e AC-11: the device run records what open() returned and whether the fixture packs are present.
    const packStore = (notes as { packStore?: { store: string; has: Record<string, boolean> } }).packStore;
    expect(packStore?.store).toBe('opfs');
    expect(Object.keys(packStore?.has ?? {}).sort()).toEqual(['world_pack/l0-64-64', 'world_pack/p0-64-64']);
    const perf = JSON.parse(downloads.find((d) => d.name === 'perf.json')?.text ?? '{}') as PerfReport;
    expect(perf.v).toBe(1);
  });
});

test.describe('telemetry @telemetry', () => {
  async function capture(page: Page): Promise<{ batches: TelemetryBatch[]; bodies: string[] }> {
    const batches: TelemetryBatch[] = [];
    const bodies: string[] = [];
    const seen = new Set<string>();
    const take = (body: string): void => {
      if (seen.has(body)) return;
      seen.add(body);
      bodies.push(body);
      try {
        batches.push(JSON.parse(body) as TelemetryBatch);
      } catch {
        // Not JSON: the assertions below fail on the empty batch list.
      }
    };
    // Two vantage points, deduplicated by body: Chromium reports `sendBeacon` posts only to route handlers, WebKit gives
    // `keepalive` fetches only to the request event. The Worker answers 204 either way (telemetry never fails the client).
    await page.route('**/api/v1/t', async (route) => {
      take(route.request().postData() ?? '');
      await route.fulfill({ status: 204 });
    });
    page.on('request', (req) => {
      if (req.url().endsWith('/api/v1/t') && req.method() === 'POST') take(req.postData() ?? '');
    });
    return { batches, bodies };
  }

  test('the first batch holds app.start, tier.decision and app.ready with registry names only @telemetry', async ({ page }) => {
    test.setTimeout(120_000);
    const { batches, bodies } = await capture(page);
    await page.goto('/');
    await waitForPlatform(page);
    await expect.poll(() => batches.length, { timeout: 30_000 }).toBeGreaterThan(0);

    const first = batches[0] as TelemetryBatch;
    const names = first.events.map((e) => e.name);
    expect(names.slice(0, 3)).toEqual(['app.start', 'tier.decision', 'app.ready']);
    const start = first.events[0]!;
    expect(Object.keys(start.props).sort()).toEqual(['backend', 'coi', 'nav', 'store', 'tier']);
    expect(start.props['coi']).toBe(true);
    // M01e: app.start waits for the asset worker's open(). WebKit's ephemeral Playwright context has no OPFS (see pack-store.spec.ts).
    expect(start.props['store']).toBe(test.info().project.name === 'webkit-webgl2' ? 'memory' : 'opfs');
    expect(['webgpu', 'webgl2']).toContain(start.props['backend']);
    expect(first.events[2]!.props['phaseWorldMs']).toBe(0);
    expect(first.env.deviceClass).toBe('desktop');
    expect(['webgpu', 'webgl2']).toContain(first.env.backend);
    for (const b of batches) {
      for (const e of b.events) {
        expect((CLIENT_TELEMETRY_NAMES as readonly string[]).includes(e.name), e.name).toBe(true);
        expect(Object.keys(e.props).length).toBeLessThanOrEqual(16);
      }
    }
    const ua = await page.evaluate(() => navigator.userAgent);
    for (const body of bodies) {
      expect(body).not.toContain(ua);
      expect(body).not.toMatch(/Mozilla|AppleWebKit|userAgent/);
    }
  });

  test('a stale running heartbeat becomes app.abnormal_exit in the next boot batch @telemetry', async ({ context, page }) => {
    test.setTimeout(120_000);
    // The record a killed page leaves behind, seeded before the app runs. A normal reload closes the heartbeat first.
    await context.addInitScript(() => {
      if (location.search.includes('seedhb=1')) {
        localStorage.setItem(
          'dv.hb',
          JSON.stringify({ v: 1, sid: 'seeded-session', t: Date.now() - 20_000, state: 'running', scene: 'world', mode: 'story', chunkKey: null, tier: 'mobile', backend: 'webgl2', memEstMB: 120, gpuEstMB: 80, build: 'old', ring: [] }),
        );
      }
    });
    const { batches } = await capture(page);
    await page.goto('/?tier=mobile-low&seedhb=1');
    await waitForPlatform(page);
    await expect.poll(() => batches.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const exit = batches.flatMap((b) => b.events).find((e) => e.name === 'app.abnormal_exit');
    expect(exit?.props).toMatchObject({ prevSid: 'seeded-session', scene: 'world', mode: 'story', memEstMB: 120, gpuEstMB: 80 });
    expect(typeof exit?.props['lastBeatAgoMs']).toBe('number');
  });

  test('hiding the page flushes with sendBeacon and writes the hidden heartbeat @telemetry', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'visibility is simulated through the CDP-free event path on Chromium');
    test.setTimeout(120_000);
    const { batches } = await capture(page);
    await page.goto('/?tier=mobile-low');
    await waitForPlatform(page);
    await expect.poll(() => batches.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('dv.hb') ?? '{}') as { state?: string }).state)).toBe('hidden');
    await expect.poll(() => batches.flatMap((b) => b.events).some((e) => e.name === 'app.hidden'), { timeout: 15_000 }).toBe(true);
  });
});

// BD-FIX-CI-01 (A-10, R-ROLL-01): `POST /api/v1/t` is geo-gated. When boot answers region 'blocked' the offline single-player page
// still boots and never calls it, so a blocked player sees no 451 in the console. The boot answer is rewritten here, so the
// runner's location does not matter.
test.describe('telemetry in a blocked region @telemetry', () => {
  test('boot region blocked: the page boots and sends no telemetry, not even the hidden beacon @telemetry', async ({ page, browserName }) => {
    test.setTimeout(120_000);
    const posts: string[] = [];
    await page.route('**/api/v1/boot', async (route) => {
      const res = await route.fetch();
      const body = { ...((await res.json()) as Record<string, unknown>), region: 'blocked' };
      await route.fulfill({ response: res, json: body });
    });
    await page.route('**/api/v1/t', async (route) => {
      posts.push(route.request().postData() ?? '');
      await route.fulfill({ status: 204 });
    });
    page.on('request', (req) => {
      if (req.url().endsWith('/api/v1/t') && req.method() === 'POST') posts.push(req.postData() ?? '');
    });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/?tier=mobile-low');
    await waitForPlatform(page);
    // app.start, tier.decision and app.ready are queued at boot and flushed 200 ms later on an open region.
    await page.waitForTimeout(3_000);
    if (browserName === 'chromium') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('dv.hb') ?? '{}') as { state?: string }).state)).toBe('hidden');
      await page.waitForTimeout(1_000);
    }
    expect(posts).toEqual([]);
    expect(errors.filter((e) => /\b451\b/.test(e))).toEqual([]);
  });
});

test.describe('memory bomb @membomb', () => {
  test('writes the running total before each 64 MB step and shows it after a relaunch @membomb', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the bomb allocates real memory; one engine is enough in CI');
    test.setTimeout(60_000);
    await page.goto('/qa/memory-bomb.html');
    await expect(page.getByTestId('out')).toContainText('last stored total: none');
    await page.locator('#start').click();
    await expect.poll(() => page.evaluate(() => Number(localStorage.getItem('dv.membomb') ?? '0')), { timeout: 20_000 }).toBeGreaterThanOrEqual(128);
    await page.locator('#stop').click();
    const stored = await page.evaluate(() => Number(localStorage.getItem('dv.membomb')));
    expect(stored % 64).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('dv.membomb.phase'))).toBe('arraybuffer');
    // A relaunch (reload) shows the last stored total and the heartbeat state.
    await page.reload();
    await expect(page.getByTestId('out')).toContainText(`last stored total: ${stored} MB`);
    await expect(page.getByTestId('out')).toContainText('heartbeat:');
  });
});

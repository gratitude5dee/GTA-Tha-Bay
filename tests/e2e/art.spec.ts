import { expect, test, type Page } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';

/**
 * M10d2 city surfaces in a real browser, on a `DV_WORLD=synth` QA build (AC-7).
 *
 *  - @art-skyline  `?tier=mobile-low`: the skyline cards come from the KTX2 asset `texture/far-bay-cards` (the rasterised atlas of
 *                  bake S11), and the facade atlas `texture/facade-atlas` is neither drawn nor requested. The `?tier=mobile` case
 *                  that binds the atlas's `mobile` variant belongs to M02h7 (its AC-11), which merges after this row (DL-740).
 *  - @art-ultra    `?tier=desktop-ultra&gl=1&atmosphere=1`: with `world.atmosphere` on under WebGL2 the takram adapter falls back
 *                  to the M02e sky with no console error, and the facade atlas of the desktop tiers loads. The one line left out is
 *                  the browser's 503 for the play-token route, which the secret-less e2e Worker gives by design (`errorsOf`).
 *
 * One software-rendered world per test (CI capacity, BD-FIX-CI-TEXGOLD-01); every wait is on the condition the assertion needs.
 */
type W = { __dvBridge: { world: WorldBridge } };

const TINY = { width: 256, height: 144 } as const;

/**
 * Route 5 (`POST /api/v1/id/play-token`, packages/identity/src/play-token-client.ts `PLAY_TOKEN_PATH`). The e2e Worker runs without
 * `PLAY_TOKEN_HMAC` (BD-FIX-CI8-H02, BD-FIX-SEC-02), so the route answers 503 `upstream_unavailable` and the client plays offline.
 */
const PLAY_TOKEN_PATH = '/api/v1/id/play-token';

/**
 * The browser's own line for that 503, matched on the message's location (the resource URL) and the status (BD-FIX-WEBGPU-FACADE-01).
 * Whether the page asks for a play token at all depends on the boot order, not on the sky or the atlas: the first schedule step of a
 * hero writes a `block_boundary` intent, and the page's intent driver (apps/web/src/npc-agency.ts, a lazy chunk) asks the identity for a
 * token only when it subscribed before that intent was published. On chromium-webgpu in CI runs 41800361763 and 41812786532 it had,
 * and the `@art-ultra` case failed on this line alone while its atlas had loaded. Every other failed load and every script error counts.
 */
function isPlayTokenUnavailable(text: string, url: string): boolean {
  if (!text.startsWith('Failed to load resource: the server responded with a status of 503')) return false;
  try {
    return new URL(url).pathname === PLAY_TOKEN_PATH;
  } catch {
    return false;
  }
}

/** Console errors and page errors of the page, collected from before the first navigation (less the line above). */
function errorsOf(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !isPlayTokenUnavailable(m.text(), m.location().url)) out.push(m.text());
  });
  page.on('pageerror', (e) => out.push(e.message));
  return out;
}

/** Every request URL the page and its workers make. */
function requestsOf(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => out.push(r.url()));
  return out;
}

async function bootWorld(page: Page, tier: QualityTierId, query = ''): Promise<void> {
  await page.setViewportSize(TINY);
  await page.goto(`/?tier=${tier}&debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
}

test.describe('art city surfaces @art-skyline', () => {
  test.describe.configure({ timeout: 600_000 });
  test('mobile-low: the skyline cards come from the KTX2 atlas and the facade atlas is never requested @art-skyline', async ({ page }) => {
    const errors = errorsOf(page);
    const requests = requestsOf(page);
    await bootWorld(page, 'mobile-low');
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.backdrop().cardsAtlas !== null, undefined, { timeout: 240_000, polling: 250 });
    const backdrop = await page.evaluate(() => (window as unknown as W).__dvBridge.world.backdrop());
    // `format` is read from the bytes the store delivered (the KTX 2.0 identifier), so the cards are the rasterised KTX2 asset
    expect(backdrop.cardsAtlas).toEqual({ asset: 'texture/far-bay-cards', format: 'ktx2' });
    expect(backdrop.cardsKm).toBe(10);
    expect(backdrop.renderObjects).toBe(1);
    // the facade atlas belongs to the desktop tiers: the view reports it off and nothing asked for it
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.art() !== null, undefined, { timeout: 240_000, polling: 250 });
    const art = await page.evaluate(() => (window as unknown as W).__dvBridge.world.art());
    expect(art?.facadeAtlas).toMatchObject({ on: false, variant: null, requested: false, loaded: false });
    expect(requests.filter((u) => u.includes('facade-atlas'))).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('art desktop-ultra @art-ultra', () => {
  test.describe.configure({ timeout: 900_000 });
  test('desktop-ultra on WebGL2 with world.atmosphere on: the sky falls back to the M02e sky with no console error; the facade atlas loads @art-ultra', async ({ page }) => {
    const errors = errorsOf(page);
    await bootWorld(page, 'desktop-ultra', '&gl=1&atmosphere=1');
    await page.waitForFunction(
      () => {
        const s = (window as unknown as W).__dvBridge.world.sky();
        return !!s && s.atmosphere !== null && s.atmosphere.state !== 'idle' && s.atmosphere.state !== 'init';
      },
      undefined,
      { timeout: 240_000, polling: 250 },
    );
    const sky = await page.evaluate(() => (window as unknown as W).__dvBridge.world.sky());
    expect(sky?.atmosphere).toEqual({ state: 'fallback', reason: 'webgl2' });
    // the M02e physical sky is still in the backdrop and visible
    const physical = await page.evaluate(() => {
      const view = (window as unknown as W).__dvBridge.world.internals().view as unknown as { backdrop: { scene: { getObjectByName(n: string): { visible: boolean } | undefined } } };
      const scene = view.backdrop.scene;
      const o = scene.getObjectByName('world.sky.physical');
      return { present: !!o, visible: o?.visible ?? false, takram: !!scene.getObjectByName('world.sky.atmosphere') };
    });
    expect(physical).toEqual({ present: true, visible: true, takram: false });
    // the facade atlas of the desktop tiers is requested and transcoded once the world is revealed
    await page.waitForFunction(
      () => {
        const a = (window as unknown as W).__dvBridge.world.art()?.facadeAtlas;
        return !!a && (a.loaded || a.failed !== null);
      },
      undefined,
      { timeout: 300_000, polling: 500 },
    );
    const art = await page.evaluate(() => (window as unknown as W).__dvBridge.world.art());
    expect(art?.facadeAtlas).toMatchObject({ on: true, asset: 'texture/facade-atlas', variant: 'desktop', requested: true, loaded: true, failed: null });
    expect(errors).toEqual([]);
  });
});

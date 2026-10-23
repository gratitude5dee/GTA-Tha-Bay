import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enuFromLatLng, type TeleportResult } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M02c2 maps in a real browser, on a `DV_WORLD=synth` QA build (everything goes through `__dvBridge.world.map`):
 *
 *  - @world-map          AC-7  the minimap follows the player after teleports to the landmarks of M02c1's list; the banner equals
 *                        `nhoodAt` at 20 seeded points at least 30 m from neighbourhood borders; 50 seeded synth addresses geocode
 *                        within 10 m on the same `cnn`; the phone Map app searches, selects and sets a waypoint
 *  - @world-attribution  AC-8  the boot splash shows the OSM line for 3 s, the full-map corner collapses to "(i)" after 5 s and still
 *                        opens, `/credits.json` and the credits page list every `attribution.world.json` entry and the ODbL notice
 */
type W = { __dvBridge: { world: WorldBridge } };

const ROOT = path.resolve(import.meta.dirname, '../..');
const TEN = [
  'lm.city-hall', 'lm.coit-tower', 'lm.ferry-building', 'lm.pyramid-tower', 'lm.crown-tower',
  'lm.sutro-tower', 'lm.twin-peaks', 'lm.painted-ladies', 'lm.dolores-park', 'lm.haight-ashbury',
] as const;

/** A small seeded stream (mulberry32): the specs draw the same points every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

async function boot(page: Page, url = '/?tier=mobile-low'): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(url);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  await expect
    .poll(async () => {
      const s = (await world(page, (w) => w.call('state'))) as { topology?: boolean } | null;
      return s?.topology === true;
    }, { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toBe(true);
  // the HUD canvas draws and the district grid arrived
  await expect
    .poll(async () => {
      const s = (await world(page, (w) => w.map.state())) as { grid?: boolean; canvas?: boolean } | null;
      return s?.grid === true && s?.canvas === true;
    }, { timeout: 60_000, intervals: [250, 500, 1000] })
    .toBe(true);
}

interface Row { address: string; cnn: string; latitude: string; longitude: string }

function synthRows(): Row[] {
  const file = path.join(ROOT, '.cache/map/raw/synth/ramy-di5m.jsonl');
  if (!existsSync(file)) throw new Error(`${file} is missing: run pnpm map:build -- --area synth first`);
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l) as Row).filter((r) => !r.address.includes('#'));
}

test.describe('maps on the synth world @world-map', () => {
  test.describe.configure({ timeout: 900_000 });

  test('teleports move the minimap player, the banner follows nhoodAt, 50 addresses geocode @world-map', async ({ page }, testInfo) => {
    await boot(page);

    // 1. ten landmarks: the minimap player is where the teleport put it, and the landmark projects onto the player's pixel
    let landed = 0;
    for (const id of TEN) {
      const result = (await page.evaluate((lm) => (window as unknown as W).__dvBridge.world.teleport(lm), id)) as TeleportResult | null;
      expect(result, id).not.toBeNull();
      if (!result!.ok) continue;
      landed++;
      await expect
        .poll(async () => {
          const m = await world(page, (w) => w.map.minimapPlayerPx());
          return m ? Math.hypot(m.x - result!.x, m.z - result!.z) : Infinity;
        }, { message: `${id}: minimap player follows the teleport`, timeout: 30_000, intervals: [200, 400, 800] })
        .toBeLessThanOrEqual(5);
      const r = result!;
      const m = (await page.evaluate(([x, z]) => {
        const map = (window as unknown as W).__dvBridge.world.map;
        return { player: map.minimapPlayerPx(), at: map.minimapProject(x as number, z as number) };
      }, [r.x, r.z])) as { player: { px: number; py: number; mPerPx: number; tilesDrawn: number } | null; at: { px: number; py: number } | null };
      expect(m.player, id).not.toBeNull();
      expect(m.at, id).not.toBeNull();
      // the landmark's projected position is within 5 m of the player's pixel
      const metres = Math.hypot(m.at!.px - m.player!.px, m.at!.py - m.player!.py) * m.player!.mPerPx;
      expect(metres, `${id}: projected ${metres.toFixed(2)} m from the minimap player`).toBeLessThanOrEqual(5);
      console.log(`world-map ${id}: ok, ${metres.toFixed(2)} m, tiles ${m.player!.tilesDrawn}`);
    }
    expect(landed).toBeGreaterThanOrEqual(8);
    // the circle shows the drawing (a screenshot for the report)
    await expect
      .poll(async () => (await world(page, (w) => w.map.minimapPlayerPx()))?.tilesDrawn ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await page.getByTestId('hud-minimap').screenshot({ path: testInfo.outputPath('minimap.png') });

    // 2. the banner equals nhoodAt at 20 seeded points at least 30 m from a border
    const around = (await page.evaluate(() => (window as unknown as W).__dvBridge.world.call('candidates', { kind: 'sandbox' }))) as { x: number; z: number }[];
    const rnd = seeded(0x4d32c2);
    const picked = (await page.evaluate(
      ([cands, seedState]) => {
        const map = (window as unknown as W).__dvBridge.world.map;
        let a = seedState as number;
        const rand = (): number => {
          a = (a + 0x6d2b79f5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const out: { x: number; z: number; slug: string }[] = [];
        const list = cands as { x: number; z: number }[];
        for (let i = 0; i < 4000 && out.length < 60; i++) {
          const c = list[Math.floor(rand() * list.length)]!;
          const x = c.x + (rand() - 0.5) * 900;
          const z = c.z + (rand() - 0.5) * 900;
          const here = map.nhoodAt(x, z);
          if (here.index === 255 || here.slug === null) continue;
          let inside = true;
          for (let k = 0; k < 12 && inside; k++) {
            const ang = (k / 12) * Math.PI * 2;
            if (map.nhoodAt(x + Math.cos(ang) * 30, z + Math.sin(ang) * 30).index !== here.index) inside = false;
          }
          if (inside) out.push({ x, z, slug: here.slug });
        }
        return out;
      },
      [around, Math.floor(rnd() * 4294967296)] as const,
    )) as { x: number; z: number; slug: string }[];
    expect(picked.length, 'seeded points well inside a neighbourhood').toBeGreaterThanOrEqual(20);
    let checked = 0;
    for (const p of picked) {
      if (checked >= 20) break;
      const res = (await page.evaluate((to) => (window as unknown as W).__dvBridge.world.teleport(to), { x: p.x, z: p.z })) as TeleportResult | null;
      if (!res || !res.ok) continue;
      const here = (await page.evaluate(([x, z]) => (window as unknown as W).__dvBridge.world.map.nhoodAt(x as number, z as number), [res.x, res.z])) as { index: number; slug: string | null };
      if (here.slug === null) continue;
      // the banner is held for up to 3 s after the previous one
      await expect
        .poll(async () => (await world(page, (w) => w.map.banner())).last?.slug ?? null, { message: `banner at (${res.x.toFixed(0)}, ${res.z.toFixed(0)})`, timeout: 30_000, intervals: [250, 500, 1000] })
        .toBe(here.slug);
      checked++;
    }
    expect(checked, 'points checked').toBe(20);
    const en = JSON.parse(readFileSync(path.join(ROOT, 'content/ui/i18n/en.json'), 'utf8')) as Record<string, string>;
    const last = (await world(page, (w) => w.map.banner())).last!;
    expect(en[last.key], last.key).toBeTruthy();

    // 3. 50 seeded addresses geocode within 10 m on the same cnn
    const rows = synthRows();
    expect(rows.length).toBeGreaterThan(200);
    const rnd2 = seeded(0x4d32c3);
    const sample: Row[] = [];
    const used = new Set<number>();
    while (sample.length < 50) {
      const i = Math.floor(rnd2() * rows.length);
      if (used.has(i)) continue;
      used.add(i);
      sample.push(rows[i]!);
    }
    let ok = 0;
    for (const r of sample) {
      const hits = (await page.evaluate((text) => (window as unknown as W).__dvBridge.world.map.geocode(text, 8), r.address)) as { label: string; x: number; z: number; kind: string; cnn: number }[];
      const want = enuFromLatLng(Number(r.latitude), Number(r.longitude));
      const hit = hits.find((h) => h.cnn === Number(r.cnn) && Math.hypot(h.x - want.x, h.z - want.z) <= 10);
      expect(hit, `${r.address}: ${JSON.stringify(hits.slice(0, 3))}`).toBeDefined();
      ok++;
    }
    expect(ok).toBe(50);

  });

  test('the phone Map app searches an address, selects the result and sets a waypoint that becomes a GPS route @world-map', async ({ page }, testInfo) => {
    await boot(page);
    // an address 150 to 600 m from where the player stands, so a drivable route exists on the resident graph
    const me = (await observe(page)).player!;
    const near = synthRows()
      .map((r) => ({ r, d: Math.hypot(enuFromLatLng(Number(r.latitude), Number(r.longitude)).x - me.pos[0], enuFromLatLng(Number(r.latitude), Number(r.longitude)).z - me.pos[2]) }))
      .filter((c) => c.d >= 150 && c.d <= 600)
      .sort((a, b) => a.d - b.d || (a.r.address < b.r.address ? -1 : 1));
    expect(near.length, 'synth addresses within 600 m of the player').toBeGreaterThan(0);
    const target = near[Math.floor(near.length / 2)]!.r;
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('btn-pause-phone')).toBeVisible();
    // the QA debug panels (pursuit, mission) float over the bottom of a 480x270 page: presses go to the elements themselves
    const press = (id: string): Promise<void> => page.getByTestId(id).dispatchEvent('click');
    await press('btn-pause-phone');
    await press('row-phone-apps-map');
    await expect(page.getByTestId('map-stage')).toBeVisible();
    await page.getByTestId('map-search').fill(target.address);
    await expect(page.getByTestId('map-result-0')).toBeVisible({ timeout: 30_000 });
    await press('map-result-0');
    await expect(page.getByTestId('map-selected')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('phone-map.png') });
    await press('btn-map-waypoint');
    await expect(page.getByTestId('map-note')).toBeVisible();
    await press('btn-phone-home');
    await press('btn-phone-close');
    await press('btn-pause-resume');
    // the sim resumes, and the GPS route reaches the map layer
    const t0 = (await observe(page)).stats.tick;
    await expect.poll(async () => (await observe(page)).stats.tick, { message: 'the sim runs again', timeout: 30_000 }).toBeGreaterThan(t0 + 30);
    try {
      await expect
        .poll(async () => {
          const patch = await world(page, (w) => w.map());
          return patch !== null && patch.route !== null && patch.route !== undefined;
        }, { message: 'a GPS route after the waypoint', timeout: 60_000, intervals: [500, 1000, 2000] })
        .toBe(true);
    } catch (e) {
      const patch = await world(page, (w) => w.map());
      console.log(`world-map no route: target ${target.address} (${target.latitude}, ${target.longitude}), player ${JSON.stringify((await observe(page)).player?.pos)}, patch ${JSON.stringify(patch)?.slice(0, 600)}`);
      throw e;
    }
    expect((await observe(page)).player).toBeTruthy();
  });
});

test.describe('map attribution and credits @world-attribution', () => {
  test.describe.configure({ timeout: 600_000 });

  test('the splash shows the OSM line for 3 s, the map corner collapses to (i) after 5 s and still opens, the credits list every entry and the ODbL notice @world-attribution', async ({ page }, testInfo) => {
    const file = JSON.parse(readFileSync(path.join(ROOT, 'config/attribution.world.json'), 'utf8')) as { entries: { id: string; text: string }[] };
    const osm = file.entries.find((e) => e.id === 'osm')!;

    // the boot splash and the full-map corner: an in-page observer stamps the moments the splash line appears and goes, and the
    // moments the corner first appears (the map opens, which is what the corner's 5 s count from) and turns to "(i)". The test's own
    // polling would add the delays of a software-rendered world that keeps the main thread busy: every Playwright round trip waits for
    // that thread, so a clock started in Node after the corner's two checks starts about 2 s late (BD-FIX-CI10-M01).
    type Corner = { first?: string; open?: number; collapsed?: number };
    await page.addInitScript(() => {
      const w = window as unknown as { __splash: { on?: number; off?: number }; __corner: Corner };
      w.__splash = {};
      w.__corner = {};
      new MutationObserver(() => {
        const here = document.querySelector('[data-testid="attribution-splash"]') !== null;
        if (here && w.__splash.on === undefined) w.__splash.on = performance.now();
        if (!here && w.__splash.on !== undefined && w.__splash.off === undefined) w.__splash.off = performance.now();
        const corner = document.querySelector('[data-testid="map-attribution"]')?.getAttribute('data-state') ?? undefined;
        if (corner !== undefined && w.__corner.first === undefined) {
          w.__corner.first = corner;
          w.__corner.open = performance.now();
        }
        if (corner === 'collapsed' && w.__corner.open !== undefined && w.__corner.collapsed === undefined) w.__corner.collapsed = performance.now();
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
    });
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?debug=1&tier=mobile-low', { waitUntil: 'commit' });
    const splash = page.getByTestId('attribution-splash');
    await expect(splash).toBeVisible({ timeout: 60_000 });
    await expect(splash).toHaveText(osm.text);
    await expect(splash).toBeHidden({ timeout: 20_000 });
    const stamps = (await page.evaluate(() => (window as unknown as { __splash: { on?: number; off?: number } }).__splash)) as { on?: number; off?: number };
    const shown = (stamps.off ?? 0) - (stamps.on ?? 0);
    expect(shown, `splash visible for 3 s (${shown.toFixed(0)} ms)`).toBeGreaterThanOrEqual(2900);
    expect(shown, `splash visible for 3 s (${shown.toFixed(0)} ms)`).toBeLessThanOrEqual(6000);

    // the full map: expanded at first, "(i)" after 5 s, opens again on a press
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
    await page.keyboard.press('Escape');
    await page.getByTestId('btn-pause-phone').click();
    await page.getByTestId('row-phone-apps-map').click();
    const attrib = page.getByTestId('map-attribution');
    await expect(attrib).toHaveAttribute('data-state', 'expanded');
    await expect(page.getByTestId('map-attribution-text')).toContainText('OpenStreetMap');
    await expect(attrib).toHaveAttribute('data-state', 'collapsed', { timeout: 10_000 });
    const corner = (await page.evaluate(() => (window as unknown as { __corner: Corner }).__corner)) as Corner;
    expect(corner.first, 'the corner opens expanded').toBe('expanded');
    const waited = (corner.collapsed ?? 0) - (corner.open ?? 0);
    testInfo.annotations.push({ type: 'corner-collapse-ms', description: `splash ${shown.toFixed(0)} ms, corner ${waited.toFixed(0)} ms` });
    expect(waited, `corner collapsed after 5 s of the map being open (${waited.toFixed(0)} ms)`).toBeGreaterThanOrEqual(5000);
    expect(waited, `corner collapsed after 5 s of the map being open (${waited.toFixed(0)} ms)`).toBeLessThanOrEqual(10_000);
    await expect(page.getByTestId('map-attribution-text')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('map-collapsed.png') });
    await page.getByTestId('map-attribution-toggle').click();
    await expect(attrib).toHaveAttribute('data-state', 'expanded');
    await expect(page.getByTestId('map-attribution-text')).toContainText('OpenStreetMap');

    // /credits.json and the credits page
    const res = await page.request.get('/credits.json');
    expect(res.ok()).toBe(true);
    const credits = (await res.json()) as { world?: { id: string; text: string }[]; odblNotice?: string };
    expect(credits.world?.map((e) => e.id).sort()).toEqual(file.entries.map((e) => e.id).sort());
    for (const e of file.entries) expect(credits.world?.find((c) => c.id === e.id)?.text, e.id).toBe(e.text);
    expect(credits.odblNotice).toContain('ODbL');

    const fresh = await page.context().newPage();
    await fresh.goto('/menu/credits');
    await expect(fresh.getByTestId('credits')).toBeVisible();
    for (const e of file.entries) await expect(fresh.getByTestId(`credit-${e.id}`), e.id).toContainText(e.text);
    await expect(fresh.getByTestId('odbl-notice')).toContainText('ODbL');
    await fresh.screenshot({ path: testInfo.outputPath('credits.png') });
    await fresh.close();
  });
});

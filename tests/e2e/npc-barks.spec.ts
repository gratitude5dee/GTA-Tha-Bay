import { expect, test, type Page } from '@playwright/test';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import type { AgencyQaBridge } from '../../apps/web/src/qa/npc-agency.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M06c in a real browser, on a `DV_WORLD=synth` QA build, `mobile-low` (so the LOD-A cap is 3 and hero intents are off):
 *
 *  - @npc-barks  the named NPCs live in the city (the panel at the bottom left lists them with their LOD and utility winner), a pedestrian
 *                in front of the player gets a Talk prompt, Talk plays a two-line exchange from the archetype ink as subtitles and
 *                makes no `/api/v1/npc/*` request, a knocked-down pedestrian barks once with a subtitle and then keeps quiet (cooldown),
 *                and a block change moves a roster NPC.
 *
 * To see it by hand: `DV_WORLD=synth VITE_DV_QA=1 pnpm build`, serve it (`pnpm dev` with the flags), open `/?debug=1&tier=mobile-low`, wait for the
 * world and walk up to a pedestrian: Talk (E) plays two lines of subtitles. The panel shows the five roster NPCs near City Hall.
 */
type W = { __dvBridge: { world: WorldBridge; npcAgency: AgencyQaBridge } };

const agency = <T>(page: Page, fn: (a: AgencyQaBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.npcAgency)`) as Promise<T>;

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?debug=1&tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.npcAgency !== undefined, undefined, { timeout: 60_000 });
}

/** The `/api/v1/*` requests this page makes from now on. */
function watchApi(page: Page): { urls: string[] } {
  const urls: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/v1/')) urls.push(u.pathname);
  });
  return { urls };
}

test.describe('NPC agency and barks @npc-barks', () => {
  test.describe.configure({ timeout: 600_000 });

  test('the roster NPCs live near City Hall and the panel lists them @npc-barks', async ({ page }) => {
    await boot(page);
    await expect
      .poll(async () => {
        const d = await agency(page, (a) => a.debug());
        return d === null ? 0 : d.a + d.b + d.c;
      }, { timeout: 60_000, intervals: [500, 1000] })
      .toBe(5);
    const d = (await agency(page, (a) => a.debug()))!;
    // mobile-low allows 3 brains at LOD A
    expect(d.cap).toBe(3);
    expect(d.a).toBeLessThanOrEqual(3);
    expect(d.peakA).toBeLessThanOrEqual(3);
    expect(d.npcs.map((n) => n.id).sort()).toEqual(['canary-mc', 'npc_test', 'ro-batista', 'standin_founder', 'standin_rapper']);
    // the hero intents are off at mobile-low: the sim writes no request
    expect(d.intents).toBe(0);
    await expect(page.getByTestId('npc-agency-panel')).toContainText('NPC agency');
    await expect(page.getByTestId('npc-agency-panel')).toContainText('ro-batista');
  });

  test('Talk on a pedestrian plays a two-line exchange with subtitles and no npc request @npc-barks', async ({ page }) => {
    await boot(page);
    const api = watchApi(page);
    await agency(page, (a) => a.filler(1.4));
    // the Talk prompt of the pedestrian in front of the player
    await expect(page.getByTestId('hud-prompt')).toContainText('Talk', { timeout: 60_000 });
    const before = api.urls.length;
    await page.keyboard.press('KeyE');
    // two subtitles, one after the other: the player's line, then the pedestrian's
    const seen: { speaker?: string; text: string }[] = [];
    const deadline = Date.now() + 30_000;
    while (seen.length < 2 && Date.now() < deadline) {
      const s = await agency(page, (a) => a.subtitle());
      if (s && (seen.length === 0 || seen[seen.length - 1]?.text !== s.text)) seen.push(s);
      await page.waitForTimeout(100);
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]?.speaker).toBe('player');
    expect(seen[1]?.speaker).not.toBe('player');
    expect(seen[0]?.text.length).toBeGreaterThan(3);
    expect(seen[1]?.text.length).toBeGreaterThan(3);
    await expect(page.getByTestId('hud-subtitles')).toBeVisible();
    // no request to the NPC routes, and nothing but the background polls reached the API during the exchange
    const during = api.urls.slice(before);
    expect(during.filter((u) => u.startsWith('/api/v1/npc/'))).toEqual([]);
    expect(during.filter((u) => u !== '/api/v1/roster' && !u.startsWith('/api/v1/telemetry') && u !== '/api/v1/t')).toEqual([]);
    // the exchange ends after its last line's time: one finished knot, and the subtitle is gone
    await expect.poll(async () => (await agency(page, (a) => a.debug()))?.knots ?? 0, { timeout: 20_000, intervals: [250, 500] }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => await agency(page, (a) => a.subtitle()), { timeout: 20_000, intervals: [250, 500] }).toBeNull();
  });

  test('a knocked-down pedestrian barks once with a subtitle, then the cooldown holds @npc-barks', async ({ page }) => {
    await boot(page);
    await agency(page, (a) => a.filler(2.2));
    // let the watcher see the pedestrian standing before it goes down
    await page.waitForTimeout(1500);
    await agency(page, (a) => a.bump());
    await expect.poll(async () => (await agency(page, (a) => a.debug()))?.barks.played ?? 0, { timeout: 30_000, intervals: [250, 500] }).toBe(1);
    const sub = await agency(page, (a) => a.subtitle());
    expect(sub?.text.length ?? 0).toBeGreaterThan(2);
    expect(sub?.speaker).toMatch(/passerby|vendor|founder|rapper|officer/);
    // up again, down again: inside the 20 s cooldown of the entity, so it is dropped, not played
    // (a slow sim, as on the software WebGPU runner, may still have the pedestrian down after 2.6 s, so bump again until a drop shows)
    await page.waitForTimeout(2600);
    await expect
      .poll(
        async () => {
          await agency(page, (a) => a.bump());
          return (await agency(page, (a) => a.debug()))?.barks.dropped ?? 0;
        },
        { timeout: 45_000, intervals: [1500, 2000] },
      )
      .toBeGreaterThanOrEqual(1);
    expect((await agency(page, (a) => a.debug()))?.barks.played).toBe(1);
  });

  test('a block change at 08:00 sends the sleeping hero to work @npc-barks', async ({ page }) => {
    await boot(page);
    const row = async (): Promise<{ block: number; x: number; z: number; lod: string } | undefined> =>
      (await agency(page, (a) => a.debug()))?.npcs.find((n) => n.id === 'ro-batista');
    await expect.poll(async () => (await row()) !== undefined, { timeout: 60_000 }).toBe(true);
    // 07:59 with the clock running: it reaches 08:00 within a few seconds
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.setHour(7.97, false));
    await expect.poll(async () => (await row())?.block, { timeout: 60_000, intervals: [500, 1000] }).toBe(0);
    const asleep = (await row())!;
    await expect.poll(async () => (await row())?.block, { timeout: 90_000, intervals: [500, 1000] }).toBe(1);
    // she walks from the flat to the shop: she is somewhere new a few seconds after the block changed
    await expect
      .poll(async () => {
        const now = await row();
        return now === undefined ? 0 : Math.hypot(now.x - asleep.x, now.z - asleep.z);
      }, { timeout: 60_000, intervals: [1000, 2000] })
      .toBeGreaterThan(2);
  });
});

import { readFileSync } from 'node:fs';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import type { WorldBridge } from '../../../packages/world/src/client/world-bridge.ts';
import { observe } from '../engine-helpers.ts';
import { bootSandbox, closeSandboxPhone as closePhone, fadeIns, jumpEnded, openSandboxTab as openTab } from './sandbox-helpers.ts';

/**
 * M04e2 AC-9 (@sandbox-teleport): the Sandbox app's Go places and Screen tabs on the synth world (the QA play bypass starts the
 * sandbox; this tag runs in the `DV_WORLD=synth` half, so it is not in GRAYBOX_GREP). To see it by hand: a QA build with
 * `DV_WORLD=synth` (`pnpm dev`), open `/?tier=mobile-low`, press Escape, then Phone, then Sandbox, and use the "Go places" and "Screen"
 * tabs: pick a landmark, "Remember this spot", "Back to where I was", and "HUD: on screen" to tuck the HUD away.
 */
/** Web assertions get 30 s instead of 5 s: a loaded CI runner answers one page query in about a second (BD-M04e2-08). */
const expect = baseExpect.configure({ timeout: 30_000 });
type W = { __dvBridge: { world: WorldBridge; engine: { modes: { send(c: object): boolean } } } };
const messages = JSON.parse(readFileSync(new URL('../../../content/ui/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;

const pos = async (page: Page): Promise<{ x: number; y: number; z: number }> => {
  const p = (await observe(page)).player!.pos;
  return { x: p[0], y: p[1], z: p[2] };
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

const refusals: string[] = [];

/** Presses a landmark row and waits for the jump (a fade-in ended) or the refusal toast. Returns true when it landed. */
async function goLandmark(page: Page, id: string): Promise<boolean> {
  const before = await fadeIns(page);
  await expect(page.locator('[data-toast-id="sandbox.teleport"]')).toHaveCount(0, { timeout: 30_000 });
  await openTab(page, 'teleport');
  await page.getByTestId(`row-sandbox-landmarks-${id}`).click();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    if ((await fadeIns(page)) > before) {
      await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 30_000 }).toBe(true);
      return true;
    }
    const refusal = page.locator('[data-toast-id="sandbox.teleport"]');
    if ((await refusal.count()) > 0) {
      refusals.push(`${id}: ${(await refusal.first().innerText()).trim()}`);
      return false;
    }
  }
  throw new Error(`no result for ${id} within 60 s`);
}

/** The first of `ids` that lands (a pick refused `not-loaded` is skipped; the synth world refuses up to 2 of 10). */
async function goFirst(page: Page, ids: string[]): Promise<string> {
  for (const id of ids) if (await goLandmark(page, id)) return id;
  throw new Error(`none of ${ids.join(', ')} landed: ${refusals.join('; ')}`);
}

test.describe('sandbox teleport and display @sandbox-teleport', () => {
  test.describe.configure({ timeout: 900_000 });

  test('Go places jumps, remembers spots, goes back, refuses at heat, and Screen tucks the HUD away @sandbox-teleport', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await bootSandbox(page);
    await expect(page.getByTestId('hud')).toBeVisible();
    const candidates = (await page.evaluate(() => (window as unknown as W).__dvBridge.world.call('candidates', { kind: 'sandbox' }))) as { id: string; x: number; z: number }[];
    const arrival = new Map(candidates.map((c) => [c.id, c]));

    // Landmark: City Hall (then Coit Tower, then the Ferry Building if refused) lands on the ground near its arrival pose.
    const first = await goFirst(page, ['lm.city-hall', 'lm.city-hall', 'lm.coit-tower', 'lm.ferry-building']);
    const landed = await pos(page);
        const q = (await page.evaluate(([x, z]) => (window as unknown as W).__dvBridge.world.call('query', { x, z }), [landed.x, landed.z])) as { groundY: number | null; isWater: boolean };
    expect(q.groundY).not.toBeNull();
    expect(Math.abs(landed.y - (q.groundY as number))).toBeLessThanOrEqual(0.2);
    expect(q.isWater).toBe(false);
    const a = arrival.get(first)!;
    expect(dist(landed, a)).toBeLessThanOrEqual(40.5);

    // Spots: remember this spot, jump to the next landing landmark, then Spot 1 returns to the remembered place.
    await openTab(page, 'teleport');
    await page.getByTestId('btn-sandbox-spot-save').click();
    await expect(page.getByTestId('row-sandbox-spots-pos-1')).toContainText('Spot 1');
    await page.screenshot({ path: testInfo.outputPath('sandbox-teleport.png') });
    await closePhone(page);
    const remembered = landed;
    const others = ['lm.coit-tower', 'lm.ferry-building', 'lm.twin-peaks', 'lm.dolores-park', 'lm.haight-ashbury', 'lm.sutro-tower'].filter((id) => id !== first);
    const beforeSpotJump = await pos(page);
    const second = await goFirst(page, others);
    const secondPose = await pos(page);
    expect(dist(secondPose, remembered)).toBeGreaterThan(5);
    const spotFades = await fadeIns(page);
    await openTab(page, 'teleport');
    await page.getByTestId('row-sandbox-spots-pos-1').click();
    await jumpEnded(page, spotFades);
    await expect.poll(async () => dist(await pos(page), remembered), { timeout: 60_000, intervals: [500, 1000] }).toBeLessThanOrEqual(3);

    // Back: returns to the pose the player stood at before the last successful jump (the second landmark's landing).
    expect(dist(beforeSpotJump, secondPose)).toBeGreaterThan(0);
    await openTab(page, 'teleport');
    await expect(page.getByTestId('btn-sandbox-back')).toBeEnabled();
    const backFades = await fadeIns(page);
    await page.getByTestId('btn-sandbox-back').click();
    await jumpEnded(page, backFades);
    await expect.poll(async () => dist(await pos(page), secondPose), { timeout: 60_000, intervals: [500, 1000] }).toBeLessThanOrEqual(3);
    expect(second).not.toBe(first);

    // Heat: at heat 1 a landmark pick shows the refusal and the player stays put.
    await page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.send({ t: 'sandbox.set', path: 'sandbox.player.heat', v: 1 }));
    const held = await pos(page);
    await openTab(page, 'teleport');
    await page.getByTestId('row-sandbox-landmarks-lm.twin-peaks').click();
    await expect(page.locator('[data-toast-id="sandbox.teleport"]')).toContainText(messages['world.teleport.heat']!);
    await page.waitForTimeout(1_500);
    expect(dist(held, await pos(page))).toBeLessThan(0.05);
    await page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.send({ t: 'sandbox.set', path: 'sandbox.player.heat', v: 0 }));

    // Display: the HUD tucked away hides the corners and the minimap; Escape still opens Pause; turning it back on shows them.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openTab(page, 'display');
    await page.getByTestId('btn-sandbox-hide-hud').click();
    await closePhone(page);
    for (const r of ['tl', 'tr', 'br']) await expect(page.locator(`[data-region="${r}"]`)).toBeHidden();
    for (const r of ['tl', 'tr', 'br', 'bl']) await expect(page.locator(`[data-region="${r}"]`)).toHaveAttribute('data-hidden', 'true');
    await expect(page.getByTestId('hud-minimap')).toBeHidden();
    const durations = await page.evaluate(() => ['tl', 'tr', 'br'].map((r) => getComputedStyle(document.querySelector(`[data-region="${r}"]`)!).transitionDuration));
    expect(durations).toEqual(['0s', '0s', '0s']);
    await page.screenshot({ path: testInfo.outputPath('sandbox-display-hidden.png') });
    // Escape still opens Pause with the HUD tucked away (openTab asserts the Pause page shows).
    await openTab(page, 'display');
    await page.getByTestId('btn-sandbox-hide-hud').click();
    await closePhone(page);
    // On foot `br` (health and vehicle cluster) is empty and so has no box: it must only lose its hidden mark.
    for (const r of ['tl', 'tr']) await expect(page.locator(`[data-region="${r}"]`)).toBeVisible();
    await expect(page.locator('[data-region="br"]')).not.toHaveAttribute('data-hidden', 'true');
    await expect(page.getByTestId('hud-minimap')).toBeVisible();

    // Clean run.
    expect(errors).toEqual([]);
  });
});

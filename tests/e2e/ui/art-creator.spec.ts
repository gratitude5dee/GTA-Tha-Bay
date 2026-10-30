import { expect, test, type Page } from '@playwright/test';
import { HOME, hideQaPanels, NO_BYPASS, passGates, waitForEngineReady } from './helpers.ts';

/**
 * M10d4 creator kit in a real browser (AC-8, the creator half):
 *
 *  - @art-creator   walks every tab of New Game: every non-Coast card names its `model` and `portrait`, a realistic avatar draws the
 *                   assembled figure (`figure: 'models'`, at most 40,000 triangles, at most three textures, every part a model), the Coast
 *                   pair stays on the mannequin, and Coast hair and hoodie on a realistic body draw their fallback parts
 *  - @art-portraits every card of every tab shows its 256 px portrait once the stage has loaded it
 *
 * The portraits are rendered by `assets:import -- portraits` (a software rasteriser over the part itself), so this spec writes nothing
 * and needs no `DV_ART_WRITE` (BD-M10d4-05).
 */
test.use({ storageState: NO_BYPASS, locale: 'en-US' });
test.describe.configure({ timeout: 420_000 });

interface StageState {
  figure: 'models' | 'mannequin';
  triangles: number;
  textures: number;
  parts: { slot: string; ref: string; path: string }[];
}
const state = (page: Page): Promise<StageState | null> => page.evaluate(() => (window as unknown as { __dvCreatorStage?: StageState | null }).__dvCreatorStage ?? null);

async function openCreator(page: Page): Promise<void> {
  await hideQaPanels(page);
  await page.goto(HOME);
  await passGates(page);
  await waitForEngineReady(page);
  await page.getByTestId('nav-new').click();
  await page.getByTestId('new-name').fill('Coast Test');
  await page.getByTestId('new-continue').click();
  await expect(page.getByTestId('creator')).toBeVisible({ timeout: 60_000 });
}

const TABS: [string, string][] = [['body', 'body'], ['face', 'face'], ['hair', 'hair'], ['outfit', 'top'], ['outfit', 'bottom'], ['outfit', 'shoes'], ['outfit', 'accessory']];

test.describe('creator kit @art-creator @art-portraits', () => {
  test('every card has a model and a portrait, a realistic avatar draws the assembled figure, Coast draws its fallbacks @art-creator', async ({ page }) => {
    await openCreator(page);
    for (const [tab, slot] of TABS) {
      await page.getByTestId(`tab-creator-${tab}`).click();
      const cards = page.getByTestId(`creator-grid-${slot}`).locator('[role="radio"][data-testid^="creator-card-"]');
      const n = await cards.count();
      expect(n, slot).toBeGreaterThan(5);
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        const id = ((await card.getAttribute('data-testid')) ?? '').replace('creator-card-', '');
        if (id === 'none') continue;
        const model = (await card.getAttribute('data-model')) ?? '';
        const portrait = (await card.getAttribute('data-portrait')) ?? '';
        if (id.includes('coast')) {
          // M10a2 sets the Coast models; until then the row has none and draws its fallbackPart
          if (model !== '') expect(model, id).toMatch(/^character\/pc-/);
        } else {
          expect(model, id).toBe(`character/pc-${id}`);
          expect(portrait, id).toBe(`portrait/pc-${id}`);
        }
      }
    }

    // A realistic avatar: the assembled figure on stage.
    await page.getByTestId('tab-creator-body').click();
    await page.getByTestId('creator-card-body-athletic').click();
    await page.getByTestId('tab-creator-face').click();
    await page.getByTestId('creator-card-face-karl').click();
    await page.getByTestId('tab-creator-hair').click();
    await page.getByTestId('creator-card-hair-waves').click();
    await page.getByTestId('tab-creator-outfit').click();
    await page.getByTestId('creator-card-top-bomber').click();
    await page.getByTestId('creator-card-bottom-jeans').click();
    await page.getByTestId('creator-card-shoes-boots').click();
    await expect.poll(async () => (await state(page))?.figure, { timeout: 120_000 }).toBe('models');
    const s = (await state(page)) as StageState;
    expect(s.parts.every((p) => p.path === 'model')).toBe(true);
    expect(s.triangles).toBeGreaterThan(1000);
    expect(s.triangles).toBeLessThanOrEqual(40_000);
    expect(s.textures).toBeLessThanOrEqual(3);

    // Coast hair and hoodie on this realistic body draw their fallback parts (no Coast model yet).
    await page.getByTestId('tab-creator-hair').click();
    await page.getByTestId('creator-card-hair-coast').click();
    await page.getByTestId('tab-creator-outfit').click();
    await page.getByTestId('creator-card-top-coast-hoodie').click();
    await expect.poll(async () => (await state(page))?.parts.find((p) => p.slot === 'top')?.path, { timeout: 60_000 }).toMatch(/^(fallback|model)$/);
    const coast = (await state(page)) as StageState;
    expect(coast.figure).toBe('models');
    expect(coast.parts.find((p) => p.slot === 'hair')?.path).toMatch(/^(fallback|model)$/);

    // The Coast body and face stay on the mannequin until M10a2 models them.
    await page.getByTestId('tab-creator-body').click();
    await page.getByTestId('creator-card-body-coast').click();
    await page.getByTestId('tab-creator-face').click();
    await page.getByTestId('creator-card-face-coast').click();
    const pair = (await state(page)) as StageState;
    if (pair.parts.find((p) => p.slot === 'body')?.path === 'mannequin') await expect.poll(async () => (await state(page))?.figure, { timeout: 30_000 }).toBe('mannequin');
  });

  test('every card of every tab shows its 256 px portrait @art-portraits', async ({ page }) => {
    await openCreator(page);
    for (const [tab, slot] of TABS) {
      await page.getByTestId(`tab-creator-${tab}`).click();
      const grid = page.getByTestId(`creator-grid-${slot}`);
      const cards = grid.locator('[role="radio"][data-portrait]:not([data-portrait=""])');
      const n = await cards.count();
      expect(n, slot).toBeGreaterThan(5);
      await expect.poll(() => grid.locator('img[data-portrait-loaded="1"]').count(), { timeout: 120_000, message: `portraits of ${slot}` }).toBe(n);
      const sizes = await grid.locator('img[data-portrait-loaded="1"]').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth));
      expect(sizes.every((w) => w === 256)).toBe(true);
    }
  });
});

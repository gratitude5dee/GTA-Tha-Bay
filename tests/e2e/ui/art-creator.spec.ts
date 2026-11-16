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

interface StagePart {
  slot: string;
  ref: string;
  path: string;
}
interface StageState {
  figure: 'models' | 'mannequin';
  /** True until the stage draws what its latest `show` asked for; `figure`, `triangles` and `textures` describe `parts` once false. */
  pending: boolean;
  triangles: number;
  textures: number;
  parts: StagePart[];
}
const state = (page: Page): Promise<StageState | null> => page.evaluate(() => (window as unknown as { __dvCreatorStage?: StageState | null }).__dvCreatorStage ?? null);
const part = (s: StageState, slot: string): StagePart | undefined => s.parts.find((p) => p.slot === slot);

/**
 * The stage once it has the latest pick and draws it (BD-FIX-CREATOR-SHOES-01). A card press reaches the stage a frame later (the
 * editor calls `show` from an effect), and the figure of the earlier parts stays on stage while the new part loads, so neither the
 * state right after a click nor `figure: 'models'` alone says which avatar is drawn.
 */
async function settled(page: Page, has: (s: StageState) => boolean, timeout = 120_000): Promise<StageState> {
  let last: StageState | null = null;
  await expect
    .poll(async () => {
      last = await state(page);
      return last !== null && !last.pending && has(last);
    }, { timeout, message: 'the creator stage draws the latest pick' })
    .toBe(true);
  return last as unknown as StageState;
}

/** What a Coast card draws: its own model once M10a2 sets one, else its `fallbackPart` (BD-M10d4-08). */
async function coastPart(page: Page, id: string, fallback: string): Promise<{ ref: string; path: string }> {
  const model = (await page.getByTestId(`creator-card-${id}`).getAttribute('data-model')) ?? '';
  return model !== '' ? { ref: model, path: 'model' } : { ref: `character/pc-${fallback}`, path: 'fallback' };
}

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
    const s = await settled(page, (x) => part(x, 'shoes')?.ref === 'character/pc-shoes-boots');
    const picked = ['body-athletic', 'face-karl', 'hair-waves', 'top-bomber', 'bottom-jeans', 'shoes-boots'];
    expect(s.parts).toEqual(picked.map((id) => ({ slot: id.split('-')[0], ref: `character/pc-${id}`, path: 'model' })));
    expect(s.figure).toBe('models');
    expect(s.triangles).toBeGreaterThan(1000);
    expect(s.triangles).toBeLessThanOrEqual(40_000);
    expect(s.textures).toBeLessThanOrEqual(3);

    // Coast hair and hoodie on this realistic body draw their fallback parts (no Coast model yet).
    await page.getByTestId('tab-creator-hair').click();
    const hair = await coastPart(page, 'hair-coast', 'hair-crop');
    await page.getByTestId('creator-card-hair-coast').click();
    await page.getByTestId('tab-creator-outfit').click();
    const top = await coastPart(page, 'top-coast-hoodie', 'top-hoodie');
    await page.getByTestId('creator-card-top-coast-hoodie').click();
    const coast = await settled(page, (x) => part(x, 'top')?.ref === top.ref && part(x, 'hair')?.ref === hair.ref, 60_000);
    expect(part(coast, 'top')).toEqual({ slot: 'top', ...top });
    expect(part(coast, 'hair')).toEqual({ slot: 'hair', ...hair });
    expect(coast.figure).toBe('models');
    expect(coast.triangles).toBeGreaterThan(1000);

    // The Coast body and face stay on the mannequin until M10a2 models them (picking the Coast body picks its face too).
    await page.getByTestId('tab-creator-body').click();
    const coastBody = (await page.getByTestId('creator-card-body-coast').getAttribute('data-model')) ?? '';
    await page.getByTestId('creator-card-body-coast').click();
    await page.getByTestId('tab-creator-face').click();
    await page.getByTestId('creator-card-face-coast').click();
    const pair = await settled(page, (x) => (coastBody === '' ? part(x, 'body')?.path === 'mannequin' : part(x, 'body')?.ref === coastBody), 30_000);
    if (coastBody === '') {
      expect(part(pair, 'body')).toEqual({ slot: 'body', ref: '', path: 'mannequin' });
      expect(part(pair, 'face')?.path).toBe('mannequin');
      expect(pair.figure).toBe('mannequin');
      expect(pair.triangles).toBe(0);
    }
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

import { expect, test, type Page } from '@playwright/test';
import { HOME, hideQaPanels, NO_BYPASS, passGates, waitForEngineReady } from './helpers.ts';

/**
 * M04b2 AC-2 (@creator): New Game names the profile, the creator changes body, hair, outfit and voice, Undo and Redo work, Done saves
 * `CoreSlice.avatar`, and a reload shows the same avatar (deep-equal) with the same AppearanceV1 bytes. A name outside the allowed set
 * is refused inline.
 */
test.use({ storageState: NO_BYPASS, locale: 'en-US' });
test.describe.configure({ timeout: 300_000 });

type Bridge = { engine: { modes: { vm(k: string): unknown } } };
const vm = (page: Page, key: string): Promise<unknown> => page.evaluate((k) => (window as unknown as { __dvBridge: Bridge }).__dvBridge.engine.modes.vm(k), key);

test.describe('creator @creator', () => {
  test('the edited avatar is stored and survives a reload; bad names are refused inline', async ({ page }) => {
    // Every QA-only panel is hidden, as in the other shell specs: a production build has none of them. Hiding only the NPC panel
    // (BD-M06a4-16) left the modes panel (M04a2, right edge) over the creator's voice cards, whose height follows the font: on CI's
    // WebKit the Deep card is 96 px tall and its centre falls on the panel's quit button (BD-FIX-CI6-A03).
    await hideQaPanels(page);
    await page.goto(HOME);
    await passGates(page);
    await waitForEngineReady(page);
    await expect.poll(() => vm(page, 'sys.profile').then((v) => v != null), { timeout: 90_000 }).toBe(true);
    await page.getByTestId('nav-new').click();
    await page.getByTestId('new-name').fill('Dee Test');
    await page.getByTestId('new-continue').click();
    await expect(page.getByTestId('creator')).toBeVisible({ timeout: 30_000 });

    // Body, hair, outfit and voice.
    await page.getByTestId('creator-card-body-broad').click();
    await page.getByTestId('tab-creator-hair').click();
    await page.getByTestId('creator-card-hair-waves').click();
    await page.getByTestId('creator-hair-color-4').click();
    await page.getByTestId('tab-creator-outfit').click();
    await page.getByTestId('creator-card-top-bomber').click();
    await page.getByTestId('creator-card-acc-shades').click();
    await page.getByTestId('tab-creator-voice').click();
    await page.getByTestId('creator-card-voice-deep').click();
    await expect(page.getByTestId('btn-voice-preview')).toHaveAttribute('aria-disabled', 'true');

    // Undo, then Redo.
    await page.getByTestId('btn-creator-undo').click();
    await expect(page.getByTestId('creator-card-voice-deep')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('btn-creator-redo').click();
    await expect(page.getByTestId('creator-card-voice-deep')).toHaveAttribute('aria-checked', 'true');

    // A bad name is refused inline and Done does not leave the creator.
    await page.getByTestId('tab-creator-name').click();
    await page.getByTestId('creator-name').fill('x'.repeat(25));
    await expect(page.getByTestId('creator-name-error')).not.toHaveText('');
    await page.getByTestId('btn-creator-done').click();
    await expect(page.getByTestId('creator')).toBeVisible();
    await page.getByTestId('creator-name').fill('Bad<Name>');
    await expect(page.getByTestId('creator-name-error')).not.toHaveText('');
    await page.getByTestId('creator-name').fill('');
    await expect(page.getByTestId('creator-name-error')).not.toHaveText('');
    await page.getByTestId('creator-name').fill('Dee Test');
    await expect(page.getByTestId('creator-name-error')).toHaveText('');

    await page.getByTestId('btn-creator-done').click();
    await expect(page.getByTestId('new-creator')).toBeVisible();
    await expect.poll(() => vm(page, 'sys.avatar').then((v) => (v as { name?: string } | undefined)?.name), { timeout: 30_000 }).toBe('Dee Test');
    const stored = (await vm(page, 'sys.avatar')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(stored['body'].preset).toBe('body-broad');
    expect(stored['hair']).toEqual({ style: 'hair-waves', color: 4 });
    expect(stored['outfit']).toMatchObject({ top: 'top-bomber', accessory: 'acc-shades' });
    expect(stored['voice'].id).toBe('voice-deep');
    await page.waitForTimeout(2500); // the manual autosave

    await page.reload();
    await waitForEngineReady(page);
    await expect.poll(() => vm(page, 'sys.avatar').then((v) => (v as { name?: string } | undefined)?.name), { timeout: 90_000 }).toBe('Dee Test');
    expect(await vm(page, 'sys.avatar')).toEqual(stored);
  });
});

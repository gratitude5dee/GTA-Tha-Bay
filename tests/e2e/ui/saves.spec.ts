import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { HOME, NO_BYPASS, passGates, waitForEngineReady } from './helpers.ts';

/**
 * M04b1 AC-10 (@ui-saves): two tabs on one profile, and export, import-as-new and undo through the Saves page. The second tab shows the
 * other-tab banner and turns Play and save actions off; the profile list is as before after the export/import/undo round trip.
 */
test.use({ storageState: NO_BYPASS, locale: 'en-US' });
test.describe.configure({ timeout: 240_000 });

test.describe('saves @ui-saves', () => {
  test('export, import as new, undo leave the profile list as it was; a delete asks for the name', async ({ page }) => {
    await page.goto(HOME);
    await passGates(page);
    await waitForEngineReady(page);
    // The sim opens (or makes) the profile once it has booted; wait until the shell knows it.
    await expect.poll(() => page.evaluate(() => (window as unknown as { __dvBridge: { engine: { modes: { vm(k: string): unknown } } } }).__dvBridge.engine.modes.vm('sys.profile') != null), { timeout: 90_000 }).toBe(true);
    await page.getByTestId('nav-profile').click();
    await page.getByTestId('to-saves').click();
    await expect(page.getByTestId('saves')).toBeVisible();
    const cards = page.locator('[data-profile-id]');
    await expect(cards).toHaveCount(1);
    const names = await cards.locator('h2').allInnerTexts();

    // Export the profile to a file.
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-saves-'));
    const download = page.waitForEvent('download');
    await cards.first().locator('[data-testid^="export-"]').click();
    const file = path.join(dir, 'export.dvsave');
    await (await download).saveAs(file);

    // Import it as a new profile.
    await page.getByTestId('import-new').setInputFiles(file);
    await expect(cards).toHaveCount(2);
    const imported = cards.filter({ has: page.locator('[data-testid^="undo-"]') });
    await expect(imported).toHaveCount(1);

    // Undo the import: back to the profiles we started with.
    await imported.locator('[data-testid^="undo-"]').click();
    await expect(cards).toHaveCount(1);
    expect(await cards.locator('h2').allInnerTexts()).toEqual(names);

    // Delete asks for the profile name; the active profile cannot be deleted from here.
    await expect(cards.first().locator('[data-testid^="delete-"]')).toHaveAttribute('aria-disabled', 'true');
  });

  test('a second tab on the same profile shows the other-tab banner and turns Play and save actions off', async ({ page, context }) => {
    await page.goto(HOME);
    await passGates(page);
    await waitForEngineReady(page);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('banner-other-tab')).toHaveCount(0);

    const second = await context.newPage();
    await second.goto(HOME);
    await expect(second.getByTestId('banner-other-tab')).toBeVisible();
    await second.getByTestId('title-start').click();
    await expect(second.getByTestId('main')).toBeVisible();
    await expect(second.getByTestId('nav-continue')).toHaveAttribute('aria-disabled', 'true');
    await expect(second.getByTestId('nav-new')).toHaveAttribute('aria-disabled', 'true');
    await second.getByTestId('nav-profile').click();
    await second.getByTestId('to-saves').click();
    await expect(second.getByTestId('saves')).toBeVisible();
    await expect(second.locator('[data-testid^="rename-"]').first()).toHaveAttribute('aria-disabled', 'true');
    await expect(second.locator('[data-testid^="delete-"]').first()).toHaveAttribute('aria-disabled', 'true');
    // The first tab is unaffected.
    await expect(page.getByTestId('banner-other-tab')).toHaveCount(0);
  });
});

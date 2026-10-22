import { expect, test, type Page } from '@playwright/test';
import { observe } from './engine-helpers.ts';
import { HOME, NO_BYPASS, dobYearsAgo, fillDob, waitForEngineReady } from './ui/helpers.ts';

/**
 * M04b3 (@offline): single-player boots, plays and saves with /api/v1/boot and every identity route unreachable (R-ROLL-01), and the
 * identity is the local one. The specs opt out of M04b1's config-level QA play bypass and load without `?play=`, so the Title, the age
 * gate and the Terms really show (DL-684).
 */
test.use({ storageState: NO_BYPASS });
test.describe.configure({ timeout: 150_000 });

interface IdentityBridge {
  state(): { tier: string; profileId: string; ageBracket: string | null; deviceKeyThumbprint: string } | null;
  authHeader(): Promise<{ Authorization: string } | null>;
}
const identityState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __dvBridge: { identity: IdentityBridge } }).__dvBridge.identity.state());

test.describe('offline boot @offline', () => {
  test('AC-8: with boot and the identity routes aborted, New Game plays and the identity is local', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/\/api\/v1\/(boot|id\/)/, (route) => route.abort());

    await page.goto(HOME);
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('age')).toBeVisible();
    await fillDob(page, dobYearsAgo(30));
    await page.getByTestId('age-continue').click();
    await expect(page.getByTestId('terms')).toBeVisible();
    await page.getByTestId('terms-accept').click();
    await expect(page.getByTestId('main')).toBeVisible();
    await waitForEngineReady(page);

    await page.getByTestId('nav-new').click();
    await page.getByTestId('new-name').fill('Offline');
    await page.getByTestId('new-continue').click();
    await expect(page.getByTestId('new-creator')).toBeVisible();
    const before = (await observe(page)).tick;
    await page.getByTestId('btn-new-start').click();
    await expect.poll(async () => (await observe(page)).tick - before, { timeout: 5_000 }).toBeGreaterThanOrEqual(120);

    const state = await identityState(page);
    expect(state?.tier).toBe('local');
    expect(state?.ageBracket).toBe('18p');
    expect(state?.profileId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // The route is unreachable, so the play token is simply absent: the game keeps playing.
    expect(await page.evaluate(() => (window as unknown as { __dvBridge: { identity: IdentityBridge } }).__dvBridge.identity.authHeader())).toBeNull();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(errors).toEqual([]);

    // The device key and the profile id survive a reload (the real CryptoKey is stored in IndexedDB).
    await page.reload();
    await expect.poll(() => identityState(page).catch(() => null), { timeout: 15_000 }).not.toBeNull();
    const again = await identityState(page);
    expect(again?.profileId).toBe(state?.profileId);
    expect(again?.deviceKeyThumbprint).toBe(state?.deviceKeyThumbprint);
  });

  test('AC-9: the age gate shows and no identity route is called while it does', async ({ page }) => {
    const idRequests: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/v1/id/')) idRequests.push(r.url());
    });
    await page.goto(HOME);
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('age')).toBeVisible();
    await expect(page.getByTestId('age').getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(idRequests).toEqual([]);
  });
});

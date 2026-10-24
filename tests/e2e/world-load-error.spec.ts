import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { observe } from './engine-helpers.ts';
import { NO_BYPASS, passGates, waitForEngineReady } from './ui/helpers.ts';

/**
 * The world-load error (BD-FU-A02, @world-load-error): a deployed catalog pointer that names a manifest the media route does not serve
 * (staging on 2026-10-24: `/asset-catalog.json` names `manifests/assets-d939e9f7….json`, `GET /media/<key>` answers 404 because
 * `pnpm assets:publish -- --env staging` never ran) must not boot an empty world in silence.
 *
 * The page runs the production path of the catalog client: the QA build's same-origin mirror is made absent (its pointer answers
 * 404, as on a production build, which ships no `/media-local/`), so the client reads `/asset-catalog.json` and `hosts.media` from
 * `/api/v1/boot`, and every `/media/manifests/*` request answers 404 with the media route's CORS header. Service workers stay blocked
 * (the suite default), so the routes see the asset worker's requests on WebKit too. No `?world=` flag: the default boot rule runs.
 */
test.use({ storageState: NO_BYPASS });
test.describe.configure({ timeout: 240_000 });

/** Makes the media mirror absent and the catalog named by the pointer missing on the media host; returns how many manifest GETs were seen. */
async function missingManifest(context: BrowserContext): Promise<{ hits(): number; lift(): Promise<void> }> {
  let hits = 0;
  const mirror = '**/media-local/asset-catalog.json';
  const manifest = /\/media\/manifests\/assets-[0-9a-f]{64}\.json$/;
  await context.route(mirror, (route) => route.fulfill({ status: 404, body: '' }));
  await context.route(manifest, (route) => {
    hits++;
    return route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: '' });
  });
  return {
    hits: () => hits,
    lift: async () => {
      await context.unroute(manifest);
      await context.unroute(mirror);
    },
  };
}

/** Main menu → New Game → name → creator (left as it opens) → intro → Start, as a player does (offline-boot.spec.ts). */
async function startNewGame(page: Page, name: string, fromMenu = true): Promise<number> {
  if (fromMenu) await page.getByTestId('nav-new').click();
  await page.getByTestId('new-name').fill(name);
  await page.getByTestId('new-continue').click();
  await expect(page.getByTestId('creator')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('btn-creator-done').click();
  await expect(page.getByTestId('new-creator')).toBeVisible();
  const before = (await observe(page)).tick;
  await page.getByTestId('btn-new-start').click();
  return before;
}

test.describe('world-load error @world-load-error', () => {
  test('a catalog the media host does not serve shows the localized error with Retry instead of an empty world, and Retry recovers once it is served', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const media = await missingManifest(context);

    await page.goto('/');
    await passGates(page);
    await waitForEngineReady(page);
    expect(media.hits()).toBeGreaterThan(0);
    // The menu itself still works: the failure is said when the world is needed.
    await expect(page.getByTestId('error')).toHaveCount(0);

    await startNewGame(page, 'Retry');
    const error = page.getByTestId('error');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('data-kind', 'world-load');
    await expect(page.getByTestId('error-message')).toHaveText('The city could not be loaded, so the game cannot start. Try again in a moment. If it keeps happening, copy the diagnostics and send them with your report.');
    await expect(page.getByTestId('error-code')).toHaveText('Error code: world-load/catalog-404');
    const retry = page.getByTestId('error-retry');
    await expect(retry).toHaveText('Try again');
    // No mode started: the canvas never took the screen and the shell never left the menu for the HUD.
    expect(await page.evaluate(() => document.documentElement.classList.contains('dv-playing'))).toBe(false);
    // A 4xx is not retried by the fetch layer: one manifest request per catalog load.
    expect(media.hits()).toBe(1);

    // Retry reloads the page where the player was (the New Game page's address); with the catalog served again the same player, now
    // a returning one, starts the game one gesture after the Title.
    await media.lift();
    await Promise.all([page.waitForEvent('load'), retry.click()]);
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('new')).toBeVisible();
    await waitForEngineReady(page);
    const before = await startNewGame(page, 'Again', false);
    await expect.poll(async () => (await observe(page)).tick - before, { timeout: 30_000 }).toBeGreaterThanOrEqual(120);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dv-playing')), { timeout: 30_000 }).toBe(true);
    await expect(page.getByTestId('error')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

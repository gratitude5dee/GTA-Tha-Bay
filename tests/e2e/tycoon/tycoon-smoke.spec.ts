import { expect, test, type Page } from '@playwright/test';
import { NO_BYPASS, passGates } from '../ui/helpers.ts';

/**
 * M09a2 AC-12, @tycoon-smoke: in a QA build the Business Tycoon tile is locked until `?unlockAll=1`; with the flag it opens the mode,
 * and the QA panel (`?tycoon=1`) starts a seeded run, steps 20 weeks and resolves a choice event whose effect shows in the panel.
 * A production build shows the tile as `comingSoon` (the descriptor unit test `descriptor.spec.ts` covers that build flavour).
 *
 * To see it by hand (the PR preview is a QA build): open `/?tycoon=1&unlockAll=1`, go to Modes, open Tycoon, press "Start run" with
 * seed 133, then "20 wk". The clock stops at week 5 for a blackout: press "resolve: run_generator" (costs $30k) or "resolve:
 * wait_it_out", then "20 wk" again. Tick "take default choices at the deadline" before "Start run" to see the default taken instead.
 *
 * Seed 133 puts `nat.blackout` (a choice event) in week 4 of a run that only sets the allocation; no other event fires before it.
 */
const SEED = 133;
const HOME_QA = '/?world=walk-drop&tycoon=1';

/** The bridge (and with it the panel) is installed when the engine has booted. */
async function waitForPanel(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { tycoon?: unknown } }).__dvBridge?.tycoon), undefined, { timeout: 150_000 });
  await expect(page.getByTestId('tycoon-qa')).toBeVisible();
}

async function openTycoonPanel(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForPanel(page);
}

const stateText = (page: Page): Promise<string> => page.getByTestId('tycoon-state').innerText();

async function startRun(page: Page, auto: boolean): Promise<void> {
  await page.getByTestId('tycoon-seed').fill(String(SEED));
  if (auto) await page.getByTestId('tycoon-auto').check();
  await page.getByTestId('tycoon-start').click();
  await expect(page.getByTestId('tycoon-state')).toContainText('0 / mvp', { timeout: 60_000 });
  // the week clock runs in real time (20 s a week at 1x): hold it so that only the "N wk" buttons move the run
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
}

test.describe('tycoon smoke @tycoon-smoke', () => {
  test.describe('menu', () => {
    test.use({ storageState: NO_BYPASS, locale: 'en-US' });

    test('without ?unlockAll=1 the tycoon tile is locked, not coming soon @tycoon-smoke', async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto(HOME_QA);
      await passGates(page);
      await page.getByTestId('nav-modes').click();
      const tile = page.locator('[data-screen="modes"] [data-testid$="-tycoon"]');
      await expect(tile).toHaveCount(1, { timeout: 90_000 });
      await expect(tile).toHaveAttribute('aria-disabled', 'true');
      await expect(tile).toContainText(/find this in the story/i);
      await expect(tile).not.toContainText(/coming soon/i);
    });

    test('with ?unlockAll=1 the tile opens the mode and the QA panel plays 20 weeks, resolving a blackout @tycoon-smoke', async ({ page }) => {
      test.setTimeout(300_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${HOME_QA}&unlockAll=1`);
      await passGates(page);
      await page.getByTestId('nav-modes').click();
      const tile = page.locator('[data-screen="modes"] [data-testid$="-tycoon"]');
      await expect(tile).toHaveCount(1, { timeout: 90_000 });
      await expect(tile).not.toHaveAttribute('aria-disabled', 'true');
      await tile.click();
      // The tile starts the mode; the panel then starts a seeded run (the bridge replaces the running entry).
      await waitForPanel(page);
      await startRun(page, false);

      await page.getByTestId('tycoon-step20').click();
      // the clock holds for the blackout in week 5
      await expect(page.getByTestId('tycoon-state')).toContainText('waiting: event', { timeout: 60_000 });
      const held = await stateText(page);
      expect(held).toMatch(/5 \/ mvp/);
      await expect(page.getByTestId('tycoon-inbox-item')).toHaveCount(1);
      await expect(page.getByTestId('tycoon-inbox-item')).toContainText('nat.blackout');
      await expect(page.getByTestId('tycoon-recent')).toContainText('nat.blackout');
      await expect(page.getByTestId('tycoon-flags')).toContainText('officeClosed');
      const cashBefore = cashOf(held);

      await page.getByTestId('tycoon-resolve-run_generator').click();
      await expect(page.getByTestId('tycoon-inbox-item')).toHaveCount(0);
      await expect(page.getByTestId('tycoon-flags')).toHaveCount(0); // the generator cancels the closure
      const afterResolve = cashOf(await stateText(page));
      expect(afterResolve).toBeLessThanOrEqual(cashBefore - 29_000); // the $30k generator was paid

      // the first "20 wk" stopped at week 5; three more fives make exactly week 20
      for (const week of [10, 15, 20]) {
        await page.getByTestId('tycoon-step5').click();
        await expect(page.getByTestId('tycoon-state')).toContainText(`${week} / `, { timeout: 120_000 });
      }
      await expect(page.getByTestId('tycoon-events-fired')).not.toHaveText('0');
      await expect(page.getByTestId('tycoon-recent')).toContainText('nat.blackout');
      expect(errors).toEqual([]);
    });
  });

  test('with default choices on, the same run reaches week 20 without waiting for the blackout @tycoon-smoke', async ({ page }) => {
    test.setTimeout(240_000);
    await openTycoonPanel(page, HOME_QA);
    await startRun(page, true);
    await page.getByTestId('tycoon-step20').click();
    await expect(page.getByTestId('tycoon-state')).toContainText('20 / ', { timeout: 120_000 });
    await expect(page.getByTestId('tycoon-events')).toContainText('defaults at the deadline');
    await expect(page.getByTestId('tycoon-recent')).toContainText('nat.blackout');
    await expect(page.getByTestId('tycoon-inbox-item')).toHaveCount(0);
  });
});

/** The cash row of the state table, in whole dollars. */
function cashOf(text: string): number {
  const m = /cash\s*\$?(-?[\d,]+)/.exec(text.replace(/\n/g, ' ').replace(/\t/g, ' '));
  if (!m) throw new Error(`no cash row in: ${text}`);
  return Number((m[1] as string).replace(/,/g, ''));
}

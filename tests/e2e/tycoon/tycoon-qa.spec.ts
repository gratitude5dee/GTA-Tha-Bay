import { expect, test, type Page } from '@playwright/test';
import { HOME, NO_BYPASS, passGates } from '../ui/helpers.ts';

/**
 * M09a1 AC-12, @tycoon-qa: in a QA build the main menu shows the Business Tycoon tile locked as `comingSoon`, and the QA text panel
 * (`/?tycoon=1`) starts a seeded run in the sim worker and steps weeks.
 *
 * To see it by hand (the PR preview is a QA build): open `/?tycoon=1`, press "Start run", then "Allocation 60/25/15", "Step 5 wk",
 * "Start SAFE raise ($50k)", one "meet ..." button and "Accept". The cap table and the state hash are in the panel.
 */
test.describe('tycoon QA @tycoon-qa', () => {
  test.describe('main menu', () => {
    test.use({ storageState: NO_BYPASS, locale: 'en-US' });
    test('the tycoon tile renders locked as comingSoon @tycoon-qa', async ({ page }) => {
      test.setTimeout(150_000);
      await page.goto(HOME);
      await passGates(page);
      await page.getByTestId('nav-modes').click();
      const screen = page.locator('[data-screen="modes"]');
      await expect(screen).toBeVisible();
      const tile = screen.locator('[data-testid$="-tycoon"]');
      await expect(tile).toHaveCount(1);
      await expect(tile).toHaveAttribute('aria-disabled', 'true');
      await expect(tile).toContainText(/coming soon/i);
    });
  });

  test('the QA panel starts a seeded run, sets the allocation, steps weeks and takes a SAFE @tycoon-qa', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?tycoon=1&world=walk-drop');
    await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { tycoon?: unknown } }).__dvBridge?.tycoon), undefined, { timeout: 150_000 });
    const panel = page.getByTestId('tycoon-qa');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('No run yet');

    await page.getByTestId('tycoon-seed').fill('1');
    await page.getByTestId('tycoon-start').click();
    await expect(page.getByTestId('tycoon-state')).toContainText('0 / mvp', { timeout: 60_000 });
    const hash0 = await hash(page);
    await page.getByTestId('tycoon-alloc').click();
    await page.getByTestId('tycoon-step5').click();
    await expect(page.getByTestId('tycoon-state')).toContainText('5 / mvp', { timeout: 60_000 });
    const hash5 = await hash(page);
    expect(hash5).not.toBe(hash0);
    await expect(page.getByTestId('tycoon-captable')).toContainText('f1');
    await expect(page.getByTestId('tycoon-captable')).toContainText('9,000,000');

    // a $50k SAFE with the scout fund: offer on the table, accept, two weeks to close
    await page.getByTestId('tycoon-raise').click();
    await panel.getByRole('button', { name: 'meet scout-solo' }).click();
    await expect(page.getByTestId('tycoon-accept')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('tycoon-state')).toContainText('waiting: meeting');
    await page.getByTestId('tycoon-accept').click();
    await expect(page.getByTestId('tycoon-accept')).toHaveCount(0);
    await page.getByTestId('tycoon-step1').click();
    await page.getByTestId('tycoon-step1').click();
    await expect(page.getByTestId('tycoon-state')).toContainText('SAFEs / rounds1 / 0', { timeout: 60_000 });

    // the run replays: the pure core gives the same hash from the recorded choices
    const replayed = await page.evaluate(() => {
      const b = (window as unknown as { __dvBridge: { tycoon: { runJson(): string; view(): { hash: string; week: number } | null } } }).__dvBridge.tycoon;
      return { run: JSON.parse(b.runJson()) as { setup: unknown; choices: unknown[]; truncated: boolean }, view: b.view() };
    });
    expect(replayed.run.truncated).toBe(false);
    expect(replayed.run.choices.length).toBeGreaterThan(3);
    const again = await page.evaluate(
      (r) => (window as unknown as { __dvBridge: { tycoon: { runDet(x: unknown): { finalHash: string; endWeek: number }[] } } }).__dvBridge.tycoon.runDet([{ seed: 1, weeks: 7, setup: r.setup, choices: r.choices }]),
      replayed.run,
    );
    // the replay of the whole list stops where the clock stopped: seven weeks done (5 + 2)
    expect(again[0]?.endWeek).toBe(7);
    expect(errors).toEqual([]);
  });
});

async function hash(page: Page): Promise<string> {
  const t = (await page.getByTestId('tycoon-hash').textContent()) ?? '';
  return t.replace('state hash', '').trim();
}

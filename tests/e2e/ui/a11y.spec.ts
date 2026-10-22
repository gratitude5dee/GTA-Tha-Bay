import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { dobYearsAgo, fillDob, HOME, NO_BYPASS, passGates } from './helpers.ts';

/**
 * M04b1 AC-6 (@ui-a11y): axe-core over every flat page of this milestone, zero critical or serious findings. A finding is fixed in the
 * kit, never silenced with a rule. Pages are reached the way a player reaches them.
 */
test.use({ storageState: NO_BYPASS, locale: 'en-US' });
test.describe.configure({ timeout: 240_000 });

async function scan(page: Page, name: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const bad = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(
    bad.map((v) => `${name}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `${name} has no critical or serious axe findings`,
  ).toEqual([]);
}

const SETTINGS = ['graphics', 'controls', 'audio', 'subtitles', 'npc', 'cutscenes', 'accessibility', 'xr', 'camera', 'language', 'privacy', 'install', 'about'];


test.describe('axe @ui-a11y', () => {
  test('gate pages: title, age, terms, blocked', async ({ page }) => {
    await page.goto(HOME);
    await expect(page.getByTestId('title')).toBeVisible();
    await scan(page, 'title');
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('age')).toBeVisible();
    await scan(page, 'age');
    await fillDob(page, dobYearsAgo(30));
    await page.getByTestId('age-continue').click();
    await expect(page.getByTestId('terms')).toBeVisible();
    await scan(page, 'terms');

    const blocked = await page.context().newPage();
    await blocked.goto(HOME);
    await blocked.evaluate(() => localStorage.setItem('dv-ui-ageBlocked', '1'));
    await blocked.reload();
    await expect(blocked.getByTestId('blocked')).toBeVisible();
    await scan(blocked, 'blocked');
  });

  test('menu pages: main, modes, load, new game, profile, saves, credits, legal, coming soon', async ({ page }) => {
    await page.goto(HOME);
    await passGates(page);
    await scan(page, 'main');
    for (const [nav, probe] of [
      ['nav-modes', '[data-screen="modes"]'],
      ['nav-load', '[data-testid="load"]'],
      ['nav-new', '[data-testid="new"]'],
      ['nav-profile', '[data-testid="profile"]'],
      ['nav-garage', '[data-testid="coming-soon"]'],
      ['nav-credits', '[data-testid="credits"]'],
    ] as const) {
      await page.getByTestId(nav).click();
      await expect(page.locator(probe)).toBeVisible();
      await scan(page, nav);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('main')).toBeVisible();
    }
    await page.getByTestId('nav-profile').click();
    await page.getByTestId('to-saves').click();
    await expect(page.getByTestId('saves')).toBeVisible();
    await scan(page, 'saves');
    await page.goto('/legal/terms');
    await expect(page.getByTestId('legal')).toBeVisible();
    await scan(page, 'legal');
  });

  test('every settings category', async ({ page }) => {
    await page.goto(HOME);
    await passGates(page);
    await page.getByTestId('nav-settings').click();
    for (const cat of SETTINGS) {
      await page.getByTestId(`settings-cat-${cat}`).click();
      await expect(page.getByTestId('settings')).toHaveAttribute('data-cat', cat);
      await scan(page, `settings/${cat}`);
    }
  });
});

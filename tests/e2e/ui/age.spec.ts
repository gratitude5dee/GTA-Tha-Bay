import { expect, test } from '@playwright/test';
import { dobYearsAgo, fillDob, NO_BYPASS, watchApi } from './helpers.ts';

/**
 * M04b1 AC-2 (@ui-age): the neutral age screen. Month/day/year in the locale's order, no threshold text, no prefill; 17 years old is
 * blocked for good (no back, no retry, a relaunch is blocked again) with no request to /api/v1/* and no telemetry; exactly 18 passes;
 * an impossible date asks again.
 */
test.use({ storageState: NO_BYPASS, locale: 'en-US' });
test.describe.configure({ timeout: 120_000 });

test.describe('age screen @ui-age', () => {
  test('en-US orders the fields month, day, year with no threshold text and no prefill; 17 is blocked, and a relaunch is blocked again', async ({ page }) => {
    const api = watchApi(page);
    await page.goto('/');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('age')).toBeVisible();

    // Field order by position, no values, autocomplete off.
    const boxes = await Promise.all(['month', 'day', 'year'].map(async (f) => (await page.getByTestId(`age-${f}`).boundingBox())!.x));
    expect(boxes[0]).toBeLessThan(boxes[1]!);
    expect(boxes[1]).toBeLessThan(boxes[2]!);
    for (const f of ['month', 'day', 'year']) {
      const input = page.getByTestId(`age-${f}`);
      await expect(input).toHaveValue('');
      await expect(input).toHaveAttribute('autocomplete', 'off');
    }
    const text = (await page.getByTestId('age').innerText()).toLowerCase();
    expect(text).toContain('before you play');
    expect(text).not.toMatch(/\b1[3-9]\b|\b2[01]\b|years|adult|old enough|age/);

    await fillDob(page, dobYearsAgo(17));
    await page.getByTestId('age-continue').click();
    await expect(page.getByTestId('blocked')).toBeVisible();
    await expect(page.getByTestId('blocked')).toContainText("You can't play right now.");
    // No back or retry control: only links to the public Privacy and Legal pages.
    expect(await page.getByTestId('blocked').locator('button').count()).toBe(0);
    const hrefs = await page.getByTestId('blocked').locator('a').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')));
    expect(hrefs.sort()).toEqual(['/legal/privacy', '/legal/terms']);
    expect(await page.evaluate(() => localStorage.getItem('dv-ui-ageBlocked'))).toBe('1');

    // Relaunch: blocked again, straight away.
    await page.reload();
    await expect(page.getByTestId('blocked')).toBeVisible();
    await expect(page.getByTestId('title')).toHaveCount(0);
    await page.waitForTimeout(1500);
    // Neither session called the Worker API (and so sent no telemetry batch), and the engine never started.
    expect(api.requests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.dataset['dvEngine'] ?? null)).toBeNull();
  });

  test('exactly 18 years ago today passes; one day short is blocked; an impossible date asks again', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('title-start').click();
    await fillDob(page, { month: '2', day: '30', year: '1990' });
    await page.getByTestId('age-continue').click();
    await expect(page.getByTestId('age-error')).toHaveText('Enter a valid date');
    await expect(page.getByTestId('age')).toBeVisible();

    await fillDob(page, dobYearsAgo(18));
    await page.getByTestId('age-continue').click();
    await expect(page.getByTestId('terms')).toBeVisible();
  });

  test('the day before the 18th birthday is blocked', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('title-start').click();
    await fillDob(page, dobYearsAgo(18, 1));
    await page.getByTestId('age-continue').click();
    await expect(page.getByTestId('blocked')).toBeVisible();
  });
});

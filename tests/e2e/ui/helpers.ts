import { expect, type Page } from '@playwright/test';

/**
 * Helpers for the shell specs (M04b1). These specs run without the QA play bypass: they opt out with an empty storage state, so the
 * Title, the age screen, the Terms card and the menus are what the page shows.
 */
export const NO_BYPASS: { cookies: []; origins: [] } = { cookies: [], origins: [] };

/** A date `years` years before today (or the day after a birthday boundary when `dayOffset` is 1), as the three field strings. */
export function dobYearsAgo(years: number, dayOffset = 0): { month: string; day: string; year: string } {
  const now = new Date();
  const d = new Date(now.getFullYear() - years, now.getMonth(), now.getDate() + dayOffset);
  return { month: String(d.getMonth() + 1), day: String(d.getDate()), year: String(d.getFullYear()) };
}

export async function fillDob(page: Page, dob: { month: string; day: string; year: string }): Promise<void> {
  await page.getByTestId('age-month').fill(dob.month);
  await page.getByTestId('age-day').fill(dob.day);
  await page.getByTestId('age-year').fill(dob.year);
}

/** Title, age screen (an adult date), Terms card (toggles untouched), then the main menu. */
export async function passGates(page: Page): Promise<void> {
  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('age')).toBeVisible();
  await fillDob(page, dobYearsAgo(30));
  await page.getByTestId('age-continue').click();
  await expect(page.getByTestId('terms')).toBeVisible();
  await page.getByTestId('terms-accept').click();
  await expect(page.getByTestId('main')).toBeVisible();
}

/** Loads the root page and waits for the engine, which boots once the age screen has passed (or at once for a returning player). */
export async function waitForEngineReady(page: Page): Promise<void> {
  await page.waitForSelector('html[data-dv-engine="ready"]', { state: 'attached', timeout: 120_000 });
}

/** The requests the page makes to the Worker API and the telemetry route. */
export function watchApi(page: Page): { requests: string[] } {
  const seen = { requests: [] as string[] };
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/v1/')) seen.requests.push(`${r.method()} ${url.pathname}`);
  });
  return seen;
}

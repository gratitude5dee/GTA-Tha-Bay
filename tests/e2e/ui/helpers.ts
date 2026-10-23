import { expect, type Page } from '@playwright/test';

/**
 * Helpers for the shell specs (M04b1). These specs run without the QA play bypass: they opt out with an empty storage state, so the
 * Title, the age screen, the Terms card and the menus are what the page shows.
 */
/** The small `walk-drop` scene: the shell specs look at pages, not at the world, and the synth city starves the software renderer. */
export const HOME = '/?world=walk-drop';

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

/**
 * The QA pursuit, modes, mission and NPC panels (M03c, M04a2, M05a1, M06a3) are fixed over the left and right edges of every page in QA
 * builds only (a production build has none), so in a small viewport they cover the menu's buttons. The menu specs that tap or click
 * through the shell hide them (2e756dc, BD-M06a4-16, BD-FIX-CI5-G03, BD-FIX-CI6-A03).
 */
export async function hideQaPanels(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.dv-pursuit, .dv-modes, .dv-mission, .dv-npcdbg { display: none !important }';
      document.head.append(st);
    });
  });
}

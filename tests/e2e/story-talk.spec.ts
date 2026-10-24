import { expect, test, type Page } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M05c1 AC-8 in a real browser, on the QA build without DV_WORLD (the default `civic-graybox` scene; CI runs `@story` in the GRAYBOX_GREP
 * half): `/?mission=m.dev.talk&stage=1&seed=1` starts the dev mission at its talk stage. The panel lists the three outcomes with their
 * labels; `charm` is off with its mood hint and `pay` is off with its cost hint (the wallet is empty); clicking the second outcome, `deal`,
 * sends one `talk.result` with `path: 'scripted'` and the mission jumps to the stage of that outcome.
 */
type W = { __dvBridge: { mission: MissionBridge } };
type State = { phase: string; stage: number; stageId: string | null };
type Ev = { tick: number; t: string; data: { talkId?: string; outcome?: string; path?: string } };

const mission = <T>(page: Page, fn: (m: MissionBridge) => T | Promise<T>): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dvBridge.mission)`) as Promise<T>;
const state = (page: Page): Promise<State | null> => mission(page, (m) => m.state() as unknown as State | null);

async function boot(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?play=story&tier=mobile-low&${query}`);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.mission !== undefined, undefined, { timeout: 60_000 });
  return errors;
}

test.describe('talk panel @story', () => {
  test.describe.configure({ timeout: 180_000 });

  test('lists the outcomes, disables the gated ones with their hints, and a click sends one scripted talk.result and moves the stage @story', async ({ page }) => {
    const errors = await boot(page, 'mission=m.dev.talk&stage=1&seed=1');
    await expect.poll(async () => (await state(page))?.stageId, { timeout: 60_000 }).toBe('ask');

    const panel = page.getByTestId('talk-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('talk-open')).toContainText('What can I do for you');
    await expect(page.getByTestId('talk-choice-charm')).toContainText('Charm them');
    await expect(page.getByTestId('talk-choice-deal')).toContainText('Make a plain deal');
    await expect(page.getByTestId('talk-choice-pay')).toContainText('Pay for it');
    await expect(panel.locator('button.dv-talk-choice')).toHaveCount(3);

    // the gated outcomes are off, each with its hint; the open one is on
    await expect(page.getByTestId('talk-choice-charm')).toBeDisabled();
    await expect(page.getByTestId('talk-hint-charm')).toHaveText('Not in the mood yet');
    await expect(page.getByTestId('talk-choice-pay')).toBeDisabled();
    await expect(page.getByTestId('talk-hint-pay')).toHaveText('Costs $300.00');
    await expect(page.getByTestId('talk-choice-deal')).toBeEnabled();

    // the second outcome: one talk.result, path scripted, and the stage of the outcome
    // the QA debug panels float over the corner of the page and swallow pointer hits there: dispatch the click on the button itself
    await page.getByTestId('talk-choice-deal').dispatchEvent('click');
    await expect.poll(async () => (await state(page))?.stageId, { timeout: 30_000 }).toBe('dealt');
    await expect(panel).toHaveCount(0);
    const talks = (await mission(page, (m) => m.events())) as unknown as Ev[];
    const results = talks.filter((e) => e.t === 'talk');
    expect(results).toHaveLength(1);
    expect(results[0]?.data).toMatchObject({ talkId: 'ask', outcome: 'deal', path: 'scripted' });
    expect(errors).toEqual([]);
  });

  test('the number key picks an open outcome and ignores a gated one @story', async ({ page }) => {
    await boot(page, 'mission=m.dev.talk&stage=1&seed=1');
    await expect(page.getByTestId('talk-panel')).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('1');
    await page.waitForTimeout(500);
    expect((await state(page))?.stageId).toBe('ask');
    await page.keyboard.press('2');
    await expect.poll(async () => (await state(page))?.stageId, { timeout: 30_000 }).toBe('dealt');
  });

  test('the phone Jobs app lists missions 1 to 6; only the open ones can be started @story', async ({ page }) => {
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?play=story&tier=mobile-low');
    await waitForEngine(page);
    await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
    // The Jobs missions are the story mode's view model (`mode.story.jobs`, published as the mode enters, BD-FIX-CI9-W02). The play bypass
    // starts the mode while the HUD is already up, and its sim half loads first; Pause stops the ticks, so the mode must be running
    // before Escape, as it is when a player who walked in opens the phone.
    await expect
      .poll(() => page.evaluate(() => JSON.stringify((window as unknown as { __dvBridge: { engine: { modes: { vm(k: string): unknown } } } }).__dvBridge.engine.modes.vm('sys.mode') ?? null)), { timeout: 60_000 })
      .toContain('{"id":"story","state":"Running"}');
    await page.keyboard.press('Escape');
    await page.getByTestId('btn-pause-phone').click();
    await page.getByTestId('row-phone-apps-jobs').click();
    const list = page.getByTestId('list-phone-missions');
    await expect(list).toBeVisible({ timeout: 30_000 });
    for (const [id, title] of [['m.a1.01', 'Jump Start'], ['m.a1.02', 'Surge Pricing'], ['m.a1.03', 'Sideshow Sunday'], ['m.a1.04', 'Curb Appeal'], ['m.a1.05', 'Turntable Battle'], ['m.a1.06', 'Signal Boost']] as const) {
      await expect(page.getByTestId(`row-phone-missions-mis:${id}`), id).toContainText(title);
    }
    // the first is open; the later ones wait for the one before them
    await expect(page.getByTestId('row-phone-missions-mis:m.a1.01')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('row-phone-missions-mis:m.a1.02')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('row-phone-missions-mis:m.a1.02')).toContainText('Locked');
  });
});

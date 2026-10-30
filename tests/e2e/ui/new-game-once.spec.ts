import { expect, test, type Page } from '@playwright/test';
import { HOME, hideQaPanels, NO_BYPASS, passGates } from './helpers.ts';

/**
 * BD-FIX-NEWGAME-01 (@new-game): one press of Continue on New Game reaches the creator, also when it comes right after the main menu
 * appears, while the engine is still starting behind it. The engine attaches to the shell only once the world is prepared (on staging the
 * baked world downloads first; WebKit takes seconds even on the small scene), and here the sim worker's script is also held back for
 * HOLD_MS so the press lands in that window on Chromium too. Before the fix that press made the profile, lost its `select` (no engine to
 * send it to) and showed "Saving is not available" at once; only a second press opened the creator. The page now shows a busy line and
 * goes on by itself once the game is up. With saving forced to memory only, the notice shows and the same press opens the creator.
 */
test.use({ storageState: NO_BYPASS, locale: 'en-US' });
test.describe.configure({ timeout: 300_000 });

const HOLD_MS = 15_000;

type Bridge = { __dvBridge?: { engine?: { modes: { vm(k: string): unknown } } } };

/** Holds the sim worker's script back, so the engine attaches HOLD_MS later than it would (the window the owner pressed Continue in). */
async function holdEngine(page: Page): Promise<void> {
  await page.route('**/assets/sim.worker-*.js', async (route) => {
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue().catch(() => undefined);
  });
}

/** Every text the save error box showed, even for a moment (a later success would hide it). */
async function watchSaveErrors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __dvSaveErrors: string[] };
    w.__dvSaveErrors = [];
    new MutationObserver(() => {
      const box = document.querySelector('[data-testid="save-error"]');
      const text = box?.textContent ?? null;
      if (text !== null && !w.__dvSaveErrors.includes(text)) w.__dvSaveErrors.push(text);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}

const saveErrors = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __dvSaveErrors: string[] }).__dvSaveErrors);
const openProfile = (page: Page): Promise<unknown> => page.evaluate(() => (window as unknown as Bridge).__dvBridge?.engine?.modes.vm('sys.profile') ?? null);

/** The menu is up and New Game is open with the name typed; nothing waits for the engine. */
async function toNewGame(page: Page, name: string): Promise<void> {
  await page.goto(HOME);
  await passGates(page);
  await page.getByTestId('nav-new').click();
  await page.getByTestId('new-name').fill(name);
}

test.describe('New Game with one press @new-game', () => {
  test('Continue pressed while the engine is still starting reaches the creator, with a busy line meanwhile @new-game', async ({ page }) => {
    await hideQaPanels(page);
    await watchSaveErrors(page);
    await holdEngine(page);
    await page.goto(HOME);
    await passGates(page);
    // The precondition of the bug: the shell has no engine yet, so no open profile (the chip says so).
    await expect(page.getByTestId('chip-profile')).toHaveText('No profile yet');
    await page.getByTestId('nav-new').click();
    await page.getByTestId('new-name').fill('Coast');
    await page.getByTestId('new-continue').click();
    // Busy, not frozen and not blaming storage: the line shows while the page waits for the game.
    await expect(page.getByTestId('new-busy')).toBeVisible();
    await expect(page.getByTestId('new-continue')).toHaveAttribute('aria-busy', 'true');
    expect(await openProfile(page)).toBeNull();
    // The one press goes on by itself once the engine is up.
    await expect(page.getByTestId('creator')).toBeVisible({ timeout: 180_000 });
    expect(await saveErrors(page)).toEqual([]);
    await expect.poll(() => openProfile(page), { timeout: 30_000 }).toMatchObject({ name: 'Coast', hasStory: false });
  });

  test('saving forced to memory only: the notice shows and the same press opens the creator @new-game', async ({ page }) => {
    await hideQaPanels(page);
    await watchSaveErrors(page);
    // The page's SaveService cannot open `dv-saves`, so it runs on the in-memory store (`persistent` false), as with IndexedDB blocked.
    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number): IDBOpenDBRequest {
        if (name === 'dv-saves') throw new DOMException('dv-saves is blocked for this test', 'UnknownError');
        return version === undefined ? open.call(this, name) : open.call(this, name, version);
      };
    });
    await toNewGame(page, 'Coast');
    await page.getByTestId('new-continue').click();
    await expect(page.getByTestId('creator')).toBeVisible({ timeout: 180_000 });
    const notice = page.locator('[data-toast-id="saves.memoryOnly"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Progress is kept in memory only.');
    // The notice is a toast over the creator; the inline error box (which kept the player on the name step) never showed.
    expect(await saveErrors(page)).toEqual([]);
  });
});

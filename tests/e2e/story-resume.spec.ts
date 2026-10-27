import { expect, test, type Page } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import type { EngineBridge } from '../../packages/engine/src/client/debug/bridge.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M05c2 AC-2 (@story-resume; the tag is outside the graybox half of CI, which runs @story only for the dev missions): save and resume of the Act 1 story across a reload, on a `DV_WORLD=synth` QA build (the SF bake itself is not
 * served to the QA page, so the bot runs of `check:missions` are the proof on the real streets; here the page, the save and the
 * unlock registry are the subject).
 *
 *  1. resume mid-mission: a flag is set and m.a1.01 is moved to its checkpoint stage; once the checkpoint save is confirmed the page is
 *     reloaded, and the mission continues at that stage with the same flag and the same wallet.
 *  2. m.a1.03 runs to its raid (the racing hook, played as its stub under `?hooks=stub`) and passes, the page is reloaded and plays on:
 *     `CoreSlice.unlocks` holds `unlock.racing`, the Racing tile is unlocked and `available`, Fighter and Tycoon stay locked, and the
 *     unlock toast showed once (not again after the reload).
 */
test.use({ storageState: { cookies: [], origins: [] } });

type W = { __dvBridge: { engine: EngineBridge; mission: MissionBridge & { autoplay(on: boolean): boolean } } };
type State = { phase: string; mission: string; stage: number; stageId: string | null };

const FLAGS = 'play=story&story=1&tier=mobile-low&hooks=stub';
const vm = (page: Page, key: string): Promise<unknown> => page.evaluate((k) => (window as unknown as W).__dvBridge.engine.modes.vm(k), key);
const state = (page: Page): Promise<State | null> => page.evaluate(() => (window as unknown as W).__dvBridge.mission.state() as unknown as State | null);
const mission = <T>(page: Page, fn: (m: W['__dvBridge']['mission']) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dvBridge.mission)`) as Promise<T>;
const send = (page: Page, name: string, args: Record<string, unknown>): Promise<unknown> =>
  page.evaluate(([n, a]) => (window as unknown as W).__dvBridge.engine.modes.send({ t: 'mode.cmd', mode: 'story', name: n as string, args: a as never } as never), [name, args] as const);

/** Records the id of every toast the page shows, from the first frame. */
async function watchToasts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    const seen = (n: Node): void => {
      if (!(n instanceof HTMLElement)) return;
      for (const el of [n, ...n.querySelectorAll<HTMLElement>('[data-toast-id]')]) {
        const id = el.dataset['toastId'];
        if (id) w.__toasts.push(id);
      }
    };
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(seen))).observe(document, { childList: true, subtree: true });
  });
}
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?${FLAGS}`);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.mission !== undefined && (window as unknown as W).__dvBridge.engine.modes.vm('sys.unlocks') !== undefined, undefined, { timeout: 90_000 });
  return errors;
}

/** The confirmed-save signal: the profile's `lastSave` (C05), read through the QA save bridge. */
const lastSave = (page: Page): Promise<{ reason: string; ok: boolean } | null> =>
  page.evaluate(async () => {
    const s = (await (window as unknown as W).__dvBridge.engine.save.list())[0]?.lastSave;
    return s ? { reason: s.reason, ok: s.ok } : null;
  });

/** The saved `story:auto` slice (the QA save bridge reads the real `dv-saves` database): a flag, the wallet and the active checkpoint. */
const savedSlice = (page: Page): Promise<{ flag: unknown; cash: number | undefined; active: string | null; stage: number | null }> =>
  page.evaluate(async () => {
    const s = (await (window as unknown as W).__dvBridge.engine.save.load()).game.story['auto'];
    const cp = s?.activeMission?.checkpoint.data as { stage?: number } | undefined;
    return { flag: s?.flags['e2e.keep'], cash: s?.wallet.cashCents, active: s?.activeMission?.id ?? null, stage: cp?.stage ?? null };
  });

const cash = async (page: Page): Promise<number | undefined> => ((await vm(page, 'hud.wallet')) as { cashCents?: number } | undefined)?.cashCents;

test.describe('story save and resume @story-resume', () => {
  test.describe.configure({ timeout: 300_000 });

  test('a reload resumes the mission at its last checkpoint with the same flags and wallet @story-resume', async ({ page }) => {
    const errors = await boot(page);
    await expect.poll(async () => (await state(page))?.phase, { timeout: 120_000, intervals: [500] }).toBe('stage');
    expect((await state(page))?.mission).toBe('m.a1.01');

    // a flag and a wallet, then the last stage of the mission: entering it writes the checkpoint and asks for a save
    expect(await mission(page, (m) => m.setFlag('e2e.keep', 7))).toBe(true);
    expect(await mission(page, (m) => m.jump(5))).toBe(true);
    await expect.poll(async () => (await state(page))?.stageId, { timeout: 30_000 }).toBe('tow_home');
    await expect.poll(() => lastSave(page), { timeout: 60_000, intervals: [250, 500, 1000] }).toEqual({ reason: 'checkpoint', ok: true });
    // the mission start wrote a checkpoint save too, so the confirmed save above may be that one: wait for the stage-5 one itself
    await expect.poll(async () => (await savedSlice(page)).stage, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(5);
    const walletBefore = await cash(page);
    const savedBefore = await savedSlice(page);
    expect(savedBefore).toMatchObject({ flag: 7, active: 'm.a1.01', stage: 5 });

    await page.reload();
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.mission !== undefined, undefined, { timeout: 90_000 });
    await expect.poll(async () => (await state(page))?.phase, { timeout: 120_000, intervals: [500] }).toBe('stage');
    const after = await state(page);
    expect(after).toMatchObject({ mission: 'm.a1.01', stageId: 'tow_home', stage: 5 });
    // the flag and the wallet are what the save held: the sim loaded them (the resumed mission has not touched the flag, so only the slice has it)
    expect(await savedSlice(page)).toMatchObject({ flag: 7, cash: savedBefore.cash, active: 'm.a1.01', stage: 5 });
    expect(await cash(page)).toBe(walletBefore);
    expect(errors).toEqual([]);
  });

  test('m.a1.03 passes, a reload plays on: Racing is unlocked and available, Fighter and Tycoon are locked, and the unlock toast showed once @story-resume', async ({ page }) => {
    await watchToasts(page);
    const errors = await boot(page);
    await expect.poll(async () => (await state(page))?.phase, { timeout: 120_000, intervals: [500] }).toBe('stage');
    expect(await mission(page, (m) => m.pass())).toBe(true);
    await expect.poll(async () => (await state(page))?.phase, { timeout: 60_000 }).toBe('passed');

    // the sideshow mission: its raid stage is the racing hook, played as a stub (`?hooks=stub`), which emits `unlock.racing` the first time
    await send(page, 'mission.start', { id: 'm.a1.03' });
    await expect.poll(async () => (await state(page))?.mission, { timeout: 60_000 }).toBe('m.a1.03');
    expect(await mission(page, (m) => m.jump(4))).toBe(true);
    await expect.poll(async () => ((await vm(page, 'sys.unlocks')) as string[]).includes('unlock.racing'), { timeout: 60_000 }).toBe(true);
    expect((await toasts(page)).filter((id) => id === 'unlock:unlock.racing')).toHaveLength(1);

    // The mission is passed through the QA command: the live autoplayer needs the real streets (the SF bake plays m.a1.03 in
    // `check:missions`, AC-1), and the synth city has none of the Yard's roads. The pass path is the product's: rewards, save, jobs.
    expect(await mission(page, (m) => m.pass())).toBe(true);
    await expect.poll(async () => (await state(page))?.phase, { timeout: 60_000, intervals: [500] }).toBe('passed');
    await expect.poll(() => lastSave(page), { timeout: 60_000, intervals: [250, 500, 1000] }).toMatchObject({ ok: true });

    await page.reload();
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.engine.modes.vm('sys.unlocks') !== undefined, undefined, { timeout: 90_000 });
    const unlocks = (await vm(page, 'sys.unlocks')) as string[];
    expect(unlocks).toContain('unlock.racing');
    expect(unlocks).not.toContain('unlock.fighter');
    expect(unlocks).not.toContain('unlock.tycoon');

    // the tiles: the Modes page shows a tile as comingSoon when its mode is (whatever its unlock), unlocked when its unlock is held
    // (`tileState` of packages/ui/src/pages/modes.ts, proven in packages/ui/test/modes-tiles.spec.ts)
    const modes = (await vm(page, 'sys.modes')) as { id: string; unlock: string | null; status: 'available' | 'comingSoon' }[];
    const tile = (id: string) => modes.find((m) => m.id === id);
    expect(tile('racing')?.status).toBe('available');
    expect(tile('racing')?.unlock).toBe('unlock.racing');
    expect(unlocks.includes(tile('racing')?.unlock ?? '')).toBe(true);
    for (const id of ['fighter', 'tycoon']) {
      const t = tile(id);
      expect(t, id).toBeDefined();
      expect(t?.unlock, id).not.toBeNull();
      expect(unlocks.includes(t?.unlock ?? ''), `${id} stays locked`).toBe(false);
    }

    // the toast showed once in the first session and was not shown again by the reload
    expect((await toasts(page)).filter((id) => id === 'unlock:unlock.racing')).toHaveLength(0);
    expect(errors).toEqual([]);
  });
});

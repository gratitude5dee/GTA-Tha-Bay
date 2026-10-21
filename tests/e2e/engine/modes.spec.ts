import { expect, test, type Page } from '@playwright/test';
import type { EngineBridge } from '../../../packages/engine/src/client/debug/bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from '../engine-helpers.ts';

/**
 * M04a2 AC-10 and AC-12 in a real browser, on a QA build without DV_WORLD (the default `civic-graybox` scene; CI runs `@modes` in the
 * GRAYBOX_GREP half): `UiCommand mode.start {id: 'sandbox'}` through the bridge reaches Running without a sim restart and without
 * touching the booted player, `mode.quit` reaches Idle and leaves a `modeExit` save, the queued telemetry carries registry props
 * only, the unlock helper toasts once, and a remapped Jump survives a reload.
 *
 * This spec drives mode.start and mode.quit itself, so it opts out of M04b1's QA play bypass from the start: an empty storage state
 * and `?play=off`. Both are inert until M04b1 lands; afterwards they keep the bypass from starting `sandbox` first.
 */
test.use({ storageState: { cookies: [], origins: [] } });

type W = { __dvBridge: { engine: EngineBridge } };
const modes = <T>(page: Page, fn: (m: EngineBridge['modes']) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.engine.modes)`) as Promise<T>;

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?play=off&tier=mobile-low');
  await waitForEngine(page);
  // the sim publishes its initial view models once the profile is loaded
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.engine.modes.vm('sys.unlocks') !== undefined, undefined, { timeout: 60_000 });
  expect(errors).toEqual([]);
}

const state = (page: Page): Promise<string> => modes(page, (m) => m.mode().state);

test.describe('modes @modes', () => {
  test.describe.configure({ timeout: 180_000 });

  test('sandbox starts on the booted scene, quit leaves a modeExit save, telemetry and the unlock toast are as registered @modes', async ({ page }) => {
    await boot(page);

    // the default QA scene shows the panel
    await expect(page.getByTestId('modes-panel')).toBeVisible();
    await expect(page.getByTestId('modes-state')).toContainText('MODE Idle');

    const listing = (await modes(page, (m) => m.list())) as { modes: { id: string; status: string; order: number; unlocked: boolean }[] };
    expect(listing.modes.map((m) => [m.id, m.status, m.order])).toEqual([
      ['story', 'available', 1], ['racing', 'comingSoon', 2], ['fighter', 'comingSoon', 3], ['tycoon', 'comingSoon', 4], ['sandbox', 'available', 5],
    ]);

    // let the player settle on the ground, then note it
    await expect.poll(async () => (await observe(page)).player?.grounded ?? false, { timeout: 60_000 }).toBe(true);
    const before = await observe(page);
    const restartsBefore = before.restarts;
    const pos0 = before.player?.pos ?? [0, 0, 0];

    // AC-10 / AC-12: mode.start sandbox through the bridge
    expect(await modes(page, (m) => m.start('sandbox'))).toBe(true);
    await expect.poll(() => state(page), { timeout: 30_000 }).toBe('Running');
    await expect(page.getByTestId('modes-state')).toContainText('sandbox:Running');
    const during = await observe(page);
    expect(during.restarts).toBe(restartsBefore);
    const pos1 = during.player?.pos ?? [0, 0, 0];
    expect(Math.hypot(pos1[0] - pos0[0], pos1[2] - pos0[2])).toBeLessThan(0.5);
    const hostState = (await modes(page, (m) => m.state())) as { host: { capability: string; stack: { id: string }[] } };
    expect(hostState.host.stack.map((e) => e.id)).toEqual(['sandbox']);
    expect(hostState.host.capability).toBe('sandbox');

    // a second top-level mode is refused, a comingSoon mode too; the HUD wallet is a view model
    await modes(page, (m) => m.start('story'));
    await modes(page, (m) => m.start('racing'));
    await page.waitForTimeout(300);
    expect(await state(page)).toBe('Running');
    expect(((await modes(page, (m) => m.state())) as { host: { stack: unknown[] } }).host.stack).toHaveLength(1);
    expect(await modes(page, (m) => m.vm('hud.wallet'))).toEqual({ cashCents: 0, streetCred: 0, techClout: 0 });

    // the garage commands raise garage.notYet and change nothing
    await modes(page, (m) => m.send({ t: 'garage.call', vehicleKey: 'veh:test' }));
    await expect.poll(() => modes(page, (m) => m.toasts().map((t) => t.text)), { timeout: 10_000 }).toContain('garage.notYet');

    // the QA unlock helper: one toast, and repeating it does nothing
    const first = (await modes(page, (m) => m.unlock('unlock.racing'))) as { isNew: boolean };
    expect(first.isNew).toBe(true);
    await expect.poll(() => modes(page, (m) => m.toasts().filter((t) => t.kind === 'unlock').length), { timeout: 10_000 }).toBe(1);
    expect(await modes(page, (m) => m.vm('sys.unlocks'))).toEqual(['unlock.racing']);
    const again = (await modes(page, (m) => m.unlock('unlock.racing'))) as { isNew: boolean };
    expect(again.isNew).toBe(false);
    await page.waitForTimeout(300);
    expect(await modes(page, (m) => m.toasts().filter((t) => t.kind === 'unlock').length)).toBe(1);
    await expect(page.getByTestId('modes-unlocks')).toContainText('unlock.racing');

    // mode.quit: Idle, and a modeExit save
    expect(await modes(page, (m) => m.quit())).toBe(true);
    await expect.poll(() => state(page), { timeout: 30_000 }).toBe('Idle');
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const list = await (window as unknown as W).__dvBridge.engine.save.list();
            return list[0]?.lastSave?.reason ?? null;
          }),
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toBe('modeExit');

    // telemetry: queued with registry names and props only
    const tel = await modes(page, (m) => m.telemetry());
    const names = tel.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['mode.enter', 'mode.exit', 'unlock.emit']));
    for (const t of tel) {
      if (t.name === 'mode.enter') expect(Object.keys(t.props)).toEqual(['mode']);
      if (t.name === 'mode.exit') expect(t.props).toEqual({ mode: 'sandbox', reason: 'quit' });
      if (t.name === 'unlock.emit') expect(t.props).toEqual({ id: 'unlock.racing' });
    }
  });

  test('a remapped Jump is saved with the settings and is back after a reload @modes', async ({ page }) => {
    await boot(page);
    const controls = {
      schema: 1, overrides: { kbm: { onFoot: { 'sim.Jump': [{ control: 'key:KeyH' }], 'client.Pause': [] } } }, holdToToggle: [],
      lookSensitivity: { kbm: 1, gamepad: 1, touch: 1 }, invertY: false, deadzones: { stickInner: 0.1, stickOuter: 0.95, trigger: 0.05 },
      touch: { layout: 'default-right', tiltSteer: false, stickRadiusPx: 64, opacity: 0.7 },
    };
    await page.evaluate((c) => (window as unknown as W).__dvBridge.engine.modes.send({ t: 'save.settings', data: { controls: c } }), controls);
    await expect
      .poll(() => modes(page, (m) => (m.vm('sys.controls') as { overrides?: { kbm?: { onFoot?: Record<string, unknown> } } } | undefined)?.overrides?.kbm?.onFoot?.['sim.Jump']), { timeout: 15_000 })
      .toEqual([{ control: 'key:KeyH' }]);
    // the unbind of Pause was dropped
    expect(await modes(page, (m) => (m.vm('sys.controls') as { overrides: { kbm: { onFoot: Record<string, unknown> } } }).overrides.kbm.onFoot['client.Pause'])).toBeUndefined();
    // the write reaches IndexedDB before we reload
    await expect
      .poll(async () => page.evaluate(async () => ((await (window as unknown as W).__dvBridge.engine.save.list())[0]?.lastSave?.reason ?? null)), { timeout: 30_000, intervals: [250, 500, 1000] })
      .toBe('settings');

    await page.reload();
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.engine.modes.vm('sys.controls') !== undefined, undefined, { timeout: 60_000 });
    expect(await modes(page, (m) => (m.vm('sys.controls') as { overrides: { kbm: { onFoot: Record<string, unknown> } } }).overrides.kbm.onFoot['sim.Jump'])).toEqual([{ control: 'key:KeyH' }]);
  });
});

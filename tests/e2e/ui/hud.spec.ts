import { expect, test, type Page } from '@playwright/test';
import { qaStorageState } from '../../support/qa-storage.ts';
import { act, observe, SMALL_VIEWPORT, terrainAt, waitForEngine } from '../engine-helpers.ts';
import { hideQaPanels } from './helpers.ts';

/**
 * M04b2 AC-9 (@ui-hud), AC-7 (@ui-motion) and the HUD half of the demo. Free roam on the gray-box block (the QA play bypass starts the
 * sandbox; CI runs this tag in the GRAYBOX_GREP half, DL-656). The HUD reads the view-model keys and the snapshot side block.
 */
type Bridge = {
  engine: {
    modes: { vm(k: string): unknown; send(c: object): boolean; credit(c: number, key: string): Promise<unknown> };
    spawn(prefab: string, at: [number, number, number], yaw?: number): Promise<{ ok?: boolean } | null>;
    pursuit: { setHeat(l: number): Promise<unknown> };
  };
};
const vm = (page: Page, key: string): Promise<unknown> => page.evaluate((k) => (window as unknown as { __dvBridge: Bridge }).__dvBridge.engine.modes.vm(k), key);
const send = (page: Page, cmd: object): Promise<boolean> => page.evaluate((c) => (window as unknown as { __dvBridge: Bridge }).__dvBridge.engine.modes.send(c), cmd);

test.describe('hud @ui-hud', () => {
  test('wallet, heat and the prompt come from the view model and the snapshot; one prompt element; a missing key renders empty; <= 300 nodes over 60 s @ui-hud', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|manifest|\[Report Only\]/i.test(m.text())) errors.push(m.text());
    });
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?debug=1');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 60_000 }).toBe(true);
    await expect(page.getByTestId('hud')).toBeVisible();

    // The removed engine overlay is gone: neither its classes nor its test ids exist.
    expect(await page.locator('.dv-prompt:not(.dv-prompt-ui), [data-testid="dv-prompt"], [data-testid="dv-speed"]').count()).toBe(0);

    // A missing key renders the widget's empty state without an error.
    await expect(page.getByTestId('hud-clock')).toBeVisible();
    await expect(page.getByTestId('hud-objective')).toHaveCount(0);
    await expect(page.getByTestId('hud-prompt')).toHaveCount(0);
    await expect(page.getByTestId('hud-heat-phase')).toContainText('Clear');

    // Wallet: from `hud.wallet`.
    await page.evaluate(() => (window as unknown as { __dvBridge: Bridge }).__dvBridge.engine.modes.credit(250_000, 'e2e:hud'));
    await expect(page.getByTestId('hud-wallet-value')).toHaveText('$2,500');

    // Heat: from the snapshot side block. The gray-box block has no pursuit director ("no-director"); the stars are then in their empty
    // state, and the synth-world @ui-pause test below drives the same widget with the sandbox heat toggle.
    const heat = (await page.evaluate(() => (window as unknown as { __dvBridge: Bridge }).__dvBridge.engine.pursuit.setHeat(2))) as { ok?: boolean } | null;
    if (heat?.ok) {
      await expect(page.getByTestId('hud-heat')).toHaveAttribute('data-level', '2', { timeout: 30_000 });
      await page.screenshot({ path: testInfo.outputPath('hud-heat.png') });
      await page.evaluate(() => (window as unknown as { __dvBridge: Bridge }).__dvBridge.engine.pursuit.setHeat(0));
    } else {
      await expect(page.getByTestId('hud-heat')).toHaveAttribute('data-level', '0');
    }

    // Prompt: a sedan 2 m from the player offers "Get in"; exactly one prompt element exists while it is live.
    const p = (await observe(page)).player!.pos;
    const at: [number, number, number] = [p[0] + 2, terrainAt(p[0] + 2, p[2]), p[2]];
    const spawned = await page.evaluate((a) => (window as unknown as { __dvBridge: Bridge }).__dvBridge.engine.spawn('vehicle.sedan', a, 0), at);
    expect(spawned?.ok, JSON.stringify(spawned)).toBe(true);
    await expect.poll(async () => (await observe(page)).prompt?.kind, { timeout: 30_000 }).toBe(1);
    await expect(page.getByTestId('hud-prompt')).toHaveCount(1);
    await expect(page.getByTestId('hud-prompt-text')).toHaveText('Get in');
    await expect(page.getByTestId('hud-prompt-glyph')).toHaveText('F');
    expect(await page.locator('.dv-prompt').count()).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('hud-prompt.png') });
    expect((await vm(page, 'hud.prompt')) as { key?: string }).toMatchObject({ key: 'interact.enterVehicle' });

    void act;

    // 60 s of HUD: the node count stays small.
    let max = 0;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      const n = await page.locator('[data-testid="hud"] *').count();
      max = Math.max(max, n);
    }
    console.log(`${testInfo.project.name}: HUD DOM nodes max ${max}`);
    expect(max).toBeLessThanOrEqual(300);
    expect(errors).toEqual([]);
  });

  // BD-FIX-GLYPH-01: staging showed "▯▯▯▯▯" for the heat row and a box in the Clear chip. The app ships no font, so a symbol
  // character falls back to a system font the browser may not have (.notdef), and U+25AF looks like .notdef even where it exists.
  // Every HUD icon slot now holds an inline SVG and no text, and every HUD text node stays inside printable ASCII and Latin-1.
  test('the heat row and the Clear chip draw SVG icons, never symbol glyphs; their names stay as text @ui-hud', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize(SMALL_VIEWPORT);
    await hideQaPanels(page);
    await page.goto('/?debug=1');
    await waitForEngine(page);
    await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
    const heat = page.getByTestId('hud-heat');
    await expect(heat).toHaveAttribute('data-level', '0');

    // Five bars, each an SVG with a painted box and no text.
    const bars = heat.locator('.dv-star');
    await expect(bars).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      const bar = bars.nth(i);
      expect((await bar.textContent())?.trim(), `bar ${i + 1} has no text glyph`).toBe('');
      const svg = bar.locator('svg[data-icon="heat-bar"]');
      await expect(svg).toHaveCount(1);
      const box = await svg.boundingBox();
      expect(box && box.width > 2 && box.height > 8, `bar ${i + 1} box ${JSON.stringify(box)}`).toBe(true);
    }

    // The Clear chip: an SVG shield in the icon slot, and "Clear" as its text (the accessible name of the state).
    const chip = page.getByTestId('hud-heat-phase');
    await expect(chip).toHaveText('Clear');
    const icon = chip.locator('.dv-schip-icon');
    expect((await icon.textContent())?.trim()).toBe('');
    await expect(icon.locator('svg[data-icon="shield"]')).toBeVisible();
    await expect(heat).toHaveAttribute('aria-label', /\S/);

    // No status-chip icon slot carries text (the wallet's ASCII "$" is a character of every font), and no HUD text node uses a
    // character outside the fonts every target browser ships.
    const bad = await page.evaluate(() => {
      const hud = document.querySelector('[data-testid="hud"]');
      const out: string[] = [];
      if (!hud) return ['no hud'];
      for (const el of hud.querySelectorAll('.dv-schip .dv-schip-icon, .dv-star')) if ((el.textContent ?? '').trim() !== '') out.push(`icon text ${JSON.stringify(el.textContent)}`);
      const walk = document.createTreeWalker(hud, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!/^[ -~ -ÿ\s]*$/u.test(n.nodeValue ?? '')) out.push(`text ${JSON.stringify(n.nodeValue)}`);
      return out;
    });
    expect(bad).toEqual([]);
    await heat.screenshot({ path: testInfo.outputPath('hud-heat-glyphs.png') });
  });
});

test.describe('reduced motion @ui-motion', () => {
  test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce', locale: 'en-US' });

  test('a new profile starts with reducedMotion on; no CSS animation or transition runs longer than 150 ms on the menu, settings, creator and Pause @ui-motion', async ({ page }) => {
    test.setTimeout(300_000);
    const { passGates, waitForEngineReady, HOME } = await import('./helpers.ts');
    await page.goto(HOME);
    await passGates(page);
    await waitForEngineReady(page);
    await expect.poll(() => vm(page, 'sys.profile').then((v) => v != null), { timeout: 90_000 }).toBe(true);
    // The first profile takes the OS preference when it is made; a new one made through New Game does the same.
    const longest = async (): Promise<number> =>
      page.evaluate(() => {
        let max = 0;
        const sec = (s: string): number => s.split(',').map((x) => (x.trim().endsWith('ms') ? Number.parseFloat(x) : Number.parseFloat(x) * 1000)).reduce((a, b) => Math.max(a, b || 0), 0);
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.animationName !== 'none') max = Math.max(max, sec(cs.animationDuration) + sec(cs.animationDelay));
          if (cs.transitionProperty !== 'none' && cs.transitionProperty !== 'all') max = Math.max(max, sec(cs.transitionDuration));
          else if (cs.transitionProperty === 'all') max = Math.max(max, sec(cs.transitionDuration));
        }
        return max;
      });
    expect(await longest()).toBeLessThanOrEqual(150);
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    expect(await longest()).toBeLessThanOrEqual(150);
    await page.getByTestId('settings-back').click();
    await page.getByTestId('nav-new').click();
    await page.getByTestId('new-name').fill('Calm Test');
    await page.getByTestId('new-continue').click();
    await expect(page.getByTestId('creator')).toBeVisible({ timeout: 30_000 });
    expect(await longest()).toBeLessThanOrEqual(150);
    // The stored setting is true for the new profile and camera shake is off.
    await expect
      .poll(async () => (await vm(page, 'sys.settings')) as { accessibility?: { reducedMotion?: boolean }; camera?: { shake?: boolean } } | undefined, { timeout: 30_000 })
      .toMatchObject({ accessibility: { reducedMotion: true }, camera: { shake: false } });
    await page.getByTestId('btn-creator-done').click();
    await page.getByTestId('btn-new-start').click();
    await expect(page.getByTestId('hud')).toBeVisible({ timeout: 90_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-resume').or(page.getByTestId('btn-pause-resume'))).toBeVisible();
    expect(await longest()).toBeLessThanOrEqual(150);
  });
});

// ---- the synth-world specs: Pause, Phone and the boundary toast (need `DV_WORLD=synth`: Ride and the county line need the baked world)

type WorldW = { __dvBridge: { world: { boot(): { revealed: boolean }; teleport(p: { x: number; z: number }): Promise<{ ok: boolean; x: number; z: number }>; call(op: string, args?: Record<string, unknown>): Promise<unknown>; boundaryEvents(): number } } };

async function bootSynth(page: Page): Promise<void> {
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<WorldW>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as WorldW).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 120_000 }).toBe(true);
}

test.describe('pause and phone on the synth world @ui-pause', () => {
  test.describe.configure({ timeout: 600_000 });

  test('Pause stops the sim, Save is off away from a safehouse, the phone lists its apps, Ride refuses at heat 1 and Quit confirms @ui-pause', async ({ page }, testInfo) => {
    // The QA pursuit and mission panels are fixed over the left edge above every page (z-index 34 and 35), and the Sandbox app's Player tab
    // (heat buttons) sits there in this 480 x 270 viewport; the menu specs hide them, as hideQaPanels says (BD-M04e1-07).
    await hideQaPanels(page);
    await bootSynth(page);
    await expect(page.getByTestId('hud')).toBeVisible();

    // Pause opens and the sim tick stops.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('btn-pause-resume')).toBeVisible();
    // AC-6 "Pause opens and the sim tick stops", with the mechanism of 10-ui-hud-xr.md section 2.10 rule 2 and C02 rule 3: Pause sets
    // FrameSignal.paused, and the sim stops on the first signal that carries it. So the bound is counted in page frames, not in wall time
    // (a software GPU draws a frame in 0.1 to 2 s): by the time Pause shows, the page is paused, and the signal that stopped the sim is at
    // the latest the next one after that moment (BD-FIX-CI10-R03). The poll below only waits for the sim's report of it to travel back
    // (stats reports, BD-FIX-CI9-W04).
    const shown = await observe(page);
    expect(shown.paused).toBe(true);
    await expect.poll(async () => (await observe(page)).simPaused, { timeout: 30_000 }).toBe(true);
    const o0 = await observe(page);
    expect(o0.simPausedSince).not.toBeNull();
    expect(o0.simPausedSince as number).toBeLessThanOrEqual(shown.frames);
    testInfo.annotations.push({ type: 'pause-frames', description: JSON.stringify({ shown: shown.frames, simPausedSince: o0.simPausedSince, reportedAt: o0.frames }) });
    await page.waitForTimeout(800);
    const o1 = await observe(page);
    expect(o1.simPaused).toBe(true);
    expect(o1.stats.tick - o0.stats.tick).toBeLessThanOrEqual(1);
    expect(o1.tick - o0.tick).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('pause.png') });

    // Save is disabled away from a safehouse, with its reason text.
    const save = page.getByTestId('btn-pause-save');
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).toContainText('Save at a safehouse');
    await expect(page.getByTestId('btn-pause-load')).toHaveAttribute('aria-disabled', 'true');

    // The phone.
    await page.getByTestId('btn-pause-phone').click();
    await expect(page.getByTestId('list-phone-apps')).toBeVisible();
    for (const id of ['map', 'messages', 'jobs', 'garage', 'bank', 'ride', 'settings', 'help', 'sandbox']) {
      await expect(page.getByTestId(`row-phone-apps-${id}`), id).toBeVisible();
      await expect(page.getByTestId(`row-phone-apps-${id}`), id).not.toHaveAttribute('aria-disabled', 'true');
    }
    for (const id of ['camera', 'feed']) await expect(page.getByTestId(`row-phone-apps-${id}`), id).toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: testInfo.outputPath('phone.png') });

    // Sandbox: heat 1. The stars appear on the HUD once the phone closes.
    await page.getByTestId('row-phone-apps-sandbox').click();
    await page.getByTestId('btn-heat-1').click();
    await expect(page.getByTestId('btn-heat-1')).toHaveClass(/primary/);
    await page.getByTestId('btn-phone-home').click();

    // Ride lists the fast-travel candidates; at heat 1 a pick shows the refusal and the player does not move.
    await page.getByTestId('row-phone-apps-ride').click();
    const rows = page.locator('[data-testid^="row-phone-ride-"]');
    await expect.poll(async () => rows.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const before = (await observe(page)).player!.pos;
    await rows.first().click();
    await expect(page.getByTestId('toast-warning')).toContainText('Not while the cops are on you', { timeout: 30_000 });
    const after = (await observe(page)).player!.pos;
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThan(0.05);

    // Clear the heat (no autosave is due during a pursuit), back to Pause, then Quit: a confirmation, then the main menu.
    await page.getByTestId('btn-phone-home').click();
    await page.getByTestId('row-phone-apps-sandbox').click();
    await page.getByTestId('btn-heat-0').click();
    await page.getByTestId('btn-phone-home').click();
    await page.getByTestId('btn-phone-close').click();
    await expect(page.getByTestId('btn-pause-quit')).toBeVisible();
    await page.getByTestId('btn-pause-quit').click();
    await expect(page.getByTestId('confirm-ok')).toBeVisible();
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('btn-pause-quit')).toBeVisible();
    await page.getByTestId('btn-pause-quit').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('main')).toBeVisible({ timeout: 60_000 });
    const state = (await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { modes: { state(): Promise<{ autosaves?: { reason: string }[] } | null> } } } }).__dvBridge.engine.modes.state()))!;
    expect(JSON.stringify(state)).toContain('modeExit');
  });

  test('the sandbox heat toggle shows its stars on the HUD @ui-pause', async ({ page }, testInfo) => {
    await bootSynth(page);
    await expect(page.getByTestId('hud-heat')).toHaveAttribute('data-level', '0');
    expect(await send(page, { t: 'sandbox.set', path: 'sandbox.player.heat', v: 2 })).toBe(true);
    await expect(page.getByTestId('hud-heat')).toHaveAttribute('data-level', '2', { timeout: 30_000 });
    await expect(page.locator('[data-testid="hud-heat"] .dv-star-on')).toHaveCount(2);
    await expect(page.getByTestId('hud-heat-phase')).not.toHaveText('');
    await page.screenshot({ path: testInfo.outputPath('hud-heat-2.png') });
    expect(await send(page, { t: 'sandbox.set', path: 'sandbox.player.heat', v: 0 })).toBe(true);
    await expect(page.getByTestId('hud-heat')).toHaveAttribute('data-level', '0', { timeout: 30_000 });
  });
});

const camYawFor = (dx: number, dz: number): number => {
  let yaw = Math.atan2(-dx, -dz);
  if (yaw < 0) yaw += 2 * Math.PI;
  return Math.round((yaw / (2 * Math.PI)) * 65536) & 0xffff;
};

test.describe('boundary toast @ui-boundary-toast', () => {
  test.describe.configure({ timeout: 600_000 });
  test.use({ storageState: qaStorageState(Number(process.env.DV_E2E_PORT ?? 8790)) });

  test('walking out toward a county line shows the toast once, in the toast region, with the en.json text @ui-boundary-toast', async ({ page }) => {
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?play=sandbox&debug=1&tier=mobile-low');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<WorldW>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
    await page.waitForFunction(() => (window as unknown as WorldW).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
    const { portals } = (await page.evaluate(() => (window as unknown as WorldW).__dvBridge.world.call('portals'))) as { portals: { kind: string; x: number; z: number; yaw: number }[] };
    const county = portals.filter((p) => p.kind === 'county-line');
    expect(county.length).toBeGreaterThan(0);
    let fwd: [number, number] = [0, -1];
    let placed = false;
    for (const p of county) {
      const f: [number, number] = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
      const to = { x: p.x - f[0] * 100, z: p.z - f[1] * 100 };
      const r = await page.evaluate((pt) => (window as unknown as WorldW).__dvBridge.world.teleport(pt), to);
      if (r.ok && Math.hypot(r.x - to.x, r.z - to.z) <= 1) {
        fwd = f;
        placed = true;
        break;
      }
    }
    expect(placed).toBe(true);
    expect(await act(page, { t: 'debug.bot', script: [{ from: 0, to: 45 * 60, moveY: -127, camYaw: camYawFor(fwd[0], fwd[1]) }] })).toBe(true);
    const toast = page.locator('[data-toast-id="world.boundary.countyLine"]');
    await expect(toast).toBeVisible({ timeout: 150_000 });
    await expect(toast).toContainText('Leaving SF — coming soon');
    await expect(page.getByTestId('toasts')).toContainText('Leaving SF');
    await expect(toast).toHaveCount(1);
    // Still pressing against the barrier: the approach fired one event and the sim raised one toast.
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => (window as unknown as WorldW).__dvBridge.world.boundaryEvents())).toBe(1);
    const raised = await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { modes: { toasts(): { id: string }[] } } } }).__dvBridge.engine.modes.toasts().filter((x) => x.id === 'world.boundary.countyLine').length);
    expect(raised).toBe(1);
  });
});

import { expect, type Page } from '@playwright/test';
import { observe, SMALL_VIEWPORT, waitForEngine } from '../engine-helpers.ts';
import { hideQaPanels } from './helpers.ts';

/**
 * Shared steps of the Sandbox app specs on the synth world (M04e1 to M04e4; BD-FIX-SBXWGPU-01). The QA play bypass starts the sandbox.
 *
 * A spec acts on the game only once what it acts on has finished: the boot spawn and every jump go through the ownership machine
 * (control 700, then 701 until the static colliders under the target are in, then a settle), and in those states the on-foot system
 * takes no input (a Jump press is dropped) and a new jump is refused as busy ("A teleport is already under way"). `CharacterBody.grounded`
 * already reads true then, and the pose of a jump is written at "ground found", before the settle and before the fade-in; under the QA
 * play bypass the sandbox mode enters, and publishes the view models its phone tabs draw, some ticks after the world is revealed (the
 * menu flow shows the HUD only once the mode runs). Whether a spec's next Escape comes before those steps end depends on how far the
 * page runs ahead of the sim: on chromium-webgpu in CI the world revealed about 4 s after load, at sim tick 16 to 27 with the boot move
 * still in 701, while the chromium-webgl2 runs of the same files take minutes. Pause stops the sim, so a step it caught stays unfinished
 * for as long as the phone is open. A slowed frame loop (`slowFrameLoop`) puts the sim behind the page the same way.
 */
type Bridge = {
  __dvBridge?: {
    world?: { boot(): { revealed: boolean }; fade(): { log: string[] } };
    engine?: { modes: { vm(k: string): unknown }; observe(): { tick: number; player: { pos: number[] } | null } };
  };
  __dvPeak?: { y: number; stop(): void };
};

/** Control states of the ownership machine's move (`CONTROL_STATE.teleportPending`, `teleportWaiting`): the player takes no input. */
export const CONTROL_TELEPORT_PENDING = 700;
export const CONTROL_TELEPORT_WAITING = 701;
/** The view models the Sandbox app's tabs draw; the mode publishes all of them when it enters. */
export const SANDBOX_VMS = ['mode.sandbox.player', 'mode.sandbox.teleport', 'mode.sandbox.vehicles', 'mode.sandbox.world'] as const;

/** Loads the synth world at `mobile-low` and waits until the player is placed on the ground and the sandbox is running. */
export async function bootSandbox(page: Page): Promise<void> {
  // The QA pursuit and mission panels sit over the left edge of every page in a 480 x 270 viewport; the menu specs hide them (BD-M04e1-07).
  await hideQaPanels(page);
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Bridge).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as Bridge).__dvBridge!.world!.boot().revealed, undefined, { timeout: 180_000 });
  // Placed: on the ground and out of the boot move (the feet stand at the unplaced height until 701 finds the ground).
  await expect
    .poll(async () => {
      const p = (await observe(page)).player;
      return p !== null && p.grounded && p.control !== CONTROL_TELEPORT_PENDING && p.control !== CONTROL_TELEPORT_WAITING;
    }, { timeout: 120_000 })
    .toBe(true);
  // Running: the sandbox has entered (its tabs have something to draw, and its commands have a mode to reach).
  await page.waitForFunction((keys) => keys.every((k) => (window as unknown as Bridge).__dvBridge!.engine!.modes.vm(k) != null), [...SANDBOX_VMS], { timeout: 120_000 });
}

/** A view model the sim published (`__dvBridge.engine.modes.vm`), or null. */
export const sandboxVm = <T>(page: Page, key: string): Promise<T | null> =>
  page.evaluate((k) => ((window as unknown as Bridge).__dvBridge!.engine!.modes.vm(k) ?? null) as T | null, key) as Promise<T | null>;

/** Pause, the phone, the Sandbox app, one of its tabs. */
export async function openSandboxTab(page: Page, tab: 'player' | 'vehicles' | 'teleport' | 'display'): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('btn-pause-resume')).toBeVisible({ timeout: 30_000 });
  // Each action gets a budget that a loaded runner can meet: on the shared CI machines (2 workers, software GL) one round trip to the
  // page takes about a second, and a click needs several (scroll, hit test, move, down, up). A 2 s click budget never fit, so every retry
  // was cancelled half way and the loop ran out its 60 s (BD-M04e2-08). The loop stays for a Phone press that lands before the Pause page
  // has settled, and only presses Phone while the phone is not showing. (A jump from the phone used to leave the phone page open over the
  // running game, so the next Escape paused and resumed at once: BD-M04e2-07.)
  await expect(async () => {
    if (!(await page.getByTestId('phone').isVisible())) await page.getByTestId('btn-pause-phone').click({ timeout: 20_000 });
    await page.getByTestId('row-phone-apps-sandbox').click({ timeout: 20_000 });
  }).toPass({ timeout: 180_000 });
  await page.getByTestId(`tab-sandbox-tabs-${tab}`).click();
}

/** From an app back to the game: the phone's home, its close button, then Resume. */
export async function closeSandboxPhone(page: Page): Promise<void> {
  await page.getByTestId('btn-phone-home').click();
  await page.getByTestId('btn-phone-close').click();
  await page.getByTestId('btn-pause-resume').click();
}

/** Fade-ins so far: every landed teleport ends in one (a refusal fades nothing). */
export const fadeIns = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as Bridge).__dvBridge!.world!.fade().log.filter((d) => d === 'in').length);

/**
 * Waits for the jump asked for after `before` fade-ins to end with its fade-in. The player's pose is written before that, at "ground
 * found", while the move still settles (control 701) and the request is still in flight; a jump asked for in that window (the Phone
 * press that asks for it pauses the sim inside it) is refused with "A teleport is already under way".
 */
export async function jumpEnded(page: Page, before: number): Promise<void> {
  await expect.poll(() => fadeIns(page), { timeout: 60_000, intervals: [500, 1000] }).toBeGreaterThan(before);
}

/** Ticks of game time a jump gets to reach its apex (2 s; a big jump's apex comes about 0.9 s after the press). */
export const JUMP_WINDOW_TICKS = 120;

/**
 * Presses Space once and returns how far above `y0` the feet got within the next `JUMP_WINDOW_TICKS` sim ticks (sampled in the page,
 * every 16 ms). The window is game time, not wall time: a slow frame loop runs the sim slower than the clock (9 ticks a frame at most),
 * and 2 s of wall time then held about 1 s of game time, short of a big jump's apex.
 */
export async function jumpPeak(page: Page, y0: number): Promise<number> {
  const t0 = await page.evaluate((base) => {
    const w = window as unknown as Bridge;
    const engine = w.__dvBridge!.engine!;
    const peak = { y: 0, stop: () => clearInterval(id) };
    const id = setInterval(() => {
      const p = engine.observe().player;
      if (p) peak.y = Math.max(peak.y, p.pos[1]! - base);
    }, 16);
    w.__dvPeak = peak;
    return engine.observe().tick;
  }, y0);
  await page.keyboard.press('Space');
  await waitTicks(page, t0, JUMP_WINDOW_TICKS);
  return page.evaluate(() => {
    const peak = (window as unknown as Bridge).__dvPeak!;
    peak.stop();
    return peak.y;
  });
}

/** A sim whose tick has not moved for this long is stalled (`waitTicks`). */
const STALL_MS = 30_000;

/**
 * Waits until the sim has run `n` ticks after tick `from` (60 a second of game time). It fails only on a stalled sim, one whose tick
 * has not moved for 30 s: how long `n` ticks take in wall time is up to the frame loop (on a software-GL page a frame alone can take
 * seconds), and the window must hold `n` ticks however long that is.
 */
export async function waitTicks(page: Page, from: number, n: number): Promise<void> {
  const tick = (): Promise<number> => page.evaluate(() => (window as unknown as Bridge).__dvBridge!.engine!.observe().tick);
  let last = await tick();
  let movedAt = Date.now();
  while (last < from + n) {
    await page.waitForTimeout(100);
    const now = await tick();
    if (now !== last) {
      last = now;
      movedAt = Date.now();
    } else if (Date.now() - movedAt > STALL_MS) {
      throw new Error(`the sim stalled at tick ${now} (waiting for tick ${from + n})`);
    }
  }
}

/**
 * A slow device's frame loop, for the regression spec: every `requestAnimationFrame` callback of the page runs `delayMs` later. The
 * engine renders and signals the sim from that loop, so the sim pays for at most 9 ticks a frame and the page sees each step of a move
 * as Chromium WebGPU on SwiftShader does on a loaded CI runner (BD-FIX-SBXWGPU-01).
 */
export async function slowFrameLoop(page: Page, delayMs: number): Promise<void> {
  await page.addInitScript((delay) => {
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const live = new Map<number, { timer: ReturnType<typeof setTimeout>; frame: number }>();
    let next = 0;
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      const id = ++next;
      const entry = {
        frame: 0,
        timer: setTimeout(() => {
          entry.frame = raf((t) => {
            live.delete(id);
            cb(t);
          });
        }, delay),
      };
      live.set(id, entry);
      return id;
    };
    window.cancelAnimationFrame = (id: number): void => {
      const e = live.get(id);
      if (!e) return;
      clearTimeout(e.timer);
      if (e.frame !== 0) caf(e.frame);
      live.delete(id);
    };
  }, delayMs);
}

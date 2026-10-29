import { expect, test, type Page } from '@playwright/test';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M07a2 AC-12 (`@racing-vs`), on a QA build: a fresh profile with `?unlockAll=1` lists Racing as available and unlocked, a race is
 * started from the mode host, the bridge puts the line bot on the player's car and it drives to the finish against two AI rivals,
 * the results view model shows place and time, the racing slice stores `bestMs` and the ghost of the run, and a retry spawns one
 * ghost entity beside the two rivals.
 *
 * The race is the QA straight sprint (`qa.demo.straight`) with two rivals: the circuit itself needs the baked streets of San
 * Francisco, which a browser build has only as a synth city; the circuit with its three cars is proven in Node, Chromium and
 * WebKit by `@racing-det`, and in Node by `replay.exact`. The slice is checked through the QA bridge (`racing.slice`).
 *
 * To see it by hand: a QA build (`pnpm dev`), open `/?racing=demo&unlockAll=1&debug=1&play=off`, press ready (`__dvBridge.racing.cmd('ready')`)
 * and `await __dvBridge.racing.bot(true)`: three cars (the supercar and two rivals) race down the street, the HUD shows the place.
 */
test.use({ storageState: { cookies: [], origins: [] } });

interface RaceState {
  ok: boolean;
  state?: {
    tick: number; phase: string; place: number; of: number; finishMs: number | null; outcome: string | null; gate: number;
    ghostRunning: boolean; puppets: number; rivals: { driverId: string; s: number }[]; car: unknown | null; endHash: string | null;
  };
}
interface SliceReply {
  ok: boolean;
  slice?: { events: Record<string, { bestMs?: number | null; medals?: number }>; ghosts: Record<string, { ms: number; vehicleDef: string }> };
}
type ModesBridge = { list(): { modes: { id: string; status: string; unlocked: boolean }[] } };

const racing = <T>(page: Page, expr: string): Promise<T> => page.evaluate(`(async () => { const r = window.__dvBridge.racing; return ${expr}; })()`) as Promise<T>;
const state = async (page: Page): Promise<NonNullable<RaceState['state']>> => {
  const r = await racing<RaceState>(page, 'r.state()');
  if (!r?.ok || !r.state) throw new Error('no race state');
  return r.state;
};

test.describe('racing versus @racing-vs', () => {
  test.describe.configure({ timeout: 300_000 });

  test('the line bot wins against two rivals, the slice keeps the best time and the ghost, and a retry spawns one ghost @racing-vs', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?racing=1&unlockAll=1&debug=1&play=off&tier=mobile-low');
    await waitForEngine(page);
    await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { racing?: unknown } }).__dvBridge?.racing), undefined, { timeout: 60_000 });
    await expect.poll(async () => (await observe(page)).player?.grounded ?? false, { timeout: 90_000 }).toBe(true);

    // the Racing tile is available and unlocked
    const listing = await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { modes: ModesBridge } } }).__dvBridge.engine.modes.list());
    const tile = listing.modes.find((m) => m.id === 'racing');
    expect(tile?.status).toBe('available');
    expect(tile?.unlocked).toBe(true);

    // start, seat, ready: three cars on the grid
    const started = await racing<{ ok: boolean }>(page, 'r.demo({ vehicle: "vehicle.aurelian-sorrel" })');
    expect(started?.ok).toBe(true);
    await expect.poll(async () => (await state(page)).car != null, { timeout: 90_000 }).toBe(true);
    const grid = await state(page);
    expect(grid.rivals.map((r) => r.driverId).sort()).toEqual(['rival.cable-car-cleo', 'rival.switchback']);
    await racing(page, "r.cmd('ready')");
    await expect.poll(async () => (await state(page)).phase, { timeout: 30_000 }).toBe('Running');

    // the bot drives to the finish
    expect(((await racing<{ ok: boolean }>(page, 'r.bot(true)')) ?? { ok: false }).ok).toBe(true);
    await expect.poll(async () => (await state(page)).outcome, { timeout: 200_000, intervals: [1000] }).toBe('finish');
    await expect.poll(async () => (await state(page)).phase, { timeout: 60_000 }).toMatch(/Results|Finished/);
    const done = await state(page);
    expect(done.of).toBe(3);
    expect(done.place).toBeGreaterThanOrEqual(1);
    expect(done.place).toBeLessThanOrEqual(3);
    expect(done.finishMs).toBeGreaterThan(1000);
    expect(done.endHash).toMatch(/^[0-9a-f]{16}$/);

    // the results view model shows place and time
    const hud = await racing<{ results?: { place: number; of: number; ms: number } | null } | null>(page, 'r.hud()');
    expect(hud?.results?.of).toBe(3);
    expect(hud?.results?.place).toBe(done.place);
    expect(hud?.results?.ms).toBe(done.finishMs);

    // the slice stores the best time and the ghost of the run
    const sl = await racing<SliceReply>(page, 'r.slice()');
    expect(sl.ok).toBe(true);
    const ev = sl.slice?.events['qa.demo.straight'];
    expect(ev?.bestMs).toBe(done.finishMs);
    expect(sl.slice?.ghosts['qa.demo.straight']?.ms).toBe(done.finishMs);

    // the retry: the grid again, the two rivals and exactly one ghost
    await racing(page, 'r.bot(false)');
    await racing(page, "r.cmd('retry')");
    await expect.poll(async () => (await state(page)).phase, { timeout: 60_000 }).not.toMatch(/Results|Finished/);
    await expect.poll(async () => (await state(page)).ghostRunning, { timeout: 60_000 }).toBe(true);
    const again = await state(page);
    expect(again.rivals).toHaveLength(2);
    expect(again.puppets).toBe(3);
    expect(errors).toEqual([]);
  });
});

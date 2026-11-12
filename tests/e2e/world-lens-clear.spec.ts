import { expect, test, type Page, type Route } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import type { EngineBridge } from '../../packages/engine/src/client/debug/bridge.ts';
import type { LensReport, TreeRead } from '../../packages/world/src/client/chunks/vegetation-pool.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { canvasRgba } from './canvas-capture.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { leafShare } from './lens-clear-helpers.ts';

/**
 * BD-FIX-LENS-CLEAR-01 in a real browser, on a `DV_WORLD=synth` QA build at `mobile-low` (`@world-lens-clear`): a director-placed
 * cinematic shot keeps tree crowns out of the lens.
 *
 * The shot is a real one: the intro beat of the sample mission (`m.dev.sample.intro`, an `establish` on the player, wide lens, static),
 * played by the story director as the in-engine fallback of its cutscene (route 27 answers `absent`), so the camera directive comes from
 * the sim through the snapshot to the rig like any beat's. Before the mission starts the player is moved (the QA teleport) to stand 6 m
 * past a synth street tree, along its row, facing away from it: the director's wide pose (10 m behind the subject, 4 m up) then stands
 * 4 m behind that tree, whose crown hangs between the lens and the player.
 *
 *  - while the shot runs `look().vegetation.lens` is `{ active: true, hidden >= 1 }`, and the tree in front of the lens is the hidden one;
 *  - the hidden tree's pixels are gone: with `setLookLayer('lensClear', false)` the leaf colour covers a large share of the canvas, with
 *    the layer on it does not;
 *  - `hidden` stays what it is while the shot runs (no tree appears or vanishes), and when the shot ends `active` is false and `hidden` 0.
 */
test.use({ storageState: { cookies: [], origins: [] } });

interface MissionGate {
  state(): { state: 'waiting' | 'released' | 'expired'; waiting: string[]; reason: string | null };
}
type W = { __dvBridge: { world: WorldBridge; engine: EngineBridge; mission: MissionBridge; missionGate?: MissionGate } };
type Sample = LensReport & { mode: string | null };

/** The director's `wide` pose (packages/modes/story/src/director/presets.ts): 10 m behind the subject and 4 m up, looking at the head. */
const WIDE_BACK_M = 10;
const WIDE_UP_M = 4;
/** The player stands this far past the tree, so the lens stands `WIDE_BACK_M - PAST_M` behind it. */
const PAST_M = 6;
/** The sample mission's start marker in ENU metres (37.77894, -122.418619): a mission further than 300 m from its start moves the player there first. */
const START = { x: 60, z: 40 };
const NEAR_START_M = 220;
/** Every DOM layer over the canvas out of the captures (the Title, the QA panels, the letterbox). */
const CANVAS_ONLY = '* { visibility: hidden !important } #dv-engine-canvas { visibility: visible !important }';
/**
 * The leaf colour's share of the canvas (lens-clear-helpers.ts): with the tree drawn its crown fills the upper part of the frame (0.29
 * measured), hidden it leaves the small trees down the lawn (0.02 measured).
 */
const LEAF_OFF_MIN = 0.2;
const LEAF_ON_MAX = 0.1;

const lens = (page: Page): Promise<LensReport> => page.evaluate(() => (window as unknown as W).__dvBridge.world.look()!.vegetation.lens);
const trees = (page: Page, x: number, z: number, r: number, max = 64): Promise<TreeRead[]> =>
  page.evaluate(([a, b, c, d]) => (window as unknown as W).__dvBridge.world.trees(a as number, b as number, c as number, d as number), [x, z, r, max] as const);
const share = async (page: Page): Promise<number> => leafShare(await canvasRgba(page));

test.describe('world lens clear @world-lens-clear', () => {
  test.describe.configure({ timeout: 420_000 });

  test('mobile-low: a director-placed shot hides the tree that crowds its lens, holds the set through the shot and restores it after @world-lens-clear', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // the sample's intro cutscene is not in the catalog: the beat falls back to its in-engine DirectorScript
    await page.route('**/api/v1/cutscenes/*', (r: Route) => {
      const key = new URL(r.request().url()).pathname.split('/').pop() as string;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key, state: 'absent', reason: 'not_in_catalog' }) });
    });
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?play=off&tier=mobile-low&mission=m.dev.sample&seed=1&talk=scripted');
    await waitForEngine(page);
    await page.waitForFunction(
      () => {
        const b = (window as unknown as Partial<W>).__dvBridge;
        return b?.world !== undefined && b.mission !== undefined && b.missionGate !== undefined && b.world.boot().revealed;
      },
      undefined,
      { timeout: 240_000 },
    );
    // noon, clear: the leaf colour is the crowns' own
    await page.evaluate(() => {
      const w = (window as unknown as W).__dvBridge.world;
      w.setHour(12, true);
      w.setWeather('clear', 0);
    });
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));

    // before any shot: nothing is hidden, and the report says so
    expect(await lens(page)).toEqual({ active: false, hidden: 0, decisions: 0 });

    // The player keeps the heading of the spawn (a teleport on foot moves, it does not turn), so the wide pose stands behind the player
    // along that heading: forward is (-sin yaw, -cos yaw).
    const heading = (await observe(page)).look.playerHeading;
    expect(heading, 'the player has a heading before the mission starts').not.toBeNull();
    const fx = -Math.sin(heading as number), fz = -Math.cos(heading as number);
    // a tree near the mission's start (the synth world scatters them; at boot most are cards, the title camera stands far off)
    const all = (await trees(page, START.x, START.z, NEAR_START_M, 256)).filter((t) => t.heightM >= 6 && t.crown !== null);
    expect(all.length, 'synth trees near the start').toBeGreaterThan(0);
    let placed: { tree: TreeRead; player: [number, number, number]; lens: [number, number, number] } | null = null;
    const tried: string[] = [];
    for (const tree of all) {
      // the player stands `PAST_M` past the tree, facing away from it
      const res = await page.evaluate((to) => (window as unknown as W).__dvBridge.world.teleport(to), { x: tree.x + fx * PAST_M, z: tree.z + fz * PAST_M });
      if (!res || !res.ok) {
        tried.push(`${tree.x.toFixed(1)},${tree.z.toFixed(1)}: ${res ? res.reason : 'no answer'}`);
        continue;
      }
      // the teleport puts the player on walkable ground near the point: where it answers is where the shot is built
      const cam: [number, number, number] = [res.x - fx * WIDE_BACK_M, res.y + WIDE_UP_M, res.z - fz * WIDE_BACK_M];
      // the tree must stand in front of the lens, on its line to the player: 2 to 7 m along it, within 1.5 m of it
      const along = (tree.x - cam[0]) * fx + (tree.z - cam[2]) * fz;
      const off = Math.abs((tree.x - cam[0]) * fz - (tree.z - cam[2]) * fx);
      if (along >= 2 && along <= 7 && off <= 1.5) {
        placed = { tree, player: [res.x, res.y, res.z], lens: cam };
        break;
      }
      tried.push(`${tree.x.toFixed(1)},${tree.z.toFixed(1)}: placed ${along.toFixed(1)} m along, ${off.toFixed(1)} m off`);
    }
    expect(placed, `no tree could be put in front of the wide pose: ${tried.join('; ')}`).not.toBeNull();
    const at = placed!;
    test.info().annotations.push({ type: 'lens-clear', description: JSON.stringify({ tree: [at.tree.x, at.tree.z, at.tree.heightM, at.tree.form], player: at.player, lens: at.lens, tried: tried.length }) });
    // the player stands there, on the ground, before the mission starts
    await expect
      .poll(async () => {
        const pl = (await observe(page)).player;
        return pl !== null && pl.grounded && Math.hypot(pl.pos[0] - at.player[0], pl.pos[2] - at.player[2]) < 1;
      }, { timeout: 60_000, intervals: [100] })
      .toBe(true);
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
    expect((await lens(page)).active).toBe(false);

    // every lens report from here on, sampled in the page (the shot lasts 6 s of sim time)
    await page.evaluate(() => {
      const w = window as unknown as W & { __lensSamples: Sample[] };
      w.__lensSamples = [];
      setInterval(() => {
        const l = w.__dvBridge.world.look()?.vegetation.lens;
        if (l) w.__lensSamples.push({ ...l, mode: w.__dvBridge.engine.observe().camera?.mode ?? null });
      }, 25);
    });

    // the player's first gesture releases the held boot mission (qa/mission-gate.ts): its intro beat is the director's shot
    await page.getByTestId('title-start').click();
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.missionGate?.state().state !== 'waiting', undefined, { timeout: 120_000 });
    const gate = await page.evaluate(() => (window as unknown as W).__dvBridge.missionGate?.state());
    expect(gate, `the boot mission did not start: ${gate?.reason ?? 'no mission gate on the page'}`).toMatchObject({ state: 'released', waiting: [] });
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.look()?.vegetation.lens.active === true, undefined, { timeout: 120_000, polling: 25 });
    // hold the shot where it is for the captures: the sim pauses, the rig keeps obeying the directive it has
    await page.evaluate(() => (window as unknown as W).__dvBridge.engine.setPaused(true));

    // the rig is on the director's shot, where the wide pose was predicted, and the rule has hidden the tree in front of it
    const cam = (await observe(page)).camera;
    expect(cam?.mode).toBe('cinematic');
    expect(Math.hypot((cam?.pos[0] ?? 0) - at.lens[0], (cam?.pos[1] ?? 0) - at.lens[1], (cam?.pos[2] ?? 0) - at.lens[2]), `the lens ${JSON.stringify(cam?.pos)} stands at the wide pose ${JSON.stringify(at.lens)}`).toBeLessThan(0.5);
    const during = await lens(page);
    expect(during.active).toBe(true);
    expect(during.hidden).toBeGreaterThanOrEqual(1);
    expect(during.decisions).toBe(1);
    const mine = (await trees(page, at.tree.x, at.tree.z, 0.5, 1))[0] as TreeRead;
    expect(mine.hidden, 'the tree in front of the lens is hidden').toBe(true);
    expect(mine.lens !== null && (mine.lens.share > 0.1 || mine.lens.corridor), `the rule's measure of it: ${JSON.stringify(mine.lens)}`).toBe(true);
    // only the trees the rule measured as crowding the lens are hidden (within 40 m of it every tree is a mesh for this lens)
    const around = await trees(page, at.lens[0], at.lens[2], 40, 256);
    expect(around.filter((t) => t.hidden).length).toBe(during.hidden);
    for (const t of around) expect(t.lens !== null && t.hidden === (t.lens.share > 0.1 || t.lens.corridor), JSON.stringify(t)).toBe(true);

    // the pixels: with the layer off the crown is back in the frame, with it on the leaf colour does not cover the frame
    await page.addStyleTag({ content: CANVAS_ONLY });
    let cut = 1;
    await expect.poll(async () => (cut = await share(page)), { timeout: 60_000, intervals: [100] }).toBeLessThan(LEAF_ON_MAX);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('lensClear', false))).toBe(true);
    expect(await lens(page)).toEqual({ active: true, hidden: 0, decisions: 1 });
    let off = 0;
    await expect.poll(async () => (off = await share(page)), { timeout: 60_000, intervals: [100] }).toBeGreaterThan(LEAF_OFF_MIN);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('lensClear', true))).toBe(true);
    // the layer came back during the shot: its next frame decides again, the same set
    await expect.poll(async () => lens(page), { timeout: 60_000, intervals: [50] }).toEqual({ active: true, hidden: during.hidden, decisions: 2 });
    let on = 1;
    await expect.poll(async () => (on = await share(page)), { timeout: 60_000, intervals: [100] }).toBeLessThan(LEAF_ON_MAX);
    test.info().annotations.push({ type: 'leaf-share', description: JSON.stringify({ cut, off, on }) });

    // the shot runs to its end: the set is held (no tree appears or vanishes), then every tree is back
    await page.evaluate(() => {
      const w = window as unknown as W & { __lensSamples: Sample[] };
      w.__lensSamples.length = 0;
      w.__dvBridge.engine.setPaused(false);
    });
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.look()?.vegetation.lens.active === false, undefined, { timeout: 120_000, polling: 25 });
    const samples = await page.evaluate(() => (window as unknown as { __lensSamples: Sample[] }).__lensSamples);
    const running = samples.filter((s) => s.active);
    expect(running.length, 'lens reports while the shot ran').toBeGreaterThan(3);
    expect([...new Set(running.map((s) => `${s.hidden}/${s.decisions}/${s.mode}`))]).toEqual([`${during.hidden}/2/cinematic`]);
    expect(await lens(page)).toEqual({ active: false, hidden: 0, decisions: 2 });
    expect((await trees(page, at.tree.x, at.tree.z, 0.5, 1))[0]).toMatchObject({ hidden: false, lens: null });
    await expect.poll(async () => (await observe(page)).camera?.mode, { timeout: 60_000 }).not.toBe('cinematic');
    expect(await lens(page)).toEqual({ active: false, hidden: 0, decisions: 2 });
    expect(errors).toEqual([]);
  });
});

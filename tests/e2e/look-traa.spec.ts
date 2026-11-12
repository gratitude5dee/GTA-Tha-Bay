import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { adaptForBackend, postNodes } from '../../packages/engine/src/platform/post/levels.ts';
import { flickerShare, type RegionMask } from '../support/flicker.ts';
import { diffImages, encodePng, goldenFailures, type Rgba } from '../support/image-diff.ts';
import { canvasRgba } from './canvas-capture.ts';
import { HIDE_ALL, read, world, type W } from './look-fixes-helpers.ts';

/**
 * M02h8 AC-7 (@look-traa, `chromium-webgl2` and `webkit-webgl2`): TRAA on `desktop`, on a `DV_WORLD=synth` QA build at `?tier=desktop&post=3`
 * (`post=3` is the build's own post-level cap; the e2e page fixture holds every other page at level 2, BD-M02h8-02).
 *
 *  1. At the reveal `governor.state().dynamic.postLevel` is 3 and `look().postNodes` is the level-3 list of the tier
 *     (`gtao-half, bloom, traa, tonemap`) after `look.json` `webgl2AaFallback` and `webgl2Unsupported`.
 *  2. A cut: from the held shot `traa-cut` the camera turns 90 degrees to `traa-graze` between two frames (`shotMove`). The stack resets the
 *     TRAA history on that frame (`look().traa.resets` goes up by one), and the picture 16 frames after the cut is within the golden
 *     tolerance of the settled picture of the new pose: the picture the QA `shot()` presents, which is the history started again on the
 *     pose and 16 frames (`SHOT_TEMPORAL_FRAMES`). A TRAA picture never stands still (its jitter walks a 32-frame cycle, so frame 16 and
 *     frame 32 of one pose differ on about 2 % of the pixels), which is why the settled picture is the one a fixed count after the reset.
 *  3. A slow slide: from `traa-graze` the camera moves 0.0125 m east per frame for eight frames (0.75 m/s at 60 frames a second: every
 *     point of the wall moves by less than half a pixel a frame, the motion at which an edge without a temporal filter hops from pixel
 *     to pixel; the 0.05 m step of the M02g2 pairs moves the near wall by more than a pixel, which is parallax). The share of facade pixels that flicker
 *     between two consecutive frames (`tests/support/flicker.ts` `flickerShare`: more than 32/255 on a channel with no look-alike within one
 *     pixel) is at most 0.2 % in every pair with `traa` on, and its largest pair is no more than the largest pair of the same slide at
 *     level 2 (`smaa`), which the same page runs after `setPostLevel(2)`.
 *
 * One boot per project and never two worlds at once. The frames are counted in the page (`PostStack.frames`) and the loop is stopped on
 * the counted frame (`hold(true)`), so a capture is the frame it names whatever a frame costs. Textures are off (as in the M02g2 and
 * M02h7 pairs): the measure is the edges of the window rows at a grazing angle, not an albedo's own detail under the parallax.
 * `DV_TRAA_DIR=<dir>` keeps the pictures.
 */

/** A 16:9 canvas between the golden size and the flicker size: 60 or more `desktop` frames at 640 x 360 on software GL do not fit a shard. */
const VIEW = { width: 320, height: 180 } as const;
const SLIDE_STEPS = 8;
const SLIDE_STEP_M = 0.0125;
/** Frames the cut is given before its picture is compared (`SHOT_TEMPORAL_FRAMES` of `world-bridge.ts`, the count the QA `shot()` presents). */
const CUT_FRAMES = 16;
/** The most facade pixels a pair of consecutive frames may flicker with `traa` on. */
const TRAA_FLICKER_MAX = 0.002;

const LOOK = read<{ postLevelCap: 0 | 1 | 2 | 3; webgl2Unsupported: string[]; webgl2AaFallback: Record<string, string> }>('config/world/look.json');
const BUDGETS = read<{ tiers: Record<string, { features: Parameters<typeof postNodes>[0] }> }>('config/tier-budgets.json');

/**
 * The facade of `traa-graze`: the shop walls stand on the right of the street the camera looks along, so the wall, its window rows and its
 * storefronts fill the right of the picture above the pavement. The left edge keeps the vanishing point and the far street out, the bottom
 * the sidewalk in front of the camera.
 */
const facadeRegion: RegionMask = (x, y) => {
  const u = x / VIEW.width, v = y / VIEW.height;
  if (u < 0.58) return false;
  // the wall top runs from (0.58, 0.44) up to the picture's top edge at u = 0.72; the wall foot from (0.58, 0.56) down to the corner
  const top = u < 0.72 ? (0.44 * (0.72 - u)) / 0.14 : 0;
  const foot = 0.56 + ((u - 0.58) / 0.42) * 0.44;
  return v >= top && v <= foot;
};

type Stack = { frames: number; framesSinceReset: number; historyResets: number; temporal: boolean };
type Internals = { look: { stack: (Stack & { resetHistory(): boolean }) | null; shotCamera: { x: number } | null; setPostLevel(n: number): void } };

/**
 * Runs the page until `frames` more frames have been drawn by the post stack, then stops the loop on that frame. `from` says where the
 * count starts: `now`, the last history reset (`reset`), or a history reset made here, in the same call (`resetNow`).
 */
async function holdAfterFrames(page: Page, frames: number, from: 'now' | 'reset' | 'resetNow' = 'now'): Promise<void> {
  await page.evaluate(
    ([n, origin]) =>
      new Promise<void>((resolve, reject) => {
        const w = (window as unknown as W).__dvBridge.world;
        const stack = (w.internals() as unknown as Internals).look.stack;
        if (!stack) return reject(new Error('no post stack'));
        if (origin === 'resetNow' && !stack.resetHistory()) return reject(new Error('the stack has no temporal history to reset'));
        const target = (origin === 'now' ? stack.frames : stack.frames - stack.framesSinceReset) + (n as number);
        const tick = (): void => {
          if (stack.frames >= target) {
            w.hold(true);
            resolve();
          } else requestAnimationFrame(tick);
        };
        tick();
      }),
    [frames, from] as const,
  );
}

const release = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as W).__dvBridge.world.hold(false));

/**
 * The slide, from a stopped loop: the picture on the canvas, then `SLIDE_STEPS` frames, each drawn one step east of the last (the camera
 * moves, the loop draws exactly one frame and stops again, in one call into the page).
 */
async function slide(page: Page): Promise<Rgba[]> {
  const out: Rgba[] = [];
  out.push(await canvasRgba(page));
  for (let i = 0; i < SLIDE_STEPS; i++) {
    await page.evaluate(
      (dx) =>
        new Promise<void>((resolve, reject) => {
          const w = (window as unknown as W).__dvBridge.world;
          const lv = (w.internals() as unknown as Internals).look;
          const stack = lv.stack;
          if (!lv.shotCamera || !stack) return reject(new Error('no shot is held'));
          lv.shotCamera.x += dx;
          const target = stack.frames + 1;
          w.hold(false);
          const tick = (): void => {
            if (stack.frames >= target) {
              w.hold(true);
              resolve();
            } else requestAnimationFrame(tick);
          };
          tick();
        }),
      SLIDE_STEP_M,
    );
    out.push(await canvasRgba(page));
  }
  return out;
}

const pairShares = (frames: readonly Rgba[]): number[] => frames.slice(1).map((f, i) => flickerShare(frames[i] as Rgba, f, undefined, 1, facadeRegion));

test.describe('TRAA on desktop @look-traa', () => {
  test.describe.configure({ timeout: 2_700_000 });

  test('desktop at level 3 runs traa; a cut resets its history and settles in 16 frames; a slow slide flickers no more than at level 2 @look-traa', async ({ page }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name === 'chromium-webgpu', 'the TRAA bounds are WebGL2 bounds (AC-7 names chromium-webgl2 and webkit-webgl2)');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const t0 = Date.now();
    await page.setViewportSize(VIEW);
    await page.goto('/?tier=desktop&debug=1&post=3&textures=0');
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 420_000 });

    // 1. at the reveal: the governor's level, and the list the stack runs
    const postLevel = await page.evaluate(() => (window as unknown as W).__dvBridge.platform.governor.state().dynamic.postLevel);
    expect(postLevel, 'governor.state().dynamic.postLevel at reveal').toBe(3);
    const look = await world(page, (w) => w.look());
    if (!look) throw new Error('no look report');
    const level3 = postNodes(BUDGETS.tiers['desktop']!.features, 3, LOOK.postLevelCap);
    expect(level3).toEqual(['gtao-half', 'bloom', 'traa', 'tonemap']);
    const expected = adaptForBackend(level3, look.backend === 'webgl2' ? 'webgl2' : 'webgpu', { webgl2Unsupported: LOOK.webgl2Unsupported as never, webgl2AaFallback: LOOK.webgl2AaFallback as never });
    expect(look.postNodes, 'the level-3 list after webgl2AaFallback').toEqual(expected);
    expect(look.postLevel).toBe(3);
    const temporal = expected.includes('traa');
    expect(look.traa === null || look.traa === undefined, 'look().traa is the report of a traa node').toBe(!temporal);
    await expect(page.getByTestId('look-nodes')).toContainText(expected.join(' > '));
    test.skip(!temporal, 'look.json webgl2AaFallback replaces traa on this backend: no temporal node to measure');

    await page.addStyleTag({ content: HIDE_ALL });
    const keep = process.env['DV_TRAA_DIR'];
    const save = (name: string, img: Rgba): void => {
      if (!keep) return;
      mkdirSync(keep, { recursive: true });
      writeFileSync(`${keep}/${testInfo.project.name}.${name}.png`, encodePng(img));
    };
    // the crowds and the avatar out of the picture, as in the pairs
    const clear = (): Promise<void> =>
      page.evaluate(() => {
        const b = (window as unknown as W).__dvBridge;
        b.engine.setPaused(true);
        type G = { group: { visible: boolean } } | null;
        const view = b.world.internals().view as unknown as { traffic: G; peds: G; transit: G; host: { scene: { children: { userData: Record<string, unknown>; traverse(f: (o: { layers: { set(n: number): void } }) => void): void }[] } } };
        for (const r of [view.traffic, view.peds, view.transit]) if (r) r.group.visible = false;
        for (const c of view.host.scene.children) if (c.userData['dvActor'] === 'avatar') c.traverse((o) => o.layers.set(31));
      });

    // 2. the cut: from `traa-cut` (the stream settles there once: both shots stand on the same spot) to `traa-graze`
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.shot('traa-cut', { held: true }));
    await clear();
    const before = (await world(page, (w) => w.look()))?.traa;
    expect(before?.resets ?? 0, 'the shot reset the history').toBeGreaterThanOrEqual(1);
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.shotMove('traa-graze'));
    const after = (await world(page, (w) => w.look()))?.traa;
    expect(after?.resets, 'the 90 degree cut reset the history once').toBe((before?.resets ?? 0) + 1);
    await holdAfterFrames(page, CUT_FRAMES, 'reset');
    const cut = await canvasRgba(page);
    expect((await world(page, (w) => w.look()))?.traa, `the picture is frame ${CUT_FRAMES} after the cut`).toMatchObject({ resets: after?.resets, framesSinceReset: CUT_FRAMES });
    save('cut16', cut);
    await release(page);
    // the settled picture of the new pose: the QA shot of it, then its history started again and the same 16 frames, counted in the page
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.shot('traa-graze', { held: true }));
    await holdAfterFrames(page, CUT_FRAMES, 'resetNow');
    const settled = await canvasRgba(page);
    expect((await world(page, (w) => w.look()))?.traa?.framesSinceReset).toBe(CUT_FRAMES);
    save('settled', settled);
    const diff = diffImages(cut, settled);
    console.log(`look-traa ${testInfo.project.name}: ${CUT_FRAMES} frames after the cut against the settled pose: ${JSON.stringify(diff)}`);
    expect(goldenFailures(diff), `16 frames after the cut against the settled pose: ${JSON.stringify(diff)}`).toEqual([]);

    // 3. the slide with traa on (the loop is stopped on the settled frame)
    const traaFrames = await slide(page);
    const traa = pairShares(traaFrames);
    traaFrames.forEach((f, i) => save(`traa.slide${i}`, f));
    const slid = (await world(page, (w) => w.look()))?.traa;
    expect(slid?.framesSinceReset, 'a 1.25 cm step is motion, not a cut: the history ran on through the slide').toBe(CUT_FRAMES + SLIDE_STEPS);
    await release(page);

    // the same slide at level 2 (`smaa`): the stack is built again, the shot stands on the start pose again
    await page.evaluate(() => ((window as unknown as W).__dvBridge.world.internals() as unknown as Internals).look.setPostLevel(2));
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.shot('traa-graze', { held: true }));
    const level2 = await world(page, (w) => w.look());
    expect(level2?.postNodes).toEqual(adaptForBackend(postNodes(BUDGETS.tiers['desktop']!.features, 2, LOOK.postLevelCap), 'webgl2', { webgl2Unsupported: LOOK.webgl2Unsupported as never, webgl2AaFallback: LOOK.webgl2AaFallback as never }));
    expect(level2?.postNodes).not.toContain('traa');
    expect(level2?.traa ?? null).toBeNull();
    await holdAfterFrames(page, 2);
    const smaaFrames = await slide(page);
    const smaa = pairShares(smaaFrames);
    smaaFrames.forEach((f, i) => save(`smaa.slide${i}`, f));
    await release(page);

    const pct = (v: number[]): string => v.map((x) => (x * 100).toFixed(3)).join(', ');
    console.log(`look-traa ${testInfo.project.name}: facade flicker per pair of the slide, traa ${pct(traa)} %; level 2 (smaa) ${pct(smaa)} %; ${Math.round((Date.now() - t0) / 1000)} s`);
    const worst = Math.max(...traa);
    expect(worst, `the worst pair with traa on against ${TRAA_FLICKER_MAX}`).toBeLessThanOrEqual(TRAA_FLICKER_MAX);
    expect(worst, 'traa flickers no more than level 2 on the same slide').toBeLessThanOrEqual(Math.max(...smaa));
    expect(errors).toEqual([]);
  });
});

import { expect, test, type Page, type Route } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M05b2 AC-8 and AC-9 (@cutscene): the CutscenePlayer on the game page. The intro beat of the sample mission is a generated cutscene with
 * an in-engine fallback. The assertions read `__dvBridge.cutscene` (requests, commands sent to the sim, subtitle and chip in the DOM) and
 * `__dvBridge.mission` (the phase), never pixels. Route 27 is mocked through Playwright. The tests that need a decodable clip skip on a
 * browser that plays neither fixture codec (WebKit on Linux); the absent-to-fallback test runs everywhere. As in a player's game, a
 * trusted click on the Title's Start unlocks media before the mission's first beat (DL-715 as amended); the 2.5 s clock starts at the beat.
 */
test.use({ storageState: { cookies: [], origins: [] } });

interface LogEntry {
  at: number;
  k: 'request' | 'cmd' | 'done' | 'play' | 'skip' | 'next-host';
  /** `k: 'next-host'`: the trigger that moved the clip to the next pooled element (BD-FIX-CUTFLAKE-01). */
  trigger?: string;
  n?: number;
  refs?: (string | null)[];
  cmd?: { t: string; playId?: string; state?: string; trigger?: string; item?: number; outcome?: { path: string; skipped: boolean; trigger?: string } };
  props?: Record<string, unknown>;
  /** `k: 'skip'`: the input that asked for it (BD-FU-B03). */
  source?: { input: string; event?: string; pointerType?: string; trusted?: boolean };
}
interface Cutscene {
  state(): { playing: string[]; host: { visible: boolean; cues: boolean; held: 'stopped' | 'cover' | 'frame' | null }; heldFrames: number; simPaused: boolean };
  log(): LogEntry[];
  stall(): boolean;
  subtitle(): string;
  aiChip(): boolean;
  hasVideo(): boolean;
  stillSrc(): string | null;
}
interface MissionGate {
  state(): { state: 'waiting' | 'released' | 'expired'; waiting: string[]; reason: string | null; releasedAfterMs: number | null; after: Record<'gesture' | 'reveal', number | null> };
}
type W = { __dvBridge: { cutscene: Cutscene; mission: MissionBridge; missionGate?: MissionGate } };

const cut = <T>(page: Page, fn: (c: Cutscene) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dvBridge.cutscene)`) as Promise<T>;
const log = (page: Page): Promise<LogEntry[]> => cut(page, (c) => c.log());
const phase = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => ((window as unknown as W).__dvBridge.mission.state() as { phase?: string } | null)?.phase);
const answer = (entries: LogEntry[], state: string): LogEntry | undefined => entries.find((e) => e.k === 'cmd' && e.cmd?.t === 'cutscene.state' && e.cmd.state === state);

/** The skips the overlay sent, by input: the test's one Escape press, and nothing that it did not ask for (BD-FU-B03). */
const skipInputs = (entries: LogEntry[]): string[] => entries.filter((e) => e.k === 'skip').map((e) => `${e.source?.input}:${e.source?.event}`);

/** Records how long the clip took from the beat's request to the `video` answer (the start chain of section D7) as an annotation. */
async function noteVideoMs(page: Page): Promise<void> {
  const entries = await log(page);
  const request = entries.find((e) => e.k === 'request');
  const video = answer(entries, 'video');
  if (request && video) test.info().annotations.push({ type: 'video-ms', description: String(Math.round(video.at - request.at)) });
}

const MANIFEST = '/media-local/cutscenes/fixture-a/manifest.json';

type Route27 = 'absent' | 'ready' | null;

/** Boots the sample mission. Route 27 is mocked before the first request when `route` is given. */
async function boot(page: Page, route: Route27, query = '', o: { holdPointer?: boolean } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (route !== null) {
    await page.route('**/api/v1/cutscenes/*', (r: Route) => {
      const key = new URL(r.request().url()).pathname.split('/').pop() as string;
      const origin = new URL(r.request().url()).origin;
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(route === 'absent' ? { key, state: 'absent', reason: 'not_in_catalog' } : { key, state: 'ready', manifestUrl: `${origin}${MANIFEST}` }),
      });
    });
  }
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?play=off&tier=mobile-low&mission=m.dev.sample&seed=1&talk=scripted${query}`);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.cutscene !== undefined && (window as unknown as W).__dvBridge.mission !== undefined, undefined, { timeout: 60_000 });
  // The player's first gesture (DL-715 as amended): a trusted click on the Title's Start runs the product's FirstGestureUnlock. The
  // held boot mission, and so the beat whose clock AC-8 reads, starts only after it and after the world reveal (qa/mission-gate.ts).
  if (o.holdPointer) {
    // The same trusted click on Start, then a press that the player keeps held (a finger on the touch stick, a mouse drag) while
    // the mission starts and its clip comes up (BD-FU-B03).
    const box = await page.getByTestId('title-start').boundingBox();
    if (!box) throw new Error('no Start button');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(SMALL_VIEWPORT.width / 2, SMALL_VIEWPORT.height / 2);
    await page.mouse.down();
  } else await page.getByTestId('title-start').click();
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.missionGate?.state().state !== 'waiting', undefined, { timeout: 120_000 });
  const gate = await page.evaluate(() => (window as unknown as W).__dvBridge.missionGate?.state());
  expect(gate, `the boot mission did not start: ${gate?.reason ?? 'no mission gate on the page'}`).toMatchObject({ state: 'released', waiting: [] });
  test.info().annotations.push({ type: 'mission-gate', description: JSON.stringify(gate) });
  return errors;
}

async function canPlayFixture(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const v = document.createElement('video');
    return v.canPlayType('video/mp4; codecs="avc1.640028"') !== '' || v.canPlayType('video/webm; codecs="vp09.00.40.08"') !== '';
  });
}

test.describe('cutscene player @cutscene', () => {
  // A clip that is slow to its first frame on a loaded runner falls back (start_stall, section D7); one retry keeps the video tests honest.
  test.describe.configure({ timeout: 240_000, retries: 1 });
  // A failed try keeps what the player did (requests, answers, telemetry) and its state beside the trace, which records neither.
  test.afterEach(async ({ page }, info) => {
    if (info.status === info.expectedStatus) return;
    const body = await page
      .evaluate(() => {
        const w = window as unknown as Partial<W>;
        return JSON.stringify({ log: w.__dvBridge?.cutscene?.log() ?? null, state: w.__dvBridge?.cutscene?.state() ?? null, gate: w.__dvBridge?.missionGate?.state() ?? null });
      })
      .catch((e: unknown) => JSON.stringify({ error: String(e) }));
    await info.attach('cutscene-log', { body, contentType: 'application/json' });
  });

  test('route 27 absent: the fallback starts within 2.5 s, subtitles show, no AI chip, the mission resumes with the end marks applied @cutscene', async ({ page }) => {
    const errors = await boot(page, 'absent');
    await expect.poll(async () => answer(await log(page), 'fallback') !== undefined, { timeout: 60_000, intervals: [200] }).toBe(true);
    const entries = await log(page);
    const request = entries.find((e) => e.k === 'request');
    const fallback = answer(entries, 'fallback');
    expect(request?.refs).toEqual(['cut.story.m.dev.sample.intro']);
    expect(fallback?.cmd?.trigger).toBe('not_ready');
    const answerMs = (fallback as LogEntry).at - (request as LogEntry).at;
    test.info().annotations.push({ type: 'answer-ms', description: String(Math.round(answerMs)) });
    expect(answerMs).toBeLessThanOrEqual(2500);
    expect(answer(entries, 'video')).toBeUndefined();

    // a subtitle of the beat shows over the live world, with no AI chip and no video. Either of the two cues counts: on a slow runner each
    // bridge read takes a second, and the first cue alone is on screen for 2.6 s (integration, M05b2 merge onto the M02e world).
    await expect.poll(() => cut(page, (c) => c.subtitle()), { timeout: 60_000, intervals: [50] }).toMatch(/Hold on|Right\. Let me/);
    expect(await cut(page, (c) => c.aiChip())).toBe(false);
    expect(await cut(page, (c) => c.hasVideo())).toBe(false);
    // the in-engine fallback draws the world under its cues (BD-FIX-CI10-R01)
    expect((await cut(page, (c) => c.state())).host).toMatchObject({ cues: true, held: null });

    // the sim finishes the beat (end marks applied) and the mission goes on
    await expect.poll(async () => (await log(page)).some((e) => e.k === 'done'), { timeout: 120_000, intervals: [250] }).toBe(true);
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('stage');
    const events = await page.evaluate(() => (window as unknown as W).__dvBridge.mission.events().map((e) => e.t));
    expect(events).toContain('cut.request');
    expect(events).toContain('beat.done');
    const done = answer(await log(page), 'done');
    expect(done?.cmd?.outcome).toMatchObject({ path: 'fallback', trigger: 'not_ready' });
    const play = (await log(page)).find((e) => e.k === 'play');
    expect(play?.props).toMatchObject({ path: 'fallback', trigger: 'not_ready', fallback: true });
    expect(play?.props).not.toHaveProperty('reason');
    expect(skipInputs(await log(page))).toEqual([]);
    expect(await cut(page, (c) => c.state())).toMatchObject({ host: { visible: false, cues: false } });
    expect(errors).toEqual([]);
  });

  test('?beats=fallback answers fallback at once without asking route 27 @cutscene', async ({ page }) => {
    let asked = 0;
    await page.route('**/api/v1/cutscenes/*', (r) => (asked++, r.abort()));
    const errors = await boot(page, null, '&beats=fallback');
    await expect.poll(async () => answer(await log(page), 'fallback') !== undefined, { timeout: 60_000, intervals: [200] }).toBe(true);
    expect(asked).toBe(0);
    await expect.poll(() => phase(page), { timeout: 120_000 }).toBe('stage');
    expect(errors).toEqual([]);
  });

  test('route 27 ready with the fixture manifest: the clip plays with the AI chip and subtitles, and Escape skips it @cutscene', async ({ page }) => {
    await page.goto('about:blank');
    test.skip(!(await canPlayFixture(page)), 'this browser plays neither fixture codec');
    const errors = await boot(page, 'ready');
    await expect.poll(() => cut(page, (c) => c.hasVideo()), { timeout: 60_000, intervals: [100] }).toBe(true);
    await noteVideoMs(page);
    const entries = await log(page);
    expect(answer(entries, 'video')).toBeDefined();
    expect(answer(entries, 'fallback')).toBeUndefined();
    expect(await cut(page, (c) => c.aiChip())).toBe(true);
    await expect.poll(() => cut(page, (c) => c.subtitle()), { timeout: 30_000, intervals: [100] }).toContain('Hold on');
    // the clip covers the screen and the sim waits behind it; the world it hides is not drawn (the loop is stopped, BD-FIX-CI10-R01)
    const st = await cut(page, (c) => c.state());
    expect(st.host.visible).toBe(true);
    expect(st.host.held).toBe('stopped');
    expect(st.simPaused).toBe(true);
    test.info().annotations.push({ type: 'held-frames', description: String(st.heldFrames) });

    await page.keyboard.press('Escape');
    await expect.poll(async () => answer(await log(page), 'done') !== undefined, { timeout: 30_000, intervals: [100] }).toBe(true);
    const done = answer(await log(page), 'done');
    expect(done?.cmd?.outcome).toMatchObject({ path: 'video', skipped: true });
    expect(skipInputs(await log(page))).toEqual(['key:keydown']);
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('stage');
    expect(await cut(page, (c) => c.state())).toMatchObject({ host: { visible: false, held: null }, simPaused: false });
    expect((await log(page)).find((e) => e.k === 'play')?.props).toMatchObject({ path: 'video', fallback: false });
    expect(errors).toEqual([]);
  });

  test('?beats=video plays the fixture clip without route 27 @cutscene', async ({ page }) => {
    await page.goto('about:blank');
    test.skip(!(await canPlayFixture(page)), 'this browser plays neither fixture codec');
    const errors = await boot(page, null, '&beats=video');
    await expect.poll(() => cut(page, (c) => c.hasVideo()), { timeout: 60_000, intervals: [100] }).toBe(true);
    await noteVideoMs(page);
    expect(await cut(page, (c) => c.aiChip())).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('stage');
    expect(skipInputs(await log(page))).toEqual(['key:keydown']);
    expect(answer(await log(page), 'done')?.cmd?.outcome).toMatchObject({ path: 'video', skipped: true });
    expect(errors).toEqual([]);
  });

  test('a press held from before the clip does not skip it when it is let go; a tap on the clip does @cutscene', async ({ page }) => {
    await page.goto('about:blank');
    test.skip(!(await canPlayFixture(page)), 'this browser plays neither fixture codec');
    const errors = await boot(page, null, '&beats=video', { holdPointer: true });
    await expect.poll(() => cut(page, (c) => c.hasVideo()), { timeout: 60_000, intervals: [100] }).toBe(true);
    // the press began before the clip covered the screen: letting it go over the overlay is not a skip (section D7, R-ENG-04)
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(skipInputs(await log(page))).toEqual([]);
    expect(answer(await log(page), 'done')).toBeUndefined();
    expect(await cut(page, (c) => c.hasVideo())).toBe(true);
    // a whole tap on the clip skips it
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => answer(await log(page), 'done') !== undefined, { timeout: 30_000, intervals: [100] }).toBe(true);
    expect(answer(await log(page), 'done')?.cmd?.outcome).toMatchObject({ path: 'video', skipped: true });
    expect(skipInputs(await log(page))).toEqual(['tap:pointerup']);
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('stage');
    expect(errors).toEqual([]);
  });

  test('a clip whose first element cannot decode it plays on the next pooled element @cutscene', async ({ page }) => {
    await page.goto('about:blank');
    test.skip(!(await canPlayFixture(page)), 'this browser plays neither fixture codec');
    // The first load of the rendition answers bytes no decoder takes (section D7: `codec` and `media_error` go to the next host before
    // the fallback; BD-FIX-CUTFLAKE-01). Every later request of it gets the real file.
    let broken = 0;
    await page.route('**/media-local/cutscenes/fixture-a/v768.mp4', (r: Route) => {
      if (broken > 0) return r.fallback();
      broken++;
      return r.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(4096, 0x5a) });
    });
    const errors = await boot(page, null, '&beats=video');
    await expect.poll(() => cut(page, (c) => c.hasVideo()), { timeout: 60_000, intervals: [100] }).toBe(true);
    const entries = await log(page);
    expect(broken).toBe(1);
    expect(entries.filter((e) => e.k === 'next-host').map((e) => e.trigger)).toEqual([
      expect.stringMatching(/^(codec|media_error)$/),
    ]);
    expect(answer(entries, 'video')).toBeDefined();
    expect(answer(entries, 'fallback')).toBeUndefined();
    await page.keyboard.press('Escape');
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('stage');
    expect(answer(await log(page), 'done')?.cmd?.outcome).toMatchObject({ path: 'video', skipped: true });
    expect((await log(page)).filter((e) => e.k === 'play').map((e) => e.props)).toEqual([expect.objectContaining({ path: 'video', fallback: false })]);
    expect(errors).toEqual([]);
  });

  test('a stall injected after 1 s: the overlay holds last.webp and the fallback finishes the beat @cutscene', async ({ page }) => {
    await page.goto('about:blank');
    test.skip(!(await canPlayFixture(page)), 'this browser plays neither fixture codec');
    const errors = await boot(page, 'ready');
    await expect.poll(() => cut(page, (c) => c.hasVideo()), { timeout: 60_000, intervals: [100] }).toBe(true);
    await page.waitForTimeout(1000);
    expect(await cut(page, (c) => c.stall())).toBe(true);

    // 1.5 s of waiting: the clip gives way to its last frame, and the sim runs the DirectorScript behind it
    await expect.poll(() => cut(page, (c) => c.stillSrc()), { timeout: 15_000, intervals: [100] }).toMatch(/last\.webp$/);
    const stalled = answer(await log(page), 'fallback');
    expect(stalled?.cmd?.trigger).toBe('mid_stall');
    // the sim runs the DirectorScript behind the opaque still, which keeps the world from being drawn (BD-FIX-CI10-R01)
    expect(await cut(page, (c) => c.state())).toMatchObject({ simPaused: false, host: { held: 'cover' } });
    expect(await cut(page, (c) => c.hasVideo())).toBe(false);

    await expect.poll(async () => (await log(page)).some((e) => e.k === 'done'), { timeout: 120_000, intervals: [250] }).toBe(true);
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('stage');
    expect(await cut(page, (c) => c.state())).toMatchObject({ host: { visible: false, held: null } });
    expect((await log(page)).find((e) => e.k === 'play')?.props).toMatchObject({ path: 'fallback', trigger: 'mid_stall' });
    expect(skipInputs(await log(page))).toEqual([]);
    await noteVideoMs(page);
    expect(errors).toEqual([]);
  });

  test('?beats=instant completes the beat without a request @cutscene', async ({ page }) => {
    const errors = await boot(page, null, '&beats=instant');
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('stage');
    expect((await log(page)).some((e) => e.k === 'request')).toBe(false);
    expect(errors).toEqual([]);
  });
});

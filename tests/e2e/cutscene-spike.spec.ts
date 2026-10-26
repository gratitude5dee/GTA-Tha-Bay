import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { serveMediaRanges } from './media-ranges.ts';

/**
 * M04c AC-6 (@cutscene): the flat cutscene path on the QA page /qa/cutscene-spike.html. The assertions read
 * `__dvBridge.media.state()` and the DOM, never pixels. WebKit on Linux may decode neither fixture codec: that project (and any project
 * where `canPlayType` accepts neither rendition) feeds the same host from `canvas.captureStream(24)` (BD-M04c-04). The codec results
 * and the blank-clip outcome go to test-results/codecs.<project>.json (U-REC-1, U-PLT-17).
 */
interface Media {
  state(): Record<string, unknown> & { unlocked: boolean; pool: number; blank: string; errors: unknown[]; loop: { running: boolean; frames: number }; crossOriginIsolated: boolean; host: { visible: boolean }; simPaused: boolean };
  play(id: string): Promise<{ path: string; skipped: boolean; trigger?: string }>;
  skip(): Promise<{ path: string; skipped: boolean; trigger?: string }>;
  sequence(ids: string[]): Promise<Record<string, unknown>>;
  useCanvasSource(on: boolean): void;
  subtitle(): string;
  aiChip(): boolean;
}
type W = { __dvBridge?: { media?: Media } };

const media = <T>(page: Page, fn: (m: Media) => T | Promise<T>): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dvBridge.media)`) as Promise<T>;

async function open(page: Page): Promise<void> {
  await page.goto('/qa/cutscene-spike.html');
  await page.waitForFunction(() => (window as unknown as W).__dvBridge?.media !== undefined, undefined, { timeout: 30_000 });
}

test.describe('@cutscene', () => {
  // The fixture renditions answer `Range` as the production media route does; the local Worker's asset server does not (BD-FIX-CUTFLAKE-01).
  test.beforeEach(async ({ page }) => serveMediaRanges(page));
  test('before the gesture: fallback not_permitted; after it: pool of 3, video plays, cue and chip show, skip within 300 ms', async ({ page }, info) => {
    await open(page);

    // AC-6: before any gesture the pool is empty and play falls back with not_permitted.
    expect(await media(page, (m) => m.state().pool)).toBe(0);
    const early = await media(page, (m) => m.play('fixture-a'));
    expect(early).toMatchObject({ path: 'fallback', trigger: 'not_permitted' });

    await page.getByTestId('title-start').click();
    await page.waitForFunction(() => (window as unknown as W).__dvBridge?.media?.state().unlocked === true, undefined, { timeout: 15_000 });
    const st = await media(page, (m) => m.state());
    expect(st.pool).toBe(3);

    // Codec facts for U-REC-1 and the blank-clip outcome for U-PLT-17.
    const codecs = await page.evaluate(() => {
      const v = document.createElement('video');
      return {
        mp4: v.canPlayType('video/mp4; codecs="avc1.640028"'),
        webm: v.canPlayType('video/webm; codecs="vp09.00.40.08"'),
        webmShort: v.canPlayType('video/webm; codecs="vp9"'),
      };
    });
    mkdirSync('test-results', { recursive: true });
    writeFileSync(`test-results/codecs.${info.project.name}.json`, `${JSON.stringify({ project: info.project.name, canPlayType: codecs, blank: st.blank, errors: st.errors, audio: st.audio }, null, 2)}\n`);

    // Neither fixture codec decodes (WebKit on Linux): the same host runs on the canvas source.
    const canvasMode = codecs.mp4 === '' && codecs.webm === '';
    if (canvasMode) await media(page, (m) => m.useCanvasSource(true));

    const started = await media(page, (m) => m.play('fixture-a'));
    expect(started.path).toBe('video');
    expect(await media(page, (m) => m.state().host.visible)).toBe(true);

    // The element plays: currentTime passes 1 s.
    await page.waitForFunction(() => ((document.querySelector('[data-testid="cutscene-host"] video') as HTMLVideoElement | null)?.currentTime ?? 0) > 1, undefined, { timeout: 15_000 });
    // Cue 1 text (the fixture's first cue) and the AI chip. The canvas source has no cues of its own: the overlay clock is the element's.
    await expect(page.getByTestId('cutscene-subtitle')).toHaveText('Fixture A, first cue.');
    expect(await media(page, (m) => m.aiChip())).toBe(true);
    // The render loop is stopped while the clip covers the canvas.
    const f0 = await media(page, (m) => m.state().loop.frames);
    await page.waitForTimeout(300);
    expect(await media(page, (m) => m.state().loop)).toMatchObject({ running: false, frames: f0 });

    const t0 = Date.now();
    const done = await media(page, (m) => m.skip());
    expect(Date.now() - t0).toBeLessThan(300);
    expect(done).toMatchObject({ path: 'video', skipped: true });

    // Released: no covering host, the pooled element has no src, the loop runs again, isolation holds.
    const after = await media(page, (m) => m.state());
    expect(after.host.visible).toBe(false);
    expect(after['free']).toBe(3);
    await page.waitForFunction((n) => ((window as unknown as W).__dvBridge?.media?.state().loop.frames ?? 0) > n + 3, f0, { timeout: 5000 });
    expect(await media(page, (m) => m.state().loop.running)).toBe(true);
    expect(after.crossOriginIsolated).toBe(true);
    expect(await page.evaluate(() => document.querySelector('[data-testid="cutscene-host"]'))).toBeNull();
  });

  test('Escape skips the clip once', async ({ page }) => {
    await open(page);
    await page.getByTestId('title-start').click();
    await page.waitForFunction(() => (window as unknown as W).__dvBridge?.media?.state().unlocked === true, undefined, { timeout: 15_000 });
    const canvasMode = await page.evaluate(() => {
      const v = document.createElement('video');
      return v.canPlayType('video/mp4; codecs="avc1.640028"') === '' && v.canPlayType('video/webm; codecs="vp09.00.40.08"') === '';
    });
    if (canvasMode) await media(page, (m) => m.useCanvasSource(true));
    const started = await media(page, (m) => m.play('fixture-b'));
    expect(started.path).toBe('video');
    await page.waitForFunction(() => document.querySelector('[data-testid="cutscene-skip"]') !== null);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as unknown as W).__dvBridge?.media?.state().host.visible === false, undefined, { timeout: 2000 });
    expect(await media(page, (m) => m.state().loop.running)).toBe(true);
  });

  test('the canvas source feeds the same host (no codec)', async ({ page }) => {
    await open(page);
    await page.getByTestId('title-start').click();
    await page.waitForFunction(() => (window as unknown as W).__dvBridge?.media?.state().unlocked === true, undefined, { timeout: 15_000 });
    await media(page, (m) => m.useCanvasSource(true));
    expect((await media(page, (m) => m.play('fixture-b'))).path).toBe('video');
    await page.waitForFunction(() => ((document.querySelector('[data-testid="cutscene-host"] video') as HTMLVideoElement | null)?.currentTime ?? 0) > 0.5, undefined, { timeout: 15_000 });
    expect(await media(page, (m) => m.skip())).toMatchObject({ path: 'video', skipped: true });
    expect(await media(page, (m) => m.state().host.visible)).toBe(false);
  });

  test('on the game page F9 plays the clip over the world and Escape returns to it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as W).__dvBridge?.media !== undefined, undefined, { timeout: 60_000 });
    expect(await media(page, (m) => m.state().simPaused)).toBe(false);
    await page.keyboard.press('F9');
    await page.waitForFunction(() => document.querySelector('[data-testid="cutscene-host"] video') !== null, undefined, { timeout: 45_000 });
    expect(await media(page, (m) => m.state().simPaused)).toBe(true);
    await expect(page.getByTestId('cutscene-ai-chip')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as unknown as W).__dvBridge?.media?.state().host.visible === false, undefined, { timeout: 3000 });
    expect(await media(page, (m) => m.state().simPaused)).toBe(false);
  });

  test('sequence records isTypeSupported for both types on the class it used', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'WebKit on Linux has no MediaSource worth measuring; the iPhone run does this on device');
    test.setTimeout(90_000);
    await open(page);
    await page.getByTestId('title-start').click();
    await page.waitForFunction(() => (window as unknown as W).__dvBridge?.media?.state().unlocked === true, undefined, { timeout: 15_000 });
    const r = await media(page, (m) => m.sequence(['fixture-a', 'fixture-b']));
    info.annotations.push({ type: 'sequence', description: JSON.stringify(r) });
    console.log('sequence', JSON.stringify(r));
    expect(r['cls']).toBe('MediaSource');
    expect(r['support']).toHaveProperty('mp4');
    expect(r['support']).toHaveProperty('webm');
    if (r['skipped'] === undefined) expect(r['sequenceAccepted']).toBe(true);
  });
});

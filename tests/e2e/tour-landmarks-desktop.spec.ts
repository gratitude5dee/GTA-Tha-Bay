import { expect, test } from '@playwright/test';
import { boot, SKYLINE, shown, teleport, world } from './world-landmarks-helpers.ts';

/**
 * The desktop cases of the M02d1 and M02d2 landmarks (`world-landmarks.spec.ts` holds the rest), on a `DV_WORLD=synth` QA build. They are
 * the longest of the landmark cases on software GL (about 22, 14 and 9 minutes on CI after M10d1's art), and a shard is cut out of the
 * sorted file names by test count, so they sit in a file of their own whose name sorts into a lighter shard (BD-FIX-CI-SHARD8-02). The
 * titles and tags are those of `world-landmarks.spec.ts`, so `--grep @world-landmarks` selects all of them as before. The twelve
 * landmarks at desktop, the longest of them, is in `marquee-landmarks-desktop.spec.ts`, whose name sorts into another shard
 * (BD-FIX-CI-SHARD6-01: this file shared shard 6 with the 37-minute desktop junction flicker pair).
 */

test.describe('landmarks @world', () => {
  test.describe.configure({ timeout: 1_800_000 });

  // the twelve at desktop is in marquee-landmarks-desktop.spec.ts (BD-FIX-CI-SHARD6-01)
  test('the skyline is up in the default scene at desktop: all seven far silhouettes are drawn as lo models, outside the cap @m02d2 @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'desktop');
    await expect
      .poll(async () => ((await world(page, (w) => w.landmarks()))?.skyline.entries ?? []).filter((e) => e.visible).length, { timeout: 180_000, intervals: [500, 1000, 2000] })
      .toBe(7);
    await world(page, (w) => w.settle(60_000));
    const r = (await world(page, (w) => w.landmarks()))!;
    console.log(`world-landmarks skyline desktop: ${JSON.stringify(r.skyline.entries.map((e) => ({ id: e.id, d: Math.round(e.distM), fid: e.fidelity, tris: e.triangles, visible: e.visible })))}`);
    expect(r.skyline.entries.map((e) => e.id)).toEqual([...SKYLINE].sort());
    for (const e of r.skyline.entries) {
      expect(e.fidelity, e.id).toBe('lo');
      expect(e.phase, e.id).toBe('shown');
      expect(e.hiddenBy, e.id).toBeNull();
      expect(e.distM, e.id).toBeLessThanOrEqual(r.skyline.rangeM);
    }
    // City Hall, the spawn, is a full-fidelity landmark; the skyline is not counted against the cap
    expect(shown(r)).toContain('lm.city-hall');
    expect(r.resident.length).toBeLessThanOrEqual(r.cap);
    expect(r.failed).toEqual([]);
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/world-landmarks/skyline-default-desktop.png' });
    await page.keyboard.press('F4');
    await page.keyboard.down('Shift');
    await page.keyboard.down('Space');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Space');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'test-results/world-landmarks/skyline-city-hall-free-cam-desktop.png' });
    await page.keyboard.press('F4');
    // and from Twin Peaks, the overlook: the whole skyline is in front of the camera
    const tp = await teleport(page, 'lm.twin-peaks');
    expect(tp.ok).toBe(true);
    await expect.poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000] }).toContain('lm.twin-peaks');
    await world(page, (w) => w.settle(60_000));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/world-landmarks/skyline-twin-peaks-desktop.png' });
    // the free camera (F4) lifts the view above the roofs: the picture the owner looks at (see packages/world/README.md)
    await page.keyboard.press('F4');
    await page.keyboard.down('Shift');
    await page.keyboard.down('Space');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Space');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'test-results/world-landmarks/skyline-twin-peaks-free-cam-desktop.png' });
    await page.keyboard.press('F4');
    const tr = (await world(page, (w) => w.landmarks()))!;
    expect(tr.skyline.entries.filter((e) => e.distM <= tr.skyline.rangeM).every((e) => e.visible || e.hiddenBy === 'full')).toBe(true);
    expect(tr.frames.holes).toBe(0);
    expect(errors).toEqual([]);
  });

  test('five of the new landmarks at desktop: hi models within their class budget, the cap of eight holds @m02d2 @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'desktop');
    for (const id of ['lm.painted-ladies', 'lm.fort-point', 'lm.hunters-point-yard', 'lm.flower-conservatory', 'lm.saint-mary-cathedral']) {
      const result = await teleport(page, id);
      expect(result.ok, `${id}: ${JSON.stringify(result)}`).toBe(true);
      await expect
        .poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000], message: id })
        .toContain(id);
      const r = (await world(page, (w) => w.landmarks()))!;
      const e = r.resident.find((x) => x.id === id)!;
      console.log(`world-landmarks desktop ${id}: ${e.fidelity} ${e.objects} objects ${e.triangles} tris`);
      expect(e.fidelity).toBe('hi');
      expect(e.objects).toBeLessThanOrEqual(3);
      expect(r.resident.length).toBeLessThanOrEqual(8);
      expect(r.failed).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

import { expect, test } from '@playwright/test';

// C05 rule 1 in a real browser: sim.worker writes the sandbox slot in a loop on IndexedDB `dv-saves`, the page is
// closed in the middle of the loop, and a fresh page loads the profile. The generation the worker loads must have a
// valid checksum and equal what the main thread's read-only status line reports.
// WebKit's IndexedDB durability under a killed process (U-ENG-9) is recorded on a device in M11a1, never asserted here.

interface Verify {
  profileId: string;
  persistent: boolean;
  n: number | null;
  gen: number | null;
  checksum: string | null;
  fellBack: boolean;
  lastSaveError: string | null;
}
interface MainInfo {
  gen: number;
  checksum: string;
  status: { ok: boolean };
}
type Qa = Record<string, unknown>;
type W = { __dvBridge: { engine: { qa: Qa } } };

test.describe('save kill @save-kill', () => {
  test('closing the page mid-loop leaves a loadable last good generation that the status line matches @save-kill', async ({ context }) => {
    test.setTimeout(120_000);
    const loop = await context.newPage();
    loop.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
    await loop.goto('/qa/save-kill.html?phase=loop');
    await loop.waitForFunction(() => Number(document.documentElement.dataset['dvSaveGen'] ?? '0') >= 20, null, { timeout: 60_000 });
    const before = Number(await loop.evaluate(() => document.documentElement.dataset['dvSaveGen']));
    await loop.close(); // the worker dies with the page, wherever the loop happens to be

    const verify = await context.newPage();
    verify.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
    await verify.goto('/qa/save-kill.html?phase=verify');
    await verify.waitForSelector('html[data-dv-save-kill="done"]', { state: 'attached', timeout: 60_000 });
    const qa = await verify.evaluate(() => (window as unknown as W).__dvBridge.engine.qa);
    const v = qa['save-verify'] as Verify;
    const main = qa['save-main'] as MainInfo | null;

    expect(v.persistent).toBe(true);
    expect(v.lastSaveError).toBeNull();
    expect(v.gen).toBeGreaterThanOrEqual(before);
    expect(v.checksum).toMatch(/^[0-9a-f]{16}$/);
    expect(v.n).toBe(v.gen); // the loop counter and the generation advance together on a fresh profile
    expect(main).not.toBeNull();
    expect(main?.status.ok).toBe(true);
    expect({ gen: main?.gen, checksum: main?.checksum }).toEqual({ gen: v.gen, checksum: v.checksum });
    expect(qa['save-match']).toBe(true);
    await verify.close();

    // The loop resumes from the stored counter, so the next generation continues the line.
    const again = await context.newPage();
    await again.goto('/qa/save-kill.html?phase=loop');
    await again.waitForFunction((g) => Number(document.documentElement.dataset['dvSaveGen'] ?? '0') > g, v.gen as number, { timeout: 60_000 });
    await again.close();
  });
});

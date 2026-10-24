import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * M09a1 AC-9, @tycoon-det: the recorded Business Tycoon runs (three seeds, 150 weeks each) replay in this browser's JS engine,
 * through `window.__dvBridge.tycoon.runDet` (QA builds, `?tycoon=1`), to the final state hashes of the Node golden
 * `tests/golden/tycoon/det-001.json`. Chromium and WebKit run the same pure core on the same choices; the hashes are exact.
 *
 * To see it by hand: open `/?tycoon=1` on a QA build and run `__dvBridge.tycoon.runDet(runs)` with the `runs` of the golden file.
 */
interface DetGolden {
  v: 1;
  contentVersion: string;
  runs: { seed: number; weeks: number; setup: unknown; choices: unknown[]; finalHash: string; endWeek: number }[];
}

const golden = JSON.parse(readFileSync(new URL('../../golden/tycoon/det-001.json', import.meta.url), 'utf8')) as DetGolden;

test.describe('tycoon determinism @tycoon-det', () => {
  test('three recorded runs end in the Node golden hashes in this browser @tycoon-det', async ({ page, browserName }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?tycoon=1&world=walk-drop');
    await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { tycoon?: unknown } }).__dvBridge?.tycoon), undefined, { timeout: 150_000 });
    const out = await page.evaluate(
      (runs) => (window as unknown as { __dvBridge: { tycoon: { runDet(r: unknown): { seed: number; finalHash: string; endWeek: number }[] } } }).__dvBridge.tycoon.runDet(runs),
      golden.runs,
    );
    console.log(`${testInfo.project.name} (${browserName}): ${out.map((o) => `${o.seed}:${o.finalHash}@${o.endWeek}`).join(' ')}`);
    expect(out.map((o) => o.finalHash)).toEqual(golden.runs.map((r) => r.finalHash));
    expect(out.map((o) => o.endWeek)).toEqual(golden.runs.map((r) => r.endWeek));
    expect(errors).toEqual([]);
  });
});

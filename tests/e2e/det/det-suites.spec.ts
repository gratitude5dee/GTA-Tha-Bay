/**
 * Runs every `RunSpec` of `suites.ts` in the determinism page and compares the browser's trace with the Node golden,
 * checkpoint by checkpoint (M04d AC-4). On a `DV_WORLD=synth` build the page must still fetch no `world_pack/*` through the
 * catalog: the fixture bytes come from the committed file (DL-699).
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DET_SUITES, isRuns } from './suites.ts';

interface Trace {
  v: 1;
  spec: unknown;
  build: string;
  checkpoints: { tick: number; hash: string }[];
  end: { tick: number; hash: string; outcome: string };
}

const toBase64Url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');

for (const suite of DET_SUITES) {
  if (!isRuns(suite)) continue;
  test.describe(`det suite ${suite.tag}`, () => {
    for (const run of suite.runs) {
      test(`${run.name} equals the Node golden ${suite.tag}`, async ({ page }, testInfo) => {
        test.setTimeout(240_000);
        const requests: string[] = [];
        page.on('request', (r) => requests.push(r.url()));
        page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));

        await page.goto(`/qa/determinism.html?run=${toBase64Url(JSON.stringify(run.spec))}`);
        await page.waitForSelector('html[data-dv-qa-run="done"]', { state: 'attached', timeout: 200_000 });
        const out = await page.evaluate(() => {
          const qa = (window as unknown as { __dvBridge?: { engine?: { qa: Record<string, unknown> } } }).__dvBridge?.engine?.qa;
          return { trace: (qa?.['trace'] ?? null) as unknown, error: (qa?.['error'] ?? null) as unknown };
        });
        expect(out.error, 'the page reported no error').toBeNull();
        const trace = out.trace as Trace;
        expect(trace, 'the page published a trace').not.toBeNull();

        const want = JSON.parse(readFileSync(new URL(`../../../${run.golden}`, import.meta.url), 'utf8')) as Trace;
        console.log(`${testInfo.project.name}: ${run.name} end ${trace.end.tick} ${trace.end.hash}`);
        expect(trace.spec).toEqual(want.spec);
        expect(trace.checkpoints.length).toBe(want.checkpoints.length);
        for (let i = 0; i < want.checkpoints.length; i++) {
          expect(trace.checkpoints[i], `checkpoint ${i}`).toEqual(want.checkpoints[i]);
        }
        expect(trace.end).toEqual(want.end);

        const catalog = requests.filter((u) => /world_pack|asset-catalog|media-local/.test(u));
        expect(catalog, 'no world pack or catalog fetch').toEqual([]);
      });
    }
  });
}

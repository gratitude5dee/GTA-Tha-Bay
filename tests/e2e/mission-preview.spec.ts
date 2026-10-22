/**
 * @mission-preview (M05a2 AC-8): the QA scrub page shows a recorded run. `pnpm missions:preview -- --mission m.dev.sample --seed 1`
 * writes `test-results/preview/m.dev.sample.1.dvtl` (this spec runs it when the file is missing); the page decodes it, lists one
 * chapter per `mis.stage` event, and at a scrubbed tick shows the stage, the recorded player pose (`lastBefore`) and the `mis.say`
 * subtitle that is showing. Needs a QA build (`VITE_DV_QA=1`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { decodeDvtl, lastBefore } from '../../packages/engine/src/sim/script/dvtl.ts';

const FILE = fileURLToPath(new URL('../../test-results/preview/m.dev.sample.1.dvtl', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test.beforeAll(() => {
  if (!existsSync(FILE)) execFileSync('pnpm', ['missions:preview', '--', '--mission', 'm.dev.sample', '--seed', '1'], { cwd: ROOT, stdio: 'ignore', timeout: 240_000 });
});

const recorded = (): ReturnType<typeof decodeDvtl> => decodeDvtl(new Uint8Array(readFileSync(FILE)));

test.describe('mission preview @mission-preview', () => {
  test('lists a chapter per stage, scrubs the tracks and shows the subtitle at its tick', async ({ page }) => {
    const d = recorded();
    const stages = d.events.filter((e) => e.t === 'mis.stage');
    expect(stages.length).toBeGreaterThan(10);

    await page.goto('/qa/mission-preview.html');
    await page.setInputFiles('[data-testid=file]', FILE);
    await expect(page.getByTestId('status')).toHaveAttribute('data-loaded', 'true');
    await expect(page.getByTestId('status')).toContainText('m.dev.sample seed 1 pass');

    // one chapter button per mis.stage event, in order, at its tick
    const chapters = page.getByTestId('chapters').locator('button');
    await expect(chapters).toHaveCount(stages.length);
    for (let i = 0; i < stages.length; i++) {
      const e = stages[i] as (typeof stages)[number];
      await expect(chapters.nth(i)).toHaveAttribute('data-tick', String(e.tick));
      await expect(chapters.nth(i)).toHaveAttribute('data-id', String((e.data as { id: string }).id));
    }

    // a chapter jumps the scrubber to its tick and names its stage
    const third = stages[3] as (typeof stages)[number];
    await chapters.nth(3).click();
    await expect(page.getByTestId('scrub')).toHaveValue(String(third.tick));
    await expect(page.getByTestId('stage')).toHaveText(`3 ${(third.data as { id: string }).id}`);
    await expect(chapters.nth(3)).toHaveAttribute('aria-current', 'true');

    // the player pose at a tick is the last recorded sample at or before it
    const player = d.tracks.find((t) => t.name === 'player');
    expect(player).toBeDefined();
    for (const tick of [0, 333, 2500, 6001, d.endTick]) {
      await page.evaluate((t) => (window as unknown as { __dvBridge: { preview: { setTick(n: number): void } } }).__dvBridge.preview.setTick(t), tick);
      const i = lastBefore(player?.ticks ?? [], tick);
      const shown = await page.getByTestId('pos').getAttribute('data-pos');
      if (i < 0) expect(shown).toBeNull();
      else expect(JSON.parse(shown as string)).toEqual([player?.pos[i * 3], player?.pos[i * 3 + 1], player?.pos[i * 3 + 2]]);
    }

    // a mis.say at its tick is the subtitle; before and after it there is none
    const say = d.events.find((e) => e.t === 'mis.say' && (e.data as { line?: string }).line === 'line.m.dev.sample.hello');
    expect(say, 'the recorded run has the first scripted line').toBeDefined();
    await page.evaluate((t) => (window as unknown as { __dvBridge: { preview: { setTick(n: number): void } } }).__dvBridge.preview.setTick(t), (say?.tick ?? 0) + 10);
    await expect(page.getByTestId('subtitle')).toHaveAttribute('data-line', 'line.m.dev.sample.hello');
    await expect(page.getByTestId('subtitle')).not.toHaveText('');
    await page.evaluate(() => (window as unknown as { __dvBridge: { preview: { setTick(n: number): void } } }).__dvBridge.preview.setTick(1));
    await expect(page.getByTestId('subtitle')).toHaveAttribute('data-line', '');
  });

  test('the bare URL shows the bundled recording of the sample', async ({ page }) => {
    await page.goto('/qa/mission-preview.html');
    await expect(page.getByTestId('status')).toHaveAttribute('data-loaded', 'true');
    await expect(page.getByTestId('status')).toContainText('m.dev.sample seed 1 pass');
    await expect(page.getByTestId('chapters').locator('button')).toHaveCount(16);
  });

  test('loads the file from ?timeline=<url>', async ({ page }) => {
    await page.route((u) => u.pathname === '/qa-preview/run.dvtl', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: readFileSync(FILE) }));
    await page.goto('/qa/mission-preview.html?timeline=/qa-preview/run.dvtl');
    await expect(page.getByTestId('status')).toHaveAttribute('data-loaded', 'true');
    await expect(page.getByTestId('chapters').locator('button')).toHaveCount(recorded().events.filter((e) => e.t === 'mis.stage').length);
  });
});

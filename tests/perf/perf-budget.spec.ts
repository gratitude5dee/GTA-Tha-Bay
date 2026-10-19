import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { PerfReport, QualityTierId } from '../../packages/shared/src/index.ts';

/**
 * check:perf (11-platform-perf.md section 9, spec 8). For each flat tier, run the canned scenario on the QA build and write
 * `test-results/perf.<scenario>.<project>.<tier>.json`. The budgets are judged afterwards by `perf-verify --counts-only` in perf-check.ts (a
 * warning on PRs, a failure with `--fail`); this spec only asserts that a report was produced. SwiftShader frame times are never
 * asserted [research/gap-ci-cd-release-assets.md section 4.1].
 */
const budgets = JSON.parse(readFileSync('config/tier-budgets.json', 'utf8')) as { tiers: Record<QualityTierId, { render: { maxRenderObjects: number; maxTriangles: number; maxGpuDrawCmds: number } }> };
const TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];
const SCENARIO = process.env.DV_PERF_SCENARIO ?? 'graybox-walk';
const DURATION_S = Number(process.env.DV_PERF_DURATION_S ?? 6);
const WARMUP_S = Number(process.env.DV_PERF_WARMUP_S ?? 2);

for (const tier of TIERS) {
  test(`${SCENARIO} at ${tier} writes its counts report @perf`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.goto(`/?tier=${tier}&perf=1`);
    await page.waitForFunction(() => (window as unknown as { __dvBridge?: { platform?: unknown } }).__dvBridge?.platform !== undefined, undefined, { timeout: 90_000 });

    // M02b2 (AC-7): the world scenarios run at the sky's most expensive look: 21:30 with rain (night lights, streaks, overlay, wet).
    if (SCENARIO !== 'graybox-walk') {
      await page.waitForFunction(() => (window as unknown as { __dvBridge?: { world?: unknown } }).__dvBridge?.world !== undefined, undefined, { timeout: 150_000 });
      await page.evaluate(() => {
        const world = (window as unknown as { __dvBridge: { world: { setHour(h: number, freeze?: boolean): boolean; setWeather(w: string, blendSec?: number): boolean; rain(v: number | null): void } } }).__dvBridge.world;
        world.setHour(21.5, true);
        world.setWeather('rain', 0);
        world.rain(200);
      });
    }

    const report = (await page.evaluate(
      `window.__dvBridge.platform.perf.run(${JSON.stringify(SCENARIO)}, { durationS: ${DURATION_S}, warmupS: ${WARMUP_S} })`,
    )) as PerfReport;

    mkdirSync('test-results', { recursive: true });
    const file = `test-results/perf.${SCENARIO}.${testInfo.project.name}.${tier}.json`;
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

    const budget = budgets.tiers[tier].render;
    console.log(
      `perf ${testInfo.project.name} ${tier}: backend=${report.backend} frames=${report.frames.count} objects=${report.counts.renderObjectsMax}/${budget.maxRenderObjects} tris=${report.counts.trianglesMax}/${budget.maxTriangles} drawCmds=${String(report.counts.gpuDrawCmdsMax)}`,
    );
    expect(report.tier).toBe(tier);
    expect(report.backend).toBe('webgl2');
    expect(report.frames.count).toBeGreaterThan(0);
    expect(report.counts.renderObjectsMax).toBeGreaterThan(0);
    // The budget comparison is perf-verify --counts-only's job, so a miss is a warning in PR mode and an error with --fail.
    expect(report.errors.gpuLost).toBe(0);
  });
}

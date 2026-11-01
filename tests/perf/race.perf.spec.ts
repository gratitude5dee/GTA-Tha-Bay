import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { PerfReport, QualityTierId } from '../../packages/shared/src/index.ts';
import { perfReportErrors } from '../../tools/ci/perf-verify.ts';
import { tierCaps } from './scenarios/race-common.ts';

/**
 * The racing half of check:perf (M11a1, AC-6). `perf-budget.spec.ts` runs the scenario and writes
 * `test-results/perf.<scenario>.<project>.<tier>.json`; this file runs after it in the same worker and reads the report it just wrote.
 * It checks what is true of a racing run and of no other: the report is schema-valid and names the scenario, the governor was held off,
 * the sprint stood exactly the tier's `tierCaps.rivals` rivals on the grid, and the pursuit reached heat 4 with police on screen.
 * Render objects and triangles are judged against the tier's budget by `perf-verify --counts-only` in tools/ci/perf-check.ts, like every
 * scenario (a warning on PRs, an error with --fail). It does nothing for any other scenario.
 */
const SCENARIO = process.env.DV_PERF_SCENARIO ?? '';
const RACE = new Set(['race-sprint', 'race-pursuit-heat4']);
const TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];

for (const tier of TIERS) {
  test(`${SCENARIO} at ${tier} wrote a valid racing report @perf`, async ({}, testInfo) => {
    test.skip(!RACE.has(SCENARIO), 'only the racing scenarios');
    const file = `test-results/perf.${SCENARIO}.${testInfo.project.name}.${tier}.json`;
    expect(existsSync(file), `${file} is written by perf-budget.spec.ts`).toBe(true);
    const report = JSON.parse(readFileSync(file, 'utf8')) as PerfReport;
    expect(perfReportErrors(report)).toEqual([]);
    expect(report.scenario.id).toBe(SCENARIO);
    expect(report.scenario.pathRef).toBe(`config/perf/paths/${SCENARIO}.json`);
    expect(report.tier).toBe(tier);
    // The governor does not move the knobs under a scenario (unless the page forces it on): the counts never follow CI frame times.
    expect(report.governor).toBe('off');
    expect(report.dynamic).toEqual({ minRenderScale: 1, downgrades: 0, upgrades: 0, tierChanges: 0 });
    if (SCENARIO === 'race-sprint') {
      // the player's car and the tier's field stood on the grid
      expect(report.counts.raceRivals).toBe(tierCaps(tier).rivals);
    } else {
      expect(report.counts.raceHeatMax).toBeGreaterThanOrEqual(4);
      expect(report.counts.racePoliceMax).toBeGreaterThanOrEqual(1);
    }
  });
}

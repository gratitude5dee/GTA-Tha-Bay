import type { Page } from '@playwright/test';
import type { PerfReport, QualityTierId } from '../../../packages/shared/src/index.ts';
import { collectRace, startRacePage } from './race-common.ts';

/**
 * The page side of the perf scenario `race-pursuit-heat4` (M11a1; the camera path is `config/perf/paths/race-pursuit-heat4.json`): the QA
 * pursuit `qa.perf.pursuit` on the street at x = 3100, police on, start heat 4. There are no rivals in a pursuit; the police are the
 * pursuit director's units for heat 4 (9 in all, a helicopter among them). The counts report says the most police units seen at once
 * (`racePoliceMax`) and the highest heat reached (`raceHeatMax`), and the run is judged on render objects and triangles like any other.
 */
export const racePursuitHeat4 = {
  /** Appended to the page URL. */
  query: 'racing=1&unlockAll=1',
  /** Longest a test with this setup may take, ms. */
  timeoutMs: 600_000,
  async setup(page: Page, _ctx: { tier: QualityTierId }): Promise<void> {
    await startRacePage(page, 'qa.perf.pursuit', { rivals: 0, waitPolice: true });
  },
  async collect(page: Page, report: PerfReport): Promise<void> {
    await collectRace(page, report);
  },
};

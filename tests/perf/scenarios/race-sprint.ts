import type { Page } from '@playwright/test';
import type { PerfReport, QualityTierId } from '../../../packages/shared/src/index.ts';
import { collectRace, startRacePage, tierCaps } from './race-common.ts';

/**
 * The page side of the perf scenario `race-sprint` (M11a1; the camera path is `config/perf/paths/race-sprint.json`): the QA sprint
 * `qa.perf.sprint` on the street at x = 3100 with as many rivals as the tier allows (`tierCaps.rivals` of `config/racing.json`: 7 desktop,
 * 2 mobile, 1 mobile-low: BD-M11a1-12). The counts report says how many rivals stood on the grid (`raceRivals`), which `verifyRace` holds to that cap.
 */
export const raceSprint = {
  /** Appended to the page URL. */
  query: 'racing=1&unlockAll=1',
  /** Longest a test with this setup may take, ms (the world boots, the player moves, the race loads, then the run). */
  timeoutMs: 600_000,
  /** The race starts on the default sky; the night rain is set after it, before the window (BD-M11a1-18). */
  lookAfterSetup: true,
  async setup(page: Page, ctx: { tier: QualityTierId }): Promise<void> {
    await startRacePage(page, 'qa.perf.sprint', { rivals: tierCaps(ctx.tier).rivals, waitPolice: false });
  },
  async collect(page: Page, report: PerfReport): Promise<void> {
    await collectRace(page, report);
  },
};

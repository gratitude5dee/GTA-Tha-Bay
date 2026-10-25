import type { Page } from '@playwright/test';
import type { PerfReport } from '../../../packages/shared/src/index.ts';
import type { AgencyQaBridge } from '../../../apps/web/src/qa/npc-agency.ts';

/**
 * The page side of the perf scenario `npc-mission-crowd` (M06c; the camera path is `config/perf/paths/npc-mission-crowd.json`). The page
 * stands 12 named NPCs at the City Hall hub (`npcCast=12`: the five roster NPCs and seven clones with the same schedules and places),
 * the story mode is on for the mission hub (`play=story`), and the run measures what the brains cost per sim tick and how many run at
 * LOD A and B. `setup` waits for the agency bridge and starts a fresh measurement window; `collect` reads the window and puts its
 * figures into `report.counts`, where `verifyNpc` (tools/ci/perf-check.ts) judges the LOD-A maximum against the tier cap of
 * `config/npc.json` and the report records the brain milliseconds (never asserted: SwiftShader times are not a budget).
 */
type W = { __dvBridge: { npcAgency: AgencyQaBridge } };

export const npcMissionCrowd = {
  /** Appended to the page URL. */
  query: 'npcCast=12&play=story',
  /** Longest a test with this setup may take, ms. */
  timeoutMs: 360_000,
  /** Runs after the world has booted and before the runner starts. */
  async setup(page: Page): Promise<void> {
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.npcAgency !== undefined, undefined, { timeout: 120_000 });
    // all 12 are placed (a brain exists for each) before the window opens
    await page.waitForFunction(
      () => {
        const d = (window as unknown as W).__dvBridge.npcAgency.debug();
        return d !== null && d.a + d.b + d.c >= 12;
      },
      undefined,
      { timeout: 120_000 },
    );
    await page.evaluate(() => (window as unknown as W).__dvBridge.npcAgency.perfReset());
    await page.waitForTimeout(500);
  },
  /** Runs after the runner returned its report and before it is written. */
  async collect(page: Page, report: PerfReport): Promise<void> {
    const p = await page.evaluate(() => (window as unknown as W).__dvBridge.npcAgency.debug()?.perf ?? null);
    if (!p) throw new Error('npc-mission-crowd: the agency published no perf block (sys.npc.debug)');
    report.counts.npcBrainsAMax = p.aMax;
    report.counts.npcBrainsBMax = p.bMax;
    report.counts.npcBrainMsMean = p.brainMsMean;
    report.counts.npcBrainMsMax = p.brainMsMax;
    report.counts.npcBrainTicks = p.ticks;
  },
};

import type { Page } from '@playwright/test';

/**
 * The page side of the perf scenario `fight-stage` (M08a2; the path is `config/perf/paths/fight-stage.json`). The page runs the QA demo
 * (`fighter=demo`: Hard against Hard on the Powell turntable, the match restarting when it ends) on the gray-box world, and the run
 * counts what the fight camera frames: the arena, both gray-box fighters, the sparks and the overlay layers. `setup` waits until a
 * round is in progress so the warm-up is spent fighting.
 */
type W = { __dvBridge: { fighter: { state(): Promise<{ match?: { phase?: number } | null } | null> } } };

export const fightStage = {
  /** Appended to the page URL. */
  query: 'fighter=demo&world=walk-drop',
  /** True: the scenario runs on the gray-box world and needs no streamed city. */
  stageOnly: true,
  /** Longest a test with this setup may take, ms. */
  timeoutMs: 300_000,
  async setup(page: Page): Promise<void> {
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.fighter !== undefined, undefined, { timeout: 120_000 });
    await page.waitForFunction(
      async () => {
        const s = await (window as unknown as W).__dvBridge.fighter.state();
        return s?.match?.phase === 3;
      },
      undefined,
      { timeout: 120_000 },
    );
  },
};

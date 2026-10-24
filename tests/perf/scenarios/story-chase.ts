import type { Page } from '@playwright/test';
import type { MissionBridge } from '../../../packages/modes/story/src/debug/bridge.ts';

/**
 * The page side of the perf scenario `story-chase` (M05c2; the camera path is `config/perf/paths/story-chase.json`). The story mode is
 * on (`play=story`, no `story=1`, so no mission starts by itself), the racing hook stubs are on (`hooks=stub`), and once the world is up
 * the page starts the chase through the Jobs command and hands the controls to the story autoplayer, so the pursuit (cruisers, the
 * scripted convoy, the mission VM) runs while the perf runner moves the camera along its path. The counts report is judged like any
 * other flat-tier scenario.
 *
 * The chase is the heat-4 survive stage of m.a1.12 (Lot Number One) when the world has Mission Bay's roads (the sf world on staging and
 * on a device). The synth world of the CI build has none (m.a1.12 does not resolve there: `E_REF_ZONE` at `/cast/ride/spawn`), so
 * there the chase is the sideshow raid of m.a1.03 (heat 2 at the Yard, the racing hook as its escape stub): the same systems at a
 * lower heat. The report says which one ran (`window.__dvChase`).
 */
type Bridge = { __dvBridge: { mission: MissionBridge & { autoplay(on: boolean): boolean }; engine: { modes: { send(cmd: unknown): boolean; vm(key: string): unknown } } } };
type MissionState = { mission?: string; phase?: string } | null;

/** The chases in order of preference: a mission and the stage it is started from. */
export const STORY_CHASES = [
  { mission: 'm.a1.12', startStage: 1 }, // 'lot': enter the car; the survive stage (heat 4) follows
  { mission: 'm.a1.03', startStage: 4 }, // 'raid': heat 2 and the escape stub
] as const;

export const storyChase = {
  /** Appended to the page URL. */
  query: 'play=story&hooks=stub',
  /** Longest a test with this setup may take, ms (the setup waits for the world and the story mode before the run). */
  timeoutMs: 480_000,
  /** Runs after the world has booted and before the runner starts. */
  async setup(page: Page): Promise<void> {
    const state = (): Promise<MissionState> => page.evaluate(() => (window as unknown as Bridge).__dvBridge.mission.state() as MissionState);
    // the mission bridge and the Jobs list (the story mode is attached once the list is published)
    await page.waitForFunction(
      () => {
        const b = (window as unknown as Partial<Bridge>).__dvBridge;
        return b?.mission !== undefined && b.engine?.modes.vm('mode.story.jobs') !== undefined;
      },
      undefined,
      { timeout: 240_000 },
    );
    for (const c of STORY_CHASES) {
      await page.evaluate((id) => (window as unknown as Bridge).__dvBridge.engine.modes.send({ t: 'mode.cmd', mode: 'story', name: 'mission.start', args: { id } }), c.mission);
      // a mission that does not resolve in this world is refused within a second or two (a toast, no state)
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && (await state())?.mission !== c.mission) await page.waitForTimeout(250);
      if ((await state())?.mission !== c.mission) continue;
      await page.evaluate(
        ([stage, id]) => {
          const b = (window as unknown as Bridge).__dvBridge;
          b.mission.jump(stage as number);
          b.mission.autoplay(true);
          (window as unknown as { __dvChase: string }).__dvChase = id as string;
        },
        [c.startStage, c.mission] as const,
      );
      return;
    }
    throw new Error('story-chase: no chase mission resolves in this world');
  },
};

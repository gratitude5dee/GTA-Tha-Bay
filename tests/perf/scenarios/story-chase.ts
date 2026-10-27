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
 *
 * Each start is waited for until the story mode answers it (BD-FIX-PERF-CHASE-01): the mission runs, or a toast says it will not. The
 * Yard is more than 300 m from the boot spawn, so the m.a1.03 start is first a move there (DL-734), whose pre-streamed teleport takes as
 * long as the world takes to stream the Yard in; a fixed 20 s wait lost that race on a slow page.
 */
type Bridge = { __dvBridge: { mission: MissionBridge & { autoplay(on: boolean): boolean }; engine: { modes: { send(cmd: unknown): boolean; vm(key: string): unknown } } } };
type MissionState = { mission?: string; phase?: string } | null;

/** The chases in order of preference: a mission and the stage it is started from. */
export const STORY_CHASES = [
  { mission: 'm.a1.12', startStage: 1 }, // 'lot': enter the car; the survive stage (heat 4) follows
  { mission: 'm.a1.03', startStage: 4 }, // 'raid': heat 2 and the escape stub
] as const;

/**
 * The toast ids with which the story mode ends a `mission.start` without the mission running (packages/modes/story/src/mode.ts): the
 * mission does not resolve in this world (`mission.disabled`), its far start could not be reached (`mission.startUnreachable`), or
 * something else is starting or running (`jobs.busy`). The far start's loading hint (`mission:<id>:loading`) is not one of them: that
 * move is still on its way.
 */
export function refusedToasts(id: string): string[] {
  return [`mission:${id}:disabled`, `mission:${id}:start`, `mission:start:${id}`];
}

/**
 * The longest a `mission.start` is waited for, ms. A start farther than 300 m from the player is a move there first (DL-734): the story
 * mode asks the pre-streamed teleport again for `PLACE_BUDGET_TICKS` and gives the last request `PLACE_ANSWER_TICKS`, 12,600 ticks
 * (3.5 min at 60 Hz) in all, and then starts the mission or refuses it with a toast. The wait ends at the first of those answers.
 */
export const START_ANSWER_MS = 240_000;

export const storyChase = {
  /** Appended to the page URL. */
  query: 'play=story&hooks=stub',
  /** Longest a test with this setup may take, ms (the setup waits for the world and the story mode before the run). */
  timeoutMs: 480_000,
  /** Runs after the world has booted and before the runner starts. */
  async setup(page: Page): Promise<void> {
    // A sim worker restarted by the stall watchdog ('sim worker stalled', "Recovering…") drops the story mode and every start in flight
    // (01-engine.md section 5); a failure says so, so it is not mistaken for a start that did not answer.
    const restarts: string[] = [];
    page.on('console', (m) => {
      if (m.text().startsWith('sim worker ')) restarts.push(m.text());
    });
    const why = (): string => (restarts.length > 0 ? `; the sim worker was restarted: ${restarts.join('; ')}` : '');
    // the mission bridge and the Jobs list (the story mode is attached once the list is published)
    await page
      .waitForFunction(
        () => {
          const b = (window as unknown as Partial<Bridge>).__dvBridge;
          return b?.mission !== undefined && b.engine?.modes.vm('mode.story.jobs') !== undefined;
        },
        undefined,
        { timeout: 240_000 },
      )
      .catch((e: unknown) => {
        throw new Error(`story-chase: the story mode did not publish its Jobs list${why()}`, { cause: e });
      });
    // the id of every toast the page shows from here on: how a start that will not run says so
    await page.evaluate(() => {
      const w = window as unknown as { __dvChaseToasts: string[] };
      w.__dvChaseToasts = [];
      const seen = (n: Node): void => {
        if (!(n instanceof HTMLElement)) return;
        for (const el of [n, ...n.querySelectorAll<HTMLElement>('[data-toast-id]')]) {
          const id = el.dataset['toastId'];
          if (id) w.__dvChaseToasts.push(id);
        }
      };
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(seen))).observe(document, { childList: true, subtree: true });
    });
    const tried: string[] = [];
    for (const c of STORY_CHASES) {
      const sent = Date.now();
      await page.evaluate((id) => (window as unknown as Bridge).__dvBridge.engine.modes.send({ t: 'mode.cmd', mode: 'story', name: 'mission.start', args: { id } }), c.mission);
      // the start's own answer: the mission runs (the debug state names it), or a toast refuses it
      const outcome = await page
        .waitForFunction(
          ([id, refused]) => {
            const w = window as unknown as Bridge & { __dvChaseToasts: string[] };
            if ((w.__dvBridge.mission.state() as MissionState)?.mission === id) return 'started';
            return w.__dvChaseToasts.some((t) => refused.includes(t)) ? 'refused' : false;
          },
          [c.mission, refusedToasts(c.mission)] as const,
          { timeout: START_ANSWER_MS, polling: 250 },
        )
        .then(async (h) => (await h.jsonValue()) as 'started' | 'refused')
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === 'TimeoutError') return `no answer in ${START_ANSWER_MS} ms`;
          throw e;
        });
      const toasts = await page.evaluate(() => (window as unknown as { __dvChaseToasts: string[] }).__dvChaseToasts.join(', '));
      tried.push(`${c.mission} ${outcome} after ${((Date.now() - sent) / 1000).toFixed(1)} s (toasts: ${toasts || 'none'})`);
      if (outcome !== 'started') continue;
      console.log(`story-chase: ${tried.join('; ')}`);
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
    throw new Error(`story-chase: no chase mission resolves in this world: ${tried.join('; ')}${why()}`);
  },
};

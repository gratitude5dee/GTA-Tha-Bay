/**
 * The story autoplayer as an S13 `BotDriver` (id `story.autoplayer`, M05a2; 03-story-missions.md C9). Each tick it reads the
 * mission observation (`observe()` of the host, never the runtime), derives a goal from the active objectives and writes player 0's
 * `InputFrame`. It cannot place anything or set an objective: the oracle would be vacuous. Seeded only from the `bot` stream.
 *
 * Params: `skip` (an integer; the bot stays neutral for that many ticks first, which shows that the bot is what passes a mission).
 * `done()` is true when the mission passed (outcome `pass`), failed (`fail`) or was aborted (`abort`).
 * Sim code under the C02 lint; the registration at the bottom is a QA entry (`@dv/mode-story/qa`).
 */
import type { InputFrame } from '@dv/shared';
import { getChildBot, type BotContext, type BotDriver } from '@dv/engine/qa';
import { deriveGoal, pickObjective, type Goal } from './goals.ts';
import type { MissionObs } from './observe.ts';
import { decide, newMem, type Control, type Mem } from './policies.ts';

export const STORY_AUTOPLAYER_ID = 'story.autoplayer';

/** Stable description of the goal, for the stuck report and the debugger. */
export function describeGoal(g: Goal): string {
  switch (g.k) {
    case 'reach':
      return `reach ${g.at.map((n) => Math.round(n)).join(',')} ${g.mode}`;
    case 'enter':
      return `enter ${g.vehicle}`;
    case 'follow':
      return `follow ${g.target}`;
    case 'chase':
      return `chase ${g.target}`;
    case 'melee':
      return `melee ${g.target}`;
    default:
      return g.k;
  }
}

export interface AutoplayerView {
  objective: string | null;
  goal: string;
}

export function createStoryAutoplayer(): BotDriver & { view(): AutoplayerView } {
  let observe: (() => Readonly<Record<string, unknown>>) | null = null;
  let rng: (() => number) | null = null;
  let mem: Mem = newMem();
  let prev = 0;
  let last: MissionObs | null = null;
  let skip = 0;
  let view: AutoplayerView = { objective: null, goal: 'idle' };
  // the bot of a child mode while a hook runs it for real (M07a2)
  let child: { key: string; bot: BotDriver } | null = null;
  let ctxKept: BotContext | null = null;

  return {
    id: STORY_AUTOPLAYER_ID,
    device: 'bot',
    init(ctx: BotContext, params?: Record<string, unknown>): void {
      observe = ctx.observe;
      ctxKept = ctx;
      child = null;
      rng = ctx.rng('bot');
      mem = newMem();
      prev = 0;
      last = null;
      const s = params?.['skip'];
      skip = typeof s === 'number' && Number.isInteger(s) && s > 0 ? s : 0;
    },

    frame(tick: number): InputFrame {
      if (!observe || !rng) throw new Error(`driver '${STORY_AUTOPLAYER_ID}' used before init`);
      const obs = observe() as unknown as MissionObs;
      last = obs;
      if (obs.child) {
        const key = `${obs.child.mode}/${obs.child.defId ?? ''}`;
        if (!child || child.key !== key) {
          const bot = getChildBot(obs.child.mode, obs.child.defId);
          child = bot && ctxKept ? { key, bot } : null;
          if (child && ctxKept) child.bot.init(ctxKept, { raceId: obs.child.defId ?? undefined });
        }
        if (child) {
          prev = 0;
          view = { objective: null, goal: `child ${child.key}` };
          return child.bot.frame(tick);
        }
      } else child = null;
      let c: Control = { buttons: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, context: 0 };
      if (obs.phase === 'stage' && tick >= skip) {
        const o = pickObjective(obs);
        const goal: Goal = o ? deriveGoal(obs, o) : { k: 'idle' };
        view = { objective: o ? o.id : null, goal: describeGoal(goal) };
        c = decide(obs, goal, mem, { tick, rng });
      }
      const buttons = c.buttons >>> 0;
      // a pressed edge is a button that was not held on the previous tick
      const pressed = (buttons & ~prev) >>> 0;
      const released = (prev & ~buttons) >>> 0;
      prev = buttons;
      return {
        tick, buttons, pressed, released, moveX: c.moveX, moveY: c.moveY, throttle: c.throttle, brake: c.brake, steer: c.steer,
        camYaw: c.camYaw, camPitch: 0, context: c.context, device: 7,
      };
    },

    done(): { done: boolean; outcome?: string } {
      const o = last;
      if (!o) return { done: false };
      if (o.phase === 'passed') return { done: true, outcome: 'pass' };
      if (o.phase === 'failed') return { done: true, outcome: 'fail' };
      if (o.phase === 'aborted') return { done: true, outcome: 'abort' };
      return { done: false };
    },

    view: () => view,
  };
}

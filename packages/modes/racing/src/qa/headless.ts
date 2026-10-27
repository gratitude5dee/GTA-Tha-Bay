/**
 * Headless runs of a race for the par tool, the tests and the det suite (M07a2). QA builds and Node only.
 *
 *  - `runHeadless` loads the `racing` scenario (the route corridor as the only statics, real Rapier) and drives it with a bot or any
 *    frame source until the run ends, returning the session and the attempt record (finish time, gate ticks, `endHash`, replay).
 *  - `replayFrames` turns a decoded replay back into the frames of its run: one frame per tick from the tick after the grid was
 *    reached, the `ready` command as a command. Feeding them to a fresh scenario re-simulates the run (`06-racing.md` 2.11).
 */
import { getBot, getScenarioLoader, type RunSpec } from '@dv/engine/qa';
import { replayBrake, replayButtons, replaySteer, replayThrottle, REPLAY_BUTTON, SimButton, type DecodedReplay, type InputFrame } from '@dv/shared';
import type { AttemptRecord, RaceSession } from '../sim/session.ts';

const NEUTRAL = (tick: number): InputFrame => ({ tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1, device: 7 });

/** The input frame of one packed replay word. */
export function frameFromWord(w: number, tick: number): InputFrame {
  const b = replayButtons(w);
  let buttons = 0;
  if (b & REPLAY_BUTTON.handbrake) buttons |= 1 << SimButton.Handbrake;
  if (b & REPLAY_BUTTON.nitro) buttons |= 1 << SimButton.Nitro;
  if (b & REPLAY_BUTTON.reset) buttons |= 1 << SimButton.Interact;
  return { ...NEUTRAL(tick), buttons, throttle: replayThrottle(w), brake: replayBrake(w), steer: replaySteer(w) };
}

/** The frame source of a re-simulation: call it with the tick, before the step. */
export function replayFrames(replay: Pick<DecodedReplay, 'inputs'>, session: Pick<RaceSession, 'director' | 'command'>): (tick: number) => InputFrame {
  let i = 0;
  return (tick) => {
    // the recorder starts one tick after the grid was reached, so the first frame is the one a session in Grid consumes
    if (session.director.phase === 'Loading' || !replay.inputs) return NEUTRAL(tick);
    const w = i < replay.inputs.length ? (replay.inputs[i] as number) : 0;
    i++;
    if (replayButtons(w) & REPLAY_BUTTON.ready) session.command('ready');
    return frameFromWord(w, tick);
  };
}

export interface HeadlessRun {
  /** The sim of the run (tests read entities from it). */
  sim: LoadedRacing['sim'];
  session: RaceSession;
  spec: RunSpec;
  ticks: number;
  /** The first attempt that ended, or null. */
  attempt: AttemptRecord | null;
  events: { t: string; tick: number; n?: number | undefined; s?: string | undefined }[];
  dispose(): void;
}

export interface HeadlessOptions {
  /** A frame source instead of the spec's bot (a replay). Receives the session and returns the per-tick frame function. */
  frames?: (session: RaceSession) => (tick: number) => InputFrame;
  /** Called once per tick before the step (commands, probes). */
  beforeTick?: (session: RaceSession, tick: number, sim: LoadedRacing['sim']) => void;
  /** Stop when the attempt has ended (default true). */
  untilResults?: boolean;
}

export type LoadedRacing = Awaited<ReturnType<ReturnType<typeof getScenarioLoader>>> & { session: RaceSession; events: HeadlessRun['events'] };

export async function runHeadless(spec: RunSpec, corridor: Uint8Array, o: HeadlessOptions = {}): Promise<HeadlessRun> {
  const loaded = (await getScenarioLoader('racing')(spec, { packs: { corridor } })) as unknown as LoadedRacing;
  const session = loaded.session;
  let source: (tick: number) => InputFrame;
  let done: () => boolean;
  if (o.frames) {
    source = o.frames(session);
    done = () => session.director.phase === 'Results';
  } else {
    const bot = getBot(spec.bot.driver);
    bot.init({ observe: () => ({ ...loaded.observe(), tick: loaded.sim.tick }), rng: () => () => 0.5 }, spec.bot.params);
    source = (t) => bot.frame(t);
    done = () => bot.done().done;
  }
  while (loaded.sim.tick < spec.maxTicks && !(o.untilResults !== false && done())) {
    o.beforeTick?.(session, loaded.sim.tick, loaded.sim);
    loaded.sim.step(1, source);
  }
  const ticks = loaded.sim.tick;
  return {
    sim: loaded.sim, session, spec, ticks, attempt: session.lastAttempt, events: loaded.events,
    dispose: () => {
      session.dispose();
      loaded.sim.dispose();
    },
  };
}

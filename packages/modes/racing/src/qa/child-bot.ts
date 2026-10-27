/**
 * The racing bot of a story hook (M07a2; QA entries and Node only): when the story autoplayer runs with `hooks: 'bot'` and a mission
 * starts the racing child (`m.a1.03` -> `sf.pursuit.bayview-escape`), this driver takes the controls for as long as the child runs.
 * The bot is chosen by race kind: a pursuit event gets `racing.pursuit`, every other kind `racing.line`. It reads the live session of
 * the mode (`activeSession`), never the world, and acts only through an `InputFrame`.
 */
import { registerChildBot, type BotContext, type BotDriver } from '@dv/engine/qa';
import type { InputFrame } from '@dv/shared';
import { LOANER_CAR } from '../cars.ts';
import { raceDef } from '../races.ts';
import { activeSession } from '../sim/mode.ts';
import type { SessionState } from '../sim/session.ts';
import { createRacingLineDriver } from './line-driver.ts';
import { createRacingPursuitDriver } from './pursuit-bot.ts';
import type { RacingObservation } from './scenario.ts';

/** The observation the racing bots read, from the session state. */
export function observeRaceState(st: SessionState): RacingObservation {
  const car = st.car;
  return {
    phase: st.phase, tick: st.tick, s: st.s, x: car ? car.pos[0] : 0, z: car ? car.pos[2] : 0, yaw: car ? car.yaw : 0,
    speed: car ? car.speedMps : 0, gate: st.gate, outcome: st.outcome,
    ...(st.pursuit ? { heat: st.pursuit.level, heatPhase: st.pursuit.phase } : {}),
  };
}

export function createRacingChildBot(defId: string | null): BotDriver {
  const def = defId ? raceDef(defId) : null;
  const inner = def && def.kind === 'pursuit' ? createRacingPursuitDriver() : createRacingLineDriver();
  const idle = (tick: number): InputFrame => ({ tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1, device: 7 });
  return {
    id: `racing.child.${inner.id}`,
    device: 'bot',
    init(ctx: BotContext, params?: Record<string, unknown>): void {
      const own: BotContext = {
        observe: () => {
          const s = activeSession();
          return (s ? observeRaceState(s.state()) : { phase: 'Loading', tick: 0, s: 0, x: 0, z: 0, yaw: 0, speed: 0, gate: 0, outcome: null }) as unknown as Record<string, unknown>;
        },
        rng: ctx.rng,
      };
      inner.init(own, { ...(params ?? {}), ...(defId ? { raceId: defId } : {}), vehicle: LOANER_CAR });
    },
    frame(tick: number): InputFrame {
      const s = activeSession();
      return s ? inner.frame(tick) : idle(tick);
    },
    done: () => inner.done(),
  };
}

/** Registers the racing child bot for the story autoplayer. Idempotent. */
export function ensureRacingChildBot(): void {
  registerChildBot('racing', createRacingChildBot);
}

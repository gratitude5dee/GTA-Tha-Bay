/**
 * Bot driver `racing.pursuit` (M07a2; 13-qa.md 3.2): drive the route of a pursuit event to a C08 `hidingSpots` tag and wait out the
 * cooldown. It acts only through an `InputFrame` and reads only `observe()`, so a run goes through the real input path. QA builds and
 * Node only (registered with `registerBot` from a QA-only import).
 *
 * The hiding spot comes from the event (`RaceDef.hidingSpots`, authored from a baked tag); the bot reads nothing else from the
 * world. The route is the racing line (`driveLine`), with the speed capped by the braking distance to the spot, so the car arrives
 * and stops inside it; from then on it holds the brakes. Everything numeric uses `detmath`.
 *
 * Params: `raceId` (default the Bayview pursuit), `vehicle` (default the starter loaner).
 */
import { centreline, dsqrt, type HandlingProfile, type InputFrame, type RaceDef } from '@dv/shared';
import { registerBot, registeredBots, type BotContext, type BotDriver } from '@dv/engine/qa';
import { LOANER_CAR, raceCar } from '../cars.ts';
import { raceDef } from '../races.ts';
import { driveLine, speedPlan, type LineMemory, type SpeedPlan } from './line-driver.ts';
import type { RacingObservation } from './scenario.ts';

export const RACING_PURSUIT_DRIVER_ID = 'racing.pursuit';
export const PURSUIT_EVENT = 'sf.pursuit.bayview-escape';

/** The route metre of the centreline sample nearest to (x, z). */
export function routeMetreOf(def: Pick<RaceDef, 'line'>, x: number, z: number): number {
  const cl = centreline(def);
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < cl.length / 2; i++) {
    const d = ((cl[2 * i] as number) - x) ** 2 + ((cl[2 * i + 1] as number) - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best * def.line.stepM;
}

/** The pursuit bot's brain: the same code drives the rig, the engine driver and the tests. */
export class PursuitBrain {
  readonly plan: SpeedPlan;
  readonly spotS: number;
  readonly spotRadiusM: number;
  private readonly mem: LineMemory = { prevSteer: 0 };

  constructor(readonly def: RaceDef, readonly prof: HandlingProfile) {
    const spot = def.hidingSpots?.[0];
    if (!spot) throw new Error(`race ${def.id} has no hiding spot for the pursuit bot`);
    // a bot that is being chased takes the corners harder than a bot on a time trial (0.65 of the grip against 0.5)
    this.plan = speedPlan(def, prof, 48, 0.65, true);
    this.spotS = routeMetreOf(def, spot.x, spot.z);
    this.spotRadiusM = spot.radiusM;
  }

  /** True when the car stands inside the hiding spot. */
  hiding(x: number, z: number): boolean {
    const s = this.def.hidingSpots?.[0];
    return !!s && dsqrt((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z)) <= s.radiusM;
  }

  frame(o: Pick<RacingObservation, 'phase' | 'x' | 'z' | 'yaw' | 'speed' | 's'>, tick: number): InputFrame {
    const base: InputFrame = { tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1, device: 7 };
    if (o.phase !== 'Running') return base;
    // stop a little inside the spot's near edge so the whole car is in it
    const stopAt = Math.max(0, this.spotS - this.spotRadiusM * 0.25);
    const c = driveLine(this.def, this.prof, this.plan, { x: o.x, z: o.z, yaw: o.yaw, speed: o.speed, s: o.s }, this.mem, { stopAtS: stopAt });
    return { ...base, throttle: Math.round(c.throttle * 127), brake: Math.round(c.brake * 127), steer: c.steer };
  }
}

/** A bot that stands still at the start with the brakes on (the fixture the busted check uses). */
export function standStillFrame(tick: number): InputFrame {
  return { tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 127, steer: 0, camYaw: 0, camPitch: 0, context: 1, device: 7 };
}

export function createRacingPursuitDriver(): BotDriver {
  let brain: PursuitBrain | null = null;
  let observe: (() => Readonly<Record<string, unknown>>) | null = null;
  let last: RacingObservation | null = null;
  return {
    id: RACING_PURSUIT_DRIVER_ID,
    device: 'bot',
    init(ctx: BotContext, params?: Record<string, unknown>): void {
      const id = typeof params?.['raceId'] === 'string' ? params['raceId'] : PURSUIT_EVENT;
      const def = raceDef(id);
      if (!def) throw new Error(`driver '${RACING_PURSUIT_DRIVER_ID}': unknown race ${id}`);
      const car = raceCar(typeof params?.['vehicle'] === 'string' ? params['vehicle'] : LOANER_CAR);
      if (!car) throw new Error(`driver '${RACING_PURSUIT_DRIVER_ID}': unknown vehicle`);
      brain = new PursuitBrain(def, car.profile);
      observe = ctx.observe;
    },
    frame(tick: number): InputFrame {
      if (!brain || !observe) throw new Error(`driver '${RACING_PURSUIT_DRIVER_ID}' used before init`);
      const o = observe() as unknown as RacingObservation;
      last = o;
      return brain.frame(o, tick);
    },
    done(): { done: boolean; outcome?: string } {
      const o = last;
      if (!o) return { done: false };
      if (o.phase === 'Results' || o.phase === 'Finished' || o.phase === 'Failed') return { done: true, outcome: o.outcome ?? 'end' };
      return { done: false };
    },
  };
}

/** Registers the driver once (QA entry points call this). */
export function ensureRacingPursuitBot(): void {
  if (!registeredBots().includes(RACING_PURSUIT_DRIVER_ID)) registerBot(RACING_PURSUIT_DRIVER_ID, createRacingPursuitDriver);
}

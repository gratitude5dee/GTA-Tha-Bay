/**
 * `GameModeSim` of racing (M07a1): one race from the grid to the results card, on the streets the race was compiled for.
 * Everything that decides a race is in `RaceSession`; this file only joins it to the `ModeContext` of the host (input, events,
 * UI view model, telemetry) and to the player's car (`RacingHost`).
 *
 * `enter` args: `defId` is the `RaceId` (default the ferry sprint); `params` may carry `vehicle` (a `vehicle.<slug>` of the six
 * race cars; default the class-D loaner), `difficulty` and `timeLimitMs`. The mode ends itself with `mode.exit.request` when the
 * player leaves the results card. Sim code under the C02 lint.
 */
import type { GameModeSim, JsonObject, ModeContext, ModeEnterArgs, ModeExitReason, ModeResult, SimEvent } from '@dv/shared';
import { raceCar, LOANER_CAR } from '../cars.ts';
import { RACING_CONFIG } from '../config.ts';
import { DEFAULT_RACE, raceDef } from '../races.ts';
import { getRacingHost, type RacingHost } from './host.ts';
import { HUD_VM_KEY, hudToJson } from './hud-vm.ts';
import { RaceSession } from './session.ts';

/** The running session of this realm, for the QA bridge and the tests. */
let active: RaceSession | null = null;
export const activeSession = (): RaceSession | null => active;

interface Held { session: RaceSession; host: RacingHost }
let held: Held | null = null;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export const racingSim: GameModeSim = {
  enter(ctx: ModeContext, args: ModeEnterArgs): void {
    const host = getRacingHost();
    if (!host) throw new Error('racing: the racing sim module is not loaded (boot with racing enabled)');
    const p = (args.params ?? {}) as JsonObject;
    const id = args.defId ?? str(p['defId']) ?? DEFAULT_RACE;
    const def = raceDef(id);
    if (!def) throw new Error(`racing: unknown race ${id}`);
    const car = raceCar(str(p['vehicle']) ?? LOANER_CAR);
    if (!car) throw new Error(`racing: unknown vehicle ${String(p['vehicle'])}`);
    const diff = str(p['difficulty']);
    const limit = typeof p['timeLimitMs'] === 'number' ? p['timeLimitMs'] : null;
    const session = new RaceSession({
      def,
      cfg: RACING_CONFIG as never,
      profile: car.profile,
      vehicleDef: car.vehicleDef,
      port: host.port,
      sinks: {
        event: (e: SimEvent) => ctx.events.emit(e),
        hud: (vm) => ctx.ui.patch(HUD_VM_KEY, hudToJson(vm)),
      },
      telemetry: { emit: (name, props) => ctx.telemetry.emit(name, props) },
      seed: args.seed,
      difficulty: diff === 'easy' || diff === 'hard' ? diff : 'normal',
      simProfile: host.profile,
      timeLimitMs: limit,
    });
    host.attach(session);
    ctx.input.push('vehicle');
    held = { session, host };
    active = session;
  },

  tick(ctx: ModeContext): void {
    const h = held;
    if (!h) return;
    const f = ctx.input.frame();
    h.session.step(f, ctx.tick);
    if (h.session.finished || (h.session.exitRequested && h.session.director.phase === 'Results')) {
      ctx.events.emit({ t: 'mode.exit.request', tick: ctx.tick, s: 'completed' });
    }
  },

  exit(ctx: ModeContext, reason: ModeExitReason): ModeResult {
    const h = held;
    held = null;
    active = null;
    if (!h) return { outcome: 'abort' };
    h.host.attach(null);
    h.host.port.release();
    ctx.input.pop('vehicle');
    ctx.ui.patch(HUD_VM_KEY, null);
    const res = h.session.director.result;
    if (reason === 'completed' && res) return { outcome: res.outcome === 'finish' ? 'finish' : 'lose', data: { ms: res.ms } as JsonObject };
    return { outcome: reason === 'quit' ? 'quit' : 'abort' };
  },

  saveSlice(): JsonObject | null {
    // RacingSlice (rep, purse, ghosts, best times) arrives with M07a2; M07a1 keeps nothing between runs.
    return null;
  },
};

export default racingSim;

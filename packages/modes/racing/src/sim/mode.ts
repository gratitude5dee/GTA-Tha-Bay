/**
 * `GameModeSim` of racing (M07a1, M07a2): one race from the grid to the results card, on the streets the race was compiled for.
 * Everything that decides a race is in `RaceSession`; this file joins it to the `ModeContext` of the host (input, events, UI view
 * model, telemetry, save) and to the player's car (`RacingHost`), and keeps `RacingSlice`.
 *
 * `enter` args: `defId` is the `RaceId` (default the ferry sprint); `params` may carry `vehicle` (a `vehicle.<slug>` of the six
 * race cars; default the class-D loaner), `difficulty` and `timeLimitMs`. The mode ends itself with `mode.exit.request` when the
 * player leaves the results card. Sim code under the C02 lint.
 *
 * Standalone runs (menu) are `canonical`: they keep records, medals, the purse, Rep and the best ghost in `mode:racing`. An
 * embedded run (story hook) is `local`, shows no ghost, keeps no records and pays nothing itself: the mission pays its rewards.
 */
import type { Difficulty, GameModeSim, JsonObject, ModeContext, ModeEnterArgs, ModeExitReason, ModeResult, SimEvent } from '@dv/shared';
import { raceCar, LOANER_CAR, type RaceCar } from '../cars.ts';
import { RACING_CONFIG } from '../config.ts';
import { DEFAULT_RACE, raceDef } from '../races.ts';
import type { RivalSpec } from './ai-driver.ts';
import { getRacingHost, type RacingHost } from './host.ts';
import { HUD_VM_KEY, hudToJson } from './hud-vm.ts';
import { PursuitBinder } from './pursuit-binder.ts';
import { RaceSession } from './session.ts';
import { applyRun, readRacingSlice, type RacingSlice, type RunRecord } from './slice.ts';

/** The running session of this realm, for the QA bridge and the tests. */
let active: RaceSession | null = null;
export const activeSession = (): RaceSession | null => active;

interface Held { session: RaceSession; host: RacingHost; slice: RacingSlice; embedded: boolean; raceId: string }
let held: Held | null = null;

/** The slice of the running mode (QA and tests). */
export const activeSlice = (): RacingSlice | null => held?.slice ?? null;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Rival `skill` moves with the difficulty: -0.15 easy, 0 normal, +0.10 hard (06-racing-content.md C.6). */
const SKILL_ADJUST: Record<Difficulty, number> = { easy: -0.15, normal: 0, hard: 0.1 };

export function rivalSpecs(def: { opponents: { driverId: string; vehicleDef: string; skill: number }[] }, difficulty: Difficulty): RivalSpec[] {
  return def.opponents.map((o) => {
    const car: RaceCar = raceCar(o.vehicleDef) ?? (raceCar(LOANER_CAR) as RaceCar);
    const skill = Math.max(0, Math.min(1, o.skill + SKILL_ADJUST[difficulty]));
    return { driverId: o.driverId, vehicleDef: car.vehicleDef, skill, profile: car.profile };
  });
}

export const racingSim: GameModeSim = {
  enter(ctx: ModeContext, args: ModeEnterArgs, sliceIn?: JsonObject | null): void {
    const host = getRacingHost();
    if (!host) throw new Error('racing: the racing sim module is not loaded (boot with racing enabled)');
    const p = (args.params ?? {}) as JsonObject;
    const id = args.defId ?? str(p['defId']) ?? DEFAULT_RACE;
    const def = raceDef(id);
    if (!def) throw new Error(`racing: unknown race ${id}`);
    const car = raceCar(str(p['vehicle']) ?? LOANER_CAR);
    if (!car) throw new Error(`racing: unknown vehicle ${String(p['vehicle'])}`);
    const embedded = args.origin.kind === 'story';
    const slice = readRacingSlice(sliceIn);
    const diffParam = str(p['difficulty']);
    const diff: Difficulty = diffParam === 'easy' || diffParam === 'hard' ? diffParam : slice.settings.difficulty;
    const limit = typeof p['timeLimitMs'] === 'number' ? p['timeLimitMs'] : null;
    const binder = def.police.enabled ? new PursuitBinder(ctx.pursuit, ctx.events, def) : null;
    const ghost = !embedded && slice.settings.ghost !== 'off' ? slice.ghosts[def.id] ?? null : null;
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
      difficulty: diff,
      simProfile: host.profile,
      unit: slice.settings.units,
      timeLimitMs: limit,
      rivals: def.police.enabled ? [] : rivalSpecs(def, diff),
      ghost,
      pursuit: binder,
      embedded,
      prevMedals: slice.events[def.id]?.medals ?? 0,
      buildId: host.buildId,
      vehiclePriceCents: car.priceCents,
      ...(host.wallMs ? { nowMs: host.wallMs } : {}),
    });
    host.attach(session);
    ctx.input.push('vehicle');
    held = { session, host, slice, embedded, raceId: def.id };
    active = session;
  },

  tick(ctx: ModeContext): void {
    const h = held;
    if (!h) return;
    const f = ctx.input.frame();
    h.session.step(f, ctx.tick);
    for (const r of h.session.takeRecords()) {
      if (h.embedded) continue;
      const def = raceDef(h.raceId);
      const run: RunRecord = {
        raceId: h.raceId, kind: def?.kind ?? 'sprint', outcome: r.outcome, ms: r.ms, place: r.place, medals: r.rewards.medals, rep: r.rewards.rep,
        cashCents: r.rewards.cashCents - (r.pursuit?.repairCents ?? 0), ghost: r.ghost, distanceM: r.distanceM,
        ...(r.pursuit ? { pursuit: { evaded: r.pursuit.outcome === 'evade' || r.pursuit.outcome === 'survive', busted: r.pursuit.outcome === 'bust', bountyPoints: r.pursuit.points, seconds: r.pursuit.seconds, takedowns: r.pursuit.takedowns } } : {}),
      };
      const out = applyRun(h.slice, run, h.host.wallMs ? h.host.wallMs() : 0);
      h.session.markNewBest(out.newBest);
      ctx.save.request('modeExit');
    }
    if (h.session.finished || (h.session.exitRequested && h.session.director.phase === 'Results')) {
      ctx.events.emit({ t: 'mode.exit.request', tick: ctx.tick, s: 'completed' });
    }
  },

  exit(ctx: ModeContext, reason: ModeExitReason): ModeResult {
    const h = held;
    held = null;
    active = null;
    if (!h) return { outcome: 'abort' };
    h.session.dispose();
    h.host.attach(null);
    h.host.port.release();
    ctx.input.pop('vehicle');
    ctx.ui.patch(HUD_VM_KEY, null);
    const res = h.session.director.result;
    const last = h.session.lastAttempt;
    if (reason === 'completed' && res) {
      const evaded = last?.pursuit?.outcome === 'evade' || last?.pursuit?.outcome === 'survive';
      const outcome = res.outcome === 'finish' ? (last?.pursuit ? (evaded ? 'win' : 'lose') : 'finish') : 'lose';
      return { outcome, data: { ms: res.ms, place: res.place } as JsonObject };
    }
    return { outcome: reason === 'quit' ? 'quit' : 'abort' };
  },

  saveSlice(): JsonObject | null {
    const h = held;
    if (!h || h.embedded) return null;
    return h.slice as unknown as JsonObject;
  },
};

export default racingSim;

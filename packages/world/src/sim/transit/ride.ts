/**
 * Rides (living part 3.6 and 5; M03b2): Bay Rail fast travel between stations and the robotaxi fare. Both go through
 * `TeleportApi.request('fast-travel', ...)`, which refuses at heat 1 or more, during the cooldown and out of bounds, with the
 * precondition key and no movement. The fare is charged to the `FareSink` once, after the teleport succeeded, with the idempotency
 * key `fare:<kind>:<tick>:<from>:<to>`.
 *
 * Robotaxi (3.6): a car appears 120 to 180 m away and arrives within 90 s (it drives about 12 m/s, so 10 to 15 s), a short in-engine
 * cut follows (1.5 s) and then the teleport. The driving car is the page's to show (BD-M03b2-08); the ride service owns the clock,
 * the refusal and the fare.
 * Pure; C02 lint applies.
 */
import type { TeleportApi, TeleportResult, TeleportTarget } from '@dv/shared';
import { TELEPORT_MSG } from '../api/teleport.ts';
import { RecordingFareSink, bayRailFare, distanceM, fareKey, robotaxiFare, stopsBetween, type FareSink } from './fares.ts';
import type { Station } from './rail.ts';

/** Nearest the robotaxi appears to the rider, metres, and the share of the next 60 m. */
export const ROBOTAXI_SPAWN_MIN_M = 120;
export const ROBOTAXI_SPAWN_SPREAD_M = 60;
/** Its pace in the dispatch estimate, m/s. */
export const ROBOTAXI_PACE = 12;
/** The arrival is promised within this many ticks (90 s). */
export const ROBOTAXI_ARRIVE_MAX_TICKS = 5400;
/** The in-engine cut between the arrival and the teleport (1.5 s). */
export const ROBOTAXI_CUT_TICKS = 90;

export type RideResult =
  | { ok: true; kind: 'bay-rail' | 'robotaxi'; cents: number; idemKey: string; to: string; stops: number }
  | { ok: false; reason: string; messageKey: string };

export type RobotaxiPhase = 'idle' | 'arriving' | 'cut' | 'travelling';

export interface RideDeps {
  teleport: TeleportApi;
  stations: readonly Station[];
  sink?: FareSink;
  now(): number;
  playerPos(): [number, number, number] | null;
  heat(): number;
  /** Turns a teleport target into a ground point (for the fare distance). */
  resolve(to: TeleportTarget): { x: number; z: number } | null;
  /** Called on each robotaxi phase change (the module turns it into a sim event). */
  onPhase?(phase: RobotaxiPhase, info: { spawnX: number; spawnZ: number; distanceM: number }): void;
}

interface Call {
  to: TeleportTarget;
  toId: string;
  from: string;
  startTick: number;
  arriveAt: number;
  cutEnd: number;
  phase: RobotaxiPhase;
  spawn: { x: number; z: number; d: number };
  resolve(r: RideResult): void;
}

const fail = (reason: string, messageKey: string): RideResult => ({ ok: false, reason, messageKey });

export class RideService {
  readonly sink: FareSink;
  private call: Call | null = null;
  private readonly deps: RideDeps;
  /** Distinct rides begun (for the unique spawn bearing of a robotaxi). */
  private serial = 0;

  constructor(deps: RideDeps) {
    this.deps = deps;
    this.sink = deps.sink ?? new RecordingFareSink();
  }

  get robotaxiPhase(): RobotaxiPhase {
    return this.call ? this.call.phase : 'idle';
  }

  /** The destination stations reachable from `from` (every other fast-travel station). */
  destinations(from: string): readonly Station[] {
    return this.deps.stations.filter((s) => s.id !== from);
  }

  /** Bay Rail: from the entrance of `from` to the station `to`. */
  async fastTravel(from: string, to: string): Promise<RideResult> {
    const st = this.deps.stations.find((s) => s.id === to);
    if (!st || !this.deps.stations.some((s) => s.id === from) || from === to) return fail('blocked', TELEPORT_MSG.unknownTarget);
    const tick = this.deps.now();
    const stops = stopsBetween(from, to, this.deps.stations.map((s) => s.id));
    const r: TeleportResult = await this.deps.teleport.request('fast-travel', { node: to });
    if (!r.ok) return fail(r.reason, r.messageKey);
    const cents = bayRailFare(from, to, this.deps.stations.map((s) => s.id));
    const idemKey = fareKey('bay-rail', tick, from, to);
    this.sink.charge(cents, 'bay-rail', idemKey);
    return { ok: true, kind: 'bay-rail', cents, idemKey, to, stops };
  }

  /** Robotaxi: asks for a car to take the rider to `to`. Resolves when the ride is over (or refused at once). */
  callRobotaxi(to: TeleportTarget, toId = 'point'): Promise<RideResult> {
    if (this.deps.heat() > 0) return Promise.resolve(fail('heat', TELEPORT_MSG.heat));
    if (this.call) return Promise.resolve(fail('blocked', TELEPORT_MSG.busy));
    const at = this.deps.playerPos();
    const dest = this.deps.resolve(to);
    if (!at || !dest) return Promise.resolve(fail('blocked', TELEPORT_MSG.unknownTarget));
    const tick = this.deps.now();
    const n = this.serial++;
    // a seeded spawn distance and bearing: the same ride at the same tick gives the same car
    const h = Math.imul(tick + 1, 2654435761) ^ Math.imul(n + 1, 40503);
    const u = ((h >>> 0) % 1000) / 1000;
    const v = (((h >>> 8) >>> 0) % 1000) / 1000;
    const d = ROBOTAXI_SPAWN_MIN_M + u * ROBOTAXI_SPAWN_SPREAD_M;
    const ang = v * 6.283185307179586;
    const spawn = { x: at[0] + d * approxCos(ang), z: at[2] + d * approxSin(ang), d };
    const eta = Math.ceil((d / ROBOTAXI_PACE) * 60);
    return new Promise<RideResult>((resolve) => {
      this.call = {
        to, toId, from: `p${Math.round(at[0])}_${Math.round(at[2])}`, startTick: tick,
        arriveAt: tick + (eta < ROBOTAXI_ARRIVE_MAX_TICKS ? eta : ROBOTAXI_ARRIVE_MAX_TICKS), cutEnd: 0,
        phase: 'arriving', spawn, resolve,
      };
      this.deps.onPhase?.('arriving', { spawnX: spawn.x, spawnZ: spawn.z, distanceM: d });
    });
  }

  /** One sim tick of the robotaxi clock. */
  step(tick: number): void {
    const c = this.call;
    if (!c) return;
    if (c.phase === 'arriving' && tick >= c.arriveAt) {
      c.phase = 'cut';
      c.cutEnd = tick + ROBOTAXI_CUT_TICKS;
      this.deps.onPhase?.('cut', { spawnX: c.spawn.x, spawnZ: c.spawn.z, distanceM: c.spawn.d });
    } else if (c.phase === 'cut' && tick >= c.cutEnd) {
      c.phase = 'travelling';
      this.deps.onPhase?.('travelling', { spawnX: c.spawn.x, spawnZ: c.spawn.z, distanceM: c.spawn.d });
      const at = this.deps.playerPos();
      const dest = this.deps.resolve(c.to);
      const metres = at && dest ? distanceM(at[0], at[2], dest.x, dest.z) : 0;
      void this.deps.teleport.request('fast-travel', c.to).then((r) => {
        this.call = null;
        this.deps.onPhase?.('idle', { spawnX: 0, spawnZ: 0, distanceM: 0 });
        if (!r.ok) return c.resolve(fail(r.reason, r.messageKey));
        const cents = robotaxiFare(metres);
        const idemKey = fareKey('robotaxi', c.startTick, c.from, c.toId);
        this.sink.charge(cents, 'robotaxi', idemKey);
        c.resolve({ ok: true, kind: 'robotaxi', cents, idemKey, to: c.toId, stops: 0 });
      });
    }
  }
}

// Spawn bearings only need to be repeatable, not exact: a 16-point lookup keeps this file free of transcendental Math.
const BEARING = [0, 0.3827, 0.7071, 0.9239, 1, 0.9239, 0.7071, 0.3827, 0, -0.3827, -0.7071, -0.9239, -1, -0.9239, -0.7071, -0.3827];
function approxSin(a: number): number {
  const i = Math.floor((a / 6.283185307179586) * 16) & 15;
  return BEARING[i] as number;
}
function approxCos(a: number): number {
  const i = (Math.floor((a / 6.283185307179586) * 16) + 4) & 15;
  return BEARING[i] as number;
}

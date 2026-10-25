/**
 * The below-the-world net for a vehicle carrying the player (02-world-maps.md 4.1 d, DL-734, DL-735; BD-FIX-SPAWN-05, -07, -08, -09). A
 * sedan with the player aboard (at its wheel or as a passenger) that has been in the air for 120 ticks under the ground (or under the floor
 * of the play box) is moved, with the player, onto the nearest drivable lane through the ownership machine's move (`requestPlayerMove`,
 * the vehicle module's `vehicleMove`), never through `TeleportApi.request`, with the teleport's own fade (`world.teleport` out, the move
 * 12 ticks later, then in). The `WorldApi` here is a fake with the queries the net reads; its `teleport.request` counts asks, which must
 * stay at zero. `moves` records what the vehicle move answered.
 */
import { describe, expect, it } from 'vitest';
import type { EdgeId, ShoreNode, TeleportResult, WorldApi } from '@dv/shared';
import {
  FALL_FLOOR_Y, FALL_RECOVER_TICKS, VEHICLE_DECK_GAP_M, VEHICLE_RECOVER_MAX_TRIES, VEHICLE_RECOVER_RETRY_TICKS, VEHICLE_RESCUE_FADE_TICKS,
  VEHICLE_ROAD_SEARCH_M, vehicleRespawnCandidates, vehicleRespawnPose,
} from '../../src/sim/control/fall.ts';
import { isDriving, requestDriverTeleport, requestPlayerMove, ridingVehicle } from '../../src/sim/control/ownership.ts';
import { CONTROL_OWNER, CONTROL_REASON, CONTROL_STATE } from '../../src/sim/control/states.ts';
import { BodyRef, Control, Transform } from '../../src/sim/ecs/components.ts';
import type { VehiclePhysics } from '../../src/sim/physics/backend.ts';
import type { WorldBoundsPort } from '../../src/sim/world/index.ts';
import { createVehicleWorld, drive, playerControl, view, type VehicleWorld } from '../vehicle-sim.ts';

/** The road point the fake graph answers: on the oracle ground plane (flat at y 0), facing +X (yaw -pi/2: forward is (-sin, -cos)). */
const ROAD = { x: 60, z: 20, yaw: -Math.PI / 2 };
/** Off the oracle plane (it ends at x 2,400): no static collider under it, so the vehicle move answers `groundNotLoaded`. */
const VOID = { x: 5000, z: 20, yaw: 0 };
/** A lane as the net hands it to the move: the fake graph's lanes lie at y 0. */
const pose = (r: { x: number; z: number; yaw: number }): { x: number; y: number; z: number; yaw: number } => ({ x: r.x, y: 0, z: r.z, yaw: r.yaw });
/** The first tick a car sunk at tick `t` is moved: its 120th tick in the air (the sink tick is its first), then the fade-out. */
const FIRST_MOVE = FALL_RECOVER_TICKS + VEHICLE_RESCUE_FADE_TICKS;

interface Fake {
  /** The lowest surface `groundY(x, z, -1e6)` answers; null where nothing is resident. */
  ground: number | null;
  road: { x: number; z: number; yaw: number } | null;
  /** What the vehicle move answered, per call. */
  moves: { tick: number; to: { x: number; z: number; yaw: number }; r: { ok: boolean; reason?: string } }[];
  edgeAsks: number;
  /** `TeleportApi.request` calls: a rescue never makes one (DL-735 a). */
  teleportAsks: number;
  /** The top surface `groundY(x, z)` answers there (a deck over the road), when set; else `ground`. */
  top?: (x: number, z: number) => number | null;
  /** Water cells, when set. */
  water?: (x: number, z: number) => boolean;
  /** The road-adjacent shore node `bounds.nearestShore` answers, when set (the world's bounds port is installed then). */
  shore?: ShoreNode;
  /** The lane centre beside the shore node (the 15 m search from it), when set. */
  shoreRoad?: { x: number; z: number; yaw: number };
}

function fakeWorld(f: Fake): WorldApi {
  return {
    query: {
      groundY: (x: number, z: number, hint?: number) => (hint === undefined && f.top ? f.top(x, z) : f.ground),
      isWater: (x: number, z: number) => f.water?.(x, z) ?? false,
      nearestWalkable: () => null,
    },
    graph: {
      nearestEdge: (_x: number, _z: number, _y: number | undefined, maxM: number) => {
        f.edgeAsks++;
        if (maxM !== VEHICLE_ROAD_SEARCH_M) {
          // the search beside a road-adjacent shore node: only with a shore node installed
          expect(f.shore).toBeDefined();
          expect(maxM).toBe(15);
          return f.shoreRoad ? { edge: 8 as EdgeId, s: 1, distM: 4 } : null;
        }
        return f.road ? { edge: 7 as EdgeId, s: 3, distM: 5 } : null;
      },
      laneCentre: (e: { edge: EdgeId }, out: Float64Array) => {
        const r = (e.edge === 8 ? f.shoreRoad : f.road) as { x: number; z: number; yaw: number };
        out[0] = r.x; out[1] = 0; out[2] = r.z; out[3] = r.yaw;
      },
    },
    teleport: {
      request: (): Promise<TeleportResult> => {
        f.teleportAsks++;
        return Promise.resolve({ ok: false, reason: 'blocked', messageKey: 'world.teleport.busy' });
      },
      candidates: () => [],
    },
  } as unknown as WorldApi;
}

/** Puts the car `depth` metres under the plane, at rest (as the e2e does through a spawn under the terrain). */
function sink(w: VehicleWorld, y: number): void {
  const id = w.sim.ecs.resolve(w.vehicle) as number;
  const body = w.sim.ecs.store(BodyRef).body[id] as number;
  const b = w.sim.backend as unknown as VehiclePhysics;
  const tr = w.sim.ecs.store(Transform);
  b.setBodyPose(body, [tr.px[id] as number, y, tr.pz[id] as number], [tr.qx[id] as number, tr.qy[id] as number, tr.qz[id] as number, tr.qw[id] as number]);
  b.setBodyVelocity(body, [0, 0, 0], [0, 0, 0]);
  tr.py[id] = y;
}

/** Records every call of the vehicle move (the ownership machine's move of a vehicle with the player aboard). */
function recordMoves(w: VehicleWorld, f: Fake): void {
  const move = w.sim.services.vehicleMove;
  if (!move) throw new Error('no vehicle move');
  w.sim.services.vehicleMove = (rider, pos, yaw) => {
    const r = move(rider, pos, yaw);
    f.moves.push({ tick: w.sim.tick, to: { x: pos[0], z: pos[2], yaw }, r });
    return r;
  };
}

async function settled(f: Partial<Fake> = {}): Promise<{ w: VehicleWorld; f: Fake }> {
  const w = await createVehicleWorld({ pos: [0, 0, 0] });
  const fake: Fake = { ground: 0, road: ROAD, moves: [], edgeAsks: 0, teleportAsks: 0, ...f };
  w.sim.services.world.api = fakeWorld(fake);
  if (fake.shore) {
    // the water wall reads the depth every tick: dry land here
    w.sim.services.world.bounds = { nearestShore: (_x: number, _z: number, road: boolean) => (road ? fake.shore ?? null : null), waterDepth: () => 0, onClosureChange: () => () => undefined } as unknown as WorldBoundsPort;
  }
  recordMoves(w, fake);
  drive(w, 60);
  expect(view(w).contacts).toBeGreaterThan(0);
  expect(isDriving(w.sim.ecs, w.player)).toBe(true);
  w.sim.services.events.drain();
  return { w, f: fake };
}

/** The player's capsule (it follows the seat). */
function playerPos(w: VehicleWorld): [number, number, number] {
  const id = w.sim.ecs.resolve(w.player) as number;
  const tr = w.sim.ecs.store(Transform);
  return [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number];
}

/** Makes the player a passenger of the car: aboard (owner Vehicle, Active) in state 202, nobody at the wheel. */
function makePassenger(w: VehicleWorld): void {
  const pid = w.sim.ecs.resolve(w.player) as number;
  const vid = w.sim.ecs.resolve(w.vehicle) as number;
  const rt = w.mod.store.rt.get(vid);
  if (!rt) throw new Error('no vehicle runtime');
  rt.driver = 0;
  w.sim.ecs.store(Control).state[pid] = CONTROL_STATE.passenger;
}

const fades = (w: VehicleWorld, events = w.sim.services.events.drain()): [string, number][] =>
  events.filter((e) => e.t === 'world.teleport').map((e) => [e.s as string, e.tick]);

describe('below-the-world net for a vehicle with the player aboard (DL-734, DL-735)', () => {
  it('respawns a car that fell under the ground, with its driver, on the nearest road, through the ownership machine with the teleport fade', async () => {
    const { w, f } = await settled();
    const sunkAt = w.sim.tick;
    sink(w, -25);
    let backAfter = -1;
    for (let i = 1; i <= 400 && backAfter < 0; i++) {
      drive(w, 1);
      if (f.moves.length > 0) backAfter = i;
    }
    // moved once the car had been in the air for 120 ticks (the sink tick counts as its first airborne tick) and the fade was out
    expect(backAfter).toBeGreaterThanOrEqual(FIRST_MOVE - 1);
    expect(backAfter).toBeLessThanOrEqual(FIRST_MOVE + 2);
    expect(f.moves).toHaveLength(1);
    expect(f.moves[0]!.r).toEqual({ ok: true });
    expect(f.moves[0]!.to).toEqual(ROAD);
    expect(f.moves[0]!.tick - sunkAt).toBeLessThanOrEqual(FIRST_MOVE + 3);
    // never the world's teleport (DL-735 a)
    expect(f.teleportAsks).toBe(0);
    drive(w, 30);
    const v = view(w);
    expect(Math.hypot(v.x - ROAD.x, v.z - ROAD.z)).toBeLessThan(0.5);
    expect(v.y).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(2);
    expect(v.contacts).toBeGreaterThan(0);
    expect(v.upY).toBeGreaterThan(0.99);
    // facing the lane: forward (-sin yaw, -cos yaw) of yaw -pi/2 is +X
    const id = w.sim.ecs.resolve(w.vehicle) as number;
    const tr = w.sim.ecs.store(Transform);
    const yaw = 2 * Math.atan2(tr.qy[id] as number, tr.qw[id] as number);
    expect(-Math.sin(yaw)).toBeCloseTo(1, 1);
    // the driver came along and still drives
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    const d = playerPos(w);
    expect(Math.hypot(d[0] - v.x, d[2] - v.z)).toBeLessThan(1.5);
    expect(w.mod.store.rt.get(id)?.airTicks).toBe(0);
    const events = w.sim.services.events.drain();
    expect(events.filter((e) => e.t === 'control.recover').map((e) => [e.s, e.a])).toEqual([['below-ground', w.player]]);
    // the teleport's own fade (DL-735 b): out when the request starts, in on the tick of the move, 12 ticks (200 ms) later
    const fd = fades(w, events);
    expect(fd.map((x) => x[0])).toEqual(['out', 'in']);
    expect(fd[1]![1] - fd[0]![1]).toBe(VEHICLE_RESCUE_FADE_TICKS);
    expect(fd[1]![1]).toBe(f.moves[0]!.tick);
    // and it drives on
    drive(w, 120, { throttle: 127 });
    expect(Math.abs(view(w).speed)).toBeGreaterThan(3);
    expect(f.moves).toHaveLength(1);
    w.sim.dispose();
  }, 60_000);

  it('moves a player riding as a passenger with the car, like a driver (DL-735 c)', async () => {
    const { w, f } = await settled();
    makePassenger(w);
    expect(isDriving(w.sim.ecs, w.player)).toBe(false);
    expect(ridingVehicle(w.sim.ecs, w.player)).toBe(w.sim.ecs.resolve(w.vehicle));
    sink(w, -25);
    drive(w, FIRST_MOVE + 5);
    expect(f.moves.map((m) => [m.to.x, m.to.z, m.r.ok])).toEqual([[ROAD.x, ROAD.z, true]]);
    expect(f.teleportAsks).toBe(0);
    drive(w, 30);
    const v = view(w);
    expect(Math.hypot(v.x - ROAD.x, v.z - ROAD.z)).toBeLessThan(0.5);
    expect(v.y).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(2);
    // still aboard as the passenger, in the car (the passenger seat, right of centre)
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    expect(playerControl(w).state).toBe(CONTROL_STATE.passenger);
    const p = playerPos(w);
    expect(Math.hypot(p[0] - v.x, p[2] - v.z)).toBeLessThan(1.5);
    expect(p[1]).toBeGreaterThan(-1);
    expect(p[1]).toBeLessThan(3);
    const events = w.sim.services.events.drain();
    expect(events.filter((e) => e.t === 'control.recover').map((e) => [e.s, e.a])).toEqual([['below-ground', w.player]]);
    expect(fades(w, events).map((x) => x[0])).toEqual(['out', 'in']);
    w.sim.dispose();
  }, 60_000);

  it('a passenger whose car finds no lane gets out and the on-foot net puts the player on the ground; the car stays (DL-735 c, e)', async () => {
    const { w, f } = await settled();
    makePassenger(w);
    f.road = null;
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 60);
    expect(f.moves).toHaveLength(0);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-ground', 'gave-up', 'below-ground']);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.OnFoot);
    const p = playerPos(w);
    expect(p[1]).toBeGreaterThan(-1);
    expect(p[1]).toBeLessThan(2);
    expect(view(w).y).toBeLessThan(-25);
    w.sim.dispose();
  }, 60_000);

  it('under the floor of the play box with nothing resident, says below-bounds', async () => {
    const { w, f } = await settled();
    f.ground = null;
    sink(w, FALL_FLOOR_Y - 5);
    drive(w, FIRST_MOVE + 5);
    expect(f.moves.map((m) => m.r.ok)).toEqual([true]);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-bounds']);
    w.sim.dispose();
  }, 60_000);

  it('a move over ground with no collider yet is refused and asked again every second, with one control.recover and a fade each time', async () => {
    const { w, f } = await settled({ road: VOID });
    sink(w, -25);
    drive(w, FIRST_MOVE + 2 * VEHICLE_RECOVER_RETRY_TICKS + 5);
    expect(f.moves.length).toBe(3);
    for (const m of f.moves) expect(m.r).toEqual({ ok: false, reason: CONTROL_REASON.groundNotLoaded });
    expect(f.moves[1]!.tick - f.moves[0]!.tick).toBe(VEHICLE_RECOVER_RETRY_TICKS);
    const events = w.sim.services.events.drain();
    expect(events.filter((e) => e.t === 'control.recover')).toHaveLength(1);
    // every request fades out and back in, also when the move is refused: the screen never stays dark
    expect(fades(w, events).map((x) => x[0])).toEqual(['out', 'in', 'out', 'in', 'out', 'in']);
    // the road appears (its colliders are there): the next ask brings the car back
    f.road = ROAD;
    drive(w, VEHICLE_RECOVER_RETRY_TICKS + 30);
    expect(f.moves[f.moves.length - 1]!.r).toEqual({ ok: true });
    expect(Math.hypot(view(w).x - ROAD.x, view(w).z - ROAD.z)).toBeLessThan(0.5);
    expect(f.teleportAsks).toBe(0);
    w.sim.dispose();
  }, 60_000);

  it('a fade that went out comes back in when the car stops counting as out of the world before its move', async () => {
    const { w, f } = await settled();
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 2);
    expect(fades(w).map((x) => x[0])).toEqual(['out']);
    // the ground there turns out to lie far lower (a deep cut): the car is above it, not out of the world
    f.ground = -100;
    drive(w, VEHICLE_RESCUE_FADE_TICKS + 5);
    expect(f.moves).toHaveLength(0);
    expect(fades(w).map((x) => x[0])).toEqual(['in']);
    w.sim.dispose();
  }, 60_000);

  it('leaves a car on the ground, an airborne car above the ground, and a car without the player alone', async () => {
    const { w, f } = await settled();
    drive(w, 300, { throttle: 60 });
    // in the air above the ground for a long time: not out of the world
    const id = w.sim.ecs.resolve(w.vehicle) as number;
    const tr = w.sim.ecs.store(Transform);
    sink(w, 40);
    drive(w, FALL_RECOVER_TICKS + 20);
    expect(tr.py[id] as number).toBeLessThan(40);
    expect(f.moves).toHaveLength(0);
    w.sim.dispose();

    const parked = await createVehicleWorld({ pos: [0, 0, 0], seated: false });
    const g: Fake = { ground: 0, road: ROAD, moves: [], edgeAsks: 0, teleportAsks: 0 };
    parked.sim.services.world.api = fakeWorld(g);
    recordMoves(parked, g);
    drive(parked, 30);
    sink(parked, -25);
    drive(parked, FIRST_MOVE + 60);
    expect(g.moves).toHaveLength(0);
    expect(g.edgeAsks).toBe(0);
    expect(parked.sim.services.events.drain().some((e) => e.t === 'world.teleport' || e.t === 'control.recover')).toBe(false);
    parked.sim.dispose();
  }, 60_000);

  it('does nothing without a baked world', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0] });
    expect(w.sim.services.world.api).toBeNull();
    drive(w, 60);
    sink(w, -25);
    drive(w, FIRST_MOVE + 60);
    expect(view(w).y).toBeLessThan(-25);
    const events = w.sim.services.events.drain();
    expect(events.some((e) => e.t === 'control.recover' || e.t === 'world.teleport')).toBe(false);
    w.sim.dispose();
  }, 60_000);

  it('requestDriverTeleport refuses a player on foot, and isDriving tells', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0], seated: false });
    drive(w, 5);
    expect(isDriving(w.sim.ecs, w.player)).toBe(false);
    expect(ridingVehicle(w.sim.ecs, w.player)).toBe(0);
    expect(requestDriverTeleport(w.sim.ecs, w.sim.services, w.player, [ROAD.x, 0, ROAD.z], 0)).toEqual({ ok: false, reason: CONTROL_REASON.wrongOwner });
    w.sim.dispose();
  }, 60_000);

  it('the respawn point: the nearest lane centre, else the lane beside the water wall\'s road-adjacent shore node, never a point off the roads', () => {
    const out = new Float64Array(4);
    const shore: ShoreNode = { id: 'sn.t', x: 5, y: 0, z: 40, nx: 1, nz: 0 };
    const bounds = { nearestShore: (_x: number, _z: number, road: boolean) => (road ? shore : null) } as unknown as WorldBoundsPort;
    const api = (road: boolean): WorldApi => ({
      query: { groundY: () => null, isWater: () => false },
      graph: {
        nearestEdge: () => (road ? { edge: 1 as EdgeId, s: 0, distM: 1 } : null),
        laneCentre: (_e: unknown, o: Float64Array) => { o[0] = 1; o[1] = 2; o[2] = 3; o[3] = 0.5; },
      },
    } as unknown as WorldApi);
    expect(vehicleRespawnPose(api(true), bounds, 0, 0, out)).toEqual({ x: 1, y: 2, z: 3, yaw: 0.5 });
    // no drivable edge near the fall nor beside the shore node: the shore node's inland point would set the player down on foot, so there
    // is no respawn point and the net hands the player to the on-foot net
    expect(vehicleRespawnPose(api(false), bounds, 0, 0, out)).toBeNull();
    expect(vehicleRespawnPose(api(false), null, 0, 0, out)).toBeNull();
  });

  it('a lane whose colliders never arrive does not hold the car: the next request takes the lane beside the shore node (BD-FIX-SPAWN-07)', async () => {
    const shore: ShoreNode = { id: 'sn.t', x: 120, y: 0, z: 60, nx: 0, nz: 1 };
    const SHORE_LANE = { x: 118, z: 50, yaw: 0 };
    // the nearest lane lies off the oracle plane: the vehicle move finds no collider under it, every time
    const { w, f } = await settled({ road: VOID, shore, shoreRoad: SHORE_LANE });
    sink(w, -25);
    drive(w, FIRST_MOVE + VEHICLE_RECOVER_RETRY_TICKS + 5);
    expect(f.moves.map((m) => [m.to.x, m.to.z, m.r.ok])).toEqual([[VOID.x, VOID.z, false], [SHORE_LANE.x, SHORE_LANE.z, true]]);
    expect(f.moves[1]!.tick - f.moves[0]!.tick).toBe(VEHICLE_RECOVER_RETRY_TICKS);
    drive(w, 30);
    expect(Math.hypot(view(w).x - SHORE_LANE.x, view(w).z - SHORE_LANE.z)).toBeLessThan(0.5);
    expect(view(w).contacts).toBeGreaterThan(0);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-ground']);
    w.sim.dispose();
  }, 60_000);

  it('after the last try the driver gets out and the on-foot net puts the player on the ground; nothing more is asked for the car (BD-FIX-SPAWN-08)', async () => {
    const { w, f } = await settled({ road: VOID });
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + VEHICLE_RECOVER_MAX_TRIES * VEHICLE_RECOVER_RETRY_TICKS + 5);
    expect(f.moves).toHaveLength(VEHICLE_RECOVER_MAX_TRIES);
    for (const m of f.moves) expect(m.r).toEqual({ ok: false, reason: CONTROL_REASON.groundNotLoaded });
    for (let k = 1; k < f.moves.length; k++) expect(f.moves[k]!.tick - f.moves[k - 1]!.tick).toBe(VEHICLE_RECOVER_RETRY_TICKS);
    drive(w, 5 * VEHICLE_RECOVER_RETRY_TICKS);
    expect(f.moves).toHaveLength(VEHICLE_RECOVER_MAX_TRIES);
    // the vehicle net says it gave up, then the on-foot net (no walkable point, the top of the ground at the fall) brings the player back
    const events = w.sim.services.events.drain();
    const rec = events.filter((e) => e.t === 'control.recover').map((e) => e.s);
    expect(rec.slice(0, 2)).toEqual(['below-ground', 'gave-up']);
    expect(rec.slice(2)).toEqual(['below-bounds']);
    // one fade per try, each back in, then the on-foot net's own
    const fd = fades(w, events).map((x) => x[0]);
    expect(fd).toHaveLength(2 * VEHICLE_RECOVER_MAX_TRIES + 2);
    for (let k = 0; k < fd.length; k += 2) expect([fd[k], fd[k + 1]]).toEqual(['out', 'in']);
    expect(isDriving(w.sim.ecs, w.player)).toBe(false);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.OnFoot);
    const d = playerPos(w);
    expect(d[1]).toBeGreaterThan(-1);
    expect(d[1]).toBeLessThan(2);
    const id = w.sim.ecs.resolve(w.vehicle) as number;
    expect(w.mod.store.rt.get(id)?.driver).toBe(0);
    expect(f.teleportAsks).toBe(0);
    w.sim.dispose();
  }, 120_000);

  it('with no respawn point at all the driver gets out on the first request tick and the on-foot net takes over (BD-FIX-SPAWN-08)', async () => {
    const { w, f } = await settled();
    f.road = null;
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 60);
    expect(f.moves).toHaveLength(0);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-ground', 'gave-up', 'below-ground']);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.OnFoot);
    const d = playerPos(w);
    expect(d[1]).toBeGreaterThan(-1);
    expect(d[1]).toBeLessThan(2);
    w.sim.dispose();
  }, 60_000);

  it('a save loaded mid-fall does not push control.recover a second time, and asks on the same ticks (BD-FIX-SPAWN-08)', async () => {
    const { w, f } = await settled({ road: VOID });
    sink(w, -25);
    drive(w, FIRST_MOVE + 10);
    expect(f.moves).toHaveLength(1);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover')).toHaveLength(1);
    const snap = w.sim.snapshot();
    const at = w.sim.tick;
    drive(w, 30);
    w.sim.restore(snap);
    expect(w.sim.tick).toBe(at);
    w.sim.services.events.drain();
    const before = f.moves.length;
    drive(w, VEHICLE_RECOVER_RETRY_TICKS);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover')).toHaveLength(0);
    // the next request goes out on the flight's own clock: 60 ticks after the first
    expect(f.moves.length).toBe(before + 1);
    expect(f.moves[f.moves.length - 1]!.tick - f.moves[0]!.tick).toBe(VEHICLE_RECOVER_RETRY_TICKS);
    w.sim.dispose();
  }, 60_000);

  it('a save loaded between the fade-out and the move still moves the car on the fade tick and fades back in', async () => {
    const { w, f } = await settled();
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 4);
    expect(fades(w).map((x) => x[0])).toEqual(['out']);
    const snap = w.sim.snapshot();
    drive(w, 30);
    expect(f.moves.map((m) => m.r.ok)).toEqual([true]);
    const moved = f.moves[0]!.tick;
    w.sim.restore(snap);
    w.sim.services.events.drain();
    drive(w, 30);
    expect(f.moves.map((m) => m.r.ok)).toEqual([true, true]);
    expect(f.moves[1]!.tick).toBe(moved);
    expect(fades(w)).toEqual([['in', moved]]);
    expect(Math.hypot(view(w).x - ROAD.x, view(w).z - ROAD.z)).toBeLessThan(0.5);
    w.sim.dispose();
  }, 60_000);

  it('a far Jobs Start while the player drives, to a marker off the roads: the move gets the driver out and moves the player on foot (BD-FIX-SPAWN-08)', async () => {
    const { w } = await settled();
    const id = w.sim.ecs.resolve(w.vehicle) as number;
    const car = view(w);
    // a plaza 300 m away, on the oracle plane, more than 8 m from any drivable edge: the world host's driver rule says off the road
    const PLAZA = { x: 300, z: 40 };
    const r = requestPlayerMove(w.sim.ecs, w.sim.services, w.player, [PLAZA.x, 0, PLAZA.z], 0, w.sim.tick, false);
    expect(r).toEqual({ ok: true });
    expect(isDriving(w.sim.ecs, w.player)).toBe(false);
    drive(w, 60);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.OnFoot);
    const d = playerPos(w);
    expect(Math.hypot(d[0] - PLAZA.x, d[2] - PLAZA.z)).toBeLessThan(1.5);
    expect(d[1]).toBeGreaterThan(-1);
    expect(d[1]).toBeLessThan(2);
    // the car stayed where it was, with nobody at the wheel
    expect(w.mod.store.rt.get(id)?.driver).toBe(0);
    expect(Math.hypot(view(w).x - car.x, view(w).z - car.z)).toBeLessThan(2);
    // on a drivable edge the driver keeps the car (02-world-maps.md 5 step 4)
    const { w: w2 } = await settled();
    expect(requestPlayerMove(w2.sim.ecs, w2.sim.services, w2.player, [ROAD.x, 0, ROAD.z], ROAD.yaw, w2.sim.tick, true)).toEqual({ ok: true });
    drive(w2, 30);
    expect(playerControl(w2).owner).toBe(CONTROL_OWNER.Vehicle);
    expect(Math.hypot(view(w2).x - ROAD.x, view(w2).z - ROAD.z)).toBeLessThan(0.5);
    // a move while another runs is refused before anything changes: the driver stays seated
    w2.sim.services.control.teleportActive = true;
    expect(requestPlayerMove(w2.sim.ecs, w2.sim.services, w2.player, [PLAZA.x, 0, PLAZA.z], 0, w2.sim.tick, false)).toEqual({ ok: false, reason: CONTROL_REASON.busy });
    expect(isDriving(w2.sim.ecs, w2.player)).toBe(true);
    w2.sim.services.control.teleportActive = false;
    w.sim.dispose();
    w2.sim.dispose();
  }, 60_000);

  it('a lane under a deck or in a water cell is skipped for the shore node beside a road (BD-FIX-SPAWN-07)', () => {
    const out = new Float64Array(4);
    const shore: ShoreNode = { id: 'sn.t', x: 120, y: 0, z: 60, nx: 0, nz: 1 };
    const bounds = { nearestShore: () => shore } as unknown as WorldBoundsPort;
    const shoreRoad = { x: 118, z: 50, yaw: 0 };
    const f: Fake = { ground: 0, road: ROAD, moves: [], edgeAsks: 0, teleportAsks: 0, shore, shoreRoad };
    const api = fakeWorld(f);
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([pose(ROAD), pose(shoreRoad)]);
    // a deck 8 m over the nearest lane: the car would be put down on the deck, off the lane
    f.top = (x, z) => (x === ROAD.x && z === ROAD.z ? VEHICLE_DECK_GAP_M + 5.5 : 0);
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([pose(shoreRoad)]);
    // a deck just inside the gap (a kerb, a ramp) does not count: the car is put down on its top, as the world teleport places
    f.top = (x, z) => (x === ROAD.x && z === ROAD.z ? VEHICLE_DECK_GAP_M - 0.5 : 0);
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([{ ...pose(ROAD), y: VEHICLE_DECK_GAP_M - 0.5 }, pose(shoreRoad)]);
    delete f.top;
    // the nearest lane is in a water cell (a bridge): skipped for the lane beside the shore node
    f.water = (x, z) => x === ROAD.x && z === ROAD.z;
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([pose(shoreRoad)]);
    // the lane beside the shore node is in water too
    f.water = () => true;
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([]);
    // no lane beside the shore node: no point inland of it either (it lies off the drivable edges)
    delete f.water;
    f.top = (x, z) => (x === ROAD.x && z === ROAD.z ? VEHICLE_DECK_GAP_M + 5.5 : 0);
    delete f.shoreRoad;
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([]);
  });

  it('leaves a car a mode claims to the mode (the race director resets its own car, BD-FIX-SPAWN-07)', async () => {
    const { w, f } = await settled();
    let claimed = true;
    w.sim.services.vehicleFallClaim = (h) => claimed && h === w.vehicle;
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 2 * VEHICLE_RECOVER_RETRY_TICKS);
    expect(f.moves).toHaveLength(0);
    const events = w.sim.services.events.drain();
    expect(events.some((e) => e.t === 'control.recover' || e.t === 'world.teleport')).toBe(false);
    // the race ends: the net takes the car on its next request tick
    claimed = false;
    drive(w, VEHICLE_RECOVER_RETRY_TICKS + VEHICLE_RESCUE_FADE_TICKS + 5);
    expect(f.moves.map((m) => m.r.ok)).toEqual([true]);
    w.sim.dispose();
  }, 60_000);

  it('a new flight after a landing gets its own control.recover and its own count (BD-FIX-SPAWN-07)', async () => {
    const { w, f } = await settled();
    sink(w, -25);
    drive(w, FIRST_MOVE + 30);
    expect(f.moves).toHaveLength(1);
    drive(w, 60);
    sink(w, -25);
    drive(w, FIRST_MOVE + 30);
    expect(f.moves.map((m) => m.r.ok)).toEqual([true, true]);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-ground', 'below-ground']);
    w.sim.dispose();
  }, 60_000);

  it('is deterministic: the same run twice gives the same state hash', async () => {
    const run = async (passenger: boolean): Promise<string> => {
      const { w } = await settled();
      if (passenger) makePassenger(w);
      sink(w, -25);
      drive(w, FIRST_MOVE + 60);
      const h = w.sim.hash();
      w.sim.dispose();
      return h;
    };
    expect(await run(false)).toBe(await run(false));
    expect(await run(true)).toBe(await run(true));
  }, 120_000);
});

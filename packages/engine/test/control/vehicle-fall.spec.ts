/**
 * The below-the-world net for a driven vehicle (02-world-maps.md 4.1 d, DL-734; BD-FIX-SPAWN-05). A sedan with the player at its wheel
 * that has been in the air for 120 ticks under the ground (or under the floor of the play box) asks the world's teleport for a respawn
 * at the nearest road-adjacent point, and the teleport's move (`requestDriverTeleport`, the vehicle module's `vehicleMove`) puts the car
 * and its driver on the road there. The `WorldApi` here is a fake with the queries the net reads; its `teleport.request` stands for the
 * world's `TeleportService`, whose host calls `requestDriverTeleport` for a driver (`packages/world/src/sim/streaming/module.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { EdgeId, ShoreNode, TeleportKind, TeleportResult, TeleportTarget, WorldApi } from '@dv/shared';
import {
  FALL_FLOOR_Y, FALL_RECOVER_TICKS, VEHICLE_DECK_GAP_M, VEHICLE_RECOVER_MAX_TRIES, VEHICLE_RECOVER_RETRY_TICKS, VEHICLE_ROAD_SEARCH_M,
  vehicleRespawnCandidates, vehicleRespawnPose,
} from '../../src/sim/control/fall.ts';
import { isDriving, requestDriverTeleport } from '../../src/sim/control/ownership.ts';
import { CONTROL_OWNER, CONTROL_REASON } from '../../src/sim/control/states.ts';
import { BodyRef, Transform } from '../../src/sim/ecs/components.ts';
import type { VehiclePhysics } from '../../src/sim/physics/backend.ts';
import type { WorldBoundsPort } from '../../src/sim/world/index.ts';
import { createVehicleWorld, drive, playerControl, view, type VehicleWorld } from '../vehicle-sim.ts';

/** The road point the fake graph answers: on the oracle ground plane (flat at y 0), facing +X (yaw -pi/2: forward is (-sin, -cos)). */
const ROAD = { x: 60, z: 20, yaw: -Math.PI / 2 };
/** Off the oracle plane (it ends at x 2,400): no static collider under it. */
const VOID = { x: 5000, z: 20, yaw: 0 };

interface Fake {
  /** The lowest surface `groundY(x, z, -1e6)` answers; null where nothing is resident. */
  ground: number | null;
  road: { x: number; z: number; yaw: number } | null;
  /** What the teleport's move answered, per request. */
  moves: { tick: number; to: { x: number; z: number; yaw: number }; r: { ok: boolean; reason?: string } }[];
  edgeAsks: number;
  /** The top surface `groundY(x, z)` answers there (a deck over the road), when set; else `ground`. */
  top?: (x: number, z: number) => number | null;
  /** Water cells, when set (the teleport refuses them). */
  water?: (x: number, z: number) => boolean;
  /** The road-adjacent shore node `bounds.nearestShore` answers, when set (the world's bounds port is installed then). */
  shore?: ShoreNode;
  /** The lane centre beside the shore node (the 15 m search from it), when set. */
  shoreRoad?: { x: number; z: number; yaw: number };
  /** The teleport's answer for a target, when set: a refusal moves nothing (the world's `TeleportService` validation and placement). */
  refuse?: (to: { x: number; z: number }) => TeleportResult | null;
}

function fakeWorld(w: VehicleWorld, f: Fake): WorldApi {
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
      // the world teleport after its pre-stream and fade: the host moves a driver with the vehicle
      request: (kind: TeleportKind, to: TeleportTarget): Promise<TeleportResult> => {
        expect(kind).toBe('respawn');
        const t = to as { x: number; z: number; yaw: number };
        const no = f.refuse?.(t) ?? null;
        if (no) {
          f.moves.push({ tick: w.sim.tick, to: t, r: { ok: false, reason: no.ok ? 'ok' : no.reason } });
          return Promise.resolve(no);
        }
        const r = requestDriverTeleport(w.sim.ecs, w.sim.services, w.player, [t.x, 0, t.z], t.yaw);
        f.moves.push({ tick: w.sim.tick, to: t, r });
        return Promise.resolve(r.ok ? { ok: true, x: t.x, y: 0, z: t.z, yaw: t.yaw } : { ok: false, reason: 'blocked', messageKey: 'world.teleport.busy' });
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

async function settled(f: Partial<Fake> = {}): Promise<{ w: VehicleWorld; f: Fake }> {
  const w = await createVehicleWorld({ pos: [0, 0, 0] });
  const fake: Fake = { ground: 0, road: ROAD, moves: [], edgeAsks: 0, ...f };
  w.sim.services.world.api = fakeWorld(w, fake);
  if (fake.shore) {
    // the water wall reads the depth every tick: dry land here
    w.sim.services.world.bounds = { nearestShore: (_x: number, _z: number, road: boolean) => (road ? fake.shore ?? null : null), waterDepth: () => 0, onClosureChange: () => () => undefined } as unknown as WorldBoundsPort;
  }
  drive(w, 60);
  expect(view(w).contacts).toBeGreaterThan(0);
  expect(isDriving(w.sim.ecs, w.player)).toBe(true);
  w.sim.services.events.drain();
  return { w, f: fake };
}

/** The player's capsule (it follows the seat). */
function driverPos(w: VehicleWorld): [number, number, number] {
  const id = w.sim.ecs.resolve(w.player) as number;
  const tr = w.sim.ecs.store(Transform);
  return [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number];
}

describe('below-the-world net for a driven vehicle (DL-734)', () => {
  it('respawns a car that fell under the ground, with its driver, on the nearest road after 2 s in the air', async () => {
    const { w, f } = await settled();
    const sunkAt = w.sim.tick;
    sink(w, -25);
    let backAfter = -1;
    for (let i = 1; i <= 400 && backAfter < 0; i++) {
      drive(w, 1);
      if (f.moves.length > 0) backAfter = i;
    }
    // asked once the car had been in the air for 120 ticks (the sink tick counts as its first airborne tick)
    expect(backAfter).toBeGreaterThanOrEqual(FALL_RECOVER_TICKS - 1);
    expect(backAfter).toBeLessThanOrEqual(FALL_RECOVER_TICKS + 2);
    expect(f.moves).toHaveLength(1);
    expect(f.moves[0]!.r).toEqual({ ok: true });
    expect(f.moves[0]!.to).toEqual(ROAD);
    expect(f.moves[0]!.tick - sunkAt).toBeLessThanOrEqual(FALL_RECOVER_TICKS + 3);
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
    const d = driverPos(w);
    expect(Math.hypot(d[0] - v.x, d[2] - v.z)).toBeLessThan(1.5);
    expect(w.mod.store.rt.get(id)?.airTicks).toBe(0);
    const events = w.sim.services.events.drain();
    expect(events.filter((e) => e.t === 'control.recover').map((e) => [e.s, e.a])).toEqual([['below-ground', w.player]]);
    // and it drives on
    drive(w, 120, { throttle: 127 });
    expect(Math.abs(view(w).speed)).toBeGreaterThan(3);
    expect(f.moves).toHaveLength(1);
    w.sim.dispose();
  }, 60_000);

  it('under the floor of the play box with nothing resident, says below-bounds', async () => {
    const { w, f } = await settled();
    f.ground = null;
    sink(w, FALL_FLOOR_Y - 5);
    drive(w, FALL_RECOVER_TICKS + 5);
    expect(f.moves.map((m) => m.r.ok)).toEqual([true]);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-bounds']);
    w.sim.dispose();
  }, 60_000);

  it('a move over ground with no collider yet is refused and asked again every second, with one control.recover', async () => {
    const { w, f } = await settled({ road: VOID });
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 2 * VEHICLE_RECOVER_RETRY_TICKS + 5);
    expect(f.moves.length).toBe(3);
    for (const m of f.moves) expect(m.r).toEqual({ ok: false, reason: CONTROL_REASON.groundNotLoaded });
    expect(f.moves[1]!.tick - f.moves[0]!.tick).toBe(VEHICLE_RECOVER_RETRY_TICKS);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover')).toHaveLength(1);
    // the road appears (its colliders are there): the next ask brings the car back
    f.road = ROAD;
    drive(w, VEHICLE_RECOVER_RETRY_TICKS + 30);
    expect(f.moves[f.moves.length - 1]!.r).toEqual({ ok: true });
    expect(Math.hypot(view(w).x - ROAD.x, view(w).z - ROAD.z)).toBeLessThan(0.5);
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
    const g: Fake = { ground: 0, road: ROAD, moves: [], edgeAsks: 0 };
    parked.sim.services.world.api = fakeWorld(parked, g);
    drive(parked, 30);
    sink(parked, -25);
    drive(parked, FALL_RECOVER_TICKS + 60);
    expect(g.moves).toHaveLength(0);
    expect(g.edgeAsks).toBe(0);
    parked.sim.dispose();
  }, 60_000);

  it('does nothing without a baked world', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0] });
    expect(w.sim.services.world.api).toBeNull();
    drive(w, 60);
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 60);
    expect(view(w).y).toBeLessThan(-25);
    expect(w.sim.services.events.drain().some((e) => e.t === 'control.recover')).toBe(false);
    w.sim.dispose();
  }, 60_000);

  it('requestDriverTeleport refuses a player on foot, and isDriving tells', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0], seated: false });
    drive(w, 5);
    expect(isDriving(w.sim.ecs, w.player)).toBe(false);
    expect(requestDriverTeleport(w.sim.ecs, w.sim.services, w.player, [ROAD.x, 0, ROAD.z], 0)).toEqual({ ok: false, reason: CONTROL_REASON.wrongOwner });
    w.sim.dispose();
  }, 60_000);

  it('the respawn point: the nearest lane centre, else the water wall\'s road-adjacent shore node facing inland', () => {
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
    expect(vehicleRespawnPose(api(true), bounds, 0, 0, out)).toEqual({ x: 1, z: 3, yaw: 0.5 });
    const p = vehicleRespawnPose(api(false), bounds, 0, 0, out);
    expect(p?.x).toBe(2);
    expect(p?.z).toBe(40);
    expect(-Math.sin(p?.yaw ?? 0)).toBeCloseTo(-1, 6);   // facing inland, -X
    expect(vehicleRespawnPose(api(false), null, 0, 0, out)).toBeNull();
  });

  it('a refusal that never changes for the road point does not hold the car: the next request takes the shore point (BD-FIX-SPAWN-07)', async () => {
    const shore: ShoreNode = { id: 'sn.t', x: 120, y: 0, z: 60, nx: 0, nz: 1 };
    const SHORE_LANE = { x: 118, z: 50, yaw: 0 };
    const { w, f } = await settled({
      shore, shoreRoad: SHORE_LANE,
      // the world refuses the nearest lane every time (a bridge deck over water with no dry point within 40 m)
      refuse: (to) => (to.x === ROAD.x && to.z === ROAD.z ? { ok: false, reason: 'water', messageKey: 'world.teleport.water' } : null),
    });
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + VEHICLE_RECOVER_RETRY_TICKS + 5);
    expect(f.moves.map((m) => [m.to.x, m.to.z, m.r.ok])).toEqual([[ROAD.x, ROAD.z, false], [SHORE_LANE.x, SHORE_LANE.z, true]]);
    expect(f.moves[1]!.tick - f.moves[0]!.tick).toBe(VEHICLE_RECOVER_RETRY_TICKS);
    drive(w, 30);
    expect(Math.hypot(view(w).x - SHORE_LANE.x, view(w).z - SHORE_LANE.z)).toBeLessThan(0.5);
    expect(view(w).contacts).toBeGreaterThan(0);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-ground']);
    w.sim.dispose();
  }, 60_000);

  it('gives up after the last try with one control.recover gave-up, and asks nothing more for that flight (BD-FIX-SPAWN-07)', async () => {
    const { w, f } = await settled({ refuse: () => ({ ok: false, reason: 'blocked', messageKey: 'world.teleport.blocked' }) });
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + VEHICLE_RECOVER_MAX_TRIES * VEHICLE_RECOVER_RETRY_TICKS + 5);
    expect(f.moves).toHaveLength(VEHICLE_RECOVER_MAX_TRIES);
    for (let k = 1; k < f.moves.length; k++) expect(f.moves[k]!.tick - f.moves[k - 1]!.tick).toBe(VEHICLE_RECOVER_RETRY_TICKS);
    drive(w, 5 * VEHICLE_RECOVER_RETRY_TICKS);
    expect(f.moves).toHaveLength(VEHICLE_RECOVER_MAX_TRIES);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-ground', 'gave-up']);
    w.sim.dispose();
  }, 120_000);

  it('a lane under a deck or in a water cell is skipped for the shore node beside a road (BD-FIX-SPAWN-07)', () => {
    const out = new Float64Array(4);
    const shore: ShoreNode = { id: 'sn.t', x: 120, y: 0, z: 60, nx: 0, nz: 1 };
    const bounds = { nearestShore: () => shore } as unknown as WorldBoundsPort;
    const f: Fake = { ground: 0, road: ROAD, moves: [], edgeAsks: 0, shore, shoreRoad: { x: 118, z: 50, yaw: 0 } };
    const api = fakeWorld(null as unknown as VehicleWorld, f);
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([ROAD, f.shoreRoad]);
    // a deck 8 m over the nearest lane: the teleport would land the car on the deck, off the lane
    f.top = (x, z) => (x === ROAD.x && z === ROAD.z ? VEHICLE_DECK_GAP_M + 5.5 : 0);
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([f.shoreRoad]);
    // a deck just inside the gap (a kerb, a ramp) does not count
    f.top = (x, z) => (x === ROAD.x && z === ROAD.z ? VEHICLE_DECK_GAP_M - 0.5 : 0);
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([ROAD, f.shoreRoad]);
    delete f.top;
    // the nearest lane is in a water cell (a bridge): skipped; no lane beside the shore node, so the point inland of it, facing inland
    f.water = (x, z) => x === ROAD.x && z === ROAD.z;
    delete f.shoreRoad;
    const c = vehicleRespawnCandidates(api, bounds, 0, 0, out);
    expect(c).toHaveLength(1);
    expect(c[0]!.x).toBe(120);
    expect(c[0]!.z).toBe(57);
    expect(-Math.cos(c[0]!.yaw)).toBeCloseTo(-1, 6);   // forward (-sin, -cos) points -Z, inland
    // the inland point is in water too: nothing to offer
    f.water = () => true;
    expect(vehicleRespawnCandidates(api, bounds, 0, 0, out)).toEqual([]);
  });

  it('leaves a car a mode claims to the mode (the race director resets its own car, BD-FIX-SPAWN-07)', async () => {
    const { w, f } = await settled();
    let claimed = true;
    w.sim.services.vehicleFallClaim = (h) => claimed && h === w.vehicle;
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 2 * VEHICLE_RECOVER_RETRY_TICKS);
    expect(f.moves).toHaveLength(0);
    expect(w.sim.services.events.drain().some((e) => e.t === 'control.recover')).toBe(false);
    // the race ends: the net takes the car on its next request tick
    claimed = false;
    drive(w, VEHICLE_RECOVER_RETRY_TICKS + 5);
    expect(f.moves.map((m) => m.r.ok)).toEqual([true]);
    w.sim.dispose();
  }, 60_000);

  it('a new flight after a landing gets its own control.recover and its own count (BD-FIX-SPAWN-07)', async () => {
    const { w, f } = await settled();
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 30);
    expect(f.moves).toHaveLength(1);
    drive(w, 60);
    sink(w, -25);
    drive(w, FALL_RECOVER_TICKS + 30);
    expect(f.moves.map((m) => m.r.ok)).toEqual([true, true]);
    expect(w.sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-ground', 'below-ground']);
    w.sim.dispose();
  }, 60_000);

  it('is deterministic: the same run twice gives the same state hash', async () => {
    const run = async (): Promise<string> => {
      const { w } = await settled();
      sink(w, -25);
      drive(w, FALL_RECOVER_TICKS + 60);
      const h = w.sim.hash();
      w.sim.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  }, 120_000);
});

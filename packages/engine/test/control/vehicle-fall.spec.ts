/**
 * The below-the-world net for a driven vehicle (02-world-maps.md 4.1 d, DL-734; BD-FIX-SPAWN-05). A sedan with the player at its wheel
 * that has been in the air for 120 ticks under the ground (or under the floor of the play box) asks the world's teleport for a respawn
 * at the nearest road-adjacent point, and the teleport's move (`requestDriverTeleport`, the vehicle module's `vehicleMove`) puts the car
 * and its driver on the road there. The `WorldApi` here is a fake with the queries the net reads; its `teleport.request` stands for the
 * world's `TeleportService`, whose host calls `requestDriverTeleport` for a driver (`packages/world/src/sim/streaming/module.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { EdgeId, ShoreNode, TeleportKind, TeleportResult, TeleportTarget, WorldApi } from '@dv/shared';
import { FALL_FLOOR_Y, FALL_RECOVER_TICKS, VEHICLE_RECOVER_RETRY_TICKS, VEHICLE_ROAD_SEARCH_M, vehicleRespawnPose } from '../../src/sim/control/fall.ts';
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
}

function fakeWorld(w: VehicleWorld, f: Fake): WorldApi {
  return {
    query: { groundY: () => f.ground, nearestWalkable: () => null },
    graph: {
      nearestEdge: (_x: number, _z: number, _y: number | undefined, maxM: number) => {
        f.edgeAsks++;
        expect(maxM).toBe(VEHICLE_ROAD_SEARCH_M);
        return f.road ? { edge: 7 as EdgeId, s: 3, distM: 5 } : null;
      },
      laneCentre: (_e: unknown, out: Float64Array) => {
        const r = f.road as { x: number; z: number; yaw: number };
        out[0] = r.x; out[1] = 0; out[2] = r.z; out[3] = r.yaw;
      },
    },
    teleport: {
      // the world teleport after its pre-stream and fade: the host moves a driver with the vehicle
      request: (kind: TeleportKind, to: TeleportTarget): Promise<TeleportResult> => {
        expect(kind).toBe('respawn');
        const t = to as { x: number; z: number; yaw: number };
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

/**
 * The water soft wall for vehicles (M03a1, AC-12; 02-world-maps.md 4.1 a, DL-691): a sedan driven into water 0.7 m deep at the
 * wheels stalls at tick 90 and respawns, with its driver, at the nearest road-adjacent shore node facing inland. The rule is
 * `waterWall` from `@dv/shared`; this file drives it through `vehicle-system.ts` with a fake `WorldBoundsPort`.
 */
import { describe, expect, it } from 'vitest';
import { WATER_WALL_TICKS, type Portal, type ShoreNode } from '@dv/shared';
import { Transform } from '../src/sim/ecs/components.ts';
import { placeVehicle, RESPAWN_FADE_TICKS } from '../src/sim/vehicle/vehicle-system.ts';
import { CONTROL_OWNER } from '../src/sim/control/states.ts';
import type { WorldBoundsPort } from '../src/sim/world/index.ts';
import { createVehicleWorld, drive, playerControl, THROTTLE, view } from './vehicle-sim.ts';

const SHORE: ShoreNode = { id: 'sn.test', x: 5, y: 0, z: 40, nx: 1, nz: 0 };

/** Water of `depth` metres east of x = 20; one shore node at (5, 0, 40) whose sea side faces +X. */
function port(depth: number): WorldBoundsPort & { asked: [number, number, boolean][] } {
  const asked: [number, number, boolean][] = [];
  return {
    asked,
    portals: (): readonly Portal[] => [],
    setPortalState: () => false,
    release: () => undefined,
    sealedPortals: (): readonly string[] => [],
    nearestShore(x: number, z: number, roadAdjacent: boolean): ShoreNode | null {
      asked.push([x, z, roadAdjacent]);
      return SHORE;
    },
    waterDepth: (x: number): number => (x > 20 ? depth : 0),
    onClosureChange: () => () => undefined,
  };
}

describe('vehicle water wall', () => {
  it('at 0.7 m throttle stops working from tick 90 and the vehicle and driver respawn at the shore facing inland', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0] });
    const p = port(0.7);
    w.sim.services.world.bounds = p;
    drive(w, 30);
    // drive in at a gentle pace so that the car is still rolling when the timer ends
    let wetFrom = -1;
    const wetTicks: number[] = [];
    let stalledAt = -1;
    const vid = w.sim.ecs.resolve(w.vehicle) as number;
    for (let i = 0; i < 600 && stalledAt < 0; i++) {
      drive(w, 1, { throttle: 40 });
      const rt = w.mod.store.rt.get(vid);
      wetTicks.push(rt?.wet.wetTicks ?? 0);
      if (wetFrom < 0 && (rt?.wet.wetTicks ?? 0) > 0) wetFrom = i;
      if (rt?.wet.stalled) stalledAt = i;
    }
    expect(wetFrom).toBeGreaterThan(0);
    // the call that reaches the 90th wet tick stalls: tick 90, not 89
    expect(stalledAt - wetFrom + 1).toBe(WATER_WALL_TICKS);
    expect(wetTicks[stalledAt - 1]).toBe(WATER_WALL_TICKS - 1);

    // from the stall on, full throttle does nothing: the car slows down
    const v0 = view(w).speed;
    drive(w, 20, { throttle: THROTTLE });
    expect(view(w).speed).toBeLessThan(v0);

    // after the fade the vehicle and its driver are at the shore node, inland of it (the sea faces +X, so inland is -X)
    drive(w, RESPAWN_FADE_TICKS);
    const v = view(w);
    expect(v.x).toBeCloseTo(SHORE.x - SHORE.nx * 3, 0);
    expect(v.z).toBeCloseTo(SHORE.z, 0);
    expect(p.asked[0]?.[2]).toBe(true);                // road-adjacent only
    // facing inland: forward is -X
    const id = w.sim.ecs.resolve(w.vehicle) as number;
    const qy = w.sim.ecs.store(Transform).qy[id] as number;
    const qw = w.sim.ecs.store(Transform).qw[id] as number;
    const yaw = 2 * Math.atan2(qy, qw);
    expect(-Math.sin(yaw)).toBeCloseTo(-1, 1);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    expect(w.mod.store.rt.get(id)?.wet).toEqual({ wetTicks: 0, stalled: false });
    // and it drives again
    drive(w, 120, { throttle: THROTTLE });
    expect(Math.abs(view(w).speed)).toBeGreaterThan(3);
    w.sim.dispose();
  }, 60_000);

  it('at 0.5 m nothing happens', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0] });
    w.sim.services.world.bounds = port(0.5);
    drive(w, 30);
    const vid = w.sim.ecs.resolve(w.vehicle) as number;
    for (let i = 0; i < 400; i++) drive(w, 1, { throttle: 60 });
    const rt = w.mod.store.rt.get(vid);
    expect(view(w).x).toBeGreaterThan(40);               // it drove through the shallows
    expect(rt?.wet).toEqual({ wetTicks: 0, stalled: false });
    expect(w.sim.hash()).toBe(w.sim.hash());
    w.sim.dispose();
  }, 60_000);

  // DL-753 (02-world-maps.md 4.1 a): with the player at the wheel, pedals held through the stall and the fade move nothing after the
  // respawn until every one has been released once; the car faces inland and the respawn is recorded for the page's camera.
  it('latches the throttle held through the stall: the respawned car stays put until the pedals are released', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0] });
    w.sim.services.world.bounds = port(0.7);
    drive(w, 30);
    const vid = w.sim.ecs.resolve(w.vehicle) as number;
    const c = w.sim.services.control;
    let stalled = false;
    for (let i = 0; i < 600 && !stalled; i++) {
      drive(w, 1, { throttle: 40 });
      stalled = w.mod.store.rt.get(vid)?.wet.stalled ?? false;
    }
    expect(stalled).toBe(true);
    expect(c.moveLatch).toBe(true);
    expect(c.respawnSeq).toBe(0);
    // full throttle held through the fade and the respawn
    let respawned = false;
    for (let i = 0; i < RESPAWN_FADE_TICKS + 5 && !respawned; i++) {
      drive(w, 1, { throttle: THROTTLE, steer: 60 });
      respawned = c.respawnSeq === 1;
    }
    expect(respawned).toBe(true);
    const at = view(w);
    expect(at.x).toBeCloseTo(SHORE.x - SHORE.nx * 3, 0);
    expect(-Math.sin(c.respawnYaw)).toBeCloseTo(-1, 6);    // inland is -X: the car and the camera face it
    // 2 s more of full throttle (and the wheel turned): the car does not drive back into the water
    drive(w, 120, { throttle: THROTTLE, steer: 60 });
    const still = view(w);
    expect(Math.hypot(still.x - at.x, still.z - at.z)).toBeLessThan(0.3);
    expect(Math.abs(still.speed)).toBeLessThan(0.2);
    expect(c.moveLatch).toBe(true);
    expect(w.mod.store.rt.get(vid)?.input.throttle).toBe(0);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    // released for one tick, then the throttle drives inland as usual
    drive(w, 1);
    expect(c.moveLatch).toBe(false);
    drive(w, 120, { throttle: THROTTLE });
    expect(view(w).speed).toBeGreaterThan(3);
    expect(view(w).x).toBeLessThan(still.x - 2);
    w.sim.dispose();
  }, 60_000);

  it('does not latch the player for an ambient car that stalls in the water', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0], seated: false });
    w.sim.services.world.bounds = port(0.7);
    const vid = w.sim.ecs.resolve(w.vehicle) as number;
    drive(w, 2);
    const rt = w.mod.store.rt.get(vid);
    expect(rt).toBeDefined();
    // put the empty car down in the water and let the wall run: it stalls and respawns without touching the player's latch
    placeVehicle(w.sim.backend, rt!, w.sim.ecs, vid, 30, 0, 0, 0);
    let respawned = false;
    for (let i = 0; i < 300 && !respawned; i++) {
      drive(w, 1);
      respawned = Math.abs(view(w).x - (SHORE.x - SHORE.nx * 3)) < 0.5;
    }
    expect(respawned).toBe(true);
    expect(w.sim.services.control.moveLatch).toBe(false);
    expect(w.sim.services.control.respawnSeq).toBe(0);
    w.sim.dispose();
  }, 60_000);
});

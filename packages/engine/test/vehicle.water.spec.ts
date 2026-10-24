/**
 * The water soft wall for vehicles (M03a1, AC-12; 02-world-maps.md 4.1 a, DL-691): a sedan driven into water 0.7 m deep at the
 * wheels stalls at tick 90 and respawns, with its driver, at the nearest road-adjacent shore node facing inland. The rule is
 * `waterWall` from `@dv/shared`; this file drives it through `vehicle-system.ts` with a fake `WorldBoundsPort`.
 */
import { describe, expect, it } from 'vitest';
import { WATER_WALL_TICKS, type Portal, type ShoreNode } from '@dv/shared';
import { Transform } from '../src/sim/ecs/components.ts';
import { RESPAWN_FADE_TICKS } from '../src/sim/vehicle/vehicle-system.ts';
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
});

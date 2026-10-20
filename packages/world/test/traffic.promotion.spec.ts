/**
 * M03b1 AC-6: near agents and promotion, with the real ECS and Rapier. A near agent is a kinematic box; when a vehicle hits it at a
 * speed difference of 3 m/s or more it becomes the vehicle prefab (dynamic) for at most 8 s and then a wreck that holds its handbrake
 * and is removed after 10 s out of sight; at most the tier's cap of agents is promoted at once and at most its cap is near.
 */
import { describe, expect, it } from 'vitest';
import type { ChunkKey, SimConfig, StableKey } from '@dv/shared';
import {
  BodyRef, ENGINE_PREFABS, PrefabRegistry, Transform, Vehicle, createPhysicsSim, groundHeightfield, registerVehicleModule,
  type PhysicsSim, type VehicleModule,
} from '@dv/engine/sim';
import { createWorldApi } from '../src/sim/api/world-api.ts';
import { ARCH } from '../src/sim/traffic/components.ts';
import { NEAR_CAP, PROMOTED_CAP } from '../src/sim/traffic/density.ts';
import { PROMOTED_TICKS, WRECK_UNSEEN_TICKS } from '../src/sim/traffic/promote.ts';
import { WORLD_COMPONENTS } from '../src/sim/traffic/components.ts';
import { AmbientTraffic } from '../src/sim/traffic/system.ts';
import { crossRoads } from './fixtures/roads.ts';
import { indexOf, loadAll, storeOf } from './fixtures/world.ts';

const CELL = '9/256/256' as ChunkKey;
const CFG: SimConfig = { seed: 7, profile: 'canonical', physicsBuild: 'deterministic-compat', tier: 'mobile-low', worldBake: 'test', hashEvery: 0 };

interface World {
  sim: PhysicsSim;
  mod: VehicleModule;
  traffic: AmbientTraffic;
  cross: ReturnType<typeof crossRoads>;
  prefabs: PrefabRegistry;
}

async function world(): Promise<World> {
  const cross = crossRoads({ armM: 100, speedMps: 11.25 });
  const store = storeOf([cross.chunk]);
  await loadAll(store, [CELL]);
  const holder: { mod: VehicleModule | null; prefabs: PrefabRegistry | null } = { mod: null, prefabs: null };
  const sim = await createPhysicsSim(CFG, {
    id: 'traffic-promotion',
    setup: (s) => {
      s.backend.addChunkStatics('ground', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
      const prefabs = new PrefabRegistry(s.ecs, s.backend);
      prefabs.load(ENGINE_PREFABS);
      holder.mod = registerVehicleModule(s.core, s.backend, prefabs);
      holder.prefabs = prefabs;
    },
  }, { ecs: { components: WORLD_COMPONENTS } });
  const clock = { t: 0 };
  const api = createWorldApi(store, indexOf(), { tick: () => clock.t }, {});
  const traffic = new AmbientTraffic({
    ecs: sim.ecs, backend: sim.backend, services: sim.services, world: api, store, cfg: CFG, seed: 1234, initialFill: false, parked: false,
  });
  traffic.focusOverride = { x: 0, z: 0, vx: 0, vz: 0 };
  sim.core.addSystem(traffic.system());
  sim.core.addResource(traffic.resource());
  return { sim, mod: holder.mod as VehicleModule, traffic, cross, prefabs: holder.prefabs as PrefabRegistry };
}

/** A car that rolls free at `speed` along -Z (north) from (x, z). */
function roll(w: World, key: string, x: number, z: number, speed: number): number {
  const h = w.prefabs.spawn('vehicle.sedan', { pos: [x, 0, z], yaw: 0 }, key as StableKey);
  w.sim.step(1);
  const id = w.sim.ecs.resolve(h);
  if (id === null) throw new Error('vehicle not created');
  const rt = w.mod.store.ensure(id, 'hp.sedan');
  rt.external = true;
  rt.input.throttle = 0;
  rt.input.brake = 0;
  rt.input.handbrake = false;
  const body = w.sim.ecs.store(BodyRef).body[id] as number;
  w.sim.backend.setBodyVelocity(body, [0, 0, -speed], [0, 0, 0]);
  return id;
}

describe('AC-6: promotion', () => {
  it('a near agent gets a kinematic body, and a vehicle that hits it at 3 m/s or more turns it into a dynamic vehicle for 8 s, then a wreck', async () => {
    const w = await world();
    const { sim, traffic, cross } = w;
    // an agent waiting at the red light of the east arm (the east-west phase turns green at tick 1440); a car comes from behind along its line
    const a = traffic.sim.place({ key: 'amb:9/256/256:60', cell: CELL, slot: 60, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[1] as number, s: 80, lane: 0, speed: 0 });
    if (!a) throw new Error('not placed');
    sim.step(6);
    expect(a.handle).not.toBe(0);
    expect(a.body).not.toBe(0);
    expect(sim.backend.bodyKind(a.body)).toBe('kinematic');
    const ent = sim.ecs.resolve(a.handle as never);
    expect(ent).not.toBeNull();
    expect(sim.ecs.byKey('amb:9/256/256:60' as StableKey)).not.toBe(0);

    const startX = a.x, startZ = a.z;
    // a car 40 m behind it (towards the arm end), driving the way the agent faces
    const behind = { x: startX - a.fx * 40, z: startZ - a.fz * 40 };
    const id = roll(w, 'veh:player', behind.x, behind.z, 12);
    void id;
    // put the car on the street's heading
    const veh = sim.ecs.byKey('veh:player' as StableKey);
    const vid = sim.ecs.resolve(veh) as number;
    const body = sim.ecs.store(BodyRef).body[vid] as number;
    const half = a.yaw / 2;
    sim.backend.setBodyPose(body, [behind.x, 0.6, behind.z], [0, Math.sin(half), 0, Math.cos(half)]);
    sim.backend.setBodyVelocity(body, [a.fx * 12, 0, a.fz * 12], [0, 0, 0]);

    let promotedAt = -1;
    let maxPromoted = 0;
    for (let t = 0; t < 400 && promotedAt < 0; t++) {
      sim.step(1);
      maxPromoted = Math.max(maxPromoted, traffic.sim.promotions.count);
      if (traffic.sim.stats.promotions > 0) promotedAt = sim.core.tick;
    }
    expect(promotedAt).toBeGreaterThan(0);
    expect(traffic.sim.agents.has('amb:9/256/256:60')).toBe(false);
    expect(maxPromoted).toBeLessThanOrEqual(PROMOTED_CAP['mobile-low']);

    // the promoted vehicle exists as the sedan prefab with its handling and rolls free
    sim.step(4);
    const key = `veh:amb.${CELL}.60.1` as StableKey;
    const h = sim.ecs.byKey(key);
    expect(h).not.toBe(0);
    const pid = sim.ecs.resolve(h) as number;
    expect(sim.ecs.hasId(pid, Vehicle)).toBe(true);
    expect(sim.backend.bodyKind(sim.ecs.store(BodyRef).body[pid] as number)).toBe('dynamic');
    const rt = w.mod.store.rt.get(pid);
    expect(rt?.external).toBe(true);
    expect(rt?.input.handbrake).toBe(false);
    expect(sim.ecs.byKey('amb:9/256/256:60' as StableKey)).toBe(0);

    // 8 s after the hit it is a wreck: the handbrake holds, the promotion slot is free again
    sim.step(PROMOTED_TICKS + 6);
    expect(traffic.sim.promotions.count).toBe(0);
    const rt2 = w.mod.store.rt.get(pid);
    expect(rt2?.external).toBe(false);
    expect(rt2?.input.handbrake).toBe(true);

    // out of sight for 10 s: removed
    traffic.focusOverride = { x: 0, z: 900, vx: 0, vz: 0 };
    sim.step(WRECK_UNSEEN_TICKS + 20);
    expect(sim.ecs.byKey(key)).toBe(0);
    void Transform;
    sim.dispose();
  }, 60_000);

  it('at most the cap of agents is promoted at once, and at most the cap of agents has a body', async () => {
    const w = await world();
    const { sim, traffic, cross } = w;
    // agents waiting in a queue at the red lights of the east and west arms, all within 80 m of the centre; fast cars rolled into them
    const placed: string[] = [];
    for (let i = 0; i < 8; i++) {
      const arm = i % 2 === 0 ? 1 : 3;
      const a = traffic.sim.place({ key: `amb:9/256/256:${70 + i}`, cell: CELL, slot: 70 + i, epoch: 1, arch: ARCH.compact, edge: cross.inEdge[arm] as number, s: 60 + Math.floor(i / 2) * 6.5, lane: 0, speed: 0 });
      if (!a) throw new Error('not placed');
      placed.push(a.key);
    }
    sim.step(6);
    let withBody = 0;
    for (const k of placed) if ((traffic.sim.agents.get(k)?.body ?? 0) !== 0) withBody++;
    expect(withBody).toBe(8);
    // forty more near agents on the north and south arms: the body cap holds
    for (let i = 0; i < 40; i++) {
      const arm = i % 2 === 0 ? 0 : 2;
      traffic.sim.place({ key: `amb:9/256/256:${100 + i}`, cell: CELL, slot: 100 + i, epoch: 1, arch: ARCH.compact, edge: cross.inEdge[arm] as number, s: 6 + Math.floor(i / 2) * 4, lane: 0, speed: 0 });
    }
    sim.step(6);
    const bodies = traffic.sim.agents.list().filter((x) => x.body !== 0).length;
    expect(bodies).toBeLessThanOrEqual(NEAR_CAP['mobile-low']);
    expect(bodies).toBeGreaterThan(8);

    // hit them with a stream of cars: the number promoted at once never passes the cap
    let max = 0;
    for (let i = 0; i < 6; i++) {
      const a = traffic.sim.agents.get(placed[i] as string);
      if (!a) continue;
      const id = roll(w, `veh:hit${i}`, a.x - a.fx * 25, a.z - a.fz * 25, 0);
      const veh = sim.ecs.byKey(`veh:hit${i}` as StableKey);
      const body = sim.ecs.store(BodyRef).body[sim.ecs.resolve(veh) as number] as number;
      const half = a.yaw / 2;
      sim.backend.setBodyPose(body, [a.x - a.fx * 25, 0.6, a.z - a.fz * 25], [0, Math.sin(half), 0, Math.cos(half)]);
      sim.backend.setBodyVelocity(body, [a.fx * 13, 0, a.fz * 13], [0, 0, 0]);
      void id;
    }
    for (let t = 0; t < 360; t++) {
      sim.step(1);
      max = Math.max(max, traffic.sim.promotions.count);
    }
    expect(traffic.sim.stats.promotions).toBeGreaterThanOrEqual(1);
    expect(max).toBeLessThanOrEqual(PROMOTED_CAP['mobile-low']);
    sim.dispose();
  }, 120_000);
});

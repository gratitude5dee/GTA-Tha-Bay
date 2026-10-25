/**
 * The below-the-world rule for ambient vehicles (02-world-maps.md 4.1 d, DL-735 c; BD-FIX-SPAWN-09): a vehicle the traffic made (a promoted
 * agent, or the wreck it became) that is under `play.minY` with no player aboard is despawned through the traffic's own despawn of its
 * vehicles; a car above `play.minY` is left alone, and so is one with the player aboard (the engine's vehicle net takes that one).
 * The real ECS, Rapier and vehicle module, as in `traffic.promotion.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { ChunkKey, EntityHandle, SimConfig, StableKey } from '@dv/shared';
import {
  BodyRef, ENGINE_PREFABS, PrefabRegistry, Transform, createPhysicsSim, groundHeightfield, registerVehicleModule, seatDriver,
  type PhysicsSim, type VehicleModule,
} from '@dv/engine/sim';
import { createWorldApi } from '../src/sim/api/world-api.ts';
import { ARCH, WORLD_COMPONENTS } from '../src/sim/traffic/components.ts';
import { PROMOTED_TICKS } from '../src/sim/traffic/promote.ts';
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
  player: EntityHandle;
  minY: number;
}

async function world(): Promise<World> {
  const cross = crossRoads({ armM: 100, speedMps: 11.25 });
  const store = storeOf([cross.chunk]);
  await loadAll(store, [CELL]);
  const holder: { mod: VehicleModule | null; prefabs: PrefabRegistry | null; player: EntityHandle } = { mod: null, prefabs: null, player: 0 as EntityHandle };
  const sim = await createPhysicsSim(CFG, {
    id: 'traffic-fallen',
    setup: (s) => {
      s.backend.addChunkStatics('ground', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
      const prefabs = new PrefabRegistry(s.ecs, s.backend);
      prefabs.load(ENGINE_PREFABS);
      holder.mod = registerVehicleModule(s.core, s.backend, prefabs);
      holder.prefabs = prefabs;
      // the player stands far from the crossing, out of the traffic's way
      holder.player = prefabs.spawn('player.default', { pos: [0, 0, 400], yaw: 0 }, 'player:0');
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
  return { sim, mod: holder.mod as VehicleModule, traffic, cross, prefabs: holder.prefabs as PrefabRegistry, player: holder.player, minY: api.play.minY };
}

/** Promotes an agent waiting at the east arm's red light by rolling a car into it; returns the promoted vehicle's key. */
function promote(w: World): StableKey {
  const { sim, traffic, cross } = w;
  const a = traffic.sim.place({ key: 'amb:9/256/256:60', cell: CELL, slot: 60, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[1] as number, s: 80, lane: 0, speed: 0 });
  if (!a) throw new Error('not placed');
  sim.step(6);
  const behind = { x: a.x - a.fx * 40, z: a.z - a.fz * 40 };
  const h = w.prefabs.spawn('vehicle.sedan', { pos: [behind.x, 0, behind.z], yaw: 0 }, 'veh:hitter' as StableKey);
  sim.step(1);
  const vid = sim.ecs.resolve(h) as number;
  const rt = w.mod.store.ensure(vid, 'hp.sedan');
  rt.external = true;
  rt.input.throttle = 0;
  rt.input.brake = 0;
  rt.input.handbrake = false;
  const body = sim.ecs.store(BodyRef).body[vid] as number;
  const half = a.yaw / 2;
  sim.backend.setBodyPose(body, [behind.x, 0.6, behind.z], [0, Math.sin(half), 0, Math.cos(half)]);
  sim.backend.setBodyVelocity(body, [a.fx * 12, 0, a.fz * 12], [0, 0, 0]);
  for (let t = 0; t < 400 && traffic.sim.stats.promotions === 0; t++) sim.step(1);
  expect(traffic.sim.stats.promotions).toBe(1);
  sim.step(4);
  const key = `veh:amb.${CELL}.60.1` as StableKey;
  expect(sim.ecs.byKey(key)).not.toBe(0);
  return key;
}

/** Puts the vehicle with `key` at height `y`, at rest. */
function drop(w: World, key: StableKey, y: number): void {
  const id = w.sim.ecs.resolve(w.sim.ecs.byKey(key)) as number;
  const tr = w.sim.ecs.store(Transform);
  const body = w.sim.ecs.store(BodyRef).body[id] as number;
  w.sim.backend.setBodyPose(body, [tr.px[id] as number, y, tr.pz[id] as number], [tr.qx[id] as number, tr.qy[id] as number, tr.qz[id] as number, tr.qw[id] as number]);
  w.sim.backend.setBodyVelocity(body, [0, 0, 0], [0, 0, 0]);
  tr.py[id] = y;
}

describe('ambient vehicles under the world (DL-735 c)', () => {
  it('a promoted car under the ground but above play.minY is left alone; under play.minY it is despawned through the traffic', async () => {
    const w = await world();
    expect(w.minY).toBe(-80);
    const key = promote(w);
    // 30 m under the plane: out of the world by the 3 m rule, but an NPC car above play.minY is left alone
    drop(w, key, -30);
    w.sim.step(20);
    expect(w.sim.ecs.byKey(key)).not.toBe(0);
    // under the floor of the play box with nobody aboard: gone within one brain step (every second tick)
    drop(w, key, w.minY - 5);
    w.sim.step(3);
    expect(w.sim.ecs.byKey(key)).toBe(0);
    // the traffic forgot it: the promotion running out later finds nothing to turn into a wreck, and nothing breaks
    w.sim.step(PROMOTED_TICKS + 10);
    expect(w.sim.ecs.byKey(key)).toBe(0);
    w.sim.dispose();
  }, 60_000);

  it('a wreck under play.minY is despawned at once, not after 10 s out of sight', async () => {
    const w = await world();
    const key = promote(w);
    // 8 s after the hit it is a wreck that holds its handbrake, still near the focus (seen), so the out-of-sight sweep keeps it
    w.sim.step(PROMOTED_TICKS + 6);
    expect(w.traffic.sim.promotions.count).toBe(0);
    expect(w.sim.ecs.byKey(key)).not.toBe(0);
    drop(w, key, w.minY - 20);
    w.sim.step(3);
    expect(w.sim.ecs.byKey(key)).toBe(0);
    w.sim.dispose();
  }, 60_000);

  it('a promoted car with the player aboard is left to the engine net, wherever it falls', async () => {
    const w = await world();
    const key = promote(w);
    const h = w.sim.ecs.byKey(key);
    expect(seatDriver(w.sim.ecs, w.sim.backend, w.mod.store, w.sim.services, w.player, h, w.sim.tick)).toBe(true);
    drop(w, key, w.minY - 5);
    w.sim.step(20);
    expect(w.sim.ecs.byKey(key)).toBe(h);
    w.sim.dispose();
  }, 60_000);

  it('is deterministic: the same fall twice gives the same state hash', async () => {
    const run = async (): Promise<string> => {
      const w = await world();
      const key = promote(w);
      drop(w, key, w.minY - 5);
      w.sim.step(10);
      const hash = w.sim.hash();
      w.sim.dispose();
      return hash;
    };
    expect(await run()).toBe(await run());
  }, 120_000);
});

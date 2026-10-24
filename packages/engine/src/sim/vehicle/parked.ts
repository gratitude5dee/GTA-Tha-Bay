/**
 * Parked vehicles for the QA scenes (M03a1): a few cars standing next to the player's spawn, so that every QA build with
 * vehicles shows them at once. Each car is spawned on the first tick there is ground under its place (the chunk colliders arrive
 * one chunk per tick), at that ground height, with the handbrake on. The list comes from a `plan` function; for a streamed world it
 * waits for the road graph and lays the cars along the lanes nearest to the spawn.
 *
 * Sim code under the C02 lint.
 */
import { SimStage, type StableKey, type SystemDef, type WorldApi } from '@dv/shared';
import type { PrefabService } from '../prefabs/registry.ts';
import type { Vec3, VehiclePhysics } from '../physics/backend.ts';
import { GROUP_BIT } from '../physics/groups.ts';
import type { EngineServices } from '../services.ts';

export interface ParkedCar {
  prefab: string;
  /** ENU x and z, metres. */
  x: number;
  z: number;
  /** Heading about +Y, radians (0 faces -Z). */
  yaw: number;
  key: string;
}

export const PARKED_ID = 'engine.vehicle.parked-spawns';

export interface ParkedOptions {
  backend: Pick<VehiclePhysics, 'castRay'>;
  prefabs: Pick<PrefabService, 'spawn'>;
  services: Pick<EngineServices, 'world'>;
  /** A y near the ground, from which the downward ray starts 60 m higher. */
  groundHintY: number;
  /** The cars to place, or null while the data they depend on is not there yet. */
  plan(world: Pick<EngineServices['world'], 'api' | 'bounds'>): readonly ParkedCar[] | null;
}

export function parkedCarsSystem(opts: ParkedOptions): SystemDef {
  let pending: ParkedCar[] | null = null;
  const from: Vec3 = [0, 0, 0];
  const down: Vec3 = [0, -1, 0];
  return {
    id: PARKED_ID, owner: 'S01', stage: SimStage.Streaming, order: 60,
    run: () => {
      if (pending === null) {
        const list = opts.plan(opts.services.world);
        if (list === null) return;
        pending = [...list];
      }
      if (pending.length === 0) return;
      const rest: ParkedCar[] = [];
      for (const car of pending) {
        from[0] = car.x;
        from[1] = opts.groundHintY + 60;
        from[2] = car.z;
        const hit = opts.backend.castRay(from, down, 160, GROUP_BIT.static);
        if (!hit) {
          rest.push(car);
          continue;
        }
        opts.prefabs.spawn(car.prefab, { pos: [car.x, from[1] - hit.toi, car.z], yaw: car.yaw }, car.key as StableKey);
      }
      pending = rest;
    },
  };
}

/** The cars standing around the gray-box block's spawn: along the west kerb of the N-S street (x = 100), facing north or south. */
export function grayboxParkedCars(): ParkedCar[] {
  return [
    { prefab: 'vehicle.sedan', x: 93.6, z: 50, yaw: 0, key: 'veh:gb.sedan' },
    { prefab: 'vehicle.compact', x: 93.6, z: 66, yaw: 0, key: 'veh:gb.compact' },
    { prefab: 'police.cruiser', x: 93.6, z: 36, yaw: 0, key: 'veh:gb.cruiser' },
    { prefab: 'vehicle.van', x: 106.4, z: 56, yaw: Math.PI, key: 'veh:gb.van' },
    { prefab: 'vehicle.pickup', x: 106.4, z: 40, yaw: Math.PI, key: 'veh:gb.pickup' },
    { prefab: 'robotaxi.default', x: 106.4, z: 72, yaw: Math.PI, key: 'veh:gb.robotaxi' },
  ];
}

/** Lays cars along the lanes of the road nearest to `spawn` in a streamed world, once the road graph answers. */
export function streamedParkedCars(spawn: readonly [number, number, number]): ParkedOptions['plan'] {
  const prefabs = ['vehicle.sedan', 'vehicle.compact', 'police.cruiser', 'vehicle.van', 'vehicle.pickup', 'robotaxi.default'];
  const out = new Float64Array(4);
  return (world) => {
    const api: WorldApi | null = world.api;
    if (!api) return null;
    const hit = api.graph.nearestEdge(spawn[0], spawn[2], undefined, 120);
    if (!hit) return null;
    const cars: ParkedCar[] = [];
    for (let i = 0; i < prefabs.length; i++) {
      api.graph.laneCentre({ edge: hit.edge, s: hit.s + 8 + i * 9, lane: i % 2 }, out);
      if (Number.isNaN(out[0] as number)) continue;
      cars.push({ prefab: prefabs[i] as string, x: out[0] as number, z: out[2] as number, yaw: out[3] as number, key: `veh:sw.${i}` });
    }
    return cars;
  };
}

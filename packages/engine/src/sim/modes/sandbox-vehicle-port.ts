/**
 * The engine side of the sandbox's car spawner (M04e3). The sandbox mode (`builtin/sandbox-vehicles.ts`) never touches the ECS; it is
 * handed a `SandboxVehiclePort` that places a car on a free lane point in front of the camera, seats the player in it and takes it
 * away again. The cars are session-only (`veh:sbx<n>`): nothing here writes a save slice.
 *
 * A car the player drives is not despawned under them: `retire` asks the ownership machine to let the driver out (the way the racing
 * port's `release` does) and queues the car; `update`, run by the `engine.modes.sandbox-retire` system, despawns each queued car on
 * the first tick it has no driver, or after `RETIRE_WAIT_TICKS`. With an empty queue `update` does nothing.
 * Sim code under the C02 lint: no wall time, no randomness.
 */
import type { EntityHandle, PhysicsQueries, RoadGraphQuery } from '@dv/shared';
import { BodyRef, Control, LocalPlayer, RenderKey, Transform, Vehicle } from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import { CONTROL_OWNER, CONTROL_PHASE, packPending, phaseOf, requestedOf } from '../control/states.ts';
import { GROUPS } from '../physics/groups.ts';
import { RACE_CAR_PREFABS, type PrefabRegistry } from '../prefabs/registry.ts';
import type { EngineServices } from '../services.ts';
import type { VehiclePhysics } from '../physics/backend.ts';
import { seatDriver } from '../vehicle/enter-exit.ts';
import type { VehicleStore } from '../vehicle/components.ts';
import { findNearSpot, type NearSpot } from './builtin/sandbox-spot.ts';

/** A queued car is despawned after this many ticks even if the player is still in it (10 s). */
export const RETIRE_WAIT_TICKS = 600;
/** A new car is not placed within this distance of another vehicle or of the player (metres). */
export const SPOT_CLEARANCE_M = 4;

export interface SandboxVehiclePort {
  /** Loads the prefabs the car needs: the race cars are loaded at the first request of one (the string table is hashed). */
  prepare(prefab: string): void;
  /** A free lane point 6 to 12 m ahead of the camera, or null. */
  spot(): NearSpot | null;
  spawn(prefab: string, at: NearSpot, key: string): EntityHandle;
  /** Puts the local player at the wheel; false when the car or the player does not exist yet. */
  seat(h: EntityHandle): boolean;
  /** True when someone drives the car or the player is getting in. */
  inUse(h: EntityHandle): boolean;
  alive(h: EntityHandle): boolean;
  /** True while the local player is in any vehicle. */
  playerDriving(): boolean;
  /** Removes the car now (empty) or as soon as its driver is out. */
  retire(h: EntityHandle): void;
}

export interface SandboxVehiclePortImpl extends SandboxVehiclePort {
  /** One tick of the retire queue (the `engine.modes.sandbox-retire` system). */
  update(tick: number): void;
  /** Cars waiting for their driver to leave. */
  queued(): number;
}

export interface SandboxVehicleDeps {
  ecs: EcsWorld;
  backend: VehiclePhysics;
  services: EngineServices;
  store: VehicleStore;
  prefabs: PrefabRegistry;
  physics: PhysicsQueries;
  tick(): number;
  /** The road graph, or null on the world-less stand-in. */
  graph(): Pick<RoadGraphQuery, 'nearestEdge' | 'laneCentre'> | null;
  /** The local player's feet and the heading of the camera (radians, 0 looks to -Z), or null before the player exists. */
  player(): { x: number; y: number; z: number; camYaw: number } | null;
}

const NO_HANDLE = 0 as EntityHandle;

export function createSandboxVehiclePort(d: SandboxVehicleDeps): SandboxVehiclePortImpl {
  const { ecs, backend, services, store, prefabs } = d;
  const queue: { h: EntityHandle; since: number }[] = [];

  const playerId = (): number | null => {
    const ids = ecs.query([LocalPlayer, Control, Transform]);
    return ids.length > 0 ? (ids[0] as number) : null;
  };
  const alive = (h: EntityHandle): boolean => h !== NO_HANDLE && ecs.resolve(h) !== null;

  const blocked = (x: number, z: number): boolean => {
    const lim = SPOT_CLEARANCE_M * SPOT_CLEARANCE_M;
    const tr = ecs.store(Transform);
    const ids = ecs.query([Vehicle, Transform]);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const dx = (tr.px[id] as number) - x;
      const dz = (tr.pz[id] as number) - z;
      if (dx * dx + dz * dz < lim) return true;
    }
    const pid = playerId();
    if (pid !== null) {
      const dx = (tr.px[pid] as number) - x;
      const dz = (tr.pz[pid] as number) - z;
      if (dx * dx + dz * dz < lim) return true;
    }
    return false;
  };

  const despawn = (h: EntityHandle): void => {
    const vid = ecs.resolve(h);
    if (vid === null) return;
    prefabs.despawn(h);
    // the runtime of a vehicle that is gone must not meet the next entity that takes its dense id
    store.drop(vid);
  };

  /** True when the local player is in car `vid` or is on the way in. */
  const playerIn = (vid: number): boolean => {
    const pid = playerId();
    if (pid === null) return false;
    const co = ecs.store(Control);
    if (co.target[pid] !== vid) return false;
    return co.owner[pid] === CONTROL_OWNER.Vehicle || requestedOf(co.pending[pid] as number) === CONTROL_OWNER.Vehicle;
  };

  /** Asks the ownership machine to let the driver of `vid` out; repeated each tick until the car has no driver. */
  const askExit = (vid: number): void => {
    const pid = playerId();
    if (pid === null) return;
    const co = ecs.store(Control);
    if (co.target[pid] !== vid || co.owner[pid] !== CONTROL_OWNER.Vehicle) return;
    const pending = co.pending[pid] as number;
    if (phaseOf(pending) === CONTROL_PHASE.Active && requestedOf(pending) !== CONTROL_OWNER.OnFoot) {
      co.pending[pid] = packPending(CONTROL_PHASE.Active, CONTROL_OWNER.OnFoot);
    }
  };

  return {
    prepare(prefab) {
      if (RACE_CAR_PREFABS.some((p) => p.id === prefab) && !prefabs.has(prefab)) prefabs.load(RACE_CAR_PREFABS);
    },

    spot() {
      const graph = d.graph();
      const p = d.player();
      if (!graph || !p) return null;
      return findNearSpot(graph, d.physics, p, blocked);
    },

    spawn: (prefab, at, key) => prefabs.spawn(prefab, { pos: [at.x, at.y, at.z], yaw: at.yaw }, key as never),

    seat(h) {
      const player = ecs.byKey('player:0');
      if (!alive(h) || ecs.resolve(player) === null) return false;
      return seatDriver(ecs, backend, store, services, player, h, d.tick());
    },

    inUse(h) {
      const vid = ecs.resolve(h);
      if (vid === null) return false;
      const rt = store.rt.get(vid);
      if (rt !== undefined && rt.driver !== 0) return true;
      return playerIn(vid);
    },

    alive,

    playerDriving() {
      const pid = playerId();
      return pid !== null && (ecs.store(Control).owner[pid] as number) === CONTROL_OWNER.Vehicle;
    },

    retire(h) {
      const vid = ecs.resolve(h);
      if (vid === null) return;
      const rt = store.rt.get(vid);
      if ((rt !== undefined && rt.driver !== 0) || playerIn(vid)) {
        askExit(vid);
        if (!queue.some((q) => q.h === h)) queue.push({ h, since: d.tick() });
        return;
      }
      despawn(h);
    },

    update(tick) {
      if (queue.length === 0) return;
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i] as { h: EntityHandle; since: number };
        const vid = ecs.resolve(q.h);
        if (vid === null) {
          queue.splice(i, 1);
          continue;
        }
        const rt = store.rt.get(vid);
        const driven = (rt !== undefined && rt.driver !== 0) || playerIn(vid);
        if (driven && tick - q.since < RETIRE_WAIT_TICKS) {
          askExit(vid);
          continue;
        }
        if (driven) releasePlayer(vid);
        despawn(q.h);
        queue.splice(i, 1);
      }
    },

    queued: () => queue.length,
  };

  /** The exit did not finish in time: hand the player back to the ground before the car goes. */
  function releasePlayer(vid: number): void {
    const pid = playerId();
    if (pid === null) return;
    const co = ecs.store(Control);
    if (co.target[pid] !== vid) return;
    co.target[pid] = 0;
    co.owner[pid] = CONTROL_OWNER.OnFoot;
    co.pending[pid] = packPending(CONTROL_PHASE.Ready, CONTROL_OWNER.None);
    // the capsule was a sensor and its mesh hidden while seated; the on-foot owner needs both back
    backend.setBodyGroups(ecs.store(BodyRef).body[pid] as number, GROUPS.character);
    if (ecs.hasId(pid, RenderKey)) ecs.store(RenderKey).visible[pid] = 1;
    services.camera.reason = 'player';
    services.camera.target = 0;
  }
}

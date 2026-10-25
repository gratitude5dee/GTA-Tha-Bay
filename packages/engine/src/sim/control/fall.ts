import { datan2, SimStage, type EntityId, type SystemDef, type WorldApi } from '@dv/shared';
import boundsJson from '../../../../../config/world.bounds.json';
import { CharacterBody, Control, LocalPlayer, PlayerControlled, Transform, Vehicle } from '../ecs/components.ts';
import type { EngineServices } from '../services.ts';
import type { VehicleStore } from '../vehicle/components.ts';
import type { WorldBoundsPort } from '../world/index.ts';
import { requestTeleport } from './ownership.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_STATE, phaseOf } from './states.ts';

export const FALL_RECOVERY_ID = 'engine.control.fall-recovery';
/** A player has to be in the air this long before it counts as out of the world: 2 s. */
export const FALL_RECOVER_TICKS = 120;
/** Out of the world: this far under the lowest surface at its (x, z) (terrain, slab or hood top), metres. */
export const FALL_BELOW_M = 3;
/** Out of the world wherever the ground is: under the floor of the play box (`config/world.bounds.json` `play.minY`). */
export const FALL_FLOOR_Y = (boundsJson as { play: { minY: number } }).play.minY;
/** How far from the fall the nearest walkable point (the pedestrian graph) is looked for, metres. */
export const FALL_SEARCH_M = 60;
/**
 * With no resident ground at the fall, the teleport aims here and the ownership machine waits for the colliders under it: its probe
 * runs `groundProbeM` (200 m) above and below, so it finds any ground of the city from 350 m down to -50 m.
 */
export const FALL_PROBE_Y = 150;
/** A `groundY` hint far below the city: the surface it returns is the lowest one at that point. */
const LOWEST_HINT = -1e6;

export interface FallRecoveryOptions {
  services: Pick<EngineServices, 'world' | 'control' | 'events'>;
}

/**
 * The out-of-the-world safety net (BD-FIX-SPAWN-02; the specs give the water and the play-bounds walls, 02-world-maps.md 4.1, but
 * nothing for a player that ends up under the ground). An on-foot player that has been in the air for `FALL_RECOVER_TICKS` while it
 * is under the floor of the play box, or more than `FALL_BELOW_M` under the lowest surface of the resident ground at its (x, z), is
 * put back on the nearest valid ground: the nearest walkable point within `FALL_SEARCH_M`, else the top of the ground at its (x, z),
 * else, where nothing is resident yet, the ground the ownership machine finds under it once the colliders arrive. The move is the
 * ordinary teleport of the ownership machine (Control 700, 701), with the swim owner's fade (`world.teleport` out and in), and the
 * SimEvent `control.recover` names why. Without a baked world (`services.world.api` null) the system does nothing, so the gray-box
 * scenes and their hashes are unchanged.
 */
export function fallRecoverySystem(opts: FallRecoveryOptions): SystemDef {
  let fadingIn = false;
  return {
    id: FALL_RECOVERY_ID, owner: 'S01', stage: SimStage.Control, order: -9,
    run: ({ ecs, tick }) => {
      const services = opts.services;
      const api = services.world.api;
      if (!api) return;
      const ids = ecs.query([Control, Transform, PlayerControlled, CharacterBody]);
      if (ids.length === 0) return;
      const co = ecs.store(Control);
      const tr = ecs.store(Transform);
      const cb = ecs.store(CharacterBody);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        if (co.owner[id] !== CONTROL_OWNER.OnFoot || phaseOf(co.pending[id] as number) !== CONTROL_PHASE.Ready) continue;
        const handle = ecs.handle(id as EntityId);
        const state = co.state[id] as number;
        if (fadingIn && !services.control.teleportActive && state === CONTROL_STATE.idle) {
          fadingIn = false;
          services.events.push({ t: 'world.teleport', tick, a: handle, s: 'in' });
        }
        if (state === CONTROL_STATE.teleportPending || state === CONTROL_STATE.teleportWaiting) continue;
        if ((cb.airTicks[id] as number) < FALL_RECOVER_TICKS) continue;
        const x = tr.px[id] as number;
        const y = tr.py[id] as number;
        const z = tr.pz[id] as number;
        const lowest = api.query.groundY(x, z, LOWEST_HINT);
        const why = y < FALL_FLOOR_Y ? 'below-bounds' : lowest !== null && y < lowest - FALL_BELOW_M ? 'below-ground' : null;
        if (why === null) continue;
        const walk = api.query.nearestWalkable(x, z, FALL_SEARCH_M);
        const top = walk ? null : api.query.groundY(x, z);
        const to: [number, number, number] = walk ? [walk.x, walk.y, walk.z] : top !== null ? [x, top, z] : [x, FALL_PROBE_Y, z];
        const r = requestTeleport(ecs, services, handle, to, tick);
        if (!r.ok) continue;
        fadingIn = true;
        services.events.push({ t: 'control.recover', tick, a: handle, s: why });
        services.events.push({ t: 'world.teleport', tick, a: handle, s: 'out' });
      }
    },
  };
}

export const VEHICLE_FALL_RECOVERY_ID = 'engine.control.vehicle-fall-recovery';
/** How far from a fallen vehicle the nearest drivable edge is looked for, metres. */
export const VEHICLE_ROAD_SEARCH_M = 250;
/** A refused or lost request for a fallen vehicle is asked again this many ticks later (1 s). */
export const VEHICLE_RECOVER_RETRY_TICKS = 60;
/** Metres the respawn point is put inland of a shore node (the water wall's value in `vehicle-system.ts`). */
const SHORE_INLAND_M = 3;

export interface VehicleFallRecoveryOptions {
  services: Pick<EngineServices, 'world' | 'events'>;
  store: VehicleStore;
}

/** Where a fallen vehicle respawns: the lane centre of the nearest drivable edge, else the water wall's road-adjacent shore node. */
export function vehicleRespawnPose(api: WorldApi, bounds: WorldBoundsPort | null, x: number, z: number, out: Float64Array): { x: number; z: number; yaw: number } | null {
  const hit = api.graph.nearestEdge(x, z, undefined, VEHICLE_ROAD_SEARCH_M);
  if (hit) {
    api.graph.laneCentre({ edge: hit.edge, s: hit.s, lane: 0 }, out);
    const lx = out[0] as number;
    const lz = out[2] as number;
    const yaw = out[3] as number;
    if (Number.isFinite(lx) && Number.isFinite(lz) && Number.isFinite(yaw)) return { x: lx, z: lz, yaw };
  }
  const shore = bounds?.nearestShore(x, z, true) ?? null;
  if (shore) return { x: shore.x - shore.nx * SHORE_INLAND_M, z: shore.z - shore.nz * SHORE_INLAND_M, yaw: datan2(shore.nx, shore.nz) };
  return null;
}

/**
 * The below-the-world net for a driven vehicle (02-world-maps.md 4.1 d, DL-734; BD-FIX-SPAWN-05). The local player's vehicle, with the
 * player at its wheel, that has been in the air (no wheel contact, `VehicleRuntime.airTicks`) for `FALL_RECOVER_TICKS` while it is under
 * the floor of the play box or more than `FALL_BELOW_M` under the lowest resident surface at its (x, z), respawns with its driver at the
 * nearest road-adjacent point: the lane centre of the nearest drivable edge within `VEHICLE_ROAD_SEARCH_M`, else the water wall's
 * road-adjacent shore node. The move is `TeleportApi.request('respawn', ...)` (02-world-maps.md 5): its fade (`world.teleport` out,
 * then in) is the screen fade the water wall uses, and its move keeps the driver in the vehicle on a drivable edge
 * (`requestDriverTeleport`, then `placeVehicle`, the water wall's placement). The SimEvent `control.recover` (`s`: `below-bounds` or
 * `below-ground`) is pushed once per fall. A request that is refused or lost is asked again every `VEHICLE_RECOVER_RETRY_TICKS` while the
 * vehicle is still out of the world. Without a baked world (`services.world.api` null) the system does nothing, so the gray-box scenes
 * and their hashes are unchanged; its own bookkeeping only paces the requests and is not sim state, so nothing new is hashed.
 */
export function vehicleFallRecoverySystem(opts: VehicleFallRecoveryOptions): SystemDef {
  /** Per vehicle (dense id) while it is out of the world: the first tick it may ask (again). */
  const due = new Map<number, number>();
  const lane = new Float64Array(4);
  return {
    id: VEHICLE_FALL_RECOVERY_ID, owner: 'S01', stage: SimStage.Control, order: -8,
    run: ({ ecs, tick }) => {
      const services = opts.services;
      const api = services.world.api;
      if (!api) return;
      const ids = ecs.query([Vehicle, Transform]);
      if (ids.length === 0) {
        due.clear();
        return;
      }
      const tr = ecs.store(Transform);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        const rt = opts.store.rt.get(id);
        const driver = rt ? rt.driver : 0;
        if (!rt || driver === 0 || rt.airTicks < FALL_RECOVER_TICKS || !ecs.has(ecs.handle(driver as EntityId), LocalPlayer)) {
          due.delete(id);
          continue;
        }
        const x = tr.px[id] as number;
        const y = tr.py[id] as number;
        const z = tr.pz[id] as number;
        const lowest = api.query.groundY(x, z, LOWEST_HINT);
        const why = y < FALL_FLOOR_Y ? 'below-bounds' : lowest !== null && y < lowest - FALL_BELOW_M ? 'below-ground' : null;
        if (why === null) {
          due.delete(id);
          continue;
        }
        const at = due.get(id);
        if (at !== undefined && tick < at) continue;
        due.set(id, tick + VEHICLE_RECOVER_RETRY_TICKS);
        if (at === undefined) services.events.push({ t: 'control.recover', tick, a: ecs.handle(driver as EntityId), s: why });
        const to = vehicleRespawnPose(api, services.world.bounds, x, z, lane);
        if (!to) continue;
        let req: Promise<unknown>;
        try {
          req = api.teleport.request('respawn', { x: to.x, z: to.z, yaw: to.yaw });
        } catch {
          continue;
        }
        void req.then(undefined, () => undefined);
      }
    },
  };
}

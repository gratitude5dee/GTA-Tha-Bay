import { SimStage, type EntityHandle, type EntityId, type SystemDef, type WorldApi } from '@dv/shared';
import boundsJson from '../../../../../config/world.bounds.json';
import { CharacterBody, Control, LocalPlayer, PlayerControlled, Transform, Vehicle } from '../ecs/components.ts';
import type { EngineServices } from '../services.ts';
import type { VehicleStore } from '../vehicle/components.ts';
import type { WorldBoundsPort } from '../world/index.ts';
import { requestPlayerMove, requestTeleport } from './ownership.ts';
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
 * With no resident ground at the fall, the rescue aims here and the ownership machine waits for the colliders under it: its probe
 * runs `groundProbeM` (200 m) above and below, so it finds any ground of the city from 350 m down to -50 m.
 */
export const FALL_PROBE_Y = 150;
/** A `groundY` hint far below the city: the surface it returns is the lowest one at that point. */
const LOWEST_HINT = -1e6;

export interface FallRecoveryOptions {
  services: Pick<EngineServices, 'world' | 'control' | 'events'>;
}

/**
 * The below-the-world net for a player on foot (02-world-maps.md 4.1 d, DL-734, DL-735; BD-FIX-SPAWN-02, BD-FIX-SPAWN-09). An on-foot
 * player that has been in the air for `FALL_RECOVER_TICKS` while it is under the floor of the play box, or more than `FALL_BELOW_M` under
 * the lowest surface of the resident ground at its (x, z), is put back on the nearest valid ground: the nearest walkable point within
 * `FALL_SEARCH_M`, else the top of the ground at its (x, z), else, where nothing is resident yet, the ground the ownership machine finds
 * under it once the colliders arrive. The move is the ownership machine's teleport (`requestTeleport`, Control 700, 701), not
 * `TeleportApi.request`: a rescue must never be refused by mode rules, heat or a cooldown, and its last target (y 150 m over ground that
 * is not resident) is one the world's teleport would answer `not-loaded` for (DL-735 a). Its fade is the teleport's own (`world.teleport`
 * out when the move is asked, in once the machine is idle again, which the page shows as its `TeleportFade`; DL-735 b), and the SimEvent
 * `control.recover` names why. Without a baked world (`services.world.api` null) the system does nothing, so the gray-box scenes and
 * their hashes are unchanged.
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
        const why = outOfWorld(api, x, y, z);
        if (why === null) continue;
        const walk = api.query.nearestWalkable(x, z, FALL_SEARCH_M);
        const top = walk ? null : api.query.groundY(x, z);
        const to: [number, number, number] = walk ? [walk.x, walk.y, walk.z] : top !== null ? [x, top, z] : [x, FALL_PROBE_Y, z];
        // the ownership machine's move, not TeleportApi.request: no mode rule, heat or cooldown may refuse a rescue (DL-735 a)
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
/** Requests for a fallen vehicle are this many ticks apart (1 s), counted on its `VehicleRuntime.airTicks` from `FALL_RECOVER_TICKS`. */
export const VEHICLE_RECOVER_RETRY_TICKS = 60;
/**
 * The teleport's own fade for a rescue (DL-735 b): the screen fades out (`world.teleport` `out`) when a request starts and the car is moved
 * this many ticks later (200 ms: the world teleport's `FADE_TICKS`, the page's `TeleportFade` fade-out), then it fades in (`in`) whatever
 * the move answered. The water wall's longer `RESPAWN_FADE_TICKS` (30) stays with the stall respawn.
 */
export const VEHICLE_RESCUE_FADE_TICKS = 12;
/**
 * After this many requests (30 s of retries) the net stops asking for the car and hands the player to the on-foot net (02-world-maps.md
 * 4.1 d: if no lane takes the car, the player is set down on foot and the on-foot rule applies; the car stays behind; DL-735 e): the
 * player gets out at once (`EngineServices.vehicleUnseat`) and the on-foot net, which ends at a target at y 150 m that the 701 probe
 * settles once colliders arrive, puts the player back on the ground (`control.recover` `s: 'gave-up'`, once). The same happens at once
 * when there is no lane to try at all. So a car the net cannot place never keeps the player falling for the rest of the session. A new
 * flight (the car touched ground again) starts a new count.
 */
export const VEHICLE_RECOVER_MAX_TRIES = 30;
/**
 * A lane centre is skipped as a respawn point when a resident surface lies more than this above it (an elevated deck: the car would be
 * put down on the deck, off the lane), metres.
 */
export const VEHICLE_DECK_GAP_M = 2.5;
/** A road-adjacent shore node is moved onto the lane centre of a drivable edge this close to it (the world's `SHORE_ROAD_M`), metres. */
const SHORE_ROAD_M = 15;
/** Metres the lane search beside a shore node starts inland of it (the water wall's value in `vehicle-system.ts`). */
const SHORE_INLAND_M = 3;

export interface VehicleFallRecoveryOptions {
  services: Pick<EngineServices, 'world' | 'events' | 'control' | 'vehicleMove' | 'vehicleFallClaim' | 'vehicleUnseat'>;
  store: VehicleStore;
}

/** Why a body at (x, y, z) is out of the world (02-world-maps.md 4.1 d), or null: under the play box floor, or under the lowest resident surface. */
export function outOfWorld(api: WorldApi, x: number, y: number, z: number): 'below-bounds' | 'below-ground' | null {
  if (y < FALL_FLOOR_Y) return 'below-bounds';
  const lowest = api.query.groundY(x, z, LOWEST_HINT);
  return lowest !== null && y < lowest - FALL_BELOW_M ? 'below-ground' : null;
}

export interface RespawnPose {
  x: number;
  /** Where the vehicle move's ground probe starts from: the top of the resident ground there (as the world teleport places), else the lane's height. */
  y: number;
  z: number;
  yaw: number;
}

/**
 * A lane centre a rescued car can be put on: finite, not in a water cell (a car is never put down in water, whatever deck spans it), with
 * no resident surface more than `VEHICLE_DECK_GAP_M` above it (the vehicle move places on the highest surface its probe meets) and with a
 * height to probe from (the top of the resident ground, else the lane's).
 */
function laneUsable(api: WorldApi, out: Float64Array): RespawnPose | null {
  const lx = out[0] as number;
  const ly = out[1] as number;
  const lz = out[2] as number;
  const yaw = out[3] as number;
  if (!Number.isFinite(lx) || !Number.isFinite(lz) || !Number.isFinite(yaw)) return null;
  if (api.query.isWater(lx, lz)) return null;
  const top = api.query.groundY(lx, lz);
  if (top !== null && Number.isFinite(ly) && top - ly > VEHICLE_DECK_GAP_M) return null;
  const y = top !== null ? top : Number.isFinite(ly) ? ly : null;
  if (y === null) return null;
  return { x: lx, y, z: lz, yaw };
}

/**
 * Where a fallen vehicle may respawn, best first (02-world-maps.md 4.1 d 'the nearest drivable lane'; BD-FIX-SPAWN-07, -08, -09): (1) the
 * lane centre of the nearest drivable edge within `VEHICLE_ROAD_SEARCH_M`, looked for at the height of the top surface over the fall;
 * (2) the lane centre of the drivable edge within `SHORE_ROAD_M` of the water wall's nearest road-adjacent `ShoreNode`. Only lane centres,
 * so the ownership machine's move keeps the player in the car (`requestPlayerMove` with `onRoad`); a point off the roads would set the
 * player down on foot. A lane in a water cell or under a deck is skipped (`laneUsable`). No candidate: the net hands the player to the
 * on-foot net (`VEHICLE_RECOVER_MAX_TRIES`).
 */
export function vehicleRespawnCandidates(api: WorldApi, bounds: WorldBoundsPort | null, x: number, z: number, out: Float64Array): RespawnPose[] {
  const found: RespawnPose[] = [];
  const top = api.query.groundY(x, z);
  const hit = api.graph.nearestEdge(x, z, top ?? undefined, VEHICLE_ROAD_SEARCH_M);
  if (hit) {
    api.graph.laneCentre({ edge: hit.edge, s: hit.s, lane: 0 }, out);
    const p = laneUsable(api, out);
    if (p) found.push(p);
  }
  const shore = bounds?.nearestShore(x, z, true) ?? null;
  if (shore) {
    const ix = shore.x - shore.nx * SHORE_INLAND_M;
    const iz = shore.z - shore.nz * SHORE_INLAND_M;
    const near = api.graph.nearestEdge(ix, iz, undefined, SHORE_ROAD_M);
    if (near) {
      api.graph.laneCentre({ edge: near.edge, s: near.s, lane: 0 }, out);
      const q = laneUsable(api, out);
      if (q && !found.some((f) => f.x === q.x && f.z === q.z)) found.push(q);
    }
  }
  return found;
}

/** The best respawn point of `vehicleRespawnCandidates`, or null when there is none. */
export function vehicleRespawnPose(api: WorldApi, bounds: WorldBoundsPort | null, x: number, z: number, out: Float64Array): RespawnPose | null {
  return vehicleRespawnCandidates(api, bounds, x, z, out)[0] ?? null;
}

/**
 * The below-the-world net for a vehicle carrying the player, as driver or passenger (02-world-maps.md 4.1 d, DL-734, DL-735;
 * BD-FIX-SPAWN-05, -07, -08, -09). The vehicle the local player rides in that has been in the air (no wheel contact,
 * `VehicleRuntime.airTicks`) for `FALL_RECOVER_TICKS` while it is out of the world (`outOfWorld`) respawns with the player on the nearest
 * drivable lane (`vehicleRespawnCandidates`). The move is the ownership machine's (`requestPlayerMove` with `onRoad`, which calls
 * `EngineServices.vehicleMove`: the same placement as the world teleport's driver move, `placeVehicle`), not `TeleportApi.request`,
 * because mode rules, heat or a cooldown must never block a rescue (DL-735 a). Its fade is the teleport's own: `world.teleport` `out` when
 * the request starts, the move `VEHICLE_RESCUE_FADE_TICKS` later, then `in` (DL-735 b). The SimEvent `control.recover` (`s`:
 * `below-bounds` or `below-ground`) is pushed once per fall.
 *
 * Requests go out on the flight's own clock, at `airTicks` = 120, 180, 240, ... (`VEHICLE_RECOVER_RETRY_TICKS` apart), each moving the car
 * `VEHICLE_RESCUE_FADE_TICKS` later, so the pacing is hashed, saved sim state and a save loaded mid-fall asks on the same ticks. Request k
 * takes candidate k mod n, so a lane whose colliders never arrive does not hold back the other. After `VEHICLE_RECOVER_MAX_TRIES`
 * requests, or at once when there is no candidate, the player gets out (`EngineServices.vehicleUnseat`; the car stays behind) and its
 * capsule counts as `FALL_RECOVER_TICKS` in the air, so the on-foot net (`fallRecoverySystem`, order -9, after this system's -11) puts the
 * player on the ground in the same tick, before the on-foot controller could take the falling car under the capsule for ground
 * (`control.recover` `s: 'gave-up'`, then the on-foot net's own; DL-735 e). A vehicle a mode places itself
 * (`EngineServices.vehicleFallClaim`: the race director resets its car to the last gate) is left to that mode. An ambient vehicle with no
 * player aboard is the traffic's (it despawns one under `play.minY`); other cars are left alone. A car stalled in the water
 * (`VehicleRuntime.wet.stalled`) is the water rule's stall respawn, with its longer fade (DL-735 b): the net does not move it, and a
 * rescue fade already out is left for the water rule's `in` (BD-FIX-SPAWN-10). Without a baked world
 * (`services.world.api` null) the system does nothing, so the gray-box scenes and their hashes are unchanged.
 *
 * Its only bookkeeping, which flights have had their `control.recover` and which rescue fades are out, is not sim state and nothing new is
 * hashed: an entry is dropped on the first tick its vehicle is not falling (landed, the player left it, despawned), with a fade-in when
 * its fade was out, and when a tick does not follow the last one it ran (a save was loaded, or the first tick of a session) a vehicle
 * already past its first request is counted as told, so a load mid-fall does not push `control.recover` a second time.
 */
export function vehicleFallRecoverySystem(opts: VehicleFallRecoveryOptions): SystemDef {
  /** Vehicles (dense id) whose current flight has had its `control.recover`, with the tick they were last seen falling. */
  const told = new Map<number, number>();
  /** Vehicles (dense id) whose rescue fade is out, with the player it was shown for and the tick they were last seen falling. */
  const fading = new Map<number, { player: EntityHandle; at: number }>();
  const lane = new Float64Array(4);
  const to3: [number, number, number] = [0, 0, 0];
  let lastTick = -2;
  return {
    id: VEHICLE_FALL_RECOVERY_ID, owner: 'S01', stage: SimStage.Control, order: -11,
    run: ({ ecs, tick }) => {
      const resumed = tick !== lastTick + 1;
      lastTick = tick;
      if (resumed) told.clear();
      const services = opts.services;
      const api = services.world.api;
      if (!api) return;
      const ids = ecs.query([LocalPlayer, Control]);
      const co = ecs.store(Control);
      const tr = ecs.store(Transform);
      for (let i = 0; i < ids.length; i++) {
        const pid = ids[i] as number;
        // aboard: at the wheel or as a passenger (DL-735 c)
        if (co.owner[pid] !== CONTROL_OWNER.Vehicle || phaseOf(co.pending[pid] as number) !== CONTROL_PHASE.Active) continue;
        const id = co.target[pid] as number;
        const rt = opts.store.rt.get(id);
        if (!rt || rt.airTicks < FALL_RECOVER_TICKS) continue;
        // a car stalled in the water is the water rule's (4.1 a): its own fade and shore respawn, and its `in` restores the screen, so
        // a rescue fade of this net that is out is handed over to it without an `in` of its own (BD-FIX-SPAWN-10)
        if (rt.wet.stalled) {
          fading.delete(id);
          continue;
        }
        const vh = ecs.handle(id as EntityId);
        if (!ecs.has(vh, Vehicle) || !ecs.has(vh, Transform)) continue;
        const ph = ecs.handle(pid as EntityId);
        const claim = services.vehicleFallClaim;
        if (claim && claim(vh)) continue;
        const x = tr.px[id] as number;
        const z = tr.pz[id] as number;
        const why = outOfWorld(api, x, tr.py[id] as number, z);
        if (why === null) continue;
        const since = rt.airTicks - FALL_RECOVER_TICKS;
        // a load mid-fall (or the first tick of a session) counts a flight past its first request as told already
        if (!told.has(id) && !(resumed && since > 0)) services.events.push({ t: 'control.recover', tick, a: ph, s: why });
        told.set(id, tick);
        const fade = fading.get(id);
        if (fade) fade.at = tick;
        const step = since % VEHICLE_RECOVER_RETRY_TICKS;
        const k = (since - step) / VEHICLE_RECOVER_RETRY_TICKS;
        if (step === 0) {
          const cands = k < VEHICLE_RECOVER_MAX_TRIES ? vehicleRespawnCandidates(api, services.world.bounds, x, z, lane) : [];
          if (cands.length > 0) {
            // request k: the fade goes out now and the car moves VEHICLE_RESCUE_FADE_TICKS later
            services.events.push({ t: 'world.teleport', tick, a: ph, s: 'out' });
            fading.set(id, { player: ph, at: tick });
            continue;
          }
          // no lane, or the last try is spent: the player gets out and the on-foot net (order -9) takes it this tick; the car stays
          if (k > VEHICLE_RECOVER_MAX_TRIES) continue;
          const out = services.vehicleUnseat?.(ph, tick) === true;
          if (out && ecs.has(ph, CharacterBody)) ecs.store(CharacterBody).airTicks[pid] = FALL_RECOVER_TICKS;
          // without a seat service (a sim without vehicles cannot get here) the net says so once, on its last try
          if (out || k === VEHICLE_RECOVER_MAX_TRIES) services.events.push({ t: 'control.recover', tick, a: ph, s: 'gave-up' });
          continue;
        }
        if (step !== VEHICLE_RESCUE_FADE_TICKS || k >= VEHICLE_RECOVER_MAX_TRIES) continue;
        const cands = vehicleRespawnCandidates(api, services.world.bounds, x, z, lane);
        const to = cands.length > 0 ? cands[k % cands.length] : undefined;
        if (to) {
          to3[0] = to.x; to3[1] = to.y; to3[2] = to.z;
          // a lane centre lies on a drivable edge, so the player stays aboard and the car moves; a refusal is asked again next request
          requestPlayerMove(ecs, services, ph, to3, to.yaw, tick, true);
        }
        fading.delete(id);
        services.events.push({ t: 'world.teleport', tick, a: ph, s: 'in' });
      }
      // a vehicle not seen falling this tick (landed, the player left it, despawned) starts a new flight next time; its fade comes back in
      for (const [id, at] of told) if (at !== tick) told.delete(id);
      for (const [id, f] of fading) {
        if (f.at === tick) continue;
        fading.delete(id);
        services.events.push({ t: 'world.teleport', tick, a: f.player, s: 'in' });
      }
    },
  };
}

/**
 * The garage (M05c1, DL-668 part 3): the single owner of `CoreSlice.garage`, an array of S06 `VehicleInstance` objects.
 * Story rewards and M07b1's ladder car write it only through `garageAdd`, `garageRemove` and `garageFavorite`; the UI commands
 * `garage.call` and `garage.favorite` reach `createGarageService`. The favourite is the first entry, so `VehicleInstance` has no
 * field for it. Sim code under the C02 lint: no wall time, no transcendental `Math.*`, no randomness (the search for a lane scans
 * a fixed pattern of angles and radii).
 */
import { datan2, dcos, dsin, dsqrt, type JsonObject, type JsonValue, type PrefabService, type StableKey, type UiBridge, type WorldApi } from '@dv/shared';
import type { VehicleInstance } from '@dv/shared';

/** A reward car is placed at least this far from the player, outside the camera view (design value). */
export const CALL_MIN_DISTANCE_M = 120;
/** The search for a free lane stays within this radius of the player (design value). */
export const CALL_SEARCH_RADIUS_M = 400;
/** The ETA shown in the toast is distance over this speed (design value; the call is free in v1). */
export const CALL_ETA_SPEED_MPS = 10;
/** Half the angle of the view cone, in degrees, inside which a spawn would be seen (design value; wider than the 50 degree lens). */
export const VIEW_HALF_ANGLE_DEG = 70;
/** Slots per safehouse (10-ui-pages.md 2.10): the Yard has 4, the mission flat 2... the car lot checks `garageSlots` before a purchase. */
export const SAFEHOUSE_SLOTS: Readonly<Record<string, number>> = { 'sh.yard': 4, 'sh.mission_flat': 2, 'sh.soma_loft': 6 };

const DEG = Math.PI / 180;

export type GarageList = JsonObject[];

const idOf = (e: JsonObject): string => (typeof e['id'] === 'string' ? e['id'] : '');

/** The StableKey of an instance: `veh:<id>`. */
export const vehicleKeyOf = (id: string): StableKey => `veh:${id}` as StableKey;

/** Adds an instance. Idempotent by `id`: an id already in the garage leaves the list unchanged (and the call returns false). Never refused for lack of room. */
export function garageAdd(list: GarageList, instance: VehicleInstance): boolean {
  if (list.some((e) => idOf(e) === instance.id)) return false;
  list.push(JSON.parse(JSON.stringify(instance)) as JsonObject);
  return true;
}

/** Removes the instance with `key` (`veh:<id>` or the bare id). True when something was removed. */
export function garageRemove(list: GarageList, key: string): boolean {
  const i = indexOfKey(list, key);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** Moves the instance to index 0, the favourite place. True when the key exists. */
export function garageFavorite(list: GarageList, key: string): boolean {
  const i = indexOfKey(list, key);
  if (i < 0) return false;
  if (i > 0) {
    const [e] = list.splice(i, 1);
    list.unshift(e as JsonObject);
  }
  return true;
}

export function indexOfKey(list: readonly JsonObject[], key: string): number {
  const id = key.startsWith('veh:') ? key.slice(4) : key;
  return list.findIndex((e) => idOf(e) === id);
}

/** Slots a safehouse set offers: the sum of the safehouses the player owns (4 for the Yard, 2 for the flat, 6 for the loft). */
export function garageSlots(safehouses: readonly string[]): number {
  let n = 0;
  for (const s of safehouses) n += SAFEHOUSE_SLOTS[s] ?? 0;
  return n;
}

/** The rows the garage frame draws (`sys.garage`): the UI reads `key`, `prefab`, `nickname`, `plate`, `damage` (0..1) and the heat fields. */
export function garageView(list: readonly JsonObject[], heatOf?: (key: string) => number): JsonObject[] {
  return list.map((e) => {
    const id = idOf(e);
    const key = `veh:${id}`;
    const livery = (e['livery'] ?? {}) as JsonObject;
    const dmg = (e['damage'] ?? {}) as JsonObject;
    const body = typeof dmg['body'] === 'number' ? dmg['body'] : 1;
    return {
      key,
      prefab: typeof e['defId'] === 'string' ? e['defId'] : '',
      plate: typeof livery['plate'] === 'string' ? livery['plate'] : '',
      damage: Math.round((1 - body) * 100) / 100,
      vehicleHeat: heatOf ? heatOf(key) : 0,
    } as JsonObject;
  });
}

export interface GaragePorts {
  /** The live `CoreSlice.garage` array. */
  list(): GarageList;
  ui: UiBridge;
  /** Wanted level now (0 when calm). */
  heat(): number;
  /** The world services; null on the world-less stand-in (no road graph). */
  world(): WorldApi | null;
  prefabs(): PrefabService | null;
  /** The player's position and the camera heading (radians, the direction the camera looks along; 0 looks to -Z), or null before the player exists. */
  player(): { x: number; y: number; z: number; camYaw: number } | null;
  /** Called after a change of the list (a favourite moved, a car spawned), so the shell re-reads `sys.garage` and a save is requested. */
  onChange(): void;
  /** Reports a spawned instance (for tests and for `garage.call` bookkeeping). */
  onSpawn?(key: string, at: { x: number; y: number; z: number; yaw: number }): void;
  /** Vehicle heat per key (the pursuit director), for the view. */
  vehicleHeat?(key: string): number;
}

export interface GarageService {
  call(vehicleKey: string): void;
  favorite(vehicleKey: string): void;
  /** Re-publishes `sys.garage`. */
  publish(): void;
}

/** Whether a point at bearing `dx, dz` from the player is inside the camera cone. The camera looks along (-sin yaw, -cos yaw). */
export function inView(dx: number, dz: number, camYaw: number): boolean {
  const fx = -dsin(camYaw);
  const fz = -dcos(camYaw);
  const len = dsqrt(dx * dx + dz * dz);
  if (len < 1e-6) return true;
  const cos = (dx * fx + dz * fz) / len;
  return cos > dcos(VIEW_HALF_ANGLE_DEG * DEG);
}

const RADII = [CALL_MIN_DISTANCE_M + 10, 170, 230, 290, 350, 395] as const;
const ANGLES = 16;

/** A free lane point at least 120 m from the player, outside the view, within 400 m; null when none qualifies. */
export function findCallSpot(world: WorldApi, p: { x: number; y: number; z: number; camYaw: number }): { x: number; y: number; z: number; yaw: number; dist: number } | null {
  const out = new Float64Array(4);
  // start behind the camera and fan out, so the first hit is the one most out of sight
  const back = p.camYaw + Math.PI;
  for (const r of RADII) {
    for (let k = 0; k < ANGLES; k++) {
      const side = k % 2 === 0 ? 1 : -1;
      const a = back + side * Math.floor((k + 1) / 2) * ((2 * Math.PI) / ANGLES);
      const tx = p.x - dsin(a) * r;
      const tz = p.z - dcos(a) * r;
      const hit = world.graph.nearestEdge(tx, tz, undefined, 60);
      if (!hit) continue;
      world.graph.laneCentre({ edge: hit.edge, s: hit.s, lane: 0 }, out);
      const x = out[0] as number;
      const y = out[1] as number;
      const z = out[2] as number;
      const dx = x - p.x;
      const dz = z - p.z;
      const dist = dsqrt(dx * dx + dz * dz);
      if (dist < CALL_MIN_DISTANCE_M || dist > CALL_SEARCH_RADIUS_M) continue;
      if (inView(dx, dz, p.camYaw)) continue;
      return { x, y, z, yaw: out[3] as number, dist };
    }
  }
  return null;
}

export function createGarageService(ports: GaragePorts): GarageService {
  const toast = (id: string, kind: 'info' | 'warning', text: string, params?: Record<string, string | number>): void =>
    ports.ui.toast({ id, kind, text, ...(params ? { params } : {}) });
  const publish = (): void => ports.ui.patch('sys.garage', garageView(ports.list(), ports.vehicleHeat) as unknown as JsonValue as never);
  return {
    publish,
    favorite(vehicleKey) {
      if (!garageFavorite(ports.list(), vehicleKey)) {
        toast('garage.refuse.unknown', 'warning', 'garage.refuse.unknown');
        return;
      }
      publish();
      ports.onChange();
    },
    call(vehicleKey) {
      const list = ports.list();
      const i = indexOfKey(list, vehicleKey);
      if (i < 0) {
        toast('garage.refuse.unknown', 'warning', 'garage.refuse.unknown');
        return;
      }
      if (ports.heat() >= 1) {
        toast('garage.refuse.heat', 'warning', 'garage.refuse.heat');
        return;
      }
      const world = ports.world();
      const player = ports.player();
      const prefabs = ports.prefabs();
      if (!world || !player || !prefabs) {
        toast('garage.refuse.noWorld', 'warning', 'garage.refuse.noWorld');
        return;
      }
      const spot = findCallSpot(world, player);
      if (!spot) {
        toast('garage.refuse.noLane', 'warning', 'garage.refuse.noLane');
        return;
      }
      const e = list[i] as JsonObject;
      const dmg = (e['damage'] ?? {}) as { body?: number; engine?: number; tires?: number[] };
      const init: Record<string, number> = {
        'VehicleDamage.body': dmg.body ?? 1,
        'VehicleDamage.engine': dmg.engine ?? 1,
      };
      for (let t = 0; t < 4; t++) init[`VehicleDamage.tires.${t}`] = dmg.tires?.[t] ?? 1;
      const key = `veh:${idOf(e)}`;
      prefabs.spawn(String(e['defId']), { pos: [spot.x, spot.y, spot.z], yaw: spot.yaw }, key as StableKey, init);
      ports.onSpawn?.(key, spot);
      const eta = Math.max(1, Math.round(spot.dist / CALL_ETA_SPEED_MPS));
      toast('garage.call.ok', 'info', 'garage.call.ok', { eta });
    },
  };
}

/** Heading helper for tests: the yaw that looks from (0,0) toward (dx, dz). */
export const yawToward = (dx: number, dz: number): number => datan2(-dx, -dz);

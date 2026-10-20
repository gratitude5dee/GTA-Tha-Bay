/**
 * Bay Rail stations and their entrances (living part 5; M03b2). The 8 stations are the `bay-rail` transit nodes of the world index
 * (positions from the bake, names from `NameRegistry` keys; nothing is hand-placed). Each entrance is an `Interactable{Transit}`;
 * fast travel runs between stations through `TeleportApi.request('fast-travel', ...)` (see `ride.ts`).
 * Pure; C02 lint applies.
 */
import type { TransitNode } from '@dv/shared';
import { TRANSIT_CONFIG } from './components.ts';

export interface Station {
  id: string;
  nameKey: string;
  x: number;
  z: number;
  /** Position in the line order (`config/world/transit.json` `bayRailOrder`); stations not named there follow, by id. */
  order: number;
}

/** The fast-travel stations of the world index in line order. */
export function bayRailStations(transit: readonly TransitNode[], order: readonly string[] = TRANSIT_CONFIG.bayRailOrder): Station[] {
  const out: Station[] = [];
  for (const t of transit) {
    if (t.kind !== 'bay-rail' || !t.fastTravel) continue;
    const at = order.indexOf(t.id);
    out.push({ id: t.id, nameKey: t.nameKey, x: t.x, z: t.z, order: at < 0 ? order.length : at });
  }
  out.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** The station after `id` in line order, wrapping to the first (the entrance's default destination until the phone app of M04b2 lets the player choose). */
export function nextStation(stations: readonly Station[], id: string): Station | null {
  if (stations.length < 2) return null;
  const i = stations.findIndex((s) => s.id === id);
  return stations[(i + 1) % stations.length] ?? null;
}

/** The station nearest to (x, z) within `within` metres, or null. */
export function stationNear(stations: readonly Station[], x: number, z: number, within: number): Station | null {
  let best: Station | null = null;
  let bd = within * within;
  for (const s of stations) {
    const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    if (d <= bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Stable key of a station entrance entity. */
export const entranceKey = (id: string): string => `pfb:transit.entrance.${id}`;
/** The station id an entrance key names, or null. */
export const stationOfKey = (key: string): string | null => (key.startsWith('pfb:transit.entrance.') ? key.slice('pfb:transit.entrance.'.length) : null);

/**
 * Safehouses (M05c1; 03-story-narrative.md B7). `sh.yard`, the Bayview shipyard garage, is granted by m.a1.01 (`rewards.safehouse`): a
 * save point, the respawn place, four garage slots, a bed and the wardrobe. `sh.mission_flat` (D2) can be bought for $8,000 after
 * m.a1.06 (see `shops.ts`). The slot totals live in the engine's garage module (`SAFEHOUSE_SLOTS`); this table adds where each one
 * stands and what it offers. Standing inside an owned safehouse sets `hud.safehouse` (the Pause menu enables Save), records the
 * respawn place in `StorySlice.position.safehouse`, and lets the player sleep. Sim code under the C02 lint.
 */
import type { StorySlice } from '@dv/shared';

export type SafehouseService = 'save' | 'respawn' | 'sleep' | 'wardrobe' | 'garage';

export interface SafehouseDef {
  id: string;
  titleKey: string;
  /** WGS84, on the ground in front of the door. */
  lat: number;
  lng: number;
  r: number;
  services: readonly SafehouseService[];
}

export const SAFEHOUSES: readonly SafehouseDef[] = [
  { id: 'sh.yard', titleKey: 'safehouse.yard', lat: 37.73648, lng: -122.38865, r: 16, services: ['save', 'respawn', 'sleep', 'wardrobe', 'garage'] },
  { id: 'sh.mission_flat', titleKey: 'safehouse.mission_flat', lat: 37.7542, lng: -122.417, r: 14, services: ['save', 'respawn', 'sleep', 'wardrobe', 'garage'] },
];

/** The $8,000 flat is for sale from the end of m.a1.06 (a price in cents). */
export const MISSION_FLAT_PRICE_CENTS = 800_000;

export const safehouseDef = (id: string): SafehouseDef | undefined => SAFEHOUSES.find((s) => s.id === id);

/** The safehouses the player owns, in table order. */
export const ownedSafehouses = (story: Pick<StorySlice, 'property'>): SafehouseDef[] => SAFEHOUSES.filter((s) => story.property.safehouses.includes(s.id));

/** Which owned safehouse the player at (x, z) stands in, given each one's ENU centre; null when none. */
export function safehouseAt(owned: readonly { def: SafehouseDef; x: number; z: number }[], x: number, z: number): SafehouseDef | null {
  for (const o of owned) {
    const dx = x - o.x;
    const dz = z - o.z;
    if (dx * dx + dz * dz <= o.def.r * o.def.r) return o.def;
  }
  return null;
}

/** Whether a safehouse offers a service (and the player owns it). */
export const offers = (story: Pick<StorySlice, 'property'>, id: string, service: SafehouseService): boolean =>
  story.property.safehouses.includes(id) && (safehouseDef(id)?.services.includes(service) ?? false);

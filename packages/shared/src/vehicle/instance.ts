/**
 * C05 `CoreSlice.garage` element (type only; the schema, the API and persistence are M05c1 and M07b2).
 * 06-racing-data.md 4.1.
 */
import type { DamageState } from './damage.ts';

export type UpgradeSlot = 'engine' | 'tires' | 'brakes' | 'suspension' | 'weight' | 'nitro' | 'armor';
export interface VehicleInstance {
  /** 32 hex; StableKey `veh:<id>`. */
  id: string;
  /** PrefabDef id, for example 'vehicle.ondine-pico'. */
  defId: string;
  upgrades: Partial<Record<UpgradeSlot, 0 | 1 | 2 | 3>>;
  /** `assetRef` is a C07 AssetRef texture/<id> (no livery kind, DL-162); `plate` is at most 7 characters, A-Z and 0-9. */
  livery: { assetRef: string; hue: number; plate: string };
  damage: DamageState;
  odometerKm: number;
  /** Epoch ms. */
  acquired: number;
  source: 'bought' | 'reward' | 'loaner' | 'mod';
}

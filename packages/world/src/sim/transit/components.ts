/**
 * Transit components and the config rows (02-world-living.md sections 5 and 8; M03b2).
 *
 * 260 `TransitVehicle` (hashed): a bus, a Metro train or a cable car; 261 `AmbientBoat` (hashed); 264 `Aircraft` (render-only, not
 * hashed: an airliner is a pure function of the tick). Pure; C02 lint applies.
 */
import { defineComponent } from '@dv/engine/sim';
import type { ComponentDef, QualityTierId } from '@dv/shared';
import transitJson from '../../../../../config/world/transit.json';
import bus from '../../../../../assets/prefabs/vehicle.bus.json';
import cablecar from '../../../../../assets/prefabs/vehicle.cablecar.json';
import ferry from '../../../../../assets/prefabs/boat.ferry.json';
import airliner from '../../../../../assets/prefabs/aircraft.airliner.json';
import entrance from '../../../../../assets/prefabs/prop.transit-entrance.json';

export const TransitVehicle = defineComponent({
  id: 260, name: 'TransitVehicle', owner: 'S02', hashed: true, snapshot: 'none',
  schema: { route: 'u16', s: 'f32', dwell: 'u16' },
});
export const AmbientBoat = defineComponent({
  id: 261, name: 'AmbientBoat', owner: 'S02', hashed: true, snapshot: 'none',
  schema: { route: 'u16', s: 'f32' },
});
export const Aircraft = defineComponent({
  id: 264, name: 'Aircraft', owner: 'S02', hashed: false, snapshot: 'none',
  schema: { corridor: 'u8', t: 'f32' },
});

/** The components the transit layer adds to a session that asks for it (`WorldSimConfig.ambient.transit`). */
export const TRANSIT_COMPONENTS: readonly ComponentDef[] = [TransitVehicle, AmbientBoat, Aircraft];

/** The transit kinds that run on routes. */
export type MoverKind = 'metro' | 'bus' | 'cablecar' | 'ferry';

type Row = Readonly<Record<QualityTierId, number>>;

export interface TransitRows {
  counts: { metro: Row; bus: Row; cablecar: Row; ferry: Row; air: Row };
  speeds: { metroMps: number; cablecarMps: number; ferryMps: number; airMps: number; busFactor: number; busMaxMps: number };
  dwell: { busS: number; metroEndS: number; cablecarEndS: number; ferryEndS: number };
  bayRailOrder: readonly string[];
  entrance: { radiusM: number; liveM: number };
}

export const TRANSIT_CONFIG: TransitRows = transitJson as unknown as TransitRows;

/** The gray-box prefabs of the transit vehicles (procedural placeholders until M10d1, Q-39). */
export interface TransitPrefab {
  id: string;
  asset: string;
  halfWidth: number;
  halfLength: number;
  halfHeight: number;
  lift: number;
}

interface PrefabJson {
  id: string;
  render: { asset: string };
  physics?: { dims: number[]; liftM: number };
}

const prefabOf = (j: unknown): TransitPrefab => {
  const p = j as PrefabJson;
  const [hx, hy, hz] = (p.physics?.dims ?? [1, 1, 1]) as [number, number, number];
  return { id: p.id, asset: p.render.asset, halfWidth: hx, halfLength: hz, halfHeight: hy, lift: p.physics?.liftM ?? hy };
};

export const TRANSIT_PREFABS = {
  bus: prefabOf(bus),
  cablecar: prefabOf(cablecar),
  ferry: prefabOf(ferry),
  airliner: prefabOf(airliner),
  entrance: prefabOf(entrance),
} as const;

/** The prefab a mover kind draws with (a Metro train is two cars of the bus-sized body, see the renderer). */
export const prefabOfKind = (k: MoverKind): TransitPrefab => (k === 'cablecar' ? TRANSIT_PREFABS.cablecar : k === 'ferry' ? TRANSIT_PREFABS.ferry : TRANSIT_PREFABS.bus);

/** Count of a kind on a tier. */
export const countOf = (kind: keyof TransitRows['counts'], tier: QualityTierId, cfg: TransitRows = TRANSIT_CONFIG): number => cfg.counts[kind][tier];

/** Metro trains draw as a 2-car consist: the second car trails the first by this many metres. */
export const METRO_CAR_GAP_M = 11;

/** Stable key of a transit mover: `pfb:transit.<kind>.<n>`. */
export const moverKey = (kind: MoverKind | 'air', n: number): string => `pfb:transit.${kind}.${n}`;

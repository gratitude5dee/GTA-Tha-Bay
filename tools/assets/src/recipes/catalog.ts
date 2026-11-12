/**
 * The 24 assets of M10d1: which recipe builds each, its budget tag and, for a vehicle, its C07 `KindExtras`. `buildModel` runs a recipe
 * at one fidelity and groups its primitives by the material rules of the fidelity. Pure and deterministic.
 */
import { regroup, type MaterialProfile } from '../lod.ts';
import type { Fidelity, ModelDoc } from './model.ts';
import * as P from './prop.ts';
import * as V from './vehicles.ts';

export type ArtKind = 'vehicle' | 'prop';

export interface ArtAssetDef {
  /** `traffic.sedan`; the C07 ref is `<kind>/<id>`. */
  id: string;
  kind: ArtKind;
  /** The budget row tag of `config/asset-budgets.json`. */
  tag: string;
  profile: MaterialProfile;
  /** Vehicles only: the C07 class and the make. */
  vehicle?: { class: 'traffic' | 'police'; make: string; wheelRadiusM: number };
  build(f: Fidelity): ModelDoc;
}

const veh = (id: string, cls: 'traffic' | 'police', make: string, r: number, build: (f: Fidelity) => ModelDoc): ArtAssetDef => ({
  id, kind: 'vehicle', tag: `class:${cls}`, profile: 'vehicle', vehicle: { class: cls, make, wheelRadiusM: r }, build,
});
const prop = (id: string, tag: string, profile: MaterialProfile, build: (f: Fidelity) => ModelDoc, kind: ArtKind = 'prop'): ArtAssetDef => ({ id, kind, tag, profile, build });

export const ART_ASSETS: readonly ArtAssetDef[] = [
  veh('traffic.compact', 'traffic', V.SPECS.compact.fictionalMake, V.SPECS.compact.wheelR, V.buildCompact),
  veh('traffic.sedan', 'traffic', V.SPECS.sedan.fictionalMake, V.SPECS.sedan.wheelR, V.buildSedan),
  veh('traffic.rideshare', 'traffic', V.SPECS.rideshare.fictionalMake, V.SPECS.rideshare.wheelR, V.buildRideshare),
  veh('traffic.van', 'traffic', V.SPECS.van.fictionalMake, V.SPECS.van.wheelR, V.buildVan),
  veh('traffic.truck', 'traffic', V.TRUCK_SPEC.fictionalMake, V.TRUCK_SPEC.wheelR, V.buildTruck),
  veh('traffic.pickup', 'traffic', V.SPECS.pickup.fictionalMake, V.SPECS.pickup.wheelR, V.buildPickup),
  veh('robotaxi.default', 'traffic', V.SPECS.robotaxi.fictionalMake, V.SPECS.robotaxi.wheelR, V.buildRobotaxi),
  veh('police.cruiser', 'police', V.SPECS.cruiser.fictionalMake, V.SPECS.cruiser.wheelR, V.buildCruiser),
  veh('police.suv', 'police', V.SPECS.suv.fictionalMake, V.SPECS.suv.wheelR, V.buildSuv),
  veh('transit.bus', 'traffic', V.BUS_SPEC.fictionalMake, V.BUS_SPEC.wheelR, V.buildBus),
  veh('transit.cablecar', 'traffic', V.CABLECAR_SPEC.fictionalMake, V.CABLECAR_SPEC.wheelR, V.buildCablecar),
  prop('police.heli', 'prop:backdrop', 'backdrop', P.buildHeli),
  prop('transit.ferry', 'prop:backdrop', 'backdrop', P.buildFerry),
  prop('transit.airliner', 'prop:backdrop', 'backdrop', P.buildAirliner),
  prop('cone', 'prop:street', 'street', P.buildCone),
  prop('barrier', 'prop:street', 'street', P.buildBarrier),
  prop('county-barrier', 'prop:street', 'street', P.buildCountyBarrier),
  prop('spikestrip', 'prop:street', 'street', P.buildSpikestrip),
  prop('crate', 'prop:street', 'street', P.buildCrate),
  prop('transit-entrance', 'prop:street', 'street', P.buildTransitEntrance),
  prop('portal-closure', 'prop:street', 'street', P.buildPortalClosure),
  prop('pickup-cash', 'prop:street', 'street', P.buildPickupCash),
  prop('pickup-item', 'prop:street', 'street', P.buildPickupItem),
  prop('marker.beam', 'prop:street', 'street', P.buildMarkerBeam),
];

export const refOf = (a: ArtAssetDef): string => `${a.kind}/${a.id}`;

/** The model of one asset at one fidelity, primitives grouped by the fidelity's material rules. */
export function buildModel(a: ArtAssetDef, f: Fidelity): ModelDoc {
  const doc = a.build(f);
  return regroup({ ...doc, ref: refOf(a) }, f, a.profile);
}

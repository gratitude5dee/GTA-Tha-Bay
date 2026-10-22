/**
 * A garage car made by the story (M05c1): a reward car (m.a1.01's tow truck) or a car bought at the lot. The instance is a
 * `VehicleInstance` exactly (06-racing-data.md 4.1); `CoreSlice.garage` is owned by the engine's garage module, which the story
 * reaches through the optional `ctx.garage` port. The id is derived from a seed string, so a retried mission or a repeated purchase
 * with the same key makes the same car and the garage's idempotent add keeps one copy. Sim code under the C02 lint.
 */
import { newDamage, type VehicleInstance } from '@dv/shared';
import { hash32 } from '../vm/util.ts';

const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

/** 32 lowercase hex characters derived from `seed` (four salted FNV-1a words). */
export function carIdOf(seed: string): string {
  return hex8(hash32(seed, 'a')) + hex8(hash32(seed, 'b')) + hex8(hash32(seed, 'c')) + hex8(hash32(seed, 'd'));
}

export interface NewCarOptions {
  defId: string;
  /** Any string that names this car once: `mis:m.a1.01:vehicle.pickup`, `lot:vehicle.compact:<idem key>`. */
  seed: string;
  source: VehicleInstance['source'];
  /** Epoch ms. The sim has no wall clock (C02), so a caller without one passes 0. */
  acquired?: number;
  hue?: number;
  plate?: string;
}

export function newGarageCar(o: NewCarOptions): VehicleInstance {
  const id = carIdOf(o.seed);
  return {
    id,
    defId: o.defId,
    upgrades: {},
    livery: { assetRef: 'texture/livery-default', hue: o.hue ?? hash32(o.seed, 'hue') % 360, plate: o.plate ?? id.slice(0, 7).toUpperCase() },
    damage: newDamage(),
    odometerKm: 0,
    acquired: o.acquired ?? 0,
    source: o.source,
  };
}

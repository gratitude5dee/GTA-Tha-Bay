import { Fnv64 } from '@dv/shared';
import type { EcsWorld } from '../ecs/world.ts';
import type { SimResource } from '../services.ts';

export interface StateHashResult {
  readonly hex: string;
  /** NaN values met in float fields (each is hashed as the canonical NaN). */
  readonly nanCount: number;
}

/**
 * stateHash(tick), C02 rule 7: FNV-1a 64 (two u32 lanes) over
 *  1. the tick (u32);
 *  2. every hashed component store in ascending ComponentId, for the entities of query([Key]) in ascending StableKey
 *     order: per entity one presence byte, then, when present, each field in schema order. Floats are fed as bit
 *     patterns with -0 mapped to 0 and every NaN to the canonical NaN; integers as u32 words; f64 as two u32 words;
 *  3. the hashed resources (RNG streams and others) in ascending name order, each preceded by its name.
 */
export function computeStateHash(tick: number, ecs: EcsWorld, resources: readonly SimResource[]): StateHashResult {
  const h = new Fnv64();
  h.u32(tick);
  const order = ecs.keyOrder();
  for (const layout of ecs.hashedLayouts()) {
    const def = layout.def;
    h.u32(def.id);
    for (let i = 0; i < order.length; i++) {
      const id = order[i] as number;
      if (!ecs.hasId(id, def)) {
        h.u8(0);
        continue;
      }
      h.u8(1);
      for (const f of layout.fields) {
        for (const a of f.arrays) {
          const v = a[id] as number;
          if (f.kind === 'f64') h.f64(v);
          else if (f.kind === 'f32') h.f32(v);
          else h.u32(v);
        }
      }
    }
  }
  for (const r of resources) {
    h.str(r.name);
    r.hash(h);
  }
  return { hex: h.hex(), nanCount: h.nanCount };
}

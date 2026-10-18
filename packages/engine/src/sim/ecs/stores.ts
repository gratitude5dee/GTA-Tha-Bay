import { MAX_ENTITIES, type ComponentDef, type ComponentId, type ScalarKind } from '@dv/shared';

export type AnyArray = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Int8Array | Uint8Array;

export interface FieldLayout {
  readonly name: string;
  readonly kind: ScalarKind;
  /** 1 for a scalar field, N for a vector field (N parallel arrays). */
  readonly lanes: number;
  readonly vector: boolean;
  /** One typed array per lane, each of length MAX_ENTITIES. */
  readonly arrays: readonly AnyArray[];
}

export interface ComponentLayout {
  readonly def: ComponentDef;
  readonly fields: readonly FieldLayout[];
  /** The object `EcsApi.store()` returns: scalar fields map to an array, vector fields to an array of arrays. */
  readonly store: Readonly<Record<string, AnyArray | readonly AnyArray[]>>;
}

export const SCALAR_BYTES: Readonly<Record<ScalarKind, number>> = {
  f64: 8, f32: 4, i32: 4, u32: 4, i16: 2, u16: 2, i8: 1, u8: 1,
};

function viewOf(kind: ScalarKind, buf: ArrayBufferLike, offset: number): AnyArray {
  switch (kind) {
    case 'f64': return new Float64Array(buf, offset, MAX_ENTITIES);
    case 'f32': return new Float32Array(buf, offset, MAX_ENTITIES);
    case 'i32': return new Int32Array(buf, offset, MAX_ENTITIES);
    case 'u32': return new Uint32Array(buf, offset, MAX_ENTITIES);
    case 'i16': return new Int16Array(buf, offset, MAX_ENTITIES);
    case 'u16': return new Uint16Array(buf, offset, MAX_ENTITIES);
    case 'i8': return new Int8Array(buf, offset, MAX_ENTITIES);
    case 'u8': return new Uint8Array(buf, offset, MAX_ENTITIES);
  }
}

export interface StoreSet {
  readonly buffer: ArrayBufferLike;
  readonly byteLength: number;
  readonly layouts: ReadonlyMap<ComponentId, ComponentLayout>;
}

/**
 * Allocates the structure-of-arrays stores of every component in `defs` (ascending id order). With `shared`, all arrays
 * are views on one SharedArrayBuffer, so the main thread can map them read-only (C01 rule 1); otherwise on one
 * ArrayBuffer. Every array is zero-filled and MAX_ENTITIES long. Offsets stay 8-byte aligned because every array
 * length times its element size is a multiple of 8.
 */
export function createStores(defs: readonly ComponentDef[], shared: boolean): StoreSet {
  let total = 0;
  for (const def of defs) {
    for (const spec of Object.values(def.schema)) {
      const kind = typeof spec === 'string' ? spec : spec[0];
      const lanes = typeof spec === 'string' ? 1 : spec[1];
      total += SCALAR_BYTES[kind] * MAX_ENTITIES * lanes;
    }
  }
  const buffer: ArrayBufferLike = shared ? new SharedArrayBuffer(total) : new ArrayBuffer(total);
  const layouts = new Map<ComponentId, ComponentLayout>();
  let offset = 0;
  for (const def of defs) {
    const fields: FieldLayout[] = [];
    const store: Record<string, AnyArray | AnyArray[]> = {};
    for (const [name, spec] of Object.entries(def.schema)) {
      const vector = typeof spec !== 'string';
      const kind = typeof spec === 'string' ? spec : spec[0];
      const lanes = typeof spec === 'string' ? 1 : spec[1];
      const arrays: AnyArray[] = [];
      for (let l = 0; l < lanes; l++) {
        arrays.push(viewOf(kind, buffer, offset));
        offset += SCALAR_BYTES[kind] * MAX_ENTITIES;
      }
      fields.push({ name, kind, lanes, vector, arrays });
      store[name] = vector ? arrays : (arrays[0] as AnyArray);
    }
    layouts.set(def.id, { def, fields, store });
  }
  return { buffer, byteLength: total, layouts };
}

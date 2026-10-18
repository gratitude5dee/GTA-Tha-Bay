// packages/shared/src/contracts/c01-ecs.ts
// C01 1.0.0. Copied from spec/domains/01-engine-contracts.md without shape changes. Owner: S01.
export const C01_VERSION = '1.0.0' as const;

/** Dense, recycled bitECS index. Valid only inside one sim world and one session.
 *  Never persisted, never sent on the wire, never held across ticks (use EntityHandle). */
export type EntityId = number & { readonly __brand: 'EntityId' };

/** Generation-checked reference: handle = gen * 2^20 + id (fits u32). */
export type EntityHandle = number & { readonly __brand: 'EntityHandle' };
export const ENTITY_ID_BITS = 20;
export const MAX_ENTITIES = 65_536;          // per sim world, identical on every tier
export const ENTITY_GEN_MAX = 4_095;         // 12 bits; wraps to 1 (0 = never allocated)
export const NULL_HANDLE = 0 as EntityHandle; // id 0 is reserved and never allocated

/** Persistent / network identity. Saves, mission IR, net messages and mods use StableKey, never EntityId. */
export type StableKey =
  | `player:${number}`                 // local player 0, net slots 1..n
  | `veh:${string}`                    // VehicleInstanceId from C05 garage
  | `npc:${string}`                    // C10 NPC id
  | `amb:${string}:${number}`          // ambient agent: C08 cellKey + slot index
  | `mis:${string}:${string}`          // mission id + local entity name (C09)
  | `pfb:${string}:${number}`;         // prefab spawn with a per-session serial (non-persistent)

export type ScalarKind = 'f64' | 'f32' | 'i32' | 'u32' | 'i16' | 'u16' | 'i8' | 'u8';
/** A field is one scalar, or a fixed-length vector of scalars (stored as N parallel arrays). */
export type FieldSpec = ScalarKind | readonly [ScalarKind, number];
export interface ComponentSchema { readonly [field: string]: FieldSpec }

/** Component ids are stable forever; a removed component's id is never reused. */
export type ComponentId = number;
export const COMPONENT_ID_RANGES = {
  engine: [1, 255], world: [256, 511], story: [512, 767], npc: [768, 1023],
  racing: [1024, 1279], fighter: [1280, 1535], tycoon: [1536, 1791], net: [1792, 1919], mod: [2048, 4095],
} as const; // owners: S01, S02, S03, S04, S06, S07, S08, S09, S12

export interface ComponentDef<S extends ComponentSchema = ComponentSchema> {
  readonly id: ComponentId;
  readonly name: string;              // PascalCase, unique
  readonly owner: 'S01' | 'S02' | 'S03' | 'S04' | 'S06' | 'S07' | 'S08' | 'S09' | 'S12';
  readonly schema: S;                 // {} = tag component
  readonly hashed: boolean;           // included in stateHash (C02)
  readonly snapshot: 'none' | 'render' | 'net' | 'render+net';
}

/** Typed-array views (one array per scalar). Backed by one SharedArrayBuffer per world when
 *  crossOriginIsolated, else by ArrayBuffers. Length = MAX_ENTITIES. */
export type ComponentStore<S extends ComponentSchema> = {
  readonly [K in keyof S]: S[K] extends readonly [infer T, number] ? readonly TypedArrayOf<T>[] : TypedArrayOf<S[K]>;
};
type TypedArrayOf<T> = T extends 'f64' ? Float64Array : T extends 'f32' ? Float32Array : T extends 'i32' ? Int32Array
  : T extends 'u32' ? Uint32Array : T extends 'i16' ? Int16Array : T extends 'u16' ? Uint16Array
  : T extends 'i8' ? Int8Array : Uint8Array;

/** Interned strings for component fields (asset ids, cue ids, prefab ids). Deterministic:
 *  ids assigned in first-intern order, which is itself driven by sim order. 0 = empty. */
export interface StringTable { intern(s: string): number; get(id: number): string; readonly size: number }

export interface CommandBuffer {
  spawn(prefabId: string, init?: Partial<Record<string, number>>, key?: StableKey): EntityHandle; // handle valid next stage
  despawn(h: EntityHandle): void;
  add<S extends ComponentSchema>(h: EntityHandle, c: ComponentDef<S>, init?: Partial<Record<keyof S, number>>): void;
  remove(h: EntityHandle, c: ComponentDef): void;
}

export interface EcsApi {
  readonly strings: StringTable;
  store<S extends ComponentSchema>(c: ComponentDef<S>): ComponentStore<S>;
  query(cs: readonly ComponentDef[], not?: readonly ComponentDef[]): Uint32Array; // EntityIds, dense order
  resolve(h: EntityHandle): EntityId | null;      // null if stale
  handle(id: EntityId): EntityHandle;
  byKey(k: StableKey): EntityHandle;               // NULL_HANDLE if absent
  keyOf(h: EntityHandle): StableKey | null;
  has(h: EntityHandle, c: ComponentDef): boolean;
  readonly commands: CommandBuffer;
}

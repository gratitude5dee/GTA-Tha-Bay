import {
  addComponent, createWorld, getEntityComponents, hasComponent, Not, query as bitQuery, registerComponents, removeComponent,
  type World,
} from 'bitecs';
import {
  MAX_ENTITIES, NULL_HANDLE,
  type ComponentDef, type ComponentSchema, type ComponentStore, type EcsApi, type EntityHandle, type EntityId, type StableKey,
} from '@dv/shared';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import { EntityAllocator, EntityLimitError, idOfHandle } from './allocator.ts';
import { CommandBufferImpl, type CommandHost } from './commands.ts';
import { ENGINE_COMPONENTS, Gen, Key } from './components.ts';
import { ComponentRegistry } from './registry.ts';
import { createStores, type AnyArray, type ComponentLayout } from './stores.ts';
import { StringTableImpl } from './strings.ts';

export { EntityLimitError };

export class DuplicateKeyError extends Error {
  constructor(readonly key: string) {
    super(`stable key ${key} is already in use`);
    this.name = 'DuplicateKeyError';
  }
}

export class UnknownPrefabError extends Error {
  constructor(readonly prefabId: string) {
    super(`unknown prefab ${prefabId}`);
    this.name = 'UnknownPrefabError';
  }
}

export class UnknownInitKeyError extends Error {
  constructor(prefabId: string, key: string) {
    super(`spawn init key ${key} does not name a field of prefab ${prefabId}`);
    this.name = 'UnknownInitKeyError';
  }
}

export class ComponentNotRegisteredError extends Error {
  constructor(name: string) {
    super(`component ${name} is not registered in this world`);
    this.name = 'ComponentNotRegisteredError';
  }
}

/** One component of a prefab with its default field values (`init`: field name -> number; vector fields fill every lane). */
export interface PrefabComponent {
  readonly def: ComponentDef;
  readonly init?: Readonly<Record<string, number>>;
}

/**
 * A spawnable template. The part-2 prefab registry (M01b1) builds on this: a prefab here is only a component list.
 * `Key` is always added by the world.
 */
export interface PrefabDef {
  readonly id: string;
  readonly components: readonly PrefabComponent[];
}

export interface EcsWorldOptions {
  /** Back all stores with one SharedArrayBuffer so the main thread can map them (needs cross-origin isolation). */
  readonly shared?: boolean;
  /** Components added to the engine registry v1. */
  readonly components?: readonly ComponentDef[];
}

const SNAPSHOT_MAGIC = 0x31455644; // 'DVE1'
const BITMAP_WORDS = MAX_ENTITIES / 32;

/**
 * The ECS facade (C01). bitECS 0.4.0 owns entity existence, recycling and the component membership queries; the
 * engine owns the data: structure-of-arrays typed arrays, generations, the string table, stable keys and the
 * command buffer.
 *
 * `query()` returns ids in ascending order. bitECS's own result order depends on the add/remove history, which a
 * restored world cannot reproduce; sorting makes the order a function of the entity set alone.
 */
export class EcsWorld implements EcsApi {
  readonly strings = new StringTableImpl();
  readonly registry: ComponentRegistry;
  readonly commands: CommandBufferImpl;
  /** The shared or plain buffer behind every component array. */
  readonly buffer: ArrayBufferLike;
  readonly shared: boolean;

  private bw: World;
  private readonly layouts: ReadonlyMap<number, ComponentLayout>;
  private readonly alloc: EntityAllocator;
  private readonly keyStore: Uint32Array;
  private readonly prefabs = new Map<string, PrefabDef>();
  private readonly keyToId = new Map<string, number>();
  private serial = 0;
  private structVersion = 0;
  private orderVersion = -1;
  private orderCache: Uint32Array = new Uint32Array(0);
  private readonly bitmap = new Uint32Array(BITMAP_WORDS);

  constructor(opts: EcsWorldOptions = {}) {
    this.registry = new ComponentRegistry([...ENGINE_COMPONENTS, ...(opts.components ?? [])]);
    this.shared = opts.shared === true;
    const stores = createStores(this.registry.list(), this.shared);
    this.buffer = stores.buffer;
    this.layouts = stores.layouts;
    this.keyStore = (this.layouts.get(Key.id) as ComponentLayout).fields[0]?.arrays[0] as Uint32Array;
    const gen = (this.layouts.get(Gen.id) as ComponentLayout).fields[0]?.arrays[0] as Uint16Array;
    this.bw = this.newBitWorld();
    this.alloc = new EntityAllocator(this.bw, gen);
    this.commands = new CommandBufferImpl(this.host());
  }

  private newBitWorld(): World {
    const w = createWorld();
    // Register in id order so bit flags are assigned the same way in every world. Gen is not a membership component.
    registerComponents(w, this.registry.list().filter((d) => d.id !== Gen.id));
    return w;
  }

  // ------------------------------------------------------------------ EcsApi

  store<S extends ComponentSchema>(c: ComponentDef<S>): ComponentStore<S> {
    return this.layoutOf(c).store as unknown as ComponentStore<S>;
  }

  query(cs: readonly ComponentDef[], not: readonly ComponentDef[] = []): Uint32Array {
    if (cs.length === 0) throw new Error('EcsWorld.query: at least one required component');
    const terms: unknown[] = [...cs];
    if (not.length > 0) terms.push(Not(...not));
    const dense = bitQuery(this.bw, terms as never[]);
    return this.sortedIds(dense);
  }

  resolve(h: EntityHandle): EntityId | null {
    return this.alloc.resolve(h);
  }

  handle(id: EntityId): EntityHandle {
    return this.alloc.handle(id);
  }

  byKey(k: StableKey): EntityHandle {
    const id = this.keyToId.get(k);
    if (id === undefined || !this.alloc.isLive(id)) return NULL_HANDLE;
    return this.alloc.handle(id);
  }

  keyOf(h: EntityHandle): StableKey | null {
    const id = this.alloc.resolve(h);
    return id === null ? null : (this.strings.get(this.keyStore[id] as number) as StableKey);
  }

  has(h: EntityHandle, c: ComponentDef): boolean {
    const id = this.alloc.resolve(h);
    return id !== null && hasComponent(this.bw, id, c);
  }

  // ------------------------------------------------------------------ beyond EcsApi

  /** Register a spawnable template. Replaces an earlier prefab with the same id. */
  definePrefab(def: PrefabDef): void {
    for (const pc of def.components) this.layoutOf(pc.def);
    this.prefabs.set(def.id, def);
  }

  /** Apply the queued commands now (SimCore calls this at the end of every stage). */
  flush(): void {
    this.commands.apply();
  }

  /** Reserved plus live entities. */
  get entityCount(): number {
    return this.alloc.count;
  }

  /** Highest entity id ever allocated. */
  get maxId(): number {
    return this.alloc.maxId;
  }

  /** The array layout of a component (used by the hash, snapshot and tests). */
  layoutOf(c: ComponentDef): ComponentLayout {
    const l = this.layouts.get(c.id);
    if (!l || l.def !== c) throw new ComponentNotRegisteredError(c.name);
    return l;
  }

  /** Whether the live entity with this id has the component. */
  hasId(id: number, c: ComponentDef): boolean {
    return hasComponent(this.bw, id, c);
  }

  /** Hashed membership components (everything but Gen) in ascending component id. */
  hashedLayouts(): ComponentLayout[] {
    const out: ComponentLayout[] = [];
    for (const def of this.registry.list()) if (def.hashed && def.id !== Gen.id) out.push(this.layoutOf(def));
    return out;
  }

  /**
   * Ids of all live entities in ascending StableKey order (string compare). Cached; recomputed only after a
   * structural change.
   */
  keyOrder(): Uint32Array {
    if (this.orderVersion === this.structVersion) return this.orderCache;
    const ids = this.query([Key]);
    const keys: string[] = new Array<string>(ids.length);
    for (let i = 0; i < ids.length; i++) keys[i] = this.strings.get(this.keyStore[ids[i] as number] as number);
    const idx: number[] = new Array<number>(ids.length);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    idx.sort((a, b) => {
      const ka = keys[a] as string;
      const kb = keys[b] as string;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    const out = new Uint32Array(ids.length);
    for (let i = 0; i < idx.length; i++) out[i] = ids[idx[i] as number] as number;
    this.orderCache = out;
    this.orderVersion = this.structVersion;
    return out;
  }

  // ------------------------------------------------------------------ snapshot

  /** Serialize ECS state (allocator, generations, strings, every component). The command buffer must be empty. */
  serialize(w: ByteWriter): void {
    if (this.commands.pending > 0) throw new Error('EcsWorld.serialize: command buffer is not empty');
    w.u32(SNAPSHOT_MAGIC);
    w.u32(this.alloc.maxId);
    w.u32(this.serial);
    w.u32(this.alloc.freeStack.length);
    for (const id of this.alloc.freeStack) w.u32(id);
    const live = this.query([Key]);
    w.u32(live.length);
    for (let i = 0; i < live.length; i++) w.u32(live[i] as number);
    const gen = (this.layouts.get(Gen.id) as ComponentLayout).fields[0]?.arrays[0] as Uint16Array;
    for (let id = 1; id <= this.alloc.maxId; id++) w.u16(gen[id] as number);
    const strings = this.strings.toArray();
    w.u32(strings.length);
    for (const s of strings) w.str(s);
    const defs = this.registry.list().filter((d) => d.id !== Gen.id);
    w.u32(defs.length);
    for (const def of defs) {
      const layout = this.layoutOf(def);
      const members = this.query([def]);
      w.u32(def.id);
      w.u32(members.length);
      for (let i = 0; i < members.length; i++) {
        const id = members[i] as number;
        w.u32(id);
        for (const f of layout.fields) for (const a of f.arrays) writeScalar(w, f.kind, a[id] as number);
      }
    }
  }

  /** Replace the whole ECS state with a serialized one. The registry must match the one that wrote it. */
  deserialize(r: ByteReader): void {
    if (r.u32() !== SNAPSHOT_MAGIC) throw new Error('EcsWorld.deserialize: bad magic');
    const maxId = r.u32();
    const serial = r.u32();
    const freeStack: number[] = [];
    for (let n = r.u32(); n > 0; n--) freeStack.push(r.u32());
    const live: number[] = [];
    for (let n = r.u32(); n > 0; n--) live.push(r.u32());
    for (const layout of this.layouts.values()) for (const f of layout.fields) for (const a of f.arrays) a.fill(0);
    const gen = (this.layouts.get(Gen.id) as ComponentLayout).fields[0]?.arrays[0] as Uint16Array;
    for (let id = 1; id <= maxId; id++) gen[id] = r.u16();
    const strings: string[] = [];
    for (let n = r.u32(); n > 0; n--) strings.push(r.str());
    this.strings.load(strings);
    this.bw = this.newBitWorld();
    this.alloc.rebuild(this.bw, maxId, live, freeStack);
    this.serial = serial;
    for (let nDefs = r.u32(); nDefs > 0; nDefs--) {
      const def = this.registry.get(r.u32());
      if (!def) throw new Error('EcsWorld.deserialize: snapshot has a component this world does not register');
      const layout = this.layoutOf(def);
      for (let n = r.u32(); n > 0; n--) {
        const id = r.u32();
        addComponent(this.bw, id, def);
        for (const f of layout.fields) for (const a of f.arrays) a[id] = readScalar(r, f.kind);
      }
    }
    this.keyToId.clear();
    for (const id of live) this.keyToId.set(this.strings.get(this.keyStore[id] as number), id);
    this.structVersion++;
  }

  // ------------------------------------------------------------------ internals

  private zero(id: number, layout: ComponentLayout): void {
    for (const f of layout.fields) for (const a of f.arrays) a[id] = 0;
  }

  private applyFieldInit(layout: ComponentLayout, id: number, field: string, lane: number | null, v: number): boolean {
    const f = layout.fields.find((x) => x.name === field);
    if (!f) return false;
    if (lane === null) {
      for (const a of f.arrays) a[id] = v;
      return true;
    }
    const a = f.arrays[lane];
    if (!a) return false;
    a[id] = v;
    return true;
  }

  private attach(id: number, def: ComponentDef, init: Readonly<Partial<Record<string, number>>> | undefined): void {
    const layout = this.layoutOf(def);
    if (!hasComponent(this.bw, id, def)) {
      addComponent(this.bw, id, def);
      this.zero(id, layout);
    }
    if (init) {
      for (const key of Object.keys(init)) {
        const v = init[key];
        if (v === undefined) continue;
        const dot = key.indexOf('.');
        const field = dot < 0 ? key : key.slice(0, dot);
        const lane = dot < 0 ? null : Number(key.slice(dot + 1));
        if (!this.applyFieldInit(layout, id, field, lane, v)) {
          throw new Error(`component ${def.name} has no field ${key}`);
        }
      }
    }
  }

  private sortedIds(dense: ArrayLike<number>): Uint32Array {
    const n = dense.length;
    const out = new Uint32Array(n);
    if (n === 0) return out;
    if (n <= 96) {
      for (let i = 0; i < n; i++) {
        const v = dense[i] as number;
        let j = i - 1;
        while (j >= 0 && (out[j] as number) > v) {
          out[j + 1] = out[j] as number;
          j--;
        }
        out[j + 1] = v;
      }
      return out;
    }
    const bm = this.bitmap;
    let maxWord = 0;
    for (let i = 0; i < n; i++) {
      const id = dense[i] as number;
      const w = id >>> 5;
      bm[w] = (bm[w] as number) | (1 << (id & 31));
      if (w > maxWord) maxWord = w;
    }
    let k = 0;
    for (let w = 0; w <= maxWord; w++) {
      let x = bm[w] as number;
      if (x === 0) continue;
      bm[w] = 0;
      while (x !== 0) {
        const low = x & -x;
        out[k++] = (w << 5) | (31 - Math.clz32(low));
        x ^= low;
      }
    }
    return out;
  }

  private validateInit(prefab: PrefabDef, init: Readonly<Partial<Record<string, number>>>): void {
    for (const key of Object.keys(init)) {
      const parts = key.split('.');
      const comp = prefab.components.find((pc) => pc.def.name === parts[0]);
      const field = comp ? Object.keys(comp.def.schema).find((f) => f === parts[1]) : undefined;
      let ok = comp !== undefined && field !== undefined && parts.length >= 2 && parts.length <= 3;
      if (ok && parts.length === 3) {
        const spec = (comp as PrefabComponent).def.schema[field as string];
        const lane = Number(parts[2]);
        ok = typeof spec !== 'string' && spec !== undefined && Number.isInteger(lane) && lane >= 0 && lane < spec[1];
      }
      if (!ok) throw new UnknownInitKeyError(prefab.id, key);
    }
  }

  private host(): CommandHost {
    return {
      issueSpawn: (prefabId, init, key) => {
        const prefab = this.prefabs.get(prefabId);
        if (!prefab) throw new UnknownPrefabError(prefabId);
        if (init) this.validateInit(prefab, init);
        const stable = key ?? (`pfb:${prefabId}:${this.serial}` as StableKey);
        if (this.keyToId.has(stable)) throw new DuplicateKeyError(stable);
        const handle = this.alloc.allocate();
        if (key === undefined) this.serial++;
        this.keyToId.set(stable, idOfHandle(handle));
        return { handle, keyId: this.strings.intern(stable) };
      },
      applySpawn: (handle, prefabId, init, keyId) => {
        const id = idOfHandle(handle);
        this.alloc.activate(id);
        this.structVersion++;
        addComponent(this.bw, id, Key);
        this.keyStore[id] = keyId;
        const prefab = this.prefabs.get(prefabId) as PrefabDef;
        for (const pc of prefab.components) this.attach(id, pc.def, pc.init);
        if (init) {
          for (const key of Object.keys(init)) {
            const v = init[key];
            if (v === undefined) continue;
            const [compName, field, lane] = key.split('.') as [string, string, string | undefined];
            const comp = prefab.components.find((pc) => pc.def.name === compName) as PrefabComponent;
            this.applyFieldInit(this.layoutOf(comp.def), id, field, lane === undefined ? null : Number(lane), v);
          }
        }
      },
      applyDespawn: (handle) => {
        const id = this.alloc.resolve(handle);
        if (id === null) return;
        this.keyToId.delete(this.strings.get(this.keyStore[id] as number));
        for (const ref of getEntityComponents(this.bw, id)) {
          const l = this.layouts.get((ref as ComponentDef).id);
          if (l) this.zero(id, l);
        }
        this.alloc.release(id);
        this.structVersion++;
      },
      applyAdd: (handle, def, init) => {
        const id = this.alloc.resolve(handle);
        if (id === null) return;
        if (def.id === Key.id || def.id === Gen.id) throw new Error(`${def.name} is managed by the world`);
        this.attach(id, def, init);
      },
      applyRemove: (handle, def) => {
        const id = this.alloc.resolve(handle);
        if (id === null) return;
        if (def.id === Key.id || def.id === Gen.id) throw new Error(`${def.name} is managed by the world`);
        if (!hasComponent(this.bw, id, def)) return;
        removeComponent(this.bw, id, def);
        this.zero(id, this.layoutOf(def));
      },
    };
  }
}

function writeScalar(w: ByteWriter, kind: string, v: number): void {
  switch (kind) {
    case 'f64': w.f64(v); break;
    case 'f32': w.f32(v); break;
    case 'i32': w.i32(v); break;
    case 'u32': w.u32(v); break;
    case 'i16': w.i16(v); break;
    case 'u16': w.u16(v); break;
    case 'i8': w.i8(v); break;
    default: w.u8(v); break;
  }
}

function readScalar(r: ByteReader, kind: string): number {
  switch (kind) {
    case 'f64': return r.f64();
    case 'f32': return r.f32();
    case 'i32': return r.i32();
    case 'u32': return r.u32();
    case 'i16': return r.i16();
    case 'u16': return r.u16();
    case 'i8': return r.i8();
    default: return r.u8();
  }
}

export type { AnyArray };

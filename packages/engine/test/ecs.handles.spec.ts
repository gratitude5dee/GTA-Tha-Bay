import { describe, expect, it } from 'vitest';
import {
  COMPONENT_ID_RANGES, ENTITY_GEN_MAX, MAX_ENTITIES, NULL_HANDLE, type ComponentDef, type EntityHandle,
} from '@dv/shared';
import {
  ComponentRegistry, ENGINE_COMPONENTS, EcsWorld, EntityLimitError, Gen, Health, Key, RegistryError, Transform, Velocity,
  defineComponent, genOfHandle, idOfHandle, nextGeneration,
} from '../src/sim/index.ts';
import { UNIT_PREFAB } from './helpers.ts';

function newWorld(opts = {}): EcsWorld {
  const w = new EcsWorld(opts);
  w.definePrefab(UNIT_PREFAB);
  return w;
}

function spawn(w: EcsWorld, key?: `${'player'}:${number}`): EntityHandle {
  const h = w.commands.spawn('unit', undefined, key);
  w.flush();
  return h;
}

describe('entity handles', () => {
  it('handle = gen * 2^20 + id and resolves to the id', () => {
    const w = newWorld();
    const h = spawn(w);
    const id = w.resolve(h);
    expect(id).not.toBeNull();
    expect(h).toBe(genOfHandle(h) * 1048576 + idOfHandle(h));
    expect(idOfHandle(h)).toBe(id);
    expect(genOfHandle(h)).toBe(1);
    expect(w.handle(id as never)).toBe(h);
  });

  it('id 0 is never returned and NULL_HANDLE never resolves', () => {
    const w = newWorld();
    const ids = new Set<number>();
    for (let i = 0; i < 500; i++) ids.add(idOfHandle(spawn(w)));
    expect(ids.has(0)).toBe(false);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(1);
    expect(w.resolve(NULL_HANDLE)).toBeNull();
    expect(w.resolve(0x100000 as EntityHandle)).toBeNull(); // gen 1, id 0
  });

  it('a handle to a despawned entity resolves to null, also after its id is reused', () => {
    const w = newWorld();
    const a = spawn(w);
    const idA = idOfHandle(a);
    w.commands.despawn(a);
    w.flush();
    expect(w.resolve(a)).toBeNull();
    const b = spawn(w);
    expect(idOfHandle(b)).toBe(idA); // last freed, first reused
    expect(genOfHandle(b)).toBe(genOfHandle(a) + 1);
    expect(w.resolve(a)).toBeNull();
    expect(w.resolve(b)).toBe(idA);
  });

  it('generation 4,095 wraps to 1', () => {
    expect(nextGeneration(0)).toBe(1);
    expect(nextGeneration(1)).toBe(2);
    expect(nextGeneration(ENTITY_GEN_MAX - 1)).toBe(ENTITY_GEN_MAX);
    expect(nextGeneration(ENTITY_GEN_MAX)).toBe(1);
    const w = newWorld();
    let h = spawn(w);
    const id = idOfHandle(h);
    (w.store(Gen).gen as Uint16Array)[id] = ENTITY_GEN_MAX - 2;
    h = w.handle(id as never); // the generation was edited, so take the current handle
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      w.commands.despawn(h);
      w.flush();
      h = spawn(w);
      expect(idOfHandle(h)).toBe(id);
      seen.push(genOfHandle(h));
    }
    expect(seen).toEqual([ENTITY_GEN_MAX - 1, ENTITY_GEN_MAX, 1, 2]);
    expect(w.resolve(h)).toBe(id);
  });

  it('the 65,535th live entity spawns, the 65,536th throws EntityLimitError (id 0 reserved)', () => {
    const w = newWorld();
    const hs: EntityHandle[] = [];
    for (let i = 0; i < MAX_ENTITIES - 1; i++) hs.push(w.commands.spawn('unit'));
    w.flush();
    expect(hs.length).toBe(65_535);
    expect(w.entityCount).toBe(65_535);
    expect(() => w.commands.spawn('unit')).toThrow(EntityLimitError);
    expect(idOfHandle(hs[hs.length - 1] as EntityHandle)).toBe(65_535);
    // The world is still usable: free one and spawn again.
    w.commands.despawn(hs[10] as EntityHandle);
    w.flush();
    expect(() => spawn(w)).not.toThrow();
    expect(w.query([Key]).length).toBe(65_535);
  });

  it('store arrays have length MAX_ENTITIES; shared worlds use one SharedArrayBuffer', () => {
    const plain = newWorld();
    expect(plain.store(Transform).px.length).toBe(MAX_ENTITIES);
    expect(plain.store(Transform).px).toBeInstanceOf(Float64Array);
    expect(plain.buffer instanceof ArrayBuffer).toBe(true);
    const shared = newWorld({ shared: true });
    expect(shared.buffer instanceof SharedArrayBuffer).toBe(true);
    expect(shared.store(Transform).px.buffer).toBe(shared.buffer);
    expect(shared.store(Health).hp.buffer).toBe(shared.buffer);
    expect(shared.store(Transform).px.byteOffset % 8).toBe(0);
  });

  it('vector fields are N parallel arrays', () => {
    const w = newWorld();
    const damage = ENGINE_COMPONENTS.find((c) => c.name === 'VehicleDamage') as ComponentDef;
    const store = w.store(damage) as unknown as { tires: Float32Array[]; body: Float32Array };
    expect(store.tires.length).toBe(4);
    expect(store.tires[3]?.length).toBe(MAX_ENTITIES);
  });
});

describe('stable keys', () => {
  it('byKey and keyOf round-trip; keyless spawns get pfb:<prefab>:<serial>', () => {
    const w = newWorld();
    const p = spawn(w, 'player:0');
    expect(w.byKey('player:0')).toBe(p);
    expect(w.keyOf(p)).toBe('player:0');
    expect(w.byKey('player:1')).toBe(NULL_HANDLE);
    const a = spawn(w);
    const b = spawn(w);
    expect(w.keyOf(a)).toBe('pfb:unit:0');
    expect(w.keyOf(b)).toBe('pfb:unit:1');
    w.commands.despawn(a);
    w.flush();
    expect(w.byKey('pfb:unit:0')).toBe(NULL_HANDLE);
    expect(w.keyOf(a)).toBeNull();
  });

  it('a duplicate key throws, also against a spawn not yet applied', () => {
    const w = newWorld();
    w.commands.spawn('unit', undefined, 'player:0');
    expect(() => w.commands.spawn('unit', undefined, 'player:0')).toThrow(/already in use/);
  });

  it('keyOrder lists live ids in ascending StableKey order', () => {
    const w = newWorld();
    const keys = ['npc:zed', 'npc:abe', 'player:0', 'veh:b', 'veh:a', 'npc:mia'] as const;
    for (const k of keys) w.commands.spawn('unit', undefined, k);
    w.flush();
    const order = Array.from(w.keyOrder()).map((id) => w.keyOf(w.handle(id as never)));
    expect(order).toEqual(['npc:abe', 'npc:mia', 'npc:zed', 'player:0', 'veh:a', 'veh:b']);
  });
});

describe('string table', () => {
  it('interns in first-use order, 0 is the empty string', () => {
    const w = newWorld();
    expect(w.strings.intern('')).toBe(0);
    const a = w.strings.intern('asset/foo');
    const b = w.strings.intern('asset/bar');
    expect(w.strings.intern('asset/foo')).toBe(a);
    expect(b).toBe(a + 1);
    expect(w.strings.get(b)).toBe('asset/bar');
    expect(() => w.strings.get(9999)).toThrow(RangeError);
  });
});

describe('component registry', () => {
  it('engine registry v1 has ids 1-24 and tags 30-39 with the C01 names', () => {
    const ids = ENGINE_COMPONENTS.map((c) => c.id);
    expect(ids).toEqual([...Array.from({ length: 24 }, (_, i) => i + 1), ...Array.from({ length: 10 }, (_, i) => i + 30)]);
    expect(ENGINE_COMPONENTS.slice(24).map((c) => c.name)).toEqual([
      'LocalPlayer', 'Police', 'Robotaxi', 'MissionOwned', 'Persistent', 'Ped', 'Prop', 'NoCollide', 'Hidden', 'Busted',
    ]);
    expect(ENGINE_COMPONENTS.filter((c) => !c.hashed).map((c) => c.name)).toEqual([
      'Gen', 'BodyRef', 'Anim', 'RenderKey', 'AudioEmitter', 'CameraAnchor',
    ]);
    for (const c of ENGINE_COMPONENTS) {
      expect(c.id).toBeGreaterThanOrEqual(COMPONENT_ID_RANGES.engine[0]);
      expect(c.id).toBeLessThanOrEqual(COMPONENT_ID_RANGES.engine[1]);
    }
    expect(Transform.schema).toEqual({ px: 'f64', py: 'f64', pz: 'f64', qx: 'f32', qy: 'f32', qz: 'f32', qw: 'f32' });
    expect(Object.isFrozen(Transform)).toBe(true);
  });

  it('rejects ids outside the owner range, duplicate ids and duplicate names', () => {
    const base = { owner: 'S02', hashed: false, snapshot: 'none', schema: { a: 'u8' } } as const;
    expect(() => defineComponent({ ...base, id: 100, name: 'Outside' })).toThrow(RegistryError);
    expect(() => defineComponent({ ...base, id: 256, name: 'lowercase' })).toThrow(/PascalCase/);
    expect(() => defineComponent({ ...base, id: 300, name: 'BadField', schema: { Field: 'u8' } })).toThrow(/camelCase/);
    expect(() => defineComponent({ ...base, id: 300, name: 'BadVec', schema: { v: ['f32', 0] } })).toThrow(/vector length/);
    const a = defineComponent({ ...base, id: 300, name: 'WorldA' });
    const sameId = defineComponent({ ...base, id: 300, name: 'WorldB' });
    const sameName = defineComponent({ ...base, id: 301, name: 'WorldA' });
    const reg = new ComponentRegistry([...ENGINE_COMPONENTS, a]);
    expect(() => reg.register(sameId)).toThrow(/already used/);
    expect(() => reg.register(sameName)).toThrow(/duplicate component name/);
    expect(() => new ComponentRegistry([Transform, Transform])).toThrow(RegistryError);
    // An S02 component cannot take an engine id and vice versa.
    expect(() => defineComponent({ ...base, owner: 'S01', id: 300, name: 'EngineHigh' })).toThrow(/outside the S01 range/);
    expect(() => defineComponent({ ...base, owner: 'S02', id: 24, name: 'WorldLow' })).toThrow(/outside the S02 range/);
  });

  it('a world accepts extra components in their owner range', () => {
    const extra = defineComponent({ id: 300, name: 'Crowd', owner: 'S02', hashed: true, snapshot: 'none', schema: { size: 'u16' } });
    const w = new EcsWorld({ components: [extra] });
    w.definePrefab({ id: 'c', components: [{ def: extra, init: { size: 7 } }] });
    const h = w.commands.spawn('c');
    w.flush();
    const id = w.resolve(h) as number;
    expect(w.store(extra).size[id]).toBe(7);
    expect(w.has(h, extra)).toBe(true);
    expect(w.has(h, Velocity)).toBe(false);
    expect(() => w.layoutOf({ ...Velocity })).toThrow(/not registered/);
  });
});

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { HALF_PI } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { BodyRef, CameraAnchor, CharacterBody, Control, Key, LocalPlayer, PlayerControlled, RenderKey, Transform } from '../src/sim/ecs/components.ts';
import { DuplicateKeyError, EcsWorld } from '../src/sim/ecs/world.ts';
import { RapierBackend } from '../src/sim/physics/rapier-backend.ts';
import { groupsFromNames, ENGINE_PREFABS, PrefabError, PrefabRegistry, type PrefabDef } from '../src/sim/prefabs/registry.ts';
import { GROUPS } from '../src/sim/physics/groups.ts';

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true });

describe('JSON files validate against their schemas (AC-1)', () => {
  const prefabSchema = ajv.compile(read('packages/engine/src/sim/prefabs/schema/prefab.schema.json') as object);
  const inputSchema = ajv.compile(read('config/schemas/input-map.schema.json') as object);

  it('assets/prefabs/player.default.json is a valid prefab', () => {
    const player = read('assets/prefabs/player.default.json');
    expect(prefabSchema(player), JSON.stringify(prefabSchema.errors)).toBe(true);
  });

  it('the prefab schema rejects an unknown kind, a bad asset ref, a missing id and a body without groups', () => {
    const player = read('assets/prefabs/player.default.json') as Record<string, unknown>;
    expect(prefabSchema({ ...player, kind: 'dragon' })).toBe(false);
    expect(prefabSchema({ ...player, render: { asset: 'not an ref' } })).toBe(false);
    const { id: _id, ...noId } = player;
    expect(prefabSchema(noId)).toBe(false);
    expect(prefabSchema({ ...player, physics: { body: 'kinematic', shape: 'capsule', dims: [0.55, 0.35], groups: [] } })).toBe(false);
    expect(prefabSchema({ ...player, extra: 1 })).toBe(false);
  });

  it('config/input/defaults.kbm.json and defaults.gamepad.json are valid input maps', () => {
    for (const file of ['config/input/defaults.kbm.json', 'config/input/defaults.gamepad.json']) {
      expect(inputSchema(read(file)), `${file}: ${JSON.stringify(inputSchema.errors)}`).toBe(true);
    }
  });

  it('the input-map schema rejects a bad control id, an unknown action and a bad context', () => {
    const kbm = read('config/input/defaults.kbm.json') as { contexts: Record<string, Record<string, unknown>> };
    expect(inputSchema({ ...kbm, contexts: { onFoot: { 'sim.Jump': [{ control: 'keyboard:Space' }] } } })).toBe(false);
    expect(inputSchema({ ...kbm, contexts: { onFoot: { 'sim.Fly': [{ control: 'key:Space' }] } } })).toBe(false);
    expect(inputSchema({ ...kbm, contexts: { sky: { 'sim.Jump': [{ control: 'key:Space' }] } } })).toBe(false);
    expect(inputSchema({ ...kbm, version: 2 })).toBe(false);
  });
});

describe('PrefabRegistry', () => {
  async function world(): Promise<{ ecs: EcsWorld; backend: RapierBackend; registry: PrefabRegistry }> {
    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    const ecs = new EcsWorld();
    const registry = new PrefabRegistry(ecs, backend);
    registry.load(ENGINE_PREFABS);
    return { ecs, backend, registry };
  }

  it('player.default spawns with the engine components, Key player:0, the LocalPlayer tag and the camera anchors', async () => {
    const { ecs, backend, registry } = await world();
    const h = registry.spawn('player.default', { pos: [10, 2, -30], yaw: HALF_PI }, 'player:0');
    ecs.flush();
    const id = ecs.resolve(h) as number;
    expect(ecs.keyOf(h)).toBe('player:0');
    expect(ecs.byKey('player:0')).toBe(h);
    for (const c of [Transform, BodyRef, CharacterBody, Control, PlayerControlled, CameraAnchor, RenderKey, LocalPlayer, Key]) {
      expect(ecs.has(h, c), c.name).toBe(true);
    }
    const tr = ecs.store(Transform);
    expect([tr.px[id], tr.py[id], tr.pz[id]]).toEqual([10, 2, -30]);
    expect(tr.qy[id]).toBeCloseTo(Math.sin(HALF_PI / 2), 6);
    expect(tr.qw[id]).toBeCloseTo(Math.cos(HALF_PI / 2), 6);
    const anchor = ecs.store(CameraAnchor);
    expect(anchor.headY[id]).toBeCloseTo(1.7, 6); // f32 stores
    expect(anchor.chestY[id]).toBeCloseTo(1.35, 6);
    const body = ecs.store(CharacterBody);
    expect(body.radius[id]).toBeCloseTo(0.35, 6);
    expect(body.height[id]).toBeCloseTo(1.8, 6);
    expect(ecs.store(Control).state[id]).toBe(100);
    expect(ecs.store(Control).owner[id]).toBe(1);
    expect(ecs.strings.get(ecs.store(RenderKey).asset[id] as number)).toBe('prop/graybox.capsule');
    expect(ecs.store(RenderKey).visible[id]).toBe(1);

    // The body: a kinematic capsule, centred 0.9 m + skin above the feet.
    const bodyId = ecs.store(BodyRef).body[id] as number;
    expect(backend.bodyKind(bodyId)).toBe('kinematic');
    const out = new Float64Array(13);
    backend.readBody(bodyId, out);
    expect(out[0]).toBeCloseTo(10, 5);
    expect(out[1]).toBeCloseTo(2 + 0.9 + 0.01, 5);
    expect(out[2]).toBeCloseTo(-30, 5);
    backend.dispose();
  });

  it('despawn removes the body and the entity', async () => {
    const { ecs, backend, registry } = await world();
    const h = registry.spawn('player.default', { pos: [0, 0, 0], yaw: 0 }, 'player:0');
    ecs.flush();
    expect(backend.bodyCount).toBe(1);
    registry.despawn(h);
    ecs.flush();
    expect(backend.bodyCount).toBe(0);
    expect(ecs.resolve(h)).toBeNull();
    expect(ecs.byKey('player:0')).toBe(0);
    backend.dispose();
  });

  it('def() returns the loaded definition; an unknown id, a duplicate key and a bodyless registry fail loudly', async () => {
    const { ecs, backend, registry } = await world();
    expect(registry.def('player.default').kind).toBe('player');
    expect(() => registry.def('nope.nothing')).toThrow(PrefabError);
    registry.spawn('player.default', { pos: [0, 0, 0], yaw: 0 }, 'player:0');
    expect(() => registry.spawn('player.default', { pos: [0, 0, 0], yaw: 0 }, 'player:0')).toThrow(DuplicateKeyError);
    const bodyless = new PrefabRegistry(new EcsWorld(), null);
    bodyless.load(ENGINE_PREFABS);
    expect(() => bodyless.spawn('player.default', { pos: [0, 0, 0], yaw: 0 }, 'player:0')).toThrow(/no physics backend/);
    backend.dispose();
    void ecs;
  });

  it('load() rejects an unknown component, an unknown field and a bad asset reference', async () => {
    const { registry, backend } = await world();
    const base = ENGINE_PREFABS[0] as PrefabDef;
    expect(() => registry.load([{ ...base, id: 'x.a', components: { Wibble: {} } }])).toThrow(/unknown component Wibble/);
    expect(() => registry.load([{ ...base, id: 'x.b', components: { Transform: { nope: 1 } } }])).toThrow(/no field nope/);
    expect(() => registry.load([{ ...base, id: 'x.c', render: { asset: 'bad' } }])).toThrow(/AssetRef/);
    backend.dispose();
  });

  it('a prefab with string values interns them, and a body-less prop needs no backend', async () => {
    const ecs = new EcsWorld();
    const registry = new PrefabRegistry(ecs, null);
    registry.load([
      { id: 'prop.cone', kind: 'prop', version: 1, render: { asset: 'prop/cone' }, physics: null, components: { Transform: {}, Prop: {} } },
    ]);
    const h = registry.spawn('prop.cone', { pos: [1, 2, 3], yaw: 0 });
    ecs.flush();
    const id = ecs.resolve(h) as number;
    expect(ecs.strings.get(ecs.store(RenderKey).asset[id] as number)).toBe('prop/cone');
    expect(ecs.keyOf(h)).toMatch(/^pfb:prop\.cone:/);
  });

  it('collision group names map to Rapier interaction groups', () => {
    expect(groupsFromNames(['character'])).toBe(GROUPS.character);
    expect(groupsFromNames(['static'])).toBe(GROUPS.static);
    const both = groupsFromNames(['dynamic', 'vehicle']);
    expect(both >>> 16).toBe(2 | 8);
    expect(() => groupsFromNames([])).toThrow(PrefabError);
  });
});

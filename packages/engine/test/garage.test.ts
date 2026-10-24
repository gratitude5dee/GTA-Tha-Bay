import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { JsonObject, JsonValue, PrefabService, StableKey, UiBridge, VehicleInstance, WorldApi } from '@dv/shared';
import vehicleInstanceSchema from '../../shared/schemas/racing/vehicle-instance.v1.schema.json';
import coreSchema from '../src/sim/save/schema/core.v1.schema.json';
import { validateSchema, type JsonSchema } from '../src/sim/save/validate.ts';
import { SLICE_SCHEMAS, inlineRefs, validateSlice } from '../src/sim/save/schemas.ts';
import { defaultCore } from '../src/sim/save/defaults.ts';
import {
  CALL_MIN_DISTANCE_M, createGarageService, garageAdd, garageFavorite, garageRemove, garageSlots, garageView, inView, type GaragePorts,
} from '../src/sim/garage/garage.ts';

const instance = (n: number, defId = 'vehicle.compact', source: VehicleInstance['source'] = 'reward'): VehicleInstance => ({
  id: n.toString(16).padStart(32, '0'),
  defId,
  upgrades: {},
  livery: { assetRef: 'texture/livery-plain', hue: 120, plate: `DV000${n}` },
  damage: { body: 0.8, engine: 1, tires: [1, 0.5, 1, 1] },
  odometerKm: 0,
  acquired: 1760000000000,
  source,
});

interface Spawn { id: string; pos: [number, number, number]; yaw: number; key?: StableKey | undefined; init?: Record<string, number> | undefined }

function rig(over: { heat?: number; world?: 'none' | 'ok' | 'empty' } = {}) {
  const list: JsonObject[] = [];
  const toasts: { text: string; params?: Record<string, string | number> | undefined }[] = [];
  const patches: { k: string; v: JsonValue | null }[] = [];
  const spawns: Spawn[] = [];
  let changed = 0;
  const ui: UiBridge = {
    patch: (k, v) => void patches.push({ k, v }),
    toast: (t) => void toasts.push({ text: t.text, params: t.params }),
    openApp: () => undefined,
    closeOverlay: () => undefined,
  };
  const lanes: [number, number][] = [];
  const world = {
    graph: {
      nearestEdge: (x: number, z: number) => {
        if (over.world === 'empty') return null;
        lanes.push([x, z]);
        return { edge: lanes.length - 1, s: 0, distM: 1 };
      },
      laneCentre: (e: { edge: number }, out: Float64Array) => {
        const p = lanes[e.edge] as [number, number];
        out[0] = p[0];
        out[1] = 2;
        out[2] = p[1];
        out[3] = 1.25;
      },
    },
  } as unknown as WorldApi;
  const prefabs: PrefabService = {
    spawn: (id, at, key, init) => {
      spawns.push({ id, pos: at.pos, yaw: at.yaw, key, init });
      return 1 as never;
    },
    despawn: () => undefined,
  };
  const heat = { n: over.heat ?? 0 };
  const ports: GaragePorts = {
    list: () => list,
    ui,
    heat: () => heat.n,
    world: () => (over.world === 'none' ? null : world),
    prefabs: () => prefabs,
    player: () => ({ x: 10, y: 0, z: -20, camYaw: 0.5 }),
    onChange: () => void changed++,
  };
  return { list, toasts, patches, spawns, heat, svc: createGarageService(ports), changed: () => changed };
}

describe('engine/garage (DL-668 part 3)', () => {
  it('add is idempotent by id, never refused for room, and remove/favorite address the instance by key', () => {
    const list: JsonObject[] = [];
    expect(garageAdd(list, instance(1))).toBe(true);
    expect(garageAdd(list, instance(1))).toBe(false);
    for (let i = 2; i <= 9; i++) expect(garageAdd(list, instance(i))).toBe(true);
    expect(list).toHaveLength(9);
    expect(garageFavorite(list, `veh:${instance(5).id}`)).toBe(true);
    expect(list[0]?.['id']).toBe(instance(5).id);
    expect(list).toHaveLength(9);
    expect(garageFavorite(list, 'veh:nope')).toBe(false);
    expect(garageRemove(list, instance(5).id)).toBe(true);
    expect(list).toHaveLength(8);
    expect(garageRemove(list, 'veh:nope')).toBe(false);
  });

  it('slots: 4 at the Yard, 2 at the flat, 6 at the loft', () => {
    expect(garageSlots([])).toBe(0);
    expect(garageSlots(['sh.yard'])).toBe(4);
    expect(garageSlots(['sh.yard', 'sh.mission_flat'])).toBe(6);
    expect(garageSlots(['sh.soma_loft'])).toBe(6);
  });

  it('AC-11: call at heat 0 spawns the prefab 120 m or more away on a lane outside the view, then refuses at heat 1, for an unknown key and without a world', () => {
    const r = rig();
    garageAdd(r.list, instance(1));
    garageAdd(r.list, instance(2, 'vehicle.sedan'));
    r.svc.call(`veh:${instance(2).id}`);
    expect(r.spawns).toHaveLength(1);
    const s = r.spawns[0] as Spawn;
    expect(s.id).toBe('vehicle.sedan');
    expect(s.key).toBe(`veh:${instance(2).id}`);
    const dx = s.pos[0] - 10;
    const dz = s.pos[2] + 20;
    expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(CALL_MIN_DISTANCE_M);
    expect(inView(dx, dz, 0.5)).toBe(false);
    expect(s.pos[1]).toBe(2);
    expect(s.yaw).toBe(1.25);
    expect(s.init).toMatchObject({ 'VehicleDamage.body': 0.8, 'VehicleDamage.engine': 1, 'VehicleDamage.tires.1': 0.5 });
    expect(r.toasts.map((t) => t.text)).toEqual(['garage.call.ok']);
    expect(r.toasts[0]?.params?.['eta']).toBeGreaterThanOrEqual(12);

    r.heat.n = 1;
    r.svc.call(`veh:${instance(1).id}`);
    r.heat.n = 0;
    r.svc.call('veh:ffffffffffffffffffffffffffffffff');
    expect(r.spawns).toHaveLength(1);
    expect(r.toasts.map((t) => t.text)).toEqual(['garage.call.ok', 'garage.refuse.heat', 'garage.refuse.unknown']);

    const w = rig({ world: 'none' });
    garageAdd(w.list, instance(1));
    w.svc.call(`veh:${instance(1).id}`);
    expect(w.spawns).toHaveLength(0);
    expect(w.toasts.map((t) => t.text)).toEqual(['garage.refuse.noWorld']);

    const e = rig({ world: 'empty' });
    garageAdd(e.list, instance(1));
    e.svc.call(`veh:${instance(1).id}`);
    expect(e.spawns).toHaveLength(0);
    expect(e.toasts.map((t) => t.text)).toEqual(['garage.refuse.noLane']);
  });

  it('favorite moves the instance to index 0, republishes sys.garage and asks for a save; an unknown key toasts', () => {
    const r = rig();
    garageAdd(r.list, instance(1));
    garageAdd(r.list, instance(2));
    r.svc.favorite(`veh:${instance(2).id}`);
    expect(r.list.map((e) => e['id'])).toEqual([instance(2).id, instance(1).id]);
    expect(r.changed()).toBe(1);
    const view = r.patches.at(-1)?.v as { key: string }[];
    expect(r.patches.at(-1)?.k).toBe('sys.garage');
    expect(view.map((v) => v.key)).toEqual([`veh:${instance(2).id}`, `veh:${instance(1).id}`]);
    r.svc.favorite('veh:nope');
    expect(r.toasts.map((t) => t.text)).toEqual(['garage.refuse.unknown']);
  });

  it('the view carries what the garage frame reads (key, prefab, plate, damage 0..1)', () => {
    const list: JsonObject[] = [];
    garageAdd(list, instance(3, 'vehicle.pickup'));
    expect(garageView(list, () => 2)).toEqual([{ key: `veh:${instance(3).id}`, prefab: 'vehicle.pickup', plate: 'DV0003', damage: 0.2, vehicleHeat: 2 }]);
  });

  it('every entry validates against vehicle-instance.v1.schema.json, in the built-in validator and in Ajv', () => {
    const list: JsonObject[] = [];
    garageAdd(list, instance(1));
    garageAdd(list, { ...instance(2), upgrades: { engine: 2, nitro: 1 } });
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(vehicleInstanceSchema);
    for (const e of list) {
      expect(validateSchema(vehicleInstanceSchema as unknown as JsonSchema, e)).toBeNull();
      expect(validate(e)).toBe(true);
    }
    const bad = [
      { ...instance(1), id: 'short' },
      { ...instance(1), source: 'stolen' },
      { ...instance(1), livery: { assetRef: 'texture/x', hue: 1, plate: 'lowercase' } },
      { ...instance(1), upgrades: { engine: 4 } },
      { ...instance(1), extra: 1 },
    ];
    for (const b of bad) {
      expect(validateSchema(vehicleInstanceSchema as unknown as JsonSchema, b)).not.toBeNull();
      expect(validate(b)).toBe(false);
    }
  });

  it('core.v1.schema.json takes garage.items as a $ref to it, and the slice validators agree', () => {
    const items = (coreSchema as { properties: { garage: { items: JsonSchema } } }).properties.garage.items;
    expect(items).toEqual({ $ref: (vehicleInstanceSchema as { $id: string }).$id });
    const inlined = inlineRefs(coreSchema) as { properties: { garage: { items: { required: string[] } } } };
    expect(inlined.properties.garage.items.required).toContain('defId');
    const core = { ...defaultCore(), garage: [instance(1)] } as unknown as JsonObject;
    expect(validateSlice('core', 1, core)).toBeNull();
    expect(validateSlice('core', 1, { ...core, garage: [{ key: 'veh:x' }] })).not.toBeNull();
    const ajv = new Ajv2020({ strict: false });
    expect(ajv.compile(SLICE_SCHEMAS.core?.[1] as object)(core)).toBe(true);
    expect(() => inlineRefs({ $ref: 'https://example.invalid/none' })).toThrow();
  });
});

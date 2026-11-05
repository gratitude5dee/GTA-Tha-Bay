/**
 * The M03a1 prefabs: 17 JSON files validate against the prefab schema, load, point at real handling presets and agree with
 * them; every car settles on its springs at its designed height.
 */
import { isArtKey } from '../src/client/vehicle/art-model.ts';
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { wheelAnchors } from '../src/sim/vehicle/raycast-vehicle.ts';
import { handlingById } from '../src/sim/vehicle/presets.ts';
import { VEHICLE_PREFABS, type PrefabDef } from '../src/sim/prefabs/registry.ts';
import { Interactable, Transform } from '../src/sim/ecs/components.ts';
import { createVehicleWorld, drive, view } from './vehicle-sim.ts';

const ROOT = new URL('../../../', import.meta.url);
const read = (p: string): unknown => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const schema = new Ajv2020({ allErrors: true, strict: false }).compile(read('packages/engine/src/sim/prefabs/schema/prefab.schema.json') as object);

const IDS = [
  'vehicle.compact', 'vehicle.sedan', 'vehicle.rideshare', 'vehicle.van', 'vehicle.truck', 'vehicle.pickup', 'vehicle.ondine-pico',
  'police.cruiser', 'police.suv', 'police.heli', 'robotaxi.default', 'prop.cone', 'prop.barrier', 'prop.spikestrip', 'prop.crate',
  'pickup.cash', 'pickup.item',
];

describe('M03a1 prefabs', () => {
  it('there are 17 files, each valid, each named by its id', () => {
    expect(IDS).toHaveLength(17);
    const files = readdirSync(new URL('assets/prefabs/', ROOT));
    for (const id of IDS) {
      expect(files, id).toContain(`${id}.json`);
      const def = read(`assets/prefabs/${id}.json`) as PrefabDef;
      expect(schema(def), `${id}: ${JSON.stringify(schema.errors)}`).toBe(true);
      expect(def.id).toBe(id);
    }
    expect(VEHICLE_PREFABS.map((d) => d.id).sort()).toEqual([...IDS].sort());
  });

  it('vehicle prefabs name an existing preset, its mass and its wheel anchors', () => {
    for (const def of VEHICLE_PREFABS) {
      if (!def.vehicle) continue;
      const p = handlingById(def.vehicle.handling);
      expect(def.physics?.massKg, def.id).toBe(p.massKg);
      expect(def.physics?.body, def.id).toBe('dynamic');
      expect(def.physics?.groups, def.id).toEqual(['vehicle']);
      const anchors = wheelAnchors(p);
      def.vehicle.wheels.forEach((w, k) => {
        const a = anchors[k] as [number, number, number];
        expect(w.pos[0], `${def.id} wheel ${k}`).toBeCloseTo(a[0], 2);
        expect(w.pos[1], `${def.id} wheel ${k}`).toBeCloseTo(a[1], 2);
        expect(w.pos[2], `${def.id} wheel ${k}`).toBeCloseTo(a[2], 2);
        expect(w.radius).toBe(p.drive.wheelRadiusM);
        expect(w.restM).toBe(p.suspension.restM);
        expect(w.axle).toBe(k < 2 ? 'front' : 'rear');
      });
      // every car carries an enter prompt unless it is a robotaxi
      expect(def.interact?.kind === 'EnterVehicle', def.id).toBe(def.kind !== 'robotaxi');
    }
  });

  it('render assets are the final art (M10d1) or, for the race cars of M10d3, the gray-box placeholders', () => {
    for (const def of VEHICLE_PREFABS) {
      const gray = /^vehicle\/graybox\.(kestrel-quill|brackenridge-rasp|aurelian-sorrel|solenne-skip|halcyon-cormorant)$/.test(def.render.asset);
      expect(gray || isArtKey(def.render.asset), def.id).toBe(true);
    }
  });

  it('the interact block fills the Interactable component', async () => {
    const w = await createVehicleWorld({ pos: [0, 0, 0], seated: false });
    drive(w, 5);
    const id = w.sim.ecs.resolve(w.vehicle) as number;
    const ia = w.sim.ecs.store(Interactable);
    expect(ia.kind[id]).toBe(1);
    expect(ia.radius[id]).toBeCloseTo(2.5, 6);
    expect(ia.coneDeg[id]).toBe(180);
    expect(w.sim.ecs.strings.get(ia.prompt[id] as number)).toBe('interact.enterVehicle');
    w.sim.dispose();
  });

  it('every car settles on its springs at its design height', async () => {
    for (const def of VEHICLE_PREFABS) {
      if (!def.vehicle || def.kind === 'police' && def.id === 'police.heli') continue;
      const w = await createVehicleWorld({ prefab: def.id, seated: false, pos: [0, 0, 0] });
      drive(w, 150);
      const v = view(w);
      const cg = handlingById(def.vehicle.handling).cgHeightM;
      expect(v.y, def.id).toBeGreaterThan(cg - 0.04);
      expect(v.y, def.id).toBeLessThan(cg + 0.04);
      expect(v.upY, def.id).toBeGreaterThan(0.999);
      expect(v.contacts, def.id).toBe(4);
      expect(Math.abs(v.speed), def.id).toBeLessThan(0.05);
      w.sim.dispose();
    }
  }, 120_000);

  it('props and pickups spawn and keep their place', async () => {
    const w = await createVehicleWorld({ prefab: null, pos: [0, 0, 0], playerAt: [0, 0, 20] });
    const h = [
      w.mod.prefabs.spawn('prop.cone', { pos: [10, 0, 0], yaw: 0 }),
      w.mod.prefabs.spawn('prop.crate', { pos: [12, 0, 0], yaw: 0 }),
      w.mod.prefabs.spawn('prop.barrier', { pos: [14, 0, 0], yaw: 1 }),
      w.mod.prefabs.spawn('pickup.cash', { pos: [16, 0, 0], yaw: 0 }),
    ];
    drive(w, 120);
    const tr = w.sim.ecs.store(Transform);
    for (const e of h) {
      const id = w.sim.ecs.resolve(e) as number;
      expect(Number.isFinite(tr.px[id]), 'finite').toBe(true);
    }
    // the crate fell to rest on the ground, centre half a metre up
    const crate = w.sim.ecs.resolve(h[1] as never) as number;
    expect(tr.py[crate]).toBeGreaterThan(0.4);
    expect(tr.py[crate]).toBeLessThan(0.6);
    w.sim.dispose();
  });
});

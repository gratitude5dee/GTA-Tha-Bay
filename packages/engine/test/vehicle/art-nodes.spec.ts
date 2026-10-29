/**
 * M10d1 AC-5 (engine half): the final vehicle models resolve the C07 node names through `anchors.ts`, wheels spin about X and steering
 * pivots turn about Y, a model draws no more meshes than the gray-box vehicle it replaces, the ground and the hubs sit where the handling
 * preset has them, and the object pool draws the stand-in until the model arrives and then swaps it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Group, Scene, type Mesh, type Object3D } from 'three/webgpu';
import { artModel } from '../../../../tests/support/art-models.ts';
import { art } from '../../src/client/vehicle/art.ts';
import { ART_GRAYBOX, ART_VEHICLES } from '../../src/client/vehicle/art-tables.ts';
import { ART_REFS, findArtNode, isArtKey, type ArtModelData } from '../../src/client/vehicle/art-model.ts';
import { buildArtThing, artMeshCount } from '../../src/client/vehicle/gltf-thing.ts';
import { beamFade } from '../../src/client/vehicle/marker-beam.ts';
import { resolveAnchors } from '../../src/client/vehicle/anchors.ts';
import { buildGrayboxThing, GrayboxAssets } from '../../src/client/vehicle/vehicle-view.ts';
import { handlingById } from '../../src/sim/vehicle/presets.ts';
import { ObjectPool } from '../../src/client/snapshot/object-pool.ts';

const VEHICLES = Object.keys(ART_VEHICLES);
const models = new Map<string, ArtModelData>();

beforeAll(async () => {
  for (const ref of ART_REFS) models.set(ref, await artModel(ref, 'hi'));
}, 120_000);

const meshesOf = (root: Object3D): number => {
  let n = 0;
  root.traverse((o) => {
    if ((o as Mesh).isMesh) n++;
  });
  return n;
};

describe('anchors on the final vehicles', () => {
  it('resolve body, glass, wheels, steering pivots, lights, tyres and rims for every pool vehicle', () => {
    const assets = new GrayboxAssets();
    for (const ref of VEHICLES) {
      const thing = buildArtThing(assets, ref, models.get(ref) as ArtModelData);
      const a = resolveAnchors(thing.root);
      expect(a.missing, ref).toEqual([]);
      expect(a.wheels.every((w) => w !== null)).toBe(true);
      expect(a.steer).toHaveLength(2);
      expect(a.lights).toHaveLength(4);
      for (const name of ['glass', 'tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr', 'rim_fl', 'rim_fr', 'rim_rl', 'rim_rr']) expect(thing.root.getObjectByName(name), `${ref}: ${name}`).toBeDefined();
      expect(thing.root.getObjectByName('collider_hull')).toBeUndefined();
    }
    assets.dispose();
  });

  it('spin the wheels about X and turn the front pivots about Y', () => {
    const assets = new GrayboxAssets();
    const thing = buildArtThing(assets, 'vehicle/traffic.sedan', models.get('vehicle/traffic.sedan') as ArtModelData);
    const a = resolveAnchors(thing.root);
    thing.update(0.1, 10, 0);
    for (const w of a.wheels) {
      expect(w?.rotation.x).toBeLessThan(0);
      expect(w?.rotation.y).toBe(0);
      expect(w?.rotation.z).toBe(0);
    }
    thing.update(0.1, 10, 1);
    for (const s of a.steer) {
      expect(s.rotation.y).toBeLessThan(0);
      expect(s.rotation.x).toBe(0);
    }
    thing.update(0.1, 10, -1);
    for (const s of a.steer) expect(s.rotation.y).toBeGreaterThan(0);
    assets.dispose();
  });

  it('stand with the ground at the centre of gravity height and the front hubs at the preset front axle', () => {
    const assets = new GrayboxAssets();
    for (const ref of VEHICLES) {
      const info = ART_VEHICLES[ref] as (typeof ART_VEHICLES)[string];
      const hp = handlingById(info.hp);
      const thing = buildArtThing(assets, ref, models.get(ref) as ArtModelData);
      thing.root.updateWorldMatrix(true, true);
      const fl = thing.root.getObjectByName('wheel_fl') as Group;
      const rl = thing.root.getObjectByName('wheel_rl') as Group;
      const p = fl.getWorldPosition(fl.position.clone());
      const q = rl.getWorldPosition(rl.position.clone());
      const wheelR = (models.get(ref)?.extras['wheelRadiusM'] as number) ?? hp.drive.wheelRadiusM;
      expect(p.y, `${ref} hub height`).toBeCloseTo(wheelR - hp.cgHeightM, 2);
      expect(p.z, `${ref} front axle`).toBeCloseTo(-hp.wheelbaseM * (1 - hp.frontWeightPct / 100), 2);
      expect(q.z - p.z, `${ref} wheelbase`).toBeGreaterThan(hp.wheelbaseM * 0.9);
      expect(q.z - p.z, `${ref} wheelbase`).toBeLessThan(hp.wheelbaseM * 1.1);
    }
    assets.dispose();
  });
});

describe('render objects per entity', () => {
  it('stay at or below the gray-box count of the vehicle or prop a model replaces', () => {
    const assets = new GrayboxAssets();
    for (const ref of ART_REFS) {
      if (ref === 'prop/transit.ferry' || ref === 'prop/transit.airliner' || ref === 'vehicle/transit.bus' || ref === 'vehicle/transit.cablecar' || ref === 'prop/transit-entrance') continue;
      const gray = buildGrayboxThing(assets, ART_GRAYBOX[ref] as string);
      expect(gray, ref).not.toBeNull();
      const art1 = buildArtThing(assets, ref, models.get(ref) as ArtModelData);
      const grayCount = meshesOf((gray as NonNullable<typeof gray>).root);
      expect(meshesOf(art1.root), `${ref}: ${meshesOf(art1.root)} meshes against ${grayCount}`).toBeLessThanOrEqual(grayCount);
      expect(artMeshCount(models.get(ref) as ArtModelData)).toBeGreaterThan(0);
    }
    assets.dispose();
  });

  it('give the pickup its tow boom, which the chase camera can fade', () => {
    const assets = new GrayboxAssets();
    const thing = buildArtThing(assets, 'vehicle/traffic.pickup', models.get('vehicle/traffic.pickup') as ArtModelData);
    expect(thing.attachments).toHaveLength(1);
    expect(thing.root.getObjectByName('attach_boom')).toBeDefined();
    assets.dispose();
  });
});

describe('the art store and the object pool', () => {
  it('draw the gray-box stand-in until the model arrives, then swap it keeping the pose', async () => {
    const ref = 'vehicle/traffic.sedan';
    const model = models.get(ref) as ArtModelData;
    let resolve: (m: ArtModelData | null) => void = () => undefined;
    art.configure({ loader: () => new Promise((r) => (resolve = r)), profile: 'legacy', variant: 'desktop' });
    const scene = new Scene();
    const pool = new ObjectPool(scene);
    const pose = { handle: 7, renderKey: 1, px: 3, py: 1, pz: -2, qx: 0, qy: 0, qz: 0, qw: 1, animState: 0, animP0: 0, animP1: 0, flags: 1, snapped: true };
    pool.sync([pose], 1, () => ref);
    expect(pool.pendingArtKeys()).toEqual([ref]);
    const before = pool.meshFor(7) as Group;
    expect(before.getObjectByName('wheel_fl')).toBeDefined();
    expect(before.userData['dvArt']).toBeUndefined();
    resolve(model);
    await new Promise((r) => setTimeout(r, 0));
    pool.sync([pose], 1, () => ref);
    const after = pool.meshFor(7) as Group;
    expect(after).not.toBe(before);
    expect(after.userData['dvArt']).toBe(ref);
    expect(after.position.x).toBe(3);
    expect(after.userData['dvActor']).toBe('vehicle');
    expect(pool.pendingArtKeys()).toEqual([]);
    expect(scene.children).toContain(after);
    expect(scene.children).not.toContain(before);
    pool.dispose();
    art.reset();
  });

  it('keep the stand-in when the loader fails, and never ask twice', async () => {
    let calls = 0;
    art.configure({ loader: () => (calls++, Promise.reject(new Error('no pack'))), profile: 'legacy', variant: 'desktop' });
    const pool = new ObjectPool(new Scene());
    const pose = { handle: 1, renderKey: 1, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, animState: 0, animP0: 0, animP1: 0, flags: 1, snapped: true };
    for (let i = 0; i < 3; i++) {
      pool.sync([pose], 1, () => 'prop/cone');
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(calls).toBe(1);
    expect(art.status().failed).toEqual(['prop/cone']);
    expect(pool.meshFor(1)).toBeDefined();
    pool.dispose();
    art.reset();
  });

  it('know the art refs and the beam fade', () => {
    expect(isArtKey('vehicle/traffic.sedan')).toBe(true);
    expect(isArtKey('vehicle/graybox.sedan')).toBe(false);
    expect(findArtNode(models.get('vehicle/traffic.sedan') as ArtModelData, 'steer_fl')).toBeDefined();
    expect(beamFade(0)).toBe(0);
    expect(beamFade(3)).toBe(0);
    expect(beamFade(12)).toBe(1);
    expect(beamFade(7.5)).toBeCloseTo(0.5, 5);
    expect(beamFade(50)).toBe(1);
  });
});

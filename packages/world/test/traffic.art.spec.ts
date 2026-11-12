/**
 * M10d1 AC-6: the instanced traffic's families per look profile, from a mock asset client. Families and meshes equal the ledger table
 * (`full` 4 x 2, `lite` 3 x 1, `min` 2 x 1, `legacy` 1 x 1), the paint is physical only on `full`, `aTint`, `aLights` and the livery bit
 * survive, instances stay within the tier's `CrowdLimits`, and a family draws a gray-box car until its model arrives.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Group, type InstancedMesh } from 'three/webgpu';
import type { ArtModelData } from '@dv/engine/client/vehicle/art-model';
import { artModel } from '../../../tests/support/art-models.ts';
import { ARCH, ARCHETYPES } from '../src/sim/traffic/components.ts';
import { createSkyNodes } from '../src/client/sky/nodes.ts';
import { TrafficRenderer } from '../src/client/traffic/instances.ts';
import { TRAFFIC_ART, familiesOf, familyOf, mergeModel, placeholderGeometry } from '../src/client/traffic/archetype-mesh.ts';
import { LIVERY_BIT, materialKindOf } from '../src/client/traffic/materials.ts';
import type { LookProfile } from '../src/client/look/config.ts';
import tierBudgets from '../../../config/tier-budgets.json';

type Frame = Parameters<TrafficRenderer['update']>[0];
type Pose = NonNullable<Frame['poses']>[number];

const KEYS = new Map<number, string>(ARCHETYPES.map((a) => [a.id + 1, a.asset] as const));
const camera = { pos: [0, 2, 0] as [number, number, number], dir: [0, 0, -1] as [number, number, number] };
const frame = (poses: Pose[]): Frame => ({ poses, poseCount: poses.length, poseKeys: KEYS, camera });
const pose = (handle: number, arch: number, x: number, z: number, animState = 0): Pose =>
  ({ handle, renderKey: arch + 1, px: x, py: 0, pz: z, qx: 0, qy: 0, qz: 0, qw: 1, animState, animP0: 0, animP1: 3, flags: 2, snapped: true });

const TABLE: Record<LookProfile, { families: number; meshes: number }> = {
  full: { families: 4, meshes: 2 },
  lite: { families: 3, meshes: 1 },
  min: { families: 2, meshes: 1 },
  legacy: { families: 1, meshes: 1 },
};

const models = new Map<string, ArtModelData>();
beforeAll(async () => {
  for (const [ref, f] of [['vehicle/traffic.sedan', 'mid'], ['vehicle/robotaxi.default', 'mid'], ['vehicle/traffic.pickup', 'mid'], ['vehicle/traffic.van', 'mid'], ['vehicle/traffic.sedan', 'lo']] as const) {
    models.set(`${ref}@${f}`, await artModel(ref, f));
  }
}, 120_000);

/** A mock asset client: resolves a ref and variant to the recipe's model after a tick. */
const loader = (calls: string[] = []) => async (ref: string, variant: string): Promise<ArtModelData | null> => {
  calls.push(`${ref}@${variant}`);
  await new Promise((r) => setTimeout(r, 0));
  const f = variant === 'mobile' ? 'mid' : variant === 'mobile-low' ? 'lo' : 'hi';
  return models.get(`${ref}@${f}`) ?? (await artModel(ref, f));
};

function make(profile: LookProfile, cap = 60, load?: ReturnType<typeof loader>): { r: TrafficRenderer; parent: Group } {
  const parent = new Group();
  return { r: new TrafficRenderer({ parent, sky: createSkyNodes(), cap, profile, ...(load ? { load } : {}) }), parent };
}

const meshes = (parent: Group): InstancedMesh[] => (parent.children[0]?.children ?? []) as InstancedMesh[];

describe('config/world/traffic-art.json', () => {
  it('validates against its schema and names every ambient archetype once per profile', () => {
    const schema = JSON.parse(readFileSync(new URL('../../../config/schemas/traffic-art.schema.json', import.meta.url), 'utf8')) as object;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(TRAFFIC_ART), JSON.stringify(validate.errors)).toBe(true);
    for (const profile of ['full', 'lite', 'min', 'legacy'] as const) {
      for (const a of ARCHETYPES) expect(familyOf(TRAFFIC_ART, profile, a.asset), `${profile} ${a.asset}`).toBeDefined();
      const hosted = Object.values(TRAFFIC_ART.profiles[profile].families).flat();
      expect(new Set(hosted).size).toBe(hosted.length);
    }
    expect(Object.keys(TRAFFIC_ART.members).sort()).toEqual(ARCHETYPES.map((a) => a.asset).sort());
  });

  it('draws the `mid` variant on full and the `lo` variant elsewhere', () => {
    expect(TRAFFIC_ART.profiles.full.variant).toBe('mobile');
    for (const p of ['lite', 'min', 'legacy'] as const) expect(TRAFFIC_ART.profiles[p].variant).toBe('mobile-low');
    expect(TRAFFIC_ART.profiles.full.splitGlass).toBe(true);
    expect(TRAFFIC_ART.profiles.lite.splitGlass).toBe(false);
  });
});

describe('TrafficRenderer families', () => {
  it('has the families and meshes of the ledger table in every profile', () => {
    for (const profile of ['full', 'lite', 'min', 'legacy'] as const) {
      const { r, parent } = make(profile);
      const want = TABLE[profile];
      expect(familiesOf(TRAFFIC_ART, profile)).toHaveLength(want.families);
      expect(meshes(parent), profile).toHaveLength(want.families * want.meshes);
      const info = r.info();
      expect(info.families).toBe(want.families);
      expect(info.objects).toBe(want.families * want.meshes);
      r.dispose();
    }
  });

  it('uses the physical material only on full', () => {
    for (const profile of ['full', 'lite', 'min', 'legacy'] as const) {
      const { r, parent } = make(profile);
      const kind = materialKindOf(profile);
      expect(r.materialKind).toBe(kind);
      expect(kind === 'physical').toBe(profile === 'full');
      for (const m of meshes(parent)) expect((m.material as { isMeshPhysicalNodeMaterial?: boolean }).isMeshPhysicalNodeMaterial === true).toBe(profile === 'full');
      r.dispose();
    }
  });

  it('sends each archetype to the family of its base and keeps instances within the tier cap', () => {
    const cap = (tierBudgets as unknown as { tiers: Record<string, { crowd: { maxTrafficInstances: number } }> }).tiers['mobile-low']?.crowd.maxTrafficInstances ?? 0;
    expect(cap).toBeGreaterThan(0);
    const { r } = make('min', cap);
    const poses = Array.from({ length: cap + 20 }, (_, i) => pose(i + 1, i % ARCHETYPES.length, (i % 40) * 3, -10 - Math.floor(i / 40) * 5));
    expect(r.update(frame(poses), 0)).toBe(cap);
    expect(r.instances).toBeLessThanOrEqual(cap);
    expect(r.info().dropped).toBe(20);
    expect(r.info().perArchetype.reduce((a, b) => a + b, 0)).toBe(cap);
    r.dispose();
  });

  it('keeps the tint, the light bits and the livery bit per instance', () => {
    const { r, parent } = make('full');
    const poses = [pose(1, ARCH.rideshare, 0, -10, 1), pose(2, ARCH.sedan, 4, -10, 4), pose(3, ARCH.cruiser, 8, -10, 0), pose(4, ARCH.robotaxi, 12, -10, 2)];
    r.update(frame(poses), 0);
    const fam = (name: string): InstancedMesh => meshes(parent).find((m) => m.name === `traffic.${name}`) as InstancedMesh;
    const car = fam('car');
    const lights = car.geometry.getAttribute('aLights').array as Float32Array;
    const tint = car.geometry.getAttribute('aTint').array as Float32Array;
    // rideshare (slot 0) and sedan (slot 1) share the car family; the cruiser is slot 2
    const at = (a: Float32Array, i: number): number => a[i] as number;
    expect(at(lights, 0) & 1).toBe(1);
    expect(at(lights, 0) & LIVERY_BIT).toBe(LIVERY_BIT); // a rideshare always carries its livery
    expect(at(lights, 1) & 4).toBe(4);
    expect(at(lights, 2) & LIVERY_BIT).toBe(LIVERY_BIT); // so does a cruiser
    // the cruiser's paint is fixed near black, the sedan's is the palette colour
    expect(at(tint, 2 * 3)).toBeLessThan(0.02);
    expect(at(tint, 3) + at(tint, 4) + at(tint, 5)).toBeGreaterThan(0.05);
    const taxi = fam('robotaxi');
    expect(((taxi.geometry.getAttribute('aLights').array as Float32Array)[0] as number) & 2).toBe(2);
    expect(taxi.count).toBe(1);
    expect(car.count).toBe(3);
    r.dispose();
  });

  it('draws a gray-box car until the family model arrives, then the model, and rewrites the matrices at its scale', async () => {
    const calls: string[] = [];
    const { r, parent } = make('lite', 60, loader(calls));
    r.update(frame([pose(1, ARCH.truck, 0, -10), pose(2, ARCH.compact, 5, -10)]), 0);
    const box = meshes(parent).find((m) => m.name === 'traffic.box') as InstancedMesh;
    const triBefore = (box.geometry.getIndex()?.count ?? 0) / 3;
    expect(r.info().loaded).toBe(0);
    const ph = placeholderGeometry();
    expect(triBefore).toBe(ph.triangles);
    const before = box.instanceMatrix.array.slice(0, 16);
    await new Promise((res) => setTimeout(res, 20));
    expect(r.info().loaded).toBe(3);
    r.update(frame([pose(1, ARCH.truck, 0, -10), pose(2, ARCH.compact, 5, -10)]), 0);
    expect((box.geometry.getIndex()?.count ?? 0) / 3).toBeGreaterThan(triBefore);
    // the truck is scaled to its own size over the van's bounds: longer than the placeholder scale, and the matrix was rewritten
    const m = box.instanceMatrix.array;
    expect(Array.from(m.slice(0, 16))).not.toEqual(Array.from(before));
    const len = Math.hypot(m[8] as number, m[9] as number, m[10] as number);
    expect(len).toBeGreaterThan(1.1);
    // every family asked once, at the variant of its profile
    expect(calls.sort()).toEqual(['vehicle/traffic.pickup@mobile-low', 'vehicle/traffic.sedan@mobile-low', 'vehicle/traffic.van@mobile-low']);
    r.dispose();
  });

  it('splits the glass pass off the merged geometry only on full', async () => {
    const sedan = models.get('vehicle/traffic.sedan@mid') as ArtModelData;
    const full = mergeModel(sedan, true);
    expect(full.glass).not.toBeNull();
    expect(full.opaque.getAttribute('aPart')).toBeDefined();
    const flat = mergeModel(sedan, false);
    expect(flat.glass).toBeNull();
    expect((flat.opaque.getIndex()?.count ?? 0)).toBeGreaterThan(full.opaque.getIndex()?.count ?? 0);
    // the paint takes a white vertex colour so that the instance tint is the colour
    const col = full.opaque.getAttribute('color');
    const part = full.opaque.getAttribute('aPart');
    for (let i = 0; i < part.count; i++) if (part.getX(i) === 0) expect([col.getX(i), col.getY(i), col.getZ(i)]).toEqual([1, 1, 1]);
    // the size is the model's bounds
    expect(full.size[2]).toBeGreaterThan(4.5);
    expect(full.size[0]).toBeGreaterThan(1.7);
  });
});

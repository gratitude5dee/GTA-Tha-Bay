/** M10d1: the LOD helpers (meshopt simplification, material grouping per fidelity). */
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyAt, materialAt, regroup, simplifierReady, simplifyMesh, trianglesOf } from '../src/lod.ts';
import { ART_ASSETS, buildModel } from '../src/recipes/catalog.ts';
import { addEllipsoid, lin, Mesh, MeshSet } from '../src/recipes/mesh.ts';
import { modelStats } from '../src/recipes/model.ts';

beforeAll(async () => {
  await simplifierReady();
});

function sphere(): Mesh {
  const m = new Mesh('paint');
  addEllipsoid(m, [0, 0, 0], [1, 1, 1], 40, lin(0x808080), 0);
  return m;
}

describe('lod', () => {
  it('simplifies a primitive to about the target and keeps its attributes', () => {
    const m = sphere();
    const s = simplifyMesh(m, 200);
    expect(m.triangleCount).toBeGreaterThan(1000);
    expect(s.triangleCount).toBeLessThanOrEqual(260);
    expect(s.triangleCount).toBeGreaterThan(40);
    expect(s.pos.length / 3).toBe(s.nor.length / 3);
    expect(s.col.length).toBe(s.pos.length);
    expect(s.part.length).toBe(s.pos.length / 3);
  });

  it('is deterministic and leaves a small primitive alone', () => {
    const a = simplifyMesh(sphere(), 200);
    const b = simplifyMesh(sphere(), 200);
    expect(a.idx).toEqual(b.idx);
    expect(a.pos).toEqual(b.pos);
    const small = new Mesh('paint');
    small.vertex([0, 0, 0], [0, 0, 1], [1, 1, 1], 0);
    small.vertex([1, 0, 0], [0, 0, 1], [1, 1, 1], 0);
    small.vertex([0, 1, 0], [0, 0, 1], [1, 1, 1], 0);
    small.tri(0, 1, 2);
    expect(simplifyMesh(small, 1)).toBe(small);
  });

  it('merges every primitive into one at lo before simplifying', () => {
    const set = new MeshSet();
    set.get('paint').append(sphere());
    set.get('glass').append(sphere().moved([3, 0, 0]));
    const lo = bodyAt(set, 'lo', { mid: 800, lo: 300 });
    expect(lo.list()).toHaveLength(1);
    expect(trianglesOf(lo)).toBeLessThanOrEqual(400);
    expect(bodyAt(set, 'hi', { mid: 800, lo: 300 })).toBe(set);
  });

  it('groups materials per fidelity and profile', () => {
    expect(materialAt('lamp', 'hi')).toBe('lamp');
    expect(materialAt('lamp', 'mid')).toBe('detail');
    expect(materialAt('glass', 'mid')).toBe('glass');
    expect(materialAt('glass', 'lo')).toBe('all');
    expect(materialAt('collider', 'lo')).toBe('collider');
    expect(materialAt('detail', 'hi', 'backdrop')).toBe('paint');
    expect(materialAt('glass', 'mid', 'backdrop')).toBe('glass');
    expect(materialAt('lamp', 'hi', 'street')).toBe('lamp');
    expect(materialAt('lamp', 'mid', 'street')).toBe('detail');
  });

  it('gives a vehicle 4, 3 and 1 materials at hi, mid and lo', () => {
    const def = ART_ASSETS.find((a) => a.id === 'traffic.sedan') as (typeof ART_ASSETS)[number];
    expect(modelStats(buildModel(def, 'hi')).materials).toBe(4);
    expect(modelStats(buildModel(def, 'mid')).materials).toBe(3);
    expect(modelStats(buildModel(def, 'lo')).materials).toBe(1);
    expect(modelStats(regroup(buildModel(def, 'hi'), 'lo')).materials).toBe(1);
  });
});

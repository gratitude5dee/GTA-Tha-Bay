import { describe, expect, it } from 'vitest';
import { TreeForm } from '@dv/shared';
import { SET_GEOMETRIES, TREE_TRIS_CAP, buildTreeSet, geometryOfForm, instanceScaleOf, tintOf, type TreeSet } from '../src/client/chunks/tree-forms.ts';

/**
 * M02h4 AC-3 (forms): the geometries of each set are byte-identical across builds and within their caps (260 `full`, 120 `lite`, 48 `low`),
 * `low` has two geometries, only `full` carries `sway`, and every geometry is opaque data (positions, normals, colours, the crown mask).
 */
const SETS: readonly TreeSet[] = ['full', 'lite', 'low', 'cone'];
const bytesOf = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

describe('tree forms (AC-3)', () => {
  it.each(SETS)('%s: the geometries are byte-identical across builds and within the cap', (set) => {
    const a = buildTreeSet(set);
    const b = buildTreeSet(set);
    expect(a.map((g) => g.id)).toEqual(SET_GEOMETRIES[set]);
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!, y = b[i]!;
      for (const k of ['positions', 'normals', 'colors', 'leaf', 'indices'] as const) expect(Buffer.compare(bytesOf(x[k]), bytesOf(y[k])), `${set}/${x.id} ${k}`).toBe(0);
      if (x.sway && y.sway) expect(Buffer.compare(bytesOf(x.sway), bytesOf(y.sway))).toBe(0);
      expect(x.triangles, `${set}/${x.id} triangles`).toBeLessThanOrEqual(TREE_TRIS_CAP[set]);
      expect(x.triangles).toBe(x.indices.length / 3);
      const n = x.positions.length / 3;
      expect(x.normals.length).toBe(n * 3);
      expect(x.colors.length).toBe(n * 3);
      expect(x.leaf.length).toBe(n);
      for (const i of x.indices) expect(i).toBeLessThan(n);
      for (const v of x.positions) expect(Number.isFinite(v)).toBe(true);
      for (let j = 0; j < n; j++) expect(Math.hypot(x.normals[j * 3]!, x.normals[j * 3 + 1]!, x.normals[j * 3 + 2]!)).toBeCloseTo(1, 4);
      // a crown and a trunk in every form
      expect([...x.leaf].some((v) => v === 1), `${set}/${x.id} has a crown`).toBe(true);
      expect([...x.leaf].some((v) => v === 0), `${set}/${x.id} has a trunk`).toBe(true);
      console.log(`tree form ${set}/${x.id}: ${x.triangles} triangles, ${n} vertices`);
    }
  });

  it('low has two geometries (crown and palm); only full carries sway, from 0 at the root to 1 at the top', () => {
    expect(buildTreeSet('low').map((g) => g.id)).toEqual(['crown', 'palm']);
    for (const set of SETS) {
      for (const g of buildTreeSet(set)) {
        if (set !== 'full') {
          expect(g.sway, `${set}/${g.id} sway`).toBeNull();
          continue;
        }
        const sway = g.sway as Float32Array;
        expect(sway.length).toBe(g.positions.length / 3);
        expect(Math.min(...sway)).toBe(0);
        expect(Math.max(...sway)).toBeGreaterThan(0.9);
        for (const w of sway) expect(w >= 0 && w <= 1).toBe(true);
      }
    }
  });

  it('a unit-tall geometry stands on the origin: the lowest vertex at 0, the top near 1, the crown wider than the trunk', () => {
    for (const set of ['full', 'lite', 'low'] as const) {
      for (const g of buildTreeSet(set)) {
        let minY = Infinity, maxY = -Infinity, maxR = 0;
        for (let i = 0; i < g.positions.length; i += 3) {
          minY = Math.min(minY, g.positions[i + 1]!);
          maxY = Math.max(maxY, g.positions[i + 1]!);
          maxR = Math.max(maxR, Math.hypot(g.positions[i]!, g.positions[i + 2]!));
        }
        expect(minY, `${set}/${g.id} foot`).toBeCloseTo(0, 6);
        expect(maxY, `${set}/${g.id} top`).toBeGreaterThan(0.8);
        expect(maxY, `${set}/${g.id} top`).toBeLessThanOrEqual(1.1);
        expect(maxR, `${set}/${g.id} crown`).toBeGreaterThan(0.1);
      }
    }
  });

  it('each form maps to a geometry of the set; the low crown tells its four forms apart by scale and tint', () => {
    for (const f of [TreeForm.Plane, TreeForm.Ficus, TreeForm.Conifer, TreeForm.Eucalyptus, TreeForm.Palm]) {
      expect(SET_GEOMETRIES.full).toContain(geometryOfForm('full', f));
      expect(SET_GEOMETRIES.lite).toContain(geometryOfForm('lite', f));
      expect(geometryOfForm('low', f)).toBe(f === TreeForm.Palm ? 'palm' : 'crown');
      expect(geometryOfForm('cone', f)).toBe('cone');
    }
    const keys = new Set<string>();
    for (const f of [TreeForm.Plane, TreeForm.Ficus, TreeForm.Conifer, TreeForm.Eucalyptus]) {
      keys.add(`${instanceScaleOf('low', f, 10).join(',')}|${tintOf('low', f, 0).map((v) => v.toFixed(3)).join(',')}`);
    }
    expect(keys.size).toBe(4);
    expect(instanceScaleOf('full', TreeForm.Plane, 12)).toEqual([12, 12]);
    // the cone is 6.2 m tall at scale 1
    expect(instanceScaleOf('cone', TreeForm.Plane, 6.2)[1]).toBeCloseTo(1, 9);
  });
});

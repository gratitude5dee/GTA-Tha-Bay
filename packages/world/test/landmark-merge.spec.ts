/**
 * M02d2: a landmark's primitives are one draw object at runtime (the render-object budget pays one object per landmark).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readLandmarkGlb, type LandmarkPrimitive } from '../src/client/chunks/landmark-glb.ts';
import { mergePrimitives } from '../src/client/chunks/landmark-merge.ts';

const root = new URL('../../../assets/src/building/', import.meta.url);
const ids = readdirSync(root).filter((n) => n.startsWith('lm.')).sort();

const prim = (positions: number[], indices: number[], offset = 0): LandmarkPrimitive => ({
  material: 'matte', roughness: 0.9, metallic: 0,
  positions: Float32Array.from(positions), normals: Float32Array.from(positions.map(() => 1)), colors: Float32Array.from(positions.map(() => 0.5)),
  indices: Uint16Array.from(indices),
  bounds: [Math.min(...positions.filter((_, i) => i % 3 === 0)) + offset, 0, 0, Math.max(...positions.filter((_, i) => i % 3 === 0)) + offset, 1, 1],
});

describe('mergePrimitives', () => {
  it('concatenates the attributes and shifts the indices by the vertices before them', () => {
    const a = prim([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    const b = prim([5, 0, 0, 6, 0, 0, 5, 1, 0], [0, 2, 1]);
    const m = mergePrimitives([a, b]);
    expect(m.vertices).toBe(6);
    expect(m.triangles).toBe(2);
    expect([...m.indices]).toEqual([0, 1, 2, 3, 5, 4]);
    expect([...m.positions.slice(9, 12)]).toEqual([5, 0, 0]);
    expect(m.bounds).toEqual([0, 0, 0, 6, 1, 1]);
    expect(m.indices).toBeInstanceOf(Uint16Array);
  });

  it('switches to 32-bit indices past 65,535 vertices and handles an empty model', () => {
    const n = 40000;
    const big = (): LandmarkPrimitive => prim(Array.from({ length: n * 3 }, (_, i) => i % 7), [0, 1, 2]);
    expect(mergePrimitives([big(), big()]).indices).toBeInstanceOf(Uint32Array);
    const e = mergePrimitives([]);
    expect(e.vertices).toBe(0);
    expect(e.bounds).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it.each(ids)('%s: every fidelity merges into one mesh with the triangles and vertices the asset records', async (id) => {
    const spec = JSON.parse(readFileSync(new URL(`${id}/asset.json`, root), 'utf8')) as { stats: Record<string, { tris: number; verts: number }> };
    for (const variant of ['desktop', 'mobile', 'mobile-low']) {
      const model = await readLandmarkGlb(new Uint8Array(readFileSync(new URL(`${id}/${variant}.glb`, root))));
      const m = mergePrimitives(model.primitives);
      const stats = spec.stats[variant]!;
      expect(m.triangles, `${id} ${variant}`).toBe(stats.tris);
      expect(m.vertices, `${id} ${variant}`).toBe(stats.verts);
      let max = 0;
      for (const k of m.indices) max = Math.max(max, k);
      expect(max, `${id} ${variant}: no index past the vertices`).toBeLessThan(m.vertices);
      expect(m.bounds).toEqual(model.bounds);
    }
  });
});

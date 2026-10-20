/** M02d1: the landmark recipe kit: primitive triangle counts, fidelity derivation, the deterministic glTF writer. */
import { describe, expect, it } from 'vitest';
import type { Document } from '@gltf-transform/core';
import { rulesOf, FIDELITIES, variantOf } from '../src/landmarks/kit/fidelity.ts';
import { ioFor, writeGlb, GLB_GENERATOR } from '../src/landmarks/kit/gltf-writer.ts';
import { MATERIALS, hexToLinear } from '../src/landmarks/kit/palette.ts';
import { box, circleRing, dome, frustum, Geo, prism, strut, taperTower, tube, type V3 } from '../src/landmarks/kit/primitives.ts';
import { catenary, slab } from '../src/landmarks/kit/spans.ts';

const geo = (f: 'hi' | 'mid' | 'lo' = 'hi'): Geo => new Geo(rulesOf(f));

describe('primitives (triangle counts)', () => {
  it('a box has 10 triangles without its bottom and 12 with it', () => {
    const g = geo();
    box(g, 0, 0, 0, 2, 3, 4, { color: 'concrete' });
    expect(g.triangles()).toBe(10);
    const h = geo();
    box(h, 0, 0, 0, 2, 3, 4, { color: 'concrete', bottom: true });
    expect(h.triangles()).toBe(12);
  });

  it('an n-gon prism has 2n wall triangles and n - 2 on its top', () => {
    const g = geo();
    prism(g, circleRing(0, 0, 5, 5, 10), 0, 3, { color: 'concrete' });
    expect(g.triangles()).toBe(20 + 8);
  });

  it('a frustum with s segments has 2s wall triangles and one cap, flat or smooth', () => {
    for (const smooth of [false, true]) {
      const g = geo();
      frustum(g, 0, 0, 0, 3, 2, 5, 12, { color: 'concrete', smooth });
      expect(g.triangles()).toBe(24 + 10);
    }
  });

  it('a pyramid (a tapered tower closing to a point) draws one triangle per wall and no cap', () => {
    const g = geo();
    taperTower(g, 0, 0, 0, 10, 10, 0, 0, 20, { color: 'concrete' });
    expect(g.triangles()).toBe(4);
  });

  it('a dome closes to an apex: rings x segments quads and one fan', () => {
    const g = geo();
    dome(g, 0, 0, 0, 10, 10, 8, 16, 6, { color: 'copperGreen' });
    expect(g.triangles()).toBe(16 * 2 * 5 + 16);
  });

  it('a strut of 4 sides has 8 wall triangles and 2 end caps of 2', () => {
    const g = geo();
    strut(g, [0, 0, 0], [10, 0, 0], 0.3, { color: 'steelGrey', cls: 'metal' });
    expect(g.triangles()).toBe(8 + 4);
  });

  it('every wall of a box faces away from its centre (counter-clockwise from outside)', () => {
    const g = geo();
    box(g, 4, 1, -3, 6, 5, 2, { color: 'concrete', bottom: true, yaw: 0.7 });
    const [c] = g.classes();
    const centre: V3 = [4, 3.5, -3];
    for (let i = 0; i < (c?.idx.length ?? 0); i += 3) {
      const p = [0, 1, 2].map((k) => {
        const v = (c?.idx[i + k] as number) * 3;
        return [c?.pos[v] as number, c?.pos[v + 1] as number, c?.pos[v + 2] as number] as V3;
      }) as [V3, V3, V3];
      const u: V3 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], w: V3 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const mid: V3 = [(p[0][0] + p[1][0] + p[2][0]) / 3 - centre[0], (p[0][1] + p[1][1] + p[2][1]) / 3 - centre[1], (p[0][2] + p[1][2] + p[2][2]) / 3 - centre[2]];
      expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2], `triangle ${i / 3}`).toBeGreaterThan(0);
    }
  });

  it('the yaw turns everything added after it and nothing before', () => {
    const g = geo();
    g.setYaw(Math.PI / 2);
    g.vert('matte', [1, 2, 0], [1, 0, 0], [1, 1, 1]);
    const a = g.classes();
    expect(a).toHaveLength(0); // no triangle yet: classes() lists only buffers with indices
    g.tri('matte', 0, 0, 0);
    const [c] = g.classes();
    // +X turned a quarter turn toward +Z with the kit's rotY convention: (1, 0) -> (cos, -sin) = (0, -1)
    expect([...(c?.pos ?? [])].map((x) => Math.round(x * 1000) / 1000)).toEqual([0, 2, -1]);
  });

  it('a cable has the requested number of segments and a slab follows its path', () => {
    const pts = catenary([0, 50, 0], [100, 50, 0], 10, 20);
    expect(pts).toHaveLength(21);
    expect(pts[10]?.[1]).toBeCloseTo(40, 6);
    const g = geo();
    slab(g, pts, 5, 1, { color: 'darkSteel' });
    expect(g.triangles()).toBe(20 * 8 + 4);
    const t = geo();
    tube(t, pts, 0.3, 3, { color: 'bridgeRed', cls: 'metal' });
    expect(t.triangles()).toBe(20 * 6 + 2);
  });
});

describe('fidelity rules', () => {
  it('derive falling counts from one parameter: segments and repeated elements thin from hi to lo', () => {
    const r = FIDELITIES.map(rulesOf);
    const segs = r.map((x) => x.segs(24));
    expect(segs[0]).toBe(24);
    expect(segs[1]).toBeLessThan(24);
    expect(segs[2]).toBeLessThan(segs[1] as number);
    const counts = r.map((x) => x.count(40));
    expect(counts).toEqual([40, 20, 10]);
    expect(r.map((x) => x.count(3, 2))).toEqual([3, 2, 2]);
    expect(r.map((x) => x.segs(4))).toEqual([4, 3, 3]);
    expect(r.map((x) => x.detail)).toEqual([2, 1, 0]);
  });

  it('the lo class set has no glass: glass parts land in the matte object, so lo has at most two objects', () => {
    const g = geo('lo');
    box(g, 0, 0, 0, 1, 1, 1, { color: 'glassBlue', cls: 'glass' });
    box(g, 3, 0, 0, 1, 1, 1, { color: 'concrete' });
    box(g, 6, 0, 0, 1, 1, 1, { color: 'steelGrey', cls: 'metal' });
    expect(g.classes().map((c) => c.cls)).toEqual(['matte', 'metal']);
    const h = geo('hi');
    box(h, 0, 0, 0, 1, 1, 1, { color: 'glassBlue', cls: 'glass' });
    box(h, 3, 0, 0, 1, 1, 1, { color: 'concrete' });
    box(h, 6, 0, 0, 1, 1, 1, { color: 'steelGrey', cls: 'metal' });
    expect(h.classes().map((c) => c.cls)).toEqual(['matte', 'metal', 'glass']);
  });

  it('variants: hi is desktop, mid is mobile, lo is mobile-low', () => {
    expect(FIDELITIES.map(variantOf)).toEqual(['desktop', 'mobile', 'mobile-low']);
  });

  it('colours are linear: sRGB mid grey 0.5 is about 0.214', () => {
    expect(hexToLinear('#808080')[0]).toBeCloseTo(0.2158, 3);
  });
});

describe('the glTF writer', () => {
  const sample = (): Geo => {
    const g = geo();
    box(g, 0, 0, 0, 4, 6, 4, { color: 'sandstone' });
    box(g, 0, 6, 0, 3, 2, 3, { color: 'glassBlue', cls: 'glass' });
    strut(g, [0, 8, 0], [0, 20, 0], 0.3, { color: 'bridgeRed', cls: 'metal' });
    return g;
  };

  it('is a pure function of the geometry: two writes give the same bytes', async () => {
    const a = await writeGlb(sample(), { id: 'lm.test', extras: { id: 'lm.test' } });
    const b = await writeGlb(sample(), { id: 'lm.test', extras: { id: 'lm.test' } });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it('records the stats the file holds and reads back as the same triangles, with one primitive per class', async () => {
    const built = await writeGlb(sample(), { id: 'lm.test', extras: { id: 'lm.test', anchor: 'ground' } });
    expect(built.stats.primitives).toBe(3);
    expect(built.stats.materials).toBe(3);
    const doc: Document = await ioFor().readBinary(built.bytes);
    const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    expect(prims).toHaveLength(3);
    const tris = prims.reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
    expect(tris).toBe(built.stats.tris);
    // the generator string is pinned in the written JSON chunk (reading a file back replaces it with the library's own)
    const jsonLen = new DataView(built.bytes.buffer, built.bytes.byteOffset).getUint32(12, true);
    const json = JSON.parse(Buffer.from(built.bytes.subarray(20, 20 + jsonLen)).toString('utf8')) as { asset: { generator: string; version: string } };
    expect(json.asset).toEqual({ generator: GLB_GENERATOR, version: '2.0' });
    const materials = doc.getRoot().listMaterials().map((m) => [m.getName(), m.getRoughnessFactor(), m.getMetallicFactor()]);
    expect(materials).toEqual(expect.arrayContaining([['matte', MATERIALS.matte.roughness, 0], ['metal', MATERIALS.metal.roughness, MATERIALS.metal.metallic]]));
    expect(doc.getRoot().listScenes()[0]?.getExtras()).toEqual({ dvLandmark: { id: 'lm.test', anchor: 'ground' } });
  });

  it('carries no texture, no image and no node transform', async () => {
    const built = await writeGlb(sample(), { id: 'lm.test', extras: {} });
    const doc = await ioFor().readBinary(built.bytes);
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    for (const n of doc.getRoot().listNodes()) {
      expect(n.getTranslation()).toEqual([0, 0, 0]);
      expect(n.getScale()).toEqual([1, 1, 1]);
    }
  });
});

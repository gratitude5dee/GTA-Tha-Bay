import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TreeForm, decodeL0, decodeP0, treeFormOfByte, triangularQuantile, type QualityTierId, type RenderChunk, type SimChunk } from '@dv/shared';
import { MESHER, TREE_STRIDE, TREE_TINTS, formHeights, meshChunk, objectCountOf, treeHeightCap, treeHeightOf } from '../src/client/chunks/mesher.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

/**
 * M02h4 AC-3 (mesher): the tree records grow to six floats `(x, y, z, heightM, yawRad, form + 8 x tint)`; the height is the form's triangular
 * quantile of `u = (scale - 0.75) / 0.5` (with its 1/17 jitter), `min` at `u = 0`, `max` at `u = 1`, the mode at `(mode - min) / (max - min)`,
 * under M02g2's eave cap; mesher output is byte-identical across runs; the trees are not counted per unit (`objectCountOf`).
 */
const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low'];
const FORMS = [TreeForm.Plane, TreeForm.Ficus, TreeForm.Conifer, TreeForm.Eucalyptus, TreeForm.Palm];

interface Sample { sim: SimChunk; render: RenderChunk }
function samples(): Sample[] {
  const bake = requireBake('synth', 'trees.mesher synth bake');
  if (!bake) return [];
  const dir = `${bake.dir}/packs`;
  const names = readdirSync(dir).filter((n) => /^p0-\d+-\d+\.pack$/.test(n)).sort();
  const out: Sample[] = [];
  for (const n of names.filter((x) => x === 'p0-64-64.pack' || x === 'p0-65-64.pack')) {
    const sims = decodeP0(new Uint8Array(readFileSync(`${dir}/${n}`)));
    const renders = decodeL0(new Uint8Array(readFileSync(`${dir}/${n.replace('p0-', 'l0-')}`)), sims);
    for (const sim of sims) {
      const render = renders.find((r) => r.key === sim.key);
      if (render && render.trees.length > 0) out.push({ sim, render });
    }
  }
  return out;
}
const SAMPLES = samples();

describe('tree heights (AC-3)', () => {
  it('each form: min at u = 0, max at u = 1, the mode at (mode - min) / (max - min); monotone in between', () => {
    for (const f of FORMS) {
      const [min, mode, max] = formHeights(f);
      expect(triangularQuantile(0, min, mode, max)).toBeCloseTo(min, 9);
      expect(triangularQuantile(1, min, mode, max)).toBeCloseTo(max, 9);
      expect(triangularQuantile((mode - min) / (max - min), min, mode, max)).toBeCloseTo(mode, 6);
      let prev = -Infinity;
      for (let k = 0; k <= 100; k++) {
        const h = triangularQuantile(k / 100, min, mode, max);
        expect(h).toBeGreaterThanOrEqual(prev);
        expect(h >= min - 1e-9 && h <= max + 1e-9).toBe(true);
        prev = h;
      }
      // the baked scale (0.75 .. 1.25) with the jitter stays inside [min, max]; the ends reach them
      expect(treeHeightOf(f, 0.75, 0.5)).toBeCloseTo(min, 9);
      expect(treeHeightOf(f, 1.25, 0.5)).toBeCloseTo(max, 9);
      for (let s = 0; s <= 16; s++) for (const j of [0, 0.25, 0.5, 0.75, 0.999]) {
        const h = treeHeightOf(f, 0.75 + s / 32, j);
        expect(h >= min && h <= max, `${f} s ${s} j ${j}: ${h}`).toBe(true);
      }
    }
    // the milestone's design values
    expect(formHeights(TreeForm.Plane)).toEqual([6, 10, 16]);
    expect(formHeights(TreeForm.Ficus)).toEqual([4, 6, 9]);
    expect(formHeights(TreeForm.Conifer)).toEqual([6, 12, 20]);
    expect(formHeights(TreeForm.Eucalyptus)).toEqual([10, 18, 30]);
    expect(formHeights(TreeForm.Palm)).toEqual([6, 10, 16]);
  });

  it('the eave cap: min(max, eave - 0.5) within 8 m, never under 3.5 m', () => {
    const house = [{ ring: [0, 0, 10, 0, 10, 8, 0, 8], height: 6 }];
    expect(treeHeightCap(14, 4, house, 16)).toBeCloseTo(6 - MESHER.tree.eaveClearM, 9);
    expect(treeHeightCap(30, 4, house, 16)).toBe(16);
    expect(treeHeightCap(5, 4, [{ ring: [0, 0, 10, 0, 10, 8, 0, 8], height: 3 }], 30)).toBe(MESHER.tree.minHeightM);
    expect(treeHeightCap(14, 4, [{ ring: [0, 0, 10, 0, 10, 8, 0, 8], height: 40 }], 9)).toBe(9);
  });
});

describe('tree records (AC-3)', () => {
  it.each(TIERS)('%s: six floats per tree, the form and tint lanes, heights within the form and the cap, byte-identical across runs', (tier) => {
    let trees = 0;
    const seen = new Set<number>();
    for (const s of SAMPLES) {
      const a = meshChunk(s.sim, s.render, { tier, distM: 0 });
      const b = meshChunk(s.sim, s.render, { tier, distM: 0 });
      expect(Buffer.compare(Buffer.from(a.trees.buffer), Buffer.from(b.trees.buffer)), `${s.sim.key}: byte-identical`).toBe(0);
      const n = Math.floor(s.render.trees.length / 4);
      expect(a.trees.length).toBe(n * TREE_STRIDE);
      // the trees are drawn by the global pools: no per-unit render object
      expect(objectCountOf(a)).toBe(a.objects.length);
      for (let i = 0; i < n; i++) {
        trees++;
        const o = i * TREE_STRIDE;
        const lane = a.trees[o + 5] as number;
        const form = lane % 8;
        const tint = Math.floor(lane / 8);
        expect(form).toBe(treeFormOfByte(s.render.trees[i * 4 + 3] as number));
        expect(tint >= 0 && tint < TREE_TINTS).toBe(true);
        seen.add(form);
        const h = a.trees[o + 3] as number;
        const [min, , max] = formHeights(form as TreeForm);
        expect(h, `${s.sim.key} tree ${i}`).toBeGreaterThanOrEqual(Math.min(min, MESHER.tree.minHeightM) - 1e-4);
        expect(h, `${s.sim.key} tree ${i}`).toBeLessThanOrEqual(max + 1e-4);
        expect(h).toBeGreaterThanOrEqual(MESHER.tree.minHeightM - 1e-4);
        const yaw = a.trees[o + 4] as number;
        expect(yaw >= 0 && yaw < Math.PI * 2 + 1e-6).toBe(true);
      }
    }
    if (process.env['DV_REQUIRE_BAKE'] === '1' || SAMPLES.length > 0) {
      expect(trees).toBeGreaterThan(0);
      console.log(`trees.mesher ${tier}: ${trees} trees, forms ${[...seen].sort().join(',')}`);
    }
  });

  // M02h5 (BD-M02h5-03): 5 and 6 are Shrub and Hedge, bit 7 the scatter flag; a reserved low value (7..127) still draws as Plane
  it('a reserved byte draws as Plane; 5 and 6 are the understory, bit 7 is ignored by the form', () => {
    for (const b of [7, 8, 127, 255, 135]) expect(treeFormOfByte(b)).toBe(TreeForm.Plane);
    for (const f of FORMS) expect(treeFormOfByte(f)).toBe(f);
    for (const f of FORMS) expect(treeFormOfByte(f | 0x80)).toBe(f);
    expect(treeFormOfByte(5)).toBe(TreeForm.Shrub);
    expect(treeFormOfByte(6 | 0x80)).toBe(TreeForm.Hedge);
  });
});

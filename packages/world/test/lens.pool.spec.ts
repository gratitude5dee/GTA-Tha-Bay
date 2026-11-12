import { describe, expect, it } from 'vitest';
import { Group, MeshStandardNodeMaterial } from 'three/webgpu';
import { TreeForm } from '@dv/shared';
import { TREE_STRIDE } from '../src/client/chunks/mesher.ts';
import { BAND_IMPOSTOR, BAND_MESH, HoleLayout, VegetationPools, type ScatterPoolOptions } from '../src/client/chunks/vegetation-pool.ts';
import type { LensRule, LensShot } from '../src/client/chunks/lens-clear.ts';
import type { TreeSet } from '../src/client/chunks/tree-forms.ts';

/**
 * BD-FIX-LENS-CLEAR-01, the pools (`chunks/vegetation-pool.ts`): a tree the lens-clear rule hides is written with zero scale, stays hidden
 * through every rewrite of its range (a re-banding, a `tree.drawM` crossing, a capacity doubling, a move between the `near` and the `far`
 * pools, `setLook`) and comes back when the set is cleared; its neighbours in the same unit keep their data byte for byte.
 */
const RULE: LensRule = { maxFrameShare: 0.1, corridorM: 0.5, redecideM: 2 };
const SCATTER: ScatterPoolOptions = { enabled: true, impostors: true, keepTree: 1, keepShrub: 1, impostorM: 50, shrubDrawM: 80, hysteresis: 0.1, rebandM: 16, writeCap: 64 };
const ID = 'l0:9/0/0';

/** [x, z, height, form, scatter]: local metres in the unit at the origin, all on ground 2 m up. */
type Rec = [number, number, number, TreeForm, boolean?];
const A = 0, B = 1, SHRUB = 4;
const UNIT: Rec[] = [
  [100, 100, 9, TreeForm.Plane], // A: the tree at the kerb mark, 4.5 m in front of the lens
  [116, 100, 8, TreeForm.Ficus], // B: its neighbour, out of the frame's share
  [160, 100, 9, TreeForm.Plane], // 60 m down the street
  [100, 180, 10, TreeForm.Conifer],
  [101, 103, 1.2, TreeForm.Shrub, true], // a shrub at the lens's feet: never hidden
  [40, 40, 12, TreeForm.Eucalyptus],
  [96, 60, 7, TreeForm.Palm],
];
function trees(recs: readonly Rec[]): Float32Array {
  const t = new Float32Array(recs.length * TREE_STRIDE);
  recs.forEach(([x, z, h, form, scatter], i) => {
    t.set([x, 2, z, h, 0.3 * i, form + 8 * (i % 8) + (scatter ? 64 : 0)], i * TREE_STRIDE);
  });
  return t;
}
/** A street of plane trees (a filler unit that makes a pool grow). */
const filler = (n: number): Float32Array => trees(Array.from({ length: n }, (_, i): Rec => [(i * 37) % 256, (i * 91) % 256, 8, TreeForm.Plane]));

/** The dawn shot's lens beside tree A: 3 m above the kerb, a wide lens looking down the street past A. */
const SHOT: LensShot = { key: 'fixed|7|1|480|75', pos: [100, 5, 104.5], lookAt: [100, 3.6, 80], fovDeg: 75, aspect: 16 / 9 };

const mat = new MeshStandardNodeMaterial();
const impMat = new MeshStandardNodeMaterial();
const make = (set: TreeSet, scatter: ScatterPoolOptions | undefined, lens: LensRule | undefined = RULE): VegetationPools =>
  new VegetationPools({ parent: new Group(), set, material: () => mat, receiveShadow: () => false, scatter, impostorMaterial: () => impMat, lens });

const frame = (pools: VegetationPools, camX: number, camZ: number, shot: LensShot | null): void => {
  pools.startFrame();
  pools.setLens(shot);
  pools.update(camX, camZ);
};
const drain = (pools: VegetationPools, camX: number, camZ: number, shot: LensShot | null): void => {
  frame(pools, camX, camZ, shot);
  for (let i = 0; i < 400 && pools.pendingBands > 0; i++) frame(pools, camX, camZ, shot);
  expect(pools.pendingBands).toBe(0);
};

/**
 * Every pool, every written range: a hidden instance is sixteen zeros (and a zero tint), every other instance is its unit's source byte
 * for byte. Returns how many hidden slots it met, and how many live instances.
 */
function check(pools: VegetationPools, label: string): { zeroed: number; live: number } {
  let zeroed = 0, live = 0;
  for (const p of pools.pools) {
    for (const [id, r] of p.layout.ranges) {
      // a hidden range of the hole layout is zero as a whole (M02h5); every other range holds its unit's data
      if (!r.drawn && p.layout instanceof HoleLayout) continue;
      const s = p.src.get(id);
      expect(s, `${label}: ${p.key} ${id} has a source`).toBeDefined();
      const hid = new Set(pools.hiddenOf(id));
      for (let j = 0; j < r.len; j++) {
        const at = r.start + j;
        const m = Array.from(p.matrices.subarray(at * 16, at * 16 + 16)), t = Array.from(p.tints.subarray(at * 4, at * 4 + 4));
        if (hid.has(s!.ks[j] as number)) {
          expect(m, `${label}: ${p.key} ${id} instance ${j} is zero scale`).toEqual(new Array(16).fill(0));
          expect(t).toEqual([0, 0, 0, 0]);
          zeroed++;
        } else {
          expect(m, `${label}: ${p.key} ${id} instance ${j} keeps its data`).toEqual(Array.from(s!.m.subarray(j * 16, j * 16 + 16)));
          expect(t).toEqual(Array.from(s!.t.subarray(j * 4, j * 4 + 4)));
          live++;
        }
      }
    }
  }
  return { zeroed, live };
}

describe('lens clear: the vegetation pools (BD-FIX-LENS-CLEAR-01)', () => {
  it('a hidden tree is written with zero scale at once, its neighbours keep their data, and it comes back when the shot ends', () => {
    const pools = make('low', SCATTER);
    frame(pools, 100, 104.5, null);
    pools.addUnit(ID, trees(UNIT), 0, 0, true, false);
    expect(pools.lensReport()).toEqual({ active: false, hidden: 0, decisions: 0 });
    const before = pools.pools.map((p) => ({ m: p.matrices.slice(), t: p.tints.slice() }));
    expect(check(pools, 'before')).toEqual({ zeroed: 0, live: UNIT.length });

    // the cut: the set is in the buffers when `setLens` returns, outside the re-banding's cap, counted in the pool's write counters
    pools.startFrame();
    const writes0 = pools.totalWrites;
    pools.setLens(SHOT);
    expect(pools.lensReport()).toEqual({ active: true, hidden: 1, decisions: 1 });
    expect(pools.hiddenOf(ID)).toEqual([A]);
    expect(pools.lensWrites).toBe(1);
    expect(pools.totalWrites - writes0).toBe(1);
    expect(pools.bytesThisFrame).toBe(80);
    expect(pools.bandWritesThisFrame).toBe(0);
    expect(check(pools, 'cut')).toEqual({ zeroed: 1, live: UNIT.length - 1 });
    // byte for byte: the only bytes of any pool that changed are the hidden instance's sixteen floats and its tint
    let changed = 0;
    pools.pools.forEach((p, i) => {
      const b = before[i]!;
      for (let k = 0; k < b.m.length; k++) if (p.matrices[k] !== b.m[k]) changed++;
      for (let k = 0; k < b.t.length; k++) if (p.tints[k] !== b.t[k]) changed++;
    });
    // the matrix's zero entries were zero before (10 of 16 are not), and the tint's 4
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(20);

    // held: the following frames of the shot write nothing
    for (let i = 0; i < 20; i++) frame(pools, 100, 104.5, SHOT);
    expect(pools.lensWrites).toBe(1);
    expect(pools.lensReport()).toEqual({ active: true, hidden: 1, decisions: 1 });

    // the shot ends: every hidden tree is back on that frame, and the pools hold what they held before the shot
    pools.startFrame();
    pools.setLens(null);
    expect(pools.lensReport()).toEqual({ active: false, hidden: 0, decisions: 1 });
    expect(pools.lensWrites).toBe(2);
    pools.pools.forEach((p, i) => {
      expect(Array.from(p.matrices), p.key).toEqual(Array.from(before[i]!.m));
      expect(Array.from(p.tints), p.key).toEqual(Array.from(before[i]!.t));
    });
    pools.dispose();
  });

  it('a hidden tree stays hidden through a re-banding, a drawM crossing, setLook and a capacity doubling', () => {
    const pools = make('low', SCATTER);
    frame(pools, 100, 104.5, null);
    pools.addUnit(ID, trees(UNIT), 0, 0, true, false);
    frame(pools, 100, 104.5, SHOT);
    expect(pools.hiddenOf(ID)).toEqual([A]);
    expect(pools.bandsOf(ID)[A]!.band).toBe(BAND_MESH);
    expect(pools.bandsOf(ID)[B]!.band).toBe(BAND_MESH);

    // a re-banding: the stream camera moves so that the neighbour B becomes an impostor card; the unit's entry in the crown pool is rewritten
    drain(pools, 52, 104.5, SHOT);
    expect(pools.bandsOf(ID)[B]!.band).toBe(BAND_IMPOSTOR);
    expect(pools.bandsOf(ID)[A]!.band).toBe(BAND_MESH);
    expect(pools.rebands).toBeGreaterThan(1);
    expect(check(pools, 're-band')).toEqual({ zeroed: 1, live: UNIT.length - 1 });
    // further still, the hidden tree itself is beyond impostorM: its card is not drawn either (no tree appears while the shot runs)
    drain(pools, 0, 104.5, SHOT);
    expect(pools.bandsOf(ID)[A]!.band).toBe(BAND_IMPOSTOR);
    const c1 = check(pools, 'card');
    expect(c1.zeroed).toBe(1);
    drain(pools, 100, 104.5, SHOT);
    expect(pools.bandsOf(ID)[A]!.band).toBe(BAND_MESH);
    expect(check(pools, 're-band back')).toEqual({ zeroed: 1, live: UNIT.length - 1 });

    // the unit crosses tree.drawM and comes back
    pools.setDrawn(ID, false);
    expect(check(pools, 'not drawn').zeroed).toBe(0);
    pools.setDrawn(ID, true);
    expect(check(pools, 'drawn again')).toEqual({ zeroed: 1, live: UNIT.length - 1 });

    // the QA look switch re-bands every unit (the legacy look has no cards)
    pools.setLookOn(false);
    drain(pools, 100, 104.5, SHOT);
    expect(check(pools, 'look off')).toEqual({ zeroed: 1, live: UNIT.length - 1 });
    pools.setLookOn(true);
    drain(pools, 100, 104.5, SHOT);

    // a capacity doubling rebuilds the crown pool's mesh from the sources
    const crown = pools.pools.find((p) => p.key === 'crown:all')!;
    const grows0 = crown.layout.grows, mesh0 = crown.mesh;
    for (let i = 1; i <= 3; i++) pools.addUnit(`l0:9/${i}/0`, filler(120), 10_000 + i * 256, 0, true, false);
    expect(crown.layout.grows).toBeGreaterThan(grows0);
    expect(crown.mesh).not.toBe(mesh0);
    frame(pools, 100, 104.5, SHOT);
    const c2 = check(pools, 'doubling');
    expect(c2.zeroed).toBe(1);
    expect(c2.live).toBe(UNIT.length - 1 + 3 * 120);
    expect(pools.lensReport()).toEqual({ active: true, hidden: 1, decisions: 1 });

    // and the tree is back when the shot ends, in the rebuilt pool too
    frame(pools, 100, 104.5, null);
    expect(check(pools, 'cleared')).toEqual({ zeroed: 0, live: UNIT.length + 3 * 120 });
    pools.dispose();
  });

  it('full: a hidden tree is zero scale in the near (caster) pool, and stays hidden when its unit moves to the far pools and back', () => {
    // no scatter: M02h4's prefix layout
    const pools = make('full', undefined);
    pools.setCasting(true);
    pools.addUnit(ID, trees(UNIT.filter((r) => r[4] !== true)), 0, 0, true, true);
    pools.startFrame();
    pools.setLens(SHOT);
    expect(pools.hiddenOf(ID)).toEqual([A]);
    const slot = (key: string): number[] | null => {
      const p = pools.pools.find((q) => q.key === key)!;
      const r = p.layout.ranges.get(ID), s = p.src.get(ID);
      const j = s ? s.ks.indexOf(A) : -1;
      return r && j >= 0 ? Array.from(p.matrices.subarray((r.start + j) * 16, (r.start + j) * 16 + 16)) : null;
    };
    // the caster pool draws the shadow from the same instance matrix: zero scale, no shadow
    expect(pools.keys().find((k) => k.key === 'plane:near')!.cast).toBe(true);
    expect(slot('plane:near')).toEqual(new Array(16).fill(0));
    expect(slot('plane:far')).toBeNull();
    expect(check(pools, 'near').zeroed).toBe(1);

    expect(pools.setNear(ID, false)).toBe(true);
    expect(slot('plane:near')).toBeNull();
    expect(slot('plane:far')).toEqual(new Array(16).fill(0));
    expect(check(pools, 'far').zeroed).toBe(1);
    expect(pools.setNear(ID, true)).toBe(true);
    expect(slot('plane:near')).toEqual(new Array(16).fill(0));

    // the prefix layout: a drawM crossing moves the range, a doubling rebuilds the pool; the tree stays hidden through both
    pools.setDrawn(ID, false);
    pools.setDrawn(ID, true);
    expect(check(pools, 'crossing').zeroed).toBe(1);
    const plane = pools.pools.find((q) => q.key === 'plane:near')!;
    const grows0 = plane.layout.grows;
    pools.addUnit('l0:9/1/0', filler(200), 10_000, 0, true, true);
    expect(plane.layout.grows).toBeGreaterThan(grows0);
    expect(slot('plane:near')).toEqual(new Array(16).fill(0));
    expect(check(pools, 'doubling')).toEqual({ zeroed: 1, live: UNIT.length - 2 + 200 });

    pools.startFrame();
    pools.setLens(null);
    expect(check(pools, 'cleared')).toEqual({ zeroed: 0, live: UNIT.length - 1 + 200 });
    expect(slot('plane:near')!.some((v) => v !== 0)).toBe(true);
    pools.dispose();
  });

  it('shrubs, hedges and impostor cards are never hidden', () => {
    // a shrub at the lens's feet (UNIT[4]) and a hedge on the line to the subject
    const recs: Rec[] = [...UNIT, [100, 95, 1.4, TreeForm.Hedge, true]];
    const pools = make('full', { ...SCATTER, impostorM: 150, shrubDrawM: 250 });
    frame(pools, 100, 104.5, null);
    pools.addUnit(ID, trees(recs), 0, 0, true, false);
    frame(pools, 100, 104.5, SHOT);
    expect(pools.hiddenOf(ID)).toEqual([A]);
    expect(pools.hiddenOf(ID)).not.toContain(SHRUB);
    pools.dispose();

    // a tree 75 m down the line of sight: a card on `min` (beyond impostorM 50 from the lens), never chosen; the same tree as a mesh (no cards) is in the corridor
    const far: Rec[] = [[100, 30, 12, TreeForm.Plane]];
    const down: LensShot = { key: 'fixed|7|1|480|28', pos: [100, 10, 104.5], lookAt: [100, 10, 0], fovDeg: 28, aspect: 16 / 9 };
    const cards = make('low', SCATTER);
    frame(cards, 100, 104.5, null);
    cards.addUnit(ID, trees(far), 0, 0, true, false);
    frame(cards, 100, 104.5, down);
    expect(cards.bandsOf(ID)[0]!.band).toBe(BAND_IMPOSTOR);
    expect(cards.lensReport()).toEqual({ active: true, hidden: 0, decisions: 1 });
    cards.dispose();
    const meshes = make('low', { ...SCATTER, impostors: false });
    frame(meshes, 100, 104.5, null);
    meshes.addUnit(ID, trees(far), 0, 0, true, false);
    frame(meshes, 100, 104.5, down);
    expect(meshes.bandsOf(ID)[0]!.band).toBe(BAND_MESH);
    expect(meshes.lensReport().hidden).toBe(1);
    meshes.dispose();
  });

  it('a cut that jumps the camera hides the tree beside the new lens although it is still a card on that frame', () => {
    const pools = make('low', SCATTER);
    // the play camera stands 400 m away: every tree of the unit is an impostor card
    drain(pools, 500, 104.5, null);
    pools.addUnit(ID, trees(UNIT), 0, 0, true, false);
    expect(pools.bandsOf(ID)[A]!.band).toBe(BAND_IMPOSTOR);
    // the cut: the lens is decided before the bands have followed the camera
    pools.startFrame();
    pools.setLens(SHOT);
    expect(pools.hiddenOf(ID)).toEqual([A]);
    expect(pools.bandsOf(ID)[A]!.band).toBe(BAND_IMPOSTOR);
    // its card is gone at once, and the mesh the re-banding writes at the lens is zero scale from its first write
    expect(check(pools, 'cut').zeroed).toBe(1);
    pools.update(100, 104.5);
    drain(pools, 100, 104.5, SHOT);
    expect(pools.bandsOf(ID)[A]!.band).toBe(BAND_MESH);
    expect(check(pools, 're-banded at the lens')).toEqual({ zeroed: 1, live: UNIT.length - 1 });
    expect(pools.lensReport()).toEqual({ active: true, hidden: 1, decisions: 1 });
    // a tree further than impostorM from the lens stays a card and is never chosen, whatever stands on the line to it
    expect(pools.treesNear(160, 100, 1)[0]).toMatchObject({ band: BAND_IMPOSTOR, hidden: false });
    pools.dispose();
  });

  it('a unit that lands during the shot is judged by the same lenses; a moved lens decides again', () => {
    const pools = make('lite', SCATTER);
    frame(pools, 100, 104.5, SHOT);
    expect(pools.lensReport()).toEqual({ active: true, hidden: 0, decisions: 1 });
    // the unit beside the lens streams in after the cut: its tree is hidden from its first write
    pools.addUnit(ID, trees(UNIT), 0, 0, true, false);
    expect(pools.hiddenOf(ID)).toEqual([A]);
    expect(check(pools, 'landed')).toEqual({ zeroed: 1, live: UNIT.length - 1 });
    expect(pools.lensReport()).toEqual({ active: true, hidden: 1, decisions: 1 });
    expect(pools.lensWrites).toBe(0);

    // the director re-places the lens every tick: within redecideM the set holds, beyond it the set is decided again
    frame(pools, 100, 104.5, { ...SHOT, pos: [101.5, 5, 104.5] });
    expect(pools.lensReport().decisions).toBe(1);
    // 16 m down the street, beside the neighbour B and past A: B is hidden, A is back
    frame(pools, 100, 104.5, { ...SHOT, pos: [116, 5, 104.5], lookAt: [116, 3.6, 80] });
    expect(pools.lensReport()).toEqual({ active: true, hidden: 1, decisions: 2 });
    expect(pools.hiddenOf(ID)).toEqual([B]);
    expect(check(pools, 'moved')).toEqual({ zeroed: 1, live: UNIT.length - 1 });
    // a cut to another shot at the same place is a decision too
    frame(pools, 100, 104.5, { ...SHOT, key: 'fixed|9|1|240|75', pos: [116, 5, 104.5], lookAt: [116, 3.6, 80] });
    expect(pools.lensReport().decisions).toBe(3);
    pools.dispose();
  });

  it('the lensClear layer off restores every tree at once; on again, the running shot decides again', () => {
    const pools = make('low', SCATTER);
    frame(pools, 100, 104.5, null);
    pools.addUnit(ID, trees(UNIT), 0, 0, true, false);
    frame(pools, 100, 104.5, SHOT);
    expect(pools.lensReport()).toEqual({ active: true, hidden: 1, decisions: 1 });
    expect(pools.setLensLayer(false)).toBe(true);
    expect(pools.lensReport()).toEqual({ active: true, hidden: 0, decisions: 1 });
    expect(check(pools, 'layer off')).toEqual({ zeroed: 0, live: UNIT.length });
    for (let i = 0; i < 5; i++) frame(pools, 100, 104.5, SHOT);
    expect(pools.lensReport()).toEqual({ active: true, hidden: 0, decisions: 1 });
    expect(pools.setLensLayer(true)).toBe(true);
    frame(pools, 100, 104.5, SHOT);
    expect(pools.lensReport()).toEqual({ active: true, hidden: 1, decisions: 2 });
    expect(check(pools, 'layer on')).toEqual({ zeroed: 1, live: UNIT.length - 1 });
    pools.dispose();
  });

  it('maxFrameShare 1 with corridorM 0 turns the feature off; so does no rule at all', () => {
    for (const lens of [{ maxFrameShare: 1, corridorM: 0, redecideM: 2 }, undefined]) {
      const pools = new VegetationPools({ parent: new Group(), set: 'low', material: () => mat, receiveShadow: () => false, scatter: SCATTER, impostorMaterial: () => impMat, lens });
      frame(pools, 100, 104.5, null);
      pools.addUnit(ID, trees(UNIT), 0, 0, true, false);
      frame(pools, 100, 104.5, SHOT);
      expect(pools.lensReport()).toEqual({ active: true, hidden: 0, decisions: 0 });
      expect(pools.setLensLayer(false)).toBe(false);
      expect(check(pools, 'off')).toEqual({ zeroed: 0, live: UNIT.length });
      pools.dispose();
    }
  });

  it('the QA read lists the trees near a point with their crowns and whether the lens hides them', () => {
    const pools = make('low', SCATTER);
    frame(pools, 100, 104.5, null);
    pools.addUnit(ID, trees(UNIT), 0, 0, true, false);
    frame(pools, 100, 104.5, SHOT);
    const near = pools.treesNear(100, 104.5, 30);
    // A and B, nearest first; the shrub is not a tree
    expect(near.map((t) => [t.x, t.z, t.form, t.hidden])).toEqual([[100, 100, TreeForm.Plane, true], [116, 100, TreeForm.Ficus, false]]);
    expect(near[0]!.heightM).toBe(9);
    expect(near[0]!.crown!.y).toBeGreaterThan(2 + 4);
    expect(near[0]!.crown!.r).toBeGreaterThan(2);
    // what the rule measured for the shot's lens: A crowds the frame, B is at its edge
    expect(near[0]!.lens!.share).toBeGreaterThan(RULE.maxFrameShare);
    expect(near[1]!.lens!.share).toBeLessThanOrEqual(RULE.maxFrameShare);
    expect(near[1]!.lens!.corridor).toBe(false);
    // no decision in force: nothing measured
    frame(pools, 100, 104.5, null);
    expect(pools.treesNear(100, 104.5, 30).map((t) => [t.hidden, t.lens])).toEqual([[false, null], [false, null]]);
    expect(pools.treesNear(100, 104.5, 30, 1)).toHaveLength(1);
    pools.dispose();
  });
});

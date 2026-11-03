import { describe, expect, it } from 'vitest';
import { Group, MeshStandardNodeMaterial } from 'three/webgpu';
import { Rng, TreeForm, splitmix32 } from '@dv/shared';
import { TREE_STRIDE } from '../src/client/chunks/mesher.ts';
import {
  BAND_IMPOSTOR, BAND_MESH, BAND_NONE, SCATTER_POOLS, VegetationPools, keepHash, type ScatterPoolOptions,
} from '../src/client/chunks/vegetation-pool.ts';
import type { TreeSet } from '../src/client/chunks/tree-forms.ts';

/**
 * M02h5 AC-4 (`veg.bands`): the scatter's bands under 300 scripted camera moves and unit adds and removals, per look profile. After every
 * re-banding has drained, each kept instance of a drawn unit draws exactly once: a tree as its form's mesh within `impostorM` (a mesh may stay
 * one up to the 10 % hysteresis), otherwise as an impostor (or not at all on `legacy`, which has no impostors: a mesh as in M02h4);
 * a shrub or hedge as a mesh within `shrubDrawM` (with its hysteresis), else not at all. No frame writes more than the cap; thinning touches
 * bit-7 records only and keeps the same records on every run; the scatter adds 4 / 3 / 1 / 0 pools on `full` / `lite` / `min` / `legacy`.
 */

type Profile = 'full' | 'lite' | 'min' | 'legacy';
const SET: Record<Profile, TreeSet> = { full: 'full', lite: 'lite', min: 'low', legacy: 'low' };
const IMP_M: Record<Profile, number> = { full: 150, lite: 80, min: 50, legacy: 50 };
const SHRUB_M: Record<Profile, number> = { full: 250, lite: 120, min: 80, legacy: 80 };
const KEEP: Record<Profile, [number, number]> = { full: [1, 1], lite: [0.7, 0.6], min: [0.5, 0.3], legacy: [0.35, 0.25] };
const STREET_FORMS = [TreeForm.Plane, TreeForm.Ficus, TreeForm.Conifer, TreeForm.Eucalyptus, TreeForm.Palm];

function opts(p: Profile, writeCap = 4096): ScatterPoolOptions {
  return {
    enabled: true, impostors: p !== 'legacy', keepTree: KEEP[p][0], keepShrub: KEEP[p][1], impostorM: IMP_M[p], shrubDrawM: SHRUB_M[p],
    hysteresis: 0.1, rebandM: 16, writeCap,
  };
}

/** A unit's records: street trees (no bit 7) and scatter trees, shrubs and hedges (lane + 64), in local metres. */
function unitTrees(n: number, seed: number): Float32Array {
  const t = new Float32Array(n * TREE_STRIDE);
  const rng = new Rng(splitmix32(seed));
  for (let i = 0; i < n; i++) {
    const o = i * TREE_STRIDE;
    t[o] = rng.nextFloat() * 256;
    t[o + 1] = 2;
    t[o + 2] = rng.nextFloat() * 256;
    const r = rng.nextFloat();
    // a fifth street trees, the rest scatter: trees, shrubs, hedges
    const form = r < 0.2 ? (STREET_FORMS[i % 5] as number) : r < 0.6 ? (STREET_FORMS[i % 5] as number) : r < 0.85 ? TreeForm.Shrub : TreeForm.Hedge;
    const scatter = r >= 0.2;
    t[o + 3] = form >= TreeForm.Shrub ? 1.2 : 8 + (i % 7);
    t[o + 4] = rng.nextFloat() * 6.28;
    t[o + 5] = form + 8 * (i % 8) + (scatter ? 64 : 0);
  }
  return t;
}

const mat = new MeshStandardNodeMaterial();
const impMat = new MeshStandardNodeMaterial();
const make = (p: Profile, sc: ScatterPoolOptions | undefined): VegetationPools =>
  new VegetationPools({ parent: new Group(), set: SET[p], material: () => mat, receiveShadow: () => false, scatter: sc, impostorMaterial: () => impMat });

/** Runs the script; checks the invariants after each drained re-banding. Returns the kept instances' signature (for the repeat). */
function script(p: Profile, writeCap: number, steps = 300): { sig: string; checked: number; maxWrites: number; overCap: number; spread: number } {
  const pools = make(p, opts(p, writeCap));
  const rng = new Rng(splitmix32(777));
  const units = new Map<string, { ox: number; oz: number; drawn: boolean }>();
  let cam = { x: 600, z: 600 };
  let next = 0;
  let checked = 0;
  let spread = 0;
  // a 6 x 6 grid of unit slots around the start
  const slot = (): { id: string; ox: number; oz: number } => {
    const i = rng.nextU32() % 6, j = rng.nextU32() % 6;
    return { id: `l0:9/${i}/${j}`, ox: i * 256, oz: j * 256 };
  };
  // the renderer's first frame sets the camera before any unit lands
  pools.startFrame();
  pools.update(cam.x, cam.z);
  for (let k = 0; k < 20; k++) {
    const s = slot();
    if (units.has(s.id)) continue;
    pools.addUnit(s.id, unitTrees(400, next++), s.ox, s.oz, true, false);
    units.set(s.id, { ox: s.ox, oz: s.oz, drawn: true });
  }
  for (let step = 0; step < steps; step++) {
    const r = rng.nextFloat();
    if (r < 0.12) {
      const s = slot();
      if (!units.has(s.id)) {
        pools.addUnit(s.id, unitTrees(200 + (rng.nextU32() % 400), next++), s.ox, s.oz, rng.nextFloat() < 0.85, false);
        units.set(s.id, { ox: s.ox, oz: s.oz, drawn: true });
      }
    } else if (r < 0.2 && units.size > 2) {
      const ids = [...units.keys()];
      const id = ids[rng.nextU32() % ids.length] as string;
      pools.removeUnit(id);
      units.delete(id);
    } else if (r < 0.25) {
      // a jump (a teleport)
      cam = { x: rng.nextFloat() * 1536, z: rng.nextFloat() * 1536 };
    } else {
      const a = rng.nextFloat() * 6.283, d = 5 + rng.nextFloat() * 35;
      cam = { x: Math.min(1536, Math.max(0, cam.x + Math.cos(a) * d)), z: Math.min(1536, Math.max(0, cam.z + Math.sin(a) * d)) };
    }
    const rebands0 = pools.rebands;
    // a frame stays within the cap unless it applied one step larger than the whole cap, alone (counted in overCap)
    const frame = (): void => {
      const over0 = pools.bandOverCap;
      pools.startFrame();
      pools.update(cam.x, cam.z);
      if (pools.bandOverCap === over0) expect(pools.bandWritesThisFrame, `frame writes at step ${step}`).toBeLessThanOrEqual(writeCap);
      else expect(pools.bandOverCap - over0).toBe(1);
    };
    frame();
    if (pools.rebands === rebands0) continue;
    // drain at this camera, one frame at a time
    let frames = 1;
    for (let f = 0; f < 200 && pools.pendingBands > 0; f++) {
      frame();
      frames++;
    }
    spread = Math.max(spread, frames);
    expect(pools.pendingBands).toBe(0);
    checked++;
    for (const id of units.keys()) {
      const bands = pools.bandsOf(id);
      const counts = pools.drawCounts(id);
      const drawn = pools.drawnOf(id) === true;
      // plain checks, one assertion per unit (an expect per instance would cost minutes over the script)
      const bad: string[] = [];
      bands.forEach((b, k) => {
        const d = Math.hypot(b.x - cam.x, b.z - cam.z);
        const under = b.form === TreeForm.Shrub || b.form === TreeForm.Hedge;
        const c = counts.get(k) ?? { mesh: 0, impostor: 0 };
        if (under) {
          if (d <= SHRUB_M[p] && b.band !== BAND_MESH) bad.push(`shrub ${k} at ${d.toFixed(1)} m band ${b.band}`);
          if (d > SHRUB_M[p] * 1.1 && b.band !== BAND_NONE) bad.push(`shrub ${k} at ${d.toFixed(1)} m band ${b.band}`);
        } else if (p === 'legacy') {
          if (b.band !== BAND_MESH) bad.push(`tree ${k} band ${b.band}`);
        } else {
          if (d <= IMP_M[p] && b.band !== BAND_MESH) bad.push(`tree ${k} at ${d.toFixed(1)} m band ${b.band}`);
          if (d > IMP_M[p] * 1.1 && b.band !== BAND_IMPOSTOR) bad.push(`tree ${k} at ${d.toFixed(1)} m band ${b.band}`);
        }
        if (!drawn) return;
        const want = b.band === BAND_NONE ? 0 : 1;
        if (c.mesh + c.impostor !== want) bad.push(`instance ${k} draws ${c.mesh + c.impostor} times, want ${want}`);
        if (b.band === BAND_MESH && c.mesh !== 1) bad.push(`instance ${k} not a mesh`);
        if (b.band === BAND_IMPOSTOR && c.impostor !== 1) bad.push(`instance ${k} not an impostor`);
      });
      if (bad.length > 0) expect(bad.slice(0, 5), `${p} step ${step} unit ${id}`).toEqual([]);
    }
  }
  const sig = [...units.keys()].sort().map((id) => pools.bandsOf(id).map((b) => `${b.x.toFixed(1)},${b.z.toFixed(1)},${b.form}`).join(';')).join('|');
  const out = { sig, checked, maxWrites: pools.maxBandWritesInFrame, overCap: pools.bandOverCap, spread };
  pools.dispose();
  return out;
}

describe('vegetation bands (M02h5 AC-4)', () => {
  for (const p of ['full', 'lite', 'min', 'legacy'] as const) {
    it(`${p}: 300 scripted moves, adds and removals keep every drawn instance once in its band, within the write cap`, () => {
      const a = script(p, 4096);
      expect(a.checked).toBeGreaterThan(20);
      expect(a.overCap, 'no single step over the whole cap').toBe(0);
      expect(a.maxWrites).toBeLessThanOrEqual(4096);
    });
  }

  it('a small write cap spreads the re-banding over frames; a frame exceeds it only with one step larger than the whole cap', () => {
    const a = script('full', 1500, 120);
    expect(a.spread, 'some re-banding took several frames').toBeGreaterThan(1);
    expect(a.checked).toBeGreaterThan(5);
  });

  it('thinning touches bit-7 records only and keeps the same records on every run', () => {
    for (const p of ['lite', 'min', 'legacy'] as const) {
      const pools = make(p, opts(p));
      const t = unitTrees(4000, 99);
      pools.addUnit('u', t, 0, 0, true, false);
      const kept = pools.bandsOf('u');
      const keptSet = new Set(kept.map((b) => `${b.x.toFixed(2)},${b.z.toFixed(2)}`));
      let street = 0, scatterTrees = 0, scatterShrubs = 0, keptTrees = 0, keptShrubs = 0;
      for (let i = 0; i < 4000; i++) {
        const o = i * TREE_STRIDE;
        const lane = t[o + 5]!;
        const key = `${t[o]!.toFixed(2)},${t[o + 2]!.toFixed(2)}`;
        const has = keptSet.has(key);
        if (lane < 64) {
          street++;
          expect(has, 'a street tree is never thinned').toBe(true);
          continue;
        }
        const under = (lane & 7) >= TreeForm.Shrub;
        expect(has).toBe(keepHash(t[o]!, t[o + 2]!) < (under ? KEEP[p][1] : KEEP[p][0]));
        if (under) {
          scatterShrubs++;
          if (has) keptShrubs++;
        } else {
          scatterTrees++;
          if (has) keptTrees++;
        }
      }
      expect(street).toBeGreaterThan(0);
      expect(Math.abs(keptTrees / scatterTrees - KEEP[p][0])).toBeLessThan(0.06);
      expect(Math.abs(keptShrubs / scatterShrubs - KEEP[p][1])).toBeLessThan(0.06);
      pools.dispose();
    }
    // identical across runs
    expect(script('min', 4096, 60).sig).toBe(script('min', 4096, 60).sig);
  });

  it('the scatter adds 4 / 3 / 1 / 0 pools; world.scatter off adds none and draws no bit-7 record', () => {
    for (const p of ['full', 'lite', 'min', 'legacy'] as const) {
      const base = make(p, undefined);
      const withScatter = make(p, opts(p));
      expect(withScatter.poolCount - base.poolCount, p).toBe(SCATTER_POOLS[p]);
      const off = make(p, { ...opts(p), enabled: false });
      expect(off.poolCount).toBe(base.poolCount);
      off.addUnit('u', unitTrees(500, 5), 0, 0, true, false);
      const rep = off.report();
      expect(rep.scatter.scatterInstances).toBe(0);
      expect(rep.scatter.impostorPools).toBe(0);
      expect(off.bandsOf('u').length).toBe(rep.forms.reduce((n, f) => n + f.instances, 0));
      for (const x of [base, withScatter, off]) x.dispose();
    }
  });
});

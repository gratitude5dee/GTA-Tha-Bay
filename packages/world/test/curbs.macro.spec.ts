/**
 * M02h2 AC-3: the macro variation (chunks/macro.ts). The tone at a border vertex two chunks share is the same from both; the tone stays within
 * +-8 %; the sampled correlation is at least 0.8 at a 10 m lag and at most 0.3 at 400 m; on `mobile-low` the baked vertex colours equal the
 * class colour times `1 + macroTone` within 1/255.
 */
import { chunkBounds, type ChunkKey } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { MACRO, bakeMacro, hash21, macroApplies, macroNoise, macroTone, vnoise } from '../src/client/chunks/macro.ts';
import type { MeshBuffers } from '../src/client/chunks/mesh-types.ts';
import { GROUND, LOT_COLOR, PLAZA_COLOR, meshChunk } from '../src/client/chunks/mesher.ts';
import { Surf } from '../src/client/look/surfaces.ts';
import { bakeTiles } from './curbs.support.ts';

/** A seeded sequence for the sample points (the test's own; the tone is deterministic). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function correlation(lag: number, n = 20_000): number {
  const r = lcg(lag * 7 + 3);
  const a: number[] = [], b: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * 20_000, z = (r() - 0.5) * 20_000, ang = r() * Math.PI * 2;
    a.push(macroTone(x, z));
    b.push(macroTone(x + Math.cos(ang) * lag, z + Math.sin(ang) * lag));
  }
  const mean = (v: number[]): number => v.reduce((p, q) => p + q, 0) / v.length;
  const ma = mean(a), mb = mean(b);
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += ((a[i] as number) - ma) * ((b[i] as number) - mb);
    va += ((a[i] as number) - ma) ** 2;
    vb += ((b[i] as number) - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}

describe('macroTone (AC-3)', () => {
  it('is the TSL hash and value noise: deterministic, in [0, 1)', () => {
    expect(hash21(3, 4)).toBe(hash21(3, 4));
    for (let i = -50; i < 50; i++) {
      const h = hash21(i * 1.0, i * -2.0);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      const v = vnoise(i * 0.37, i * 0.91);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(MACRO.octavesM).toEqual([200, 50]);
  });

  it('stays within +-8 % of the albedo (and the roughness within +-0.04)', () => {
    const r = lcg(11);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 100_000; i++) {
      const t = macroTone((r() - 0.5) * 40_000, (r() - 0.5) * 40_000);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    expect(MACRO.albedo).toBeLessThanOrEqual(0.08);
    expect(MACRO.roughness).toBeLessThanOrEqual(0.04);
    expect(lo).toBeGreaterThanOrEqual(-0.08);
    expect(hi).toBeLessThanOrEqual(0.08);
    // the range is used, not a constant
    expect(hi - lo).toBeGreaterThan(0.08);
  });

  it('is correlated at 10 m (>= 0.8) and not at 400 m (<= 0.3)', () => {
    expect(correlation(10)).toBeGreaterThanOrEqual(0.8);
    expect(Math.abs(correlation(400))).toBeLessThanOrEqual(0.3);
  });

  it('gives a border vertex two chunks share the same value from both chunks', () => {
    const a = chunkBounds('9/256/256' as ChunkKey), b = chunkBounds('9/257/256' as ChunkKey), c = chunkBounds('9/256/257' as ChunkKey);
    for (let k = 0; k <= 64; k++) {
      const z = k * 4;
      // the east border of a is the west border of b, both in each chunk's own local frame (float32 positions, as the mesher writes them)
      const fromA = macroTone(a.minX + Math.fround(256), a.minZ + Math.fround(z));
      const fromB = macroTone(b.minX + Math.fround(0), b.minZ + Math.fround(z));
      expect(fromA).toBe(fromB);
      const fromA2 = macroTone(a.minX + Math.fround(z), a.minZ + Math.fround(256));
      const fromC = macroTone(c.minX + Math.fround(z), c.minZ + Math.fround(0));
      expect(fromA2).toBe(fromC);
    }
  });

  it('bakes the tone into the colours of the surfaces it applies to only', () => {
    const pos = new Float32Array([10, 0, 20, 30, 0, 40]);
    const col = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const surf = new Uint8Array([Surf.Lot, 0, 0, 0, Surf.WallBase, 0, 0, 0]);
    bakeMacro(pos, col, surf, 1000, 2000);
    expect(col[0]).toBeCloseTo(0.5 * (1 + macroTone(1010, 2020)), 6);
    expect(col[3]).toBe(0.5);
    expect(macroApplies(Surf.Gutter)).toBe(false);
    expect(macroApplies(Surf.Plaza)).toBe(true);
    expect(macroNoise(0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('the baked tone on mobile-low (AC-3)', () => {
  const tiles = bakeTiles('synth', 'curbs.macro', 1);

  it('the terrain colours equal the class colour times 1 + macroTone within 1/255', () => {
    let checked = 0;
    for (const t of tiles) {
      for (const sim of t.sims.slice(0, 6)) {
        const render = t.renders.find((r) => r.key === sim.key) ?? null;
        const m = meshChunk(sim, render, { tier: 'mobile-low', distM: 0, tile: t.sims });
        const terrain = m.objects.find((o) => o.kind === 'terrain') as MeshBuffers;
        const verts = terrain.positions.length / 3;
        for (let v = 0; v < verts; v++) {
          const id = terrain.surf[v * 4] as number;
          // the post vertices (the skirt below copies them), class colour known for these ids
          const base = id === Surf.Lot ? LOT_COLOR : id === Surf.Plaza ? PLAZA_COLOR : id === 0 || id === 1 || id === 6 || id === 7 ? GROUND[id] : null;
          if (!base) continue;
          const tone = macroTone(m.originX + (terrain.positions[v * 3] as number), m.originZ + (terrain.positions[v * 3 + 2] as number));
          for (let ch = 0; ch < 3; ch++) expect(Math.abs((terrain.colors[v * 3 + ch] as number) - (base[ch] as number) * (1 + tone))).toBeLessThanOrEqual(1 / 255);
          checked++;
        }
      }
    }
    if (tiles.length > 0) expect(checked).toBeGreaterThan(1000);
  });

  it('the desktop tier keeps the plain colours (the shader adds the tone)', () => {
    for (const t of tiles) {
      const sim = t.sims[0];
      if (!sim) continue;
      const m = meshChunk(sim, t.renders.find((r) => r.key === sim.key) ?? null, { tier: 'desktop', distM: 0, tile: t.sims });
      const terrain = m.objects.find((o) => o.kind === 'terrain') as MeshBuffers;
      for (let v = 0; v < terrain.positions.length / 3; v++) {
        if (terrain.surf[v * 4] !== Surf.Lot) continue;
        expect(terrain.colors[v * 3]).toBeCloseTo(LOT_COLOR[0], 6);
      }
    }
  });
});

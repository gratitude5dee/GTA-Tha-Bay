/**
 * M02h2 AC-4: the walk lift masks. On a full-height curbed sidewalk the lift equals the ribbon top over the road within 0.01 m; on the
 * carriageways and the crosswalks it is 0; and the render lift leaves the sim alone: the state hash of the 600-tick pedestrian scenario
 * equals the parent commit's (`golden/traffic-peds-synth.json`, the M03b2 checkpoint at tick 600).
 */
import { readFileSync } from 'node:fs';
import { PedEdgeKind, type QualityTierId } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/client/chunks/mesher.ts';
import { CURBS, WALK_CELLS, markQuad, walkBit, walkLiftAt, walkLiftOf } from '../src/client/chunks/sidewalks.ts';
import { bakeTiles } from './curbs.support.ts';
import { loadBake } from './fixtures/bake.ts';
import { runTrafficSynth, TRAFFIC_PEDS_SYNTH } from './fixtures/traffic-run.ts';

const tiles = bakeTiles('synth', 'curbs.walk', 2);

describe('the walk mask (AC-4)', () => {
  it('marks the cells whose centres lie inside a quad, and nothing outside the chunk', () => {
    const w = new Uint8Array((WALK_CELLS * WALK_CELLS) / 8);
    markQuad(w, [10, 10, 14, 10, 14, 12, 10, 12]);
    expect(walkBit(w, 10, 10)).toBe(true);
    expect(walkBit(w, 13, 11)).toBe(true);
    expect(walkBit(w, 14, 11)).toBe(false);
    expect(walkBit(w, 9, 10)).toBe(false);
    expect(walkBit(w, -1, 0)).toBe(false);
    expect(walkLiftAt(w, 0.11, 12.5, 11.5)).toBe(0.11);
    expect(walkLiftAt(w, 0.11, 30, 30)).toBe(0);
    markQuad(w, [250, 250, 270, 250, 270, 260, 250, 260]);
    expect(walkBit(w, 255, 255)).toBe(true);
  });

  it.each(['desktop', 'mobile', 'mobile-low'] as QualityTierId[])('%s: the lift is the ribbon top over the road on sidewalks, 0 on carriageways and crosswalks', (tier) => {
    let onWalk = 0, onRoad = 0, onCross = 0;
    const profile = tier === 'mobile-low' ? 'low' : tier === 'mobile' ? 'mobile' : 'desktop';
    for (const t of tiles) {
      for (const sim of t.sims) {
        const render = t.renders.find((r) => r.key === sim.key) ?? null;
        const m = meshChunk(sim, render, { tier, distM: 0, tile: t.sims, curbDebug: true });
        if (!m.walk) continue;
        expect(m.walkLiftM).toBe(walkLiftOf(profile));
        const lift = (x: number, z: number): number => walkLiftAt(m.walk as Uint8Array, m.walkLiftM ?? 0, x - m.originX, z - m.originZ);
        const s = m.curbSamples ?? [];
        // the middle of the ribbon between two full-height samples: the lift there is the top over the road
        for (let i = 0; i + 1 < s.length; i++) {
          const a = s[i] as (typeof s)[number], b = s[i + 1] as (typeof s)[number];
          const full = walkLiftOf(profile);
          if (a.heightM < full - 1e-6 || b.heightM < full - 1e-6 || Math.hypot(a.x - b.x, a.z - b.z) > 9) continue;
          const x = (a.x + a.outerX + b.x + b.outerX) / 4, z = (a.z + a.outerZ + b.z + b.outerZ) / 4;
          const lx = x - m.originX, lz = z - m.originZ;
          if (lx < 1 || lz < 1 || lx > 255 || lz > 255) continue;
          // the cell of the point is set unless its centre falls past the ribbon's edge; count the set ones and check their value
          const l = lift(x, z);
          if (l === 0) continue;
          expect(Math.abs(l - (a.top - a.roadTop)), `${m.key} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThanOrEqual(0.01);
          onWalk++;
        }
        // 0 on the carriageways: the centreline points of the chunk's roads
        for (const seg of sim.segments) {
          for (let i = 0; i < seg.pts.length; i += 3) {
            const x = seg.pts[i] as number, z = seg.pts[i + 2] as number;
            if (x - m.originX < 0 || z - m.originZ < 0 || x - m.originX >= 256 || z - m.originZ >= 256) continue;
            expect(lift(x, z), `${m.key} road ${seg.id}`).toBe(0);
            onRoad++;
          }
        }
        // 0 on the crosswalks: their middle thirds
        const nodes = new Map(sim.pedNodes.map((n) => [n.id, n]));
        for (const pe of sim.pedEdges) {
          if (pe.kind !== PedEdgeKind.Crosswalk) continue;
          const a = nodes.get(pe.a), b = nodes.get(pe.b);
          if (!a || !b) continue;
          for (const f of [0.35, 0.5, 0.65]) {
            const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
            if (x - m.originX < 0 || z - m.originZ < 0 || x - m.originX >= 256 || z - m.originZ >= 256) continue;
            expect(lift(x, z), `${m.key} crosswalk`).toBe(0);
            onCross++;
          }
        }
      }
    }
    if (tiles.length > 0) {
      expect(onWalk).toBeGreaterThan(100);
      expect(onRoad).toBeGreaterThan(100);
      expect(onCross).toBeGreaterThan(10);
    }
  });

  it('the lift of a set cell is the curb height on the curbed profiles and the strip lift on mobile-low', () => {
    expect(walkLiftOf('desktop')).toBe(CURBS.heightM);
    expect(walkLiftOf('mobile')).toBe(CURBS.heightM);
    expect(walkLiftOf('low')).toBe(CURBS.lowLiftM);
  });
});

const bake = loadBake('synth', 'curbs.walk');
const suite = bake ? describe : describe.skip;

suite('the sim is untouched (AC-4)', () => {
  it('the state hash of 600 ticks of the pedestrian scenario equals the committed one of the parent commit', async () => {
    if (!bake) return;
    const golden = JSON.parse(readFileSync(new URL('./golden/traffic-peds-synth.json', import.meta.url), 'utf8')) as { bakeId: string; checkpoints: Record<string, string> };
    expect(golden.bakeId, 'the golden is of this bake').toBe(bake.bakeId);
    const run = await runTrafficSynth({ bake, order: 'in-order', ambient: TRAFFIC_PEDS_SYNTH.ambient, ticks: 600 });
    expect(run.checkpoints['600']).toBe(golden.checkpoints['600']);
  }, 300_000);
});

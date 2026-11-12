/**
 * M02h2 AC-2 on the `synth` and `civic-excerpt` bakes: every L0 chunk of the busiest tiles is meshed twice per profile. The buffers and the
 * walk mask are byte-identical across the runs; every attached `Sidewalk` ped edge yields a ribbon; the curb is 0.10 to 0.12 m over the road
 * on `desktop` and `mobile` and has no face on `mobile-low`; the curb is 0 within `rampM` of every crosswalk start; the gutter and the
 * carriageway share edges and never overlap; every surface id is under 42; no `mobile-low` unit passes the 2 MiB upload cap. Also: the
 * render-object count does not change (the sidewalks go into the roads object) and the triangle deltas stay within the milestone's budget.
 */
import { type QualityTierId } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { planRoads, roadsContext, type RoadsContext } from '../src/client/chunks/junction-patch.ts';
import type { MeshBuffers, UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { MeshBuilder, addRibbon, meshChunk, objectCountOf, ribbonLift, roadColor } from '../src/client/chunks/mesher.ts';
import { CURBS, WALK_BYTES, classifySidewalks, curbedSides } from '../src/client/chunks/sidewalks.ts';
import { LOOK } from '../src/client/look/config.ts';
import { SURFACE_COUNT, Surf } from '../src/client/look/surfaces.ts';
import { bakeTiles, type Tile } from './curbs.support.ts';

const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low', 'xr-quest'];
const MOBILE_LOW_CAP = 2 * 1024 * 1024;
const AREAS = ['synth', 'civic-excerpt'] as const;
const TILES: Record<string, Tile[]> = Object.fromEntries(AREAS.map((a) => [a, bakeTiles(a, `curbs.mesher ${a}`, 2)]));

const eq = (x: ArrayBufferView | undefined, y: ArrayBufferView | undefined): boolean =>
  (x === undefined && y === undefined) || (x !== undefined && y !== undefined && Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)) === 0);
const same = (a: MeshBuffers, b: MeshBuffers): boolean =>
  a.kind === b.kind && eq(a.positions, b.positions) && eq(a.normals, b.normals) && eq(a.colors, b.colors) && eq(a.ao, b.ao) && eq(a.indices, b.indices) && eq(a.surf, b.surf) && eq(a.road, b.road);

function* units(tiles: readonly Tile[], tier: QualityTierId, debug = false): Generator<{ t: Tile; m: UnitMesh; off: UnitMesh; again: UnitMesh }> {
  for (const t of tiles) {
    for (const sim of t.sims) {
      const render = t.renders.find((r) => r.key === sim.key) ?? null;
      const m = meshChunk(sim, render, { tier, distM: 0, tile: t.sims, curbs: true, curbDebug: debug });
      const again = meshChunk(sim, render, { tier, distM: 0, tile: t.sims, curbs: true, curbDebug: debug });
      const off = meshChunk(sim, render, { tier, distM: 0, tile: t.sims, curbs: false });
      yield { t, m, off, again };
    }
  }
}

describe.each(AREAS)('curbs and sidewalks on %s (AC-2)', (area) => {
  const tiles = TILES[area] as Tile[];

  it('has tiles with sidewalks to mesh', () => {
    if (tiles.length === 0) return;
    expect(tiles.reduce((n, t) => n + t.sims.reduce((k, s) => k + s.pedEdges.length, 0), 0)).toBeGreaterThan(100);
  });

  it.each(TIERS)('%s: two runs are byte-identical (walk mask too), ids stay under 42, objects do not change, mobile-low stays under 2 MiB', (tier) => {
    let withCurbs = 0;
    for (const { m, off, again } of units(tiles, tier)) {
      expect(m.objects.length).toBe(again.objects.length);
      m.objects.forEach((o, i) => expect(same(o, again.objects[i] as MeshBuffers), `${m.key} ${o.kind}`).toBe(true));
      expect(eq(m.walk, again.walk), `${m.key} walk`).toBe(true);
      expect(objectCountOf(m), `${m.key}: the sidewalks add no render object`).toBe(objectCountOf(off));
      for (const o of m.objects) for (let v = 0; v < o.surf.length; v += 4) expect(o.surf[v] as number).toBeLessThan(SURFACE_COUNT);
      if (tier === 'mobile-low') expect(m.stats.bytes, `${m.key} on mobile-low`).toBeLessThanOrEqual(MOBILE_LOW_CAP);
      if (m.walk) expect(m.walk.byteLength).toBe(WALK_BYTES);
      if ((m.stats.curbs?.attached ?? 0) > 0) withCurbs++;
      // the triangle budget of the milestone: +20,000 per L0 chunk on desktop, +4,000 on mobile-low
      const delta = m.stats.triangles - off.stats.triangles;
      if (tier === 'desktop') expect(delta, `${m.key} desktop triangles`).toBeLessThanOrEqual(20_000);
      if (tier === 'mobile-low') expect(delta, `${m.key} mobile-low triangles`).toBeLessThanOrEqual(4_000);
    }
    if (tiles.length > 0) expect(withCurbs).toBeGreaterThan(0);
  });

  it('every attached Sidewalk edge yields a ribbon', () => {
    for (const { t, m } of units(tiles, 'desktop')) {
      const sim = t.sims.find((s) => s.key === m.key);
      if (!sim || sim.segments.length === 0) continue;
      const ctx = roadsContext(t.sims);
      const classes = classifySidewalks(sim, ctx);
      const attached = classes.filter((c) => c.attached).length;
      expect(m.stats.curbs?.attached, `${m.key}`).toBe(attached);
      expect(m.stats.curbs?.ribbons, `${m.key}`).toBe(classes.length);
    }
  });

  it.each(['desktop', 'mobile'] as const)('%s: the curb is 0.10 to 0.12 m over the road away from a crosswalk and 0 within rampM of one', (tier) => {
    let full = 0, ramped = 0;
    for (const { m } of units(tiles, tier, true)) {
      for (const s of m.curbSamples ?? []) {
        if (s.rampD <= CURBS.rampM + 1e-6) {
          expect(s.heightM, `${m.key} ramp at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`).toBe(0);
          expect(Math.abs(s.top - s.roadTop)).toBeLessThan(1e-9);
          ramped++;
        } else if (s.rampD >= CURBS.rampM + CURBS.rampRunM - 1e-6) {
          expect(s.heightM).toBeGreaterThanOrEqual(0.1);
          expect(s.heightM).toBeLessThanOrEqual(0.12);
          expect(s.top - s.roadTop).toBeCloseTo(s.heightM, 9);
          full++;
        }
      }
      // the curb faces exist: Curb vertices with a level normal
      if ((m.stats.curbs?.attached ?? 0) > 0) {
        const roads = m.objects.find((o) => o.kind === 'roads') as MeshBuffers;
        let faces = 0;
        for (let v = 0; v < roads.surf.length / 4; v++) if (roads.surf[v * 4] === Surf.Curb && Math.abs(roads.normals[v * 3 + 1] as number) < 0.5) faces++;
        expect(faces, m.key).toBeGreaterThan(0);
      }
    }
    if (tiles.length > 0) {
      expect(full).toBeGreaterThan(50);
      expect(ramped).toBeGreaterThan(5);
    }
  });

  it('mobile-low: a flat strip with a painted band, no curb face', () => {
    for (const { m } of units(tiles, 'mobile-low', true)) {
      const roads = m.objects.find((o) => o.kind === 'roads');
      if (!roads) continue;
      for (let v = 0; v < roads.surf.length / 4; v++) {
        if (roads.surf[v * 4] === Surf.Curb) expect(roads.normals[v * 3 + 1], `${m.key}: a curb face on mobile-low`).toBe(1);
        expect(roads.surf[v * 4], 'no gutter on mobile-low').not.toBe(Surf.Gutter);
      }
      for (const s of m.curbSamples ?? []) expect(s.top - s.roadTop).toBeCloseTo(CURBS.lowLiftM, 9);
    }
  });
});

// ---- the gutter -----------------------------------------------------------------------------------------------------------------------

type Tri = [number, number, number, number, number, number];
const trisOf = (o: MeshBuffers, keep: (id: number) => boolean): Tri[] => {
  const out: Tri[] = [];
  for (let i = 0; i < o.indices.length; i += 3) {
    const a = o.indices[i] as number, b = o.indices[i + 1] as number, c = o.indices[i + 2] as number;
    if (!keep(o.surf[a * 4] as number)) continue;
    out.push([o.positions[a * 3] as number, o.positions[a * 3 + 2] as number, o.positions[b * 3] as number, o.positions[b * 3 + 2] as number, o.positions[c * 3] as number, o.positions[c * 3 + 2] as number]);
  }
  return out;
};
/** Whether (x, z) lies strictly inside the triangle (more than `eps` from every edge). */
const strictlyInside = (t: Tri, x: number, z: number, eps = 1e-3): boolean => {
  const side = (ax: number, az: number, bx: number, bz: number): number => {
    const ex = bx - ax, ez = bz - az;
    return (ex * (z - az) - ez * (x - ax)) / (Math.hypot(ex, ez) || 1);
  };
  const s1 = side(t[0], t[1], t[2], t[3]), s2 = side(t[2], t[3], t[4], t[5]), s3 = side(t[4], t[5], t[0], t[1]);
  return (s1 > eps && s2 > eps && s3 > eps) || (s1 < -eps && s2 < -eps && s3 < -eps);
};
const centroid = (t: Tri): [number, number] => [(t[0] + t[2] + t[4]) / 3, (t[1] + t[3] + t[5]) / 3];
const edges = (t: Tri): string[] => {
  const p = [`${t[0]},${t[1]}`, `${t[2]},${t[3]}`, `${t[4]},${t[5]}`];
  return [[p[0], p[1]], [p[1], p[2]], [p[2], p[0]]].map(([a, b]) => ((a as string) < (b as string) ? `${a}|${b}` : `${b}|${a}`));
};

function checkGutter(ribbon: MeshBuffers): { gutter: number; shared: number } {
  const gut = trisOf(ribbon, (id) => id === Surf.Gutter);
  const road = trisOf(ribbon, (id) => id !== Surf.Gutter);
  for (const g of gut) {
    const [x, z] = centroid(g);
    for (const r of road) expect(strictlyInside(r, x, z), 'a gutter triangle overlaps the carriageway').toBe(false);
  }
  for (const r of road) {
    const [x, z] = centroid(r);
    for (const g of gut) expect(strictlyInside(g, x, z), 'a carriageway triangle overlaps the gutter').toBe(false);
  }
  const roadEdges = new Set(road.flatMap(edges));
  let shared = 0;
  for (const g of gut) for (const e of edges(g)) if (roadEdges.has(e)) shared++;
  return { gutter: gut.length, shared };
}

describe('the gutter strip (AC-2)', () => {
  it('a synthetic curved ribbon: the gutter strips share their inner edges with the carriageway and never overlap it', () => {
    const pts = new Float32Array([0, 0, 0, 20, 0, 0, 40, 0, 6, 55, 0, 20]);
    for (const sides of [1, 2, 3]) {
      const b = new MeshBuilder({ road: false });
      b.setSurf(Surf.RoadBase + 4);
      addRibbon(b, pts, 0, 0, 10, ribbonLift(4), roadColor(4), { gutter: { sides, widthM: CURBS.gutterM } });
      const r = checkGutter(b.build('roads') as MeshBuffers);
      expect(r.gutter).toBe(2 * 3 * (sides === 3 ? 2 : 1));
      // each gutter quad meets its carriageway quad along one edge (one of its two triangles carries it)
      expect(r.shared).toBe(3 * (sides === 3 ? 2 : 1));
    }
  });

  it.each(AREAS)('%s: the curbed ribbons of real segments keep the rule', (area) => {
    let checked = 0;
    for (const t of TILES[area] as Tile[]) {
      const ctx: RoadsContext = roadsContext(t.sims);
      planRoads(ctx, LOOK.markings.junctionExtraM);
      const curbed = curbedSides(ctx);
      for (const [seg, sides] of [...curbed.entries()].slice(0, 40)) {
        const s = ctx.segById.get(seg);
        if (!s) continue;
        const b = new MeshBuilder({ road: false });
        b.setSurf(Surf.RoadBase + 4);
        addRibbon(b, s.pts, 0, 0, s.widthM, 0.12, roadColor(4), { gutter: { sides, widthM: CURBS.gutterM } });
        const built = b.build('roads');
        if (!built) continue;
        const r = checkGutter(built);
        expect(r.gutter).toBeGreaterThan(0);
        expect(r.shared).toBeGreaterThan(0);
        checked++;
      }
    }
    if ((TILES[area] as Tile[]).length > 0) expect(checked).toBeGreaterThan(0);
  });
});

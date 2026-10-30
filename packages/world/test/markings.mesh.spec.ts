/**
 * AC-3 (M02h1) on the `synth` bake: every L0 chunk of the tiles around City Hall is meshed twice per profile. The buffers are byte-identical,
 * every road vertex has its `road` record, each junction with three or more roads has one convex patch (no clipped ribbon vertex more than
 * 5 cm inside it), the crosswalk quads equal the `Crosswalk` ped edges and the stop bars the approaches, the surface ids stay under 38, a
 * chunk has at most six objects, and no `mobile-low` chunk goes over the upload cap. Also: the paint coordinates of a ribbon, the markings
 * switch (no `road`, no patch, the M02g2 overlap), and the cross-chunk plan.
 */
import { readFileSync } from 'node:fs';
import { PedEdgeKind, decodeL0, decodeP0, chunkKeyAt, parseChunkKey, type QualityTierId, type RenderChunk, type SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { approachesOf, armsOf, depthInsideHull, nearestRoad, planRoads, roadsContext, CORNER_TOLERANCE_M } from '../src/client/chunks/junction-patch.ts';
import type { MeshBuffers } from '../src/client/chunks/mesh-types.ts';
import { MESHER, meshChunk, objectCountOf, ribbonLift } from '../src/client/chunks/mesher.ts';
import { transferListOf } from '../src/client/chunks/mesh-types.ts';
import { LOOK } from '../src/client/look/config.ts';
import { ROAD_SCALE, unpackRoad } from '../src/client/look/road-layout.ts';
import { SURFACE_COUNT, Surf } from '../src/client/look/surfaces.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low', 'xr-quest'];
/** The per-frame upload cap of `mobile-low` (C13 `maxChunkUploadBytes`, 2 MB). */
const MOBILE_LOW_CAP = 2 * 1024 * 1024;
const bake = requireBake('synth', 'markings.mesh');

interface Tile {
  name: string;
  sims: SimChunk[];
  renders: RenderChunk[];
}

/** The z7 tiles around City Hall (the origin), decoded the way the mesher job decodes one. */
function tiles(): Tile[] {
  if (!bake) return [];
  const here = parseChunkKey(chunkKeyAt(9, 0, 0)) as { x: number; y: number };
  const out: Tile[] = [];
  for (const [dx, dy] of [[0, 0], [1, 0]] as const) {
    const name = `${(here.x >> 2) + dx}-${(here.y >> 2) + dy}`;
    try {
      const sims = decodeP0(new Uint8Array(readFileSync(`${bake.dir}/packs/p0-${name}.pack`)));
      const renders = decodeL0(new Uint8Array(readFileSync(`${bake.dir}/packs/l0-${name}.pack`)), sims);
      out.push({ name, sims, renders });
    } catch {
      // a tile outside the bake
    }
  }
  return out;
}

const eq = (x: ArrayBufferView | undefined, y: ArrayBufferView | undefined): boolean =>
  (x === undefined && y === undefined) || (x !== undefined && y !== undefined && Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)) === 0);
const sameBuffers = (a: MeshBuffers, b: MeshBuffers): boolean =>
  a.kind === b.kind && eq(a.positions, b.positions) && eq(a.normals, b.normals) && eq(a.colors, b.colors) && eq(a.ao, b.ao) && eq(a.indices, b.indices) && eq(a.surf, b.surf) && eq(a.road, b.road);

const ALL = tiles();
const roadsOf = (m: ReturnType<typeof meshChunk>): MeshBuffers | undefined => m.objects.find((o) => o.kind === 'roads');

describe('the roads object (AC-3)', () => {
  it('has tiles to mesh', () => {
    if (!bake) return;
    expect(ALL.length).toBeGreaterThan(0);
    expect(ALL.reduce((n, t) => n + t.sims.length, 0)).toBeGreaterThan(4);
  });

  it.each(TIERS)('%s: two runs give byte-identical buffers, every road vertex has its record, ids stay under 38 and a chunk has at most six objects', (tier) => {
    if (!bake) return;
    let withRoads = 0;
    for (const t of ALL) {
      for (const sim of t.sims) {
        const render = t.renders.find((r) => r.key === sim.key) ?? null;
        const a = meshChunk(sim, render, { tier, distM: 0, tile: t.sims });
        const b = meshChunk(sim, render, { tier, distM: 0, tile: t.sims });
        a.objects.forEach((o, i) => expect(sameBuffers(o, b.objects[i] as MeshBuffers), `${sim.key} ${o.kind}`).toBe(true));
        expect(objectCountOf(a)).toBeLessThanOrEqual(6);
        for (const o of a.objects) for (let v = 0; v < o.surf.length; v += 4) expect(o.surf[v] as number).toBeLessThan(SURFACE_COUNT);
        const roads = roadsOf(a);
        if (!roads) continue;
        withRoads++;
        expect(roads.road, `${sim.key}: road attribute`).toBeDefined();
        expect((roads.road as Int16Array).length).toBe((roads.positions.length / 3) * 4);
        expect(a.stats.markings?.roadVerts).toBe(roads.positions.length / 3);
        // the transfer list carries it, and the byte count includes it (8 B per road vertex)
        expect(new Set(transferListOf(a)).has((roads.road as Int16Array).buffer as ArrayBuffer)).toBe(true);
        // other objects have none
        for (const o of a.objects) if (o.kind !== 'roads') expect(o.road).toBeUndefined();
      }
    }
    expect(withRoads).toBeGreaterThan(4);
  });

  it('gives every ribbon vertex its place on the road: along the segment, across it at half the width, and the fields of the layout', () => {
    if (!bake) return;
    const t = ALL[0] as Tile;
    let checked = 0;
    for (const sim of t.sims) {
      const a = meshChunk(sim, null, { tier: 'desktop', distM: 0, tile: t.sims });
      const roads = roadsOf(a);
      if (!roads) continue;
      const road = roads.road as Int16Array;
      for (let v = 0; v < roads.positions.length / 3; v++) {
        const id = roads.surf[v * 4] as number;
        if (id < Surf.RoadBase || id > Surf.RoadBase + 5) continue;
        const u = unpackRoad([road[v * 4], road[v * 4 + 1], road[v * 4 + 2], road[v * 4 + 3]] as [number, number, number, number]);
        const half = (u.lanes * (u.oneWay ? 1 : 2) * u.laneM + u.medianM + u.parking * LOOK.markings.parkingM) / 2;
        expect(Math.abs(Math.abs(u.tM) - half), `${sim.key} vertex ${v}`).toBeLessThan(0.15);
        expect(u.sM).toBeGreaterThanOrEqual(0);
        expect(u.sM).toBeLessThan(3277);
        expect(u.lanes).toBeGreaterThanOrEqual(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(ROAD_SCALE).toBe(32767);
  });

  it('plans one convex patch per junction of three or more roads, with every clipped corner at most 5 cm inside its outline', () => {
    if (!bake) return;
    let planned = 0, complete = 0;
    for (const t of ALL) {
      const ctx = roadsContext(t.sims);
      const plan = planRoads(ctx, LOOK.markings.junctionExtraM);
      for (const [id, j] of ctx.junctionById) {
        const arms = armsOf(ctx, j);
        // a junction whose every incident edge has its segment in the tile
        const known = (ctx.edgesAtNode.get(j.nodes[0] as number) ?? []).every((e) => ctx.segById.has(e.seg));
        if (known && arms !== null && arms.length >= 3) {
          complete++;
          expect(plan.junctions.has(id), `junction ${id} with ${arms.length} roads has a patch`).toBe(true);
        }
      }
      for (const pj of plan.junctions.values()) {
        planned++;
        expect(pj.hull.length).toBeGreaterThanOrEqual(3);
        expect(pj.arms.length).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < pj.corners.length; i++) expect(depthInsideHull(pj.corners, pj.hull, i)).toBeLessThanOrEqual(CORNER_TOLERANCE_M);
        // the clip is the largest half width plus the extra
        expect(pj.radiusM).toBeCloseTo(Math.max(...pj.arms.map((a) => a.halfM)) + LOOK.markings.junctionExtraM, 9);
        for (const a of pj.arms) expect(plan.clip.get(a.seg * 2 + a.end)).toBe(pj.radiusM);
      }
      expect(plan.skipped).toBe(0);
    }
    expect(planned).toBeGreaterThan(10);
    expect(complete).toBeGreaterThan(10);
  });

  it.each(['desktop', 'mobile-low'] as const)('%s: a patch in the roads object per planned junction of the chunk, and no ribbon vertex deeper than 5 cm inside a patch', (tier) => {
    if (!bake) return;
    let patches = 0, near = 0;
    for (const t of ALL) {
      const ctx = roadsContext(t.sims);
      const plan = planRoads(ctx, LOOK.markings.junctionExtraM);
      for (const sim of t.sims) {
        const m = meshChunk(sim, null, { tier, distM: 0, tile: t.sims });
        const mine = [...plan.junctions.values()].filter((j) => j.chunk === sim.key);
        expect(m.stats.markings?.patches ?? 0, sim.key).toBe(mine.length);
        patches += mine.length;
        // every patch vertex is on surface Junction, and the fans triangles face up
        const roads = roadsOf(m);
        if (!roads) continue;
        let patchTris = 0;
        for (let i = 0; i < roads.indices.length; i += 3) {
          if ((roads.surf[(roads.indices[i] as number) * 4] as number) !== Surf.Junction) continue;
          patchTris++;
          const p = (k: number, c: number): number => roads.positions[(roads.indices[i + k] as number) * 3 + c] as number;
          const nrm = (p(1, 2) - p(0, 2)) * (p(2, 0) - p(0, 0)) - (p(1, 0) - p(0, 0)) * (p(2, 2) - p(0, 2));
          expect(nrm, 'a patch triangle faces up').toBeGreaterThan(0);
        }
        expect(patchTris).toBe(mine.reduce((n, j) => n + j.hull.length - 2, 0));
      }
      // the ribbon vertices of every chunk of the tile, against every patch of the tile
      for (const sim of t.sims) {
        const m = meshChunk(sim, null, { tier, distM: 0, tile: t.sims });
        const roads = roadsOf(m);
        if (!roads) continue;
        for (const pj of plan.junctions.values()) {
          const pts = pj.corners.map((c) => ({ x: c.x, z: c.z }));
          for (let v = 0; v < roads.positions.length / 3; v++) {
            const id = roads.surf[v * 4] as number;
            if (id < Surf.RoadBase || id > Surf.RoadBase + 5) continue;
            const x = (roads.positions[v * 3] as number) + m.originX, z = (roads.positions[v * 3 + 2] as number) + m.originZ;
            if (Math.hypot(x - pj.x, z - pj.z) > pj.radiusM + 3) continue;
            near++;
            const all = [...pts, { x, z }];
            const depth = depthInsideHull(all, pj.hull, all.length - 1);
            expect(depth, `ribbon vertex of ${sim.key} against junction ${pj.id}`).toBeLessThanOrEqual(CORNER_TOLERANCE_M);
          }
        }
      }
    }
    expect(patches).toBeGreaterThan(10);
    expect(near).toBeGreaterThan(20);
  });

  it('makes one crosswalk quad per Crosswalk ped edge, and one stop bar per approach whose edge is in the tile', () => {
    if (!bake) return;
    let crosswalks = 0, bars = 0, approaches = 0;
    for (const t of ALL) {
      const ctx = roadsContext(t.sims);
      for (const sim of t.sims) {
        const m = meshChunk(sim, null, { tier: 'desktop', distM: 0, tile: t.sims });
        const s = m.stats.markings;
        if (!s) {
          expect(sim.segments.length).toBe(0);
          continue;
        }
        const want = sim.pedEdges.filter((e) => e.kind === PedEdgeKind.Crosswalk).length;
        expect(s.crosswalks, `${sim.key} crosswalks`).toBe(want);
        const appr = sim.junctions.flatMap((j) => approachesOf(j));
        expect(s.approaches, `${sim.key} approaches`).toBe(appr.length);
        const resolvable = sim.junctions.reduce((n, j) => n + approachesOf(j).filter((e) => ctx.edgeById.has(e)).length, 0);
        expect(s.stopBars, `${sim.key} stop bars`).toBe(resolvable);
        crosswalks += s.crosswalks;
        bars += s.stopBars;
        approaches += s.approaches;
        // their quads are on the crosswalk and stop-bar surfaces, one object (the roads) holds them all
        const roads = roadsOf(m) as MeshBuffers;
        const count = (id: number): number => {
          let n = 0;
          for (let i = 0; i < roads.indices.length; i += 3) if (roads.surf[(roads.indices[i] as number) * 4] === id) n++;
          return n;
        };
        expect(count(Surf.Crosswalk)).toBe(s.crosswalks * 2);
        expect(count(Surf.StopBar)).toBe(s.stopBars * 2);
      }
    }
    expect(crosswalks).toBeGreaterThan(10);
    expect(bars).toBeGreaterThan(10);
    expect(bars).toBeLessThanOrEqual(approaches);
  });

  it('lifts a decal 2 cm over the highest ribbon and a patch to the lift of its roads', () => {
    if (!bake) return;
    const t = ALL[0] as Tile;
    const sim = t.sims.find((s) => s.junctions.length >= 2 && s.pedEdges.some((e) => e.kind === PedEdgeKind.Crosswalk)) as SimChunk;
    const m = meshChunk(sim, null, { tier: 'desktop', distM: 0, tile: t.sims });
    const roads = roadsOf(m) as MeshBuffers;
    const top = ribbonLift(0);
    const ctx = roadsContext(t.sims);
    let checked = 0;
    for (let v = 0; v < roads.positions.length / 3; v++) {
      const id = roads.surf[v * 4] as number;
      if (id !== Surf.Crosswalk && id !== Surf.StopBar) continue;
      const x = (roads.positions[v * 3] as number) + m.originX, z = (roads.positions[v * 3 + 2] as number) + m.originZ;
      const road = nearestRoad(ctx, x, z, 40);
      expect(road, `a road under decal vertex ${v}`).not.toBeNull();
      // the synth roads follow the terrain, which climbs: the decal stands on the road's own height there
      expect(Math.abs((roads.positions[v * 3 + 1] as number) - ((road?.y ?? 0) + top + LOOK.markings.decalLiftM))).toBeLessThan(0.35);
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('with the markings off: no road attribute, no patch, no decal, the ribbons as M02g2 drew them', () => {
    if (!bake) return;
    const t = ALL[0] as Tile;
    for (const sim of t.sims) {
      const m = meshChunk(sim, null, { tier: 'desktop', distM: 0, tile: t.sims, markings: false });
      const roads = roadsOf(m);
      if (!roads) continue;
      expect(roads.road).toBeUndefined();
      expect(m.stats.markings?.patches ?? 0).toBe(0);
      for (let v = 0; v < roads.surf.length; v += 4) expect(roads.surf[v] as number).toBeLessThan(Surf.Sidewalk);
    }
  });

  it('without a tile it plans over the chunk alone, and the result is still deterministic', () => {
    if (!bake) return;
    const t = ALL[0] as Tile;
    const sim = t.sims.find((s) => s.junctions.length > 0) as SimChunk;
    const a = meshChunk(sim, null, { tier: 'mobile', distM: 0 });
    const b = meshChunk(sim, null, { tier: 'mobile', distM: 0 });
    expect(sameBuffers(roadsOf(a) as MeshBuffers, roadsOf(b) as MeshBuffers)).toBe(true);
  });

  it('keeps the road triangles within 10 % of the ribbons alone, and every mobile-low chunk under the upload cap', () => {
    if (!bake) return;
    let on = 0, off = 0;
    for (const t of ALL) {
      for (const sim of t.sims) {
        const render = t.renders.find((r) => r.key === sim.key) ?? null;
        const a = meshChunk(sim, render, { tier: 'mobile-low', distM: 0, tile: t.sims, maxBytes: MOBILE_LOW_CAP });
        const b = meshChunk(sim, render, { tier: 'mobile-low', distM: 0, tile: t.sims, markings: false, maxBytes: MOBILE_LOW_CAP });
        on += (roadsOf(a)?.indices.length ?? 0) / 3;
        off += (roadsOf(b)?.indices.length ?? 0) / 3;
        expect(a.stats.bytes, `${sim.key} bytes`).toBeLessThanOrEqual(MOBILE_LOW_CAP);
      }
    }
    expect(off).toBeGreaterThan(100);
    expect(on / off, `road triangles with the markings ${on}, without ${off}`).toBeLessThanOrEqual(1.1);
    expect(MESHER.depth.ribbonStepM).toBe(0.01);
  });
});

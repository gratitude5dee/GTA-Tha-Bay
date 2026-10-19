/**
 * S14 verify (02-world-bake.md section 4): the gates that read a FINISHED bake back from disk, so they also prove the packs.
 * `verifyBakeDir(dir)` decodes every p0 pack, `sf-graph.v1`, the world index and `transit-routes`, and returns the gate rows
 * that `runBake` appends to bake-report.json (stage S14); `map:verify` runs it again on any bake in dist/world.
 *
 * Gates: largest strongly connected component of the drivable edges; no edge with lanes 0; every signal junction has a
 * program with two or more phases; a route from the City Hall edge to every portal; edges per chunk, out-degree and road
 * grade; the chunk limits of contract rule 20; sf-graph.v1 against the p0 sums; the world index (landmarks, POIs, exactly 8
 * bay-rail nodes); the transit routes; and, for `sf` only, the hero edges of living part section 1.8. Thresholds that are
 * design values on `sf` (U-W15) stay in config/world/sources.json per area; each row carries its measured ratio.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  decodeGraph, decodeP0, enuFromLatLng, type PedEdge, type RoadEdge, type SimChunk, type WorldIndex, type Junction,
} from '../../../../packages/shared/src/index.ts';
import { loadSources, mapSchema, type AreaId, type SourcesConfig } from '../config.ts';
import type { ContentWorld } from '../content.ts';
import { loadBridges } from '../config.ts';
import { buildEdgeGraph, reachable, scc } from '../graph/route.ts';
import { sccReport } from '../graph/scc.ts';
import { resolveIn } from '../resolve.ts';
import type { TransitRoutes } from '../stages/s10-transit.ts';
import { EDGE_CHUNK_LIMIT, GRADE_LIMIT_PCT, type GateResult } from './gates.ts';

const row = (id: string, ok: boolean, detail: string, values?: Record<string, number>): GateResult => ({
  id, stage: 'S14', level: ok ? 'pass' : 'fail', detail, ...(values ? { values } : {}),
});

export interface DecodedBake {
  area: AreaId;
  sims: SimChunk[];
  index: WorldIndex;
  transit: TransitRoutes;
  report: Record<string, unknown>;
  graphBytes: Uint8Array;
}

export function loadBakeDir(dir: string): DecodedBake {
  const report = JSON.parse(readFileSync(path.join(dir, 'bake-report.json'), 'utf8')) as Record<string, unknown> & { area: AreaId };
  const sims: SimChunk[] = [];
  for (const name of readdirSync(path.join(dir, 'packs')).sort()) {
    if (name.startsWith('p0-')) sims.push(...decodeP0(readFileSync(path.join(dir, 'packs', name))));
  }
  return {
    area: report.area,
    sims,
    index: JSON.parse(readFileSync(path.join(dir, 'world-index.json'), 'utf8')) as WorldIndex,
    transit: JSON.parse(readFileSync(path.join(dir, 'transit-routes.json'), 'utf8')) as TransitRoutes,
    report,
    graphBytes: readFileSync(path.join(dir, 'packs', 'sf-graph.v1.pack')),
  };
}

export interface VerifyOptions { cfg?: SourcesConfig; content?: ContentWorld }

export function verifyBakeDir(dir: string, o: VerifyOptions = {}): GateResult[] {
  const cfg = o.cfg ?? loadSources();
  const b = loadBakeDir(dir);
  return verifyDecoded(b, cfg, o.content);
}

export function verifyDecoded(b: DecodedBake, cfg: SourcesConfig, content?: ContentWorld): GateResult[] {
  const g14 = cfg.areas[b.area].gates.s14;
  const out: GateResult[] = [];
  const edges: RoadEdge[] = [];
  const junctions: Junction[] = [];
  const nodeJunction = new Map<number, number>();
  const segLen = new Map<number, number>();
  for (const c of b.sims) {
    edges.push(...c.edges);
    junctions.push(...c.junctions);
    for (const n of c.nodes) nodeJunction.set(n.id, n.junction);
    for (const s of c.segments) segLen.set(s.id, s.lengthM);
  }
  edges.sort((a, c) => a.id - c.id);
  const graph = decodeGraph(b.graphBytes);

  // graph against the packs
  let lenBad = 0;
  for (const e of edges) {
    const ge = graph.edges[e.id];
    const l = segLen.get(e.seg);
    if (!ge || ge.from !== e.from || ge.to !== e.to || (l !== undefined && Math.abs(ge.lengthM - l) > 0.1)) lenBad++;
  }
  const nodeCount = b.sims.reduce((n, c) => n + c.nodes.length, 0);
  out.push(row('s14.graph-counts', graph.nodes.length === nodeCount && graph.edges.length === edges.length && lenBad === 0,
    `sf-graph.v1 holds ${graph.nodes.length} nodes and ${graph.edges.length} edges; the p0 packs hold ${nodeCount} and ${edges.length}; ${lenBad} edges disagree on ends or length by more than 0.1 m`, { nodes: nodeCount, edges: edges.length }));

  const outBy = new Map<number, number[]>();
  for (const e of edges) (outBy.get(e.from) ?? outBy.set(e.from, []).get(e.from)!).push(e.id);
  const eg = buildEdgeGraph(edges, junctions, (n) => nodeJunction.get(n) ?? -1, (e) => graph.edges[e.id]?.lengthM ?? 0, (n) => outBy.get(n) ?? []);

  // SCC
  const segInfo = new Map<number, { cnn: number; osmWay: number }>();
  for (const c of b.sims) for (const s of c.segments) segInfo.set(s.id, { cnn: s.cnn, osmWay: s.osmWay });
  const sr = sccReport(eg, edges, (e) => segInfo.get(e.seg) ?? { cnn: 0, osmWay: 0 });
  out.push(row('s14.scc', sr.fraction >= g14.sccMin, `largest strongly connected component holds ${sr.largest} of ${sr.edges} drivable edges (${(sr.fraction * 100).toFixed(2)} %), at least ${(g14.sccMin * 100).toFixed(0)} % required${sr.fraction < g14.sccMin ? `; strays: ${sr.stray.map((s) => `${s.edges} edges near cnn ${s.cnn} way ${s.osmWay}`).join('; ')}` : ''}`, { fraction: sr.fraction, edges: sr.edges, components: sr.components }));
  const noLanes = edges.filter((e) => e.lanes === 0).length;
  out.push(row('s14.lanes', noLanes === 0, `${noLanes} edges with lanes = 0`, { noLanes }));
  const badSignals = junctions.filter((j) => j.control === 1 && (!j.program || j.program.phases.length < 2)).length;
  out.push(row('s14.signals', badSignals === 0, `${junctions.filter((j) => j.control === 1).length} signal junctions, ${badSignals} without a program of at least 2 phases`, { bad: badSignals }));

  // City Hall edge and portal routes
  const city = resolveIn(b.sims, 0, 0, 120);
  const portals = b.index.portals;
  if (!city) out.push(row('s14.portal-routes', portals.length === 0, `no road within 120 m of City Hall (${portals.length} portals unchecked)`));
  else {
    const seen = reachable(eg, city.edge);
    const unreachable = portals.filter((p) => !p.edges.some((e) => seen[e] === 1)).map((p) => p.id);
    out.push(row('s14.portal-routes', unreachable.length === 0, `City Hall edge ${city.edge}: ${portals.length - unreachable.length} of ${portals.length} portals reachable${unreachable.length ? `; not reachable: ${unreachable.slice(0, 8).join(', ')}` : ''}`, { portals: portals.length, unreachable: unreachable.length }));
  }

  // limits
  let maxEdges = 0, maxOut = 0, maxGrade = 0, maxPed = 0, maxTag = 0;
  for (const c of b.sims) {
    maxEdges = Math.max(maxEdges, c.edges.length);
    maxPed = Math.max(maxPed, c.pedEdges.length);
    for (const l of Object.values(c.tags)) maxTag = Math.max(maxTag, (l as unknown[]).length);
  }
  for (const l of outBy.values()) maxOut = Math.max(maxOut, l.length);
  for (const e of edges) maxGrade = Math.max(maxGrade, e.maxGradePct);
  const maxBuildings = Number((b.report['buildings'] as { maxPerChunk?: number } | undefined)?.maxPerChunk ?? 0);
  out.push(row('s14.edges-per-chunk', maxEdges <= EDGE_CHUNK_LIMIT, `most edges in one chunk ${maxEdges}, limit ${EDGE_CHUNK_LIMIT}`, { max: maxEdges }));
  out.push(row('s14.out-degree', maxOut <= 8, `largest out-degree ${maxOut}, limit 8`, { max: maxOut }));
  out.push(row('s14.max-grade', maxGrade <= GRADE_LIMIT_PCT, `steepest edge ${maxGrade} %, limit ${GRADE_LIMIT_PCT} %`, { max: maxGrade }));
  out.push(row('s14.chunk-limits', maxBuildings <= 1500 && maxPed <= 1500 && maxTag <= 24, `per chunk: buildings ${maxBuildings}/1500, road edges ${maxEdges}/600, ped edges ${maxPed}/1500, tags per type ${maxTag}/24`, { buildings: maxBuildings, pedEdges: maxPed, tags: maxTag }));

  // world index
  const idx = b.index;
  if (g14.worldIndex) {
    const want = content?.landmarks.length ?? 37;
    const noArrival = idx.landmarks.filter((l) => !l.arrival || !Number.isFinite(l.arrival.x)).length;
    const bay = idx.transit.filter((t) => t.kind === 'bay-rail');
    out.push(row('s14.landmarks', idx.landmarks.length >= 25 && idx.landmarks.length === want && noArrival === 0, `${idx.landmarks.length} landmarks (at least 25, all ${want} seeds expected), ${noArrival} without an arrival pose`, { landmarks: idx.landmarks.length }));
    out.push(row('s14.pois', idx.pois.length >= 150, `${idx.pois.length} POIs, at least 150 required`, { pois: idx.pois.length }));
    out.push(row('s14.bay-rail', bay.length === 8 && bay.every((t) => t.fastTravel), `${bay.length} bay-rail transit nodes (exactly 8, all fastTravel)`, { count: bay.length }));
  }
  if (g14.transit) {
    const t = b.transit;
    const nEdges = graph.edges.length;
    const busBad = t.bus.filter((r) => r.edges.some((e) => e >= nEdges) || r.stops.some((s) => s.edge >= nEdges)).length;
    const busShort = t.bus.filter((r) => r.stops.length < 2).length;
    out.push(row('s14.transit-bus', t.bus.length >= 2 && busShort === 0 && busBad === 0, `${t.bus.length} bus patterns (at least 2), ${busShort} with fewer than 2 stops, ${busBad} naming an edge that is not in sf-graph.v1`, { patterns: t.bus.length }));
    out.push(row('s14.transit-metro', t.metro.length >= 1, `${t.metro.length} metro splines (at least 1)`, { metro: t.metro.length }));
    // ferry lines lie over water: interior samples on a post at or below sea level, or off the baked chunks
    let overWater = 0, samples = 0;
    const heightAt = (x: number, z: number): number | null => {
      const key = `9/${Math.floor((x + 65664) / 256)}/${Math.floor((z + 65664) / 256)}`;
      const c = b.sims.find((s) => s.key === key);
      if (!c) return null;
      const i = Math.round((x - c.height.originX) / 4), j = Math.round((z - c.height.originZ) / 4);
      return (c.height.dm[Math.min(64, Math.max(0, j)) * 65 + Math.min(64, Math.max(0, i))] as number) / 10;
    };
    for (const f of t.ferry) {
      const p = f.points;
      for (let i = 2; i + 3 < p.length; i += 2) {
        for (let k = 1; k <= 4; k++) {
          const x = (p[i] as number) + (((p[i + 2] as number) - (p[i] as number)) * k) / 5, z = (p[i + 1] as number) + (((p[i + 3] as number) - (p[i + 1] as number)) * k) / 5;
          samples++;
          const h = heightAt(x, z);
          if (h === null || h <= 0.5) overWater++;
        }
      }
    }
    out.push(row('s14.transit-ferry', t.ferry.length >= 1 && samples > 0 && overWater / samples >= 0.8, `${t.ferry.length} ferry lines, ${overWater} of ${samples} interior samples over water posts`, { ferry: t.ferry.length }));
    out.push(row('s14.transit-air', t.air.length === 3, `${t.air.length} air corridors (exactly 3)`, { air: t.air.length }));
    if (g14.cablecars) out.push(row('s14.transit-cablecar', t.cablecar.length >= 1, `${t.cablecar.length} cable-car splines (at least 1 on sf)`, { cablecar: t.cablecar.length }));
  }
  const trErr = mapSchema('transit-routes')(b.transit);
  out.push(row('s14.transit-schema', trErr.length === 0, trErr.length === 0 ? 'transit-routes.json validates against transit-routes.schema.json' : trErr.slice(0, 5).join('; ')));

  // hero edges (sf only)
  if (g14.heroEdges) {
    const scc2 = scc(eg);
    const bad: string[] = [];
    for (const h of loadBridges().hero) {
      const e = enuFromLatLng(h.lat, h.lng);
      const r = resolveIn(b.sims, e.x, e.z, h.maxM);
      if (!r) { bad.push(`${h.id} (no road within ${h.maxM} m)`); continue; }
      if (scc2.comp[r.edge] !== scc2.largest) bad.push(`${h.id} (edge ${r.edge} outside the main component)`);
    }
    out.push(row('s14.hero-edges', bad.length === 0, bad.length === 0 ? 'hero edges are drivable and connected' : `hero edges failing: ${bad.join('; ')}`, { bad: bad.length }));
  }
  void existsSync;
  void (null as unknown as PedEdge);
  return out;
}

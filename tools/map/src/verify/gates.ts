/**
 * Bake gates of the stages in M02a1 (02-world-bake.md section 4): S0 row counts, S2 terrain, S3 land/union ratio, S4
 * building counts, S13 pack sizes and key-like strings. Parameters come from config/world/sources.json per area. Pure:
 * every function takes numbers and returns GateResult rows; a `fail` row fails the bake.
 */
import { scanText } from '../../../ci/check-secrets.ts';
import type { AreaGates } from '../config.ts';
import type { RawLockFile } from '../raw-lock.ts';
import type { BuildingsReport } from '../stages/s4-buildings.ts';
import type { TerrainStats } from '../stages/s2-terrain.ts';
import type { WaterGate } from '../stages/s3-water.ts';
import type { RoadsReport } from '../stages/s5-roads.ts';
import type { JunctionsReport } from '../stages/s6-junctions.ts';
import type { GradingStats } from '../stages/s7-grading.ts';
import type { PedReport } from '../stages/s8-ped.ts';
import type { TagsReport } from '../stages/s9-tags.ts';
import type { PlacesReport } from '../stages/s10-places.ts';
import type { DistrictGridReport } from '../stages/s12-district-grid.ts';

export interface GateResult {
  id: string;
  stage: 'S0' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S11' | 'S12' | 'S13' | 'S14';
  level: 'pass' | 'fail' | 'warn';
  detail: string;
  /** Numbers worth keeping in bake-report.json. */
  values?: Record<string, number>;
}

const row = (id: string, stage: GateResult['stage'], ok: boolean, detail: string, values?: Record<string, number>): GateResult => ({
  id, stage, level: ok ? 'pass' : 'fail', detail, ...(values ? { values } : {}),
});

export function s0Gates(lock: RawLockFile, g: AreaGates['s0']): GateResult[] {
  const out: GateResult[] = [];
  const rows = new Map(lock.sources.map((s) => [s.id, s.rows]));
  for (const [id, min] of Object.entries(g.minRows).sort()) {
    const n = rows.get(id);
    out.push(row(`s0.rows.${id}`, 'S0', n !== undefined && n >= min, `${id}: ${n ?? 'missing'} rows, at least ${min} required`, { rows: n ?? 0, min }));
  }
  for (const [id, exact] of Object.entries(g.exactRows).sort()) {
    const n = rows.get(id);
    out.push(row(`s0.exact.${id}`, 'S0', n === exact, `${id}: ${n ?? 'missing'} rows, exactly ${exact} required`, { rows: n ?? 0, exact }));
  }
  return out;
}

export function s2Gates(s: TerrainStats, g: AreaGates['s2']): GateResult[] {
  const [lo, hi] = g.cityHallM;
  const ch = s.cityHallM;
  return [
    row('s2.city-hall', 'S2', ch !== null && ch >= lo && ch <= hi, `City Hall height ${ch === null ? 'unavailable' : `${ch.toFixed(2)} m`}, ${lo}-${hi} m required`, { cityHallM: ch ?? Number.NaN }),
    row('s2.min', 'S2', s.minM >= g.minM, `minimum ${s.minM.toFixed(1)} m, at least ${g.minM} m required`, { minM: s.minM }),
    row('s2.edges', 'S2', s.edgeMismatches === 0, `${s.edgeMismatches} shared edge posts differ`, { mismatches: s.edgeMismatches }),
    row('s2.coverage', 'S2', s.missingPixels === 0, `${s.missingPixels} Terrarium pixels read outside the fetched tiles`, { missing: s.missingPixels }),
  ];
}

export function s3Gates(w: WaterGate, g: AreaGates['s3']): GateResult[] {
  const ok = w.unionKm2 > 0 && Math.abs(w.ratio - 1) <= g.landRatioTolerance;
  return [
    row('s3.land-union', 'S3', ok, `area(land ∩ union) / area(union) = ${w.ratio.toFixed(4)}, within ±${g.landRatioTolerance} of 1 required`, {
      ratio: w.ratio, unionKm2: w.unionKm2, landInUnionKm2: w.landInUnionKm2,
    }),
    { id: 's3.land-outside-union', stage: 'S3', level: 'pass', detail: `area(land \\ union) = ${w.landOutsideUnionKm2.toFixed(3)} km² (reported, not gated)`, values: { landOutsideUnionKm2: w.landOutsideUnionKm2 } },
  ];
}

export function s4Gates(r: BuildingsReport, g: AreaGates['s4'], limit: number): GateResult[] {
  const frac = r.rows === 0 ? 0 : r.baked / r.rows;
  const osmFrac = r.records === 0 ? 0 : r.osm.added / r.records;
  return [
    row('s4.baked', 'S4', r.rows > 0 && frac >= g.minBakedFraction, `${r.baked} of ${r.rows} DataSF rows baked (${(frac * 100).toFixed(2)} %), at least ${(g.minBakedFraction * 100).toFixed(0)} % required; dropped ${JSON.stringify(r.droppedReasons)}`, { baked: r.baked, rows: r.rows, fraction: frac }),
    row('s4.osm', 'S4', osmFrac <= g.maxOsmFraction, `${r.osm.added} OSM additions (${(osmFrac * 100).toFixed(2)} % of ${r.records}), at most ${(g.maxOsmFraction * 100).toFixed(0)} % allowed`, { added: r.osm.added, fraction: osmFrac }),
    row('s4.chunk-limit', 'S4', r.overLimit.length === 0, `most buildings in one chunk: ${r.maxPerChunk}, limit ${limit}${r.overLimit.length ? `; over: ${r.overLimit.join(', ')}` : ''}`, { maxPerChunk: r.maxPerChunk }),
  ];
}

export const EDGE_CHUNK_LIMIT = 600;
export const GRADE_LIMIT_PCT = 40;
export const SLAB_STEP_LIMIT_M = 0.16;

export function s5Gates(r: RoadsReport, minAgreement: number): GateResult[] {
  const o = r.oneway;
  const out: GateResult[] = [
    row('s5.oneway', 'S5', o.ok,
      o.comparable === 0 ? 'no matched one-way pieces to compare (DataSF F/T vs OSM)' : `DataSF F/T agreement with OSM on ${o.comparable} matched pieces: F-along ${(o.ratio1 * 100).toFixed(1)} %, F-against ${(o.ratio2 * 100).toFixed(1)} %; adopted ${o.adopted}; more than ${(minAgreement * 100).toFixed(0)} % required; DataSF one-way applied to ${o.applied} named two-way STREETS pieces, ${o.osmKept} OSM one-ways kept (${o.osmKeptAgainstDsf} against DataSF), ${o.unnamedSkipped} unnamed pieces and ${o.otherLayerSkipped} other-layer pieces took none (DL-705)`,
      { comparable: o.comparable, ratioAlong: o.ratio1, ratioAgainst: o.ratio2, applied: o.applied, osmKept: o.osmKept, osmKeptAgainstDsf: o.osmKeptAgainstDsf, unnamedSkipped: o.unnamedSkipped }),
    row('s5.edges-per-chunk', 'S5', r.maxEdgesPerChunk <= EDGE_CHUNK_LIMIT, `most edges owned by one chunk: ${r.maxEdgesPerChunk}, limit ${EDGE_CHUNK_LIMIT}`, { maxPerChunk: r.maxEdgesPerChunk }),
  ];
  const isl = r.islands;
  out.push({
    id: 's5.islands', stage: 'S5', level: 'pass',
    detail: `weakly detached fragments (DL-706): ${isl.droppedComponents} dropped by the declared rules (${isl.droppedEdges} edges), ${isl.keptComponents} kept in the graph and the SCC count (${isl.keptEdges} edges); keepWays applied ${isl.keepWaysApplied.length}, connectors ${isl.connectorsApplied.length}`,
    values: { droppedEdges: isl.droppedEdges, keptEdges: isl.keptEdges, keptComponents: isl.keptComponents },
  });
  if (r.unknownLayers.length > 0) out.push({ id: 's5.layers', stage: 'S5', level: 'warn', detail: `DataSF layer values not in the N2 list: ${r.unknownLayers.join(', ')}` });
  return out;
}

export function s6Gates(r: JunctionsReport, signalMin: number): GateResult[] {
  return [
    row('s6.signal-programs', 'S6', r.signalNoProgram === 0, `${r.signalNoProgram} signal junctions without a program`, { noProgram: r.signalNoProgram }),
    row('s6.signal-match', 'S6', r.signalMatch.ratio >= signalMin, `${r.signalMatch.matched} of ${r.signalMatch.total} OSM signal nodes within 25 m of a junction (${(r.signalMatch.ratio * 100).toFixed(2)} %), at least ${(signalMin * 100).toFixed(0)} % required`, { ratio: r.signalMatch.ratio, total: r.signalMatch.total }),
    row('s6.approaches', 'S6', r.maxApproaches <= 8 && r.maxOutDegree <= 8, `most approaches ${r.maxApproaches}, largest out-degree ${r.maxOutDegree}, limit 8`, { maxApproaches: r.maxApproaches, maxOutDegree: r.maxOutDegree }),
    row('s6.junction-ids', 'S6', r.junctions <= 32767, `${r.junctions} junctions, RoadNode.junction is an i16`, { junctions: r.junctions }),
  ];
}

export function s7Gates(s: GradingStats): GateResult[] {
  return [
    row('s7.grade', 'S7', s.maxGradePct <= GRADE_LIMIT_PCT, `steepest road ${s.maxGradePct} %, limit ${GRADE_LIMIT_PCT} %`, { maxGradePct: s.maxGradePct }),
    row('s7.slab-steps', 'S7', s.maxSlabStepM <= SLAB_STEP_LIMIT_M + 1e-9, `largest step between slab tops ${s.maxSlabStepM.toFixed(2)} m over ${s.slabs} slabs, limit ${SLAB_STEP_LIMIT_M} m`, { maxStepM: s.maxSlabStepM, slabs: s.slabs }),
    row('s7.deck-chunks', 'S7', s.slabsDropped === 0, `${s.slabsDropped} slabs or hoods over a chunk without terrain`, { dropped: s.slabsDropped }),
  ];
}

export function s8Gates(r: PedReport): GateResult[] {
  const out: GateResult[] = [row('s8.chunk-limit', 'S8', r.overLimit.length === 0, `most ped edges in one chunk: ${r.maxEdgesPerChunk}, limit 1500${r.overLimit.length ? `; over: ${r.overLimit.join(', ')}` : ''}`, { maxPerChunk: r.maxEdgesPerChunk })];
  out.push(r.tilesBelow85.length === 0
    ? { id: 's8.connectivity', stage: 'S8', level: 'pass', detail: `largest component holds at least ${(r.minTileFraction * 100).toFixed(1)} % of the nodes in every tile`, values: { minFraction: r.minTileFraction } }
    : { id: 's8.connectivity', stage: 'S8', level: 'warn', detail: `${r.tilesBelow85.length} tiles below 85 %: ${r.tilesBelow85.slice(0, 8).map((x) => `${x.tile} ${(x.fraction * 100).toFixed(0)} %`).join(', ')}` });
  return out;
}

export function s9Gates(r: TagsReport): GateResult[] {
  const thinned = Object.entries(r.thinned).sort(([a], [b]) => (a < b ? -1 : 1));
  const out: GateResult[] = [];
  out.push(thinned.length === 0
    ? { id: 's9.tag-limit', stage: 'S9', level: 'pass', detail: 'no chunk holds more than 24 records of any tag type' }
    : { id: 's9.tag-limit', stage: 'S9', level: 'warn', detail: `thinned to the limit of 24 per chunk: ${thinned.map(([k, v]) => `${k} -${v}`).join(', ')}` });
  if (r.breakersDropped.length > 0) out.push({ id: 's9.breakers', stage: 'S9', level: 'warn', detail: `${r.breakersDropped.length} pursuit breakers more than 12 m from a road: ${r.breakersDropped.join(', ')}` });
  if (r.portalsMissing.length > 0) out.push({ id: 's9.portals', stage: 'S9', level: 'warn', detail: `portal seeds with no road within reach: ${r.portalsMissing.join(', ')}` });
  return out;
}

/** S12: the district grid names only known neighbourhoods and assigns at least one cell (every index 0 to 40 or 255 holds by construction). */
export function s12Gates(r: DistrictGridReport): GateResult[] {
  return [
    row('s12.district-names', 'S12', r.unknownNames.length === 0, r.unknownNames.length === 0 ? `every neighbourhood polygon is one of the 41 Analysis Neighborhoods` : `polygons that are not one of the 41: ${r.unknownNames.join(', ')}`, { unknown: r.unknownNames.length }),
    row('s12.district-cells', 'S12', r.assigned > 0, `${r.assigned} of ${r.cells} cells (${r.cols} x ${r.rows}) belong to ${r.nhoodsPresent} neighbourhoods`, { assigned: r.assigned, cells: r.cells, nhoods: r.nhoodsPresent }),
  ];
}

export function s10Gates(r: PlacesReport, requireFeature: boolean): GateResult[] {
  const out: GateResult[] = [
    row('s10.arrival', 'S10', r.noArrival.length === 0, r.noArrival.length === 0 ? `${r.landmarks} landmarks have an arrival pose on ground` : `no arrival pose within 120 m for ${r.noArrival.join(', ')}`, { landmarks: r.landmarks }),
  ];
  if (r.featureTooFar.length > 0) {
    out.push({ id: 's10.feature', stage: 'S10', level: requireFeature ? 'fail' : 'warn', detail: `landmark seeds more than 120 m from their OSM feature: ${r.featureTooFar.map((x) => `${x.id} ${x.distM} m`).join(', ')}` });
  }
  if (r.arrivalFar.length > 0) {
    out.push({ id: 's10.arrival-far', stage: 'S10', level: 'warn', detail: `arrival pose farther than 120 m from the landmark (the nearest valid pedestrian node at any distance): ${r.arrivalFar.map((x) => `${x.id} ${x.distM} m at (${x.x}, ${x.z})`).join(', ')}` });
  }
  if (r.featureMissing.length > 0 && requireFeature) out.push({ id: 's10.feature-missing', stage: 'S10', level: 'warn', detail: `OSM features not in the extract: ${r.featureMissing.join(', ')}` });
  return out;
}

export interface OutputFile { name: string; bytes: Uint8Array }

export function s13Gates(packs: readonly { name: string; bytes: number }[], files: readonly OutputFile[], g: AreaGates['s13']): GateResult[] {
  const out: GateResult[] = [];
  const over = packs.filter((p) => p.bytes > g.packMaxBytes);
  const warn = packs.filter((p) => p.bytes > g.packWarnBytes && p.bytes <= g.packMaxBytes);
  const biggest = packs.reduce((m, p) => Math.max(m, p.bytes), 0);
  out.push(row('s13.pack-size', 'S13', over.length === 0, `${packs.length} packs, largest ${biggest} B, limit ${g.packMaxBytes} B${over.length ? `; over: ${over.map((p) => p.name).join(', ')}` : ''}`, { packs: packs.length, largest: biggest }));
  if (warn.length > 0) out.push({ id: 's13.pack-warn', stage: 'S13', level: 'warn', detail: `${warn.length} packs above ${g.packWarnBytes} B: ${warn.map((p) => p.name).join(', ')}` });
  const hits: string[] = [];
  for (const f of files) for (const h of scanText(Buffer.from(f.bytes).toString('latin1'), f.name)) hits.push(`${h.file}:${h.line} ${h.pattern}`);
  out.push(row('s13.no-keys', 'S13', hits.length === 0, hits.length ? `key-like strings: ${hits.join(', ')}` : `no key-like strings in ${files.length} outputs`));
  return out;
}

export const failed = (rs: readonly GateResult[]): GateResult[] => rs.filter((r) => r.level === 'fail');

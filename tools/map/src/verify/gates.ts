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

export interface GateResult {
  id: string;
  stage: 'S0' | 'S2' | 'S3' | 'S4' | 'S13';
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

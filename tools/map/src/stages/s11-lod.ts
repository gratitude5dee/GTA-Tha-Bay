/**
 * S11 LOD packs (02-world.md section 5.3, contract section 4 table rows 1 and 30 to 32; moved here from M02b1, DL-546).
 *
 *   l1  family 2, host z=5 block (4,096 m) of 16 z=7 tiles: HEIGHT at 16 m posts, MASSING (rings simplified with DP 3 m, no
 *       building under 6 m outside districts d1 and d5), ROADLINE (class 4 and better, DP 4 m), LANDUSE (DP 8 m)
 *   l2  family 3, host z=3 region (16,384 m) of 16 z=5 blocks: HEIGHT at 64 m posts, MASSING (buildings of 20 m and more, DP 6 m),
 *       ROADLINE (class 2 and better, DP 12 m), LANDUSE (DP 16 m)
 *
 * Layout clarifications (BD-M02a2-08, proposed to the Architect): the units of an l1/l2 pack are z=7 tiles / z=5 blocks keyed by
 * their (cx, cy) cell in the host; every coordinate is an i16 in 0.1 m relative to the unit CENTRE (an l2 unit is 4,096 m wide,
 * which would not fit i16 from the corner); LANDUSE class codes are the C08 LANDUSE_ORDER index (grass 3, park 4, sand 5, plaza 6,
 * rock 7) plus 8 for land outline polygons; the MASSING record is the BUILDING record with proxyOf 0.
 */
import { GRID_MIN_M, TERRAIN_POSTS, type ChunkKey } from '../../../../packages/shared/src/index.ts';
import { simplifyPolyline, simplifyRing } from '../geom/dp.ts';
import { ringBbox, clipRingToBox, ccwArea, forceCcw, type Bbox } from '../geom/rings.ts';
import { assemble, Bytes, type ChunkOut, type SectionOut } from '../pack/encode.ts';
import type { AreaGrid } from '../config.ts';
import { LANDUSE_ORDER, type LandusePoly } from './s3-water.ts';
import type { BuildingsProduct } from './s4-buildings.ts';
import type { SegB } from './s5-roads.ts';
import type { TerrainField } from './s2-terrain.ts';

export const L1 = { family: 2, hostZ: 5, unitM: 1024, postM: 16, massDp: 3, roadDp: 4, landDp: 8, roadMaxCls: 4, minHeightDm: 60 } as const;
export const L2 = { family: 3, hostZ: 3, unitM: 4096, postM: 64, massDp: 6, roadDp: 12, landDp: 16, roadMaxCls: 2, minHeightDm: 200 } as const;
export const SEC_MASSING = 30, SEC_ROADLINE = 31, SEC_LANDUSE = 32, SEC_HEIGHT = 1;
export const LAND_CLASS = 8;
export const DEEP_M = -20;

export interface LodInputs {
  bakeId: string;
  grid: AreaGrid;
  terrain: TerrainField;
  landRings: readonly number[][];
  landuse: readonly LandusePoly[];
  buildings: BuildingsProduct;
  segs: readonly SegB[];
  /** District id at a point (d1 .. d10, outer, stage) or null. */
  districtAt(x: number, z: number): string | null;
}
export interface LodFile { name: string; family: 'l1' | 'l2'; x: number; y: number; units: number; bytes: Uint8Array }
export interface LodReport { l1Packs: number; l2Packs: number; l1Units: number; l2Units: number; l1Massing: number; l2Massing: number; roadLines: number; largest: number }

type Level = typeof L1 | typeof L2;
const q = (v: number): number => Math.round(v * 10);

/** Simplifies a ring to at most 255 vertices. */
function fitRing(r: number[], tol: number): number[] {
  let t = tol;
  let s = simplifyRing(r, t);
  while (s.length / 2 > 255) { t *= 1.5; s = simplifyRing(r, t); }
  return s;
}
function fitLine(r: number[], tol: number): number[] {
  let t = tol;
  let s = simplifyPolyline(r, t);
  while (s.length / 2 > 255) { t *= 1.5; s = simplifyPolyline(r, t); }
  return s;
}

function unitSections(lv: Level, ux: number, uy: number, inp: LodInputs, masses: Map<string, MassRec[]>, lines: Map<string, LineRec[]>, rep: LodReport): SectionOut[] {
  const x0 = GRID_MIN_M + ux * lv.unitM, z0 = GRID_MIN_M + uy * lv.unitM;
  const cx = x0 + lv.unitM / 2, cz = z0 + lv.unitM / 2;
  const box: Bbox = { minX: x0, minZ: z0, maxX: x0 + lv.unitM, maxZ: z0 + lv.unitM };
  const out: SectionOut[] = [];
  let w = new Bytes();
  for (let j = 0; j < TERRAIN_POSTS; j++) {
    for (let i = 0; i < TERRAIN_POSTS; i++) {
      const h = inp.terrain.heightAt(Math.min(box.maxX - 1e-6, x0 + i * lv.postM), Math.min(box.maxZ - 1e-6, z0 + j * lv.postM)) ?? DEEP_M;
      w.i16(Math.max(-32767, Math.min(32767, q(h))));
    }
  }
  out.push({ id: SEC_HEIGHT, count: 1, data: w.bytes() });

  const key = `${ux},${uy}`;
  const ms = masses.get(key) ?? [];
  w = new Bytes();
  for (const m of ms) {
    w.i16(m.baseDm); w.u16(m.heightDm); w.u8(m.kind); w.u8((m.roof << 6) | m.palette); w.u16(m.seed); w.u8(0); w.u8(m.ring.length / 2);
    for (let k = 0; k < m.ring.length; k += 2) { w.i16(q((m.ring[k] as number) - cx)); w.i16(q((m.ring[k + 1] as number) - cz)); }
  }
  out.push({ id: SEC_MASSING, count: ms.length, data: w.bytes() });

  const ls = lines.get(key) ?? [];
  w = new Bytes();
  for (const l of ls) {
    w.u8(l.cls); w.u8(l.pts.length / 2);
    for (let k = 0; k < l.pts.length; k += 2) { w.i16(q((l.pts[k] as number) - cx)); w.i16(q((l.pts[k + 1] as number) - cz)); }
  }
  out.push({ id: SEC_ROADLINE, count: ls.length, data: w.bytes() });
  rep.roadLines += ls.length;

  w = new Bytes();
  let n = 0;
  const emit = (cls: number, ring: number[]): void => {
    const clipped = clipRingToBox(ring, box);
    if (clipped.length < 6) return;
    const s = fitRing(clipped, lv.landDp);
    if (s.length < 6 || Math.abs(ccwArea(s)) < lv.landDp * lv.landDp) return;
    w.u8(cls); w.u8(s.length / 2);
    for (let k = 0; k < s.length; k += 2) { w.i16(q((s[k] as number) - cx)); w.i16(q((s[k + 1] as number) - cz)); }
    n++;
  };
  for (const u of inp.landuse) {
    const idx = LANDUSE_ORDER.indexOf(u.cls);
    if (idx < 3) continue;   // residential, commercial and industrial are building-kind hints only
    const outer = u.rings[0] as number[];
    const bb = ringBbox(outer);
    if (bb.maxX < box.minX || bb.minX > box.maxX || bb.maxZ < box.minZ || bb.minZ > box.maxZ) continue;
    emit(idx, outer);
  }
  for (const r of inp.landRings) {
    const bb = ringBbox(r);
    if (bb.maxX < box.minX || bb.minX > box.maxX || bb.maxZ < box.minZ || bb.minZ > box.maxZ) continue;
    emit(LAND_CLASS, forceCcw(r));
  }
  out.push({ id: SEC_LANDUSE, count: n, data: w.bytes() });
  return out;
}

interface MassRec { baseDm: number; heightDm: number; kind: number; roof: number; palette: number; seed: number; ring: number[] }
interface LineRec { cls: number; pts: number[] }

export function runLod(inp: LodInputs): { files: LodFile[]; report: LodReport } {
  const rep: LodReport = { l1Packs: 0, l2Packs: 0, l1Units: 0, l2Units: 0, l1Massing: 0, l2Massing: 0, roadLines: 0, largest: 0 };
  const files: LodFile[] = [];
  const chunkKeys = new Set<ChunkKey>();
  for (const k of inp.buildings.byChunk.keys()) chunkKeys.add(k);
  const haveChunk = (ux: number, uy: number, lv: Level): boolean => {
    const per = lv.unitM / 256;
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) if (inp.terrain.grids.has(`9/${ux * per + i}/${uy * per + j}` as ChunkKey)) return true;
    return false;
  };

  for (const lv of [L1, L2]) {
    const masses = new Map<string, MassRec[]>();
    const lines = new Map<string, LineRec[]>();
    const unitOf = (x: number, z: number): [number, number] => [Math.floor((x - GRID_MIN_M) / lv.unitM), Math.floor((z - GRID_MIN_M) / lv.unitM)];
    // buildings
    for (const list of [...inp.buildings.byChunk.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, l]) => l)) {
      for (const b of list) {
        if (lv === L2 && b.heightDm < L2.minHeightDm) continue;
        const ring = b.prism;
        let sx = 0, sz = 0;
        for (let i = 0; i < ring.length; i += 2) { sx += ring[i] as number; sz += ring[i + 1] as number; }
        const mx = sx / (ring.length / 2), mz = sz / (ring.length / 2);
        if (lv === L1 && b.heightDm < L1.minHeightDm) {
          const d = inp.districtAt(mx, mz);
          if (d !== 'd1' && d !== 'd5') continue;
        }
        let s = simplifyRing(ring, lv.massDp);
        for (let tol = lv.massDp * 1.5; s.length / 2 > 28 && tol < 64; tol *= 1.5) s = simplifyRing(ring, tol);
        if (s.length < 6) continue;
        const rounded = s;
        const [ux, uy] = unitOf(mx, mz);
        const key = `${ux},${uy}`;
        const l = masses.get(key) ?? [];
        l.push({ baseDm: b.baseDm, heightDm: b.heightDm, kind: b.kind, roof: b.roof, palette: b.palette, seed: b.seed, ring: rounded.map((v) => Math.round(v * 10) / 10) });
        masses.set(key, l);
        if (lv === L1) rep.l1Massing++; else rep.l2Massing++;
      }
    }
    // road lines
    for (const s of inp.segs) {
      if (s.cls > lv.roadMaxCls) continue;
      const mid = s.pts.length / 4;
      const mi = Math.floor(mid) * 2;
      const [ux, uy] = unitOf(s.pts[mi] as number, s.pts[mi + 1] as number);
      const pts = fitLine(s.pts, lv.roadDp).map((v) => Math.round(v * 10) / 10);
      const key = `${ux},${uy}`;
      const l = lines.get(key) ?? [];
      l.push({ cls: s.cls, pts });
      lines.set(key, l);
    }
    for (const l of lines.values()) l.sort((a, b) => a.cls - b.cls || (a.pts[0] as number) - (b.pts[0] as number) || (a.pts[1] as number) - (b.pts[1] as number));
    for (const l of masses.values()) l.sort((a, b) => (a.ring[0] as number) - (b.ring[0] as number) || (a.ring[1] as number) - (b.ring[1] as number) || a.heightDm - b.heightDm);

    // units that exist, grouped into host packs
    const units: [number, number][] = [];
    const perUnit = lv.unitM / 256;
    const seen = new Set<string>();
    for (const k of inp.terrain.grids.keys()) {
      const [, cx, cy] = k.split('/').map(Number) as [number, number, number];
      const ux = Math.floor(cx / perUnit), uy = Math.floor(cy / perUnit);
      const id = `${ux},${uy}`;
      if (!seen.has(id)) { seen.add(id); units.push([ux, uy]); }
    }
    units.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const hosts = new Map<string, [number, number][]>();
    for (const u of units) {
      if (!haveChunk(u[0], u[1], lv)) continue;
      const hx = Math.floor(u[0] / 4), hy = Math.floor(u[1] / 4);
      const l = hosts.get(`${hx},${hy}`) ?? [];
      l.push(u);
      hosts.set(`${hx},${hy}`, l);
    }
    for (const [hk, us] of [...hosts.entries()].sort(([a], [b]) => { const [ax, ay] = a.split(',').map(Number) as [number, number]; const [bx, by] = b.split(',').map(Number) as [number, number]; return ay - by || ax - bx; })) {
      const [hx, hy] = hk.split(',').map(Number) as [number, number];
      const chunks: ChunkOut[] = us.map(([ux, uy]) => ({ cx: ux - hx * 4, cy: uy - hy * 4, sections: unitSections(lv, ux, uy, inp, masses, lines, rep) }));
      const bytes = assemble(lv.family, { tileX: hx, tileY: hy, hostZ: lv.hostZ, bakeId: inp.bakeId }, chunks);
      const fam = lv === L1 ? 'l1' : 'l2';
      files.push({ name: `${fam}-${hx}-${hy}.pack`, family: fam, x: hx, y: hy, units: us.length, bytes });
      if (lv === L1) { rep.l1Packs++; rep.l1Units += us.length; } else { rep.l2Packs++; rep.l2Units += us.length; }
      rep.largest = Math.max(rep.largest, bytes.length);
    }
  }
  return { files, report: rep };
}

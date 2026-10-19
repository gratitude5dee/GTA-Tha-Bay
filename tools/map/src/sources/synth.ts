/**
 * `synth` sources: a seeded generator that writes the same raw files S0 writes (Socrata-shaped JSON Lines, Terrarium PNG
 * tiles, OSM-shaped GeoJSON lines) for a land rectangle inside `play`, water strips, one land pad per landmark that would
 * otherwise sit in or near water (DL-652), smooth hills (City Hall 17.6 m), 41 rectangular neighbourhoods with the real
 * names, parks, landuse and buildings by density band. Stamps are `authored`, licence LicenseRef-DeeVerse-Owned; synth
 * packs are QA only and never enter assets/assets.lock.json.
 *
 * Randomness: xoshiro128** streams seeded per chunk, so the output does not depend on iteration order.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GRID_MIN_M, M_PER_DEG_LAT, M_PER_DEG_LNG, ORIGIN, Rng, canonicalize, fnv32, latLngFromEnu, sha256Hex, splitmix32 } from '../../../../packages/shared/src/index.ts';
import { areaGridOf, type AreaId, type EnuBox, type SourcesConfig, type SynthConfig } from '../config.ts';
import { writeRawLock, type RawLockFile, type RawSourceLock, RAW_LOCK_NAME } from '../raw-lock.ts';
import { distToRing } from '../geom/rings.ts';
import { CORRIDOR_HALF_M, generateRoads, roadGrid } from './synth-roads.ts';
import { encodeTerrarium, latOfPy, lngOfPx, tilePath, tilesCovering, TILE_PX } from './terrarium.ts';

export const SYNTH_RETRIEVED_AT = '2026-01-01T00:00:00Z';
export const SYNTH_LICENCE = 'LicenseRef-DeeVerse-Owned';

// ---- geometry of the synthetic land --------------------------------------------------------------------------------

type Ring = number[];

/** Main land outline (rectangle plus strips on the north edge), CCW north-up, without a repeated closing point. */
export function mainOutline(cfg: SynthConfig): Ring {
  const l = cfg.land;
  const strips = cfg.landPads.filter((p): p is Extract<SynthConfig['landPads'][number], { kind: 'strip' }> => p.kind === 'strip').sort((a, b) => b.x - a.x);
  const r: Ring = [l.minX, l.minZ, l.minX, l.maxZ, l.maxX, l.maxZ, l.maxX, l.minZ];
  for (const s of strips) {
    const a = s.x - s.width / 2, b = s.x + s.width / 2, end = l.minZ - s.length;
    r.push(b, l.minZ, b, end, a, end, a, l.minZ);
  }
  return r;
}

export function islandRing(p: { x: number; z: number; size: number }): Ring {
  const h = p.size / 2;
  return [p.x - h, p.z - h, p.x - h, p.z + h, p.x + h, p.z + h, p.x + h, p.z - h];
}

/** Every land ring (main outline first, then islands in config order). */
export function landRings(cfg: SynthConfig): Ring[] {
  const out: Ring[] = [mainOutline(cfg)];
  for (const p of cfg.landPads) if (p.kind === 'island') out.push(islandRing(p));
  return out;
}

/** Precomputed land test and height function: the land is a union of axis-aligned rectangles. */
class SynthField {
  readonly rects: EnuBox[];
  readonly rings: Ring[];
  private readonly cityTerm: number;
  constructor(readonly cfg: SynthConfig) {
    const l = cfg.land;
    this.rects = [l];
    for (const p of cfg.landPads) {
      if (p.kind === 'island') this.rects.push({ minX: p.x - p.size / 2, maxX: p.x + p.size / 2, minZ: p.z - p.size / 2, maxZ: p.z + p.size / 2 });
      else this.rects.push({ minX: p.x - p.width / 2, maxX: p.x + p.width / 2, minZ: l.minZ - p.length, maxZ: l.minZ });
    }
    this.rings = landRings(cfg);
    this.cityTerm = cfg.terrain.cityHallM - cfg.terrain.landFloorM - this.hills(0, 0);
  }

  inLand(x: number, z: number): boolean {
    for (const r of this.rects) if (x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ) return true;
    return false;
  }

  dist(x: number, z: number): number {
    let best = Infinity;
    for (const r of this.rings) best = Math.min(best, distToRing(x, z, r));
    return best;
  }

  private hills(px: number, pz: number): number {
    let s = 0;
    for (const h of this.cfg.terrain.hills) {
      const d2 = (px - h.x) ** 2 + (pz - h.z) ** 2;
      const lim = 36 * h.sigma * h.sigma;
      if (d2 < lim) s += h.amp * Math.exp(-d2 / (2 * h.sigma * h.sigma));
    }
    return s;
  }

  height(x: number, z: number): number {
    const t = this.cfg.terrain;
    if (!this.inLand(x, z)) return t.seabedM + 4 * Math.sin(x / 900) * Math.cos(z / 700);
    let h = t.landFloorM + this.hills(x, z);
    const c2 = x * x + z * z;
    if (c2 < 36 * 700 * 700) h += this.cityTerm * Math.exp(-c2 / (2 * 700 * 700));
    for (const p of this.cfg.landPads) {
      if (p.kind !== 'island') continue;
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d2 < 36 * t.padHillSigmaM * t.padHillSigmaM) h += t.padHillM * Math.exp(-d2 / (2 * t.padHillSigmaM * t.padHillSigmaM));
    }
    return Math.max(1.5, h);
  }
}

const fields = new WeakMap<SynthConfig, SynthField>();
const fieldOf = (cfg: SynthConfig): SynthField => {
  let f = fields.get(cfg);
  if (!f) fields.set(cfg, (f = new SynthField(cfg)));
  return f;
};

export function inSynthLand(cfg: SynthConfig, x: number, z: number): boolean {
  return fieldOf(cfg).inLand(x, z);
}

/** Distance from a land point to the nearest coastline. */
export function distToSynthWater(cfg: SynthConfig, x: number, z: number): number {
  return fieldOf(cfg).dist(x, z);
}

export function synthHeight(cfg: SynthConfig, x: number, z: number): number {
  return fieldOf(cfg).height(x, z);
}

// ---- row helpers ---------------------------------------------------------------------------------------------------

const f9 = (v: number): string => v.toFixed(9);
const lonLat = (x: number, z: number): string => {
  const p = latLngFromEnu(x, z);
  return `[${f9(p.lng)},${f9(p.lat)}]`;
};
/** A ring as GeoJSON coordinates, closed. */
function coordsOf(ring: readonly number[]): string {
  const pts: string[] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push(lonLat(ring[i] as number, ring[i + 1] as number));
  pts.push(pts[0] as string);
  return `[${pts.join(',')}]`;
}
const boxRing = (b: EnuBox): Ring => [b.minX, b.minZ, b.minX, b.maxZ, b.maxX, b.maxZ, b.maxX, b.minZ];
const inBox = (b: EnuBox, x: number, z: number): boolean => x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ;
const slug = (s: string): string => s.toLowerCase().replace(/[/\s]+/g, '-');
export const hoodSlug = slug;

function rectFootprint(cx: number, cz: number, w: number, d: number, angle: number): Ring {
  const c = Math.cos(angle), s = Math.sin(angle);
  const pts: [number, number][] = [[-w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2]];
  return pts.flatMap(([px, pz]) => [cx + px * c - pz * s, cz + px * s + pz * c]);
}
function lFootprint(cx: number, cz: number, w: number, d: number, angle: number): Ring {
  const c = Math.cos(angle), s = Math.sin(angle);
  const pts: [number, number][] = [[-w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [w / 2, 0], [0, 0], [0, -d / 2]];
  return pts.flatMap(([px, pz]) => [cx + px * c - pz * s, cz + px * s + pz * c]);
}
function roundFootprint(cx: number, cz: number, r: number): Ring {
  const out: number[] = [];
  const n = 40;
  for (let i = 0; i < n; i++) out.push(cx + r * Math.cos(-(i * 2 * Math.PI) / n), cz + r * Math.sin(-(i * 2 * Math.PI) / n));
  return out;
}

export interface SynthStats { rows: Record<string, number>; tiles: number }

const SPECIES = ['Platanus x hispanica', 'Tristaniopsis laurina', 'Prunus cerasifera', 'Ficus microcarpa', 'Metrosideros excelsa', 'Pyrus calleryana'];

function chunkRng(seed: number, tag: string, cx: number, cy: number): Rng {
  return new Rng(splitmix32(seed ^ fnv32(`${tag}:${cx}:${cy}`)));
}

function densityOf(cfg: SynthConfig, cx: number, cy: number): number {
  const d = cfg.buildings.downtown;
  if (cx >= d.chunkX[0] && cx <= d.chunkX[1] && cy >= d.chunkY[0] && cy <= d.chunkY[1]) return d.perChunk;
  const mx = GRID_MIN_M + cx * 256 + 128, mz = GRID_MIN_M + cy * 256 + 128;
  for (const b of cfg.buildings.dense.boxes) if (inBox(b, mx, mz)) return cfg.buildings.dense.perChunk;
  return cfg.buildings.bulk.perChunk;
}

interface BuildOut { rows: string[]; osm: string[]; count: number }

/** True when (x, z) lies within `extra` metres of a street corridor of the synth grid (buildings keep off the streets). */
function onRoadCorridor(cfg: SynthConfig, x: number, z: number, extra: number): boolean {
  const r = cfg.roads;
  const g = roadGrid(cfg);
  const i = Math.round((x - r.originX) / r.pitchM), j = Math.round((z - r.originZ) / r.pitchM);
  const half = (c: 'arterial' | 'collector' | 'local'): number => CORRIDOR_HALF_M[c] + extra;
  const clsOf = (kind: 'v' | 'h', idx: number): 'arterial' | 'collector' | 'local' => {
    const a = r.arterial;
    const m = (v: number, n: number): number => ((v % n) + n) % n;
    if (kind === 'v' ? m(idx - a.phaseI, a.everyI) === 0 : m(idx - a.phaseJ, a.everyJ) === 0) return 'arterial';
    return m(idx, r.collectorEvery) === 0 ? 'collector' : 'local';
  };
  if (i >= g.iMin && i <= g.iMax && Math.abs(x - g.vx(i)) < half(clsOf('v', i))) return true;
  return j >= g.jMin && j <= g.jMax && Math.abs(z - g.hz(j)) < half(clsOf('h', j));
}

function footprintRow(id: string, ring: Ring, heightM: number, groundM: number, blank: boolean): string {
  const med = blank ? '' : String(Math.round(heightM * 100));
  const max = blank ? '' : String(Math.round(heightM * 105));
  return `{"sf16_bldgid":"${id}","shape":{"type":"MultiPolygon","coordinates":[[${coordsOf(ring)}]]},"hgt_mediancm":"${med}","hgt_maxcm":"${max}","gnd_mediancm":"${Math.round(groundM * 100)}","p2010_zmaxn88ft":"${((groundM + heightM) / 0.3048).toFixed(4)}"}`;
}

function genBuildings(cfg: SynthConfig, box: EnuBox): BuildOut {
  const rows: string[] = [];
  const osm: string[] = [];
  const grid = areaGridOf(box);
  const hole = cfg.buildings.osmGapFill.box;
  let count = 0;
  for (let cy = grid.cy0; cy <= grid.cy1; cy++) {
    for (let cx = grid.cx0; cx <= grid.cx1; cx++) {
      const minX = GRID_MIN_M + cx * 256, minZ = GRID_MIN_M + cy * 256;
      if (!inSynthLand(cfg, minX + 128, minZ + 128) && !inSynthLand(cfg, minX + 8, minZ + 8) && !inSynthLand(cfg, minX + 248, minZ + 248)) continue;
      const n = densityOf(cfg, cx, cy);
      const downtown = n === cfg.buildings.downtown.perChunk;
      const g = downtown ? 39 : Math.max(2, Math.ceil(Math.sqrt(n * 3)));
      const pitch = 256 / g;
      const rng = chunkRng(cfg.seed, 'bld', cx, cy);
      // Fisher-Yates over the cell list for a deterministic choice of cells.
      const cells = Array.from({ length: g * g }, (_, i) => i);
      for (let i = cells.length - 1; i > 0; i--) {
        const j = rng.nextU32() % (i + 1);
        const t = cells[i] as number;
        cells[i] = cells[j] as number;
        cells[j] = t;
      }
      let made = 0;
      for (const cell of cells) {
        if (made >= n) break;
        const px = minX + ((cell % g) + 0.5) * pitch, pz = minZ + (Math.floor(cell / g) + 0.5) * pitch;
        if (!inBox(box, px, pz)) continue;
        if (!inSynthLand(cfg, px, pz) || distToSynthWater(cfg, px, pz) < 24) continue;
        if (inBox(hole, px, pz)) continue;
        if (!downtown && onRoadCorridor(cfg, px, pz, pitch * 0.35 + 2)) continue;
        const idx = made++;
        const id = `${cx}${String(cy).padStart(3, '0')}.${String(idx).padStart(5, '0')}`;
        const kindRoll = rng.nextU32() % 100;
        const hRoll = rng.nextFloat();
        const heightM = downtown ? 30 + hRoll * 150 : n === cfg.buildings.dense.perChunk ? 8 + hRoll * 52 : hRoll > 0.99 ? 40 + hRoll * 40 : 3 + hRoll * 11;
        const w = downtown ? 4.2 + rng.nextFloat() * 0.6 : Math.max(4, pitch * (0.35 + rng.nextFloat() * 0.35));
        const d = downtown ? 4.2 + rng.nextFloat() * 0.6 : Math.max(4, pitch * (0.35 + rng.nextFloat() * 0.35));
        const angle = downtown || rng.nextU32() % 10 >= 3 ? 0 : rng.nextFloat() * Math.PI * 0.5;
        const tiny = !downtown && rng.nextU32() % 1000 === 0;
        let ring: Ring;
        if (tiny) ring = rectFootprint(px, pz, 1.4, 1.4, 0);
        else if (downtown || kindRoll < 70) ring = rectFootprint(px, pz, w, d, angle);
        else if (kindRoll < 90) ring = lFootprint(px, pz, w, d, angle);
        else ring = roundFootprint(px, pz, Math.min(w, d) / 2);
        const ground = synthHeight(cfg, px, pz);
        const blank = !downtown && rng.nextU32() % 500 === 0;
        rows.push(footprintRow(id, ring, heightM, ground, blank));
        count++;
      }
    }
  }
  // Civic sites: one DataSF row and one tagged OSM polygon each.
  let osmId = 1000000;
  const civicTags: Record<string, Record<string, string>> = {
    townhall: { building: 'civic', amenity: 'townhall' }, civic: { building: 'civic' }, cathedral: { building: 'cathedral' },
    school: { building: 'school', amenity: 'school' }, hospital: { building: 'hospital', amenity: 'hospital' },
    church: { building: 'church', amenity: 'place_of_worship' },
  };
  for (const s of cfg.buildings.civicSites) {
    if (!inBox(box, s.x, s.z)) continue;
    const ring = rectFootprint(s.x, s.z, s.w, s.d, 0);
    rows.push(footprintRow(`civic.${s.id}`, ring, s.h, synthHeight(cfg, s.x, s.z), false));
    count++;
    const big = rectFootprint(s.x, s.z, s.w + 2, s.d + 2, 0);
    osm.push(osmPolygon(`w${osmId++}`, [big], { ...(civicTags[s.tag] ?? { building: 'civic' }), name: `Synth ${s.id}` }));
  }
  for (const t of cfg.buildings.osmTowers) {
    if (!inBox(box, t.x, t.z)) continue;
    osm.push(osmPolygon(`w${osmId++}`, [rectFootprint(t.x, t.z, t.w, t.d, 0)], { building: 'commercial', height: String(t.heightM) }));
  }
  const gap = cfg.buildings.osmGapFill;
  const grng = chunkRng(cfg.seed, 'gap', 0, 0);
  for (let i = 0; i < gap.count; i++) {
    const gx = gap.box.minX + 60 + (i % 8) * ((gap.box.maxX - gap.box.minX - 120) / 8), gz = gap.box.minZ + 60 + Math.floor(i / 8) * ((gap.box.maxZ - gap.box.minZ - 120) / 5);
    if (!inBox(box, gx, gz)) continue;
    const w = 14 + grng.nextFloat() * 8, d = 12 + grng.nextFloat() * 8;
    osm.push(osmPolygon(`w${osmId++}`, [rectFootprint(gx, gz, w, d, 0)], { building: 'house', 'building:levels': String(2 + (i % 3)) }));
  }
  return { rows, osm, count };
}

function osmPolygon(id: string, rings: Ring[], tags: Record<string, string>): string {
  return `{"type":"Feature","id":"${id}","properties":${JSON.stringify(tags)},"geometry":{"type":"Polygon","coordinates":[${rings.map(coordsOf).join(',')}]}}`;
}
function osmPoint(id: string, x: number, z: number, tags: Record<string, string>): string {
  return `{"type":"Feature","id":"${id}","properties":${JSON.stringify(tags)},"geometry":{"type":"Point","coordinates":${lonLat(x, z)}}}`;
}
function multiLine(line: readonly number[]): string {
  const pts: string[] = [];
  for (let i = 0; i < line.length; i += 2) pts.push(lonLat(line[i] as number, line[i + 1] as number));
  return `{"type":"MultiLineString","coordinates":[[${pts.join(',')}]]}`;
}
function osmLine(id: string, line: Ring, tags: Record<string, string>): string {
  const pts: string[] = [];
  for (let i = 0; i < line.length; i += 2) pts.push(lonLat(line[i] as number, line[i + 1] as number));
  return `{"type":"Feature","id":"${id}","properties":${JSON.stringify(tags)},"geometry":{"type":"LineString","coordinates":[${pts.join(',')}]}}`;
}

// ---- the generator -------------------------------------------------------------------------------------------------

export interface GenerateOptions {
  outDir: string;
  /** The area box the files must cover. */
  box: EnuBox;
  /** `restricted` is the offline civic-excerpt cut: only the square, no coastline, stamps say synthetic. */
  restricted?: boolean;
}

export function synthSourceSha(cfg: SynthConfig, sourceId: string, box: EnuBox, restricted: boolean): string {
  return sha256Hex(canonicalize({ generator: cfg.generator, seed: cfg.seed, source: sourceId, box, restricted, config: sha256Hex(canonicalize(cfg)) }));
}

export function generateSynth(cfg: SynthConfig, sources: SourcesConfig, area: AreaId, o: GenerateOptions): { lock: RawLockFile; stats: SynthStats } {
  mkdirSync(o.outDir, { recursive: true });
  const box = o.box;
  const restricted = o.restricted === true;
  const rows: Record<string, number> = {};
  const grid = areaGridOf(box);

  // footprints and OSM buildings
  const b = genBuildings(cfg, box);
  writeFileSync(path.join(o.outDir, 'ynuv-fyni.jsonl'), b.rows.length ? `${b.rows.join('\n')}\n` : '');
  rows['datasf-footprints'] = b.rows.length;

  // neighbourhoods: 7 x 6 cells of the land rectangle, the first 41 carry the real names
  const nb = cfg.neighbourhoods;
  const hoodRows: string[] = [];
  const cw = (cfg.land.maxX - cfg.land.minX) / nb.cols, ch = (cfg.land.maxZ - cfg.land.minZ) / nb.rows;
  nb.names.forEach((name, i) => {
    const c = i % nb.cols, r = Math.floor(i / nb.cols);
    const cell: EnuBox = { minX: cfg.land.minX + c * cw, maxX: cfg.land.minX + (c + 1) * cw, minZ: cfg.land.minZ + r * ch, maxZ: cfg.land.minZ + (r + 1) * ch };
    const clipped: EnuBox = restricted
      ? { minX: Math.max(cell.minX, box.minX), maxX: Math.min(cell.maxX, box.maxX), minZ: Math.max(cell.minZ, box.minZ), maxZ: Math.min(cell.maxZ, box.maxZ) }
      : cell;
    if (clipped.minX >= clipped.maxX || clipped.minZ >= clipped.maxZ) return;
    hoodRows.push(`{"nhood":${JSON.stringify(name)},"the_geom":{"type":"MultiPolygon","coordinates":[[${coordsOf(boxRing(clipped))}]]}}`);
  });
  writeFileSync(path.join(o.outDir, 'j2bu-swwd.jsonl'), hoodRows.length ? `${hoodRows.join('\n')}\n` : '');
  rows['datasf-neighborhoods'] = hoodRows.length;

  // parks
  const parkRows = cfg.parks
    .filter((p) => !restricted || (p.maxX > box.minX && p.minX < box.maxX && p.maxZ > box.minZ && p.minZ < box.maxZ))
    .map((p, i) => `{"property_id":"${String(i + 1).padStart(3, '0')}","property_name":${JSON.stringify(p.name)},"propertytype":"Neighborhood Park or Playground","acres":"${(((p.maxX - p.minX) * (p.maxZ - p.minZ)) / 4046.86).toFixed(2)}","shape":{"type":"MultiPolygon","coordinates":[[${coordsOf(boxRing(p))}]]}}`);
  writeFileSync(path.join(o.outDir, 'gtr9-ntp6.jsonl'), parkRows.length ? `${parkRows.join('\n')}\n` : '');
  rows['datasf-parks'] = parkRows.length;

  // trees
  const treeRows: string[] = [];
  for (let cy = grid.cy0; cy <= grid.cy1; cy++) {
    for (let cx = grid.cx0; cx <= grid.cx1; cx++) {
      const minX = GRID_MIN_M + cx * 256, minZ = GRID_MIN_M + cy * 256;
      const rng = chunkRng(cfg.seed, 'tree', cx, cy);
      for (let i = 0; i < cfg.trees.perChunk; i++) {
        const x = minX + 8 + rng.nextFloat() * 240, z = minZ + 8 + rng.nextFloat() * 240;
        const sp = SPECIES[rng.nextU32() % SPECIES.length] as string;
        if (!inBox(box, x, z) || !inSynthLand(cfg, x, z) || distToSynthWater(cfg, x, z) < 12) continue;
        const p = latLngFromEnu(x, z);
        treeRows.push(`{"treeid":"${cx}${String(cy).padStart(3, '0')}${String(i).padStart(2, '0')}","species":${JSON.stringify(sp)},"latitude":"${f9(p.lat)}","longitude":"${f9(p.lng)}"}`);
      }
    }
  }
  writeFileSync(path.join(o.outDir, 'tkzw-k3nq.jsonl'), treeRows.length ? `${treeRows.join('\n')}\n` : '');
  rows['datasf-trees'] = treeRows.length;

  // OSM
  const osm: string[] = [];
  let wid = 5000;
  if (!restricted) {
    const rings = landRings(cfg);
    rings.forEach((r, i) => {
      // closed CCW ring; the main outline is split into three ways so S3 has to chain them
      const closed = [...r, r[0] as number, r[1] as number];
      if (i === 0) {
        const n = closed.length / 2;
        const a = Math.floor(n / 3), c = Math.floor((2 * n) / 3);
        osm.push(osmLine(`w${wid++}`, closed.slice(0, (a + 1) * 2), { natural: 'coastline' }));
        osm.push(osmLine(`w${wid++}`, closed.slice(a * 2, (c + 1) * 2), { natural: 'coastline' }));
        osm.push(osmLine(`w${wid++}`, closed.slice(c * 2), { natural: 'coastline' }));
      } else osm.push(osmLine(`w${wid++}`, closed, { natural: 'coastline' }));
    });
    for (const p of cfg.piers) {
      if (p.kind === 'line') osm.push(osmLine(`w${wid++}`, [p.x0, p.z0, p.x1, p.z1], { man_made: 'pier', width: String(p.width) }));
      else osm.push(osmPolygon(`w${wid++}`, [boxRing(p)], { man_made: 'pier' }));
    }
    osm.push(osmPolygon(`w${wid++}`, [boxRing({ minX: -6000, minZ: 900, maxX: -5900, maxZ: 1000 })], { natural: 'water', water: 'pond' }));
  }
  const luTags: Record<string, Record<string, string>> = {
    commercial: { landuse: 'commercial' }, industrial: { landuse: 'industrial' }, residential: { landuse: 'residential' }, grass: { landuse: 'grass' },
    beach: { natural: 'beach' }, plaza: { place: 'square' }, cliff: { natural: 'bare_rock' },
  };
  for (const u of cfg.landuse) {
    if (restricted && !(u.maxX > box.minX && u.minX < box.maxX && u.maxZ > box.minZ && u.minZ < box.maxZ)) continue;
    osm.push(osmPolygon(`w${wid++}`, [boxRing(u)], luTags[u.cls] ?? { landuse: u.cls }));
  }
  for (const p of cfg.parks) {
    if (restricted && !(p.maxX > box.minX && p.minX < box.maxX && p.maxZ > box.minZ && p.minZ < box.maxZ)) continue;
    osm.push(osmPolygon(`w${wid++}`, [boxRing({ minX: p.minX + 10, minZ: p.minZ + 10, maxX: p.minX + 60, maxZ: p.minZ + 60 })], { leisure: 'pitch' }));
  }
  osm.push(...b.osm);

  // roads, rails, ferry, footways and the DataSF street / Muni rows that describe them (M02a2)
  const nb2 = cfg.neighbourhoods;
  const cw2 = (cfg.land.maxX - cfg.land.minX) / nb2.cols, ch2 = (cfg.land.maxZ - cfg.land.minZ) / nb2.rows;
  const hoodOf = (x: number, z: number): string => {
    const c = Math.floor((x - cfg.land.minX) / cw2), r = Math.floor((z - cfg.land.minZ) / ch2);
    if (c < 0 || r < 0 || c >= nb2.cols || r >= nb2.rows) return '';
    return nb2.names[c + r * nb2.cols] ?? '';
  };
  const roads = generateRoads(cfg, { box, hoodOf });
  for (const w of roads.ways) osm.push(osmLine(w.id, w.pts, w.tags));
  for (const p of roads.points) osm.push(osmPoint(p.id, p.x, p.z, p.tags));
  writeFileSync(path.join(o.outDir, 'osm.geojsonl'), osm.length ? `${osm.join('\n')}\n` : '');
  rows['osm'] = osm.length;
  const streetRows = roads.streets.map((s) =>
    `{"cnn":"${s.cnn}","streetname":${JSON.stringify(s.streetname)},"st_type":"${s.st_type}","classcode":"${s.classcode}","oneway":"${s.oneway}","layer":"${s.layer}","f_node_cnn":"${s.f_node_cnn}","t_node_cnn":"${s.t_node_cnn}","nhood":${JSON.stringify(s.nhood)},"analysis_neighborhood":${JSON.stringify(s.nhood)},"active":"${s.active}","line":${multiLine(s.line)}}`);
  writeFileSync(path.join(o.outDir, '3psu-pn9h.jsonl'), streetRows.length ? `${streetRows.join('\n')}\n` : '');
  rows['datasf-streets'] = streetRows.length;
  const stopRows = roads.stops.map((s) => {
    const p = latLngFromEnu(s.x, s.z);
    return `{"stopname":${JSON.stringify(s.stopname)},"stopid":"${s.stopid}","latitude":"${f9(p.lat)}","longitude":"${f9(p.lng)}","shelter":"${s.shelter}"}`;
  });
  writeFileSync(path.join(o.outDir, 'i28k-bkz6.jsonl'), stopRows.length ? `${stopRows.join('\n')}\n` : '');
  rows['datasf-muni-stops'] = stopRows.length;
  const patternRows = roads.patterns.map((p) => `{"route_name":${JSON.stringify(p.route_name)},"lineabbr":"${p.lineabbr}","direction":"${p.direction}","shape":${multiLine(p.line)}}`);
  writeFileSync(path.join(o.outDir, '9exe-acju.jsonl'), patternRows.length ? `${patternRows.join('\n')}\n` : '');
  rows['datasf-muni-routes'] = patternRows.length;

  // Terrarium tiles over the area box
  const tiles = tilesCovering(box, 15);
  const tdir = path.join(o.outDir, 'terrarium');
  const z = 15;
  const h = new Float32Array(TILE_PX * TILE_PX);
  for (const t of tiles) {
    const lngs = new Float64Array(TILE_PX);
    for (let i = 0; i < TILE_PX; i++) lngs[i] = lngOfPx(t.x * TILE_PX + i + 0.5, z);
    for (let j = 0; j < TILE_PX; j++) {
      const lat = latOfPy(t.y * TILE_PX + j + 0.5, z);
      for (let i = 0; i < TILE_PX; i++) {
        const x = ((lngs[i] as number) - ORIGIN.lng) * M_PER_DEG_LNG;
        const zz = -(lat - ORIGIN.lat) * M_PER_DEG_LAT;
        h[j * TILE_PX + i] = synthHeight(cfg, x, zz);
      }
    }
    const file = path.join(tdir, tilePath(t));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, encodeTerrarium(h));
  }
  rows['terrarium'] = tiles.length;

  // lock
  const used = sources.areas[area].sources;
  const entries: RawSourceLock[] = used.map((id) => ({
    id,
    url: `synth://${id}`,
    retrievedAt: SYNTH_RETRIEVED_AT,
    sha256: synthSourceSha(cfg, id, box, restricted),
    rows: rows[id] ?? 0,
    licence: SYNTH_LICENCE,
  }));
  const lock: RawLockFile = { schema: 'raw-lock/1', area, synthetic: true, sources: entries };
  writeRawLock(path.join(o.outDir, RAW_LOCK_NAME), lock);
  return { lock, stats: { rows, tiles: tiles.length } };
}

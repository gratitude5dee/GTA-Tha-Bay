/**
 * `synth` roads and transit (M02a2): an OSM-shaped street grid with arterial spines, signals at arterial crossings, one
 * layered overpass, one short tunnel, one-way streets, restrictions, a light-rail line, two bus patterns with stops, one
 * ferry line and footways, plus the DataSF-shaped street rows (`cnn`, `oneway`, `layer`) that describe the same blocks.
 *
 * The grid is global (lines at originX + i * pitch and originZ + j * pitch), so a restricted cut for the civic-excerpt is
 * the same grid clipped to its box. Everything is a pure function of the config, the box and the civic sites: no
 * randomness at all. Geometry stays in ENU metres; synth.ts serialises it to GeoJSON lines.
 */
import { GRID_MIN_M } from '../../../../packages/shared/src/index.ts';
import type { EnuBox, SynthConfig } from '../config.ts';

export interface RoadWay { id: string; pts: number[]; tags: Record<string, string> }
export interface RoadPoint { id: string; x: number; z: number; tags: Record<string, string> }
export interface StreetRowData {
  cnn: number; streetname: string; st_type: string; classcode: string; oneway: 'B' | 'F' | 'T'; layer: string; f_node_cnn: number; t_node_cnn: number;
  nhood: string; active: string; line: number[];
}
export interface StopRowData { stopname: string; stopid: string; x: number; z: number; shelter: string }
export interface PatternRowData { route_name: string; lineabbr: string; direction: string; line: number[] }
export interface SynthRoads {
  ways: RoadWay[];
  points: RoadPoint[];
  streets: StreetRowData[];
  stops: StopRowData[];
  patterns: PatternRowData[];
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

const TREES = [
  'Alder', 'Aspen', 'Bay', 'Birch', 'Cedar', 'Cypress', 'Dogwood', 'Elm', 'Fir', 'Hazel', 'Hickory', 'Juniper', 'Laurel', 'Linden', 'Locust', 'Madrone',
  'Maple', 'Myrtle', 'Oak', 'Olive', 'Palm', 'Pepper', 'Pine', 'Poplar', 'Redwood', 'Sequoia', 'Spruce', 'Sumac', 'Sycamore', 'Willow', 'Yew', 'Acacia',
  'Buckeye', 'Catalpa', 'Fig',
];

type Cls = 'arterial' | 'collector' | 'local';

export interface RoadGen {
  vx(i: number): number;
  hz(j: number): number;
  iMin: number; iMax: number; jMin: number; jMax: number;
}

export function roadGrid(cfg: SynthConfig): RoadGen {
  const r = cfg.roads;
  const l = cfg.land;
  return {
    vx: (i) => r.originX + i * r.pitchM,
    hz: (j) => r.originZ + j * r.pitchM,
    iMin: Math.ceil((l.minX + r.marginM - r.originX) / r.pitchM),
    iMax: Math.floor((l.maxX - r.marginM - r.originX) / r.pitchM),
    jMin: Math.ceil((l.minZ + r.marginM - r.originZ) / r.pitchM),
    jMax: Math.floor((l.maxZ - r.marginM - r.originZ) / r.pitchM),
  };
}

/** The downtown 1,500-building chunk block (a stress case, not a street scene): no streets cross it. */
export function downtownBox(cfg: SynthConfig): EnuBox {
  const d = cfg.buildings.downtown;
  return {
    minX: GRID_MIN_M + d.chunkX[0] * 256, maxX: GRID_MIN_M + (d.chunkX[1] + 1) * 256,
    minZ: GRID_MIN_M + d.chunkY[0] * 256, maxZ: GRID_MIN_M + (d.chunkY[1] + 1) * 256,
  };
}

const clsOfLine = (cfg: SynthConfig, kind: 'v' | 'h', idx: number): Cls => {
  const a = cfg.roads.arterial;
  if (kind === 'v' ? mod(idx - a.phaseI, a.everyI) === 0 : mod(idx - a.phaseJ, a.everyJ) === 0) return 'arterial';
  return mod(idx, cfg.roads.collectorEvery) === 0 ? 'collector' : 'local';
};

const oneWayLine = (cfg: SynthConfig, kind: 'v' | 'h', idx: number): boolean => {
  if (clsOfLine(cfg, kind, idx) !== 'local') return false;
  const o = cfg.roads.oneWay;
  return kind === 'v' ? mod(idx - o.phaseI, o.everyI) === 0 : mod(idx - o.phaseJ, o.everyJ) === 0;
};

/** Half width of a street's corridor incl. sidewalks, used to keep buildings and civic sites off the roads. */
export const CORRIDOR_HALF_M: Record<Cls, number> = { arterial: 13, collector: 10, local: 8 };

function streetName(kind: 'v' | 'h', idx: number, iMin: number, jMin: number): { name: string; type: string } {
  if (kind === 'v') {
    const k = idx - iMin + 1;
    const suf = k % 100 >= 11 && k % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[k % 10] ?? 'th';
    return { name: `${k}${suf}`, type: 'Avenue' };
  }
  const k = idx - jMin;
  const base = TREES[mod(k, TREES.length)] as string;
  return { name: k >= TREES.length ? `${base} Park` : base, type: k >= TREES.length ? 'Way' : 'Street' };
}

export interface RoadGenOptions {
  /** Only ways with both end points in this box are kept (the civic-excerpt cut). */
  box: EnuBox;
  hoodOf(x: number, z: number): string;
}

export function generateRoads(cfg: SynthConfig, o: RoadGenOptions): SynthRoads {
  const r = cfg.roads;
  const g = roadGrid(cfg);
  const down = downtownBox(cfg);
  const dEx = 20;
  const inBox = (x: number, z: number): boolean => x >= o.box.minX && x <= o.box.maxX && z >= o.box.minZ && z <= o.box.maxZ;
  const inDown = (x: number, z: number): boolean => x > down.minX - dEx && x < down.maxX + dEx && z > down.minZ - dEx && z < down.maxZ + dEx;
  const sites = cfg.buildings.civicSites;
  const hitsSite = (x0: number, z0: number, x1: number, z1: number, half: number): boolean => {
    const lx = Math.min(x0, x1) - half, hx = Math.max(x0, x1) + half, lz = Math.min(z0, z1) - half, hz = Math.max(z0, z1) + half;
    return sites.some((s) => lx < s.x + s.w / 2 && hx > s.x - s.w / 2 && lz < s.z + s.d / 2 && hz > s.z - s.d / 2);
  };
  const ov = r.overpass;
  const tu = r.tunnel;

  const ways: RoadWay[] = [];
  const points: RoadPoint[] = [];
  const streets: StreetRowData[] = [];
  let wid = 6000000;
  let nid = 7000000;
  let cnn = 1000000;
  const wayAt = new Map<string, string>();   // `${v|h}:${line}:${block}` -> way id (blocks keyed by the lower index)
  const present = new Set<string>();         // `${v|h}:${line}:${block}` for every generated block

  // blocks that exist: both ends in the box, away from the downtown cut, clear of civic sites, not around the tunnel crossings
  const tunnelCut = (kind: 'v' | 'h', idx: number, blk: number): boolean => {
    if (kind !== 'v') return false;
    // vertical blocks touching a node strictly inside the tunnel span
    for (let k = 1; k < tu.blocks; k++) {
      if (idx === tu.i0 + k && (blk === tu.j - 1 || blk === tu.j)) return true;
    }
    return false;
  };
  const blockOk = (kind: 'v' | 'h', idx: number, blk: number): boolean => {
    const x0 = kind === 'v' ? g.vx(idx) : g.vx(blk), z0 = kind === 'v' ? g.hz(blk) : g.hz(idx);
    const x1 = kind === 'v' ? x0 : g.vx(blk + 1), z1 = kind === 'v' ? g.hz(blk + 1) : z0;
    if (!inBox(x0, z0) || !inBox(x1, z1)) return false;
    if (inDown((x0 + x1) / 2, (z0 + z1) / 2)) return false;
    if (hitsSite(x0, z0, x1, z1, CORRIDOR_HALF_M[clsOfLine(cfg, kind, idx)])) return false;
    return !tunnelCut(kind, idx, blk);
  };

  const hasV = (i: number, j: number): boolean => present.has(`v:${i}:${j}`);   // vertical block j -> j+1 on line i
  const hasH = (j: number, i: number): boolean => present.has(`h:${j}:${i}`);   // horizontal block i -> i+1 on line j

  // 1. which blocks exist
  for (let i = g.iMin; i <= g.iMax; i++) for (let j = g.jMin; j < g.jMax; j++) if (blockOk('v', i, j)) present.add(`v:${i}:${j}`);
  for (let j = g.jMin; j <= g.jMax; j++) for (let i = g.iMin; i < g.iMax; i++) if (blockOk('h', j, i)) present.add(`h:${j}:${i}`);

  const tagsOf = (kind: 'v' | 'h', idx: number): Record<string, string> => {
    const c = clsOfLine(cfg, kind, idx);
    const nm = streetName(kind, idx, g.iMin, g.jMin);
    const t: Record<string, string> = { highway: c === 'arterial' ? 'primary' : c === 'collector' ? 'tertiary' : 'residential', name: `${nm.name} ${nm.type}` };
    if (c === 'arterial') { t['lanes'] = '4'; t['maxspeed'] = '30 mph'; }
    else if (c === 'collector') { t['lanes'] = '2'; t['maxspeed'] = '25 mph'; }
    return t;
  };

  const overpassBlock = (i: number, j: number): boolean => i === ov.i && j >= ov.j0 && j < ov.j0 + ov.blocks;
  const tunnelBlock = (j: number, i: number): boolean => j === tu.j && i >= tu.i0 && i < tu.i0 + tu.blocks;

  const nhoodOf = (x: number, z: number): string => o.hoodOf(x, z);

  const addRow = (kind: 'v' | 'h', idx: number, blk: number, pts: number[]): void => {
    const c = clsOfLine(cfg, kind, idx);
    const nm = streetName(kind, idx, g.iMin, g.jMin);
    const ow = oneWayLine(cfg, kind, idx);
    // DataSF oneway: F travels along the digitised line, T against it. The OSM way is drawn in the travel direction; the row
    // is digitised the other way for half of the one-way blocks and flagged T there.
    const flip = ow && mod(blk, 2) === 1;
    const line = flip ? reversePts(pts) : pts;
    const mx = (pts[0]! + pts[pts.length - 2]!) / 2, mz = (pts[1]! + pts[pts.length - 1]!) / 2;
    const k = cnn++;
    streets.push({
      cnn: k, streetname: nm.name.toUpperCase(), st_type: nm.type === 'Avenue' ? 'AVE' : nm.type === 'Street' ? 'ST' : 'WAY',
      classcode: c === 'arterial' ? (kind === 'v' ? '2' : '3') : c === 'collector' ? '4' : '5', oneway: ow ? (flip ? 'T' : 'F') : 'B',
      layer: 'STREETS', f_node_cnn: 2000000 + (kind === 'v' ? idx * 1000 + blk : blk * 1000 + idx), t_node_cnn: 2000000 + (kind === 'v' ? idx * 1000 + blk + 1 : (blk + 1) * 1000 + idx),
      nhood: nhoodOf(mx, mz), active: 'true', line,
    });
  };

  const emitLine = (kind: 'v' | 'h', idx: number): void => {
    const nBlocks = kind === 'v' ? g.jMax - g.jMin : g.iMax - g.iMin;
    const lo = kind === 'v' ? g.jMin : g.iMin;
    const base = tagsOf(kind, idx);
    const ow = oneWayLine(cfg, kind, idx);
    const dirFwd = ow ? mod(idx, 2) === 0 : true;    // one-way streets alternate direction by line parity
    for (let b = lo; b < lo + nBlocks; b++) {
      const key = `${kind}:${idx}:${b}`;
      if (!present.has(key)) continue;
      const isOver = kind === 'v' && overpassBlock(idx, b);
      const isTun = kind === 'h' && tunnelBlock(idx, b);
      if (isOver && b !== ov.j0) { wayAt.set(key, wayAt.get(`v:${idx}:${ov.j0}`) as string); addStreetRow(kind, idx, b, true); continue; }
      if (isTun && b !== tu.i0) { wayAt.set(key, wayAt.get(`h:${idx}:${tu.i0}`) as string); addStreetRow(kind, idx, b, true); continue; }
      const x0 = kind === 'v' ? g.vx(idx) : g.vx(b), z0 = kind === 'v' ? g.hz(b) : g.hz(idx);
      let span = 1;
      if (isOver) span = ov.blocks;
      if (isTun) span = tu.blocks;
      const x1 = kind === 'v' ? x0 : g.vx(b + span), z1 = kind === 'v' ? g.hz(b + span) : z0;
      const pts = dirFwd ? [x0, z0, x1, z1] : [x1, z1, x0, z0];
      const tags = { ...base };
      if (ow) tags['oneway'] = 'yes';
      if (isOver) { tags['bridge'] = 'yes'; tags['layer'] = '1'; }
      if (isTun) { tags['tunnel'] = 'yes'; tags['layer'] = '-1'; }
      const id = `w${wid++}`;
      wayAt.set(key, id);
      ways.push({ id, pts, tags });
      addStreetRow(kind, idx, b, dirFwd);
    }
  };
  const addStreetRow = (kind: 'v' | 'h', idx: number, b: number, dirFwd: boolean): void => {
    const x0 = kind === 'v' ? g.vx(idx) : g.vx(b), z0 = kind === 'v' ? g.hz(b) : g.hz(idx);
    const x1 = kind === 'v' ? x0 : g.vx(b + 1), z1 = kind === 'v' ? g.hz(b + 1) : z0;
    addRow(kind, idx, b, dirFwd ? [x0, z0, x1, z1] : [x1, z1, x0, z0]);
  };

  for (let i = g.iMin; i <= g.iMax; i++) emitLine('v', i);
  for (let j = g.jMin; j <= g.jMax; j++) emitLine('h', j);

  // 2. controls at crossings
  const junctionHere = (i: number, j: number): boolean => {
    // the crossing is a junction node when at least three of its four blocks exist and it is not under the overpass or inside the tunnel
    if (i === ov.i && j > ov.j0 && j < ov.j0 + ov.blocks) return false;
    if (j === tu.j && i > tu.i0 && i < tu.i0 + tu.blocks) return false;
    let n = 0;
    if (hasV(i, j - 1)) n++;
    if (hasV(i, j)) n++;
    if (hasH(j, i - 1)) n++;
    if (hasH(j, i)) n++;
    return n >= 3;
  };
  for (let i = g.iMin; i <= g.iMax; i++) {
    for (let j = g.jMin; j <= g.jMax; j++) {
      if (!junctionHere(i, j)) continue;
      const cv = clsOfLine(cfg, 'v', i), ch = clsOfLine(cfg, 'h', j);
      const x = g.vx(i), z = g.hz(j);
      if (cv === 'arterial' && ch === 'arterial') points.push({ id: `n${nid++}`, x, z, tags: { highway: 'traffic_signals' } });
      else if ((cv === 'arterial' && ch === 'collector') || (cv === 'collector' && ch === 'arterial')) { if (mod(i + j, 2) === 0) points.push({ id: `n${nid++}`, x, z, tags: { highway: 'traffic_signals' } }); }
      else if ((cv === 'arterial' || cv === 'collector') !== (ch === 'arterial' || ch === 'collector')) { if (mod(i + j, 2) === 0) points.push({ id: `n${nid++}`, x, z, tags: { highway: 'stop' } }); }
    }
  }

  // mid-block crossings on every fifth arterial vertical block
  for (let i = g.iMin; i <= g.iMax; i++) {
    if (clsOfLine(cfg, 'v', i) !== 'arterial') continue;
    for (let j = g.jMin; j < g.jMax; j++) if (hasV(i, j) && mod(i + j, 5) === 0 && !overpassBlock(i, j)) points.push({ id: `n${nid++}`, x: g.vx(i), z: (g.hz(j) + g.hz(j + 1)) / 2, tags: { highway: 'crossing', crossing: 'marked' } });
  }

  // 3. restrictions (relation features: a Point at the via node with from/to way ids)
  const vec: Record<'n' | 's' | 'e' | 'w', [number, number]> = { n: [0, 1], s: [0, -1], e: [-1, 0], w: [1, 0] };   // heading of a vehicle arriving from that side
  let rid = 8000000;
  for (const rs of r.restrictions) {
    const [hx, hz] = vec[rs.from];
    const left: [number, number] = [hz, -hx], right: [number, number] = [-hz, hx];
    const target: [number, number] = rs.kind === 'no_left_turn' ? left : rs.kind === 'no_right_turn' ? right : rs.kind === 'only_straight_on' ? [hx, hz] : [-hx, -hz];
    const blockWay = (dx: number, dz: number, arrive: boolean): string | undefined => {
      // way of the block that leaves the via node toward (dx, dz); when `arrive` the block lies behind the arriving vehicle
      const sx = arrive ? -dx : dx, sz = arrive ? -dz : dz;
      if (sx !== 0) return wayAt.get(`h:${rs.j}:${sx > 0 ? rs.i : rs.i - 1}`);
      return wayAt.get(`v:${rs.i}:${sz > 0 ? rs.j : rs.j - 1}`);
    };
    const fromWay = blockWay(hx, hz, true), toWay = blockWay(target[0], target[1], false);
    if (!fromWay || !toWay) continue;
    const x = g.vx(rs.i), z = g.hz(rs.j);
    if (!inBox(x, z)) continue;
    points.push({ id: `r${rid++}`, x, z, tags: { '@type': 'relation', type: 'restriction', restriction: rs.kind, from: fromWay, to: toWay } });
  }

  // 4. light rail (an OSM railway way beside an arterial spine)
  {
    const lr = r.lightRail;
    const x = g.vx(lr.i) + lr.offsetM;
    const pts: number[] = [];
    for (let z = lr.z0; z <= lr.z1; z += 160) if (inBox(x, z) && !inDown(x, z)) pts.push(x, z);
    if (pts.length >= 4) ways.push({ id: `w${wid++}`, pts, tags: { railway: 'light_rail', name: 'Spine Line' } });
  }

  // 5. ferry (route=ferry between two land pads over the north water strip)
  {
    const f = r.ferry;
    if (inBox(f.from.x, f.from.z) && inBox(f.to.x, f.to.z)) {
      ways.push({ id: `w${wid++}`, pts: [f.from.x, f.from.z, f.to.x, f.to.z], tags: { route: 'ferry', name: 'Strait Crossing' } });
    }
  }

  // 6. footways and steps
  for (const f of r.footways) {
    const pts = f.pts;
    if (!inBox(pts[0]!, pts[1]!) || !inBox(pts[pts.length - 2]!, pts[pts.length - 1]!)) continue;
    ways.push({ id: `w${wid++}`, pts: [...pts], tags: f.kind === 'steps' ? { highway: 'steps', name: f.id } : { highway: 'footway', name: f.id } });
  }

  // 7. bus patterns and stops
  const stops: StopRowData[] = [];
  const patterns: PatternRowData[] = [];
  let stopN = 0;
  for (const b of r.bus) {
    const pts: number[] = [];
    const along: number[] = [];
    if (b.line === 'v') {
      const x = g.vx(b.idx);
      for (let j = g.jMin; j <= g.jMax; j++) { const z = g.hz(j); if (z >= b.from && z <= b.to && inBox(x, z) && (hasV(b.idx, j) || hasV(b.idx, j - 1))) { pts.push(x, z); along.push(j); } }
    } else {
      const z = g.hz(b.idx);
      for (let i = g.iMin; i <= g.iMax; i++) { const x = g.vx(i); if (x >= b.from && x <= b.to && inBox(x, z) && (hasH(b.idx, i) || hasH(b.idx, i - 1))) { pts.push(x, z); along.push(i); } }
    }
    if (pts.length < 4) continue;
    patterns.push({ route_name: `Route ${b.route}`, lineabbr: b.route, direction: 'Outbound', line: pts });
    along.forEach((_k, n) => {
      if (n % b.stopEveryBlocks !== 0) return;
      const x = pts[n * 2]! + (b.line === 'h' ? 0 : 4), z = pts[n * 2 + 1]! + (b.line === 'h' ? 4 : 0);
      stops.push({ stopname: `Stop ${stopN + 1}`, stopid: String(15000 + stopN), x, z, shelter: stopN % 2 === 0 ? 'Yes' : 'No' });
      stopN++;
    });
  }

  // 8. rows that have no OSM way: paper, private, pseudo and right-of-way layers (they exercise the layer histogram)
  const odd: { layer: string; x0: number; z0: number; x1: number; z1: number }[] = [
    { layer: 'PAPER', x0: g.vx(g.iMin) - 50, z0: g.hz(g.jMin) + 40, x1: g.vx(g.iMin) - 50, z1: g.hz(g.jMin) + 200 },
    { layer: 'PAPER_WATER', x0: g.vx(g.iMax) + 40, z0: g.hz(g.jMin) + 40, x1: g.vx(g.iMax) + 40, z1: g.hz(g.jMin) + 200 },
    { layer: 'PRIVATE', x0: g.vx(g.iMin) + 40, z0: g.hz(g.jMax) - 60, x1: g.vx(g.iMin) + 120, z1: g.hz(g.jMax) - 60 },
    { layer: 'PSEUDO', x0: g.vx(g.iMin) + 40, z0: g.hz(g.jMax) - 100, x1: g.vx(g.iMin) + 60, z1: g.hz(g.jMax) - 100 },
    { layer: 'UPROW', x0: g.vx(g.iMax) - 120, z0: g.hz(g.jMax) - 60, x1: g.vx(g.iMax) - 40, z1: g.hz(g.jMax) - 60 },
    { layer: 'STREETS_PEDESTRI', x0: g.vx(g.iMax) - 120, z0: g.hz(g.jMax) - 100, x1: g.vx(g.iMax) - 40, z1: g.hz(g.jMax) - 100 },
  ];
  for (const s of odd) {
    if (!inBox(s.x0, s.z0) || !inBox(s.x1, s.z1)) continue;
    streets.push({
      cnn: cnn++, streetname: 'PAPER', st_type: 'ST', classcode: '5', oneway: 'B', layer: s.layer, f_node_cnn: 0, t_node_cnn: 0,
      nhood: nhoodOf(s.x0, s.z0), active: 'true', line: [s.x0, s.z0, s.x1, s.z1],
    });
  }

  return { ways, points, streets, stops, patterns };
}

function reversePts(p: number[]): number[] {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i] as number, p[i + 1] as number);
  return out;
}

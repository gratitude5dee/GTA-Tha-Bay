/**
 * S5 roads (02-world-bake.md section 4 S5, 02-world-living.md sections 1.1 to 1.3).
 *
 * Drivable OSM `highway` ways become segments (one per piece between shared nodes) and directed edges. DataSF `3psu-pn9h`
 * rows are matched piece by piece (name-compatible rows within 12 m on at least 60 % of the sample points): the `cnn`,
 * `classcode` and `oneway` of a matched row override the OSM values on active STREETS-type layers, and a piece whose
 * best row sits on an excluded layer (`PAPER*`, `PSEUDO`, `PRIVATE`, `STREETS_PEDESTRI`, `UPROW`) is dropped. Both
 * orientations of the DataSF F/T flag are scored against OSM on the matched one-way pieces and the better one is adopted;
 * S5 fails when neither exceeds 90 % (a design value, U-W15).
 *
 * Ids (C08 rule 8): NodeId, EdgeId and SegId are dense u32, assigned in Morton order of the owning chunk (the chunk of the
 * `from` node, and for a segment the chunk of its lower-id edge) and then by position, so they are stable per bake.
 */
import {
  EdgeFlag, GRID_MIN_M, NodeControl, RoadClass, chunkKeyAt, enuFromLatLng,
  type ChunkKey, type RoadEdge,
} from '../../../../packages/shared/src/index.ts';
import { pointInRing, ringBbox, type Bbox } from '../geom/rings.ts';
import { PointGrid, morton, polyLength, resample } from '../geom/poly.ts';
import type { Geometry, OsmFeature } from '../sources/geo.ts';
import type { HoodPoly } from './s3-water.ts';
import { NEIGHBOURHOODS_41 } from '../districts-seed.ts';

// ---- config ---------------------------------------------------------------------------------------------------------

export interface RoadClassDef { id: number; name: string; lanes: number; laneWidthM: number; speedMps: number; parking: boolean }
export interface RoadClassConfig {
  schema: 'world-roadclass/1';
  classes: RoadClassDef[];
  osmHighway: Record<string, number>;
  datasfClasscode: Record<string, number>;
  excludedService: string[];
  excludedAccess: string[];
  parkingLaneM: number;
  layers: { excludedPrefixes: string[]; excludedExact: string[]; known: string[] };
  oneway: { minAgreement: number; worstListed: number };
  match: { sampleM: number; maxDistM: number; minFraction: number };
  hillGradePct: number;
}

export const isExcludedLayer = (layer: string, c: RoadClassConfig): boolean =>
  c.layers.excludedExact.includes(layer) || c.layers.excludedPrefixes.some((p) => layer.startsWith(p));

// ---- inputs ---------------------------------------------------------------------------------------------------------

export interface StreetRow {
  cnn?: string | number;
  streetname?: string;
  st_type?: string;
  classcode?: string | number;
  oneway?: string;
  layer?: string;
  f_node_cnn?: string | number;
  t_node_cnn?: string | number;
  nhood?: string;
  active?: string | boolean;
  line?: Geometry;
}

export interface RoadsInputs {
  osm: readonly OsmFeature[];
  streets: readonly StreetRow[];
  hoods: readonly HoodPoly[];
  cfg: RoadClassConfig;
  /** ENU box of the area: ways with a vertex outside it are cut at the box edge (none are for synth and the excerpt). */
  box: Bbox;
}

// ---- outputs --------------------------------------------------------------------------------------------------------

export interface SegB {
  id: number;
  /** x, z pairs (ENU), at most 20 m apart; S7 adds `y` in `ys`. */
  pts: number[];
  ys: number[];
  a: number;
  b: number;
  lengthM: number;
  widthM: number;
  osmWay: number;
  cnn: number;
  name: string;
  cls: RoadClass;
  /** 1: only a to b; -1: only b to a; 0: both. */
  oneWay: -1 | 0 | 1;
  lanesF: number;
  lanesB: number;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  roundabout: boolean;
  /** Edge indices of the two directions (-1 when absent), set once ids exist. */
  eF: number;
  eB: number;
  nhood: number;
  /** The authored highway value, for ramps and links. */
  highway: string;
  speedMps: number;
  parking: 0 | 1 | 2;
  /** OSM `sidewalk=no|none`: the pedestrian graph derives no sidewalks beside this segment. */
  noSidewalk: boolean;
}

export interface NodeB {
  id: number;
  x: number;
  z: number;
  y: number;
  layer: number;
  control: NodeControl;
  /** Junction index (global, set by S6) or -1. */
  junction: number;
  signal: boolean;
  stop: boolean;
  stopAll: boolean;
  giveWay: boolean;
  roundabout: boolean;
  out: number[];
  in: number[];
}

export interface RestrictionB { kind: string; fromWay: number; toWay: number; via: number }

export interface OnewayReport {
  comparable: number;
  agree1: number;
  agree2: number;
  ratio1: number;
  ratio2: number;
  adopted: 'F-along' | 'F-against';
  ok: boolean;
  dsfOneOsmTwo: number;
  worst: { cnn: number; osmWay: number }[];
}

export interface RoadsReport {
  layerHistogram: Record<string, number>;
  excludedActive: number;
  unknownLayers: string[];
  osmWays: number;
  pieces: number;
  droppedExcluded: number;
  droppedAccess: number;
  matchedPieces: number;
  unmatchedPieces: number;
  classOverrides: number;
  oneway: OnewayReport;
  segments: number;
  edges: number;
  nodes: number;
  maxEdgesPerChunk: number;
}

export interface RoadsProduct {
  /** Every OSM `highway=traffic_signals` point (ENU), for the S6 match gate. */
  signalPoints: { x: number; z: number }[];
  segs: SegB[];
  edges: RoadEdge[];
  nodes: NodeB[];
  restrictions: RestrictionB[];
  report: RoadsReport;
}

// ---- tag helpers ----------------------------------------------------------------------------------------------------

export function parseMaxspeed(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kph)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'km/h').toLowerCase();
  const ms = unit === 'mph' ? n * 0.44704 : n / 3.6;
  return ms > 0 ? ms : null;
}

const q025 = (v: number): number => Math.round(v * 4) / 4;

const STREET_TYPES = new Set([
  'AVENUE', 'AVE', 'STREET', 'ST', 'WAY', 'BOULEVARD', 'BLVD', 'ROAD', 'RD', 'DRIVE', 'DR', 'COURT', 'CT', 'PLACE', 'PL', 'LANE', 'LN',
  'TERRACE', 'TER', 'ALLEY', 'AL', 'HIGHWAY', 'HWY', 'PARKWAY', 'PKWY', 'CIRCLE', 'CIR', 'SQUARE', 'SQ', 'PLAZA', 'PLZ',
]);

/** Upper-case name without the trailing street type, digit-led words without leading zeros ("03RD" is "3RD"). */
export function normalizeStreetName(s: string | undefined): string {
  if (!s) return '';
  const toks = s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (toks.length > 1 && STREET_TYPES.has(toks[toks.length - 1] as string)) toks.pop();
  return toks.map((t) => (/^0+\d/.test(t) ? t.replace(/^0+/, '') : t)).join(' ');
}

const truthy = (v: unknown): boolean => v === true || (typeof v === 'string' && ['true', 'yes', 'y', '1'].includes(v.toLowerCase()));

function osmNum(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

function lineCoords(g: Geometry): number[][][] {
  if (g.type === 'LineString') return [g.coordinates as number[][]];
  if (g.type === 'MultiLineString') return g.coordinates as number[][][];
  return [];
}

const vkey = (c: readonly number[]): string => `${(c[0] as number).toFixed(7)},${(c[1] as number).toFixed(7)}`;

// ---- one-way orientation ----------------------------------------------------------------------------------------------

export interface OnewayPair {
  cnn: number;
  osmWay: number;
  /** OSM direction relative to the piece: 1 along, -1 against. Zero-direction (two-way) pairs are not passed. */
  osmDir: 1 | -1;
  /** DataSF direction relative to the piece under "F travels along the digitised line". */
  dsfDirAlong: 1 | -1;
}

/** Scores both readings of the DataSF F/T flag and adopts the better one; `ok` needs the winner strictly above `min`. */
export function adoptOrientation(pairs: readonly OnewayPair[], min: number, listWorst: number): OnewayReport {
  let a1 = 0, a2 = 0;
  for (const p of pairs) {
    if (p.dsfDirAlong === p.osmDir) a1++;
    else a2++;
  }
  const n = pairs.length;
  const r1 = n === 0 ? 1 : a1 / n, r2 = n === 0 ? 0 : a2 / n;
  const adopted = r2 > r1 ? 'F-against' : 'F-along';
  const best = Math.max(r1, r2);
  const worst = pairs
    .filter((p) => (adopted === 'F-along' ? p.dsfDirAlong !== p.osmDir : p.dsfDirAlong === p.osmDir))
    .map((p) => ({ cnn: p.cnn, osmWay: p.osmWay }))
    .sort((x, y) => x.cnn - y.cnn || x.osmWay - y.osmWay)
    .slice(0, listWorst);
  return { comparable: n, agree1: a1, agree2: a2, ratio1: r1, ratio2: r2, adopted, ok: n === 0 || best > min, dsfOneOsmTwo: 0, worst };
}

// ---- the stage --------------------------------------------------------------------------------------------------------

interface Way {
  id: string;
  num: number;
  tags: Record<string, string>;
  keys: string[];
  enu: number[];
}

interface RowB {
  cnn: number;
  nameKey: string;
  layer: string;
  classcode: string;
  oneway: string;
  excluded: boolean;
  /** unit direction of the digitised line */
  dx: number;
  dz: number;
}

export function runRoads(inp: RoadsInputs): RoadsProduct {
  const c = inp.cfg;
  const layerHistogram: Record<string, number> = {};
  const unknown = new Set<string>();
  let excludedActive = 0;

  // -- DataSF rows
  const rows: RowB[] = [];
  const rowGrid = new PointGrid<number>(32);
  for (const r of inp.streets) {
    if (!truthy(r.active)) continue;
    const layer = String(r.layer ?? '');
    layerHistogram[layer] = (layerHistogram[layer] ?? 0) + 1;
    if (!c.layers.known.includes(layer)) unknown.add(layer);
    const excluded = isExcludedLayer(layer, c);
    if (excluded) excludedActive++;
    if (!r.line) continue;
    const lines = lineCoords(r.line);
    if (lines.length === 0) continue;
    const enu: number[][] = lines.map((l) => l.flatMap((p) => { const e = enuFromLatLng(p[1] as number, p[0] as number); return [e.x, e.z]; }));
    const first = enu[0] as number[], last = enu[enu.length - 1] as number[];
    let dx = (last[last.length - 2] as number) - (first[0] as number), dz = (last[last.length - 1] as number) - (first[1] as number);
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const idx = rows.length;
    rows.push({
      cnn: Number(r.cnn ?? 0) || 0, nameKey: normalizeStreetName(r.streetname), layer, classcode: String(r.classcode ?? ''),
      oneway: String(r.oneway ?? 'B').toUpperCase(), excluded, dx, dz,
    });
    for (const line of enu) {
      const pts = resample(line, c.match.sampleM);
      for (let i = 0; i < pts.length; i += 2) rowGrid.add(pts[i] as number, pts[i + 1] as number, idx);
    }
  }

  // -- OSM ways and points
  const sorted = [...inp.osm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ways: Way[] = [];
  const pointTags = new Map<string, { signal: boolean; stop: boolean; stopAll: boolean; giveWay: boolean }>();
  const restrictionsRaw: { kind: string; fromWay: number; toWay: number; key: string }[] = [];
  const signalPoints: { x: number; z: number }[] = [];
  let droppedAccess = 0;
  for (const f of sorted) {
    const t = f.tags;
    if (f.geometry.type === 'Point') {
      const co = f.geometry.coordinates as number[];
      if (t['type'] === 'restriction' && t['restriction']) {
        restrictionsRaw.push({ kind: t['restriction'], fromWay: osmNum(t['from'] ?? ''), toWay: osmNum(t['to'] ?? ''), key: vkey(co) });
      } else if (t['highway'] === 'traffic_signals' || t['highway'] === 'stop' || t['highway'] === 'give_way') {
        const k = vkey(co);
        const p = pointTags.get(k) ?? { signal: false, stop: false, stopAll: false, giveWay: false };
        if (t['highway'] === 'traffic_signals') {
          p.signal = true;
          const e = enuFromLatLng(co[1] as number, co[0] as number);
          if (e.x >= inp.box.minX && e.x <= inp.box.maxX && e.z >= inp.box.minZ && e.z <= inp.box.maxZ) signalPoints.push({ x: e.x, z: e.z });
        }
        if (t['highway'] === 'stop') { p.stop = true; if (t['stop'] === 'all') p.stopAll = true; }
        if (t['highway'] === 'give_way') p.giveWay = true;
        pointTags.set(k, p);
      }
      continue;
    }
    const hw = t['highway'];
    if (hw === undefined || c.osmHighway[hw] === undefined) continue;
    if (hw === 'service' && t['service'] !== undefined && c.excludedService.includes(t['service'])) { droppedAccess++; continue; }
    if (t['access'] !== undefined && c.excludedAccess.includes(t['access']) && t['motor_vehicle'] !== 'yes') { droppedAccess++; continue; }
    if (t['area'] === 'yes') continue;
    for (const co of lineCoords(f.geometry)) {
      if (co.length < 2) continue;
      const enu: number[] = [];
      for (const p of co) { const e = enuFromLatLng(p[1] as number, p[0] as number); enu.push(e.x, e.z); }
      ways.push({ id: f.id, num: osmNum(f.id), tags: t, keys: co.map(vkey), enu });
    }
  }

  // -- node vertices: ends, vertices shared by two ways, tagged vertices
  const uses = new Map<string, number>();
  for (const w of ways) for (const k of new Set(w.keys)) uses.set(k, (uses.get(k) ?? 0) + 1);

  interface Piece { way: Way; k0: number; k1: number; pts: number[]; keyA: string; keyB: string; seq: number }
  const pieces: Piece[] = [];
  let seq = 0;
  for (const w of ways) {
    const n = w.keys.length;
    let start = 0;
    for (let k = 1; k < n; k++) {
      const key = w.keys[k] as string;
      const isNode = k === n - 1 || (uses.get(key) ?? 0) >= 2 || pointTags.has(key);
      if (!isNode) continue;
      const pts = w.enu.slice(start * 2, k * 2 + 2);
      if (polyLength(pts) > 0.2) pieces.push({ way: w, k0: start, k1: k, pts, keyA: w.keys[start] as string, keyB: key, seq: seq++ });
      start = k;
    }
  }

  // -- classify pieces and match DataSF rows
  interface Built {
    piece: Piece; cls: RoadClass; cnn: number; oneWay: -1 | 0 | 1; lanesF: number; lanesB: number; speed: number; parking: 0 | 1 | 2; dsf: 1 | -1 | 0;
    layer: number; bridge: boolean; tunnel: boolean; roundabout: boolean; name: string; highway: string; widthM: number; laneW: number; noSidewalk: boolean;
  }
  const built: Built[] = [];
  const pairs: OnewayPair[] = [];
  let droppedExcluded = 0, matched = 0, unmatched = 0, overrides = 0, dsfOneOsmTwo = 0;
  const matchOf = (p: Piece, name: string): { row: RowB; frac: number } | null => {
    const L = polyLength(p.pts);
    const nS = Math.max(3, Math.ceil(L / c.match.sampleM) + 1);
    const votes = new Map<number, { n: number; sd: number }>();
    for (let s = 0; s < nS; s++) {
      const q = nearestSample(p.pts, (L * s) / (nS - 1));
      const seen = new Set<number>();
      for (const hit of rowGrid.query(q.x, q.z, c.match.maxDistM)) {
        const ri = hit.item;
        if (seen.has(ri)) continue;
        const row = rows[ri] as RowB;
        if (name && row.nameKey && normalizeStreetName(name) !== row.nameKey) continue;
        seen.add(ri);
        const v = votes.get(ri) ?? { n: 0, sd: 0 };
        v.n++; v.sd += hit.d;
        votes.set(ri, v);
      }
    }
    let best: { ri: number; n: number; sd: number } | null = null;
    for (const [ri, v] of [...votes.entries()].sort((a, b) => a[0] - b[0])) {
      if (!best || v.n > best.n || (v.n === best.n && v.sd < best.sd)) best = { ri, n: v.n, sd: v.sd };
    }
    if (!best || best.n / nS < c.match.minFraction) return null;
    return { row: rows[best.ri] as RowB, frac: best.n / nS };
  };

  for (const p of pieces) {
    const t = p.way.tags;
    const hw = t['highway'] as string;
    const name = t['name'] ?? '';
    const m = rows.length > 0 ? matchOf(p, name) : null;
    if (m && m.row.excluded) { droppedExcluded++; continue; }
    let cls = c.osmHighway[hw] as RoadClass;
    let cnn = 0;
    if (m) {
      matched++;
      cnn = m.row.cnn;
      const code = c.datasfClasscode[m.row.classcode];
      if (code !== undefined && code !== cls) { cls = code as RoadClass; overrides++; }
    } else unmatched++;
    const def = c.classes[cls] as RoadClassDef;

    const rbt = t['junction'] === 'roundabout' || t['junction'] === 'circular';
    let ow: -1 | 0 | 1 = 0;
    const ov = (t['oneway'] ?? '').toLowerCase();
    if (ov === 'yes' || ov === 'true' || ov === '1') ow = 1;
    else if (ov === '-1' || ov === 'reverse') ow = -1;
    else if (rbt || hw === 'motorway' || hw === 'motorway_link') ow = ov === 'no' ? 0 : 1;
    const osmOw = ow;
    let dsfAuth = false;
    let dsf: 1 | -1 | 0 = 0;
    if (m) {
      dsfAuth = m.row.layer.startsWith('STREETS');
      if (m.row.oneway === 'F' || m.row.oneway === 'T') {
        const rowDot = m.row.dx * ((p.pts[p.pts.length - 2] as number) - (p.pts[0] as number)) + m.row.dz * ((p.pts[p.pts.length - 1] as number) - (p.pts[1] as number));
        const along: 1 | -1 = (rowDot >= 0 ? 1 : -1) * (m.row.oneway === 'F' ? 1 : -1) as 1 | -1;
        if (osmOw !== 0) pairs.push({ cnn: m.row.cnn, osmWay: p.way.num, osmDir: osmOw, dsfDirAlong: along });
        else if (dsfAuth) dsfOneOsmTwo++;
        dsf = along;   // applied below, once the orientation is adopted
      }
    }

    // lanes per direction
    const tagInt = (k: string): number | null => { const v = Number.parseInt(t[k] ?? '', 10); return Number.isFinite(v) && v > 0 && v < 12 ? v : null; };
    const total = tagInt('lanes');
    let lanesF = def.lanes, lanesB = def.lanes;
    if (osmOw !== 0) { lanesF = lanesB = total ?? def.lanes; }
    else {
      const f = tagInt('lanes:forward'), b = tagInt('lanes:backward');
      if (f !== null || b !== null) { lanesF = f ?? (total !== null ? Math.max(1, total - (b ?? 0)) : def.lanes); lanesB = b ?? (total !== null ? Math.max(1, total - (f ?? 0)) : def.lanes); }
      else if (total !== null) { lanesF = Math.max(1, Math.ceil(total / 2)); lanesB = Math.max(1, Math.floor(total / 2) || 1); }
    }
    const sp = parseMaxspeed(t['maxspeed']);
    const speed = q025(Math.min(40, Math.max(2.5, sp ?? def.speedMps)));
    let parking: 0 | 1 | 2 = def.parking ? 2 : 0;
    if (parking > 0) {
      const no = (k: string): boolean => ['no', 'none', 'no_parking', 'no_stopping', 'no_standing'].includes(t[k] ?? '');
      if (no('parking:lane:both') || no('parking:both')) parking = 0;
      else {
        const l = no('parking:lane:left') || no('parking:left'), r = no('parking:lane:right') || no('parking:right');
        parking = (l && r ? 0 : l || r ? 1 : 2) as 0 | 1 | 2;
      }
    }
    const bridgeTag = t['bridge'] !== undefined && t['bridge'] !== 'no';
    const tunnelTag = t['tunnel'] !== undefined && t['tunnel'] !== 'no' && t['tunnel'] !== 'culvert';
    let layer = Number.parseInt(t['layer'] ?? '', 10);
    if (!Number.isFinite(layer)) layer = bridgeTag ? 1 : tunnelTag ? -1 : 0;
    layer = Math.max(-5, Math.min(5, layer));
    const laneW = def.laneWidthM;
    built.push({
      piece: p, cls, cnn, oneWay: ow, lanesF, lanesB, speed, parking, dsf, layer, bridge: bridgeTag, tunnel: tunnelTag, roundabout: rbt,
      name, highway: hw, widthM: 0, laneW, noSidewalk: ['no', 'none'].includes(t['sidewalk'] ?? ''),
    });
  }

  // -- adopt the DataSF F/T orientation
  const oneway = adoptOrientation(pairs, c.oneway.minAgreement, c.oneway.worstListed);
  oneway.dsfOneOsmTwo = dsfOneOsmTwo;
  if (oneway.ok) {
    for (const b of built) {
      if (b.dsf === 0) continue;
      // DataSF wins on a matched active STREETS segment, whatever OSM says
      b.oneWay = (oneway.adopted === 'F-along' ? b.dsf : -b.dsf) as 1 | -1;
    }
  }

  // -- widths
  for (const b of built) {
    const lanes = b.oneWay !== 0 ? b.lanesF : Math.max(b.lanesF, b.lanesB);
    b.widthM = Math.round((lanes * b.laneW * (b.oneWay !== 0 ? 1 : 2) + 2.3 * b.parking) * 10) / 10;
  }

  // -- nodes
  const nodeIndex = new Map<string, number>();
  const nodes: NodeB[] = [];
  const nodeOf = (key: string, x: number, z: number, layer: number): number => {
    const have = nodeIndex.get(key);
    if (have !== undefined) {
      const n = nodes[have] as NodeB;
      if (layer < n.layer) n.layer = layer;
      return have;
    }
    const pt = pointTags.get(key);
    const n: NodeB = {
      id: -1, x, z, y: 0, layer, control: NodeControl.None, junction: -1, signal: pt?.signal ?? false, stop: pt?.stop ?? false, stopAll: pt?.stopAll ?? false,
      giveWay: pt?.giveWay ?? false, roundabout: false, out: [], in: [],
    };
    nodes.push(n);
    nodeIndex.set(key, nodes.length - 1);
    return nodes.length - 1;
  };

  const segs: SegB[] = [];
  for (const b of built) {
    const p = b.piece;
    const pts = resample(p.pts, 20);
    const a = nodeOf(p.keyA, pts[0] as number, pts[1] as number, b.layer);
    const z = nodeOf(p.keyB, pts[pts.length - 2] as number, pts[pts.length - 1] as number, b.layer);
    if (b.roundabout) { (nodes[a] as NodeB).roundabout = true; (nodes[z] as NodeB).roundabout = true; }
    segs.push({
      id: -1, pts, ys: new Array(pts.length / 2).fill(0), a, b: z, lengthM: polyLength(pts), widthM: b.widthM, osmWay: p.way.num, cnn: b.cnn, name: b.name,
      cls: b.cls, oneWay: b.oneWay, lanesF: b.lanesF, lanesB: b.lanesB, layer: b.layer, bridge: b.bridge, tunnel: b.tunnel, roundabout: b.roundabout,
      eF: -1, eB: -1, nhood: 255, highway: b.highway, speedMps: b.speed, parking: b.parking, noSidewalk: b.noSidewalk,
    });
  }

  // -- ids: nodes by chunk Morton order then position, edges by owner chunk of the from node, segments by lowest edge id
  const chunkIdx = (v: number): number => Math.floor((v - GRID_MIN_M) / 256);
  const nodeOrder = nodes.map((_n, i) => i).sort((i, j) => {
    const a = nodes[i] as NodeB, b = nodes[j] as NodeB;
    return morton(chunkIdx(a.x), chunkIdx(a.z)) - morton(chunkIdx(b.x), chunkIdx(b.z))
      || Math.round(a.z * 10) - Math.round(b.z * 10) || Math.round(a.x * 10) - Math.round(b.x * 10) || a.layer - b.layer || i - j;
  });
  const nodeRank = new Array<number>(nodes.length);
  nodeOrder.forEach((old, rank) => { nodeRank[old] = rank; });
  const finalNodes: NodeB[] = nodeOrder.map((old, rank) => ({ ...(nodes[old] as NodeB), id: rank }));
  for (const s of segs) { s.a = nodeRank[s.a] as number; s.b = nodeRank[s.b] as number; }

  interface ESpec { seg: number; dir: 1 | -1; from: number; to: number }
  const especs: ESpec[] = [];
  segs.forEach((s, i) => {
    if (s.oneWay >= 0) especs.push({ seg: i, dir: 1, from: s.a, to: s.b });
    if (s.oneWay <= 0) especs.push({ seg: i, dir: -1, from: s.b, to: s.a });
  });
  especs.sort((x, y) => {
    const fx = finalNodes[x.from] as NodeB, fy = finalNodes[y.from] as NodeB;
    return x.from - y.from || x.seg - y.seg || y.dir - x.dir || fx.id - fy.id;
  });
  // node ids already follow chunk Morton order, so sorting by from-node id sorts by owner chunk then position
  const eIndex = new Map<string, number>();
  especs.forEach((e, id) => eIndex.set(`${e.seg}:${e.dir}`, id));
  const hoodBoxes = inp.hoods.map((h) => ({ name: h.name, polys: h.polys, bbs: h.polys.map((q) => ringBbox(q.outer)) }));
  const hoodIndex = (x: number, z: number): number => {
    for (const h of hoodBoxes) {
      for (let k = 0; k < h.polys.length; k++) {
        const bb = h.bbs[k] as Bbox;
        if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
        const q = h.polys[k] as { outer: number[]; holes: number[][] };
        if (pointInRing(x, z, q.outer) && !q.holes.some((hole) => pointInRing(x, z, hole))) {
          const i = NEIGHBOURHOODS_41.indexOf(h.name);
          return i < 0 ? 255 : i;
        }
      }
    }
    return 255;
  };

  const edges: RoadEdge[] = especs.map((e, id) => {
    const s = segs[e.seg] as SegB;
    const twinKey = `${e.seg}:${-e.dir}`;
    const lanes = e.dir === 1 || s.oneWay !== 0 ? s.lanesF : s.lanesB;
    let flags = 0;
    if (s.oneWay !== 0) flags |= EdgeFlag.OneWay;
    if (s.bridge) flags |= EdgeFlag.Bridge;
    if (s.tunnel) flags |= EdgeFlag.Tunnel;
    if (s.cls === RoadClass.Freeway && s.oneWay !== 0) flags |= EdgeFlag.Divided;
    if (s.parking === 0) flags |= EdgeFlag.NoParking;
    return {
      id, seg: e.seg, dir: e.dir, from: e.from, to: e.to, twin: eIndex.get(twinKey) ?? -1, cls: s.cls, lanes, laneWidthM: (c.classes[s.cls] as RoadClassDef).laneWidthM,
      speedMps: s.speedMps, flags, layer: s.layer, medianM: 0, parkingSides: s.parking, maxGradePct: 0, nhood: 255,
    };
  });
  const segOrder = segs.map((_s, i) => i).sort((i, j) => {
    const ai = Math.min((eIndex.get(`${i}:1`) ?? Infinity), (eIndex.get(`${i}:-1`) ?? Infinity));
    const aj = Math.min((eIndex.get(`${j}:1`) ?? Infinity), (eIndex.get(`${j}:-1`) ?? Infinity));
    return ai - aj || i - j;
  });
  const segRank = new Array<number>(segs.length);
  segOrder.forEach((old, rank) => { segRank[old] = rank; });
  const finalSegs: SegB[] = segOrder.map((old, rank) => {
    const s = { ...(segs[old] as SegB) };
    s.id = rank;
    s.eF = eIndex.get(`${old}:1`) ?? -1;
    s.eB = eIndex.get(`${old}:-1`) ?? -1;
    const mid = s.pts.length / 4;
    const mi = Math.floor(mid) * 2;
    s.nhood = hoodIndex(s.pts[mi] as number, s.pts[mi + 1] as number);
    return s;
  });
  for (const e of edges) {
    e.seg = segRank[e.seg] as number;
    e.nhood = (finalSegs[e.seg] as SegB).nhood;
  }
  for (const e of edges) {
    (finalNodes[e.from] as NodeB).out.push(e.id);
    (finalNodes[e.to] as NodeB).in.push(e.id);
  }

  // node layer: lowest layer of incident segments was applied in nodeOf; restrictions
  const restrictions: RestrictionB[] = [];
  for (const r of restrictionsRaw) {
    const ni = nodeIndex.get(r.key);
    if (ni === undefined) continue;
    restrictions.push({ kind: r.kind, fromWay: r.fromWay, toWay: r.toWay, via: nodeRank[ni] as number });
  }
  restrictions.sort((a, b) => a.via - b.via || a.fromWay - b.fromWay || a.toWay - b.toWay || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

  const perChunk = new Map<ChunkKey, number>();
  for (const e of edges) {
    const f = finalNodes[e.from] as NodeB;
    const k = chunkKeyAt(9, f.x, f.z);
    perChunk.set(k, (perChunk.get(k) ?? 0) + 1);
  }
  let maxPerChunk = 0;
  for (const n of perChunk.values()) if (n > maxPerChunk) maxPerChunk = n;

  const report: RoadsReport = {
    layerHistogram: Object.fromEntries(Object.entries(layerHistogram).sort(([a], [b]) => (a < b ? -1 : 1))),
    excludedActive, unknownLayers: [...unknown].sort(), osmWays: ways.length, pieces: pieces.length, droppedExcluded, droppedAccess,
    matchedPieces: matched, unmatchedPieces: unmatched, classOverrides: overrides, oneway, segments: finalSegs.length, edges: edges.length,
    nodes: finalNodes.length, maxEdgesPerChunk: maxPerChunk,
  };
  return { signalPoints, segs: finalSegs, edges, nodes: finalNodes, restrictions, report };
}

function nearestSample(pts: number[], s: number): { x: number; z: number } {
  let acc = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2] as number, z0 = pts[i - 1] as number, x1 = pts[i] as number, z1 = pts[i + 1] as number;
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (acc + d >= s || i === pts.length - 2) {
      const t = d === 0 ? 0 : Math.min(1, Math.max(0, (s - acc) / d));
      return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t };
    }
    acc += d;
  }
  return { x: pts[0] as number, z: pts[1] as number };
}


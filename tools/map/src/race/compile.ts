/**
 * Race authoring, step 2 (M07a1; 06-racing.md 2.7): `source.json` + a finished bake -> `race.json`.
 *
 *   waypoints -> snap (<= 25 m) -> A* between them on the bake topology -> the route's centreline from the real segments ->
 *   resample every 5 m -> elevation every 25 m, curvature -> gates (start, every <= 250 m and at turns over 60 degrees, finish) ->
 *   grid -> medals from the par estimate.
 *
 * The output is deterministic for one bake: the same source and bake give the same bytes. Tools code: it may use `Math`.
 * `via` points are visited in order between the first and the second waypoint (BD-M07a1-03).
 */
import { PI, type EdgeId, type GateDef, type RaceDef, type RaceSource } from '../../../../packages/shared/src/index.ts';
import { snapPoint, waypointEnu, type BakeGraph, type Snapped } from './snap.ts';

export const STEP_M = 5;
/** Gate spacing target; V6 allows 260 m. */
export const GATE_EVERY_M = 245;
const TURN_WINDOW_M = 20;
const TURN_DEG = 60;
const START_GATE_S = 10;
const GRID_SPACING_M = 6;
const FINISH_BACK_M = 2;
const DEFAULT_WIDTH_M = 14;
/** The par estimate: an average of 30 m/s over the route (replaced by the bot in M07a2, V12). */
const PAR_MPS = 30;

export class CompileError extends Error {
  constructor(readonly rule: string, message: string) {
    super(`${rule}: ${message}`);
    this.name = 'CompileError';
  }
}

interface Pt { x: number; y: number; z: number }

/** The route as one polyline: x, y, z per vertex, and the edge it came from. */
interface RoutePoly { pts: Pt[]; edges: EdgeId[]; dirs: (1 | -1)[] }

function edgePolyline(bg: BakeGraph, edge: EdgeId): Pt[] | null {
  const rec = bg.edgeRec.get(edge);
  const seg = rec ? bg.segs.get(rec.seg) : undefined;
  if (!rec || !seg) return null;
  const p = seg.pts;
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i += 3) out.push({ x: p[i] as number, y: p[i + 1] as number, z: p[i + 2] as number });
  if (rec.dir === -1) out.reverse();
  return out;
}

function polyLen(pts: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot((pts[i] as Pt).x - (pts[i - 1] as Pt).x, (pts[i] as Pt).z - (pts[i - 1] as Pt).z);
  return l;
}

/** The part of a polyline between arc lengths `a` and `b` (metres along the polyline). */
function slice(pts: readonly Pt[], a: number, b: number): Pt[] {
  const out: Pt[] = [];
  let acc = 0;
  const at = (i: number, t: number): Pt => {
    const p = pts[i] as Pt;
    const q = pts[i + 1] as Pt;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[i + 1] as Pt;
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    const s0 = acc;
    const s1 = acc + l;
    acc = s1;
    if (s1 < a || s0 > b || l === 0) continue;
    const t0 = Math.max(0, (a - s0) / l);
    const t1 = Math.min(1, (b - s0) / l);
    if (out.length === 0) out.push(at(i, t0));
    out.push(at(i, t1));
  }
  return out;
}

/** Edge polyline between the baked arc lengths `s0` and `s1` (decimetre-exact edge lengths scale the polyline). */
function edgePiece(bg: BakeGraph, edge: EdgeId, s0: number, s1: number): Pt[] {
  const poly = edgePolyline(bg, edge);
  if (!poly) throw new CompileError('V1', `edge ${edge} has no resident geometry`);
  const pl = polyLen(poly);
  const len = bg.net.lenDm(edge) / 10;
  const k = len > 0 ? pl / len : 1;
  return slice(poly, Math.max(0, s0) * k, Math.min(len, s1) * k);
}

function appendPoly(into: Pt[], more: readonly Pt[]): void {
  for (const p of more) {
    const last = into[into.length - 1];
    if (last && Math.hypot(last.x - p.x, last.z - p.z) < 0.01) continue;
    into.push(p);
  }
}

export interface CompileOptions {
  bg: BakeGraph;
  /** Version stamped into the def; default the source's. */
  now?: never;
}

export interface RouteLeg { from: Snapped; to: Snapped; edges: EdgeId[]; lengthM: number }

/** Routes the snapped points; throws `CompileError` with the rule (V1) when a leg has no route. */
export function routeLegs(bg: BakeGraph, snaps: readonly Snapped[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < snaps.length; i++) {
    const a = snaps[i] as Snapped;
    const b = snaps[i + 1] as Snapped;
    const r = bg.graph.routeDetailed({ from: { edge: a.edge, s: a.s, lane: 0 }, to: { edge: b.edge, s: b.s, lane: 0 }, maxExpand: 4_000_000, useTopology: true });
    if (!r || !r.complete) throw new CompileError('V1', `no route from waypoint ${i} to waypoint ${i + 1}`);
    legs.push({ from: a, to: b, edges: r.edges, lengthM: r.lengthM });
  }
  return legs;
}

function buildPolyline(bg: BakeGraph, legs: readonly RouteLeg[]): RoutePoly {
  // load every chunk the route touches before reading geometry (the ends of each edge, one chunk of margin)
  for (const leg of legs) {
    for (const e of leg.edges) {
      const a = bg.net.from(e);
      const b = bg.net.to(e);
      const ax = bg.net.nodeX(a), az = bg.net.nodeZ(a), bx = bg.net.nodeX(b), bz = bg.net.nodeZ(b);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 100));
      for (let k = 0; k <= n; k++) bg.ensureAround(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, 1);
    }
  }
  const pts: Pt[] = [];
  const edges: EdgeId[] = [];
  const dirs: (1 | -1)[] = [];
  for (const leg of legs) {
    const es = leg.edges;
    for (let i = 0; i < es.length; i++) {
      const e = es[i] as EdgeId;
      const len = bg.net.lenDm(e) / 10;
      const s0 = i === 0 ? leg.from.s : 0;
      const s1 = i === es.length - 1 ? leg.to.s : len;
      if (es.length === 1 && s1 < s0) throw new CompileError('V1', `waypoints on edge ${e} run against its direction`);
      appendPoly(pts, edgePiece(bg, e, s0, s1));
      if (edges[edges.length - 1] !== e) {
        edges.push(e);
        dirs.push(bg.edgeRec.get(e)?.dir ?? 1);
      }
    }
  }
  return { pts, edges, dirs };
}

/** Resamples a polyline every `step` metres; the last sample sits at the end of the line. */
function resample(pts: readonly Pt[], step: number): { samples: Pt[]; lengthM: number } {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push((cum[i - 1] as number) + Math.hypot((pts[i] as Pt).x - (pts[i - 1] as Pt).x, (pts[i] as Pt).z - (pts[i - 1] as Pt).z));
  const total = cum[cum.length - 1] as number;
  const n = Math.ceil(total / step);
  const samples: Pt[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = k === n ? total : k * step;
    while (j + 2 < cum.length && (cum[j + 1] as number) < s) j++;
    const a = pts[j] as Pt;
    const b = pts[j + 1] as Pt;
    const span = (cum[j + 1] as number) - (cum[j] as number);
    const t = span > 0 ? Math.min(1, Math.max(0, (s - (cum[j] as number)) / span)) : 0;
    samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  }
  return { samples, lengthM: total };
}

const headingOf = (a: Pt, b: Pt): number => Math.atan2(b.z - a.z, b.x - a.x);
const angDiff = (a: number, b: number): number => {
  let d = b - a;
  while (d > PI) d -= 2 * PI;
  while (d < -PI) d += 2 * PI;
  return d;
};

/** Route metres of the point of the polyline nearest to ENU (x, z), searching the whole route. */
export function sOfPoint(samples: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i] as Pt;
    const b = samples[i + 1] as Pt;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    const d2 = (x - (a.x + dx * t)) ** 2 + (z - (a.z + dz * t)) ** 2;
    if (d2 < best) {
      best = d2;
      bestS = (i + t) * STEP_M;
    }
  }
  return bestS;
}

function placeGates(src: RaceSource, samples: readonly Pt[], lengthM: number, gridCount: number): GateDef[] {
  const at = (s: number): { p: Pt; tx: number; tz: number } => {
    const i = Math.min(samples.length - 2, Math.max(0, Math.floor(s / STEP_M)));
    const a = samples[i] as Pt;
    const b = samples[i + 1] as Pt;
    const span = i === samples.length - 2 ? lengthM - i * STEP_M : STEP_M;
    const t = span > 0 ? Math.min(1, Math.max(0, (s - i * STEP_M) / span)) : 0;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { p: { x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t }, tx: dx / l, tz: dz / l };
  };
  const startS = START_GATE_S + GRID_SPACING_M * Math.max(0, gridCount - 1);
  const finishS = Math.max(startS + 50, lengthM - FINISH_BACK_M);
  // turns over 60 degrees: heading change across a 20 m window either side, one gate per turn
  const turnS: number[] = [];
  const w = Math.round(TURN_WINDOW_M / STEP_M);
  let lastTurn = -1e9;
  for (let i = w; i + w < samples.length; i++) {
    const h0 = headingOf(samples[i - w] as Pt, samples[i] as Pt);
    const h1 = headingOf(samples[i] as Pt, samples[i + w] as Pt);
    if (Math.abs(angDiff(h0, h1)) * (180 / PI) > TURN_DEG) {
      const s = i * STEP_M;
      if (s > startS + 40 && s < finishS - 40 && s - lastTurn > 80) {
        turnS.push(s);
        lastTurn = s;
      }
    }
  }
  const marks = [startS, ...turnS, finishS].sort((a, b) => a - b);
  const all: number[] = [marks[0] as number];
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1] as number;
    const b = marks[i] as number;
    const n = Math.max(1, Math.ceil((b - a) / GATE_EVERY_M));
    for (let k = 1; k <= n; k++) all.push(a + ((b - a) * k) / n);
  }
  const gates: GateDef[] = all.map((s0, i) => {
    const s = Math.round(s0 * 10) / 10;
    const g = at(s);
    const kind: GateDef['kind'] = i === 0 ? 'start' : i === all.length - 1 ? 'finish' : 'gate';
    return { s, widthM: DEFAULT_WIDTH_M, kind, at: [round(g.p.x, 3), round(g.p.y, 3), round(g.p.z, 3)], tangent: [round(g.tx, 4), round(g.tz, 4)] };
  });
  // overrides: apply to the gate nearest the point, or insert one when nothing is within 60 m
  for (const o of src.gateOverrides ?? []) {
    const p = waypointEnu(o.at as never);
    const s = sOfPoint(samples, p.x, p.z);
    let bi = -1;
    let bd = 60;
    gates.forEach((g, i) => {
      if (Math.abs(g.s - s) < bd) {
        bd = Math.abs(g.s - s);
        bi = i;
      }
    });
    if (o.remove) {
      if (bi > 0 && bi < gates.length - 1) gates.splice(bi, 1);
      continue;
    }
    let g = gates[bi];
    if (!g) {
      const pt = at(s);
      g = { s: Math.round(s * 10) / 10, widthM: DEFAULT_WIDTH_M, kind: 'gate', at: [round(pt.p.x, 3), round(pt.p.y, 3), round(pt.p.z, 3)], tangent: [round(pt.tx, 4), round(pt.tz, 4)] };
      gates.push(g);
      gates.sort((a, b) => a.s - b.s);
    }
    if (o.widthM !== undefined) g.widthM = o.widthM;
    if (o.timeBonusSec !== undefined) g.timeBonusSec = o.timeBonusSec;
    if (o.speedCam && g.kind === 'gate') g.kind = 'speedCam';
  }
  return gates;
}

const round = (x: number, d: number): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};

export interface Compiled {
  def: RaceDef;
  /** Centreline samples (metres), for the corridor and the validator. */
  samples: Pt[];
  stats: { lengthM: number; maxGradePct: number; legs: number };
}

export function compileRace(source: RaceSource, bg: BakeGraph): Compiled {
  const wp = source.waypoints;
  const order = [wp[0], ...(source.via ?? []), ...wp.slice(1)];
  const snaps: Snapped[] = [];
  order.forEach((p, i) => {
    const e = waypointEnu(p as never);
    const sn = snapPoint(bg, e.x, e.z);
    if (!sn) throw new CompileError('V1', `waypoint ${i} (${e.x.toFixed(0)}, ${e.z.toFixed(0)}) is not within 25 m of a drivable edge`);
    snaps.push(sn);
  });
  const legs = routeLegs(bg, snaps);
  const poly = buildPolyline(bg, legs);
  const { samples, lengthM: rawLen } = resample(poly.pts, STEP_M);
  const lengthM = Math.round(rawLen * 10) / 10;

  // elevation every 25 m, grade, curvature
  const elevation: { s: number; y: number }[] = [];
  for (let s = 0; s < lengthM; s += 25) elevation.push({ s, y: round((samples[Math.round(s / STEP_M)] as Pt).y, 2) });
  elevation.push({ s: lengthM, y: round((samples[samples.length - 1] as Pt).y, 2) });
  let maxGrade = 0;
  for (let i = 1; i < elevation.length; i++) {
    const a = elevation[i - 1] as { s: number; y: number };
    const b = elevation[i] as { s: number; y: number };
    const g = (Math.abs(b.y - a.y) / Math.max(1, b.s - a.s)) * 100;
    if (g > maxGrade) maxGrade = g;
  }
  const curvature: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)] as Pt;
    const b = samples[i] as Pt;
    const c = samples[Math.min(samples.length - 1, i + 1)] as Pt;
    const d = i === 0 || i === samples.length - 1 ? 0 : angDiff(headingOf(a, b), headingOf(b, c)) / STEP_M;
    curvature.push(Math.max(-32768, Math.min(32767, Math.round(d * 1e4))));
  }
  const dm = (v: number): number => Math.round(v * 10);
  const start: [number, number] = [dm((samples[0] as Pt).x), dm((samples[0] as Pt).z)];
  const dxz: number[] = [];
  let px = start[0];
  let pz = start[1];
  for (let i = 1; i < samples.length; i++) {
    const nx = dm((samples[i] as Pt).x);
    const nz = dm((samples[i] as Pt).z);
    dxz.push(nx - px, nz - pz);
    px = nx;
    pz = nz;
  }

  const gridCount = Math.max(1, 1 + source.opponents.length);
  const gates = placeGates(source, samples, lengthM, gridCount);
  // grid slots: the pole sits 6 m before the start gate, each further slot 6 m back; all stay on the route (s >= 0)
  const grid = Array.from({ length: gridCount }, (_, k) => ({ s: round((gates[0] as GateDef).s - GRID_SPACING_M - GRID_SPACING_M * k, 1), lane: k % 2, offsetM: 0 }));

  const closures = (source.closures ?? []).map((c) => {
    const p = waypointEnu(c.at as never);
    const ll = 'lat' in (c.at as object) ? (c.at as { lat: number; lng: number }) : { lat: 0, lng: 0 };
    return { s: round(sOfPoint(samples, p.x, p.z), 1), lat: ll.lat, lng: ll.lng, propSet: c.propSet };
  });
  const zones = (source.zones ?? []).map((z) => ({
    id: z.id, kind: z.kind,
    ringEnu: z.ring.map((r) => { const p = waypointEnu(r as never); return [round(p.x, 2), round(p.z, 2)] as [number, number]; }),
  }));

  const parSec = Math.round((lengthM / PAR_MPS) * 10) / 10;
  const def: RaceDef = {
    schema: 1,
    id: source.id,
    version: source.version,
    kind: source.kind,
    titleKey: source.titleKey,
    district: source.district,
    ...(source.laps !== undefined ? { laps: source.laps } : {}),
    ...(source.closedLoop !== undefined ? { closedLoop: source.closedLoop } : {}),
    ...(source.hour !== undefined ? { hour: source.hour } : {}),
    ...(source.weather !== undefined ? { weather: source.weather } : {}),
    traffic: source.traffic,
    peds: source.peds,
    opponents: source.opponents,
    ...(source.classLimit ? { classLimit: source.classLimit } : {}),
    ...(source.loaner ? { loaner: source.loaner } : {}),
    police: source.police,
    rubberBand: source.rubberBand,
    rewards: source.rewards,
    ...(source.unlocks ? { unlocks: source.unlocks } : {}),
    xr: source.xr,
    ...(source.story ? { story: source.story } : {}),
    worldBake: bg.bakeId,
    waypoints: source.waypoints,
    route: poly.edges.map((e, i) => ({ edgeIds: [e], dir: poly.dirs[i] as 1 | -1 })),
    routeLenM: lengthM,
    elevation,
    gates,
    closures,
    zones,
    grid,
    jumpZones: [],
    line: { stepM: STEP_M, curvature, offsetCm: new Array<number>(samples.length).fill(0), start, dxz },
    parSec,
    parBotHash: 'pending',
    medals: [round(parSec * 1.25, 1), round(parSec * 1.12, 1), round(parSec * 1.04, 1)],
  };
  return { def, samples, stats: { lengthM, maxGradePct: round(maxGrade, 1), legs: legs.length } };
}

/** `race.json` text: one key per line, every value compact, so a diff shows what moved. Deterministic. */
export function raceJson(def: RaceDef): string {
  const order: (keyof RaceDef)[] = [
    'schema', 'id', 'version', 'kind', 'titleKey', 'district', 'laps', 'closedLoop', 'hour', 'weather', 'traffic', 'peds', 'opponents', 'classLimit', 'loaner',
    'police', 'rubberBand', 'rewards', 'unlocks', 'xr', 'story', 'worldBake', 'waypoints', 'route', 'routeLenM', 'elevation', 'gates', 'closures', 'zones',
    'grid', 'jumpZones', 'line', 'parSec', 'parBotHash', 'medals',
  ];
  const lines: string[] = [];
  for (const k of order) {
    const v = def[k];
    if (v === undefined) continue;
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  }
  return `{\n${lines.join(',\n')}\n}\n`;
}

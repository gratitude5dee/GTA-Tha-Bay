/**
 * Curbs, gutters and sidewalk ribbons (M02h2): the edges of the streets, built from the C08 `PedEdge` graph instead of the 4 m ground-class
 * grid. Everything goes into the chunk's existing `roads` object (no render object is added). Pure and deterministic: no `three`, no
 * randomness, so it runs in asset.worker and in the unit tests.
 *
 *  - attached sidewalks: a `Sidewalk` ped edge whose two ends both lie `attachM` (1.6 m) +- `attachTolM` past a road's curb line (the bake puts
 *    derived sidewalk centrelines at carriageway/2 + 1.6 m, 02-world-living.md section 4.1). Consecutive attached edges are joined into chains
 *    (a chain runs through every ped node with exactly two attached edges, so a block's sidewalk is one ribbon round its corners); a chain
 *    is a ribbon from the curb line (`attachM` toward the road) to `widthM / 2` past the ped centreline, joined with mitres at its nodes (the
 *    corner fans), and a mitre point that falls inside a junction patch of M02h1 is pulled back to the plain bevel;
 *  - the curb (profiles `desktop`, `visionpro`, `mobile`): a face `heightM` over the road ribbon (buried `buryM` under it), a 2 cm bevel on
 *    `desktop`, a `topM` concrete band, then the sidewalk at the same height and a skirt down to the ground at the outer edge; the curb drops
 *    to 0 within `rampM` (along the ribbon) of every `Crosswalk` start and rises again over `rampRunM`;
 *  - `low` (`mobile-low`): a flat strip `lowLiftM` over the road with the curb band painted in the vertex colour, no curb face;
 *  - unattached sidewalks (an edge whose ends do not both sit by a curb line): a flat walkway `widthM` wide, no curb;
 *  - the gutter: the sides of the road ribbons that have an attached sidewalk (`curbedSides`), drawn by `addRibbon` as an edge strip;
 *  - the walk mask: a bit per 1 m cell of the chunk (65,536 bits, 8 KiB) set where a cell centre lies on a full-height curbed sidewalk; the
 *    pedestrians and the player figure draw `liftM` higher there (render only: the sim, the heightfield and the collision are untouched).
 *
 * The raise of each vertex over the road (centimetres) rides in the `surf` attribute's third byte, so the `curbs` layer can put the sidewalks
 * back on the road plane in the shader without a new mesh.
 */
import { PedEdgeKind, sampleHeight, type PedEdge, type PedNode, type SimChunk } from '@dv/shared';
import mesherJson from '../../../../../config/world/mesher.json';
import { GROUND_NAMES, Surf } from '../look/surfaces.ts';
import type { PlannedJunction, RoadsContext, RoadsPlan } from './junction-patch.ts';

export type CurbProfile = 'desktop' | 'visionpro' | 'mobile' | 'low';

export interface CurbsConfig {
  attachM: number;
  attachTolM: number;
  heightM: number;
  topM: number;
  bevelM: number;
  gutterM: number;
  rampM: number;
  rampRunM: number;
  lowLiftM: number;
  skirtM: number;
  buryM: number;
  resampleM: Record<CurbProfile, number>;
  faces: Record<CurbProfile, boolean>;
  bevel: Record<CurbProfile, boolean>;
  gutter: Record<CurbProfile, boolean>;
  miterLimit: number;
  footAoM: number;
  footAo: number;
  curb: string;
  gutterColor: string;
  paint: string;
}

export const CURBS: CurbsConfig = (mesherJson as unknown as { curbs: CurbsConfig }).curbs;

type Rgb = readonly [number, number, number];
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
};
export const CURB_COLOR: Rgb = hexRgb(CURBS.curb);
export const GUTTER_COLOR: Rgb = hexRgb(CURBS.gutterColor);
export const PAINT_COLOR: Rgb = hexRgb(CURBS.paint);
const SIDEWALK_COLOR: Rgb = hexRgb((mesherJson as unknown as { ground: string[] }).ground[GROUND_NAMES.indexOf('Sidewalk')] as string);

/** Cells of the walk mask per side (1 m cells over a 256 m chunk) and its size in bytes. */
export const WALK_CELLS = 256;
export const WALK_BYTES = (WALK_CELLS * WALK_CELLS) / 8;

/** The lift of a set walk-mask bit on a mesher profile: the curb height, or the painted strip's lift on `low`. */
export const walkLiftOf = (profile: CurbProfile, c: CurbsConfig = CURBS): number => (c.faces[profile] ? c.heightM : c.lowLiftM);

/** Whether the walk mask has the bit of local cell (col, row) set. */
export function walkBit(mask: Uint8Array, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= WALK_CELLS || row >= WALK_CELLS) return false;
  const i = row * WALK_CELLS + col;
  return (((mask[i >> 3] as number) >> (i & 7)) & 1) === 1;
}

/** The lift at local (x, z) metres of a chunk: `liftM` on a set cell, else 0. */
export const walkLiftAt = (mask: Uint8Array, liftM: number, x: number, z: number): number => (walkBit(mask, Math.floor(x), Math.floor(z)) ? liftM : 0);

// ---- the nearest road (a grid over the tile's segments, memoised per tile) ----------------------------------------------------------------

const GRID_M = 32;

interface SegIndex {
  cells: Map<number, number[]>;
}

const indexes = new WeakMap<RoadsContext, SegIndex>();

const cellKey = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);

function segIndexOf(ctx: RoadsContext): SegIndex {
  const memo = indexes.get(ctx);
  if (memo) return memo;
  const cells = new Map<number, number[]>();
  const ids = [...ctx.segById.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const b = ctx.bounds.get(id) as [number, number, number, number];
    const seg = ctx.segById.get(id);
    const pad = (seg?.widthM ?? 0) / 2 + 4;
    for (let cz = Math.floor((b[1] - pad) / GRID_M); cz <= Math.floor((b[3] + pad) / GRID_M); cz++) {
      for (let cx = Math.floor((b[0] - pad) / GRID_M); cx <= Math.floor((b[2] + pad) / GRID_M); cx++) {
        const k = cellKey(cx, cz);
        const l = cells.get(k);
        if (l) l.push(id);
        else cells.set(k, [id]);
      }
    }
  }
  const idx = { cells };
  indexes.set(ctx, idx);
  return idx;
}

/** The road nearest (x, z): centreline height, half width, class, the centreline point and tangent, and which side of it (x, z) lies on. */
export interface RoadHit {
  seg: number;
  y: number;
  halfM: number;
  cls: number;
  qx: number;
  qz: number;
  tx: number;
  tz: number;
  dist: number;
  /** +1: (x, z) lies on the `left` of `ribbonSides` (the side at (-tz, +tx)); -1 the other. */
  side: 1 | -1;
}

export function roadNear(ctx: RoadsContext, x: number, z: number, maxM = 24): RoadHit | null {
  const idx = segIndexOf(ctx);
  const seen = new Set<number>();
  let best: RoadHit | null = null;
  const r = Math.ceil(maxM / GRID_M);
  const ccx = Math.floor(x / GRID_M), ccz = Math.floor(z / GRID_M);
  for (let cz = ccz - r; cz <= ccz + r; cz++) {
    for (let cx = ccx - r; cx <= ccx + r; cx++) {
      for (const id of idx.cells.get(cellKey(cx, cz)) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const seg = ctx.segById.get(id);
        if (!seg) continue;
        const p = seg.pts;
        for (let i = 0; i + 1 < p.length / 3; i++) {
          const ax = p[i * 3] as number, az = p[i * 3 + 2] as number, bx = p[i * 3 + 3] as number, bz = p[i * 3 + 5] as number;
          const dx = bx - ax, dz = bz - az;
          const l2 = dx * dx + dz * dz;
          const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
          const qx = ax + dx * t, qz = az + dz * t;
          const d = Math.hypot(x - qx, z - qz);
          // the road whose curb line is nearest wins (a wide road's curb can be nearer than a narrow road's centreline)
          const edge = d - seg.widthM / 2;
          if (d > maxM || (best !== null && edge >= best.dist - best.halfM - 1e-9)) continue;
          const l = Math.sqrt(l2) || 1;
          const tx = dx / l, tz = dz / l;
          best = {
            seg: id,
            y: (p[i * 3 + 1] as number) + ((p[i * 3 + 4] as number) - (p[i * 3 + 1] as number)) * t,
            halfM: seg.widthM / 2,
            cls: ctx.clsOfSeg.get(id) ?? 4,
            qx, qz, tx, tz, dist: d,
            side: (x - qx) * -tz + (z - qz) * tx >= 0 ? 1 : -1,
          };
        }
      }
    }
  }
  return best;
}

// ---- classification ---------------------------------------------------------------------------------------------------------------------

/** How far past the curb line of the nearest road a point is (metres), or null with no road near. */
export function curbOffset(ctx: RoadsContext, x: number, z: number): { off: number; hit: RoadHit } | null {
  const hit = roadNear(ctx, x, z);
  return hit ? { off: hit.dist - hit.halfM, hit } : null;
}

/** Whether a ped node sits a sidewalk's width past a curb line (`attachM` +- `attachTolM`). */
export function nodeAttached(ctx: RoadsContext, x: number, z: number, c: CurbsConfig = CURBS): boolean {
  const o = curbOffset(ctx, x, z);
  return o !== null && Math.abs(o.off - c.attachM) <= c.attachTolM;
}

export interface SidewalkEdgeClass {
  /** Index into `sim.pedEdges`. */
  edge: number;
  attached: boolean;
}

/** The `Sidewalk` ped edges of a chunk and whether each is attached (both ends by a curb line). */
export function classifySidewalks(sim: SimChunk, ctx: RoadsContext, c: CurbsConfig = CURBS): SidewalkEdgeClass[] {
  const nodes = nodeMap(sim);
  const out: SidewalkEdgeClass[] = [];
  sim.pedEdges.forEach((pe, i) => {
    if (pe.kind !== PedEdgeKind.Sidewalk) return;
    const a = nodes.get(pe.a), b = nodes.get(pe.b);
    if (!a || !b) return;
    out.push({ edge: i, attached: nodeAttached(ctx, a.x, a.z, c) && nodeAttached(ctx, b.x, b.z, c) });
  });
  return out;
}

const nodeMaps = new WeakMap<SimChunk, Map<number, PedNode>>();
function nodeMap(sim: SimChunk): Map<number, PedNode> {
  let m = nodeMaps.get(sim);
  if (!m) {
    m = new Map();
    for (const n of sim.pedNodes) m.set(n.id, n);
    nodeMaps.set(sim, m);
  }
  return m;
}

const curbedMemo = new WeakMap<RoadsContext, Map<number, number>>();

/**
 * The curbed sides of the tile's road segments: bit 0 the `left` of `ribbonSides`, bit 1 the `right`. A side is curbed when an attached
 * sidewalk edge of any chunk of the tile runs beside it (its midpoint `attachM` +- `attachTolM` past that side's curb line).
 */
export function curbedSides(ctx: RoadsContext, c: CurbsConfig = CURBS): Map<number, number> {
  const memo = curbedMemo.get(ctx);
  if (memo) return memo;
  const out = new Map<number, number>();
  for (const sim of ctx.chunks) {
    const nodes = nodeMap(sim);
    for (const pe of sim.pedEdges) {
      if (pe.kind !== PedEdgeKind.Sidewalk) continue;
      const a = nodes.get(pe.a), b = nodes.get(pe.b);
      if (!a || !b) continue;
      const o = curbOffset(ctx, (a.x + b.x) / 2, (a.z + b.z) / 2);
      if (!o || Math.abs(o.off - c.attachM) > c.attachTolM) continue;
      if (!nodeAttached(ctx, a.x, a.z, c) || !nodeAttached(ctx, b.x, b.z, c)) continue;
      out.set(o.hit.seg, (out.get(o.hit.seg) ?? 0) | (o.hit.side === 1 ? 1 : 2));
    }
  }
  curbedMemo.set(ctx, out);
  return out;
}

// ---- the builder ----------------------------------------------------------------------------------------------------------------------

/** The part of `MeshBuilder` the sidewalks use (mesher.ts owns the class; this keeps the import one way). */
export interface RibbonSink {
  setSurf(id: number, palette?: number, code?: number, flags?: number): void;
  vertex(x: number, y: number, z: number, n: Rgb, c: Rgb, ao?: number): number;
  tri(a: number, b: number, c: number): void;
  triFacing(a: number, b: number, c: number, nx: number, ny: number, nz: number): void;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

export interface CurbStats {
  /** Sidewalk ped edges meshed (attached and unattached). */
  ribbons: number;
  attached: number;
  unattached: number;
  /** Chains the attached edges were joined into. */
  chains: number;
  /** Metres of curb line with a curb (or the painted band on `low`). */
  curbedM: number;
  /** Ramps: crosswalk starts on a curbed ribbon. */
  rampCount: number;
  /** Triangles the sidewalks added to the roads object. */
  triangles: number;
}

/** A sample of a curbed ribbon, for the tests: the curb point (world), the road top under it, the sidewalk top, the curb height there. */
export interface CurbSample {
  x: number;
  z: number;
  roadTop: number;
  top: number;
  heightM: number;
  /** Distance along the ribbon to the nearest crosswalk start (Infinity with none). */
  rampD: number;
  /** The outer edge point of the ribbon there (world). */
  outerX: number;
  outerZ: number;
}

export interface SidewalkResult {
  stats: CurbStats;
  /** The walk mask of the chunk (`WALK_BYTES`), see `walkBit`. */
  walk: Uint8Array;
  liftM: number;
  /** Only with `debug`. */
  samples?: CurbSample[];
}

export interface SidewalkOptions {
  profile: CurbProfile;
  plan: RoadsPlan | null;
  /** The height of a road ribbon of class `cls` over its centreline points (mesher.ts `ribbonLift`). */
  lift: (cls: number) => number;
  debug?: boolean;
  config?: CurbsConfig;
}

interface Pt {
  x: number;
  z: number;
}

/** The raise of a vertex over the road in the `surf` code byte (centimetres, 0..255). */
const raiseCode = (m: number): number => Math.max(0, Math.min(255, Math.round(m * 100)));

/**
 * Builds the sidewalks of `sim` into `b` (local to `ox`, `oz`). `ctx` is the tile the roads were planned over (M02h1), so a sidewalk whose
 * road is owned by the next chunk still finds it.
 */
export function buildSidewalks(b: RibbonSink, sim: SimChunk, ctx: RoadsContext, ox: number, oz: number, o: SidewalkOptions): SidewalkResult {
  const c = o.config ?? CURBS;
  const prof = o.profile;
  const tris0 = b.triangleCount;
  const stats: CurbStats = { ribbons: 0, attached: 0, unattached: 0, chains: 0, curbedM: 0, rampCount: 0, triangles: 0 };
  const walk = new Uint8Array(WALK_BYTES);
  const samples: CurbSample[] | undefined = o.debug ? [] : undefined;
  const nodes = nodeMap(sim);
  const classes = classifySidewalks(sim, ctx, c);
  const attached = classes.filter((k) => k.attached).map((k) => k.edge);
  const loose = classes.filter((k) => !k.attached).map((k) => k.edge);

  // crosswalk starts of the tile (the ped nodes a crosswalk leaves from)
  const starts: Pt[] = [];
  for (const list of ctx.crosswalks.values()) for (const r of list) starts.push({ x: r.a.x, z: r.a.z }, { x: r.b.x, z: r.b.z });
  const isStart = (x: number, z: number): boolean => starts.some((s) => Math.abs(s.x - x) < 0.25 && Math.abs(s.z - z) < 0.25);
  const patches = o.plan ? [...o.plan.junctions.values()] : [];

  for (const chain of chainsOf(attached, sim.pedEdges)) {
    stats.chains++;
    stats.attached += chain.edges.length;
    stats.ribbons += chain.edges.length;
    const pts = chain.nodes.map((id) => nodes.get(id) as PedNode);
    const width = Math.max(...chain.edges.map((e) => (sim.pedEdges[e] as PedEdge).widthM));
    const r = curbedChain(b, pts, chain.closed, width, ctx, ox, oz, prof, c, o.lift, isStart, patches, walk, samples);
    stats.curbedM += r.curbedM;
    stats.rampCount += r.ramps;
  }
  for (const e of loose) {
    const pe = sim.pedEdges[e] as PedEdge;
    const a = nodes.get(pe.a) as PedNode, bn = nodes.get(pe.b) as PedNode;
    walkway(b, sim, a, bn, pe.widthM, ox, oz, prof, c, o.lift);
    stats.unattached++;
    stats.ribbons++;
  }
  stats.triangles = b.triangleCount - tris0;
  return { stats, walk, liftM: walkLiftOf(prof, c), ...(samples ? { samples } : {}) };
}

/** Chains of attached edges: maximal runs through nodes with exactly two attached edges; a run that comes back to its start is closed. */
export function chainsOf(edges: readonly number[], all: readonly PedEdge[]): { nodes: number[]; edges: number[]; closed: boolean }[] {
  const at = new Map<number, number[]>();
  const add = (n: number, e: number): void => {
    const l = at.get(n);
    if (l) l.push(e);
    else at.set(n, [e]);
  };
  for (const e of edges) {
    const pe = all[e] as PedEdge;
    add(pe.a, e);
    add(pe.b, e);
  }
  const used = new Set<number>();
  const out: { nodes: number[]; edges: number[]; closed: boolean }[] = [];
  const other = (e: number, n: number): number => ((all[e] as PedEdge).a === n ? (all[e] as PedEdge).b : (all[e] as PedEdge).a);
  const through = (n: number): boolean => (at.get(n)?.length ?? 0) === 2;
  for (const e0 of edges) {
    if (used.has(e0)) continue;
    used.add(e0);
    const pe = all[e0] as PedEdge;
    const fwdNodes: number[] = [pe.a, pe.b];
    const fwdEdges: number[] = [e0];
    // forward from b
    let n = pe.b;
    let closed = false;
    while (through(n)) {
      const next = (at.get(n) as number[]).find((e) => !used.has(e));
      if (next === undefined) {
        closed = n === pe.a || (at.get(n) as number[]).every((e) => used.has(e)) && n === fwdNodes[0];
        break;
      }
      used.add(next);
      n = other(next, n);
      fwdEdges.push(next);
      fwdNodes.push(n);
      if (n === pe.a) {
        closed = true;
        break;
      }
    }
    if (!closed) {
      // backward from a
      n = pe.a;
      while (through(n)) {
        const next = (at.get(n) as number[]).find((e) => !used.has(e));
        if (next === undefined) break;
        used.add(next);
        n = other(next, n);
        fwdEdges.unshift(next);
        fwdNodes.unshift(n);
      }
    }
    out.push({ nodes: fwdNodes, edges: fwdEdges, closed });
  }
  return out;
}

/** How deep (metres) a point lies inside a junction patch's outline; negative outside. */
function depthInPatch(pj: PlannedJunction, x: number, z: number): number {
  let depth = Infinity;
  const h = pj.hull;
  for (let k = 0; k < h.length; k++) {
    const a = pj.corners[h[k] as number] as Pt, bq = pj.corners[h[(k + 1) % h.length] as number] as Pt;
    const ex = bq.x - a.x, ez = bq.z - a.z;
    const len = Math.hypot(ex, ez) || 1;
    depth = Math.min(depth, (ex * (z - a.z) - ez * (x - a.x)) / len);
  }
  return depth;
}

interface Sample {
  x: number;
  z: number;
  /** Unit normal toward the road, and the mitre factor of the curb-side offset (1 on a straight run). */
  nx: number;
  nz: number;
  k: number;
  s: number;
}

function curbedChain(
  b: RibbonSink, pts: readonly PedNode[], closed: boolean, width: number, ctx: RoadsContext, ox: number, oz: number, prof: CurbProfile, c: CurbsConfig,
  lift: (cls: number) => number, isStart: (x: number, z: number) => boolean, patches: readonly PlannedJunction[], walk: Uint8Array, samples: CurbSample[] | undefined,
): { curbedM: number; ramps: number } {
  const n = pts.length;
  // the open polyline of the chain (a closed chain repeats its first node at the end)
  const poly: Pt[] = pts.map((p) => ({ x: p.x, z: p.z }));
  const segs = n - 1;
  // the road side: the side of most of the edges' midpoints' nearest road
  let vote = 0;
  for (let i = 0; i < segs; i++) {
    const a = poly[i] as Pt, q = poly[i + 1] as Pt;
    const mx = (a.x + q.x) / 2, mz = (a.z + q.z) / 2;
    const hit = roadNear(ctx, mx, mz);
    if (!hit) continue;
    const tx = q.x - a.x, tz = q.z - a.z;
    // the edge's left normal (-tz, tx) against the direction to the road
    vote += Math.sign(-tz * (hit.qx - mx) + tx * (hit.qz - mz));
  }
  const sigma = vote >= 0 ? 1 : -1;
  const normalOf = (i: number): Pt => {
    const a = poly[i] as Pt, q = poly[i + 1] as Pt;
    const tx = q.x - a.x, tz = q.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    return { x: (-tz / l) * sigma, z: (tx / l) * sigma };
  };
  const segN = Array.from({ length: segs }, (_, i) => normalOf(i));
  // arc lengths of the nodes
  const sAt: number[] = [0];
  for (let i = 1; i < n; i++) sAt.push((sAt[i - 1] as number) + Math.hypot((poly[i] as Pt).x - (poly[i - 1] as Pt).x, (poly[i] as Pt).z - (poly[i - 1] as Pt).z));
  const L = sAt[n - 1] as number;
  if (!(L > 0.05)) return { curbedM: 0, ramps: 0 };
  // ramp centres: the chain nodes a crosswalk starts from
  const ramps: number[] = [];
  for (let i = 0; i < n; i++) if ((!closed || i < n - 1) && isStart((poly[i] as Pt).x, (poly[i] as Pt).z)) ramps.push(sAt[i] as number);
  const rampD = (s: number): number => {
    let d = Infinity;
    for (const r of ramps) {
      const dd = Math.abs(s - r);
      d = Math.min(d, closed ? Math.min(dd, L - dd) : dd);
    }
    return d;
  };
  const faces = c.faces[prof];
  const H = c.heightM;
  // the ramp: 0 within `rampM` (a millimetre of slack for the arc-length sums), up to the full height over `rampRunM`
  const heightAt = (s: number): number => {
    if (!faces) return c.lowLiftM;
    const d = rampD(s) - c.rampM;
    return d <= 1e-6 ? 0 : H * Math.min(1, d / c.rampRunM);
  };

  // the sample arc lengths: every node, every `resampleM` between, and the ramp breakpoints
  const step = c.resampleM[prof];
  const cuts = new Set<number>();
  for (let i = 0; i < n; i++) cuts.add(sAt[i] as number);
  for (let i = 0; i < segs; i++) {
    const s0 = sAt[i] as number, s1 = sAt[i + 1] as number;
    const k = Math.ceil((s1 - s0) / step);
    for (let j = 1; j < k; j++) cuts.add(s0 + ((s1 - s0) * j) / k);
  }
  if (faces) {
    for (const r of ramps) {
      for (const d of [c.rampM, c.rampM + c.rampRunM]) {
        for (const s of [r - d, r + d]) {
          const w = closed ? ((s % L) + L) % L : s;
          if (w > 0 && w < L) cuts.add(w);
        }
      }
    }
  }
  // samples closer than a millimetre are one (a ramp break that falls on a node keeps the node, whose normal is the mitre)
  const nodeS = new Set(sAt);
  const order: number[] = [];
  for (const v of [...cuts].sort((p, q) => p - q)) {
    const last = order[order.length - 1];
    if (last !== undefined && v - last < 1e-3) {
      if (nodeS.has(v) && !nodeS.has(last)) order[order.length - 1] = v;
      continue;
    }
    order.push(v);
  }
  const list: Sample[] = [];
  let seg = 0;
  for (const s of order) {
    while (seg < segs - 1 && s > (sAt[seg + 1] as number) + 1e-9) seg++;
    const s0 = sAt[seg] as number, s1 = sAt[seg + 1] as number;
    const t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
    const a = poly[seg] as Pt, q = poly[seg + 1] as Pt;
    const x = a.x + (q.x - a.x) * t, z = a.z + (q.z - a.z) * t;
    // a node sample between two edges takes the mitre of the two edge normals
    const atNode = Math.abs(s - s0) < 1e-6 ? seg : Math.abs(s - s1) < 1e-6 ? seg + 1 : -1;
    let nIn = segN[seg] as Pt, nOut = segN[seg] as Pt;
    if (atNode >= 0) {
      const prev = atNode - 1 >= 0 ? atNode - 1 : closed ? segs - 1 : -1;
      const next = atNode < segs ? atNode : closed ? 0 : -1;
      nIn = prev >= 0 ? (segN[prev] as Pt) : (segN[next] as Pt);
      nOut = next >= 0 ? (segN[next] as Pt) : (segN[prev] as Pt);
    }
    let mx = nIn.x + nOut.x, mz = nIn.z + nOut.z;
    const ml = Math.hypot(mx, mz);
    let k = 1;
    if (ml > 1e-6) {
      mx /= ml;
      mz /= ml;
      k = Math.min(c.miterLimit, 1 / Math.max(1e-3, mx * nIn.x + mz * nIn.z));
    } else {
      mx = nIn.x;
      mz = nIn.z;
    }
    // the corner fan stays out of a junction patch: a mitre point inside one goes back to the plain offset
    if (k > 1.0001) {
      const cx = x + mx * c.attachM * k, cz = z + mz * c.attachM * k;
      for (const pj of patches) {
        if (Math.hypot(pj.x - cx, pj.z - cz) > pj.radiusM * 3 + 10) continue;
        if (depthInPatch(pj, cx, cz) > 0.05) {
          k = 1;
          break;
        }
      }
    }
    list.push({ x, z, nx: mx, nz: mz, k, s });
  }
  if (closed && list.length > 0) {
    // the closing sample repeats the first one's position and normal
    const f = list[0] as Sample;
    const last = list[list.length - 1] as Sample;
    if (Math.abs(last.s - L) > 1e-6) list.push({ ...f, s: L });
    else list[list.length - 1] = { ...f, s: L };
  }

  // per sample: the curb point, the road top under it, the sidewalk top
  interface Row { cx: number; cz: number; ox: number; oz: number; bx: number; bz: number; vx: number; vz: number; roadTop: number; h: number; top: number; ground: number; nx: number; nz: number }
  const rows: Row[] = list.map((p) => {
    const cx = p.x + p.nx * c.attachM * p.k, cz = p.z + p.nz * c.attachM * p.k;
    const hit = roadNear(ctx, cx, cz, 30);
    const roadTop = hit ? hit.y + lift(hit.cls) : sampleHeightIn(ctx, p.x, p.z) + lift(4);
    const h = heightAt(p.s);
    const half = width / 2;
    const ox2 = p.x - p.nx * half * p.k, oz2 = p.z - p.nz * half * p.k;
    const band = c.attachM - c.topM;
    const bev = c.attachM - c.bevelM;
    const top = roadTop + h;
    return {
      cx, cz, ox: ox2, oz: oz2,
      bx: p.x + p.nx * band * p.k, bz: p.z + p.nz * band * p.k,
      vx: p.x + p.nx * bev * p.k, vz: p.z + p.nz * bev * p.k,
      roadTop, h, top,
      ground: Math.min(sampleHeightIn(ctx, ox2, oz2), top) - c.skirtM,
      nx: p.nx, nz: p.nz,
    };
  });
  if (samples) for (let i = 0; i < rows.length; i++) samples.push({ x: (rows[i] as Row).cx, z: (rows[i] as Row).cz, roadTop: (rows[i] as Row).roadTop, top: (rows[i] as Row).top, heightM: (rows[i] as Row).h, rampD: rampD((list[i] as Sample).s), outerX: (rows[i] as Row).ox, outerZ: (rows[i] as Row).oz });

  const UP: Rgb = [0, 1, 0];
  const bevel = faces && c.bevel[prof];
  const ids = rows.map((r) => {
    const face: Rgb = [r.nx, 0, r.nz];
    const back: Rgb = [-r.nx, 0, -r.nz];
    const foot = 1 - c.footAo;
    const L0 = (x: number, y: number, z: number, n: Rgb, col: Rgb, ao = 1): number => b.vertex(x - ox, y, z - oz, n, col, ao);
    const out: Record<string, number> = {};
    if (faces) {
      b.setSurf(Surf.Curb, 0, 0);
      out['cb'] = L0(r.cx, r.roadTop - c.buryM, r.cz, face, CURB_COLOR, foot);
      const ctop = bevel ? r.top - c.bevelM : r.top;
      b.setSurf(Surf.Curb, 0, raiseCode(Math.max(0, ctop - r.roadTop)));
      out['ct'] = L0(r.cx, ctop, r.cz, face, CURB_COLOR);
      b.setSurf(Surf.Curb, 0, raiseCode(r.h));
      out['tt'] = bevel ? L0(r.vx, r.top, r.vz, UP, CURB_COLOR) : L0(r.cx, r.top, r.cz, UP, CURB_COLOR);
      out['bc'] = L0(r.bx, r.top, r.bz, UP, CURB_COLOR);
    } else {
      b.setSurf(Surf.Curb, 0, raiseCode(r.h));
      out['tt'] = L0(r.cx, r.top, r.cz, UP, PAINT_COLOR);
      out['bc'] = L0(r.bx, r.top, r.bz, UP, PAINT_COLOR);
    }
    b.setSurf(Surf.Sidewalk, 0, raiseCode(r.h));
    out['bs'] = L0(r.bx, r.top, r.bz, UP, SIDEWALK_COLOR);
    out['os'] = L0(r.ox, r.top, r.oz, UP, SIDEWALK_COLOR);
    out['ok'] = L0(r.ox, r.top, r.oz, back, SIDEWALK_COLOR);
    b.setSurf(Surf.Sidewalk, 0, 0);
    out['ob'] = L0(r.ox, r.ground, r.oz, back, SIDEWALK_COLOR, 1 - c.footAo);
    return out;
  });
  let curbedM = 0;
  for (let i = 0; i + 1 < rows.length; i++) {
    const p = ids[i] as Record<string, number>, q = ids[i + 1] as Record<string, number>;
    const r0 = rows[i] as Row, r1 = rows[i + 1] as Row;
    const fx = (r0.nx + r1.nx) / 2, fz = (r0.nz + r1.nz) / 2;
    // a vertical strip from (ax, az) to (bx, bz) whose face points along `sign` x the row normals: drawn only where its own normal agrees
    // with both rows' (a sharp turn whose curb or outer edge folds back on itself on the inside draws no face there)
    const upright = (ax: number, az: number, bx: number, bz: number, sign: number): boolean => {
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-4) return false;
      let gx = -(bz - az) / len, gz = (bx - ax) / len;
      if (gx * fx * sign + gz * fz * sign < 0) {
        gx = -gx;
        gz = -gz;
      }
      return (gx * r0.nx + gz * r0.nz) * sign >= 0.1 && (gx * r1.nx + gz * r1.nz) * sign >= 0.1;
    };
    if (faces && upright(r0.cx, r0.cz, r1.cx, r1.cz, 1)) {
      b.triFacing(p['cb'] as number, q['cb'] as number, q['ct'] as number, fx, 0, fz);
      b.triFacing(p['cb'] as number, q['ct'] as number, p['ct'] as number, fx, 0, fz);
      if (bevel) {
        b.triFacing(p['ct'] as number, q['ct'] as number, q['tt'] as number, fx, 1, fz);
        b.triFacing(p['ct'] as number, q['tt'] as number, p['tt'] as number, fx, 1, fz);
      }
    }
    // the top surfaces, each triangle only where it lies flat enough to carry its up normal (a turn that folds the band or the walk onto
    // a line leaves a vertical sliver, which is dropped)
    const tx0 = bevel ? r0.vx : r0.cx, tz0 = bevel ? r0.vz : r0.cz, tx1 = bevel ? r1.vx : r1.cx, tz1 = bevel ? r1.vz : r1.cz;
    const flat = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): boolean => {
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      const len = Math.hypot(gx, gy, gz);
      return len > 1e-9 && Math.abs(gy) / len >= 0.3;
    };
    if (flat(tx0, r0.top, tz0, tx1, r1.top, tz1, r1.bx, r1.top, r1.bz)) b.triFacing(p['tt'] as number, q['tt'] as number, q['bc'] as number, 0, 1, 0);
    if (flat(tx0, r0.top, tz0, r1.bx, r1.top, r1.bz, r0.bx, r0.top, r0.bz)) b.triFacing(p['tt'] as number, q['bc'] as number, p['bc'] as number, 0, 1, 0);
    if (flat(r0.bx, r0.top, r0.bz, r1.bx, r1.top, r1.bz, r1.ox, r1.top, r1.oz)) b.triFacing(p['bs'] as number, q['bs'] as number, q['os'] as number, 0, 1, 0);
    if (flat(r0.bx, r0.top, r0.bz, r1.ox, r1.top, r1.oz, r0.ox, r0.top, r0.oz)) b.triFacing(p['bs'] as number, q['os'] as number, p['os'] as number, 0, 1, 0);
    if ((r0.top - r0.ground > 0.005 || r1.top - r1.ground > 0.005) && upright(r0.ox, r0.oz, r1.ox, r1.oz, -1)) {
      b.triFacing(p['ok'] as number, q['ok'] as number, q['ob'] as number, -fx, 0, -fz);
      b.triFacing(p['ok'] as number, q['ob'] as number, p['ob'] as number, -fx, 0, -fz);
    }
    const len = Math.hypot(r1.cx - r0.cx, r1.cz - r0.cz);
    curbedM += len;
    // the walk mask: a full-height interval away from the ramps (on every profile, so a crosswalk keeps lift 0 on `low` too) marks the cells
    // whose centres lie between its curb line and its outer edge
    const clear = rampD((list[i] as Sample).s) >= c.rampM + c.rampRunM - 1e-6 && rampD((list[i + 1] as Sample).s) >= c.rampM + c.rampRunM - 1e-6;
    if (clear && r0.h >= walkLiftOf(prof, c) - 1e-6 && r1.h >= walkLiftOf(prof, c) - 1e-6) {
      markQuad(walk, [r0.cx - ox, r0.cz - oz, r1.cx - ox, r1.cz - oz, r1.ox - ox, r1.oz - oz, r0.ox - ox, r0.oz - oz]);
    }
  }
  return { curbedM, ramps: ramps.length };
}

/** A flat walkway along one unattached edge, resampled on the ground. */
function walkway(b: RibbonSink, sim: SimChunk, a: PedNode, q: PedNode, width: number, ox: number, oz: number, prof: CurbProfile, c: CurbsConfig, lift: (cls: number) => number): void {
  const len = Math.hypot(q.x - a.x, q.z - a.z);
  if (!(len > 0.05)) return;
  const tx = (q.x - a.x) / len, tz = (q.z - a.z) / len;
  const nx = -tz * (width / 2), nz = tx * (width / 2);
  const k = Math.max(1, Math.ceil(len / c.resampleM[prof]));
  const UP: Rgb = [0, 1, 0];
  b.setSurf(Surf.Sidewalk, 0, 0);
  const row = (t: number): [number, number] => {
    const x = a.x + (q.x - a.x) * t, z = a.z + (q.z - a.z) * t;
    const y = Math.max(groundIn(sim, x + nx, z + nz), groundIn(sim, x - nx, z - nz)) + lift(4);
    return [b.vertex(x + nx - ox, y, z + nz - oz, UP, SIDEWALK_COLOR), b.vertex(x - nx - ox, y, z - nz - oz, UP, SIDEWALK_COLOR)];
  };
  let prev = row(0);
  for (let j = 1; j <= k; j++) {
    const cur = row(j / k);
    b.triFacing(prev[0], cur[0], cur[1], 0, 1, 0);
    b.triFacing(prev[0], cur[1], prev[1], 0, 1, 0);
    prev = cur;
  }
}

/** The ground of a chunk at (x, z), clamped into the chunk (a ribbon's side can reach a little past its border). */
function groundIn(sim: SimChunk, x: number, z: number): number {
  const g = sim.height;
  const edge = 64 * g.cellM;
  return sampleHeight(g, Math.min(g.originX + edge, Math.max(g.originX, x)), Math.min(g.originZ + edge, Math.max(g.originZ, z)));
}

/** The ground height of the chunk of the tile under (x, z) (C08 `sampleHeight`), 0 outside the tile. */
function sampleHeightIn(ctx: RoadsContext, x: number, z: number): number {
  for (const s of ctx.chunks) {
    const g = s.height;
    const edge = (g.dm.length === 65 * 65 ? 64 : Math.sqrt(g.dm.length) - 1) * g.cellM;
    if (x >= g.originX && x <= g.originX + edge && z >= g.originZ && z <= g.originZ + edge) return sampleHeight(g, x, z);
  }
  return 0;
}

/** Sets the walk bits of the cells whose centres lie inside a quad (local x, z pairs, in order around it). */
export function markQuad(walk: Uint8Array, q: readonly number[]): void {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    minX = Math.min(minX, q[i] as number);
    maxX = Math.max(maxX, q[i] as number);
    minZ = Math.min(minZ, q[i + 1] as number);
    maxZ = Math.max(maxZ, q[i + 1] as number);
  }
  const c0 = Math.max(0, Math.floor(minX - 0.5)), c1 = Math.min(WALK_CELLS - 1, Math.ceil(maxX - 0.5));
  const r0 = Math.max(0, Math.floor(minZ - 0.5)), r1 = Math.min(WALK_CELLS - 1, Math.ceil(maxZ - 0.5));
  for (let r = r0; r <= r1; r++) {
    for (let col = c0; col <= c1; col++) {
      if (!inPoly(q, col + 0.5, r + 0.5)) continue;
      const i = r * WALK_CELLS + col;
      walk[i >> 3] = (walk[i >> 3] as number) | (1 << (i & 7));
    }
  }
}

function inPoly(pts: readonly number[], x: number, z: number): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2] as number, zi = pts[i * 2 + 1] as number, xj = pts[j * 2] as number, zj = pts[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

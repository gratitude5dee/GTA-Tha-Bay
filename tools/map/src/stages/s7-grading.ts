/**
 * S7 grading (02-world-bake.md section 4 S7 rules 1 to 6; contract rules 6 and 7).
 *
 * Road surface heights come from the terrain profile of each segment smoothed with a 24 m moving average and clamped to
 * 40 % slope between 4 m samples; node heights are the mean of the incident segment ends and every segment fades to them
 * over its last 24 m. Posts within `widthM / 2 + 2 m` of a centreline blend to the road height (smoothstep over the last
 * 2 m); where several roads reach a post, the one with the largest blend weight wins, ties go to the better class and then
 * the lower segment id, so a post on a chunk edge gets the same value in both chunks. Freeways are processed first by that
 * tie-break (rule 1).
 *
 * Bridges and overpasses keep the terrain and add slabs (4 m long, 1.0 m thick, shortened where the grade would make a step
 * above 0.16 m, flat-topped on the 0.1 m grid). A deck rises from its abutments at most 6 % to terrain + 5.5 m x layer, or
 * to the named deck height of `config/world/bridges.json` for the Golden Gate and Bay Bridge. Tunnels run straight between
 * their portals; the corridor (`widthM + 3 m`) is lowered to the road height minus 0.5 m and covered by hood prisms from
 * road + 5.5 m up to the original terrain top in 20 m steps, and short ones whose cover is under 0.5 m stay open cuts.
 */
import {
  CHUNK_EDGE_M, GRID_MIN_M, TERRAIN_POSTS, EdgeFlag, chunkKeyAt, enuFromLatLng, type ChunkKey, type RoadEdge,
} from '../../../../packages/shared/src/index.ts';
import { polyLength, pointAt } from '../geom/poly.ts';
import type { NodeB, SegB } from './s5-roads.ts';
import { TerrainField } from './s2-terrain.ts';

export interface BridgesConfig {
  schema: 'world-bridges/1';
  overpass: { clearancePerLayerM: number; maxApproachGrade: number };
  slab: { lengthM: number; thicknessM: number; maxStepM: number };
  tunnel: { corridorExtraM: number; dropM: number; hoodClearanceM: number; hoodStepM: number; minHoodM: number };
  grade: { maxPct: number; smoothingM: number; sampleM: number; blendM: number };
  named: { id: string; lat: number; lng: number; radiusM: number; deckM: number }[];
  portals: { id: string; kind: 'bridge' | 'ferry' | 'tunnel' | 'county-line'; lat: number; lng: number; widthM: number; toArea: string | null; snapM: number }[];
  countyLine: { widthM: number; toArea: string | null };
  hero: { id: string; lat: number; lng: number; maxM: number }[];
}

export interface GradingStats {
  maxGradePct: number;
  slabs: number;
  hoods: number;
  tunnels: number;
  openCuts: number;
  overpasses: number;
  namedSpans: number;
  maxSlabStepM: number;
  slabsDropped: number;
  postsGraded: number;
}

export interface GradingInputs {
  segs: readonly SegB[];
  nodes: readonly NodeB[];
  edges: readonly RoadEdge[];
  grids: ReadonlyMap<ChunkKey, Int16Array>;
  cfg: BridgesConfig;
  /** Edges at or above this grade (percent) get the Hill flag. */
  hillGradePct: number;
}

export interface GradingProduct {
  segs: SegB[];
  nodes: NodeB[];
  edges: RoadEdge[];
  grids: Map<ChunkKey, Int16Array>;
  /** PrismPack numbers per chunk: [nVerts, baseY, heightM, x0, z0, ...]. */
  slabs: Map<ChunkKey, number[]>;
  hoods: Map<ChunkKey, number[]>;
  stats: GradingStats;
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const q10 = (v: number): number => Math.round(v * 10) / 10;

interface Prof { n: number; step: number; x: Float64Array; z: Float64Array; s: Float64Array; y: Float64Array; t: Float64Array }

function sampleProfile(seg: SegB, stepM: number, field: TerrainField): Prof {
  const L = polyLength(seg.pts);
  const n = Math.max(1, Math.ceil(L / stepM)) + 1;
  const step = L / (n - 1);
  const x = new Float64Array(n), z = new Float64Array(n), s = new Float64Array(n), y = new Float64Array(n), t = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const p = pointAt(seg.pts, k * step);
    x[k] = p.x; z[k] = p.z; s[k] = k * step;
    t[k] = field.heightAt(p.x, p.z) ?? 0;
  }
  return { n, step, x, z, s, y, t };
}

/** Limits the slope between neighbouring samples with a forward and a backward pass. */
export function clampSlope(y: Float64Array, step: number, maxSlope: number): void {
  const d = maxSlope * step;
  for (let k = 1; k < y.length; k++) y[k] = Math.min((y[k - 1] as number) + d, Math.max((y[k - 1] as number) - d, y[k] as number));
  for (let k = y.length - 2; k >= 0; k--) y[k] = Math.min((y[k + 1] as number) + d, Math.max((y[k + 1] as number) - d, y[k] as number));
}

/**
 * Slope limiting with both ends pinned: the profile is cut to the double cone of the two end heights first (feasible when the
 * ends differ by at most `maxSlope` times the length), then forward and backward passes are alternated with the ends re-pinned
 * until nothing moves, which is a projection onto the slope-limited functions with those boundary values.
 */
export function pinnedClamp(y: Float64Array, s: Float64Array, yA: number, yB: number, maxSlope: number): void {
  const n = y.length;
  const L = s[n - 1] as number;
  const d = maxSlope * (n > 1 ? L / (n - 1) : 0);
  y[0] = yA; y[n - 1] = yB;
  for (let k = 1; k < n - 1; k++) {
    const sk = s[k] as number;
    const lo = Math.max(yA - maxSlope * sk, yB - maxSlope * (L - sk)), hi = Math.min(yA + maxSlope * sk, yB + maxSlope * (L - sk));
    y[k] = lo <= hi ? Math.min(hi, Math.max(lo, y[k] as number)) : (lo + hi) / 2;
  }
  for (let it = 0; it < 30; it++) {
    let moved = 0;
    for (let k = 1; k < n; k++) { const v = Math.min((y[k - 1] as number) + d, Math.max((y[k - 1] as number) - d, y[k] as number)); moved = Math.max(moved, Math.abs(v - (y[k] as number))); y[k] = v; }
    y[n - 1] = yB;
    for (let k = n - 2; k >= 0; k--) { const v = Math.min((y[k + 1] as number) + d, Math.max((y[k + 1] as number) - d, y[k] as number)); moved = Math.max(moved, Math.abs(v - (y[k] as number))); y[k] = v; }
    y[0] = yA;
    if (moved < 1e-4) break;
  }
}

function movingAverage(t: Float64Array, half: number): Float64Array {
  const out = new Float64Array(t.length);
  for (let k = 0; k < t.length; k++) {
    let a = 0, c = 0;
    for (let q = Math.max(0, k - half); q <= Math.min(t.length - 1, k + half); q++) { a += t[q] as number; c++; }
    out[k] = a / c;
  }
  return out;
}

export function runGrading(inp: GradingInputs): GradingProduct {
  const cfg = inp.cfg;
  const field = new TerrainField(inp.grids);
  const maxSlope = Math.min(cfg.grade.maxPct, 39) / 100;
  const segs: SegB[] = inp.segs.map((s) => ({ ...s, pts: [...s.pts], ys: [...s.ys] }));
  const nodes: NodeB[] = inp.nodes.map((n) => ({ ...n, out: [...n.out], in: [...n.in] }));
  const edges: RoadEdge[] = inp.edges.map((e) => ({ ...e }));
  const stats: GradingStats = { maxGradePct: 0, slabs: 0, hoods: 0, tunnels: 0, openCuts: 0, overpasses: 0, namedSpans: 0, maxSlabStepM: 0, slabsDropped: 0, postsGraded: 0 };
  const named = cfg.named.map((b) => ({ ...b, ...enuFromLatLng(b.lat, b.lng) }));
  const half = Math.max(1, Math.round(cfg.grade.smoothingM / cfg.grade.sampleM / 2));
  const g = cfg.overpass.maxApproachGrade;

  // the pack stores 0.1 m positions: round node and segment coordinates first so every later length and grade is of the stored geometry
  for (const n of nodes) { n.x = q10(n.x); n.z = q10(n.z); }
  for (const s of segs) s.pts = s.pts.map(q10);

  // 1. base profiles
  const profs: Prof[] = segs.map((s) => sampleProfile(s, cfg.grade.sampleM, field));
  const kinds: ('surface' | 'overpass' | 'span' | 'tunnel')[] = segs.map(() => 'surface');
  segs.forEach((s, i) => {
    const p = profs[i] as Prof;
    const mid = pointAt(s.pts, polyLength(s.pts) / 2);
    if (s.tunnel) {
      kinds[i] = 'tunnel';
      for (let k = 0; k < p.n; k++) p.y[k] = (p.t[0] as number) + ((p.t[p.n - 1] as number) - (p.t[0] as number)) * (p.s[k] as number) / Math.max(1e-9, p.s[p.n - 1] as number);
      return;
    }
    if (s.bridge) {
      const nb = named.find((b) => Math.hypot(mid.x - b.x, mid.z - b.z) <= b.radiusM);
      if (nb) {
        kinds[i] = 'span';
        stats.namedSpans++;
        // distance along the segment to the nearest land sample (terrain at least 1 m); no land sample means full deck height
        for (let k = 0; k < p.n; k++) {
          let best = Infinity, ref = 0;
          for (let q = 0; q < p.n; q++) {
            if ((p.t[q] as number) < 1) continue;
            const d = Math.abs((p.s[q] as number) - (p.s[k] as number));
            if (d < best) { best = d; ref = p.t[q] as number; }
          }
          p.y[k] = Math.min(nb.deckM, best === Infinity ? nb.deckM : ref + g * best);
        }
        return;
      }
      kinds[i] = 'overpass';
      stats.overpasses++;
      const lift = cfg.overpass.clearancePerLayerM * Math.max(1, s.layer);
      const L = p.s[p.n - 1] as number;
      for (let k = 0; k < p.n; k++) {
        const base = (p.t[0] as number) + ((p.t[p.n - 1] as number) - (p.t[0] as number)) * (p.s[k] as number) / Math.max(1e-9, L);
        p.y[k] = base + Math.min(lift, g * Math.min(p.s[k] as number, L - (p.s[k] as number)));
      }
      return;
    }
    const sm = movingAverage(p.t, half);
    for (let k = 0; k < p.n; k++) p.y[k] = sm[k] as number;
  });
  segs.forEach((_s, i) => { const p = profs[i] as Prof; clampSlope(p.y, p.step, maxSlope); });

  // 2. node heights: mean of the incident segment ends
  const endSum = new Float64Array(nodes.length), endCnt = new Int32Array(nodes.length);
  segs.forEach((s, i) => {
    const p = profs[i] as Prof;
    endSum[s.a] = (endSum[s.a] as number) + (p.y[0] as number); endCnt[s.a] = (endCnt[s.a] as number) + 1;
    endSum[s.b] = (endSum[s.b] as number) + (p.y[p.n - 1] as number); endCnt[s.b] = (endCnt[s.b] as number) + 1;
  });
  for (const n of nodes) {
    const c = endCnt[n.id] as number;
    n.y = q10(c > 0 ? (endSum[n.id] as number) / c : (field.heightAt(n.x, n.z) ?? 0));
  }

  // node heights must be reachable along every segment at the slope limit: relax pairs that are too far apart
  for (let pass = 0; pass < 400; pass++) {
    let changed = false;
    for (const s of segs) {
      const a = nodes[s.a] as NodeB, b = nodes[s.b] as NodeB;
      let L = 0;
      for (let q = 2; q < s.pts.length; q += 2) L += Math.hypot((s.pts[q] as number) - (s.pts[q - 2] as number), (s.pts[q + 1] as number) - (s.pts[q - 1] as number));
      const lim = maxSlope * L * 0.98;
      const diff = b.y - a.y;
      if (Math.abs(diff) > lim) {
        const e = (Math.abs(diff) - lim) / 2 + 0.01;
        a.y += Math.sign(diff) * e;
        b.y -= Math.sign(diff) * e;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const n of nodes) n.y = q10(n.y);

  // 3. fade every segment to its node heights over the last 24 m, clamp again, quantise
  const fade = cfg.grade.smoothingM;
  segs.forEach((s, i) => {
    const p = profs[i] as Prof;
    const L = p.s[p.n - 1] as number;
    const dA = (nodes[s.a] as NodeB).y - (p.y[0] as number), dB = (nodes[s.b] as NodeB).y - (p.y[p.n - 1] as number);
    const f = Math.min(fade, L / 2);
    for (let k = 0; k < p.n; k++) {
      const sk = p.s[k] as number;
      p.y[k] = (p.y[k] as number) + dA * (1 - smooth(sk / Math.max(f, 1e-9))) + dB * (1 - smooth((L - sk) / Math.max(f, 1e-9)));
    }
    pinnedClamp(p.y, p.s, (nodes[s.a] as NodeB).y, (nodes[s.b] as NodeB).y, maxSlope);
    // the segment polyline (at most 20 m apart) takes the profile at its own arc lengths
    const ys: number[] = [];
    let acc = 0;
    for (let q = 0; q < s.pts.length / 2; q++) {
      if (q > 0) acc += Math.hypot((s.pts[q * 2] as number) - (s.pts[q * 2 - 2] as number), (s.pts[q * 2 + 1] as number) - (s.pts[q * 2 - 1] as number));
      const u = Math.min(L, acc) / p.step;
      const k0 = Math.min(p.n - 2, Math.max(0, Math.floor(u)));
      const tt = Math.min(1, Math.max(0, u - k0));
      ys.push(q10((p.y[k0] as number) * (1 - tt) + (p.y[k0 + 1] as number) * tt));
    }
    // pin the ends to the node heights exactly (rounded the same way)
    ys[0] = (nodes[s.a] as NodeB).y;
    ys[ys.length - 1] = (nodes[s.b] as NodeB).y;
    s.ys = ys;
    let len = 0, grade = 0;
    for (let q = 1; q < ys.length; q++) {
      const dx = (s.pts[q * 2] as number) - (s.pts[q * 2 - 2] as number), dz = (s.pts[q * 2 + 1] as number) - (s.pts[q * 2 - 1] as number);
      const dy = (ys[q] as number) - (ys[q - 1] as number);
      const h = Math.hypot(dx, dz);
      len += Math.hypot(h, dy);
      if (h > 0.5) grade = Math.max(grade, Math.abs(dy) / h);
    }
    s.lengthM = len;
    (s as SegB & { gradeFrac?: number }).gradeFrac = grade;
  });

  // 4. edges: max grade and the Hill flag
  for (const e of edges) {
    const gf = (segs[e.seg] as SegB & { gradeFrac?: number }).gradeFrac ?? 0;
    e.maxGradePct = Math.min(127, Math.round(gf * 100));
    if (e.maxGradePct >= inp.hillGradePct) e.flags |= EdgeFlag.Hill;
    stats.maxGradePct = Math.max(stats.maxGradePct, e.maxGradePct);
  }

  // 5. slabs and hoods
  const slabs = new Map<ChunkKey, number[]>();
  const hoods = new Map<ChunkKey, number[]>();
  const grids = new Map<ChunkKey, Int16Array>();
  for (const [k, v] of inp.grids) grids.set(k, Int16Array.from(v));
  const push = (m: Map<ChunkKey, number[]>, x: number, z: number, rec: number[]): void => {
    const key = chunkKeyAt(9, x, z);
    if (!grids.has(key)) { stats.slabsDropped++; return; }
    let l = m.get(key);
    if (!l) m.set(key, (l = []));
    l.push(...rec);
  };
  const rect = (cx: number, cz: number, tx: number, tz: number, len: number, wid: number): number[] => {
    // CCW on a north-up map (z south): corners front-left, back-left, back-right, front-right of the travel direction
    const nx = -tz, nz = tx;   // right-hand normal
    const hl = len / 2, hw = wid / 2;
    const c: [number, number][] = [
      [cx + tx * hl - nx * hw, cz + tz * hl - nz * hw], [cx - tx * hl - nx * hw, cz - tz * hl - nz * hw],
      [cx - tx * hl + nx * hw, cz - tz * hl + nz * hw], [cx + tx * hl + nx * hw, cz + tz * hl + nz * hw],
    ];
    return c.flatMap(([x, z]) => [q10(x), q10(z)]);
  };
  let lastTop: number | null = null;
  segs.forEach((s, i) => {
    const k = kinds[i];
    const L = polyLength(s.pts);
    if (s.bridge) {
      lastTop = null;
      const gradeFrac = (s as SegB & { gradeFrac?: number }).gradeFrac ?? 0;
      const slabLen = Math.max(0.5, Math.min(cfg.slab.lengthM, gradeFrac > 1e-6 ? 0.1 / gradeFrac : cfg.slab.lengthM));
      const n = Math.max(1, Math.ceil(L / slabLen));
      const step = L / n;
      for (let q = 0; q < n; q++) {
        const sm = (q + 0.5) * step;
        const p = pointAt(s.pts, sm);
        // top height from the segment polyline heights at arc length sm
        let acc = 0, y = s.ys[0] as number;
        for (let r = 1; r < s.pts.length / 2; r++) {
          const d = Math.hypot((s.pts[r * 2] as number) - (s.pts[r * 2 - 2] as number), (s.pts[r * 2 + 1] as number) - (s.pts[r * 2 - 1] as number));
          if (acc + d >= sm || r === s.pts.length / 2 - 1) { const tt = d === 0 ? 0 : Math.min(1, Math.max(0, (sm - acc) / d)); y = (s.ys[r - 1] as number) * (1 - tt) + (s.ys[r] as number) * tt; break; }
          acc += d;
        }
        const top = q10(y);
        if (lastTop !== null) stats.maxSlabStepM = Math.max(stats.maxSlabStepM, Math.abs(q10(top - lastTop)));
        lastTop = top;
        push(slabs, p.x, p.z, [4, q10(top - cfg.slab.thicknessM), cfg.slab.thicknessM, ...rect(p.x, p.z, p.tx, p.tz, step, s.widthM)]);
        stats.slabs++;
      }
    }
    if (k === 'tunnel') {
      stats.tunnels++;
      lastTop = null;
      const n = Math.max(1, Math.ceil(L / cfg.tunnel.hoodStepM));
      const step = L / n;
      let any = 0;
      for (let q = 0; q < n; q++) {
        const sm = (q + 0.5) * step;
        const p = pointAt(s.pts, sm);
        let acc = 0, y = s.ys[0] as number;
        for (let r = 1; r < s.pts.length / 2; r++) {
          const d = Math.hypot((s.pts[r * 2] as number) - (s.pts[r * 2 - 2] as number), (s.pts[r * 2 + 1] as number) - (s.pts[r * 2 - 1] as number));
          if (acc + d >= sm || r === s.pts.length / 2 - 1) { const tt = d === 0 ? 0 : Math.min(1, Math.max(0, (sm - acc) / d)); y = (s.ys[r - 1] as number) * (1 - tt) + (s.ys[r] as number) * tt; break; }
          acc += d;
        }
        const wid = s.widthM + cfg.tunnel.corridorExtraM;
        // original terrain top over the hood footprint
        let top = -Infinity;
        for (let a = -1; a <= 1; a++) for (let b = -2; b <= 2; b++) {
          const px = p.x + p.tx * (b * step) / 2 + -p.tz * (a * wid) / 2, pz = p.z + p.tz * (b * step) / 2 + p.tx * (a * wid) / 2;
          top = Math.max(top, field.heightAt(px, pz) ?? -Infinity);
        }
        const base = q10(y + cfg.tunnel.hoodClearanceM);
        const height = q10(top - base);
        if (height < cfg.tunnel.minHoodM) continue;
        any++;
        push(hoods, p.x, p.z, [4, base, height, ...rect(p.x, p.z, p.tx, p.tz, step, wid)]);
        stats.hoods++;
      }
      if (any === 0) stats.openCuts++;
    }
  });

  // 6. grade the posts chunk by chunk (identical shared posts by construction: a post value depends on its position only)
  interface Samp { x: number; z: number; y: number; halfW: number; rank: number; seg: number; tunnel: boolean }
  const R = 30;
  const buckets = new Map<ChunkKey, Samp[]>();
  segs.forEach((s, i) => {
    if (kinds[i] === 'overpass' || kinds[i] === 'span') return;
    const p = profs[i] as Prof;
    const half = s.widthM / 2 + (kinds[i] === 'tunnel' ? cfg.tunnel.corridorExtraM / 2 : 0);
    for (let k = 0; k < p.n; k++) {
      // the profile height at the sample, from the quantised polyline heights
      const sm = p.s[k] as number;
      let acc = 0, y = s.ys[0] as number;
      for (let r = 1; r < s.pts.length / 2; r++) {
        const d = Math.hypot((s.pts[r * 2] as number) - (s.pts[r * 2 - 2] as number), (s.pts[r * 2 + 1] as number) - (s.pts[r * 2 - 1] as number));
        if (acc + d >= sm || r === s.pts.length / 2 - 1) { const tt = d === 0 ? 0 : Math.min(1, Math.max(0, (sm - acc) / d)); y = (s.ys[r - 1] as number) * (1 - tt) + (s.ys[r] as number) * tt; break; }
        acc += d;
      }
      const smp: Samp = { x: p.x[k] as number, z: p.z[k] as number, y, halfW: half, rank: s.cls, seg: s.id, tunnel: kinds[i] === 'tunnel' };
      const c0x = Math.floor((smp.x - R - GRID_MIN_M) / 256), c1x = Math.floor((smp.x + R - GRID_MIN_M) / 256);
      const c0z = Math.floor((smp.z - R - GRID_MIN_M) / 256), c1z = Math.floor((smp.z + R - GRID_MIN_M) / 256);
      for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
        const key = `9/${cx}/${cz}` as ChunkKey;
        if (!grids.has(key)) continue;
        let l = buckets.get(key);
        if (!l) buckets.set(key, (l = []));
        l.push(smp);
      }
    }
  });
  const n = TERRAIN_POSTS;
  const cellM = CHUNK_EDGE_M[9] / (n - 1);
  const blend = cfg.grade.blendM;
  for (const [key, list] of [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const dm = grids.get(key) as Int16Array;
    const orig = inp.grids.get(key) as Int16Array;
    const [, sx, sz] = key.split('/').map(Number) as [number, number, number];
    const ox = GRID_MIN_M + sx * 256, oz = GRID_MIN_M + sz * 256;
    const bestW = new Float32Array(n * n), bestY = new Float32Array(n * n), bestR = new Int16Array(n * n).fill(99), bestS = new Int32Array(n * n).fill(2147483647);
    const tunW = new Float32Array(n * n), tunY = new Float32Array(n * n);
    for (const sm of list) {
      const reach = sm.halfW + blend;
      const i0 = Math.max(0, Math.ceil((sm.x - reach - ox) / cellM)), i1 = Math.min(n - 1, Math.floor((sm.x + reach - ox) / cellM));
      const j0 = Math.max(0, Math.ceil((sm.z - reach - oz) / cellM)), j1 = Math.min(n - 1, Math.floor((sm.z + reach - oz) / cellM));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(ox + i * cellM - sm.x, oz + j * cellM - sm.z);
          if (d > reach) continue;
          const w = d <= sm.halfW ? 1 : smooth(1 - (d - sm.halfW) / blend);
          if (w <= 0) continue;
          const idx = j * n + i;
          if (sm.tunnel) {
            if (w > (tunW[idx] as number) + 1e-6 || (Math.abs(w - (tunW[idx] as number)) <= 1e-6 && sm.y < (tunY[idx] as number))) { tunW[idx] = w; tunY[idx] = sm.y; }
            continue;
          }
          const better = w > (bestW[idx] as number) + 1e-6
            || (Math.abs(w - (bestW[idx] as number)) <= 1e-6 && (sm.rank < (bestR[idx] as number) || (sm.rank === (bestR[idx] as number) && sm.seg < (bestS[idx] as number))));
          if (better) { bestW[idx] = w; bestY[idx] = sm.y; bestR[idx] = sm.rank; bestS[idx] = sm.seg; }
        }
      }
    }
    for (let idx = 0; idx < n * n; idx++) {
      let h = (orig[idx] as number) / 10;
      const w = bestW[idx] as number;
      if (w > 0) h = h * (1 - w) + (bestY[idx] as number) * w;
      const tw = tunW[idx] as number;
      if (tw > 0) {
        const target = (tunY[idx] as number) - cfg.tunnel.dropM;
        const v = h * (1 - tw) + target * tw;
        h = Math.min(h, v);
      }
      const v = Math.max(-32767, Math.min(32767, Math.round(h * 10)));
      if (v !== dm[idx]) stats.postsGraded++;
      dm[idx] = v;
    }
  }

  return { segs, nodes, edges, grids, slabs, hoods, stats };
}

/**
 * The facade kit (M02h7, DL-OWN-07 Phase 1): which walls of a building face the street, which of them are shop fronts, where the bay
 * windows go, the cornice ring, and what fits in the building's kit allowance. Pure and deterministic, no `three` import: the mesher runs
 * it in asset.worker, and the unit tests in Node. The geometry itself is emitted by `addBuilding` (mesher.ts); the shading by
 * `look/facade.ts`.
 *
 *  - **Street test:** a wall of at least `street.minWallM` faces the street when the ray along its outward normal from the wall's midpoint
 *    meets a centreline piece of a same-chunk `SimChunk.segments` entry within `street.reachM`, and that piece runs within
 *    `street.parallelDeg` of the wall.
 *  - **Shop walls:** street walls of Commercial and Civic, and of ResMid where `kitHash(seed) < shopResMid`; Tower keeps M02e's class rule.
 *  - **Budget:** parts are dropped whole, the cornice first, then the bays (last first), then the awnings (last first), until the kit fits.
 */
import mesherJson from '../../../../../config/world/mesher.json';

export type KitProfileId = 'desktop' | 'visionpro' | 'mobile' | 'low';

export interface KitConfig {
  /** Kit triangles a building may add, per mesher profile (0: the kit is off on that profile). */
  trisPerBuilding: Record<KitProfileId, number>;
  street: { minWallM: number; reachM: number; parallelDeg: number };
  /** The share of ResMid street walls that are shop fronts. */
  shopResMid: number;
  /** The canopy along a shop wall: `insetM` off each end, its top `topBelowGfM` under the ground-floor line, `depthM` out and `dropM` down. */
  awning: { insetM: number; topBelowGfM: number; depthM: number; dropM: number };
  /** Bay windows: width and depth ranges by seed, the gap under the eave, bays per street wall and profile, the least height. */
  bay: { widthM: [number, number]; depthM: [number, number]; eaveGapM: number; perWall: Record<KitProfileId, number>; minHeightM: number; marginM: number };
  /** The cornice ring: offset outward, height, the shortest edge it allows, the profiles that mesh it. */
  cornice: { offsetM: number; heightM: number; minEdgeM: number; profiles: KitProfileId[] };
}

export const KIT: KitConfig = (mesherJson as unknown as { kit: KitConfig }).kit;

/** Triangles of one part (awning: top, underside, two cheeks; bay: three faces, cap and underside; cornice: front and underside per edge). */
export const AWNING_TRIS = 6;
export const BAY_TRIS = 10;
export const CORNICE_TRIS_PER_EDGE = 4;

/** `BuildingKind` codes. */
const RES_LOW = 0, RES_MID = 1, COMMERCIAL = 2, CIVIC = 5;

/** A per-building hash in [0, 1) from the record seed and a salt (integer maths only, so the worker and Node agree). */
export function kitHash(seed: number, salt: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The centreline points of the segments as local (x, z) pairs, relative to the unit corner (ox, oz). */
export function localSegments(segments: readonly { pts: Float32Array }[], ox: number, oz: number): Float32Array[] {
  return segments.map((s) => {
    const n = Math.floor(s.pts.length / 3);
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      out[i * 2] = (s.pts[i * 3] as number) - ox;
      out[i * 2 + 1] = (s.pts[i * 3 + 2] as number) - oz;
    }
    return out;
  });
}

/**
 * Whether the wall from (x0, z0) to (x1, z1) faces the street. The outward normal of a counter-clockwise ring in (x, z) is (dz, -dx)
 * over the length (the mesher's convention); `segs` are local centrelines (`localSegments`).
 */
export function isStreetWall(x0: number, z0: number, x1: number, z1: number, segs: readonly Float32Array[], cfg: KitConfig = KIT): boolean {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < cfg.street.minWallM) return false;
  const tx = dx / len, tz = dz / len;
  const nx = tz, nz = -tx;
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  const cosMax = Math.cos((cfg.street.parallelDeg * Math.PI) / 180);
  for (const s of segs) {
    for (let i = 0; i + 3 < s.length; i += 2) {
      const ax = s[i] as number, az = s[i + 1] as number, bx = s[i + 2] as number, bz = s[i + 3] as number;
      const ex = bx - ax, ez = bz - az;
      const el = Math.hypot(ex, ez);
      if (el < 1e-6) continue;
      // within 30 degrees of parallel (either direction)
      if (Math.abs((ex * tx + ez * tz) / el) < cosMax) continue;
      // ray m + t n against the piece a + u e: solve t n - u e = a - m
      const det = -nx * ez + nz * ex;
      if (Math.abs(det) < 1e-9) continue;
      const rx = ax - mx, rz = az - mz;
      const t = (-rx * ez + rz * ex) / det;
      const u = (nx * rz - nz * rx) / det;
      if (t > 0 && t <= cfg.street.reachM && u >= 0 && u <= 1) return true;
    }
  }
  return false;
}

/** A street wall of this building is a shop front (Commercial, Civic, and some ResMid by seed). */
export function isShopKind(kind: number, seed: number, cfg: KitConfig = KIT): boolean {
  if (kind === COMMERCIAL || kind === CIVIC) return true;
  return kind === RES_MID && kitHash(seed, 7) < cfg.shopResMid;
}

/** Street walls of ResLow and ResMid carry bay windows. */
export const isBayKind = (kind: number): boolean => kind === RES_LOW || kind === RES_MID;

/** Flat-roof ResMid, Commercial and Civic get a cornice ring (on the profiles that mesh one). */
export const isCorniceKind = (kind: number): boolean => kind === RES_MID || kind === COMMERCIAL || kind === CIVIC;

export interface BaySpot {
  /** Distance of the bay's centre from the wall start, metres. */
  c: number;
  /** Width along the wall and depth out of it, metres (45 degree sides, so the front is `w - 2 d` wide). */
  w: number;
  d: number;
}

/** The bays of a street wall of length `len`: up to `max`, evenly spaced, each with its seed's width and depth; none when they do not fit. */
export function bayLayout(len: number, seed: number, wall: number, max: number, cfg: KitConfig = KIT): BaySpot[] {
  const [w0, w1] = cfg.bay.widthM;
  const [d0, d1] = cfg.bay.depthM;
  const w = w0 + (w1 - w0) * kitHash(seed, 11 + wall * 3);
  const d = d0 + (d1 - d0) * kitHash(seed, 12 + wall * 3);
  let k = Math.max(0, Math.floor(max));
  while (k > 0 && k * w + (k + 1) * cfg.bay.marginM > len) k--;
  const out: BaySpot[] = [];
  for (let i = 0; i < k; i++) out.push({ c: (len * (i + 1)) / (k + 1), w, d });
  return out;
}

/**
 * The cornice ring: each corner moved `offsetM` outward along the mitre of its two edges (the mitre is clamped to the offset at a
 * concave corner, so the ring never folds into the wall), or null when an edge is shorter than `minEdgeM`. `ring` is counter-clockwise.
 */
export function corniceRing(ring: readonly number[], cfg: KitConfig = KIT): number[] | null {
  const n = ring.length / 2;
  if (n < 3) return null;
  const off = cfg.cornice.offsetM;
  const nrm: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = (ring[j * 2] as number) - (ring[i * 2] as number), dz = (ring[j * 2 + 1] as number) - (ring[i * 2 + 1] as number);
    const len = Math.hypot(dx, dz);
    if (len < cfg.cornice.minEdgeM) return null;
    nrm.push([dz / len, -dx / len]);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = nrm[(i + n - 1) % n] as [number, number], b = nrm[i] as [number, number];
    const cross = a[0] * b[1] - a[1] * b[0];
    let mx = a[0] + b[0], mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    // the mitre length for an offset of 1: 1 / cos(half the turn), limited to 2 (a sharp convex corner) and to 1 at a concave corner
    const cosHalf = Math.max(1e-3, mx * b[0] + mz * b[1]);
    // the ring is counter-clockwise in (x, z) with outward normals (dz, -dx): a convex corner turns the normal with a positive cross
    const concave = cross < -1e-9;
    const k = concave ? 1 : Math.min(2, 1 / cosHalf);
    out.push((ring[i * 2] as number) + mx * off * k, (ring[i * 2 + 1] as number) + mz * off * k);
  }
  return out;
}

export type KitPartKind = 'cornice' | 'bay' | 'awning';
export interface KitPart {
  kind: KitPartKind;
  tris: number;
}

/**
 * Which parts fit in `allowance` triangles: all of them when they do; else they drop whole, the cornice first, then the bays from the
 * last, then the awnings from the last. Returns one flag per part, in the input order.
 */
export function planKit(parts: readonly KitPart[], allowance: number): boolean[] {
  const keep = parts.map(() => true);
  let total = parts.reduce((n, p) => n + p.tris, 0);
  for (const kind of ['cornice', 'bay', 'awning'] as const) {
    for (let i = parts.length - 1; i >= 0 && total > allowance; i--) {
      const p = parts[i] as KitPart;
      if (p.kind !== kind || !keep[i]) continue;
      keep[i] = false;
      total -= p.tris;
    }
  }
  return keep;
}

/** The kit's counts for one unit (`MeshStats.kit`). */
export interface KitStats {
  shopWalls: number;
  awnings: number;
  bays: number;
  /** Buildings with a cornice ring. */
  cornices: number;
  /** Triangles the kit added (`MeshStats.kitTriangles`). */
  triangles: number;
  /** Bays left out because a corner or an edge midpoint fell inside a footprint. */
  baysBlocked: number;
}

export const emptyKitStats = (): KitStats => ({ shopWalls: 0, awnings: 0, bays: 0, cornices: 0, triangles: 0, baysBlocked: 0 });

/** Point in a ring of (x, z) pairs (even-odd). */
export function inRing(pts: readonly number[], x: number, z: number): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2] as number, zi = pts[i * 2 + 1] as number, xj = pts[j * 2] as number, zj = pts[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** What `addBuilding` (mesher.ts) takes to mesh a building's kit. */
export interface BuildingKit {
  /** The chunk's road centrelines, local to the unit corner (`localSegments`). */
  segs: readonly Float32Array[];
  /** The footprints of the chunk (local rings): a bay with a corner or an edge midpoint inside one is left out. */
  others: readonly (readonly number[])[];
  /** The index of this building's own footprint in `others`, which the bay test skips. */
  self?: number;
  /** Kit triangles this building may add (`trisPerBuilding` of the profile). */
  allowance: number;
  /** Bays per street wall on the profile. */
  bays: number;
  /** The profile meshes cornice rings. */
  cornice: boolean;
  /** Counts, added to as buildings are meshed. */
  stats: KitStats;
}

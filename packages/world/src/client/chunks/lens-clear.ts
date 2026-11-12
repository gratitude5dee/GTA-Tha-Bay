/**
 * The lens-clear rule (BD-FIX-LENS-CLEAR-01): while the camera rig obeys a director-placed cinematic shot, a tree that crowds the frame or
 * stands between the lens and the subject is not drawn. Render only: the director (sim) casts one physics ray from the camera to the
 * subject's head, tree crowns have no collider and the sim holds no tree data, so a shot from a mark at the kerb can stand between two
 * crowns. The pools (`vegetation-pool.ts`) write the hidden instances with zero scale; this file is the rule alone, pure and without
 * `three`, so the tests drive it on their own.
 *
 *  - A crown is the ellipsoid inscribed in the bounding box of the geometry's crown vertices (`leaf` 1, the vertices the material tints,
 *    `tree-forms.ts`), placed by the instance's position, yaw and scale (`instanceScaleOf`).
 *  - (a) Frame share: a fixed grid of `LENS_GRID` directions through the frame; the share is the fraction whose ray meets the ellipsoid in
 *    front of the lens. A crown behind the lens covers nothing; a lens inside a crown sees nothing else (share 1). Hidden above
 *    `maxFrameShare`.
 *  - (b) Corridor: the crown comes within `corridorM` of the straight segment from the lens to the look-at point (the ellipsoid grown by
 *    `corridorM` on each axis meets the segment). `corridorM: 0` turns (b) off, so `maxFrameShare: 1` with `corridorM: 0` hides nothing.
 *  - `LensDecider`: the set is decided when a shot starts and held until it ends. The director re-places `pos` every tick (a push-in, a
 *    `single` that follows a walking subject), so a new decision is: the shot changed (kind, subject, seed, durationTicks, fovDeg), or the
 *    lens has moved more than `redecideM` from every pose the set was decided for (for a `spline`: from the segment between its ends).
 */

export type LensVec3 = readonly [number, number, number];

/** One frame of a lens: where it stands, what it looks at, the vertical field of view in degrees and the aspect ratio (width / height). */
export interface Lens {
  pos: LensVec3;
  lookAt: LensVec3;
  fovDeg: number;
  aspect: number;
}

/** `look.json` `vegetation.lens`. */
export interface LensRule {
  /** A crown that covers more than this share of the frame is hidden (1: never). */
  maxFrameShare: number;
  /** A crown within this many metres of the lens-to-subject segment is hidden (0: never). */
  corridorM: number;
  /** Lens travel (metres) from the poses a set was decided for that makes a new decision. */
  redecideM: number;
}

/** The director-placed shot the rig obeys now (rule 1), as the renderer's `CullCamera.lens` carries it. */
export interface LensShot extends Lens {
  /** What identifies the shot: `kind|subject|seed|durationTicks|fovDeg`. */
  key: string;
  /** A `spline` shot: the two ends of its path (the set is decided for both). */
  ends?: readonly [LensVec3, LensVec3] | null;
}

/** The crown box of a geometry in its own units (one unit tall): the centre and the half extents of its leaf vertices. */
export interface CrownBox {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}

/** A crown in the world: the ellipsoid's centre, its semi-axes along the tree's own axes, and the tree's yaw (cos, sin). */
export interface Crown {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  cos: number;
  sin: number;
}

/** The grid of directions the frame share is counted on (a constant, not config). */
export const LENS_GRID = { cols: 24, rows: 14 } as const;

/** The bounding box of the crown vertices (`leaf` above 0.5) of a geometry; null when it has none. */
export function crownBoxOf(positions: ArrayLike<number>, leaf: ArrayLike<number>): CrownBox | null {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const n = Math.min(leaf.length, Math.floor(positions.length / 3));
  for (let i = 0; i < n; i++) {
    if (!((leaf[i] as number) > 0.5)) continue;
    const x = positions[i * 3] as number, y = positions[i * 3 + 1] as number, z = positions[i * 3 + 2] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (!(x1 >= x0)) return null;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2 };
}

/**
 * The crown of an instance: the pools' instance matrix is the translation `(x, y, z)`, the rotation by `yaw` about +y and the scale
 * `(sx, sy, sx)` (`vegetation-pool.ts` `fillPool`), so a local point `(lx, ly, lz)` stands at
 * `(x + cos sx lx + sin sx lz, y + sy ly, z - sin sx lx + cos sx lz)`.
 */
export function crownOf(box: CrownBox, x: number, y: number, z: number, yaw: number, sx: number, sy: number): Crown {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const lx = box.cx * sx, lz = box.cz * sx;
  return { x: x + c * lx + s * lz, y: y + box.cy * sy, z: z - s * lx + c * lz, rx: box.hx * sx, ry: box.hy * sy, rz: box.hz * sx, cos: c, sin: s };
}

/** A world offset from the crown's centre in the unit-sphere space of the ellipsoid grown by `grow` metres on each axis. */
function toUnit(c: Crown, wx: number, wy: number, wz: number, grow: number, out: [number, number, number]): void {
  out[0] = (c.cos * wx - c.sin * wz) / (c.rx + grow);
  out[1] = wy / (c.ry + grow);
  out[2] = (c.sin * wx + c.cos * wz) / (c.rz + grow);
}

const P: [number, number, number] = [0, 0, 0];
const D: [number, number, number] = [0, 0, 0];

/** The lens's basis: forward, right and up (unit vectors), and the half extents of the frame at unit distance. */
function basisOf(l: Lens): { f: LensVec3; r: LensVec3; u: LensVec3; tanH: number; tanV: number } | null {
  let fx = l.lookAt[0] - l.pos[0], fy = l.lookAt[1] - l.pos[1], fz = l.lookAt[2] - l.pos[2];
  const fl = Math.hypot(fx, fy, fz);
  if (!(fl > 1e-9)) return null;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward x up(0, 1, 0); a lens that looks straight up or down takes +x
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz);
  if (rl > 1e-9) {
    rx /= rl;
    rz /= rl;
  } else {
    rx = 1;
    rz = 0;
  }
  // up = right x forward
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const tanV = Math.tan((Math.min(179, Math.max(1, l.fovDeg)) * Math.PI) / 360);
  return { f: [fx, fy, fz], r: [rx, 0, rz], u: [ux, uy, uz], tanH: tanV * Math.max(1e-6, l.aspect), tanV };
}

/** The share of the frame (0..1) a crown covers: the fraction of the `LENS_GRID` rays that meet the ellipsoid in front of the lens. */
export function frameShare(lens: Lens, crown: Crown): number {
  const b = basisOf(lens);
  if (!b || !(crown.rx > 0 && crown.ry > 0 && crown.rz > 0)) return 0;
  toUnit(crown, lens.pos[0] - crown.x, lens.pos[1] - crown.y, lens.pos[2] - crown.z, 0, P);
  const pp = P[0] * P[0] + P[1] * P[1] + P[2] * P[2] - 1;
  let hits = 0;
  for (let j = 0; j < LENS_GRID.rows; j++) {
    const v = (((j + 0.5) / LENS_GRID.rows) * 2 - 1) * b.tanV;
    for (let i = 0; i < LENS_GRID.cols; i++) {
      const u = (((i + 0.5) / LENS_GRID.cols) * 2 - 1) * b.tanH;
      toUnit(crown, b.f[0] + b.r[0] * u + b.u[0] * v, b.f[1] + b.r[1] * u + b.u[1] * v, b.f[2] + b.r[2] * u + b.u[2] * v, 0, D);
      // |P + t D| = 1: the ray meets the ellipsoid when the discriminant is not negative, in front of the lens when the far root is positive
      const a = D[0] * D[0] + D[1] * D[1] + D[2] * D[2];
      const h = P[0] * D[0] + P[1] * D[1] + P[2] * D[2];
      const disc = h * h - a * pp;
      if (disc >= 0 && -h + Math.sqrt(disc) > 0) hits++;
    }
  }
  return hits / (LENS_GRID.cols * LENS_GRID.rows);
}

/** Whether the crown comes within `corridorM` of the segment from the lens to its look-at point (`corridorM` 0 or less: never). */
export function inCorridor(lens: Lens, crown: Crown, corridorM: number): boolean {
  if (!(corridorM > 0) || !(crown.rx > 0 && crown.ry > 0 && crown.rz > 0)) return false;
  toUnit(crown, lens.pos[0] - crown.x, lens.pos[1] - crown.y, lens.pos[2] - crown.z, corridorM, P);
  toUnit(crown, lens.lookAt[0] - lens.pos[0], lens.lookAt[1] - lens.pos[1], lens.lookAt[2] - lens.pos[2], corridorM, D);
  // the point of the segment P + t D (t in 0..1) nearest the origin of the unit sphere
  const a = D[0] * D[0] + D[1] * D[1] + D[2] * D[2];
  const t = a > 1e-12 ? Math.min(1, Math.max(0, -(P[0] * D[0] + P[1] * D[1] + P[2] * D[2]) / a)) : 0;
  const x = P[0] + D[0] * t, y = P[1] + D[1] * t, z = P[2] + D[2] * t;
  return x * x + y * y + z * z <= 1;
}

/** `maxFrameShare: 1` together with `corridorM: 0` turns the feature off. */
export function lensRuleOff(rule: LensRule): boolean {
  return !(rule.maxFrameShare < 1) && !(rule.corridorM > 0);
}

/**
 * Whether a crown is hidden for one lens: (a) or (b). The grid is cast only for a crown that could reach the share at all: the image of
 * its bounding sphere (radius R at d metres) on the frame plane is at most `pi (R / (d - R))^2` times the stretch of the frame's corner,
 * `(1 + tanH^2 + tanV^2)^(3/2)`; below `maxFrameShare` of the frame's area `4 tanH tanV` the crown cannot be hidden by (a).
 */
export function lensHides(lens: Lens, crown: Crown, rule: LensRule): boolean {
  if (inCorridor(lens, crown, rule.corridorM)) return true;
  if (!(rule.maxFrameShare < 1)) return false;
  const R = Math.max(crown.rx, crown.ry, crown.rz);
  const d = Math.hypot(crown.x - lens.pos[0], crown.y - lens.pos[1], crown.z - lens.pos[2]);
  if (d > R) {
    const b = basisOf(lens);
    if (!b) return false;
    const k = R / (d - R);
    const bound = (Math.PI * k * k * (1 + b.tanH * b.tanH + b.tanV * b.tanV) ** 1.5) / (4 * b.tanH * b.tanV);
    if (bound <= rule.maxFrameShare) return false;
  }
  return frameShare(lens, crown) > rule.maxFrameShare;
}

/** Hidden when any of the lenses of the decision (both ends of a spline) breaks the rule. */
export function lensHidesAny(lenses: readonly Lens[], crown: Crown, rule: LensRule): boolean {
  for (const l of lenses) if (lensHides(l, crown, rule)) return true;
  return false;
}

/** The lenses a shot's set is decided for: where it stands now and, for a spline, both ends of its path (each looking at the subject). */
export function lensesOf(shot: LensShot): Lens[] {
  const out: Lens[] = [{ pos: shot.pos, lookAt: shot.lookAt, fovDeg: shot.fovDeg, aspect: shot.aspect }];
  for (const e of shot.ends ?? []) {
    if (out.some((l) => Math.hypot(l.pos[0] - e[0], l.pos[1] - e[1], l.pos[2] - e[2]) < 1e-3)) continue;
    out.push({ pos: e, lookAt: shot.lookAt, fovDeg: shot.fovDeg, aspect: shot.aspect });
  }
  return out;
}

/** Metres from `p` to the segment `a`-`b`. */
function distToSegment(p: LensVec3, a: LensVec3, b: LensVec3): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l2 = dx * dx + dy * dy + dz * dz;
  const t = l2 > 1e-12 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t), p[2] - (a[2] + dz * t));
}

export type LensStep = 'idle' | 'hold' | 'decide' | 'clear';

/**
 * When a set is decided (the hold of rule 3). `step` takes the shot of the frame (null: no director-placed shot) and answers:
 * `decide` (a cut, or the lens left the poses the set was decided for: decide for `lenses`), `hold` (keep the set), `clear` (the shot
 * ended: every hidden tree comes back) or `idle`.
 */
export class LensDecider {
  private key: string | null = null;
  /** The poses the current set was decided for: points, and the path of a spline. */
  private at: [LensVec3, LensVec3][] = [];
  /** The lenses of the decision in force (empty while idle). */
  lenses: Lens[] = [];
  decisions = 0;

  step(shot: LensShot | null, redecideM: number): LensStep {
    if (!shot) {
      if (this.key === null) return 'idle';
      this.reset();
      return 'clear';
    }
    if (this.key === shot.key) {
      let far = true;
      for (const [a, b] of this.at) if (distToSegment(shot.pos, a, b) <= redecideM) far = false;
      if (!far) return 'hold';
    }
    this.key = shot.key;
    this.at = [[shot.pos, shot.pos]];
    if (shot.ends) this.at.push([shot.ends[0], shot.ends[1]]);
    this.lenses = lensesOf(shot);
    this.decisions++;
    return 'decide';
  }

  /** Forgets the decision in force (the layer went off): the next shot frame decides again. */
  reset(): void {
    this.key = null;
    this.at = [];
    this.lenses = [];
  }

  get holding(): boolean {
    return this.key !== null;
  }
}

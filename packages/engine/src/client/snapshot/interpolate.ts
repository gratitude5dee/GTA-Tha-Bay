import type { SnapshotFrame } from '../../sim/transport/snapshot-buffer.ts';
import { REC_BYTES } from '../../sim/transport/snapshot-buffer.ts';

/** C02 InterpRules: skip interpolation when the tick gap exceeds 3 or the entity moved more than 2 m. */
export const INTERP_SKIP_TICK_GAP = 3;
export const INTERP_TELEPORT_M = 2;

/** One entity ready to draw. The objects are reused between frames. */
export interface Pose {
  handle: number;
  renderKey: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  animState: number;
  flags: number;
  /** True when the entity was placed at the newest snapshot without blending (new, teleported or a large tick gap). */
  snapped: boolean;
}

function newPose(): Pose {
  return { handle: 0, renderKey: 0, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, animState: 0, flags: 0, snapped: true };
}

const viewCache = new WeakMap<Uint8Array, DataView>();
function viewOf(bytes: Uint8Array): DataView {
  let v = viewCache.get(bytes);
  if (!v || v.buffer !== bytes.buffer || v.byteOffset !== bytes.byteOffset || v.byteLength !== bytes.byteLength) {
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    viewCache.set(bytes, v);
  }
  return v;
}

/** Spherical interpolation along the shortest arc between unit quaternions a and b. Writes into `out`. */
export function slerpShortest(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  t: number, out: { qx: number; qy: number; qz: number; qw: number },
): void {
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  // q and -q are the same rotation: take the sign that makes the angle at most 180 degrees.
  let sx = bx, sy = by, sz = bz, sw = bw;
  if (dot < 0) {
    dot = -dot;
    sx = -sx; sy = -sy; sz = -sz; sw = -sw;
  }
  let ka: number;
  let kb: number;
  if (dot > 0.9995) {
    ka = 1 - t;
    kb = t;
  } else {
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    ka = Math.sin((1 - t) * theta) / sin;
    kb = Math.sin(t * theta) / sin;
  }
  const x = ka * ax + kb * sx;
  const y = ka * ay + kb * sy;
  const z = ka * az + kb * sz;
  const w = ka * aw + kb * sw;
  const n = Math.hypot(x, y, z, w) || 1;
  out.qx = x / n;
  out.qy = y / n;
  out.qz = z / n;
  out.qw = w / n;
}

const scratchQ = { qx: 0, qy: 0, qz: 0, qw: 1 };
const prevIndex = new Map<number, number>();

/**
 * Blend two snapshots (C02 rule 2). Entities are matched by handle. `alpha` is the fraction between `prev` and `cur`.
 * An entity snaps to `cur` when it has no entry in `prev`, when the snapshots are more than 3 ticks apart, or when it
 * moved more than 2 m. Poses are written to `out` (grown as needed); returns how many.
 */
export function interpolateSnapshots(prev: SnapshotFrame | null, cur: SnapshotFrame, alpha: number, out: Pose[]): number {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const cv = viewOf(cur.records);
  const gap = prev ? cur.tick - prev.tick : Infinity;
  const blend = prev !== null && gap >= 1 && gap <= INTERP_SKIP_TICK_GAP;
  prevIndex.clear();
  let pv: DataView | null = null;
  if (blend && prev) {
    pv = viewOf(prev.records);
    for (let i = 0; i < prev.count; i++) prevIndex.set(pv.getUint32(i * REC_BYTES, true), i);
  }
  const limit2 = INTERP_TELEPORT_M * INTERP_TELEPORT_M;
  for (let i = 0; i < cur.count; i++) {
    const o = i * REC_BYTES;
    const pose = out[i] ?? (out[i] = newPose());
    pose.handle = cv.getUint32(o, true);
    pose.renderKey = cv.getUint32(o + 4, true);
    const cx = cv.getFloat64(o + 8, true);
    const cy = cv.getFloat64(o + 16, true);
    const cz = cv.getFloat64(o + 24, true);
    const cqx = cv.getFloat32(o + 32, true);
    const cqy = cv.getFloat32(o + 36, true);
    const cqz = cv.getFloat32(o + 40, true);
    const cqw = cv.getFloat32(o + 44, true);
    pose.animState = cv.getUint16(o + 48, true);
    pose.flags = cv.getUint16(o + 50, true);
    const j = pv ? prevIndex.get(pose.handle) : undefined;
    let snapped = true;
    if (pv && j !== undefined) {
      const po = j * REC_BYTES;
      const px = pv.getFloat64(po + 8, true);
      const py = pv.getFloat64(po + 16, true);
      const pz = pv.getFloat64(po + 24, true);
      const dx = cx - px;
      const dy = cy - py;
      const dz = cz - pz;
      if (dx * dx + dy * dy + dz * dz <= limit2) {
        snapped = false;
        pose.px = px + dx * a;
        pose.py = py + dy * a;
        pose.pz = pz + dz * a;
        slerpShortest(
          pv.getFloat32(po + 32, true), pv.getFloat32(po + 36, true), pv.getFloat32(po + 40, true), pv.getFloat32(po + 44, true),
          cqx, cqy, cqz, cqw, a, scratchQ,
        );
        pose.qx = scratchQ.qx;
        pose.qy = scratchQ.qy;
        pose.qz = scratchQ.qz;
        pose.qw = scratchQ.qw;
      }
    }
    if (snapped) {
      pose.px = cx;
      pose.py = cy;
      pose.pz = cz;
      pose.qx = cqx;
      pose.qy = cqy;
      pose.qz = cqz;
      pose.qw = cqw;
    }
    pose.snapped = snapped;
  }
  return cur.count;
}

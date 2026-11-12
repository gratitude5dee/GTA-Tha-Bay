/**
 * Boxy bodies (M10d1): buses, cable cars, vans' cargo boxes. A tube along Z with a rounded-rectangle ring that carries extra points at
 * the window band, rounded ends, and a per-cell style callback. Used by the bus, the cable car and the box truck.
 */
import { PART } from '../../../../packages/shared/src/assets/art-parts.ts';
import { addLoft, lerp, lin, type MeshSet, style, type LoftStation, type Style, type V2 } from './mesh.ts';

export interface BoxySpec {
  /** Rear and front z of the straight part's extent (the front is +z). */
  zRear: number;
  zFront: number;
  halfWidth: number;
  /** Underside and roof heights. */
  y0: number;
  y1: number;
  /** Corner radius of the ring. */
  radius: number;
  /** Window band on the sides (heights), or null. */
  window: readonly [number, number] | null;
  /** Length of the rounded end zones and how far they pull in (0..1) at the tip. */
  endLen: number;
  endPull: number;
  /** Top-edge crown, metres. */
  crown?: number;
}

export interface BoxyCell {
  /** Mid z of the strip. */
  z: number;
  /** 0 on the straight part, rising to 1 at the tip of an end. */
  d: number;
  front: boolean;
  /** Mid heights and half-widths of the two ring points the cell lies between. */
  y: number;
  x: number;
  /** Whether the cell is on a side wall, the roof, the underside or a corner. */
  zone: 'under' | 'corner-low' | 'side' | 'corner-high' | 'roof';
  /** Whether the cell is inside the window band. */
  inWindow: boolean;
}

/** The ring (right half bottom to top, then the left half back): n = 2 * (points per half) - 2. */
export function boxyRing(hw: number, y0: number, y1: number, r: number, window: readonly [number, number] | null, crown: number): { ring: V2[]; zone: BoxyCell['zone'][]; win: boolean[] } {
  const rr = Math.min(r, hw, (y1 - y0) / 3);
  const half: V2[] = [[0, y0]];
  const zones: BoxyCell['zone'][] = [];
  const wins: boolean[] = [];
  const push = (p: V2, zone: BoxyCell['zone'], win = false): void => {
    half.push(p);
    zones.push(zone);
    wins.push(win);
  };
  // cell k joins half[k] and half[k+1]: its zone is recorded when the second point is pushed
  push([hw - rr, y0], 'under');
  push([hw - rr * 0.3, y0 + rr * 0.1], 'corner-low');
  push([hw, y0 + rr], 'corner-low');
  const ys: number[] = [];
  if (window) ys.push(window[0], window[1]);
  const sideStart = y0 + rr, sideEnd = y1 - rr;
  let prev = sideStart;
  for (const y of ys) {
    if (y <= prev + 0.02 || y >= sideEnd - 0.02) continue;
    const inWin = window !== null && prev >= window[0] - 1e-6 && y <= window[1] + 1e-6;
    push([hw, y], 'side', inWin);
    prev = y;
  }
  const inWinLast = window !== null && prev >= window[0] - 1e-6 && sideEnd <= window[1] + 1e-6;
  push([hw, sideEnd], 'side', inWinLast);
  push([hw - rr * 0.3, y1 - rr * 0.1], 'corner-high');
  push([hw - rr, y1], 'corner-high');
  push([hw * 0.5, y1 + crown * 0.7], 'roof');
  push([0, y1 + crown], 'roof');
  const left: V2[] = [];
  const lz: BoxyCell['zone'][] = [];
  const lw: boolean[] = [];
  for (let i = half.length - 2; i >= 1; i--) left.push([-(half[i] as V2)[0], (half[i] as V2)[1]]);
  // cells of the left half mirror the right half in reverse
  for (let k = zones.length - 1; k >= 0; k--) {
    lz.push(zones[k] as BoxyCell['zone']);
    lw.push(wins[k] as boolean);
  }
  return { ring: [...half, ...left], zone: [...zones, ...lz], win: [...wins, ...lw] };
}

/** Builds the tube into `set`; `styleOf` gives the style of each cell (null leaves it out). */
export function addBoxy(set: MeshSet, s: BoxySpec, styleOf: (c: BoxyCell) => Style | null, caps: { front?: Style | null; rear?: Style | null } = {}): void {
  const crown = s.crown ?? 0.04;
  const ds = [0, 0.3, 0.55, 0.75, 0.9, 0.97, 1];
  const zs: { z: number; d: number }[] = [];
  const zStartRear = s.zRear + s.endLen, zStartFront = s.zFront - s.endLen;
  for (const d of [...ds].reverse()) zs.push({ z: s.zRear + s.endLen * (1 - d), d });
  const span = zStartFront - zStartRear;
  const mids = span > 6 ? 5 : span > 2.5 ? 3 : 1;
  for (let i = 1; i <= mids; i++) zs.push({ z: lerp(zStartRear, zStartFront, i / (mids + 1)), d: 0 });
  for (const d of ds) zs.push({ z: s.zFront - s.endLen * (1 - d), d });
  // drop the duplicated join stations (d = 0 appears at both zone starts)
  const stations: LoftStation[] = [];
  const dOf: number[] = [];
  let info = boxyRing(s.halfWidth, s.y0, s.y1, s.radius, s.window, crown);
  for (const q of zs) {
    const k = Math.pow(Math.max(0, 1 - Math.pow(q.d, 4)), 0.25);
    const pull = 1 - s.endPull * (1 - k);
    const ring = info.ring.map((p) => [p[0] * pull, p[1]] as V2);
    stations.push({ z: q.z, ring });
    dOf.push(q.d);
  }
  info = boxyRing(s.halfWidth, s.y0, s.y1, s.radius, s.window, crown);
  const n = info.ring.length;
  addLoft(set, stations, {
    cell: (si, c) => {
      const st0 = stations[si] as LoftStation, st1 = stations[si + 1] as LoftStation;
      const a = st0.ring[c] as V2, b = st0.ring[(c + 1) % n] as V2;
      const z = (st0.z + st1.z) / 2;
      const d = Math.max(dOf[si] as number, dOf[si + 1] as number);
      return styleOf({
        z,
        d,
        front: z > (s.zFront + s.zRear) / 2,
        y: (a[1] + b[1]) / 2,
        x: Math.abs((a[0] + b[0]) / 2),
        zone: info.zone[c] as BoxyCell['zone'],
        inWindow: info.win[c] as boolean,
      });
    },
    caps: { start: caps.rear ?? null, end: caps.front ?? null },
  });
}

export const solid = (material: string, part: number, hex: number): Style => style(material, part, hex);
export const glassStyle = (): Style => ({ material: 'glass', part: PART.glass, color: lin(0x1c2630) });

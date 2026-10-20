/**
 * Barrel vaults and glass halls (M02d2): a train shed, a hangar, a conservatory wing and a transit atrium all share these.
 * A vault is a half-oval cross-section on straight walls, extruded along its length. Conventions as in `primitives.ts`.
 */
import type { ColorRef, MatClass } from './palette.ts';
import { rotY, skin, tube, type Geo, type V3 } from './primitives.ts';

export interface VaultOpts {
  color: ColorRef;
  cls?: MatClass;
  /** Straight wall height below the arc (default 0: the arc springs from the ground). */
  wallH?: number;
  yaw?: number;
  /** Close the two ends with flat walls (default true). */
  caps?: boolean;
  /** Arc segments at `hi` (thinned by the rules; default 10). */
  segs?: number;
}

/** Cross-section points (x across, y up) of a vault of width w: the left wall, the arc, the right wall. */
export function vaultProfile(g: Geo, w: number, wallH: number, rise: number, segs: number): [number, number][] {
  const n = Math.max(3, g.rules.segs(segs));
  const pts: [number, number][] = [[-w / 2, 0]];
  if (wallH > 0) pts.push([-w / 2, wallH]);
  for (let i = 1; i < n; i++) {
    const a = Math.PI - (Math.PI * i) / n;
    pts.push([Math.cos(a) * (w / 2), wallH + Math.sin(a) * rise]);
  }
  if (wallH > 0) pts.push([w / 2, wallH]);
  pts.push([w / 2, 0]);
  return pts;
}

/** A vault centred on (cx, cz) with its floor at y0: `w` wide across local X, `d` long along local Z, the arc `rise` high. */
export function vault(g: Geo, cx: number, y0: number, cz: number, w: number, d: number, rise: number, o: VaultOpts): void {
  const yaw = o.yaw ?? 0;
  const prof = vaultProfile(g, w, o.wallH ?? 0, rise, o.segs ?? 10);
  const ring = (z: number): V3[] => prof.map(([x, y]) => {
    const [rx, rz] = rotY(x, z, yaw);
    return [cx + rx, y0 + y, cz + rz] as V3;
  });
  const caps = o.caps !== false;
  skin(g, [ring(-d / 2), ring(d / 2)], { color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: false, capStart: caps, capEnd: caps });
}

export interface HallOpts {
  yaw?: number;
  wallH: number;
  glass?: ColorRef;
  frame?: ColorRef;
  /** Number of frame ribs along the length at `hi`. */
  ribs: number;
  ribR?: number;
  segs?: number;
}

/** A glass hall: a vault in the glass class with a white rib frame (ribs thin out with the rules; none at `lo`). */
export function glassHall(g: Geo, cx: number, y0: number, cz: number, w: number, d: number, rise: number, o: HallOpts): void {
  const yaw = o.yaw ?? 0;
  vault(g, cx, y0, cz, w, d, rise, { color: o.glass ?? 'glassLight', cls: 'glass', wallH: o.wallH, yaw, segs: o.segs ?? 8 });
  if (g.rules.detail < 1) return;
  const prof = vaultProfile(g, w, o.wallH, rise, o.segs ?? 8);
  const n = g.rules.count(o.ribs, 3);
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + (d * i) / (n - 1);
    const path = prof.map(([x, y]) => {
      const [rx, rz] = rotY(x, z, yaw);
      return [cx + rx, y0 + y + 0.15, cz + rz] as V3;
    });
    tube(g, path, o.ribR ?? 0.18, 3, { color: o.frame ?? 'white', cls: 'metal' });
  }
}

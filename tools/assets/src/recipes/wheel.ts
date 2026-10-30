/**
 * Wheel recipes (M10d1): a tyre and a rim, both around the X axis through the hub, built outward-facing for either side. A wheel node
 * sits at the hub centre and spins about X (`anchors.ts`); `tyre_*` and `rim_*` are its two meshes.
 */
import { PART } from '../../../../packages/shared/src/assets/art-parts.ts';
import { addLathe, lin, Mesh, type V2 } from './mesh.ts';
import type { Fidelity } from './model.ts';

export interface WheelSpec {
  /** Tyre radius, metres. */
  radius: number;
  /** Tyre width, metres. */
  width: number;
  /** The direction of the wheel's outer face along X: +1 for the model's left side, -1 for the right. */
  side: 1 | -1;
  /** Rim colour, sRGB hex. */
  rim?: number;
}

const SEGS: Readonly<Record<Fidelity, number>> = { hi: 22, mid: 14, lo: 7 };

/** The tyre: a rounded tread with the sidewalls drawn in to the rim opening. */
export function buildTyre(spec: WheelSpec, f: Fidelity): Mesh {
  const m = new Mesh('detail');
  const R = spec.radius, w = spec.width;
  const profile: V2[] = [
    [-w / 2, R * 0.66],
    [-w / 2 + w * 0.05, R * 0.9],
    [-w * 0.36, R * 0.985],
    [-w * 0.14, R],
    [w * 0.14, R],
    [w * 0.36, R * 0.985],
    [w / 2 - w * 0.05, R * 0.9],
    [w / 2, R * 0.66],
  ];
  const keep = f === 'hi' ? profile : f === 'mid' ? [profile[0], profile[2], profile[3], profile[4], profile[5], profile[7]] : [profile[0], profile[3], profile[4], profile[7]];
  addLathe(m, [0, 0, 0], 'x', keep as V2[], SEGS[f], lin(0x121315), PART.tyre);
  return m;
}

/** The rim: a dish whose lip sits just inside the tyre opening and whose centre cap is recessed, facing `side`. */
export function buildRim(spec: WheelSpec, f: Fidelity): Mesh {
  const m = new Mesh('detail');
  const R = spec.radius, w = spec.width;
  const s = spec.side;
  const face = lin(spec.rim ?? 0xb7bcc4);
  const dark = lin(0x30343a);
  // profile points are [along the outward axis, radius]; the dish is read from the outside, so its normals face outward when the
  // profile runs from the lip towards the centre
  const dish: V2[] = [
    [0.3 * w, 0.68 * R],
    [0.24 * w, 0.62 * R],
    [0.06 * w, 0.46 * R],
    [-0.1 * w, 0.26 * R],
    [-0.16 * w, 0.18 * R],
  ];
  const dishLod = f === 'hi' ? dish : f === 'mid' ? [dish[0], dish[2], dish[4]] : [dish[0], dish[4]];
  // a mirrored profile runs the other way round, which keeps its normals facing outward
  const place = (pts: V2[]): V2[] => {
    const out = pts.map((p) => [p[0] * s, p[1]] as V2);
    return s < 0 ? out.reverse() : out;
  };
  const outer = new Mesh('detail');
  addLathe(outer, [0, 0, 0], 'x', place(dishLod as V2[]), SEGS[f], face, PART.rim);
  m.append(outer);
  const cap = new Mesh('detail');
  const capProfile: V2[] = [
    [-0.16 * w, 0.18 * R],
    [-0.16 * w, 0.0001],
  ];
  addLathe(cap, [0, 0, 0], 'x', place(capProfile), SEGS[f], dark, PART.rim);
  m.append(cap);
  return m;
}

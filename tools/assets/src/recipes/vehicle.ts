/**
 * Vehicle recipes (M10d1): road vehicles lofted from cross-sections. A car is two lofts, the lower body (sill to belt line, with the
 * wheel arches cut into the underside) and the greenhouse (belt line to roof), plus lamps, mirrors and four wheels. Everything is
 * deterministic and original: the proportions come from the spec of each vehicle below, not from any real model; there are no grilles,
 * badges, plates or text (rule V-SIL of the vetting checklist).
 *
 * Frame: +Z forward, +X to the left, +Y up; the origin is on the ground at the middle of the wheelbase. Node names follow the C07 1.1
 * vehicle contract (`body`, `wheel_*`, `steer_*`, `light_*`, `collider_hull`) plus `tyre_*`, `rim_*`, `sirens`.
 */
import { ART_NODE, PART } from '../../../../packages/shared/src/assets/art-parts.ts';
import { addBox, addEllipsoid, addLoft, lerp, lin, Mesh, MeshSet, smooth, style, type LoftStation, type Style, type V2, type V3 } from './mesh.ts';
import type { Fidelity, ModelDoc, ModelNode } from './model.ts';
import { buildRim, buildTyre } from './wheel.ts';

export interface CarSpec {
  /** `vehicle/traffic.sedan` and so on. */
  ref: string;
  fictionalMake: string;
  /** Overall metres. */
  length: number;
  width: number;
  /** Axle positions: wheelbase and track (hub to hub), tyre radius and width. */
  wheelbase: number;
  track: number;
  wheelR: number;
  tyreW: number;
  /** Z of the front tip relative to the middle of the wheelbase (the rear tip is `frontTip - length`). */
  frontTip: number;
  /** Underside height above the ground between the arches. */
  sill: number;
  /** Top of the lower body over the doors. */
  beltY: number;
  /** Top of the lower body at the nose (hood line) and at the tail (deck line). */
  hoodY: number;
  deckY: number;
  roofY: number;
  /** Greenhouse: z of the windscreen base and of the roof's front edge; z of the rear-window base and of the roof's rear edge. */
  wsBase: number;
  roofFront: number;
  roofRear: number;
  rwBase: number;
  /** Half width of the roof as a share of the belt half width. */
  roofShare: number;
  /** Colours, sRGB hex. */
  paint: number;
  livery?: number;
  /** Door panels in the livery colour (the livery part). */
  liveryDoors?: boolean;
  /** Side-glass ranges in z (default: the whole flat part of the greenhouse). */
  sideGlass?: readonly (readonly [number, number])[];
  /** The rear ramp is solid (a van or a truck cab). */
  solidRear?: boolean;
  /** The end zones' drop and plan rounding. */
  noseDrop?: number;
  endLen?: number;
  /** Extras by role. */
  roof?: 'lightbar' | 'dome' | 'sign' | 'rack';
  /** A bed behind the cab: top of the bed rails and the z where the cab ends (pickup). */
  bed?: { railY: number; cabEnd: number };
  /** Height of the headlamp centres. */
  lampY?: number;
  rim?: number;
}

const D_HI = [0, 0.18, 0.36, 0.54, 0.7, 0.82, 0.91, 0.97, 1];

function distinct(zs: number[]): number[] {
  const out: number[] = [];
  for (const z of zs.sort((a, b) => a - b)) if (out.length === 0 || z - (out[out.length - 1] as number) > 1e-4) out.push(z);
  return out;
}

/** The shape factor of an end zone: 1 inside, falling to 0 at the tip along a squared-off curve. */
const endShape = (d: number): number => Math.pow(Math.max(0, 1 - Math.pow(d, 4)), 0.25);

/** The lower body ring: 16 points around, from the underside centre up the +x (left) side and back down the other. */
function bodyRing(hw: number, yb: number, yt: number, crown: number): V2[] {
  const h = Math.max(0.12, yt - yb);
  const half: V2[] = [
    [0, yb],
    [hw * 0.78, yb],
    [hw * 0.955, yb + h * 0.07],
    [hw, yb + h * 0.22],
    [hw, yt - h * 0.3],
    [hw * 0.955, yt - h * 0.07],
    [hw * 0.8, yt - crown * 0.1],
    [hw * 0.45, yt + crown * 0.7],
    [0, yt + crown],
  ];
  const left: V2[] = [];
  for (let i = half.length - 2; i >= 1; i--) left.push([-(half[i] as V2)[0], (half[i] as V2)[1]]);
  return [...half, ...left];
}

/** The greenhouse ring: 12 points, belt line to roof. */
function cabinRing(wb: number, wr: number, y0: number, y1: number, crown: number): V2[] {
  const H = Math.max(0.02, y1 - y0);
  const half: V2[] = [
    [0, y0],
    [wb * 0.9, y0],
    [wb, y0 + H * 0.1],
    [lerp(wb, wr, 0.6), y0 + H * 0.62],
    [wr, y0 + H * 0.93],
    [wr * 0.62, y1],
    [0, y1 + crown],
  ];
  const left: V2[] = [];
  for (let i = half.length - 2; i >= 1; i--) left.push([-(half[i] as V2)[0], (half[i] as V2)[1]]);
  return [...half, ...left];
}

const halfIndex = (c: number, n: number): number => (c <= n / 2 - 1 ? c : n - 1 - c);

/** The meshes of a car body (paint, glass and detail primitives) with the shared lower body and greenhouse. */
export function carBody(spec: CarSpec, f: Fidelity): MeshSet {
  void f;
  const set = new MeshSet();
  const L = spec.length;
  const zF = spec.frontTip, zR = spec.frontTip - L;
  const hw0 = spec.width / 2;
  const endLen = spec.endLen ?? 0.55;
  const noseDrop = spec.noseDrop ?? 0.16;
  const R = spec.wheelR;
  const ra = R * 1.22;
  const archTop = R + ra * 0.95;
  const zAxles = [spec.wheelbase / 2, -spec.wheelbase / 2];
  const paint = lin(spec.paint);
  const livery = lin(spec.livery ?? spec.paint);
  const trim = lin(0x16181b);
  const glass = lin(0x1c2630);

  // ---- lower body ----------------------------------------------------------------------------------------------------------
  const ts: number[] = [];
  for (const d of D_HI) {
    ts.push(zF - endLen * (1 - d));
    ts.push(zR + endLen * (1 - d));
  }
  const thetas = [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90];
  for (const za of zAxles) for (const th of thetas) ts.push(za + ra * Math.sin((th * Math.PI) / 180));
  for (const z of [spec.wsBase, spec.rwBase, spec.roofFront, spec.roofRear, 0]) ts.push(z);
  if (spec.bed) ts.push(spec.bed.cabEnd, spec.bed.cabEnd - 0.02);
  const zs = distinct(ts.filter((z) => z <= zF + 1e-6 && z >= zR - 1e-6));

  const topY = (z: number): number => {
    if (spec.bed && z < spec.bed.cabEnd - 0.01) return spec.bed.railY;
    if (z > spec.wsBase) return lerp(spec.beltY - 0.02, spec.hoodY, smooth((z - spec.wsBase) / Math.max(0.1, zF - spec.wsBase)));
    if (z < spec.rwBase && !spec.bed) return lerp(spec.beltY - 0.02, spec.deckY, smooth((spec.rwBase - z) / Math.max(0.1, spec.rwBase - zR)));
    return spec.beltY;
  };
  const archY = (z: number): number => {
    let y = spec.sill;
    for (const za of zAxles) {
      const dz = Math.abs(z - za);
      if (dz < ra) y = Math.max(y, spec.sill + (archTop - spec.sill) * Math.sqrt(1 - (dz / ra) ** 2));
    }
    return y;
  };
  const stations: LoftStation[] = zs.map((z) => {
    let d = 0;
    if (z > zF - endLen) d = 1 - (zF - z) / endLen;
    else if (z < zR + endLen) d = 1 - (z - zR) / endLen;
    const s = endShape(d);
    const hw = hw0 * (0.12 + 0.88 * s);
    const yb = archY(z) + 0.14 * d * d;
    const yt = topY(z) - noseDrop * Math.pow(d, 2.2) * (z > 0 ? 1 : 0.85);
    return { z, ring: bodyRing(hw, yb, Math.max(yb + 0.14, yt), 0.035 * (1 - d * 0.5)) };
  });
  const creases = new Set<number>();
  if (spec.bed) {
    zs.forEach((z, i) => {
      if (Math.abs(z - spec.bed!.cabEnd) < 0.011 || Math.abs(z - (spec.bed!.cabEnd - 0.02)) < 0.011) creases.add(i);
    });
  }
  const bumper = (z: number): boolean => z > zF - 0.46 || z < zR + 0.46;
  addLoft(set, stations, {
    creaseStations: creases,
    cell: (s, c) => {
      const zMid = ((stations[s] as LoftStation).z + (stations[s + 1] as LoftStation).z) / 2;
      const h = halfIndex(c, 16);
      if (h === 0 || h === 1) return style('detail', PART.trim, 0x16181b); // underside and sill
      if (bumper(zMid) && h <= 3) return { material: 'detail', part: PART.trim, color: trim };
      if (spec.liveryDoors && (h === 2 || h === 3) && zMid < spec.wsBase - 0.05 && zMid > spec.rwBase + 0.15) {
        return { material: 'paint', part: PART.livery, color: livery };
      }
      return { material: 'paint', part: PART.paint, color: paint };
    },
    caps: { start: { material: 'detail', part: PART.trim, color: trim }, end: { material: 'detail', part: PART.trim, color: trim } },
  });

  // ---- greenhouse ----------------------------------------------------------------------------------------------------------
  const wb = hw0 * 0.9;
  const wr = wb * spec.roofShare;
  const ramp = (z: number): number => {
    if (z >= spec.wsBase) return 0;
    if (z > spec.roofFront) return 1 - (z - spec.roofFront) / Math.max(0.05, spec.wsBase - spec.roofFront);
    if (z >= spec.roofRear) return 1;
    if (z > spec.rwBase) return (z - spec.rwBase) / Math.max(0.05, spec.roofRear - spec.rwBase);
    return 0;
  };
  const gz: number[] = [];
  const rampSteps = [0, 0.14, 0.3, 0.5, 0.72, 0.9, 1];
  for (const t of rampSteps) {
    gz.push(lerp(spec.wsBase, spec.roofFront, t));
    gz.push(lerp(spec.rwBase, spec.roofRear, t));
  }
  const mid = (spec.roofFront + spec.roofRear) / 2;
  gz.push(mid, lerp(spec.roofFront, mid, 0.5), lerp(spec.roofRear, mid, 0.5));
  const gzs = distinct(gz);
  const y0 = spec.beltY - 0.03;
  const gst: LoftStation[] = gzs.map((z) => {
    const r = ramp(z);
    const e = Math.pow(r, 0.85);
    const y1 = lerp(y0 + 0.012, spec.roofY, e);
    return { z, ring: cabinRing(wb * lerp(0.86, 1, e), lerp(wb * 0.86, wr, e), y0, y1, 0.03 * e) };
  });
  const sideGlass = spec.sideGlass ?? [[spec.roofRear - 0.05, spec.roofFront + 0.05]];
  const bPillar = (z: number): boolean => Math.abs(z - mid) < 0.05 && spec.sideGlass === undefined;
  addLoft(set, gst, {
    cell: (s, c) => {
      const zMid = ((gst[s] as LoftStation).z + (gst[s + 1] as LoftStation).z) / 2;
      const h = halfIndex(c, 12);
      const r = ramp(zMid);
      const flat = r > 0.97;
      const front = zMid > mid;
      const gl: Style = { material: 'glass', part: PART.glass, color: glass };
      const pa: Style = { material: 'paint', part: PART.paint, color: paint };
      if (h <= 1) return pa;
      if (flat) {
        if (h >= 4) return pa;
        return sideGlass.some(([a, b]) => zMid >= a && zMid <= b) && !bPillar(zMid) ? gl : pa;
      }
      if (!front && spec.solidRear) return pa;
      if (h === 4) return pa;
      return gl;
    },
    caps: {},
  });

  // ---- details -------------------------------------------------------------------------------------------------------------
  const detail = set.get('detail');
  // door mirrors
  for (const sx of [1, -1]) addBox(detail, [sx * (wb + 0.07), spec.beltY + 0.1, spec.wsBase - 0.12], [0.13, 0.09, 0.15], trim, PART.trim);
  // a thin dark plastic strip under the belt line reads as the window seal
  if (spec.bed) {
    // the bed: a dark floor just below the rails
    const bz0 = spec.rwBase - 0.05 - 0.0, bz1 = spec.bed.cabEnd - 0.06;
    const zEnd = zR + 0.1;
    addBox(detail, [0, spec.bed.railY + 0.012, (Math.min(bz1, spec.bed.cabEnd - 0.06) + zEnd) / 2], [spec.width * 0.74, 0.03, spec.bed.cabEnd - 0.06 - zEnd], trim, PART.trim);
    void bz0;
  }
  if (spec.roof === 'rack') {
    addBox(detail, [0, spec.roofY + 0.06, mid], [spec.width * 0.55, 0.05, (spec.roofFront - spec.roofRear) * 0.8], trim, PART.trim);
  }
  return set;
}

// ---- the rest of a car ------------------------------------------------------------------------------------------------------

const lampBox = (m: Mesh, c: V3, size: V3, color: number, part: number): void => addBox(m, c, size, lin(color), part);

/** The glass primitives of a body as their own `glass` node (C07: `body` holds paint, `glass` and the lamps). */
export function splitGlass(meshes: Mesh[]): { rest: Mesh[]; glass: Mesh[] } {
  return { rest: meshes.filter((m) => m.material !== 'glass'), glass: meshes.filter((m) => m.material === 'glass') };
}

/** The nodes of a finished car for one fidelity: body, lamps, wheels, steering pivots, collider. */
export function buildCar(spec: CarSpec, f: Fidelity, body: MeshSet, extras: Record<string, string | number | boolean | number[]> = {}): ModelDoc {
  const hw = spec.width / 2;
  const hubY = spec.wheelR;
  const hubX = spec.track / 2;
  const zF = spec.frontTip, zR = spec.frontTip - spec.length;
  const lampY = spec.lampY ?? spec.hoodY - 0.12;
  const headX = hw * 0.66;
  const mk = (name: string, c: V3, size: V3, color: number, part: number): ModelNode => {
    const m = new Mesh('lamp');
    lampBox(m, [0, 0, 0], size, color, part);
    return { name, translation: c, meshes: [m] };
  };
  const lamps: ModelNode[] = [
    mk('light_head_l', [headX, lampY, zF - 0.1], [0.36, 0.1, 0.14], 0xfff3c4, PART.lampHead),
    mk('light_head_r', [-headX, lampY, zF - 0.1], [0.36, 0.1, 0.14], 0xfff3c4, PART.lampHead),
    mk('light_brake_l', [headX, spec.deckY - 0.12, zR + 0.08], [0.34, 0.09, 0.12], 0xc0161a, PART.lampBrake),
    mk('light_brake_r', [-headX, spec.deckY - 0.12, zR + 0.08], [0.34, 0.09, 0.12], 0xc0161a, PART.lampBrake),
  ];
  const roofMid = (spec.roofFront + spec.roofRear) / 2;
  const bodyChildren: ModelNode[] = [...lamps];
  // the bases of the roof gear are plain trim in the body's detail primitive, so each gear node is one primitive
  const baseDetail = body.get('detail');
  if (spec.roof === 'lightbar') {
    const sirens = new Mesh('lamp');
    addBox(sirens, [0.3, 0, 0], [0.5, 0.1, 0.28], lin(0xe02c2c), PART.sirenRed);
    addBox(sirens, [-0.3, 0, 0], [0.5, 0.1, 0.28], lin(0x2c5be0), PART.sirenBlue);
    addBox(baseDetail, [0, spec.roofY + 0.045, roofMid], [1.16, 0.04, 0.34], lin(0x16181b), PART.trim);
    bodyChildren.push({ name: ART_NODE.sirens, translation: [0, spec.roofY + 0.09, roofMid], meshes: [sirens] });
  } else if (spec.roof === 'dome') {
    const dome = new Mesh('lamp');
    addEllipsoid(dome, [0, 0.12, 0], [0.24, 0.17, 0.24], f === 'hi' ? 14 : 10, lin(0x1e2329), PART.dome);
    addBox(baseDetail, [0, spec.roofY + 0.03, roofMid + 0.1], [0.38, 0.05, 0.38], lin(0x16181b), PART.trim);
    bodyChildren.push({ name: 'dome', translation: [0, spec.roofY + 0.03, roofMid + 0.1], meshes: [dome] });
  } else if (spec.roof === 'sign') {
    const sign = new Mesh('lamp');
    addBox(sign, [0, 0, 0], [0.5, 0.13, 0.2], lin(0x6cf0d8), PART.glow);
    bodyChildren.push({ name: 'roof_sign', translation: [0, spec.roofY + 0.09, roofMid], meshes: [sign] });
  }
  const collider = colliderHull(spec);
  const { rest, glass } = splitGlass(body.list());
  const bodyNode: ModelNode = { name: ART_NODE.body, meshes: rest, children: [{ name: ART_NODE.glass, meshes: glass }, ...bodyChildren] };
  const roots: ModelNode[] = [bodyNode];
  const wheelNames = ART_NODE.wheels;
  const steerNames = ART_NODE.steers;
  wheelNames.forEach((wn, k) => {
    const left = k % 2 === 0;
    const front = k < 2;
    const sideSign: 1 | -1 = left ? 1 : -1;
    const tyre = buildTyre({ radius: spec.wheelR, width: spec.tyreW, side: sideSign }, f);
    const rim = buildRim({ radius: spec.wheelR, width: spec.tyreW, side: sideSign, ...(spec.rim !== undefined ? { rim: spec.rim } : {}) }, f);
    const wheel: ModelNode = {
      name: wn,
      children: [
        { name: ART_NODE.tyres[k] as string, meshes: [tyre] },
        { name: ART_NODE.rims[k] as string, meshes: [rim] },
      ],
    };
    const pos: V3 = [(left ? 1 : -1) * hubX, hubY, front ? spec.wheelbase / 2 : -spec.wheelbase / 2];
    if (front) {
      roots.push({ name: steerNames[left ? 0 : 1] as string, translation: pos, children: [wheel] });
    } else {
      wheel.translation = pos;
      roots.push(wheel);
    }
  });
  roots.push({ name: ART_NODE.collider, meshes: [collider] });
  return {
    ref: spec.ref,
    fidelity: f,
    extras: { fictionalMake: spec.fictionalMake, wheelRadiusM: spec.wheelR, ...extras },
    roots,
  };
}

/** A convex hull of twelve vertices around the body (sill, belt and roof rectangles), for the collider contract. */
export function colliderHull(spec: CarSpec): Mesh {
  const m = new Mesh('collider');
  const zF = spec.frontTip - 0.05, zR = spec.frontTip - spec.length + 0.05;
  const hw = spec.width / 2;
  const roofMid = (spec.roofFront + spec.roofRear) / 2;
  const rings: { y: number; hw: number; z0: number; z1: number }[] = [
    { y: spec.sill, hw: hw * 0.9, z0: zR, z1: zF },
    { y: spec.beltY, hw, z0: zR, z1: zF },
    { y: spec.roofY, hw: hw * 0.7, z0: roofMid - (spec.roofFront - spec.roofRear) * 0.4, z1: roofMid + (spec.roofFront - spec.roofRear) * 0.4 },
  ];
  const n: V3 = [0, 1, 0];
  const ids = rings.map((r) => [
    m.vertex([r.hw, r.y, r.z1], n, [0.5, 0.5, 0.5], 0),
    m.vertex([-r.hw, r.y, r.z1], n, [0.5, 0.5, 0.5], 0),
    m.vertex([-r.hw, r.y, r.z0], n, [0.5, 0.5, 0.5], 0),
    m.vertex([r.hw, r.y, r.z0], n, [0.5, 0.5, 0.5], 0),
  ]);
  for (let k = 0; k < rings.length - 1; k++) {
    const a = ids[k] as number[], b = ids[k + 1] as number[];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      m.quad(a[i] as number, a[j] as number, b[j] as number, b[i] as number);
    }
  }
  const top = ids[rings.length - 1] as number[];
  m.quad(top[0] as number, top[1] as number, top[2] as number, top[3] as number);
  return m;
}

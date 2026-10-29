/**
 * Prop recipes (M10d1): street props, pickups, the objective beam, the police helicopter, the ferry and the airliner. Original shapes
 * built from boxes, lathes and lofts; no text, no logos. A prop is one node tree under a root node named after the asset. Sizes follow
 * the physics shapes of the prefabs they stand in for.
 */
import { PART } from '../../../../packages/shared/src/assets/art-parts.ts';
import { bodyAt } from '../lod.ts';
import { addBoxy, solid, type BoxyCell } from './boxy.ts';
import { addBox, addEllipsoid, addLathe, addLoft, lerp, lin, Mesh, MeshSet, type LoftStation, type V2, type V3 } from './mesh.ts';
import type { Fidelity, ModelDoc, ModelNode } from './model.ts';

const segs = (f: Fidelity, hi: number): number => (f === 'hi' ? hi : f === 'mid' ? Math.max(6, Math.round(hi * 0.6)) : Math.max(5, Math.round(hi * 0.4)));

function doc(ref: string, f: Fidelity, set: MeshSet, children: ModelNode[] = [], extras: ModelDoc['extras'] = {}): ModelDoc {
  const root: ModelNode = { name: ref.split('/')[1] as string, meshes: set.list(), children };
  return { ref, fidelity: f, extras, roots: [root] };
}

/** A convex polygon (in the two axes other than `axis`) extruded between `a0` and `a1` along `axis`. */
export function addExtrude(m: Mesh, poly: readonly V2[], axis: 'x' | 'y', a0: number, a1: number, color: V3, part: number): void {
  const at = (p: V2, a: number): V3 => (axis === 'y' ? [p[0], a, p[1]] : [a, p[1], p[0]]);
  const n = poly.length;
  const nrm = (s: number): V3 => (axis === 'y' ? [0, s, 0] : [s, 0, 0]);
  const cx = poly.reduce((a, p) => a + p[0], 0) / n, cy = poly.reduce((a, p) => a + p[1], 0) / n;
  for (const [a, s] of [[a0, -1], [a1, 1]] as const) {
    const hub = m.vertex(at([cx, cy], a), nrm(s), color, part);
    const ids = poly.map((p) => m.vertex(at(p, a), nrm(s), color, part));
    for (let i = 0; i < n; i++) m.tri(hub, ids[i] as number, ids[(i + 1) % n] as number);
  }
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i] as V2, q = poly[(i + 1) % n] as V2;
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  const sg = area2 >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = poly[i] as V2, q = poly[(i + 1) % n] as V2;
    const e: V2 = [q[0] - p[0], q[1] - p[1]];
    const l = Math.hypot(e[0], e[1]) || 1;
    const o: V2 = [(sg * e[1]) / l, (-sg * e[0]) / l];
    const nn: V3 = axis === 'y' ? [o[0], 0, o[1]] : [0, o[1], o[0]];
    const ids = [at(p, a0), at(q, a0), at(q, a1), at(p, a1)].map((v) => m.vertex(v, nn, color, part));
    m.quad(ids[0] as number, ids[1] as number, ids[2] as number, ids[3] as number);
  }
  // make every triangle face away from the centre of the extrusion
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] as number, b = m.idx[t + 1] as number, c = m.idx[t + 2] as number;
    const pa = [m.pos[a * 3], m.pos[a * 3 + 1], m.pos[a * 3 + 2]] as number[], pb = [m.pos[b * 3], m.pos[b * 3 + 1], m.pos[b * 3 + 2]] as number[], pc = [m.pos[c * 3], m.pos[c * 3 + 1], m.pos[c * 3 + 2]] as number[];
    const u = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!], v = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
    const cr = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const dn = cr[0]! * (m.nor[a * 3] as number) + cr[1]! * (m.nor[a * 3 + 1] as number) + cr[2]! * (m.nor[a * 3 + 2] as number);
    if (dn < 0) {
      m.idx[t + 1] = c;
      m.idx[t + 2] = b;
    }
  }
}

// ---- street props ------------------------------------------------------------------------------------------------------------

export function buildCone(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const m = set.get('detail');
  const s = segs(f, 16);
  addBox(m, [0, 0.02, 0], [0.42, 0.04, 0.42], lin(0x2b2f35), PART.matte);
  addLathe(m, [0, 0, 0], 'y', [[0.04, 0.17], [0.3, 0.1], [0.62, 0.05], [0.7, 0.035]], s, lin(0xf26a1b), PART.matte);
  addLathe(m, [0, 0, 0], 'y', [[0.3, 0.1005], [0.38, 0.0885]], s, lin(0xf2f2f0), PART.chrome);
  return doc('prop/cone', f, set);
}

/** A striped plastic barrier: a tapered tube along X with alternating bands. */
function stripedWall(set: MeshSet, length: number, hw: number, h: number, bands: number, a: number, b: number, base: number): void {
  const st: LoftStation[] = [];
  const ring: V2[] = [[0, 0], [hw, 0], [hw * 0.8, h * 0.45], [hw * 0.45, h], [0, h], [-hw * 0.45, h], [-hw * 0.8, h * 0.45], [-hw, 0]];
  for (let i = 0; i <= bands * 2; i++) st.push({ z: lerp(-length / 2, length / 2, i / (bands * 2)), ring });
  addLoft(set, st, {
    creaseStations: new Set(st.map((_, i) => i)),
    cell: (s, c) => (c === 0 || c === 7 ? solid('detail', PART.matte, base) : solid('detail', PART.matte, Math.floor(s / 1) % 2 === 0 ? a : b)),
    caps: { start: solid('detail', PART.matte, base), end: solid('detail', PART.matte, base) },
  });
}

export function buildBarrier(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  // half extents 1.2 x 0.5 x 0.2: a plastic road barrier lying along X
  const s = new MeshSet();
  stripedWall(s, 2.4, 0.2, 1.0, f === 'hi' ? 6 : 3, 0xf0f0ec, 0xe8532b, 0x2b2f35);
  const m = set.get('detail');
  for (const p of s.list()) {
    // lay it along X: swap z into x
    const q = new Mesh(p.material);
    for (let i = 0; i < p.pos.length; i += 3) {
      q.pos.push(p.pos[i + 2] as number, (p.pos[i + 1] as number) - 0.5, p.pos[i] as number);
      q.nor.push(p.nor[i + 2] as number, p.nor[i + 1] as number, p.nor[i] as number);
    }
    q.col.push(...p.col);
    q.part.push(...p.part);
    for (let i = 0; i < p.idx.length; i += 3) q.idx.push(p.idx[i] as number, p.idx[i + 2] as number, p.idx[i + 1] as number);
    m.append(q);
  }
  return doc('prop/barrier', f, set);
}

function longBarrier(ref: string, f: Fidelity, halfLen: number, h: number, hw: number, a: number, b: number, base: number, lamps: boolean): ModelDoc {
  const set = new MeshSet();
  const m = set.get('detail');
  addBox(m, [0, h / 2 - 0.1, 0], [halfLen * 2, h - 0.2, hw * 2], lin(base), PART.matte);
  const n = f === 'hi' ? 12 : f === 'mid' ? 8 : 4;
  for (let i = 0; i < n; i++) addBox(m, [lerp(-halfLen + halfLen / n, halfLen - halfLen / n, i / (n - 1)), h - 0.1, 0], [(halfLen * 2) / n * 0.92, 0.3, hw * 2 + 0.04], lin(i % 2 === 0 ? a : b), PART.matte);
  for (const sx of [-1, 1]) addBox(m, [sx * (halfLen - 0.3), h / 2, 0], [0.5, h, hw * 2 + 0.2], lin(0x2b2f35), PART.matte);
  const lamp = new Mesh('lamp');
  if (lamps) for (const sx of [-1, 1]) addBox(lamp, [sx * (halfLen - 0.3), h + 0.15, 0], [0.3, 0.3, 0.3], lin(0xff7a1a), PART.amber);
  if (lamp.idx.length > 0) set.get('lamp').append(lamp);
  return doc(ref, f, set);
}

export const buildCountyBarrier = (f: Fidelity): ModelDoc => longBarrier('prop/county-barrier', f, 7.5, 2.0, 0.4, 0xf0f0ec, 0xe8532b, 0x8a8f96, false);
export const buildPortalClosure = (f: Fidelity): ModelDoc => longBarrier('prop/portal-closure', f, 8, 2.0, 0.5, 0xf2c230, 0x2b2f35, 0x6b7077, true);

export function buildSpikestrip(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const m = set.get('detail');
  addBox(m, [0, 0.02, 0], [4, 0.04, 0.5], lin(0x2b2f35), PART.matte);
  const n = f === 'hi' ? 15 : f === 'mid' ? 9 : 5;
  const s = segs(f, 6);
  for (let i = 0; i < n; i++) addLathe(m, [lerp(-1.85, 1.85, i / (n - 1)), 0.04, 0], 'y', [[0, 0.05], [0.12, 0.0001]], s, lin(0xb9bec6), PART.chrome);
  return doc('prop/spikestrip', f, set);
}

export function buildCrate(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const m = set.get('detail');
  addBox(m, [0, 0, 0], [0.96, 0.96, 0.96], lin(0x9a6b3a), PART.matte);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(m, [sx * 0.45, 0, sz * 0.45], [0.1, 1, 0.1], lin(0x6e4a26), PART.matte);
  for (const y of [-0.4, 0, 0.4]) addBox(m, [0, y, 0], [1.0, 0.1, 1.0], lin(0x7e5530), PART.matte);
  if (f === 'hi') for (const sy of [-1, 1]) addBox(m, [0, sy * 0.5, 0], [1.02, 0.04, 1.02], lin(0x6e4a26), PART.matte);
  return doc('prop/crate', f, set);
}

export function buildTransitEntrance(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const m = set.get('detail');
  // half extents 1.6 x 1.3 x 1.2: a stair head with a canopy and a sign post
  addBox(m, [0, -0.1, 0], [3.2, 2.4, 2.4], lin(0x39424e), PART.matte);
  addBox(m, [0, 1.2, 0], [3.5, 0.2, 2.7], lin(0xffc23d), PART.matte);
  addBox(m, [0, 0.1, 1.21], [1.6, 1.9, 0.05], lin(0x14181d), PART.trim);
  addBox(m, [1.45, 2.4, -1.0], [0.16, 2.4, 0.16], lin(0x39424e), PART.matte);
  const g = set.get('lamp');
  addBox(g, [1.45, 3.7, -1.0], [0.9, 0.6, 0.12], lin(0xffc23d), PART.glow);
  if (f !== 'lo') addBox(m, [0, -0.5, 1.3], [2.6, 0.25, 0.5], lin(0x4b5563), PART.matte);
  return doc('prop/transit-entrance', f, set);
}

export function buildPickupCash(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const g = set.get('lamp');
  const n = f === 'lo' ? 1 : 3;
  for (let i = 0; i < n; i++) addBox(g, [0, i * 0.06 - 0.06, 0], [0.5 - i * 0.02, 0.05, 0.3], lin(0x2f9a4a), PART.glow);
  addBox(set.get('detail'), [0, 0, 0], [0.12, 0.2, 0.32], lin(0xe8e1c8), PART.matte);
  return doc('prop/pickup-cash', f, set);
}

export function buildPickupItem(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const g = set.get('lamp');
  addEllipsoid(g, [0, 0, 0], [0.28, 0.28, 0.28], segs(f, 16), lin(0xf2c230), PART.glow);
  const ring = set.get('detail');
  addLathe(ring, [0, 0, 0], 'y', [[-0.02, 0.36], [0.02, 0.36]], segs(f, 20), lin(0xe8e1c8), PART.chrome, { hardEdges: true });
  return doc('prop/pickup-item', f, set);
}

/** The objective beam: an open eight-sided column whose colour fades with height (the runtime fades it near the camera too). */
export function buildMarkerBeam(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const g = set.get('lamp');
  const n = f === 'hi' ? 5 : 3;
  const sides = f === 'lo' ? 6 : 8;
  const H = 30;
  for (let i = 0; i < n; i++) {
    const y0 = (H * i) / n, y1 = (H * (i + 1)) / n;
    const k0 = 1 - y0 / H, k1 = 1 - y1 / H;
    const seg = new Mesh('lamp');
    // two rings with a brightness (colour) ramp, no caps
    const ids: number[][] = [];
    for (const [y, k] of [[y0, k0], [y1, k1]] as const) {
      const row: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const c = lin(0xf2c230);
        row.push(seg.vertex([0.25 * Math.cos(a), y, 0.25 * Math.sin(a)], [Math.cos(a), 0, Math.sin(a)], [c[0] * k, c[1] * k, c[2] * k], PART.glow));
      }
      ids.push(row);
    }
    for (let s = 0; s < sides; s++) seg.quad((ids[0] as number[])[s] as number, (ids[1] as number[])[s] as number, (ids[1] as number[])[s + 1] as number, (ids[0] as number[])[s + 1] as number);
    g.append(seg);
  }
  // fix winding outward
  for (let t = 0; t < g.idx.length; t += 3) {
    const a = g.idx[t] as number, b = g.idx[t + 1] as number, c = g.idx[t + 2] as number;
    const ux = (g.pos[b * 3] as number) - (g.pos[a * 3] as number), uy = (g.pos[b * 3 + 1] as number) - (g.pos[a * 3 + 1] as number), uz = (g.pos[b * 3 + 2] as number) - (g.pos[a * 3 + 2] as number);
    const vx = (g.pos[c * 3] as number) - (g.pos[a * 3] as number), vy = (g.pos[c * 3 + 1] as number) - (g.pos[a * 3 + 1] as number), vz = (g.pos[c * 3 + 2] as number) - (g.pos[a * 3 + 2] as number);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * (g.nor[a * 3] as number) + ny * (g.nor[a * 3 + 1] as number) + nz * (g.nor[a * 3 + 2] as number) < 0) {
      g.idx[t + 1] = c;
      g.idx[t + 2] = b;
    }
  }
  // a base ring on the ground
  addLathe(set.get('detail'), [0, 0, 0], 'y', [[0, 0.9], [0.06, 0.9]], segs(f, 20), lin(0xf2c230), PART.glow, { flatCaps: true });
  return doc('prop/marker.beam', f, set);
}

// ---- backdrop pieces: helicopter, ferry, airliner -----------------------------------------------------------------------------

export function buildHeli(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const paint = set.get('paint');
  const dark = lin(0x1b1f24);
  const s = segs(f, 18);
  addEllipsoid(paint, [0, 0, 0], [0.95, 0.85, 2.0], s, dark, PART.paint);
  addEllipsoid(paint, [0, -0.05, 0.0], [0.97, 0.12, 1.0], s, lin(0xf4f4f4), PART.livery);
  addLathe(paint, [0, 0.3, 1.5], 'z', [[0, 0.3], [1.6, 0.22], [3.2, 0.12], [3.6, 0.1]], segs(f, 10), dark, PART.paint);
  addExtrude(paint, [[0, 0], [0.5, 0.0], [0.15, 0.95], [-0.1, 0.95]], 'x', -0.04, 0.04, dark, PART.paint);
  const glass = set.get('glass');
  addEllipsoid(glass, [0, 0.12, -1.25], [0.78, 0.55, 0.85], s, lin(0x1c2630), PART.glass);
  const detail = set.get('detail');
  for (const sx of [-1, 1]) {
    addBox(detail, [sx * 0.7, -1.0, 0], [0.07, 0.07, 2.6], lin(0x2b2f35), PART.trim);
    for (const sz of [-0.7, 0.8]) addBox(detail, [sx * 0.55, -0.7, sz], [0.06, 0.6, 0.06], lin(0x2b2f35), PART.trim);
  }
  addBox(detail, [0, 0.95, 0], [0.3, 0.3, 0.3], lin(0x2b2f35), PART.trim);
  const lamp = set.get('lamp');
  addBox(lamp, [0, -0.9, -1.9], [0.4, 0.2, 0.4], lin(0xe02c2c), PART.sirenRed);
  const mkRotor = (name: string, t: V3, blades: V3[]): ModelNode => {
    const m = new Mesh('detail');
    for (const b of blades) addBox(m, [0, 0, 0], b, lin(0x888d94), PART.trim);
    return { name, translation: t, meshes: [m] };
  };
  const main = mkRotor('rotor_main', [0, 1.1, 0], f === 'lo' ? [[9, 0.05, 0.3]] : [[9, 0.05, 0.3], [0.3, 0.05, 9]]);
  const tail = mkRotor('rotor_tail', [0.12, 0.9, 3.6], [[0.05, 1.5, 0.12]]);
  void main;
  const body = bodyAt(set, f, { mid: 900, lo: 300 });
  return doc('prop/police.heli', f, body, [main, tail]);
}

export function buildFerry(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const hull = lin(0x1c5d99);
  addBoxy(set, { zRear: -16, zFront: 16, halfWidth: 4.5, y0: -1.2, y1: 1.1, radius: 0.8, window: null, endLen: 5, endPull: 0.9, crown: 0.05 },
    (c: BoxyCell) => ({ material: 'paint', part: c.zone === 'roof' ? PART.paint : PART.paint, color: c.y > 0.6 ? lin(0xe8eef2) : hull }),
    { front: solid('paint', PART.paint, 0xe8eef2), rear: solid('paint', PART.paint, 0xe8eef2) });
  addBoxy(set, { zRear: -11, zFront: 9, halfWidth: 3.6, y0: 1.1, y1: 3.1, radius: 0.35, window: [1.7, 2.6], endLen: 2.5, endPull: 0.5, crown: 0.05 },
    (c: BoxyCell) => (c.inWindow ? solid('glass', PART.glass, 0x1c2630) : solid('paint', PART.paint, 0xe8eef2)));
  addBoxy(set, { zRear: -7, zFront: 3, halfWidth: 2.6, y0: 3.1, y1: 4.3, radius: 0.25, window: [3.4, 4.0], endLen: 1.5, endPull: 0.4, crown: 0.04 },
    (c: BoxyCell) => (c.inWindow ? solid('glass', PART.glass, 0x1c2630) : solid('paint', PART.paint, 0xe8eef2)));
  const d = set.get('detail');
  addLathe(d, [0, 4.3, -2.5], 'y', [[0, 0.9], [1.2, 0.75], [1.5, 0.78]], segs(f, 16), lin(0x1c5d99), PART.paint);
  addBox(d, [0, 3.1, 8.5], [5, 0.15, 3], lin(0x6b7077), PART.matte);
  const body = bodyAt(set, f, { mid: 2200, lo: 800 });
  return doc('prop/transit.ferry', f, body);
}

export function buildAirliner(f: Fidelity): ModelDoc {
  const set = new MeshSet();
  const white = lin(0xf2f4f6);
  const blue = lin(0x3a6ea5);
  const paint = set.get('paint');
  const N = 16;
  const radius = (z: number): number => {
    if (z > 20) return 1.7 * Math.sqrt(Math.max(0.04, 1 - ((z - 20) / 8.2) ** 2));
    if (z < -18) return lerp(0.35, 1.7, Math.min(1, (z + 28) / 10));
    return 1.7;
  };
  const stations: LoftStation[] = [];
  const zs = [-28, -26, -23, -20, -16, -8, 0, 8, 16, 20, 23, 25.5, 27, 28];
  for (const z of zs) {
    const r = radius(z);
    const ring: V2[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      ring.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    stations.push({ z, ring });
  }
  addLoft(set, stations, {
    cell: (s, c) => {
      const zMid = ((stations[s] as LoftStation).z + (stations[s + 1] as LoftStation).z) / 2;
      const low = c >= N / 2 - 1 && c <= N / 2 + 2;
      if (zMid > 21 && zMid < 24 && c >= 2 && c <= 5) return solid('glass', PART.glass, 0x1c2630);
      return { material: 'paint', part: low ? PART.livery : PART.paint, color: low ? blue : white };
    },
    caps: {},
  });
  // wings, tailplane, fin: swept slabs
  for (const sx of [-1, 1]) {
    addExtrude(paint, [[0, 6], [sx * 17, -2], [sx * 17, -5], [0, -8]].map((p) => [p[0], p[1]] as V2), 'y', -0.7, -0.4, white, PART.paint);
    addExtrude(paint, [[0, -22], [sx * 6.5, -27], [sx * 6.5, -28], [0, -26]].map((p) => [p[0], p[1]] as V2), 'y', 0.0, 0.2, white, PART.paint);
  }
  addExtrude(paint, [[-18, 1.5], [-27.5, 1.5], [-28.3, 7], [-25, 7]].map((p) => [p[0], p[1]] as V2), 'x', -0.2, 0.2, blue, PART.livery);
  const d = set.get('detail');
  for (const sx of [-1, 1]) for (const ex of [6.5, 11.5]) addLathe(d, [sx * ex, -1.6, 0], 'z', [[-1.8, 0.7], [0.6, 0.85], [2.0, 0.78]], segs(f, 12), lin(0x8a9099), PART.trim);
  const body = bodyAt(set, f, { mid: 2200, lo: 700 });
  return doc('prop/transit.airliner', f, body);
}

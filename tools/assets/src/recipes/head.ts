/**
 * The people recipes of M10d4, part 2: the head with its 24 morph targets (the `morph_*` ids of the creator catalog) and the hair styles.
 * The skull is a sweep of elliptical rings with a hand-set profile; nose, lips, eyes, brows and ears are small sweeps of their own, all
 * weighted to the head bone. A morph target is a set of Gaussian displacements around a facial landmark (mirrored across x = 0), so the
 * 24 targets move the same landmarks on every face. Faces come from sliders and a seeded table, never from a photo or a scan.
 */
import {
  ellipsoid, FRAME_X, FRAME_Y, FRAME_Z, hash01, lerp, profileAt, rigid, SkinMesh, smoothNormals, tube, PERSON_PART,
  type Cell, type Ring,
} from './skin-mesh.ts';
import { BROW_CELL, cellOf, HAIR_CELL, LIP_CELL, LODS, SKIN_CELL, steps, type AtlasLayout, type FaceSpec, type Fidelity, type HairSpec } from './people.ts';
import type { V3 } from './rig.ts';

/** The centre of the skull and its radii (x, y, z); the crown is at y = 1.788 and the chin at 1.572. */
export const HEAD_C: V3 = [0, 1.68, 0];
export const HEAD_R: V3 = [0.088, 0.108, 0.1];
const CHIN_Y = 1.572;
const CROWN_Y = 1.788;

/** Width and depth profile of the skull by the fraction s of the way from chin to crown: [s, rx, rz, cz]. */
const SKULL: readonly (readonly number[])[] = [
  [0.0, 0.012, 0.022, -0.04],
  [0.06, 0.036, 0.05, -0.04],
  [0.15, 0.058, 0.074, -0.026],
  [0.28, 0.074, 0.092, -0.012],
  [0.42, 0.083, 0.099, -0.004],
  [0.55, 0.088, 0.101, 0.0],
  [0.7, 0.088, 0.102, 0.0],
  [0.84, 0.076, 0.094, 0.004],
  [0.94, 0.05, 0.066, 0.004],
  [1.0, 0.012, 0.02, 0.004],
];

const sAt = (y: number): number => (y - CHIN_Y) / (CROWN_Y - CHIN_Y);

/** z of the face surface at height y (negative: the front). */
export function surfaceZ(y: number): number {
  const [, rz, cz] = profileAt(SKULL, Math.min(1, Math.max(0, sAt(y)))) as [number, number, number];
  return cz - rz;
}

const headW = rigid('head');

// ---- morphs -----------------------------------------------------------------------------------------------------------------------

interface Push { c: V3; s: number; d: V3; mirror?: boolean; scale?: number }

const E = 0.034;
/** The 24 targets in catalog order. A push displaces the vertices around `c` by `d` (or scales them about `c` by `scale`). */
export const MORPH_TARGETS: readonly { id: string; target: string; pushes: Push[] }[] = [
  { id: 'brow-height', target: 'morph_brow_height', pushes: [{ c: [0.03, 1.725, -0.085], s: 0.025, d: [0, 0.012, 0], mirror: true }] },
  { id: 'brow-depth', target: 'morph_brow_depth', pushes: [{ c: [0.03, 1.725, -0.085], s: 0.025, d: [0, 0, -0.01], mirror: true }] },
  { id: 'eye-size', target: 'morph_eye_size', pushes: [{ c: [E, 1.7, -0.09], s: 0.022, d: [0, 0, 0], scale: 0.3, mirror: true }] },
  { id: 'eye-spacing', target: 'morph_eye_spacing', pushes: [{ c: [E, 1.7, -0.088], s: 0.03, d: [0.008, 0, 0], mirror: true }] },
  { id: 'eye-tilt', target: 'morph_eye_tilt', pushes: [{ c: [0.052, 1.7, -0.086], s: 0.02, d: [0, 0.008, 0], mirror: true }, { c: [0.018, 1.7, -0.09], s: 0.02, d: [0, -0.008, 0], mirror: true }] },
  { id: 'nose-width', target: 'morph_nose_width', pushes: [{ c: [0.016, 1.655, -0.1], s: 0.014, d: [0.007, 0, 0], mirror: true }] },
  { id: 'nose-length', target: 'morph_nose_length', pushes: [{ c: [0, 1.655, -0.112], s: 0.02, d: [0, 0, -0.01] }] },
  { id: 'nose-bridge', target: 'morph_nose_bridge', pushes: [{ c: [0, 1.69, -0.092], s: 0.014, d: [0, 0, -0.008] }] },
  { id: 'cheek-fullness', target: 'morph_cheek_fullness', pushes: [{ c: [0.05, 1.64, -0.06], s: 0.03, d: [0.006, 0, -0.008], mirror: true }] },
  { id: 'cheekbone', target: 'morph_cheekbone', pushes: [{ c: [0.062, 1.665, -0.05], s: 0.025, d: [0.004, 0.004, -0.007], mirror: true }] },
  { id: 'jaw-width', target: 'morph_jaw_width', pushes: [{ c: [0.055, 1.6, -0.03], s: 0.03, d: [0.01, 0, 0], mirror: true }] },
  { id: 'jaw-length', target: 'morph_jaw_length', pushes: [{ c: [0, 1.585, -0.05], s: 0.04, d: [0, -0.012, 0] }] },
  { id: 'chin-width', target: 'morph_chin_width', pushes: [{ c: [0.012, 1.58, -0.065], s: 0.018, d: [0.008, 0, 0], mirror: true }] },
  { id: 'chin-height', target: 'morph_chin_height', pushes: [{ c: [0, 1.58, -0.06], s: 0.02, d: [0, -0.01, -0.002] }] },
  { id: 'mouth-width', target: 'morph_mouth_width', pushes: [{ c: [0.025, 1.612, -0.088], s: 0.016, d: [0.008, 0, 0], mirror: true }] },
  { id: 'lip-fullness', target: 'morph_lip_fullness', pushes: [{ c: [0, 1.612, -0.092], s: 0.014, d: [0, 0, -0.006] }] },
  { id: 'ear-size', target: 'morph_ear_size', pushes: [{ c: [0.088, 1.68, 0], s: 0.03, d: [0, 0, 0], scale: 0.3, mirror: true }] },
  { id: 'forehead-height', target: 'morph_forehead_height', pushes: [{ c: [0, 1.76, -0.07], s: 0.04, d: [0, 0.012, -0.003] }] },
  { id: 'temple-width', target: 'morph_temple_width', pushes: [{ c: [0.08, 1.72, -0.02], s: 0.035, d: [0.006, 0, 0], mirror: true }] },
  { id: 'neck-width', target: 'morph_neck_width', pushes: [{ c: [0.045, 1.585, 0.03], s: 0.04, d: [0.004, 0, 0], mirror: true }] },
  { id: 'face-length', target: 'morph_face_length', pushes: [{ c: [0, 1.68, -0.05], s: 0.12, d: [0, 0, 0], scale: 0.0, mirror: false }] },
  { id: 'face-width', target: 'morph_face_width', pushes: [{ c: [0, 1.68, -0.05], s: 0.12, d: [0, 0, 0], scale: 0.0, mirror: false }] },
  { id: 'smile', target: 'morph_smile', pushes: [{ c: [0.032, 1.612, -0.085], s: 0.015, d: [0.004, 0.008, 0], mirror: true }] },
  { id: 'age', target: 'morph_age', pushes: [{ c: [0.04, 1.64, -0.075], s: 0.04, d: [0, -0.004, 0], mirror: true }, { c: [0.03, 1.715, -0.085], s: 0.025, d: [0, -0.005, 0], mirror: true }] },
];

/** The displacement of one morph target at a point, for weight 1. */
export function morphDelta(index: number, p: V3): V3 {
  const t = MORPH_TARGETS[index] as (typeof MORPH_TARGETS)[number];
  let dx = 0, dy = 0, dz = 0;
  if (t.id === 'face-length' || t.id === 'face-width') {
    const g = Math.exp(-(((p[0] - 0) ** 2 + (p[1] - 1.68) ** 2 + (p[2] + 0.05) ** 2) / (2 * 0.12 * 0.12)));
    if (t.id === 'face-length') dy += (p[1] - 1.68) * 0.1 * g;
    else dx += p[0] * 0.08 * g;
    return [dx, dy, dz];
  }
  for (const push of t.pushes) {
    for (const sgn of push.mirror ? [1, -1] : [1]) {
      const c: V3 = [push.c[0] * sgn, push.c[1], push.c[2]];
      const d2 = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      const g = Math.exp(-d2 / (2 * push.s * push.s));
      if (push.scale) {
        dx += (p[0] - c[0]) * push.scale * g;
        dy += (p[1] - c[1]) * push.scale * g;
        dz += (p[2] - c[2]) * push.scale * g;
      }
      dx += push.d[0] * sgn * g;
      dy += push.d[1] * g;
      dz += push.d[2] * g;
    }
  }
  return [dx, dy, dz];
}

/** A copy of a head with the weights of a face preset (or any map of morph ids) applied to the positions. */
export function applyMorphs(head: SkinMesh, weights: Readonly<Record<string, number>>): SkinMesh {
  const out = head.clone();
  out.morphs = new Map();
  MORPH_TARGETS.forEach((t, k) => {
    const w = weights[t.id] ?? 0;
    if (w === 0) return;
    for (let i = 0; i < out.vertexCount; i++) {
      const d = morphDelta(k, [head.pos[i * 3] as number, head.pos[i * 3 + 1] as number, head.pos[i * 3 + 2] as number]);
      out.pos[i * 3] = (out.pos[i * 3] as number) + d[0] * w;
      out.pos[i * 3 + 1] = (out.pos[i * 3 + 1] as number) + d[1] * w;
      out.pos[i * 3 + 2] = (out.pos[i * 3 + 2] as number) + d[2] * w;
    }
  });
  smoothNormals(out);
  return out;
}

// ---- the head ---------------------------------------------------------------------------------------------------------------------

function skull(f: Fidelity, cell: Cell): SkinMesh {
  const lod = LODS[f];
  const ys = steps(CHIN_Y, CROWN_Y, 17, f);
  const rings: Ring[] = ys.map((y) => {
    const [rx, rz, cz] = profileAt(SKULL, sAt(y)) as [number, number, number];
    return { c: [0, y, cz], ru: rx, rv: rz };
  });
  const eyeL: V3 = [E, 1.7, -0.09];
  const eyeR: V3 = [-E, 1.7, -0.09];
  const ao = (i: number, a: number): number => {
    const ring = rings[i] as Ring;
    const turn = a / lod.seg;
    const px = ring.c[0] + Math.cos(turn * Math.PI * 2) * ring.ru;
    const pz = ring.c[2] + Math.sin(turn * Math.PI * 2) * ring.rv;
    const near = (e: V3): number => Math.exp(-(((px - e[0]) ** 2 + (ring.c[1] - e[1]) ** 2 + (pz - e[2]) ** 2) / (2 * 0.02 * 0.02)));
    return 1 - 0.22 * Math.max(near(eyeL), near(eyeR));
  };
  return tube(rings, { seg: lod.seg, cell, part: PERSON_PART.skin, weights: () => headW, ao, capStart: true, capEnd: true, phase: 0 });
}

/** Planar UVs for the eyeballs: the iris disc of the page cell faces front (-Z). */
function eyeBall(cx: number, cy: number, cz: number, r: number, seg: number, cell: Cell): SkinMesh {
  const m = ellipsoid([cx, cy, cz], [r, r, r], seg, Math.max(4, Math.round(seg * 0.7)), { cell, part: PERSON_PART.plain, weights: () => headW });
  const du = (cell.u1 - cell.u0) * 0.92;
  const dv = (cell.v1 - cell.v0) * 0.92;
  const u0 = (cell.u0 + cell.u1) / 2;
  const v0 = (cell.v0 + cell.v1) / 2;
  for (let i = 0; i < m.vertexCount; i++) {
    const x = (m.pos[i * 3] as number) - cx;
    const y = (m.pos[i * 3 + 1] as number) - cy;
    m.uv[i * 2] = u0 + (x / (2 * r)) * du;
    m.uv[i * 2 + 1] = v0 - (y / (2 * r)) * dv;
  }
  return m;
}

/** The face: skull, nose, lips, eyes, brows, ears; one mesh with the skin, lip and eye classes. */
export function buildHeadBase(f: Fidelity, layout: AtlasLayout): SkinMesh {
  const lod = LODS[f];
  const m = new SkinMesh();
  const faceCell = cellOf(layout, 'skin', SKIN_CELL.face);
  const lipCell = cellOf(layout, 'skin', layout === 'pc' ? LIP_CELL : SKIN_CELL.face);
  const eyeCell = cellOf(layout, 'skin', SKIN_CELL.eye);
  m.append(skull(f, faceCell));
  const seg = Math.max(6, Math.round(lod.seg * 0.5));
  // nose: a short sweep along -Z from the bridge to the tip
  const nose: Ring[] = [0, 1, 2, 3].map((i) => ({ c: [0, lerp(1.693, 1.652, i / 3), lerp(-0.087, -0.119, i / 3)] as V3, ru: lerp(0.011, 0.017, Math.sin((i / 3) * 1.4)), rv: lerp(0.018, 0.012, i / 3) }));
  m.append(tube(nose, { seg, frame: FRAME_Z, cell: faceCell, part: PERSON_PART.skin, weights: () => headW, capEnd: true }));
  // lips: a thin sweep along x with a fuller middle
  const lipY = 1.611;
  const lipZ = surfaceZ(lipY) + 0.004;
  const lips: Ring[] = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => ({ c: [k * 0.0075, lipY, lipZ + Math.abs(k) * 0.0014] as V3, ru: 0.0085 - Math.abs(k) * 0.0007, rv: 0.0075 - Math.abs(k) * 0.0006 }));
  m.append(tube(lips, { seg: Math.max(6, Math.round(lod.seg * 0.4)), frame: FRAME_X, cell: lipCell, part: PERSON_PART.lip, weights: () => headW, capStart: true, capEnd: true }));
  // eyes
  const eyeZ = surfaceZ(1.7) + 0.003;
  for (const sd of [1, -1]) m.append(eyeBall(sd * E, 1.7, eyeZ, 0.0125, Math.max(6, Math.round(lod.seg * 0.7)), eyeCell));
  if (lod.detail) {
    // brows: flattened bars over the eyes, hair class
    // the brows ride on the face's own page: the creator's skin page holds a grain cell for them, the ped atlas its short-hair cell
    const hairCell = layout === 'pc' ? cellOf('pc', 'skin', BROW_CELL) : cellOf('ped', 'hair', HAIR_CELL.short);
    for (const sd of [1, -1]) {
      const brow: Ring[] = [0, 1, 2, 3, 4].map((i) => ({ c: [sd * lerp(0.012, 0.058, i / 4), 1.724 + Math.sin((i / 4) * Math.PI) * 0.004 - (i / 4) * 0.004, surfaceZ(1.724) + 0.004] as V3, ru: 0.0055, rv: 0.0045 }));
      m.append(tube(brow, { seg: 5, frame: FRAME_X, cell: hairCell, part: PERSON_PART.hair, weights: () => headW, capStart: true, capEnd: true }));
      // ears
      const ear: Ring[] = steps(1.652, 1.708, 4, f).map((y, i, a) => ({ c: [sd * 0.088, y, 0.004] as V3, ru: 0.0085 * Math.sin(((i + 0.5) / a.length) * Math.PI) + 0.003, rv: 0.016 * Math.sin(((i + 0.5) / a.length) * Math.PI) + 0.005 }));
      m.append(tube(ear, { seg: 6, frame: FRAME_Y, cell: faceCell, part: PERSON_PART.skin, weights: () => headW, capStart: true, capEnd: true }));
    }
  }
  smoothNormals(m);
  return m;
}

/** The face part of the creator: the base head with all 24 morph targets (position deltas at weight 1) and the preset's weights as defaults. */
export function buildFace(face: FaceSpec | null, f: Fidelity, layout: AtlasLayout, withTargets: boolean): SkinMesh {
  const base = buildHeadBase(f, layout);
  if (!withTargets) return face ? applyMorphs(base, face.morphs) : base;
  const out = face ? applyMorphs(base, face.morphs) : base.clone();
  out.morphs = new Map();
  // the targets are deltas from the preset's rest shape, computed on the base positions
  MORPH_TARGETS.forEach((t, k) => {
    const delta: number[] = [];
    for (let i = 0; i < base.vertexCount; i++) delta.push(...morphDelta(k, [base.pos[i * 3] as number, base.pos[i * 3 + 1] as number, base.pos[i * 3 + 2] as number]));
    out.morphs.set(t.target, delta);
  });
  return out;
}

// ---- hair -------------------------------------------------------------------------------------------------------------------------

/** The shell of a hair style over the skull: an ellipsoid cut along the hairline, with waves, a lifted crown and the tails. */
export function buildHair(h: HairSpec, f: Fidelity, layout: AtlasLayout): SkinMesh {
  const lod = LODS[f];
  const cellKind = h.id === 'hair-curls' || h.id === 'hair-afro' || h.id === 'hair-shag' ? HAIR_CELL.curly : h.id === 'hair-coils' || h.id === 'hair-locs' || h.id === 'hair-braids' ? HAIR_CELL.coil : h.id === 'hair-buzz' || h.id === 'hair-crop' || h.id === 'hair-fade' ? HAIR_CELL.short : HAIR_CELL.straight;
  const cell = cellOf(layout, 'hair', cellKind);
  const part = h.kind === 'bald' ? PERSON_PART.skin : PERSON_PART.hair;
  const m = new SkinMesh();
  const s = h.scale;
  const rings = f === 'hi' ? 30 : f === 'mid' ? 20 : 12;
  const seg = Math.max(8, lod.seg + 2);
  // the shell is the skull's own profile grown by the style's scale and a thickness, so it never sinks into the head
  const ringList: Ring[] = Array.from({ length: rings }, (_, i) => {
    const t = i / (rings - 1);
    const [rx, rz, cz] = profileAt(SKULL, t) as [number, number, number];
    const yBase = lerp(CHIN_Y, CROWN_Y, t) + h.top * t * t * t;
    const sy = h.kind === 'afro' ? 1.3 : 1 + (s - 1) * 0.5;
    const y = HEAD_C[1] + (yBase - HEAD_C[1]) * sy;
    return { c: [0, y, cz * s], ru: Math.max(1e-4, rx * s + 0.004), rv: Math.max(1e-4, rz * s + 0.004) };
  });
  const shell = tube(ringList, { seg, cell, part, weights: () => headW, capStart: true, capEnd: true });
  const cutAt = (x: number, y: number, z: number): number => {
    if (h.kind === 'bald') return -1;
    const ang = Math.atan2(z - 0.004, x);
    const back = Math.max(0, Math.sin(ang));
    const front = Math.max(0, -Math.sin(ang));
    const side = 1 - Math.abs(Math.sin(ang));
    const base = h.sideY * side + h.backY * back + h.frontY * front;
    const norm = side + back + front;
    return base / (norm || 1) - (y > 0 ? 0 : 0);
  };
  const ripple = h.ripple;
  const deformed = shell.mapped((p) => {
    if (!ripple) return p;
    const ang = Math.atan2(p[2], p[0]);
    const k = ripple.amp * Math.sin(ripple.freq * p[1] * 6 + ang * 5) + ripple.amp * 0.5 * Math.sin(ripple.freq * 9 * p[1] - ang * 3);
    const dx = p[0] - HEAD_C[0], dz = p[2] - HEAD_C[2], dy = p[1] - HEAD_C[1];
    const l = Math.hypot(dx, dy, dz) || 1;
    return [p[0] + (dx / l) * k, p[1] + (dy / l) * k, p[2] + (dz / l) * k];
  });
  const keep = h.kind === 'bald'
    ? (): boolean => true
    : (i: number): boolean => (deformed.pos[i * 3 + 1] as number) >= cutAt(deformed.pos[i * 3] as number, deformed.pos[i * 3 + 1] as number, deformed.pos[i * 3 + 2] as number);
  const cap = deformed.filtered(keep);
  m.append(cap);
  if (h.pomp) {
    const pomp = ellipsoid([0, 1.8, -0.045], [0.055, 0.035 + h.pomp, 0.06], Math.max(6, lod.seg - 2), 6, { cell, part, weights: () => headW });
    m.append(pomp);
  }
  if (h.bun) m.append(ellipsoid([0, h.bun.y, 0.07], [h.bun.r, h.bun.r * 0.9, h.bun.r], Math.max(6, lod.seg - 4), 6, { cell, part, weights: () => headW }));
  if (h.tail) {
    const t = h.tail;
    if (t.kind === 'curtain') {
      const ys = steps(1.725, t.endY, 6, f);
      const ring: Ring[] = ys.map((y, i) => {
        const [rx, rz] = profileAt(SKULL, Math.min(1, Math.max(0, sAt(Math.max(y, CHIN_Y + 0.03))))) as [number, number];
        const flare = 1 + (i / (ys.length - 1)) * 0.1;
        return { c: [0, y, 0.004], ru: Math.max(rx, 0.075) * s * flare + 0.006, rv: Math.max(rz, 0.085) * s * flare + 0.006 };
      });
      m.append(tube(ring, { seg: lod.seg, cell, part, weights: (_, r) => (r.c[1] < 1.62 ? [[5, 0.4], [4, 0.6]] : headW), arc: [0.02, 0.48] }));
    } else if (t.kind === 'pony') {
      const path: Ring[] = [0, 1, 2, 3, 4].map((i) => ({ c: [0, lerp(1.76, t.endY, i / 4), lerp(0.075, 0.12 + 0.03 * Math.sin((i / 4) * 3), i / 4)] as V3, ru: t.r * (1 - 0.3 * (i / 4)) + 0.004, rv: t.r * (1 - 0.3 * (i / 4)) + 0.004 }));
      m.append(tube(path, { seg: 7, cell, part, weights: () => headW, capEnd: true }));
    } else {
      const n = Math.max(3, Math.round(t.count * (f === 'hi' ? 1 : f === 'mid' ? 0.6 : 0.34)));
      for (let k = 0; k < n; k++) {
        const ang = Math.PI * (0.1 + 0.8 * (k / Math.max(1, n - 1)));
        const x = Math.cos(ang) * 0.088 * s;
        const z = 0.012 + Math.sin(ang) * 0.094 * s;
        const y0 = 1.74 - Math.abs(Math.cos(ang)) * 0.06;
        const wob = hash01(k, 7) * 0.02;
        const strand: Ring[] = [0, 1, 2, 3].map((i) => ({ c: [x * (1 + i * 0.03) + wob * (i / 3), lerp(y0, t.endY - hash01(k, 3) * 0.05, i / 3), z + i * 0.004] as V3, ru: t.r, rv: t.r }));
        m.append(tube(strand, { seg: 5, cell, part, weights: () => headW, capEnd: true }));
      }
    }
  }
  smoothNormals(m);
  return m;
}

export { HAIR_CELL };

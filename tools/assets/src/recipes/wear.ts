/**
 * The people recipes of M10d4, part 3: clothes as shells by body region (tops, bottoms, shoes) and bone-attached accessories. A shell
 * follows the reference figure's profile (`people.ts`) grown by the garment's ease and copies the skin weights of the body at the same
 * height, so it bends with the same bones; an accessory is rigid on one bone. No garment carries text, a logo or a mark: the only
 * surface detail is a weave in the cloth atlas.
 */
import { boneIndex, type Bone, type V3 } from './rig.ts';
import {
  armRadii, armWeights, ARM_X, cellOf, footRings, footWeights, LEG_X, legRadii, legWeights, LODS, steps, torsoRadii, torsoWeights,
  type AccessorySpec, type AtlasLayout, type BottomSpec, type Fidelity, type ShoesSpec, type TopSpec,
} from './people.ts';
import {
  ellipsoid, FRAME_X, FRAME_Y, FRAME_Z, lerp, rigid, SkinMesh, smoothNormals, tube, PERSON_PART,
  type Ring,
} from './skin-mesh.ts';
import { HEAD_C, HEAD_R } from './head.ts';

const MARGIN = 0.009;

const hemShade = (n: number) => (i: number): number => (i === 0 || i === n - 1 ? 0.82 : 1);

/** A top: the trunk shell, the sleeves, the collar and the hood. */
export function buildTop(t: TopSpec, f: Fidelity, layout: AtlasLayout): SkinMesh {
  const lod = LODS[f];
  const cell = cellOf(layout, 'cloth', t.cell);
  const m = new SkinMesh();
  const ys = steps(t.hemY, 1.455, 11, f);
  const rings: Ring[] = ys.map((y) => {
    const r = torsoRadii(y, null);
    const flare = 1 + t.flare * Math.max(0, 1 - (y - t.hemY) / 0.25);
    const neckCut = y > 1.43 ? lerp(1, t.neck, (y - 1.43) / 0.03) : 1;
    return { c: [0, y, 0], ru: Math.max(0.058, (r.rx * (1 + t.ease) + MARGIN) * flare * neckCut), rv: Math.max(0.056, (r.rz * (1 + t.ease) + MARGIN) * flare * neckCut) };
  });
  m.append(tube(rings, { seg: lod.seg, cell, part: PERSON_PART.cloth, weights: (_, r) => torsoWeights(r.c[1]), ao: hemShade(rings.length), capStart: false }));
  if (t.hemband) {
    const band = steps(t.hemY, t.hemY + 0.07, 3, f).map((y) => {
      const r = torsoRadii(y, null);
      return { c: [0, y, 0] as V3, ru: (r.rx * (1 + t.ease) + MARGIN) * 1.02 + 0.004, rv: (r.rz * (1 + t.ease) + MARGIN) * 1.02 + 0.004 };
    });
    m.append(tube(band, { seg: lod.seg, cell: cellOf(layout, 'cloth', 2), part: PERSON_PART.cloth2, weights: (_, r) => torsoWeights(r.c[1]) }));
  }
  if (t.sleeve !== 'none') {
    const top = 1.455;
    const bottom = t.cuffY;
    for (const [sd, name] of [[1, 'l'], [-1, 'r']] as [1 | -1, 'l' | 'r'][]) {
      const ysA = steps(top - 0.012, bottom, 8, f);
      const sleeve: Ring[] = ysA.map((y, i) => {
        const a = armRadii(Math.min(y, 1.43), null);
        const loose = 1 + t.ease * 0.9;
        // the first ring closes the shoulder as a dome instead of a flat cap
        const dome = i === 0 ? 0.55 : i === 1 && f !== 'lo' ? 0.92 : 1;
        return { c: [sd * ARM_X, y + (i === 0 ? 0.012 : 0), 0], ru: (a.ru * loose + MARGIN) * dome, rv: (a.rv * loose + MARGIN) * dome };
      });
      m.append(tube(sleeve, { seg: Math.max(6, Math.round(lod.seg * 0.7)), cell, part: PERSON_PART.cloth, weights: (_, r) => armWeights(name, r.c[1]), ao: hemShade(sleeve.length), capStart: true }));
      if (t.hemband && t.sleeve === 'long') {
        const cuff = steps(bottom, bottom + 0.05, 2, f).map((y) => {
          const a = armRadii(y, null);
          return { c: [sd * ARM_X, y, 0] as V3, ru: a.ru * (1 + t.ease * 0.5) + MARGIN + 0.003, rv: a.rv * (1 + t.ease * 0.5) + MARGIN + 0.003 };
        });
        m.append(tube(cuff, { seg: Math.max(6, Math.round(lod.seg * 0.7)), cell: cellOf(layout, 'cloth', 2), part: PERSON_PART.cloth2, weights: (_, r) => armWeights(name, r.c[1]) }));
      }
    }
  }
  if (t.collar > 0) {
    const collar = steps(1.47, 1.47 + 0.035 * t.collar + 0.02, 3, f).map((y, i) => ({ c: [0, y, -0.004] as V3, ru: 0.064 + i * 0.002, rv: 0.066 + i * 0.002 }));
    m.append(tube(collar, { seg: lod.seg, cell, part: PERSON_PART.cloth, weights: () => rigid('neck'), capStart: false }));
  }
  if (t.hood) {
    // a soft hood draped behind the neck: a flattened ellipsoid on the upper chest bone
    m.append(ellipsoid([0, 1.5, 0.06], [0.09, 0.075, 0.06], Math.max(6, lod.seg - 4), Math.max(4, Math.round(7 * lod.rings)), { cell, part: PERSON_PART.cloth, weights: () => rigid('upperChest') }));
  }
  smoothNormals(m);
  return m;
}

/** A bottom: pants, shorts, a skirt or overalls. */
export function buildBottom(b: BottomSpec, f: Fidelity, layout: AtlasLayout): SkinMesh {
  const lod = LODS[f];
  const cell = cellOf(layout, 'cloth', b.cell);
  const m = new SkinMesh();
  // waistband: the trunk from the hip to just above the waist
  const bandYs = steps(b.kind === 'skirt' ? 0.86 : 0.78, 1.1, 5, f);
  const band: Ring[] = bandYs.map((y) => {
    const r = torsoRadii(y, null);
    return { c: [0, y, 0], ru: r.rx * (1 + b.ease) + MARGIN, rv: r.rz * (1 + b.ease) + MARGIN };
  });
  if (b.kind !== 'skirt') m.append(tube(band, { seg: lod.seg, cell, part: PERSON_PART.cloth, weights: (_, r) => torsoWeights(r.c[1]), ao: hemShade(band.length), capStart: true }));
  if (b.kind === 'skirt') {
    const ys = steps(1.1, b.hemY, 7, f);
    const skirt: Ring[] = ys.map((y) => {
      const t = (1.1 - y) / (1.1 - b.hemY);
      const r = torsoRadii(Math.max(0.9, y), null);
      const grow = 1 + b.flare * t * t;
      return { c: [0, y, 0.004], ru: (r.rx * (1 + b.ease) + MARGIN) * grow + 0.03 * t, rv: (r.rz * (1 + b.ease) + MARGIN) * grow + 0.03 * t };
    });
    m.append(tube(skirt, { seg: lod.seg + 2, cell, part: PERSON_PART.cloth, weights: (_, r) => (r.c[1] > 0.92 ? torsoWeights(r.c[1]) : legWeights('l', Math.max(r.c[1], 0.92)).map(([bone, w]) => [bone, w * 0.5] as [number, number]).concat(legWeights('r', Math.max(r.c[1], 0.92)).map(([bone, w]) => [bone, w * 0.5] as [number, number]))), ao: hemShade(skirt.length) }));
  } else {
    for (const [sd, name] of [[1, 'l'], [-1, 'r']] as [1 | -1, 'l' | 'r'][]) {
      const ys = steps(0.97, b.hemY, 9, f);
      const leg: Ring[] = ys.map((y) => {
        const r = legRadii(y, null);
        const flare = 1 + b.flare * Math.max(0, 1 - (y - b.hemY) / 0.2);
        return { c: [sd * LEG_X, y, y < 0.5 ? 0.004 : 0], ru: (r.ru * (1 + b.ease) + MARGIN) * flare, rv: (r.rv * (1 + b.ease) + MARGIN) * flare };
      });
      m.append(tube(leg, { seg: Math.max(7, Math.round(lod.seg * 0.8)), cell, part: PERSON_PART.cloth, weights: (_, r) => legWeights(name, r.c[1]), ao: hemShade(leg.length), capStart: true }));
    }
  }
  if (b.kind === 'overalls') {
    const ys = steps(1.1, 1.36, 4, f);
    const bib: Ring[] = ys.map((y) => {
      const r = torsoRadii(y, null);
      return { c: [0, y, -0.003], ru: 0.085 + (y - 1.1) * 0.05, rv: r.rz * 1.2 + MARGIN };
    });
    m.append(tube(bib, { seg: 4, phase: Math.PI / 4, cell: cellOf(layout, 'cloth', 2), part: PERSON_PART.cloth2, weights: (_, r) => torsoWeights(r.c[1]), arc: [0.54, 0.96] }));
    for (const sd of [1, -1]) {
      const strap = steps(1.36, 1.47, 3, f).map((y, i, a) => ({ c: [sd * lerp(0.06, 0.11, i / (a.length - 1)), y, lerp(-0.07, 0.0, i / (a.length - 1))] as V3, ru: 0.012, rv: 0.006 }));
      m.append(tube(strap, { seg: 5, cell: cellOf(layout, 'cloth', 2), part: PERSON_PART.cloth2, weights: (_, r) => torsoWeights(r.c[1]), capEnd: true }));
    }
  }
  smoothNormals(m);
  return m;
}

/** Shoes: a shell over the foot with a sole, a shaft for boots, straps for sandals. */
export function buildShoes(s: ShoesSpec, f: Fidelity, layout: AtlasLayout): SkinMesh {
  const lod = LODS[f];
  const cell = cellOf(layout, 'cloth', s.cell);
  const soleCell = cellOf(layout, 'cloth', 5);
  const m = new SkinMesh();
  for (const [sd, name] of [[1, 'l'], [-1, 'r']] as [1 | -1, 'l' | 'r'][]) {
    const segs = Math.max(6, Math.round(lod.seg * 0.7));
    if (!s.open) {
      const upper = footRings(sd, 0.007 + s.bulk * 0.01, s.sole * 0.6, s.bulk * 0.04);
      m.append(tube(upper, { seg: segs, frame: FRAME_Z, cell, part: PERSON_PART.cloth, weights: (_, r) => footWeights(name, r.c[2], r.c[1]), capStart: true, capEnd: true }));
    } else {
      // a flat footbed and two straps
      const bed = footRings(sd, 0.004, s.sole * 0.4, 0).map((r) => ({ ...r, rv: Math.min(r.rv, 0.012) }));
      m.append(tube(bed, { seg: segs, frame: FRAME_Z, cell, part: PERSON_PART.cloth, weights: (_, r) => footWeights(name, r.c[2], r.c[1]), capStart: true, capEnd: true }));
      for (const z of [-0.02, -0.09]) {
        const strap = [0, 1, 2, 3, 4].map((i) => ({ c: [sd * LEG_X, 0.036 + Math.sin((i / 4) * Math.PI) * 0.03, z] as V3, ru: lerp(0.032, 0.032, 0), rv: 0.006 }));
        m.append(tube(strap, { seg: 6, frame: FRAME_Z, cell, part: PERSON_PART.cloth2, weights: (_, r) => footWeights(name, r.c[2], r.c[1]), capStart: false, capEnd: false }));
      }
    }
    // sole: a slightly longer, flatter band under the foot
    const sole = footRings(sd, 0.011 + s.bulk * 0.01, 0, s.bulk * 0.05).map((r, i, a) => ({ c: [r.c[0], 0.018 + s.sole * 0.35 - i * 0.002, r.c[2]] as V3, ru: r.ru, rv: Math.max(0.01, s.sole * 0.5 + 0.008 - (i === a.length - 1 ? 0.004 : 0)) }));
    m.append(tube(sole, { seg: segs, frame: FRAME_Z, cell: soleCell, part: PERSON_PART.plain, weights: (_, r) => footWeights(name, r.c[2], 0.04), capStart: true, capEnd: true }));
    if (s.shaft > 0) {
      const ys = steps(0.07, 0.07 + s.shaft, 4, f);
      const shaft: Ring[] = ys.map((y) => {
        const r = legRadii(y, null);
        return { c: [sd * LEG_X, y, 0.004], ru: r.ru + 0.012, rv: r.rv + 0.012 };
      });
      m.append(tube(shaft, { seg: Math.max(7, Math.round(lod.seg * 0.8)), cell, part: PERSON_PART.cloth, weights: (_, r) => legWeights(name, r.c[1]), ao: hemShade(shaft.length), capEnd: false }));
    } else {
      const ys = steps(0.07, 0.1, 2, f);
      const collar: Ring[] = ys.map((y) => {
        const r = legRadii(y, null);
        return { c: [sd * LEG_X, y, 0.004], ru: r.ru + 0.008, rv: r.rv + 0.008 };
      });
      m.append(tube(collar, { seg: Math.max(7, Math.round(lod.seg * 0.8)), cell, part: PERSON_PART.cloth, weights: (_, r) => legWeights(name, r.c[1]), capEnd: false }));
    }
  }
  smoothNormals(m);
  return m;
}

/** An accessory, rigid on one bone. */
export function buildAccessory(a: AccessorySpec, f: Fidelity, layout: AtlasLayout): SkinMesh {
  const lod = LODS[f];
  const cell = cellOf(layout, 'cloth', a.cell);
  const m = new SkinMesh();
  const seg = Math.max(6, lod.seg - 2);
  const head = rigid('head');
  switch (a.kind) {
    case 'cap': {
      const dome = ellipsoid([HEAD_C[0], HEAD_C[1] + 0.012, HEAD_C[2] + 0.004], [HEAD_R[0] * 1.07, HEAD_R[1] * 1.04, HEAD_R[2] * 1.07], seg, 8, { cell, part: PERSON_PART.cloth, weights: () => head });
      m.append(dome.filtered((i) => (dome.pos[i * 3 + 1] as number) > 1.725));
      const brim: Ring[] = [0, 1, 2, 3].map((i) => ({ c: [0, 1.738 - i * 0.003, -0.085 - i * 0.03] as V3, ru: 0.07 - i * 0.008, rv: 0.004 }));
      m.append(tube(brim, { seg: 8, frame: FRAME_Z, cell: cellOf(layout, 'cloth', 2), part: PERSON_PART.cloth2, weights: () => head, capEnd: true }));
      break;
    }
    case 'beanie': {
      const dome = ellipsoid([HEAD_C[0], HEAD_C[1] + 0.02, HEAD_C[2]], [HEAD_R[0] * 1.1, HEAD_R[1] * 1.08, HEAD_R[2] * 1.1], seg, 8, { cell, part: PERSON_PART.cloth, weights: () => head });
      m.append(dome.filtered((i) => (dome.pos[i * 3 + 1] as number) > 1.71));
      const cuff = steps(1.7, 1.73, 2, f).map((y) => ({ c: [0, y, 0.002] as V3, ru: 0.098, rv: 0.109 }));
      m.append(tube(cuff, { seg, cell: cellOf(layout, 'cloth', 2), part: PERSON_PART.cloth2, weights: () => head }));
      break;
    }
    case 'shades': {
      for (const sd of [1, -1]) {
        const lens: Ring[] = [0, 1, 2].map((i) => ({ c: [sd * 0.034, 1.7, -0.098 - i * 0.003] as V3, ru: 0.019 - i * 0.002, rv: 0.014 - i * 0.002 }));
        m.append(tube(lens, { seg: 8, frame: FRAME_Z, cell: cellOf(layout, 'cloth', 5), part: PERSON_PART.plain, weights: () => head, capStart: true, capEnd: true }));
        const arm: Ring[] = [0, 1, 2].map((i) => ({ c: [sd * lerp(0.053, 0.088, i / 2), 1.708, lerp(-0.082, 0.0, i / 2)] as V3, ru: 0.003, rv: 0.003 }));
        m.append(tube(arm, { seg: 4, frame: FRAME_Y, cell: cellOf(layout, 'cloth', 5), part: PERSON_PART.plain, weights: () => head }));
      }
      const bridge: Ring[] = [-1, 0, 1].map((k) => ({ c: [k * 0.012, 1.708, -0.099] as V3, ru: 0.004, rv: 0.003 }));
      m.append(tube(bridge, { seg: 4, frame: FRAME_X, cell: cellOf(layout, 'cloth', 5), part: PERSON_PART.plain, weights: () => head }));
      break;
    }
    case 'chain': {
      const band = steps(1.395, 1.425, 2, f).map((y) => ({ c: [0, y, -0.012] as V3, ru: 0.098, rv: 0.083 }));
      m.append(tube(band, { seg: lod.seg + 4, cell: cellOf(layout, 'cloth', 6), part: PERSON_PART.plain, weights: () => rigid('upperChest') }));
      const drop: Ring[] = [0, 1, 2].map((i) => ({ c: [0, 1.39 - i * 0.04, -0.092] as V3, ru: 0.006, rv: 0.003 }));
      m.append(tube(drop, { seg: 4, cell: cellOf(layout, 'cloth', 6), part: PERSON_PART.plain, weights: () => rigid('upperChest'), capEnd: true }));
      break;
    }
    case 'watch': {
      const band = steps(0.95, 0.985, 2, f).map((y) => ({ c: [ARM_X, y, 0] as V3, ru: 0.031, rv: 0.031 }));
      m.append(tube(band, { seg: lod.seg - 2, cell: cellOf(layout, 'cloth', 4), part: PERSON_PART.cloth2, weights: () => rigid('l_lowerArm') }));
      const face: Ring[] = [0, 1].map((i) => ({ c: [ARM_X, 0.965, -0.03 - i * 0.004] as V3, ru: 0.016, rv: 0.016 }));
      m.append(tube(face, { seg: 8, frame: FRAME_Z, cell: cellOf(layout, 'cloth', 5), part: PERSON_PART.plain, weights: () => rigid('l_lowerArm'), capStart: true, capEnd: true }));
      break;
    }
    case 'backpack': {
      const body: Ring[] = steps(1.2, 1.48, 4, f).map((y) => ({ c: [0, y, 0.135] as V3, ru: 0.12, rv: 0.05 }));
      m.append(tube(body, { seg: 4, phase: Math.PI / 4, cell, part: PERSON_PART.cloth, weights: () => rigid('upperChest'), capStart: true, capEnd: true }));
      for (const sd of [1, -1]) {
        // over the shoulder: from the pack's top, forward over the chest, down to the pack's side
        const path: V3[] = [[0.07, 1.47, 0.1], [0.085, 1.46, 0.0], [0.09, 1.38, -0.085], [0.095, 1.28, -0.09], [0.1, 1.2, 0.0]];
        const strap: Ring[] = path.map((p) => ({ c: [sd * p[0], p[1], p[2]] as V3, ru: 0.014, rv: 0.007 }));
        m.append(tube(strap, { seg: 5, cell: cellOf(layout, 'cloth', 2), part: PERSON_PART.cloth2, weights: () => rigid('upperChest') }));
      }
      break;
    }
    case 'scarf': {
      const wrap = steps(1.465, 1.53, 3, f).map((y, i) => ({ c: [0, y, -0.004] as V3, ru: 0.074 - i * 0.004, rv: 0.078 - i * 0.004 }));
      m.append(tube(wrap, { seg: lod.seg, cell, part: PERSON_PART.cloth, weights: () => rigid('neck'), capStart: false }));
      const tail = steps(1.47, 1.2, 5, f).map((y) => ({ c: [0.02, y, -0.098] as V3, ru: 0.03, rv: 0.008 }));
      m.append(tube(tail, { seg: 6, cell: cellOf(layout, 'cloth', 2), part: PERSON_PART.cloth2, weights: () => rigid('upperChest'), capEnd: true }));
      break;
    }
    case 'headphones': {
      const band = ellipsoid([HEAD_C[0], HEAD_C[1] + 0.004, HEAD_C[2] + 0.004], [HEAD_R[0] * 1.1, HEAD_R[1] * 1.08, HEAD_R[2] * 1.1], seg + 6, 10, { cell: cellOf(layout, 'cloth', 5), part: PERSON_PART.plain, weights: () => head });
      m.append(band.filtered((i) => Math.abs(band.pos[i * 3 + 2] as number) < 0.012 && (band.pos[i * 3 + 1] as number) > 1.69));
      for (const sd of [1, -1]) m.append(ellipsoid([sd * 0.099, 1.68, 0.004], [0.02, 0.038, 0.032], 8, 6, { cell, part: PERSON_PART.cloth, weights: () => head }));
      break;
    }
  }
  smoothNormals(m);
  return m;
}

export { boneIndex };
export type { Bone };
export { FRAME_Y as _FRAME_Y };

/**
 * The people recipes of M10d4, part 1: the data model of `content/art/people.json`, the level-of-detail table and the bare body (skin of
 * the trunk, neck, arms, hands, legs and feet) on the `bay_rig_v1` skeleton. Heads and hair are in `head.ts`, clothes in `wear.ts`.
 *
 * The bodies differ in proportion by a few per cent around one reference figure, and a body's stature is its root scale (`heightM / 1.8`),
 * so every garment authored for the reference fits every body: the shells carry an ease of at least 12 % and the body multipliers
 * stay within 0.9 to 1.08 (BD-M10d4-02). Everything is a pure function of the recipe data.
 */
import { boneIndex, REST, type Bone, type V3 } from './rig.ts';
import {
  chainWeights, FRAME_Z, lerp, profileAt, rigid, SkinMesh, smoothNormals, tube, PERSON_PART,
  type Cell, type Ring, type W,
} from './skin-mesh.ts';

export type Fidelity = 'hi' | 'mid' | 'lo';
export const FIDELITIES: readonly Fidelity[] = ['hi', 'mid', 'lo'];
/** The C07 variant id of each fidelity. */
export const VARIANT_OF: Readonly<Record<Fidelity, 'desktop' | 'mobile' | 'mobile-low'>> = { hi: 'desktop', mid: 'mobile', lo: 'mobile-low' };

export interface Lod {
  /** Columns round a ring. */
  seg: number;
  /** Factor on the number of rings of a sweep. */
  rings: number;
  /** Extra detail (ears, brows, thumbs, soles' welt). */
  detail: boolean;
}

export const LODS: Readonly<Record<Fidelity, Lod>> = {
  hi: { seg: 18, rings: 1, detail: true },
  mid: { seg: 11, rings: 0.62, detail: true },
  lo: { seg: 6, rings: 0.38, detail: false },
};

// ---- data ------------------------------------------------------------------------------------------------------------------------

export interface BodySpec {
  id: string;
  /** Stature in metres (1.55 .. 1.95). */
  heightM: number;
  /** Multipliers around the reference figure, each in 0.9 .. 1.08 (the belly and bust are metres of extra depth). */
  shoulder: number;
  chest: number;
  waist: number;
  hips: number;
  thigh: number;
  arm: number;
  neck: number;
  depth: number;
  belly: number;
  bust: number;
}

export interface FaceSpec { id: string; morphs: Record<string, number> }

export interface HairSpec {
  id: string;
  kind: 'cap' | 'afro' | 'bald';
  /** Radial scale of the shell around the skull. */
  scale: number;
  /** Extra lift of the crown, metres. */
  top: number;
  /** Lowest y of the shell at the back, the sides and the hairline in front. */
  backY: number;
  sideY: number;
  frontY: number;
  /** Surface waves: amplitude in metres and frequency. */
  ripple?: { amp: number; freq: number };
  tail?: { kind: 'pony' | 'locs' | 'braids' | 'curtain'; count: number; endY: number; r: number };
  bun?: { r: number; y: number };
  pomp?: number;
}

export interface TopSpec {
  id: string;
  hemY: number;
  ease: number;
  sleeve: 'long' | 'short' | 'none';
  cuffY: number;
  hood: boolean;
  collar: number;
  hemband: boolean;
  flare: number;
  /** Atlas cell of the cloth page. */
  cell: number;
  neck: number;
}

export interface BottomSpec {
  id: string;
  kind: 'pants' | 'shorts' | 'skirt' | 'overalls';
  hemY: number;
  ease: number;
  flare: number;
  cell: number;
}

export interface ShoesSpec {
  id: string;
  /** Height of the shaft above the ankle (0 = low shoe), metres. */
  shaft: number;
  /** Extra length and width of the shell. */
  bulk: number;
  sole: number;
  open: boolean;
  cell: number;
}

export interface AccessorySpec { id: string; kind: 'cap' | 'beanie' | 'shades' | 'chain' | 'watch' | 'backpack' | 'scarf' | 'headphones'; cell: number }

export interface OutfitSpec { n: number; top: string; bottom: string; shoes: string; accessory: string | null }

export interface PedBodySpec { id: string; body: string; face: string; hair: string; far: { w: number; h: number } }

export interface PeopleData {
  schema: 'art-people/1';
  bodies: BodySpec[];
  pedBodies: PedBodySpec[];
  pedBodySpecs: BodySpec[];
  faces: FaceSpec[];
  hairs: HairSpec[];
  tops: TopSpec[];
  bottoms: BottomSpec[];
  shoes: ShoesSpec[];
  accessories: AccessorySpec[];
  outfits: OutfitSpec[];
}

// ---- cells of the atlas pages ----------------------------------------------------------------------------------------------------

export type AtlasLayout = 'pc' | 'ped';
export type Pool = 'skin' | 'cloth' | 'hair';

/** The cell of a pool on the page of a layout: the creator pages are 4x4 each; the ped atlas holds skin 0..3, cloth 4..11, hair 12..15. */
export function cellOf(layout: AtlasLayout, pool: Pool, i: number): Cell {
  const slot = layout === 'pc' ? i : pool === 'skin' ? i : pool === 'cloth' ? 4 + i : 12 + i;
  const col = slot % 4;
  const row = Math.floor(slot / 4);
  return { u0: col / 4, v0: row / 4, u1: (col + 1) / 4, v1: (row + 1) / 4 };
}

export const SKIN_CELL = { body: 0, face: 1, hands: 2, eye: 3 } as const;
/** Lips take the skin page's cell 3 neighbour in the ped atlas; the creator page has its own spare cell. */
export const LIP_CELL = 4;
export const HAIR_CELL = { straight: 0, curly: 1, coil: 2, short: 3 } as const;

// ---- shared geometry helpers -------------------------------------------------------------------------------------------------------

/** `n` evenly spaced values from a to b (inclusive), n scaled by the fidelity (never fewer than 2). */
export function steps(a: number, b: number, base: number, f: Fidelity): number[] {
  const n = Math.max(2, Math.round(base * LODS[f].rings));
  return Array.from({ length: n }, (_, i) => lerp(a, b, i / (n - 1)));
}

/** Torso half-widths and half-depths of the reference figure by height: [y, rx, rz]. */
export const TORSO_PROFILE: readonly (readonly number[])[] = [
  [0.84, 0.140, 0.092],
  [0.90, 0.152, 0.096],
  [0.97, 0.158, 0.098],
  [1.05, 0.146, 0.093],
  [1.12, 0.136, 0.088],
  [1.20, 0.148, 0.096],
  [1.29, 0.162, 0.104],
  [1.37, 0.170, 0.098],
  [1.42, 0.158, 0.086],
  [1.46, 0.110, 0.070],
  [1.49, 0.060, 0.058],
];

/** Ramps and bones of the trunk chain. */
export const TORSO_CHAIN: readonly Bone[] = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'];
export const TORSO_RAMPS: readonly (readonly [number, number])[] = [[0.92, 0.99], [1.0, 1.1], [1.12, 1.25], [1.28, 1.38], [1.5, 1.58]];

export const torsoWeights = (y: number): W => chainWeights(y, TORSO_CHAIN, TORSO_RAMPS);

/** Radii of the trunk at height y for a body (the reference figure when `spec` is null), before any garment ease. */
export function torsoRadii(y: number, spec: BodySpec | null): { rx: number; rz: number; cz: number } {
  const [rx0, rz0] = profileAt(TORSO_PROFILE, y) as [number, number];
  if (!spec) return { rx: rx0, rz: rz0, cz: 0 };
  // blend the multipliers by region: hips below 1.0, waist 1.0 .. 1.15, chest and shoulders above
  const lowT = Math.min(1, Math.max(0, (1.12 - y) / 0.2));
  const highT = Math.min(1, Math.max(0, (y - 1.12) / 0.22));
  const mx = lowT * spec.hips + (1 - lowT) * (1 - highT) * spec.waist + highT * (y > 1.33 ? spec.shoulder : spec.chest);
  const mz = spec.depth;
  const bellyZ = spec.belly * 0.04 * Math.max(0, 1 - Math.abs(y - 1.08) / 0.16);
  const bustZ = spec.bust * 0.05 * Math.max(0, 1 - Math.abs(y - 1.28) / 0.1);
  return { rx: rx0 * mx, rz: rz0 * mz + (bellyZ + bustZ) / 2, cz: -(bellyZ + bustZ) / 2 };
}

export function legRadii(y: number, spec: BodySpec | null): { ru: number; rv: number } {
  const [ru, rv] = profileAt(
    [[0.07, 0.030, 0.034], [0.16, 0.034, 0.036], [0.30, 0.047, 0.050], [0.42, 0.054, 0.057], [0.50, 0.056, 0.060], [0.62, 0.067, 0.072], [0.78, 0.080, 0.086], [0.90, 0.088, 0.092], [0.96, 0.086, 0.090]],
    y,
  ) as [number, number];
  const m = y > 0.5 ? (spec?.thigh ?? 1) : 1 + ((spec?.thigh ?? 1) - 1) * 0.5;
  return { ru: ru * m, rv: rv * m };
}

export function armRadii(y: number, spec: BodySpec | null): { ru: number; rv: number } {
  const [ru, rv] = profileAt(
    [[0.80, 0.024, 0.014], [0.86, 0.030, 0.019], [0.93, 0.028, 0.028], [1.05, 0.034, 0.036], [1.16, 0.039, 0.040], [1.28, 0.046, 0.046], [1.38, 0.050, 0.050], [1.43, 0.045, 0.046]],
    y,
  ) as [number, number];
  const m = spec?.arm ?? 1;
  return { ru: ru * m, rv: rv * m };
}

export const ARM_X = 0.19;
export const LEG_X = 0.09;

export function legWeights(side: 'l' | 'r', y: number): W {
  return chainWeights(y, [`${side}_foot`, `${side}_lowerLeg`, `${side}_upperLeg`, 'hips'] as Bone[], [[0.06, 0.14], [0.44, 0.54], [0.9, 1.0]]);
}

export function armWeights(side: 'l' | 'r', y: number): W {
  return chainWeights(y, [`${side}_hand`, `${side}_lowerArm`, `${side}_upperArm`, `${side}_shoulder`] as Bone[], [[0.87, 0.97], [1.1, 1.22], [1.38, 1.46]]);
}

/** Foot weights by z: the foot bone to the toe's joint. */
export function footWeights(side: 'l' | 'r', z: number, y: number): W {
  const t = Math.min(1, Math.max(0, (-0.04 - z) / 0.08));
  const a = Math.min(1, Math.max(0, (y - 0.06) / 0.05));
  const foot = (1 - t) * (1 - a);
  const lower = (1 - t) * a;
  return [[boneIndex(`${side}_foot` as Bone), foot], [boneIndex(`${side}_toes` as Bone), t], [boneIndex(`${side}_lowerLeg` as Bone), lower]];
}

/** Rings of a foot loft from heel to toe, optionally grown by `grow` metres in every direction and lifted. */
export function footRings(side: 1 | -1, grow = 0, lift = 0, lengthen = 0): Ring[] {
  const base: [number, number, number, number, number][] = [
    [0.07, 0.060, 0.028, 0.032, 0],
    [0.02, 0.050, 0.034, 0.034, 0],
    [-0.05, 0.040, 0.040, 0.030, 0],
    [-0.12, 0.032, 0.042, 0.024, 0],
    [-0.17, 0.026, 0.036, 0.018, 0],
    [-0.195, 0.022, 0.026, 0.012, 0],
  ];
  return base.map(([z, y, ru, rv], i) => ({
    c: [side * LEG_X, y + lift, z - (i >= 3 ? lengthen * (i - 2) / 3 : 0) + (i === 0 ? grow * 0.6 : 0)] as V3,
    ru: ru + grow,
    rv: rv + grow,
  }));
}

// ---- the body ---------------------------------------------------------------------------------------------------------------------

/** The bare body: trunk, neck, arms with hands, legs with feet. One mesh, skin class, weights on the 22 bones. */
export function buildBodySkin(spec: BodySpec | null, f: Fidelity, layout: AtlasLayout): SkinMesh {
  const lod = LODS[f];
  const m = new SkinMesh();
  const cellBody = cellOf(layout, 'skin', SKIN_CELL.body);
  const cellHands = cellOf(layout, 'skin', SKIN_CELL.hands);
  // trunk
  const ys = steps(0.84, 1.49, 13, f);
  const torso: Ring[] = ys.map((y) => {
    const r = torsoRadii(y, spec);
    return { c: [0, y, r.cz], ru: r.rx, rv: r.rz };
  });
  m.append(tube(torso, { seg: lod.seg, cell: cellBody, part: PERSON_PART.skin, weights: (_, r) => torsoWeights(r.c[1]), capStart: true, capEnd: false }));
  // neck
  const nk = spec?.neck ?? 1;
  const neckYs = steps(1.47, 1.62, 4, f);
  const neck: Ring[] = neckYs.map((y) => ({ c: [0, y, -0.004 - (y - 1.47) * 0.03], ru: 0.052 * nk, rv: 0.056 * nk }));
  m.append(tube(neck, { seg: lod.seg, cell: cellBody, part: PERSON_PART.skin, weights: (_, r) => torsoWeights(r.c[1]), capEnd: false }));
  for (const [sd, name] of [[1, 'l'], [-1, 'r']] as [1 | -1, 'l' | 'r'][]) {
    // arm from the shoulder down to the wrist
    const armYs = steps(1.43, 0.9, 8, f);
    const armRings: Ring[] = armYs.map((y) => {
      const r = armRadii(y, spec);
      const out = ((spec?.shoulder ?? 1) - 1) * 0.12;
      return { c: [sd * (ARM_X + out), y, 0], ru: r.ru, rv: r.rv };
    });
    m.append(tube(armRings, { seg: Math.max(6, Math.round(lod.seg * 0.7)), cell: cellBody, part: PERSON_PART.skin, weights: (_, r) => armWeights(name, r.c[1]), capStart: true }));
    // hand: a flat mitten from the wrist to the fingertips
    const handYs = steps(0.91, 0.79, 4, f);
    const out = ((spec?.shoulder ?? 1) - 1) * 0.12;
    const hand: Ring[] = handYs.map((y, i, a) => {
      const t = i / (a.length - 1);
      return { c: [sd * (ARM_X + out), y, -0.004 * t], ru: lerp(0.027, 0.012, t * t) * (spec?.arm ?? 1), rv: lerp(0.016, 0.006, t) };
    });
    m.append(tube(hand, { seg: Math.max(6, Math.round(lod.seg * 0.6)), cell: cellHands, part: PERSON_PART.skin, weights: () => rigid(`${name}_hand` as Bone), capEnd: true }));
    // leg from the hip to the ankle
    const legYs = steps(0.97, 0.07, 11, f);
    const legRings: Ring[] = legYs.map((y) => {
      const r = legRadii(y, spec);
      return { c: [sd * LEG_X, y, y < 0.5 ? 0.004 : 0], ru: r.ru, rv: r.rv };
    });
    m.append(tube(legRings, { seg: Math.max(7, Math.round(lod.seg * 0.8)), cell: cellBody, part: PERSON_PART.skin, weights: (_, r) => legWeights(name, r.c[1]), capStart: true }));
    // foot
    const foot = footRings(sd, 0);
    m.append(tube(foot, { seg: Math.max(6, Math.round(lod.seg * 0.6)), frame: FRAME_Z, cell: cellBody, part: PERSON_PART.skin, weights: (_, r) => footWeights(name, r.c[2], r.c[1]), capStart: true, capEnd: true }));
  }
  smoothNormals(m);
  return m;
}

/** The rest world position of a bone (re-exported for the recipes). */
export const restOf = (b: Bone): V3 => REST[b];

import {
  Bone, BufferAttribute, BufferGeometry, DoubleSide, Group, MeshStandardNodeMaterial, Skeleton, SkinnedMesh, Color,
  type Texture,
} from 'three/webgpu';
import { HUMANOID_BONES } from '@dv/shared';
import { BONE_PARENT, BONE_REST } from '../anim/placeholder-rig.ts';
import { PERSON_CLASS, type PersonMesh } from './person-glb.ts';

/**
 * The creator preview's figure (M10d4, 10-ui-pages.md 2.8 rule 3): the parts of an avatar (body, face, hair, top, bottom, shoes,
 * accessory) are skinned meshes on the same `bay_rig_v1` skeleton, so they merge into three skinned meshes that share ONE skeleton: the
 * skin mesh (body and face, on the skin atlas page), the cloth mesh (top, bottom, shoes, accessory, on the cloth page) and the hair mesh
 * (on the hair page). Colours are baked into the vertex colours from the vertex class (skin tone, garment colours, hair colour) times the
 * baked shade, so one atlas page serves every colour. The face's 24 morph targets are merged into the skin mesh (zero deltas on the body).
 * A mid-fidelity preview stays under 40,000 triangles and three textures of at most 1,024 px.
 */
export type AssemblySlot = 'body' | 'face' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory';
type Pool = 'skin' | 'cloth' | 'hair';
const POOL_OF: Readonly<Record<AssemblySlot, Pool>> = { body: 'skin', face: 'skin', hair: 'hair', top: 'cloth', bottom: 'cloth', shoes: 'cloth', accessory: 'cloth' };
export const ASSEMBLY_TRIANGLES_MAX = 40_000;
export const ASSEMBLY_TEXTURES_MAX = 3;
export const ASSEMBLY_TEXTURE_PX_MAX = 1024;

export interface AssembledPart {
  slot: AssemblySlot;
  mesh: PersonMesh;
}

/** sRGB hex colours. */
export interface AssemblyColors {
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
  accessory: number;
}

export interface AssembleInput {
  parts: readonly AssembledPart[];
  colors: AssemblyColors;
  /** Face morph weights by catalog morph id (`brow-height`), -1 .. 1. */
  morphs?: Readonly<Record<string, number>>;
  textures?: Partial<Record<Pool, Texture>>;
}

export interface Assembly {
  root: Group;
  meshes: SkinnedMesh[];
  skeleton: Skeleton;
  bones: Map<string, Bone>;
  triangles: number;
  textures: number;
  /** Stature of the body part at its own scale, metres (the figure's root scale is `heightM / 1.8` times the sliders). */
  heightM: number;
  /** The morph target names that exist (`morph_brow_height` and so on). */
  morphNames: string[];
  setColors(c: AssemblyColors): void;
  setMorphs(w: Readonly<Record<string, number>>): void;
  dispose(): void;
}

const morphTarget = (id: string): string => `morph_${id.replace(/-/g, '_')}`;

const tmp = new Color();
function linear(hex: number): [number, number, number] {
  tmp.setHex(hex);
  return [tmp.r, tmp.g, tmp.b];
}

function slotColor(slot: AssemblySlot, c: AssemblyColors): number {
  switch (slot) {
    case 'top': return c.top;
    case 'bottom': return c.bottom;
    case 'shoes': return c.shoes;
    case 'accessory': return c.accessory;
    case 'hair': return c.hair;
    default: return c.skin;
  }
}

/** The vertex colour of one class: tint times the baked shade. Pure, exported for the tests and the ped kit's reading of the same rule. */
export function classColor(cls: number, slot: AssemblySlot, c: AssemblyColors): [number, number, number] {
  switch (cls) {
    case PERSON_CLASS.skin: return linear(c.skin);
    case PERSON_CLASS.lip: { const s = linear(c.skin); return [s[0] * 0.95, s[1] * 0.68, s[2] * 0.7]; }
    case PERSON_CLASS.cloth: return linear(slotColor(slot, c));
    case PERSON_CLASS.cloth2: { const s = linear(slotColor(slot, c)); return [s[0] * 0.55, s[1] * 0.55, s[2] * 0.55]; }
    case PERSON_CLASS.hair: return linear(c.hair);
    default: return [1, 1, 1];
  }
}

interface PoolBuild {
  pool: Pool;
  geo: BufferGeometry;
  /** Per vertex: the slot's index in `parts`, class and shade, for recolouring. */
  slotOf: Uint8Array;
  cls: Float32Array;
  ao: Float32Array;
  slots: AssemblySlot[];
  material: MeshStandardNodeMaterial;
  mesh: SkinnedMesh;
}

function buildPool(pool: Pool, parts: readonly AssembledPart[], colors: AssemblyColors, texture: Texture | undefined): PoolBuild | null {
  const mine = parts.filter((p) => POOL_OF[p.slot] === pool);
  if (mine.length === 0) return null;
  const verts = mine.reduce((a, p) => a + p.mesh.position.length / 3, 0);
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const skinIndex = new Uint16Array(verts * 4);
  const skinWeight = new Float32Array(verts * 4);
  const slotOf = new Uint8Array(verts);
  const cls = new Float32Array(verts);
  const ao = new Float32Array(verts).fill(1);
  const idx: number[] = [];
  const slots: AssemblySlot[] = [];
  const names: string[] = [];
  for (const p of mine) for (const t of p.mesh.targets) if (!names.includes(t.name)) names.push(t.name);
  const morph = names.map(() => new Float32Array(verts * 3));
  let base = 0;
  for (const p of mine) {
    const m = p.mesh;
    const n = m.position.length / 3;
    slots.push(p.slot);
    pos.set(m.position, base * 3);
    if (m.normal) nor.set(m.normal, base * 3);
    if (m.uv) uv.set(m.uv, base * 2);
    if (m.joints) skinIndex.set(m.joints, base * 4);
    if (m.weights) skinWeight.set(m.weights, base * 4);
    if (m.part) cls.set(m.part, base);
    if (m.ao) ao.set(m.ao, base);
    slotOf.fill(slots.length - 1, base, base + n);
    for (let i = 0; i < m.index.length; i++) idx.push((m.index[i] as number) + base);
    for (const t of m.targets) (morph[names.indexOf(t.name)] as Float32Array).set(t.position, base * 3);
    base += n;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(verts * 3), 3));
  geo.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geo.setIndex(idx);
  if (names.length > 0) {
    geo.morphAttributes['position'] = morph.map((a) => new BufferAttribute(a, 3));
    geo.morphTargetsRelative = true;
  }
  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: pool === 'hair' ? 0.55 : 0.78, metalness: 0.02 });
  if (texture) material.map = texture;
  if (pool === 'hair') material.side = DoubleSide;
  const mesh = new SkinnedMesh(geo, material);
  mesh.name = `avatar.${pool}`;
  mesh.frustumCulled = false;
  if (names.length > 0) {
    mesh.updateMorphTargets();
    names.forEach((nm, i) => {
      if (mesh.morphTargetDictionary) mesh.morphTargetDictionary[nm] = i;
    });
  }
  const b: PoolBuild = { pool, geo, slotOf, cls, ao, slots, material, mesh };
  paint(b, colors);
  return b;
}

function paint(b: PoolBuild, colors: AssemblyColors): void {
  const attr = b.geo.getAttribute('color') as BufferAttribute;
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < attr.count; i++) {
    const slot = b.slots[b.slotOf[i] as number] as AssemblySlot;
    const cls = b.cls[i] as number;
    const key = `${slot}:${cls}`;
    let c = cache.get(key);
    if (!c) {
      c = classColor(cls, slot, colors);
      cache.set(key, c);
    }
    const shade = b.ao[i] as number;
    attr.setXYZ(i, c[0] * shade, c[1] * shade, c[2] * shade);
  }
  attr.needsUpdate = true;
}

/** Builds the figure at rest on a fresh `bay_rig_v1` skeleton (feet on the origin, facing -Z). */
export function assembleAvatar(input: AssembleInput): Assembly {
  const root = new Group();
  root.name = 'avatar';
  const bones = new Map<string, Bone>();
  const list: Bone[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(...(BONE_REST[name] as [number, number, number]));
    bones.set(name, bone);
    list.push(bone);
  }
  for (const name of HUMANOID_BONES) {
    const parent = BONE_PARENT[name];
    (parent ? (bones.get(parent) as Bone) : root).add(bones.get(name) as Bone);
  }
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(list);
  const builds: PoolBuild[] = [];
  for (const pool of ['skin', 'cloth', 'hair'] as Pool[]) {
    const b = buildPool(pool, input.parts, input.colors, input.textures?.[pool]);
    if (!b) continue;
    root.add(b.mesh);
    b.mesh.bind(skeleton);
    builds.push(b);
  }
  const body = input.parts.find((p) => p.slot === 'body');
  const heightM = typeof body?.mesh.extras['heightM'] === 'number' ? (body.mesh.extras['heightM'] as number) : 1.8;
  const triangles = input.parts.reduce((a, p) => a + p.mesh.index.length / 3, 0);
  const morphNames = [...new Set(input.parts.flatMap((p) => p.mesh.targets.map((t) => t.name)))];
  const setMorphs = (w: Readonly<Record<string, number>>): void => {
    for (const b of builds) {
      const dict = b.mesh.morphTargetDictionary;
      const infl = b.mesh.morphTargetInfluences;
      if (!dict || !infl) continue;
      for (const [id, value] of Object.entries(w)) {
        const i = dict[morphTarget(id)];
        if (i !== undefined) infl[i] = value;
      }
    }
  };
  if (input.morphs) setMorphs(input.morphs);
  return {
    root,
    meshes: builds.map((b) => b.mesh),
    skeleton,
    bones,
    triangles,
    textures: builds.filter((b) => b.material.map !== null && b.material.map !== undefined).length,
    heightM,
    morphNames,
    setColors(c) {
      for (const b of builds) paint(b, c);
    },
    setMorphs,
    dispose() {
      for (const b of builds) {
        b.geo.dispose();
        b.material.dispose();
      }
      skeleton.dispose();
    },
  };
}

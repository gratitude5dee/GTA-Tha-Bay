/**
 * The near-LOD pedestrian (living part 4.5; M03b2): the procedural mannequin of M01b2 on the `bay_rig_v1` bone names,
 * but with its parts merged into ONE `SkinnedMesh` bound to the 22 bones, so a near pedestrian costs one render object (the player's
 * own mannequin is a group of separate meshes). The engine's `MannequinAnimator` drives the bones from the anim states 0 to 3.
 * Final bodies and outfits replace it in M10d1 (Q-39).
 */
import {
  Bone, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Group, MeshStandardNodeMaterial, Skeleton, SkinnedMesh, SphereGeometry,
  type Object3D,
} from 'three/webgpu';
import { HUMANOID_BONES } from '@dv/shared';
import { BONE_PARENT, BONE_REST, buildPlaceholderClips, type HumanoidBone, type PlaceholderRig } from '@dv/engine/client/anim';

const SKIN = [1, 0.78, 0.63] as const;

interface Part {
  bone: HumanoidBone;
  geo: BufferGeometry;
  at: readonly [number, number, number];
  skin: boolean;
}

function parts(): Part[] {
  const out: Part[] = [];
  const add = (bone: HumanoidBone, geo: BufferGeometry, at: [number, number, number], skin = false): void => {
    out.push({ bone, geo, at, skin });
  };
  const limb = (bone: HumanoidBone, r: number, len: number, skin = false): void => add(bone, new CapsuleGeometry(r, len, 3, 6), [0, -(len / 2 + r) + 0.02, 0], skin);
  add('hips', new BoxGeometry(0.32, 0.16, 0.2), [0, 0, 0]);
  add('chest', new BoxGeometry(0.3, 0.2, 0.19), [0, 0, 0]);
  add('upperChest', new BoxGeometry(0.36, 0.2, 0.21), [0, 0.02, 0]);
  add('head', new SphereGeometry(0.11, 8, 6), [0, 0.1, 0], true);
  add('head', new BoxGeometry(0.04, 0.04, 0.06), [0, 0.09, -0.12], true);
  for (const side of ['l', 'r'] as const) {
    limb(`${side}_upperArm` as HumanoidBone, 0.045, 0.2);
    limb(`${side}_lowerArm` as HumanoidBone, 0.04, 0.2, true);
    add(`${side}_hand` as HumanoidBone, new SphereGeometry(0.045, 6, 4), [0, -0.03, 0], true);
    limb(`${side}_upperLeg` as HumanoidBone, 0.075, 0.26);
    limb(`${side}_lowerLeg` as HumanoidBone, 0.06, 0.28);
    add(`${side}_foot` as HumanoidBone, new BoxGeometry(0.1, 0.07, 0.26), [0, -0.035, -0.06]);
  }
  return out;
}

/** The mannequin's rest position of each bone in the rig's own space (the sum of the parent chain). */
function restWorld(): Map<HumanoidBone, [number, number, number]> {
  const out = new Map<HumanoidBone, [number, number, number]>();
  const at = (b: HumanoidBone): [number, number, number] => {
    const have = out.get(b);
    if (have) return have;
    const r = BONE_REST[b];
    const p = BONE_PARENT[b];
    const base: [number, number, number] = p ? at(p) : [0, 0, 0];
    const v: [number, number, number] = [base[0] + r[0], base[1] + r[1], base[2] + r[2]];
    out.set(b, v);
    return v;
  };
  for (const b of HUMANOID_BONES) at(b);
  return out;
}

export interface NearFigure extends PlaceholderRig {
  /** The single skinned mesh. */
  mesh: SkinnedMesh;
  /** Sets the clothing colour (sRGB hex). */
  setTint(hex: number): void;
}

/** Builds one near-LOD pedestrian: feet on the origin, facing -Z, 1.8 m tall, one render object. */
export function buildNearFigure(): NearFigure {
  const root = new Group();
  root.name = 'ped.near';
  const bones = new Map<HumanoidBone, Bone>();
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
  const world = restWorld();
  const index = new Map<HumanoidBone, number>();
  HUMANOID_BONES.forEach((b, i) => index.set(b, i));

  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const skinIdx: number[] = [];
  const skinW: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const p of parts()) {
    const g = p.geo;
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    const bw = world.get(p.bone) as [number, number, number];
    const bi = index.get(p.bone) as number;
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i) + p.at[0] + bw[0], gp.getY(i) + p.at[1] + bw[1], gp.getZ(i) + p.at[2] + bw[2]);
      nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      // skin parts keep their colour; clothing is white and takes the tint
      if (p.skin) col.push(SKIN[0], SKIN[1], SKIN[2]);
      else col.push(1, 1, 1);
      skinIdx.push(bi, 0, 0, 0);
      skinW.push(1, 0, 0, 0);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
    base += gp.count;
    g.dispose();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(Float32Array.from(nor), 3));
  geo.setAttribute('color', new BufferAttribute(Float32Array.from(col), 3));
  geo.setAttribute('skinIndex', new BufferAttribute(Uint16Array.from(skinIdx), 4));
  geo.setAttribute('skinWeight', new BufferAttribute(Float32Array.from(skinW), 4));
  geo.setIndex(idx);
  const mat = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.02, vertexColors: true, transparent: true });
  const mesh = new SkinnedMesh(geo, mat);
  mesh.name = 'ped.near.mesh';
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(list);
  mesh.bind(skeleton);
  const hip = bones.get('hips') as Bone;
  void hip;
  return {
    root,
    bones,
    clips: buildPlaceholderClips(),
    mesh,
    setTint: (hex) => mat.color.setHex(hex),
    setOpacity: (o) => {
      mat.opacity = o;
      root.visible = o > 0.01;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      skeleton.dispose();
    },
  };
}

export type { Object3D };

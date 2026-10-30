/**
 * The `bay_rig_v1` rest skeleton as the people recipes of M10d4 use it: the 22 `HUMANOID_BONES`, their parents and rest offsets. The
 * values are a copy of `BONE_PARENT` and `BONE_REST` of `packages/engine/src/client/anim/placeholder-rig.ts` (that file imports `three`,
 * which a Node tool avoids); `tools/assets/test/recipes.people.spec.ts` compares the two, so a change of the rig cannot drift unseen.
 * The figure stands 1.8 m tall with its feet on the origin, faces -Z, and its `l_` bones sit on +X (the engine rule, not the glTF one).
 */
import { HUMANOID_BONES } from '../../../../packages/shared/src/contracts/anim-states.ts';

export { HUMANOID_BONES };
export type Bone = (typeof HUMANOID_BONES)[number];
export type V3 = [number, number, number];

export const BONE_PARENT: Readonly<Record<Bone, Bone | null>> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  l_shoulder: 'upperChest', l_upperArm: 'l_shoulder', l_lowerArm: 'l_upperArm', l_hand: 'l_lowerArm',
  r_shoulder: 'upperChest', r_upperArm: 'r_shoulder', r_lowerArm: 'r_upperArm', r_hand: 'r_lowerArm',
  l_upperLeg: 'hips', l_lowerLeg: 'l_upperLeg', l_foot: 'l_lowerLeg', l_toes: 'l_foot',
  r_upperLeg: 'hips', r_lowerLeg: 'r_upperLeg', r_foot: 'r_lowerLeg', r_toes: 'r_foot',
};

export const BONE_REST: Readonly<Record<Bone, readonly [number, number, number]>> = {
  hips: [0, 0.95, 0], spine: [0, 0.1, 0], chest: [0, 0.14, 0], upperChest: [0, 0.14, 0], neck: [0, 0.16, 0], head: [0, 0.07, 0],
  l_shoulder: [0.09, 0.1, 0], l_upperArm: [0.1, 0, 0], l_lowerArm: [0, -0.27, 0], l_hand: [0, -0.25, 0],
  r_shoulder: [-0.09, 0.1, 0], r_upperArm: [-0.1, 0, 0], r_lowerArm: [0, -0.27, 0], r_hand: [0, -0.25, 0],
  l_upperLeg: [0.09, -0.06, 0], l_lowerLeg: [0, -0.41, 0], l_foot: [0, -0.41, 0], l_toes: [0, -0.05, -0.14],
  r_upperLeg: [-0.09, -0.06, 0], r_lowerLeg: [0, -0.41, 0], r_foot: [0, -0.41, 0], r_toes: [0, -0.05, -0.14],
};

/** The height the rest figure stands (the rig's own, before a body's `heightM` scales the root). */
export const RIG_HEIGHT_M = 1.8;

export const boneIndex = (b: Bone): number => HUMANOID_BONES.indexOf(b);

/** Rest position of each bone in the rig's space (the sum of the parent chain). */
export function restWorld(): Record<Bone, V3> {
  const out = {} as Record<Bone, V3>;
  const at = (b: Bone): V3 => {
    const have = out[b];
    if (have) return have;
    const r = BONE_REST[b];
    const p = BONE_PARENT[b];
    const base: V3 = p ? at(p) : [0, 0, 0];
    const v: V3 = [base[0] + r[0], base[1] + r[1], base[2] + r[2]];
    out[b] = v;
    return v;
  };
  for (const b of HUMANOID_BONES) at(b);
  return out;
}

export const REST = restWorld();

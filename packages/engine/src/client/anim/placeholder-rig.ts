import {
  AnimationClip, AnimationMixer, Bone, BoxGeometry, CapsuleGeometry, Euler, Group, LoopOnce, Mesh, MeshStandardNodeMaterial,
  Quaternion, QuaternionKeyframeTrack, SphereGeometry, VectorKeyframeTrack,
  type AnimationAction, type KeyframeTrack,
} from 'three/webgpu';
import { HUMANOID_BONES } from '@dv/shared';
import { AnimGraph, clipKey, PLACEHOLDER_CLIPS, PLAYER_GRAPH, type PlaceholderClip } from './graph.ts';

export type HumanoidBone = (typeof HUMANOID_BONES)[number];

/** Parent of each of the 22 `bay_rig_v1` bones; the hips are the root. */
export const BONE_PARENT: Readonly<Record<HumanoidBone, HumanoidBone | null>> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  l_shoulder: 'upperChest', l_upperArm: 'l_shoulder', l_lowerArm: 'l_upperArm', l_hand: 'l_lowerArm',
  r_shoulder: 'upperChest', r_upperArm: 'r_shoulder', r_lowerArm: 'r_upperArm', r_hand: 'r_lowerArm',
  l_upperLeg: 'hips', l_lowerLeg: 'l_upperLeg', l_foot: 'l_lowerLeg', l_toes: 'l_foot',
  r_upperLeg: 'hips', r_lowerLeg: 'r_upperLeg', r_foot: 'r_lowerLeg', r_toes: 'r_foot',
};

/** Rest position of each bone relative to its parent, metres. The mannequin stands 1.8 m tall, feet on the origin, facing -Z. */
export const BONE_REST: Readonly<Record<HumanoidBone, readonly [number, number, number]>> = {
  hips: [0, 0.95, 0], spine: [0, 0.1, 0], chest: [0, 0.14, 0], upperChest: [0, 0.14, 0], neck: [0, 0.16, 0], head: [0, 0.07, 0],
  l_shoulder: [0.09, 0.1, 0], l_upperArm: [0.1, 0, 0], l_lowerArm: [0, -0.27, 0], l_hand: [0, -0.25, 0],
  r_shoulder: [-0.09, 0.1, 0], r_upperArm: [-0.1, 0, 0], r_lowerArm: [0, -0.27, 0], r_hand: [0, -0.25, 0],
  l_upperLeg: [0.09, -0.06, 0], l_lowerLeg: [0, -0.41, 0], l_foot: [0, -0.41, 0], l_toes: [0, -0.05, -0.14],
  r_upperLeg: [-0.09, -0.06, 0], r_lowerLeg: [0, -0.41, 0], r_foot: [0, -0.41, 0], r_toes: [0, -0.05, -0.14],
};

/** Euler XYZ rotation per bone, radians. A positive X rotation swings a hanging limb forward (-Z); a negative one leans the trunk forward. */
type BonePose = Partial<Record<HumanoidBone, readonly [number, number, number]>>;

const SAMPLES = 16;
const TAU = Math.PI * 2;

/** Builds a looping clip from a pose function of the cycle position u in [0, 1). `hipsY` is the hip height offset. */
function makeClip(name: PlaceholderClip, duration: number, pose: (u: number) => BonePose, hipsY: (u: number) => number = () => 0): AnimationClip {
  const times: number[] = [];
  const perBone = new Map<HumanoidBone, number[]>();
  const hips: number[] = [];
  const q = new Quaternion();
  const e = new Euler();
  for (let i = 0; i <= SAMPLES; i++) {
    const u = (i % SAMPLES) / SAMPLES;
    times.push((i / SAMPLES) * duration);
    const p = pose(u);
    for (const bone of HUMANOID_BONES) {
      const r = p[bone] ?? [0, 0, 0];
      q.setFromEuler(e.set(r[0], r[1], r[2]));
      const list = perBone.get(bone) ?? [];
      list.push(q.x, q.y, q.z, q.w);
      perBone.set(bone, list);
    }
    hips.push(BONE_REST.hips[0], BONE_REST.hips[1] + hipsY(u), BONE_REST.hips[2]);
  }
  const tracks: KeyframeTrack[] = [];
  for (const bone of HUMANOID_BONES) tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, times, perBone.get(bone) as number[]));
  tracks.push(new VectorKeyframeTrack('hips.position', times, hips));
  return new AnimationClip(name, duration, tracks);
}

const s = Math.sin;
const c = Math.cos;

function walkPose(u: number, swing: number, lean: number, elbow: number, knee: number): BonePose {
  const p = u * TAU;
  return {
    spine: [lean, 0, 0],
    chest: [0, 0.12 * s(p), 0],
    l_upperLeg: [swing * s(p), 0, 0],
    r_upperLeg: [-swing * s(p), 0, 0],
    l_lowerLeg: [-knee * Math.max(0, c(p)), 0, 0],
    r_lowerLeg: [-knee * Math.max(0, -c(p)), 0, 0],
    l_upperArm: [-swing * 0.9 * s(p), 0, 0.05],
    r_upperArm: [swing * 0.9 * s(p), 0, -0.05],
    l_lowerArm: [elbow, 0, 0],
    r_lowerArm: [elbow, 0, 0],
  };
}

/** The seven clips of the mannequin, built in code (no asset file). Durations are one cycle. */
export function buildPlaceholderClips(): Map<PlaceholderClip, AnimationClip> {
  const clips = new Map<PlaceholderClip, AnimationClip>();
  clips.set('idle', makeClip('idle', 2.4, (u) => ({
    spine: [0.02 * s(u * TAU), 0, 0],
    chest: [0.015 * s(u * TAU + 0.6), 0, 0],
    head: [0.02 * s(u * TAU + 1.2), 0, 0],
    l_upperArm: [0.04 * s(u * TAU), 0, 0.08],
    r_upperArm: [-0.04 * s(u * TAU), 0, -0.08],
    l_lowerArm: [0.12, 0, 0],
    r_lowerArm: [0.12, 0, 0],
  }), (u) => 0.005 * s(u * TAU)));
  clips.set('walk', makeClip('walk', 0.9, (u) => walkPose(u, 0.5, -0.03, 0.3, 0.55), (u) => 0.025 * Math.abs(c(u * TAU)) - 0.02));
  clips.set('run', makeClip('run', 0.62, (u) => walkPose(u, 0.95, -0.2, 1.2, 1.5), (u) => 0.06 * Math.abs(c(u * TAU)) - 0.05));
  clips.set('jump', makeClip('jump', 0.5, () => ({
    spine: [-0.1, 0, 0],
    l_upperLeg: [0.5, 0, 0], l_lowerLeg: [-0.9, 0, 0],
    r_upperLeg: [0.15, 0, 0], r_lowerLeg: [-0.4, 0, 0],
    l_upperArm: [2.1, 0, 0.15], r_upperArm: [2.1, 0, -0.15],
    l_lowerArm: [0.3, 0, 0], r_lowerArm: [0.3, 0, 0],
  })));
  clips.set('fall', makeClip('fall', 0.6, (u) => ({
    spine: [0.05 * s(u * TAU), 0, 0],
    l_upperLeg: [0.25 + 0.1 * s(u * TAU), 0, 0.1], l_lowerLeg: [-0.5, 0, 0],
    r_upperLeg: [-0.1 - 0.1 * s(u * TAU), 0, -0.1], r_lowerLeg: [-0.7, 0, 0],
    l_upperArm: [0.4, 0, 1.0], r_upperArm: [0.4, 0, -1.0],
    l_lowerArm: [0.3, 0, 0], r_lowerArm: [0.3, 0, 0],
  })));
  clips.set('land', makeClip('land', 0.4, () => ({
    spine: [-0.45, 0, 0],
    l_upperLeg: [1.0, 0, 0.05], l_lowerLeg: [-1.7, 0, 0],
    r_upperLeg: [1.0, 0, -0.05], r_lowerLeg: [-1.7, 0, 0],
    l_upperArm: [0.6, 0, 0.2], r_upperArm: [0.6, 0, -0.2],
  }), () => -0.3));
  clips.set('vault', makeClip('vault', 0.8, () => ({
    spine: [-0.35, 0, 0],
    l_upperLeg: [1.3, 0, 0], l_lowerLeg: [-0.5, 0, 0],
    r_upperLeg: [-0.25, 0, 0], r_lowerLeg: [-0.3, 0, 0],
    l_upperArm: [1.3, 0, 0.1], r_upperArm: [1.3, 0, -0.1],
    l_lowerArm: [0.2, 0, 0], r_lowerArm: [0.2, 0, 0],
  }), () => -0.1));
  return clips;
}

export interface PlaceholderRig {
  /** The group to add to the scene: feet on its origin, facing -Z. */
  root: Group;
  bones: Map<HumanoidBone, Bone>;
  clips: Map<PlaceholderClip, AnimationClip>;
  /** Sets the opacity of every part (the camera fade). 0 hides the group. */
  setOpacity(o: number): void;
  dispose(): void;
}

const BODY_COLOR = 0x4aa3ff;
const SKIN_COLOR = 0xf0c8a0;

/**
 * The procedural `bay_rig_v1` mannequin (M01b2): 22 bones named like `HUMANOID_BONES` and a few primitive parts parented to
 * them, so the real skeleton contract is exercised before any art exists. No asset file; real characters replace it in
 * M01d/M10a through the same bone names.
 */
export function buildPlaceholderRig(): PlaceholderRig {
  const root = new Group();
  root.name = 'bay_rig_v1.placeholder';
  const bones = new Map<HumanoidBone, Bone>();
  for (const name of HUMANOID_BONES) {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(...(BONE_REST[name] as [number, number, number]));
    bones.set(name, bone);
  }
  for (const name of HUMANOID_BONES) {
    const parent = BONE_PARENT[name];
    (parent ? (bones.get(parent) as Bone) : root).add(bones.get(name) as Bone);
  }

  const body = new MeshStandardNodeMaterial({ color: BODY_COLOR, roughness: 0.6, metalness: 0.05, transparent: true });
  const skin = new MeshStandardNodeMaterial({ color: SKIN_COLOR, roughness: 0.7, metalness: 0, transparent: true });
  const geometries: (CapsuleGeometry | BoxGeometry | SphereGeometry)[] = [];
  const part = (bone: HumanoidBone, geo: CapsuleGeometry | BoxGeometry | SphereGeometry, mat: MeshStandardNodeMaterial, at: [number, number, number]): void => {
    geometries.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(...at);
    (bones.get(bone) as Bone).add(m);
  };
  const limb = (bone: HumanoidBone, r: number, len: number, mat = body): void => part(bone, new CapsuleGeometry(r, len, 4, 8), mat, [0, -(len / 2 + r) + 0.02, 0]);

  part('hips', new BoxGeometry(0.32, 0.16, 0.2), body, [0, 0, 0]);
  part('chest', new BoxGeometry(0.3, 0.2, 0.19), body, [0, 0, 0]);
  part('upperChest', new BoxGeometry(0.36, 0.2, 0.21), body, [0, 0.02, 0]);
  part('head', new SphereGeometry(0.11, 12, 8), skin, [0, 0.1, 0]);
  // A nose on the -Z side so the facing direction can be read.
  part('head', new BoxGeometry(0.04, 0.04, 0.06), skin, [0, 0.09, -0.12]);
  for (const side of ['l', 'r'] as const) {
    limb(`${side}_upperArm` as HumanoidBone, 0.045, 0.2);
    limb(`${side}_lowerArm` as HumanoidBone, 0.04, 0.2, skin);
    part(`${side}_hand` as HumanoidBone, new SphereGeometry(0.045, 8, 6), skin, [0, -0.03, 0]);
    limb(`${side}_upperLeg` as HumanoidBone, 0.075, 0.26);
    limb(`${side}_lowerLeg` as HumanoidBone, 0.06, 0.28);
    part(`${side}_foot` as HumanoidBone, new BoxGeometry(0.1, 0.07, 0.26), body, [0, -0.035, -0.06]);
  }

  return {
    root,
    bones,
    clips: buildPlaceholderClips(),
    setOpacity: (o) => {
      body.opacity = o;
      skin.opacity = o;
      root.visible = o > 0.01;
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      body.dispose();
      skin.dispose();
    },
  };
}

/** Plays a graph's weights on a rig's clips through one `AnimationMixer`. */
export class MannequinAnimator {
  readonly graph: AnimGraph;
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private lastState = -1;
  private readonly scratch = new Map<string, number>();

  constructor(readonly rig: PlaceholderRig, graph: AnimGraph = new AnimGraph(PLAYER_GRAPH)) {
    this.graph = graph;
    this.mixer = new AnimationMixer(rig.root);
    for (const name of PLACEHOLDER_CLIPS) {
      const clip = rig.clips.get(name) as AnimationClip;
      const action = this.mixer.clipAction(clip);
      const looping = graph.def.states.some((st) => st.loop && (st.clip?.clip === name || st.blend1d?.points.some(([, ref]) => ref.clip === name)));
      if (!looping) {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(clipKey({ asset: 'anim/bay_rig_v1.proc', clip: name }), action);
    }
  }

  /** Drives the graph from the snapshot's `Anim` fields and advances the mixer by `mixerDtSec` (the time since this mixer last ran). */
  update(dtSec: number, animState: number, p0: number, mixerDtSec = dtSec): void {
    if (animState !== this.lastState) {
      this.lastState = animState;
      const def = this.graph.stateDef(animState);
      if (def?.clip && !def.loop) this.actions.get(clipKey(def.clip))?.reset().play();
    }
    this.graph.setState(animState, p0);
    this.graph.update(dtSec);
    const w = this.graph.weights(this.scratch);
    for (const [key, action] of this.actions) action.setEffectiveWeight(w.get(key) ?? 0);
    this.mixer.update(mixerDtSec);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}

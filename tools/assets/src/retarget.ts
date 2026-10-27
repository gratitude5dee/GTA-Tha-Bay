/**
 * assets:retarget (M10a1; spec/domains/05-assets-pipeline.md section 4): bake authored clips, keyed once on the `bay_rig_v1` mannequin, onto
 * one character's skeleton in Node, never at runtime. `SkeletonUtils.retargetClip(target, source, clip, { names, hip: 'hips', fps })` of
 * three@0.186.1 does the retarget; this file builds the skeletons from the two GLBs, scales the hip travel by the hip-height ratio, writes
 * the result as an animation-only GLB (`anim/<slug>.moves`: clip name = move id, frame count in the clip's `extras`) and measures gate A5.
 */
import { Document, type Node as GNode } from '@gltf-transform/core';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import {
  AnimationClip, Bone, BufferGeometry, MeshBasicMaterial, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Vector3, VectorKeyframeTrack,
  type KeyframeTrack,
} from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { canonicalBone, checkA5Retarget, hipDrift, type RetargetStats, type RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import type { GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { readGlb, writeGlb } from './glb-inspect.ts';

export const RETARGET_FPS = 30;

interface Rig3 {
  mesh: SkinnedMesh;
  bones: Bone[];
  byName: Map<string, Bone>;
  clips: AnimationClip[];
}

function boneNodes(doc: Document, rig: RigFamily): Map<GNode, string> {
  const out = new Map<GNode, string>();
  for (const n of doc.getRoot().listNodes()) {
    const c = canonicalBone(rig, n.getName());
    if (c !== null) out.set(n, c);
  }
  return out;
}

function trackOf(doc: Document, rig: RigFamily): AnimationClip[] {
  const clips: AnimationClip[] = [];
  for (const anim of doc.getRoot().listAnimations()) {
    const tracks: KeyframeTrack[] = [];
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const sampler = ch.getSampler();
      const path = ch.getTargetPath();
      if (node === null || sampler === null || path === null) continue;
      const bone = canonicalBone(rig, node.getName());
      if (bone === null) continue;
      if (sampler.getInterpolation() === 'CUBICSPLINE') throw new Error(`clip ${anim.getName()}: CUBICSPLINE samplers are not supported`);
      const times = sampler.getInput()?.getArray();
      const values = sampler.getOutput()?.getArray();
      if (!times || !values) continue;
      if (path === 'translation') tracks.push(new VectorKeyframeTrack(`${bone}.position`, Array.from(times), Array.from(values)));
      else if (path === 'rotation') tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, Array.from(times), Array.from(values)));
    }
    if (tracks.length > 0) clips.push(new AnimationClip(anim.getName(), -1, tracks));
  }
  return clips;
}

/** The skeleton of a GLB as three bones under a skinned mesh, at its rest pose. */
function buildRig(doc: Document, rig: RigFamily): Rig3 {
  const names = boneNodes(doc, rig);
  const made = new Map<GNode, Bone>();
  const bones: Bone[] = [];
  const roots: Bone[] = [];
  const make = (n: GNode): Bone => {
    const have = made.get(n);
    if (have !== undefined) return have;
    const b = new Bone();
    b.name = names.get(n) as string;
    const t = n.getTranslation();
    const r = n.getRotation();
    const s = n.getScale();
    b.position.set(t[0], t[1], t[2]);
    b.quaternion.set(r[0], r[1], r[2], r[3]);
    b.scale.set(s[0], s[1], s[2]);
    made.set(n, b);
    bones.push(b);
    return b;
  };
  for (const n of names.keys()) make(n);
  for (const [n, b] of made) {
    // The parent in the output is the nearest ancestor that is itself a bone.
    let p = n.getParentNode();
    while (p !== null && !made.has(p)) p = p.getParentNode();
    if (p === null) roots.push(b);
    else (made.get(p) as Bone).add(b);
  }
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
  for (const r of roots) mesh.add(r);
  mesh.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  mesh.bind(skeleton);
  return { mesh, bones, byName: new Map(bones.map((b) => [b.name, b])), clips: trackOf(doc, rig) };
}

export interface ClipReport {
  name: string;
  frames: number;
  stats: RetargetStats;
  findings: GateFinding[];
}

export interface RetargetResult {
  glb: Uint8Array;
  clips: ClipReport[];
  findings: GateFinding[];
}

export interface RetargetInput {
  /** GLB with the source skeleton (the mannequin) and the authored clips. */
  clipsGlb: Uint8Array;
  /** GLB of the character: its skeleton is the target. */
  targetGlb: Uint8Array;
  slug: string;
  heightM: number;
  rig: RigFamily;
  fps?: number;
  /** Clip names to bake (default: all). */
  only?: readonly string[];
}

/** Largest world-space distance any bone moves between two frames of a retargeted clip. */
function endPoseDistance(target: Rig3, clip: AnimationClip): number {
  const set = (frame: number): Vector3[] => {
    target.mesh.skeleton.pose();
    for (const t of clip.tracks) {
      const m = /^\.bones\[(.+)\]\.(position|quaternion)$/.exec(t.name);
      if (m === null) continue;
      const bone = target.byName.get(m[1] as string);
      if (bone === undefined) continue;
      const v = t.values;
      if (m[2] === 'position') bone.position.set(v[frame * 3] as number, v[frame * 3 + 1] as number, v[frame * 3 + 2] as number);
      else bone.quaternion.set(v[frame * 4] as number, v[frame * 4 + 1] as number, v[frame * 4 + 2] as number, v[frame * 4 + 3] as number);
    }
    target.mesh.updateMatrixWorld(true);
    return target.bones.map((b) => b.getWorldPosition(new Vector3()));
  };
  const frames = clip.tracks[0]?.times.length ?? 0;
  if (frames < 2) return 0;
  const a = set(0);
  const z = set(frames - 1);
  let worst = 0;
  a.forEach((p, i) => {
    worst = Math.max(worst, p.distanceTo(z[i] as Vector3));
  });
  target.mesh.skeleton.pose();
  return worst;
}

export async function retargetClips(i: RetargetInput): Promise<RetargetResult> {
  const fps = i.fps ?? RETARGET_FPS;
  const [srcDoc, tgtDoc] = await Promise.all([readGlb(i.clipsGlb), readGlb(i.targetGlb)]);
  const source = buildRig(srcDoc, i.rig);
  const target = buildRig(tgtDoc, i.rig);
  const srcHips = source.byName.get('hips');
  const tgtHips = target.byName.get('hips');
  if (srcHips === undefined || tgtHips === undefined) throw new Error('retarget: both skeletons need a hips bone on the bay_rig_v1 names');
  const scale = tgtHips.getWorldPosition(new Vector3()).y / srcHips.getWorldPosition(new Vector3()).y;
  const names: Record<string, string> = {};
  for (const b of target.bones) if (source.byName.has(b.name)) names[b.name] = b.name;

  const out = new Document();
  const buffer = out.createBuffer('data');
  const scene = out.createScene('Scene');
  const root = out.createNode('Armature');
  scene.addChild(root);
  const outNodes = new Map<string, GNode>();
  for (const b of target.bones) {
    const n = out.createNode(b.name).setTranslation([b.position.x, b.position.y, b.position.z]).setRotation([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]);
    outNodes.set(b.name, n);
  }
  for (const b of target.bones) {
    const parent = b.parent instanceof Bone ? outNodes.get(b.parent.name) : undefined;
    (parent ?? root).addChild(outNodes.get(b.name) as GNode);
  }

  const reports: ClipReport[] = [];
  const findings: GateFinding[] = [];
  const wanted = i.only === undefined ? source.clips : source.clips.filter((c) => i.only?.includes(c.name));
  for (const clip of wanted) {
    target.mesh.skeleton.pose();
    const baked = SkeletonUtils.retargetClip(target.mesh, source.mesh, clip, { names, hip: 'hips', fps, scale, useFirstFramePosition: false });
    baked.name = clip.name;
    const anim = out.createAnimation(clip.name);
    let frames = 0;
    let hipValues: Float32Array | null = null;
    for (const t of baked.tracks) {
      const m = /^\.bones\[(.+)\]\.(position|quaternion)$/.exec(t.name);
      if (m === null) continue;
      const node = outNodes.get(m[1] as string);
      if (node === undefined) continue;
      frames = Math.max(frames, t.times.length);
      const input = out.createAccessor().setType('SCALAR').setArray(Float32Array.from(t.times)).setBuffer(buffer);
      const output = out.createAccessor().setType(m[2] === 'position' ? 'VEC3' : 'VEC4').setArray(Float32Array.from(t.values)).setBuffer(buffer);
      if (m[2] === 'position' && m[1] === 'hips') hipValues = Float32Array.from(t.values);
      const sampler = out.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(out.createAnimationChannel().setTargetNode(node).setTargetPath(m[2] === 'position' ? 'translation' : 'rotation').setSampler(sampler));
    }
    anim.setExtras({ frames, fps });
    const hips: [number, number, number][] = [];
    if (hipValues !== null) for (let k = 0; k + 2 < hipValues.length; k += 3) hips.push([hipValues[k] as number, hipValues[k + 1] as number, hipValues[k + 2] as number]);
    const stats: RetargetStats = { heightM: i.heightM, hipDriftM: hipDrift(hips), endPoseDistM: endPoseDistance(target, baked) };
    const f = checkA5Retarget(`${i.slug}/${clip.name}`, stats);
    findings.push(...f);
    reports.push({ name: clip.name, frames, stats, findings: f });
  }
  out.getRoot().setExtras({ assetId: `anim/${i.slug}.moves`, rig: i.rig.family, clips: reports.map((r) => r.name) });
  await MeshoptEncoder.ready;
  await out.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return { glb: await writeGlb(out), clips: reports, findings };
}

/**
 * A procedural skinned mannequin as a GLB, for the character-pipeline tests (M10a1): the 22 `HUMANOID_BONES` in a T-pose, one box of
 * geometry bound to each bone, optional vendor-style bone names, clips with a chosen hip drift, and knobs that make the measurements
 * of gates A3, A4 and A5 come out good or bad. Tests only; nothing here ships.
 */
import { Document, type Node } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import { HUMANOID_BONES } from '../../../../packages/shared/src/contracts/anim-states.ts';
import { writeGlb } from '../../src/glb-inspect.ts';

export type Bone = (typeof HUMANOID_BONES)[number];

export interface ClipSpec {
  name: string;
  seconds?: number;
  /** Sample rate of the authored clip (default 30; fighter moves are keyed at 60, M10a2). */
  fps?: number;
  /** Horizontal travel of the hips over the clip, in metres (0 for a loop). */
  driftM?: number;
  /** Leave the arm raised at the end, so the last pose differs from the first. */
  openEnd?: boolean;
}

export interface MannequinOptions {
  heightM?: number;
  /** Bone name as written in the file; default is the canonical name. */
  name?: (bone: Bone) => string;
  omitBones?: readonly Bone[];
  /** Sum of the weights of every vertex (1 is valid). */
  weightSum?: number;
  /** Texture edge in pixels; 0 for none. */
  texturePx?: number;
  facing?: '+z' | '-z';
  /** Copies of the box set, to raise the triangle count. */
  repeat?: number;
  skin?: boolean;
  /** Arms raised 45 degrees instead of horizontal. */
  armsDown?: boolean;
  clips?: readonly ClipSpec[];
  /** Mesh without clips or geometry: the source of clips for a retarget test. */
  clipsOnly?: boolean;
}

const WORLD: Record<Bone, readonly [number, number, number]> = {
  hips: [0, 0.53, 0], spine: [0, 0.58, 0], chest: [0, 0.65, 0], upperChest: [0, 0.72, 0], neck: [0, 0.8, 0], head: [0, 0.87, 0],
  l_shoulder: [0.04, 0.77, 0], l_upperArm: [0.1, 0.77, 0], l_lowerArm: [0.22, 0.77, 0], l_hand: [0.34, 0.77, 0],
  r_shoulder: [-0.04, 0.77, 0], r_upperArm: [-0.1, 0.77, 0], r_lowerArm: [-0.22, 0.77, 0], r_hand: [-0.34, 0.77, 0],
  l_upperLeg: [0.05, 0.5, 0], l_lowerLeg: [0.05, 0.28, 0], l_foot: [0.05, 0.05, 0], l_toes: [0.05, 0.03, 0.07],
  r_upperLeg: [-0.05, 0.5, 0], r_lowerLeg: [-0.05, 0.28, 0], r_foot: [-0.05, 0.05, 0], r_toes: [-0.05, 0.03, 0.07],
};

const PARENT: Record<Bone, Bone | null> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  l_shoulder: 'upperChest', l_upperArm: 'l_shoulder', l_lowerArm: 'l_upperArm', l_hand: 'l_lowerArm',
  r_shoulder: 'upperChest', r_upperArm: 'r_shoulder', r_lowerArm: 'r_upperArm', r_hand: 'r_lowerArm',
  l_upperLeg: 'hips', l_lowerLeg: 'l_upperLeg', l_foot: 'l_lowerLeg', l_toes: 'l_foot',
  r_upperLeg: 'hips', r_lowerLeg: 'r_upperLeg', r_foot: 'r_lowerLeg', r_toes: 'r_foot',
};

interface Box {
  bone: Bone;
  c: [number, number, number];
  h: [number, number, number];
}

function boxes(): Box[] {
  const out: Box[] = [];
  for (const b of HUMANOID_BONES) {
    const [x, y, z] = WORLD[b];
    out.push({ bone: b, c: [x, y, z], h: [0.035, 0.035, 0.035] });
  }
  out.push({ bone: 'head', c: [0, 0.94, 0], h: [0.06, 0.06, 0.06] }); // crown: top of the head at 1.0
  out.push({ bone: 'l_foot', c: [0.05, 0.03, 0.03], h: [0.04, 0.03, 0.06] }); // sole at y 0, toes forward
  out.push({ bone: 'r_foot', c: [-0.05, 0.03, 0.03], h: [0.04, 0.03, 0.06] });
  return out;
}

const CUBE: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_TRIS: readonly number[] = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];

function pngBytes(px: number): Uint8Array {
  const png = new PNG({ width: px, height: px });
  for (let i = 0; i < px * px; i++) {
    // A gradient, not one colour: gltf-transform's prune folds a solid texture into the material factor.
    png.data[i * 4] = (i % px) % 256;
    png.data[i * 4 + 1] = Math.floor(i / px) % 256;
    png.data[i * 4 + 2] = 120;
    png.data[i * 4 + 3] = 255;
  }
  return new Uint8Array(PNG.sync.write(png));
}

export async function buildMannequin(o: MannequinOptions = {}): Promise<Uint8Array> {
  const h = o.heightM ?? 1.75;
  const nameOf = o.name ?? ((b: Bone): string => b);
  const omit = new Set<Bone>(o.omitBones ?? []);
  const sign = o.facing === '-z' ? -1 : 1;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const armature = doc.createNode('Armature');
  scene.addChild(armature);

  const nodes = new Map<Bone, Node>();
  const worldOf = (b: Bone): [number, number, number] => {
    const w = WORLD[b];
    let y = w[1];
    let x = w[0];
    if (o.armsDown === true && (b.endsWith('_lowerArm') || b.endsWith('_hand'))) {
      const side = b.startsWith('l_') ? 1 : -1;
      const step = b.endsWith('_lowerArm') ? 1 : 2;
      x = side * (0.1 + 0.08 * step);
      y = 0.77 - 0.08 * step;
    }
    return [x, y, w[2] * sign];
  };
  for (const b of HUMANOID_BONES) {
    if (omit.has(b)) continue;
    const parent = PARENT[b];
    const pw = parent === null ? [0, 0, 0] : worldOf(parent);
    const w = worldOf(b);
    const node = doc.createNode(nameOf(b)).setTranslation([(w[0] - (pw[0] as number)) * h, (w[1] - (pw[1] as number)) * h, (w[2] - (pw[2] as number)) * h]);
    nodes.set(b, node);
    const parentNode = parent === null ? armature : nodes.get(parent);
    (parentNode ?? armature).addChild(node);
  }
  const joints = HUMANOID_BONES.filter((b) => nodes.has(b));
  const jointIndex = new Map<Bone, number>(joints.map((b, i) => [b, i]));

  if (o.clipsOnly !== true) {
    const bx = boxes();
    const reps = Math.max(1, o.repeat ?? 1);
    const pos: number[] = [];
    const jnt: number[] = [];
    const wgt: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r < reps; r++) {
      for (const bxx of bx) {
        const j = jointIndex.get(bxx.bone) ?? jointIndex.get('hips') ?? 0;
        const base = pos.length / 3;
        for (const c of CUBE) {
          pos.push((bxx.c[0] + c[0] * bxx.h[0]) * h, (bxx.c[1] + c[1] * bxx.h[1]) * h, (bxx.c[2] * sign + c[2] * bxx.h[2]) * h);
          jnt.push(j, 0, 0, 0);
          wgt.push(o.weightSum ?? 1, 0, 0, 0);
          uv.push(0.5, 0.5);
        }
        for (const t of CUBE_TRIS) idx.push(base + t);
      }
    }
    const mat = doc.createMaterial('skin');
    if ((o.texturePx ?? 64) > 0) {
      const tex = doc.createTexture('base').setImage(pngBytes(o.texturePx ?? 64)).setMimeType('image/png');
      mat.setBaseColorTexture(tex);
    }
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
      .setMaterial(mat);
    if (o.skin !== false) {
      prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(jnt)).setBuffer(buffer));
      prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(wgt)).setBuffer(buffer));
    }
    const mesh = doc.createMesh('body').addPrimitive(prim);
    const meshNode = doc.createNode('Body').setMesh(mesh);
    if (o.skin !== false) {
      const ibm = new Float32Array(joints.length * 16);
      joints.forEach((b, i) => {
        const w = worldOf(b);
        ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0] * h, -w[1] * h, -w[2] * h, 1], i * 16);
      });
      const skin = doc.createSkin('skin').setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
      for (const b of joints) skin.addJoint(nodes.get(b) as Node);
      const root = nodes.get('hips');
      if (root !== undefined) skin.setSkeleton(root);
      meshNode.setSkin(skin);
    }
    scene.addChild(meshNode);
  }

  const clips = o.clips ?? (o.clipsOnly === true ? [{ name: 'Idle' }] : []);
  for (const c of clips) {
    const fps = c.fps ?? 30;
    const seconds = c.seconds ?? 1;
    const frames = Math.round(seconds * fps) + 1;
    const times = new Float32Array(frames);
    const hipsBase = nodes.get('hips')?.getTranslation() ?? [0, 0.53 * h, 0];
    const hipsT = new Float32Array(frames * 3);
    const armQ = new Float32Array(frames * 4);
    for (let i = 0; i < frames; i++) {
      const t = i / (frames - 1);
      times[i] = i / fps;
      const bob = c.driftM === undefined || c.driftM === 0 ? 0.01 * h * Math.sin(t * Math.PI * 2) : 0;
      hipsT.set([hipsBase[0] + (c.driftM ?? 0) * t, hipsBase[1] + bob, hipsBase[2]], i * 3);
      const angle = c.openEnd === true ? 0.9 * t : 0.3 * Math.sin(t * Math.PI * 2);
      armQ.set([0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], i * 4);
    }
    const anim = doc.createAnimation(c.name);
    const timeAcc = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    const hips = nodes.get('hips');
    if (hips !== undefined) {
      const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(doc.createAccessor().setType('VEC3').setArray(hipsT).setBuffer(buffer)).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(hips).setTargetPath('translation').setSampler(sampler));
    }
    const arm = nodes.get('l_upperArm');
    if (arm !== undefined) {
      const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(doc.createAccessor().setType('VEC4').setArray(armQ).setBuffer(buffer)).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(arm).setTargetPath('rotation').setSampler(sampler));
    }
  }
  doc.getRoot().setExtras({ mannequin: true });
  return writeGlb(doc);
}

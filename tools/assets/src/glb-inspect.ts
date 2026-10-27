/**
 * Measurements of a GLB for the character gates (M10a1): the glTF validator, triangle count, bounding-box height, facing, texture size,
 * skin and rig statistics. The verdicts are the pure cores in `packages/shared/src/assets/gates/` (A3, A4); this file only measures.
 */
import { ImageUtils, NodeIO, getBounds, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import validator from 'gltf-validator';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { canonicalBone, type MeshStats, type RigFamily, type RigStats } from '../../../packages/shared/src/assets/gates/index.ts';

export function ioFor(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

export async function readGlb(bytes: Uint8Array): Promise<Document> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return ioFor().readBinary(bytes);
}

export async function writeGlb(doc: Document): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  return ioFor().writeBinary(doc);
}

export interface ValidatorResult {
  errors: number;
  warnings: number;
  messages: string[];
}

/** The Khronos glTF validator. Messages of severity error only are listed. */
export async function validateGlb(bytes: Uint8Array): Promise<ValidatorResult> {
  const report = (await validator.validateBytes(bytes, { maxIssues: 200 })) as { issues: { numErrors: number; numWarnings: number; messages: { severity: number; code: string; message: string; pointer?: string }[] } };
  return {
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    messages: report.issues.messages.filter((m) => m.severity === 0).map((m) => `${m.code} ${m.pointer ?? ''}: ${m.message}`),
  };
}

export function triangleCount(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += Math.floor((idx !== null ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
    }
  }
  return n;
}

export function vertexCount(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) n += prim.getAttribute('POSITION')?.getCount() ?? 0;
  return n;
}

/** Largest texture edge in pixels (0 without textures). */
export function maxTexturePx(doc: Document): number {
  let m = 0;
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage();
    if (img === null) continue;
    const size = ImageUtils.getSize(img, t.getMimeType());
    if (size !== null) m = Math.max(m, size[0], size[1]);
  }
  return m;
}

export function textureEdges(doc: Document): number[] {
  const out: number[] = [];
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage();
    const size = img === null ? null : ImageUtils.getSize(img, t.getMimeType());
    if (size !== null) out.push(Math.max(size[0], size[1]));
  }
  return out;
}

/**
 * True when the model faces +Z: the feet (the lowest 6 % of the vertices) sit in front of the body's mean depth, because toes point forward.
 * A heuristic for a first filter; H3 is the human check.
 */
export function facesPlusZ(doc: Document): boolean {
  const ys: number[] = [];
  const zs: number[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (pos === null) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        ys.push(v[1] as number);
        zs.push(v[2] as number);
      }
    }
  }
  if (ys.length === 0) return false;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const y of ys) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cut = minY + (maxY - minY) * 0.06;
  let sumAll = 0;
  let sumFeet = 0;
  let nFeet = 0;
  for (let i = 0; i < ys.length; i++) {
    sumAll += zs[i] as number;
    if ((ys[i] as number) <= cut) {
      sumFeet += zs[i] as number;
      nFeet += 1;
    }
  }
  return nFeet > 0 && sumFeet / nFeet > sumAll / ys.length;
}

export function sceneHeight(doc: Document): number {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (scene === undefined) return 0;
  const b = getBounds(scene);
  return b.max[1] - b.min[1];
}

export async function inspectMesh(bytes: Uint8Array): Promise<{ stats: MeshStats; validatorMessages: string[]; doc: Document }> {
  const [doc, v] = await Promise.all([readGlb(bytes), validateGlb(bytes)]);
  return {
    doc,
    validatorMessages: v.messages,
    stats: {
      validatorErrors: v.errors,
      triangles: triangleCount(doc),
      heightM: Math.round(sceneHeight(doc) * 1000) / 1000,
      facesPlusZ: facesPlusZ(doc),
      maxTexPx: maxTexturePx(doc),
      skins: doc.getRoot().listSkins().length,
    },
  };
}

/** Joint nodes of every skin, by name. */
export function jointNodes(doc: Document): Node[] {
  const seen = new Set<Node>();
  for (const skin of doc.getRoot().listSkins()) for (const j of skin.listJoints()) seen.add(j);
  return [...seen];
}

/** Weight statistics over every skinned primitive: the largest |sum - 1| and the largest influence count. */
export function weightStats(doc: Document): { maxSumDeviation: number; maxInfluences: number } {
  let dev = 0;
  let inf = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const w = prim.getAttribute('WEIGHTS_0');
      if (w === null) continue;
      const v = [0, 0, 0, 0];
      for (let i = 0; i < w.getCount(); i++) {
        w.getElement(i, v);
        const sum = (v[0] as number) + (v[1] as number) + (v[2] as number) + (v[3] as number);
        dev = Math.max(dev, Math.abs(sum - 1));
        inf = Math.max(inf, v.filter((x) => x > 1e-6).length);
      }
    }
  }
  return { maxSumDeviation: Math.round(dev * 1e6) / 1e6, maxInfluences: inf };
}

/** T-pose rest: each arm points away from the body within 20 degrees of horizontal. Unknown bones count as not evaluable (true). */
export function tPoseRest(doc: Document, rig: RigFamily): boolean {
  const byCanon = new Map<string, Node>();
  for (const n of jointNodes(doc)) {
    const c = canonicalBone(rig, n.getName());
    if (c !== null) byCanon.set(c, n);
  }
  for (const side of ['l', 'r']) {
    const a = byCanon.get(`${side}_upperArm`);
    const b = byCanon.get(`${side}_hand`);
    if (a === undefined || b === undefined) return true;
    const p = a.getWorldTranslation();
    const q = b.getWorldTranslation();
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return false;
    if (Math.abs(dy) / len > Math.sin((20 * Math.PI) / 180)) return false;
  }
  return true;
}

export async function inspectRig(bytes: Uint8Array, rig: RigFamily): Promise<{ stats: RigStats; doc: Document }> {
  const doc = await readGlb(bytes);
  const w = weightStats(doc);
  return {
    doc,
    stats: {
      boneNames: jointNodes(doc).map((n) => n.getName()),
      maxWeightSumDeviation: w.maxSumDeviation,
      maxInfluences: w.maxInfluences,
      clipCount: doc.getRoot().listAnimations().length,
      tPoseRest: tPoseRest(doc, rig),
    },
  };
}

/** Copies the animations of `source` onto the nodes of `target` that carry the same names. Returns how many animations were copied. */
export function mergeAnimations(target: Document, source: Document): number {
  const byName = new Map(target.getRoot().listNodes().map((n) => [n.getName(), n] as const));
  const buffer = target.getRoot().listBuffers()[0] ?? target.createBuffer();
  let copied = 0;
  for (const a of source.getRoot().listAnimations()) {
    const anim = target.createAnimation(a.getName());
    for (const ch of a.listChannels()) {
      const node = byName.get(ch.getTargetNode()?.getName() ?? '');
      const s = ch.getSampler();
      const path = ch.getTargetPath();
      const input = s?.getInput()?.getArray();
      const output = s?.getOutput();
      if (node === undefined || s === null || path === null || !input || !output || !output.getArray()) continue;
      const sampler = target.createAnimationSampler()
        .setInput(target.createAccessor().setType('SCALAR').setArray(Float32Array.from(input)).setBuffer(buffer))
        .setOutput(target.createAccessor().setType(output.getType()).setArray(Float32Array.from(output.getArray() as ArrayLike<number>)).setBuffer(buffer))
        .setInterpolation(s.getInterpolation());
      anim.addSampler(sampler).addChannel(target.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    }
    copied += 1;
  }
  return copied;
}

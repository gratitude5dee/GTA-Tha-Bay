/**
 * The `.glb` of a skinned people part (M10d4): the 22 bone nodes of `bay_rig_v1` in the engine frame (`l_` on +X, facing -Z) with their
 * rest offsets, one skin over them with the inverse bind matrices of the rest pose, one mesh with `POSITION`, `NORMAL`, `TEXCOORD_0`,
 * `COLOR_0` (the baked shade), the custom `_PART` class and `JOINTS_0` / `WEIGHTS_0`, and optional morph targets. No compression, no
 * textures (the atlas pages are separate assets), a fixed generator string: the bytes are a pure function of the mesh. A rigid far
 * figure uses `writeRigidGlb` with its own custom attributes.
 */
import { Document, Logger, NodeIO, type TypedArray } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { PART_ATTRIBUTE } from '../../../../packages/shared/src/assets/art-parts.ts';
import { BONE_PARENT, BONE_REST, HUMANOID_BONES, REST, type Bone } from './rig.ts';
import type { SkinMesh } from './skin-mesh.ts';

export const PERSON_GENERATOR = 'dee-verse tools/assets people';

export interface SkinnedExtras {
  /** `character/pc-top-hoodie` and so on. */
  ref: string;
  fidelity: string;
  [k: string]: string | number | boolean | number[] | string[];
}

const materialFor = (doc: Document, double: boolean): ReturnType<Document['createMaterial']> =>
  doc.createMaterial('people').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.7).setMetallicFactor(0).setDoubleSided(double);

/** The bytes of a skinned part. `meshName` names the glTF mesh; morph target names go to `extras.targetNames`. */
export async function writeSkinnedGlb(m: SkinMesh, extras: SkinnedExtras, meshName: string, doubleSided = false): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.getRoot().getAsset().generator = PERSON_GENERATOR;
  const buffer = doc.createBuffer('data');
  const scene = doc.createScene(extras.ref);
  const rigRoot = doc.createNode('rig');
  const nodes = new Map<Bone, ReturnType<Document['createNode']>>();
  for (const b of HUMANOID_BONES) {
    const n = doc.createNode(b);
    n.setTranslation([BONE_REST[b][0], BONE_REST[b][1], BONE_REST[b][2]]);
    nodes.set(b, n);
  }
  for (const b of HUMANOID_BONES) {
    const p = BONE_PARENT[b];
    (p ? (nodes.get(p) as ReturnType<Document['createNode']>) : rigRoot).addChild(nodes.get(b) as ReturnType<Document['createNode']>);
  }
  const ibm = new Float32Array(HUMANOID_BONES.length * 16);
  HUMANOID_BONES.forEach((b, i) => {
    const w = REST[b];
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1], i * 16);
  });
  const skin = doc.createSkin('people')
    .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer))
    .setSkeleton(nodes.get('hips') as ReturnType<Document['createNode']>);
  for (const b of HUMANOID_BONES) skin.addJoint(nodes.get(b) as ReturnType<Document['createNode']>);
  const n = m.vertexCount;
  // compact encodings: the bytes of a part are mostly vertex data, and a kit of ~130 parts ships three variants of each
  const acc = (type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', arr: TypedArray, normalized = false): ReturnType<Document['createAccessor']> =>
    doc.createAccessor().setType(type).setArray(arr).setNormalized(normalized).setBuffer(buffer);
  const nor8 = new Int8Array(n * 3);
  for (let i = 0; i < n * 3; i++) nor8[i] = Math.max(-127, Math.min(127, Math.round((m.nor[i] as number) * 127)));
  const uv16 = new Uint16Array(n * 2);
  for (let i = 0; i < n * 2; i++) uv16[i] = Math.max(0, Math.min(65535, Math.round((m.uv[i] as number) * 65535)));
  const col8 = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) col8.fill(Math.max(0, Math.min(255, Math.round((m.ao[i] as number) * 255))), i * 3, i * 3 + 3);
  const joints8 = Uint8Array.from(m.joints);
  const weights8 = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    let sum = 0, big = 0;
    for (let k = 0; k < 4; k++) {
      const q = Math.round((m.weights[i * 4 + k] as number) * 255);
      weights8[i * 4 + k] = q;
      sum += q;
      if (q > (weights8[i * 4 + big] as number)) big = k;
    }
    weights8[i * 4 + big] = (weights8[i * 4 + big] as number) + (255 - sum);
  }
  const wide = n > 65535;
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', Float32Array.from(m.pos)))
    .setAttribute('NORMAL', acc('VEC3', nor8, true))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv16, true))
    .setAttribute('COLOR_0', acc('VEC3', col8, true))
    .setAttribute(PART_ATTRIBUTE, acc('SCALAR', Uint8Array.from(m.part)))
    .setAttribute('JOINTS_0', acc('VEC4', joints8))
    .setAttribute('WEIGHTS_0', acc('VEC4', weights8, true))
    .setIndices(acc('SCALAR', wide ? Uint32Array.from(m.idx) : Uint16Array.from(m.idx)))
    .setMaterial(materialFor(doc, doubleSided));
  const mesh = doc.createMesh(meshName).addPrimitive(prim);
  const names = [...m.morphs.keys()];
  for (const name of names) {
    // a morph target moves a part of the face: the deltas are sparse, and a delta under 0.3 mm is dropped
    const raw = Float32Array.from(m.morphs.get(name) as number[]);
    for (let i = 0; i < raw.length; i += 3) {
      if (Math.hypot(raw[i] as number, raw[i + 1] as number, raw[i + 2] as number) < 3e-4) raw.fill(0, i, i + 3);
    }
    prim.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION', acc('VEC3', raw).setSparse(true)));
  }
  if (names.length > 0) {
    mesh.setWeights(names.map(() => 0));
    mesh.setExtras({ targetNames: names });
  }
  const meshNode = doc.createNode(meshName).setMesh(mesh).setSkin(skin);
  scene.addChild(rigRoot);
  scene.addChild(meshNode);
  scene.setExtras({ dvArt: { ...extras } });
  // byte normals are legal glTF only with KHR_mesh_quantization
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  return new NodeIO().registerExtensions([KHRMeshQuantization]).writeBinary(doc);
}

export interface RigidMesh {
  pos: number[];
  nor: number[];
  col: number[];
  part: number[];
  swing: number[];
  pivot: number[];
  idx: number[];
}

/** A rigid far figure: positions, normals, colours, the part class and the gait attributes `_SWING` and `_PIVOT`. */
export async function writeRigidGlb(m: RigidMesh, extras: SkinnedExtras, name: string): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.getRoot().getAsset().generator = PERSON_GENERATOR;
  const buffer = doc.createBuffer('data');
  const acc = (type: 'VEC3' | 'SCALAR', arr: number[]): ReturnType<Document['createAccessor']> => doc.createAccessor().setType(type).setArray(Float32Array.from(arr)).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', m.pos))
    .setAttribute('NORMAL', acc('VEC3', m.nor))
    .setAttribute('COLOR_0', acc('VEC3', m.col))
    .setAttribute(PART_ATTRIBUTE, acc('SCALAR', m.part))
    .setAttribute('_SWING', acc('SCALAR', m.swing))
    .setAttribute('_PIVOT', acc('SCALAR', m.pivot))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint16Array.from(m.idx)).setBuffer(buffer))
    .setMaterial(materialFor(doc, false));
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
  const scene = doc.createScene(extras.ref);
  scene.addChild(node);
  scene.setExtras({ dvArt: { ...extras } });
  return new NodeIO().writeBinary(doc);
}

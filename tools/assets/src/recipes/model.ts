/**
 * A model in memory and its `.glb` (M10d1): a tree of named nodes, each holding primitives (`Mesh`), written with
 * `@gltf-transform/core`, vertices reordered and compressed with `EXT_meshopt_compression` (`meshoptimizer@1.3.0`). The output is a pure
 * function of the model: a fixed generator string, no timestamps, nothing from the host. The custom attribute `_PART` carries the part id
 * of each vertex (`packages/shared/src/assets/art-parts.ts`).
 */
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { ART_NODE, PART_ATTRIBUTE } from '../../../../packages/shared/src/assets/art-parts.ts';
import type { Mesh, V3 } from './mesh.ts';

export const MODEL_GENERATOR = 'dee-verse tools/assets vehicle';

export type Fidelity = 'hi' | 'mid' | 'lo';
export const FIDELITIES: readonly Fidelity[] = ['hi', 'mid', 'lo'];
/** The C07 variant id of each fidelity (`desktop`, `mobile`, `mobile-low`). */
export const VARIANT_OF: Readonly<Record<Fidelity, 'desktop' | 'mobile' | 'mobile-low'>> = { hi: 'desktop', mid: 'mobile', lo: 'mobile-low' };

export interface ModelNode {
  name: string;
  translation?: V3;
  children?: ModelNode[];
  /** Primitives, one per material name. */
  meshes?: Mesh[];
}

export interface ModelDoc {
  /** `vehicle/traffic.sedan` and so on. */
  ref: string;
  fidelity: Fidelity;
  /** Written to the scene's extras (`dvArt`). */
  extras: Record<string, string | number | boolean | number[]>;
  roots: ModelNode[];
}

export interface ModelStats {
  tris: number;
  verts: number;
  /** Render objects: primitives outside the collider. */
  primitives: number;
  /** Distinct material names outside the collider. */
  materials: number;
}

/** Gray-box facts the budgets and tests read: render stats exclude the collider hull. */
export function modelStats(doc: ModelDoc): ModelStats {
  let tris = 0, verts = 0, primitives = 0;
  const mats = new Set<string>();
  const visit = (n: ModelNode, inCollider: boolean): void => {
    const collider = inCollider || n.name === ART_NODE.collider;
    if (!collider) {
      for (const m of n.meshes ?? []) {
        if (m.idx.length === 0) continue;
        tris += m.idx.length / 3;
        verts += m.vertexCount;
        primitives++;
        mats.add(m.material);
      }
    }
    for (const c of n.children ?? []) visit(c, collider);
  };
  for (const r of doc.roots) visit(r, false);
  return { tris, verts, primitives, materials: mats.size };
}

/** Every node with its accumulated translation (no rotations or scales exist in these models). */
export function walk(doc: ModelDoc, f: (n: ModelNode, world: V3, parent: ModelNode | null) => void): void {
  const visit = (n: ModelNode, base: V3, parent: ModelNode | null): void => {
    const t = n.translation ?? [0, 0, 0];
    const w: V3 = [base[0] + t[0], base[1] + t[1], base[2] + t[2]];
    f(n, w, parent);
    for (const c of n.children ?? []) visit(c, w, n);
  };
  for (const r of doc.roots) visit(r, [0, 0, 0], null);
}

/** Bounds of the rendered meshes (collider excluded) in the model's frame. */
export function modelBounds(doc: ModelDoc): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const visit = (n: ModelNode, base: V3): void => {
    if (n.name === ART_NODE.collider) return;
    const t = n.translation ?? [0, 0, 0];
    const w: V3 = [base[0] + t[0], base[1] + t[1], base[2] + t[2]];
    for (const m of n.meshes ?? []) {
      if (m.idx.length === 0) continue;
      const mb = m.bounds();
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k] as number, (mb[k] as number) + (w[k] as number));
        b[k + 3] = Math.max(b[k + 3] as number, (mb[k + 3] as number) + (w[k] as number));
      }
    }
    for (const c of n.children ?? []) visit(c, w);
  };
  for (const r of doc.roots) visit(r, [0, 0, 0]);
  return b;
}

const MATERIALS: Readonly<Record<string, { roughness: number; metallic: number; alpha?: number }>> = {
  paint: { roughness: 0.35, metallic: 0.2 },
  glass: { roughness: 0.05, metallic: 0, alpha: 0.5 },
  detail: { roughness: 0.7, metallic: 0.05 },
  lamp: { roughness: 0.3, metallic: 0 },
  all: { roughness: 0.5, metallic: 0.1 },
  collider: { roughness: 1, metallic: 0 },
};

let ready: Promise<void> | null = null;
const encoderReady = (): Promise<void> => (ready ??= MeshoptEncoder.ready);

export function ioFor(): NodeIO {
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** The `.glb` bytes of a model. */
export async function writeModelGlb(model: ModelDoc): Promise<Uint8Array> {
  await encoderReady();
  await MeshoptDecoder.ready;
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.getRoot().getAsset().generator = MODEL_GENERATOR;
  const buffer = doc.createBuffer('data');
  const materials = new Map<string, ReturnType<Document['createMaterial']>>();
  const material = (name: string): ReturnType<Document['createMaterial']> => {
    let m = materials.get(name);
    if (!m) {
      const def = MATERIALS[name] ?? MATERIALS['all']!;
      m = doc.createMaterial(name).setBaseColorFactor([1, 1, 1, def.alpha ?? 1]).setRoughnessFactor(def.roughness).setMetallicFactor(def.metallic);
      if (def.alpha !== undefined) m.setAlphaMode('BLEND');
      materials.set(name, m);
    }
    return m;
  };
  const build = (n: ModelNode): ReturnType<Document['createNode']> => {
    const node = doc.createNode(n.name);
    if (n.translation) node.setTranslation([n.translation[0], n.translation[1], n.translation[2]]);
    const meshes = (n.meshes ?? []).filter((m) => m.idx.length > 0);
    if (meshes.length > 0) {
      const mesh = doc.createMesh(n.name);
      for (const m of meshes) {
        const wide = m.vertexCount > 65535;
        mesh.addPrimitive(
          doc
            .createPrimitive()
            .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(m.pos)).setBuffer(buffer))
            .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(m.nor)).setBuffer(buffer))
            .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(m.col)).setBuffer(buffer))
            .setAttribute(PART_ATTRIBUTE, doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(m.part)).setBuffer(buffer))
            .setIndices(doc.createAccessor().setType('SCALAR').setArray(wide ? Uint32Array.from(m.idx) : Uint16Array.from(m.idx)).setBuffer(buffer))
            .setMaterial(material(n.name === ART_NODE.collider ? 'collider' : m.material)),
        );
      }
      node.setMesh(mesh);
    }
    for (const c of n.children ?? []) node.addChild(build(c));
    return node;
  };
  const scene = doc.createScene(model.ref);
  for (const r of model.roots) scene.addChild(build(r));
  scene.setExtras({ dvArt: { ref: model.ref, fidelity: model.fidelity, ...model.extras } });
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return ioFor().writeBinary(doc);
}

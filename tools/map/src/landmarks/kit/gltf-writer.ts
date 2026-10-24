/**
 * The landmark glTF writer (M02d1): a `Geo` becomes one `.glb` through `@gltf-transform/core`, with the vertices reordered and
 * compressed by `EXT_meshopt_compression` (`@gltf-transform/functions` `reorder`, the `meshoptimizer@1.3.0` encoder, no
 * quantization: positions stay float32 so the runtime reads exact metres). The output is a pure function of the geometry: one
 * node, one mesh with at most one primitive per material class, a fixed `asset.generator`, no timestamps, nothing from the host.
 */
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { MATERIALS } from './palette.ts';
import type { Geo } from './primitives.ts';

/** Fixed so the bytes do not move with the tool version. */
export const GLB_GENERATOR = 'dee-verse tools/map landmarks';

export interface ModelStats {
  /** Triangles over all primitives. */
  tris: number;
  verts: number;
  /** Draw calls: primitives, one per material class in use. */
  primitives: number;
  materials: number;
}

export interface ModelMeta {
  /** `lm.<slug>` */
  id: string;
  /** Written to the scene's extras for the runtime (`dvLandmark`). */
  extras: Record<string, string | number | boolean>;
}

export interface BuiltModel { bytes: Uint8Array; stats: ModelStats }

let ready: Promise<void> | null = null;
const encoderReady = (): Promise<void> => (ready ??= MeshoptEncoder.ready);

export function ioFor(): NodeIO {
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

export async function writeGlb(geo: Geo, meta: ModelMeta): Promise<BuiltModel> {
  await encoderReady();
  await MeshoptDecoder.ready;
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.getRoot().getAsset().generator = GLB_GENERATOR;
  const buffer = doc.createBuffer('data');
  const mesh = doc.createMesh(meta.id);
  const classes = geo.classes();
  for (const c of classes) {
    const def = MATERIALS[c.cls];
    const material = doc.createMaterial(def.name).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(def.roughness).setMetallicFactor(def.metallic);
    const index = c.pos.length / 3 > 65535 ? c.idx : Uint16Array.from(c.idx);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(c.pos).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(c.nor).setBuffer(buffer))
      .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(c.col).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(index).setBuffer(buffer))
      .setMaterial(material);
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode(meta.id).setMesh(mesh);
  const scene = doc.createScene(meta.id).addChild(node);
  scene.setExtras({ dvLandmark: meta.extras });
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  // Stats come from the document after the reorder (it may drop vertices no triangle uses).
  let tris = 0, verts = 0;
  for (const prim of mesh.listPrimitives()) {
    tris += (prim.getIndices()?.getCount() ?? 0) / 3;
    verts += prim.getAttribute('POSITION')?.getCount() ?? 0;
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bytes = await ioFor().writeBinary(doc);
  return { bytes, stats: { tris, verts, primitives: classes.length, materials: classes.length } };
}

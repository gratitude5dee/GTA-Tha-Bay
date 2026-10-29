/**
 * A reader for the vehicle and prop `.glb` files of M10d1 (`tools/assets/src/recipes`): the subset those recipes write, so it needs
 * neither three's GLTFLoader nor a decode on the main thread. A tree of named nodes with translations only, each node holding up to a
 * few triangle primitives with `POSITION`, `NORMAL`, float `COLOR_0` and the custom float `_PART`, 16- or 32-bit indices, and
 * `EXT_meshopt_compression` on the buffer views (`meshoptimizer@1.3.0`, wasm). No `three` import: asset.worker runs it and transfers the
 * buffers.
 *
 * The decoded shape is `ArtModelData` of the engine. The files follow the C07 axis rule (+Z forward, +X to the model's left). `flip` (the default) turns the model half a circle about +Y so
 * that it faces -Z, the engine's rule: x and z of every position, normal and translation change sign. A file the recipes did not write
 * (another extension, a rotation or scale on a node, textures) is refused with an `ArtGlbError` rather than drawn wrong.
 */
import type { ArtModelData, ArtNode, ArtPrimitive } from '@dv/engine/client/vehicle/art-model';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

export class ArtGlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtGlbError';
  }
}

interface Json {
  scene?: number;
  scenes?: { nodes?: number[]; extras?: { dvArt?: Record<string, unknown> } }[];
  nodes?: { name?: string; mesh?: number; translation?: number[]; scale?: number[]; rotation?: number[]; matrix?: number[]; children?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { name?: string }[];
  accessors?: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews?: {
    buffer: number; byteOffset?: number; byteLength: number; byteStride?: number;
    extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } };
  }[];
  extensionsRequired?: string[];
}

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC3: 3 };

function viewBytes(json: Json, bin: Uint8Array, index: number, cache: Map<number, Uint8Array>): Uint8Array {
  const hit = cache.get(index);
  if (hit) return hit;
  const v = json.bufferViews?.[index];
  if (!v) throw new ArtGlbError(`buffer view ${index} is missing`);
  const ext = v.extensions?.EXT_meshopt_compression;
  let out: Uint8Array;
  if (ext) {
    const src = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter ?? 'NONE');
  } else {
    out = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  }
  cache.set(index, out);
  return out;
}

function readAccessor(json: Json, bin: Uint8Array, index: number, cache: Map<number, Uint8Array>, expect: { type: string; component: number }): Float32Array | Uint16Array | Uint32Array {
  const a = json.accessors?.[index];
  if (!a) throw new ArtGlbError(`accessor ${index} is missing`);
  if (a.type !== expect.type || a.componentType !== expect.component || a.normalized) throw new ArtGlbError(`accessor ${index}: unsupported ${a.type}/${a.componentType}`);
  const view = json.bufferViews?.[a.bufferView];
  if (!view) throw new ArtGlbError(`accessor ${index}: buffer view ${a.bufferView} is missing`);
  const bytes = viewBytes(json, bin, a.bufferView, cache);
  const comps = TYPE_SIZE[a.type] as number;
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
  const stride = view.byteStride ?? view.extensions?.EXT_meshopt_compression?.byteStride ?? comps * size;
  const base = a.byteOffset ?? 0;
  const out = a.componentType === 5126 ? new Float32Array(a.count * comps) : a.componentType === 5125 ? new Uint32Array(a.count * comps) : new Uint16Array(a.count * comps);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < comps; k++) {
      const at = base + i * stride + k * size;
      out[i * comps + k] = a.componentType === 5126 ? dv.getFloat32(at, true) : a.componentType === 5125 ? dv.getUint32(at, true) : dv.getUint16(at, true);
    }
  }
  return out;
}

export interface ReadOptions {
  /** Turn the model from +Z forward (the file) to -Z forward (the engine). Default true. */
  flip?: boolean;
}

/** Parses one vehicle or prop `.glb`. */
export async function readArtGlb(file: ArrayBuffer | Uint8Array, o: ReadOptions = {}): Promise<ArtModelData> {
  await MeshoptDecoder.ready;
  const flip = o.flip !== false;
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  if (bytes.byteLength < 28) throw new ArtGlbError('file is too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== 2) throw new ArtGlbError('not a glTF 2 binary');
  let json: Json | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const len = dv.getUint32(at, true), type = dv.getUint32(at + 4, true);
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as Json;
    else if (type === CHUNK_BIN) bin = body;
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new ArtGlbError('no JSON chunk');
  const unsupported = (json.extensionsRequired ?? []).filter((e) => e !== 'EXT_meshopt_compression');
  if (unsupported.length > 0) throw new ArtGlbError(`unsupported required extension ${unsupported.join(', ')}`);
  const scene = json.scenes?.[json.scene ?? 0];
  const cache = new Map<number, Uint8Array>();
  const sx = flip ? -1 : 1;
  let triangles = 0, vertices = 0;
  const bounds: ArtModelData['bounds'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

  const build = (id: number, parentWorld: [number, number, number], inCollider: boolean): ArtNode => {
    const n = json!.nodes?.[id];
    if (!n) throw new ArtGlbError(`node ${id} is missing`);
    if (n.matrix || n.rotation || (n.scale && n.scale.some((x) => x !== 1))) throw new ArtGlbError(`node ${n.name ?? id} has a rotation or a scale`);
    const t = n.translation ?? [0, 0, 0];
    const translation: [number, number, number] = [sx * (t[0] as number), t[1] as number, sx * (t[2] as number)];
    const world: [number, number, number] = [parentWorld[0] + translation[0], parentWorld[1] + translation[1], parentWorld[2] + translation[2]];
    const name = n.name ?? `node${id}`;
    const collider = inCollider || name === 'collider_hull';
    const primitives: ArtPrimitive[] = [];
    if (n.mesh !== undefined) {
      for (const p of json!.meshes?.[n.mesh]?.primitives ?? []) {
        if ((p.mode ?? 4) !== 4) throw new ArtGlbError('only triangle lists are supported');
        const pos = p.attributes['POSITION'], nor = p.attributes['NORMAL'], col = p.attributes['COLOR_0'], part = p.attributes['_PART'];
        if (pos === undefined || nor === undefined || col === undefined || part === undefined || p.indices === undefined) throw new ArtGlbError('a primitive lacks POSITION, NORMAL, COLOR_0, _PART or indices');
        const idxAccessor = json!.accessors?.[p.indices];
        const indices = readAccessor(json!, bin, p.indices, cache, { type: 'SCALAR', component: idxAccessor?.componentType === 5125 ? 5125 : 5123 }) as Uint16Array | Uint32Array;
        const positions = readAccessor(json!, bin, pos, cache, { type: 'VEC3', component: 5126 }) as Float32Array;
        const normals = readAccessor(json!, bin, nor, cache, { type: 'VEC3', component: 5126 }) as Float32Array;
        const colors = readAccessor(json!, bin, col, cache, { type: 'VEC3', component: 5126 }) as Float32Array;
        const parts = readAccessor(json!, bin, part, cache, { type: 'SCALAR', component: 5126 }) as Float32Array;
        if (flip) {
          for (let i = 0; i < positions.length; i += 3) {
            positions[i] = -(positions[i] as number);
            positions[i + 2] = -(positions[i + 2] as number);
            normals[i] = -(normals[i] as number);
            normals[i + 2] = -(normals[i + 2] as number);
          }
        }
        if (!collider) {
          triangles += indices.length / 3;
          vertices += positions.length / 3;
          for (let i = 0; i < positions.length; i += 3) {
            for (let k = 0; k < 3; k++) {
              const v = (positions[i + k] as number) + (world[k] as number);
              if (v < (bounds[k] as number)) bounds[k] = v;
              if (v > (bounds[k + 3] as number)) bounds[k + 3] = v;
            }
          }
        }
        const mi = p.material;
        primitives.push({ material: (mi !== undefined ? json!.materials?.[mi]?.name : undefined) ?? 'all', positions, normals, colors, parts, indices });
      }
    }
    const children = (n.children ?? []).map((c) => build(c, world, collider));
    return { name, translation, primitives, children };
  };

  const roots = (scene?.nodes ?? []).map((id) => build(id, [0, 0, 0], false));
  if (roots.length === 0) throw new ArtGlbError('the scene has no node');
  if (!Number.isFinite(bounds[0])) bounds.fill(0);
  const extras = scene?.extras?.dvArt ?? {};
  return {
    ref: typeof extras['ref'] === 'string' ? extras['ref'] : '',
    fidelity: typeof extras['fidelity'] === 'string' ? extras['fidelity'] : '',
    extras,
    roots,
    triangles,
    vertices,
    bounds,
  };
}

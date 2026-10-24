/**
 * A reader for the landmark `.glb` files of M02d1 (`tools/map/src/landmarks`): exactly the subset those recipes write, so it needs
 * neither three's GLTFLoader nor a main-thread decode. One scene, one node with no transform, one mesh of up to three primitives
 * (triangles, `POSITION`, `NORMAL`, float `COLOR_0`, 16- or 32-bit indices), `EXT_meshopt_compression` on the buffer views (decoded
 * with `meshoptimizer@1.3.0`, wasm). No `three` import: the asset worker runs it and transfers the buffers.
 *
 * A file the recipes did not write (another extension, textures, a transform on the node) is refused with a `LandmarkGlbError`
 * rather than drawn wrong: the landmark then keeps its baked proxy.
 */
import { MeshoptDecoder } from 'meshoptimizer/decoder';

export class LandmarkGlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LandmarkGlbError';
  }
}

export interface LandmarkPrimitive {
  /** The material name: `matte`, `metal` or `glass`. */
  material: string;
  roughness: number;
  metallic: number;
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB, 3 floats per vertex. */
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** minX, minY, minZ, maxX, maxY, maxZ in the model's frame (metres, y = 0 at the ground or the sea). */
  bounds: [number, number, number, number, number, number];
}

export interface LandmarkModelData {
  /** `lm.<slug>` */
  id: string;
  fidelity: string;
  /** `ground`: y = 0 is the terrain height at the seed; `sea`: y = 0 is the water level. */
  anchor: 'ground' | 'sea';
  primitives: LandmarkPrimitive[];
  triangles: number;
  vertices: number;
  bounds: [number, number, number, number, number, number];
}

interface Json {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[]; extras?: { dvLandmark?: { id?: string; fidelity?: string; anchor?: string } } }[];
  nodes?: { mesh?: number; translation?: number[]; scale?: number[]; rotation?: number[]; matrix?: number[]; children?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { name?: string; pbrMetallicRoughness?: { roughnessFactor?: number; metallicFactor?: number } }[];
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

/** Bytes of one buffer view, decoded when it is meshopt-compressed. */
function viewBytes(json: Json, bin: Uint8Array, index: number, cache: Map<number, Uint8Array>): Uint8Array {
  const hit = cache.get(index);
  if (hit) return hit;
  const v = json.bufferViews?.[index];
  if (!v) throw new LandmarkGlbError(`buffer view ${index} is missing`);
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

/** An accessor read into a new, tightly packed typed array. */
function readAccessor(json: Json, bin: Uint8Array, index: number, cache: Map<number, Uint8Array>, expect: { type: string; component: number }): Float32Array | Uint16Array | Uint32Array {
  const a = json.accessors?.[index];
  if (!a) throw new LandmarkGlbError(`accessor ${index} is missing`);
  if (a.type !== expect.type || a.componentType !== expect.component || a.normalized) throw new LandmarkGlbError(`accessor ${index}: unsupported ${a.type}/${a.componentType}`);
  const view = json.bufferViews?.[a.bufferView];
  if (!view) throw new LandmarkGlbError(`accessor ${index}: buffer view ${a.bufferView} is missing`);
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

/** Parses one landmark `.glb`. */
export async function readLandmarkGlb(file: ArrayBuffer | Uint8Array): Promise<LandmarkModelData> {
  await MeshoptDecoder.ready;
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  if (bytes.byteLength < 28) throw new LandmarkGlbError('file is too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== 2) throw new LandmarkGlbError('not a glTF 2 binary');
  let json: Json | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const len = dv.getUint32(at, true), type = dv.getUint32(at + 4, true);
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as Json;
    else if (type === CHUNK_BIN) bin = body;
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new LandmarkGlbError('no JSON chunk');
  const unsupported = (json.extensionsRequired ?? []).filter((e) => e !== 'EXT_meshopt_compression');
  if (unsupported.length > 0) throw new LandmarkGlbError(`unsupported required extension ${unsupported.join(', ')}`);

  const scene = json.scenes?.[json.scene ?? 0];
  const nodeIds = scene?.nodes ?? [];
  const mesh = nodeIds.length === 1 ? json.nodes?.[nodeIds[0] as number] : undefined;
  if (!mesh || mesh.mesh === undefined || (mesh.children?.length ?? 0) > 0) throw new LandmarkGlbError('expected one scene node holding one mesh');
  if (mesh.matrix || mesh.rotation || (mesh.translation && mesh.translation.some((x) => x !== 0)) || (mesh.scale && mesh.scale.some((x) => x !== 1))) throw new LandmarkGlbError('the node has a transform');
  const prims = json.meshes?.[mesh.mesh]?.primitives ?? [];
  if (prims.length === 0 || prims.length > 3) throw new LandmarkGlbError(`expected 1 to 3 primitives, found ${prims.length}`);

  const cache = new Map<number, Uint8Array>();
  const primitives: LandmarkPrimitive[] = [];
  let triangles = 0, vertices = 0;
  const all: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    if ((p.mode ?? 4) !== 4) throw new LandmarkGlbError('only triangle lists are supported');
    const pos = p.attributes['POSITION'], nor = p.attributes['NORMAL'], col = p.attributes['COLOR_0'];
    if (pos === undefined || nor === undefined || col === undefined || p.indices === undefined) throw new LandmarkGlbError('a primitive lacks POSITION, NORMAL, COLOR_0 or indices');
    const idxAccessor = json.accessors?.[p.indices];
    const indices = readAccessor(json, bin, p.indices, cache, { type: 'SCALAR', component: idxAccessor?.componentType === 5125 ? 5125 : 5123 }) as Uint16Array | Uint32Array;
    const positions = readAccessor(json, bin, pos, cache, { type: 'VEC3', component: 5126 }) as Float32Array;
    const normals = readAccessor(json, bin, nor, cache, { type: 'VEC3', component: 5126 }) as Float32Array;
    const colors = readAccessor(json, bin, col, cache, { type: 'VEC3', component: 5126 }) as Float32Array;
    const bounds: LandmarkPrimitive['bounds'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = positions[i + k] as number;
        if (v < (bounds[k] as number)) bounds[k] = v;
        if (v > (bounds[k + 3] as number)) bounds[k + 3] = v;
      }
    }
    for (let k = 0; k < 3; k++) {
      all[k] = Math.min(all[k] as number, bounds[k] as number);
      all[k + 3] = Math.max(all[k + 3] as number, bounds[k + 3] as number);
    }
    const m = p.material !== undefined ? json.materials?.[p.material] : undefined;
    primitives.push({
      material: m?.name ?? 'matte',
      roughness: m?.pbrMetallicRoughness?.roughnessFactor ?? 1,
      metallic: m?.pbrMetallicRoughness?.metallicFactor ?? 1,
      positions, normals, colors, indices, bounds,
    });
    triangles += indices.length / 3;
    vertices += positions.length / 3;
  }
  const extras = scene?.extras?.dvLandmark;
  return {
    id: extras?.id ?? '',
    fidelity: extras?.fidelity ?? '',
    anchor: extras?.anchor === 'sea' ? 'sea' : 'ground',
    primitives, triangles, vertices, bounds: all,
  };
}

/** Every buffer of a model, for the transfer list of a worker reply. */
export function landmarkTransferList(m: LandmarkModelData): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const p of m.primitives) for (const a of [p.positions, p.normals, p.colors, p.indices]) if (a.buffer instanceof ArrayBuffer) out.add(a.buffer);
  return [...out];
}

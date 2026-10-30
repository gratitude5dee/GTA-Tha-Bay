/**
 * A reader for the people `.glb` files of M10d4 (`tools/assets/src/recipes/skinned-glb.ts`): the subset those recipes write, so it needs
 * neither three's GLTFLoader nor a decode on the main thread. One mesh with one primitive; attributes as float, normalized byte or
 * normalized short (`KHR_mesh_quantization`), unsigned-byte joints, sparse morph target deltas, no compression, no textures. The result
 * is plain typed arrays in float: normals and uvs and colours and weights come back dequantized, joints as `Uint16Array`.
 * No `three` import: the pedestrian kit and the creator assembly both build their geometry from this.
 */
export class PersonGlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonGlbError';
  }
}

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  sparse?: {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
  };
}

interface Json {
  scenes?: { extras?: { dvArt?: Record<string, unknown> } }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; targets?: Record<string, number>[] }[]; extras?: { targetNames?: string[] } }[];
  accessors?: Accessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  extensionsRequired?: string[];
}

export interface PersonMesh {
  /** The part's `dvArt` extras (ref, fidelity, heightM, slot, part, morphs). */
  extras: Record<string, unknown>;
  position: Float32Array;
  normal: Float32Array | null;
  uv: Float32Array | null;
  /** Baked shade, one float per vertex (the colour attribute's first channel). */
  ao: Float32Array | null;
  /** The class id of each vertex (`PERSON_PART`). */
  part: Float32Array | null;
  joints: Uint16Array | null;
  weights: Float32Array | null;
  /** Gait attributes of a far figure. */
  swing: Float32Array | null;
  pivot: Float32Array | null;
  index: Uint32Array;
  /** Morph targets in file order: name and position deltas (3 per vertex). */
  targets: { name: string; position: Float32Array }[];
}

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const ALLOWED_EXTENSIONS = new Set(['KHR_mesh_quantization']);

function readComponent(dv: DataView, at: number, type: number, normalized: boolean): number {
  switch (type) {
    case 5126: return dv.getFloat32(at, true);
    case 5120: { const v = dv.getInt8(at); return normalized ? Math.max(v / 127, -1) : v; }
    case 5121: { const v = dv.getUint8(at); return normalized ? v / 255 : v; }
    case 5122: { const v = dv.getInt16(at, true); return normalized ? Math.max(v / 32767, -1) : v; }
    case 5123: { const v = dv.getUint16(at, true); return normalized ? v / 65535 : v; }
    case 5125: return dv.getUint32(at, true);
    default: throw new PersonGlbError(`unsupported component type ${type}`);
  }
}

function readAccessor(json: Json, bin: Uint8Array, index: number): { data: Float32Array; size: number } {
  const a = json.accessors?.[index];
  if (!a) throw new PersonGlbError(`accessor ${index} is missing`);
  const size = COMPONENTS[a.type];
  const csize = SIZE[a.componentType];
  if (size === undefined || csize === undefined) throw new PersonGlbError(`accessor ${index}: unsupported ${a.type}/${a.componentType}`);
  const out = new Float32Array(a.count * size);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (a.bufferView !== undefined) {
    const v = json.bufferViews?.[a.bufferView];
    if (!v) throw new PersonGlbError(`accessor ${index}: buffer view ${a.bufferView} is missing`);
    // the writer interleaves the vertex attributes of a mesh in one view with a byteStride; the other views are tightly packed
    const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const step = v.byteStride ?? size * csize;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = readComponent(dv, base + i * step + k * csize, a.componentType, a.normalized === true);
  }
  if (a.sparse) {
    const s = a.sparse;
    const iv = json.bufferViews?.[s.indices.bufferView];
    const vv = json.bufferViews?.[s.values.bufferView];
    if (!iv || !vv) throw new PersonGlbError(`accessor ${index}: sparse buffer view is missing`);
    const ic = SIZE[s.indices.componentType] as number;
    for (let n = 0; n < s.count; n++) {
      const at = readComponent(dv, (iv.byteOffset ?? 0) + (s.indices.byteOffset ?? 0) + n * ic, s.indices.componentType, false);
      for (let k = 0; k < size; k++) out[at * size + k] = readComponent(dv, (vv.byteOffset ?? 0) + (s.values.byteOffset ?? 0) + (n * size + k) * csize, a.componentType, a.normalized === true);
    }
  }
  return { data: out, size };
}

/** Parses a people part. Throws `PersonGlbError` for a file the recipes did not write (an unknown required extension, no mesh). */
export function parsePersonGlb(bytes: Uint8Array): PersonMesh {
  const head = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || head.getUint32(0, true) !== MAGIC) throw new PersonGlbError('not a GLB');
  let at = 12;
  let json: Json | null = null;
  let bin: Uint8Array | null = null;
  while (at + 8 <= bytes.byteLength) {
    const len = head.getUint32(at, true);
    const type = head.getUint32(at + 4, true);
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as Json;
    else if (type === CHUNK_BIN) bin = body;
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new PersonGlbError('the GLB has no JSON or no binary chunk');
  for (const e of json.extensionsRequired ?? []) if (!ALLOWED_EXTENSIONS.has(e)) throw new PersonGlbError(`unsupported required extension ${e}`);
  const mesh = json.meshes?.[0];
  const prim = mesh?.primitives[0];
  if (!mesh || !prim) throw new PersonGlbError('the GLB has no mesh');
  const attr = (name: string): { data: Float32Array; size: number } | null => {
    const i = prim.attributes[name];
    return i === undefined ? null : readAccessor(json as Json, bin as Uint8Array, i);
  };
  const position = attr('POSITION');
  if (!position) throw new PersonGlbError('the mesh has no POSITION');
  const col = attr('COLOR_0');
  let ao: Float32Array | null = null;
  if (col) {
    ao = new Float32Array(col.data.length / col.size);
    for (let i = 0; i < ao.length; i++) ao[i] = col.data[i * col.size] as number;
  }
  const joints = attr('JOINTS_0');
  const idxAcc = prim.indices === undefined ? null : readAccessor(json, bin, prim.indices);
  const index = new Uint32Array(idxAcc ? idxAcc.data.length : position.data.length / 3);
  if (idxAcc) for (let i = 0; i < index.length; i++) index[i] = idxAcc.data[i] as number;
  else for (let i = 0; i < index.length; i++) index[i] = i;
  const names = mesh.extras?.targetNames ?? [];
  const targets = (prim.targets ?? []).map((t, k) => ({
    name: names[k] ?? `target${k}`,
    position: readAccessor(json as Json, bin as Uint8Array, t['POSITION'] as number).data,
  }));
  return {
    extras: json.scenes?.[0]?.extras?.dvArt ?? {},
    position: position.data,
    normal: attr('NORMAL')?.data ?? null,
    uv: attr('TEXCOORD_0')?.data ?? null,
    ao,
    part: attr('_PART')?.data ?? null,
    joints: joints ? Uint16Array.from(joints.data) : null,
    weights: attr('WEIGHTS_0')?.data ?? null,
    swing: attr('_SWING')?.data ?? null,
    pivot: attr('_PIVOT')?.data ?? null,
    index,
    targets,
  };
}

/** Class ids of a vertex: the same numbers as `PERSON_PART` in `packages/shared/src/assets/art-parts.ts`. */
export const PERSON_CLASS = { skin: 0, cloth: 1, cloth2: 2, hair: 3, plain: 4, lip: 5 } as const;

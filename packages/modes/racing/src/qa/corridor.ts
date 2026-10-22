/**
 * The route corridor (M07a1, BD-M07a1-04): the ground under a race, for the headless run. The real run reads the bake's `p0`
 * tiles; a browser and CI have no bake, so `pnpm map:races compile` also writes `corridor.bin` next to `race.json`: the height
 * grids (4 m cells, 65 x 65 posts) of the chunks the route crosses, with one chunk of margin. The canonical determinism run feeds
 * them to the physics world as the only statics (no buildings, no props), the same bytes in Node and in WebKit.
 *
 * Format (before deflate, little endian): `CRD1`, bakeId as 32 bytes, u16 chunk count, then per chunk: u8 key length, the key
 * (ASCII `9/x/y`), f64 originX, f64 originZ, f64 cellM, then 65 x 65 i16 residuals (each post minus its left neighbour, the first
 * of a row minus the first of the row above, in decimetres). The file is raw-deflate compressed.
 */
export const CORRIDOR_MAGIC = 'CRD1';
export const CORRIDOR_POSTS = 65;

export interface CorridorChunk { key: string; originX: number; originZ: number; cellM: number; dm: Int16Array }
export interface Corridor { bakeId: string; chunks: CorridorChunk[] }

const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The uncompressed corridor bytes (the tool deflates them). */
export function encodeCorridorRaw(c: Corridor): Uint8Array {
  const chunks = [...c.chunks].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let size = 4 + 32 + 2;
  for (const k of chunks) size += 1 + k.key.length + 24 + CORRIDOR_POSTS * CORRIDOR_POSTS * 2;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (const ch of CORRIDOR_MAGIC) out[o++] = ch.charCodeAt(0);
  out.set(hexBytes(c.bakeId), o);
  o += 32;
  dv.setUint16(o, chunks.length, true);
  o += 2;
  for (const k of chunks) {
    out[o++] = k.key.length;
    for (let i = 0; i < k.key.length; i++) out[o++] = k.key.charCodeAt(i);
    dv.setFloat64(o, k.originX, true);
    dv.setFloat64(o + 8, k.originZ, true);
    dv.setFloat64(o + 16, k.cellM, true);
    o += 24;
    for (let r = 0; r < CORRIDOR_POSTS; r++) {
      for (let q = 0; q < CORRIDOR_POSTS; q++) {
        const v = k.dm[r * CORRIDOR_POSTS + q] as number;
        const pred = q > 0 ? (k.dm[r * CORRIDOR_POSTS + q - 1] as number) : r > 0 ? (k.dm[(r - 1) * CORRIDOR_POSTS] as number) : 0;
        dv.setInt16(o, v - pred, true);
        o += 2;
      }
    }
  }
  return out;
}

export function decodeCorridorRaw(b: Uint8Array): Corridor {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  let magic = '';
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(b[o++] as number);
  if (magic !== CORRIDOR_MAGIC) throw new Error(`corridor: bad magic ${magic}`);
  const bakeId = toHex(b.subarray(o, o + 32));
  o += 32;
  const n = dv.getUint16(o, true);
  o += 2;
  const chunks: CorridorChunk[] = [];
  for (let c = 0; c < n; c++) {
    const kl = b[o++] as number;
    let key = '';
    for (let i = 0; i < kl; i++) key += String.fromCharCode(b[o++] as number);
    const originX = dv.getFloat64(o, true);
    const originZ = dv.getFloat64(o + 8, true);
    const cellM = dv.getFloat64(o + 16, true);
    o += 24;
    const dm = new Int16Array(CORRIDOR_POSTS * CORRIDOR_POSTS);
    for (let r = 0; r < CORRIDOR_POSTS; r++) {
      for (let q = 0; q < CORRIDOR_POSTS; q++) {
        const pred = q > 0 ? (dm[r * CORRIDOR_POSTS + q - 1] as number) : r > 0 ? (dm[(r - 1) * CORRIDOR_POSTS] as number) : 0;
        dm[r * CORRIDOR_POSTS + q] = pred + dv.getInt16(o, true);
        o += 2;
      }
    }
    chunks.push({ key, originX, originZ, cellM, dm });
  }
  return { bakeId, chunks };
}

/** Inflates and decodes a `corridor.bin` (`DecompressionStream` exists in Node 22 and in every supported browser). */
export async function decodeCorridor(deflated: Uint8Array): Promise<Corridor> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  void w.write(deflated as unknown as BufferSource);
  void w.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return decodeCorridorRaw(new Uint8Array(buf));
}

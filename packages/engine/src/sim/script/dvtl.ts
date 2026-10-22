/**
 * `.dvtl`: the binary file of a recorded timeline (M05a2; C06 1.1 `TimelineRecorder.export`). Versioned, little-endian, one
 * self-contained file per run. The mission preview scrubs it, `check:missions` stores one per run as a CI artifact, and a replay
 * feeds its `external` rows back into the sim at the recorded ticks.
 *
 * ```
 * offset  size  field
 * 0       4     magic 0x4c545644 ("DVTL")
 * 4       2     version (1)
 * 6       2     snapshotEvery (ticks between track samples, 2)
 * 8       4     endTick (the last tick of the recording)
 * 12      4     string index of the meta JSON (mission id, seed, outcome, end hash; may be "{}")
 * 16      4     nStrings
 * 20      4     nEvents
 * 24      4     nExternals
 * 28      4     nTracks
 * 32      ...   strings: nStrings x (u32 byteLength, UTF-8 bytes), then zero padding to a multiple of 4
 *         ...   events: nEvents x (u32 tick, u32 type string, u32 data string = canonical JSON of the event data), ascending by record order
 *         ...   externals: nExternals x (u32 tick, u8 src [talk 0, intent 1, cutscene 2, mode 3], 3 zero bytes, u32 data string)
 *         ...   tracks: nTracks x (u32 name string, u32 count, count x u32 tick ascending, count x 3 x f32 x y z)
 * ```
 *
 * Positions are f32: the file is for scrubbing and replay checks, and a sample read back is `Math.fround` of the recorded value.
 * `lastBefore` is the binary search the scrubber uses. Sim code under the C02 lint: no `TextEncoder`, no `Date`.
 */
import { canonicalize, utf8Bytes, type JsonObject } from '@dv/shared';

export const DVTL_MAGIC = 0x4c545644;
export const DVTL_VERSION = 1;
const SRC_CODES = { talk: 0, intent: 1, cutscene: 2, mode: 3 } as const;
const SRC_NAMES = ['talk', 'intent', 'cutscene', 'mode'] as const;

export interface DvtlEvent {
  t: string;
  tick: number;
  data: JsonObject;
}
export interface DvtlExternal {
  src: (typeof SRC_NAMES)[number];
  tick: number;
  data: JsonObject;
}
export interface DvtlTrack {
  name: string;
  /** Ascending sample ticks. */
  ticks: Uint32Array;
  /** `x, y, z` per sample (f32). */
  pos: Float32Array;
}
export interface DvtlInput {
  snapshotEvery: number;
  endTick: number;
  meta: JsonObject;
  events: readonly DvtlEvent[];
  external: readonly DvtlExternal[];
  tracks: readonly { name: string; samples: readonly (readonly [tick: number, x: number, y: number, z: number])[] }[];
}
export interface Dvtl {
  version: number;
  snapshotEvery: number;
  endTick: number;
  meta: JsonObject;
  events: DvtlEvent[];
  external: DvtlExternal[];
  tracks: DvtlTrack[];
}

export function encodeDvtl(input: DvtlInput): ArrayBuffer {
  const strings: Uint8Array[] = [];
  const index = new Map<string, number>();
  const str = (s: string): number => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(utf8Bytes(s));
      index.set(s, i);
    }
    return i;
  };
  const meta = str(canonicalize(input.meta));
  const ev = input.events.map((e) => [e.tick, str(e.t), str(canonicalize(e.data))] as const);
  const ex = input.external.map((e) => [e.tick, SRC_CODES[e.src], str(canonicalize(e.data))] as const);
  const tr = [...input.tracks].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((t) => ({ name: str(t.name), samples: t.samples }));

  let strBytes = 0;
  for (const s of strings) strBytes += 4 + s.length;
  const strPad = (4 - (strBytes % 4)) % 4;
  let size = 32 + strBytes + strPad + ev.length * 12 + ex.length * 12;
  for (const t of tr) size += 8 + t.samples.length * 4 + t.samples.length * 12;

  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let o = 0;
  const u32 = (v: number): void => {
    dv.setUint32(o, v >>> 0, true);
    o += 4;
  };
  u32(DVTL_MAGIC);
  dv.setUint16(o, DVTL_VERSION, true);
  dv.setUint16(o + 2, input.snapshotEvery, true);
  o += 4;
  u32(input.endTick);
  u32(meta);
  u32(strings.length);
  u32(ev.length);
  u32(ex.length);
  u32(tr.length);
  for (const s of strings) {
    u32(s.length);
    u8.set(s, o);
    o += s.length;
  }
  o += strPad;
  for (const [tick, t, d] of ev) {
    u32(tick);
    u32(t);
    u32(d);
  }
  for (const [tick, src, d] of ex) {
    u32(tick);
    dv.setUint8(o, src);
    o += 4;
    u32(d);
  }
  for (const t of tr) {
    u32(t.name);
    u32(t.samples.length);
    for (const s of t.samples) u32(s[0]);
    for (const s of t.samples) {
      dv.setFloat32(o, s[1], true);
      dv.setFloat32(o + 4, s[2], true);
      dv.setFloat32(o + 8, s[3], true);
      o += 12;
    }
  }
  return buf;
}

function utf8Text(b: Uint8Array, from: number, to: number): string {
  let s = '';
  let i = from;
  while (i < to) {
    const c = b[i++] as number;
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | ((b[i++] as number) & 63));
    else if (c < 0xf0) {
      s += String.fromCharCode(((c & 15) << 12) | (((b[i] as number) & 63) << 6) | ((b[i + 1] as number) & 63));
      i += 2;
    } else {
      const cp = ((c & 7) << 18) | (((b[i] as number) & 63) << 12) | (((b[i + 1] as number) & 63) << 6) | ((b[i + 2] as number) & 63);
      i += 3;
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return s;
}

export class DvtlError extends Error {
  constructor(message: string) {
    super(`dvtl: ${message}`);
    this.name = 'DvtlError';
  }
}

export function decodeDvtl(bytes: ArrayBuffer | Uint8Array): Dvtl {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 32) throw new DvtlError('shorter than the header');
  if (dv.getUint32(0, true) !== DVTL_MAGIC) throw new DvtlError('bad magic');
  const version = dv.getUint16(4, true);
  if (version !== DVTL_VERSION) throw new DvtlError(`version ${version}`);
  const snapshotEvery = dv.getUint16(6, true);
  const endTick = dv.getUint32(8, true);
  const metaIdx = dv.getUint32(12, true);
  const nStr = dv.getUint32(16, true);
  const nEv = dv.getUint32(20, true);
  const nEx = dv.getUint32(24, true);
  const nTr = dv.getUint32(28, true);
  let o = 32;
  const strings: string[] = [];
  for (let i = 0; i < nStr; i++) {
    if (o + 4 > u8.byteLength) throw new DvtlError('string table cut short');
    const n = dv.getUint32(o, true);
    o += 4;
    if (o + n > u8.byteLength) throw new DvtlError('string cut short');
    strings.push(utf8Text(u8, o, o + n));
    o += n;
  }
  o += (4 - ((o - 32) % 4)) % 4;
  const s = (i: number): string => {
    const v = strings[i];
    if (v === undefined) throw new DvtlError(`string ${i} is out of range`);
    return v;
  };
  const events: DvtlEvent[] = [];
  for (let i = 0; i < nEv; i++) {
    events.push({ tick: dv.getUint32(o, true), t: s(dv.getUint32(o + 4, true)), data: JSON.parse(s(dv.getUint32(o + 8, true))) as JsonObject });
    o += 12;
  }
  const external: DvtlExternal[] = [];
  for (let i = 0; i < nEx; i++) {
    const src = SRC_NAMES[dv.getUint8(o + 4)];
    if (!src) throw new DvtlError('unknown external source');
    external.push({ tick: dv.getUint32(o, true), src, data: JSON.parse(s(dv.getUint32(o + 8, true))) as JsonObject });
    o += 12;
  }
  const tracks: DvtlTrack[] = [];
  for (let i = 0; i < nTr; i++) {
    const name = s(dv.getUint32(o, true));
    const n = dv.getUint32(o + 4, true);
    o += 8;
    const ticks = new Uint32Array(n);
    for (let k = 0; k < n; k++) ticks[k] = dv.getUint32(o + k * 4, true);
    o += n * 4;
    const pos = new Float32Array(n * 3);
    for (let k = 0; k < n * 3; k++) pos[k] = dv.getFloat32(o + k * 4, true);
    o += n * 12;
    tracks.push({ name, ticks, pos });
  }
  if (o > u8.byteLength) throw new DvtlError('file cut short');
  return { version, snapshotEvery, endTick, meta: JSON.parse(s(metaIdx)) as JsonObject, events, external, tracks };
}

/** Index of the last sample at or before `tick` (binary search), or -1 when the track starts later. */
export function lastBefore(ticks: ArrayLike<number>, tick: number): number {
  let lo = 0;
  let hi = ticks.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((ticks[mid] as number) <= tick) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** The recorded position of a track at `tick` (the last sample at or before it), or null. */
export function poseAt(track: DvtlTrack, tick: number): [number, number, number] | null {
  const i = lastBefore(track.ticks, tick);
  return i < 0 ? null : [track.pos[i * 3] as number, track.pos[i * 3 + 1] as number, track.pos[i * 3 + 2] as number];
}

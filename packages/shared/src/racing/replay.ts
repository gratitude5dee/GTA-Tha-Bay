/**
 * Replay codec (06-racing-data.md 4.3; M07a2). A replay is a header, the quantized per-tick inputs and a 20 Hz transform track.
 * Pure and exact: `decodeReplay(encodeReplay(x))` returns x, byte for byte, on every device. Sim code under the C02 lint.
 *
 * Wire layout (all integers little endian):
 *
 *     'DVRP' u8 version(1)
 *     varint headerLen, header JSON (canonical, ASCII only)
 *     varint inputsLen, inputs section (0 = none)
 *     varint trackLen,  track section (0 = none)
 *
 * Inputs section (BD-M07a2-01): `varint tickCount`, then a bit stream. One word per tick packs
 * steer i8 | throttle u7 << 8 | brake u7 << 15 | buttons u6 << 22 (`REPLAY_BUTTON`: handbrake, nitro, ability, lookBehind, reset, ready),
 * the fields a race reads. Per tick: 1 bit "same as the tick before" (a run of equal frames costs one bit a tick); otherwise a
 * mask of the fields that changed (steer alone costs 1 bit, steer and throttle 2, throttle alone 3, any other set 8), then a signed
 * Exp-Golomb delta for each changed analog field and 6 raw bits for the buttons. The first tick is compared with a neutral frame.
 *
 * Track section: `u8 stride` (ticks between samples, 3 = 20 Hz), `varint lead` (ticks from the first sample to GO), `varint sampleCount`, then per sample zigzag-varint deltas of
 * x and z in 2 cm, y in 4 cm and yaw in 1/65536 turn (wrapped to i16), and speed as one byte (kph / 2, clamped). The decoded
 * `Int32Array` holds five values per sample: x (2 cm), z (2 cm), y (4 cm), yaw (u16), speed (2 kph).
 */
import type { AssistSettings, Difficulty } from '../vehicle/handling.ts';
import type { UpgradeSlot } from '../vehicle/instance.ts';
import { canonicalize } from '../json.ts';
import { sha256Hex } from '../hash.ts';
import type { RaceId } from './race-def.ts';

export interface ReplayHeaderV1 {
  v: 1;
  raceId: RaceId;
  raceVersion: number;
  worldBake: string;
  buildId: string;
  profile: 'local' | 'canonical';
  seed: number;
  vehicleDef: string;
  handlingRev: number;
  upgrades: Partial<Record<UpgradeSlot, number>>;
  assists: AssistSettings;
  difficulty: Difficulty;
  hour: number;
  weather: string;
  startTick: number;
  finishTick: number | null;
  gateTicks: number[];
  /** FNV-1a-64 hex of the vehicle components at `finishTick` (C02 rule 7 order); '' while the run is unfinished. */
  endHash: string;
  /** Ticks between track samples (default 3). */
  trackEvery?: number;
  /** Ticks from the first track sample (the start of the attempt) to GO; a ghost plays from its own GO. */
  trackLead?: number;
}

export const REPLAY_LIMITS = { maxInputsBytes: 12_288, maxTrackBytes: 16_384, maxDurationSec: 600, keyframeEveryTicks: 300 } as const;

/** Bit positions of the buttons a replay keeps. */
export const REPLAY_BUTTON = { handbrake: 1, nitro: 2, ability: 4, lookBehind: 8, reset: 16, ready: 32 } as const;

export const REPLAY_TRACK_STRIDE = 3;
export const REPLAY_TRACK_FIELDS = 5;

const MAGIC = [0x44, 0x56, 0x52, 0x50];

/** Packs one tick's input; `steer` -127..127, `throttle` and `brake` 0..127, `buttons` 0..63. */
export function packReplayFrame(steer: number, throttle: number, brake: number, buttons: number): number {
  const s = steer < -128 ? -128 : steer > 127 ? 127 : steer | 0;
  const t = throttle < 0 ? 0 : throttle > 127 ? 127 : throttle | 0;
  const b = brake < 0 ? 0 : brake > 127 ? 127 : brake | 0;
  return ((s & 0xff) | (t << 8) | (b << 15) | ((buttons & 63) << 22)) >>> 0;
}
export const replaySteer = (w: number): number => (w << 24) >> 24;
export const replayThrottle = (w: number): number => (w >>> 8) & 127;
export const replayBrake = (w: number): number => (w >>> 15) & 127;
export const replayButtons = (w: number): number => (w >>> 22) & 63;

// ------------------------------------------------------------------ bytes

class ByteWriter {
  private b = new Uint8Array(256);
  n = 0;
  private grow(k: number): void {
    if (this.n + k <= this.b.length) return;
    let l = this.b.length * 2;
    while (l < this.n + k) l *= 2;
    const nb = new Uint8Array(l);
    nb.set(this.b.subarray(0, this.n));
    this.b = nb;
  }
  u8(v: number): void {
    this.grow(1);
    this.b[this.n++] = v & 0xff;
  }
  varint(v: number): void {
    let x = v >>> 0;
    while (x >= 0x80) {
      this.u8((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    this.u8(x);
  }
  zigzag(v: number): void {
    this.varint(((v << 1) ^ (v >> 31)) >>> 0);
  }
  bytes(a: Uint8Array): void {
    this.grow(a.length);
    this.b.set(a, this.n);
    this.n += a.length;
  }
  out(): Uint8Array {
    return this.b.slice(0, this.n);
  }
}

class ByteReader {
  o = 0;
  constructor(readonly b: Uint8Array) {}
  u8(): number {
    if (this.o >= this.b.length) throw new ReplayFormatError('truncated');
    return this.b[this.o++] as number;
  }
  varint(): number {
    let r = 0;
    let mul = 1;
    for (let k = 0; ; k++) {
      const c = this.u8();
      r += (c & 0x7f) * mul;
      if ((c & 0x80) === 0) break;
      mul *= 128;
      if (k > 5) throw new ReplayFormatError('varint too long');
    }
    return r;
  }
  zigzag(): number {
    const v = this.varint();
    return v % 2 === 1 ? -(v + 1) / 2 : v / 2;
  }
  take(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new ReplayFormatError('truncated');
    const s = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return s;
  }
}

class BitWriter {
  private w = new ByteWriter();
  private acc = 0;
  private nb = 0;
  bit(v: number): void {
    this.acc = (this.acc << 1) | (v & 1);
    if (++this.nb === 8) {
      this.w.u8(this.acc);
      this.acc = 0;
      this.nb = 0;
    }
  }
  bits(v: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bit((v >>> i) & 1);
  }
  /** Signed Exp-Golomb (order 0) of a zigzagged value. */
  sgolomb(d: number): void {
    const z = d > 0 ? 2 * d - 1 : -2 * d;
    const m = z + 1;
    let len = 0;
    while (m >>> (len + 1) !== 0) len++;
    for (let i = 0; i < len; i++) this.bit(0);
    this.bits(m, len + 1);
  }
  out(): Uint8Array {
    while (this.nb !== 0) this.bit(0);
    return this.w.out();
  }
}

class BitReader {
  private i = 0;
  private nb = 0;
  private cur = 0;
  constructor(private readonly b: Uint8Array) {}
  bit(): number {
    if (this.nb === 0) {
      if (this.i >= this.b.length) throw new ReplayFormatError('truncated bit stream');
      this.cur = this.b[this.i++] as number;
      this.nb = 8;
    }
    this.nb--;
    return (this.cur >>> this.nb) & 1;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v >>> 0;
  }
  sgolomb(): number {
    let len = 0;
    while (this.bit() === 0) {
      if (++len > 31) throw new ReplayFormatError('bad Exp-Golomb code');
    }
    const m = ((1 << len) | this.bits(len)) >>> 0;
    const z = m - 1;
    return z % 2 === 1 ? (z + 1) / 2 : -z / 2;
  }
}

export class ReplayFormatError extends Error {
  constructor(message: string) {
    super(`replay: ${message}`);
    this.name = 'ReplayFormatError';
  }
}

// ------------------------------------------------------------------ inputs

export function encodeInputs(words: readonly number[]): Uint8Array {
  const head = new ByteWriter();
  head.varint(words.length);
  const bw = new BitWriter();
  let prev = 0;
  for (let i = 0; i < words.length; i++) {
    const w = (words[i] as number) >>> 0;
    if (w === prev) {
      bw.bit(0);
      continue;
    }
    bw.bit(1);
    const ds = replaySteer(w) - replaySteer(prev);
    const dt = replayThrottle(w) - replayThrottle(prev);
    const db = replayBrake(w) - replayBrake(prev);
    const bt = replayButtons(w);
    const dbt = bt !== replayButtons(prev);
    const mask = (ds !== 0 ? 8 : 0) | (dt !== 0 ? 4 : 0) | (db !== 0 ? 2 : 0) | (dbt ? 1 : 0);
    // the usual changes are short: steer alone '0', steer and throttle '10', throttle alone '110'; anything else '1110' and the mask
    if (mask === 8) bw.bit(0);
    else if (mask === 12) bw.bits(0b10, 2);
    else if (mask === 4) bw.bits(0b110, 3);
    else {
      bw.bits(0b1110, 4);
      bw.bits(mask, 4);
    }
    if (ds !== 0) bw.sgolomb(ds);
    if (dt !== 0) bw.sgolomb(dt);
    if (db !== 0) bw.sgolomb(db);
    if (dbt) bw.bits(bt, 6);
    prev = w;
  }
  head.bytes(bw.out());
  return head.out();
}

export function decodeInputs(b: Uint8Array): Uint32Array {
  const r = new ByteReader(b);
  const n = r.varint();
  const br = new BitReader(b.subarray(r.o));
  const out = new Uint32Array(n);
  let steer = 0;
  let thr = 0;
  let brk = 0;
  let btn = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    if (br.bit() === 1) {
      let mask: number;
      if (br.bit() === 0) mask = 8;
      else if (br.bit() === 0) mask = 12;
      else if (br.bit() === 0) mask = 4;
      else {
        if (br.bit() !== 0) throw new ReplayFormatError('bad mask code');
        mask = br.bits(4);
      }
      if (mask & 8) steer += br.sgolomb();
      if (mask & 4) thr += br.sgolomb();
      if (mask & 2) brk += br.sgolomb();
      if (mask & 1) btn = br.bits(6);
      prev = packReplayFrame(steer, thr, brk, btn);
    }
    out[i] = prev;
  }
  return out;
}

// ------------------------------------------------------------------ track

export function encodeTrack(track: Int32Array, stride: number, lead = 0): Uint8Array {
  const w = new ByteWriter();
  w.u8(stride);
  w.varint(lead);
  const n = Math.floor(track.length / REPLAY_TRACK_FIELDS);
  w.varint(n);
  let px = 0;
  let pz = 0;
  let py = 0;
  let pyaw = 0;
  for (let i = 0; i < n; i++) {
    const o = i * REPLAY_TRACK_FIELDS;
    const x = track[o] as number;
    const z = track[o + 1] as number;
    const y = track[o + 2] as number;
    const yaw = (track[o + 3] as number) & 0xffff;
    const sp = track[o + 4] as number;
    w.zigzag(x - px);
    w.zigzag(z - pz);
    w.zigzag(y - py);
    w.zigzag(((yaw - pyaw) << 16) >> 16);
    w.u8(sp < 0 ? 0 : sp > 255 ? 255 : sp);
    px = x;
    pz = z;
    py = y;
    pyaw = yaw;
  }
  return w.out();
}

export function decodeTrack(b: Uint8Array): { track: Int32Array; stride: number; lead: number } {
  const r = new ByteReader(b);
  const stride = r.u8();
  const lead = r.varint();
  const n = r.varint();
  const out = new Int32Array(n * REPLAY_TRACK_FIELDS);
  let x = 0;
  let z = 0;
  let y = 0;
  let yaw = 0;
  for (let i = 0; i < n; i++) {
    x += r.zigzag();
    z += r.zigzag();
    y += r.zigzag();
    yaw = (yaw + r.zigzag()) & 0xffff;
    const o = i * REPLAY_TRACK_FIELDS;
    out[o] = x;
    out[o + 1] = z;
    out[o + 2] = y;
    out[o + 3] = yaw;
    out[o + 4] = r.u8();
  }
  return { track: out, stride, lead };
}

// ------------------------------------------------------------------ whole replay

function asciiJson(v: unknown): Uint8Array {
  const s = canonicalize(v).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** `inputs` is one packed word per tick (`packReplayFrame`) or null for a track-only replay. */
export function encodeReplay(h: ReplayHeaderV1, inputs: readonly number[] | null, track: Int32Array | null): Uint8Array {
  const w = new ByteWriter();
  for (const m of MAGIC) w.u8(m);
  w.u8(1);
  const hj = asciiJson(h);
  w.varint(hj.length);
  w.bytes(hj);
  const ib = inputs ? encodeInputs(inputs) : new Uint8Array(0);
  w.varint(ib.length);
  w.bytes(ib);
  const tb = track ? encodeTrack(track, h.trackEvery ?? REPLAY_TRACK_STRIDE, h.trackLead ?? 0) : new Uint8Array(0);
  w.varint(tb.length);
  w.bytes(tb);
  return w.out();
}

export interface DecodedReplay { h: ReplayHeaderV1; inputs: Uint32Array | null; track: Int32Array | null }

export function decodeReplay(b: Uint8Array): DecodedReplay {
  const r = new ByteReader(b);
  for (const m of MAGIC) if (r.u8() !== m) throw new ReplayFormatError('bad magic');
  if (r.u8() !== 1) throw new ReplayFormatError('unknown version');
  const hb = r.take(r.varint());
  let hs = '';
  for (let i = 0; i < hb.length; i++) hs += String.fromCharCode(hb[i] as number);
  const h = JSON.parse(hs) as ReplayHeaderV1;
  const il = r.varint();
  const ib = r.take(il);
  const tl = r.varint();
  const tb = r.take(tl);
  return { h, inputs: il > 0 ? decodeInputs(ib) : null, track: tl > 0 ? decodeTrack(tb).track : null };
}

/** Section sizes of an encoded replay, for the size caps. */
export function replaySizes(b: Uint8Array): { inputsBytes: number; trackBytes: number; total: number } {
  const r = new ByteReader(b);
  r.take(5);
  r.take(r.varint());
  const il = r.varint();
  r.take(il);
  const tl = r.varint();
  return { inputsBytes: il, trackBytes: tl, total: b.length };
}

export function replayWithinLimits(b: Uint8Array): boolean {
  const s = replaySizes(b);
  return s.inputsBytes <= REPLAY_LIMITS.maxInputsBytes && s.trackBytes <= REPLAY_LIMITS.maxTrackBytes;
}

/** What a viewer compares with the running build before it re-simulates. */
export interface ReplayContext { handlingRev: number; buildId: string; worldBake: string }
export type ReplayMismatch = 'handlingRev' | 'buildId' | 'worldBake';

export function replayMismatch(h: Pick<ReplayHeaderV1, 'handlingRev' | 'buildId' | 'worldBake'>, cur: ReplayContext): ReplayMismatch[] {
  const out: ReplayMismatch[] = [];
  if (h.handlingRev !== cur.handlingRev) out.push('handlingRev');
  if (h.buildId !== cur.buildId) out.push('buildId');
  if (h.worldBake !== cur.worldBake) out.push('worldBake');
  return out;
}

export const replaySha256 = (bytes: Uint8Array): string => sha256Hex(bytes);

/** Quantizers of the track (2 cm, 4 cm, 1/65536 turn, 2 kph). */
export const TRACK_Q = { xz: 50, y: 25, yawTurns: 65536, kph: 0.5 } as const;

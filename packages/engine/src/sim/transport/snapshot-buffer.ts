import { SNAPSHOT_MAX_RECORDS, SNAPSHOT_RECORD_BYTES, utf8Bytes } from '@dv/shared';
import { decodeUtf8 } from '../bytes.ts';
import type { PmSnapshotPayload, SnapshotFramePayload } from './envelope.ts';

/**
 * Render snapshot transport (C02): records are 64 bytes, little endian, the layout from 01-engine-contracts.md.
 *
 *   0 u32 handle . 4 u32 renderKey . 8 f64 px . 16 f64 py . 24 f64 pz . 32 f32 qx . 36 f32 qy . 40 f32 qz . 44 f32 qw
 *   48 u16 animState . 50 u16 flags . 52 f32 animP0 . 56 f32 animP1 . 60 u8 variant . 61 u8 lod . 62 u16 reserved
 */
export interface SnapshotRecord {
  handle: number;
  renderKey: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  animState: number;
  flags: number;
  animP0: number;
  animP1: number;
  variant: number;
  lod: number;
}

export const REC_BYTES = SNAPSHOT_RECORD_BYTES;
export const REC_MAX = SNAPSHOT_MAX_RECORDS;
export const SIDE_BYTES = 8 * 1024;
const RECORDS_BYTES = REC_MAX * REC_BYTES;

export function emptyRecord(): SnapshotRecord {
  return { handle: 0, renderKey: 0, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, animState: 0, flags: 0, animP0: 0, animP1: 0, variant: 0, lod: 0 };
}

export function writeRecord(v: DataView, index: number, r: Readonly<SnapshotRecord>): void {
  const o = index * REC_BYTES;
  v.setUint32(o, r.handle, true);
  v.setUint32(o + 4, r.renderKey, true);
  v.setFloat64(o + 8, r.px, true);
  v.setFloat64(o + 16, r.py, true);
  v.setFloat64(o + 24, r.pz, true);
  v.setFloat32(o + 32, r.qx, true);
  v.setFloat32(o + 36, r.qy, true);
  v.setFloat32(o + 40, r.qz, true);
  v.setFloat32(o + 44, r.qw, true);
  v.setUint16(o + 48, r.animState, true);
  v.setUint16(o + 50, r.flags, true);
  v.setFloat32(o + 52, r.animP0, true);
  v.setFloat32(o + 56, r.animP1, true);
  v.setUint8(o + 60, r.variant);
  v.setUint8(o + 61, r.lod);
  v.setUint16(o + 62, 0, true);
}

export function readRecord(v: DataView, index: number, into: SnapshotRecord = emptyRecord()): SnapshotRecord {
  const o = index * REC_BYTES;
  into.handle = v.getUint32(o, true);
  into.renderKey = v.getUint32(o + 4, true);
  into.px = v.getFloat64(o + 8, true);
  into.py = v.getFloat64(o + 16, true);
  into.pz = v.getFloat64(o + 24, true);
  into.qx = v.getFloat32(o + 32, true);
  into.qy = v.getFloat32(o + 36, true);
  into.qz = v.getFloat32(o + 40, true);
  into.qw = v.getFloat32(o + 44, true);
  into.animState = v.getUint16(o + 48, true);
  into.flags = v.getUint16(o + 50, true);
  into.animP0 = v.getFloat32(o + 52, true);
  into.animP1 = v.getFloat32(o + 56, true);
  into.variant = v.getUint8(o + 60);
  into.lod = v.getUint8(o + 61);
  return into;
}

/** One snapshot as the reader holds it. `records` is a view of `count * 64` bytes owned by the reader. */
export interface SnapshotFrame {
  tick: number;
  count: number;
  flags: number;
  records: Uint8Array;
  side: Record<string, unknown>;
}

/** What `read()` returns. The objects are reused between calls: copy what you keep. */
export interface SnapshotRead {
  /** True when this call delivered a snapshot newer than the previous call's. */
  fresh: boolean;
  tick: number;
  /** Fraction of the next tick the worker had accumulated when the frame ended, in [0, 1). */
  alpha: number;
  cur: SnapshotFrame;
  /** The snapshot one tick before `cur`, or null when it is not available (first frame, torn read). */
  prev: SnapshotFrame | null;
}

/** Worker side: fills the next snapshot in place. */
export interface SnapshotWriter {
  /**
   * Publish one snapshot. `fill` writes records into the view (at most `max`) and returns how many it wrote.
   * `side` is serialized as JSON into the 8 KiB side block; a larger value is replaced by `{}`.
   */
  write(tick: number, fill: (view: DataView, max: number) => number, side?: Record<string, unknown>, flags?: number): void;
  setAlpha(alpha: number): void;
  /** Called after each frame's ticks. The postMessage sink posts here; the SAB writer has nothing to do. */
  endFrame(): void;
}

export interface SnapshotReader {
  read(): SnapshotRead | null;
  /** Calls to `read` that returned the previous snapshot (no new tick, or a torn read). */
  readonly reuse: number;
}

// ------------------------------------------------------------------------------------------------------------
// SharedArrayBuffer triple buffer with a seqlock per slot
// ------------------------------------------------------------------------------------------------------------

const HEADER_BYTES = 256;
const SLOT_BYTES = RECORDS_BYTES + SIDE_BYTES;
const G_ORDER = 0; // bits 0-1 latest slot, bits 2-3 previous slot, bit 4 has latest, bit 5 has previous
const G_ALPHA = 1; // f32 bits
const G_PUBLISHED = 2;
const S_BASE = 8; // slot header words start here, 8 words per slot
const S_SEQ = 0;
const S_TICK = 1;
const S_COUNT = 2;
const S_FLAGS = 3;
const S_SIDE_LEN = 4;
const HAS_LATEST = 1 << 4;
const HAS_PREV = 1 << 5;

const f32Scratch = new Float32Array(1);
const i32Scratch = new Int32Array(f32Scratch.buffer);

export function snapshotBufferBytes(): number {
  return HEADER_BYTES + 3 * SLOT_BYTES;
}

const slotWord = (slot: number, word: number): number => S_BASE + slot * 8 + word;
const recordsOffset = (slot: number): number => HEADER_BYTES + slot * SLOT_BYTES;
const sideOffset = (slot: number): number => recordsOffset(slot) + RECORDS_BYTES;

/**
 * Three slots of 8,192 records plus an 8 KiB side block. The worker writes a slot that is neither the latest nor the
 * previous one, bracketing the write with an odd sequence number, then publishes (latest, previous) in one atomic
 * word. The reader copies the latest and previous slots under the same sequence check and, if it saw a write in
 * progress or a changed sequence, keeps the snapshot it already had.
 */
export class SabSnapshotWriter implements SnapshotWriter {
  private readonly g: Int32Array;
  constructor(private readonly buffer: SharedArrayBuffer) {
    this.g = new Int32Array(buffer, 0, HEADER_BYTES / 4);
  }

  write(tick: number, fill: (view: DataView, max: number) => number, side: Record<string, unknown> = {}, flags = 0): void {
    const order = Atomics.load(this.g, G_ORDER);
    const latest = order & HAS_LATEST ? order & 3 : -1;
    const prev = order & HAS_PREV ? (order >> 2) & 3 : -1;
    let slot = 0;
    while (slot === latest || slot === prev) slot++;
    const seqIdx = slotWord(slot, S_SEQ);
    const seq = Atomics.load(this.g, seqIdx);
    Atomics.store(this.g, seqIdx, seq | 1); // odd: a write is in progress
    const count = fill(new DataView(this.buffer, recordsOffset(slot), RECORDS_BYTES), REC_MAX);
    let sideBytes = utf8Bytes(JSON.stringify(side));
    if (sideBytes.length > SIDE_BYTES) sideBytes = utf8Bytes('{}');
    new Uint8Array(this.buffer, sideOffset(slot), SIDE_BYTES).set(sideBytes);
    Atomics.store(this.g, slotWord(slot, S_TICK), tick | 0);
    Atomics.store(this.g, slotWord(slot, S_COUNT), count);
    Atomics.store(this.g, slotWord(slot, S_FLAGS), flags | 0);
    Atomics.store(this.g, slotWord(slot, S_SIDE_LEN), sideBytes.length);
    Atomics.store(this.g, seqIdx, ((seq | 1) + 1) | 0); // even again: complete
    const next = slot | HAS_LATEST | (latest >= 0 ? (latest << 2) | HAS_PREV : 0);
    Atomics.store(this.g, G_ORDER, next);
    Atomics.add(this.g, G_PUBLISHED, 1);
  }

  setAlpha(alpha: number): void {
    f32Scratch[0] = alpha;
    Atomics.store(this.g, G_ALPHA, i32Scratch[0] as number);
  }

  endFrame(): void {}
}

class FrameBuf {
  tick = -1;
  count = 0;
  flags = 0;
  side: Record<string, unknown> = {};
  readonly bytes = new Uint8Array(RECORDS_BYTES);
  view: SnapshotFrame = { tick: -1, count: 0, flags: 0, records: this.bytes.subarray(0, 0), side: {} };

  publish(): SnapshotFrame {
    this.view.tick = this.tick;
    this.view.count = this.count;
    this.view.flags = this.flags;
    this.view.side = this.side;
    this.view.records = this.bytes.subarray(0, this.count * REC_BYTES);
    return this.view;
  }
}

export class SabSnapshotReader implements SnapshotReader {
  reuse = 0;
  private readonly g: Int32Array;
  private readonly cur = new FrameBuf();
  private readonly prev = new FrameBuf();
  private result: SnapshotRead | null = null;

  constructor(private readonly buffer: SharedArrayBuffer) {
    this.g = new Int32Array(buffer, 0, HEADER_BYTES / 4);
  }

  /** Copy one slot under its seqlock into `into`. False when the slot was being written or changed under us. */
  private copySlot(slot: number, into: FrameBuf): boolean {
    const s1 = Atomics.load(this.g, slotWord(slot, S_SEQ));
    if (s1 & 1) return false;
    const tick = Atomics.load(this.g, slotWord(slot, S_TICK));
    const count = Atomics.load(this.g, slotWord(slot, S_COUNT));
    const flags = Atomics.load(this.g, slotWord(slot, S_FLAGS));
    const sideLen = Atomics.load(this.g, slotWord(slot, S_SIDE_LEN));
    if (count < 0 || count > REC_MAX || sideLen < 0 || sideLen > SIDE_BYTES) return false;
    into.bytes.set(new Uint8Array(this.buffer, recordsOffset(slot), count * REC_BYTES));
    const sideCopy = new Uint8Array(sideLen);
    sideCopy.set(new Uint8Array(this.buffer, sideOffset(slot), sideLen));
    if (Atomics.load(this.g, slotWord(slot, S_SEQ)) !== s1) return false;
    into.tick = tick >>> 0;
    into.count = count;
    into.flags = flags >>> 0;
    try {
      into.side = JSON.parse(decodeUtf8(sideCopy)) as Record<string, unknown>;
    } catch {
      into.side = {};
    }
    return true;
  }

  read(): SnapshotRead | null {
    const order = Atomics.load(this.g, G_ORDER);
    if (!(order & HAS_LATEST)) {
      this.reuse++;
      return this.result;
    }
    const latest = order & 3;
    const latestTick = Atomics.load(this.g, slotWord(latest, S_TICK)) >>> 0;
    const seen = this.result !== null && this.cur.tick === latestTick;
    const alpha = this.alpha();
    if (seen) {
      // Same tick as last time: only alpha may have moved.
      (this.result as SnapshotRead).fresh = false;
      (this.result as SnapshotRead).alpha = alpha;
      this.reuse++;
      return this.result;
    }
    const gotCur = this.copySlot(latest, this.cur);
    if (!gotCur) {
      // Torn: keep what we had (possibly nothing yet).
      this.reuse++;
      if (this.result) this.result.fresh = false;
      return this.result;
    }
    const prevSlot = order & HAS_PREV ? (order >> 2) & 3 : -1;
    const gotPrev = prevSlot >= 0 && this.copySlot(prevSlot, this.prev);
    this.result = {
      fresh: true,
      tick: this.cur.tick,
      alpha,
      cur: this.cur.publish(),
      prev: gotPrev ? this.prev.publish() : null,
    };
    return this.result;
  }

  private alpha(): number {
    i32Scratch[0] = Atomics.load(this.g, G_ALPHA);
    return f32Scratch[0] as number;
  }
}

// ------------------------------------------------------------------------------------------------------------
// postMessage fallback
// ------------------------------------------------------------------------------------------------------------

interface HeldFrame {
  tick: number;
  count: number;
  flags: number;
  side: Record<string, unknown>;
  buf: ArrayBuffer;
}

/** Worker side of the fallback: keeps the last two published snapshots and posts them at the end of the frame. */
export class PmSnapshotSink implements SnapshotWriter {
  private latest: HeldFrame | null = null;
  private prev: HeldFrame | null = null;
  private alpha = 0;
  private readonly scratch = new ArrayBuffer(RECORDS_BYTES);

  constructor(private readonly post: (payload: PmSnapshotPayload, transfer: ArrayBuffer[]) => void) {}

  write(tick: number, fill: (view: DataView, max: number) => number, side: Record<string, unknown> = {}, flags = 0): void {
    const count = fill(new DataView(this.scratch), REC_MAX);
    this.prev = this.latest;
    this.latest = { tick, count, flags, side: JSON.parse(JSON.stringify(side)) as Record<string, unknown>, buf: this.scratch.slice(0, count * REC_BYTES) };
  }

  setAlpha(alpha: number): void {
    f32Scratch[0] = alpha;
    this.alpha = f32Scratch[0] as number; // same f32 rounding as the SAB path
  }

  endFrame(): void {
    // Posted every frame, even when no tick ran, because alpha moves with the accumulator.
    if (!this.latest) return;
    const copy = (f: HeldFrame): SnapshotFramePayload => ({ tick: f.tick, count: f.count, flags: f.flags, side: f.side, buf: f.buf.slice(0) });
    const cur = copy(this.latest);
    const prev = this.prev ? copy(this.prev) : null;
    this.post({ tick: cur.tick, alpha: this.alpha, cur, prev }, prev ? [cur.buf, prev.buf] : [cur.buf]);
  }
}

/** Main side of the fallback: remembers the newest posted snapshot. */
export class PmSnapshotReader implements SnapshotReader {
  reuse = 0;
  private latest: PmSnapshotPayload | null = null;
  private delivered = -1;
  private result: SnapshotRead | null = null;

  push(p: PmSnapshotPayload): void {
    if (!this.latest || p.tick >= this.latest.tick) this.latest = p;
  }

  read(): SnapshotRead | null {
    const p = this.latest;
    if (!p) {
      this.reuse++;
      return null;
    }
    if (p.tick === this.delivered && this.result) {
      this.reuse++;
      this.result.fresh = false;
      this.result.alpha = p.alpha;
      return this.result;
    }
    this.delivered = p.tick;
    const frame = (f: SnapshotFramePayload): SnapshotFrame => ({ tick: f.tick, count: f.count, flags: f.flags, side: f.side, records: new Uint8Array(f.buf, 0, f.count * REC_BYTES) });
    this.result = { fresh: true, tick: p.tick, alpha: p.alpha, cur: frame(p.cur), prev: p.prev ? frame(p.prev) : null };
    return this.result;
  }
}

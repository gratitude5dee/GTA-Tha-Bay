/**
 * Single-producer single-consumer byte ring over a SharedArrayBuffer. Used for the command ring (main to worker) and,
 * through `EventRing`, for the event ring (worker to main).
 *
 * Layout: an 8-word Int32 header, then `capacity` bytes of data. Positions are free-running u32 byte counters; the
 * data index is `pos & (capacity - 1)`, so capacity is a power of two. A message is a u32 little-endian length followed
 * by that many payload bytes, and may wrap around the end of the data area.
 *
 * Header words: 0 write position, 1 read position, 2 dropped-message count, 3 capacity.
 */
const W_WRITE = 0;
const W_READ = 1;
const W_DROPPED = 2;
const W_CAPACITY = 3;
const HEADER_WORDS = 8;
const HEADER_BYTES = HEADER_WORDS * 4;

export class SpscRing {
  readonly header: Int32Array;
  private readonly data: Uint8Array;
  readonly capacity: number;

  /** Bytes a ring of `capacity` data bytes occupies in its SharedArrayBuffer. */
  static byteLength(capacity: number): number {
    return HEADER_BYTES + capacity;
  }

  /** Initialize a fresh buffer. Call once, on the side that creates it. */
  static init(buffer: SharedArrayBuffer, capacity: number): void {
    if (capacity < 64 || (capacity & (capacity - 1)) !== 0) throw new RangeError('ring capacity must be a power of two >= 64');
    if (buffer.byteLength < SpscRing.byteLength(capacity)) throw new RangeError('ring buffer is too small');
    const h = new Int32Array(buffer, 0, HEADER_WORDS);
    h.fill(0);
    h[W_CAPACITY] = capacity;
  }

  constructor(buffer: SharedArrayBuffer) {
    this.header = new Int32Array(buffer, 0, HEADER_WORDS);
    this.capacity = Atomics.load(this.header, W_CAPACITY);
    if (this.capacity < 64) throw new RangeError('ring buffer was not initialized');
    this.data = new Uint8Array(buffer, HEADER_BYTES, this.capacity);
  }

  /** Messages refused for lack of space since creation. */
  get dropped(): number {
    return Atomics.load(this.header, W_DROPPED) >>> 0;
  }

  /** Free-running write position; waiters use it with `Atomics.waitAsync(header, 0, observed)`. */
  get writePos(): number {
    return Atomics.load(this.header, W_WRITE) >>> 0;
  }

  get readPos(): number {
    return Atomics.load(this.header, W_READ) >>> 0;
  }

  get pending(): boolean {
    return this.writePos !== this.readPos;
  }

  /** Producer side. Returns false (and counts a drop) when the message does not fit; never blocks. */
  push(payload: Uint8Array): boolean {
    const need = 4 + payload.length;
    if (need > this.capacity >>> 1) throw new RangeError(`ring message of ${payload.length} bytes is too large`);
    const write = this.writePos;
    const read = this.readPos;
    const used = (write - read) >>> 0;
    if (this.capacity - used < need) {
      Atomics.add(this.header, W_DROPPED, 1);
      return false;
    }
    this.copyIn(write, lengthBytes(payload.length));
    this.copyIn((write + 4) >>> 0, payload);
    Atomics.store(this.header, W_WRITE, (write + need) | 0);
    Atomics.notify(this.header, W_WRITE);
    return true;
  }

  /** Consumer side. Returns the next message's bytes, or null when the ring is empty. */
  pop(): Uint8Array | null {
    const read = this.readPos;
    const write = this.writePos;
    if (write === read) return null;
    const len = readLength(this.copyOut(read, 4));
    const payload = this.copyOut((read + 4) >>> 0, len);
    Atomics.store(this.header, W_READ, (read + 4 + len) | 0);
    return payload;
  }

  private copyIn(pos: number, bytes: Uint8Array): void {
    const mask = this.capacity - 1;
    const start = pos & mask;
    const first = Math.min(bytes.length, this.capacity - start);
    this.data.set(bytes.subarray(0, first), start);
    if (first < bytes.length) this.data.set(bytes.subarray(first), 0);
  }

  private copyOut(pos: number, len: number): Uint8Array {
    const mask = this.capacity - 1;
    const start = pos & mask;
    const out = new Uint8Array(len);
    const first = Math.min(len, this.capacity - start);
    out.set(this.data.subarray(start, start + first), 0);
    if (first < len) out.set(this.data.subarray(0, len - first), first);
    return out;
  }
}

function lengthBytes(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function readLength(b: Uint8Array): number {
  return ((b[0] as number) | ((b[1] as number) << 8) | ((b[2] as number) << 16) | ((b[3] as number) << 24)) >>> 0;
}

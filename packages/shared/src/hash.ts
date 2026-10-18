/**
 * Hashes for sim and content code (M01a1). Pure, synchronous, no IO.
 *
 * - fnv32: FNV-1a 32 bit over UTF-8 bytes (stream names, rateDivisor offsets).
 * - Fnv64: incremental FNV-1a 64 bit kept as two u32 lanes, Math.imul only (C02 rule 7 stateHash).
 * - sha256Hex: FNV is not collision resistant; content and cache keys use SHA-256 (C07, C09).
 *
 * Strings are always hashed as UTF-8. Lone surrogates encode as U+FFFD, like TextEncoder.
 */

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

/** UTF-8 encode without TextEncoder (sim code has no DOM or Node types). */
export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return Uint8Array.from(out);
}

/** FNV-1a 32 bit. Returns an unsigned 32 bit integer. */
export function fnv32(input: string | Uint8Array): number {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
  let h = FNV32_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ (bytes[i] as number), FNV32_PRIME);
  }
  return h >>> 0;
}

// Scratch aliases for float bit patterns. The sim runs on little-endian hardware only (every browser and Node
// target); the check below makes a big-endian host fail at load instead of hashing differently.
const F64 = new Float64Array(1);
const U32_OF_F64 = new Uint32Array(F64.buffer);
const F32 = new Float32Array(1);
const U32_OF_F32 = new Uint32Array(F32.buffer);
F64[0] = 1;
if (U32_OF_F64[1] !== 0x3ff00000 || U32_OF_F64[0] !== 0) {
  throw new Error('@dv/shared hash: little-endian platform required');
}

/** Canonical quiet NaN bits, as feeders write them. */
export const CANONICAL_NAN_HI = 0x7ff80000;
export const CANONICAL_NAN_F32 = 0x7fc00000;

/**
 * Incremental FNV-1a 64 bit. Lanes are `hi` and `lo` (u32). The prime is 2^40 + 0x1b3, so one byte step is
 * h = (h ^ byte) * 0x1b3 + (h << 40) mod 2^64, computed with 16-bit partial products (all exact in doubles).
 */
export class Fnv64 {
  hi = 0xcbf29ce4;
  lo = 0x84222325;
  /** Number of NaN values fed through f32/f64 (a bug signal for stateHash callers). */
  nanCount = 0;

  reset(): this {
    this.hi = 0xcbf29ce4;
    this.lo = 0x84222325;
    this.nanCount = 0;
    return this;
  }

  /** Feed one byte (0..255). */
  u8(b: number): this {
    const lo = (this.lo ^ (b & 0xff)) >>> 0;
    const hi = this.hi;
    const p = lo * 0x1b3; // < 2^41, exact
    const carry = Math.floor(p / 4294967296);
    this.lo = p >>> 0;
    this.hi = (Math.imul(hi, 0x1b3) + carry + (lo << 8)) >>> 0;
    return this;
  }

  /** Feed a u32 as four little-endian bytes. */
  u32(v: number): this {
    this.u8(v & 0xff);
    this.u8((v >>> 8) & 0xff);
    this.u8((v >>> 16) & 0xff);
    this.u8((v >>> 24) & 0xff);
    return this;
  }

  /** Feed a float32 as its bit pattern; -0 becomes 0 and every NaN the canonical NaN. */
  f32(v: number): this {
    if (v !== v) {
      this.nanCount++;
      return this.u32(CANONICAL_NAN_F32);
    }
    F32[0] = v === 0 ? 0 : v;
    return this.u32(U32_OF_F32[0] as number);
  }

  /** Feed a float64 as two u32 words (low word first); -0 becomes 0 and every NaN the canonical NaN. */
  f64(v: number): this {
    if (v !== v) {
      this.nanCount++;
      this.u32(0);
      return this.u32(CANONICAL_NAN_HI);
    }
    F64[0] = v === 0 ? 0 : v;
    this.u32(U32_OF_F64[0] as number);
    return this.u32(U32_OF_F64[1] as number);
  }

  /** Feed the UTF-8 bytes of a string, then a 0xff terminator (so "ab","c" differs from "a","bc"). */
  str(s: string): this {
    const b = utf8Bytes(s);
    for (let i = 0; i < b.length; i++) this.u8(b[i] as number);
    return this.u8(0xff);
  }

  /** Feed raw bytes (no terminator). */
  bytes(b: Uint8Array): this {
    for (let i = 0; i < b.length; i++) this.u8(b[i] as number);
    return this;
  }

  /** 16 lowercase hex digits, hi lane first. */
  hex(): string {
    return hex32(this.hi) + hex32(this.lo);
  }
}

const HEX = '0123456789abcdef';

/** Eight lowercase hex digits of a u32. */
export function hex32(v: number): string {
  let s = '';
  for (let shift = 28; shift >= 0; shift -= 4) s += HEX.charAt((v >>> shift) & 15);
  return s;
}

/** FNV-1a 64 bit over bytes or a UTF-8 string, as 16 lowercase hex digits. */
export function fnv64Hex(input: string | Uint8Array): string {
  const h = new Fnv64();
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
  return h.bytes(bytes).hex();
}

// SHA-256 (FIPS 180-4).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Pure synchronous SHA-256, lowercase hex. Strings are hashed as UTF-8. */
export function sha256Hex(input: string | Uint8Array): string {
  const data = typeof input === 'string' ? utf8Bytes(input) : input;
  const len = data.length;
  const padded = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(padded);
  buf.set(data);
  buf[len] = 0x80;
  const bitsHi = Math.floor(len / 0x20000000);
  const bitsLo = (len << 3) >>> 0;
  const end = padded - 8;
  buf[end] = (bitsHi >>> 24) & 0xff;
  buf[end + 1] = (bitsHi >>> 16) & 0xff;
  buf[end + 2] = (bitsHi >>> 8) & 0xff;
  buf[end + 3] = bitsHi & 0xff;
  buf[end + 4] = (bitsLo >>> 24) & 0xff;
  buf[end + 5] = (bitsLo >>> 16) & 0xff;
  buf[end + 6] = (bitsLo >>> 8) & 0xff;
  buf[end + 7] = bitsLo & 0xff;

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (((buf[j] as number) << 24) | ((buf[j + 1] as number) << 16) | ((buf[j + 2] as number) << 8) | (buf[j + 3] as number)) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return hex32(h0 >>> 0) + hex32(h1 >>> 0) + hex32(h2 >>> 0) + hex32(h3 >>> 0)
    + hex32(h4 >>> 0) + hex32(h5 >>> 0) + hex32(h6 >>> 0) + hex32(h7 >>> 0);
}

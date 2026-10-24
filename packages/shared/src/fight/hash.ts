// packages/shared/src/fight/hash.ts — the match hash (FNV-1a-64 lanes over every buffer word but the presentation counter)
// and the two xoshiro128** states kept inside the buffer (`fight`, `cpu`; FC1.6).
import { Fnv64, fnv32 } from '../hash.ts';
import { Rng, splitmix32 } from '../rng.ts';
import { HASH_SKIP_WORD } from './buffer.ts';

const H = new Fnv64();

/** [lo, hi] u32 lanes over every word of the buffer except FM.Reserved (events emitted, a presentation counter). */
export function hashBuffer(buf: Int32Array): [number, number] {
  H.reset();
  for (let i = 0; i < buf.length; i++) if (i !== HASH_SKIP_WORD) H.u32(buf[i] as number);
  return [H.lo >>> 0, H.hi >>> 0];
}

/** `lo` and `hi` as one 16-digit lowercase hex string (hi lane first). */
export function hashHex(h: readonly [number, number]): string {
  const x = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');
  return x(h[1]) + x(h[0]);
}

/** Seed the 4-word generator at `base` as splitmix32(seed ^ fnv32(name)) expanded by `Rng` (C02 rule 3). */
export function rngSeed(buf: Int32Array, base: number, seed: number, name: string): void {
  const r = new Rng(splitmix32((seed ^ fnv32(name)) | 0));
  const s = r.getState();
  for (let i = 0; i < 4; i++) buf[base + i] = (s[i] as number) | 0;
}

function rotl(x: number, k: number): number { return (x << k) | (x >>> (32 - k)); }

/** Next u32 of the generator at `base` (same xoshiro128** step as `Rng.nextU32`). */
export function rngNext(buf: Int32Array, base: number): number {
  let s0 = buf[base] as number, s1 = buf[base + 1] as number, s2 = buf[base + 2] as number, s3 = buf[base + 3] as number;
  const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = s1 << 9;
  s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
  buf[base] = s0; buf[base + 1] = s1; buf[base + 2] = s2; buf[base + 3] = s3;
  return result;
}

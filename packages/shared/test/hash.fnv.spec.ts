import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Fnv64, Rng, fnv32, fnv64Hex, utf8Bytes } from '../src/index.ts';

const MASK64 = 0xffffffffffffffffn;
function refFnv32(b: Uint8Array): number {
  let h = 0x811c9dc5n;
  for (const x of b) h = ((h ^ BigInt(x)) * 0x01000193n) & 0xffffffffn;
  return Number(h);
}
function refFnv64(b: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  for (const x of b) h = ((h ^ BigInt(x)) * 0x100000001b3n) & MASK64;
  return h.toString(16).padStart(16, '0');
}

describe('FNV-1a', () => {
  it('matches the published test vectors', () => {
    expect(fnv32('')).toBe(0x811c9dc5);
    expect(fnv32('a')).toBe(0xe40c292c);
    expect(fnv32('foobar')).toBe(0xbf9cf968);
    expect(fnv64Hex('')).toBe('cbf29ce484222325');
    expect(fnv64Hex('a')).toBe('af63dc4c8601ec8c');
    expect(fnv64Hex('foobar')).toBe('85944171f73967e8');
  });

  it('fnv32 and Fnv64 equal a BigInt reference on 10,000 seeded random byte strings (length 0..4096)', () => {
    const rng = new Rng(0xf17);
    for (let i = 0; i < 10000; i++) {
      const len = rng.nextU32() % 4097;
      const b = new Uint8Array(len);
      for (let j = 0; j < len; j++) b[j] = rng.nextU32() & 0xff;
      expect(fnv32(b), `fnv32 case ${i}`).toBe(refFnv32(b));
      expect(new Fnv64().bytes(b).hex(), `fnv64 case ${i}`).toBe(refFnv64(b));
    }
  });

  it('strings are hashed as UTF-8', () => {
    for (const s of ['café', '\u{1f309} bridge', 'Tha Bay', '\ud800 lone']) {
      const bytes = utf8Bytes(s);
      expect(fnv32(s)).toBe(refFnv32(bytes));
      expect(fnv64Hex(s)).toBe(refFnv64(bytes));
    }
    expect(Array.from(utf8Bytes('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8Bytes('\u{1f309}'))).toEqual([0xf0, 0x9f, 0x8c, 0x89]);
    expect(Array.from(utf8Bytes('\ud800'))).toEqual([0xef, 0xbf, 0xbd]);
  });

  it('feeders: u32 is four little-endian bytes, f32/f64 hash bit patterns, -0 equals 0, NaN is canonical', () => {
    const bytesOf = (...b: number[]): string => new Fnv64().bytes(Uint8Array.from(b)).hex();
    expect(new Fnv64().u32(0x04030201).hex()).toBe(bytesOf(1, 2, 3, 4));
    expect(new Fnv64().f32(1.5).hex()).toBe(bytesOf(0, 0, 0xc0, 0x3f));
    expect(new Fnv64().f64(1).hex()).toBe(bytesOf(0, 0, 0, 0, 0, 0, 0xf0, 0x3f));
    expect(new Fnv64().f64(-0).hex()).toBe(new Fnv64().f64(0).hex());
    expect(new Fnv64().f32(-0).hex()).toBe(new Fnv64().f32(0).hex());
    const nan = new Fnv64();
    nan.f64(NaN).f32(NaN);
    expect(nan.hex()).toBe(bytesOf(0, 0, 0, 0, 0, 0, 0xf8, 0x7f, 0, 0, 0xc0, 0x7f));
    expect(nan.nanCount).toBe(2);
    expect(new Fnv64().str('ab').str('c').hex()).not.toBe(new Fnv64().str('a').str('bc').hex());
  });

  it('equals the frozen golden values in fnv.v1.json', () => {
    const g = JSON.parse(readFileSync(new URL('./golden/fnv.v1.json', import.meta.url), 'utf8')) as {
      strings: { text?: string; repeat?: { ch: string; n: number }; fnv32: number; fnv64: string }[];
      feeders: { hex: string; nanCount: number };
    };
    for (const e of g.strings) {
      const text = e.text ?? (e.repeat ? e.repeat.ch.repeat(e.repeat.n) : '');
      expect(fnv32(text)).toBe(e.fnv32);
      expect(fnv64Hex(text)).toBe(e.fnv64);
    }
    const h = new Fnv64();
    h.u8(1).u32(0xdeadbeef).f32(1.5).f32(-0).f64(Math.PI).f64(-0).f64(NaN).str('ab').str('c');
    expect(h.hex()).toBe(g.feeders.hex);
    expect(h.nanCount).toBe(g.feeders.nanCount);
  });
});

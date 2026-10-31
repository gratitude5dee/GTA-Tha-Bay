/**
 * M02h3 AC-3: the ground cover codec (section 21 LANDUSE, C08 1.1). Random grids round-trip exactly; on the `synth` bake every l0 pack's
 * cover re-encodes to the same bytes, `decodeL0` gives the same chunks with and without section 21, a pack without it decodes to all
 * `None`, the world index is C08 1.1, and a 1.0 index skips the cover codes (classes above 16).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVER_CELLS, COVER_CODE_BASE, COVER_RECORD_BYTES, CoverClass, coverCounts, coverRects, decodeCover, decodeCoverSection, decodeCoverTile,
  decodeL0, decodeP0, encodeCoverRects, packSections, readHeader, readsCover,
  type ChunkKey,
} from '../src/index.ts';
import { encodeL0 } from '../../../tools/map/src/pack/encode.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

/** A small seeded LCG (tests only). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomCover(seed: number, patchy: boolean): Uint8Array {
  const r = lcg(seed);
  const out = new Uint8Array(COVER_CELLS);
  if (!patchy) {
    for (let k = 0; k < COVER_CELLS; k++) out[k] = Math.floor(r() * 8);
    return out;
  }
  // blocks of one class, like a real chunk
  for (let n = 0; n < 40; n++) {
    const c = Math.floor(r() * 8), i0 = Math.floor(r() * 64), j0 = Math.floor(r() * 64), w = 1 + Math.floor(r() * 24), h = 1 + Math.floor(r() * 24);
    for (let j = j0; j < Math.min(64, j0 + h); j++) for (let i = i0; i < Math.min(64, i0 + w); i++) out[j * 64 + i] = c;
  }
  return out;
}

describe('cover codec: rectangles', () => {
  it('round-trips random grids exactly, noisy and patchy', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cover = randomCover(seed, seed % 2 === 0);
      const s = encodeCoverRects(cover);
      expect(s.data.length).toBe(s.count * COVER_RECORD_BYTES);
      expect(Buffer.from(decodeCoverSection(s.data, s.count)).equals(Buffer.from(cover)), `seed ${seed}`).toBe(true);
      // identical input, identical bytes
      expect(Buffer.from(encodeCoverRects(cover).data).equals(Buffer.from(s.data))).toBe(true);
    }
  });

  it('merges runs across rows: one class everywhere is one rectangle, none is no record', () => {
    expect(coverRects(new Uint8Array(COVER_CELLS).fill(CoverClass.Yard))).toEqual([{ cls: 1, i0: 0, j0: 0, i1: 64, j1: 64 }]);
    expect(encodeCoverRects(new Uint8Array(COVER_CELLS)).count).toBe(0);
    const stripe = new Uint8Array(COVER_CELLS);
    for (let j = 10; j < 20; j++) for (let i = 3; i < 9; i++) stripe[j * 64 + i] = CoverClass.Driveway;
    expect(coverRects(stripe)).toEqual([{ cls: 4, i0: 3, j0: 10, i1: 9, j1: 20 }]);
  });

  it('writes the C08 section 4 record: class 16 + CoverClass, n = 4, decimetre corners from the chunk NW corner', () => {
    const one = new Uint8Array(COVER_CELLS);
    one[2 * 64 + 5] = CoverClass.Scrub;
    const s = encodeCoverRects(one);
    const dv = new DataView(s.data.buffer);
    expect(s.count).toBe(1);
    expect(dv.getUint8(0)).toBe(COVER_CODE_BASE + CoverClass.Scrub);
    expect(dv.getUint8(1)).toBe(4);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => dv.getInt16(2 + k * 2, true))).toEqual([200, 80, 240, 80, 240, 120, 200, 120]);
  });

  it('reads past the C08 1.0 classes of the section and skips every cover code for a 1.0 index', () => {
    const cover = randomCover(7, true);
    const s = encodeCoverRects(cover);
    // a 1.0 park polygon (class 1, a triangle) ahead of the cover records
    const park = new Uint8Array(2 + 3 * 4);
    const pv = new DataView(park.buffer);
    pv.setUint8(0, 1); pv.setUint8(1, 3);
    [0, 0, 400, 0, 0, 400].forEach((v, k) => pv.setInt16(2 + k * 2, v, true));
    const both = new Uint8Array(park.length + s.data.length);
    both.set(park, 0);
    both.set(s.data, park.length);
    expect(Buffer.from(decodeCoverSection(both, s.count + 1)).equals(Buffer.from(cover))).toBe(true);
    expect(decodeCoverSection(both, s.count + 1, '1.0.0').every((v) => v === 0)).toBe(true);
    expect(readsCover('1.0.0')).toBe(false);
    expect(readsCover('1.1.0')).toBe(true);
    expect(readsCover('2.0.0')).toBe(true);
    expect(() => decodeCoverSection(both.subarray(0, both.length - 3), s.count + 1)).toThrow(RangeError);
  });

  it('counts cells per class', () => {
    const c = new Uint8Array(COVER_CELLS);
    c.fill(CoverClass.Park, 0, 100);
    c.fill(CoverClass.Mixed, 100, 130);
    expect(coverCounts(c)).toEqual([COVER_CELLS - 130, 0, 0, 30, 0, 0, 0, 100]);
  });
});

describe('cover codec on the synth bake', () => {
  const bake = requireBake('synth', 'world.cover-codec');

  it('the world index is C08 1.1', () => {
    if (!bake) return;
    const index = JSON.parse(readFileSync(path.join(bake.dir, 'world-index.json'), 'utf8')) as { c08: string };
    expect(index.c08).toBe('1.1.0');
  });

  it('every l0 pack: the cover re-encodes to the same bytes, decodeL0 is the same without section 21, and without it the cover is all None', () => {
    if (!bake) return;
    const names = readdirSync(path.join(bake.dir, 'packs')).filter((f) => f.startsWith('l0-')).sort();
    expect(names.length).toBeGreaterThan(0);
    const totals = new Array<number>(8).fill(0);
    // every fourth tile keeps the case quick; the bake test (tools/map) covers the rest through the gate counts
    for (const name of names.filter((_, i) => i % 4 === 0)) {
      const l0 = new Uint8Array(readFileSync(path.join(bake.dir, 'packs', name)));
      const p0 = decodeP0(new Uint8Array(readFileSync(path.join(bake.dir, 'packs', name.replace('l0-', 'p0-')))));
      const h = readHeader(l0);
      const covers = decodeCoverTile(l0);
      const sections = packSections(l0, 21);
      expect(sections.every((s) => s.bytes !== null), `${name} has section 21 in every chunk`).toBe(true);
      for (const [key, cv] of covers) {
        expect(Buffer.from(decodeCover(l0, key)).equals(Buffer.from(cv))).toBe(true);
        coverCounts(cv).forEach((n, i) => { totals[i] = (totals[i] as number) + n; });
      }
      const header = { tileX: h.tileX, tileY: h.tileY, hostZ: h.hostZ, bakeId: h.bakeId };
      const chunks = decodeL0(l0, p0);
      expect(Buffer.from(encodeL0(chunks, header, covers)).equals(Buffer.from(l0)), `${name} re-encodes byte for byte`).toBe(true);
      const without = encodeL0(chunks, header);
      expect(without.length).toBeLessThan(l0.length);
      expect(decodeL0(without, p0)).toEqual(chunks);
      for (const s of packSections(without, 21)) {
        expect(s.bytes).toBeNull();
        expect(decodeCover(without, s.key as ChunkKey).every((v) => v === 0)).toBe(true);
      }
    }
    expect(totals.slice(1).some((n) => n > 0)).toBe(true);
  });
});

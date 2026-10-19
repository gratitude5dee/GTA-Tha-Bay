import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIR_ENTRY_BYTES, SECTION_ENTRY_BYTES, TERRAIN_POSTS, readHeader } from '../../../packages/shared/src/index.ts';
import { CARD_COUNT, FAR_MAGIC } from '../src/stages/s11-far.ts';
import { L1, L2, SEC_HEIGHT, SEC_LANDUSE, SEC_MASSING, SEC_ROADLINE } from '../src/stages/s11-lod.ts';
import { bakeExcerpt } from './helpers.ts';

interface Sec { id: number; count: number; bytes: number }

/** The sections of every chunk entry of a pack, read from the directory (header, directory, section tables). */
function sectionsOf(buf: Uint8Array): Sec[][] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const h = readHeader(buf);
  const out: Sec[][] = [];
  for (let i = 0; i < h.chunkCount; i++) {
    const at = h.dirOffset + i * DIR_ENTRY_BYTES;
    const n = dv.getUint16(at + 2, true), off = dv.getUint32(at + 4, true);
    const l: Sec[] = [];
    for (let s = 0; s < n; s++) {
      const e = off + s * SECTION_ENTRY_BYTES;
      l.push({ id: dv.getUint8(e), count: dv.getUint16(e + 2, true), bytes: dv.getUint32(e + 8, true) });
    }
    out.push(l);
  }
  return out;
}

describe('S11 l1 and l2 packs on the civic-excerpt', () => {
  it('writes l1 packs on 1,024 m units (host z5) and l2 packs on 4,096 m units (host z3), each under 4 MiB', async () => {
    const b = await bakeExcerpt();
    const files = readdirSync(path.join(b.outDir, 'packs'));
    const l1 = files.filter((f) => f.startsWith('l1-')), l2 = files.filter((f) => f.startsWith('l2-'));
    expect(l1.length).toBe((b.report['lod'] as unknown as { l1Packs: number }).l1Packs);
    expect(l2.length).toBe((b.report['lod'] as unknown as { l2Packs: number }).l2Packs);
    expect(l1.length).toBeGreaterThan(0);
    for (const [names, lv, family] of [[l1, L1, 2], [l2, L2, 3]] as const) {
      for (const name of names) {
        const buf = readFileSync(path.join(b.outDir, 'packs', name));
        expect(buf.byteLength).toBeLessThan(4 * 1024 * 1024);
        const h = readHeader(buf);
        expect(h.family).toBe(family);
        expect(h.hostZ).toBe(lv.hostZ);
        expect(h.bakeId).toBe(b.result.bakeId);
        expect(name).toBe(`${names === l1 ? 'l1' : 'l2'}-${h.tileX}-${h.tileY}.pack`);
      }
    }
  });

  it('gives every unit a height section with 65 x 65 posts and massing, road-line and land-use sections', async () => {
    const b = await bakeExcerpt();
    let massing = 0, lines = 0;
    for (const name of readdirSync(path.join(b.outDir, 'packs')).filter((f) => /^l[12]-/.test(f))) {
      for (const secs of sectionsOf(readFileSync(path.join(b.outDir, 'packs', name)))) {
        expect(secs.map((s) => s.id).sort((a, c) => a - c)).toEqual([SEC_HEIGHT, SEC_MASSING, SEC_ROADLINE, SEC_LANDUSE].sort((a, c) => a - c));
        expect(secs.find((s) => s.id === SEC_HEIGHT)!.bytes).toBe(TERRAIN_POSTS * TERRAIN_POSTS * 2);
        massing += secs.find((s) => s.id === SEC_MASSING)!.count;
        lines += secs.find((s) => s.id === SEC_ROADLINE)!.count;
      }
    }
    const rep = b.report['lod'] as unknown as { l1Massing: number; l2Massing: number; roadLines: number };
    expect(massing).toBe(rep.l1Massing + rep.l2Massing);
    expect(lines).toBe(rep.roadLines);
    expect(massing).toBeGreaterThan(0);
    expect(lines).toBeGreaterThan(0);
  });

  it('keeps only taller buildings at l2 than at l1 (massing at least 20 m, l1 from 6 m)', () => {
    expect(L1.minHeightDm).toBe(60);
    expect(L2.minHeightDm).toBe(200);
    expect(L2.roadMaxCls).toBeLessThan(L1.roadMaxCls);
    expect(L1.postM * (TERRAIN_POSTS - 1)).toBe(L1.unitM);
    expect(L2.postM * (TERRAIN_POSTS - 1)).toBe(L2.unitM);
  });
});

describe('S11 far-bay packs on the civic-excerpt', () => {
  it('writes the DEM and massing packs with the far magic, the bakeId and a placeholder card atlas', async () => {
    const b = await bakeExcerpt();
    for (const [name, kind] of [['far-bay-dem.pack', 1], ['far-bay-massing.pack', 2]] as const) {
      const buf = readFileSync(path.join(b.outDir, 'packs', name));
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      expect(dv.getUint32(0, true)).toBe(FAR_MAGIC);
      expect(dv.getUint8(5)).toBe(kind);
      expect(Buffer.from(buf.subarray(8, 40)).toString('hex')).toBe(b.result.bakeId);
      expect(buf.byteLength).toBeLessThan(4 * 1024 * 1024);
    }
    const png = readFileSync(path.join(b.outDir, 'packs', 'far-bay-cards.png'));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const far = b.report['far'] as unknown as { cards: number; boxes: number; demPosts: number };
    expect(far.cards).toBe(CARD_COUNT);
    expect(far.demPosts).toBeGreaterThan(0);
  });
});

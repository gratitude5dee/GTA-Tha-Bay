/** M10d2 AC-4: the skyline cards of bake S11 come from the software silhouette rasterizer as a reproducible 2048 x 1024 KTX2. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLOR_MODEL_ETC1S, readKtx2 } from '../../assets/src/import/texture-set.ts';
import { clusterBoxes, rasterAtlas, rasterCard, type CardCluster } from '../src/far/raster.ts';
import { CARD_COUNT, cardsRaster, encodeCards, loadBackdrop, type DemGrid } from '../src/stages/s11-far.ts';
import { bakeExcerpt } from './helpers.ts';

const MiB = 1024 * 1024;

/** A DEM of 256 m posts with one hill under the first cluster, and the rest water. */
function grid(): DemGrid {
  const nx = 200, nz = 120, cellM = 256, minX = -20000, minZ = -20000;
  const heights = new Float32Array(nx * nz).fill(-5);
  const land = new Uint8Array(nx * nz);
  const c = loadBackdrop().clusters[1] as CardCluster; // oakland-hills
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cellM, z = minZ + j * cellM;
      const d = Math.hypot(x - c.enu[0], z - c.enu[1]);
      if (d < 3500) {
        heights[j * nx + i] = 400 * (1 - d / 3500) + 5;
        land[j * nx + i] = 1;
      }
    }
  }
  return { minX, minZ, nx, nz, cellM, heights, land };
}

const alpha = (img: { width: number; data: Uint8Array }, x: number, y: number): number => img.data[(y * img.width + x) * 4 + 3] as number;

describe('far-cards: the rasterizer', () => {
  it('draws 24 cards of 256 x 341 px into a 2048 x 1024 atlas, byte-identical across runs', () => {
    const a = cardsRaster(grid());
    const b = cardsRaster(grid());
    expect(a.cards).toBe(CARD_COUNT);
    expect(a.cards).toBeLessThanOrEqual(24);
    expect([a.atlas.width, a.atlas.height]).toEqual([2048, 1024]);
    expect(Buffer.from(a.atlas.data).equals(Buffer.from(b.atlas.data))).toBe(true);
    // the hill under oakland-hills comes from the DEM; the other clusters fall back to their seeded ridge
    expect(a.demClusters).toBe(1);
  });

  it('keeps the top tenth of every card clear and stands every card on ground in the middle of its base', () => {
    const { atlas } = cardsRaster(grid());
    const cfg = loadBackdrop();
    const [cw, ch] = cfg.atlas.cardPx;
    for (const c of cfg.clusters) {
      for (let row = 0; row < cfg.atlas.rows; row++) {
        const x0 = c.col * cw, y0 = row * ch;
        for (let x = x0; x < x0 + cw; x++) for (let y = y0; y < y0 + Math.floor(ch * 0.09); y++) expect(alpha(atlas, x, y), `${c.id} row ${row} top`).toBe(0);
        expect(alpha(atlas, x0 + cw / 2, y0 + ch - 1), `${c.id} row ${row} base`).toBe(255);
        let opaque = 0;
        for (let x = x0; x < x0 + cw; x++) for (let y = y0; y < y0 + ch; y++) if (alpha(atlas, x, y) === 255) opaque++;
        expect(opaque / (cw * ch), `${c.id} row ${row} coverage`).toBeGreaterThan(0.03);
      }
    }
  });

  it('shows the same cluster differently from the three azimuths (W, SW, NW)', () => {
    const c = loadBackdrop().clusters[0] as CardCluster; // oakland-downtown: towers
    expect(clusterBoxes(c).length).toBe((c.towers ?? 0) + (c.houses ?? 0));
    const flat = (): null => null;
    const [w, sw, nw] = [270, 225, 315].map((az) => Buffer.from(rasterCard(c, az, [256, 341], flat, false).data));
    expect((w as Buffer).equals(sw as Buffer)).toBe(false);
    expect((w as Buffer).equals(nw as Buffer)).toBe(false);
  });

  it('places no card outside its own atlas cell', () => {
    const cfg = loadBackdrop();
    const only = cfg.clusters.slice(0, 1) as CardCluster[];
    const { atlas, cards } = rasterAtlas(only, cfg.atlas, () => null, () => false);
    expect(cards).toBe(3);
    const [cw] = cfg.atlas.cardPx;
    for (let y = 0; y < atlas.height; y += 7) for (let x = cw; x < atlas.width; x += 5) expect(alpha(atlas, x, y)).toBe(0);
  });

  it('encodes the atlas as a byte-identical KTX2 (ETC1S, full mip chain)', async () => {
    const { atlas } = cardsRaster(grid());
    const [k1, k2] = [await encodeCards(atlas), await encodeCards(atlas)];
    expect(Buffer.from(k1).equals(Buffer.from(k2))).toBe(true);
    const info = readKtx2(k1);
    expect(info).toMatchObject({ width: 2048, height: 1024, colorModel: COLOR_MODEL_ETC1S });
    expect(info?.levels).toBe(12);
    expect(k1.byteLength).toBeLessThanOrEqual(4 * MiB);
  }, 120_000);
});

describe('far-cards: the civic-excerpt bake (AC-4)', () => {
  it('writes texture/far-bay-cards as a 2048 x 1024 KTX2 of at most 24 cards and 4 MiB, with a preview PNG', async () => {
    const b = await bakeExcerpt();
    const ktx = new Uint8Array(readFileSync(path.join(b.outDir, 'packs', 'far-bay-cards.ktx2')));
    const info = readKtx2(ktx);
    expect(info).toMatchObject({ width: 2048, height: 1024, colorModel: COLOR_MODEL_ETC1S });
    expect(ktx.byteLength).toBeLessThanOrEqual(4 * MiB);
    const far = b.report['far'] as unknown as { cards: number; cardsBytes: number };
    expect(far.cards).toBeLessThanOrEqual(24);
    expect(far.cardsBytes).toBe(ktx.byteLength);
    expect(readFileSync(path.join(b.outDir, 'far-bay-cards.preview.png')).subarray(1, 4).toString()).toBe('PNG');
  }, 300_000);
});

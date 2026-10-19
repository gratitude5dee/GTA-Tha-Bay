/**
 * Terrarium DEM tiles (AWS Terrain Tiles, Web Mercator PNG): tile maths, decode (h = R*256 + G + B/256 - 32768), fetch,
 * encode (synth) and a mosaic sampler. The bake samples the mosaic on the global 4 m post grid.
 */
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { latLngFromEnu } from '../../../../packages/shared/src/index.ts';
import type { EnuBox } from '../config.ts';
import { fetchBuffer } from './net.ts';

export const TILE_PX = 256;

export const worldPx = (z: number): number => 2 ** z * TILE_PX;
export const pxOfLng = (lng: number, z: number): number => ((lng + 180) / 360) * worldPx(z);
export const pyOfLat = (lat: number, z: number): number => {
  const phi = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * worldPx(z);
};
export const lngOfPx = (px: number, z: number): number => (px / worldPx(z)) * 360 - 180;
export const latOfPy = (py: number, z: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / worldPx(z)))) * 180) / Math.PI;

export interface TileId { z: number; x: number; y: number }
export const tilePath = (t: TileId): string => `${t.z}/${t.x}/${t.y}.png`;
const tileKey = (x: number, y: number): number => x * 1048576 + y;

/** Tiles covering an ENU box (inclusive range; a 1 px margin so bilinear taps at the box edge stay inside). */
export function tilesCovering(box: EnuBox, z: number): TileId[] {
  const nw = latLngFromEnu(box.minX, box.minZ);
  const se = latLngFromEnu(box.maxX, box.maxZ);
  const x0 = Math.floor((pxOfLng(nw.lng, z) - 1) / TILE_PX);
  const x1 = Math.floor((pxOfLng(se.lng, z) + 1) / TILE_PX);
  const y0 = Math.floor((pyOfLat(nw.lat, z) - 1) / TILE_PX);
  const y1 = Math.floor((pyOfLat(se.lat, z) + 1) / TILE_PX);
  const out: TileId[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  return out;
}

export function unionTiles(lists: TileId[][]): TileId[] {
  const seen = new Map<string, TileId>();
  for (const l of lists) for (const t of l) seen.set(tilePath(t), t);
  return [...seen.values()].sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Decodes one Terrarium PNG into metres. */
export function decodeTerrarium(png: Uint8Array): Float32Array {
  const img = PNG.sync.read(Buffer.from(png));
  if (img.width !== TILE_PX || img.height !== TILE_PX) throw new Error(`terrarium tile is ${img.width}x${img.height}, expected 256x256`);
  const out = new Float32Array(TILE_PX * TILE_PX);
  const d = img.data;
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] as number) * 256 + (d[i * 4 + 1] as number) + (d[i * 4 + 2] as number) / 256 - 32768;
  return out;
}

/** Encodes metres into a Terrarium PNG (the synth generator). Heights are quantised to 1/256 m. */
export function encodeTerrarium(h: Float32Array): Buffer {
  const img = new PNG({ width: TILE_PX, height: TILE_PX });
  for (let i = 0; i < h.length; i++) {
    const v = Math.max(0, Math.min(16777215, Math.round(((h[i] as number) + 32768) * 256)));
    img.data[i * 4] = (v >> 16) & 255;
    img.data[i * 4 + 1] = (v >> 8) & 255;
    img.data[i * 4 + 2] = v & 255;
    img.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(img, { colorType: 2, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9 });
}

export async function fetchTile(urlTemplate: string, t: TileId): Promise<Buffer> {
  const url = urlTemplate.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
  return fetchBuffer(url);
}

/** Fetches missing tiles into `dir/<z>/<x>/<y>.png` with limited concurrency; returns the count downloaded. */
export async function fetchTiles(urlTemplate: string, dir: string, tiles: readonly TileId[], log: (l: string) => void, concurrency = 8): Promise<number> {
  const todo = tiles.filter((t) => !existsSync(path.join(dir, tilePath(t))));
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const t = todo[i] as TileId;
      const bytes = await fetchTile(urlTemplate, t);
      decodeTerrarium(bytes); // reject a non-Terrarium body early
      const file = path.join(dir, tilePath(t));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      done++;
      if (done % 50 === 0) log(`map:fetch terrarium: ${done}/${todo.length} tiles`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return done;
}

/** Every `<z>/<x>/<y>.png` under `dir`, sorted. */
export function listTileFiles(dir: string): TileId[] {
  const out: TileId[] = [];
  if (!existsSync(dir)) return out;
  for (const zs of readdirSync(dir)) {
    const z = Number(zs);
    if (!Number.isInteger(z)) continue;
    for (const xs of readdirSync(path.join(dir, zs))) {
      for (const f of readdirSync(path.join(dir, zs, xs))) {
        const m = /^(\d+)\.png$/.exec(f);
        if (m) out.push({ z, x: Number(xs), y: Number(m[1]) });
      }
    }
  }
  return out.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
}

export class TerrariumMosaic {
  missing = 0;
  private readonly tiles = new Map<number, Float32Array>();
  constructor(readonly z: number) {}

  add(x: number, y: number, h: Float32Array): void {
    this.tiles.set(tileKey(x, y), h);
  }
  get tileCount(): number {
    return this.tiles.size;
  }

  /** Height at integer global pixel (gx, gy); NaN-free: a missing tile counts and reads as 0. */
  private px(gx: number, gy: number): number {
    const t = this.tiles.get(tileKey(Math.floor(gx / TILE_PX), Math.floor(gy / TILE_PX)));
    if (!t) {
      this.missing++;
      return 0;
    }
    return t[(gy & 255) * TILE_PX + (gx & 255)] as number;
  }

  /** Bilinear height at fractional global pixel coordinates (pixel centres at +0.5). */
  atPixel(fx: number, fy: number): number {
    const gx = fx - 0.5;
    const gy = fy - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const a = this.px(x0, y0);
    const b = this.px(x0 + 1, y0);
    const c = this.px(x0, y0 + 1);
    const d = this.px(x0 + 1, y0 + 1);
    const n = a + (b - a) * tx;
    const s = c + (d - c) * tx;
    return n + (s - n) * ty;
  }

  /** Height at an ENU point (flat-earth frame of C08 to lat/lng, then Web Mercator pixels). */
  atEnu(x: number, zEnu: number): number {
    const p = latLngFromEnu(x, zEnu);
    return this.atPixel(pxOfLng(p.lng, this.z), pyOfLat(p.lat, this.z));
  }

  /** Heights on the grid xs x zs (row-major, z outer). Column and row pixel coordinates are computed once. */
  sampleGrid(xs: ArrayLike<number>, zs: ArrayLike<number>, out: Float32Array): void {
    const nx = xs.length;
    const cols = new Float64Array(nx);
    for (let i = 0; i < nx; i++) cols[i] = pxOfLng(latLngFromEnu(xs[i] as number, 0).lng, this.z);
    for (let j = 0; j < zs.length; j++) {
      const fy = pyOfLat(latLngFromEnu(0, zs[j] as number).lat, this.z);
      for (let i = 0; i < nx; i++) out[j * nx + i] = this.atPixel(cols[i] as number, fy);
    }
  }
}

/** Loads every tile of zoom `z` found under `dir` (raw/terrarium). */
export function loadMosaic(dir: string, z: number): TerrariumMosaic {
  const m = new TerrariumMosaic(z);
  for (const t of listTileFiles(dir)) {
    if (t.z !== z) continue;
    m.add(t.x, t.y, decodeTerrarium(readFileSync(path.join(dir, tilePath(t)))));
  }
  return m;
}


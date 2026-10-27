/**
 * PNG helpers of the character pipeline (M10a1): crop a sheet into cells, slice a mouth atlas, measure a cell for gate A1, downscale a texture
 * and take the luminance of an image for gate A7. Plain `pngjs`; no native image library.
 */
import { PNG } from 'pngjs';
import type { CellStats } from '../../../services/pipeline/src/steps/gates.ts';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8Array;
}

export function decodePng(bytes: Uint8Array): Raster {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
}

export function encodePng(r: Raster): Uint8Array {
  const png = new PNG({ width: r.width, height: r.height });
  Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength).copy(png.data);
  return new Uint8Array(PNG.sync.write(png));
}

/** Width and height from the IHDR chunk, without decoding the pixels. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('not a PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export function crop(r: Raster, x: number, y: number, w: number, h: number): Raster {
  if (x < 0 || y < 0 || x + w > r.width || y + h > r.height) throw new Error(`crop ${x},${y} ${w}x${h} leaves the ${r.width}x${r.height} image`);
  const out = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const from = ((y + j) * r.width + x) * 4;
    out.set(r.data.subarray(from, from + w * 4), j * w * 4);
  }
  return { width: w, height: h, data: out };
}

/** The cells of a grid in reading order (row by row). Cell size is the floor of the image size over the grid. */
export function sliceGrid(r: Raster, cols: number, rows: number): Raster[] {
  const cw = Math.floor(r.width / cols);
  const ch = Math.floor(r.height / rows);
  const cells: Raster[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push(crop(r, i * cw, j * ch, cw, ch));
  return cells;
}

export function luma(r: Raster): Uint8Array {
  const out = new Uint8Array(r.width * r.height);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = Math.round(0.2126 * (r.data[p] as number) + 0.7152 * (r.data[p + 1] as number) + 0.0722 * (r.data[p + 2] as number));
  }
  return out;
}

/** Measurements of one sheet cell for gate A1: the border deviation and the box of everything that differs from the background. */
export function cellStats(cell: Raster): CellStats {
  const { width: w, height: h, data } = cell;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const inBand = (x: number, y: number): boolean => x < band || y < band || x >= w - band || y >= h - band;
  // Background colour: the mean of the border band.
  let n = 0;
  const sum = [0, 0, 0];
  const lum: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inBand(x, y)) continue;
      const p = (y * w + x) * 4;
      sum[0] = (sum[0] as number) + (data[p] as number);
      sum[1] = (sum[1] as number) + (data[p + 1] as number);
      sum[2] = (sum[2] as number) + (data[p + 2] as number);
      lum.push(0.2126 * (data[p] as number) + 0.7152 * (data[p + 1] as number) + 0.0722 * (data[p + 2] as number));
      n += 1;
    }
  }
  const bg = [(sum[0] as number) / n, (sum[1] as number) / n, (sum[2] as number) / n];
  const meanL = lum.reduce((a, b) => a + b, 0) / lum.length;
  const borderStd = Math.sqrt(lum.reduce((a, b) => a + (b - meanL) * (b - meanL), 0) / lum.length);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const d = Math.max(Math.abs((data[p] as number) - (bg[0] as number)), Math.abs((data[p + 1] as number) - (bg[1] as number)), Math.abs((data[p + 2] as number) - (bg[2] as number)));
      if (d <= 24) continue;
      count += 1;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (count < w * h * 0.005) return { figure: null, borderStd };
  return { figure: { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h }, borderStd };
}

/** Area-average downscale so that the longer edge is at most `maxEdge`; an image already within the cap is returned as is. */
export function limitEdge(r: Raster, maxEdge: number): Raster {
  const longest = Math.max(r.width, r.height);
  if (longest <= maxEdge) return r;
  const s = maxEdge / longest;
  const w = Math.max(1, Math.round(r.width * s));
  const h = Math.max(1, Math.round(r.height * s));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * r.height) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * r.height) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * r.width) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * r.width) / w));
      const acc = [0, 0, 0, 0];
      let c = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const p = (sy * r.width + sx) * 4;
          for (let k = 0; k < 4; k++) acc[k] = (acc[k] as number) + (r.data[p + k] as number);
          c += 1;
        }
      }
      for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = Math.round((acc[k] as number) / c);
    }
  }
  return { width: w, height: h, data: out };
}

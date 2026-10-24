/**
 * Pure image helpers for the look goldens and the before/after capture (M02e; DL-704): PNG decode and encode with `pngjs`, the
 * golden comparison and a mean absolute difference. No browser, no filesystem.
 *
 * Golden rule (AC-6): per channel |delta| <= 6/255 on at least 99 % of pixels, and the mean |delta| over all channels <= 2/255.
 */
import { PNG } from 'pngjs';

export interface Rgba {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

export const GOLDEN_CHANNEL_TOLERANCE = 6;
export const GOLDEN_MIN_FRACTION = 0.99;
export const GOLDEN_MAX_MEAN = 2;

export function decodePng(bytes: Uint8Array): Rgba {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
}

export function encodePng(img: Rgba): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).copy(png.data);
  return PNG.sync.write(png);
}

export interface Diff {
  width: number;
  height: number;
  /** Share of pixels whose three colour channels are all within the per-channel tolerance (0..1). */
  fractionWithin: number;
  /** Mean |delta| over the colour channels, in 0..255 units. */
  meanAbs: number;
  /** The largest |delta| of any colour channel. */
  maxAbs: number;
}

export function diffImages(a: Rgba, b: Rgba, tolerance = GOLDEN_CHANNEL_TOLERANCE): Diff {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`image sizes differ: ${a.width}x${a.height} against ${b.width}x${b.height}`);
  const n = a.width * a.height;
  let within = 0;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    let ok = true;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((a.data[i * 4 + c] as number) - (b.data[i * 4 + c] as number));
      sum += d;
      if (d > max) max = d;
      if (d > tolerance) ok = false;
    }
    if (ok) within++;
  }
  return { width: a.width, height: a.height, fractionWithin: within / n, meanAbs: sum / (n * 3), maxAbs: max };
}

export function goldenFailures(d: Diff): string[] {
  const out: string[] = [];
  if (d.fractionWithin < GOLDEN_MIN_FRACTION) out.push(`only ${(d.fractionWithin * 100).toFixed(2)} % of pixels within ${GOLDEN_CHANNEL_TOLERANCE}/255 (need ${GOLDEN_MIN_FRACTION * 100} %)`);
  if (d.meanAbs > GOLDEN_MAX_MEAN) out.push(`mean |delta| ${d.meanAbs.toFixed(2)}/255 exceeds ${GOLDEN_MAX_MEAN}/255`);
  return out;
}

/** Mean |delta| over the colour channels as a share of full scale (0..1): the before/after figure of `docs/look`. */
export function meanAbsDifference(a: Rgba, b: Rgba): number {
  return diffImages(a, b).meanAbs / 255;
}

/** Whether two images hold the same bytes. */
export function identical(a: Rgba, b: Rgba): boolean {
  return a.width === b.width && a.height === b.height && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;
}

/** Places `tiles` on a `cols`-wide grid of equal cells (row-major) and returns the sheet. */
export function composeGrid(tiles: readonly Rgba[], cols: number): Rgba {
  const cw = Math.max(...tiles.map((t) => t.width));
  const ch = Math.max(...tiles.map((t) => t.height));
  const rows = Math.ceil(tiles.length / cols);
  const out: Rgba = { width: cw * cols, height: ch * rows, data: new Uint8Array(cw * cols * ch * rows * 4) };
  tiles.forEach((t, k) => {
    const ox = (k % cols) * cw, oy = Math.floor(k / cols) * ch;
    for (let y = 0; y < t.height; y++) {
      const src = y * t.width * 4;
      out.data.set(t.data.subarray(src, src + t.width * 4), ((oy + y) * out.width + ox) * 4);
    }
  });
  return out;
}

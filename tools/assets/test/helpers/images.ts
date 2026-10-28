/**
 * Procedural PNGs for the character-pipeline tests (M10a1): a turnaround sheet of four figures on a flat grey background, a square image
 * with one figure (portrait), and a 3 x 3 atlas. Deterministic; tests only.
 */
import { PNG } from 'pngjs';

export type Rgb = readonly [number, number, number];

function fill(png: PNG, x0: number, y0: number, w: number, h: number, c: Rgb): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = 255;
    }
  }
}

const BACKGROUND: Rgb = [120, 120, 120];

function blank(width: number, height: number): PNG {
  const png = new PNG({ width, height });
  fill(png, 0, 0, width, height, BACKGROUND);
  return png;
}

const encode = (png: PNG): Uint8Array => new Uint8Array(PNG.sync.write(png, { deflateLevel: 1 }));

/** A 2 x 2 sheet; each cell holds one figure with a 20 % margin (a larger `figure` fraction models a cramped one). */
export function sheetPng(width: number, height: number, tone: number, figure = 0.6): Uint8Array {
  const png = blank(width, height);
  const cw = width / 2;
  const ch = height / 2;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const fw = Math.round(cw * figure * 0.5);
      const fh = Math.round(ch * figure);
      fill(png, Math.round(i * cw + (cw - fw) / 2), Math.round(j * ch + (ch - fh) / 2), fw, fh, [tone % 256, i === 0 ? 200 : 30, j === 0 ? 200 : 30]);
    }
  }
  return encode(png);
}

/** A square image with one centred figure. */
export function squarePng(edge: number, tone: number): Uint8Array {
  const png = blank(edge, edge);
  fill(png, Math.round(edge * 0.3), Math.round(edge * 0.1), Math.round(edge * 0.4), Math.round(edge * 0.8), [tone % 256, 140, 60]);
  return encode(png);
}

/** A flat grey sheet with nothing on it. */
export function emptySheetPng(width: number, height: number): Uint8Array {
  return encode(blank(width, height));
}

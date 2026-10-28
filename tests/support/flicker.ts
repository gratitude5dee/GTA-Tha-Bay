/**
 * Flicker measure for the shot pairs of `config/world/look-shots.json` (M02g2, AC-6). Pure: no browser, no filesystem.
 *
 * A pair is two shots 0.05 m apart (`<id>` and `<id>-b`). A surface that is stable moves a little between them; one that sparkles or
 * moires changes pixel by pixel. The measure is the share of pixels that differ by more than 32/255 on some colour channel from every
 * pixel of the other shot within one pixel of them, taken on the 640 x 360 canvas (`flickerShare`). The committed baselines are the
 * figures of the code before the milestone (the parent commit), per project, taken with the same function.
 */
import type { Rgba } from './image-diff.ts';

/** The canvas size of a flicker capture. */
export const FLICKER_VIEWPORT = { width: 640, height: 360 } as const;
/** A pixel counts when any colour channel differs by more than this (of 255). */
export const FLICKER_THRESHOLD = 32;
/** The pair cases and the tier each one runs at. */
export const FLICKER_PAIRS = [
  { id: 'junction-graze', tier: 'desktop' },
  { id: 'civic-hall-graze', tier: 'desktop' },
  { id: 'asphalt-low', tier: 'mobile-low' },
] as const;
export type FlickerPairId = (typeof FLICKER_PAIRS)[number]['id'];
/** The file of the committed baselines. */
export const FLICKER_BASELINE_FILE = 'tests/e2e/golden/look/flicker-baseline.json';

export interface FlickerBaseline {
  $comment: string;
  schema: 'look-flicker-baseline/1';
  viewport: { width: number; height: number };
  threshold: number;
  /** Per project name, then per pair id: the share (0..1) at the parent commit. */
  baselines: Record<string, Record<string, number>>;
}

/** The largest colour-channel difference between pixel `i` of `a` and pixel `j` of `b` (alpha is ignored). */
function pixelDiff(a: Rgba, i: number, b: Rgba, j: number): number {
  const o = i * 4, q = j * 4;
  return Math.max(
    Math.abs((a.data[o] as number) - (b.data[q] as number)),
    Math.abs((a.data[o + 1] as number) - (b.data[q + 1] as number)),
    Math.abs((a.data[o + 2] as number) - (b.data[q + 2] as number)),
  );
}

/** Whether pixel (x, y) of `a` has a pixel of `b` within `reach` of it that is within `threshold` of it on every colour channel. */
function hasMatch(a: Rgba, b: Rgba, x: number, y: number, threshold: number, reach: number): boolean {
  const w = a.width, h = a.height;
  for (let dy = -reach; dy <= reach; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -reach; dx <= reach; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < w && pixelDiff(a, y * w + x, b, yy * w + xx) <= threshold) return true;
    }
  }
  return false;
}

/**
 * The share (0..1) of pixel positions where one shot has a colour the other lacks nearby: some channel of the pixel differs by more than
 * `threshold` from every pixel of the other shot within `reach` pixels (a square window, 1 by default), in either direction. The camera
 * moves 0.05 m between the two shots, which moves a silhouette, a pole or a window edge by a pixel or two: a plain per-pixel difference
 * counts all of those edges (about 0.57 % of the 640 x 360 canvas on the parent commit, BD-M02g2-10) and so measures the parallax, not
 * the sparkle. A pixel with a look-alike one pixel away is the same surface moved; a pixel with none is a texel that changed in place,
 * which is what sparkle is. Moire of a period under three pixels moves by a texel and is not seen, which is the limit of the window.
 */
export function flickerShare(a: Rgba, b: Rgba, threshold = FLICKER_THRESHOLD, reach = 1): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`flicker: image sizes differ: ${a.width}x${a.height} against ${b.width}x${b.height}`);
  const w = a.width, h = a.height;
  let over = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixelDiff(a, y * w + x, b, y * w + x) <= threshold) continue;
      if (!hasMatch(a, b, x, y, threshold, reach) || !hasMatch(b, a, x, y, threshold, reach)) over++;
    }
  }
  return over / (w * h);
}

/** The share of pixels whose largest colour-channel difference between `a` and `b` is above `threshold`, with no search: the parallax is in it. */
export function flickerShareRaw(a: Rgba, b: Rgba, threshold = FLICKER_THRESHOLD): number {
  return flickerShare(a, b, threshold, 0);
}

/**
 * The most a pair may flicker now: half of its committed baseline. A baseline under `floor` (a pair that hardly flickered before) is
 * held to `floor` instead, so measurement noise on a quiet pair does not fail the case.
 */
export function flickerLimit(baseline: number, floor = 0.0005): number {
  return Math.max(baseline * 0.5, floor);
}

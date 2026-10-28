/**
 * Flicker measure for the shot pairs of `config/world/look-shots.json` (M02g2, AC-6). Pure: no browser, no filesystem.
 *
 * A pair is two shots 0.05 m apart (`<id>` and `<id>-b`). A surface that is stable moves a little between them; one that sparkles or
 * moires changes pixel by pixel. The measure is the share of pixels whose largest colour-channel difference exceeds 32/255, taken on
 * the 640 x 360 canvas. The committed baselines are the figures of the code before the milestone (the parent commit), per project.
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

/** The share (0..1) of pixels whose largest colour-channel difference between `a` and `b` is above `threshold`. */
export function flickerShare(a: Rgba, b: Rgba, threshold = FLICKER_THRESHOLD): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`flicker: image sizes differ: ${a.width}x${a.height} against ${b.width}x${b.height}`);
  const n = a.width * a.height;
  let over = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(
      Math.abs((a.data[o] as number) - (b.data[o] as number)),
      Math.abs((a.data[o + 1] as number) - (b.data[o + 1] as number)),
      Math.abs((a.data[o + 2] as number) - (b.data[o + 2] as number)),
    );
    if (d > threshold) over++;
  }
  return over / n;
}

/**
 * The most a pair may flicker now: half of its committed baseline. A baseline under `floor` (a pair that hardly flickered before) is
 * held to `floor` instead, so measurement noise on a quiet pair does not fail the case.
 */
export function flickerLimit(baseline: number, floor = 0.0005): number {
  return Math.max(baseline * 0.5, floor);
}

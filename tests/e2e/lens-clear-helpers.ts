import type { Rgba } from '../support/image-diff.ts';

/**
 * What the lens-clear captures measure (BD-FIX-LENS-CLEAR-01; `world-lens-clear.spec.ts` and the real-city proof of its report): the
 * share of a canvas capture whose pixels are leaf-coloured, that is with a hue in the greens. A crown that crowds a director's lens
 * fills a large share of the frame with it; with the crown gone the street, the sky and the fog are grey, blue or warm.
 */

/** Hue in degrees (0..360), saturation and value (0..1) of an sRGB pixel. */
export function hsvOf(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

/**
 * The greens of a crown: a hue from green-yellow to blue-green, with enough colour to be a hue at all and not near black. The band starts
 * at 80 degrees because two large surfaces of a street sit just under it and are not leaves: the asphalt and the sidewalks of the look
 * are a warm grey (measured at 60 to 68 degrees in the captures of the real city) and a lawn of the ground cover is yellow-green (70 to
 * 76 degrees on the synth world). The crowns in those captures measure 86 to 122 degrees; a green car body falls in the band too.
 */
export const LEAF_HUE_DEG: readonly [number, number] = [80, 170];
export const LEAF_MIN_SATURATION = 0.15;
export const LEAF_MIN_VALUE = 0.08;

export const isLeaf = (r: number, g: number, b: number): boolean => {
  const [h, s, v] = hsvOf(r, g, b);
  return h >= LEAF_HUE_DEG[0] && h <= LEAF_HUE_DEG[1] && s >= LEAF_MIN_SATURATION && v >= LEAF_MIN_VALUE;
};

/** The share (0..1) of the picture's pixels that are leaf-coloured. */
export function leafShare(img: Rgba): number {
  let n = 0;
  const px = img.width * img.height;
  for (let i = 0; i < px; i++) if (isLeaf(img.data[i * 4] as number, img.data[i * 4 + 1] as number, img.data[i * 4 + 2] as number)) n++;
  return px > 0 ? n / px : 0;
}

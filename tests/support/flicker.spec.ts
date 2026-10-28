import { describe, expect, it } from 'vitest';
import { FLICKER_THRESHOLD, flickerLimit, flickerShare, flickerShareRaw } from './flicker.ts';
import type { Rgba } from './image-diff.ts';

const flat = (w: number, h: number, v: number): Rgba => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([v, v, v, 255], i * 4);
  return { width: w, height: h, data };
};

describe('flicker measure (M02g2)', () => {
  it('is 0 for identical images and 1 when every pixel moves past the threshold', () => {
    expect(flickerShare(flat(8, 4, 100), flat(8, 4, 100))).toBe(0);
    expect(flickerShare(flat(8, 4, 100), flat(8, 4, 100 + FLICKER_THRESHOLD + 1))).toBe(1);
  });

  it('counts a pixel only above the threshold, on its largest colour channel, and ignores alpha', () => {
    const a = flat(4, 4, 50);
    const b = flat(4, 4, 50);
    b.data[0] = 50 + FLICKER_THRESHOLD; // exactly at the threshold: not counted
    b.data[4 + 2] = 50 + FLICKER_THRESHOLD + 1; // blue channel over: counted
    b.data[8 + 3] = 0; // alpha only: not counted
    expect(flickerShare(a, b)).toBeCloseTo(1 / 16, 12);
  });

  it('does not count an edge that moved by one pixel, and does count a texel that changed in place', () => {
    // a vertical edge: dark left of column 4, light from column 4 on; the second shot has the edge one pixel to the right
    const edge = (at: number): Rgba => {
      const img = flat(8, 4, 0);
      for (let y = 0; y < 4; y++) for (let x = at; x < 8; x++) img.data.set([200, 200, 200, 255], (y * 8 + x) * 4);
      return img;
    };
    expect(flickerShareRaw(edge(4), edge(5))).toBeCloseTo(4 / 32, 12);
    expect(flickerShare(edge(4), edge(5))).toBe(0);
    // two pixels is past the reach of one
    expect(flickerShare(edge(4), edge(6))).toBeGreaterThan(0);
    // a lone bright texel on a dark ground that is dark in the other shot, and a lone dark one in a bright field
    const a = flat(8, 4, 0);
    a.data.set([255, 255, 255, 255], (1 * 8 + 3) * 4);
    expect(flickerShare(a, flat(8, 4, 0))).toBeCloseTo(1 / 32, 12);
    // a checker whose phase flips in place has no look-alike one pixel away only if its neighbours differ from it too
    const checker = (phase: number): Rgba => {
      const img = flat(8, 4, 0);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) if ((x + y + phase) % 2 === 0) img.data.set([255, 255, 255, 255], (y * 8 + x) * 4);
      return img;
    };
    // a pixel of a checker finds its colour among the neighbours of the flipped one: the one-pixel window sees a texel that moved
    expect(flickerShare(checker(0), checker(1))).toBe(0);
  });

  it('refuses images of different sizes', () => {
    expect(() => flickerShare(flat(2, 2, 0), flat(4, 2, 0))).toThrow(/sizes differ/);
  });

  it('limits a pair to half its baseline, with a floor for a quiet pair', () => {
    expect(flickerLimit(0.2)).toBeCloseTo(0.1, 12);
    expect(flickerLimit(0)).toBe(0.0005);
    expect(flickerLimit(0.0004)).toBe(0.0005);
  });
});

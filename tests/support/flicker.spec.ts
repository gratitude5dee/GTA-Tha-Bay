import { describe, expect, it } from 'vitest';
import { FLICKER_FLOOR, FLICKER_THRESHOLD, flickerLimit, flickerShare, flickerShareRaw, roadRegion } from './flicker.ts';
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
    expect(flickerLimit(0)).toBe(FLICKER_FLOOR);
    expect(flickerLimit(0.0017)).toBe(FLICKER_FLOOR);
  });
});

describe('flicker region mask (M02h1)', () => {
  it('counts only the pixels of the region, and divides by them', () => {
    const a = flat(8, 4, 0);
    const b = flat(8, 4, 0);
    // a changed pixel outside the region does not count; one inside counts against the region's size
    b.data.set([255, 255, 255, 255], (0 * 8 + 0) * 4);
    b.data.set([255, 255, 255, 255], (3 * 8 + 7) * 4);
    const bottom = (_x: number, y: number): boolean => y >= 2;
    expect(flickerShare(a, b, FLICKER_THRESHOLD, 1, bottom)).toBeCloseTo(1 / 16, 12);
    expect(flickerShare(a, b)).toBeCloseTo(2 / 32, 12);
    expect(flickerShare(a, b, FLICKER_THRESHOLD, 1, () => false)).toBe(0);
  });

  it('puts the road below the horizon and inside the cone of its edges', () => {
    // looking along a road 18.2 m wide from 1.6 m up, level: the horizon is the middle row, the cone is 5.7 pixels wide per row
    const m = roadRegion({ width: 640, height: 360, pitchDeg: 0, fovDeg: 60, eyeM: 1.6, halfWidthM: 9.1 });
    expect(m(320, 100)).toBe(false);
    expect(m(320, 181)).toBe(false);
    expect(m(320, 200)).toBe(true);
    expect(m(0, 200)).toBe(false);
    expect(m(0, 359)).toBe(true);
    expect(m(320, 359)).toBe(true);
    // looking down moves the horizon up
    const down = roadRegion({ width: 640, height: 360, pitchDeg: -10, fovDeg: 60, eyeM: 1.6, halfWidthM: 9.1 });
    expect(down(320, 150)).toBe(true);
  });

  it('cuts the road to a band of ground distances', () => {
    // level, 1.6 m up, focal length 311.8 px: 40 m away is 12.5 rows under the horizon (row 192.5), 300 m away is 1.7 rows
    const band = roadRegion({ width: 640, height: 360, pitchDeg: 0, fovDeg: 60, eyeM: 1.6, halfWidthM: 9.1, marginPx: 0, nearM: 40, farM: 300 });
    expect(band(320, 359)).toBe(false);
    expect(band(320, 193)).toBe(false);
    expect(band(320, 192)).toBe(true);
    expect(band(320, 185)).toBe(true);
    expect(band(320, 182)).toBe(true);
    expect(band(320, 181)).toBe(false);
    const nearOnly = roadRegion({ width: 640, height: 360, pitchDeg: 0, fovDeg: 60, eyeM: 1.6, halfWidthM: 9.1, marginPx: 0, nearM: 40 });
    expect(nearOnly(320, 200)).toBe(false);
    expect(nearOnly(320, 190)).toBe(true);
  });
});

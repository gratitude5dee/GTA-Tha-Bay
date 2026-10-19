import { describe, expect, it } from 'vitest';
import { postIndex, sampleHeight, type HeightGrid } from '../src/index.ts';

/** A plane on the Int16 grid: dm = 100 + 2 * col + 5 * row. */
function plane(): HeightGrid {
  const dm = new Int16Array(65 * 65);
  for (let r = 0; r < 65; r++) for (let c = 0; c < 65; c++) dm[postIndex(c, r)] = 100 + 2 * c + 5 * r;
  return { originX: -128, originZ: -128, cellM: 4, dm };
}

describe('terrain', () => {
  it('indexes row-major with z outer', () => {
    expect(postIndex(0, 0)).toBe(0);
    expect(postIndex(64, 0)).toBe(64);
    expect(postIndex(0, 1)).toBe(65);
    expect(postIndex(64, 64)).toBe(4224);
  });

  it('returns the post value on a post and interpolates bilinearly between', () => {
    const h = plane();
    expect(sampleHeight(h, -128, -128)).toBeCloseTo(10, 9);
    expect(sampleHeight(h, -124, -128)).toBeCloseTo(10.2, 9);
    expect(sampleHeight(h, -128, -124)).toBeCloseTo(10.5, 9);
    expect(sampleHeight(h, -126, -126)).toBeCloseTo(10 + 0.1 + 0.25, 9); // a plane stays a plane
    expect(sampleHeight(h, 128, 128)).toBeCloseTo((100 + 128 + 320) / 10, 9);
  });

  it('is continuous across cell borders', () => {
    const h = plane();
    const eps = 1e-9;
    for (const x of [-100, -60, 0, 60, 100]) {
      expect(Math.abs(sampleHeight(h, x - eps, 7) - sampleHeight(h, x + eps, 7))).toBeLessThan(1e-6);
    }
  });

  it('throws RangeError outside the chunk', () => {
    const h = plane();
    for (const [x, z] of [[-128.01, 0], [128.01, 0], [0, -128.01], [0, 128.01], [NaN, 0]] as const) {
      expect(() => sampleHeight(h, x, z)).toThrow(RangeError);
    }
  });
});

/**
 * M02h7 AC-2 (the street test and the kit's pure rules): a wall faces the street when the ray along its outward normal from its midpoint
 * meets a same-chunk centreline within 14 m, within 30 degrees of parallel; only a wall of 4 m or more qualifies. Shop and bay kinds, the
 * bay layout, the cornice ring and the drop order of the budget.
 */
import { describe, expect, it } from 'vitest';
import {
  AWNING_TRIS, BAY_TRIS, CORNICE_TRIS_PER_EDGE, KIT, bayLayout, corniceRing, inRing, isBayKind, isCorniceKind, isShopKind, isStreetWall, kitHash, localSegments, planKit,
} from '../src/client/chunks/facade-kit.ts';

/** A straight centreline along x at z, from x0 to x1 (absolute ENU triples). */
const road = (z: number, x0 = -50, x1 = 50): { pts: Float32Array } => ({ pts: new Float32Array([x0, 0, z, (x0 + x1) / 2, 0, z, x1, 0, z]) });

describe('the street test (AC-2 fixtures)', () => {
  // A wall from (10, 0) to (0, 0): its outward normal (dz, -dx) / len = (0, 1) points to +z.
  const wall = [10, 0, 0, 0] as const;

  it('a wall facing a segment at 10 m qualifies, at 20 m it does not', () => {
    expect(isStreetWall(...wall, localSegments([road(10)], 0, 0))).toBe(true);
    expect(isStreetWall(...wall, localSegments([road(20)], 0, 0))).toBe(false);
  });

  it('a segment at 45 degrees does not qualify, one within 30 degrees does', () => {
    const at = (deg: number): { pts: Float32Array } => {
      const r = (deg * Math.PI) / 180;
      return { pts: new Float32Array([5 - 30 * Math.cos(r), 0, 8 - 30 * Math.sin(r), 5 + 30 * Math.cos(r), 0, 8 + 30 * Math.sin(r)]) };
    };
    expect(isStreetWall(...wall, localSegments([at(45)], 0, 0))).toBe(false);
    expect(isStreetWall(...wall, localSegments([at(20)], 0, 0))).toBe(true);
  });

  it('a 3 m wall never qualifies', () => {
    expect(isStreetWall(3, 0, 0, 0, localSegments([road(5)], 0, 0))).toBe(false);
  });

  it('a road behind the wall (against the outward normal) does not count', () => {
    expect(isStreetWall(...wall, localSegments([road(-8)], 0, 0))).toBe(false);
  });

  it('segments are made local to the unit corner', () => {
    expect(isStreetWall(...wall, localSegments([road(1010, 950, 1050)], 1000, 1000))).toBe(true);
  });
});

describe('shop, bay and cornice kinds', () => {
  it('Commercial and Civic street walls are shops, Tower keeps its class rule, ResMid by seed near the configured share', () => {
    expect(isShopKind(2, 1)).toBe(true);
    expect(isShopKind(5, 1)).toBe(true);
    expect(isShopKind(3, 1)).toBe(false);
    expect(isShopKind(0, 1)).toBe(false);
    let shops = 0;
    for (let s = 0; s < 2000; s++) if (isShopKind(1, s)) shops++;
    expect(shops / 2000).toBeGreaterThan(KIT.shopResMid - 0.05);
    expect(shops / 2000).toBeLessThan(KIT.shopResMid + 0.05);
  });

  it('bays on ResLow and ResMid, cornices on ResMid, Commercial and Civic', () => {
    expect([0, 1, 2, 3, 4, 5].filter(isBayKind)).toEqual([0, 1]);
    expect([0, 1, 2, 3, 4, 5].filter(isCorniceKind)).toEqual([1, 2, 5]);
  });

  it('kitHash is in [0, 1) and stable', () => {
    for (let s = 0; s < 100; s++) {
      const h = kitHash(s, 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(kitHash(s, 3)).toBe(h);
    }
  });
});

describe('bay layout', () => {
  it('widths and depths stay in their ranges, bays fit the wall, a short wall has none', () => {
    for (let s = 0; s < 50; s++) {
      for (const b of bayLayout(12, s, 0, 2)) {
        expect(b.w).toBeGreaterThanOrEqual(KIT.bay.widthM[0]);
        expect(b.w).toBeLessThanOrEqual(KIT.bay.widthM[1]);
        expect(b.d).toBeGreaterThanOrEqual(KIT.bay.depthM[0]);
        expect(b.d).toBeLessThanOrEqual(KIT.bay.depthM[1]);
        expect(b.c - b.w / 2).toBeGreaterThan(0);
        expect(b.c + b.w / 2).toBeLessThan(12);
      }
      expect(bayLayout(2, s, 0, 2)).toEqual([]);
    }
    expect(bayLayout(12, 4, 0, 1).length).toBe(1);
    expect(bayLayout(12, 4, 0, 0).length).toBe(0);
  });
});

describe('the cornice ring', () => {
  it('a square ring moves every corner out along its mitre', () => {
    const ring = [0, 0, 10, 0, 10, 10, 0, 10];
    const c = corniceRing(ring) as number[];
    expect(c).not.toBeNull();
    const o = KIT.cornice.offsetM;
    // every offset corner lies outside the footprint, by the mitre (offset x sqrt 2 at a right angle)
    for (let i = 0; i < 4; i++) {
      expect(inRing(ring, c[i * 2] as number, c[i * 2 + 1] as number)).toBe(false);
      const d = Math.hypot((c[i * 2] as number) - (ring[i * 2] as number), (c[i * 2 + 1] as number) - (ring[i * 2 + 1] as number));
      expect(d).toBeCloseTo(o * Math.SQRT2, 5);
    }
  });

  it('a concave corner is clamped to the offset, a short edge skips the ring', () => {
    // an L: the corner at (5, 5) is concave
    const ring = [0, 0, 10, 0, 10, 5, 5, 5, 5, 10, 0, 10];
    const c = corniceRing(ring) as number[];
    const d = Math.hypot((c[6] as number) - 5, (c[7] as number) - 5);
    expect(d).toBeCloseTo(KIT.cornice.offsetM, 5);
    expect(corniceRing([0, 0, 10, 0, 10, 0.5, 0, 0.5])).toBeNull();
  });
});

describe('the budget drops cornice, then bay, then awning (AC-2)', () => {
  const parts = [
    { kind: 'awning' as const, tris: AWNING_TRIS },
    { kind: 'bay' as const, tris: BAY_TRIS },
    { kind: 'cornice' as const, tris: 4 * CORNICE_TRIS_PER_EDGE },
  ];
  it('a shrinking allowance drops the cornice first, then the bay, then the awning', () => {
    expect(planKit(parts, 48)).toEqual([true, true, true]);
    expect(planKit(parts, 31)).toEqual([true, true, false]);
    expect(planKit(parts, 15)).toEqual([true, false, false]);
    expect(planKit(parts, 5)).toEqual([false, false, false]);
  });
  it('profile allowances are the configured ones: desktop 48, mobile 16, low and visionpro 0', () => {
    expect(KIT.trisPerBuilding).toEqual({ desktop: 48, visionpro: 0, mobile: 16, low: 0 });
  });
});

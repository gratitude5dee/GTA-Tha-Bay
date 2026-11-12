import { describe, expect, it } from 'vitest';
import {
  LENS_GRID, LensDecider, crownBoxOf, crownOf, frameShare, inCorridor, lensHides, lensHidesAny, lensRuleOff, lensesOf,
  type Crown, type Lens, type LensRule, type LensShot,
} from '../src/client/chunks/lens-clear.ts';
import { SET_GEOMETRIES, buildTreeSet, type TreeSet } from '../src/client/chunks/tree-forms.ts';
import { LOOK } from '../src/client/look/config.ts';

/**
 * BD-FIX-LENS-CLEAR-01, the pure rule (`chunks/lens-clear.ts`): which crowns a director-placed cinematic lens hides, and when a set is
 * decided. The lens of the cases is the dawn shot's: 3 m above its mark, a wide lens (75 degrees), looking at a head 20 m away.
 */
const RULE: LensRule = LOOK.vegetation.lens;
const WIDE: Lens = { pos: [0, 3, 0], lookAt: [0, 1.6, -20], fovDeg: 75, aspect: 16 / 9 };
/** A round crown of radius `r` at (x, y, z), no yaw. */
const ball = (x: number, y: number, z: number, r: number): Crown => ({ x, y, z, rx: r, ry: r, rz: r, cos: 1, sin: 0 });

describe('lens clear: the rule (BD-FIX-LENS-CLEAR-01)', () => {
  it('look.json carries the rule: a tenth of the frame, half a metre of corridor, two metres to decide again', () => {
    expect(RULE).toEqual(expect.objectContaining({ maxFrameShare: 0.1, corridorM: 0.5, redecideM: 2 }));
    expect(lensRuleOff(RULE)).toBe(false);
    expect(LENS_GRID).toEqual({ cols: 24, rows: 14 });
  });

  it('a crown 2 m from a wide lens is hidden and one 40 m away is not', () => {
    // beside the kerb mark: the crown's edge 2 m from the lens, ahead and to the right, off the line to the subject
    const near = ball(3.2, 4.5, -3.2, 2.6);
    expect(Math.hypot(3.2, 1.5, 3.2) - 2.6).toBeCloseTo(2, 0);
    expect(inCorridor(WIDE, near, RULE.corridorM)).toBe(false);
    expect(frameShare(WIDE, near)).toBeGreaterThan(RULE.maxFrameShare);
    expect(lensHides(WIDE, near, RULE)).toBe(true);
    // the same crown 40 m down the street, beside the line
    const far = ball(8, 4.5, -40, 2.6);
    expect(frameShare(WIDE, far)).toBeLessThan(0.02);
    expect(lensHides(WIDE, far, RULE)).toBe(false);
  });

  it('a crown on the lens-to-subject segment is hidden even when it is small in the frame', () => {
    // 15 m along the segment, a crown 0.4 m across: a few thousandths of the frame, but it stands on the subject
    const t = 0.75;
    const small = ball(0, 3 + (1.6 - 3) * t, -20 * t, 0.2);
    expect(frameShare(WIDE, small)).toBeLessThan(0.01);
    expect(inCorridor(WIDE, small, RULE.corridorM)).toBe(true);
    expect(lensHides(WIDE, small, RULE)).toBe(true);
    // 1 m to the side of the segment it is neither in the corridor (0.5 m + its 0.2 m radius) nor large
    const beside = ball(1, small.y, small.z, 0.2);
    expect(inCorridor(WIDE, beside, RULE.corridorM)).toBe(false);
    expect(lensHides(WIDE, beside, RULE)).toBe(false);
    // and past the subject, on the same line, it is behind the look-at point: not between the lens and the subject
    expect(inCorridor(WIDE, ball(0, 1.2, -26, 0.2), RULE.corridorM)).toBe(false);
  });

  it('a crown behind the lens covers nothing and is not hidden', () => {
    const behind = ball(0, 3.5, 4, 2.5);
    expect(frameShare(WIDE, behind)).toBe(0);
    expect(lensHides(WIDE, behind, RULE)).toBe(false);
    // the same crown in front, at the same distance, fills the frame
    expect(frameShare(WIDE, ball(0, 3.5, -4, 2.5))).toBeGreaterThan(0.2);
  });

  it('a lens inside a crown sees nothing else: share 1', () => {
    expect(frameShare(WIDE, ball(0.5, 3.2, 0.3, 2.5))).toBe(1);
  });

  it('the share of a fixed crown falls with distance, monotonically', () => {
    let prev = Infinity;
    const shares: number[] = [];
    for (let d = 3; d <= 80; d += 1) {
      const s = frameShare({ pos: [0, 4, 0], lookAt: [0, 4, -100], fovDeg: 75, aspect: 16 / 9 }, ball(0, 4, -d, 2.5));
      expect(s, `share at ${d} m`).toBeLessThanOrEqual(prev);
      prev = s;
      shares.push(s);
    }
    expect(shares[0]).toBeGreaterThan(0.3);
    expect(shares[shares.length - 1]).toBeLessThan(0.01);
    // a longer lens sees the same crown larger
    const at30 = ball(0, 4, -30, 2.5);
    expect(frameShare({ pos: [0, 4, 0], lookAt: [0, 4, -100], fovDeg: 28, aspect: 16 / 9 }, at30)).toBeGreaterThan(frameShare({ pos: [0, 4, 0], lookAt: [0, 4, -100], fovDeg: 75, aspect: 16 / 9 }, at30));
  });

  it('the cheap bound never skips a crown the grid would hide', () => {
    // crowns over a fan of places and sizes: `lensHides` (bound first) agrees with the grid and the corridor on every one
    let hidden = 0;
    for (let i = 0; i < 400; i++) {
      const a = (i * 0.61) % 6.283, d = 1 + ((i * 7) % 60), r = 0.5 + ((i * 3) % 9) * 0.7;
      const c = ball(Math.sin(a) * d, 2 + (i % 5) * 1.5, -Math.cos(a) * d, r);
      const want = inCorridor(WIDE, c, RULE.corridorM) || frameShare(WIDE, c) > RULE.maxFrameShare;
      expect(lensHides(WIDE, c, RULE), `crown ${i}`).toBe(want);
      if (want) hidden++;
    }
    expect(hidden).toBeGreaterThan(20);
    expect(hidden).toBeLessThan(380);
  });

  it('maxFrameShare 1 with corridorM 0 hides nothing', () => {
    const off: LensRule = { maxFrameShare: 1, corridorM: 0, redecideM: 2 };
    expect(lensRuleOff(off)).toBe(true);
    for (const c of [ball(0.5, 3.2, 0.3, 2.5), ball(3.2, 4.5, -3.2, 2.6), ball(0, 2.3, -10, 0.2), ball(0, 2.3, -10, 3)]) {
      expect(inCorridor(WIDE, c, off.corridorM)).toBe(false);
      expect(lensHides(WIDE, c, off)).toBe(false);
    }
    // each half alone still works
    expect(lensRuleOff({ maxFrameShare: 1, corridorM: 0.5, redecideM: 2 })).toBe(false);
    expect(lensRuleOff({ maxFrameShare: 0.1, corridorM: 0, redecideM: 2 })).toBe(false);
    expect(lensHides(WIDE, ball(0, 2.3, -10, 0.2), { maxFrameShare: 1, corridorM: 0.5, redecideM: 2 })).toBe(true);
    expect(lensHides(WIDE, ball(0, 2.3, -10, 0.2), { maxFrameShare: 0.1, corridorM: 0, redecideM: 2 })).toBe(false);
  });

  it('every geometry of every tree set gives a finite crown ellipsoid', () => {
    for (const set of ['full', 'lite', 'low', 'cone'] as TreeSet[]) {
      const datas = buildTreeSet(set);
      expect(datas.map((d) => d.id)).toEqual([...SET_GEOMETRIES[set]]);
      for (const data of datas) {
        const box = crownBoxOf(data.positions, data.leaf);
        expect(box, `${set} ${data.id}`).not.toBeNull();
        const b = box!;
        for (const v of [b.cx, b.cy, b.cz, b.hx, b.hy, b.hz]) expect(Number.isFinite(v), `${set} ${data.id}`).toBe(true);
        for (const h of [b.hx, b.hy, b.hz]) expect(h, `${set} ${data.id} half extent`).toBeGreaterThan(0.01);
        // the crown is the upper part of the tree: above the root, and the trunk's foot is not in it
        expect(b.cy - b.hy, `${set} ${data.id} crown bottom`).toBeGreaterThan(0);
        // placed as a 9 m tree (the cone is 6.2 m tall at scale 1): metres, finite, and a wide lens 2 m from its side loses a tenth of the frame
        const s = set === 'cone' ? 9 / 6.2 : 9;
        const c = crownOf(b, 100, 2, -50, 1.1, s, s);
        for (const v of [c.x, c.y, c.z, c.rx, c.ry, c.rz, c.cos, c.sin]) expect(Number.isFinite(v)).toBe(true);
        expect(Math.max(c.rx, c.ry, c.rz)).toBeLessThan(9);
        expect(c.y).toBeGreaterThan(2);
        const lens: Lens = { pos: [c.x, c.y, c.z + Math.max(c.rx, c.rz) + 2], lookAt: [c.x, c.y, c.z], fovDeg: 75, aspect: 16 / 9 };
        expect(frameShare(lens, c), `${set} ${data.id} share from 2 m`).toBeGreaterThan(RULE.maxFrameShare);
      }
    }
  });

  it('a crown is placed by the instance: its offset from the trunk turns with the yaw, its radii follow the scale', () => {
    const box = { cx: 0.2, cy: 0.7, cz: 0, hx: 0.3, hy: 0.25, hz: 0.2 };
    const a = crownOf(box, 10, 1, 20, 0, 10, 8);
    expect([a.x, a.y, a.z]).toEqual([12, 6.6, 20]);
    expect([a.rx, a.ry, a.rz]).toEqual([3, 2, 2]);
    // the pool's matrix turns local +x to world -z at a quarter turn (column-major rotation about y)
    const q = crownOf(box, 10, 1, 20, Math.PI / 2, 10, 8);
    expect(q.x).toBeCloseTo(10, 6);
    expect(q.z).toBeCloseTo(18, 6);
    // the long axis (x, 3 m) now lies along z: a lens 2.5 m from the centre along z, looking away, is inside the turned crown (every ray
    // meets it) and outside the unturned one (the crown is behind it)
    const away = (c: Crown): Lens => ({ pos: [c.x, c.y, c.z + 2.5], lookAt: [c.x, c.y, c.z + 10], fovDeg: 75, aspect: 1 });
    expect(frameShare(away(q), q)).toBe(1);
    expect(frameShare(away(a), a)).toBe(0);
  });
});

describe('lens clear: when a set is decided (BD-FIX-LENS-CLEAR-01)', () => {
  const shot = (over: Partial<LensShot> = {}): LensShot => ({ key: 'fixed|7|1|480|75', pos: [0, 3, 0], lookAt: [0, 1.6, -20], fovDeg: 75, aspect: 16 / 9, ...over });

  it('decides on the cut, holds through the shot, clears when it ends', () => {
    const d = new LensDecider();
    expect(d.step(null, 2)).toBe('idle');
    expect(d.step(shot(), 2)).toBe('decide');
    expect(d.lenses).toHaveLength(1);
    for (let i = 0; i < 100; i++) expect(d.step(shot(), 2)).toBe('hold');
    expect(d.decisions).toBe(1);
    expect(d.holding).toBe(true);
    expect(d.step(null, 2)).toBe('clear');
    expect(d.lenses).toHaveLength(0);
    expect(d.step(null, 2)).toBe('idle');
    // the same shot again is a new shot
    expect(d.step(shot(), 2)).toBe('decide');
    expect(d.decisions).toBe(2);
  });

  it('a lens the director re-places every tick decides again only beyond redecideM of the poses it was decided for', () => {
    const d = new LensDecider();
    expect(d.step(shot(), 2)).toBe('decide');
    // a `single` follows a walking subject: 1.9 m of travel holds, the step past 2 m decides, and the count starts again from there
    expect(d.step(shot({ pos: [1.9, 3, 0] }), 2)).toBe('hold');
    expect(d.step(shot({ pos: [2.1, 3, 0] }), 2)).toBe('decide');
    expect(d.step(shot({ pos: [0.3, 3, 0] }), 2)).toBe('hold');
    expect(d.step(shot({ pos: [0, 3, 0] }), 2)).toBe('decide');
    expect(d.decisions).toBe(3);
    // the subject moving (the look-at point) is not a new decision
    expect(d.step(shot({ lookAt: [9, 1.6, -3] }), 2)).toBe('hold');
  });

  it('a change of the shot is a cut, whatever the pose', () => {
    const d = new LensDecider();
    expect(d.step(shot(), 2)).toBe('decide');
    for (const key of ['spline|7|1|480|75', 'fixed|8|1|480|75', 'fixed|7|2|480|75', 'fixed|7|1|240|75', 'fixed|7|1|480|50']) {
      expect(d.step(shot({ key }), 2), key).toBe('decide');
      expect(d.step(shot({ key }), 2), key).toBe('hold');
    }
    expect(d.decisions).toBe(6);
  });

  it('a spline is decided for both of its ends and held along the whole push-in', () => {
    const d = new LensDecider();
    const ends: [[number, number, number], [number, number, number]] = [[0, 3, 0], [0, 2.66, -4.8]];
    const spline = (t: number): LensShot => shot({ key: 'spline|7|1|480|75', pos: [0, 3 + (2.66 - 3) * t, -4.8 * t], ends });
    expect(d.step(spline(0), 2)).toBe('decide');
    expect(d.lenses.map((l) => l.pos.map((v) => v + 0))).toEqual([[0, 3, 0], [0, 2.66, -4.8]]);
    // the midpoint is 2.4 m from either end, but on the path the set was decided for
    for (let i = 1; i <= 480; i++) expect(d.step(spline(i / 480), 2)).toBe('hold');
    expect(d.decisions).toBe(1);
    // decided in the middle of the path (the layer came on during the shot): where the lens stands and both ends
    expect(lensesOf(spline(0.5))).toHaveLength(3);
    // a tree at the far end of the push-in is hidden from the first frame: neither end's frame may break the rule
    const atEnd: Crown = { x: 2.4, y: 4, z: -7, rx: 2.4, ry: 2, rz: 2.4, cos: 1, sin: 0 };
    expect(lensHides(lensesOf(spline(0))[0]!, atEnd, RULE)).toBe(false);
    expect(lensHidesAny(lensesOf(spline(0)), atEnd, RULE)).toBe(true);
  });
});

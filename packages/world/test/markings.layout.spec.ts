/**
 * AC-2 (M02h1): the lane layout of a segment. `packRoad` adds the strips up to `widthM`, the `road` fields round-trip, and `markingAt`
 * (the TS reference of the shader) paints a double yellow only on two-way roads of its class, nothing on `service`, the bus tint only with
 * `BusLane` and no T with `NoParking`. Also the pure geometry helpers the mesher shares (clipping, collinear vertices, the convex hull).
 */
import { EdgeFlag, type RoadEdge } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { LOOK } from '../src/client/look/config.ts';
import {
  LANE_STEP_M, MEDIAN_STEP_M, ROAD_WRAP_M, carriagewayOuterM, carriagewayShift, layoutSumM, markingAt, packRoad, roadFields, roadVertex, unpackRoad, wrapAlong, type MarkKind, type RoadLayout,
} from '../src/client/look/road-layout.ts';
import { arcLength, clippedPolyline, convexHull, depthInsideHull, MAX_QUAD_M, ribbonSides, simplifyPoints } from '../src/client/chunks/junction-patch.ts';
import { loadBake } from './fixtures/bake.ts';

const cfg = LOOK.markings;
type E = Pick<RoadEdge, 'cls' | 'lanes' | 'medianM' | 'parkingSides' | 'flags'>;
const edge = (o: Partial<E> = {}): E => ({ cls: 2, lanes: 2, medianM: 0, parkingSides: 2, flags: 0, ...o });
/** A segment as the synth bake makes one: `lanes` each way of 3.4 m, a parking lane each side, width less 0.2 m. */
const widthOf = (lanes: number, laneM: number, parking: number, twoWay = true): number => lanes * (twoWay ? 2 : 1) * laneM + parking * 2.4 - 0.2;

/** Every kind of paint found over a grid of the layout (0.5 m along a 24 m run, every 5 cm across). */
function kindsOf(l: RoadLayout, sMax = 24): Set<MarkKind> {
  const out = new Set<MarkKind>();
  for (let s = 0; s < sMax; s += 0.05) for (let t = -l.widthM / 2; t <= l.widthM / 2; t += 0.01) out.add(markingAt(l, s, t, cfg));
  return out;
}

describe('packRoad (AC-2)', () => {
  it('adds the strips up to the segment width and gives the synth arterial two lanes of about 3.3 m', () => {
    const l = packRoad({ widthM: 18.2 }, [edge(), edge()], cfg);
    expect(l).toMatchObject({ lanes: 2, parking: 2, medianM: 0, oneWay: false, divided: false, busLane: false, noParking: false });
    expect(Math.abs(layoutSumM(l, cfg) - 18.2)).toBeLessThan(0.05);
    expect(l.laneM).toBeGreaterThan(3.2);
    expect(l.laneM).toBeLessThan(3.5);
    expect(cfg.classes[l.markClass]).toBe('arterial');
  });

  it('treats a single edge as a one-way street, and a flag likewise', () => {
    const one = packRoad({ widthM: 7.6 }, [edge({ cls: 4, lanes: 1, flags: EdgeFlag.OneWay })], cfg);
    expect(one.oneWay).toBe(true);
    expect(Math.abs(layoutSumM(one, cfg) - 7.6)).toBeLessThan(0.05);
    expect(packRoad({ widthM: 10.6 }, [edge({ cls: 4, lanes: 1 })], cfg).oneWay).toBe(true);
    expect(packRoad({ widthM: 10.6 }, [edge({ cls: 4, lanes: 1, flags: EdgeFlag.OneWay }), edge({ cls: 4, lanes: 1 })], cfg).oneWay).toBe(true);
  });

  it('gives up parking, then the median, then lanes when the road is too narrow for them', () => {
    const narrow = packRoad({ widthM: 6 }, [edge({ lanes: 3, medianM: 2, parkingSides: 2 }), edge({ lanes: 3, medianM: 2, parkingSides: 2 })], cfg);
    expect(narrow.parking).toBe(0);
    expect(narrow.laneM).toBeGreaterThanOrEqual(2.2);
    expect(Math.abs(layoutSumM(narrow, cfg) - 6)).toBeLessThan(1e-9);
  });

  it('maps the road classes to the rules of look.json: edges and dashes on the freeway and the ramp, nothing on a service road', () => {
    const cls = (c: number): string => cfg.classes[packRoad({ widthM: 12 }, [edge({ cls: c }), edge({ cls: c })], cfg).markClass] as string;
    expect([0, 1, 2, 3, 4, 5].map(cls)).toEqual(['freeway', 'freeway', 'arterial', 'collector', 'local', 'none']);
  });

  it('on the synth bake: every segment sums to its width within 0.05 m, and the fields round-trip', () => {
    const bake = loadBake('synth', 'markings.layout');
    if (!bake) return;
    let n = 0;
    for (const c of bake.chunks((k) => k.endsWith('/245') || k.endsWith('/246'))) {
      for (const seg of c.segments) {
        const edges = c.edges.filter((e) => e.seg === seg.id);
        if (edges.length === 0) continue;
        const l = packRoad(seg, edges, cfg);
        expect(Math.abs(layoutSumM(l, cfg) - seg.widthM), `segment ${seg.id}`).toBeLessThan(0.05);
        const f = roadFields(l);
        const v = unpackRoad(roadVertex(12.34, -3.21, f));
        expect(v).toMatchObject({ lanes: l.lanes, parking: l.parking, oneWay: l.oneWay, divided: l.divided, busLane: l.busLane, noParking: l.noParking, markClass: l.markClass });
        expect(Math.abs(v.laneM - l.laneM)).toBeLessThanOrEqual(LANE_STEP_M / 2 + 1e-9);
        expect(Math.abs(v.medianM - l.medianM)).toBeLessThanOrEqual(MEDIAN_STEP_M / 2 + 1e-9);
        expect(v.sM).toBeCloseTo(12.3, 1);
        expect(v.tM).toBeCloseTo(-3.21, 2);
        n++;
      }
    }
    expect(n).toBeGreaterThan(5);
  });

  it('wraps the position along a segment at a multiple of every period of the paint', () => {
    expect(ROAD_WRAP_M % (cfg.dashOnM + cfg.dashOffM)).toBe(0);
    expect(ROAD_WRAP_M % cfg.tEveryM).toBe(0);
    expect(wrapAlong(ROAD_WRAP_M + 5)).toBe(5);
    expect(wrapAlong(-1)).toBe(ROAD_WRAP_M - 1);
    // a far row of a 200 m quad past the wrap still fits the 16-bit field
    expect(roadVertex(ROAD_WRAP_M - 1 + 200, 0, { z: 0, w: 0 })[0]).toBeLessThanOrEqual(32767);
  });
});

describe('markingAt (AC-2)', () => {
  const arterial = packRoad({ widthM: widthOf(2, 3.4, 2) }, [edge(), edge()], cfg);

  it('paints the double yellow, the lane dashes, the edge lines and the Ts of a two-way arterial, and no bus tint', () => {
    const k = kindsOf(arterial);
    expect(k.has('doubleYellow')).toBe(true);
    expect(k.has('dash')).toBe(true);
    expect(k.has('edge')).toBe(true);
    expect(k.has('parkingT')).toBe(true);
    expect(k.has('bus')).toBe(false);
    expect(k.has('medianYellow')).toBe(false);
  });

  it('puts two 10 cm lines 10 cm apart at the centre, and the dashes 3 m on, 9 m off, at the lane boundary', () => {
    const at = (s: number, t: number): MarkKind => markingAt(arterial, s, t, cfg);
    expect(at(1, 0.1)).toBe('doubleYellow');
    expect(at(1, -0.1)).toBe('doubleYellow');
    expect(at(1, 0)).toBe('none');
    expect(at(1, 0.3)).toBe('none');
    const boundary = arterial.laneM;
    const shift = carriagewayShift(arterial, cfg.parkingM);
    expect(shift).toBe(0);
    expect(at(1.5, boundary)).toBe('dash');
    expect(at(1.5, -boundary)).toBe('dash');
    expect(at(2.9, boundary)).toBe('dash');
    expect(at(3.1, boundary)).toBe('none');
    expect(at(11.9, boundary)).toBe('none');
    expect(at(12.5, boundary)).toBe('dash');
    // the edge line is inside the outer lane
    const outer = carriagewayOuterM(arterial);
    expect(at(1, outer - 0.05)).toBe('edge');
    expect(at(1, -(outer - 0.05))).toBe('edge');
  });

  it('draws a double yellow only on a two-way road: none on a one-way arterial', () => {
    const one = packRoad({ widthM: widthOf(2, 3.4, 2, false) }, [edge({ flags: EdgeFlag.OneWay })], cfg);
    expect(one.oneWay).toBe(true);
    const k = kindsOf(one);
    expect(k.has('doubleYellow')).toBe(false);
    expect(k.has('dash')).toBe(true);
  });

  it('draws the centre of a local street only when it is two-way and 9 m wide', () => {
    const wide = packRoad({ widthM: 10.6 }, [edge({ cls: 4, lanes: 1 }), edge({ cls: 4, lanes: 1 })], cfg);
    const thin = packRoad({ widthM: 7.4 }, [edge({ cls: 4, lanes: 1, parkingSides: 1 }), edge({ cls: 4, lanes: 1, parkingSides: 1 })], cfg);
    const oneWay = packRoad({ widthM: 7.6 }, [edge({ cls: 4, lanes: 1, flags: EdgeFlag.OneWay })], cfg);
    expect(kindsOf(wide).has('doubleYellow')).toBe(true);
    expect(kindsOf(thin).has('doubleYellow')).toBe(false);
    expect(kindsOf(oneWay).has('doubleYellow')).toBe(false);
    // a local street has neither edge lines nor dashes
    expect(kindsOf(wide).has('edge')).toBe(false);
    expect(kindsOf(wide).has('dash')).toBe(false);
  });

  it('paints nothing on a service road, whatever its flags', () => {
    const service = packRoad({ widthM: 8 }, [edge({ cls: 5, lanes: 1, flags: EdgeFlag.BusLane }), edge({ cls: 5, lanes: 1, flags: EdgeFlag.BusLane })], cfg);
    expect([...kindsOf(service)]).toEqual(['none']);
  });

  it('tints the outer lane only with BusLane, on both carriageways of a two-way road', () => {
    const plain = kindsOf(arterial);
    expect(plain.has('bus')).toBe(false);
    const bus = packRoad({ widthM: widthOf(2, 3.4, 2) }, [edge({ flags: EdgeFlag.BusLane }), edge({ flags: EdgeFlag.BusLane })], cfg);
    expect(bus.busLane).toBe(true);
    const outer = carriagewayOuterM(bus);
    expect(markingAt(bus, 4, outer - bus.laneM / 2, cfg)).toBe('bus');
    expect(markingAt(bus, 4, -(outer - bus.laneM / 2), cfg)).toBe('bus');
    expect(markingAt(bus, 4, bus.laneM * 0.5 + 0.4, cfg)).toBe('none');
  });

  it('draws no T with NoParking, and Ts only where there is a parking lane', () => {
    const noPark = packRoad({ widthM: widthOf(2, 3.4, 2) }, [edge({ flags: EdgeFlag.NoParking }), edge({ flags: EdgeFlag.NoParking })], cfg);
    expect(noPark.noParking).toBe(true);
    expect(kindsOf(noPark).has('parkingT')).toBe(false);
    const none = packRoad({ widthM: widthOf(2, 3.4, 0) }, [edge({ parkingSides: 0 }), edge({ parkingSides: 0 })], cfg);
    expect(kindsOf(none).has('parkingT')).toBe(false);
    // a T every 6 m: the stem at 3 m, 9 m, ...
    const half = arterial.widthM / 2;
    expect(markingAt(arterial, 3, half - 0.5, cfg)).toBe('parkingT');
    expect(markingAt(arterial, 9, -(half - 0.5), cfg)).toBe('parkingT');
    expect(markingAt(arterial, 4.5, half - 0.5, cfg)).toBe('none');
  });

  it('with one parking lane the carriageway shifts away from it and the centre line moves with it', () => {
    const l = packRoad({ widthM: widthOf(1, 3.4, 1) }, [edge({ cls: 3, lanes: 1, parkingSides: 1 }), edge({ cls: 3, lanes: 1, parkingSides: 1 })], cfg);
    const shift = carriagewayShift(l, cfg.parkingM);
    expect(shift).toBeCloseTo(cfg.parkingM / 2, 6);
    expect(markingAt(l, 1, shift + 0.1, cfg)).toBe('doubleYellow');
    expect(markingAt(l, 1, 0.1, cfg)).toBe('none');
  });

  it('draws the yellow median edges of a divided road and not the double centre line', () => {
    const divided = packRoad({ widthM: 16 }, [edge({ lanes: 2, medianM: 2, parkingSides: 0, flags: EdgeFlag.Divided }), edge({ lanes: 2, medianM: 2, parkingSides: 0, flags: EdgeFlag.Divided })], cfg);
    expect(divided.divided).toBe(true);
    const k = kindsOf(divided);
    expect(k.has('medianYellow')).toBe(true);
    expect(k.has('doubleYellow')).toBe(false);
    expect(markingAt(divided, 1, 1, cfg)).toBe('medianYellow');
  });
});

describe('ribbon geometry helpers', () => {
  const line = (n: number, spacing: number, bend = 0): Float32Array => {
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = i * spacing;
      p[i * 3 + 1] = 2;
      p[i * 3 + 2] = bend * (i * spacing) ** 2 * 0.001;
    }
    return p;
  };

  it('clips a polyline at both ends, keeping the arc length of every vertex from the original start', () => {
    const p = line(11, 16);
    const c = clippedPolyline(p, 10, 5) as NonNullable<ReturnType<typeof clippedPolyline>>;
    expect(c[0]).toMatchObject({ x: 10, s: 10 });
    expect(c[c.length - 1]).toMatchObject({ x: 155, s: 155 });
    expect(c.map((q) => q.s)).toEqual([10, 16, 32, 48, 64, 80, 96, 112, 128, 144, 155]);
    expect(clippedPolyline(p, 0, 0)?.length).toBe(11);
    expect(clippedPolyline(p, 100, 60)).toBeNull();
    expect(arcLength(p)).toBeCloseTo(160, 6);
  });

  it('drops collinear vertices, keeps a bend and a grade change, and never leaves a gap over MAX_QUAD_M', () => {
    const straight = clippedPolyline(line(11, 16), 0, 0) as NonNullable<ReturnType<typeof clippedPolyline>>;
    expect(simplifyPoints(straight).map((q) => q.s)).toEqual([0, 160]);
    const bent = clippedPolyline(line(11, 16, 1), 0, 0) as NonNullable<ReturnType<typeof clippedPolyline>>;
    expect(simplifyPoints(bent).length).toBeGreaterThan(2);
    const graded = line(11, 16);
    for (let i = 5; i < 11; i++) graded[i * 3 + 1] = 2 + (i - 5) * 0.5;
    expect(simplifyPoints(clippedPolyline(graded, 0, 0) as NonNullable<ReturnType<typeof clippedPolyline>>).some((q) => q.s === 80)).toBe(true);
    const long = clippedPolyline(line(31, 20), 0, 0) as NonNullable<ReturnType<typeof clippedPolyline>>;
    const kept = simplifyPoints(long);
    for (let i = 1; i < kept.length; i++) expect((kept[i] as { s: number }).s - (kept[i - 1] as { s: number }).s).toBeLessThanOrEqual(MAX_QUAD_M);
  });

  it('puts the two sides of a ribbon half a width either side, perpendicular to the direction', () => {
    const c = clippedPolyline(line(3, 10), 0, 0) as NonNullable<ReturnType<typeof clippedPolyline>>;
    const s = ribbonSides(c, 4);
    // heading +x: the `left` side (-tz, +tx) is +z
    expect(s.left[1]).toMatchObject({ x: 10, z: 4 });
    expect(s.right[1]).toMatchObject({ x: 10, z: -4 });
  });

  it('builds a counter-clockwise convex hull and measures how far inside it a point lies', () => {
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 5, z: 5 }, { x: 5, z: 0 }];
    const hull = convexHull(pts);
    expect(hull.slice().sort()).toEqual([0, 1, 2, 3]);
    expect(depthInsideHull(pts, hull, 4)).toBeCloseTo(5, 9);
    expect(depthInsideHull(pts, hull, 5)).toBeCloseTo(0, 9);
    expect(depthInsideHull(pts, hull, 0)).toBeCloseTo(0, 9);
  });
});

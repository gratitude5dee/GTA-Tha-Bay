import { describe, expect, it, vi } from 'vitest';
import type { BlipKind, ChunkKey, MapBlip } from '@dv/shared';
import { BLIP_KINDS, BLIP_STYLE, clampToRim, drawBlip, drawRoute } from '../src/client/map/blips.ts';
import { PALETTE_NAMES, mapPaletteOf } from '../src/client/map/views.ts';
import { trimRoute } from '../src/client/map/fullmap.ts';
import { RoadNetwork } from '../src/sim/graph/adjacency.ts';
import { RoadGraph } from '../src/sim/graph/query.ts';
import { MapApiImpl, OFF_ROUTE_M, REPLAN_TICKS, ROUTE_MAX_POINTS, distToPolyline } from '../src/sim/map/map-api.ts';
import { fakeCanvas } from './fixtures/fake-canvas.ts';
import { chunkOf, roads, topologyOf } from './fixtures/roads.ts';

const draw = (kind: BlipKind, palette = mapPaletteOf('default')) => {
  const cv = fakeCanvas();
  drawBlip(cv.getContext('2d'), { kind }, 40, 40, palette, { sizePx: 14, radiusPx: 30 });
  return cv.rec;
};

describe('blip shapes and colours (AC-4)', () => {
  it('gives every kind of the spec its own shape', () => {
    expect(new Set(BLIP_KINDS)).toEqual(new Set(['mission', 'waypoint', 'route', 'police', 'experience', 'property', 'shop', 'transit', 'landmark', 'fasttravel', 'player', 'friend']));
    const glyphs = BLIP_KINDS.map((k) => BLIP_STYLE[k].glyph);
    expect(new Set(glyphs).size).toBe(BLIP_KINDS.length);
    // the drawn paths differ too, not only the labels
    const drawn = BLIP_KINDS.map((k) => JSON.stringify(draw(k).ops.filter((o) => !['save', 'restore', 'translate'].includes(o[0] as string))));
    expect(new Set(drawn).size).toBe(BLIP_KINDS.length);
  });

  it('uses the tokens of the table: objective for missions, waypoint and route, danger for police, friendly for experiences, fast travel and friends', () => {
    expect(BLIP_STYLE.mission.token).toBe('objective');
    expect(BLIP_STYLE.waypoint.token).toBe('objective');
    expect(BLIP_STYLE.route.token).toBe('objective');
    expect(BLIP_STYLE.police.token).toBe('danger');
    expect(BLIP_STYLE.experience.token).toBe('friendly');
    expect(BLIP_STYLE.fasttravel.token).toBe('friendly');
    expect(BLIP_STYLE.friend.token).toBe('friendly');
    for (const k of ['property', 'shop', 'transit', 'landmark', 'player'] as const) expect(BLIP_STYLE[k].token).toBe('neutral');
  });

  for (const name of PALETTE_NAMES) {
    it(`draws every kind with colours that are tokens of the ${name} palette`, () => {
      const palette = mapPaletteOf(name);
      const allowed = new Set(Object.values(palette));
      expect(allowed.size).toBeGreaterThanOrEqual(10);
      for (const kind of BLIP_KINDS) {
        const rec = draw(kind, palette);
        expect(rec.colors.size).toBeGreaterThan(0);
        for (const c of rec.colors) expect(allowed.has(c), `${kind} used ${c}`).toBe(true);
      }
      // a rim blip and the GPS line as well
      const cv = fakeCanvas();
      drawBlip(cv.getContext('2d'), { kind: 'mission' }, 10, 10, palette, { rimAngle: 0.5 });
      drawRoute(cv.getContext('2d'), Float32Array.from([0, 0, 50, 0, 100, 40]), (x, z, o) => { o[0] = x; o[1] = z; }, palette);
      for (const c of cv.rec.colors) expect(allowed.has(c), `rim or route used ${c}`).toBe(true);
    });
  }

  it('gives the colour-blind palettes different semantic colours with the same shapes', () => {
    const d = mapPaletteOf('default'), p = mapPaletteOf('protan');
    expect(d.danger).not.toBe(p.danger);
    expect(d.water).toBe(p.water);
  });

  it('clamps a point to the rim and reports its angle, or reports none inside', () => {
    const out: [number, number] = [0, 0];
    expect(clampToRim(3, 4, 10, out)).toBeNull();
    expect(out).toEqual([3, 4]);
    const a = clampToRim(30, 40, 10, out);
    expect(a).toBeCloseTo(Math.atan2(40, 30), 9);
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(10, 9);
  });
});

// ---- the GPS line (AC-5) ----------------------------------------------------------------------------------------------------

const CH = '9/256/256' as ChunkKey;
/** One straight street from x = -120 to 120 with a centreline point every 0.5 m (481 points: more than the 400 of a route). */
function straight() {
  const via: number[] = [];
  for (let x = -119.5; x < 120; x += 0.5) via.push(x, 0);
  return roads([[-120, 0], [120, 0]], [{ a: 0, b: 1, via }]);
}
function graphOf(f: ReturnType<typeof straight>): RoadGraph {
  const net = new RoadNetwork(topologyOf(f));
  net.addChunk(chunkOf(CH, f));
  return new RoadGraph(net, { tick: () => 0, blackout: () => false, closed: () => false });
}

describe('GPS route (AC-5)', () => {
  it('plans a line with at most 400 points from the player to the target', () => {
    const f = straight();
    const me = { x: -100, z: 0 };
    const api = new MapApiImpl({ graph: graphOf(f), player: () => me });
    api.setRoute({ x: 100, z: 0 });
    const patch = api.flush(1)!;
    expect(patch.route).not.toBeNull();
    const pts = patch.route!.points;
    expect(pts.length / 2).toBeLessThanOrEqual(ROUTE_MAX_POINTS);
    expect(pts.length / 2).toBeGreaterThan(300);
    expect(pts[0]).toBe(-100);
    expect(pts[pts.length - 2]).toBe(100);
  });

  it('replans no more often than every 3 s when the player drifts 30 m off the route and keeps moving', () => {
    const f = straight();
    const graph = graphOf(f);
    const route = vi.spyOn(graph, 'route');
    const me = { x: -100, z: 0 };
    const api = new MapApiImpl({ graph, player: () => me });
    api.setRoute({ x: 100, z: 0 });
    const planTicks: number[] = [];
    let last = -1;
    for (let tick = 1; tick <= 1500; tick++) {
      // after 100 ticks the player is 30 m beside the street and drives on along it
      if (tick > 100) me.z = 30;
      me.x = Math.min(60, -100 + tick * 0.1);
      const before = route.mock.calls.length;
      const p = api.flush(tick);
      if (route.mock.calls.length > before) planTicks.push(tick);
      if (p?.route) {
        expect(p.route.points.length / 2).toBeLessThanOrEqual(ROUTE_MAX_POINTS);
        last = tick;
      }
    }
    expect(last).toBeGreaterThan(0);
    // the first plan at tick 1; the next ones only once the player is more than 25 m off the line, and 180 ticks apart at the least
    expect(planTicks[0]).toBe(1);
    expect(planTicks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < planTicks.length; i++) expect(planTicks[i]! - planTicks[i - 1]!).toBeGreaterThanOrEqual(REPLAN_TICKS);
    expect(REPLAN_TICKS).toBe(180);
    // 1500 ticks hold at most 1 + floor(1499 / 180) plans
    expect(planTicks.length).toBeLessThanOrEqual(1 + Math.floor(1499 / REPLAN_TICKS));
  });

  it('does not replan while the player stays on the route', () => {
    const f = straight();
    const graph = graphOf(f);
    const route = vi.spyOn(graph, 'route');
    const me = { x: -100, z: 0 };
    const api = new MapApiImpl({ graph, player: () => me });
    api.setRoute({ x: 100, z: 0 });
    for (let tick = 1; tick <= 1200; tick++) {
      me.x = -100 + tick * 0.1;
      api.flush(tick);
    }
    expect(route.mock.calls.length).toBe(1);
  });

  it('measures the distance to the line', () => {
    expect(distToPolyline([0, 0, 100, 0], 50, 30)).toBeCloseTo(30, 9);
    expect(distToPolyline([0, 0, 100, 0], 130, 0)).toBeCloseTo(30, 9);
    expect(distToPolyline([], 0, 0)).toBe(Infinity);
    expect(OFF_ROUTE_M).toBe(25);
  });

  it('draws the line from the player on, without the part behind', () => {
    const r = Float32Array.from([0, 0, 50, 0, 100, 0, 150, 0]);
    const t = trimRoute(r, 60, 4)!;
    expect(Array.from(t)).toEqual([60, 4, 100, 0, 150, 0]);
    expect(trimRoute(null, 0, 0)).toBeNull();
  });

  it('draws a casing, the line and chevrons', () => {
    const cv = fakeCanvas();
    const n = drawRoute(cv.getContext('2d'), Float32Array.from([0, 0, 300, 0]), (x, z, o) => { o[0] = x; o[1] = z; }, mapPaletteOf('default'), 4, 50);
    expect(n).toBe(2);
    expect(cv.rec.count('stroke')).toBe(2);
    expect(cv.rec.count('fill')).toBeGreaterThanOrEqual(5);
  });
});

// keep the type import used
export type _B = MapBlip;

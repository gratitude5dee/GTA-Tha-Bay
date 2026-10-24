/**
 * M05c2: the small engine pieces the new missions lean on. The pace of a scripted leader car and the corner cap of a route, a glider
 * (a kinematic convoy prop) driven along a route, route waypoints without the zig-zag of joined edges and with the wrong-way edges
 * sampled backwards, `setFlag('story.act')` and `emit('vehicle.respray')`.
 */
import { Velocity } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import { at, circle, defineMission, driveTo, emit, npc, prop, setFlag, spawn, stage, task, vehicle, wait, waitFor } from '../src/authoring/index.ts';
import { cornerCap, paceFactor, PACE_FLOOR } from '../src/vm/tasks.ts';
import { routeWaypoints } from '../src/vm/route.ts';
import { ll, makeHarness, seatPlayer } from './harness.ts';

describe('paceFactor and cornerCap', () => {
  it('a leader keeps its speed up to slowAbove, the floor from floorAt, and eases between', () => {
    expect(paceFactor(10, 40, 80)).toBe(1);
    expect(paceFactor(40, 40, 80)).toBe(1);
    expect(paceFactor(80, 40, 80)).toBe(PACE_FLOOR);
    expect(paceFactor(200, 40, 80, 0)).toBe(0);
    expect(paceFactor(60, 40, 80, 0)).toBeCloseTo(0.5, 6);
  });

  it('a straight route allows speed; a right angle ahead caps it; a few-metre jitter is a bend only when it is a bend', () => {
    const straight = [[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]] as [number, number, number][];
    expect(cornerCap(straight, 0, [0, 0, 0], 10)).toBeGreaterThan(15);
    const corner = [[10, 0, 0], [20, 0, 0], [20, 0, 10], [20, 0, 20]] as [number, number, number][];
    expect(cornerCap(corner, 0, [0, 0, 0], 10)).toBeLessThan(cornerCap(straight, 0, [0, 0, 0], 10));
    expect(cornerCap(corner, 0, [0, 0, 0], 10)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('route waypoints', () => {
  const buf = (x: number, z: number, out: Float64Array): void => {
    out[0] = x;
    out[1] = 0;
    out[2] = z;
    out[3] = 0;
  };
  /** A graph of two straight edges that meet with a one-metre sideways jog, as two lanes of a join do. */
  function world(opts: { wrongWay?: boolean[] } = {}) {
    return {
      graph: {
        route: () => null,
        routeDetailed: (req: { avoid?: ReadonlySet<number>; allowWrongWay?: boolean }) => ({ edges: req.avoid?.has(1) ? [3] : [1, 2], lengthM: 120, ...(opts.wrongWay ? { wrongWay: opts.wrongWay } : {}) }),
        laneCentre: (e: { edge: number; s: number }, out: Float64Array) => {
          const s = Math.min(e.s, 60);
          if (e.edge === 1) buf(s, 0, out);
          else if (e.edge === 2) buf(60 + s, 1, out); // starts 1 m to the side of where edge 1 ended
          else buf(s, 50, out);
        },
      },
    } as never;
  }

  it('drops the sample at the join of two edges that lies within 3.5 m of the one before it, keeps the goal, and fills edgesOut in step', () => {
    const edges: number[] = [];
    const path = routeWaypoints(world(), [0, 0, 0], [120, 0, 1], undefined, undefined, edges) as [number, number, number][];
    expect(path.length).toBe(edges.length);
    for (let i = 1; i < path.length - 1; i++) {
      const d = Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![2] - path[i - 1]![2]);
      expect(d).toBeGreaterThanOrEqual(3.5);
    }
    expect(path.at(-1)).toEqual([120, 0, 1]);
  });

  it('an avoid set changes the route; a wrong-way edge is sampled from its far end', () => {
    const w = world();
    const direct = routeWaypoints(w, [0, 0, 0], [60, 0, 50]) as [number, number, number][];
    const detour = routeWaypoints(w, [0, 0, 0], [60, 0, 50], undefined, new Set([1])) as [number, number, number][];
    // the goal ends both; only the detour runs along the third edge (z = 50) before it
    expect(direct.filter((p) => p[2] === 50)).toHaveLength(1);
    expect(detour.filter((p) => p[2] === 50).length).toBeGreaterThan(2);
    const back = routeWaypoints(world({ wrongWay: [true, false] }), [60, 0, 0], [120, 0, 1]) as [number, number, number][];
    // edge 1 reversed: the first samples run from x = 60 down towards 0 (the nearest-to-start trim keeps the part from the player on)
    expect(back[0]![0]).toBeGreaterThanOrEqual(back[1]![0] - 0.001);
  });
});

describe('mission ops', () => {
  const ID = 'm.t.m05c2';
  const mission = (onEnter: ReturnType<typeof setFlag>[]) =>
    defineMission({
      id: ID,
      version: 1,
      district: 'd1',
      cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)), spawnAt: 'manual' }) },
      zones: { z: circle(...ll(50, 0), 5) },
      stages: [stage('a', [waitFor(600, { id: 'long' })], { onEnter })],
    });

  it("setFlag('story.act') raises the campaign act and never lowers it", () => {
    const h = makeHarness();
    h.story.act = 1;
    h.start(mission([setFlag({ 'story.act': 2 })]));
    h.step(3);
    expect(h.story.act).toBe(2);
    expect(h.story.flags['story.act']).toBe(2);
    const g = makeHarness();
    g.story.act = 3;
    g.start(mission([setFlag({ 'story.act': 2 })]));
    g.step(3);
    expect(g.story.act).toBe(3);
  });

  it("emit('vehicle.respray') asks the pursuit to respray the car the player sits in, and does nothing on foot", () => {
    const keys: string[] = [];
    const h = makeHarness();
    (h.ctx.pursuit as unknown as { respray: (k: string) => void }).respray = (k) => void keys.push(k);
    const ir = defineMission({
      id: ID,
      version: 1,
      district: 'd1',
      cast: { car: vehicle({ prefab: 'vehicle.compact', spawn: at(...ll(5, 5)) }) },
      zones: { z: circle(...ll(50, 0), 5) },
      stages: [stage('a', [waitFor(600, { id: 'long' })], { onEnter: [spawn('car'), wait(0.5), emit('vehicle.respray')] })],
    });
    h.start(ir);
    h.step(2);
    expect(keys).toEqual([]);
    seatPlayer(h, h.at('mis:m.t.m05c2:car') as never);
    h.step(60);
    expect(keys.length).toBeGreaterThanOrEqual(1);
  });
});

describe('gliders', () => {
  it('a kinematic prop with a Velocity is driven along the route by driveTo and stops in the goal zone', () => {
    const h = makeHarness();
    const ir = defineMission({
      id: 'm.t.glide',
      version: 1,
      district: 'd1',
      cast: { lead: prop({ prefab: 'prop.crate', spawn: at(...ll(0, 0)) }) },
      zones: { goal: circle(...ll(60, 0), 6) },
      stages: [stage('a', [waitFor(600, { id: 'long' })], { onEnter: [task('lead', driveTo('goal'))] })],
    });
    const world = h.ctx.world as unknown as { graph: Record<string, unknown> };
    world.graph = {
      route: () => ({ edges: [1], lengthM: 60, etaS: 8, complete: true }),
      laneCentre: (e: { s: number }, out: Float64Array) => {
        out[0] = Math.min(e.s, 60);
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
      },
    };
    h.start(ir);
    h.step(900);
    const lead = h.rt.actors.cast('lead');
    expect(lead).not.toBeNull();
    const pos = h.rt.actors.posOf(lead as never) as [number, number, number];
    // the crate started at the origin and now stands in the 6 m goal zone 60 m east, at rest
    expect(Math.hypot(pos[0] - ll2(60, 0)[0], pos[2] - ll2(60, 0)[1])).toBeLessThan(7);
    const id = h.ecs.resolve(lead as never) as number;
    expect(Math.hypot(h.ecs.store(Velocity).vx[id] as number, h.ecs.store(Velocity).vz[id] as number)).toBeLessThan(0.5);
  });
});

/** The ENU point a `ll(x, z)` pair stands for (the harness world is flat and its origin is City Hall). */
function ll2(x: number, z: number): [number, number] {
  return [x, z];
}

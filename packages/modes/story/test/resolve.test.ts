import type { MissionIR, WorldResolver } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { at, atLandmark, circle, defineMission, landmark, npc, poly, route, stage, waitFor } from '../src/authoring/index.ts';
import { resolveMission } from '../src/compiler/resolve.ts';
import { StoryController } from '../src/mode.ts';
import { flatResolver, ll, makeHarness } from './harness.ts';

const ID = 'm.t.res';

function mission(over: Partial<Parameters<typeof defineMission>[0]> = {}): MissionIR {
  const m = defineMission({
    id: ID,
    version: 2,
    district: 'd1',
    cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }) },
    zones: { z: circle(...ll(50, 0), 5), p: poly([ll(0, 0), ll(10, 0), ll(10, 10)]) },
    stages: [stage('a', [waitFor(600, { id: 'w' })])],
    ...over,
  });
  return { ...m, worldBake: 'old-bake' };
}

/** 30 m of every road: ground placements resolve, anything on a road does not. */
const roadless: Partial<WorldResolver> = {
  snap: (req) => {
    if (req.snap === 'road' || 'landmark' in req.at) return null;
    return { pos: [0, 0, 0], yaw: 0, distM: 0 };
  },
};

describe('load-time resolution (C09 section C5 step 2)', () => {
  it('turns tuples into ENU metres and registers shapes; the loaded bake wins over the compiled one', () => {
    const r = resolveMission(mission(), flatResolver('new-bake'));
    if ('errors' in r) throw new Error('unexpected');
    expect(r.bake).toBe('new-bake');
    expect(r.ir.worldBake).toBe('old-bake');
    const z = r.zones['z'];
    expect(z?.k).toBe('circle');
    if (z?.k === 'circle') {
      expect(z.at[0]).toBeCloseTo(50, 1);
      expect(z.at[2]).toBeCloseTo(0, 1);
      expect(z.r).toBe(5);
    }
    const p = r.zones['p'];
    expect(p?.k === 'poly' && p.ring).toHaveLength(3);
    expect(r.spawns['pal']?.pos[0]).toBeCloseTo(10, 1);
    expect(r.spawns['pal']?.pos[2]).toBeCloseTo(10, 1);
  });

  it('a landmark zone takes the landmark\'s position and a route zone becomes its edge set', () => {
    const w = flatResolver('b', {
      landmark: (id) => (id === 'lm.city-hall' ? { enu: [4, 17, 1], chunkKey: '9/256/256' } : null),
      route: () => [3, 4, 5],
    });
    const r = resolveMission(mission({ zones: { hall: landmark('lm.city-hall', 12), road: route(8, ll(0, 0), ll(50, 0)) } }), w);
    if ('errors' in r) throw new Error('unexpected');
    expect(r.zones['hall']).toEqual({ k: 'circle', at: [4, 17, 1], r: 12 });
    expect(r.zones['road']).toEqual({ k: 'edges', edgeIds: [3, 4, 5], widthM: 8 });
  });

  it('fails with E_REF_LANDMARK, E_ROUTE_UNSNAPPABLE and E_REF_ZONE, each with a pointer', () => {
    const r1 = resolveMission(mission({ zones: { hall: landmark('lm.nowhere') } }), flatResolver());
    expect('errors' in r1 && r1.errors).toEqual([{ code: 'E_REF_LANDMARK', pointer: '/zones/hall', message: expect.any(String) }]);
    const r2 = resolveMission(mission({ zones: { road: route(8, ll(0, 0), ll(50, 0)) } }), flatResolver());
    expect('errors' in r2 && r2.errors[0]).toMatchObject({ code: 'E_ROUTE_UNSNAPPABLE', pointer: '/zones/road' });
    const r3 = resolveMission(mission({ cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10), { snap: 'road' }) }) } }), flatResolver('b', roadless));
    expect('errors' in r3 && r3.errors[0]).toMatchObject({ code: 'E_REF_ZONE', pointer: '/cast/pal/spawn' });
    const r4 = resolveMission(mission({ cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: atLandmark('lm.nowhere') }) } }), flatResolver());
    expect('errors' in r4 && r4.errors[0]).toMatchObject({ code: 'E_REF_LANDMARK' });
  });
});

describe('a mission that reaches starting (AC-8)', () => {
  function controller(resolver: WorldResolver): { c: StoryController; h: ReturnType<typeof makeHarness> } {
    const h = makeHarness();
    (h.ctx.world as { resolver: WorldResolver }).resolver = resolver;
    const c = new StoryController({ qa: false, bootConfig: () => ({}) });
    c.attach(h.ctx, h.story);
    return { c, h };
  }

  it('is disabled with E_REF_ZONE when a zone cannot be placed; telemetry says unresolved; the saved mission is dropped', () => {
    const { c, h } = controller(flatResolver('new-bake', roadless));
    h.story.activeMission = { id: ID, checkpoint: { schema: 1, data: { missionId: ID, version: 1, worldBake: 'old-bake', stage: 0 } } };
    const ir = mission({ cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10), { snap: 'road' }) }) } });
    const r = c.begin(ir);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]?.code).toBe('E_REF_ZONE');
    expect(c.disabled.get(ID)?.[0]?.code).toBe('E_REF_ZONE');
    expect(h.calls.telemetry).toEqual([{ name: 'mission.fail', props: { mid: ID, stage: 0, sec: 0, attempt: 1, reason: 'unresolved' } }]);
    expect(h.story.activeMission).toBeNull();
    expect(h.story.missions[ID]?.state).toBe('available');
    expect(c.rt).toBeNull();
  });

  it('a different compiled bake alone does not disable it: positions are resolved again', () => {
    const { c, h } = controller(flatResolver('new-bake'));
    const r = c.begin(mission());
    expect(r.ok).toBe(true);
    h.step(3);
    expect(h.calls.telemetry.map((t) => t.name)).toEqual(['mission.start']);
    expect(c.rt?.rm.bake).toBe('new-bake');
    expect(c.disabled.size).toBe(0);
  });

  it('drops a saved mission of an older version or another world bake, and resumes one that matches when asked', () => {
    const cp = (version: number, bake: string): never => ({ id: ID, checkpoint: { schema: 1, data: { missionId: ID, version, worldBake: bake, stage: 0, attempt: 1, seed: 1, rng: [1, 2, 3, 4], elapsedSec: 0, flags: {}, objectivesDone: [], talkResults: {}, player: { x: 0, y: 0, z: 0, yaw: 0, health: 1 }, cast: {}, walletDeltaCents: 0 } } }) as never;
    const old = controller(flatResolver('new-bake'));
    old.h.story.activeMission = cp(1, 'new-bake');
    expect(old.c.begin(mission(), { resume: true }).ok).toBe(true);
    expect(old.h.story.activeMission?.checkpoint.data['version']).not.toBe(1);

    const other = controller(flatResolver('new-bake'));
    other.h.story.activeMission = cp(2, 'a-different-bake');
    other.c.begin(mission(), { resume: true });
    expect(other.h.story.activeMission?.checkpoint.data['worldBake']).not.toBe('a-different-bake');

    const same = controller(flatResolver('new-bake'));
    same.h.story.activeMission = cp(2, 'new-bake');
    const stored = same.h.story.activeMission;
    same.c.begin(mission(), { resume: true });
    expect(same.c.rt?.attempt).toBe(1);
    expect(stored?.id).toBe(ID);
    expect(same.c.rt?.phase).toBe('stage');
  });
});

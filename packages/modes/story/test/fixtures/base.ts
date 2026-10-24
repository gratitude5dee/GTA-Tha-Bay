import type { MissionIR } from '@dv/shared';
import { at, circle, collect, defineMission, failWhen, goto, ko, say, stage, waitFor } from '../../src/authoring/index.ts';
import type { CompileEnv, CompileErrorCode } from '../../src/compiler/index.ts';

/** City Hall is the ENU origin; these tuples sit a few metres from it. */
export const NEAR = { a: [37.7794, -122.4192], b: [37.7795, -122.419], c: [37.7792, -122.4194] } as const;

export const LINES = {
  'line.t.hello': 'Hello there.',
  'line.t.bye': 'See you.',
  'mission.m.t.base.title': 'Base mission',
  'mission.m.t.base.obj.goto_a': 'Go to the spot',
  'mission.m.t.base.obj.collect_box': 'Take the box',
  'mission.m.t.base.obj.wait': 'Wait a moment',
  'fail.reason.ko': 'You went down.',
};

export function baseEnv(over: Partial<CompileEnv> = {}): CompileEnv {
  return {
    profile: 'story',
    bounds: { minX: -9400, maxX: 6200, minZ: -6300, maxZ: 8900 },
    worldBake: 'test-bake',
    lines: new Set(Object.keys(LINES)),
    lineText: LINES,
    i18n: new Set(),
    landmarks: new Set(['lm.city-hall']),
    directors: new Set(['dir.ok']),
    cutscenes: new Map([['cut.story.ok', { fallback: true }], ['cut.story.nofb', { fallback: false }]]),
    names: [],
    strings: null,
    realDerived: (who) => 'slot' in who || who.soul === 'real_soul',
    ...over,
  };
}

/** A small valid mission: two stages, a box to take and a spot to reach. */
export function baseMission(): MissionIR {
  return defineMission({
    id: 'm.t.base',
    version: 1,
    act: 0,
    district: 'd1',
    cast: {
      box: { k: 'prop', prefab: 'prop.crate', spawn: at(NEAR.b[0], NEAR.b[1]) },
      pal: { k: 'npc', who: { soul: 'npc_test' }, role: 'ally', spawn: at(NEAR.c[0], NEAR.c[1]) },
    },
    zones: { spot: circle(NEAR.a[0], NEAR.a[1], 8) },
    stages: [
      stage('one', [goto('spot', { id: 'goto_a' })], { onEnter: [say('pal', 'line.t.hello')] }),
      stage('two', [collect('box', { id: 'collect_box' }), waitFor(1, { id: 'wait' })], { join: 'any' }),
    ],
    fail: [failWhen(ko('player'), 'fail.reason.ko')],
    autoplay: { expectedSec: [30, 300], seeds: [1, 2, 3] },
  });
}

/** One bad mission and the single error it must produce. */
export interface Fixture {
  code: CompileErrorCode;
  /** A pointer that must be among the errors. */
  pointer: string;
  build(): MissionIR;
  env?(): CompileEnv;
}

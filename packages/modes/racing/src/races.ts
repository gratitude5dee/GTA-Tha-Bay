/**
 * The compiled races the mode can run, bundled so the sim worker needs no fetch (`content/races/<id>/race.json`, written by
 * `pnpm map:races compile`). M07a1 ships one; the other VS races and the pursuit arrive in M07a2.
 */
import { straightRaceDef, type RaceDef, type RaceId } from '@dv/shared';
import { DEFAULT_RACE } from './race-ids.ts';
import ferryOceanBeach from '../../../../content/races/sf.sprint.ferry-ocean-beach/race.json';

/**
 * QA only: a straight 180 m sprint north along the street of the gray-box block (x = 96, from z = 190), the default QA scene.
 * The synth bake has ground there but no street, and only tiers whose physics radius reaches 238 m from the synth spawn load its
 * colliders (BD-FIX-CI4-F01). Not content: it is not a place in San Francisco, and the sf race needs the baked streets.
 * `__dvBridge.racing.demo()` and `?racing=demo` start it.
 */
export const DEMO_RACE = 'qa.demo.straight';
const DEMO_AT = { x: 96, y: 16, z: 190 };

function demoRace(): RaceDef {
  const d = straightRaceDef({ lengthM: 180, gates: 3, widthM: 24 });
  return {
    ...d,
    id: DEMO_RACE,
    titleKey: 'race.demo.straight',
    line: { ...d.line, start: [DEMO_AT.x * 10, DEMO_AT.z * 10] },
    elevation: d.elevation.map((e) => ({ s: e.s, y: DEMO_AT.y })),
    gates: d.gates.map((g) => ({ ...g, at: [g.at[0] + DEMO_AT.x, DEMO_AT.y, g.at[2] + DEMO_AT.z] as [number, number, number] })),
  };
}

export const RACE_DEFS: Readonly<Record<RaceId, RaceDef>> = {
  'sf.sprint.ferry-ocean-beach': ferryOceanBeach as unknown as RaceDef,
  [DEMO_RACE]: demoRace(),
};

export { DEFAULT_RACE };

export function raceDef(id: RaceId): RaceDef | null {
  return RACE_DEFS[id] ?? null;
}

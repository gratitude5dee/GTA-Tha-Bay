/**
 * A synthetic straight race for tests and tools (M07a1): a road running north (-Z) from the origin, a start gate, `gates` numbered
 * gates and the finish at `lengthM`. Not content: nothing ships it. Pure; C02 lint applies.
 */
import type { GateDef, RaceDef } from './race-def.ts';

export interface StraightRaceOptions {
  lengthM?: number;
  /** Numbered gates after the start gate, the last one being the finish. */
  gates?: number;
  widthM?: number;
  kind?: RaceDef['kind'];
  laps?: number;
  timeBonusSec?: number;
}

export function straightRaceDef(o: StraightRaceOptions = {}): RaceDef {
  const lengthM = o.lengthM ?? 1000;
  const n = o.gates ?? 5;
  const widthM = o.widthM ?? 14;
  const stepM = 5;
  const points = Math.floor(lengthM / stepM) + 1;
  const dxz: number[] = [];
  for (let i = 1; i < points; i++) dxz.push(0, -stepM * 10);
  const gates: GateDef[] = [{ s: 10, widthM, kind: 'start', at: [0, 0, -10], tangent: [0, -1] }];
  for (let i = 1; i <= n; i++) {
    const s = (lengthM * i) / n;
    const g: GateDef = { s, widthM, kind: i === n ? 'finish' : 'gate', at: [0, 0, -s], tangent: [0, -1] };
    if (o.timeBonusSec !== undefined && i !== n) g.timeBonusSec = o.timeBonusSec;
    gates.push(g);
  }
  const elevation: { s: number; y: number }[] = [];
  for (let s = 0; s <= lengthM; s += 25) elevation.push({ s, y: 0 });
  return {
    schema: 1,
    id: 'sf.sprint.fixture-straight',
    version: 1,
    kind: o.kind ?? 'sprint',
    titleKey: 'race.fixture.straight',
    district: 'd1',
    traffic: 'off',
    peds: 'sidewalk',
    opponents: [],
    police: { enabled: false, startHeat: 0, maxHeat: 0 },
    rubberBand: 0,
    rewards: [],
    xr: 'full',
    ...(o.laps !== undefined ? { laps: o.laps } : {}),
    worldBake: '0'.repeat(64),
    waypoints: [{ lat: 37.79, lng: -122.4 }, { lat: 37.8, lng: -122.4 }],
    route: [{ edgeIds: [0], dir: 1 }],
    routeLenM: lengthM,
    elevation,
    gates,
    closures: [],
    zones: [],
    grid: [{ s: 4, lane: 0, offsetM: 0 }],
    jumpZones: [],
    line: { stepM, curvature: new Array<number>(points).fill(0), offsetCm: new Array<number>(points).fill(0), start: [0, 0], dxz },
    parSec: lengthM / 30,
    parBotHash: 'pending',
    medals: [lengthM / 24, lengthM / 26.8, lengthM / 28.8],
    version: 1,
  };
}

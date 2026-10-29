/**
 * m.a1.01 Jump Start (Act 1, D3 Bayview; 03-story-narrative.md B4). The first morning: the player walks to the Yard gate, takes the
 * tow truck, finds a stalled robotaxi on Third Street, hooks it (a collect: the car is lifted onto the truck) and tows it home. The
 * clock is locked at 06:30 in fog until the truck stage (M02g1), where it is released and the fog burns off into morning sun (C09 1.1). The VM has no hitch, so the lifted car is carried and set down in the Yard. Passing grants district d3, the safehouse sh.yard and the tow truck (garage.add).
 * Coordinates are WGS84 and sit on the sf bake's roads (checked with `pnpm map:resolve`).
 */
import {
  always, at, autoTrigger, circle, clock, collect, defineMission, deliver, destroyed, enterVehicle, failWhen, goto, ko, npc, say, spawn, stage, vehicle,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.01',
  version: 2,
  act: 1,
  district: 'd3',
  tags: ['sensitivity-read'],
  title: 'mission.m.a1.01.title',
  start: autoTrigger(always()),
  cast: {
    odessa: npc({ soul: 'odessa_calloway', role: 'mentor', spawn: at(37.73645, -122.38868, { snap: 'road' }) }),
    tavi: npc({ soul: 'tavi_okafor', role: 'ally', spawn: at(37.73641, -122.38868, { snap: 'road' }) }),
    tow: vehicle({ prefab: 'vehicle.pickup', spawn: at(37.73633, -122.38850, { snap: 'road', yawDeg: -126 }), playerUsable: true }),
    pod_car: vehicle({ prefab: 'robotaxi.default', spawn: at(37.73583, -122.38762, { snap: 'road', yawDeg: -126 }), role: 'civilian', spawnAt: 'manual' }),
  },
  zones: {
    yard_gate: circle(37.73639, -122.38860, 9),
    stall: circle(37.73583, -122.38762, 14),
    yard: circle(37.73648, -122.38865, 16),
  },
  intro: { cutscene: 'cut.story.m.a1.01.dawn' },
  outro: { director: 'm.a1.01.pod' },
  stages: [
    stage('to_gate', [goto('yard_gate', { id: 'goto_gate', onFoot: true })], {
      onEnter: [clock({ lock: { hour: 6.5, weather: 'karl-fog' } }), say('odessa', 'line.m.a1.01.gate')],
    }),
    stage('truck', [enterVehicle('tow', { id: 'enter_tow' })], {
      onEnter: [clock({ unlock: true, lock: { weather: 'clear' } }), spawn('pod_car'), say('odessa', 'line.m.a1.01.truck')],
    }),
    stage('to_stall', [goto('stall', { id: 'goto_stall', inVehicle: 'tow', stopped: true })], { onEnter: [say('tavi', 'line.m.a1.01.radio')] }),
    stage('hook', [collect('pod_car', { id: 'hook_pod' })], { onComplete: [say('player', 'line.m.a1.01.hook')] }),
    stage('truck_again', [enterVehicle('tow', { id: 'enter_tow_again' })]),
    stage('tow_home', [deliver('pod_car', 'yard', { id: 'deliver_pod', fragile: 0.5 })], { checkpoint: true, onEnter: [say('odessa', 'line.m.a1.01.tow')] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.01.fail.ko'),
    failWhen(destroyed('pod_car'), 'mission.m.a1.01.fail.pod', 'start'),
    failWhen(destroyed('tow'), 'mission.m.a1.01.fail.tow', 'start'),
  ],
  heatPolicy: { maxHeat: 0, clearOnPass: true },
  rewards: { cashCents: 50_000, safehouse: 'sh.yard', vehicles: ['vehicle.pickup'] },
  unlocks: ['unlock.district.d3'],
  medals: { silverSec: 480, goldSec: 360 },
  autoplay: { expectedSec: [30, 600], seeds: [1, 2, 3] },
});


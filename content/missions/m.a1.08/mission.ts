/**
 * m.a1.08 Dead Pixels (Act 1, D3 Bayview to D1; 03-story-narrative.md B4). At night (21:00 to 04:00) a Halcyon mapping car sweeps the
 * Bayview. Patch wants the road it takes: the player waits at the Yard gate, follows the car at a distance (15 to 90 m, lose it after
 * 25 s) to its depot near Mission Bay, photographs the depot gate, then runs down a second mapping car (catch it within 6 m for 3 s) to
 * plant Patch's dongle, and loses the patrol the depot calls (heat 2). Both mapping cars are scripted cast cars that follow the C08 road
 * graph. Sensitivity read: the night drive starts in the Bayview (B3 rule 4).
 */
import {
  at, beat, chase, circle, clock, defineMission, destroyed, enterVehicle, escape, failWhen, follow, heat, ko, markerTrigger, npc, passed, photo, prop, say, spawn, stage, task,
  vehicle, waitFor, driveTo, busted,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.08',
  version: 1,
  act: 1,
  district: 'd3',
  tags: ['sensitivity-read'],
  title: 'mission.m.a1.08.title',
  requires: [passed('m.a1.07')],
  start: markerTrigger(at(37.73639, -122.38860), 8, { hours: [21, 4] }),
  cast: {
    ride: vehicle({ prefab: 'vehicle.compact', spawn: at(37.73642, -122.38843, { snap: 'road', yawDeg: 55 }), playerUsable: true }),
    patch: npc({ soul: 'patch', role: 'ally', spawn: at(37.73641, -122.38868, { snap: 'road' }), spawnAt: 'manual' }),
    scan1: vehicle({ prefab: 'convoy.sedan', spawn: at(37.73655, -122.38876, { snap: 'road', yawDeg: 54 }), role: 'civilian', spawnAt: 'manual' }),
    scan2: vehicle({ prefab: 'convoy.sedan', spawn: at(37.76199, -122.38771, { snap: 'road', yawDeg: 4 }), role: 'civilian', spawnAt: 'manual' }),
    gate: prop({ prefab: 'prop.barrier', spawn: at(37.75990, -122.38762, { snap: 'road' }) }),
  },
  zones: {
    yard_gate: circle(37.73639, -122.38860, 9),
    depot: circle(37.75999, -122.38753, 26),
    lap: circle(37.76600, -122.38807, 24),
  },
  stages: [
    stage('wait', [enterVehicle('ride', { id: 'enter_ride' })], {
      onEnter: [clock({ lock: { hour: 22, weather: 'karl-fog' } }), say('radio', 'line.m.a1.08.start')],
    }),
    stage('lurk', [waitFor(4, { id: 'wait_car' })], { onEnter: [say('radio', 'line.m.a1.08.lurk')] }),
    stage('tail', [follow('scan1', [15, 90], 25, { id: 'follow_scanner', untilZone: 'depot' })], {
      checkpoint: true,
      onEnter: [spawn('scan1'), beat({ cutscene: 'cut.story.m.a1.08.scanner' }), task('scan1', driveTo('depot', 'normal')), say('radio', 'line.m.a1.08.tail')],
    }),
    stage('snap', [photo('gate', { id: 'photo_gate', maxDistM: 30 })], { conduct: 'unlawful', onEnter: [say('radio', 'line.m.a1.08.gate')] }),
    stage('wheels_again', [enterVehicle('ride', { id: 'enter_ride_again' })], { conduct: 'unlawful' }),
    stage('plant', [chase('scan2', 6, { id: 'chase_scanner', holdSec: 3 })], {
      conduct: 'unlawful',
      checkpoint: true,
      onEnter: [spawn('scan2'), task('scan2', driveTo('lap', 'normal')), say('radio', 'line.m.a1.08.plant')],
      onComplete: [say('patch', 'line.m.a1.08.planted')],
    }),
    stage('lose', [escape({ id: 'escape_patrol' })], { conduct: 'unlawful', checkpoint: true, onEnter: [heat({ set: 1 }), say('radio', 'line.m.a1.08.patrol')] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.08.fail.ko'),
    failWhen(busted(), 'mission.m.a1.08.fail.busted'),
    failWhen(destroyed('ride'), 'mission.m.a1.08.fail.ride', 'start'),
  ],
  heatPolicy: { maxHeat: 2, clearOnPass: true },
  rewards: { cashCents: 300_000 },
  medals: { silverSec: 900, goldSec: 600 },
  autoplay: { expectedSec: [60, 1500], seeds: [1, 2, 3] },
});

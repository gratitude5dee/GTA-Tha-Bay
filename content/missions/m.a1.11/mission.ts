/**
 * m.a1.11 Night Market (Act 1, D2 on 24th Street; 03-story-narrative.md B4). The 24th Street night market runs from 19:00 to 23:00.
 * The guest of honor (a roster slot, drawing raffle tickets; lawful, no sport) is thanked, then three Halcyon "curb compliance" tow
 * trucks roll out to clear the stalls and the player boxes each one in (within 4 m for 2 s, all three inside 240 s, times the player's
 * timer scale). The trucks are scripted cast cars that follow the road graph and park at the end of their run. The patrol the trucks call
 * is the last stage (scripted heat 2). Starts at the market plaza between 19:00 and 23:00.
 */
import {
  at, busted, chase, circle, clock, defineMission, despawn, destroyed, driveTo, enterVehicle, escape, failWhen, heat, ko, markerTrigger, npc, passed, say, spawn, stage, talk, talkDef, task, vehicle,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.11',
  version: 1,
  act: 1,
  district: 'd2',
  title: 'mission.m.a1.11.title',
  requires: [passed('m.a1.06')],
  start: markerTrigger(at(37.75225, -122.41840), 10, { hours: [19, 23] }),
  lines: ['line.m.a1.11.talk.raffle.open'],
  cast: {
    guest: npc({ slot: 'ATH_SHOOTER', role: 'cameo', spawn: at(37.75222, -122.41850) }),
    ride: vehicle({ prefab: 'vehicle.compact', spawn: at(37.75215, -122.41999, { snap: 'road', yawDeg: 95 }), playerUsable: true }),
    truck_a: vehicle({ prefab: 'convoy.pickup', spawn: at(37.75400, -122.41863, { snap: 'road', yawDeg: -176 }), role: 'antagonist', spawnAt: 'manual' }),
    truck_b: vehicle({ prefab: 'convoy.pickup', spawn: at(37.75215, -122.42160, { snap: 'road', yawDeg: 95 }), role: 'antagonist', spawnAt: 'manual' }),
    truck_c: vehicle({ prefab: 'convoy.pickup', spawn: at(37.75236, -122.41651, { snap: 'road', yawDeg: -86 }), role: 'antagonist', spawnAt: 'manual' }),
  },
  zones: {
    run_a: circle(37.75100, -122.41891, 20),
    run_b: circle(37.75194, -122.42348, 20),
    run_c: circle(37.75221, -122.41186, 20),
  },
  stages: [
    stage(
      'raffle',
      [
        talk(
          talkDef({
            id: 'raffle',
            npc: 'guest',
            intent: 'mission.m.a1.11.talk.raffle.intent',
            outcomes: { thanks: { label: 'mission.m.a1.11.talk.raffle.thanks', flags: { 'a1.11.raffle': true }, trust: 3 } },
            default: 'thanks',
            maxTurns: 2,
          }),
          { id: 'talk_raffle' },
        ),
      ],
      { onEnter: [clock({ lock: { hour: 20, weather: 'clear' } }), say('radio', 'line.m.a1.11.start')], onComplete: [despawn('guest')] },
    ),
    stage('wheels', [enterVehicle('ride', { id: 'enter_ride' })], { onEnter: [say('radio', 'line.m.a1.11.trucks')] }),
    stage(
      'box_in',
      [
        chase('truck_a', 4, { id: 'box_a', holdSec: 2 }),
        chase('truck_b', 4, { id: 'box_b', holdSec: 2 }),
        chase('truck_c', 4, { id: 'box_c', holdSec: 2 }),
      ],
      {
        join: 'sequence',
        timeLimitSec: 240,
        checkpoint: true,
        conduct: 'unlawful',
        onEnter: [
          spawn('truck_a', 'truck_b', 'truck_c'),
          task('truck_a', driveTo('run_a', 'normal')),
          task('truck_b', driveTo('run_b', 'normal')),
          task('truck_c', driveTo('run_c', 'normal')),
        ],
      },
    ),
    stage('lose', [escape({ id: 'escape_patrol' })], { conduct: 'unlawful', checkpoint: true, onEnter: [heat({ set: 2 }), say('radio', 'line.m.a1.11.patrol')] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.11.fail.ko'),
    failWhen(busted(), 'mission.m.a1.11.fail.busted'),
    failWhen(destroyed('ride'), 'mission.m.a1.11.fail.ride', 'start'),
  ],
  heatPolicy: { maxHeat: 3, clearOnPass: true },
  rewards: { cashCents: 300_000, streetCred: 60 },
  medals: { silverSec: 900, goldSec: 540 },
  autoplay: { expectedSec: [60, 1500], seeds: [1, 2, 3] },
});

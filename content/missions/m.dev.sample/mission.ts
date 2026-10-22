/**
 * m.dev.sample: the development mission of the story VM (M05a1). It plays in the gray-box Civic Center block, uses every objective
 * kind except `escape` and `defeat` (Act 1 covers those), and has a talk with two outcomes and a racing hook whose stub waits five
 * seconds. Positions are WGS84 tuples; they sit within 150 m of City Hall, on the gray-box terrain. Display text is in lines.en.json.
 */
import {
  ambient, at, circle, clock, collect, castZone, chase, defineMission, deliver, destroyed, enterVehicle, failWhen, fleeTask, follow, give, goto, ko, markerTrigger, modeHook,
  modeObjective, npc, pickup, photo, protect, say, score, setFlag, stage, stealth, survive, talk, talkDef, task, text, vehicle, wait, waitFor, walkTo,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.dev.sample',
  version: 1,
  act: 0,
  district: 'd4',
  tags: ['dev', 'sensitivity-read'],
  title: 'mission.m.dev.sample.title',
  start: markerTrigger(at(37.77894, -122.418619), 6),
  cast: {
    buddy: npc({ soul: 'npc_test', role: 'ally', spawn: at(37.77885, -122.418051) }),
    runner: npc({ soul: 'standin_founder', role: 'civilian', spawn: at(37.778309, -122.417711) }),
    crate: pickup({ prefab: 'pickup.item', spawn: at(37.778624, -122.418165), item: 'item.dev.parcel' }),
    car: vehicle({ prefab: 'vehicle.compact', spawn: at(37.778507, -122.418483, { yawDeg: 90 }), playerUsable: true }),
  },
  zones: {
    plaza: circle(37.778759, -122.417938, 10),
    corner: circle(37.778399, -122.417484, 12),
    park: circle(37.777949, -122.418959, 15),
    buddy_near: castZone('buddy', 8),
  },
  intro: { director: 'm.dev.sample.intro' },
  stages: [
    stage('arrive', [goto('plaza', { id: 'arrive_plaza', onFoot: true })], {
      onEnter: [ambient({ traffic: 0.5 }), clock({ lock: { hour: 14 } }), say('buddy', 'line.m.dev.sample.hello')],
    }),
    stage(
      'meet',
      [
        talk(
          talkDef({
            id: 'greet',
            npc: 'buddy',
            intent: 'mission.m.dev.sample.talk.greet.intent',
            outcomes: {
              agree: { label: 'mission.m.dev.sample.talk.greet.agree', stage: 'pickup', flags: { 'dev.buddy_ok': true }, trust: 5 },
              decline: { label: 'mission.m.dev.sample.talk.greet.decline', stage: 'pickup', flags: { 'dev.buddy_ok': false }, trust: -5 },
            },
            default: 'agree',
            maxTurns: 3,
          }),
          { id: 'talk_greet' },
        ),
      ],
    ),
    stage('pickup', [collect('crate', { id: 'collect_crate' })], { onComplete: [give('parcel-bonus', { cashCents: 5000 }), setFlag({ 'dev.parcel': true })] }),
    stage('wheels', [enterVehicle('car', { id: 'enter_car' })]),
    stage('drive', [goto('corner', { id: 'goto_corner', inVehicle: 'car', stopped: true })], { checkpoint: true }),
    stage('deliver', [deliver('crate', 'park', { id: 'deliver_crate' })]),
    stage('tail', [follow('buddy', [6, 40], 15, { id: 'follow_buddy', untilZone: 'park' })], { onEnter: [task('buddy', walkTo('park'))] }),
    stage('chase', [chase('runner', 5, { id: 'chase_runner' })], { onEnter: [task('runner', fleeTask('player'))] }),
    stage('guard', [protect('buddy', 0.5, { id: 'protect_buddy', sec: 8 })]),
    stage('snap', [photo('crate', { id: 'photo_crate', maxDistM: 20 })]),
    stage('sneak', [stealth('park', 2, [[37.778039, -122.419073], [37.777949, -122.418959], [37.777904, -122.418789]], { id: 'stealth_park' })]),
    stage('drift', [score('drift', 30, 60, { id: 'score_drift' })]),
    stage('hold', [survive(6, { id: 'survive_six' })]),
    stage('rest', [waitFor(3, { id: 'wait_rest' })]),
    stage('race', [modeObjective('race1', { id: 'mode_race1' })]),
    stage('finish', [goto('plaza', { id: 'return_plaza', onFoot: true })], { onComplete: [say('buddy', 'line.m.dev.sample.bye')] }),
  ],
  threads: { nudge: [wait(45), text('npc_test', 'line.m.dev.sample.nudge')] },
  modeHooks: [
    modeHook({
      id: 'race1',
      mode: 'racing',
      defId: 'race.dev.loop',
      passOn: ['win', 'finish'],
      stub: waitFor(5, { id: 'race1_stub' }),
      unlockOnFirstEncounter: 'unlock.racing',
      retry: 'hook',
    }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.dev.sample.fail.ko'),
    failWhen(ko('buddy'), 'mission.m.dev.sample.fail.buddy'),
    failWhen(destroyed('car'), 'mission.m.dev.sample.fail.car', 'start'),
  ],
  heatPolicy: { maxHeat: 0, clearOnPass: true },
  rewards: { cashCents: 10000, streetCred: 5 },
  medals: { silverSec: 900, goldSec: 600 },
  autoplay: { expectedSec: [120, 900], seeds: [1, 2, 3] },
});

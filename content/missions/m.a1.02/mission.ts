/**
 * m.a1.02 Surge Pricing (Act 1, D1 to D2; 03-story-narrative.md B4). x_ramos sends the player for a fare at 4th and King. The fare is
 * delivered to the 24th St BART plaza inside 240 s (times the player's timer scale) against the clock (a Halcyon robotaxi runs the same trip in the radio chatter);
 * the last stretch is a patrol escape at heat 1 (checkpoint), then home to the Yard. The VM has no passenger seat for a cast NPC, so
 * the fare is picked up on foot (a collect) and set down at the plaza by the delivery.
 */
import {
  at, busted, circle, collect, defineMission, deliver, destroyed, enterVehicle, escape, failWhen, goto, heat, ko, npc, passed, phoneTrigger, say, spawn, stage, vehicle,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.02',
  version: 1,
  act: 1,
  district: 'd1',
  title: 'mission.m.a1.02.title',
  giver: { phone: 'x_ramos' },
  requires: [passed('m.a1.01')],
  start: phoneTrigger('x_ramos'),
  cast: {
    fare: npc({ soul: 'ama_osei', role: 'civilian', spawn: at(37.776389, -122.394215, { snap: 'road' }) }),
    ride: vehicle({ prefab: 'vehicle.compact', spawn: at(37.776602, -122.394471, { snap: 'road', yawDeg: 0 }), playerUsable: true }),
  },
  zones: {
    pickup: circle(37.776389, -122.394215, 14),
    bart: circle(37.752247, -122.418395, 20),
    yard: circle(37.73648, -122.38865, 24),
  },
  stages: [
    stage('to_pickup', [goto('pickup', { id: 'goto_pickup', inVehicle: 'ride', stopped: true })], { onEnter: [say('radio', 'line.m.a1.02.text'), spawn('fare')] }),
    stage('meet_fare', [collect('fare', { id: 'meet_fare' })], { onComplete: [say('fare', 'line.m.a1.02.fare')] }),
    stage('back_in', [enterVehicle('ride', { id: 'enter_ride' })]),
    stage('fare_ride', [deliver('fare', 'bart', { id: 'deliver_fare' })], {
      timeLimitSec: 240,
      onEnter: [say('radio', 'line.m.a1.02.race')],
    }),
    stage('lose_patrol', [escape({ id: 'escape_patrol' })], { checkpoint: true, onEnter: [heat({ set: 1 }), say('radio', 'line.m.a1.02.patrol')] }),
    stage('to_yard', [goto('yard', { id: 'goto_yard', inVehicle: 'ride' })], { onEnter: [say('radio', 'line.m.a1.02.home')] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.02.fail.ko'),
    failWhen(busted(), 'mission.m.a1.02.fail.busted'),
    failWhen(ko('fare'), 'mission.m.a1.02.fail.fare'),
    failWhen(destroyed('ride'), 'mission.m.a1.02.fail.ride', 'start'),
  ],
  heatPolicy: { maxHeat: 2, clearOnPass: true },
  rewards: { cashCents: 120_000, streetCred: 20 },
  unlocks: ['unlock.district.d1', 'unlock.district.d2'],
  medals: { silverSec: 600, goldSec: 420 },
  autoplay: { expectedSec: [60, 720], seeds: [1, 2, 3] },
});


/**
 * m.a1.09 Respray (Act 1, D3 Bayview to Dogpatch; 03-story-narrative.md B4). The mapping cars' depot saw the Yard's tow truck, so the
 * truck is flagged: the moment it leaves the Yard the patrol knows it (scripted heat 3). Odessa sends the player to the body shop in
 * Dogpatch for a respray (which clears the truck's heat, C06 `PursuitApi.respray`), then the player loses the patrol under the freeway
 * viaduct and brings the truck home. Sergeant Bell leads the patrol on the radio. Starts on its own after m.a1.08.
 * Sensitivity read: the drive starts in the Bayview (B3 rule 4).
 */
import {
  at, busted, circle, defineMission, destroyed, emit, enterVehicle, escape, failWhen, goto, heat, ko, passed, say, stage, vehicle, autoTrigger,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.09',
  version: 1,
  act: 1,
  district: 'd3',
  tags: ['sensitivity-read'],
  title: 'mission.m.a1.09.title',
  giver: { phone: 'odessa_calloway' },
  requires: [passed('m.a1.08')],
  start: autoTrigger(passed('m.a1.08')),
  cast: {
    tow: vehicle({ prefab: 'vehicle.pickup', spawn: at(37.73642, -122.38843, { snap: 'road', yawDeg: 55 }), playerUsable: true }),
  },
  zones: {
    exit: circle(37.73681, -122.38923, 22),
    bodyshop: circle(37.75796, -122.38802, 16),
    hide_viaduct: circle(37.75817, -122.39222, 16),
    yard: circle(37.73648, -122.38865, 24),
  },
  stages: [
    stage('wheels', [enterVehicle('tow', { id: 'enter_tow' })], { onEnter: [say('radio', 'line.m.a1.09.start')] }),
    stage('leave', [goto('exit', { id: 'goto_exit', inVehicle: 'tow' })], { onComplete: [heat({ set: 3 }), say('radio', 'line.m.a1.09.flagged')] }),
    stage('shop', [goto('bodyshop', { id: 'goto_shop', inVehicle: 'tow', stopped: true })], {
      checkpoint: true,
      conduct: 'unlawful',
      onComplete: [emit('vehicle.respray'), say('radio', 'line.m.a1.09.sprayed')],
    }),
    stage('hide', [escape({ id: 'escape_viaduct' })], { checkpoint: true, conduct: 'unlawful', onEnter: [say('radio', 'line.m.a1.09.hide')] }),
    stage('home', [goto('yard', { id: 'goto_yard', inVehicle: 'tow' })], { onEnter: [say('radio', 'line.m.a1.09.home')] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.09.fail.ko'),
    failWhen(busted(), 'mission.m.a1.09.fail.busted'),
    failWhen(destroyed('tow'), 'mission.m.a1.09.fail.tow', 'start'),
  ],
  heatPolicy: { maxHeat: 3, clearOnPass: true },
  rewards: { cashCents: 250_000 },
  medals: { silverSec: 900, goldSec: 600 },
  autoplay: { expectedSec: [60, 1500], seeds: [1, 2, 3] },
});

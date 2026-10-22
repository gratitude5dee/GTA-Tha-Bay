/**
 * m.a1.06 Signal Boost (Act 1, D2; 03-story-narrative.md B4). Saint Static needs the Chorus van to reach the hill above the Mission
 * before the signal goes live. Meet at a Mission warehouse, follow the van and keep it safe (band 10 to 60 m, lose it after 20 s, the van
 * must keep 40 percent of its health), ride out a patrol sweep at heat 2, then the antenna goes up. The warehouse is reached on foot
 * from the phone call; the van is driven by its own task.
 */
import {
  at, beat, circle, defineMission, destroyed, driveTo, enterVehicle, escape, failWhen, follow, goto, heat, ko, npc, passed, phoneTrigger, protect, say, spawn, stage, task, vehicle, busted, waitFor,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.06',
  version: 1,
  act: 1,
  district: 'd2',
  title: 'mission.m.a1.06.title',
  giver: { phone: 'saint_static' },
  requires: [passed('m.a1.05')],
  start: phoneTrigger('saint_static'),
  cast: {
    van: vehicle({ prefab: 'vehicle.van', spawn: at(37.75066, -122.41452, { snap: 'road', yawDeg: 0 }), spawnAt: 'manual' }),
    crew: npc({ soul: 'chorus_sparrer', role: 'ally', spawn: at(37.75062, -122.41442) }),
    ride: vehicle({ prefab: 'vehicle.compact', spawn: at(37.75058, -122.41440, { snap: 'road', yawDeg: 0 }), playerUsable: true }),
  },
  zones: {
    warehouse: circle(37.7506, -122.4145, 16),
    hill: circle(37.7435, -122.4150, 30),
  },
  stages: [
    stage('warehouse', [goto('warehouse', { id: 'goto_warehouse', onFoot: true })], { onEnter: [say('radio', 'line.m.a1.06.start')] }),
    stage('wheels', [enterVehicle('ride', { id: 'enter_ride' })], { onEnter: [spawn('van')] }),
    stage(
      'convoy',
      [follow('van', [10, 60], 20, { id: 'follow_van', untilZone: 'hill' }), protect('van', 0.4, { id: 'protect_van', untilZone: 'hill' })],
      { onEnter: [task('van', driveTo('hill', 'normal')), say('radio', 'line.m.a1.06.convoy')], checkpoint: true },
    ),
    stage('sweep', [escape({ id: 'escape_sweep' })], { checkpoint: true, onEnter: [heat({ set: 2 }), say('radio', 'line.m.a1.06.sweep')] }),
    stage('antenna', [waitFor(2, { id: 'wait_antenna' })], { onEnter: [beat({ cutscene: 'cut.story.m.a1.06.antenna' })] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.06.fail.ko'),
    failWhen(busted(), 'mission.m.a1.06.fail.busted'),
    failWhen(destroyed('van'), 'mission.m.a1.06.fail.van'),
    failWhen(destroyed('ride'), 'mission.m.a1.06.fail.ride', 'start'),
  ],
  heatPolicy: { maxHeat: 2, clearOnPass: true },
  rewards: { cashCents: 250_000 },
  medals: { silverSec: 900, goldSec: 540 },
  autoplay: { expectedSec: [60, 900], seeds: [1, 2, 3] },
});

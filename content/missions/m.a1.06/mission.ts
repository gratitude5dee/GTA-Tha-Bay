/**
 * m.a1.06 Signal Boost (Act 1, D2; 03-story-narrative.md B4). Saint Static needs the Chorus van to reach the hill above the Mission
 * before the signal goes live. Meet at a Mission warehouse, follow the van and keep it safe (band 10 to 60 m, lose it after 20 s, the van
 * must keep 40 percent of its health), ride out a patrol sweep at heat 2, then the antenna goes up. The warehouse is reached on foot
 * from the phone call. The player drives the Chorus van to the hill with its health watched: a cast car that drives itself along real
 * streets is not reliable yet (BD-M05c1-04), and a convoy that stalls would fail a human player too.
 */
import {
  at, beat, busted, circle, defineMission, destroyed, enterVehicle, escape, failWhen, goto, heat, ko, npc, passed, phoneTrigger, protect, say, stage, vehicle, waitFor,
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
    van: vehicle({ prefab: 'vehicle.van', spawn: at(37.75066, -122.41447, { snap: 'road', yawDeg: 180 }), playerUsable: true }),
    crew: npc({ soul: 'chorus_sparrer', role: 'ally', spawn: at(37.75062, -122.41442) }),
  },
  zones: {
    warehouse: circle(37.7506, -122.4145, 16),
    hill: circle(37.74314, -122.41477, 25),
  },
  stages: [
    stage('warehouse', [goto('warehouse', { id: 'goto_warehouse', onFoot: true })], { onEnter: [say('radio', 'line.m.a1.06.start')] }),
    stage('wheels', [enterVehicle('van', { id: 'enter_van' })]),
    stage('convoy', [goto('hill', { id: 'goto_hill', inVehicle: 'van' }), protect('van', 0.4, { id: 'protect_van', untilZone: 'hill' })], {
      onEnter: [say('radio', 'line.m.a1.06.convoy')],
      checkpoint: true,
    }),
    stage('sweep', [escape({ id: 'escape_sweep' })], { checkpoint: true, onEnter: [heat({ set: 2 }), say('radio', 'line.m.a1.06.sweep')] }),
    stage('antenna', [waitFor(2, { id: 'wait_antenna' })], { onEnter: [beat({ cutscene: 'cut.story.m.a1.06.antenna' })] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.06.fail.ko'),
    failWhen(busted(), 'mission.m.a1.06.fail.busted'),
    failWhen(destroyed('van'), 'mission.m.a1.06.fail.van'),
  ],
  heatPolicy: { maxHeat: 2, clearOnPass: true },
  rewards: { cashCents: 250_000 },
  medals: { silverSec: 900, goldSec: 540 },
  autoplay: { expectedSec: [60, 900], seeds: [1, 2, 3] },
});

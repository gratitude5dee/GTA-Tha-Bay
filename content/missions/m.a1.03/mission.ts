/**
 * m.a1.03 Sideshow Sunday (Act 1, D3 Bayview; 03-story-narrative.md B4). A marker at the Yard, Sunday evening (18:00 to 23:00): follow
 * Tavi to an industrial lot, score a drift show, ride out the patrol raid. The raid ends in the racing hook `race-a1-sideshow-escape`
 * (`sf.pursuit.bayview-escape`); until racing ships the stub runs: lose the patrol at heat 2, then be back at the Yard in 240 s. The first
 * encounter emits `unlock.racing`. Sideshows are allowed (Q-06) with a police response; only the player and the fictional cast take part.
 */
import {
  at, beat, busted, circle, defineMission, destroyed, enterVehicle, escape, failWhen, goto, heat, ko, markerTrigger, modeHook, modeObjective, npc, passed, say, score, stage, survive,
  vehicle,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.03',
  version: 1,
  act: 1,
  district: 'd3',
  tags: ['sideshow', 'sensitivity-read'],
  title: 'mission.m.a1.03.title',
  requires: [passed('m.a1.01')],
  start: markerTrigger(at(37.73639, -122.38860), 8, { hours: [18, 23] }),
  cast: {
    tavi: npc({ soul: 'tavi_okafor', role: 'ally', spawn: at(37.73641, -122.38868, { snap: 'road' }) }),
    ride: vehicle({ prefab: 'vehicle.compact', spawn: at(37.73633, -122.38850, { snap: 'road', yawDeg: -126 }), playerUsable: true }),
  },
  zones: {
    yard_gate: circle(37.73639, -122.38860, 9),
    lot: circle(37.73684, -122.38860, 25),
    yard: circle(37.73648, -122.38865, 18),
    hideout: circle(37.74046, -122.38864, 30),
  },
  stages: [
    stage('gate', [goto('yard_gate', { id: 'goto_gate', onFoot: true })], { onEnter: [say('tavi', 'line.m.a1.03.gate')] }),
    stage('wheels', [enterVehicle('ride', { id: 'enter_ride' })]),
    stage('to_lot', [goto('lot', { id: 'goto_lot', inVehicle: 'ride' })], { onEnter: [say('tavi', 'line.m.a1.03.follow')] }),
    stage('show', [survive(30, { id: 'hold_crowd' }), score('drift', 3000, 90, { id: 'drift_show', optional: true })], { onEnter: [say('tavi', 'line.m.a1.03.show')] }),
    stage('raid', [modeObjective('race-a1-sideshow-escape', { id: 'mode_sideshow' })], {
      onEnter: [beat({ cutscene: 'cut.story.m.a1.03.raid' }), heat({ set: 2 }), say('radio', 'line.m.a1.03.raid')],
    }),
    stage('home', [goto('yard', { id: 'goto_yard', inVehicle: 'ride' })], { timeLimitSec: 240, checkpoint: true, onEnter: [say('tavi', 'line.m.a1.03.home')] }),
  ],
  modeHooks: [
    modeHook({
      id: 'race-a1-sideshow-escape',
      mode: 'racing',
      defId: 'sf.pursuit.bayview-escape',
      passOn: ['win', 'finish'],
      stub: escape({ id: 'escape_raid' }),
      unlockOnFirstEncounter: 'unlock.racing',
      retry: 'hook',
    }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.03.fail.ko'),
    failWhen(busted(), 'mission.m.a1.03.fail.busted'),
    failWhen(destroyed('ride'), 'mission.m.a1.03.fail.ride', 'start'),
  ],
  heatPolicy: { maxHeat: 3, clearOnPass: true },
  rewards: { cashCents: 150_000, streetCred: 40 },
  medals: { silverSec: 600, goldSec: 420 },
  autoplay: { expectedSec: [60, 780], seeds: [1, 2, 3] },
});

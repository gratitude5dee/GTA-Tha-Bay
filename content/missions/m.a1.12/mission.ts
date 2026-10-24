/**
 * m.a1.12 Lot Number One (Act 1, D1 Mission Bay to the Yard in D3; 03-story-narrative.md B4). Saint Static calls the player to the plaza
 * by the arena, where a giant screen names the Yard's street "LOT 1" (the "LOT 1" text is an in-engine overlay in both the clip and the
 * fallback). Halcyon's security rolls out: the player survives 120 s at scripted heat 4 (helicopter, spike strips), loses the patrol
 * (the helicopter loses the car in the fog, so the search is a heat 2 one), brings the truck home to the Yard, and meets the
 * investor whose black car pulls up at the gate. Passing ends Act 1: it sets `StorySlice.act` to 2 and the flag `act1_complete`.
 * Starts by phone from Saint Static once m.a1.10 and m.a1.11 are passed.
 */
import {
  text, at, beat, busted, circle, defineMission, destroyed, enterVehicle, escape, failWhen, goto, heat, ko, npc, passed, phoneTrigger, say, setFlag, spawn, stage, survive, talk, talkDef, vehicle, waitFor,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.12',
  version: 1,
  act: 1,
  district: 'd1',
  title: 'mission.m.a1.12.title',
  giver: { phone: 'saint_static' },
  requires: [passed('m.a1.10'), passed('m.a1.11')],
  start: phoneTrigger('saint_static'),
  lines: ['line.m.a1.12.talk.whitney.open'],
  cast: {
    ride: vehicle({ prefab: 'vehicle.compact', spawn: at(37.76888, -122.38841, { snap: 'road', yawDeg: 94 }), playerUsable: true }),
    whitney: npc({ soul: 'whitney_arlo', role: 'antagonist', spawn: at(37.73642, -122.38843, { snap: 'road', yawDeg: 55 }), spawnAt: 'manual' }),
  },
  zones: {
    plaza: circle(37.76891, -122.38799, 24),
    yard: circle(37.73648, -122.38865, 26),
  },
  stages: [
    stage('to_plaza', [goto('plaza', { id: 'goto_plaza', onFoot: true })], { onEnter: [text('saint_static', 'line.m.a1.12.msg'), say('radio', 'line.m.a1.12.start')] }),
    stage('lot', [enterVehicle('ride', { id: 'enter_ride' })], { onEnter: [beat({ cutscene: 'cut.story.m.a1.12.lot-one' }), say('radio', 'line.m.a1.12.lot')] }),
    stage('run', [survive(120, { id: 'survive_run' })], {
      checkpoint: true,
      conduct: 'unlawful',
      onEnter: [heat({ set: 4 }), say('radio', 'line.m.a1.12.run')],
    }),
    stage('lose', [escape({ id: 'escape_fog' })], { checkpoint: true, conduct: 'unlawful', onEnter: [heat({ cap: 2 }), say('radio', 'line.m.a1.12.fog')] }),
    stage('home', [goto('yard', { id: 'goto_yard', inVehicle: 'ride' })], { onEnter: [say('radio', 'line.m.a1.12.home')] }),
    stage('arrival', [waitFor(3, { id: 'wait_car' })], { onEnter: [spawn('whitney'), beat({ cutscene: 'cut.story.m.a1.12.arrival' })] }),
    stage(
      'listen',
      [
        talk(
          talkDef({
            id: 'whitney',
            npc: 'whitney',
            intent: 'mission.m.a1.12.talk.whitney.intent',
            outcomes: { listen: { label: 'mission.m.a1.12.talk.whitney.listen', flags: { act1_complete: true }, trust: 2 } },
            default: 'listen',
            maxTurns: 3,
          }),
          { id: 'talk_whitney' },
        ),
      ],
      { onComplete: [setFlag({ 'story.act': 2 })] },
    ),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.12.fail.ko'),
    failWhen(busted(), 'mission.m.a1.12.fail.busted'),
    failWhen(destroyed('ride'), 'mission.m.a1.12.fail.ride', 'start'),
  ],
  heatPolicy: { maxHeat: 4, clearOnPass: true, startHeat: 0 },
  rewards: { cashCents: 500_000 },
  medals: { silverSec: 1500, goldSec: 1000 },
  autoplay: { expectedSec: [120, 2400], seeds: [1, 2, 3] },
});

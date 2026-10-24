/**
 * m.a1.07 Hacker House (Act 1, D4 Hayes Valley; 03-story-narrative.md B4). Odessa sends the player to the Cerebral's Victorian by Alamo
 * Square: Patch can read the pod, if the player trusts them with it (`trust`: hand it over) or not (`doubt`: keep it and flag the
 * house). Patch comes along on foot, the two cross the park past Halcyon's survey drones (a stealth budget of 3), and Patch is
 * seen safely to Civic Center. The drones are a detection budget the stealth objective counts; they have no body until the NPC
 * perception lands. Sensitivity read: the Tenderloin and Hayes Valley are shown through the people who live there (B3 rule 4).
 * Coordinates are WGS84 and sit on the sf bake's roads or in its park (checked with the authoring probe).
 */
import {
  at, circle, collect, defineMission, deliver, destroyed, failWhen, goto, health, ko, npc, passed, phoneTrigger, say, setFlag, stage, stealth, talk, talkDef,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.07',
  version: 1,
  act: 1,
  district: 'd4',
  tags: ['sensitivity-read'],
  title: 'mission.m.a1.07.title',
  giver: { phone: 'odessa_calloway' },
  requires: [passed('m.a1.04')],
  start: phoneTrigger('odessa_calloway'),
  lines: ['line.m.a1.07.talk.patch.open'],
  cast: {
    patch: npc({ soul: 'patch', role: 'ally', spawn: at(37.77643, -122.43648) }),
  },
  zones: {
    house: circle(37.77643, -122.43639, 14),
    park: circle(37.77640, -122.43302, 14),
    civic: circle(37.77925, -122.41840, 22),
  },
  stages: [
    stage('to_house', [goto('house', { id: 'goto_house', onFoot: true })], { onEnter: [say('radio', 'line.m.a1.07.start')] }),
    stage(
      'meet_patch',
      [
        talk(
          talkDef({
            id: 'patch',
            npc: 'patch',
            intent: 'mission.m.a1.07.talk.patch.intent',
            outcomes: {
              trust: { label: 'mission.m.a1.07.talk.patch.trust', stage: 'bring_patch', flags: { 'a1.07.pod': 'handed' }, trust: 6 },
              doubt: { label: 'mission.m.a1.07.talk.patch.doubt', stage: 'bring_patch', flags: { 'a1.07.pod': 'kept' }, trust: -2 },
            },
            default: 'trust',
            maxTurns: 3,
          }),
          { id: 'talk_patch' },
        ),
      ],
      { next: 'bring_patch' },
    ),
    stage('bring_patch', [collect('patch', { id: 'collect_patch' })], { onComplete: [say('patch', 'line.m.a1.07.patch.come')] }),
    stage('sneak', [stealth('park', 3, [[37.77632, -122.43590], [37.77625, -122.43500], [37.77625, -122.43420], [37.77636, -122.43350], [37.77640, -122.43310]], { id: 'stealth_park' })], {
      conduct: 'unlawful',
      checkpoint: true,
      onEnter: [say('radio', 'line.m.a1.07.drones')],
    }),
    stage('civic', [deliver('patch', 'civic', { id: 'deliver_patch' })], { conduct: 'unlawful', onEnter: [say('radio', 'line.m.a1.07.civic')], onComplete: [setFlag({ 'a1.07.done': true }), say('patch', 'line.m.a1.07.patch.thanks')] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.07.fail.ko'),
    failWhen(health('patch', 0.25), 'mission.m.a1.07.fail.patch'),
    failWhen(destroyed('patch'), 'mission.m.a1.07.fail.patch'),
  ],
  heatPolicy: { maxHeat: 1, clearOnPass: true },
  rewards: { cashCents: 200_000, techClout: 40 },
  unlocks: ['unlock.district.d4'],
  medals: { silverSec: 900, goldSec: 540 },
  autoplay: { expectedSec: [60, 1200], seeds: [1, 2, 3] },
});

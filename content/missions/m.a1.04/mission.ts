/**
 * m.a1.04 Curb Appeal (Act 1, D1; 03-story-narrative.md B4). Odessa phones: the Halcyon launch party is where the curb map goes up on a
 * screen, and the Yard needs a photo of it. Walk to the line, talk the cameo influencer (a selfie or a pass: flavor only), talk the door
 * host (`charm` is gated on the host's mood, `bribe` costs $300, `refuse` sends the player to the service door), sneak to the exec floor
 * (detect budget 3 through the front, 2 through the service door), photo the curb-map screen and watch the keynote beat. The cast is
 * fictional; the influencer is a roster slot (its stand-in plays it) and is never a target of anything.
 */
import {
  at, beat, circle, defineMission, destroyed, failWhen, goto, health, ko, npc, passed, phoneTrigger, photo, prop, say, spawn, stage, stealth, talk, talkDef,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.04',
  version: 1,
  act: 1,
  district: 'd1',
  title: 'mission.m.a1.04.title',
  giver: { phone: 'odessa_calloway' },
  requires: [passed('m.a1.02')],
  start: phoneTrigger('odessa_calloway'),
  lines: ['line.m.a1.04.talk.influencer.open', 'line.m.a1.04.talk.door.open'],
  cast: {
    influencer: npc({ slot: 'INFLUENCER', role: 'cameo', spawn: at(37.77694, -122.40451) }),
    door_host: npc({ soul: 'door_host', role: 'civilian', spawn: at(37.77712, -122.40463) }),
    dana: npc({ soul: 'dana_voss', role: 'antagonist', spawn: at(37.77731, -122.40482), spawnAt: 'manual' }),
    screen: prop({ prefab: 'prop.barrier', spawn: at(37.77734, -122.40486) }),
  },
  zones: {
    queue: circle(37.77690, -122.40455, 9),
    front: circle(37.77735, -122.40465, 14),
    service: circle(37.77728, -122.40493, 12),
    exit: circle(37.77698, -122.40460, 10),
  },
  stages: [
    stage('line', [goto('queue', { id: 'goto_queue', onFoot: true })], { onEnter: [say('radio', 'line.m.a1.04.start')] }),
    stage(
      'selfie',
      [
        talk(
          talkDef({
            id: 'influencer',
            npc: 'influencer',
            intent: 'mission.m.a1.04.talk.influencer.intent',
            outcomes: {
              selfie: { label: 'mission.m.a1.04.talk.influencer.selfie', stage: 'door', flags: { 'a1.04.selfie': true }, trust: 3 },
              pass: { label: 'mission.m.a1.04.talk.influencer.pass', stage: 'door', flags: { 'a1.04.selfie': false } },
            },
            default: 'pass',
            maxTurns: 2,
          }),
          { id: 'talk_influencer' },
        ),
      ],
      { next: 'door' },
    ),
    stage(
      'door',
      [
        talk(
          talkDef({
            id: 'door',
            npc: 'door_host',
            intent: 'mission.m.a1.04.talk.door.intent',
            outcomes: {
              charm: { label: 'mission.m.a1.04.talk.door.charm', stage: 'sneak_front', flags: { 'a1.04.way': 'charm' }, trust: 5, when: { mood: ['amused', 'friendly'], minTrust: 5 } },
              bribe: { label: 'mission.m.a1.04.talk.door.bribe', stage: 'sneak_front', flags: { 'a1.04.way': 'bribe', 'talk.cost': 30_000 }, when: { actions: ['offer_deal'] } },
              refuse: { label: 'mission.m.a1.04.talk.door.refuse', stage: 'sneak_service', flags: { 'a1.04.way': 'service' } },
            },
            default: 'refuse',
            maxTurns: 3,
          }),
          { id: 'talk_door' },
        ),
      ],
      { next: 'sneak_front' },
    ),
    stage(
      'sneak_front',
      [stealth('front', 3, [[37.77712, -122.40463], [37.77722, -122.40466], [37.77732, -122.40468]], { id: 'stealth_front' })],
      { conduct: 'unlawful', onEnter: [spawn('dana')], next: 'snap' },
    ),
    stage(
      'sneak_service',
      [stealth('service', 2, [[37.77721, -122.40460], [37.77728, -122.40471], [37.77728, -122.40488], [37.77728, -122.40497]], { id: 'stealth_service' })],
      { conduct: 'unlawful', onEnter: [spawn('dana')], next: 'snap' },
    ),
    stage('snap', [photo('screen', { id: 'photo_screen', maxDistM: 14 })], { conduct: 'unlawful', onComplete: [say('radio', 'line.m.a1.04.photo')] }),
    stage('keynote', [goto('front', { id: 'goto_front', onFoot: true })], { conduct: 'unlawful', onEnter: [beat({ cutscene: 'cut.story.m.a1.04.keynote' })] }),
    stage('out', [goto('exit', { id: 'goto_exit', onFoot: true })], { conduct: 'unlawful', onEnter: [say('radio', 'line.m.a1.04.out')] }),
  ],
  fail: [
    failWhen(ko('player'), 'mission.m.a1.04.fail.ko'),
    failWhen(health('door_host', 0.3), 'mission.m.a1.04.fail.host'),
    failWhen(destroyed('screen'), 'mission.m.a1.04.fail.screen'),
  ],
  heatPolicy: { maxHeat: 0, clearOnPass: true },
  rewards: { cashCents: 200_000, techClout: 30 },
  medals: { silverSec: 900, goldSec: 540 },
  autoplay: { expectedSec: [60, 1200], seeds: [1, 2, 3] },
});

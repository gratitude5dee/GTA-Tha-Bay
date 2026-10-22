/**
 * m.a1.05 Turntable Battle (Act 1, D4 at Powell and Market; 03-story-narrative.md B4). Saint Static texts the player about the Chorus street
 * exhibition at the cable-car turntable. Walk to the plaza, watch the ring form, talk the host (a roster slot; it only announces and signs the
 * player up), then the fighter hook `fight-a1-turntable` (`bout.a5`: the new-wave opponent, a sanctioned exhibition bout, CPU Normal). Both a
 * win and a loss pass. Until the fighter mode ships the stub runs: knock down `chorus_sparrer`, non-lethal. The first encounter emits
 * `unlock.fighter`; the pass grants `unlock.fighter.rap_new_wave` (a stand-in while the roster is absent). Win bonus: another $1,000.
 */
import {
  at, beat, circle, defeat, defineMission, failWhen, goto, ifOp, give, ko, modeHook, modeObjective, modeResult, npc, passed, phoneTrigger, say, stage, talk, talkDef,
} from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.a1.05',
  version: 1,
  act: 1,
  district: 'd4',
  tags: ['sensitivity-read'],
  title: 'mission.m.a1.05.title',
  giver: { phone: 'saint_static' },
  requires: [passed('m.a1.04')],
  start: phoneTrigger('saint_static'),
  lines: ['line.m.a1.05.talk.signup.open'],
  cast: {
    host: npc({ slot: 'RAP_HYPHY_ELDER', role: 'host', spawn: at(37.78466, -122.40764) }),
    rival: npc({ slot: 'RAP_NEW_WAVE', role: 'opponent', spawn: at(37.78474, -122.40780) }),
    sparrer: npc({ soul: 'chorus_sparrer', role: 'civilian', spawn: at(37.78476, -122.40775) }),
  },
  zones: {
    plaza: circle(37.7847, -122.4077, 22),
    ring: circle(37.78472, -122.40772, 8),
  },
  stages: [
    stage('plaza', [goto('plaza', { id: 'goto_plaza', onFoot: true })], { onEnter: [say('radio', 'line.m.a1.05.start')] }),
    stage('ring', [goto('ring', { id: 'goto_ring', onFoot: true })], { onEnter: [beat({ cutscene: 'cut.story.m.a1.05.ring' })] }),
    stage(
      'signup',
      [
        talk(
          talkDef({
            id: 'signup',
            npc: 'host',
            intent: 'mission.m.a1.05.talk.signup.intent',
            outcomes: {
              sign_up: { label: 'mission.m.a1.05.talk.signup.sign_up', stage: 'bout', flags: { 'a1.05.signed': true }, trust: 3 },
            },
            default: 'sign_up',
            maxTurns: 2,
          }),
          { id: 'talk_signup' },
        ),
      ],
      { next: 'bout' },
    ),
    stage('bout', [modeObjective('fight-a1-turntable', { id: 'mode_turntable' })], {
      onEnter: [say('host', 'line.m.a1.05.bout')],
      onComplete: [ifOp(modeResult('fight-a1-turntable', ['win']), [give('a1.05.win', { cashCents: 100_000 }), say('host', 'line.m.a1.05.win')], [say('host', 'line.m.a1.05.lose')])],
    }),
  ],
  modeHooks: [
    modeHook({
      id: 'fight-a1-turntable',
      mode: 'fighter',
      defId: 'bout.a5',
      params: { kind: 'story' },
      passOn: ['win', 'lose'],
      stub: defeat(['sparrer'], { id: 'defeat_sparrer' }),
      unlockOnFirstEncounter: 'unlock.fighter',
      retry: 'hook',
    }),
  ],
  fail: [failWhen(ko('player'), 'mission.m.a1.05.fail.ko')],
  heatPolicy: { maxHeat: 0, clearOnPass: true },
  rewards: { cashCents: 100_000, streetCred: 30 },
  unlocks: ['unlock.fighter.rap_new_wave'],
  medals: { silverSec: 420, goldSec: 300 },
  autoplay: { expectedSec: [30, 600], seeds: [1, 2, 3] },
});

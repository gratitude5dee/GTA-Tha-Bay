/**
 * m.dev.talk: the development mission of the talk panel (M05c1, QA builds only). One talk with three outcomes, in the gray-box Civic Center
 * block: `charm` is gated on the NPC's mood (off with its hint), `deal` is open, `pay` costs $300 (off while the wallet is empty). Every
 * outcome jumps to its own stage. `/?mission=m.dev.talk&stage=1&seed=1` starts at the talk, which `tests/e2e/story-talk.spec.ts` drives.
 * Positions are WGS84 tuples within 150 m of City Hall, on the gray-box terrain.
 */
import { at, circle, defineMission, goto, markerTrigger, npc, stage, talk, talkDef, waitFor } from '../../../packages/modes/story/src/authoring/index.ts';

export default defineMission({
  id: 'm.dev.talk',
  version: 1,
  act: 0,
  district: 'd1',
  tags: ['dev'],
  title: 'mission.m.dev.talk.title',
  start: markerTrigger(at(37.77894, -122.418619), 6),
  lines: ['line.m.dev.talk.talk.ask.open'],
  cast: {
    buddy: npc({ soul: 'npc_test', role: 'ally', spawn: at(37.77885, -122.418051) }),
  },
  zones: {
    plaza: circle(37.778759, -122.417938, 10),
  },
  stages: [
    stage('arrive', [goto('plaza', { id: 'arrive_plaza', onFoot: true })]),
    stage(
      'ask',
      [
        talk(
          talkDef({
            id: 'ask',
            npc: 'buddy',
            intent: 'mission.m.dev.talk.ask.intent',
            outcomes: {
              charm: { label: 'mission.m.dev.talk.ask.charm', stage: 'charmed', flags: { 'dev.talk': 'charm' }, when: { mood: ['friendly'], minTrust: 20 } },
              deal: { label: 'mission.m.dev.talk.ask.deal', stage: 'dealt', flags: { 'dev.talk': 'deal' } },
              pay: { label: 'mission.m.dev.talk.ask.pay', stage: 'paid', flags: { 'dev.talk': 'pay', 'talk.cost': 30_000 } },
            },
            default: 'deal',
            maxTurns: 2,
          }),
          { id: 'talk_ask' },
        ),
      ],
      { next: 'dealt' },
    ),
    stage('charmed', [waitFor(1, { id: 'wait_charmed' })], { next: 'done' }),
    stage('dealt', [waitFor(1, { id: 'wait_dealt' })], { next: 'done' }),
    stage('paid', [waitFor(1, { id: 'wait_paid' })], { next: 'done' }),
    stage('done', [goto('plaza', { id: 'return_plaza', onFoot: true })]),
  ],
  heatPolicy: { maxHeat: 0, clearOnPass: true },
  rewards: { cashCents: 1_000 },
  autoplay: { expectedSec: [10, 300], seeds: [1, 2, 3] },
});

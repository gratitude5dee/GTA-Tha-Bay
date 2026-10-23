/**
 * m.dev.talk: the development mission of the talk panel (M05c1, QA builds only). One talk with three outcomes, in the gray-box Civic Center
 * block: `charm` is gated on the NPC's mood (off with its hint), `deal` is open, `pay` costs $300 (off while the wallet is empty). Every
 * outcome jumps to its own stage. `/?mission=m.dev.talk&stage=1&seed=1` starts at the talk, which `tests/e2e/story-talk.spec.ts` drives.
 * Positions are WGS84 tuples within 150 m of City Hall, on the gray-box terrain.
 *
 * Every outcome stage holds for OUTCOME_HOLD_SEC before the return leg, so the bot's run sits inside `autoplay.expectedSec` (R-MODE-01; the
 * band's floor is the C9 §C4 minimum of 10 s). With a 1 s hold the bot finished in 6.3 s on every seed and `check:missions` failed
 * `out_of_band` (BD-FIX-CI3-B01); with 12 s it finishes in about 17 s, and 0.6 x that is still above the 10 s floor.
 */
import { at, circle, defineMission, goto, markerTrigger, npc, stage, talk, talkDef, waitFor } from '../../../packages/modes/story/src/authoring/index.ts';

/** Seconds each outcome stage holds before the return leg (BD-FIX-CI3-B01). */
const OUTCOME_HOLD_SEC = 12;

export default defineMission({
  id: 'm.dev.talk',
  version: 2,
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
    stage('charmed', [waitFor(OUTCOME_HOLD_SEC, { id: 'wait_charmed' })], { next: 'done' }),
    stage('dealt', [waitFor(OUTCOME_HOLD_SEC, { id: 'wait_dealt' })], { next: 'done' }),
    stage('paid', [waitFor(OUTCOME_HOLD_SEC, { id: 'wait_paid' })], { next: 'done' }),
    stage('done', [goto('plaza', { id: 'return_plaza', onFoot: true })]),
  ],
  heatPolicy: { maxHeat: 0, clearOnPass: true },
  rewards: { cashCents: 1_000 },
  autoplay: { expectedSec: [10, 300], seeds: [1, 2, 3] },
});

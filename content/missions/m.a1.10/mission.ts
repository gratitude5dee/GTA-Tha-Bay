/**
 * m.a1.10 Public Comment (Act 1, D4 Civic Center and the Tenderloin; 03-story-narrative.md B4). Imani Hart, a supervisor at the Curb
 * Allocation Board, texts that the public comment on the curb auction closes at half past five, and the Yard needs voices in the room.
 * The player asks three residents (a shopkeeper, a retired bus driver, a teenager with flyers) to speak, each of whom agrees or declines,
 * then reaches the City Hall steps before the doors close. The clock starts at 15:00 and the doors close at 17:30: the stage limit is
 * 240 s of play (about a game minute per two seconds) times the player's timer scale. The number of residents who agreed is the flag
 * `hearing_support` (0 to 3), which Act 3 reads. Sensitivity read: the Tenderloin is shown through the people who work and live there (B3 rule 4).
 */
import {
  text, and, at, beat, circle, clock, defineMission, failWhen, flagIs, goto, ifOp, ko, npc, passed, phoneTrigger, say, setFlag, spawn, stage, talk, talkDef,
} from '../../../packages/modes/story/src/authoring/index.ts';
import type { Op } from '@dv/shared';

const RESIDENTS = ['moss', 'tran', 'kai'] as const;

/** Sets `hearing_support` to the number of residents who agreed: one branch per combination of three yes/no flags. */
function tally(): Op[] {
  const ops: Op[] = [];
  for (let mask = 0; mask < 8; mask++) {
    const want = RESIDENTS.map((_, i) => (mask & (1 << i)) !== 0);
    const count = want.filter(Boolean).length;
    ops.push(ifOp(and(...RESIDENTS.map((r, i) => flagIs(`a1.10.${r}`, { eq: want[i] as boolean }))), [setFlag({ hearing_support: count })]));
  }
  return ops;
}

const residentTalk = (who: (typeof RESIDENTS)[number], next: string) =>
  talk(
    talkDef({
      id: who,
      npc: who,
      intent: `mission.m.a1.10.talk.${who}.intent`,
      outcomes: {
        agree: { label: `mission.m.a1.10.talk.${who}.agree`, stage: next, flags: { [`a1.10.${who}`]: true }, trust: 4 },
        decline: { label: `mission.m.a1.10.talk.${who}.decline`, stage: next, flags: { [`a1.10.${who}`]: false } },
      },
      default: who === 'kai' ? 'decline' : 'agree',
      maxTurns: 3,
    }),
    { id: `talk_${who}` },
  );

export default defineMission({
  id: 'm.a1.10',
  version: 1,
  act: 1,
  district: 'd4',
  tags: ['sensitivity-read'],
  title: 'mission.m.a1.10.title',
  giver: { phone: 'imani_hart' },
  requires: [passed('m.a1.06'), passed('m.a1.09')],
  start: phoneTrigger('imani_hart'),
  lines: ['line.m.a1.10.talk.moss.open', 'line.m.a1.10.talk.tran.open', 'line.m.a1.10.talk.kai.open'],
  cast: {
    moss: npc({ soul: 'res_moss', role: 'civilian', spawn: at(37.78103, -122.41625) }),
    tran: npc({ soul: 'res_tran', role: 'civilian', spawn: at(37.78281, -122.41400) }),
    kai: npc({ soul: 'res_kai', role: 'civilian', spawn: at(37.78453, -122.41551) }),
    imani: npc({ soul: 'imani_hart', role: 'mentor', spawn: at(37.77925, -122.41840), spawnAt: 'manual' }),
  },
  zones: {
    moss_spot: circle(37.78103, -122.41625, 10),
    tran_spot: circle(37.78281, -122.41400, 10),
    kai_spot: circle(37.78453, -122.41551, 10),
    steps: circle(37.77925, -122.41840, 22),
  },
  stages: [
    stage('to_moss', [goto('moss_spot', { id: 'goto_moss', onFoot: true })], { onEnter: [clock({ lock: { hour: 15, weather: 'clear' } }), text('imani_hart', 'line.m.a1.10.msg'), say('radio', 'line.m.a1.10.start')] }),
    stage('moss', [residentTalk('moss', 'to_tran')], { next: 'to_tran' }),
    stage('to_tran', [goto('tran_spot', { id: 'goto_tran', onFoot: true })]),
    stage('tran', [residentTalk('tran', 'to_kai')], { next: 'to_kai' }),
    stage('to_kai', [goto('kai_spot', { id: 'goto_kai', onFoot: true })]),
    stage('kai', [residentTalk('kai', 'steps')], { next: 'steps' }),
    stage('steps', [goto('steps', { id: 'goto_steps', onFoot: true })], {
      timeLimitSec: 240,
      checkpoint: true,
      onEnter: [...tally(), spawn('imani'), say('radio', 'line.m.a1.10.clock')],
      onComplete: [beat({ cutscene: 'cut.story.m.a1.10.steps' })],
    }),
  ],
  fail: [failWhen(ko('player'), 'mission.m.a1.10.fail.ko')],
  heatPolicy: { maxHeat: 0, clearOnPass: true },
  rewards: { cashCents: 150_000, streetCred: 50 },
  medals: { silverSec: 600, goldSec: 420 },
  autoplay: { expectedSec: [60, 1200], seeds: [1, 2, 3] },
});

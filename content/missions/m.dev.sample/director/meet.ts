/**
 * The meeting beat of m.dev.sample, played when the "meet" stage starts: the player and the friend stand on their start marks,
 * walk to their end marks side by side while the camera cuts establish, two-shot, single, and two lines show as subtitles.
 * Two actors, three shots, two cues, one action each: the sample of the DirectorScript runner (M05a2).
 */
import { defineDirector, dirAction, dirActor, dirCue, dirShot, markLocal } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.dev.sample.meet',
  durationSec: 6,
  seed: 7,
  marks: {
    me_start: markLocal(114, 0, 66, 0),
    pal_start: markLocal(126, 0, 66, 90),
    me_end: markLocal(118, 0, 60, 0),
    pal_end: markLocal(122, 0, 60, 0),
    wide_cam: markLocal(138, 0, 80, 0),
  },
  actors: [dirActor('player', 'me_start', 'me_end'), dirActor('buddy', 'pal_start', 'pal_end')],
  shots: [
    dirShot(0, 'establish', 'player', { lens: 'wide', from: 'wide_cam' }),
    dirShot(2, 'two-shot', 'player', { secondary: 'buddy', lens: 'normal' }),
    dirShot(4, 'single', 'buddy', { lens: 'tele' }),
  ],
  actions: [dirAction(1, 'player', 'moveTo', 'me_end'), dirAction(1, 'buddy', 'moveTo', 'pal_end')],
  cues: [
    dirCue('line.m.dev.sample.hello', 500, 2500, { speaker: 'buddy' }),
    dirCue('line.m.dev.sample.nudge', 3000, 5500, { speaker: 'buddy' }),
  ],
});

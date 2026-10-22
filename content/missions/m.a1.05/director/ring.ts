/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.05.ring` (an establishing shot, 8 s): a crowd forms a ring around a
 * cable-car turntable at dusk, bells ring. It carries the same cue as the clip. Marks are lat/lng at the plaza.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.05.ring',
  durationSec: 8,
  marks: { plaza: markAt(37.78478, -122.40755, 215) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', move: 'push-in', from: 'plaza' })],
  cues: [dirCue('line.m.a1.05.ring.1', 800, 7000, { speaker: 'standin_rap_elder' })],
});

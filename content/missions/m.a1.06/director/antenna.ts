/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.06.antenna` (an establishing shot, 8 s): a makeshift antenna rises on a
 * hill above the city lights. It carries the same cue as the clip. Marks are lat/lng at the hill.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.06.antenna',
  durationSec: 8,
  marks: { hill: markAt(37.7438, -122.4153, 160) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', move: 'push-in', from: 'hill' })],
  cues: [dirCue('line.m.a1.06.antenna.1', 700, 6800, { speaker: 'saint_static' })],
});

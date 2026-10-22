/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.01.dawn` (an establishing shot, 8 s): fog over the Yard at dawn, one
 * slow push-in. It carries the same cue as the clip. Marks are lat/lng on the Yard's street.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.01.dawn',
  durationSec: 8,
  marks: { yard: markAt(37.736399, -122.388401, 90) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', move: 'push-in', from: 'yard' })],
  cues: [dirCue('line.m.a1.01.dawn.1', 600, 7200, { speaker: 'odessa_calloway' })],
});

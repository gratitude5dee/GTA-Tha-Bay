/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.10.steps` (14 s): neighbors gather on the steps of City Hall at golden
 * hour and the doors open. Two shots, the same cue as the clip (Imani calls the line). Marks are lat/lng at the plaza by the steps.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.10.steps',
  durationSec: 14,
  marks: { plaza_wide: markAt(37.77985, -122.41800, 250), steps_close: markAt(37.77935, -122.41845, 265) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', from: 'plaza_wide', move: 'push-in' }), dirShot(7, 'single', 'player', { lens: 'normal', from: 'steps_close' })],
  cues: [dirCue('line.m.a1.10.steps.1', 1500, 9000, { speaker: 'imani_hart' })],
});

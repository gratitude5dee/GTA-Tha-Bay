/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.08.scanner` (an establishing shot, 8 s): a mapping car with spinning
 * sensors glides through night fog on Third Street. It carries the same cue as the clip. Marks are lat/lng on the street by the Yard.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.08.scanner',
  durationSec: 8,
  marks: { street: markAt(37.73610, -122.38790, 300) },
  shots: [dirShot(0, 'establish', 'scan1', { lens: 'wide', move: 'push-in', from: 'street' })],
  cues: [dirCue('line.m.a1.08.scanner.1', 700, 6800, { speaker: 'patch' })],
});

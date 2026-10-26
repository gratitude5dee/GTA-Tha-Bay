/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.12.lot-one` (14 s): a giant public screen above the Mission Bay plaza
 * lights up with a street map split into numbered lots; dark security vehicles roll out of the garage. Two shots, the same two cues as
 * the clip. The "LOT 1" label on the screen is an in-engine overlay (the clip carries no text). Marks are lat/lng at the plaza.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.12.lot-one',
  durationSec: 14,
  marks: { plaza_wide: markAt(37.76850, -122.38810, 5), garage: markAt(37.76920, -122.38780, 200) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', from: 'plaza_wide', move: 'push-in' }), dirShot(7, 'tracking', 'player', { lens: 'normal', from: 'garage' })],
  cues: [
    dirCue('line.m.a1.12.lot-one.1', 1200, 6500, { speaker: 'corwin_hale' }),
    dirCue('line.m.a1.12.lot-one.2', 8000, 12500, { speaker: 'dana_voss' }),
  ],
});

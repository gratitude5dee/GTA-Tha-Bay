/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.03.raid` (14 s): headlights and tire smoke in an industrial lot, patrol
 * lights flood the fog, the crowd scatters. Two shots, the same two cues as the clip. Marks are lat/lng at the lot.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.03.raid',
  durationSec: 14,
  marks: { lot_wide: markAt(37.73598, -122.38790, 40), lot_close: markAt(37.73588, -122.38768, 220) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', from: 'lot_wide', move: 'push-in' }), dirShot(7, 'single', 'player', { lens: 'normal', from: 'lot_close' })],
  cues: [
    dirCue('line.m.a1.03.raid.1', 1500, 6000, { speaker: 'tavi_okafor' }),
    dirCue('line.m.a1.03.raid.2', 8000, 12500, { speaker: 'tavi_okafor' }),
  ],
});

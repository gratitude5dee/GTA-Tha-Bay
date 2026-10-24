/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.04.keynote` (14 s): a launch stage, a city curb map splits into glowing
 * numbered lots, the executive raises a hand. Two shots, the same two cues as the clip. Marks are lat/lng at the exec floor.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.04.keynote',
  durationSec: 14,
  marks: { stage_wide: markAt(37.77740, -122.40470, 200), stage_close: markAt(37.77735, -122.40468, 20) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', from: 'stage_wide', move: 'push-in' }), dirShot(8, 'single', 'player', { lens: 'normal', from: 'stage_close' })],
  cues: [
    dirCue('line.m.a1.04.keynote.1', 1200, 7000, { speaker: 'corwin_hale' }),
    dirCue('line.m.a1.04.keynote.2', 8000, 12800, { speaker: 'corwin_hale' }),
  ],
});

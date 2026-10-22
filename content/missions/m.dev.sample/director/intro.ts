/**
 * The opening beat of m.dev.sample: one establishing shot over the plaza. Marks are local ENU metres in the gray-box block.
 * It is also the in-engine fallback of the generated cutscene `cut.story.m.dev.sample.intro` (M05b2), so it carries the same cues.
 */
import { defineDirector, dirCue, dirShot, markLocal } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.dev.sample.intro',
  durationSec: 6,
  seed: 1,
  marks: { plaza: markLocal(120, 0, 60) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', move: 'static' })],
  cues: [
    dirCue('line.m.dev.sample.cut.intro.1', 200, 2800, { speaker: 'npc_test' }),
    dirCue('line.m.dev.sample.cut.intro.2', 3000, 5600, { speaker: 'npc_test' }),
  ],
});

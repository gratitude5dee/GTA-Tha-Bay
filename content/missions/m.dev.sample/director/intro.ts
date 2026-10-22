/**
 * The opening beat of m.dev.sample: one establishing shot over the plaza. Marks are local ENU metres in the gray-box block.
 */
import { defineDirector, dirShot, markLocal } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.dev.sample.intro',
  durationSec: 2,
  seed: 1,
  marks: { plaza: markLocal(120, 0, 60) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', move: 'static' })],
});

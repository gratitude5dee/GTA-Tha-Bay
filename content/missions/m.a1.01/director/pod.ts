/**
 * The in-engine outro of m.a1.01, "the pod": Odessa and the player walk up to the towed car in the Yard and read the box under the
 * seat. Two shots, two lines. Marks are local to the drop zone of the Yard.
 */
import { defineDirector, dirAction, dirActor, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.01.pod',
  durationSec: 7,
  marks: {
    me_start: markAt(37.736034, -122.389059, 0),
    me_end: markAt(37.736090, -122.389059, 0),
    odessa_start: markAt(37.736034, -122.388990, 270),
    odessa_end: markAt(37.736080, -122.388990, 270),
    cam: markAt(37.735950, -122.389150, 30),
  },
  actors: [dirActor('player', 'me_start', 'me_end'), dirActor('odessa', 'odessa_start', 'odessa_end')],
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', from: 'cam' }), dirShot(3, 'two-shot', 'player', { secondary: 'odessa', lens: 'normal' })],
  actions: [dirAction(0.5, 'player', 'moveTo', 'me_end'), dirAction(0.5, 'odessa', 'moveTo', 'odessa_end')],
  cues: [
    dirCue('line.m.a1.01.pod.1', 400, 3400, { speaker: 'odessa_calloway' }),
    dirCue('line.m.a1.01.pod.2', 3600, 6600, { speaker: 'odessa_calloway' }),
  ],
});

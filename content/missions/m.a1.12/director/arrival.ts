/**
 * The in-engine fallback of the generated clip `cut.story.m.a1.12.arrival` (14 s): a black car pulls up at the floodlit Yard gate at
 * night and a partner in a long coat steps out under the light. Two shots, the same cue as the clip. Marks are lat/lng at the gate.
 */
import { defineDirector, dirCue, dirShot, markAt } from '../../../../packages/modes/story/src/authoring/index.ts';

export default defineDirector({
  id: 'm.a1.12.arrival',
  durationSec: 14,
  marks: { gate_wide: markAt(37.73610, -122.38820, 320), light_close: markAt(37.73635, -122.38850, 40) },
  shots: [dirShot(0, 'establish', 'player', { lens: 'wide', from: 'gate_wide' }), dirShot(7, 'single', 'player', { lens: 'tele', from: 'light_close', move: 'push-in' })],
  cues: [dirCue('line.m.a1.12.arrival.1', 8000, 12800, { speaker: 'whitney_arlo' })],
});

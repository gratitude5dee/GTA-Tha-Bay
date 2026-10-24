/** Mutant 2 of `missions` (M05a2): the mission clock counts the ticks of a beat, so a cutscene and its fallback no longer leave every timer equal. */
import type { MissionsDeps } from '../harness.ts';

export const description = 'mission clock counting beat ticks';

export function patch(deps: MissionsDeps): MissionsDeps {
  return { ...deps, clockCountsBeats: true };
}

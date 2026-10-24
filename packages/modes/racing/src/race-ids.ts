/** The id of the race the mode runs when none is named. Kept apart from `races.ts` (which imports the compiled JSON) so that plain Node loaders can read it. */
import type { RaceId } from '@dv/shared';

export const DEFAULT_RACE: RaceId = 'sf.sprint.ferry-ocean-beach';

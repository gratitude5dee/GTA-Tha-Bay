import type { CoreSlice } from '@dv/shared';

/** What an absent slot reads as. These validate against the v1 slice schemas (tested). */
export function defaultCore(): CoreSlice {
  return {
    avatar: {},
    unlocks: [],
    firstEncounters: {},
    garage: [],
    inventory: { items: [], wardrobe: [] },
    stats: { distanceKm: 0, pursuitsEscaped: 0, busted: 0, fightsWon: 0, racesWon: 0, playtimeSec: 0 },
  };
}

export { defaultSettings } from '../modes/settings-defaults.ts';

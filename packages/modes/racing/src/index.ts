/**
 * `@dv/mode-racing` (M07a1): the racing mode's descriptor and the data the shell needs without loading the sim half. The sim
 * half (`./sim/mode.ts`) and the UI half (`./ui/index.ts`) are lazy imports, as C06 asks, so the main chunk carries neither.
 *
 * The descriptor is `comingSoon` on purpose: M07a2 flips it to `available` together with the story hook. A QA build starts a
 * race through the bridge (`__dvBridge.racing.start`), which the mode host honours only when `qa` is true.
 */
import type { GameModeDescriptor, UnlockDef } from '@dv/shared';
import unlocksJson from '../../../../config/unlocks.json';

export { RACING_CONFIG } from './config.ts';
export type { RacingConfig } from './config.ts';
export { RACE_DEFS, DEFAULT_RACE, raceDef } from './races.ts';
export { RACE_CARS, LOANER_CAR, raceCar } from './cars.ts';
export type { RaceCar } from './cars.ts';
export { RACING_ANIM } from './anim-states.ts';
export { RACING_COMPONENTS } from './components.ts';

/** The tile `art` is the C07 ref `ui/mode-racing`. */
export function racingDescriptor(): GameModeDescriptor {
  return {
    id: 'racing',
    version: 1,
    titleKey: 'mode.racing.title',
    tile: { art: 'ui/mode-racing', order: 2 },
    status: 'comingSoon',
    unlock: 'unlock.racing',
    standalone: true,
    embeddable: true,
    requires: { simProfile: 'any', world: 'city', physics: true, xr: 'none', inputContexts: ['vehicle', 'menu'], network: 'none' },
    standaloneProfile: 'canonical',
    saveSlot: 'mode:racing',
    sliceSchema: 1,
    sim: () => import('./sim/mode.ts').then((m) => ({ default: m.racingSim })),
    ui: () => import('./ui/index.ts').then((m) => ({ default: m.racingUi })),
  };
}

/** The unlock rows of racing: `unlock.racing` with the starter loaner set, and the four class unlocks. */
export function racingUnlockDefs(): UnlockDef[] {
  return (unlocksJson as { unlocks: UnlockDef[] }).unlocks.map((u) => ({ ...u }));
}

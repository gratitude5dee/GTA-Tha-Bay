import type { GameModeDescriptor, GameModeSim, GameModeUI, UnlockDef } from '@dv/shared';

type StubId = 'racing' | 'fighter' | 'tycoon';

const ORDER: Record<StubId, number> = { racing: 2, fighter: 3, tycoon: 4 };

/** A sim that does nothing. `mode.start` refuses a `comingSoon` mode before this is ever loaded; it exists so the descriptor is complete. */
const noopSim: GameModeSim = {
  enter() {},
  tick() {},
  exit: () => ({ outcome: 'abort' }),
  saveSlice: () => null,
};

const noopUi: GameModeUI = { mount() {}, unmount() {}, inputContexts: ['menu'] };

/**
 * The A-06 stub of a mode that arrives later (ADR-0006): the tile exists, shows locked with its title, and refuses `mode.start`.
 * M07a1 (racing), M08a2 (fighter) and M09a1 (tycoon) replace these.
 */
export function comingSoonDescriptor(id: StubId): GameModeDescriptor {
  return {
    id,
    version: 1,
    titleKey: `mode.${id}.title`,
    tile: { art: `ui/mode-${id}`, order: ORDER[id] },
    status: 'comingSoon',
    unlock: `unlock.${id}`,
    standalone: true,
    embeddable: true,
    requires: { simProfile: 'any', world: id === 'tycoon' ? 'none' : 'city', physics: id !== 'tycoon', xr: 'none', inputContexts: ['menu'], network: 'none' },
    saveSlot: `mode:${id}`,
    sliceSchema: 1,
    sim: () => Promise.resolve({ default: noopSim }),
    ui: () => Promise.resolve({ default: noopUi }),
  };
}

export const comingSoonUnlock = (id: StubId): UnlockDef => ({
  id: `unlock.${id}`,
  titleKey: `unlock.${id}.title`,
  source: 'base',
  grants: { menuTile: id },
});

export const COMING_SOON_IDS: readonly StubId[] = ['racing', 'fighter', 'tycoon'];
export { noopUi };

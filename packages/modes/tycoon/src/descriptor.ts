/**
 * The C06 descriptor of Business Tycoon (08-tycoon.md section 3.1). `status` stays `comingSoon` until M09a2 (A-06): the tile renders
 * locked, and a QA build starts the mode through `host.startQa`. M09b2 bumps `version` to 2 and `world` to `'stage'` with the 3D pitch room.
 */
import type { GameModeDescriptor, GameModeUI, UnlockDef } from '@dv/shared';

const noopUi: GameModeUI = { mount() {}, unmount() {}, inputContexts: ['menu'] };

export const tycoonDescriptor = (): GameModeDescriptor => ({
  id: 'tycoon',
  version: 1,
  titleKey: 'mode.tycoon.title',
  tile: { art: 'ui/mode-tycoon', order: 4 },
  status: 'comingSoon',
  unlock: 'unlock.tycoon',
  standalone: true,
  embeddable: true,
  requires: { simProfile: 'any', world: 'none', physics: false, xr: 'seated', inputContexts: ['tycoon', 'menu'], network: 'none' },
  standaloneProfile: 'canonical',
  saveSlot: 'mode:tycoon',
  sliceSchema: 1,
  sim: () => import('./sim/TycoonModeSim.ts').then((m) => ({ default: m.tycoonSim })),
  // The dashboard and the other player views arrive in M09b1; until then the mode has no UI of its own.
  ui: () => Promise.resolve({ default: noopUi }),
});

export const tycoonUnlock: UnlockDef = { id: 'unlock.tycoon', titleKey: 'unlock.tycoon.title', source: 'base', grants: { menuTile: 'tycoon' } };

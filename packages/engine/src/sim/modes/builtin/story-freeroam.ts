import type { GameModeDescriptor, GameModeSim, JsonObject, ModeContext, StorySlice } from '@dv/shared';
import { noopUi } from './coming-soon.ts';

/** What a new profile's story slice reads as (valid against the v1 story schema). */
export function defaultStory(): StorySlice {
  return {
    premise: 'hella-valuation',
    act: 1,
    missions: {},
    activeMission: null,
    flags: {},
    wallet: { cashCents: 0, streetCred: 0, techClout: 0 },
    heat: { vehicleHeat: {}, impoundStrikes: {} },
    property: { safehouses: [], businesses: [] },
    npcRelations: {},
    world: { clockT: 0, weather: 'clear', seed: 0 },
    rng: {},
    position: { x: 0, y: 0, z: 0, yaw: 0 },
  };
}

export interface StoryFreeroamEnv {
  /** The live story slice of the session (the wallet in it is the economy's balance). */
  story(): StorySlice;
  /** The local player's feet and heading, or null before it exists. */
  playerPose(): { x: number; y: number; z: number; yaw: number } | null;
}

/**
 * The `story` mode's sim in this milestone: a minimal free roam (DL-668). It adopts the scenario the engine booted, so it spawns
 * nothing and moves nothing; it keeps the wallet on the HUD and, when the autosave policy asks, returns the story slice with the
 * player's pose and the clock in it. M05a1 replaces this with the mission VM.
 */
export function storyFreeroamSim(env: StoryFreeroamEnv): GameModeSim<JsonObject> {
  const snapshot = (ctx: ModeContext): StorySlice => {
    const s = env.story();
    const pose = env.playerPose();
    if (pose) s.position = { ...s.position, ...pose };
    try {
      s.world = { ...s.world, clockT: ctx.clock.now().t, weather: ctx.clock.env().weather };
    } catch {
      // a build without the clock keeps the last values
    }
    return s;
  };
  return {
    enter(ctx) {
      const w = env.story().wallet;
      ctx.ui.patch('hud.wallet', { cashCents: w.cashCents, streetCred: w.streetCred, techClout: w.techClout });
    },
    tick() {},
    exit: () => ({ outcome: 'quit' }),
    saveSlice: (ctx) => snapshot(ctx) as unknown as JsonObject,
  };
}

export const storyDescriptor = (sim: GameModeSim): GameModeDescriptor => ({
  id: 'story',
  version: 1,
  titleKey: 'mode.story.title',
  tile: { art: 'ui/mode-story', order: 1 },
  status: 'available',
  unlock: null,
  standalone: true,
  embeddable: false,
  requires: { simProfile: 'local', world: 'city', physics: true, xr: 'full', inputContexts: ['onFoot', 'vehicle'], network: 'none' },
  saveSlot: 'story:auto',
  sliceSchema: 1,
  sim: () => Promise.resolve({ default: sim }),
  ui: () => Promise.resolve({ default: noopUi }),
});

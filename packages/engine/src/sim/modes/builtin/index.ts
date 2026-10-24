import type { GameModeDescriptor, GameModeSim, UnlockDef } from '@dv/shared';
import { COMING_SOON_IDS, comingSoonDescriptor, comingSoonUnlock } from './coming-soon.ts';
import { sandboxDescriptor, sandboxSim, type SandboxEnv } from './sandbox.ts';
import { storyDescriptor, storyFreeroamSim, type StoryFreeroamEnv } from './story-freeroam.ts';

export { defaultSandbox, applyToggle, NEVER_WANTED } from './sandbox.ts';
export { defaultStory } from './story-freeroam.ts';
export { COMING_SOON_IDS } from './coming-soon.ts';
export { SANDBOX_ACTIONS, type SandboxWorldPort } from './sandbox-world.ts';

export type BuiltinEnv = StoryFreeroamEnv & SandboxEnv & {
  /** Replaces the story sim (M05a1); the argument is the free-roam sim of this milestone's engine. */
  wrapStory?(freeroam: GameModeSim): GameModeSim;
};

/** The first-party descriptors in tile order: story, racing, fighter, tycoon (the A-06 stubs), then sandbox. */
export function builtinDescriptors(env: BuiltinEnv): GameModeDescriptor[] {
  return [
    storyDescriptor(env.wrapStory ? env.wrapStory(storyFreeroamSim(env)) : storyFreeroamSim(env)),
    ...COMING_SOON_IDS.map(comingSoonDescriptor),
    sandboxDescriptor(sandboxSim(env)),
  ];
}

/** The base unlocks: one per standalone mode that arrives later. */
export function builtinUnlockDefs(): UnlockDef[] {
  return COMING_SOON_IDS.map(comingSoonUnlock);
}

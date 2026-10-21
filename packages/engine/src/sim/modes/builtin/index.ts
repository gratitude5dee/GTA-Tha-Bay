import type { GameModeDescriptor, UnlockDef } from '@dv/shared';
import { COMING_SOON_IDS, comingSoonDescriptor, comingSoonUnlock } from './coming-soon.ts';
import { sandboxDescriptor, sandboxSim, type SandboxEnv } from './sandbox.ts';
import { storyDescriptor, storyFreeroamSim, type StoryFreeroamEnv } from './story-freeroam.ts';

export { defaultSandbox, applyToggle, NEVER_WANTED } from './sandbox.ts';
export { defaultStory } from './story-freeroam.ts';
export { COMING_SOON_IDS } from './coming-soon.ts';

export type BuiltinEnv = StoryFreeroamEnv & SandboxEnv;

/** The first-party descriptors in tile order: story, racing, fighter, tycoon (the A-06 stubs), then sandbox. */
export function builtinDescriptors(env: BuiltinEnv): GameModeDescriptor[] {
  return [
    storyDescriptor(storyFreeroamSim(env)),
    ...COMING_SOON_IDS.map(comingSoonDescriptor),
    sandboxDescriptor(sandboxSim(env)),
  ];
}

/** The base unlocks: one per standalone mode that arrives later. */
export function builtinUnlockDefs(): UnlockDef[] {
  return COMING_SOON_IDS.map(comingSoonUnlock);
}

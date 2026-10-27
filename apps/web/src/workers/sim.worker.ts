/**
 * sim.worker as the game runs it (M02b1, DL-651): the engine's sim worker body plus the world streaming module. The engine's own
 * entry (`packages/engine/src/workers/sim.worker.ts`) passes no modules; this one adds the world, which stays inert until the
 * boot payload carries a world (`BootPayload.config.world`). With the world index in that payload (M02c1) the module also builds the
 * `WorldApi` (graph, traffic, map, teleport, query, places, resolver) and registers it, with the `WorldBoundsPort`, on `services.world`.
 *
 * M07a1 adds racing: the descriptor that replaces the `comingSoon` stub, its unlock rows and the racing sim module, which is inert
 * unless the boot payload says `racing: true` (QA `?racing=1`; M07a2 turns it on for players).
 *
 * M06c adds the NPC agency module (named NPCs, barks, Talk, `ModeContext.npc`), inert unless the boot payload carries a baked world.
 *
 * M08a2 adds the fighter: the descriptor (`available`, replacing the stub), the sim module (the ECS mirror, on when the boot payload says
 * `fighter: true`) and the QA commands.
 *
 * M09a1 replaces the tycoon `comingSoon` stub with the real descriptor (still `comingSoon`); `unlock.tycoon` is a row of config/unlocks.json.
 */
import { createPursuitModule } from '@dv/engine/sim';
import { runSimWorker, type WorkerScope } from '@dv/engine/workers/sim-worker-core';
import { storyUnlockDefs, wrapStory } from '@dv/mode-story';
import { racingDescriptor, racingUnlockDefs } from '@dv/mode-racing';
import { tycoonDescriptor } from '@dv/mode-tycoon';
import { fighterDescriptor } from '@dv/mode-fighter';
import { createFighterModule } from '@dv/mode-fighter/sim/module';
import { createRacingModule } from '@dv/mode-racing/sim/module';
import { worldStreamingModule } from '@dv/world/sim/module';
import { createNpcModule } from '@dv/npc/sim';
import { npcModuleOptions } from './npc-data.ts';

const racing = createRacingModule();
const fighter = createFighterModule();
// The named NPCs (M06c): schedules, utility, behaviour trees, barks, the Talk handler and ModeContext.npc. Inert without a baked world.
const npc = createNpcModule({ ...npcModuleOptions(), clock: () => performance.now() });

// The pursuit director (M03c) is inert until the world services and the vehicle module exist, and unhashed until it is first touched.
// The story mode (M05a1) wraps the engine's free roam with the mission runtime; the engine never imports the mode package.
runSimWorker(self as unknown as WorkerScope, [worldStreamingModule, createPursuitModule(), racing, fighter, npc], {
  wrapStory,
  descriptors: [racingDescriptor(), fighterDescriptor(), tycoonDescriptor()],
  unlockDefs: [...racingUnlockDefs(), ...storyUnlockDefs()],
  // QA builds only (the literal comparison lets production builds drop the branch): the racing loader and bot, and its QA commands
  ...(import.meta.env.VITE_DV_QA === '1'
    ? {
        qaSetup: async (): Promise<void> => {
          const [qa, dbg] = await Promise.all([import('@dv/mode-racing/qa'), import('@dv/mode-racing/qa/debug')]);
          qa.registerRacingQa();
          racing.installQa(dbg.runRacingQa);
          // the fighter's QA commands and bots (M08a2)
          const [fqa, fdbg] = await Promise.all([import('@dv/mode-fighter/qa'), import('@dv/mode-fighter/qa/debug')]);
          fqa.registerFighterQa();
          fighter.installQa(fdbg.runFighterQa);
          // the missions suite loader and the story autoplayer (M05a2)
          (await import('@dv/mode-story/qa')).registerStoryQa();
        },
      }
    : {}),
});

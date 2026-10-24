// The story mode as the sim worker and the page use it. The compiler (Ajv), the authoring helpers and the QA debugger have their own
// entry points: a production bundle imports this file only.
export { wrapStory, StoryController } from './mode.ts';
export type { BeginOptions, BeginResult, QaMissionBoot } from './mode.ts';
export { MissionRuntime } from './vm/runtime.ts';
export type { ThreadView } from './vm/runtime.ts';
export { resolveMission } from './compiler/resolve.ts';
export type { ResolvedMission, ResolvedPlacement, ResolvedZone } from './compiler/resolve.ts';
export { OpRunner } from './vm/ops.ts';
export { evalPred } from './vm/predicates.ts';
export type { PredEnv } from './vm/predicates.ts';
export { captureCheckpoint, readCheckpoint, restoreCheckpoint, writeCheckpoint } from './vm/checkpoint.ts';
export { pursuit, stepToward, TaskRunner } from './vm/tasks.ts';
export type { VehicleDriver } from './vm/tasks.ts';
export { DEFAULT_FLAGS } from './vm/types.ts';
export type { RuntimeFlags, RuntimeOptions, StartOptions, StoryCommand } from './vm/types.ts';
export { hash32 } from './vm/util.ts';

// The unlock rows of the story (M05c1): the fighter tile and its first fighter, and the ten district unlocks. Racing's rows are racing's.
import type { UnlockDef } from '@dv/shared';
import unlocksJson from '../../../../config/unlocks.json';

export function storyUnlockDefs(): UnlockDef[] {
  return (unlocksJson as { unlocks: UnlockDef[] }).unlocks.filter((u) => u.id !== 'unlock.racing' && !u.id.startsWith('unlock.racing.')).map((u) => ({ ...u }));
}
export { StoryPlaces, ShopService, SHOPS, SAFEHOUSES } from './missions/index.ts';
export { MissionStore } from './missions/store.ts';
export type { CatalogPayload, JobRow } from './missions/store.ts';
export { newGarageCar } from './missions/garage-car.ts';

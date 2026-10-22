/** `StorySlice.activeMission.checkpoint.schema` of `MissionCheckpointV1`. */
export const CHECKPOINT_SCHEMA = 1;
/** Ops one thread may run in a tick (`SimScheduler.opsBudgetPerTick`). */
export const OPS_BUDGET = 2000;
/** Consecutive ticks at the budget after which the mission fails with `E_BUDGET`. */
export const BUDGET_STREAK_LIMIT = 60;
/** The key every cast, marker and thread of a mission is registered under. */
export const missionScope = (id: string): string => `mis:${id}`;

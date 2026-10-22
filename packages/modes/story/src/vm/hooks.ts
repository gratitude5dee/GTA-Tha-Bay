/**
 * Mode hooks (C09 section C8, R-MODE-05). A `mode` objective runs its hook. The real path starts the child mode through
 * `ModeContext.startChild` and finishes on `mode.childExit`; the stub path runs the hook's stub objective instead, and is taken
 * when `startChild` says no (the mode is missing or `comingSoon`, the profile does not fit, the opponent was killed with scope
 * `fighter`) or under `?hooks=stub`. On the stub path the VM itself emits `unlockOnFirstEncounter` with
 * `{kind: 'mission', ref: '<missionId>:<hookId>'}`, so the unlock is recorded while the mode is `comingSoon`. Sim code under the C02 lint.
 */
import type { JsonObject, ModeHook, ObjectiveDef } from '@dv/shared';
import { objectiveStep, startObjective, type ObjResult } from './objectives.ts';
import type { MissionRuntime } from './runtime.ts';
import type { ObjRt } from './types.ts';
import { hash32 } from './util.ts';

type ModeObjective = Extract<ObjectiveDef, { k: 'mode' }>;

/** The outcome names of `ModeResult.outcome` in the order the mode host reports them (`mode.childExit` carries the index). */
export const CHILD_OUTCOMES = ['win', 'lose', 'finish', 'quit', 'abort'] as const;

/** Starts the stub of a hook as an objective of its own, and emits the first-encounter unlock. */
function startStub(rt: MissionRuntime, hook: ModeHook, o: ObjRt): () => ObjResult {
  if (hook.unlockOnFirstEncounter !== undefined) {
    const isNew = rt.ctx.unlocks.emit(hook.unlockOnFirstEncounter, { kind: 'mission', ref: `${rt.ir.id}:${hook.id}` });
    rt.noteEvent('mode.stub', { hook: hook.id, unlock: hook.unlockOnFirstEncounter, isNew });
  }
  const stub: ObjRt = { def: hook.stub, state: 'active', since: rt.clock, threadId: o.threadId, data: {} };
  startObjective(rt, hook.stub, stub);
  return objectiveStep(rt, stub);
}

export function hookStep(rt: MissionRuntime, o: ObjRt, d: ModeObjective): () => ObjResult {
  const hook = rt.ir.modeHooks?.find((h) => h.id === d.hook);
  let phase: 'init' | 'stub' | 'real' = 'init';
  let stubStep: (() => ObjResult) | null = null;
  let tries = 0;
  return () => {
    rt.cost(1);
    if (!hook) return 'failed';
    if (phase === 'init') {
      tries++;
      delete rt.modeResults[hook.id];
      let real = false;
      if (rt.flagsCfg.hooks !== 'stub') {
        const params: JsonObject = { ...(hook.params ?? {}), missionId: rt.ir.id, hookId: hook.id };
        if (hook.unlockOnFirstEncounter !== undefined) params['unlockOnFirstEncounter'] = hook.unlockOnFirstEncounter;
        real = rt.ctx.startChild(hook.mode, { defId: hook.defId, params, seed: hash32(rt.seed, hook.id, rt.attempt, tries) });
      }
      if (real) {
        phase = 'real';
        rt.activeHook = hook.id;
        rt.noteEvent('mode.child', { hook: hook.id });
        return 'running';
      }
      phase = 'stub';
      stubStep = startStub(rt, hook, o);
    }
    if (phase === 'stub') return (stubStep as () => ObjResult)();
    const result = rt.modeResults[hook.id];
    if (result === undefined) return 'running';
    rt.activeHook = null;
    if ((hook.passOn as string[]).includes(result)) return 'done';
    if (hook.retry === 'hook') {
      phase = 'init';
      return 'running';
    }
    return 'failed';
  };
}

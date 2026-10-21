import type { CombatApi, ModeContext, SimScheduler, TimelineRecorder, ZoneService } from '@dv/shared';

/** A `ModeContext` member whose service has not landed yet. The message names the milestone that delivers it. */
export class NotYetAvailable extends Error {
  constructor(readonly service: string, readonly milestone: string) {
    super(`ModeContext.${service} is not available yet: it lands in ${milestone}`);
    this.name = 'NotYetAvailable';
  }
}

/** An object whose listed methods throw `NotYetAvailable`; reading the object itself never throws, so a mode may keep a reference. */
function stub<T extends object>(service: string, milestone: string, methods: readonly string[], extra: Record<string, unknown> = {}): T {
  const o: Record<string, unknown> = { ...extra };
  for (const m of methods) {
    o[m] = (): never => {
      throw new NotYetAvailable(`${service}.${m}`, milestone);
    };
  }
  return o as T;
}

/** Zones, the thread scheduler and the timeline recorder come with the mission VM (M05a1). */
export const zonesStub = (): ZoneService => stub('zones', 'M05a1', ['define', 'undefine', 'inside', 'query', 'onEnter', 'onExit']);
export const schedulerStub = (): SimScheduler => stub('scheduler', 'M05a1', ['spawn', 'kill'], { opsBudgetPerTick: 2000 });
export const timelineStub = (): TimelineRecorder => stub('timeline', 'M05a1', ['emit', 'export', 'external'], { snapshotEvery: 2 });
/** The open-world combat core comes with M05c1 (the fighter's frame data with M08a1). */
export const combatStub = (): CombatApi => stub('combat', 'M05c1', ['setMoveSet', 'startMove', 'onHit']);
/** The NPC runtime comes with the dialogue proxy (M06a3). */
export const npcStub = (): ModeContext['npc'] => stub('npc', 'M06a3', ['whereIs', 'isKilled', 'playKnot']);

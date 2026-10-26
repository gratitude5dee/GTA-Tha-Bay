/**
 * What a behaviour-tree leaf reads for one brain step. Kept apart from `bt.ts` so the tree library and the leaves can import it without
 * a cycle. Sim code; C02 lint applies.
 */
import type { Activity } from '@dv/shared/contracts/c10-npc';
import type { BrainEnv, BrainWorld, NpcAgent } from './agent.ts';
import type { BrainConfig } from './config.ts';

/** Smart-object slots by POI: how many NPCs use the prop of a place right now. Derived from `NpcAgent.slotPoi`, so it is not saved. */
export class SmartSlots {
  private readonly used = new Map<string, number>();

  count(poi: string): number {
    return this.used.get(poi) ?? 0;
  }

  claim(poi: string): void {
    this.used.set(poi, this.count(poi) + 1);
  }

  release(poi: string): void {
    const n = this.count(poi) - 1;
    if (n > 0) this.used.set(poi, n);
    else this.used.delete(poi);
  }

  clear(): void {
    this.used.clear();
  }

  rebuild(agents: readonly NpcAgent[]): void {
    this.used.clear();
    for (const a of agents) if (a.slotPoi !== '') this.claim(a.slotPoi);
  }
}

export interface BtCtx {
  env: BrainEnv;
  world: BrainWorld;
  cfg: BrainConfig;
  /** Sim ticks and seconds this brain step stands for. */
  stepTicks: number;
  stepS: number;
  slots: SmartSlots;
  /** The active block's target for this step: `whereIs` of the schedule. */
  target: { x: number; y: number; z: number; poi: string; activity: Activity };
}

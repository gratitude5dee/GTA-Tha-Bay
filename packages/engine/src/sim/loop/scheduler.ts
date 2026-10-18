import { fnv32, type SimProfile, type SimStage, type SystemContext, type SystemDef } from '@dv/shared';

export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}

interface Entry {
  readonly def: SystemDef;
  /** fnv32(id) % rateDivisor. */
  readonly offset: number;
  readonly divisor: number;
}

function compareEntries(a: Entry, b: Entry): number {
  if (a.def.order !== b.def.order) return a.def.order - b.def.order;
  return a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0;
}

/**
 * Systems per stage, ordered by `order`, then `id` (string compare), whatever order they were registered in.
 * A system with `rateDivisor` d runs on ticks where (tick + fnv32(id) % d) % d === 0. A system with `profiles`
 * runs only in those sim profiles.
 */
export class SystemScheduler {
  private readonly stages: Entry[][] = [];
  private readonly ids = new Set<string>();

  constructor(private readonly profile: SimProfile) {}

  register(def: SystemDef): void {
    if (this.ids.has(def.id)) throw new SchedulerError(`system ${def.id} is already registered`);
    const stage = def.stage as number;
    if (!Number.isInteger(stage) || stage < 0 || stage > 9) throw new SchedulerError(`system ${def.id}: bad stage ${stage}`);
    const divisor = def.rateDivisor ?? 1;
    if (divisor !== 1 && divisor !== 2 && divisor !== 4) throw new SchedulerError(`system ${def.id}: rateDivisor must be 1, 2 or 4`);
    if (!Number.isFinite(def.order)) throw new SchedulerError(`system ${def.id}: order must be a finite number`);
    if (def.profiles && !def.profiles.includes(this.profile)) {
      // Registered for bookkeeping (duplicate detection) but never runs in this profile.
      this.ids.add(def.id);
      return;
    }
    const list = this.stages[stage] ?? (this.stages[stage] = []);
    list.push({ def, offset: fnv32(def.id) % divisor, divisor });
    list.sort(compareEntries);
    this.ids.add(def.id);
  }

  unregister(id: string): boolean {
    if (!this.ids.delete(id)) return false;
    for (const list of this.stages) {
      const i = list ? list.findIndex((e) => e.def.id === id) : -1;
      if (list && i >= 0) list.splice(i, 1);
    }
    return true;
  }

  /** System ids that would run in `stage` on `tick`, in run order. */
  plan(stage: SimStage, tick: number): string[] {
    const out: string[] = [];
    for (const e of this.stages[stage as number] ?? []) {
      if (e.divisor === 1 || (tick + e.offset) % e.divisor === 0) out.push(e.def.id);
    }
    return out;
  }

  /** Run one stage. `ctx.tick` is already set by the caller. */
  runStage(stage: SimStage, ctx: SystemContext): void {
    const list = this.stages[stage as number];
    if (!list) return;
    const tick = ctx.tick;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as Entry;
      if (e.divisor === 1 || (tick + e.offset) % e.divisor === 0) e.def.run(ctx);
    }
  }

  get size(): number {
    return this.ids.size;
  }
}

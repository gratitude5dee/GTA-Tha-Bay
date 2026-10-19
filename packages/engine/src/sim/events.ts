/**
 * Sim events: facts the sim reports to the page and to other systems (ownership transitions today; damage,
 * infractions and mission hooks later). The C06 `SimEvent` type arrives with M04a; this is its shape from
 * spec/domains/01-engine-save-modes.md ("Mission and mode hooks"), kept local until then.
 */
export interface SimEvent {
  /** Dotted event name, for example `control.transition`. */
  t: string;
  tick: number;
  /** EntityHandle of the subject. */
  a?: number;
  b?: number;
  n?: number;
  /** Detail: a reason key or a short state description. */
  s?: string;
}

/** Events not yet delivered. Not hashed or checkpointed: delivery state is not simulation state. */
export class SimEventLog {
  private items: SimEvent[] = [];
  /** Events dropped because the log was full (nothing drained it). */
  dropped = 0;

  constructor(private readonly capacity = 256) {}

  push(e: SimEvent): void {
    if (this.items.length >= this.capacity) {
      this.dropped++;
      return;
    }
    this.items.push(e);
  }

  get size(): number {
    return this.items.length;
  }

  /** Take every pending event, oldest first. */
  drain(): SimEvent[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  /** The pending events without taking them (tests). */
  peek(): readonly SimEvent[] {
    return this.items;
  }
}

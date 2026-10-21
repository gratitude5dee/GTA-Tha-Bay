import type { SaveReason, SaveResult, SimControlMessage, SlotId } from '@dv/shared';
import type { SimControlResult } from '../transport/envelope.ts';
import type { SaveCapability, SaveWritePort } from '../save-port.ts';

/**
 * Worker side of saving (C05 rule 4, C02 rule 9): the handler for `SimControlMessage {t: 'save.request'}` and the
 * write port for sim systems. Both run outside ticks: `SimRuntime` calls `handle` when a control message arrives and
 * `flush` after it has handled a batch of commands, never from inside `advance`.
 *
 * This file imports only types so the C02 sim program (no DOM lib) stays free of IndexedDB; the SaveService itself is
 * opened lazily through `deps.service`.
 */
export interface SaveWriter {
  write(slot: SlotId, data: unknown, reason: SaveReason): Promise<SaveResult>;
  /** The SaveService sets the session capability before a write (M04a2: ModeHost chooses it per top-level mode). */
  setCapability?(cap: SaveCapability): void;
}

export interface SaveSnapshotEntry {
  slot: SlotId;
  data: unknown;
}

export interface SaveControlDeps {
  /** Opens the SaveService on first use. */
  service: () => Promise<SaveWriter>;
  /**
   * The slots to write for `reason`, or null when no save is due (heat above 0, mid-mission, mid-pursuit: C05 rule 4).
   * M04a2's autosave policy supplies this; until then the worker installs a collector that returns null.
   */
  collect: (reason: SaveReason) => SaveSnapshotEntry[] | null;
}

export type { SaveWritePort } from '../save-port.ts';

export class SaveControl implements SaveWritePort {
  private readonly queue = new Map<SlotId, { data: unknown; reason: SaveReason }>();
  private flushing: Promise<number> | null = null;
  /** Writes that failed at a flush (kept for QA and the status line). */
  readonly failures: { slot: SlotId; error: string }[] = [];
  /** The capability of the running top-level mode (M04a2); applied to the SaveService before each write batch. */
  capability: SaveCapability | null = null;

  constructor(private readonly deps: SaveControlDeps) {}

  post(slot: SlotId, data: unknown, reason: SaveReason): void {
    this.queue.set(slot, { data, reason });
  }

  setCapability(cap: SaveCapability | null): void {
    this.capability = cap;
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Handles one `save.request` and answers with the result to post as `ctl.result`. */
  async handle(msg: SimControlMessage): Promise<SimControlResult> {
    const entries = this.deps.collect(msg.reason);
    if (!entries) return { t: 'save.result', ok: false, reason: 'not-eligible' };
    const svc = await this.deps.service();
    if (this.capability) svc.setCapability?.(this.capability);
    let n = 0;
    for (const e of entries) {
      const r = await svc.write(e.slot, e.data, msg.reason);
      if (!r.ok) return { t: 'save.result', ok: false, reason: r.error };
      n++;
    }
    return { t: 'save.result', ok: true, slots: n };
  }

  /** Writes what the port holds. Overlapping calls share one run; the number of slots written is returned. */
  flush(): Promise<number> {
    if (this.flushing) return this.flushing;
    if (this.queue.size === 0) return Promise.resolve(0);
    const run = (async (): Promise<number> => {
      const svc = await this.deps.service();
      if (this.capability) svc.setCapability?.(this.capability);
      let n = 0;
      while (this.queue.size > 0) {
        const [slot, item] = this.queue.entries().next().value as [SlotId, { data: unknown; reason: SaveReason }];
        this.queue.delete(slot);
        const r = await svc.write(slot, item.data, item.reason);
        if (r.ok) n++;
        else this.failures.push({ slot, error: r.error });
      }
      return n;
    })();
    this.flushing = run.finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }
}

import type { CoreSlice, UiBridge, UnlockDef, UnlockEventId, UnlockRegistry } from '@dv/shared';

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface UnlockRegistryOptions {
  /** The live core slice (`unlocks` is sorted and unique). */
  core(): CoreSlice;
  ui: UiBridge;
  /** Asks for a save with reason `unlock` after a new unlock. */
  saveUnlock(): void;
  /** Telemetry port; the name and props follow the C16 registry (`unlock.emit {id}`). */
  telemetry: { emit(name: 'unlock.emit', props: { id: string }): void };
}

/**
 * The unlock registry (C06 rule 6, R-MODE-05). `emit` is idempotent: only the first call for an id returns true, writes
 * `CoreSlice.unlocks` (kept sorted and unique), saves with reason `unlock`, sends one `unlock` toast and one `sys.unlocks` patch.
 * `setUnlockAll` is the QA `?unlockAll=1` switch: `has` then answers true for every registered id, in memory only; nothing is added
 * to the slice and nothing is saved because of it.
 */
export class UnlockRegistryImpl implements UnlockRegistry {
  private readonly defsById = new Map<UnlockEventId, UnlockDef>();
  private readonly listeners = new Set<(d: UnlockDef) => void>();
  private all = false;

  constructor(private readonly o: UnlockRegistryOptions) {}

  register(defs: UnlockDef[]): void {
    for (const d of defs) this.defsById.set(d.id, d);
  }

  defs(): UnlockDef[] {
    return [...this.defsById.values()];
  }

  setUnlockAll(on: boolean): void {
    this.all = on;
    this.publish();
  }

  get unlockAll(): boolean {
    return this.all;
  }

  emit(id: UnlockEventId, src: { kind: 'mission' | 'mode' | 'achievement' | 'debug'; ref: string }): boolean {
    const core = this.o.core();
    if (core.unlocks.includes(id)) return false;
    core.unlocks.push(id);
    core.unlocks.sort(byStr);
    const def = this.defsById.get(id);
    this.o.telemetry.emit('unlock.emit', { id });
    this.o.ui.toast({ id: `unlock:${id}`, kind: 'unlock', text: def?.titleKey ?? `unlock.title.${id}`, params: { source: src.kind } });
    this.publish();
    this.o.saveUnlock();
    if (def) for (const cb of [...this.listeners]) cb(def);
    return true;
  }

  has(id: UnlockEventId): boolean {
    return this.o.core().unlocks.includes(id) || (this.all && this.defsById.has(id));
  }

  list(): UnlockEventId[] {
    return [...this.o.core().unlocks];
  }

  onUnlocked(cb: (d: UnlockDef) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** `sys.unlocks`: the ids that count as unlocked right now (with the QA switch, every registered id). */
  publish(): void {
    const ids = new Set<string>(this.o.core().unlocks);
    if (this.all) for (const id of this.defsById.keys()) ids.add(id);
    this.o.ui.patch('sys.unlocks', [...ids].sort(byStr));
  }
}

import type { JsonValue, ViewModelSource, VmKey, VmPatch } from '@dv/shared';

type Listener = (v: JsonValue | undefined, k: VmKey) => void;

/**
 * Main-side `ViewModelSource` (C06 1.1, 10-ui.md 3.3). `apply` takes the patches of one sim frame in order; a patch whose `rev` is not
 * newer than the key's last one is stale and ignored (a worker restart resets `rev`, so `reset` clears the store first). `subscribe`
 * takes an exact key or a `prefix*` pattern and calls back for every change, `undefined` for a deleted key. Listener errors do not
 * stop the other listeners.
 */
export class ViewModelStore implements ViewModelSource {
  private readonly values = new Map<VmKey, { v: JsonValue; rev: number }>();
  private readonly exact = new Map<string, Set<Listener>>();
  private readonly prefix = new Map<string, Set<Listener>>();
  private top = 0;

  get rev(): number {
    return this.top;
  }

  get<T extends JsonValue>(k: VmKey): T | undefined {
    return this.values.get(k)?.v as T | undefined;
  }

  keys(): VmKey[] {
    return [...this.values.keys()].sort();
  }

  subscribe(k: VmKey | `${string}*`, cb: Listener): () => void {
    const star = k.endsWith('*');
    const table = star ? this.prefix : this.exact;
    const key = star ? k.slice(0, -1) : k;
    let set = table.get(key);
    if (!set) table.set(key, (set = new Set()));
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) table.delete(key);
    };
  }

  apply(patches: readonly VmPatch[]): void {
    for (const p of patches) {
      const prev = this.values.get(p.k);
      if (prev && p.rev <= prev.rev) continue;
      if (p.v === null) this.values.delete(p.k);
      else this.values.set(p.k, { v: p.v, rev: p.rev });
      if (p.rev > this.top) this.top = p.rev;
      this.notify(p.k, p.v === null ? undefined : p.v);
    }
  }

  /** Forgets every value (the sim worker restarted). Listeners hear `undefined` for each key that was set. */
  reset(): void {
    const keys = [...this.values.keys()];
    this.values.clear();
    this.top = 0;
    for (const k of keys) this.notify(k, undefined);
  }

  private notify(k: VmKey, v: JsonValue | undefined): void {
    const fire = (set: Set<Listener> | undefined): void => {
      if (!set) return;
      for (const cb of [...set]) {
        try {
          cb(v, k);
        } catch (e) {
          console.error('view-model listener failed', e);
        }
      }
    };
    fire(this.exact.get(k));
    for (const [pre, set] of this.prefix) if (k.startsWith(pre)) fire(set);
  }
}

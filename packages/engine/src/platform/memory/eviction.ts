/**
 * The eviction registry of the MemoryBudget (11-platform.md section 5.6): modules that hold evictable memory register a callback, and a
 * soft memory-pressure response calls them all. The ChunkStore (through the world view) is the first one; a texture cache or a
 * decoded-clip cache joins the same way. A callback returns the megabytes it freed when it knows them (for the log line), else 0.
 */
export type Evictor = (ctx: { level: 'soft' | 'hard' }) => number | void;

export class EvictionRegistry {
  private readonly list = new Map<string, Evictor>();
  /** Calls made and megabytes reported freed since creation. */
  calls = 0;
  freedMB = 0;

  register(name: string, fn: Evictor): () => void {
    this.list.set(name, fn);
    return () => {
      if (this.list.get(name) === fn) this.list.delete(name);
    };
  }

  get names(): string[] {
    return [...this.list.keys()];
  }

  /** Runs every evictor once. A throwing evictor is skipped, so one broken cache cannot stop the response. */
  run(level: 'soft' | 'hard'): number {
    let freed = 0;
    for (const fn of [...this.list.values()]) {
      try {
        const n = fn({ level });
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) freed += n;
      } catch {
        // a failing cache is not the pressure response's problem
      }
      this.calls += 1;
    }
    this.freedMB += freed;
    return freed;
  }
}

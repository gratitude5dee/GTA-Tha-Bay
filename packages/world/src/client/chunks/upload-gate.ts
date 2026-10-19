/**
 * ChunkUploadGate (02-world.md section 5.2 rule 4; C08 rule 13; M02b1): at most ONE chunk is released to the GPU per frame on every
 * tier, and on `mobile-low` and `xr-quest` at most 2 MB per frame (C13 `WorldLimits`). A chunk goes up whole. Items are released
 * highest priority first (the lowest `priority` number: the stream rank `distance x direction weight`), ties by arrival.
 *
 * A mesh that alone exceeds the byte cap cannot be split; the mesher keeps meshes under the cap (`maxBytes`), so this does not
 * occur on the baked worlds. If one does arrive it is released alone, counted in `stats.oversize`, and the tests assert the count
 * stays 0 (the gate would otherwise hold it forever).
 */
export interface GateItem<T> {
  id: string;
  /** Lower goes first. */
  priority: number;
  bytes: number;
  payload: T;
}

export interface GateStats {
  /** Items released since the start. */
  released: number;
  /** The most items released in one frame (the gate's contract: 1). */
  maxPerFrame: number;
  /** Bytes of the item released in the latest releasing frame. */
  lastBytes: number;
  /** Largest `bytes` released in one frame. */
  maxBytes: number;
  oversize: number;
}

export class ChunkUploadGate<T> {
  private readonly queue: (GateItem<T> & { seq: number })[] = [];
  private seq = 0;
  private frame = -1;
  private inFrame = 0;
  readonly stats: GateStats = { released: 0, maxPerFrame: 0, lastBytes: 0, maxBytes: 0, oversize: 0 };

  constructor(private readonly maxBytes: number | null) {}

  get size(): number {
    return this.queue.length;
  }

  has(id: string): boolean {
    return this.queue.some((q) => q.id === id);
  }

  /** Queues an item; an item with the same id is replaced (a newer mesh of the same unit). */
  enqueue(item: GateItem<T>): void {
    this.remove(item.id);
    this.queue.push({ ...item, seq: this.seq++ });
  }

  remove(id: string): boolean {
    const i = this.queue.findIndex((q) => q.id === id);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  /** Changes the priority of a queued item (the focus moved). */
  reprioritise(id: string, priority: number): void {
    const q = this.queue.find((x) => x.id === id);
    if (q) q.priority = priority;
  }

  /**
   * The item to upload in `frame`, or null. Calling it twice in one frame returns null the second time: the gate never lets two
   * chunks through in one frame.
   */
  release(frame: number): GateItem<T> | null {
    if (frame !== this.frame) {
      this.frame = frame;
      this.inFrame = 0;
    }
    if (this.inFrame >= 1 || this.queue.length === 0) return null;
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i] as GateItem<T> & { seq: number };
      if (this.maxBytes !== null && q.bytes > this.maxBytes) continue;
      const b = best < 0 ? null : (this.queue[best] as GateItem<T> & { seq: number });
      if (!b || q.priority < b.priority || (q.priority === b.priority && q.seq < b.seq)) best = i;
    }
    let oversize = false;
    if (best < 0) {
      // Only oversize items are left: release the best of them rather than hold the unit forever.
      oversize = true;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i] as GateItem<T> & { seq: number };
        const b = best < 0 ? null : (this.queue[best] as GateItem<T> & { seq: number });
        if (!b || q.priority < b.priority || (q.priority === b.priority && q.seq < b.seq)) best = i;
      }
    }
    const [item] = this.queue.splice(best, 1) as [GateItem<T> & { seq: number }];
    this.inFrame++;
    this.stats.released++;
    this.stats.maxPerFrame = Math.max(this.stats.maxPerFrame, this.inFrame);
    this.stats.lastBytes = item.bytes;
    this.stats.maxBytes = Math.max(this.stats.maxBytes, item.bytes);
    if (oversize) this.stats.oversize++;
    return item;
  }
}

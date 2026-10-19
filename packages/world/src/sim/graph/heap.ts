/**
 * A binary min-heap of (key, id) pairs for the road router (M02c1). Order is the key, then the id: two states with the same
 * score always leave in the same order, which is what makes a route reproducible (C08 `RoadGraphQuery.route`: ties by edge id).
 * Keys and ids are non-negative integers (keys in decimetres). Pure; C02 lint applies.
 */
export class MinHeap {
  private keys: number[] = [];
  private ids: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  clear(): void {
    this.keys.length = 0;
    this.ids.length = 0;
  }

  /** Smaller key first; equal keys by smaller id. */
  private less(i: number, j: number): boolean {
    const ki = this.keys[i] as number;
    const kj = this.keys[j] as number;
    return ki < kj || (ki === kj && (this.ids[i] as number) < (this.ids[j] as number));
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i] as number;
    const d = this.ids[i] as number;
    this.keys[i] = this.keys[j] as number;
    this.ids[i] = this.ids[j] as number;
    this.keys[j] = k;
    this.ids[j] = d;
  }

  push(key: number, id: number): void {
    let i = this.ids.length;
    this.keys.push(key);
    this.ids.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** The smallest entry, or null when empty. The returned object is reused by the next call. */
  pop(): { key: number; id: number } | null {
    const n = this.ids.length;
    if (n === 0) return null;
    this.top.key = this.keys[0] as number;
    this.top.id = this.ids[0] as number;
    const lastKey = this.keys.pop() as number;
    const lastId = this.ids.pop() as number;
    if (n > 1) {
      this.keys[0] = lastKey;
      this.ids[0] = lastId;
      let i = 0;
      const m = n - 1;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < m && this.less(l, s)) s = l;
        if (r < m && this.less(r, s)) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return this.top;
  }

  private readonly top = { key: 0, id: 0 };
}

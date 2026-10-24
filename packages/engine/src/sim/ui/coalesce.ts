import type { JsonValue, VmKey, VmPatch } from '@dv/shared';

/** C06 `UiBridge.patch`: at most this many patches and this many bytes (key plus JSON value) leave the sim per tick. */
export const PATCH_LIMITS = { perTick: 64, bytesPerTick: 4096 } as const;

const byteLength = (s: string): number => {
  // JSON of view-model values is mostly ASCII; count UTF-8 bytes without TextEncoder (the sim program has no DOM lib).
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3;
  }
  return n;
};

interface Pending {
  k: VmKey;
  v: JsonValue | null;
  bytes: number;
}

/**
 * Coalesces `UiBridge.patch` calls (C06, 10-ui.md 3.3). A patch replaces a value as a whole, so a second patch of a key that is still
 * waiting replaces the first in place (the key keeps its place in the queue). `flush` takes patches in queue order until the tick's
 * limits are met; the rest wait for the next tick, in order, and `rev` rises by one per patch that leaves. A single patch of more
 * than the byte limit can never be sent: it is dropped and counted.
 */
export class PatchCoalescer {
  private readonly queue: Pending[] = [];
  private readonly index = new Map<VmKey, Pending>();
  private rev = 0;
  /** Patches dropped because one value alone exceeded the byte limit. */
  oversized = 0;

  push(k: VmKey, v: JsonValue | null): void {
    const bytes = byteLength(k) + byteLength(JSON.stringify(v));
    if (bytes > PATCH_LIMITS.bytesPerTick) {
      this.oversized++;
      return;
    }
    const waiting = this.index.get(k);
    if (waiting) {
      waiting.v = v;
      waiting.bytes = bytes;
      return;
    }
    const p: Pending = { k, v, bytes };
    this.queue.push(p);
    this.index.set(k, p);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** The patches that leave this tick. */
  flush(): VmPatch[] {
    const out: VmPatch[] = [];
    let bytes = 0;
    let n = 0;
    while (n < this.queue.length && out.length < PATCH_LIMITS.perTick) {
      const p = this.queue[n] as Pending;
      if (bytes + p.bytes > PATCH_LIMITS.bytesPerTick) break;
      bytes += p.bytes;
      this.index.delete(p.k);
      out.push({ k: p.k, rev: ++this.rev, v: p.v });
      n++;
    }
    this.queue.splice(0, n);
    return out;
  }
}

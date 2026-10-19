import { MemoryFileStore, MemoryIndexStore } from '../../src/assets/store/memory-ports.ts';
import { PackStore, sha256Hex, type PackFetcher, type PackStoreOptions } from '../../src/assets/store/store.ts';
import { FetchFailure } from '../../src/assets/store/fetch-retry.ts';
import type { PackRef } from '../../src/assets/store/types.ts';

export const KB = 1024;

/** Deterministic bytes: `size` bytes seeded by `seed`. */
export function bytesOf(seed: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

export interface TestPack {
  ref: PackRef;
  bytes: Uint8Array;
}

export async function makePack(seed: number, size: number, tags: string[] = [], kind: PackRef['kind'] = 'data'): Promise<TestPack> {
  const bytes = bytesOf(seed, size);
  const sha256 = await sha256Hex(bytes);
  return { ref: { url: `https://media.test/p${seed}.bin`, sha256, bytes: size, kind, tags }, bytes };
}

/** A fetcher that serves registered packs by URL and counts requests. */
export class FakeFetcher implements PackFetcher {
  readonly served = new Map<string, Uint8Array>();
  calls: string[] = [];
  failWith: FetchFailure | null = null;
  /** When set, requests wait for it before answering. */
  gate: Promise<void> | null = null;

  add(p: TestPack): void {
    this.served.set(p.ref.url, p.bytes);
  }
  async fetchBytes(url: string): Promise<Uint8Array> {
    this.calls.push(url);
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    const b = this.served.get(url);
    if (!b) throw new FetchFailure('http', 404);
    return b.slice();
  }
}

export class Clock {
  t: number;
  constructor(start = 1_000_000) {
    this.t = start;
  }
  now = (): number => this.t;
  advanceDays(d: number): void {
    this.t += d * 24 * 60 * 60 * 1000;
  }
}

export interface Rig {
  files: MemoryFileStore;
  index: MemoryIndexStore;
  fetcher: FakeFetcher;
  clock: Clock;
  store: PackStore;
  make(over?: Partial<PackStoreOptions>): PackStore;
}

export function rig(over: Partial<PackStoreOptions> = {}): Rig {
  const files = new MemoryFileStore();
  const index = new MemoryIndexStore();
  const fetcher = new FakeFetcher();
  const clock = new Clock();
  const make = (o: Partial<PackStoreOptions> = {}): PackStore =>
    new PackStore({ files, index, fetcher, now: clock.now, softCapBytes: 1 << 30, ...over, ...o });
  return { files, index, fetcher, clock, store: make(), make };
}

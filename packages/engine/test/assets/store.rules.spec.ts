import { describe, expect, it } from 'vitest';
import { FetchFailure } from '../../src/assets/store/fetch-retry.ts';
import { PackUnavailable } from '../../src/assets/store/types.ts';
import { KB, makePack, rig } from './helpers.ts';

describe('PackStore rules (11-platform-pwa.md section 5)', () => {
  it('rule 1: a crash between the file flush and the row write leaves an orphan that the next open() deletes', async () => {
    const r = rig();
    const p = await makePack(1, 4 * KB);
    r.fetcher.add(p);
    await r.store.open();
    r.index.crashNextPut = true;
    // The verified bytes are still served; the cache just did not commit.
    const got = await r.store.get(p.ref);
    expect(new Uint8Array(got)).toEqual(p.bytes);
    expect(r.files.files.has(p.ref.sha256)).toBe(true);
    expect(r.index.rows.has(p.ref.sha256)).toBe(false);

    const next = r.make();
    await next.open();
    expect(r.files.files.size).toBe(0);
    expect(await next.has(p.ref.sha256)).toBe(false);
  });

  it('rule 1: a hash mismatch leaves neither file nor row and throws hash-mismatch', async () => {
    const r = rig();
    const p = await makePack(2, 4 * KB);
    const other = await makePack(3, 4 * KB);
    r.fetcher.served.set(p.ref.url, other.bytes);
    await r.store.open();
    await expect(r.store.get(p.ref)).rejects.toMatchObject({ name: 'PackUnavailable', reason: 'hash-mismatch' });
    expect(r.files.files.size).toBe(0);
    expect(r.index.rows.size).toBe(0);
  });

  it('rule 1: the right bytes with the wrong size are a hash-mismatch too', async () => {
    const r = rig();
    const p = await makePack(4, 4 * KB);
    r.fetcher.add(p);
    await r.store.open();
    await expect(r.store.get({ ...p.ref, bytes: p.ref.bytes + 1 })).rejects.toMatchObject({ reason: 'hash-mismatch' });
    expect(r.index.rows.size).toBe(0);
  });

  it('rule 3: with a 3-pack soft cap the least recently used unpinned pack is evicted and pinned packs stay', async () => {
    const r = rig({ softCapBytes: 3 * 4 * KB });
    const packs = await Promise.all([1, 2, 3, 4].map((n) => makePack(10 + n, 4 * KB)));
    for (const p of packs) r.fetcher.add(p);
    const [a, b, c, d] = packs as [typeof packs[0], typeof packs[0], typeof packs[0], typeof packs[0]];
    await r.store.open();
    await r.store.get(a.ref);
    await r.store.get(b.ref);
    await r.store.get(c.ref);
    r.store.pin([a.ref.sha256]);
    // Touch b so that c is the least recently used unpinned pack.
    await r.store.get(b.ref);
    await r.store.get(d.ref);
    await r.store.settled();
    expect(await r.store.has(a.ref.sha256)).toBe(true);
    expect(await r.store.has(b.ref.sha256)).toBe(true);
    expect(await r.store.has(c.ref.sha256)).toBe(false);
    expect(await r.store.has(d.ref.sha256)).toBe(true);
    expect(r.store.stats.evictions).toBe(1);
  });

  it('rule 3: a pinned pack is never the victim even when it is the oldest', async () => {
    const r = rig({ softCapBytes: 2 * 4 * KB });
    const [a, b, c] = await Promise.all([20, 21, 22].map((n) => makePack(n, 4 * KB)));
    for (const p of [a, b, c]) r.fetcher.add(p!);
    await r.store.open();
    r.store.pin([a!.ref.sha256]);
    await r.store.get(a!.ref);
    await r.store.get(b!.ref);
    await r.store.get(c!.ref);
    expect(await r.store.has(a!.ref.sha256)).toBe(true);
    expect(await r.store.has(b!.ref.sha256)).toBe(false);
    expect(await r.store.has(c!.ref.sha256)).toBe(true);
  });

  it('rule 3: QuotaExceededError on a write evicts the LRU unpinned pack and retries', async () => {
    const r = rig();
    const [a, b, c] = await Promise.all([30, 31, 32].map((n) => makePack(n, 4 * KB)));
    for (const p of [a, b, c]) r.fetcher.add(p!);
    r.files.limitBytes = 2 * 4 * KB;
    await r.store.open();
    await r.store.get(a!.ref);
    await r.store.get(b!.ref);
    await r.store.get(c!.ref);
    expect(await r.store.has(a!.ref.sha256)).toBe(false);
    expect(await r.store.has(b!.ref.sha256)).toBe(true);
    expect(await r.store.has(c!.ref.sha256)).toBe(true);
  });

  it('rule 3: gc(current) removes only packs absent from current and unused for over 14 days', async () => {
    const r = rig();
    const [x, y, z] = await Promise.all([40, 41, 42].map((n) => makePack(n, 4 * KB)));
    for (const p of [x, y, z]) r.fetcher.add(p!);
    await r.store.open();
    await r.store.get(x!.ref); // absent from current, old
    await r.store.get(y!.ref); // in current, old
    r.clock.advanceDays(15);
    await r.store.get(z!.ref); // absent from current, recent
    const out = await r.store.gc(new Set([y!.ref.sha256]));
    expect(out.removed).toBe(1);
    expect(out.freedMB).toBeCloseTo((4 * KB) / (1024 * 1024), 6);
    expect(await r.store.has(x!.ref.sha256)).toBe(false);
    expect(await r.store.has(y!.ref.sha256)).toBe(true);
    expect(await r.store.has(z!.ref.sha256)).toBe(true);
  });

  it('rule 3: evictByTag removes only the tagged packs', async () => {
    const r = rig();
    const tagged = await makePack(50, 4 * KB, ['char:npc_test']);
    const other = await makePack(51, 4 * KB, ['char:npc_other']);
    const plain = await makePack(52, 4 * KB);
    for (const p of [tagged, other, plain]) r.fetcher.add(p);
    await r.store.open();
    for (const p of [tagged, other, plain]) await r.store.get(p.ref);
    r.store.pin([tagged.ref.sha256]);
    expect(await r.store.evictByTag('char:npc_test')).toEqual({ removed: 1 });
    expect(await r.store.has(tagged.ref.sha256)).toBe(false);
    expect(await r.store.has(other.ref.sha256)).toBe(true);
    expect(await r.store.has(plain.ref.sha256)).toBe(true);
  });

  it('rule 5: downloadAll rejects when free quota is below 1.2 x the missing bytes, and runs when it is not', async () => {
    const packs = await Promise.all([60, 61, 62].map((n) => makePack(n, 30 * KB)));
    const total = 3 * 30 * KB;
    let quota = Math.floor(1.2 * total) - 1;
    const r = rig({ estimate: () => Promise.resolve({ usage: 0, quota }) });
    for (const p of packs) r.fetcher.add(p);
    await r.store.open();
    const refs = packs.map((p) => p.ref);
    await expect(r.store.downloadAll(refs, () => undefined)).rejects.toMatchObject({ name: 'PackUnavailable', reason: 'quota' });
    expect(r.fetcher.calls).toHaveLength(0);

    quota = Math.ceil(1.2 * total);
    const progress: Array<[number, number]> = [];
    await r.store.downloadAll(refs, (d, t) => progress.push([d, t]));
    expect(progress.at(-1)).toEqual([3, 3]);
    for (const p of packs) expect(await r.store.has(p.ref.sha256)).toBe(true);
  });

  it('rule 2: a read serves from the store without the network and updates lastUsedAt', async () => {
    const r = rig();
    const p = await makePack(70, 4 * KB);
    r.fetcher.add(p);
    await r.store.open();
    await r.store.get(p.ref);
    const before = r.index.rows.get(p.ref.sha256)?.lastUsedAt ?? 0;
    r.clock.advanceDays(1);
    const again = await r.store.get(p.ref);
    expect(new Uint8Array(again)).toEqual(p.bytes);
    expect(r.fetcher.calls).toHaveLength(1);
    expect(r.store.stats.hits).toBe(1);
    expect(r.index.rows.get(p.ref.sha256)?.lastUsedAt ?? 0).toBeGreaterThan(before);
  });

  it('rule 2: a file the OS took is a normal miss and is fetched again', async () => {
    const r = rig();
    const p = await makePack(71, 4 * KB);
    r.fetcher.add(p);
    await r.store.open();
    await r.store.get(p.ref);
    r.files.files.delete(p.ref.sha256);
    expect(await r.store.has(p.ref.sha256)).toBe(false);
    await r.store.get(p.ref);
    expect(r.fetcher.calls).toHaveLength(2);
    expect(await r.store.has(p.ref.sha256)).toBe(true);
  });

  it('rule 2: a caller-reported decode failure purges the pack and fetches once more', async () => {
    const r = rig();
    const p = await makePack(72, 4 * KB);
    r.fetcher.add(p);
    await r.store.open();
    await r.store.get(p.ref);
    await r.store.reportDecodeFailure(p.ref);
    expect(r.fetcher.calls).toHaveLength(2);
    expect(await r.store.has(p.ref.sha256)).toBe(true);
  });

  it('five concurrent gets of one hash make one request and each gets its own buffer', async () => {
    const r = rig();
    const p = await makePack(73, 4 * KB);
    r.fetcher.add(p);
    await r.store.open();
    const bufs = await Promise.all([1, 2, 3, 4, 5].map(() => r.store.get(p.ref)));
    expect(r.fetcher.calls).toHaveLength(1);
    expect(new Set(bufs).size).toBe(5);
    for (const b of bufs) expect(new Uint8Array(b)).toEqual(p.bytes);
  });

  it('fetch failures surface as PackUnavailable with the same reason; an aborted caller stops waiting', async () => {
    const r = rig();
    const p = await makePack(74, 4 * KB);
    r.fetcher.add(p);
    await r.store.open();
    r.fetcher.failWith = new FetchFailure('http', 503);
    await expect(r.store.get(p.ref)).rejects.toBeInstanceOf(PackUnavailable);
    r.fetcher.failWith = new FetchFailure('offline');
    await expect(r.store.get(p.ref)).rejects.toMatchObject({ reason: 'offline' });
    r.fetcher.failWith = null;
    let release!: () => void;
    r.fetcher.gate = new Promise<void>((res) => (release = res));
    const ac = new AbortController();
    const pending = r.store.get(p.ref, { signal: ac.signal });
    ac.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'aborted' });
    release();
  });

  it('rule 6: the memory-fallback kind is reported by open()', async () => {
    const r = rig({ kind: 'memory-fallback' });
    expect(await r.store.open()).toBe('memory-fallback');
  });

  it('rule 7: a read-only store reads and fetches but never writes, deletes or sweeps', async () => {
    const w = rig();
    const p = await makePack(80, 4 * KB);
    const q = await makePack(81, 4 * KB);
    w.fetcher.add(p);
    w.fetcher.add(q);
    await w.store.open();
    await w.store.get(p.ref);
    await w.files.write('f'.repeat(64), new Uint8Array([1])); // another tab's write in flight: no row yet

    const ro = w.make({ writable: () => false });
    await ro.open();
    expect(w.files.files.has('f'.repeat(64))).toBe(true);
    expect(new Uint8Array(await ro.get(p.ref))).toEqual(p.bytes);
    expect(new Uint8Array(await ro.get(q.ref))).toEqual(q.bytes);
    expect(w.index.rows.has(q.ref.sha256)).toBe(false);
    expect(await ro.evictByTag('x')).toEqual({ removed: 0 });
  });

  it('open() drops a row whose file is missing and clears stale pins', async () => {
    const r = rig();
    const p = await makePack(90, 4 * KB);
    const q = await makePack(91, 4 * KB);
    r.fetcher.add(p);
    r.fetcher.add(q);
    await r.store.open();
    await r.store.get(p.ref);
    await r.store.get(q.ref);
    r.store.pin([q.ref.sha256]);
    await r.store.settled();
    expect(r.index.rows.get(q.ref.sha256)?.pinned).toBe(true);
    r.files.files.delete(p.ref.sha256);
    const next = r.make();
    await next.open();
    expect(r.index.rows.has(p.ref.sha256)).toBe(false);
    expect(r.index.rows.get(q.ref.sha256)?.pinned).toBe(false);
  });

  it('usage() reports pack counts and sizes from the rows and the quota estimate', async () => {
    const r = rig({ estimate: () => Promise.resolve({ usage: 10 * 1024 * 1024, quota: 100 * 1024 * 1024 }), persisted: () => Promise.resolve(true) });
    const p = await makePack(95, 512 * KB);
    r.fetcher.add(p);
    await r.store.open();
    await r.store.get(p.ref);
    const u = await r.store.usage();
    expect(u).toMatchObject({ packs: 1, usageMB: 10, quotaMB: 100, persisted: true, cutscenesMB: 0 });
    expect(u.packsMB).toBeCloseTo(0.5, 6);
    await r.store.clear();
    expect((await r.store.usage()).packs).toBe(0);
    expect(r.files.files.size).toBe(0);
  });
});

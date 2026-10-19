import { describe, expect, it } from 'vitest';
import { SaveKilled, SaveServiceImpl, MemoryStore } from '../../src/sim/save/index.ts';
import { clock, mkProfile, openSvc, padded } from './helpers.ts';

const throwingFactory = {
  open() {
    throw new Error('SecurityError: IndexedDB is disabled');
  },
} as unknown as IDBFactory;

const erroringFactory = {
  open() {
    const req: { onerror?: () => void; error: Error } = { error: new Error('UnknownError') };
    queueMicrotask(() => req.onerror?.());
    return req;
  },
} as unknown as IDBFactory;

describe('engine/save.memory (IDB_UNAVAILABLE path)', () => {
  it.each([
    ['open throws', throwingFactory],
    ['open fires an error event', erroringFactory],
    ['no IndexedDB at all', null],
  ])('%s: the service runs on the memory store and reports persistent = false', async (_name, indexedDB) => {
    const svc = await SaveServiceImpl.open({ indexedDB, capability: 'sandbox', now: clock().now });
    expect(svc.persistent).toBe(false);
    const p = await mkProfile(svc);
    expect(await svc.write('sandbox', { toggles: { n: 1 } }, 'manual')).toMatchObject({ ok: true, gen: 1 });
    expect(((await svc.load(p.id)).sandbox as unknown as { toggles: { n: number } }).toggles.n).toBe(1);
  });

  it('rules 1 to 3 hold on the memory store: kill, fallback, caps and capabilities', async () => {
    const store = new MemoryStore();
    expect(store.persistent).toBe(false);
    const clk = clock();
    const a = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const p = await mkProfile(a);
    await a.write('sandbox', { toggles: { n: 1 } }, 'manual');

    // Rule 1: a write killed after step (c) leaves gen 1 current.
    const k = await openSvc(store, { capability: 'sandbox', now: clk.now, onStep: (s) => { if (s === 'c') throw new SaveKilled(s); } });
    await k.load(p.id);
    await expect(k.write('sandbox', { toggles: { n: 2 } }, 'manual')).rejects.toBeInstanceOf(SaveKilled);
    const after = await openSvc(store, { capability: 'sandbox', now: clk.now });
    expect(((await after.load(p.id)).sandbox as unknown as { toggles: { n: number } }).toggles.n).toBe(1);

    // Rule 2: a corrupted pointer record falls back.
    await after.write('sandbox', { toggles: { n: 2 } }, 'manual');
    const rec = (await store.getRecord(p.id, 'sandbox', 2))!;
    await store.deleteRecord(p.id, 'sandbox', 2);
    await store.addRecord({ ...rec, checksum: '0'.repeat(16) });
    const g = await (await openSvc(store, { now: clk.now })).load(p.id);
    expect((g.sandbox as unknown as { toggles: { n: number } }).toggles.n).toBe(1);
    expect(g.profile.lastSave?.error).toBe('CHECKSUM');

    // Rule 3 and the caps.
    expect(await after.write('core', { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
    expect(await after.write('mod:big', padded(2 * 1024 * 1024 + 1), 'manual')).toMatchObject({ ok: false, error: 'TOO_LARGE' });
  });
});

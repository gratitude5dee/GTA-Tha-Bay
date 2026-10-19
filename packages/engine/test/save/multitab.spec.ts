import { describe, expect, it } from 'vitest';
import type { LastSaveStatus } from '@dv/shared';
import { clock, mkProfile, newStore, openSvc, type StoreKind } from './helpers.ts';

describe.each<StoreKind>(['memory', 'idb'])('engine/save.multitab (%s store)', (kind) => {
  it('two services writing the same slot: one wins, the other gets CONFLICT, goes read-only and reports it', async () => {
    const store = await newStore(kind);
    const a = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(a);
    const b = await openSvc(store, { capability: 'sandbox', now: clock().now });
    await b.load(p.id);
    const seenB: LastSaveStatus[] = [];
    b.onStatus((_id, s) => seenB.push(s));

    expect(await a.write('sandbox', { toggles: { by: 'a' } }, 'manual')).toMatchObject({ ok: true, gen: 1 });
    expect(await b.write('sandbox', { toggles: { by: 'b' } }, 'manual')).toMatchObject({ ok: false, error: 'CONFLICT' });
    expect(b.readOnly).toBe('conflict');
    expect(seenB).toMatchObject([{ slot: 'sandbox', ok: false, error: 'CONFLICT' }]);
    // Read-only now: even a slot nobody else touched is refused.
    expect(await b.write('settings', { language: 'en' }, 'manual')).toMatchObject({ ok: false, error: 'CONFLICT' });
    expect(a.readOnly).toBeNull();
    expect(await a.write('sandbox', { toggles: { by: 'a2' } }, 'manual')).toMatchObject({ ok: true, gen: 2 });
    expect(((await a.load(p.id)).sandbox as unknown as { toggles: { by: string } }).toggles.by).toBe('a2');
  });

  it('writes started at the same moment: exactly one succeeds', async () => {
    const store = await newStore(kind);
    const a = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(a);
    const b = await openSvc(store, { capability: 'sandbox', now: clock().now });
    await b.load(p.id);
    const results = await Promise.all([a.write('sandbox', { toggles: { by: 'a' } }, 'manual'), b.write('sandbox', { toggles: { by: 'b' } }, 'manual')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const lost = results.find((r) => !r.ok);
    expect(lost).toMatchObject({ ok: false, error: 'CONFLICT' });
    expect((await store.getPointer(p.id, 'sandbox'))?.gen).toBe(1);
  });

  it('a tab that loads again after losing becomes writable and sees the winner', async () => {
    const store = await newStore(kind);
    const a = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(a);
    const b = await openSvc(store, { capability: 'sandbox', now: clock().now });
    await b.load(p.id);
    await a.write('sandbox', { toggles: { by: 'a' } }, 'manual');
    await b.write('sandbox', { toggles: { by: 'b' } }, 'manual');
    expect(b.readOnly).toBe('conflict');
    const g = await b.load(p.id);
    expect(b.readOnly).toBeNull();
    expect((g.sandbox as unknown as { toggles: { by: string } }).toggles.by).toBe('a');
    expect(await b.write('sandbox', { toggles: { by: 'b' } }, 'manual')).toMatchObject({ ok: true, gen: 2 });
  });

  it('serial writes from one service never conflict with themselves', async () => {
    const store = await newStore(kind);
    const a = await openSvc(store, { capability: 'sandbox', now: clock().now });
    await mkProfile(a);
    const rs = await Promise.all([1, 2, 3, 4, 5].map((n) => a.write('sandbox', { toggles: { n } }, 'manual')));
    expect(rs.map((r) => (r.ok ? r.gen : 0))).toEqual([1, 2, 3, 4, 5]);
    expect(a.readOnly).toBeNull();
  });
});

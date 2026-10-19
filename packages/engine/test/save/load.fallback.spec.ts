import { describe, expect, it } from 'vitest';
import { clock, mkProfile, newStore, openSvc, replaceRecord, snapshot, type StoreKind } from './helpers.ts';

const slice = (n: number): Record<string, unknown> => ({ toggles: { n }, savedPositions: [], clock: { hour: 9, paused: false, syncSystemTime: false }, weather: 'clear', presets: [] });

describe.each<StoreKind>(['memory', 'idb'])('engine/save.loadFallback (%s store)', (kind) => {
  it('a corrupted current generation loads the previous one, reports CHECKSUM and leaves the stored records untouched', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    await svc.write('sandbox', slice(1), 'manual');
    await svc.write('sandbox', slice(2), 'manual');

    const rec = await store.getRecord(p.id, 'sandbox', 2);
    if (!rec) throw new Error('missing record');
    await replaceRecord(store, { ...rec, data: { ...(rec.data as object), weather: 'rain' } }); // checksum no longer matches
    const before = await snapshot(store, p.id);

    const reader = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const statuses: string[] = [];
    reader.onStatus((_id, s) => statuses.push(`${s.slot}:${s.error}`));
    const game = await reader.load(p.id);

    expect((game.sandbox as { toggles: Record<string, number> }).toggles['n']).toBe(1);
    expect(game.profile.lastSave).toMatchObject({ slot: 'sandbox', ok: false, error: 'CHECKSUM' });
    expect(statuses).toEqual(['sandbox:CHECKSUM']);
    expect(await snapshot(store, p.id)).toBe(before); // byte for byte
    expect((await reader.describeSlot(p.id, 'sandbox'))?.gen).toBe(1);
  });

  it('a pointer whose record is missing falls back too, and with no readable generation the slot reads as absent', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    await svc.write('sandbox', slice(1), 'manual');
    await svc.write('sandbox', slice(2), 'manual');
    await store.deleteRecord(p.id, 'sandbox', 2);
    const g1 = await (await openSvc(store, { now: clock().now })).load(p.id);
    expect((g1.sandbox as { toggles: Record<string, number> }).toggles['n']).toBe(1);
    await store.deleteRecord(p.id, 'sandbox', 1);
    const g0 = await (await openSvc(store, { now: clock().now })).load(p.id);
    expect(g0.sandbox).toBeNull();
    expect(g0.profile.lastSave?.error).toBe('CHECKSUM');
  });

  it('an unwritten profile loads defaults', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store);
    const p = await mkProfile(svc);
    const g = await svc.load(p.id);
    expect(g.version).toBe(1);
    expect(g.core.unlocks).toEqual([]);
    expect(g.settings.language).toBe('en');
    expect(g.story).toEqual({});
    expect(g.modes).toEqual({ racing: null, fighter: null, tycoon: null });
  });
});

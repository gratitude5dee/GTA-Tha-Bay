import { describe, expect, it } from 'vitest';
import { SAVE_LIMITS } from '@dv/shared';
import { sandboxData, T0, clock, mkProfile, newStore, openSvc, type StoreKind } from './helpers.ts';

const DAY = 86_400_000;

describe.each<StoreKind>(['memory', 'idb'])('engine/save.tombstone (%s store)', (kind) => {
  it('a deleted slot stays deleted when an import brings an older record', async () => {
    const store = await newStore(kind);
    const clk = clock();
    const svc = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const other = await mkProfile(svc, 'Other');
    await svc.write('sandbox', sandboxData(1), 'manual'); // saved at T0
    const file = await svc.exportProfile(other.id);

    clk.advance(1000);
    const target = await mkProfile(svc, 'Target');
    await svc.write('sandbox', sandboxData(2), 'manual');
    clk.advance(1000);
    expect(await svc.deleteSlot(target.id, 'sandbox')).toMatchObject({ ok: true });
    const tombs = await svc.listTombstones(target.id);
    expect(tombs).toHaveLength(1);
    expect(tombs[0]).toMatchObject({ slot: 'sandbox', gen: 1 });
    expect(await store.getPointer(target.id, 'sandbox')).toBeNull();
    expect(await store.listRecords(target.id)).toEqual([]);

    expect(await svc.importProfile(file, 'replace', target.id)).toMatchObject({ ok: true });
    expect(svc.lastImport?.skipped).toEqual(['sandbox']);
    expect(await store.getPointer(target.id, 'sandbox')).toBeNull();
    expect((await svc.load(target.id)).sandbox).toBeNull();
  });

  it('a write after the delete is a new life of the slot, with a generation above the retired one', async () => {
    const store = await newStore(kind);
    const clk = clock();
    const svc = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const p = await mkProfile(svc);
    await svc.write('sandbox', { toggles: { n: 1 } }, 'manual');
    await svc.write('sandbox', { toggles: { n: 2 } }, 'manual');
    await svc.deleteSlot(p.id, 'sandbox');
    clk.advance(10);
    expect(await svc.write('sandbox', { toggles: { n: 3 } }, 'manual')).toMatchObject({ ok: true, gen: 3 });
    expect(((await svc.load(p.id)).sandbox as unknown as { toggles: { n: number } }).toggles.n).toBe(3);
  });

  it('tombstones older than 180 days are purged only when marked synced', async () => {
    const store = await newStore(kind);
    const clk = clock();
    const svc = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const p = await mkProfile(svc);
    await svc.write('sandbox', { toggles: {} }, 'manual');
    await svc.deleteSlot(p.id, 'sandbox');
    const [t] = await svc.listTombstones(p.id);
    const later = T0 + (SAVE_LIMITS.tombstoneRetentionDays + 1) * DAY;

    expect(await svc.purgeTombstones(p.id, later)).toBe(0); // old, not synced
    await svc.markTombstonesSynced(p.id, t!.deletedAt);
    expect(await svc.purgeTombstones(p.id, T0 + 179 * DAY)).toBe(0); // synced, not old enough
    expect(await svc.purgeTombstones(p.id, later)).toBe(1);
    expect(await svc.listTombstones(p.id)).toEqual([]);
  });

  it('a tombstone newer than the synced mark survives the purge', async () => {
    const store = await newStore(kind);
    const clk = clock();
    const svc = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const p = await mkProfile(svc);
    await svc.write('sandbox', { toggles: {} }, 'manual');
    await svc.deleteSlot(p.id, 'sandbox');
    const [t] = await svc.listTombstones(p.id);
    await svc.markTombstonesSynced(p.id, t!.deletedAt - 1);
    expect(await svc.purgeTombstones(p.id, T0 + 400 * DAY)).toBe(0);
  });

  it('deleting a profile writes a profile tombstone and removes its data', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store, { capability: 'sandbox' });
    const p = await mkProfile(svc);
    await svc.write('sandbox', { toggles: {} }, 'manual');
    expect(await svc.deleteProfile(p.id)).toMatchObject({ ok: true });
    expect(await svc.listProfiles()).toEqual([]);
    expect(await store.listRecords(p.id)).toEqual([]);
    expect(await svc.listTombstones(p.id)).toMatchObject([{ slot: '*', gen: 1 }]);
    expect(svc.activeProfile).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { sandboxData as sb, clock, mkProfile, newStore, openSvc, snapshot, type StoreKind } from './helpers.ts';


describe.each<StoreKind>(['memory', 'idb'])('engine/save.importUndo (%s store)', (kind) => {
  it('asNew copies the slot data, replace moves the pointers and records undoGen, undo restores exactly', async () => {
    const store = await newStore(kind);
    const clk = clock();
    const svc = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const src = await mkProfile(svc, 'Source');
    await svc.write('sandbox', sb(1), 'manual');
    await svc.write('sandbox', sb(2), 'manual');
    await svc.write('mod:x', { v: 1 }, 'manual');
    clk.advance(5);
    const file = await svc.exportProfile(src.id);

    // asNew: a new profile with equal slot data.
    const asNew = await svc.importProfile(file, 'asNew');
    expect(asNew).toMatchObject({ ok: true, gen: 2 });
    const created = svc.lastImport!.profileId;
    expect(created).not.toBe(src.id);
    const names = (await svc.listProfiles()).map((p) => p.name);
    expect(names).toEqual(['Source', 'Source (2)']);
    const a = await svc.load(created);
    const s = await svc.load(src.id);
    expect(a.sandbox).toEqual(s.sandbox);
    expect(a.mods).toEqual(s.mods);

    // replace into another profile that has its own data.
    const dst = await mkProfile(svc, 'Dest');
    await svc.write('sandbox', sb(100), 'manual');
    await svc.write('sandbox', sb(101), 'manual'); // gen 2
    await svc.write('settings', { language: 'fr' }, 'manual'); // not in the file: must not change
    const before = await snapshot(store, dst.id);

    expect(await svc.importProfile(file, 'replace', dst.id)).toMatchObject({ ok: true });
    const profile = (await svc.listProfiles()).find((p) => p.id === dst.id)!;
    expect(profile.importedFrom?.undoGen).toEqual({ sandbox: 2, 'mod:x': 0 });
    expect(await store.getPointer(dst.id, 'sandbox')).toMatchObject({ gen: 3 });
    expect(await store.getPointer(dst.id, 'mod:x')).toMatchObject({ gen: 1 });
    const g = await svc.load(dst.id);
    expect((g.sandbox as unknown as { toggles: { n: number } }).toggles.n).toBe(2);
    expect(g.mods['x']).toEqual({ v: 1 });
    expect((await store.getPointer(dst.id, 'settings'))?.gen).toBe(1);

    // undo restores the previous generations exactly.
    expect(await svc.undoImport(dst.id)).toMatchObject({ ok: true });
    expect(await snapshot(store, dst.id)).toBe(before);
    expect((await svc.listProfiles()).find((p) => p.id === dst.id)?.importedFrom).toBeUndefined();
    expect(await svc.undoImport(dst.id)).toMatchObject({ ok: false, error: 'INVALID' });
  });

  it('a record that fails its schema rejects the whole import with INVALID', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store, { capability: 'story', now: clock().now });
    const p = await mkProfile(svc);
    await svc.write('core', { avatar: {}, unlocks: ['unlock.racing'], firstEncounters: {}, garage: [], inventory: { items: [], wardrobe: [] }, stats: { distanceKm: 0, pursuitsEscaped: 0, busted: 0, fightsWon: 0, racesWon: 0, playtimeSec: 0 } }, 'manual');
    await svc.write('story:1', { whatever: true }, 'manual'); // writes are not schema-checked; imports are
    const file = JSON.parse(await (await svc.exportProfile(p.id)).text()) as { records: { slot: string }[] };
    const target = await mkProfile(svc, 'Target');
    const before = await snapshot(store, target.id);
    const res = await svc.importProfile(new Blob([JSON.stringify(file)]), 'replace', target.id);
    expect(res).toMatchObject({ ok: false, error: 'INVALID' });
    expect(await snapshot(store, target.id)).toBe(before);
    expect((await svc.listProfiles()).length).toBe(2);
    expect(await svc.importProfile(new Blob([JSON.stringify(file)]), 'asNew')).toMatchObject({ ok: false, error: 'INVALID' });
    expect((await svc.listProfiles()).length).toBe(2);
  });

  it('rejects non-JSON, a wrong format, a tampered checksum and a replace without a target', async () => {
    const svc = await openSvc(await newStore(kind), { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    await svc.write('sandbox', sb(1), 'manual');
    expect(await svc.importProfile(new Blob(['not json']), 'asNew')).toMatchObject({ ok: false, error: 'INVALID' });
    expect(await svc.importProfile(new Blob(['{"format":"zip"}']), 'asNew')).toMatchObject({ ok: false, error: 'INVALID' });
    const file = JSON.parse(await (await svc.exportProfile(p.id)).text()) as { records: { data: { toggles: { n: number } } }[] };
    file.records[0]!.data.toggles.n = 99;
    expect(await svc.importProfile(new Blob([JSON.stringify(file)]), 'asNew')).toMatchObject({ ok: false, error: 'INVALID' });
    const ok = await svc.exportProfile(p.id);
    expect(await svc.importProfile(ok, 'replace')).toMatchObject({ ok: false, error: 'INVALID' });
    expect(await svc.importProfile(ok, 'replace', '1'.repeat(32) as never)).toMatchObject({ ok: false, error: 'INVALID' });
  });

  it('the exported file lists records, tombstones and only intact records', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    await svc.write('sandbox', sb(1), 'manual');
    await svc.write('mod:a', { v: 1 }, 'manual');
    await svc.deleteSlot(p.id, 'mod:a');
    const file = JSON.parse(await (await svc.exportProfile(p.id)).text()) as { format: string; records: { slot: string }[]; tombstones: { slot: string }[] };
    expect(file.format).toBe('dvsave');
    expect(file.records.map((r) => r.slot)).toEqual(['sandbox']);
    expect(file.tombstones.map((t) => t.slot)).toEqual(['mod:a']);
  });
});

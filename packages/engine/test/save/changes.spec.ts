import { describe, expect, it } from 'vitest';
import { clock, mkProfile, newStore, openSvc, type StoreKind } from './helpers.ts';

describe.each<StoreKind>(['memory', 'idb'])('engine/save.changes (%s store)', (kind) => {
  it('changesSince returns current records and tombstones after the cursor and advances it', async () => {
    const clk = clock();
    const svc = await openSvc(await newStore(kind), { capability: 'sandbox', now: clk.now });
    const p = await mkProfile(svc);

    const none = await svc.changesSince(p.id, 0);
    expect(none).toEqual({ records: [], tombstones: [], cursor: 0 });

    await svc.write('sandbox', { toggles: { n: 1 } }, 'manual');
    await svc.write('sandbox', { toggles: { n: 2 } }, 'manual');
    await svc.write('mod:a', { v: 1 }, 'manual');
    const first = await svc.changesSince(p.id, 0);
    expect(first.records.map((r) => `${r.slot}@${r.gen}`)).toEqual(['sandbox@2', 'mod:a@1']);
    expect(first.tombstones).toEqual([]);
    expect(first.cursor).toBeGreaterThan(0);

    const again = await svc.changesSince(p.id, first.cursor);
    expect(again).toEqual({ records: [], tombstones: [], cursor: first.cursor });

    clk.advance(10);
    await svc.write('sandbox', { toggles: { n: 3 } }, 'manual');
    await svc.deleteSlot(p.id, 'mod:a');
    const next = await svc.changesSince(p.id, first.cursor);
    expect(next.records.map((r) => `${r.slot}@${r.gen}`)).toEqual(['sandbox@3']);
    expect(next.tombstones).toMatchObject([{ slot: 'mod:a', gen: 1 }]);
    expect(next.cursor).toBeGreaterThan(first.cursor);
  });

  it('two writes in the same millisecond are still told apart by the cursor', async () => {
    const svc = await openSvc(await newStore(kind), { capability: 'sandbox', now: () => 5000 });
    const p = await mkProfile(svc);
    await svc.write('sandbox', { toggles: { n: 1 } }, 'manual');
    const c1 = (await svc.changesSince(p.id, 0)).cursor;
    await svc.write('mod:a', { v: 1 }, 'manual');
    const d = await svc.changesSince(p.id, c1);
    expect(d.records.map((r) => r.slot)).toEqual(['mod:a']);
  });
});

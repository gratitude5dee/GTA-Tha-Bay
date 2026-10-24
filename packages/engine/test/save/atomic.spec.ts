import { describe, expect, it } from 'vitest';
import { SAVE_LIMITS, type SandboxSlice } from '@dv/shared';
import { SaveKilled, type WriteStep } from '../../src/sim/save/index.ts';
import { clock, mkProfile, newStore, openSvc, type StoreKind } from './helpers.ts';

const STEPS: WriteStep[] = ['a', 'b', 'c', 'd', 'e', 'f'];
const slice = (n: number): Record<string, unknown> => ({ toggles: { n }, savedPositions: [], clock: { hour: 9, paused: false, syncSystemTime: false }, weather: 'clear', presets: [] });

describe.each<StoreKind>(['memory', 'idb'])('engine/save.atomic (%s store)', (kind) => {
  it.each(STEPS)('a write interrupted after step (%s) leaves the last good generation loadable', async (step) => {
    const store = await newStore(kind);
    const clk = clock();
    const a = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const p = await mkProfile(a);
    expect((await a.write('sandbox', slice(1), 'manual')).ok).toBe(true);
    expect((await a.write('sandbox', slice(2), 'manual')).ok).toBe(true);

    const b = await openSvc(store, {
      capability: 'sandbox',
      now: clk.now,
      onStep: (s) => {
        if (s === step) throw new SaveKilled(s);
      },
    });
    await b.load(p.id);
    await expect(b.write('sandbox', slice(3), 'manual')).rejects.toBeInstanceOf(SaveKilled);

    // The next boot (a new service) sweeps orphans and loads.
    const c = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const game = await c.load(p.id);
    const reachedPointer = step === 'e' || step === 'f';
    expect((game.sandbox as SandboxSlice).toggles['n']).toBe(reachedPointer ? 3 : 2);
    const info = await c.describeSlot(p.id, 'sandbox');
    expect(info?.gen).toBe(reachedPointer ? 3 : 2);
    expect(game.profile.lastSave?.error).toBeUndefined();

    const records = (await store.listRecords(p.id)).filter((r) => r.slot === 'sandbox');
    expect(records.length).toBeLessThanOrEqual(SAVE_LIMITS.keepGenerations);
    expect(Math.max(...records.map((r) => r.gen))).toBe(reachedPointer ? 3 : 2);
  });

  // BD-FIX-CI6-B02: the page's SaveService (or a second tab) opening sweeps orphans while the sim worker writes. A record put at (c)
  // is an orphan until (e) moves the pointer; the sweep must not leave the pointer on a record it deleted.
  it.each<WriteStep>(['c', 'd'])('another service opening after step (%s) of a write does not lose the written record', async (step) => {
    const store = await newStore(kind);
    const clk = clock();
    const a = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const p = await mkProfile(a);
    expect((await a.write('sandbox', slice(1), 'manual')).ok).toBe(true);
    expect((await a.write('sandbox', slice(2), 'manual')).ok).toBe(true);

    let swept = false;
    const b = await openSvc(store, {
      capability: 'sandbox',
      now: clk.now,
      onStep: async (s) => {
        if (s !== step || swept) return;
        swept = true;
        // The sweep of the other service's open sees generation 3 with the pointer still on 2, and deletes it.
        await openSvc(store, { capability: 'sandbox', now: clk.now });
        expect((await store.listRecords(p.id)).filter((r) => r.slot === 'sandbox').map((r) => r.gen)).not.toContain(3);
      },
    });
    await b.load(p.id);
    expect(await b.write('sandbox', slice(3), 'settings')).toMatchObject({ ok: true, gen: 3 });
    expect(swept).toBe(true);

    const c = await openSvc(store, { capability: 'sandbox', now: clk.now });
    const game = await c.load(p.id);
    expect((game.sandbox as SandboxSlice).toggles['n']).toBe(3);
    expect(game.profile.lastSave).toMatchObject({ slot: 'sandbox', ok: true, reason: 'settings' });
    expect((await c.describeSlot(p.id, 'sandbox'))?.gen).toBe(3);
  });

  it('a clean write moves the pointer, keeps two generations and reports ok through onStatus', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    const seen: string[] = [];
    svc.onStatus((id, s) => seen.push(`${id === p.id}:${s.slot}:${s.ok}:${s.reason}`));
    for (let i = 1; i <= 4; i++) expect(await svc.write('sandbox', slice(i), 'manual')).toMatchObject({ ok: true, gen: i });
    expect((await store.listRecords(p.id)).map((r) => r.gen).sort()).toEqual([3, 4]);
    expect(seen).toEqual(Array(4).fill('true:sandbox:true:manual'));
    expect((await svc.listProfiles())[0]?.lastSave).toMatchObject({ slot: 'sandbox', ok: true });
  });

  it('data with NaN, undefined or functions is rejected as INVALID and nothing is stored', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store, { capability: 'sandbox' });
    const p = await mkProfile(svc);
    expect(await svc.write('sandbox', { a: Number.NaN }, 'manual')).toMatchObject({ ok: false, error: 'INVALID' });
    expect(await svc.write('sandbox', { a: undefined }, 'manual')).toMatchObject({ ok: false, error: 'INVALID' });
    expect(await svc.write('sandbox', [1], 'manual')).toMatchObject({ ok: false, error: 'INVALID' });
    expect(await store.listRecords(p.id)).toEqual([]);
  });
});

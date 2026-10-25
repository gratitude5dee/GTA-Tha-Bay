import { describe, expect, it } from 'vitest';
import { SAVE_LIMITS } from '@dv/shared';
import { SaveStoreError, type SaveStore } from '../../src/sim/save/index.ts';
import { mkProfile, newStore, openSvc, padded, type StoreKind } from './helpers.ts';

describe.each<StoreKind>(['memory', 'idb'])('engine/save.caps (%s store)', (kind) => {
  it('2 MiB + 1 B, a profile above 16 MiB, a 65th profile and a case-only duplicate name are refused and store nothing', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store, { capability: 'sandbox' });
    const p = await mkProfile(svc);

    // The exact cap passes, one byte more does not.
    expect(await svc.write('mod:a', padded(SAVE_LIMITS.recordMaxBytes + 1), 'manual')).toMatchObject({ ok: false, error: 'TOO_LARGE' });
    expect(await store.listRecords(p.id)).toEqual([]);

    // Eight records of exactly 2 MiB fill the profile; the ninth is refused and not stored.
    for (const k of 'abcdefgh') expect(await svc.write(`mod:${k}`, padded(SAVE_LIMITS.recordMaxBytes), 'manual')).toMatchObject({ ok: true, bytes: SAVE_LIMITS.recordMaxBytes });
    expect(await svc.write('mod:i', { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'TOO_LARGE' });
    expect(await store.getPointer(p.id, 'mod:i')).toBeNull();
    expect((await store.listRecords(p.id)).length).toBe(8);
    // Rewriting an existing slot replaces its share of the total, so it still fits.
    expect(await svc.write('mod:a', { small: true }, 'manual')).toMatchObject({ ok: true });
  });

  it('refuses the 65th profile and a duplicate name differing only in case', async () => {
    const store = await newStore(kind);
    const svc = await openSvc(store);
    for (let i = 1; i <= SAVE_LIMITS.maxProfiles; i++) {
      const r = await svc.createProfile(`Profile ${i}`);
      expect('id' in r).toBe(true);
    }
    expect(await svc.createProfile('One more')).toMatchObject({ ok: false, error: 'PROFILE_LIMIT' });
    expect(await svc.createProfile('PROFILE 1')).toMatchObject({ ok: false, error: 'PROFILE_LIMIT' });
    expect((await svc.listProfiles()).length).toBe(64);

    const store2 = await newStore(kind);
    const s2 = await openSvc(store2);
    expect('id' in (await s2.createProfile('Coast'))).toBe(true);
    expect(await s2.createProfile('cOAST')).toMatchObject({ ok: false, error: 'NAME_TAKEN' });
    expect(await s2.createProfile('  coast ')).toMatchObject({ ok: false, error: 'NAME_TAKEN' });
    expect((await s2.listProfiles()).length).toBe(1);
  });
});

describe('engine/save.caps quota', () => {
  it('maps a QuotaExceededError from the store to QUOTA', async () => {
    const store = await newStore('memory');
    const failing: SaveStore = new Proxy(store, {
      get(target, prop, recv) {
        if (prop === 'addRecord') return () => Promise.reject(new SaveStoreError('quota', true));
        return Reflect.get(target, prop, recv) as unknown;
      },
    });
    const svc = await openSvc(failing, { capability: 'sandbox' });
    await mkProfile(svc);
    expect(await svc.write('sandbox', { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'QUOTA' });
  });
});

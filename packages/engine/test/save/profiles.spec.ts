import { describe, expect, it } from 'vitest';
import { normalizeName, uniqueName, randomHex32 } from '../../src/sim/save/profiles.ts';
import { newStore, openSvc, type StoreKind } from './helpers.ts';

describe('engine/save.profiles helpers', () => {
  it('names are NFC, trimmed and 1 to 80 characters', () => {
    expect(normalizeName('  Café  ')).toBe('Café');
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName('a'.repeat(80))).toHaveLength(80);
    expect(normalizeName('a'.repeat(81))).toBeNull();
    expect(normalizeName('\u{1F600}'.repeat(80))).not.toBeNull();
  });

  it('ids are 32 lowercase hex', () => {
    for (let i = 0; i < 20; i++) expect(randomHex32()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('uniqueName appends a counter', () => {
    const p = (name: string) => ({ id: name as never, name, createdAt: 0, updatedAt: 0, playtimeSec: 0, lastSave: null, deviceId: '' });
    expect(uniqueName([p('Coast'), p('Coast (2)')], 'coast')).toBe('coast (3)');
  });
});

describe.each<StoreKind>(['memory', 'idb'])('engine/save.profiles (%s store)', (kind) => {
  it('creates, lists, renames and deletes profiles', async () => {
    const svc = await openSvc(await newStore(kind));
    const a = await svc.createProfile('Alpha');
    const b = await svc.createProfile('Beta');
    if (!('id' in a) || !('id' in b)) throw new Error('create failed');
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
    expect(a.deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.deviceId).toBe(svc.deviceId);
    expect((await svc.listProfiles()).map((p) => p.name)).toEqual(['Alpha', 'Beta']);

    expect(await svc.renameProfile(b.id, 'alpha')).toMatchObject({ ok: false, error: 'NAME_TAKEN' });
    expect(await svc.renameProfile(a.id, 'ALPHA')).toMatchObject({ ok: true }); // own name, other case
    expect(await svc.renameProfile(b.id, '')).toMatchObject({ ok: false, error: 'INVALID' });
    expect(await svc.renameProfile(b.id, 'Gamma')).toMatchObject({ ok: true });
    expect((await svc.listProfiles()).map((p) => p.name)).toEqual(['ALPHA', 'Gamma']);

    expect(await svc.deleteProfile(a.id)).toMatchObject({ ok: true });
    expect((await svc.listProfiles()).map((p) => p.name)).toEqual(['Gamma']);
    expect(await svc.deleteProfile(a.id)).toMatchObject({ ok: false, error: 'INVALID' });
  });

  it('the device id is stable across service instances on one database', async () => {
    const store = await newStore(kind);
    const a = await openSvc(store);
    const b = await openSvc(store);
    expect(a.deviceId).toBe(b.deviceId);
  });

  it('profiles written by one service are visible to the next', async () => {
    const store = await newStore(kind);
    await (await openSvc(store)).createProfile('Persisted');
    expect((await (await openSvc(store)).listProfiles()).map((p) => p.name)).toEqual(['Persisted']);
  });

  it('loading an unknown profile throws', async () => {
    const svc = await openSvc(await newStore(kind));
    await expect(svc.load('0'.repeat(32) as never)).rejects.toThrow(/no profile/);
  });
});

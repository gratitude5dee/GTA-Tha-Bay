import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { LocalIdentity, idbStore, thumbprint, uuid7, DB_NAME, STORE_NAME, RECORD_KEY, type StoredIdentity } from '../src/index.ts';

const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function rawStored(factory: IDBFactory): Promise<StoredIdentity | undefined> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY);
      get.onsuccess = () => resolve(get.result as StoredIdentity | undefined);
      get.onerror = () => reject(get.error);
    };
  });
}

describe('LocalIdentity', () => {
  it('AC-1: mints once, persists, stores a non-extractable key, tier local', async () => {
    const factory = new IDBFactory();
    const first = await LocalIdentity.open({ store: idbStore(factory) });
    const a = first.current();
    expect(a.profileId).toMatch(UUID7);
    expect(a.tier).toBe('local');
    expect(a.providers).toEqual([]);
    expect(a.ageBracket).toBeNull();
    const second = await LocalIdentity.open({ store: idbStore(factory) });
    const b = second.current();
    expect(b.profileId).toBe(a.profileId);
    expect(b.deviceKeyThumbprint).toBe(a.deviceKeyThumbprint);
    const rec = await rawStored(factory);
    expect(rec?.privateKey.extractable).toBe(false);
    expect(rec?.privateKey.type).toBe('private');
    // Only the public JWK is stored: no private member.
    expect(JSON.stringify(rec?.publicJwk)).not.toContain('"d"');
    expect(rec?.thumbprint).toBe(a.deviceKeyThumbprint);
  });

  it('AC-3: attestAge persists the bracket, notifies, and makes no network call', async () => {
    const factory = new IDBFactory();
    const fetchSpy = vi.fn();
    const id = await LocalIdentity.open({ store: idbStore(factory), fetch: fetchSpy as unknown as typeof fetch });
    const seen: (string | null)[] = [];
    const off = id.onChange((s) => seen.push(s.ageBracket));
    const state = await id.attestAge('16_17');
    expect(state.ageBracket).toBe('16_17');
    expect(id.current().ageBracket).toBe('16_17');
    await expect(id.authHeader()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    await id.attestAge('18p');
    off();
    await id.attestAge('u13');
    expect(seen).toEqual(['16_17', '18p']);
    await id.attestAge('18p');
    const reopened = await LocalIdentity.open({ store: idbStore(factory) });
    expect(reopened.current().ageBracket).toBe('18p');
  });

  it('the not-yet adapters reject with not_available', async () => {
    const id = await LocalIdentity.open({ store: idbStore(new IDBFactory()) });
    await expect(id.register('t')).rejects.toThrow('not_available: lands in M12a1');
    await expect(id.link('openai')).rejects.toThrow(/^not_available: lands in M13c1$/);
    await expect(id.unlink('openai')).rejects.toThrow(/^not_available/);
    await expect(id.signInOnNewDevice('thirdweb')).rejects.toThrow(/^not_available: lands in M14a$/);
  });

  it('forget calls DELETE /api/v1/me once, ignores failure, and the next open mints a fresh identity', async () => {
    const factory = new IDBFactory();
    const fetchSpy = vi.fn().mockRejectedValue(new Error('offline'));
    const id = await LocalIdentity.open({ store: idbStore(factory), fetch: fetchSpy as unknown as typeof fetch });
    const before = id.current();
    await id.forget();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/v1/me');
    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
    const after = (await LocalIdentity.open({ store: idbStore(factory) })).current();
    expect(after.profileId).not.toBe(before.profileId);
    expect(after.deviceKeyThumbprint).not.toBe(before.deviceKeyThumbprint);
  });

  it('forget also tolerates a 404', async () => {
    const id = await LocalIdentity.open({
      store: idbStore(new IDBFactory()),
      fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 404 })) as unknown as typeof fetch,
    });
    await expect(id.forget()).resolves.toBeUndefined();
  });
});

describe('uuid7', () => {
  it('has version 7, variant 10 and a big-endian millisecond prefix', () => {
    const ms = 0x0198_1234_5678;
    const id = uuid7(ms);
    expect(id).toMatch(UUID7);
    expect(id.replace(/-/g, '').slice(0, 12)).toBe(ms.toString(16).padStart(12, '0'));
    expect(uuid7()).not.toBe(uuid7());
  });
});

describe('thumbprint', () => {
  const jwk = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' };

  it('AC-2: equals the base64url SHA-256 of the RFC 7638 string built independently; kid and use do not matter', async () => {
    const member = '{"crv":"P-256","kty":"EC","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}';
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(member).digest('base64url');
    expect(await thumbprint(jwk)).toBe(expected);
    expect(await thumbprint({ ...jwk, kid: 'a', use: 'sig', key_ops: ['verify'] })).toBe(expected);
  });

  it('refuses a JWK without the EC members', async () => {
    await expect(thumbprint({ kty: 'oct' })).rejects.toThrow();
  });
});

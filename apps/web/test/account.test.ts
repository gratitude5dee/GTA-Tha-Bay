import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { bracketFor, deleteConfirmed, fieldOrder, isValidBirthDate, parseField } from '../src/account/age.ts';
import { AGE_BLOCK_LOCAL_KEY, createAgeBlockStore } from '../src/account/age-block.ts';
import { createAccountApi, purgeLegacySession, REFRESH_LEAD_MS, refreshDelayMs, type ClientDeps, type SessionState } from '../src/account/api.ts';
import en from '../../../content/ui/i18n/en.json' with { type: 'json' };

const NOW = new Date(2026, 9, 19); // 2026-10-19 local

describe('age screen helpers', () => {
  it('computes brackets from a date of birth and keeps nothing else', () => {
    expect(bracketFor({ month: 10, day: 19, year: 2008 }, NOW)).toBe('18p');
    expect(bracketFor({ month: 10, day: 20, year: 2008 }, NOW)).toBe('16_17');
    expect(bracketFor({ month: 1, day: 1, year: 2011 }, NOW)).toBe('13_15');
    expect(bracketFor({ month: 1, day: 1, year: 2020 }, NOW)).toBe('u13');
    expect(bracketFor({ month: 6, day: 1, year: 1980 }, NOW)).toBe('18p');
  });

  it('rejects impossible, future and pre-1900 dates', () => {
    for (const d of [
      { month: 2, day: 30, year: 2000 },
      { month: 13, day: 1, year: 2000 },
      { month: 1, day: 1, year: 1899 },
      { month: 10, day: 20, year: 2026 },
      { month: Number.NaN, day: 1, year: 2000 },
    ]) {
      expect(isValidBirthDate(d, NOW)).toBe(false);
      expect(bracketFor(d, NOW)).toBeNull();
    }
    expect(isValidBirthDate({ month: 2, day: 29, year: 2000 }, NOW)).toBe(true);
    expect(isValidBirthDate({ month: 2, day: 29, year: 2001 }, NOW)).toBe(false);
  });

  it('orders the fields by locale and parses digits only', () => {
    expect(fieldOrder('en-US')).toEqual(['month', 'day', 'year']);
    expect(fieldOrder('de-DE')).toEqual(['day', 'month', 'year']);
    expect(fieldOrder('ja-JP')).toEqual(['year', 'month', 'day']);
    expect(parseField(' 12 ')).toBe(12);
    expect(Number.isNaN(parseField(''))).toBe(true);
    expect(Number.isNaN(parseField('1e3'))).toBe(true);
  });

  it('keeps the delete button disabled until the typed name matches', () => {
    expect(deleteConfirmed('', 'pilot')).toBe(false);
    expect(deleteConfirmed('pilo', 'pilot')).toBe(false);
    expect(deleteConfirmed(' Pilot ', 'pilot')).toBe(true);
    expect(deleteConfirmed('anything', '')).toBe(false);
  });
});

describe('under-18 flag', () => {
  it('writes localStorage dv-ui-ageBlocked and reads it back; a device with the flag sees no form', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const store = createAgeBlockStore(storage, null);
    expect(await store.isBlocked()).toBe(false);
    await store.block();
    expect(data.get(AGE_BLOCK_LOCAL_KEY)).toBe('1');
    expect(await createAgeBlockStore(storage, null).isBlocked()).toBe(true);
  });

  it('survives storage that throws on every access', async () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const idb = {
      open: () => {
        throw new Error('blocked');
      },
    } as unknown as IDBFactory;
    const store = createAgeBlockStore(broken, idb);
    await expect(store.block()).resolves.toBeUndefined();
    await expect(store.isBlocked()).resolves.toBe(false);
  });
});

function fakeDeps(handler: (path: string, init: RequestInit) => { status: number; body?: unknown }) {
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = [];
  const calls: { path: string; init: RequestInit }[] = [];
  const deps: ClientDeps = {
    fetch: async (input, init) => {
      const path = String(input);
      calls.push({ path, init: init ?? {} });
      const r = handler(path, init ?? {});
      return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status });
    },
    setTimeout: (fn, ms) => {
      const t = { fn, ms, id: timers.length + 1, live: true };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (id) => {
      const t = timers.find((x) => x.id === id);
      if (t) t.live = false;
    },
  };
  return { deps, timers, calls };
}

const SESSION_BODY = { user: { id: 'u1', username: 'pilot' }, session: { accessToken: 'at-1', expiresIn: 3600 } };

describe('account client', () => {
  it('keeps the token in memory only and schedules the refresh 60 s before expiry', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem, getItem: () => null, removeItem: () => undefined });
    vi.stubGlobal('sessionStorage', { setItem, getItem: () => null, removeItem: () => undefined });
    try {
      const { deps, timers } = fakeDeps(() => ({ status: 200, body: SESSION_BODY }));
      const seen: (SessionState | null)[] = [];
      const api = createAccountApi(deps, (s) => seen.push(s));
      const r = await api.login({ username: 'pilot', password: 'pw123456' });
      expect(r.ok).toBe(true);
      expect(api.session()?.accessToken).toBe('at-1');
      expect(setItem).not.toHaveBeenCalled();
      expect(timers.length).toBe(1);
      expect(timers[0]?.ms).toBe(3600 * 1000 - REFRESH_LEAD_MS);
      expect(refreshDelayMs(3600)).toBe(3_540_000);
      expect(refreshDelayMs(30)).toBe(5_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refreshes through the cookie when the timer fires and clears the session when that fails', async () => {
    let refreshOk = true;
    const { deps, timers, calls } = fakeDeps((path) => {
      if (path === '/api/v1/auth/refresh') return refreshOk ? { status: 200, body: { ...SESSION_BODY, session: { accessToken: 'at-2', expiresIn: 3600 } } } : { status: 401, body: { error: { code: 'unauthorized', message: 'x', requestId: 'r' } } };
      return { status: 200, body: SESSION_BODY };
    });
    const seen: (SessionState | null)[] = [];
    const api = createAccountApi(deps, (s) => seen.push(s));
    await api.login({ username: 'pilot', password: 'pw123456' });
    timers[0]?.fn();
    await vi.waitFor(() => expect(api.session()?.accessToken).toBe('at-2'));
    const refreshCall = calls.find((c) => c.path === '/api/v1/auth/refresh');
    expect(refreshCall?.init.method).toBe('POST');
    expect(refreshCall?.init.body).toBeUndefined(); // the refresh token is the cookie, never a body
    expect(refreshCall?.init.credentials).toBe('same-origin');
    refreshOk = false;
    timers[timers.length - 1]?.fn();
    await vi.waitFor(() => expect(api.session()).toBeNull());
    expect(seen.at(-1)).toBeNull();
  });

  it('retries a 401 from route 62 once after a refresh', async () => {
    let meCalls = 0;
    const { deps } = fakeDeps((path) => {
      if (path === '/api/v1/auth/me') {
        meCalls += 1;
        return meCalls === 1 ? { status: 401, body: { error: { code: 'unauthorized', message: 'x', requestId: 'r' } } } : { status: 200, body: { user: { id: 'u1', username: 'pilot' } } };
      }
      if (path === '/api/v1/auth/refresh') return { status: 200, body: { ...SESSION_BODY, session: { accessToken: 'at-2', expiresIn: 3600 } } };
      return { status: 200, body: SESSION_BODY };
    });
    const api = createAccountApi(deps, () => undefined);
    await api.login({ username: 'pilot', password: 'pw123456' });
    const me = await api.me();
    expect(me.ok).toBe(true);
    expect(meCalls).toBe(2);
  });

  it('surfaces terms_required details and error codes without echoing server text', async () => {
    const { deps } = fakeDeps(() => ({
      status: 403,
      body: { error: { code: 'forbidden', message: 'm', requestId: 'r', details: { reason: 'terms_required', termsVersion: 'interim-1' } } },
    }));
    const api = createAccountApi(deps, () => undefined);
    const r = await api.login({ username: 'pilot', password: 'pw123456' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.termsRequired).toEqual({ termsVersion: 'interim-1' });
      expect(r.code).toBe('forbidden');
    }
    expect(api.session()).toBeNull();
  });

  it('reports a network failure as code network', async () => {
    const api = createAccountApi(
      { fetch: async () => Promise.reject(new Error('down')), setTimeout: () => 0, clearTimeout: () => undefined },
      () => undefined,
    );
    const r = await api.boot();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('network');
  });

  it('deletes the legacy dv-session entry and ignores blocked storage', () => {
    const removeItem = vi.fn();
    purgeLegacySession({ removeItem });
    expect(removeItem).toHaveBeenCalledWith('dv-session');
    expect(() => purgeLegacySession({ removeItem: () => { throw new Error('blocked'); } })).not.toThrow();
    expect(() => purgeLegacySession(null)).not.toThrow();
  });

  it('delete and export call routes 64 and 65 with the bearer', async () => {
    const { deps, calls } = fakeDeps((path, init) => {
      if (path === '/api/v1/auth/me' && init.method === 'DELETE') return { status: 204 };
      if (path === '/api/v1/auth/me/export') return { status: 200, body: { username: 'pilot', ageBracket: '18p', termsVersion: 'interim-1', acceptedAt: 1, createdAt: 2 } };
      return { status: 200, body: SESSION_BODY };
    });
    const api = createAccountApi(deps, () => undefined);
    await api.login({ username: 'pilot', password: 'pw123456' });
    const exp = await api.exportData();
    expect(exp.ok).toBe(true);
    const del = await api.deleteAccount();
    expect(del.ok).toBe(true);
    expect(api.session()).toBeNull();
    const deleteCall = calls.find((c) => c.init.method === 'DELETE');
    expect((deleteCall?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer at-1');
  });
});

describe('account page text', () => {
  const keys = Object.keys(en);
  it('has the i18n keys the island uses, including the password hint', () => {
    const src = ['main.tsx', 'age.ts', 'api.ts']
      .map((f) => readFileSync(new URL(`../src/account/${f}`, import.meta.url), 'utf8'))
      .join('\n');
    const used = [...src.matchAll(/'(account\.[a-zA-Z.]+)'/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(20);
    for (const k of new Set(used)) expect(keys, k).toContain(k);
    expect(en['account.password.hint']).toContain('8');
  });

  it('keeps the display name out of the catalog (placeholder only)', () => {
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toContain('Dee-Verse');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LastSaveStatus, ProfileId, ProfileMeta, SaveErrorCode, SaveResult } from '@dv/shared';
import { catalogs } from '../src/i18n/index.ts';
import {
  SAVE_ERROR_UI, lastSaveLine, mostRecent, newGameErrorUi, openSession, playtimeText, relativeTime, runNewGame, saveErrorUi, selectProfile, waitForSession,
  type NewGameDeps, type OpenProfile, type SelectCtx,
} from '../src/pages/saves.tsx';

const CODES: SaveErrorCode[] = ['QUOTA', 'TOO_LARGE', 'CHECKSUM', 'CONFLICT', 'NEWER_SCHEMA', 'IDB_UNAVAILABLE', 'NOT_ALLOWED', 'INVALID', 'NAME_TAKEN', 'PROFILE_LIMIT'];

const meta = (id: string, name: string, over: Partial<ProfileMeta> = {}): ProfileMeta => ({
  id: id as ProfileId, name, createdAt: 1, updatedAt: 1, playtimeSec: 0, lastSave: null, deviceId: 'd'.repeat(32), ...over,
});

describe('save errors (AC-9)', () => {
  it('every SaveErrorCode has a message key in the catalog and an action', () => {
    expect(Object.keys(SAVE_ERROR_UI).sort()).toEqual([...CODES].sort());
    for (const code of CODES) {
      const ui = saveErrorUi(code);
      expect(catalogs['en']![ui.message], `${code} message`).toBeTruthy();
      expect(ui.action, `${code} action`).toBeDefined();
      if (ui.action.kind !== 'none') expect(catalogs['en']![ui.action.label], `${code} action label`).toBeTruthy();
    }
    expect(saveErrorUi('QUOTA').action).toMatchObject({ kind: 'nav', page: 'settings', params: { cat: 'install' } });
    expect(saveErrorUi('NEWER_SCHEMA').action.kind).toBe('reload');
  });
});

describe('New Game (AC-9, AC-11)', () => {
  const OPEN: OpenProfile = { id: 'b'.repeat(32), name: 'Player 1', hasStory: false };
  const deps = (over: Partial<NewGameDeps> & { create?: NewGameDeps['saves']['create']; rename?: NewGameDeps['saves']['rename']; persistent?: boolean; open?: OpenProfile | null } = {}) => {
    const sent: unknown[] = [];
    const selects: { id: string; reload: boolean }[] = [];
    const d: NewGameDeps = {
      saves: {
        create: over.create ?? vi.fn(() => Promise.resolve(meta('a'.repeat(32), 'Pilot'))),
        rename: over.rename ?? vi.fn(() => Promise.resolve({ ok: true, gen: 0, bytes: 0 } as SaveResult)),
        list: vi.fn(() => Promise.resolve([])),
        persistent: over.persistent ?? true,
      },
      session: over.session ?? (() => Promise.resolve(over.open === undefined ? { ...OPEN, hasStory: true } : over.open)),
      prefersReducedMotion: over.prefersReducedMotion ?? false,
      send: (c) => {
        sent.push(c);
        return true;
      },
      select: over.select ?? ((id, reload) => (selects.push({ id, reload }), Promise.resolve('ok'))),
    };
    return { d, sent, selects };
  };

  it('creates a new profile and selects it when the open one has story data', async () => {
    const { d, selects } = deps();
    const r = await runNewGame(d, 'Pilot');
    expect(r).toEqual({ ok: true, id: 'a'.repeat(32), reused: false, memoryOnly: false });
    expect(selects).toEqual([{ id: 'a'.repeat(32), reload: false }]);
  });

  it('reuses the open profile when it has no story data (renaming it, then reloading it)', async () => {
    const { d, selects } = deps({ open: OPEN });
    const r = await runNewGame(d, 'Pilot');
    expect(r).toEqual({ ok: true, id: OPEN.id, reused: true, memoryOnly: false });
    expect(d.saves.create).not.toHaveBeenCalled();
    expect(d.saves.rename).toHaveBeenCalledWith(OPEN.id, 'Pilot');
    expect(selects).toEqual([{ id: OPEN.id, reload: true }]);
  });

  it('NAME_TAKEN and PROFILE_LIMIT come back as the error to show inline', async () => {
    const taken = deps({ create: () => Promise.resolve({ ok: false, error: 'NAME_TAKEN' }) });
    expect(await runNewGame(taken.d, 'Pilot')).toEqual({ ok: false, error: 'NAME_TAKEN' });
    const limit = deps({ create: () => Promise.resolve({ ok: false, error: 'PROFILE_LIMIT' }) });
    expect(await runNewGame(limit.d, 'Pilot')).toEqual({ ok: false, error: 'PROFILE_LIMIT' });
    expect(taken.selects).toEqual([]);
    const rename = deps({ open: OPEN, rename: () => Promise.resolve({ ok: false, error: 'NAME_TAKEN' }) });
    expect(await runNewGame(rename.d, 'Pilot')).toEqual({ ok: false, error: 'NAME_TAKEN' });
  });

  it('a profile made under prefers-reduced-motion starts with reducedMotion on (and the XR mirror)', async () => {
    const { d, sent } = deps({ prefersReducedMotion: true });
    await runNewGame(d, 'Pilot');
    expect(sent).toContainEqual({ t: 'save.settings', data: { accessibility: { reducedMotion: true }, camera: { shake: false }, xr: { reduceMotion: true } } });
    const calm = deps({ prefersReducedMotion: false });
    await runNewGame(calm.d, 'Pilot');
    expect(calm.sent.filter((c) => (c as { t: string }).t === 'save.settings')).toEqual([]);
  });

  it('settings follow the select: nothing is sent before the sim reports the profile', async () => {
    const order: string[] = [];
    const { d } = deps({ prefersReducedMotion: true, select: () => new Promise((res) => setTimeout(() => (order.push('selected'), res('ok')), 5)) });
    const send = d.send;
    d.send = (c) => (order.push((c as { t: string }).t), send(c));
    await runNewGame(d, 'Pilot');
    expect(order).toEqual(['selected', 'save.settings']);
  });

  // BD-FIX-NEWGAME-01: the owner's bug. Continue before the engine attached made a profile, lost the select and blamed storage.
  it('decides nothing before the session is up, and says "not ready" (never IDB_UNAVAILABLE) when it does not come up', async () => {
    const { d, selects } = deps({ session: () => Promise.resolve(null) });
    expect(await runNewGame(d, 'Pilot')).toEqual({ ok: false, error: 'NOT_READY' });
    expect(d.saves.create).not.toHaveBeenCalled();
    expect(d.saves.rename).not.toHaveBeenCalled();
    expect(selects).toEqual([]);
  });

  it('a select the sim does not confirm in time is NOT_READY, not IDB_UNAVAILABLE', async () => {
    const { d } = deps({ select: () => Promise.resolve('timeout') });
    expect(await runNewGame(d, 'Pilot')).toEqual({ ok: false, error: 'NOT_READY' });
    expect(newGameErrorUi('NOT_READY').message).toBe('engine.notReady');
    expect(catalogs['en']!['engine.notReady']).toBeTruthy();
    expect(newGameErrorUi('IDB_UNAVAILABLE')).toBe(saveErrorUi('IDB_UNAVAILABLE'));
  });

  it('memory only: play goes on in the open profile on the same press, nothing made or renamed on the page store', async () => {
    const { d, selects, sent } = deps({ persistent: false, open: OPEN, prefersReducedMotion: true });
    expect(await runNewGame(d, 'Pilot')).toEqual({ ok: true, id: OPEN.id, reused: true, memoryOnly: true });
    expect(d.saves.list).toHaveBeenCalled();
    expect(d.saves.create).not.toHaveBeenCalled();
    expect(d.saves.rename).not.toHaveBeenCalled();
    expect(selects).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('memory only beside a playthrough with story data: IDB_UNAVAILABLE (the storage really is unavailable)', async () => {
    const { d, selects } = deps({ persistent: false, open: { ...OPEN, hasStory: true } });
    expect(await runNewGame(d, 'Pilot')).toEqual({ ok: false, error: 'IDB_UNAVAILABLE' });
    expect(d.saves.create).not.toHaveBeenCalled();
    expect(selects).toEqual([]);
  });
});

/** A shell context with an engine that attaches later and a fake sim that answers a `select` by publishing `sys.profile`. */
function fakeShell(opts: { answer?: boolean; answerMs?: number } = {}) {
  const values = new Map<string, unknown>();
  const subs = new Map<string, Set<(v: unknown) => void>>();
  const vm = {
    get: (k: string) => values.get(k),
    subscribe: (k: string, cb: (v: unknown) => void) => {
      let set = subs.get(k);
      if (!set) subs.set(k, (set = new Set()));
      set.add(cb);
      return () => void set.delete(cb);
    },
  };
  const publish = (k: string, v: unknown): void => {
    values.set(k, v);
    for (const cb of [...(subs.get(k) ?? [])]) cb(v);
  };
  const state = { engine: null as { vm: typeof vm } | null, mode: { state: 'Idle', stack: [] as { id: string; state: string }[] } };
  const sent: unknown[] = [];
  const names = new Map<string, string>();
  const ctx: SelectCtx = {
    get engine() {
      return state.engine as never;
    },
    get mode() {
      return state.mode;
    },
    sendUi: (c) => {
      // ShellCore.sendUi: false (dropped) while no engine is attached.
      if (!state.engine) return false;
      sent.push(c);
      if (c.t === 'save.profile' && c.op === 'select' && opts.answer !== false) {
        const id = c.id as string;
        setTimeout(() => publish('sys.profile', { id, name: names.get(id) ?? 'Player 1', hasStory: false }), opts.answerMs ?? 30);
      }
      return true;
    },
  };
  return {
    ctx,
    sent,
    names,
    publish,
    state,
    /** The engine attaches and, a moment later, the sim publishes the profile it opened at boot. */
    attach(profile: OpenProfile, afterMs = 50) {
      state.engine = { vm };
      setTimeout(() => publish('sys.profile', profile), afterMs);
    },
  };
}

describe('profile select (BD-FIX-NEWGAME-01)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const P1: OpenProfile = { id: 'p'.repeat(32), name: 'Player 1', hasStory: false };
  const Q = 'q'.repeat(32);

  it('openSession needs the engine, its sys.profile and an Idle host', () => {
    const f = fakeShell();
    expect(openSession(f.ctx)).toBeNull();
    f.state.engine = { vm: { get: () => undefined, subscribe: () => () => undefined } } as never;
    expect(openSession(f.ctx)).toBeNull();
    f.attach(P1, 0);
    vi.advanceTimersByTime(1);
    expect(openSession(f.ctx)).toEqual(P1);
    f.state.mode = { state: 'Loading', stack: [{ id: 'story', state: 'Loading' }] };
    expect(openSession(f.ctx)).toBeNull();
  });

  it('waitForSession waits for the engine to attach, and gives up at the timeout or on abort', async () => {
    const f = fakeShell();
    const late = waitForSession(f.ctx, 60_000);
    await vi.advanceTimersByTimeAsync(20_000);
    f.attach(P1);
    await vi.advanceTimersByTimeAsync(500);
    expect(await late).toEqual(P1);

    const never = waitForSession(fakeShell().ctx, 5_000);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(await never).toBeNull();

    const ac = new AbortController();
    const aborted = waitForSession(fakeShell().ctx, 60_000, ac.signal);
    ac.abort();
    expect(await aborted).toBeNull();
  });

  it('a select pressed before the engine attaches is sent once it is up, and resolves when the sim reports the profile', async () => {
    const f = fakeShell();
    const r = selectProfile(f.ctx, Q);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.sent).toEqual([]);   // nothing was dropped on the floor: nothing was sent yet
    f.attach(P1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.sent).toEqual([{ t: 'save.profile', op: 'select', id: Q }]);
    expect(await r).toBe('ok');
  });

  it('a select is not sent while a mode runs (the sim would refuse it), only once the host is Idle', async () => {
    const f = fakeShell();
    f.attach(P1, 0);
    f.state.mode = { state: 'Running', stack: [{ id: 'sandbox', state: 'Running' }] };
    const r = selectProfile(f.ctx, Q);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.sent).toEqual([]);
    f.state.mode = { state: 'Idle', stack: [] };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await r).toBe('ok');
    expect(f.sent).toHaveLength(1);
  });

  it('the open profile needs no select unless it is reloaded; a reload waits for the next sys.profile', async () => {
    const f = fakeShell();
    f.attach(P1, 0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await selectProfile(f.ctx, P1.id)).toBe('ok');
    expect(f.sent).toEqual([]);
    const reload = selectProfile(f.ctx, P1.id, { reload: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.sent).toEqual([{ t: 'save.profile', op: 'select', id: P1.id }]);
    expect(await reload).toBe('ok');
  });

  it('notReady without an engine in time, timeout when the sim never reports the profile', async () => {
    const none = selectProfile(fakeShell().ctx, Q, { readyMs: 3_000 });
    await vi.advanceTimersByTimeAsync(3_200);
    expect(await none).toBe('notReady');
    const f = fakeShell({ answer: false });
    f.attach(P1, 0);
    const silent = selectProfile(f.ctx, Q, { confirmMs: 4_000 });
    await vi.advanceTimersByTimeAsync(4_200);
    expect(await silent).toBe('timeout');
  });

  it('the owner bug end to end: one Continue before the engine attaches reaches the creator, renaming the open profile', async () => {
    const f = fakeShell();
    const rename = vi.fn((id: ProfileId, name: string) => (f.names.set(id, name), Promise.resolve({ ok: true, gen: 0, bytes: 0 } as SaveResult)));
    const create = vi.fn(() => Promise.resolve(meta(Q, 'Coast')));
    const run = runNewGame(
      {
        saves: { create, rename, list: () => Promise.resolve([]), persistent: true },
        session: () => waitForSession(f.ctx),
        prefersReducedMotion: false,
        send: (c) => f.ctx.sendUi(c as never),
        select: (id, reload) => selectProfile(f.ctx, id, { reload }),
      },
      'Coast',
    );
    // The world prepares behind the menu: no engine for 25 s. The page made nothing and sent nothing meanwhile.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(create).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    f.attach(P1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await run).toEqual({ ok: true, id: P1.id, reused: true, memoryOnly: false });
    expect(rename).toHaveBeenCalledWith(P1.id, 'Coast');
    expect(create).not.toHaveBeenCalled();
    expect(f.sent).toEqual([{ t: 'save.profile', op: 'select', id: P1.id }]);
    expect((f.ctx.engine?.vm.get('sys.profile' as never) as unknown as OpenProfile).name).toBe('Coast');
  });
});

describe('save status line', () => {
  const now = 10 * 60_000;
  it('says how long ago and why', () => {
    const s: LastSaveStatus = { slot: 'story:auto', at: now - 2 * 60_000, ok: true, reason: 'interval' };
    expect(lastSaveLine(s, now)).toEqual({ text: 'Saved 2 minutes ago · Auto-save', ok: true });
  });
  it('shows the failure, not the time, when the last save did not work', () => {
    const s: LastSaveStatus = { slot: 'story:auto', at: now, ok: false, error: 'QUOTA', reason: 'manual' };
    const line = lastSaveLine(s, now);
    expect(line.ok).toBe(false);
    expect(line.text).toBe(catalogs['en']!['saves.error.QUOTA']);
  });
  it('has a line for no save', () => {
    expect(lastSaveLine(null, now).text).toBe('No save yet');
  });
  it('formats relative time and playtime', () => {
    expect(relativeTime(now, now)).toMatch(/now|0 seconds/);
    expect(relativeTime(now - 3 * 3600_000, now)).toMatch(/3 hours ago/);
    expect(playtimeText(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(playtimeText(90)).toBe('1 minute');
  });
  it('continue resumes the profile saved most recently', () => {
    const a = meta('a'.repeat(32), 'A', { updatedAt: 5, lastSave: { slot: 'story:auto', at: 100, ok: true, reason: 'interval' } });
    const b = meta('b'.repeat(32), 'B', { updatedAt: 500, lastSave: { slot: 'story:auto', at: 50, ok: true, reason: 'interval' } });
    const c = meta('c'.repeat(32), 'C', { updatedAt: 7 });
    expect(mostRecent([a, b, c])?.name).toBe('A');
    expect(mostRecent([])).toBeNull();
  });
});

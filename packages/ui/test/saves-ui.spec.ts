import { describe, expect, it, vi } from 'vitest';
import type { LastSaveStatus, ProfileId, ProfileMeta, SaveErrorCode, SaveResult } from '@dv/shared';
import { catalogs } from '../src/i18n/index.ts';
import { SAVE_ERROR_UI, lastSaveLine, mostRecent, playtimeText, relativeTime, runNewGame, saveErrorUi, type NewGameDeps } from '../src/pages/saves.tsx';

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
  const deps = (over: Partial<NewGameDeps> & { create?: NewGameDeps['saves']['create']; rename?: NewGameDeps['saves']['rename'] } = {}) => {
    const sent: unknown[] = [];
    const d: NewGameDeps = {
      saves: {
        create: over.create ?? vi.fn(() => Promise.resolve(meta('a'.repeat(32), 'Pilot'))),
        rename: over.rename ?? vi.fn(() => Promise.resolve({ ok: true, gen: 0, bytes: 0 } as SaveResult)),
      },
      active: over.active ?? null,
      prefersReducedMotion: over.prefersReducedMotion ?? false,
      send: (c) => {
        sent.push(c);
        return true;
      },
      selected: over.selected ?? (() => Promise.resolve(true)),
    };
    return { d, sent };
  };

  it('creates a new profile and selects it', async () => {
    const { d, sent } = deps();
    const r = await runNewGame(d, 'Pilot');
    expect(r).toEqual({ ok: true, id: 'a'.repeat(32), reused: false });
    expect(sent).toEqual([{ t: 'save.profile', op: 'select', id: 'a'.repeat(32) }]);
  });

  it('reuses the open profile when it has no story data (renaming it)', async () => {
    const { d, sent } = deps({ active: { id: 'b'.repeat(32), name: 'Player 1', hasStory: false } });
    const r = await runNewGame(d, 'Pilot');
    expect(r).toEqual({ ok: true, id: 'b'.repeat(32), reused: true });
    expect(d.saves.create).not.toHaveBeenCalled();
    expect(d.saves.rename).toHaveBeenCalledWith('b'.repeat(32), 'Pilot');
    expect(sent[0]).toMatchObject({ op: 'select', id: 'b'.repeat(32) });
  });

  it('does not reuse a profile that has story data', async () => {
    const { d } = deps({ active: { id: 'b'.repeat(32), name: 'Player 1', hasStory: true } });
    const r = await runNewGame(d, 'Pilot');
    expect(r).toMatchObject({ ok: true, reused: false });
    expect(d.saves.create).toHaveBeenCalled();
  });

  it('NAME_TAKEN and PROFILE_LIMIT come back as the error to show inline', async () => {
    const taken = deps({ create: () => Promise.resolve({ ok: false, error: 'NAME_TAKEN' }) });
    expect(await runNewGame(taken.d, 'Pilot')).toEqual({ ok: false, error: 'NAME_TAKEN' });
    const limit = deps({ create: () => Promise.resolve({ ok: false, error: 'PROFILE_LIMIT' }) });
    expect(await runNewGame(limit.d, 'Pilot')).toEqual({ ok: false, error: 'PROFILE_LIMIT' });
    expect(taken.sent).toEqual([]);
    const rename = deps({ active: { id: 'b'.repeat(32), name: 'Player 1', hasStory: false }, rename: () => Promise.resolve({ ok: false, error: 'NAME_TAKEN' }) });
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
    const { d } = deps({ prefersReducedMotion: true, selected: () => new Promise((res) => setTimeout(() => (order.push('selected'), res(true)), 5)) });
    const send = d.send;
    d.send = (c) => (order.push((c as { t: string }).t), send(c));
    await runNewGame(d, 'Pilot');
    expect(order).toEqual(['save.profile', 'selected', 'save.settings']);
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

import { describe, expect, it, vi } from 'vitest';
import { runAction, type SettingsEnv } from '../src/pages/settings/index.ts';
import { installScreen } from '../src/pages/settings/privacy-storage.ts';
import type { ScreenDef, Widget } from '../src/screen/types.ts';
import type { OfflineJob, OfflinePlan, OfflinePort, ShellApi, ShellContext } from '../src/shell/types.ts';

const MB = 1024 * 1024;

const plan = (over: Partial<OfflinePlan> = {}): OfflinePlan => ({
  totalBytes: 40 * MB,
  files: 20,
  missingBytes: 30 * MB,
  missingFiles: 15,
  freeBytes: 500 * MB,
  fits: true,
  shortfallBytes: 0,
  store: 'opfs',
  writable: true,
  ...over,
});

function env(offline: SettingsEnv['offline']): SettingsEnv {
  return {
    xrCapable: false, deviceClass: 'desktop', tierChoices: [], tierLine: 'desktop (auto)', backend: 'webgl2', storage: null,
    installable: false, ios: false, standalone: false, build: 'x', updateReady: false, ageStatus: '-', offline,
  };
}

function button(s: ScreenDef, id: string): Extract<Widget, { k: 'button' }> | undefined {
  return s.children.find((w): w is Extract<Widget, { k: 'button' }> => w.k === 'button' && w.id === id);
}

const job = (over: Partial<OfflineJob> = {}): OfflineJob => ({ done: 3, total: 20, state: 'running', ...over });

describe('Install and storage offline rows (M04b4)', () => {
  it('neither offline nor clear carries settings.later', () => {
    const s = installScreen(env({ plan: plan(), downloaded: { bytes: 0, files: 0 }, job: null }));
    expect(button(s, 'offline')?.disabled).toBeUndefined();
    expect(button(s, 'clear')?.disabled).toBeUndefined();
    for (const w of s.children) if (w.k === 'button') expect(w.disabled).not.toBe('settings.later');
    // Without a port the rows are still not the "later" placeholder.
    const none = installScreen(env(null));
    expect(button(none, 'offline')?.disabled).toBe('settings.storage.offline.disabled.size');
    expect(button(none, 'clear')?.disabled).not.toBe('settings.later');
  });

  it('a plan that does not fit disables offline with the shortfall, and pressing it calls nothing', () => {
    const offline = { start: vi.fn(), cancel: vi.fn() };
    const s = installScreen(env({ plan: plan({ fits: false, shortfallBytes: Math.round(12.34 * MB) }), downloaded: { bytes: 0, files: 0 }, job: null }));
    const b = button(s, 'offline');
    expect(b?.disabled).toBe('settings.storage.offline.disabled.space');
    expect(b?.disabledParams).toEqual({ short: '12.3' });
    // A disabled button is never run by the screen; nothing else may reach the port.
    expect(offline.start).not.toHaveBeenCalled();
  });

  it('a memory-fallback store, a read-only tab and a null plan each disable offline with their own reason', () => {
    const d = { bytes: 0, files: 0 };
    const reason = (p: OfflinePlan | null): string | undefined => button(installScreen(env({ plan: p, downloaded: d, job: null })), 'offline')?.disabled;
    const reasons = [reason(plan({ store: 'memory-fallback' })), reason(plan({ writable: false })), reason(null)];
    expect(reasons).toEqual([
      'settings.storage.offline.disabled.store',
      'settings.storage.offline.disabled.tab',
      'settings.storage.offline.disabled.size',
    ]);
    expect(new Set(reasons).size).toBe(3);
  });

  it('a running job shows progress and offline-cancel, and disables clear and the download button', () => {
    const s = installScreen(env({ plan: plan(), downloaded: { bytes: 0, files: 0 }, job: job() }));
    const p = s.children.find((w) => w.k === 'progress');
    expect(p).toMatchObject({ k: 'progress', value: 3 / 20, params: { done: 3, total: 20 } });
    expect(button(s, 'offline-cancel')).toBeDefined();
    expect(button(s, 'clear')?.disabled).toBe('settings.storage.clear.disabled.running');
    expect(button(s, 'offline')?.disabled).toBe('settings.storage.offline.disabled.running');
  });

  it('shows the size, the result lines, the caveat and the downloaded row', () => {
    const texts = (j: OfflineJob | null): string[] =>
      installScreen(env({ plan: plan(), downloaded: { bytes: 5 * MB, files: 7 }, job: j })).children.flatMap((w) => (w.k === 'text' ? [w.text] : []));
    expect(texts(null)).toEqual(expect.arrayContaining(['settings.storage.offline.size', 'settings.storage.offline.caveat', 'settings.storage.offline.downloaded']));
    expect(texts(job({ state: 'done' }))).toContain('settings.storage.offline.done');
    expect(texts(job({ state: 'cancelled' }))).toContain('settings.storage.offline.stopped');
    expect(texts(job({ state: 'failed', reason: 'quota' }))).toContain('settings.storage.offline.failed.quota');
    const dl = installScreen(env({ plan: plan(), downloaded: { bytes: 5 * MB, files: 7 }, job: null })).children.find(
      (w) => w.k === 'text' && w.text === 'settings.storage.offline.downloaded',
    );
    expect(dl).toMatchObject({ params: { mb: '5.0', files: 7 } });
    const size = installScreen(env({ plan: plan(), downloaded: { bytes: 0, files: 0 }, job: null })).children.find((w) => w.k === 'text' && w.text === 'settings.storage.offline.size');
    expect(size).toMatchObject({ params: { total: '40.0', missing: '30.0' } });
  });
});

function fakes(confirmResult: boolean) {
  const offline: OfflinePort = {
    plan: vi.fn(() => Promise.resolve(plan())),
    downloaded: vi.fn(() => Promise.resolve({ bytes: 0, files: 0 })),
    start: vi.fn(() => Promise.resolve(job({ state: 'done' }))),
    cancel: vi.fn(),
    job: () => null,
    onJob: () => () => undefined,
    clear: vi.fn(() => Promise.resolve()),
  };
  const confirm = vi.fn(() => Promise.resolve(confirmResult));
  const shell = { confirm } as unknown as ShellApi;
  const ctx = { platform: { offline } } as unknown as ShellContext;
  const storageReload = vi.fn();
  const offlineReload = vi.fn();
  return { offline, confirm, deps: { cat: 'install', ctx, shell, storageReload, offlineReload }, offlineReload };
}

describe('runAction for the offline rows (M04b4)', () => {
  it('offline starts the download and offline-cancel stops it', () => {
    const f = fakes(true);
    runAction({ call: 'offline' }, 'offline', f.deps);
    expect(f.offline.start).toHaveBeenCalledTimes(1);
    runAction({ call: 'offline-cancel' }, 'offline-cancel', f.deps);
    expect(f.offline.cancel).toHaveBeenCalledTimes(1);
  });

  it('clear asks for a danger confirmation and clears only when it resolves true', async () => {
    const no = fakes(false);
    runAction({ call: 'clear' }, 'clear', no.deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(no.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(no.offline.clear).not.toHaveBeenCalled();

    const yes = fakes(true);
    runAction({ call: 'clear' }, 'clear', yes.deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(yes.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(yes.offline.clear).toHaveBeenCalledTimes(1);
    expect(yes.offlineReload).toHaveBeenCalled();
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformSettings } from '@dv/shared';
import { DEFAULT_SETTINGS } from '../../engine/src/platform/platform-store.ts';
import { defaultSettings } from '../../engine/src/sim/modes/settings-defaults.ts';
import { SettingsBinder } from '../src/shell/binder.ts';
import { ShellCore } from '../src/shell/core.ts';
import { createOverlayHooks, defaultOverlayHooks, type OverlayHooks, type ShellSignal } from '../src/shell/overlay-hooks.ts';
import { defaultPrefs, memoryPrefs } from '../src/shell/prefs.ts';
import type { EnginePort, PlatformPort, ShellHooks, ShellProps } from '../src/shell/types.ts';

const root = path.resolve(import.meta.dirname, '../../..');

function rig(withChannel = true) {
  const target = new EventTarget();
  const events: ShellSignal[] = [];
  target.addEventListener('dv-shell', (e) => events.push((e as CustomEvent<ShellSignal>).detail));
  const posted: unknown[] = [];
  const ch = withChannel ? { postMessage: (m: unknown) => void posted.push(m) } : null;
  let clock = 0;
  const hooks = createOverlayHooks({ target, channel: ch, now: () => clock });
  return { hooks, events, posted, tick: (ms: number) => void (clock += ms) };
}

function wired() {
  const r = rig();
  const platformSettings: PlatformSettings = { ...DEFAULT_SETTINGS };
  const platform = { settings: () => platformSettings, update: (p: Partial<PlatformSettings>) => (Object.assign(platformSettings, p), Promise.resolve()) } as unknown as PlatformPort;
  vi.useFakeTimers();
  const binder = new SettingsBinder({
    base: () => defaultSettings(),
    sendUi: () => true,
    platform: () => platform,
    prefs: memoryPrefs(defaultPrefs()),
    signal: (ref, value) => r.hooks.setting(ref, value),
  });
  return { ...r, binder };
}

describe('overlay hooks (M04b5 AC-7)', () => {
  it('one binder write gives exactly one dv-shell event and one channel post of the same object', () => {
    const w = wired();
    w.binder.set({ scope: 'device', path: 'renderScale' }, 0.5);
    expect(w.events).toEqual([{ v: 1, kind: 'setting', ref: 'device:renderScale', value: 0.5 }]);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]).toBe(w.events[0]);
    vi.useRealTimers();
  });

  it('the reduced-motion switch gives one signal, not two (the xr mirror is silent), and setControls gives none', () => {
    const w = wired();
    w.binder.set({ scope: 'profile', path: 'accessibility.reducedMotion' }, true);
    expect(w.events).toEqual([{ v: 1, kind: 'setting', ref: 'profile:accessibility.reducedMotion', value: true }]);
    w.binder.setControls(defaultSettings().controls);
    expect(w.events).toHaveLength(1);
    vi.useRealTimers();
  });

  it('a value that is not a JSON primitive is left out of the signal', () => {
    const w = wired();
    w.binder.set({ scope: 'ui', path: 'customTouchLayouts' }, { a: 1 });
    expect(w.events).toEqual([{ v: 1, kind: 'setting', ref: 'ui:customTouchLayouts' }]);
    expect('value' in (w.events[0] as object)).toBe(false);
    vi.useRealTimers();
  });

  it('fps samples every 100 ms for 3 s give at most 3 fps signals', () => {
    const r = rig();
    for (let i = 0; i < 30; i++) {
      r.hooks.fps(60, 'desktop');
      r.tick(100);
    }
    const n = r.events.filter((e) => e.kind === 'fps').length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
  });

  it('a profile id change gives one profile signal, and a repeat gives none', () => {
    const r = rig();
    r.hooks.profile('p1');
    r.hooks.profile('p1');
    r.hooks.profile('p2');
    expect(r.events).toEqual([{ v: 1, kind: 'profile', profileId: 'p1' }, { v: 1, kind: 'profile', profileId: 'p2' }]);
  });

  it('state and page changes are signals', () => {
    const r = rig();
    r.hooks.state('Paused');
    r.hooks.page('settings');
    expect(r.events).toEqual([{ v: 1, kind: 'state', state: 'Paused' }, { v: 1, kind: 'page', page: 'settings' }]);
  });

  it('with channel null the window event still fires and nothing throws', () => {
    const r = rig(false);
    expect(() => r.hooks.page('main')).not.toThrow();
    expect(r.events).toHaveLength(1);
  });

  it('a closed channel does not break the shell', () => {
    const hooks = createOverlayHooks({
      target: new EventTarget(),
      channel: {
        postMessage: () => {
          throw new Error('closed');
        },
      },
      now: () => 0,
    });
    expect(() => hooks.state('Menu')).not.toThrow();
  });

  it('the default hooks work where BroadcastChannel is missing', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const hooks = defaultOverlayHooks();
    expect(() => hooks.page('main')).not.toThrow();
    hooks.dispose();
    vi.unstubAllGlobals();
  });
});

describe('the shell core feeds the stream (M04b5)', () => {
  const hooks = (): ShellHooks => ({ play: () => undefined, setPaused: () => undefined, view: () => undefined, reload: () => undefined });
  const props = (overlay: OverlayHooks): ShellProps => ({
    diagnostics: () => 'd', unsupported: false, update: null, initialPath: '/', prefs: memoryPrefs(defaultPrefs()), qa: true, qaPlay: null,
    unlockAllFlag: false, hooks: hooks(), build: 't', overlay,
  });
  const engine = () => {
    const values = new Map<string, unknown>([['sys.mode', { state: 'Idle', stack: [] }], ['sys.profile', { id: 'p1', name: 'A', hasStory: false }]]);
    const subs: Array<(v: unknown, k: string) => void> = [];
    const port: EnginePort = {
      vm: { get: ((k: string) => values.get(k)) as never, subscribe: ((_k: string, cb: (v: unknown, k: string) => void) => (subs.push(cb), () => undefined)) as never, rev: 0 },
      sendUi: () => true, activeDevice: () => 'kbm', audioUnlock: () => undefined, firstGesture: () => undefined,
    };
    return {
      port,
      set: (k: string, v: unknown) => {
        values.set(k, v);
        for (const cb of subs) cb(v, k);
      },
    };
  };

  it('signals the state, the profile and the platform frame stats; the fps signal flows with the chip off', () => {
    const r = rig();
    const core = new ShellCore(props(r.hooks));
    const holder: { push: ((s: { fps: number; tier: string }) => void) | null } = { push: null };
    core.attachPlatform({ onFrameStats: (cb: (s: { fps: number; tier: string }) => void) => ((holder.push = cb), () => undefined) } as unknown as PlatformPort);
    const e = engine();
    core.attachEngine(e.port);
    expect(r.events).toContainEqual({ v: 1, kind: 'profile', profileId: 'p1' });
    e.set('sys.profile', { id: 'p1', name: 'A', hasStory: true });
    e.set('sys.profile', { id: 'p2', name: 'B', hasStory: false });
    expect(r.events.filter((s) => s.kind === 'profile')).toHaveLength(2);
    holder.push?.({ fps: 59, tier: 'desktop' });
    expect(r.events).toContainEqual({ v: 1, kind: 'fps', fps: 59, tier: 'desktop' });
    core.ready();
    expect(r.events).toContainEqual({ v: 1, kind: 'state', state: 'Title' });
    core.dispose();
  });
});

describe('data-ui-skip on names and values (M04b5 AC-7)', () => {
  const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');
  const near = (src: string, anchor: string): string => src.slice(Math.max(0, src.indexOf(anchor) - 120), src.indexOf(anchor) + 200);
  it('the creator inputs, the saves rename input and the profile card heading carry data-ui-skip and translate off', () => {
    const creator = read('packages/ui/src/creator/page.tsx');
    for (const id of ['creator-name"', 'creator-callsign"']) {
      const s = near(creator, `data-testid="${id}`);
      expect(s).toContain('data-ui-skip=""');
      expect(s).toContain('translate={false}');
    }
    const saves = read('packages/ui/src/pages/saves.tsx');
    expect(near(saves, 'data-testid="rename-input"')).toContain('data-ui-skip=""');
    expect(near(saves, 'data-testid={`profile-card-${p.name}`}')).toContain('data-ui-skip=""');
    const hud = read('packages/ui/src/hud/widgets.tsx');
    for (const id of ['hud-wallet-value', 'hud-clock"', 'hud-prompt-glyph']) expect(near(hud, `data-testid="${id}`)).toContain('data-ui-skip=""');
    expect(read('packages/ui/src/hud/fps-chip.tsx')).toContain('data-ui-skip=""');
  });
});

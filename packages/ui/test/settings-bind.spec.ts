import type { VNode } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import type { ControlsSettings, JsonValue, PlatformSettings, ProfileSettings, UiCommand } from '@dv/shared';
import { defaultSettings } from '../../engine/src/sim/modes/settings-defaults.ts';
import { mergeControls } from '../../engine/src/sim/input/remap-persist.ts';
import { DEFAULT_SETTINGS } from '../../engine/src/platform/platform-store.ts';
import { DomScreen } from '../src/screen/dom-screen.tsx';
import type { ScreenCtx, SettingRef, Widget } from '../src/screen/types.ts';
import { CATEGORIES, DEVICE_DEFAULTS, PROFILE_DEFAULTS, categoryScreen, resetCategory, type SettingsEnv } from '../src/pages/settings/index.ts';
import {
  PAUSE_ACTION, actionsOf, bindingLabel, effective, findConflict, glyph, isLocked, resetAction, resetDevice, resetGroup, resolveConflict, setBinding,
} from '../src/pages/settings/controls.tsx';
import { PROFILE_DEBOUNCE_MS, SettingsBinder, UNSET_DEFAULTS } from '../src/shell/binder.ts';
import { defaultPrefs, memoryPrefs } from '../src/shell/prefs.ts';
import type { PlatformPort } from '../src/shell/types.ts';

const env: SettingsEnv = {
  xrCapable: true, deviceClass: 'xr', tierChoices: ['xr-quest'], tierLine: 'xr-quest (auto)', backend: 'webgl2', storage: null, installable: true, ios: false,
  standalone: false, build: 'x', updateReady: true, ageStatus: '-',
};

function setup() {
  vi.useFakeTimers();
  const sent: UiCommand[] = [];
  const base: ProfileSettings = defaultSettings();
  const prefs = memoryPrefs(defaultPrefs());
  const platformSettings: PlatformSettings = { ...DEFAULT_SETTINGS };
  const update = vi.fn((p: Partial<PlatformSettings>) => {
    Object.assign(platformSettings, p);
    return Promise.resolve();
  });
  const platform = { settings: () => platformSettings, update } as unknown as PlatformPort;
  const binder = new SettingsBinder({ base: () => base, sendUi: (c) => (sent.push(c), true), platform: () => platform, prefs });
  return { binder, sent, update, prefs, platformSettings, base };
}

describe('settings binding (AC-11)', () => {
  it('a profile-scoped row sends one save.settings 500 ms after the last change, with the sections that changed', () => {
    const { binder, sent } = setup();
    binder.set({ scope: 'profile', path: 'audio.master' }, 0.5);
    binder.set({ scope: 'profile', path: 'audio.music' }, 0.2);
    binder.set({ scope: 'profile', path: 'camera.fovDeg' }, 90);
    vi.advanceTimersByTime(PROFILE_DEBOUNCE_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ t: 'save.settings', data: { audio: { master: 0.5, music: 0.2 }, camera: { fovDeg: 90 } } }]);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
    vi.useRealTimers();
  });

  it('shows a profile change at once (overlay) and drops it when the sim echoes the value', () => {
    const { binder, base } = setup();
    expect(binder.get({ scope: 'profile', path: 'audio.master' })).toBe(1);
    binder.set({ scope: 'profile', path: 'audio.master' }, 0.5);
    expect(binder.get({ scope: 'profile', path: 'audio.master' })).toBe(0.5);
    vi.advanceTimersByTime(PROFILE_DEBOUNCE_MS);
    base.audio.master = 0.5;
    binder.rebase();
    base.audio.master = 0.9;
    expect(binder.get({ scope: 'profile', path: 'audio.master' })).toBe(0.9);
    vi.useRealTimers();
  });

  it('reduced motion mirrors into the XR comfort block in the same write', () => {
    const { binder, sent } = setup();
    binder.set({ scope: 'profile', path: 'accessibility.reducedMotion' }, true);
    vi.advanceTimersByTime(PROFILE_DEBOUNCE_MS);
    expect(sent).toEqual([{ t: 'save.settings', data: { accessibility: { reducedMotion: true }, xr: { reduceMotion: true } } }]);
    vi.useRealTimers();
  });

  it('a device-scoped row writes PlatformSettings and sends nothing to the sim', () => {
    const { binder, sent, update, platformSettings } = setup();
    binder.set({ scope: 'device', path: 'fpsCap' }, 30);
    binder.set({ scope: 'device', path: 'telemetryConsent.analytics' }, false);
    expect(update).toHaveBeenNthCalledWith(1, { fpsCap: 30 });
    expect(update).toHaveBeenNthCalledWith(2, { telemetryConsent: { diagnostics: true, analytics: false } });
    expect(platformSettings.telemetryConsent).toEqual({ diagnostics: true, analytics: false });
    expect(binder.get({ scope: 'device', path: 'fpsCap' })).toBe(30);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    vi.useRealTimers();
  });

  it('a ui-scoped row writes UiPrefs', () => {
    const { binder, prefs } = setup();
    binder.set({ scope: 'ui', path: 'uiScale' }, 1.25);
    expect(prefs.get().uiScale).toBe(1.25);
    expect(binder.get({ scope: 'ui', path: 'uiScale' })).toBe(1.25);
    vi.useRealTimers();
  });

  it('every settings row shows its scope badge, and every row binds to a value that exists', () => {
    const { binder, base } = setup();
    let rows = 0;
    const badgeScopes: string[] = [];
    const walk = (node: unknown): void => {
      if (node === null || node === undefined || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const v = node as VNode<Record<string, unknown>>;
      if (typeof v.type === 'function') return walk((v.type as (p: unknown) => unknown)(v.props));
      if (v.props?.['data-scope']) badgeScopes.push(String(v.props['data-scope']));
      walk(v.props?.['children']);
    };
    const ctx: ScreenCtx = { get: (r) => binder.get(r), set: (r, x) => binder.set(r, x), run: () => undefined, tab: () => undefined, setTab: () => undefined };
    const bound: { ref: SettingRef; id: string }[] = [];
    const collect = (w: Widget): void => {
      if (w.k === 'toggle' || w.k === 'slider' || w.k === 'choice') {
        rows++;
        bound.push({ ref: w.bind, id: w.id });
      }
      if (w.k === 'tabs') w.tabs.forEach((t) => t.children.forEach(collect));
    };
    for (const cat of CATEGORIES) {
      const screen = categoryScreen(cat.id, env);
      if (!screen) continue;
      screen.children.forEach(collect);
      badgeScopes.length = 0;
      const before = rows;
      walk(DomScreen({ screen, ctx }));
      const inScreen = screen.children.filter((w) => w.k === 'toggle' || w.k === 'slider' || w.k === 'choice').length;
      expect(badgeScopes.length, cat.id).toBe(inScreen);
      expect(before).toBeGreaterThan(0);
    }
    expect(rows).toBeGreaterThan(50);
    for (const { ref, id } of bound) {
      if (ref.scope === 'device' || ref.scope === 'ui') continue;
      expect(binder.get(ref), `${id} (${ref.path}) exists in the default profile settings`).toBeDefined();
    }
    void base;
    vi.useRealTimers();
  });

  it('Reset category writes the defaults, and the table matches the sim defaults', () => {
    const d = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
    for (const [cat, paths] of Object.entries(PROFILE_DEFAULTS)) {
      for (const [path, v] of Object.entries(paths)) {
        // `npc` and `cutscenes` (C05 1.1) are unset in a new profile; the binder shows UNSET_DEFAULTS for them.
        if (d[path.split('.')[0] as string] === undefined) {
          expect(UNSET_DEFAULTS[path], path).toEqual(v);
          continue;
        }
        const [a, b] = path.split('.') as [string, string];
        expect(d[a]?.[b], `${cat}:${path}`).toEqual(v);
      }
    }
    for (const [, paths] of Object.entries(DEVICE_DEFAULTS)) for (const [path, v] of Object.entries(paths)) expect((DEFAULT_SETTINGS as unknown as Record<string, unknown>)[path], path).toEqual(v);
    const written: [SettingRef, JsonValue][] = [];
    resetCategory('audio', (r, v) => void written.push([r, v]));
    expect(written).toHaveLength(8);
    resetCategory('graphics', (r, v) => void written.push([r, v]));
    expect(written.some(([r]) => r.scope === 'device' && r.path === 'tierOverride')).toBe(true);
    expect(written.some(([r]) => r.scope === 'ui' && r.path === 'showFps')).toBe(true);
    vi.useRealTimers();
  });
});

describe('controls remap', () => {
  const base = (): ControlsSettings => defaultSettings().controls;

  it('rebinding Jump writes an override and round-trips through the sim merge', () => {
    const next = setBinding(base(), 'kbm', 'onFoot', 'sim.Jump', 0, { control: 'key:KeyH' });
    expect(effective(next, 'kbm', 'onFoot', 'sim.Jump')).toEqual([{ control: 'key:KeyH' }]);
    expect(bindingLabel({ control: 'key:KeyH' })).toBe('H');
    const merged = mergeControls(base(), next);
    expect(merged?.overrides).toEqual(next.overrides);
  });

  it('a second slot adds a second binding; at most two are kept', () => {
    let c = setBinding(base(), 'kbm', 'onFoot', 'sim.Sprint', 1, { control: 'key:KeyQ' });
    expect(effective(c, 'kbm', 'onFoot', 'sim.Sprint')).toHaveLength(2);
    c = setBinding(c, 'kbm', 'onFoot', 'sim.Sprint', 1, { control: 'key:KeyZ' });
    expect(effective(c, 'kbm', 'onFoot', 'sim.Sprint').map((b) => b.control)).toEqual(['key:ShiftLeft', 'key:KeyZ']);
  });

  it('Pause cannot be rebound to nothing: the row is locked and the model refuses', () => {
    expect(isLocked(PAUSE_ACTION)).toBe(true);
    const c = base();
    expect(setBinding(c, 'kbm', 'onFoot', PAUSE_ACTION, 0, null)).toBe(c);
    expect(setBinding(c, 'kbm', 'onFoot', PAUSE_ACTION, 0, { control: 'key:KeyO' })).toBe(c);
    expect(effective(c, 'kbm', 'onFoot', PAUSE_ACTION).length).toBeGreaterThan(0);
    // The sim drops an empty Pause override as well.
    const forced = { ...c, overrides: { kbm: { onFoot: { 'client.Pause': [] } } } } as ControlsSettings;
    expect(mergeControls(c, forced)?.overrides.kbm?.onFoot?.['client.Pause']).toBeUndefined();
  });

  it('finds a conflict and resolves it by replace or swap; a Pause binding is never taken', () => {
    const c = base();
    expect(findConflict(c, 'kbm', 'onFoot', 'sim.Jump', { control: 'key:KeyE' })).toBe('sim.Interact');
    expect(findConflict(c, 'kbm', 'onFoot', 'sim.Jump', { control: 'key:KeyJ' })).toBeNull();
    expect(findConflict(c, 'kbm', 'onFoot', 'sim.Jump', { control: 'key:Escape' })).toBe(PAUSE_ACTION);
    const replaced = resolveConflict(c, 'kbm', 'onFoot', 'sim.Jump', 0, { control: 'key:KeyE' }, 'sim.Interact', 'replace');
    expect(effective(replaced, 'kbm', 'onFoot', 'sim.Jump')).toEqual([{ control: 'key:KeyE' }]);
    expect(effective(replaced, 'kbm', 'onFoot', 'sim.Interact')).toEqual([]);
    const swapped = resolveConflict(c, 'kbm', 'onFoot', 'sim.Jump', 0, { control: 'key:KeyE' }, 'sim.Interact', 'swap');
    expect(effective(swapped, 'kbm', 'onFoot', 'sim.Interact')).toEqual([{ control: 'key:Space' }]);
    expect(resolveConflict(c, 'kbm', 'onFoot', 'sim.Jump', 0, { control: 'key:Escape' }, PAUSE_ACTION, 'replace')).toBe(c);
  });

  it('resets a row, a group and a device', () => {
    let c = setBinding(base(), 'kbm', 'onFoot', 'sim.Jump', 0, { control: 'key:KeyH' });
    c = setBinding(c, 'kbm', 'vehicle', 'sim.Horn', 0, { control: 'key:KeyJ' });
    expect(resetAction(c, 'kbm', 'onFoot', 'sim.Jump').overrides.kbm?.onFoot).toBeUndefined();
    expect(resetGroup(c, 'kbm', 'onFoot').overrides.kbm?.vehicle).toBeDefined();
    expect(resetDevice(c, 'kbm').overrides).toEqual({});
  });

  it('lists the rebindable actions of each group and names controls for people', () => {
    expect(actionsOf('kbm', 'onFoot')).toEqual(expect.arrayContaining(['sim.Jump', 'sim.Sprint', 'client.Pause']));
    expect(actionsOf('kbm', 'onFoot').some((a) => a.startsWith('axis.'))).toBe(false);
    expect(actionsOf('gamepad', 'vehicle').length).toBeGreaterThan(3);
    expect(glyph('key:Space')).toBe('Space');
    expect(glyph('key:ArrowUp')).toBe('Arrow Up');
    expect(glyph('pad:b0')).toBe('A');
  });
});

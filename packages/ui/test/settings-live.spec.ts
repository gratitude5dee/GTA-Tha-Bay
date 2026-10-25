import type { VNode } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformSettings } from '@dv/shared';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../engine/src/platform/platform-store.ts';
import { t } from '../src/i18n/index.ts';
import { pauseScreen } from '../src/phone/pause.tsx';
import { graphicsScreen } from '../src/pages/settings/display.ts';
import type { SettingsEnv } from '../src/pages/settings/index.ts';
import { CanvasScreen } from '../src/screen/canvas-screen.ts';
import { DomScreen } from '../src/screen/dom-screen.tsx';
import type { ScreenCtx, ScreenDef, Widget } from '../src/screen/types.ts';
import { fullscreenAvailable, fullscreenState, toggleFullscreen, type FullscreenDoc } from '../src/shell/fullscreen.ts';
import { defaultPrefs, memoryPrefs, normalizePrefs } from '../src/shell/prefs.ts';
import { SettingsBinder } from '../src/shell/binder.ts';
import type { PlatformPort } from '../src/shell/types.ts';

interface Host {
  type: string;
  props: Record<string, unknown>;
  text: string;
}

/** Expands function components and lists every host element with the text under it. */
function hosts(node: unknown, out: Host[] = []): Host[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) {
    for (const n of node) hosts(n, out);
    return out;
  }
  const v = node as VNode<Record<string, unknown>>;
  if (typeof v.type === 'function') return hosts((v.type as (p: unknown) => unknown)(v.props), out);
  const text = (n: unknown): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text((n as VNode<{ children?: unknown }>).props?.children) : '');
  out.push({ type: String(v.type), props: v.props ?? {}, text: text(v.props?.['children']) });
  return hosts(v.props?.['children'], out);
}

const ctx = (store: Map<string, unknown> = new Map()): ScreenCtx & { sets: string[] } => {
  const sets: string[] = [];
  return {
    sets,
    get: (r) => store.get(`${r.scope}:${r.path}`) as never,
    set: (r, v) => {
      sets.push(`${r.scope}:${r.path}=${JSON.stringify(v)}`);
      store.set(`${r.scope}:${r.path}`, v);
    },
    run: () => undefined,
    tab: () => undefined,
    setTab: () => undefined,
  };
};

const env = (over: Partial<SettingsEnv> = {}): SettingsEnv => ({
  xrCapable: false, deviceClass: 'desktop', tierChoices: ['desktop'], tierLine: 'desktop (auto)', backend: 'webgl2', storage: null, installable: false, ios: false,
  standalone: false, build: 'x', updateReady: false, ageStatus: '-', ...over,
});

const fpsRow = (s: ScreenDef): Extract<Widget, { k: 'choice' }> => s.children.find((w) => w.k === 'choice' && w.id === 'fps') as Extract<Widget, { k: 'choice' }>;

describe('the frame-cap row (M04b5 AC-3)', () => {
  it('is disabled with its reason while there is no frame pacer, and enabled with one', () => {
    expect(fpsRow(graphicsScreen(env())).disabled).toBe('settings.graphics.fps.later');
    expect(fpsRow(graphicsScreen(env({ framePacer: false }))).disabled).toBe('settings.graphics.fps.later');
    expect(fpsRow(graphicsScreen(env({ framePacer: true }))).disabled).toBeUndefined();
  });

  it('DomScreen renders aria-disabled with the reason read aloud, and a press changes nothing', () => {
    const c = ctx();
    const all = hosts(DomScreen({ screen: graphicsScreen(env()), ctx: c }));
    const radios = all.filter((h) => String(h.props['data-fid'] ?? '').startsWith('choice.fps.'));
    expect(radios).toHaveLength(3);
    for (const r of radios) {
      expect(r.props['aria-disabled']).toBe('true');
      (r.props['onClick'] as () => void)();
    }
    expect(c.sets).toEqual([]);
    const group = all.find((h) => h.props['role'] === 'radiogroup' && h.text.includes(t('settings.graphics.fps.later')));
    expect(group?.props['aria-disabled']).toBe('true');
    // The scale row stays live.
    const scale = all.filter((h) => String(h.props['data-fid'] ?? '').startsWith('choice.scale.'));
    expect(scale.every((h) => h.props['aria-disabled'] === undefined)).toBe(true);
    (scale[1]?.props['onClick'] as () => void)();
    expect(c.sets).toEqual(['device:renderScale=0.5']);
  });

  it('CanvasScreen lists the same focus order, marks the row disabled and ignores a press', () => {
    const screen = graphicsScreen(env());
    const c = ctx();
    const cs = new CanvasScreen(screen, c, 1000);
    const dom = hosts(DomScreen({ screen, ctx: c })).map((h) => h.props['data-fid']).filter((f): f is string => typeof f === 'string');
    expect(cs.focusOrder()).toEqual(dom);
    const items = cs.layout.items.filter((i) => i.fid.startsWith('choice.fps.'));
    expect(items.map((i) => i.disabled)).toEqual([true, true, true]);
    const it30 = items[1];
    cs.pick((it30!.rect.x + 2) / 1000, (it30!.rect.y + 2) / cs.layout.height, true);
    expect(c.sets).toEqual([]);
  });

  it('a stored fpsCap is kept: the binder is not asked to write it', () => {
    let settings: PlatformSettings = { ...DEFAULT_SETTINGS, fpsCap: 30 };
    const update = vi.fn((p: Partial<PlatformSettings>) => {
      settings = { ...settings, ...p };
      return Promise.resolve();
    });
    const binder = new SettingsBinder({ base: () => null, sendUi: () => true, platform: () => ({ settings: () => settings, update }) as unknown as PlatformPort, prefs: memoryPrefs(defaultPrefs()) });
    const c: ScreenCtx = { get: (r) => binder.get(r), set: (r, v) => binder.set(r, v), run: () => undefined, tab: () => undefined, setTab: () => undefined };
    for (const h of hosts(DomScreen({ screen: graphicsScreen(env()), ctx: c })).filter((h) => String(h.props['data-fid'] ?? '').startsWith('choice.fps.'))) (h.props['onClick'] as () => void)();
    expect(update).not.toHaveBeenCalled();
    expect(settings.fpsCap).toBe(30);
  });
});

function fakeDoc(over: Partial<FullscreenDoc> = {}) {
  const calls: string[] = [];
  const doc: FullscreenDoc & { calls: string[] } = {
    calls,
    fullscreenEnabled: true,
    fullscreenElement: null,
    exitFullscreen: () => (calls.push('exit'), Promise.resolve()),
    documentElement: { requestFullscreen: () => (calls.push('request'), Promise.resolve()) },
    ...over,
  };
  return doc;
}

describe('full screen (M04b5 AC-5)', () => {
  it('is available only when the document says so and the device is not XR', () => {
    expect(fullscreenAvailable(fakeDoc(), 'desktop')).toBe(true);
    expect(fullscreenAvailable(fakeDoc(), 'mobile')).toBe(true);
    expect(fullscreenAvailable(fakeDoc({ fullscreenEnabled: false }), 'desktop')).toBe(false);
    expect(fullscreenAvailable(fakeDoc({ fullscreenEnabled: undefined }), 'desktop')).toBe(false);
    expect(fullscreenAvailable(fakeDoc(), 'xr')).toBe(false);
    expect(fullscreenAvailable(null, 'desktop')).toBe(false);
    expect(fullscreenState(fakeDoc({ fullscreenElement: {} }), 'desktop')).toEqual({ available: true, active: true });
  });

  it('Pause and Graphics omit the button when it is not available, and show the matching label when it is', () => {
    const pauseIds = (fs?: { available: boolean; active: boolean }) =>
      pauseScreen({ atSafehouse: false, lastSave: null, otherTab: false, ...(fs ? { fullscreen: fs } : {}) }).children.filter((w) => w.k === 'button').map((w) => (w as { id: string }).id);
    expect(pauseIds()).not.toContain('pause-fullscreen');
    expect(pauseIds({ available: false, active: false })).not.toContain('pause-fullscreen');
    const ids = pauseIds({ available: true, active: false });
    expect(ids.indexOf('pause-fullscreen')).toBe(ids.indexOf('pause-settings') + 1);
    const label = (fs: { available: boolean; active: boolean }) =>
      (pauseScreen({ atSafehouse: false, lastSave: null, otherTab: false, fullscreen: fs }).children.find((w) => w.k === 'button' && w.id === 'pause-fullscreen') as { label: string }).label;
    expect(label({ available: true, active: false })).toBe('settings.fullscreen.enter');
    expect(label({ available: true, active: true })).toBe('settings.fullscreen.exit');

    const gIds = (e: SettingsEnv) => graphicsScreen(e).children.filter((w) => w.k === 'button').map((w) => (w as { id: string }).id);
    expect(gIds(env())).not.toContain('fullscreen');
    expect(gIds(env({ fullscreen: { available: false, active: false } }))).not.toContain('fullscreen');
    expect(gIds(env({ fullscreen: { available: true, active: false } }))).toContain('fullscreen');
  });

  it('one press requests full screen once on the document element, and a second press with an element set exits', () => {
    const doc = fakeDoc();
    toggleFullscreen(doc);
    expect(doc.calls).toEqual(['request']);
    doc.fullscreenElement = {};
    toggleFullscreen(doc);
    expect(doc.calls).toEqual(['request', 'exit']);
  });

  it('a rejected request, a throwing request and a missing method all show the failed toast path', async () => {
    const failed = vi.fn();
    toggleFullscreen(fakeDoc({ documentElement: { requestFullscreen: () => Promise.reject(new Error('denied')) } }), failed);
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).toHaveBeenCalledTimes(1);
    toggleFullscreen(
      fakeDoc({
        documentElement: {
          requestFullscreen: () => {
            throw new Error('sync');
          },
        },
      }),
      failed,
    );
    expect(failed).toHaveBeenCalledTimes(2);
    toggleFullscreen(fakeDoc({ documentElement: {} }), failed);
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('calls the browser inside the press, before any await', () => {
    const order: string[] = [];
    const doc = fakeDoc({ documentElement: { requestFullscreen: () => (order.push('request'), Promise.resolve()) } });
    toggleFullscreen(doc);
    order.push('after');
    expect(order).toEqual(['request', 'after']);
  });

  it('has its texts', () => {
    for (const k of ['settings.fullscreen.enter', 'settings.fullscreen.exit', 'settings.fullscreen.failed', 'settings.graphics.fps.later', 'hud.fps.line']) expect(t(k)).not.toBe(k);
    expect(t('hud.fps.line', { fps: 60 })).toBe('60 fps');
  });
});

describe('unknown fields survive (M04b5 AC-9)', () => {
  it('UiPrefs keeps a key it does not know through normalize, a change and persist', async () => {
    const raw = { ...defaultPrefs(), futureKey: { a: 1 } };
    const n = normalizePrefs(raw) as unknown as Record<string, unknown>;
    expect(n['futureKey']).toEqual({ a: 1 });
    const store = memoryPrefs(n as never);
    store.set({ showFps: true });
    expect((store.get() as unknown as Record<string, unknown>)['futureKey']).toEqual({ a: 1 });
    expect(store.get().showFps).toBe(true);
    // Known keys are always validated: a bad value does not ride in on the unknown-key copy.
    expect(normalizePrefs({ ...defaultPrefs(), uiScale: 99 }).uiScale).toBe(1.5);
    expect(normalizePrefs({ ...defaultPrefs(), v: 2, futureKey: 1 })).toEqual(defaultPrefs());
  });

  it('PlatformSettings keeps a key it does not know, and the platform port patch spreads it', () => {
    const cur = normalizeSettings({ ...DEFAULT_SETTINGS, futureKnob: 3 });
    const next = { ...cur, ...{ renderScale: 0.5 }, v: 1 as const } as unknown as Record<string, unknown>;
    expect(next['futureKnob']).toBe(3);
    expect(next['renderScale']).toBe(0.5);
  });
});

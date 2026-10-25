import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { CanvasScreen, layoutScreen, type Canvas2DLike } from '../src/screen/canvas-screen.ts';
import { DomScreen } from '../src/screen/dom-screen.tsx';
import type { ScreenCtx, ScreenDef } from '../src/screen/types.ts';
import { modesScreen } from '../src/pages/modes.ts';
import { appScreen, type PhoneEnv } from '../src/phone/apps.ts';
import { CATEGORIES, categoryScreen, type SettingsEnv } from '../src/pages/settings/index.ts';

/** Walks the vnode tree DomScreen returns (expanding function components) and lists the `data-fid` of every focusable element in order. */
function domFocus(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) {
    for (const n of node) domFocus(n, out);
    return out;
  }
  const v = node as VNode<Record<string, unknown>>;
  if (typeof v.type === 'function') return domFocus((v.type as (p: unknown) => unknown)(v.props), out);
  const fid = v.props?.['data-fid'];
  if (typeof fid === 'string') out.push(fid);
  return domFocus(v.props?.['children'], out);
}

const ctxWith = (tab?: string): ScreenCtx => ({
  get: () => undefined,
  set: () => undefined,
  run: () => undefined,
  tab: () => tab,
  setTab: () => undefined,
});

const env = (over: Partial<SettingsEnv> = {}): SettingsEnv => ({
  xrCapable: true, deviceClass: 'xr', tierChoices: ['xr-quest', 'xr-visionpro'], tierLine: 'xr-quest (auto)', backend: 'webgl2',
  storage: { usage: 1, quota: 2, persisted: false }, installable: true, ios: false, standalone: false, build: 'x', updateReady: true, ageStatus: '-', ...over,
});

const fixture: ScreenDef = {
  id: 'fixture',
  title: 'nav.main',
  children: [
    { k: 'heading', text: 'nav.main', level: 1 },
    { k: 'text', text: 'common.build', params: { build: 'x' } },
    { k: 'button', id: 'a', label: 'common.back', style: 'primary', onPress: { back: true } },
    { k: 'button', id: 'b', label: 'common.back', style: 'danger', disabled: 'settings.later', onPress: { back: true } },
    { k: 'toggle', id: 't', label: 'settings.camera.shake', bind: { scope: 'profile', path: 'camera.shake' } },
    { k: 'slider', id: 's', label: 'settings.camera.fov', bind: { scope: 'profile', path: 'camera.fovDeg' }, min: 60, max: 100, step: 5 },
    { k: 'choice', id: 'c', label: 'settings.camera.mode', bind: { scope: 'profile', path: 'camera.defaultMode' }, options: [{ value: 'tp', label: 'settings.camera.tp' }, { value: 'fp', label: 'settings.camera.fp' }] },
    { k: 'choice', id: 'cd', label: 'settings.graphics.fps', bind: { scope: 'device', path: 'fpsCap' }, disabled: 'settings.graphics.fps.later', options: [{ value: 'auto', label: 'settings.auto' }, { value: 30, label: 'settings.fps.30' }] },
    { k: 'list', id: 'l', rows: [{ id: 'r1', text: 'one' }, { id: 'r2', text: 'two', disabled: true }], onPress: { call: 'x' }, empty: 'load.empty' },
    { k: 'list', id: 'empty', rows: [], onPress: { call: 'x' }, empty: 'load.empty' },
    {
      k: 'tabs', id: 'tabs',
      tabs: [
        { id: 'one', label: 'settings.audio', children: [{ k: 'button', id: 'in1', label: 'common.back', style: 'secondary', onPress: { back: true } }] },
        { id: 'two', label: 'settings.camera', children: [{ k: 'toggle', id: 'in2', label: 'settings.camera.shake', bind: { scope: 'ui', path: 'showFps' } }, { k: 'spacer', size: 2 }] },
      ],
    },
    { k: 'progress', value: 0.4 },
    { k: 'table', columns: ['common.back'], rows: [['a'], ['b']] },
    { k: 'image', asset: 'ui/x', alt: 'common.back' },
    { k: 'spacer', size: 1 },
  ],
};

function registered(): { name: string; screen: ScreenDef }[] {
  const out = [{ name: 'fixture', screen: fixture }, { name: 'modes', screen: modesScreen([{ id: 'story', text: 'Story' }, { id: 'racing', text: 'Racing', disabled: true }], true) }];
  for (const xr of [true, false]) {
    for (const cat of CATEGORIES) {
      const s = categoryScreen(cat.id, env({ xrCapable: xr, deviceClass: xr ? 'xr' : 'desktop', installable: xr, ios: !xr, standalone: false, updateReady: xr }));
      if (s) out.push({ name: `${cat.id}${xr ? '' : '-flat'}`, screen: s });
    }
  }
  return out;
}

const sandboxEnv: PhoneEnv = {
  mode: 'sandbox', jobs: [], cashCents: 0, garage: [], ride: undefined, heat: 1, neverWanted: false, appRows: [],
  sandboxPlayer: { godMode: true, superJump: false, carNoDamage: true, car: 'near', online: false },
  sandboxTeleport: { positions: [{ name: 'pos-1', x: 10, z: -20 }, { name: 'pos-2', x: 30, z: 40 }], previous: true },
  sandboxVehicles: {
    catalog: [
      { prefab: 'vehicle.compact', cls: 'D', nameKey: 'sandbox.car.compact' },
      { prefab: 'vehicle.kestrel-quill', cls: 'C', nameKey: 'sandbox.car.kestrel-quill' },
      { prefab: 'vehicle.halcyon-cormorant', cls: 'R', nameKey: 'sandbox.car.halcyon-cormorant' },
    ],
    owned: [{ key: 'veh:sbx0', nameKey: 'sandbox.car.compact' }], cap: 8, pending: null, online: false,
  },
  sandboxWorld: { weather: 'rain', hour: 18.5, paused: false, sync: false, timeScale: 2, blackout: false, density: { traffic: 1, ped: 0, parked: 1.5 }, shortcuts: ['fog-dawn', 'burn-off', 'golden-hour', 'fog-returns'], online: false },
};

describe('ui-screen-parity: the Sandbox app tabs (M04e1 AC-9, M04e2 AC-7)', () => {
  for (const online of [false, true]) {
    for (const tab of ['player', 'weather', 'time', 'world', 'teleport', 'vehicles', 'display']) {
      it(`${tab}${online ? ' (online)' : ''}: DomScreen and CanvasScreen list the same focusables in the same order`, () => {
        const screen = appScreen('sandbox', { ...sandboxEnv, sandboxWorld: { ...sandboxEnv.sandboxWorld!, online }, sandboxVehicles: { ...sandboxEnv.sandboxVehicles!, online }, sandboxPlayer: { ...sandboxEnv.sandboxPlayer!, online } });
        const ctx = ctxWith(tab);
        const dom = domFocus(DomScreen({ screen, ctx }));
        const canvas = new CanvasScreen(screen, ctx).focusOrder();
        expect(canvas).toEqual(dom);
        expect(new Set(dom).size).toBe(dom.length);
        expect(dom.some((f) => f.startsWith(`tab.sandbox-tabs.${tab}`))).toBe(true);
        expect(dom.length).toBeGreaterThan(5);
      });
    }
  }
});

describe('ui-screen-parity (AC-12)', () => {
  it('has screens to compare', () => {
    expect(registered().length).toBeGreaterThan(20);
  });

  for (const tab of [undefined, 'two']) {
    for (const { name, screen } of registered()) {
      it(`${name}${tab ? ` (tab ${tab})` : ''}: DomScreen and CanvasScreen list the same focusables in the same order`, () => {
        const ctx = ctxWith(tab);
        const dom = domFocus(DomScreen({ screen, ctx }));
        const canvas = new CanvasScreen(screen, ctx).focusOrder();
        expect(canvas).toEqual(dom);
        // No focus id appears twice.
        expect(new Set(dom).size).toBe(dom.length);
      });
    }
  }

  it('CanvasScreen presses act like DomScreen: a ray press runs the action, sets a setting, switches a tab', () => {
    const calls: string[] = [];
    const store = new Map<string, unknown>();
    let tab = 'one';
    const ctx: ScreenCtx = {
      get: (r) => store.get(`${r.scope}:${r.path}`) as never,
      set: (r, v) => void store.set(`${r.scope}:${r.path}`, v),
      run: (a, row) => void calls.push(`${JSON.stringify(a)}|${row ?? ''}`),
      tab: () => tab,
      setTab: (_id, t) => {
        tab = t;
      },
    };
    const cs = new CanvasScreen(fixture, ctx, 1000);
    const press = (fid: string): void => {
      const it = cs.layout.items.find((i) => i.fid === fid);
      expect(it, fid).toBeDefined();
      const r = it!.rect;
      cs.pick((r.x + r.w / 2) / cs.width, (r.y + r.h / 2) / cs.height, true);
    };
    press('button.a');
    expect(calls[0]).toContain('"back":true');
    press('toggle.t');
    expect(store.get('profile:camera.shake')).toBe(true);
    press('choice.c.1');
    expect(store.get('profile:camera.defaultMode')).toBe('fp');
    press('row.l.r1');
    expect(calls.at(-1)).toContain('|r1');
    const before = calls.length;
    press('row.l.r2');
    press('button.b');
    expect(calls).toHaveLength(before);
    press('tab.tabs.two');
    expect(tab).toBe('two');
    expect(cs.focusOrder()).toContain('toggle.in2');
    // A slider press sets a stepped value inside its range.
    press('slider.s');
    const fov = store.get('profile:camera.fovDeg') as number;
    expect(fov).toBeGreaterThanOrEqual(60);
    expect(fov).toBeLessThanOrEqual(100);
    expect(fov % 5).toBe(0);
  });

  it('CanvasScreen draws without a DOM', () => {
    const ops: string[] = [];
    const g = new Proxy({} as Canvas2DLike, {
      get: (_t, k) => (typeof k === 'string' && /^(fillRect|strokeRect|fillText|clearRect)$/.test(k) ? () => void ops.push(k) : undefined),
      set: () => true,
    });
    new CanvasScreen(fixture, ctxWith()).draw(g);
    expect(ops).toContain('fillText');
    expect(layoutScreen(fixture, ctxWith(), 800).height).toBeGreaterThan(300);
  });
});

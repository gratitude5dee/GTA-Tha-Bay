import { describe, expect, it } from 'vitest';
import { appScreen, homeScreen, placeName, stepHour, type PhoneEnv, type SandboxWorldView } from '../src/phone/apps.ts';
import { PHONE_APPS, appDef, visibleApps } from '../src/phone/registry.ts';
import { pauseScreen } from '../src/phone/pause.tsx';
import type { ScreenDef, Widget } from '../src/screen/types.ts';
import en from '../../../content/ui/i18n/en.json';

const cat = en as Record<string, string>;
const env = (over: Partial<PhoneEnv> = {}): PhoneEnv => ({
  mode: 'story', jobs: [], cashCents: 125000, garage: [], ride: undefined, heat: 0, neverWanted: false, appRows: [], ...over,
});

/** Every LocKey a screen names, to check the catalog covers it. */
function keys(s: ScreenDef): string[] {
  const out: string[] = [s.title];
  const walk = (w: Widget): void => {
    if (w.k === 'heading' || w.k === 'text') out.push(w.text);
    else if (w.k === 'button') {
      out.push(w.label);
      if (w.disabled) out.push(w.disabled);
    } else if (w.k === 'list') out.push(w.empty);
    else if (w.k === 'tabs') for (const tab of w.tabs) tab.children.forEach(walk);
  };
  s.children.forEach(walk);
  return out;
}

describe('phone registry (AC-6)', () => {
  it('lists Map, Jobs, Garage, Bank, Ride, Settings and Help; Camera and Feed are comingSoon tiles; Messages opens (M05c2)', () => {
    const ids = visibleApps({ mode: 'story' }).map((a) => a.id);
    for (const id of ['map', 'jobs', 'garage', 'bank', 'ride', 'settings', 'help']) expect(ids).toContain(id);
    for (const id of ['camera', 'feed']) expect(appDef(id)?.comingSoon, id).toBe(true);
    expect(appDef('messages')?.comingSoon).toBeUndefined();
    for (const a of PHONE_APPS.filter((x) => x.id !== 'camera' && x.id !== 'feed')) expect(a.comingSoon).toBeUndefined();
  });

  it('Sandbox appears only in the sandbox mode', () => {
    expect(visibleApps({ mode: 'story' }).map((a) => a.id)).not.toContain('sandbox');
    expect(visibleApps({ mode: null }).map((a) => a.id)).not.toContain('sandbox');
    expect(visibleApps({ mode: 'sandbox' }).map((a) => a.id)).toContain('sandbox');
  });

  it('every app builds a screen whose text is in the catalog, and the apps pause the sim', () => {
    for (const a of PHONE_APPS) {
      const s = a.screen(env({ ride: { ready: true, destinations: [{ id: 'st1', nameKey: 'x.y', x: 1, z: 2 }] } }));
      for (const k of keys(s)) expect(cat[k], `${a.id}: ${k}`).toBeTypeOf('string');
      expect(a.pauses).toBe(true);
      expect(a.xr).toBe('panel');
      expect(cat[a.titleKey], a.titleKey).toBeTypeOf('string');
    }
  });

  it('Ride lists the destinations as a list and offers the robotaxi; without a world it says so', () => {
    const ready = appScreen('ride', env({ ride: { ready: true, destinations: [{ id: 'transit.civic', nameKey: 'place.civic', x: 1, z: 2 }, { id: 'transit.mission', nameKey: 'place.mission', x: 5, z: 6 }] } }));
    const list = ready.children.find((w) => w.k === 'list');
    expect(list && list.k === 'list' ? list.rows.map((r) => r.id) : []).toEqual(['transit.civic', 'transit.mission']);
    expect(ready.children.some((w) => w.k === 'button' && w.id === 'ride-taxi')).toBe(true);
    const off = appScreen('ride', env({ ride: { ready: false, destinations: [] } }));
    expect(off.children.some((w) => w.k === 'list')).toBe(false);
    expect(placeName('no.such.key', 'transit.civic-center')).toBe('Civic Center');
  });

  const tabsOf = (s: ScreenDef): Extract<Widget, { k: 'tabs' }> => s.children.find((w): w is Extract<Widget, { k: 'tabs' }> => w.k === 'tabs')!;
  const buttonsIn = (s: ScreenDef, tab: string): Extract<Widget, { k: 'button' }>[] =>
    tabsOf(s).tabs.find((x) => x.id === tab)!.children.filter((w): w is Extract<Widget, { k: 'button' }> => w.k === 'button');
  const world = (over: Partial<SandboxWorldView> = {}): SandboxWorldView => ({
    weather: null, hour: 7.5, paused: false, sync: false, timeScale: 1, blackout: false, density: { traffic: 1, ped: 1, parked: 1 }, shortcuts: ['fog-dawn', 'burn-off', 'golden-hour', 'fog-returns'], online: false, ...over,
  });

  it('Sandbox sets the heat 0 to 5 through sandbox.set (player tab)', () => {
    const s = appScreen('sandbox', env({ mode: 'sandbox', heat: 2, sandboxWorld: world() }));
    const heats = buttonsIn(s, 'player').filter((w) => w.id.startsWith('heat-'));
    expect(heats.map((h) => h.id)).toEqual(['heat-0', 'heat-1', 'heat-2', 'heat-3', 'heat-4', 'heat-5']);
    expect(heats[2]!.style).toBe('primary');
    expect(heats[2]!.onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.player.heat', v: 2 } });
    expect(buttonsIn(s, 'player').some((w) => w.id === 'never-wanted')).toBe(true);
  });

  it('Sandbox is a tabs widget: player, weather, time, world (AC-9)', () => {
    const s = appScreen('sandbox', env({ mode: 'sandbox', sandboxWorld: world() }));
    const tabs = tabsOf(s);
    expect(tabs.id).toBe('sandbox-tabs');
    expect(tabs.tabs.map((x) => x.id)).toEqual(['player', 'weather', 'time', 'world']);
    for (const k of keys(s)) expect(cat[k], k).toBeDefined();
  });

  it('Weather: six presets and Natural, the held one is primary, each press is a sandbox.set', () => {
    const rain = buttonsIn(appScreen('sandbox', env({ sandboxWorld: world({ weather: 'rain' }) })), 'weather');
    expect(rain.map((b) => b.id)).toEqual(['weather-natural', 'weather-clear', 'weather-karl-fog', 'weather-overcast', 'weather-rain', 'weather-smoke', 'weather-golden']);
    expect(rain.filter((b) => b.style === 'primary').map((b) => b.id)).toEqual(['weather-rain']);
    expect(rain[4]!.onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.weather.preset', v: 3 } });
    expect(rain[0]!.onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.weather.preset', v: -1 } });
    expect(rain[2]!.label).toBe('hud.weather.karl-fog');
    const natural = buttonsIn(appScreen('sandbox', env({ sandboxWorld: world() })), 'weather');
    expect(natural.filter((b) => b.style === 'primary').map((b) => b.id)).toEqual(['weather-natural']);
  });

  it('Time: the hour as the HUD clock shows it, wrapped half-hour steps, pause, sync and the shortcuts', () => {
    const s = appScreen('sandbox', env({ sandboxWorld: world({ hour: 23.75, paused: true, sync: true }) }));
    const time = tabsOf(s).tabs.find((x) => x.id === 'time')!.children;
    const line = time.find((w) => w.k === 'text');
    expect(line && line.k === 'text' ? line.params : null).toEqual({ label: 'Time', time: '23:45' });
    const b = buttonsIn(s, 'time');
    const by = (id: string) => b.find((x) => x.id === id)!;
    expect(by('time-minus').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.time.hour', v: 23 } });
    expect(by('time-plus').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.time.hour', v: 1 } });
    expect(by('time-pause').label).toBe('phone.sandbox.resume');
    expect(by('time-pause').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.time.paused', v: false } });
    expect(by('time-sync').style).toBe('primary');
    expect(by('time-sync').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.time.sync', v: false } });
    expect(by('shortcut-golden-hour').onPress).toEqual({ cmd: { t: 'mode.cmd', mode: 'sandbox', name: 'time.shortcut', args: { id: 'golden-hour' } } });
    expect(by('shortcut-fog-dawn').label).toBe('phone.sandbox.time.fog-dawn');
    expect(stepHour(0.2, -1)).toBe(23);
  });

  it('World: speed, blackout and the three density rows mark the stored level as primary', () => {
    const s = appScreen('sandbox', env({ sandboxWorld: world({ timeScale: 2, blackout: true, density: { traffic: 0, ped: 0.35, parked: 1.5 } }) }));
    const b = buttonsIn(s, 'world');
    const primary = b.filter((x) => x.style === 'primary').map((x) => x.id);
    expect(primary).toEqual(['speed-2', 'blackout', 'density-traffic-off', 'density-ped-light', 'density-parked-busy']);
    const by = (id: string) => b.find((x) => x.id === id)!;
    expect(by('speed-025').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.world.timeScale', v: 0.25 } });
    expect(by('blackout').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.world.blackout', v: false } });
    expect(by('density-ped-normal').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.world.density.ped', v: 1 } });
    expect(by('world-reset').onPress).toEqual({ cmd: { t: 'mode.cmd', mode: 'sandbox', name: 'world.reset' } });
  });

  it('online: every new button is disabled with sandbox.refuse.online, the heat buttons are as they were', () => {
    const s = appScreen('sandbox', env({ sandboxWorld: world({ online: true }) }));
    for (const tab of ['weather', 'time', 'world']) {
      const bs = buttonsIn(s, tab);
      expect(bs.length).toBeGreaterThan(3);
      for (const x of bs) expect(x.disabled, x.id).toBe('sandbox.refuse.online');
    }
    for (const x of buttonsIn(s, 'player')) expect(x.disabled).toBeUndefined();
    const on = buttonsIn(appScreen('sandbox', env({ sandboxWorld: world() })), 'world');
    for (const x of on) expect(x.disabled).toBeUndefined();
  });

  it('without a published view model the tabs still build', () => {
    const s = appScreen('sandbox', env({ mode: 'sandbox' }));
    expect(tabsOf(s).tabs).toHaveLength(4);
  });

  it('the home screen lists the rows it is given and has a close button', () => {
    const s = homeScreen({ appRows: [{ id: 'map', text: 'Map' }] });
    expect(s.children.some((w) => w.k === 'list')).toBe(true);
    expect(s.children.some((w) => w.k === 'button' && w.id === 'phone-close')).toBe(true);
  });

  it('Bank shows the balance', () => {
    const s = appScreen('bank', env({ cashCents: 98700 }));
    const text = s.children.find((w) => w.k === 'text' && w.params);
    expect(text && text.k === 'text' ? text.params : null).toEqual({ amount: '$987' });
  });
});

describe('pause menu (AC-6)', () => {
  const buttons = (s: ScreenDef): Extract<Widget, { k: 'button' }>[] => s.children.filter((w): w is Extract<Widget, { k: 'button' }> => w.k === 'button');

  it('has Resume, Save, Load, Phone, Settings, Help, Report and Quit in order', () => {
    const ids = buttons(pauseScreen({ atSafehouse: false, lastSave: null, otherTab: false })).map((b) => b.id);
    expect(ids).toEqual(['pause-resume', 'pause-save', 'pause-load', 'pause-phone', 'pause-settings', 'pause-help', 'pause-report', 'pause-quit']);
  });

  it('Save is disabled away from a safehouse with its reason text, and enabled at one', () => {
    const away = buttons(pauseScreen({ atSafehouse: false, lastSave: null, otherTab: false })).find((b) => b.id === 'pause-save')!;
    expect(away.disabled).toBe('pause.save.away');
    expect(cat['pause.save.away']).toBe('Save at a safehouse');
    const at = buttons(pauseScreen({ atSafehouse: true, lastSave: null, otherTab: false })).find((b) => b.id === 'pause-save')!;
    expect(at.disabled).toBeUndefined();
    expect(at.onPress).toEqual({ cmd: { t: 'save.request', reason: 'safehouse' } });
  });

  it('shows the last save line when there is one, and every key is in the catalog', () => {
    const s = pauseScreen({ atSafehouse: true, lastSave: 'now', otherTab: false });
    expect(s.children.some((w) => w.k === 'text' && w.params?.['line'] === 'now')).toBe(true);
    for (const k of keys(s)) expect(cat[k], k).toBeTypeOf('string');
  });

  it('a second tab disables Save with the other-tab reason', () => {
    const b = buttons(pauseScreen({ atSafehouse: true, lastSave: null, otherTab: true })).find((x) => x.id === 'pause-save')!;
    expect(b.disabled).toBe('banner.otherTab.short');
  });
});


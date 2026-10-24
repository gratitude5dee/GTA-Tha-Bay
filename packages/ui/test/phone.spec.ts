import { describe, expect, it } from 'vitest';
import { appScreen, homeScreen, placeName, type PhoneEnv } from '../src/phone/apps.ts';
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

  it('Sandbox sets the heat 0 to 5 through sandbox.set', () => {
    const s = appScreen('sandbox', env({ mode: 'sandbox', heat: 2 }));
    const heats = s.children.filter((w): w is Extract<Widget, { k: 'button' }> => w.k === 'button' && w.id.startsWith('heat-'));
    expect(heats).toHaveLength(6);
    expect(heats[2]!.style).toBe('primary');
    expect(heats[2]!.onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.player.heat', v: 2 } });
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


import { describe, expect, it } from 'vitest';
import { DISPLAY_NAME, SHORT_NAME } from '../../../config/brand.ts';
import { appScreen, SANDBOX_LANDMARK_IDS, SANDBOX_SPOT_LIMIT, type PhoneEnv, type SandboxWorldView } from '../src/phone/apps.ts';
import { HIDE_HUD, HIDE_MINIMAP, hudHidden } from '../src/hud/model.ts';
import type { ListRow, Widget } from '../src/screen/types.ts';
import en from '../../../content/ui/i18n/en.json';
import landmarks from '../../../content/world/landmarks.json';
import teleports from '../../../content/world/teleports.json';

const cat = en as Record<string, string>;
const world = (over: Partial<SandboxWorldView> = {}): SandboxWorldView => ({
  weather: null, hour: 12, paused: false, sync: false, timeScale: 1, blackout: false, density: { traffic: 1, ped: 1, parked: 1 }, shortcuts: [], online: false, ...over,
});
const env = (over: Partial<PhoneEnv> = {}): PhoneEnv => ({
  mode: 'sandbox', jobs: [], cashCents: 0, garage: [], ride: undefined, heat: 0, neverWanted: false, appRows: [], sandboxWorld: world(),
  sandboxTeleport: { positions: [{ name: 'pos-1', x: 10, z: -20 }, { name: 'My corner', x: 1, z: 2 }], previous: true }, ...over,
});

const tabIn = (e: PhoneEnv, id: string): Widget[] => {
  const tabs = appScreen('sandbox', e).children.find((w): w is Extract<Widget, { k: 'tabs' }> => w.k === 'tabs');
  const tab = tabs?.tabs.find((x) => x.id === id);
  if (!tab) throw new Error(`no tab ${id}`);
  return tab.children;
};
const button = (ws: Widget[], id: string): Extract<Widget, { k: 'button' }> => {
  const b = ws.find((w): w is Extract<Widget, { k: 'button' }> => w.k === 'button' && w.id === id);
  if (!b) throw new Error(`no button ${id}`);
  return b;
};
const list = (ws: Widget[], id: string): Extract<Widget, { k: 'list' }> => {
  const l = ws.find((w): w is Extract<Widget, { k: 'list' }> => w.k === 'list' && w.id === id);
  if (!l) throw new Error(`no list ${id}`);
  return l;
};

describe('the Sandbox app Teleport and Display tabs (AC-7)', () => {
  it('adds the two tabs after the M04e1 tabs', () => {
    const tabs = appScreen('sandbox', env()).children.find((w) => w.k === 'tabs') as Extract<Widget, { k: 'tabs' }>;
    expect(tabs.tabs.map((x) => x.id)).toEqual(['player', 'weather', 'time', 'world', 'teleport', 'display']);
  });

  it('lists the 37 landmarks in teleports.json order, each with a real name', () => {
    expect(SANDBOX_LANDMARK_IDS).toHaveLength(37);
    const rows = list(tabIn(env(), 'teleport'), 'sandbox-landmarks').rows;
    expect(rows.map((r) => r.id)).toEqual(teleports.sandbox);
    for (const r of rows) {
      expect(r.text, r.id).not.toMatch(/^place\./);
      expect(cat[`place.${r.id.slice(3)}`], r.id).toBe(r.text);
    }
    expect(rows.find((r) => r.id === 'lm.coit-tower')?.text).toBe('Coit Tower');
    expect(rows.every((r) => !r.disabled)).toBe(true);
  });

  it('every teleports.json id is a landmark of landmarks.json', () => {
    const ids = new Set((landmarks as { landmarks: { id: string }[] }).landmarks.map((l) => l.id));
    for (const id of teleports.sandbox) expect(ids.has(id), id).toBe(true);
  });

  it('shows numbered spots as "Spot n" and other names as they are', () => {
    const rows: ListRow[] = list(tabIn(env(), 'teleport'), 'sandbox-spots').rows;
    expect(rows.map((r) => r.id)).toEqual(['pos-1', 'My corner']);
    expect(rows.map((r) => r.text)).toEqual(['Spot {n}'.replace('{n}', '1'), 'My corner']);
  });

  it('disables back with its reason and the save button when all spots are taken', () => {
    const none = tabIn(env({ sandboxTeleport: { positions: [], previous: false } }), 'teleport');
    expect(button(none, 'sandbox-back').disabled).toBe('phone.sandbox.noPrevious');
    expect(button(none, 'sandbox-spot-save').disabled).toBeUndefined();
    expect(list(none, 'sandbox-spots').empty).toBe('phone.sandbox.spotsEmpty');
    const full = tabIn(env({ sandboxTeleport: { positions: Array.from({ length: SANDBOX_SPOT_LIMIT }, (_, i) => ({ name: `pos-${i + 1}`, x: i, z: i })), previous: true } }), 'teleport');
    expect(button(full, 'sandbox-spot-save').disabled).toBe('phone.sandbox.spotsFull');
    expect(button(full, 'sandbox-back').disabled).toBeUndefined();
  });

  it('switches the forget button and sends the save as a sandbox action', () => {
    const t = tabIn(env({ forgetting: true }), 'teleport');
    expect(button(t, 'sandbox-spot-forget').label).toBe('phone.sandbox.spotForgetDone');
    expect(button(tabIn(env(), 'teleport'), 'sandbox-spot-forget').label).toBe('phone.sandbox.spotForget');
    expect(button(t, 'sandbox-spot-save').onPress).toEqual({ cmd: { t: 'mode.cmd', mode: 'sandbox', name: 'position.save' } });
  });

  it('the display buttons send the two sandbox.set paths with the negated value', () => {
    const shown = tabIn(env(), 'display');
    expect(button(shown, 'sandbox-hide-hud').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.display.hideHud', v: true } });
    expect(button(shown, 'sandbox-hide-minimap').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.display.hideMinimap', v: true } });
    expect(button(shown, 'sandbox-hide-hud').label).toBe('phone.sandbox.hudShown');
    const hidden = tabIn(env({ hideHud: true, hideMinimap: true }), 'display');
    expect(button(hidden, 'sandbox-hide-hud').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.display.hideHud', v: false } });
    expect(button(hidden, 'sandbox-hide-minimap').onPress).toEqual({ cmd: { t: 'sandbox.set', path: 'sandbox.display.hideMinimap', v: false } });
    expect(button(hidden, 'sandbox-hide-hud').label).toBe('phone.sandbox.hudHidden');
    expect(button(hidden, 'sandbox-hide-minimap').label).toBe('phone.sandbox.mapHidden');
  });

  it('greys out every new control online', () => {
    const online = env({ sandboxWorld: world({ online: true }), forgetting: false });
    const t = tabIn(online, 'teleport');
    for (const id of ['sandbox-waypoint', 'sandbox-back', 'sandbox-spot-save', 'sandbox-spot-forget']) expect(button(t, id).disabled, id).toBe('sandbox.refuse.online');
    expect(list(t, 'sandbox-landmarks').rows.every((r) => r.disabled === true)).toBe(true);
    expect(list(t, 'sandbox-spots').rows.every((r) => r.disabled === true)).toBe(true);
    const d = tabIn(online, 'display');
    for (const id of ['sandbox-hide-hud', 'sandbox-hide-minimap']) expect(button(d, id).disabled, id).toBe('sandbox.refuse.online');
  });

  it('every key the two tabs name is in the catalog', () => {
    const keys: string[] = [];
    for (const id of ['teleport', 'display']) {
      for (const w of tabIn(env(), id)) {
        if (w.k === 'heading' || w.k === 'text') keys.push(w.text);
        if (w.k === 'button') keys.push(w.label);
        if (w.k === 'list') keys.push(w.empty);
      }
    }
    for (const k of keys) expect(cat[k], k).toBeTypeOf('string');
  });
});

describe('hudHidden (AC-8)', () => {
  const T = (hud: boolean, map: boolean): Record<string, boolean> => ({ [HIDE_HUD]: hud, [HIDE_MINIMAP]: map });
  const none = { tl: false, tr: false, bl: false, br: false, tip: false, prompt: false };

  it('hideHud in a single-player sandbox hides the corners, the tip bar and the prompt', () => {
    expect(hudHidden('sandbox', T(true, false), false)).toEqual({ tl: true, tr: true, bl: true, br: true, tip: true, prompt: true });
    expect(hudHidden('sandbox', T(true, true), false)).toEqual({ tl: true, tr: true, bl: true, br: true, tip: true, prompt: true });
  });

  it('hideMinimap alone hides bl only', () => {
    expect(hudHidden('sandbox', T(false, true), false)).toEqual({ ...none, bl: true });
  });

  it('shows everything with the toggles off, in story, and online whatever the toggles are', () => {
    expect(hudHidden('sandbox', T(false, false), false)).toEqual(none);
    expect(hudHidden('sandbox', {}, false)).toEqual(none);
    expect(hudHidden('sandbox', undefined, false)).toEqual(none);
    for (const hud of [false, true]) for (const map of [false, true]) {
      expect(hudHidden('story', T(hud, map), false)).toEqual(none);
      expect(hudHidden('story', T(hud, map), true)).toEqual(none);
      expect(hudHidden('sandbox', T(hud, map), true)).toEqual(none);
    }
    expect(hudHidden(null, T(true, true), false)).toEqual(none);
  });

  it('has no field for subtitles or the centre region: they never hide', () => {
    expect(Object.keys(hudHidden('sandbox', T(true, true), false)).sort()).toEqual(['bl', 'br', 'prompt', 'tip', 'tl', 'tr']);
  });
});

describe('the new strings (AC-11)', () => {
  const keys = Object.keys(cat).filter((k) => /^(phone\.sandbox\.(tab\.(teleport|display)|landmarks|waypoint|back|noPrevious|spots|spotSave|spotForget|spotForgetDone|spotsFull|spotsEmpty|hudShown|hudHidden|mapShown|mapHidden|displayNote)|sandbox\.(teleport|position)\.|place\.)/.test(k));

  it('has the 37 place names and the sandbox keys', () => {
    expect(keys.filter((k) => k.startsWith('place.'))).toHaveLength(37);
    expect(keys.length).toBeGreaterThanOrEqual(37 + 26);
  });

  it('names no brand, and the pier is a plain description', () => {
    for (const k of keys) {
      expect(cat[k], k).not.toContain(DISPLAY_NAME);
      expect(cat[k], k).not.toContain(SHORT_NAME);
    }
    expect(cat['place.pier-39']).toBe('Sea lion pier');
  });
});

/**
 * The Settings page (10-ui-pages.md section 2.9): a category list and the page of one category. Every category except Controls is a
 * data-driven `ScreenDef` (XR-capable), drawn by `DomScreen`; each row carries a scope badge ("This profile" or "This device").
 */
import { h, type FunctionComponent } from 'preact';
import type { ControlsSettings, JsonValue, ProfileSettings } from '@dv/shared';
import { lk, t } from '../../i18n/index.ts';
import { ScreenHost } from '../../screen/dom-screen.tsx';
import type { ScreenDef, SettingRef, UiAction } from '../../screen/types.ts';
import { Link, useShell } from '../../shell/context.tsx';
import { defaultPrefs } from '../../shell/prefs.ts';
import type { PageProps, ShellApi, ShellContext, StorageInfo, UiPrefs } from '../../shell/types.ts';
import { useAsync } from '../../kit/widgets.tsx';
import { accessibilityScreen, audioScreen, cutscenesScreen, npcScreen, subtitlesScreen } from './audio-access.ts';
import { ControlsPanel } from './controls.tsx';
import { cameraScreen, graphicsScreen, languageScreen, xrScreen } from './display.ts';
import { aboutScreen, installScreen, privacyScreen } from './privacy-storage.ts';

/** What the category builders need to know about the device and the session. */
export interface SettingsEnv {
  xrCapable: boolean;
  deviceClass: 'desktop' | 'mobile' | 'xr';
  tierChoices: readonly string[];
  tierLine: string;
  backend: string;
  storage: StorageInfo | null;
  installable: boolean;
  ios: boolean;
  standalone: boolean;
  build: string;
  updateReady: boolean;
  ageStatus: string;
}

const EMPTY_CONTROLS: ControlsSettings = {
  schema: 1, overrides: {}, holdToToggle: [], lookSensitivity: { kbm: 1, gamepad: 1, touch: 1 }, invertY: false,
  deadzones: { stickInner: 0.1, stickOuter: 0.95, trigger: 0.05 }, touch: { layout: 'default-right', tiltSteer: false, stickRadiusPx: 64, opacity: 0.7 },
};

export interface Category { id: string; labelKey: string }

/** The settings categories in menu order (10-ui-pages.md section 2.9; mode options arrive with the modes). */
export const CATEGORIES: readonly Category[] = [
  { id: 'graphics', labelKey: lk('settings.graphics') },
  { id: 'controls', labelKey: lk('settings.controls') },
  { id: 'audio', labelKey: lk('settings.audio') },
  { id: 'subtitles', labelKey: lk('settings.subtitles') },
  { id: 'npc', labelKey: lk('settings.npc') },
  { id: 'cutscenes', labelKey: lk('settings.cutscenes') },
  { id: 'accessibility', labelKey: lk('settings.accessibility') },
  { id: 'xr', labelKey: lk('settings.xr') },
  { id: 'camera', labelKey: lk('settings.camera') },
  { id: 'language', labelKey: lk('settings.language') },
  { id: 'privacy', labelKey: lk('settings.privacy') },
  { id: 'install', labelKey: lk('settings.install') },
  { id: 'about', labelKey: lk('settings.about') },
];

/** The ScreenDef of a category, or null for Controls (a custom panel). */
export function categoryScreen(id: string, env: SettingsEnv): ScreenDef | null {
  switch (id) {
    case 'graphics': return graphicsScreen(env);
    case 'audio': return audioScreen();
    case 'subtitles': return subtitlesScreen();
    case 'npc': return npcScreen();
    case 'cutscenes': return cutscenesScreen();
    case 'accessibility': return accessibilityScreen();
    case 'xr': return xrScreen(env);
    case 'camera': return cameraScreen();
    case 'language': return languageScreen();
    case 'privacy': return privacyScreen(env);
    case 'install': return installScreen(env);
    case 'about': return aboutScreen(env);
    default: return null;
  }
}

/** Profile defaults the "Reset category" action writes (mirrors the sim's `defaultSettings()`; a unit test compares the two). */
export const PROFILE_DEFAULTS: Readonly<Record<string, Record<string, JsonValue>>> = {
  audio: { 'audio.master': 1, 'audio.music': 0.8, 'audio.sfx': 1, 'audio.ambience': 0.8, 'audio.voice': 1, 'audio.radio': 0.7, 'audio.ui': 0.8, 'audio.cutscene': 1 },
  subtitles: { 'subtitles.on': true, 'subtitles.size': 'm', 'subtitles.background': true, 'subtitles.speakerNames': true },
  camera: { 'camera.defaultMode': 'tp', 'camera.fovDeg': 70, 'camera.shoulder': 'right', 'camera.shake': true },
  accessibility: { 'accessibility.hudPalette': 'default', 'accessibility.timerScale': 1, 'accessibility.autoBlockStoryFights': false, 'accessibility.pauseOnTycoonEvents': false },
  npc: { 'npc.voice': 'all', 'npc.aiDialogue': true },
  cutscenes: { 'cutscenes.generated': true, 'cutscenes.audio': 'engine' },
  xr: {
    'xr.locomotion': 'teleport', 'xr.turn': 'snap', 'xr.snapAngleDeg': 30, 'xr.smoothSpeedMps': 4, 'xr.quantizeVelocity': true, 'xr.vignette': 'medium', 'xr.comfortAssist': 0.5,
    'xr.seated': false, 'xr.dominantHand': 'right', 'xr.cockpitHorizonLock': true, 'xr.chaseView': 'cockpit', 'xr.arenaScale': 'tabletop', 'xr.handsEnabled': true, 'xr.uiDistanceM': 1.2,
  },
};
export const DEVICE_DEFAULTS: Readonly<Record<string, Record<string, JsonValue>>> = {
  graphics: { tierOverride: 'auto', compatibilityMode: false, fpsCap: 'auto', renderScale: 'auto', foveation: 'auto', dataSaver: false },
};
const UI_DEFAULTS_BY_CAT: Readonly<Record<string, readonly (keyof UiPrefs)[]>> = {
  graphics: ['showFps'],
  accessibility: ['uiScale', 'highContrast', 'focusRing', 'hudScale', 'hudOpacity', 'hudSafeMarginPct', 'units', 'showTips', 'announce'],
  subtitles: ['soundCaptions'],
};

/** Writes the defaults of one category through the binder. Reduced motion is initialised at profile creation, so it is not reset. */
export function resetCategory(cat: string, set: (ref: SettingRef, v: JsonValue) => void): void {
  for (const [path, v] of Object.entries(PROFILE_DEFAULTS[cat] ?? {})) set({ scope: 'profile', path }, v);
  for (const [path, v] of Object.entries(DEVICE_DEFAULTS[cat] ?? {})) set({ scope: 'device', path }, v);
  const ui = defaultPrefs();
  for (const key of UI_DEFAULTS_BY_CAT[cat] ?? []) set({ scope: 'ui', path: key }, ui[key] as JsonValue);
}

function copy(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

export function buildEnv(ctx: ShellContext, storage: StorageInfo | null): SettingsEnv {
  const p = ctx.platform;
  const info = p?.tierInfo() ?? { tier: 'desktop', source: 'auto', backend: 'webgl2' };
  const att = ctx.props.prefs.get().age;
  return {
    xrCapable: p?.xrCapable ?? false,
    deviceClass: p?.deviceClass ?? 'desktop',
    tierChoices: p?.tierChoices() ?? [],
    tierLine: `${info.tier} (${info.source})`,
    backend: info.backend,
    storage,
    installable: p?.install?.canPrompt() ?? false,
    ios: p?.install?.isIos ?? false,
    standalone: p?.install?.standalone ?? false,
    build: ctx.props.build,
    updateReady: ctx.props.update?.updateAvailable ?? false,
    ageStatus: att.attestedAt ? new Date(att.attestedAt).toLocaleDateString() : '-',
  };
}

export function SettingsPage(props: PageProps) {
  const { shell, ctx } = useShell();
  const cat = CATEGORIES.some((c) => c.id === props.params['cat']) ? (props.params['cat'] as string) : 'graphics';
  const storage = useAsync(() => (ctx.platform ? ctx.platform.storage() : Promise.resolve(null)), [cat === 'install']);
  const env = buildEnv(ctx, storage.data ?? null);
  const screen = categoryScreen(cat, env);
  const binder = ctx.binder;
  const run = (action: UiAction, rowId?: string): void => runAction(action, rowId, { cat, ctx, shell, storageReload: storage.reload });
  const nav = h(
    'nav',
    { class: 'dv-settings-nav', 'aria-label': t('nav.settings'), 'data-testid': 'settings-nav' },
    CATEGORIES.map((c) => h(Link as unknown as FunctionComponent<Record<string, unknown>>, { key: c.id, to: 'settings', params: { cat: c.id }, class: c.id === cat ? 'dv-link dv-link-active' : 'dv-link', testId: `settings-cat-${c.id}` }, t(c.labelKey))),
  );
  const body =
    cat === 'controls'
      ? h(ControlsPanel, { controls: (binder.get({ scope: 'profile', path: 'controls' }) as unknown as ControlsSettings | undefined) ?? EMPTY_CONTROLS, setControls: (next: ControlsSettings) => binder.setControls(next) })
      : screen
        ? h(ScreenHost, { key: cat, screen, get: (r: SettingRef) => binder.get(r), set: (r: SettingRef, v: JsonValue) => binder.set(r, v), run })
        : null;
  return h(
    'main',
    { class: 'dv-page dv-settings', 'data-testid': 'settings', 'data-cat': cat },
    h('h1', null, t('nav.settings')),
    h('div', { class: 'dv-settings-layout' }, nav, h('div', { class: 'dv-settings-panel' }, body)),
    h('div', { class: 'dv-actions' }, h('button', { type: 'button', class: 'dv-btn dv-btn-secondary', 'data-testid': 'settings-back', 'data-fid': 'settings.back', onClick: () => shell.back() }, t('common.back'))),
  );
}

interface RunDeps { cat: string; ctx: ShellContext; shell: ShellApi; storageReload(): void }

function runAction(action: UiAction, _rowId: string | undefined, d: RunDeps): void {
  const { ctx, shell } = d;
  if ('back' in action) return shell.back();
  if ('nav' in action) return shell.navigate(action.nav, action.params);
  if ('cmd' in action) {
    ctx.sendUi(action.cmd);
    return;
  }
  const arg = action.args?.[0];
  switch (action.call) {
    case 'reset':
      resetCategory(String(arg), (r, v) => ctx.binder.set(r, v));
      return;
    case 'benchmark':
      void ctx.platform?.rerunBenchmark?.();
      return;
    case 'install':
      void ctx.platform?.install?.prompt().then(d.storageReload);
      return;
    case 'persist':
      void ctx.platform?.requestPersist?.().then(d.storageReload);
      return;
    case 'copy-tier':
      copy(JSON.stringify(ctx.platform?.tierInfo() ?? {}));
      return;
    case 'update':
      void ctx.props.update?.applyNow();
      return;
    case 'reset-ui':
      ctx.props.prefs.set({ ...defaultPrefs(), age: ctx.props.prefs.get().age, terms: ctx.props.prefs.get().terms, seenTiles: ctx.props.prefs.get().seenTiles });
      return;
    case 'delete-local':
      void shell
        .confirm({ titleKey: lk('settings.privacy.delete'), bodyKey: lk('settings.privacy.delete.body'), confirmKey: lk('settings.privacy.delete'), danger: true, typeToConfirm: t('settings.privacy.delete.word') })
        .then((ok) => {
          if (!ok) return;
          void clearLocalData().then(() => ctx.props.hooks.reload());
        });
      return;
    case 'audio.test':
      ctx.engine?.audioUnlock();
      return;
    default:
  }
}

/** Deletes the game's IndexedDB databases and cache entries on this device (the "Delete local data" action). */
export async function clearLocalData(): Promise<void> {
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(dbs.map((db) => (db.name ? new Promise<void>((res) => { const r = indexedDB.deleteDatabase(db.name as string); r.onsuccess = r.onerror = r.onblocked = () => res(); }) : Promise.resolve())));
  } catch {
    // storage may be blocked
  }
  try {
    for (const k of await caches.keys()) await caches.delete(k);
  } catch {
    // caches may be unavailable
  }
  try {
    localStorage.clear();
  } catch {
    // storage may be blocked
  }
}

export type { ProfileSettings };

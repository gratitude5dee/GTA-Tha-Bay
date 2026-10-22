import type { ControlsSettings, JsonObject, JsonValue, PlatformSettings, ProfileSettings, UiCommand } from '@dv/shared';
import type { SettingRef } from '../screen/types.ts';
import type { PlatformPort, PrefsStore, UiPrefs } from './types.ts';

/**
 * The settings binder (10-ui-pages.md section 2.9). A `SettingRef` names where a value lives:
 *  - profile scope: C05 `ProfileSettings`, debounced 500 ms into one `save.settings` command (the sim merges sections);
 *  - device scope: `PlatformSettings` (S11), written through the platform port;
 *  - ui scope: `UiPrefs`, written through the prefs store.
 * Profile writes show at once through an overlay that is dropped when the sim's echo (`sys.settings`, `sys.controls`) carries the value.
 */
export const PROFILE_DEBOUNCE_MS = 500;

/** C05 1.1 sections the sim leaves unset until the player changes them (`npc`, `cutscenes`): what the rows show meanwhile. */
export const UNSET_DEFAULTS: Readonly<Record<string, JsonValue>> = {
  'npc.voice': 'all',
  'npc.aiDialogue': true,
  'cutscenes.generated': true,
  'cutscenes.audio': 'engine',
};

export interface BinderDeps {
  /** The profile settings as the sim last published them (controls merged in), or null before the profile is open. */
  base(): ProfileSettings | null;
  sendUi(cmd: UiCommand): boolean;
  platform(): PlatformPort | null;
  prefs: PrefsStore;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(h: unknown): void;
  /** Called when a profile value was set locally, so the page shows it before the sim echoes it. */
  changed?(): void;
}

export interface SettingsBinderApi {
  get(ref: SettingRef): JsonValue | undefined;
  set(ref: SettingRef, value: JsonValue): void;
  setControls(next: ControlsSettings): void;
  /** Sends what is waiting now. */
  flush(): void;
  /** Tells the binder the sim published new values, so overlay entries the echo carries are dropped. */
  rebase(): void;
}

type Dict = Record<string, unknown>;
const isObj = (x: unknown): x is Dict => typeof x === 'object' && x !== null && !Array.isArray(x);

function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const k of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function setPath(root: Dict, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = root;
  for (const k of keys.slice(0, -1)) {
    const next = cur[k];
    if (isObj(next)) cur = next;
    else {
      const made: Dict = {};
      cur[k] = made;
      cur = made;
    }
  }
  cur[keys[keys.length - 1] as string] = value;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class SettingsBinder implements SettingsBinderApi {
  /** Values set locally and not yet echoed, by path. */
  private overlay = new Map<string, unknown>();
  /** The paths changed since the last send, as a nested patch. */
  private pending: Dict = {};
  private timer: unknown = null;
  sent = 0;

  constructor(private readonly d: BinderDeps) {}

  private after(fn: () => void, ms: number): unknown {
    return (this.d.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms);
  }

  get(ref: SettingRef): JsonValue | undefined {
    if (ref.scope === 'profile') {
      if (this.overlay.has(ref.path)) return this.overlay.get(ref.path) as JsonValue;
      return (getPath(this.d.base(), ref.path) as JsonValue | undefined) ?? UNSET_DEFAULTS[ref.path];
    }
    if (ref.scope === 'device') return getPath(this.d.platform()?.settings(), ref.path) as JsonValue | undefined;
    return getPath(this.d.prefs.get(), ref.path) as JsonValue | undefined;
  }

  set(ref: SettingRef, value: JsonValue): void {
    if (ref.scope === 'profile') {
      this.profile(ref.path, value);
      // `reduceMotion` of the XR comfort block mirrors the accessibility switch in the same write (S11 field comment).
      if (ref.path === 'accessibility.reducedMotion') this.profile('xr.reduceMotion', value);
      return;
    }
    if (ref.scope === 'device') {
      const platform = this.d.platform();
      if (!platform) return;
      const cur = platform.settings() as unknown as Dict;
      const [top, ...rest] = ref.path.split('.');
      if (top === undefined) return;
      const next: Dict = rest.length === 0 ? { [top]: value } : { [top]: { ...(isObj(cur[top]) ? (cur[top] as Dict) : {}), [rest.join('.')]: value } };
      void platform.update(next as Partial<PlatformSettings>);
      return;
    }
    this.d.prefs.set({ [ref.path]: value } as Partial<UiPrefs>);
  }

  setControls(next: ControlsSettings): void {
    this.profile('controls', next as unknown as JsonValue);
  }

  private profile(path: string, value: unknown): void {
    this.overlay.set(path, value);
    setPath(this.pending, path, value);
    if (this.timer !== null) (this.d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = this.after(() => this.flush(), PROFILE_DEBOUNCE_MS);
    this.d.changed?.();
  }

  flush(): void {
    if (this.timer !== null) {
      (this.d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
      this.timer = null;
    }
    if (Object.keys(this.pending).length === 0) return;
    const data = this.pending as JsonObject;
    this.pending = {};
    this.sent++;
    this.d.sendUi({ t: 'save.settings', data });
  }

  rebase(): void {
    const base = this.d.base();
    for (const [path, v] of [...this.overlay]) {
      if (same(getPath(base, path), v) && !(path in this.pendingFlat())) this.overlay.delete(path);
    }
  }

  private pendingFlat(): Dict {
    const out: Dict = {};
    const walk = (o: Dict, prefix: string): void => {
      for (const [k, v] of Object.entries(o)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (isObj(v) && p !== 'controls') walk(v, p);
        else out[p] = v;
      }
    };
    walk(this.pending, '');
    return out;
  }
}

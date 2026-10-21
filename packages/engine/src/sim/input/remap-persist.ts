import type { ControlsSettings, JsonObject, ProfileSettings } from '@dv/shared';

/**
 * Controls remapping persistence (R-ENG-04, C03 rule 9). `UiCommand save.settings` carries a `controls` block; the sim keeps it in
 * the `settings` slice, saves it, and publishes the accepted block as the view model `sys.controls`, which the page hands to
 * `InputRouter.setOverrides` (also on load). `client.Pause` can never be unbound: an override that gives it no binding is dropped
 * here, and the router keeps the default binding next to any override it does get.
 */

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, lo: number, hi: number, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

/** Every action id an override may name starts with one of these. */
const ACTION_ID = /^(sim|client|axis)\.[A-Za-z0-9]+$/;

/** The overrides with every malformed entry removed and every empty `client.Pause` list dropped. */
export function sanitizeOverrides(raw: unknown): ControlsSettings['overrides'] {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  if (!isObject(raw)) return out as ControlsSettings['overrides'];
  for (const [device, contexts] of Object.entries(raw)) {
    if (!isObject(contexts)) continue;
    for (const [ctx, actions] of Object.entries(contexts)) {
      if (!isObject(actions)) continue;
      for (const [action, bindings] of Object.entries(actions)) {
        if (!ACTION_ID.test(action) || !Array.isArray(bindings)) continue;
        if (action === 'client.Pause' && bindings.length === 0) continue;
        const good = bindings.filter((b) => isObject(b) && typeof b['control'] === 'string');
        if (good.length !== bindings.length) continue;
        ((out[device] ??= {})[ctx] ??= {})[action] = good;
      }
    }
  }
  return out as ControlsSettings['overrides'];
}

/** Merges an incoming `controls` block onto the current one; fields of the wrong type keep their old value. Null when it is not a controls block. */
export function mergeControls(base: ControlsSettings, incoming: unknown): ControlsSettings | null {
  if (!isObject(incoming) || incoming['schema'] !== 1) return null;
  const sens = isObject(incoming['lookSensitivity']) ? incoming['lookSensitivity'] : {};
  const dz = isObject(incoming['deadzones']) ? incoming['deadzones'] : {};
  const touch = isObject(incoming['touch']) ? incoming['touch'] : {};
  const next: ControlsSettings = {
    schema: 1,
    overrides: incoming['overrides'] === undefined ? base.overrides : sanitizeOverrides(incoming['overrides']),
    holdToToggle: Array.isArray(incoming['holdToToggle']) ? (incoming['holdToToggle'].filter((a) => typeof a === 'string' && ACTION_ID.test(a)) as ControlsSettings['holdToToggle']) : base.holdToToggle,
    lookSensitivity: {
      kbm: num(sens['kbm'], 0.1, 5, base.lookSensitivity.kbm),
      gamepad: num(sens['gamepad'], 0.1, 5, base.lookSensitivity.gamepad),
      touch: num(sens['touch'], 0.1, 5, base.lookSensitivity.touch),
    },
    invertY: typeof incoming['invertY'] === 'boolean' ? incoming['invertY'] : base.invertY,
    deadzones: {
      stickInner: num(dz['stickInner'], 0, 0.5, base.deadzones.stickInner),
      stickOuter: num(dz['stickOuter'], 0.5, 1, base.deadzones.stickOuter),
      trigger: num(dz['trigger'], 0, 0.5, base.deadzones.trigger),
    },
    touch: {
      layout: typeof touch['layout'] === 'string' && touch['layout'].length <= 40 ? touch['layout'] : base.touch.layout,
      tiltSteer: typeof touch['tiltSteer'] === 'boolean' ? touch['tiltSteer'] : base.touch.tiltSteer,
      stickRadiusPx: num(touch['stickRadiusPx'], 32, 160, base.touch.stickRadiusPx),
      opacity: num(touch['opacity'], 0.1, 1, base.touch.opacity),
    },
  };
  if (incoming['fighterScheme'] === 'classic' || incoming['fighterScheme'] === 'simple') next.fighterScheme = incoming['fighterScheme'];
  else if (base.fighterScheme) next.fighterScheme = base.fighterScheme;
  return next;
}

const SECTIONS = ['audio', 'subtitles', 'camera', 'accessibility', 'xr', 'npc', 'cutscenes', 'privacy'] as const;

/**
 * Applies a `save.settings` payload to the settings slice in place. Known sections are shallow-merged, `language` is replaced,
 * `controls` goes through `mergeControls`. Returns the names of the sections that changed (empty when the payload held nothing usable).
 */
export function applySettings(settings: ProfileSettings, data: JsonObject): string[] {
  const changed: string[] = [];
  if ('controls' in data) {
    const merged = mergeControls(settings.controls, data['controls']);
    if (merged) {
      settings.controls = merged;
      changed.push('controls');
    }
  }
  for (const key of SECTIONS) {
    const v = data[key];
    if (!isObject(v)) continue;
    (settings as unknown as Record<string, unknown>)[key] = { ...(settings[key] as object | undefined), ...v };
    changed.push(key);
  }
  if (typeof data['language'] === 'string' && data['language'].length <= 16) {
    settings.language = data['language'];
    changed.push('language');
  }
  return changed;
}

import type { ControlsSettings, InputMap } from '@dv/shared';
import gamepadJson from '../../../../../config/input/defaults.gamepad.json';
import kbmJson from '../../../../../config/input/defaults.kbm.json';
import touchJson from '../../../../../config/input/defaults.touch.json';
import kbmFighterClassic from '../../../../../config/input/defaults.kbm.fighter-classic.json';
import kbmFighterSimple from '../../../../../config/input/defaults.kbm.fighter-simple.json';
import padFighterClassic from '../../../../../config/input/defaults.pad.fighter-classic.json';
import padFighterSimple from '../../../../../config/input/defaults.pad.fighter-simple.json';
import touchFighterClassic from '../../../../../config/input/defaults.touch.fighter-classic.json';
import touchFighterSimple from '../../../../../config/input/defaults.touch.fighter-simple.json';

/** config/input/defaults.<device>.json (schema: config/schemas/input-map.schema.json). */
export const DEFAULT_KBM_MAP = kbmJson as unknown as InputMap;
export const DEFAULT_GAMEPAD_MAP = gamepadJson as unknown as InputMap;
export const DEFAULT_TOUCH_MAP = touchJson as unknown as InputMap;
export const DEFAULT_MAPS: readonly InputMap[] = Object.freeze([DEFAULT_KBM_MAP, DEFAULT_GAMEPAD_MAP, DEFAULT_TOUCH_MAP]);

/**
 * The bindings of the `fighter` context (M08a2, C03 1.1 `ControlsSettings.fighterScheme`): one file per device and scheme,
 * `config/input/defaults.<kbm|pad|touch>.fighter-<classic|simple>.json`. The router merges the maps of the chosen scheme next to the
 * default maps; the other scheme's files are not read.
 */
export const FIGHTER_MAPS: Readonly<Record<'classic' | 'simple', readonly InputMap[]>> = Object.freeze({
  classic: Object.freeze([kbmFighterClassic, padFighterClassic, touchFighterClassic] as unknown as InputMap[]),
  simple: Object.freeze([kbmFighterSimple, padFighterSimple, touchFighterSimple] as unknown as InputMap[]),
});

/**
 * Controls settings before the player changes anything (persisting them is M04a). The look values are the design
 * numbers: 0.0022 rad per mouse pixel, 3.0 rad/s at full stick deflection.
 */
export const DEFAULT_CONTROLS: ControlsSettings = Object.freeze({
  schema: 1,
  overrides: Object.freeze({}),
  holdToToggle: Object.freeze([]) as unknown as ControlsSettings['holdToToggle'],
  lookSensitivity: Object.freeze({ kbm: 1, gamepad: 1, touch: 1 }),
  invertY: false,
  deadzones: Object.freeze({ stickInner: 0.12, stickOuter: 1, trigger: 0.05 }),
  touch: Object.freeze({ layout: 'default', tiltSteer: false, stickRadiusPx: 58, opacity: 0.8 }),
}) as ControlsSettings;

/** Mouse look: radians per pixel at sensitivity 1. */
export const MOUSE_RAD_PER_PX = 0.0022;
/** Gamepad look: radians per second at full deflection and sensitivity 1. */
export const PAD_RAD_PER_SEC = 3.0;
/** Pitch limits, radians (C04: [-70, 70] degrees). */
export const PITCH_LIMIT = (70 * Math.PI) / 180;

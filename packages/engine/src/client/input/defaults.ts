import type { ControlsSettings, InputMap } from '@dv/shared';
import gamepadJson from '../../../../../config/input/defaults.gamepad.json';
import kbmJson from '../../../../../config/input/defaults.kbm.json';

/** config/input/defaults.<device>.json (schema: config/schemas/input-map.schema.json). */
export const DEFAULT_KBM_MAP = kbmJson as unknown as InputMap;
export const DEFAULT_GAMEPAD_MAP = gamepadJson as unknown as InputMap;
export const DEFAULT_MAPS: readonly InputMap[] = Object.freeze([DEFAULT_KBM_MAP, DEFAULT_GAMEPAD_MAP]);

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

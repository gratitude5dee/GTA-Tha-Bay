import type { CoreSlice, ProfileSettings } from '@dv/shared';

/** What an absent slot reads as. These validate against the v1 slice schemas (tested). */
export function defaultCore(): CoreSlice {
  return {
    avatar: {},
    unlocks: [],
    firstEncounters: {},
    garage: [],
    inventory: { items: [], wardrobe: [] },
    stats: { distanceKm: 0, pursuitsEscaped: 0, busted: 0, fightsWon: 0, racesWon: 0, playtimeSec: 0 },
  };
}

export function defaultSettings(): ProfileSettings {
  return {
    controls: {
      schema: 1,
      overrides: {},
      holdToToggle: [],
      lookSensitivity: { kbm: 1, gamepad: 1, touch: 1 },
      invertY: false,
      deadzones: { stickInner: 0.1, stickOuter: 0.95, trigger: 0.05 },
      touch: { layout: 'default-right', tiltSteer: false, stickRadiusPx: 64, opacity: 0.7 },
    },
    audio: { master: 1, music: 0.8, sfx: 1, ambience: 0.8, voice: 1, radio: 0.7, ui: 0.8, cutscene: 1 },
    subtitles: { on: true, size: 'm', background: true, speakerNames: true },
    camera: { defaultMode: 'tp', fovDeg: 70, shoulder: 'right', shake: true },
    accessibility: { reducedMotion: false, hudPalette: 'default', timerScale: 1, autoBlockStoryFights: false, pauseOnTycoonEvents: false },
    xr: {
      v: 1, locomotion: 'teleport', turn: 'snap', snapAngleDeg: 30, smoothSpeedMps: 4, quantizeVelocity: true, vignette: 'medium',
      comfortAssist: 0.5, seated: false, dominantHand: 'right', cockpitHorizonLock: true, chaseView: 'cockpit', arenaScale: 'tabletop',
      handsEnabled: true, uiDistanceM: 1.2, reduceMotion: false, heightCalibM: 1.6,
    },
    language: 'en',
    privacy: { cameraFeatures: false, parentalConsent: false },
  };
}


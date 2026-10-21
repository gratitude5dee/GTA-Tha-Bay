import type { ProfileSettings } from '@dv/shared';

/** What a new profile's settings read as (moved here from sim/save so the mode host needs no import of sim/save, M04a2). */
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


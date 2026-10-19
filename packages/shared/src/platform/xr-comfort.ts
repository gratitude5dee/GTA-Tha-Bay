// XrComfortSettings, copied from spec/domains/11-platform-xr.md section 4.2 (persisted in C05 ProfileSettings.xr).
export interface XrComfortSettings {
  v: 1;
  locomotion: 'teleport' | 'smooth';          // default 'teleport'
  turn: 'snap' | 'smooth';                    // default 'snap'
  snapAngleDeg: 30 | 45;                      // default 30 (matches C04 XRRigParams)
  smoothSpeedMps: number;                     // 1..6, default 4
  quantizeVelocity: boolean;                  // stop / walk / run steps, default true
  vignette: 'off' | 'low' | 'medium' | 'high';// default 'medium'; applies only while moving
  comfortAssist: number;                      // 0..1, default 0.5 (scales vignette and acceleration)
  seated: boolean;                            // eye-height offset, default false
  dominantHand: 'left' | 'right';             // default 'right'
  cockpitHorizonLock: boolean;                // default true
  chaseView: 'cockpit' | 'diorama';           // pursuits, default 'cockpit'
  arenaScale: 'tabletop' | 'life-size';       // fighter, default 'tabletop'
  handsEnabled: boolean;                      // request hand-tracking, default true
  uiDistanceM: number;                        // 0.8..2.0, default 1.2
  reduceMotion: boolean;                      // from global reduced-motion; vignette >= low, no head bob
}

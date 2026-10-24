/**
 * Sky types (02-world-living.md section 6; M02b2). Main thread only. These are S02 domain types, not numbered contracts.
 *
 * `SkyKeysRow`, `SkyKeysFile`, `SkyUniforms` and `AtmosphereAdapter` follow the spec text. `SkyUniforms` adds four members the
 * spec's twelve do not name (`uStars`, `uSunSize`, `uWindowLit`, `uCloud`): they come from the same key rows and cost no extra
 * pass, so the sky still is one set of shared uniforms.
 */
export type Vec3 = [number, number, number];

export type SkyPresetId = 'clear' | 'karl-fog' | 'overcast' | 'rain' | 'smoke' | 'golden';

export interface SkyKeysRow {
  skyTop: Vec3;
  skyBottom: Vec3;
  sunColor: Vec3;
  sunSize: number;
  ambient: Vec3;
  fogColor: Vec3;
  fogNearM: number;
  fogFarM: number;
  exposure: number;
  cloudCover: number;
  /** 0..1: how much of the night-window glow the preset allows at this hour. */
  windowLit: number;
  starAlpha: number;
}

/** The key hours of every preset: six rows' worth of eight (config/world/sky-keys.json). */
export const SKY_KEY_HOURS = [0, 5, 6.5, 9, 13, 17, 19.5, 21.5] as const;

export interface SkyKeysFile {
  schema: 'sky-keys/1';
  hours: readonly [0, 5, 6.5, 9, 13, 17, 19.5, 21.5];
  presets: Record<SkyPresetId, readonly SkyKeysRow[]>;
}

/** The shared uniform values of one frame, evaluated from the keys and the sim's `EnvState` (`evaluateSky`). */
export interface SkyUniforms {
  uNight: number;
  uDark: number;
  uSunDir: Vec3;
  uSunColor: Vec3;
  uFogColor: Vec3;
  uFogNear: number;
  uFogFar: number;
  uSkyTop: Vec3;
  uSkyBottom: Vec3;
  uAmbient: Vec3;
  uExposure: number;
  uWet: number;
  uRain: number;
  uBlackout: number;
  /** Share of the fog that is the Karl marine layer (0 none .. 1 full): the bank weight by x applies to this share. */
  uBank: number;
  /** Star alpha: `max(0, night - 0.3)` of the night, scaled by the preset's `starAlpha`. */
  uStars: number;
  uSunSize: number;
  /** Window glow allowed by the preset and the hour, 0..1. */
  uWindowLit: number;
  uCloud: number;
}

/** What the keyframe evaluation needs of the sim's `EnvState` (C06) plus the client-side wetness and blackout. */
export interface SkyInput {
  hour: number;
  night: number;
  dark: number;
  weather: SkyPresetId;
  next: SkyPresetId;
  /** u16 0..65535. */
  blend: number;
  fogBankM: number;
  /** u8 streak intensity, 0..255. */
  rain: number;
  /** 0..1 wetness of the ground (follows the rain with a slow dry-out). */
  wet: number;
  blackout: boolean;
}

/** Removable desktop-ultra atmosphere (takram), isolated behind this interface; the dome and fog stay when it is absent. */
export interface AtmosphereAdapter {
  init(r: unknown): Promise<void>;
  update(env: Readonly<SkyUniforms>): void;
  dispose(): void;
}

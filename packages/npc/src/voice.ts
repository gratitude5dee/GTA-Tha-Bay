// The voice side of @dv/npc as its own entry (M06a4): the app and the creator preview import it without the dialogue client.
export { TtsPlayer } from './tts/tts-player.ts';
export type { TtsAudioHost, TtsContext, TtsPlayerOptions } from './tts/tts-player.ts';
export { LipSyncDriver, HOLD_MS, MAX_SPEAKERS } from './lipsync/driver.ts';
export type { LipSyncOptions, LipSyncSource, LipSyncTarget } from './lipsync/driver.ts';
export { atlasTarget, cellUv, ATLAS_GRID, JAW_OPEN, MAX_JAW_RAD } from './lipsync/atlas.ts';
export { rms, envelopeReader } from './lipsync/rms.ts';
export type { AnalyserLike } from './lipsync/rms.ts';

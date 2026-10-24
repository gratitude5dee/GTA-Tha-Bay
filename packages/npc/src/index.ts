/**
 * @dv/npc: the client side of the NPC runtime (04-npc.md section 3). M06a3 ships the dialogue client, the NpcRuntime that falls back to
 * ink, the InkRunner and the QA debug overlay. The brain, TTS and lip-sync arrive with M06a4 and M06c.
 */
export { createNpcRuntime } from './client/runtime.ts';
export type { NpcRuntime, NpcRuntimeHandle, NpcRuntimeOptions } from './client/runtime.ts';
export { DialogueClient, OFFLINE_CODES } from './client/dialogue-client.ts';
export type { DialogueClientOptions, TalkEnd } from './client/dialogue-client.ts';
export { SseParser, toDialogueEvent } from './client/sse.ts';
export type { SseFrame } from './client/sse.ts';
export { InkRunner } from './ink/ink-runner.ts';
export type { InkLine } from './ink/ink-runner.ts';
// The executor is pure and lives in @dv/shared so the Worker can use it; the NPC package re-exports it (DL-234).
export { validateTurn, normalizeTurnJson, prefilterPlayerText, inkKnotFor } from '@dv/shared/npc';
export type { ExecutorScene, ExecutorSoul, NpcTurnOutput, ValidatedTurn } from '@dv/shared/npc';
// M06a4: voice and lip-sync.
export { TtsPlayer } from './tts/tts-player.ts';
export type { TtsAudioHost, TtsContext, TtsPlayerOptions } from './tts/tts-player.ts';
export { LipSyncDriver, HOLD_MS, MAX_SPEAKERS } from './lipsync/driver.ts';
export type { LipSyncOptions, LipSyncSource, LipSyncTarget } from './lipsync/driver.ts';
export { atlasTarget, cellUv, ATLAS_GRID, JAW_OPEN, MAX_JAW_RAD } from './lipsync/atlas.ts';
export { rms, envelopeReader } from './lipsync/rms.ts';
export type { AnalyserLike } from './lipsync/rms.ts';
export type { VoiceSink } from './client/runtime.ts';

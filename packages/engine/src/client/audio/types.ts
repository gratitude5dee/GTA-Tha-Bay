/**
 * Audio service types (spec/domains/01-engine-contracts.md, "Engine service interfaces"). The service lives on the main
 * thread; the sim only emits `AudioCue` events and `AudioEmitter` records in the snapshot.
 */
export type AudioBusId = 'master' | 'music' | 'sfx' | 'ambience' | 'voice' | 'radio' | 'ui' | 'cutscene';

export interface AudioCue {
  tick: number;
  cue: string;
  bus: AudioBusId;
  at?: [number, number, number];
  entity?: number;
  gain?: number;
  pitch?: number;
}

export interface AudioService {
  /** Inside the first `pointerdown` or `keydown`. */
  unlock(): Promise<void>;
  setVolume(bus: AudioBusId, linear: number): void;
  duck(target: AudioBusId, db: number, attackMs: number, releaseMs: number): void;
  play(c: AudioCue): void;
  setListener(p: [number, number, number], fwd: [number, number, number], up: [number, number, number]): void;
  /** From the snapshot's AudioEmitter records. */
  updateEmitters(view: ArrayLike<number>): void;
  /** `visibilitychange` to hidden and back to visible. */
  suspend(): void;
  resume(): void;
}

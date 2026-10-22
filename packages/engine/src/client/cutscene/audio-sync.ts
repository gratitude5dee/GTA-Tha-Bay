/**
 * Cutscene audio (spec/domains/03-story-cutscenes.md section D7 "Audio"): the video is always muted. `engine` audio plays the
 * cues' lines on the `cutscene` bus; `generated-ambient` plays the clip's `a.m4a` there, only when the manifest says no speech was
 * detected or a reviewer approved it. The sound is kept in step with the picture: on every presented frame
 * (`requestVideoFrameCallback`) the video position is compared with the audio position (`getOutputTimestamp()` of the context) and
 * the audio is nudged when they differ by more than 45 ms. Where the browser has no frame callback a 100 ms poll does the same.
 *
 * Voice lines exist as assets from M10e; until then `engine` audio has nothing to play and the port's `startLines` is a no-op.
 */
import type { CueSpec } from '@dv/shared/contracts/c09-cutscene';
import type { AudioContextLike, AudioServiceImpl } from '../audio/audio-service.ts';
import type { CutsceneConfig, Timers } from './triggers.ts';

export interface CutsceneAudioPort {
  /** `engine` audio: the voice lines of the cues, relative to the start of the beat. */
  startLines(cues: readonly CueSpec[]): void;
  /** `generated-ambient`: fetch, decode and start the clip's audio file from its first sample. */
  startAmbient(url: string): Promise<void>;
  /** Audio timeline position in ms since `startAmbient`; null when nothing plays. */
  positionMs(): number | null;
  /** Moves the audio by `deltaMs` (positive: later). */
  nudge(deltaMs: number): void;
  stop(): void;
}

/** True when the manifest allows the clip's own audio: no speech was detected, or a reviewer approved it. */
export function ambientAllowed(audio: { speechDetected: boolean; approvedBy?: string } | undefined): boolean {
  return audio !== undefined && (!audio.speechDetected || (audio.approvedBy !== undefined && audio.approvedBy !== ''));
}

/** The correction to apply, in ms: 0 within `thresholdMs`, else the audio-ahead amount to move the audio by (negative: delay it). */
export function nudgeFor(videoMs: number, audioMs: number, thresholdMs: number): number {
  const drift = audioMs - videoMs;
  return Math.abs(drift) > thresholdMs ? -drift : 0;
}

interface VideoLike {
  currentTime: number;
  requestVideoFrameCallback?(cb: () => void): number;
  cancelVideoFrameCallback?(id: number): void;
}

/** Keeps the audio port in step with a playing video. */
export class AudioSync {
  private live = false;
  private frameId: number | null = null;
  private poll: unknown = null;
  /** Nudges applied, for the QA bridge and the tests. */
  nudges = 0;

  constructor(
    private readonly video: VideoLike,
    private readonly audio: Pick<CutsceneAudioPort, 'positionMs' | 'nudge'>,
    private readonly timers: Timers,
    private readonly cfg: Pick<CutsceneConfig, 'audioNudgeMs' | 'audioNudgeConstantOffsetMs'>,
  ) {}

  start(): void {
    if (this.live) return;
    this.live = true;
    // The fallback of the file-budget risk: a constant offset when the audio clock cannot be read.
    if (this.audio.positionMs() === null && this.cfg.audioNudgeConstantOffsetMs !== 0) this.audio.nudge(this.cfg.audioNudgeConstantOffsetMs);
    this.schedule();
  }

  stop(): void {
    this.live = false;
    if (this.frameId !== null) this.video.cancelVideoFrameCallback?.(this.frameId);
    this.frameId = null;
    if (this.poll !== null) this.timers.clearTimeout(this.poll);
    this.poll = null;
  }

  /** One comparison; the frame callback and the poll both end here. */
  check(): void {
    const audioMs = this.audio.positionMs();
    if (audioMs === null) return;
    const delta = nudgeFor(this.video.currentTime * 1000, audioMs, this.cfg.audioNudgeMs);
    if (delta !== 0) {
      this.nudges++;
      this.audio.nudge(delta);
    }
  }

  private schedule(): void {
    if (!this.live) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.frameId = this.video.requestVideoFrameCallback(() => {
        this.check();
        this.schedule();
      });
    } else {
      this.poll = this.timers.setTimeout(() => {
        this.check();
        this.schedule();
      }, 100);
    }
  }
}

/** The structural part of the audio service this adapter uses: the context and the bus nodes. */
export interface AudioServiceLike {
  readonly context: AudioContextLike | null;
  bus: AudioServiceImpl['bus'];
}

interface DecodingContext extends AudioContextLike {
  decodeAudioData(bytes: ArrayBuffer): Promise<unknown>;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

/**
 * The port over the game's `AudioContext` and its `cutscene` bus. `engine` voice lines have no assets before M10e, so
 * `startLines` does nothing here; the ambient file plays through a buffer source on the bus, and `getOutputTimestamp()` gives the
 * audio clock for the sync.
 */
export function createWebAudioCutscene(service: AudioServiceLike, fetchBytes: (url: string) => Promise<ArrayBuffer>): CutsceneAudioPort {
  let source: { stop?(when?: number): unknown; start(when?: number): unknown; buffer: unknown; connect(d: object): unknown; playbackRate: { value: number } } | null = null;
  let startedAt: number | null = null;
  let shift = 0;
  return {
    startLines() {
      // M10e supplies the voice assets; nothing to play yet.
    },
    async startAmbient(url) {
      const ctx = service.context as DecodingContext | null;
      const bus = service.bus('cutscene');
      if (!ctx || !bus || typeof ctx.decodeAudioData !== 'function') return;
      const buffer = await ctx.decodeAudioData(await fetchBytes(url));
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(bus);
      src.start();
      source = src;
      startedAt = ctx.getOutputTimestamp?.().contextTime ?? ctx.currentTime;
    },
    positionMs() {
      const ctx = service.context as DecodingContext | null;
      if (!ctx || startedAt === null) return null;
      const now = ctx.getOutputTimestamp?.().contextTime ?? ctx.currentTime;
      return (now - startedAt) * 1000 + shift;
    },
    nudge(deltaMs) {
      shift += deltaMs;
      // A running buffer source cannot seek; a short rate change closes the gap without a click.
      if (source) source.playbackRate.value = deltaMs > 0 ? 0.98 : 1.02;
    },
    stop() {
      try {
        source?.stop?.();
      } catch {
        // already stopped
      }
      source = null;
      startedAt = null;
      shift = 0;
    },
  };
}

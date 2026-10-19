import audioJson from '../../../../../config/audio.json';
import type { AudioBusId, AudioCue, AudioService } from './types.ts';

/** The parts of the Web Audio API the service uses. Structural, so tests pass a fake and the service needs no DOM types. */
export interface AudioParamLike {
  value: number;
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
}
export interface AudioNodeLike {
  connect(dest: AudioNodeLike | object): unknown;
  disconnect?(): unknown;
}
export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}
export interface BiquadLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  Q: AudioParamLike;
}
export interface BufferSourceLike extends AudioNodeLike {
  buffer: unknown;
  playbackRate: AudioParamLike;
  onended: (() => void) | null;
  start(when?: number): unknown;
  stop?(when?: number): unknown;
}
export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}
export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: object;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  listener?: { positionX?: AudioParamLike; positionY?: AudioParamLike; positionZ?: AudioParamLike };
}

/** `config/audio.json` (schema: config/schemas/audio.schema.json). */
export interface AudioConfig {
  version: 1;
  buses: Record<AudioBusId, { gain: number; parent: AudioBusId | null }>;
  duck: Partial<Record<AudioBusId, { targets: AudioBusId[]; db: number; attackMs: number; releaseMs: number }>>;
  footstep: { bus: AudioBusId; cue: string; durationSec: number; bandpassHz: number; q: number; peakGain: number; pitchSpread: number };
}
export const AUDIO_CONFIG = audioJson as unknown as AudioConfig;

/** The seven buses under master. */
export const CHILD_BUSES: readonly AudioBusId[] = ['music', 'sfx', 'ambience', 'voice', 'radio', 'ui', 'cutscene'];

export const dbToLinear = (db: number): number => 10 ** (db / 20);

export interface AudioServiceOptions {
  /** Builds the context. Called once, inside `unlock`, so that it is created in the user gesture. */
  createContext: () => AudioContextLike;
  config?: AudioConfig;
  /** `navigator.audioSession` when the browser has it (iOS 16.4+): `type` is set to `'playback'`. */
  audioSession?: { type: string } | null;
  /** Concurrent one-shot voices (`config/engine-tiers.json` `audioVoices` of the tier). */
  maxVoices?: number;
  /** A number in [0, 1) for the footstep pitch spread. Defaults to `Math.random`. */
  random?: () => number;
}

interface Duck {
  db: number;
  attackMs: number;
  releaseMs: number;
  targets: AudioBusId[];
}

/**
 * The audio bus skeleton (01-engine.md section 2.9): one `AudioContext`, unlocked in the first gesture, and
 * `master -> {music, sfx, ambience, voice, radio, ui, cutscene}`. Voice ducks music and radio by 9 dB (80 ms attack,
 * 400 ms release). The sim's `foot.step` cue plays a synthesized footfall (a short band-passed noise burst) on the sfx bus.
 * Suspended when the page is hidden and resumed when it is visible again.
 */
export class AudioServiceImpl implements AudioService {
  private ctx: AudioContextLike | null = null;
  private readonly buses = new Map<AudioBusId, GainNodeLike>();
  /** The volume the player set per bus, linear; ducks multiply it. */
  private readonly volumes = new Map<AudioBusId, number>();
  private readonly ducks = new Map<AudioBusId, Duck>();
  private unlocking: Promise<void> | null = null;
  private noise: AudioBufferLike | null = null;
  private voices = 0;
  private readonly config: AudioConfig;
  /** Counts for tests and the bridge. */
  resumeCalls = 0;
  suspendCalls = 0;
  played = 0;
  dropped = 0;

  constructor(private readonly opts: AudioServiceOptions) {
    this.config = opts.config ?? AUDIO_CONFIG;
    for (const [id, b] of Object.entries(this.config.buses)) this.volumes.set(id as AudioBusId, b.gain);
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** The bus node (tests and the debug panel). */
  bus(id: AudioBusId): GainNodeLike | undefined {
    return this.buses.get(id);
  }

  get context(): AudioContextLike | null {
    return this.ctx;
  }

  unlock(): Promise<void> {
    this.unlocking ??= this.doUnlock();
    return this.unlocking;
  }

  private async doUnlock(): Promise<void> {
    if (this.opts.audioSession) {
      try {
        this.opts.audioSession.type = 'playback';
      } catch {
        // The property exists on iOS 16.4+ and Safari; a read-only value is not worth failing for.
      }
    }
    const ctx = this.opts.createContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.volumes.get('master') ?? 1;
    master.connect(ctx.destination);
    this.buses.set('master', master);
    for (const id of CHILD_BUSES) {
      const g = ctx.createGain();
      g.gain.value = this.volumes.get(id) ?? 1;
      g.connect(master);
      this.buses.set(id, g);
    }
    if (ctx.state !== 'running') {
      this.resumeCalls++;
      await ctx.resume();
    }
  }

  setVolume(bus: AudioBusId, linear: number): void {
    const v = Math.max(0, linear);
    this.volumes.set(bus, v);
    const node = this.buses.get(bus);
    if (node) this.applyGain(bus, node);
  }

  /**
   * Starts the duck that source bus `target` imposes on its configured buses (voice: music and radio): their gain ramps to
   * `db` over `attackMs`. `unduck(target)` ramps them back over `releaseMs`.
   */
  duck(target: AudioBusId, db: number, attackMs: number, releaseMs: number): void {
    const targets = this.config.duck[target]?.targets ?? [];
    this.ducks.set(target, { db, attackMs, releaseMs, targets: [...targets] });
    const ctx = this.ctx;
    if (!ctx) return;
    for (const id of targets) {
      const node = this.buses.get(id);
      if (node) this.ramp(node.gain, (this.volumes.get(id) ?? 1) * dbToLinear(db), attackMs);
    }
  }

  /** Ends the duck of `target`: the ducked buses return to their volume over the release time. */
  unduck(target: AudioBusId): void {
    const d = this.ducks.get(target);
    if (!d) return;
    this.ducks.delete(target);
    if (!this.ctx) return;
    for (const id of d.targets) {
      const node = this.buses.get(id);
      if (node) this.ramp(node.gain, this.targetGain(id), d.releaseMs);
    }
  }

  play(c: AudioCue): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'suspended') {
      this.dropped++;
      return;
    }
    if (c.cue === this.config.footstep.cue) this.footstep(ctx, c);
    else this.dropped++;
  }

  setListener(p: [number, number, number], _fwd: [number, number, number], _up: [number, number, number]): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) l.positionX.value = p[0];
    if (l.positionY) l.positionY.value = p[1];
    if (l.positionZ) l.positionZ.value = p[2];
  }

  updateEmitters(_view: ArrayLike<number>): void {
    // Continuous emitters (engine rpm, sirens) arrive with M03; no snapshot carries any yet.
  }

  suspend(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.suspendCalls++;
    void ctx.suspend().catch(() => {});
  }

  resume(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return;
    this.resumeCalls++;
    void ctx.resume().catch(() => {});
  }

  /** Suspends on `visibilitychange` to hidden and resumes on visible. Returns the detach function. */
  attachLifecycle(doc: { addEventListener(t: string, l: () => void): void; removeEventListener(t: string, l: () => void): void }, visibility: () => string): () => void {
    const onChange = (): void => (visibility() === 'visible' ? this.resume() : this.suspend());
    doc.addEventListener('visibilitychange', onChange);
    return () => doc.removeEventListener('visibilitychange', onChange);
  }

  // ------------------------------------------------------------------ internals

  private targetGain(id: AudioBusId): number {
    let g = this.volumes.get(id) ?? 1;
    for (const d of this.ducks.values()) if (d.targets.includes(id)) g *= dbToLinear(d.db);
    return g;
  }

  private applyGain(id: AudioBusId, node: GainNodeLike): void {
    const ctx = this.ctx;
    if (!ctx) return;
    node.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.setValueAtTime(this.targetGain(id), ctx.currentTime);
  }

  private ramp(param: AudioParamLike, to: number, ms: number): void {
    const ctx = this.ctx as AudioContextLike;
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + ms / 1000);
  }

  private footstep(ctx: AudioContextLike, c: AudioCue): void {
    const f = this.config.footstep;
    const cap = this.opts.maxVoices ?? Number.POSITIVE_INFINITY;
    if (this.voices >= cap) {
      this.dropped++;
      return;
    }
    const bus = this.buses.get(c.bus ?? f.bus) ?? this.buses.get(f.bus);
    if (!bus) return;
    this.noise ??= this.makeNoise(ctx, f.durationSec);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const spread = (((this.opts.random ?? Math.random)() * 2) - 1) * f.pitchSpread;
    src.playbackRate.value = (c.pitch ?? 1) * (1 + spread);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = f.bandpassHz * (1 + spread);
    band.Q.value = f.q;
    const env = ctx.createGain();
    const t = ctx.currentTime;
    const peak = f.peakGain * (c.gain ?? 1);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.008);
    env.gain.linearRampToValueAtTime(0, t + f.durationSec);
    src.connect(band);
    band.connect(env);
    env.connect(bus);
    this.voices++;
    this.played++;
    src.onended = () => {
      this.voices--;
      src.disconnect?.();
      band.disconnect?.();
      env.disconnect?.();
    };
    src.start(t);
  }

  /** White noise with a decaying envelope, made once. The generator is a fixed LCG so the buffer is the same every run. */
  private makeNoise(ctx: AudioContextLike, seconds: number): AudioBufferLike {
    const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let x = 0x2545f491;
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      data[i] = ((x / 0xffffffff) * 2 - 1) * (1 - i / n);
    }
    return buf;
  }
}

/** Calls `svc.unlock()` on the first `pointerdown` or `keydown` of `target`, then stops listening. Returns the detach function. */
export function unlockOnFirstGesture(
  svc: Pick<AudioService, 'unlock'>,
  target: { addEventListener(t: string, l: () => void, o?: unknown): void; removeEventListener(t: string, l: () => void): void },
): () => void {
  const off = (): void => {
    target.removeEventListener('pointerdown', go);
    target.removeEventListener('keydown', go);
  };
  const go = (): void => {
    off();
    void svc.unlock().catch(() => {});
  };
  target.addEventListener('pointerdown', go);
  target.addEventListener('keydown', go);
  return off;
}

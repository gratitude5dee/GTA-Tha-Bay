import type { AudioChunk, VoiceTier } from '@dv/shared/contracts/c10-npc';
import { visemesFromAlignment, vowelDensity } from '@dv/shared/npc';
import { envelopeReader, type AnalyserLike } from '../lipsync/rms.ts';
import type { LipSyncDriver, LipSyncTarget } from '../lipsync/driver.ts';

/**
 * TtsPlayer (04-npc.md section 5.7, M06a4): plays the audio chunks of `line.delta {audio}` on the voice bus of the AudioService.
 *
 *  - Nothing plays before `FirstGestureUnlock`: while the audio host is not unlocked every call is a no-op (the text and subtitles go on).
 *  - Chunks of a sentence are joined, decoded (mp3 through `decodeAudioData`, 16 kHz PCM copied into an AudioBuffer) and scheduled back to
 *    back on the AudioContext clock, so sentences follow each other without a gap whatever the frame rate.
 *  - Each line has its own gain node into the `voice` bus (with an optional PannerNode at the NPC's position); the bus ducks music and radio
 *    while a line plays (the AudioService config: 9 dB, 80 ms attack, 400 ms release).
 *  - A line starts a LipSyncDriver speaker: t2 alignment gives viseme cues, t1 an analyser tap for the RMS envelope.
 *  - `npc.voice.client {ttfaMs, tier}` is emitted once per line when its first sentence starts playing. No text, no ids.
 * Decoding failures drop that sentence only. The player never throws into the dialogue code.
 */
export interface ParamLike {
  value: number;
}
export interface NodeLike {
  connect(dest: unknown): unknown;
  disconnect?(): unknown;
}
export interface GainLike extends NodeLike {
  gain: ParamLike;
}
export interface SourceLike extends NodeLike {
  buffer: unknown;
  detune?: ParamLike;
  onended: (() => void) | null;
  start(when?: number): unknown;
  stop?(when?: number): unknown;
}
export interface BufferLike {
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}
export interface PannerLike extends NodeLike {
  positionX?: ParamLike;
  positionY?: ParamLike;
  positionZ?: ParamLike;
}
export interface TtsContext {
  readonly currentTime: number;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike>;
  createAnalyser?(): AnalyserLike & NodeLike;
  createPanner?(): PannerLike;
}
/** The slice of `AudioServiceImpl` the player uses. */
export interface TtsAudioHost {
  readonly unlocked: boolean;
  readonly context: TtsContext | null;
  bus(id: 'voice'): NodeLike | undefined;
  duck?(target: 'voice', db: number, attackMs: number, releaseMs: number): void;
  unduck?(target: 'voice'): void;
}

export interface TtsPlayerOptions {
  audio: TtsAudioHost;
  lipSync?: {
    driver: LipSyncDriver;
    /** The face target of an NPC, or null when it has none (it then only talks). */
    target(npcId: string): { target: LipSyncTarget; hasJaw: boolean } | null;
  };
  telemetry?: { emit(name: 'npc.voice.client', props: { ttfaMs: number; tier: 't1' | 't2' | 't3' }): void };
  /** Milliseconds for the time to first audio. Default `Date.now`. */
  now?: () => number;
  /** World position of an NPC, for a PannerNode. */
  position?: (npcId: string) => readonly [number, number, number] | null;
}

interface Sentence {
  chunks: Uint8Array[];
  codec: AudioChunk['codec'];
}

interface Line {
  npcId: string;
  tier: VoiceTier;
  requestedAt: number;
  sentences: Map<number, Sentence>;
  /** Decodes and schedules run one after the other, so sentences keep their order. */
  chain: Promise<void>;
  nextStart: number;
  gain: GainLike | null;
  analyser: (AnalyserLike & NodeLike) | null;
  started: boolean;
  closed: boolean;
  playing: number;
  lipsync: boolean;
  text: string;
  /** The audio-context time the first sentence starts (M06a5: the dialogue bubble reveals text against it). */
  firstStartS: number | null;
  /** Sentences whose decode and scheduling have not finished. */
  decoding: number;
}

/** The scheduled window of a line's audio on the audio-context clock. */
export interface LineClock {
  startS: number;
  endS: number;
  nowS: number;
  /** The line is closed and every sentence is scheduled: `endS` is final. */
  complete: boolean;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Mono 16 kHz signed little-endian 16-bit PCM to an AudioBuffer. */
function pcmBuffer(ctx: TtsContext, bytes: Uint8Array): BufferLike {
  const n = Math.floor(bytes.length / 2);
  const buf = ctx.createBuffer(1, Math.max(1, n), 16000);
  const ch = buf.getChannelData(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
  return buf;
}

export class TtsPlayer {
  private readonly lines = new Map<string, Line>();
  private readonly pending = new Set<Promise<unknown>>();
  /** Counts for tests and the QA overlay. */
  played = 0;
  dropped = 0;

  constructor(private readonly opts: TtsPlayerOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private ready(): TtsContext | null {
    const a = this.opts.audio;
    return a.unlocked && a.context !== null ? a.context : null;
  }

  /** A line is about to be spoken (the stream's `meta` said the tier is not `text`). Replaces an unfinished line of the same NPC. */
  beginLine(npcId: string, tier: VoiceTier, text = ''): void {
    if (tier === 'text') return;
    this.stop(npcId);
    this.lines.set(npcId, {
      npcId,
      tier,
      requestedAt: this.now(),
      sentences: new Map(),
      chain: Promise.resolve(),
      nextStart: 0,
      gain: null,
      analyser: null,
      started: false,
      closed: false,
      playing: 0,
      lipsync: false,
      text,
      firstStartS: null,
      decoding: 0,
    });
  }

  /**
   * Where the audio of an NPC's line is on the audio clock, or null before its first sentence is scheduled and after the line ended
   * (M06a5: the bubble shows text no faster than this window plays).
   */
  clock(npcId: string): LineClock | null {
    const line = this.lines.get(npcId);
    const ctx = this.ready();
    if (line === undefined || ctx === null || line.firstStartS === null) return null;
    return { startS: line.firstStartS, endS: line.nextStart, nowS: ctx.currentTime, complete: line.closed && line.decoding <= 0 };
  }

  /** The text of the line so far (the `line.delta` text); its vowel density steers the t1 mouth shapes. */
  appendText(npcId: string, text: string): void {
    const line = this.lines.get(npcId);
    if (line !== undefined && line.text.length < 600) line.text += text;
  }

  /** One `AudioChunk` of the line. The last chunk of a sentence triggers its decode and scheduling. */
  push(npcId: string, chunk: AudioChunk): void {
    const line = this.lines.get(npcId);
    if (line === undefined) return;
    if (this.ready() === null) {
      this.dropped++;
      return;
    }
    let s = line.sentences.get(chunk.sentence);
    if (s === undefined) {
      s = { chunks: [], codec: chunk.codec };
      line.sentences.set(chunk.sentence, s);
    }
    try {
      s.chunks.push(fromBase64(chunk.b64));
    } catch {
      this.dropped++;
      return;
    }
    if (!chunk.last) return;
    const bytes = join(s.chunks);
    line.sentences.delete(chunk.sentence);
    const codec = s.codec;
    line.decoding++;
    const job = line.chain
      .then(() => this.schedule(line, bytes, codec, chunk.alignment))
      .catch(() => {
        this.dropped++;
      })
      .finally(() => {
        line.decoding--;
      });
    line.chain = job;
    this.track(job);
  }

  /** The text of the line is complete (`line.done`, `fallback` or `done`): once the audio has played out, the line ends. */
  endLine(npcId: string): void {
    const line = this.lines.get(npcId);
    if (line === undefined) return;
    line.closed = true;
    // Sentences may still be decoding: the line ends when they have been scheduled and played out.
    this.track(
      line.chain.then(() => {
        if (line.playing <= 0 && this.lines.get(npcId) === line) this.finish(line);
      }),
    );
  }

  /** Cuts a line off now (a new line, the dialogue closed, the NPC despawned). */
  stop(npcId: string): void {
    const line = this.lines.get(npcId);
    if (line === undefined) return;
    this.lines.delete(npcId);
    this.release(line);
  }

  /** Resolves when every decode that was started has settled (tests). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /**
   * Plays a recorded clip once on the voice bus, outside any dialogue line (the creator's voice preview). `detuneCents` shifts the pitch.
   * False when the audio is still locked, the clip cannot be decoded or the context is gone.
   */
  async playClip(clip: { bytes: Uint8Array; codec: AudioChunk['codec'] }, opts: { detuneCents?: number; onEnded?: () => void } = {}): Promise<boolean> {
    const ctx = this.ready();
    const bus = this.opts.audio.bus('voice');
    if (ctx === null || bus === undefined) return false;
    try {
      const buffer = await this.decode(ctx, clip.bytes, clip.codec);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      if (opts.detuneCents !== undefined && src.detune !== undefined) src.detune.value = opts.detuneCents;
      src.connect(bus);
      src.onended = () => opts.onEnded?.();
      src.start(ctx.currentTime);
      this.played++;
      return true;
    } catch {
      return false;
    }
  }

  private track(p: Promise<unknown>): void {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  private decode(ctx: TtsContext, bytes: Uint8Array, codec: AudioChunk['codec']): Promise<BufferLike> {
    if (codec === 'pcm_s16le_16000') return Promise.resolve(pcmBuffer(ctx, bytes));
    // decodeAudioData detaches its input: hand it a copy
    return ctx.decodeAudioData(bytes.slice().buffer);
  }

  private async schedule(line: Line, bytes: Uint8Array, codec: AudioChunk['codec'], alignment: AudioChunk['alignment']): Promise<void> {
    const ctx = this.ready();
    const bus = this.opts.audio.bus('voice');
    if (ctx === null || bus === undefined || this.lines.get(line.npcId) !== line) return;
    const buffer = await this.decode(ctx, bytes, codec);
    if (this.lines.get(line.npcId) !== line) return;

    if (line.gain === null) {
      const gain = ctx.createGain();
      let out: NodeLike = gain;
      const pos = this.opts.position?.(line.npcId) ?? null;
      if (pos !== null && ctx.createPanner !== undefined) {
        const panner = ctx.createPanner();
        if (panner.positionX !== undefined) panner.positionX.value = pos[0];
        if (panner.positionY !== undefined) panner.positionY.value = pos[1];
        if (panner.positionZ !== undefined) panner.positionZ.value = pos[2];
        gain.connect(panner);
        out = panner;
      }
      out.connect(bus);
      if (ctx.createAnalyser !== undefined) {
        line.analyser = ctx.createAnalyser();
        gain.connect(line.analyser);
      }
      line.gain = gain;
      line.nextStart = ctx.currentTime;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(line.gain);
    const startAt = Math.max(ctx.currentTime + 0.02, line.nextStart);
    line.nextStart = startAt + buffer.duration;
    line.firstStartS ??= startAt;
    line.playing++;
    src.onended = () => {
      line.playing--;
      if (line.closed && line.playing <= 0 && this.lines.get(line.npcId) === line) this.finish(line);
    };
    src.start(startAt);
    this.played++;

    if (!line.started) {
      line.started = true;
      this.opts.audio.duck?.('voice', -9, 80, 400);
      const ttfaMs = Math.max(0, Math.round(this.now() - line.requestedAt + (startAt - ctx.currentTime) * 1000));
      if (line.tier !== 'text') this.opts.telemetry?.emit('npc.voice.client', { ttfaMs: Math.min(60_000, ttfaMs), tier: line.tier });
      this.startLipSync(line, alignment, startAt);
    } else if (alignment !== undefined && line.lipsync) {
      this.opts.lipSync?.driver.addCues(line.npcId, visemesFromAlignment(alignment), startAt);
    }
  }

  private startLipSync(line: Line, alignment: AudioChunk['alignment'], startAt: number): void {
    const ls = this.opts.lipSync;
    const face = ls?.target(line.npcId) ?? null;
    if (ls === undefined || face === null) return;
    if (alignment !== undefined) {
      line.lipsync = ls.driver.start(line.npcId, face.target, { hasJaw: face.hasJaw, source: { kind: 'cues', cues: visemesFromAlignment(alignment), offsetS: startAt } });
    } else if (line.analyser !== null) {
      line.lipsync = ls.driver.start(line.npcId, face.target, {
        hasJaw: face.hasJaw,
        source: { kind: 'envelope', read: envelopeReader(line.analyser), vowelDensity: vowelDensity(line.text) },
      });
    }
  }

  private finish(line: Line): void {
    if (this.lines.get(line.npcId) === line) this.lines.delete(line.npcId);
    this.release(line);
  }

  private release(line: Line): void {
    if (line.lipsync) this.opts.lipSync?.driver.stop(line.npcId);
    line.lipsync = false;
    if (line.started) this.opts.audio.unduck?.('voice');
    line.started = false;
    try {
      line.gain?.disconnect?.();
    } catch {
      // a node that is already gone needs no disconnect
    }
  }
}

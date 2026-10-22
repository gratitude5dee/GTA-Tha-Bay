import type { AnalyserLike } from '../src/lipsync/rms.ts';
import type { BufferLike, GainLike, NodeLike, SourceLike, TtsAudioHost, TtsContext } from '../src/tts/tts-player.ts';

/** A fake Web Audio graph for the M06a4 client specs: nodes remember what they were connected to, sources remember when they were started. */
export class FakeNode implements NodeLike {
  connections: unknown[] = [];
  disconnected = false;
  connect(dest: unknown): unknown {
    this.connections.push(dest);
    return dest;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode implements GainLike {
  gain = { value: 1 };
}

export class FakeSource extends FakeNode implements SourceLike {
  buffer: unknown = null;
  detune = { value: 0 };
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  start(when?: number): void {
    this.startedAt = when ?? 0;
  }
}

export class FakeAnalyser extends FakeNode implements AnalyserLike {
  readonly fftSize = 256;
  /** The level the next read returns (a constant-amplitude buffer has that RMS). */
  level = 0.3;
  getFloatTimeDomainData(buffer: Float32Array<ArrayBuffer>): void {
    buffer.fill(this.level);
  }
}

export class FakeContext implements TtsContext {
  currentTime = 0;
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  analysers: FakeAnalyser[] = [];
  decodeCalls: number[] = [];
  pcmBuffers = 0;
  /** Seconds of audio per byte of input for decoded mp3. */
  secondsPerByte = 0.001;
  failDecode = false;

  createGain(): GainLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): SourceLike {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(_channels: number, length: number, sampleRate: number): BufferLike {
    this.pcmBuffers++;
    const data = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => data };
  }
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike> {
    this.decodeCalls.push(data.byteLength);
    if (this.failDecode) return Promise.reject(new Error('EncodingError'));
    return Promise.resolve({ duration: data.byteLength * this.secondsPerByte, getChannelData: () => new Float32Array(1) });
  }
  createAnalyser(): AnalyserLike & NodeLike {
    const a = new FakeAnalyser();
    this.analysers.push(a);
    return a;
  }
}

export class FakeHost implements TtsAudioHost {
  unlocked = false;
  context: FakeContext | null = new FakeContext();
  readonly voiceBus = new FakeNode();
  ducks: [string, number, number, number][] = [];
  unducks: string[] = [];
  bus(id: 'voice'): NodeLike | undefined {
    return id === 'voice' ? this.voiceBus : undefined;
  }
  duck(target: 'voice', db: number, attackMs: number, releaseMs: number): void {
    this.ducks.push([target, db, attackMs, releaseMs]);
  }
  unduck(target: 'voice'): void {
    this.unducks.push(target);
  }
}

export const b64 = (n: number, fill = 7): string => btoa(String.fromCharCode(...new Uint8Array(n).fill(fill)));

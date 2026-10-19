import { describe, expect, it } from 'vitest';
import {
  AudioServiceImpl, AUDIO_CONFIG, CHILD_BUSES, dbToLinear, unlockOnFirstGesture,
  type AudioBufferLike, type AudioContextLike, type AudioParamLike, type BiquadLike, type BufferSourceLike, type GainNodeLike,
} from '../src/client/audio/audio-service.ts';
import { FakeTarget } from './input-helpers.ts';

type Call = [kind: 'set' | 'ramp' | 'cancel', value: number, time: number];

class FakeParam implements AudioParamLike {
  value = 1;
  calls: Call[] = [];
  cancelScheduledValues(t: number): void {
    this.calls.push(['cancel', 0, t]);
  }
  setValueAtTime(v: number, t: number): void {
    this.calls.push(['set', v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push(['ramp', v, t]);
    this.value = v;
  }
}

class FakeNode {
  to: object[] = [];
  connect(d: object): void {
    this.to.push(d);
  }
  disconnect(): void {
    this.to = [];
  }
}
class FakeGain extends FakeNode implements GainNodeLike {
  gain: FakeParam;
  constructor(_clock: { t: number }) {
    super();
    this.gain = new FakeParam();
  }
}
class FakeBiquad extends FakeNode implements BiquadLike {
  type = 'lowpass';
  frequency: FakeParam;
  Q: FakeParam;
  constructor(_clock: { t: number }) {
    super();
    this.frequency = new FakeParam();
    this.Q = new FakeParam();
  }
}
class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: unknown = null;
  playbackRate: FakeParam;
  onended: (() => void) | null = null;
  started: number[] = [];
  constructor(_clock: { t: number }) {
    super();
    this.playbackRate = new FakeParam();
  }
  start(when = 0): void {
    this.started.push(when);
  }
}

class FakeContext implements AudioContextLike {
  state = 'suspended';
  readonly clock = { t: 10 };
  readonly sampleRate = 8000;
  readonly destination = { id: 'destination' };
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  get currentTime(): number {
    return this.clock.t;
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.state = 'suspended';
    return Promise.resolve();
  }
  createGain(): FakeGain {
    const g = new FakeGain(this.clock);
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this.clock);
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource(this.clock);
    this.sources.push(s);
    return s;
  }
  createBuffer(_c: number, length: number): AudioBufferLike {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

function make(extra: { maxVoices?: number; audioSession?: { type: string } } = {}) {
  const ctx = new FakeContext();
  let created = 0;
  const svc = new AudioServiceImpl({ createContext: () => { created++; return ctx; }, random: () => 0.5, ...extra });
  return { ctx, svc, created: () => created };
}

describe('AudioService (AC-8)', () => {
  it('unlock() twice makes one context and resumes it once; the buses are wired master to destination, seven to master', async () => {
    const { ctx, svc, created } = make();
    await svc.unlock();
    await svc.unlock();
    expect(created()).toBe(1);
    expect(ctx.resumeCalls).toBe(1);
    expect(svc.unlocked).toBe(true);

    const master = svc.bus('master') as unknown as FakeGain;
    expect(master.to).toEqual([ctx.destination]);
    expect(CHILD_BUSES).toHaveLength(7);
    for (const id of CHILD_BUSES) expect((svc.bus(id) as unknown as FakeGain).to, id).toEqual([master]);
    // The gains start at the config values.
    for (const [id, b] of Object.entries(AUDIO_CONFIG.buses)) expect(svc.bus(id as 'master')?.gain.value, id).toBe(b.gain);
  });

  it('sets navigator.audioSession.type to playback when the browser has it', async () => {
    const session = { type: 'auto' };
    const { svc } = make({ audioSession: session });
    await svc.unlock();
    expect(session.type).toBe('playback');
  });

  it('duck(voice, -9, 80, 400) ramps music and radio to -9 dB over 80 ms; unduck ramps back over 400 ms', async () => {
    const { ctx, svc } = make();
    await svc.unlock();
    const music = svc.bus('music') as unknown as FakeGain;
    const radio = svc.bus('radio') as unknown as FakeGain;
    const sfx = svc.bus('sfx') as unknown as FakeGain;
    const musicBase = AUDIO_CONFIG.buses.music.gain;
    ctx.clock.t = 12;
    svc.duck('voice', -9, 80, 400);
    const down = music.gain.calls.filter((c) => c[0] === 'ramp');
    expect(down).toHaveLength(1);
    expect(down[0]?.[1]).toBeCloseTo(musicBase * dbToLinear(-9), 9);
    expect(down[0]?.[2]).toBeCloseTo(12.08, 9);
    expect(dbToLinear(-9)).toBeCloseTo(0.3548, 4);
    expect(radio.gain.calls.some((c) => c[0] === 'ramp')).toBe(true);
    // Other buses are untouched.
    expect(sfx.gain.calls).toEqual([]);

    ctx.clock.t = 14;
    svc.unduck('voice');
    const up = music.gain.calls.filter((c) => c[0] === 'ramp').at(-1) as Call;
    expect(up[1]).toBeCloseTo(musicBase, 9);
    expect(up[2]).toBeCloseTo(14.4, 9);
  });

  it('a volume set while ducked keeps the duck; the unducked gain follows the new volume', async () => {
    const { svc } = make();
    await svc.unlock();
    svc.duck('voice', -9, 80, 400);
    svc.setVolume('music', 0.5);
    const music = svc.bus('music') as unknown as FakeGain;
    expect(music.gain.value).toBeCloseTo(0.5 * dbToLinear(-9), 9);
    svc.unduck('voice');
    expect(music.gain.value).toBeCloseTo(0.5, 9);
  });

  it('hidden suspends once and visible resumes once', async () => {
    const { ctx, svc } = make();
    await svc.unlock();
    expect(ctx.resumeCalls).toBe(1);
    const doc = new FakeTarget();
    const state = { v: 'visible' };
    svc.attachLifecycle(doc, () => state.v);
    state.v = 'hidden';
    doc.emit('visibilitychange');
    await Promise.resolve();
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');
    // A second hidden event does nothing: the context is already suspended.
    doc.emit('visibilitychange');
    expect(ctx.suspendCalls).toBe(1);
    state.v = 'visible';
    doc.emit('visibilitychange');
    await Promise.resolve();
    expect(ctx.resumeCalls).toBe(2); // the unlock's, then this one
    expect(ctx.state).toBe('running');
    doc.emit('visibilitychange');
    expect(ctx.resumeCalls).toBe(2);
  });

  it('suspend and resume before unlock do nothing', () => {
    const { ctx, svc } = make();
    svc.suspend();
    svc.resume();
    expect(ctx.suspendCalls + ctx.resumeCalls).toBe(0);
  });

  it('unlockOnFirstGesture unlocks on the first pointerdown or keydown and then stops listening', async () => {
    const { svc, created } = make();
    const target = new FakeTarget();
    unlockOnFirstGesture(svc, target);
    expect(target.count('pointerdown')).toBe(1);
    target.emit('keydown');
    await Promise.resolve();
    expect(created()).toBe(1);
    expect(target.count('pointerdown')).toBe(0);
    expect(target.count('keydown')).toBe(0);
  });
});

describe('the synthesized footstep', () => {
  it('foot.step plays a band-passed noise burst on the sfx bus', async () => {
    const { ctx, svc } = make();
    await svc.unlock();
    svc.play({ tick: 1, cue: 'foot.step', bus: 'sfx' });
    expect(ctx.sources).toHaveLength(1);
    const src = ctx.sources[0] as FakeSource;
    expect(src.started).toEqual([ctx.currentTime]);
    expect(src.buffer).not.toBeNull();
    expect(svc.played).toBe(1);
    // source -> band -> envelope -> sfx
    const band = src.to[0] as FakeBiquad;
    expect(band.type).toBe('bandpass');
    expect(band.frequency.value).toBeCloseTo(AUDIO_CONFIG.footstep.bandpassHz, 6); // random() = 0.5: no spread
    const env = band.to[0] as FakeGain;
    expect(env.to).toEqual([svc.bus('sfx')]);
    expect(env.gain.calls.at(-1)).toEqual(['ramp', 0, ctx.currentTime + AUDIO_CONFIG.footstep.durationSec]);
  });

  it('does not play before the unlock or while suspended, ignores unknown cues, and respects the voice cap', async () => {
    const { ctx, svc } = make({ maxVoices: 2 });
    svc.play({ tick: 1, cue: 'foot.step', bus: 'sfx' });
    expect(ctx.sources).toHaveLength(0);
    await svc.unlock();
    svc.play({ tick: 1, cue: 'siren.loop', bus: 'sfx' });
    expect(ctx.sources).toHaveLength(0);
    svc.play({ tick: 1, cue: 'foot.step', bus: 'sfx' });
    svc.play({ tick: 2, cue: 'foot.step', bus: 'sfx' });
    svc.play({ tick: 3, cue: 'foot.step', bus: 'sfx' });
    expect(ctx.sources).toHaveLength(2);
    // A finished voice frees its slot.
    ctx.sources[0]?.onended?.();
    svc.play({ tick: 4, cue: 'foot.step', bus: 'sfx' });
    expect(ctx.sources).toHaveLength(3);
    ctx.state = 'suspended';
    svc.play({ tick: 5, cue: 'foot.step', bus: 'sfx' });
    expect(ctx.sources).toHaveLength(3);
  });
});

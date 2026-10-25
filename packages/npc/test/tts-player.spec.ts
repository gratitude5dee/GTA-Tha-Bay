import { describe, expect, it } from 'vitest';
import type { AudioChunk } from '@dv/shared/contracts/c10-npc';
import { VOICE_CATALOG } from '@dv/shared/npc';
import { CREATOR_VOICES, createVoicePreview, creatorVoiceRef, detuneCents, type VoiceClip } from '../../ui/src/creator/voice-preview.ts';
import catalogJson from '../../../content/ui/creator/catalog.json';
import { LipSyncDriver } from '../src/lipsync/driver.ts';
import { TtsPlayer } from '../src/tts/tts-player.ts';
import { b64, FakeHost, FakeNode } from './audio-fakes.ts';

// M06a4 AC-7 (second half) and AC-11: TtsPlayer does nothing before the first-gesture unlock; the creator preview plays a clip once on bus
// `voice` with detune 150 cents at pitch 0.5, shows its subtitle, and a part without a clip stays disabled.

const chunk = (sentence: number, n: number, last: boolean, over: Partial<AudioChunk> = {}): AudioChunk => ({ sentence, codec: 'mp3', b64: b64(n), last, ...over });
const settle = async (p: TtsPlayer): Promise<void> => {
  await p.idle();
  await Promise.resolve();
};

describe('TtsPlayer before and after the unlock', () => {
  it('does nothing while the audio is locked, then plays the next line', async () => {
    const host = new FakeHost();
    const player = new TtsPlayer({ audio: host });
    player.beginLine('npc_a', 't1');
    player.push('npc_a', chunk(0, 1000, true));
    await settle(player);
    expect(host.context!.decodeCalls).toEqual([]);
    expect(host.context!.sources).toEqual([]);
    expect(host.context!.gains).toEqual([]);
    expect(host.ducks).toEqual([]);
    expect(player.dropped).toBe(1);
    expect(await player.playClip({ bytes: new Uint8Array(10), codec: 'mp3' })).toBe(false);

    host.unlocked = true;
    player.beginLine('npc_a', 't1');
    player.push('npc_a', chunk(0, 1000, true));
    await settle(player);
    expect(host.context!.sources).toHaveLength(1);
  });

  it('does nothing without an audio context, and ignores a line of tier text', async () => {
    const host = new FakeHost();
    host.unlocked = true;
    host.context = null;
    const player = new TtsPlayer({ audio: host });
    player.beginLine('npc_a', 't1');
    player.push('npc_a', chunk(0, 10, true));
    await settle(player);
    expect(player.played).toBe(0);
    const ok = new FakeHost();
    ok.unlocked = true;
    const p2 = new TtsPlayer({ audio: ok });
    p2.beginLine('npc_a', 'text');
    p2.push('npc_a', chunk(0, 10, true));
    await settle(p2);
    expect(ok.context!.sources).toEqual([]);
  });
});

describe('TtsPlayer playing a line', () => {
  function setup(): { host: FakeHost; player: TtsPlayer; events: { name: string; props: unknown }[]; clock: { t: number } } {
    const host = new FakeHost();
    host.unlocked = true;
    const events: { name: string; props: unknown }[] = [];
    const clock = { t: 1000 };
    const player = new TtsPlayer({ audio: host, now: () => clock.t, telemetry: { emit: (name, props) => events.push({ name, props }) } });
    return { host, player, events, clock };
  }

  it('joins the chunks of a sentence, schedules sentences back to back on the voice bus, ducks, and reports the time to first audio once', async () => {
    const { host, player, events, clock } = setup();
    const ctx = host.context!;
    ctx.currentTime = 2;
    player.beginLine('npc_a', 't1');
    clock.t += 350;
    player.push('npc_a', chunk(0, 600, false));
    player.push('npc_a', chunk(0, 400, true)); // 1,000 bytes: 1 s of audio
    player.push('npc_a', chunk(1, 500, true)); // 0.5 s
    await settle(player);

    expect(ctx.decodeCalls).toEqual([1000, 500]);
    expect(ctx.sources).toHaveLength(2);
    const [s0, s1] = ctx.sources;
    expect(s0!.startedAt).toBeCloseTo(2.02, 6);
    expect(s1!.startedAt).toBeCloseTo(3.02, 6); // right after the first one ends
    // the chain is source -> the line's gain -> the voice bus
    expect(ctx.gains).toHaveLength(1);
    expect(s0!.connections).toEqual([ctx.gains[0]]);
    expect(s1!.connections).toEqual([ctx.gains[0]]);
    expect(ctx.gains[0]!.connections).toContain(host.voiceBus);
    expect(host.ducks).toEqual([['voice', -9, 80, 400]]);
    // 350 ms from the request plus the 20 ms scheduling margin
    expect(events).toEqual([{ name: 'npc.voice.client', props: { ttfaMs: 370, tier: 't1' } }]);

    // the line ends after the text is done and the last source has played out
    player.endLine('npc_a');
    await settle(player);
    expect(host.unducks).toEqual([]);
    s0!.onended?.();
    s1!.onended?.();
    expect(host.unducks).toEqual(['voice']);
    expect(ctx.gains[0]!.disconnected).toBe(true);
  });

  it('ends a line whose text finished while sentences were still decoding without cutting the audio off', async () => {
    const { host, player } = setup();
    player.beginLine('npc_a', 't1');
    player.push('npc_a', chunk(0, 800, true));
    player.endLine('npc_a'); // line.done arrives before the decode has settled
    await settle(player);
    expect(host.context!.sources).toHaveLength(1);
    expect(host.unducks).toEqual([]);
    host.context!.sources[0]!.onended?.();
    expect(host.unducks).toEqual(['voice']);
  });

  it('M06a5: clock() gives the scheduled window of the line on the audio clock: none before the first sentence, complete once closed, none after the line ends', async () => {
    const { host, player } = setup();
    const ctx = host.context!;
    ctx.currentTime = 2;
    player.beginLine('npc_a', 't1');
    expect(player.clock('npc_a')).toBeNull();
    player.push('npc_a', chunk(0, 1000, true)); // 1 s
    await settle(player);
    ctx.currentTime = 2.5;
    const open = player.clock('npc_a')!;
    expect(open.startS).toBeCloseTo(2.02, 6);
    expect(open.endS).toBeCloseTo(3.02, 6);
    expect(open.nowS).toBe(2.5);
    expect(open.complete).toBe(false);
    player.push('npc_a', chunk(1, 500, true)); // 0.5 s more
    player.endLine('npc_a');
    await settle(player);
    expect(player.clock('npc_a')).toMatchObject({ complete: true });
    expect(player.clock('npc_a')!.endS).toBeCloseTo(3.52, 6);
    for (const src of host.context!.sources) src.onended?.();
    expect(player.clock('npc_a')).toBeNull();
    expect(player.clock('nobody')).toBeNull();
  });

  it('copies 16 kHz PCM into an AudioBuffer instead of decoding it, and drops a sentence that will not decode', async () => {
    const { host, player } = setup();
    const ctx = host.context!;
    player.beginLine('npc_a', 't1');
    player.push('npc_a', { sentence: 0, codec: 'pcm_s16le_16000', b64: b64(3200), last: true });
    await settle(player);
    expect(ctx.pcmBuffers).toBe(1);
    expect(ctx.decodeCalls).toEqual([]);
    expect(ctx.sources).toHaveLength(1);

    ctx.failDecode = true;
    player.beginLine('npc_b', 't1');
    player.push('npc_b', chunk(0, 100, true));
    await settle(player);
    expect(ctx.sources).toHaveLength(1);
    expect(player.dropped).toBe(1);
  });

  it('starts lip-sync from the t2 alignment, and from an analyser tap for t1', async () => {
    const { host, player } = setup();
    const shapes: string[] = [];
    const clock = { t: 0 };
    const driver = new LipSyncDriver({ clock: () => clock.t });
    const lip = new TtsPlayer({
      audio: host,
      lipSync: { driver, target: () => ({ target: { setCell: (_c, _r, s) => shapes.push(s), setJaw: () => undefined }, hasJaw: false }) },
    });
    lip.beginLine('npc_a', 't2');
    lip.push('npc_a', chunk(0, 500, true, { alignment: { chars: 'bro', startS: [0, 0.1, 0.2], endS: [0.1, 0.2, 0.3] } }));
    await settle(lip);
    expect(driver.speaking()).toEqual(['npc_a']);
    for (; clock.t < 0.5; clock.t += 1 / 60) driver.update();
    expect(shapes).toEqual(expect.arrayContaining(['A', 'B', 'E']));
    lip.stop('npc_a');
    expect(driver.speaking()).toEqual([]);

    lip.beginLine('npc_b', 't1', 'one two three');
    lip.push('npc_b', chunk(0, 500, true));
    await settle(lip);
    expect(driver.speaking()).toEqual(['npc_b']);
    expect(host.context!.analysers).toHaveLength(2);
    void player;
  });

  it('replaces an unfinished line of the same NPC and releases the duck', async () => {
    const { host, player } = setup();
    player.beginLine('npc_a', 't1');
    player.push('npc_a', chunk(0, 500, true));
    await settle(player);
    player.beginLine('npc_a', 't1');
    expect(host.unducks).toEqual(['voice']);
    player.push('npc_a', chunk(0, 500, true));
    await settle(player);
    expect(host.context!.sources).toHaveLength(2);
  });

  it('places a line at the NPC position when the context has a panner', async () => {
    const host = new FakeHost();
    host.unlocked = true;
    const panner = Object.assign(new FakeNode(), { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } });
    (host.context as unknown as { createPanner: () => unknown }).createPanner = () => panner;
    const player = new TtsPlayer({ audio: host, position: () => [3, 1, -4] });
    player.beginLine('npc_a', 't1');
    player.push('npc_a', chunk(0, 500, true));
    await settle(player);
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([3, 1, -4]);
    expect(panner.connections).toContain(host.voiceBus);
  });
});

describe('the creator voice preview (AC-11)', () => {
  const clip: VoiceClip = { bytes: new Uint8Array(1500), codec: 'mp3' };

  function preview(unlocked: boolean): { host: FakeHost; press(part: string, pitch: number): Promise<boolean>; available(part: string): boolean; subtitles: (string | null)[]; loads: string[] } {
    const host = new FakeHost();
    host.unlocked = unlocked;
    const player = new TtsPlayer({ audio: host });
    const subtitles: (string | null)[] = [];
    const loads: string[] = [];
    const p = createVoicePreview({
      hasClip: (id) => id === 'voice-bay-smooth',
      loadClip: (id) => {
        loads.push(id);
        return Promise.resolve(clip);
      },
      play: (c, o) => player.playClip(c, { detuneCents: o.detuneCents, onEnded: o.onEnded }),
      unlocked: () => host.unlocked,
      subtitle: (t) => subtitles.push(t),
    });
    return { host, press: p.press, available: p.available, subtitles, loads };
  }

  it('plays the clip once on bus voice with detune 150 cents at pitch 0.5, and shows the sample line as the subtitle', async () => {
    const x = preview(true);
    expect(x.available('voice-bay-smooth')).toBe(true);
    expect(await x.press('voice-bay-smooth', 0.5)).toBe(true);
    const sources = x.host.context!.sources;
    expect(sources).toHaveLength(1);
    expect(sources[0]!.detune.value).toBe(150);
    expect(sources[0]!.connections).toEqual([x.host.voiceBus]);
    expect(sources[0]!.startedAt).toBe(0);
    expect(x.subtitles).toEqual([CREATOR_VOICES.sample]);
    sources[0]!.onended?.();
    expect(x.subtitles).toEqual([CREATOR_VOICES.sample, null]);
    // pressed while playing nothing else starts; after the end it plays again
    expect(await x.press('voice-bay-smooth', -1)).toBe(true);
    expect(x.host.context!.sources.at(-1)!.detune.value).toBe(-300);
  });

  it('keeps the button disabled for a part without a clip, and plays nothing for it', async () => {
    const x = preview(true);
    expect(x.available('voice-gravel')).toBe(false);
    expect(await x.press('voice-gravel', 0.5)).toBe(false);
    expect(x.host.context!.sources).toEqual([]);
    expect(x.loads).toEqual([]);
    expect(x.available('not-a-voice')).toBe(false);
  });

  it('plays nothing before the first-gesture unlock', async () => {
    const x = preview(false);
    expect(await x.press('voice-bay-smooth', 0.5)).toBe(false);
    expect(x.host.context!.sources).toEqual([]);
    expect(x.subtitles).toEqual([]);
  });

  it('rounds the pitch to cents and keeps it in -1..1', () => {
    expect([detuneCents(0.5), detuneCents(-0.25), detuneCents(2), detuneCents(Number.NaN)]).toEqual([150, -75, 300, 0]);
    expect(creatorVoiceRef('voice-gravel')).toBe('audio_bark/creator-voice.voice-gravel');
  });

  it('maps every creator voice part to a t1 entry of the voice catalog, and every part of the creator catalog to a voice', () => {
    const parts = (catalogJson as unknown as { slots: { voice: { id: string }[] } }).slots.voice.map((v) => v.id).sort();
    expect(Object.keys(CREATOR_VOICES.voices).sort()).toEqual(parts);
    expect(parts).toHaveLength(8);
    for (const [part, ref] of Object.entries(CREATOR_VOICES.voices)) {
      const entry = VOICE_CATALOG.entries.find((e) => e.voiceRef === ref);
      expect(entry, `${part} -> ${ref}`).toBeDefined();
      expect(entry!.tier).toBe('t1');
      expect(entry!.engine).toBe('workers_ai');
    }
  });
});

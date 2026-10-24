/**
 * M05b2 AC-5 and AC-6: the CutscenePlayer over fake media. Each of the eleven fallback triggers produces its action and outcome, nothing
 * throws, every play emits `cutscene.play` with `path` and `trigger` and no `reason`; a mixed sequence answers per item.
 */
import { describe, expect, it } from 'vitest';
import type { CutsceneRefId } from '@dv/shared/contracts/c09-cutscene';
import { CutscenePlayerImpl } from '../../src/client/cutscene/player.ts';
import { TRIGGER_ACTIONS } from '../../src/client/cutscene/triggers.ts';
import { renditionCandidates } from '../../src/client/cutscene/hosts.ts';
import { ambientAllowed, AudioSync, nudgeFor } from '../../src/client/cutscene/audio-sync.ts';
import type { MseClass, MseInstance, MseSourceBuffer } from '../../src/client/cutscene/sequence.ts';
import { CUTSCENE_CONFIG } from '../../src/client/cutscene/triggers.ts';
import { KEY_A, KEY_B, KEY_C, entry, manifest, rig, settle, type Rig } from './fakes.ts';

const REF_A = 'cut.a' as CutsceneRefId;
const REF_B = 'cut.b' as CutsceneRefId;
const REF_C = 'cut.c' as CutsceneRefId;

const player = (r: Rig): CutscenePlayerImpl => new CutscenePlayerImpl(r.deps);
const lastTelemetry = (r: Rig): Record<string, unknown> | undefined => r.telemetry.at(-1)?.props;
/** The telemetry of a play: only the five props, never `reason`. */
function expectPlayEvent(r: Rig, want: { path: string; trigger?: string; fallback: boolean }): void {
  const e = r.telemetry.at(-1);
  expect(e?.name).toBe('cutscene.play');
  expect(Object.keys(e?.props ?? {}).sort()).toEqual(['cached', 'fallback', 'key8', 'path', ...(want.trigger ? ['trigger'] : [])].sort());
  expect(e?.props).toMatchObject(want);
  expect(e?.props).not.toHaveProperty('reason');
}

describe('the trigger table', () => {
  it('names all eleven triggers of section D7', () => {
    expect(Object.keys(TRIGGER_ACTIONS).sort()).toEqual(
      ['budget', 'codec', 'degraded_sequence', 'media_error', 'mid_stall', 'not_permitted', 'not_ready', 'offline', 'policy', 'setting_off', 'start_stall'].sort(),
    );
  });
});

describe('prepare: the triggers that need no playback', () => {
  it('not_ready: route 27 answers absent, pending or failed, or the manifest 404s', async () => {
    for (const state of ['absent', 'pending', 'failed'] as const) {
      const r = rig();
      r.status.set(KEY_A, { key: KEY_A, state });
      expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'not_ready' });
      expectPlayEvent(r, { path: 'fallback', trigger: 'not_ready', fallback: true });
    }
    const r = rig();
    r.manifests.set(`https://media.test/cutscenes/${KEY_A}/manifest.json`, null);
    expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'not_ready' });
    const unknown = rig();
    expect(await player(unknown).prepare('1', ['cut.unknown' as CutsceneRefId])).toEqual({ fallback: 'not_ready' });
  });

  it('not_ready: a manifest of another key is refused unless the QA fixture mode relaxes the check', async () => {
    const r = rig();
    r.manifests.set(`https://media.test/cutscenes/${KEY_A}/manifest.json`, manifest(KEY_B));
    expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'not_ready' });
    r.deps.strictKey = false;
    expect('clips' in (await player(r).prepare('2', [REF_A]))).toBe(true);
  });

  it('policy: blocked by route 27, a roster kill, and the boot flag', async () => {
    const blocked = rig();
    blocked.status.set(KEY_A, { key: KEY_A, state: 'blocked', reason: 'kill_switched' });
    expect(await player(blocked).prepare('1', [REF_A])).toEqual({ fallback: 'policy' });
    const killed = rig();
    killed.state.suppressed = true;
    expect(await player(killed).prepare('1', [REF_A])).toEqual({ fallback: 'policy' });
    expectPlayEvent(killed, { path: 'fallback', trigger: 'policy', fallback: true });
    const flag = rig();
    flag.state.bootEnabled = false;
    expect(await player(flag).prepare('1', [REF_A])).toEqual({ fallback: 'policy' });
  });

  it('setting_off: "Generated cutscenes: Off" wins, with no network call', async () => {
    const r = rig();
    r.state.generated = false;
    let calls = 0;
    const real = r.deps.status;
    r.deps.status = (k) => (calls++, real(k));
    expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'setting_off' });
    expect(calls).toBe(0);
    expectPlayEvent(r, { path: 'fallback', trigger: 'setting_off', fallback: true });
  });

  it('offline: no network, or route 27 unreachable while the browser says offline', async () => {
    const r = rig();
    r.state.online = false;
    expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'offline' });
    const down = rig();
    down.status.set(KEY_A, null);
    down.state.online = true;
    expect(await player(down).prepare('1', [REF_A])).toEqual({ fallback: 'not_ready' });
  });

  it('codec: no rendition passes canPlayType; the pooled element goes back', async () => {
    const r = rig();
    for (const v of r.pool) v.canPlay = () => '';
    expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'codec' });
    expect(r.free.size).toBe(3);
    expect(r.budget.held()).toEqual([]);
  });

  it('budget: above 85 % of the mobile media line the smaller rendition is used, and with none that fits the play falls back', async () => {
    const r = rig([entry('cut.a', KEY_A)], 64);
    r.state.tier = 'mobile';
    // 56 MB accounted of 64: v768 (4.8 MB) would be 95 %, v540 (1.9 MB) 90 %: still above 85 %
    expect(r.budget.prepare('other', 56 * 1024 * 1024).ok).toBe(true);
    expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'budget' });
    expectPlayEvent(r, { path: 'fallback', trigger: 'budget', fallback: true });
    expect(r.free.size).toBe(3);
    // 52 MB accounted: v768 would be 88 %, v540 82 %: the smaller one is taken
    const s = rig([entry('cut.a', KEY_A)], 64);
    s.state.tier = 'mobile';
    s.budget.prepare('other', 52 * 1024 * 1024);
    const p = await player(s).prepare('1', [REF_A]);
    expect('clips' in p).toBe(true);
    expect(s.pool.some((v) => v.src.endsWith('v540.mp4'))).toBe(true);
  });

  it('not_permitted: every pooled element is in use', async () => {
    const r = rig();
    r.free.clear();
    expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'not_permitted' });
  });

  it('never throws, whatever the dependencies do', async () => {
    const r = rig();
    r.deps.status = () => Promise.reject(new Error('network'));
    expect(await player(r).prepare('1', [REF_A])).toEqual({ fallback: 'not_ready' });
    const m = rig();
    m.deps.fetchManifest = () => Promise.reject(new Error('boom'));
    expect(await player(m).prepare('1', [REF_A])).toEqual({ fallback: 'not_ready' });
  });
});

describe('rendition choice', () => {
  const ctx = (over: Partial<Parameters<typeof renditionCandidates>[1]> = {}): Parameters<typeof renditionCandidates>[1] => ({
    dataSaver: false, throughputMbps: null, screenHeightPx: 1080, baseUrl: 'b/', cfg: CUTSCENE_CONFIG, canPlayType: () => 'probably', ...over,
  });
  const m = manifest(KEY_A, { renditions: { v540: { file: 'a.mp4', bytes: 1, sha256: 'x', codecs: 'avc1.640028', kbps: 1 }, v768: { file: 'b.mp4', bytes: 2, sha256: 'x', codecs: 'avc1.640028', kbps: 1 }, v1080: { file: 'c.mp4', bytes: 3, sha256: 'x', codecs: 'avc1.640028', kbps: 1 } } });
  const first = (c: ReturnType<typeof ctx>): string | undefined => renditionCandidates(m, c)[0]?.key;

  it('v768 by default, v1080 on screens of 1440 px and taller, v540 on data saver or below 4 Mbps', () => {
    expect(first(ctx())).toBe('v768');
    expect(first(ctx({ screenHeightPx: 1440 }))).toBe('v1080');
    expect(first(ctx({ dataSaver: true }))).toBe('v540');
    expect(first(ctx({ throughputMbps: 3.9 }))).toBe('v540');
    expect(first(ctx({ throughputMbps: 4 }))).toBe('v768');
    expect(first(ctx({ dataSaver: true, screenHeightPx: 2000 }))).toBe('v540');
  });
  it('leaves out a rendition whose codec canPlayType refuses', () => {
    expect(renditionCandidates(m, ctx({ canPlayType: (t) => (t.includes('video/mp4') ? '' : 'maybe') }))).toEqual([]);
  });
});

describe('play: a clip on the flat host', () => {
  it('answers video before the host pauses the sim, shows the AI chip and subtitles, and sends done at the end', async () => {
    const r = rig();
    const p = player(r);
    const prep = await p.prepare('1', [REF_A]);
    if (!('clips' in prep)) throw new Error('expected clips');
    const clip = prep.clips[0]!;
    expect(clip.aiGenerated).toBe(true);
    expect(clip.durationMs).toBe(7000);
    expect(clip.cues).toEqual([{ startMs: 0, endMs: 1000, text: 'text of line.a.1' }]);
    expect(clip.posterUrl).toBe(`https://media.test/cutscenes/${KEY_A}/poster.webp`);
    const playing = p.play('1', prep.clips);
    await settle();
    expect(r.host.log).toEqual(['show']);
    expect(r.answers()).toEqual([{ state: 'video' }]);
    expect(r.overlay.last).toMatchObject({ aiGenerated: true });
    expect(r.pool[0]!.muted).toBe(true);
    r.pool[0]!.end();
    expect(await playing).toEqual({ path: 'video', skipped: false });
    expect(r.host.log).toEqual(['show', 'hide']);
    expect(r.done()).toHaveLength(1);
    expect(r.free.size).toBe(3);
    expect(r.budget.held()).toEqual([]);
    expectPlayEvent(r, { path: 'video', fallback: false });
  });

  it('skip ends the clip as skipped', async () => {
    const r = rig();
    const p = player(r);
    const prep = (await p.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const playing = p.play('1', prep.clips);
    await settle();
    p.skip('1');
    expect(await playing).toEqual({ path: 'video', skipped: true });
    expect(r.done()[0]).toMatchObject({ outcome: { path: 'video', skipped: true } });
  });

  it('a lost ended event does not hold the screen forever', async () => {
    const r = rig();
    const p = player(r);
    const prep = (await p.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const playing = p.play('1', prep.clips);
    await settle();
    await r.clock.advance(7000 + 2000 + 10);
    expect(await playing).toEqual({ path: 'video', skipped: false });
  });

  it('the ambient file is fetched only for generated-ambient audio with no detected speech or an approval', async () => {
    expect(ambientAllowed(undefined)).toBe(false);
    expect(ambientAllowed({ speechDetected: false })).toBe(true);
    expect(ambientAllowed({ speechDetected: true })).toBe(false);
    expect(ambientAllowed({ speechDetected: true, approvedBy: 'reviewer' })).toBe(true);
    const r = rig([entry('cut.a', KEY_A, { audio: 'generated-ambient' })]);
    const m = manifest(KEY_A, { audio: { file: 'a.m4a', lufs: -23, speechDetected: false } });
    r.manifests.set(`https://media.test/cutscenes/${KEY_A}/manifest.json`, m);
    const calls: string[] = [];
    r.deps.audio = { startLines: () => undefined, startAmbient: (u) => (calls.push(u), Promise.resolve()), positionMs: () => null, nudge: () => undefined, stop: () => calls.push('stop') };
    const p = player(r);
    const prep = (await p.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const playing = p.play('1', prep.clips);
    await settle();
    expect(calls).toEqual([`https://media.test/cutscenes/${KEY_A}/a.m4a`]);
    r.pool[0]!.end();
    await playing;
    expect(calls.at(-1)).toBe('stop');
    // the player's own choice of engine audio keeps the ambient file silent
    const quiet = rig([entry('cut.a', KEY_A, { audio: 'generated-ambient' })]);
    quiet.manifests.set(`https://media.test/cutscenes/${KEY_A}/manifest.json`, m);
    const more: string[] = [];
    quiet.deps.audio = { startLines: () => undefined, startAmbient: (u) => (more.push(u), Promise.resolve()), positionMs: () => null, nudge: () => undefined, stop: () => undefined };
    quiet.deps.audioMode = () => 'engine';
    const q = player(quiet);
    const qp = (await q.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const plays = q.play('1', qp.clips);
    await settle();
    expect(more).toEqual([]);
    quiet.pool[0]!.end();
    await plays;
  });
});

describe('play: the triggers during playback', () => {
  async function started(r: Rig): Promise<{ p: CutscenePlayerImpl; playing: Promise<unknown> }> {
    const p = player(r);
    const prep = (await p.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const playing = p.play('1', prep.clips);
    await settle();
    return { p, playing };
  }

  it('not_permitted: a play() rejection on desktop goes straight to the fallback and uncovers the world', async () => {
    const r = rig();
    r.pool[0]!.rejectPlay = ['NotAllowedError'];
    const p = player(r);
    const prep = (await p.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const out = await p.play('1', prep.clips);
    expect(out).toEqual({ path: 'fallback', skipped: false, trigger: 'not_permitted' });
    expect(r.answers()).toEqual([{ state: 'video' }, { state: 'fallback', trigger: 'not_permitted' }]);
    expect(r.host.log).toContain('hide');
    expect(r.host.log).not.toContain('tapPrompt');
    expectPlayEvent(r, { path: 'fallback', trigger: 'not_permitted', fallback: true });
    expect(r.free.size).toBe(3);
  });

  it('not_permitted on a mobile tier: "Tap to play" for 3 s; a tap plays the clip, no tap falls back', async () => {
    const tapped = rig();
    tapped.state.tier = 'mobile';
    tapped.host.tap = true;
    tapped.pool[0]!.rejectPlay = ['NotAllowedError'];
    const a = player(tapped);
    const prep = (await a.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const playing = a.play('1', prep.clips);
    await settle();
    expect(tapped.host.log).toContain('tapPrompt');
    expect(tapped.pool[0]!.playCalls).toBe(2);
    tapped.pool[0]!.end();
    expect(await playing).toEqual({ path: 'video', skipped: false });

    const timedOut = rig();
    timedOut.state.tier = 'mobile';
    timedOut.host.tap = false;
    timedOut.pool[0]!.rejectPlay = ['NotAllowedError'];
    const b = player(timedOut);
    const prepB = (await b.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    expect(await b.play('1', prepB.clips)).toEqual({ path: 'fallback', skipped: false, trigger: 'not_permitted' });
    expect(CUTSCENE_CONFIG.tapToPlayMs).toBe(3000);
  });

  it('media_error and codec: a decode error before the first frame', async () => {
    const decode = rig();
    decode.pool[0]!.loadError = 4;
    const p = player(decode);
    const prep = (await p.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    expect(await p.play('1', prep.clips)).toEqual({ path: 'fallback', skipped: false, trigger: 'codec' });
    expectPlayEvent(decode, { path: 'fallback', trigger: 'codec', fallback: true });
    const net = rig();
    net.pool[0]!.loadError = 2;
    const q = player(net);
    const prepQ = (await q.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    expect(await q.play('1', prepQ.clips)).toEqual({ path: 'fallback', skipped: false, trigger: 'media_error' });
  });

  it('media_error: a decode error while the clip shows holds last.webp and finishes in-engine', async () => {
    const r = rig();
    r.manualFallback = true;
    const { p, playing } = await started(r);
    r.pool[0]!.dispatchEvent(new Event('error'));
    await settle();
    expect(r.host.stillUrl).toBe(`https://media.test/cutscenes/${KEY_A}/last.webp`);
    r.simDone('1');
    expect(await playing).toEqual({ path: 'fallback', skipped: false, trigger: 'media_error' });
    void p;
  });

  it('start_stall: no first frame in 2.5 s (1.5 s when prefetched)', async () => {
    const r = rig();
    r.pool[0]!.noFrame = true;
    const p = player(r);
    const prep = (await p.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const playing = p.play('1', prep.clips);
    await r.clock.advance(2499);
    expect(r.answers()).toEqual([]);
    await r.clock.advance(1);
    expect(await playing).toEqual({ path: 'fallback', skipped: false, trigger: 'start_stall' });
    expect(r.answers()).toEqual([{ state: 'fallback', trigger: 'start_stall' }]);
    expect(r.host.log).not.toContain('show');
    expectPlayEvent(r, { path: 'fallback', trigger: 'start_stall', fallback: true });
    expect(r.free.size).toBe(3);

    const pre = rig();
    pre.pool[0]!.noFrame = true;
    const q = player(pre);
    q.prefetch([REF_A]);
    await settle();
    const prepQ = (await q.prepare('1', [REF_A])) as { clips: Parameters<CutscenePlayerImpl['play']>[1] };
    const playingQ = q.play('1', prepQ.clips);
    await pre.clock.advance(1499);
    expect(pre.answers()).toEqual([]);
    await pre.clock.advance(1);
    expect(await playingQ).toMatchObject({ trigger: 'start_stall' });
    expect(pre.telemetry.at(-1)?.props).toMatchObject({ cached: true });
  });

  it('mid_stall: waiting for more than 1.5 s holds last.webp, the sim finishes the beat, then the world is uncovered', async () => {
    const r = rig();
    r.manualFallback = true;
    const { playing } = await started(r);
    r.pool[0]!.dispatchEvent(new Event('waiting'));
    await r.clock.advance(1499);
    expect(r.host.stillUrl).toBeNull();
    await r.clock.advance(1);
    expect(r.host.stillUrl).toBe(`https://media.test/cutscenes/${KEY_A}/last.webp`);
    expect(r.answers()).toEqual([{ state: 'video' }, { state: 'fallback', trigger: 'mid_stall' }]);
    expect(r.overlay.last).toMatchObject({ aiGenerated: false });
    r.simDone('1');
    expect(await playing).toEqual({ path: 'fallback', skipped: false, trigger: 'mid_stall' });
    expect(r.host.visible).toBe(false);
    expect(r.done()[0]).toMatchObject({ outcome: { path: 'fallback', trigger: 'mid_stall' } });
    expectPlayEvent(r, { path: 'fallback', trigger: 'mid_stall', fallback: true });
    expect(r.free.size).toBe(3);
  });

  it('a stall that clears within 1.5 s does not fall back', async () => {
    const r = rig();
    const { playing } = await started(r);
    r.pool[0]!.dispatchEvent(new Event('waiting'));
    await r.clock.advance(1000);
    r.pool[0]!.dispatchEvent(new Event('playing'));
    await r.clock.advance(1000);
    expect(r.host.stillUrl).toBeNull();
    r.pool[0]!.end();
    expect(await playing).toEqual({ path: 'video', skipped: false });
  });

  it('qaStall freezes the clip so that the stall watch fires', async () => {
    const r = rig();
    r.manualFallback = true;
    const { p, playing } = await started(r);
    expect(p.qaStall()).toBe(true);
    await r.clock.advance(1500);
    r.simDone('1');
    expect(await playing).toMatchObject({ trigger: 'mid_stall' });
    expect(p.qaStall()).toBe(false);
  });
});

describe('request: the answer the sim waits for', () => {
  it('answers fallback within the deadline when preparing hangs, and releases the late result', async () => {
    const r = rig();
    r.deps.status = () => new Promise(() => undefined);
    const p = player(r);
    const done = p.request('7', [REF_A], ['dir.a']);
    await r.clock.advance(2499);
    expect(r.answers()).toEqual([]);
    await r.clock.advance(1);
    const outs = await done;
    expect(outs).toEqual([{ path: 'fallback', skipped: false, trigger: 'not_ready' }]);
    expect(r.answers()).toEqual([{ state: 'fallback', trigger: 'not_ready' }]);
    expect(r.overlay.log).toContain('show:cues');
    expect(r.done()).toHaveLength(1);
  });

  it('an absent clip falls back at once, with the cues of the index entry as subtitles and no AI chip', async () => {
    const r = rig();
    r.status.set(KEY_A, { key: KEY_A, state: 'absent', reason: 'not_in_catalog' });
    const outs = await player(r).request('7', [REF_A], ['dir.a']);
    expect(outs).toEqual([{ path: 'fallback', skipped: false, trigger: 'not_ready' }]);
    expect(r.overlay.last).toMatchObject({ aiGenerated: false, cues: [{ text: 'text of line.a.1' }] });
    expect(r.host.log).toEqual(['showCues', 'hideCues']);
    expect(r.clock.now()).toBe(0);
  });

  it('?beats=fallback answers fallback without asking the network', async () => {
    const r = rig();
    r.state.force = 'fallback';
    let calls = 0;
    r.deps.status = () => (calls++, Promise.resolve(null));
    const outs = await player(r).request('7', [REF_A], ['dir.a']);
    expect(outs[0]).toMatchObject({ path: 'fallback' });
    expect(calls).toBe(0);
  });

  it('plays a ready clip end to end: video, then done', async () => {
    const r = rig();
    const p = player(r);
    const run = p.request('7', [REF_A], ['dir.a']);
    await settle();
    expect(r.answers()).toEqual([{ state: 'video' }]);
    r.pool[0]!.end();
    expect(await run).toEqual([{ path: 'video', skipped: false }]);
    expect(r.done()).toHaveLength(1);
  });

  it('skip during the fallback ends the wait and reports skipped', async () => {
    const r = rig();
    r.manualFallback = true;
    r.status.set(KEY_A, { key: KEY_A, state: 'absent' });
    const p = player(r);
    const run = p.request('7', [REF_A], ['dir.a']);
    await settle();
    p.skip('7');
    expect(await run).toEqual([{ path: 'fallback', skipped: true, trigger: 'not_ready' }]);
  });
});

describe('what covers the world while a clip is resolved and pre-rolled (section D7 step 2, BD-FIX-CI10-R01)', () => {
  it('a ready clip: the armed frame is held while it resolves, the poster covers the pre-roll, the clip replaces it', async () => {
    const r = rig();
    let release: () => void = () => undefined;
    const manifestGate = new Promise<void>((res) => {
      release = res;
    });
    const real = r.deps.fetchManifest;
    r.deps.fetchManifest = async (url) => {
      await manifestGate;
      return real(url);
    };
    const p = player(r);
    const run = p.request('7', [REF_A], ['dir.a']);
    // resolving: route 27 and the manifest are still out
    expect(r.host.held).toBe('frame');
    release();
    await settle();
    expect(r.answers()).toEqual([{ state: 'video' }]);
    expect(r.host.holds).toEqual(['frame', 'poster', 'drawn']);
    expect(r.host.log).toEqual(['show']);
    r.pool[0]!.end();
    await run;
    expect(r.host.held).toBeNull();
  });

  it('the poster stays up until the first frame and goes, with the world drawn again, when the clip stalls before it', async () => {
    const r = rig();
    r.manualFallback = true;
    r.pool[0]!.noFrame = true;
    const p = player(r);
    const run = p.request('7', [REF_A], ['dir.a']);
    await settle();
    expect(r.host.held).toBe('poster');
    expect(r.host.posterUrl).toBe(`https://media.test/cutscenes/${KEY_A}/poster.webp`);
    expect(r.answers()).toEqual([]);
    await r.clock.advance(2500);
    expect(r.answers()).toEqual([{ state: 'fallback', trigger: 'start_stall' }]);
    // the in-engine fallback runs over the live world: nothing is held and only the cues are up
    expect(r.host.held).toBeNull();
    expect(r.host.visible).toBe(false);
    expect(r.host.cuesOn).toBe(true);
    r.simDone('7', undefined);
    expect(await run).toEqual([{ path: 'fallback', skipped: false, trigger: 'start_stall' }]);
    expect(r.host.holds).toEqual(['frame', 'poster', 'drawn']);
  });

  it('an absent clip: the held frame goes in the same step as the fallback answer', async () => {
    const r = rig();
    r.manualFallback = true;
    r.status.set(KEY_A, { key: KEY_A, state: 'absent', reason: 'not_in_catalog' });
    const p = player(r);
    const run = p.request('7', [REF_A], ['dir.a']);
    expect(r.host.held).toBe('frame');
    await settle();
    expect(r.answers()).toEqual([{ state: 'fallback', trigger: 'not_ready' }]);
    expect(r.host.held).toBeNull();
    expect(r.host.holds).toEqual(['frame', 'drawn']);
    r.simDone('7', undefined);
    await run;
  });

  it('a late answer: the held frame goes with the fallback at the deadline, and the clip that resolves later shows no poster', async () => {
    const r = rig();
    r.manualFallback = true;
    let resolveStatus: (s: { key: string; state: 'ready'; manifestUrl: string }) => void = () => undefined;
    r.deps.status = () => new Promise((res) => {
      resolveStatus = res;
    });
    const p = player(r);
    const run = p.request('7', [REF_A], ['dir.a']);
    await r.clock.advance(2500);
    expect(r.answers()).toEqual([{ state: 'fallback', trigger: 'not_ready' }]);
    expect(r.host.held).toBeNull();
    resolveStatus({ key: KEY_A, state: 'ready', manifestUrl: `https://media.test/cutscenes/${KEY_A}/manifest.json` });
    await settle();
    expect(r.host.posterUrl).toBeNull();
    expect(r.host.holds).toEqual(['frame', 'drawn']);
    r.simDone('7', undefined);
    await run;
    expect(r.free.size).toBe(3);
  });

  it('nothing is held when the checks without network already fall back, or under ?beats=fallback', async () => {
    const off = rig();
    off.state.generated = false;
    await player(off).request('7', [REF_A], ['dir.a']);
    const forced = rig();
    forced.state.force = 'fallback';
    await player(forced).request('7', [REF_A], ['dir.a']);
    const unknown = rig();
    await player(unknown).request('7', ['cut.unknown' as CutsceneRefId], ['dir.x']);
    for (const r of [off, forced, unknown]) expect(r.host.holds).toEqual([]);
  });

  it('a sequence holds the frame for its first item and shows no poster under a clip that is already up', async () => {
    const r = rig([entry('cut.a', KEY_A), entry('cut.b', KEY_B)]);
    const p = player(r);
    const run = p.playSequence('9', [{ ref: REF_A, fallback: '' }, { ref: REF_B, fallback: '' }]);
    expect(r.host.held).toBe('frame');
    await settle();
    r.pool.find((v) => v.src.includes(KEY_A))!.end();
    await settle();
    r.pool.find((v) => v.src.includes(KEY_B))!.end();
    await run;
    expect(r.host.holds).toEqual(['frame', 'poster', 'drawn']);
  });
});

describe('prefetch', () => {
  it('looks at most 2 refs ahead on mobile tiers and answers the next prepare from the cache', async () => {
    const r = rig([entry('cut.a', KEY_A), entry('cut.b', KEY_B), entry('cut.c', KEY_C)]);
    r.state.tier = 'mobile-low';
    let calls = 0;
    const real = r.deps.status;
    r.deps.status = (k) => (calls++, real(k));
    const p = player(r);
    p.prefetch([REF_A, REF_B, REF_C]);
    await settle();
    expect(calls).toBe(2);
    expect('clips' in (await p.prepare('1', [REF_A]))).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('sequence', () => {
  it('[null, ready, absent]: three answers carry item 0, 1, 2 with fallback, video, fallback, and the outcomes match (AC-6)', async () => {
    const r = rig([entry('cut.a', KEY_A), entry('cut.c', KEY_C)]);
    r.status.set(KEY_C, { key: KEY_C, state: 'absent' });
    const p = player(r);
    const run = p.playSequence('9', [
      { ref: null, fallback: 'dir.walkin' },
      { ref: REF_A, fallback: 'dir.a' },
      { ref: REF_C, fallback: 'dir.c' },
    ]);
    await settle();
    r.pool[0]!.end();
    await settle();
    const outs = await run;
    expect(r.answers()).toEqual([
      { item: 0, state: 'fallback', trigger: 'not_ready' },
      { item: 1, state: 'video' },
      { item: 2, state: 'fallback', trigger: 'not_ready' },
    ]);
    expect(outs.map((o) => o.path)).toEqual(['fallback', 'video', 'fallback']);
    expect(r.done()).toHaveLength(1);
    expect(r.done()[0]).toMatchObject({ outcome: { path: 'video' } });
    expect(r.telemetry.map((t) => t.props['path'])).toEqual(['fallback', 'video', 'fallback']);
    expect(r.free.size).toBe(3);
    expect(r.host.visible).toBe(false);
  });

  it('two ready clips ping-pong: the host stays up between them and the second starts when the first ends', async () => {
    const r = rig([entry('cut.a', KEY_A), entry('cut.b', KEY_B)]);
    const p = player(r);
    const run = p.playSequence('9', [{ ref: REF_A, fallback: 'dir.a' }, { ref: REF_B, fallback: 'dir.b' }]);
    await settle();
    expect(r.answers()).toEqual([{ item: 0, state: 'video' }]);
    // the second clip is already loading on its own element
    expect(r.pool.filter((v) => v.src !== '')).toHaveLength(2);
    r.pool[0]!.end();
    await settle();
    expect(r.answers()).toEqual([{ item: 0, state: 'video' }, { item: 1, state: 'video' }]);
    expect(r.host.log).toEqual(['show', 'show']);
    r.pool[1]!.end();
    expect((await run).map((o) => o.path)).toEqual(['video', 'video']);
    expect(r.host.log).toEqual(['show', 'show', 'hide']);
  });

  it('degraded_sequence: a degraded clip joins by ping-pong and reports the trigger', async () => {
    const r = rig([entry('cut.a', KEY_A), entry('cut.b', KEY_B)]);
    r.manifests.set(`https://media.test/cutscenes/${KEY_B}/manifest.json`, manifest(KEY_B, { degraded: true, renditions: { p720: { file: 'p720.mp4', bytes: 1000, sha256: 'x', codecs: 'avc1.640028', kbps: 1 } } }));
    const p = player(r);
    const run = p.playSequence('9', [{ ref: REF_A, fallback: 'dir.a' }, { ref: REF_B, fallback: 'dir.b' }]);
    await settle();
    r.pool[0]!.end();
    await settle();
    r.pool[1]!.end();
    const outs = await run;
    expect(outs[0]).toEqual({ path: 'video', skipped: false });
    expect(outs[1]).toEqual({ path: 'video', skipped: false, trigger: 'degraded_sequence' });
    expect(lastTelemetry(r)).toMatchObject({ path: 'video', trigger: 'degraded_sequence', fallback: false });
    expect(lastTelemetry(r)).not.toHaveProperty('reason');
  });

  it('a skip ends the whole sequence and gives the pre-rolled clip back', async () => {
    const r = rig([entry('cut.a', KEY_A), entry('cut.b', KEY_B)]);
    const p = player(r);
    const run = p.playSequence('9', [{ ref: REF_A, fallback: 'dir.a' }, { ref: REF_B, fallback: 'dir.b' }]);
    await settle();
    p.skip('9');
    const outs = await run;
    await settle();
    expect(outs).toEqual([{ path: 'video', skipped: true }, { path: 'fallback', skipped: true }]);
    expect(r.free.size).toBe(3);
    expect(r.budget.held()).toEqual([]);
  });

  describe('MSE sequence mode', () => {
    class FakeSb implements MseSourceBuffer {
      mode = 'segments';
      updating = false;
      private l: (() => void)[] = [];
      appended = 0;
      addEventListener(_t: string, l: () => void): void {
        this.l.push(l);
      }
      appendBuffer(): void {
        this.appended++;
        queueMicrotask(() => this.l.forEach((f) => f()));
      }
    }
    const sbs: FakeSb[] = [];
    class FakeMs implements MseInstance {
      static isTypeSupported(): boolean {
        return true;
      }
      readyState = 'open';
      private open: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => this.open?.());
      }
      addEventListener(t: string, l: () => void): void {
        if (t === 'sourceopen') {
          this.open = l;
          queueMicrotask(l);
        }
      }
      addSourceBuffer(): MseSourceBuffer {
        const sb = new FakeSb();
        sbs.push(sb);
        return sb;
      }
      endOfStream(): void {
        this.readyState = 'ended';
      }
    }

    it('joins two ready fMP4 clips in one source buffer in sequence mode and answers per item as the playhead moves', async () => {
      const r = rig([entry('cut.a', KEY_A), entry('cut.b', KEY_B)]);
      r.deps.mse = { globals: { ManagedMediaSource: FakeMs as unknown as MseClass }, fetchBytes: () => Promise.resolve(new ArrayBuffer(4)), createObjectURL: () => 'blob:seq', revokeObjectURL: () => undefined };
      const p = player(r);
      const run = p.playSequence('9', [{ ref: REF_A, fallback: 'dir.a' }, { ref: REF_B, fallback: 'dir.b' }]);
      await settle();
      await settle();
      expect(sbs[0]?.mode).toBe('sequence');
      expect(sbs[0]?.appended).toBe(2);
      expect(r.answers()).toEqual([{ item: 0, state: 'video' }]);
      const v = r.pool.find((x) => x.src === 'blob:seq')!;
      expect(v.disableRemotePlayback).toBe(true);
      v.currentTime = 7.1;
      v.dispatchEvent(new Event('timeupdate'));
      expect(r.answers()).toEqual([{ item: 0, state: 'video' }, { item: 1, state: 'video' }]);
      v.end();
      const outs = await run;
      expect(outs.map((o) => o.path)).toEqual(['video', 'video']);
      expect(r.free.size).toBe(3);
      expect(r.budget.held()).toEqual([]);
    });

    it('falls back to ping-pong when the browser has no MSE or a clip is not ready', async () => {
      const r = rig([entry('cut.a', KEY_A), entry('cut.b', KEY_B)]);
      r.deps.mse = { globals: {}, fetchBytes: () => Promise.resolve(new ArrayBuffer(4)), createObjectURL: () => 'blob:seq', revokeObjectURL: () => undefined };
      const p = player(r);
      const run = p.playSequence('9', [{ ref: REF_A, fallback: 'dir.a' }, { ref: REF_B, fallback: 'dir.b' }]);
      await settle();
      expect(r.pool.some((v) => v.src === 'blob:seq')).toBe(false);
      r.pool[0]!.end();
      await settle();
      r.pool[1]!.end();
      expect((await run).map((o) => o.path)).toEqual(['video', 'video']);
    });
  });
});

describe('audio sync', () => {
  it('nudges beyond 45 ms and leaves a smaller drift alone', () => {
    expect(nudgeFor(1000, 1030, 45)).toBe(0);
    expect(nudgeFor(1000, 1045, 45)).toBe(0);
    expect(nudgeFor(1000, 1046, 45)).toBe(-46);
    expect(nudgeFor(1000, 900, 45)).toBe(100);
  });

  it('compares on every presented frame', () => {
    const calls: number[] = [];
    let cb: (() => void) | null = null;
    const video = { currentTime: 1, requestVideoFrameCallback: (f: () => void) => ((cb = f), 1), cancelVideoFrameCallback: () => undefined };
    const clock = rig().clock;
    const sync = new AudioSync(video, { positionMs: () => 1100, nudge: (d) => void calls.push(d) }, clock, CUTSCENE_CONFIG);
    sync.start();
    (cb as (() => void) | null)?.();
    expect(calls).toEqual([-100]);
    expect(sync.nudges).toBe(1);
    sync.stop();
  });
});

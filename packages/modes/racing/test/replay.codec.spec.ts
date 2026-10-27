/**
 * AC-5: a 90 s recorded lap round-trips through the replay codec without loss, stays inside the size caps, a header from another
 * `handlingRev`, `buildId` or `worldBake` is flagged, and `buildScoreSubmit` sets `replaySha256` to the SHA-256 of the bytes.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSIST, decodeInputs, decodeReplay, decodeTrack, encodeInputs, encodeReplay, encodeTrack, fromBase64, packReplayFrame, REPLAY_BUTTON, REPLAY_LIMITS,
  replayMismatch, replaySizes, replaySha256, replayWithinLimits, sha256Hex, SimButton, splitmix32, toBase64, type InputFrame, type ReplayHeaderV1,
} from '@dv/shared';
import { buildScoreSubmit, nullLeaderboard, timeBoard } from '../src/leaderboard.ts';
import { ReplayRecorder } from '../src/sim/recorder.ts';
import { raceDef } from '../src/races.ts';

const frame = (tick: number, steer: number, throttle: number, brake: number, buttons = 0): InputFrame => ({
  tick, buttons, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle, brake, steer, camYaw: 0, camPitch: 0, context: 1, device: 7,
});

/** A driver-like 90 s lap at 60 Hz: a smooth steer that moves at most 25 a tick, a throttle that steps and a brake that ramps. */
function lap(seconds: number, seed = 7): InputFrame[] {
  const out: InputFrame[] = [];
  let s = seed;
  let steer = 0;
  let target = 0;
  let throttle = 100;
  let brake = 0;
  for (let t = 0; t < seconds * 60; t++) {
    s = splitmix32(s);
    if (t % 45 === 0) target = ((s >>> 8) % 255) - 127;
    steer += Math.max(-25, Math.min(25, Math.round((target - steer) * 0.15)));
    if (t % 90 === 0) throttle = (s >>> 3) % 3 === 0 ? 127 : 96;
    brake = t % 600 > 540 ? Math.min(127, (t % 600 - 540) * 2) : 0;
    out.push(frame(t, steer, brake > 0 ? 0 : throttle, brake, t > 300 && t % 1000 > 900 ? 1 << SimButton.Handbrake : 0));
  }
  return out;
}

const header: ReplayHeaderV1 = {
  v: 1, raceId: 'sf.circuit.embarcadero-vanness', raceVersion: 1, worldBake: 'ab'.repeat(32), buildId: 'build-1', profile: 'canonical', seed: 0xc0ffee,
  vehicleDef: 'vehicle.kestrel-quill', handlingRev: 3, upgrades: { engine: 1 }, assists: { ...DEFAULT_ASSIST }, difficulty: 'normal', hour: 18,
  weather: 'clear', startTick: 3, finishTick: 5600, gateTicks: [600, 1200, 1800], endHash: '0123456789abcdef',
};

describe('replay codec', () => {
  it('round-trips the inputs word for word', () => {
    const frames = lap(90);
    const words = frames.map((f) => packReplayFrame(f.steer, f.throttle, f.brake, f.buttons ? REPLAY_BUTTON.handbrake : 0));
    const back = decodeInputs(encodeInputs(words));
    expect(back.length).toBe(words.length);
    for (let i = 0; i < words.length; i++) expect(back[i], `tick ${i}`).toBe(words[i]);
  });

  it('round-trips every kind of delta, including large jumps, full range steer and every button', () => {
    const words: number[] = [];
    for (const s of [-127, -127, 127, 0, 1, -1, 64, -64]) for (const t of [0, 127, 3, 3]) for (const b of [0, 127, 0]) words.push(packReplayFrame(s, t, b, (s + 200) & 63));
    expect(Array.from(decodeInputs(encodeInputs(words)))).toEqual(words);
    expect(decodeInputs(encodeInputs([])).length).toBe(0);
  });

  it('a 90 s lap round-trips losslessly inside the caps', () => {
    const frames = lap(90);
    const rec = new ReplayRecorder();
    rec.begin(4);
    frames.forEach((f, i) => rec.record(f, i === 0, { x: 100 + i * 0.4, y: 5 + (i % 40) * 0.01, z: -200 - i * 0.2, yaw: ((i % 628) - 314) / 100, speedMps: 20 + (i % 50) * 0.1 }));
    const run = rec.finish(
      { v: 1, raceId: header.raceId, raceVersion: 1, worldBake: header.worldBake, buildId: 'build-1', profile: 'canonical', seed: 1, vehicleDef: header.vehicleDef, handlingRev: 3, upgrades: {}, assists: { ...DEFAULT_ASSIST }, difficulty: 'normal', hour: 18, weather: 'clear' },
      5400, [600, 1200], 'deadbeefdeadbeef', 60,
    );
    const sizes = replaySizes(run.bytes);
    expect(run.hasInputs).toBe(true);
    expect(sizes.inputsBytes).toBeLessThanOrEqual(REPLAY_LIMITS.maxInputsBytes);
    expect(sizes.trackBytes).toBeLessThanOrEqual(REPLAY_LIMITS.maxTrackBytes);
    expect(replayWithinLimits(run.bytes)).toBe(true);
    const d = decodeReplay(run.bytes);
    expect(d.h).toEqual(run.header);
    expect(d.h.trackLead).toBe(60);
    const words = frames.map((f, i) => packReplayFrame(f.steer, f.throttle, f.brake, (f.buttons ? REPLAY_BUTTON.handbrake : 0) | (i === 0 ? REPLAY_BUTTON.ready : 0)));
    expect(Array.from(d.inputs as Uint32Array)).toEqual(words);
    // the same bytes decode, re-encode and decode to the same thing
    const again = encodeReplay(d.h, Array.from(d.inputs as Uint32Array), d.track);
    expect(again).toEqual(run.bytes);
  });

  it('a track round-trips: x and z in 2 cm, y in 4 cm, yaw wraps, speed in 2 kph', () => {
    const t = new Int32Array([0, 0, 0, 65535, 0, 5, -5, 2, 3, 7, -300000, 120000, -2, 65000, 255]);
    const d = decodeTrack(encodeTrack(t, 6, 41));
    expect(Array.from(d.track)).toEqual(Array.from(t));
    expect(d.stride).toBe(6);
    expect(d.lead).toBe(41);
  });

  it('a long track is thinned to fit its cap, and the stride says how', () => {
    const rec = new ReplayRecorder();
    rec.begin(1);
    for (let i = 0; i < 60 * 600; i++) rec.record(frame(i, i % 127, 90, 0), false, { x: i * 0.31, y: 3, z: Math.sin(i / 90) * 40 * 0 + i * 0.05, yaw: (i % 6000) / 1000, speedMps: 30 + (i % 70) / 10 });
    const run = rec.finish({ v: 1, raceId: 'sf.sprint.ferry-ocean-beach', raceVersion: 1, worldBake: 'cd'.repeat(32), buildId: 'b', profile: 'canonical', seed: 1, vehicleDef: 'vehicle.kestrel-quill', handlingRev: 1, upgrades: {}, assists: { ...DEFAULT_ASSIST }, difficulty: 'normal', hour: 12, weather: 'clear' }, null, [], '');
    expect(run.trackStride).toBeGreaterThan(3);
    expect(replaySizes(run.bytes).trackBytes).toBeLessThanOrEqual(REPLAY_LIMITS.maxTrackBytes);
    // 10 minutes of a changing steer does not fit the input cap: the replay is then a track only
    expect(run.hasInputs).toBe(false);
    expect(decodeReplay(run.bytes).inputs).toBeNull();
  });

  it('a header with another handlingRev, buildId or worldBake is flagged as a mismatch', () => {
    const cur = { handlingRev: header.handlingRev, buildId: header.buildId, worldBake: header.worldBake };
    expect(replayMismatch(header, cur)).toEqual([]);
    expect(replayMismatch(header, { ...cur, handlingRev: 4 })).toEqual(['handlingRev']);
    expect(replayMismatch(header, { ...cur, buildId: 'build-2' })).toEqual(['buildId']);
    expect(replayMismatch(header, { ...cur, worldBake: 'ef'.repeat(32) })).toEqual(['worldBake']);
    expect(replayMismatch(header, { handlingRev: 9, buildId: 'x', worldBake: 'y' })).toEqual(['handlingRev', 'buildId', 'worldBake']);
  });

  it('rejects bytes that are not a replay', () => {
    expect(() => decodeReplay(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(/replay/);
    const ok = encodeReplay(header, [1, 2, 3], new Int32Array([1, 2, 3, 4, 5]));
    expect(() => decodeReplay(ok.subarray(0, ok.length - 3))).toThrow(/replay/);
  });

  it('buildScoreSubmit sets replaySha256 to the SHA-256 of the replay bytes and puts the bytes in replayB64', () => {
    const def = raceDef('sf.circuit.embarcadero-vanness');
    expect(def).not.toBeNull();
    const rec = new ReplayRecorder();
    rec.begin(1);
    for (let i = 0; i < 600; i++) rec.record(frame(i, (i % 20) - 10, 100, 0), false, { x: i, y: 0, z: 0, yaw: 0, speedMps: 20 });
    const run = rec.finish({ v: 1, raceId: header.raceId, raceVersion: 1, worldBake: def!.worldBake, buildId: 'b', profile: 'canonical', seed: 1, vehicleDef: 'vehicle.kestrel-quill', handlingRev: 1, upgrades: {}, assists: { ...DEFAULT_ASSIST }, difficulty: 'normal', hour: 12, weather: 'clear' }, 700, [100, 200], 'aa'.repeat(8));
    const sub = buildScoreSubmit(def!, run, 123456, 1, 'b');
    expect(sub).not.toBeNull();
    expect(sub!.replaySha256).toBe(sha256Hex(run.bytes));
    expect(sub!.replaySha256).toBe(replaySha256(run.bytes));
    expect(fromBase64(sub!.replayB64)).toEqual(run.bytes);
    expect(toBase64(run.bytes)).toBe(sub!.replayB64);
    expect(sub!.board).toBe(timeBoard('sf.circuit.embarcadero-vanness'));
    expect(sub!.value).toBe(123456);
    expect(sub!.gateTicks).toEqual([100, 200]);
    expect(sub!.worldBake).toBe(def!.worldBake);
  });

  it('a run without inputs, a DNF or a local run has no submission; the null leaderboard sends nothing', async () => {
    const def = raceDef('sf.circuit.embarcadero-vanness')!;
    const rec = new ReplayRecorder();
    rec.begin(1);
    rec.record(frame(1, 0, 0, 0), false, null);
    const base = { v: 1 as const, raceId: header.raceId, raceVersion: 1, worldBake: def.worldBake, buildId: 'b', profile: 'canonical' as const, seed: 1, vehicleDef: 'vehicle.kestrel-quill', handlingRev: 1, upgrades: {}, assists: { ...DEFAULT_ASSIST }, difficulty: 'normal' as const, hour: 12, weather: 'clear' };
    expect(buildScoreSubmit(def, rec.finish(base, null, [], ''), 1, 1, 'b')).toBeNull();
    const rec2 = new ReplayRecorder();
    rec2.begin(1);
    rec2.record(frame(1, 0, 0, 0), false, null);
    expect(buildScoreSubmit(def, rec2.finish({ ...base, profile: 'local' }, 5, [], ''), 1, 1, 'b')).toBeNull();
    await expect(nullLeaderboard.submit({} as never)).resolves.toBe('unavailable');
    await expect(nullLeaderboard.top('x', 5)).resolves.toEqual([]);
  });
});

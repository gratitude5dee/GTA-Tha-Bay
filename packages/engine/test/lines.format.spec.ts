/**
 * Input lines: the file format, the recorder and the player (M03a1, AC-8).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { InputFrame } from '@dv/shared';
import {
  encodeRuns, inputAt, LineFormatError, lineLength, parseLine, serializeLine, validateLine, type LineFile, type LineInput,
} from '../src/sim/lines/format.ts';
import { cruisePedals, CRUISE_BAND, CRUISE_DEADBAND, isRealInput, LinePlayer } from '../src/sim/lines/player.ts';
import { LineRecorder } from '../src/sim/lines/recorder.ts';
import { createVehicleWorld, NEUTRAL } from './vehicle-sim.ts';

const TICKS = 600;

/** A scripted session: throttle, a steer that swings, a brake at the end, one Enter-bit tap in the middle. */
function session(tick: number): InputFrame {
  const t = tick % 1000;
  const swing = ((t % 120) - 60) * 2;
  return {
    ...NEUTRAL,
    tick,
    throttle: t < 450 ? 100 : 0,
    brake: t >= 450 ? 90 : 0,
    steer: Math.max(-127, Math.min(127, swing)),
    buttons: t === 300 ? 1 << 3 : 0,
    camYaw: 49152,
    context: 1,
  };
}

function edges(frames: InputFrame[]): InputFrame[] {
  let last = 0;
  return frames.map((f) => {
    const out = { ...f, pressed: (f.buttons & ~last) >>> 0, released: (last & ~f.buttons) >>> 0 };
    last = f.buttons;
    return out;
  });
}

describe('line format', () => {
  it('run-length encodes and decodes by tick', () => {
    const a: LineInput = { buttons: 0, moveX: 0, moveY: 0, throttle: 100, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1 };
    const b: LineInput = { ...a, throttle: 0, brake: 50 };
    const runs = encodeRuns([a, a, a, b, b, a], 10);
    expect(runs.map((r) => [r.tick, r.run])).toEqual([[10, 3], [13, 2], [15, 1]]);
    expect(inputAt(runs, 9)).toBeNull();
    expect(inputAt(runs, 12)).toEqual(a);
    expect(inputAt(runs, 14)).toEqual(b);
    expect(inputAt(runs, 16)).toBeNull();
    expect(lineLength({ frames: runs })).toBe(16);
  });

  it('rejects bad files with the path of the first problem', () => {
    const ok = {
      v: 1, scenario: 's', seed: 1, profile: 'canonical', start: { pos: [0, 0, 0], yaw: 0 },
      frames: [{ tick: 0, run: 2, input: { buttons: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0 } }],
    };
    expect(() => validateLine(ok)).not.toThrow();
    expect(() => validateLine({ ...ok, v: 2 })).toThrow(/\$\.v/);
    expect(() => validateLine({ ...ok, profile: 'x' })).toThrow(/\$\.profile/);
    expect(() => validateLine({ ...ok, frames: [{ ...ok.frames[0], run: 0 }] })).toThrow(/frames\[0\]\.run/);
    expect(() => validateLine({ ...ok, frames: [{ ...ok.frames[0], input: { ...ok.frames[0]?.input, steer: 200 } }] })).toThrow(/steer/);
    expect(() => validateLine({ ...ok, frames: [ok.frames[0], { ...ok.frames[0], tick: 1 }] })).toThrow(LineFormatError);
    expect(() => validateLine({ ...ok, commands: [{ t: 'jump', tick: 0 }] })).toThrow(/commands\[0\]\.t/);
    expect(validateLine({ ...ok, commands: [{ t: 'cruise', tick: 0, speed: 8, throttle: 90 }] }).commands).toEqual([{ t: 'cruise', tick: 0, speed: 8, throttle: 90 }]);
    expect(() => validateLine({ ...ok, commands: [{ t: 'cruise', tick: 0, speed: -1 }] })).toThrow(/commands\[0\]\.speed/);
    expect(() => validateLine({ ...ok, commands: [{ t: 'cruise', tick: 0, speed: 8, brake: 128 }] })).toThrow(/commands\[0\]\.brake/);
    expect(() => parseLine('{')).toThrow(/not JSON/);
  });

  it('every committed line file validates and is in canonical form', () => {
    const dir = new URL('./lines/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.line.json'));
    expect(files.sort()).toEqual(['accel-0-100.line.json', 'brake-100-0.line.json', 'crest-jump.line.json', 'filbert.line.json', 'skidpad.line.json', 'walk-drive.line.json']);
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      expect(serializeLine(parseLine(text)) + '\n', f).toBe(text);
    }
  });

  it('records a 600 tick session, saves it, loads it byte-identical and replays to the recorded state hash', async () => {
    const live = await createVehicleWorld({ prefab: 'vehicle.sedan' });
    const rec = new LineRecorder();
    const startTick = live.sim.tick;
    rec.begin({ scenario: 'vehicle-oracle', seed: 0xc0ffee, profile: 'canonical', pos: [0, 0, 0], yaw: -Math.PI / 2, prefab: 'vehicle.sedan' });
    const sent: InputFrame[] = [];
    for (let i = 0; i < TICKS; i++) {
      live.sim.step(1, (tick) => {
        const f = edges([session(tick - startTick)])[0] as InputFrame;
        rec.record(f);
        sent.push(f);
        return { ...f, tick };
      });
    }
    const hash = live.sim.hash();
    const line = rec.end();
    expect(lineLength(line)).toBe(TICKS);

    // RLE round trip: byte-identical
    const text = serializeLine(line);
    const again = serializeLine(parseLine(text));
    expect(again).toBe(text);

    // replay in a fresh world
    const fresh = await createVehicleWorld({ prefab: 'vehicle.sedan' });
    const base = fresh.sim.tick;
    expect(base).toBe(startTick);
    const player = new LinePlayer(parseLine(text), base);
    for (let i = 0; i < TICKS; i++) fresh.sim.step(1, (tick) => player.frame(tick));
    expect(player.stoppedAt).toBeNull();
    expect(fresh.sim.hash()).toBe(hash);
    live.sim.dispose();
    fresh.sim.dispose();
  }, 60_000);

  it('derives pressed and released from the change of buttons', () => {
    const line: LineFile = {
      v: 1, scenario: 's', seed: 1, profile: 'canonical', start: { pos: [0, 0, 0], yaw: 0 },
      frames: encodeRuns([
        { buttons: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0 },
        { buttons: 8, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0 },
        { buttons: 8, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0 },
        { buttons: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0 },
      ]),
    };
    const p = new LinePlayer(line, 100);
    const f = [100, 101, 102, 103].map((t) => p.frame(t));
    expect(f.map((x) => x.pressed)).toEqual([0, 8, 0, 0]);
    expect(f.map((x) => x.released)).toEqual([0, 0, 0, 8]);
    expect(f.every((x) => x.device === 7)).toBe(true);
  });

  it('any real input stops playback on that tick and hands over the real frame', () => {
    const line = parseLine(readFileSync(new URL('./lines/accel-0-100.line.json', import.meta.url), 'utf8'));
    const p = new LinePlayer(line, 0);
    expect(p.frame(5).throttle).toBe(127);
    // a camera look is not input
    expect(isRealInput({ ...NEUTRAL, camYaw: 123, camPitch: 40 })).toBe(false);
    expect(p.frame(6, { ...NEUTRAL, tick: 6, camYaw: 9 }).throttle).toBe(127);
    expect(p.stoppedAt).toBeNull();
    const real: InputFrame = { ...NEUTRAL, tick: 7, brake: 80 };
    const got = p.frame(7, real);
    expect(got).toBe(real);
    expect(p.stoppedAt).toBe(7);
    // afterwards the line gives nothing of its own
    expect(p.frame(8).throttle).toBe(0);
    expect(p.frame(9, { ...NEUTRAL, tick: 9, steer: 12 }).steer).toBe(12);
  });

  it('waitNear holds the line clock until the player is near the point', () => {
    const input = (throttle: number): LineInput => ({ buttons: 0, moveX: 0, moveY: 0, throttle, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0 });
    const line: LineFile = {
      v: 1, scenario: 's', seed: 1, profile: 'canonical', start: { pos: [0, 0, 0], yaw: 0 },
      frames: encodeRuns([input(10), input(20), input(30)]),
      commands: [{ t: 'waitNear', tick: 1, x: 100, z: 0, r: 5, timeout: 1000 }],
    };
    let x = 0;
    const p = new LinePlayer(line, 0, () => ({ x, z: 0, yaw: 0, inVehicle: true }));
    expect(p.frame(0).throttle).toBe(10);
    // from line tick 1 the clock stands still while the player is away
    expect(p.frame(1).throttle).toBe(10);
    expect(p.frame(2).throttle).toBe(10);
    x = 97;
    expect(p.frame(3).throttle).toBe(20);
    expect(p.frame(4).throttle).toBe(30);
  });

  it('waitNear gives up after its timeout', () => {
    const input = (throttle: number): LineInput => ({ buttons: 0, moveX: 0, moveY: 0, throttle, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0 });
    const line: LineFile = {
      v: 1, scenario: 's', seed: 1, profile: 'canonical', start: { pos: [0, 0, 0], yaw: 0 },
      frames: encodeRuns([input(10), input(20), input(30)]),
      commands: [{ t: 'waitNear', tick: 1, x: 100, z: 0, r: 5, timeout: 3 }],
    };
    const p = new LinePlayer(line, 0, () => ({ x: 0, z: 0, yaw: 0, inVehicle: true }));
    const seen = [0, 1, 2, 3, 4, 5, 6].map((t) => p.frame(t).throttle);
    expect(seen).toEqual([10, 10, 10, 10, 20, 30, 0]);
  });

  it('follow steers a vehicle toward the point: a target on the right is a positive steer, one on the left a negative one', () => {
    const input: LineInput = { buttons: 0, moveX: 0, moveY: 0, throttle: 50, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1 };
    const line: LineFile = {
      v: 1, scenario: 's', seed: 1, profile: 'canonical', start: { pos: [0, 0, 0], yaw: 0 },
      frames: encodeRuns([input]),
      commands: [{ t: 'follow', tick: 0, x: 50, z: -50 }],
    };
    // the vehicle faces north (-z); the point is north-east, to its right
    const right = new LinePlayer(line, 0, () => ({ x: 0, z: 0, yaw: 0, inVehicle: true }));
    expect(right.frame(0).steer).toBeGreaterThan(40);
    const left = new LinePlayer({ ...line, commands: [{ t: 'follow', tick: 0, x: -50, z: -50 }] }, 0, () => ({ x: 0, z: 0, yaw: 0, inVehicle: true }));
    expect(left.frame(0).steer).toBeLessThan(-40);
    // already facing the point: no steer
    const ahead = new LinePlayer({ ...line, commands: [{ t: 'follow', tick: 0, x: 0, z: -80 }] }, 0, () => ({ x: 0, z: 0, yaw: 0, inVehicle: true }));
    expect(ahead.frame(0).steer).toBe(0);
  });

  it('a follow line drives the sedan to the point', async () => {
    // the sedan starts facing east on the oracle track; the point is 60 m ahead and 60 m to the south (z grows southward)
    const input: LineInput = { buttons: 0, moveX: 0, moveY: 0, throttle: 45, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1 };
    const line: LineFile = {
      v: 1, scenario: 'vehicle-oracle', seed: 1, profile: 'canonical', start: { pos: [0, 0, 0], yaw: -Math.PI / 2, prefab: 'vehicle.sedan' },
      frames: encodeRuns([input, ...Array.from({ length: 599 }, () => input)]),
      commands: [{ t: 'follow', tick: 0, x: 60, z: 60, r: 6 }],
    };
    const { runLine } = await import('./lines-runner.ts');
    const r = await runLine(line);
    const first = r.trace[0]!;
    const last = r.trace[r.trace.length - 1]!;
    const dist = (v: { x: number; z: number }): number => Math.hypot(v.x - 60, v.z - 60);
    expect(dist(last)).toBeLessThan(dist(first) - 30);
    expect(last.z).toBeGreaterThan(20);
  });

  it('cruise pedals: throttle below the target, nothing in the dead band, brake above it, never a brake that would reverse', () => {
    expect(cruisePedals(0, 8, 90, 127)).toEqual({ throttle: 90, brake: 0 });
    expect(cruisePedals(8 - CRUISE_BAND / 2, 8, 90, 127)).toEqual({ throttle: 45, brake: 0 });
    expect(cruisePedals(8, 8, 90, 127)).toEqual({ throttle: 0, brake: 0 });
    expect(cruisePedals(8 + CRUISE_DEADBAND, 8, 90, 127)).toEqual({ throttle: 0, brake: 0 });
    expect(cruisePedals(8 + CRUISE_DEADBAND + CRUISE_BAND, 8, 90, 127)).toEqual({ throttle: 0, brake: 127 });
    expect(cruisePedals(30, 8, 90, 70)).toEqual({ throttle: 0, brake: 70 });
    // a target near rest: the brake pedal at 1.5 m/s or less would select reverse
    expect(cruisePedals(1.4, 0, 90, 127)).toEqual({ throttle: 0, brake: 0 });
  });

  it('cruise replaces the line pedals on every tick from the probe speed, and only in a vehicle', () => {
    const input: LineInput = { buttons: 0, moveX: 0, moveY: 0, throttle: 127, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1 };
    const line: LineFile = {
      v: 1, scenario: 's', seed: 1, profile: 'canonical', start: { pos: [0, 0, 0], yaw: 0 },
      frames: encodeRuns(Array.from({ length: 10 }, () => input)),
      commands: [{ t: 'cruise', tick: 2, speed: 8, throttle: 90 }],
    };
    let speed = 0;
    let inVehicle = true;
    const p = new LinePlayer(line, 0, () => ({ x: 0, z: 0, yaw: 0, inVehicle, speed }));
    expect(p.frame(0).throttle).toBe(127);   // before the command's tick: the line's own pedal
    p.frame(1);
    expect(p.frame(2)).toMatchObject({ throttle: 90, brake: 0 });
    speed = 12;
    expect(p.frame(3)).toMatchObject({ throttle: 0, brake: 127 });
    speed = 8;
    expect(p.frame(4)).toMatchObject({ throttle: 0, brake: 0 });
    inVehicle = false;
    expect(p.frame(5)).toMatchObject({ throttle: 127, brake: 0 });
  });

  it('a cruise line holds the sedan at its target speed', async () => {
    const input: LineInput = { buttons: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1 };
    const line: LineFile = {
      v: 1, scenario: 'vehicle-oracle', seed: 1, profile: 'canonical', start: { pos: [0, 0, 0], yaw: -Math.PI / 2, prefab: 'vehicle.sedan' },
      frames: encodeRuns(Array.from({ length: 900 }, () => input)),
      commands: [{ t: 'cruise', tick: 0, speed: 8, throttle: 90 }],
    };
    const { runLine } = await import('./lines-runner.ts');
    const r = await runLine(line);
    // after the run-up (5 s), every tick of the last 10 s is within 1 m/s of the target
    const held = r.trace.slice(300).map((v) => v.speed);
    expect(Math.min(...held)).toBeGreaterThan(7);
    expect(Math.max(...held)).toBeLessThan(9);
  });
});

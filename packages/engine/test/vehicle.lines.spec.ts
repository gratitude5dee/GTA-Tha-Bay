/**
 * The vehicle oracle lines (M03a1, AC-3 and AC-4): the `*.line.json` files run headless in the `canonical` profile on the
 * oracle track and the measured numbers are held against the windows of 06-racing-content.md C.2 and the milestone file.
 * The golden end poses, state hashes and the 0-100 gear sequence are in `golden/lines.json` (DL-549); regenerate them with
 * `DV_UPDATE_GOLDEN=1` and review the diff.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLASS_ENVELOPE, CLASS_ORACLE, type VehicleClass } from '@dv/shared';
import { parseLine, type LineFile } from '../src/sim/lines/format.ts';
import { handlingById } from '../src/sim/vehicle/presets.ts';
import { runLine, SETTLE_TICKS } from './lines-runner.ts';

const LINE_DIR = new URL('./lines/', import.meta.url);
const GOLDEN = new URL('./golden/lines.json', import.meta.url);
const line = (name: string): LineFile => parseLine(readFileSync(new URL(`${name}.line.json`, LINE_DIR), 'utf8'));

const CLASS_D: [hp: string, prefab: string][] = [
  ['hp.compact', 'vehicle.compact'], ['hp.sedan', 'vehicle.sedan'], ['hp.rideshare', 'vehicle.rideshare'], ['hp.van', 'vehicle.van'],
  ['hp.truck', 'vehicle.truck'], ['hp.pickup', 'vehicle.pickup'], ['hp.ondine-pico', 'vehicle.ondine-pico'],
];
const POLICE: [string, string][] = [['hp.police-cruiser', 'police.cruiser'], ['hp.police-suv', 'police.suv']];
const ROBOTAXI: [string, string] = ['hp.robotaxi-ambient', 'robotaxi.default'];
const ALL = [...CLASS_D, ...POLICE, ROBOTAXI];

/** Rolling start on the 1.2 km straight for the top-speed line: metres per second along the heading. */
const ROLLING: Record<string, number> = { 'hp.police-cruiser': 55, 'hp.police-suv': 52, 'hp.robotaxi-ambient': 28 };

function withStart(l: LineFile, speed: number | undefined, frames?: LineFile['frames']): LineFile {
  const start: LineFile['start'] = { ...l.start };
  if (speed === undefined) delete start.speed;
  else start.speed = speed;
  return { ...l, start, frames: frames ?? l.frames };
}

describe('oracle lines, canonical profile', () => {
  it('0-100 kph: the seven class-D presets in 7.5-12.0 s, the cruiser 7.0 +- 0.5, the SUV 7.5 +- 0.5, the robotaxi 6.5-9.5', async () => {
    const accel = line('accel-0-100');
    const windows: Record<string, [number, number]> = { 'hp.police-cruiser': [6.5, 7.5], 'hp.police-suv': [7.0, 8.0], 'hp.robotaxi-ambient': [6.5, 9.5] };
    for (const [hp, prefab] of ALL) {
      const run = await runLine(accel, { prefab });
      const i = run.trace.findIndex((v) => v.kph >= 100);
      expect(i, `${hp} reached 100 kph`).toBeGreaterThan(0);
      const sec = (i + 1) / 60;
      const [lo, hi] = windows[hp] ?? [7.5, 12.0];
      expect(sec, `${hp} 0-100 s`).toBeGreaterThanOrEqual(lo);
      expect(sec, `${hp} 0-100 s`).toBeLessThanOrEqual(hi);
    }
  }, 240_000);

  it('stops from 100 kph within the class distance +- 8 %', async () => {
    const brake = line('brake-100-0');
    const target: Record<string, number> = {};
    for (const [hp] of ALL) target[hp] = CLASS_ORACLE[handlingById(hp).class].brakeM;
    for (const [hp, prefab] of ALL) {
      const run = await runLine(brake, { prefab });
      const x0 = run.trace[0]?.x ?? 0;
      const stop = run.trace.findIndex((v, i) => i > 5 && Math.abs(v.speed) < 0.3);
      expect(stop, `${hp} stopped`).toBeGreaterThan(0);
      const dist = (run.trace[stop]?.x ?? 0) - x0;
      const want = target[hp] as number;
      expect(dist, `${hp} braking distance m`).toBeGreaterThanOrEqual(want * 0.92);
      expect(dist, `${hp} braking distance m`).toBeLessThanOrEqual(want * 1.08);
    }
  }, 240_000);

  it('top speed: class D 140-185 kph, cruiser 210 +- 3 %, SUV 200 +- 3 %, robotaxi held at 105 +- 2', async () => {
    const accel = line('accel-0-100');
    for (const [hp, prefab] of ALL) {
      const v0 = ROLLING[hp] ?? 40;
      const l = withStart(accel, v0, [{ tick: 0, run: 1800, input: { ...(accel.frames[0]?.input as NonNullable<LineFile['frames'][0]>['input']) } }]);
      const run = await runLine(l, { prefab });
      const end = run.trace.findIndex((v) => v.x >= 1200);
      const top = Math.max(...run.trace.slice(0, end > 0 ? end : undefined).map((v) => v.kph));
      if (hp === 'hp.police-cruiser') {
        expect(top, hp).toBeGreaterThanOrEqual(210 * 0.97);
        expect(top, hp).toBeLessThanOrEqual(210 * 1.03);
      } else if (hp === 'hp.police-suv') {
        expect(top, hp).toBeGreaterThanOrEqual(200 * 0.97);
        expect(top, hp).toBeLessThanOrEqual(200 * 1.03);
      } else if (hp === ROBOTAXI[0]) {
        expect(top, hp).toBeGreaterThanOrEqual(103);
        expect(top, hp).toBeLessThanOrEqual(107);
      } else {
        expect(top, hp).toBeGreaterThanOrEqual(140);
        expect(top, hp).toBeLessThanOrEqual(185);
      }
    }
  }, 240_000);

  it('skidpad: sustained lateral g within the class mu range +- 0.08 g', async () => {
    const pad = line('skidpad');
    for (const [hp, prefab] of ALL) {
      const run = await runLine(pad, { prefab });
      const t = run.trace;
      let peak = 0;
      const win: number[] = [];
      for (let i = 1; i < t.length; i++) {
        const a = t[i - 1];
        const b = t[i];
        if (!a || !b) continue;
        const sp = Math.hypot(a.vx, a.vz);
        if (sp < 3) continue;
        const ax = (b.vx - a.vx) * 60;
        const az = (b.vz - a.vz) * 60;
        win.push(Math.abs(ax * (a.vz / sp) - az * (a.vx / sp)) / 9.81);
        if (win.length > 30) win.shift();
        if (win.length === 30) peak = Math.max(peak, win.reduce((s, x) => s + x, 0) / 30);
      }
      const cls: VehicleClass = handlingById(hp).class;
      const [lo, hi] = CLASS_ENVELOPE[cls].muLat;
      expect(peak, `${hp} lateral g`).toBeGreaterThanOrEqual(lo - 0.08);
      expect(peak, `${hp} lateral g`).toBeLessThanOrEqual(hi + 0.08);
    }
  }, 240_000);

  it('the crest jump lands on four wheels, settles in at most two bounces and costs at most 5 % damage', async () => {
    const run = await runLine(line('crest-jump'));
    const t = run.trace;
    const lip = t.findIndex((v) => v.contacts < 4 && v.x > 50);
    expect(lip, 'leaves the ground at the crest').toBeGreaterThan(0);
    // flight episodes after the first touchdown are bounces
    let airborne = false;
    let episodes = 0;
    for (let i = lip; i < t.length; i++) {
      const none = (t[i]?.contacts ?? 4) === 0;
      if (none && !airborne) episodes++;
      airborne = none;
    }
    expect(episodes - 1, 'bounces after the first landing').toBeLessThanOrEqual(2);
    const end = t[t.length - 1];
    expect(end?.contacts).toBe(4);
    expect(end?.upY).toBeGreaterThan(0.95);
    expect(1 - (end?.bodyHealth ?? 0)).toBeLessThanOrEqual(0.05);
  }, 120_000);

  it('the Filbert climb (31.5 % grade) gets the sedan to the top', async () => {
    const run = await runLine(line('filbert'));
    const top = run.trace[run.trace.length - 1];
    expect(top?.y).toBeGreaterThan(30);
  }, 120_000);
});

describe('regression oracle (AC-4)', () => {
  it('filbert.line.json (hp.sedan) is bit-identical across three runs and equals the golden; the 0-100 gear sequence equals its golden', async () => {
    const f = line('filbert');
    const runs = [await runLine(f), await runLine(f), await runLine(f)];
    const hashes = runs.map((r) => r.hash);
    expect(new Set(hashes).size).toBe(1);
    const end = runs[0]?.trace[runs[0].trace.length - 1];
    const poses = runs.map((r) => {
      const v = r.trace[r.trace.length - 1];
      return [v?.x, v?.y, v?.z, v?.vx, v?.vy, v?.vz];
    });
    expect(poses[1]).toEqual(poses[0]);
    expect(poses[2]).toEqual(poses[0]);

    const accel = await runLine(line('accel-0-100'));
    // the gear sequence up to the tick the car passes 100 kph
    const upTo = accel.trace.findIndex((v) => v.kph >= 100);
    const gears: number[] = [];
    for (const v of accel.trace.slice(0, upTo + 1)) if (gears[gears.length - 1] !== v.gear) gears.push(v.gear);
    const data = {
      filbert: { prefab: 'vehicle.sedan', ticks: SETTLE_TICKS + (runs[0]?.trace.length ?? 0), hash: hashes[0], endPose: [end?.x, end?.y, end?.z] },
      accelGears: gears,
    };
    if (process.env['DV_UPDATE_GOLDEN'] === '1') writeFileSync(GOLDEN, `${JSON.stringify(data, null, 2)}\n`);
    else if (!existsSync(GOLDEN)) throw new Error('golden/lines.json is missing; create it with DV_UPDATE_GOLDEN=1 and review the diff');
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof data;
    expect(golden.filbert.hash).toBe(hashes[0]);
    expect(golden.filbert.endPose).toEqual(data.filbert.endPose);
    expect(golden.accelGears).toEqual(gears);
  }, 120_000);
});

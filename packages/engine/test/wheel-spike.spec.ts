/**
 * The U-RAC-1 wheel-force spike (M03a2, ADR-0031): both wheel paths through the five oracle lines for three presets, 3 runs
 * each, in `canonical`, on both Rapier builds. The decision rule is fixed in the ADR before the first run and coded in
 * `decide` below. Writes `test-results/wheel-spike.json`; `golden/wheel-spike.json` holds the committed result of the run
 * that settled the decision (its `selected` is what `SELECTED_WHEEL_PATH` and the ADR must say).
 *
 * Tick costs are Node wall-clock milliseconds of a whole sim tick, informational and machine dependent.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { describe, expect, it } from 'vitest';
import { CLASS_ENVELOPE, CLASS_ORACLE, SELECTED_WHEEL_PATH, type VehicleClass } from '@dv/shared';
import { parseLine, type LineFile } from '../src/sim/lines/format.ts';
import type { PhysicsBuild, VehiclePhysics } from '../src/sim/physics/backend.ts';
import { CastrayWheelPath } from '../src/sim/vehicle/wheel-path-castray.ts';
import { ControllerWheelPath } from './wheel-path-controller.ts';
import type { WheelPath } from '../src/sim/vehicle/wheel-path.ts';
import { handlingById } from '../src/sim/vehicle/presets.ts';
import { runLine, type LineRun } from './lines-runner.ts';

type PathName = 'castray' | 'controller';
const PATHS: PathName[] = ['castray', 'controller'];
const BUILDS: PhysicsBuild[] = ['deterministic-compat', 'simd-compat'];
const PRESETS: [hp: string, prefab: string][] = [
  ['hp.sedan', 'vehicle.sedan'], ['hp.police-cruiser', 'police.cruiser'], ['hp.robotaxi-ambient', 'robotaxi.default'],
];
const LINES = ['accel-0-100', 'brake-100-0', 'skidpad', 'filbert', 'crest-jump'] as const;
type LineName = (typeof LINES)[number];
const RUNS = 3;

const LINE_DIR = new URL('./lines/', import.meta.url);
const GOLDEN = new URL('./golden/wheel-spike.json', import.meta.url);
const OUT = new URL('../../../test-results/wheel-spike.json', import.meta.url);
const line = (name: string): LineFile => parseLine(readFileSync(new URL(`${name}.line.json`, LINE_DIR), 'utf8'));

interface Check { name: string; value: number; lo: number; hi: number; pass: boolean }
interface Row {
  path: PathName; build: PhysicsBuild; preset: string; line: LineName;
  /** The oracle value of run 1 (seconds, metres, g, metres of climb or bounces, per line). */
  oracle: Record<string, number>;
  /** Null: no tolerance for this preset and line (informational). */
  check: Check | null;
  hashes: string[];
  hashesEqual: boolean;
  tickMsMean: number;
  tickMsP99: number;
  readout: { slots: number; nanSlots: number; complete: boolean };
}

const WINDOWS_0_100: Record<string, [number, number]> = { 'hp.police-cruiser': [6.5, 7.5], 'hp.robotaxi-ambient': [6.5, 9.5] };

/** The oracle value and its M03a1 AC-3/AC-4 window for one run, or `check: null` when the preset has none for the line. */
function measure(name: LineName, hp: string, run: LineRun): { oracle: Record<string, number>; check: Check | null } {
  const t = run.trace;
  switch (name) {
    case 'accel-0-100': {
      const i = t.findIndex((v) => v.kph >= 100);
      const sec = i > 0 ? (i + 1) / 60 : Number.NaN;
      const [lo, hi] = WINDOWS_0_100[hp] ?? [7.5, 12.0];
      return { oracle: { seconds: sec }, check: { name: '0-100 s', value: sec, lo, hi, pass: sec >= lo && sec <= hi } };
    }
    case 'brake-100-0': {
      const x0 = t[0]?.x ?? 0;
      const stop = t.findIndex((v, i) => i > 5 && Math.abs(v.speed) < 0.3);
      const dist = stop > 0 ? (t[stop]?.x ?? 0) - x0 : Number.NaN;
      const want = CLASS_ORACLE[handlingById(hp).class].brakeM;
      const lo = want * 0.92;
      const hi = want * 1.08;
      return { oracle: { metres: dist }, check: { name: 'braking m', value: dist, lo, hi, pass: dist >= lo && dist <= hi } };
    }
    case 'skidpad': {
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
      const [lo0, hi0] = CLASS_ENVELOPE[cls].muLat;
      const lo = lo0 - 0.08;
      const hi = hi0 + 0.08;
      return { oracle: { lateralG: peak }, check: { name: 'lateral g', value: peak, lo, hi, pass: peak >= lo && peak <= hi } };
    }
    case 'filbert': {
      const top = t[t.length - 1]?.y ?? 0;
      return { oracle: { topY: top }, check: hp === 'hp.sedan' ? { name: 'Filbert top y', value: top, lo: 30, hi: Infinity, pass: top > 30 } : null };
    }
    case 'crest-jump': {
      const lip = t.findIndex((v) => v.contacts < 4 && v.x > 50);
      let airborne = false;
      let episodes = 0;
      if (lip >= 0) {
        for (let i = lip; i < t.length; i++) {
          const none = (t[i]?.contacts ?? 4) === 0;
          if (none && !airborne) episodes++;
          airborne = none;
        }
      }
      const end = t[t.length - 1];
      const bounces = Math.max(0, episodes - 1);
      const dmg = 1 - (end?.bodyHealth ?? 0);
      const ok = lip > 0 && bounces <= 2 && end?.contacts === 4 && (end?.upY ?? 0) > 0.95 && dmg <= 0.05;
      return {
        oracle: { bounces, damage: dmg, endContacts: end?.contacts ?? 0, endUpY: end?.upY ?? 0 },
        check: hp === 'hp.sedan' ? { name: 'crest landing', value: ok ? 1 : 0, lo: 1, hi: 1, pass: ok } : null,
      };
    }
  }
}

interface Decision {
  selected: PathName;
  /** One entry per rule letter: whether it held and why. */
  rules: Record<'a' | 'b' | 'c' | 'd', { pass: boolean; why: string }>;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const p99 = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))] as number;
};

/** The rule of ADR-0031, applied to the rows. */
export function decide(rows: Row[]): Decision {
  const ctl = rows.filter((r) => r.path === 'controller');
  const cas = rows.filter((r) => r.path === 'castray');
  const incomplete = ctl.filter((r) => !r.readout.complete);
  const a = { pass: incomplete.length === 0, why: incomplete.length === 0 ? 'every WheelContact field readable' : `${incomplete[0]?.readout.nanSlots}/${incomplete[0]?.readout.slots} read slots are NaN (vLong, vLat: the controller gives no wheel-point velocity)` };
  const failed = ctl.filter((r) => r.check && !r.check.pass);
  const b = { pass: failed.length === 0, why: failed.length === 0 ? 'every oracle within tolerance' : `${failed.length} oracle rows miss, e.g. ${failed[0]?.preset} ${failed[0]?.line} ${failed[0]?.check?.name}=${failed[0]?.check?.value.toFixed(3)}` };
  const unequal = ctl.filter((r) => !r.hashesEqual);
  const c = { pass: unequal.length === 0, why: unequal.length === 0 ? 'hashes equal in all runs' : `${unequal.length} rows with unequal hashes` };
  const ratios = BUILDS.map((bd) => mean(ctl.filter((r) => r.build === bd).map((r) => r.tickMsMean)) / (mean(cas.filter((r) => r.build === bd).map((r) => r.tickMsMean)) || 1));
  const d = { pass: ratios.every((x) => x <= 1.2), why: `mean tick cost ratio controller/castray ${BUILDS.map((bd, i) => `${bd} ${(ratios[i] as number).toFixed(2)}`).join(', ')}` };
  const all = a.pass && b.pass && c.pass && d.pass;
  return { selected: all ? 'controller' : 'castray', rules: { a, b, c, d } };
}

function factory(path: PathName, sink: { ctl?: ControllerWheelPath }): (b: VehiclePhysics) => WheelPath {
  return (b) => {
    if (path === 'castray') return new CastrayWheelPath(b);
    const p = new ControllerWheelPath(b);
    sink.ctl = p;
    return p;
  };
}

async function matrix(build: PhysicsBuild): Promise<Row[]> {
  const rows: Row[] = [];
  for (const path of PATHS) {
    for (const [hp, prefab] of PRESETS) {
      for (const name of LINES) {
        const f = line(name);
        const hashes: string[] = [];
        const ms: number[] = [];
        let first: LineRun | null = null;
        const sink: { ctl?: ControllerWheelPath } = {};
        for (let r = 0; r < RUNS; r++) {
          // the Filbert line names its own vehicle (hp.sedan); the other presets climb it as informational rows
          const run = await runLine(f, { prefab, build, wheelPath: factory(path, sink), tickMs: ms });
          hashes.push(run.hash);
          first ??= run;
        }
        const m = measure(name, hp, first as LineRun);
        const nan = path === 'controller' ? (sink.ctl?.nanSlots ?? 0) : 0;
        const slots = path === 'controller' ? (sink.ctl?.slots ?? 44) : 44;
        rows.push({
          path, build, preset: hp, line: name, oracle: m.oracle, check: m.check, hashes, hashesEqual: new Set(hashes).size === 1,
          tickMsMean: mean(ms), tickMsP99: p99(ms), readout: { slots, nanSlots: nan, complete: nan === 0 },
        });
      }
    }
  }
  return rows;
}

describe('wheel path spike (U-RAC-1)', () => {
  const all: Row[] = [];

  for (const build of BUILDS) {
    it(`runs ${PATHS.length} paths x ${PRESETS.length} presets x ${LINES.length} lines x ${RUNS} runs on ${build}`, async () => {
      all.push(...(await matrix(build)));
    }, 900_000);
  }

  it('writes test-results/wheel-spike.json, decides by the ADR rule, and every castray row passes and repeats exactly', () => {
    const decision = decide(all);
    const cpu = cpus();
    const result = {
      schema: 1,
      machine: `${platform()} ${cpu[0]?.model ?? 'cpu'} x${cpu.length}, node ${process.version}`,
      rapier: '0.21.0',
      selected: decision.selected,
      rules: decision.rules,
      note: 'tickMs is the wall-clock of one whole sim tick in Node: informational, machine dependent',
      rows: all,
    };
    mkdirSync(new URL('./', OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
    if (process.env['DV_UPDATE_GOLDEN'] === '1') writeFileSync(GOLDEN, `${JSON.stringify(result, null, 2)}\n`);

    expect(all.length).toBe(PATHS.length * BUILDS.length * PRESETS.length * LINES.length);
    const castray = all.filter((r) => r.path === 'castray');
    for (const r of castray) {
      expect(r.hashesEqual, `castray ${r.build} ${r.preset} ${r.line} repeats`).toBe(true);
      if (r.check) expect(r.check.pass, `castray ${r.build} ${r.preset} ${r.line}: ${r.check.name} ${r.check.value}`).toBe(true);
      expect(r.readout.complete).toBe(true);
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { selected: string };
    expect(decision.selected, 'the rule gives the committed decision').toBe(golden.selected);
    expect(SELECTED_WHEEL_PATH).toBe(decision.selected);
  });
});

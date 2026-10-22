/**
 * AC-10: in a running race the `RaceHudVm` is published every tick with speed, gear, nitro, place, gate and timer filled; the
 * telemetry `racing.start` and `racing.finish` emitted by the session validate against the C16 registry with no `tier` prop.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { CLIENT_TELEMETRY_NAMES, straightRaceDef, type InputFrame } from '@dv/shared';
import sorrel from '../../../../content/vehicles/handling/hp.aurelian-sorrel.json';
import { RACING_CONFIG } from '../src/config.ts';
import { renderHud } from '../src/ui/index.ts';
import { buildHud, type RaceHudVm } from '../src/sim/hud-vm.ts';
import { RaceSession } from '../src/sim/session.ts';
import { durBucket, finishProps, medalsFor, startProps } from '../src/sim/telemetry.ts';
import { fakePort } from './fake-port.ts';

const def = straightRaceDef({ lengthM: 600, gates: 3 });
const schemas = JSON.parse(readFileSync(new URL('../../../shared/schemas/telemetry/names.schema.json', import.meta.url), 'utf8')) as { $defs: Record<string, object> };
const ajv = new Ajv2020({ allErrors: true, strict: false });

const frame = (tick: number, o: Partial<InputFrame> = {}): InputFrame => ({
  tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 1, device: 7, ...o,
});

function makeSession() {
  const port = fakePort(def);
  const huds: RaceHudVm[] = [];
  const events: { t: string; tick: number }[] = [];
  const telemetry: { name: string; props: Record<string, string | number | boolean> }[] = [];
  const session = new RaceSession({
    def, cfg: RACING_CONFIG as never, profile: sorrel as never, vehicleDef: 'vehicle.aurelian-sorrel', port,
    sinks: { event: (e) => events.push({ t: e.t, tick: e.tick }), hud: (vm) => huds.push(vm) },
    telemetry: { emit: (name, props) => telemetry.push({ name, props }) }, seed: 1, simProfile: 'canonical',
  });
  return { port, huds, events, telemetry, session };
}

describe('RaceHudVm', () => {
  it('is published every tick of a running race with speed, gear, nitro, place, gate and timer', () => {
    const { port, huds, session } = makeSession();
    let tick = 0;
    session.command('ready');
    for (; session.state().phase !== 'Running' && tick < 1000; tick++) session.step(frame(tick), tick);
    expect(session.state().phase).toBe('Running');
    const before = huds.length;
    port.speed = 30;
    for (let i = 0; i < 60; i++, tick++) {
      port.s += port.speed / 60;
      session.step(frame(tick, { throttle: 100 }), tick);
    }
    const run = huds.slice(before);
    expect(run).toHaveLength(60);
    for (const vm of run) {
      expect(vm.speed).toBe(108);
      expect(vm.unit).toBe('kph');
      expect(vm.gear).toBeGreaterThan(0);
      expect(vm.nitro01).toBeGreaterThanOrEqual(0);
      expect(vm.place).toBe(1);
      expect(vm.of).toBe(1);
      expect(vm.gates).toBe(3);
      expect(typeof vm.gate).toBe('number');
      expect(vm.phase).toBe('Running');
    }
    expect(run[59]!.timerMs).toBeGreaterThan(run[0]!.timerMs);
    expect(run[59]!.timerMs - run[0]!.timerMs).toBeCloseTo(59 * (1000 / 60), -1);
  });

  it('the Countdown view model carries the ticks left, and the Results card the final time', () => {
    const { port, huds, session } = makeSession();
    let tick = 0;
    session.command('ready');
    while (session.state().phase !== 'Countdown' && tick < 1000) session.step(frame(tick), tick++);
    session.step(frame(tick), tick++);
    const cd = huds[huds.length - 1]!;
    expect(cd.phase).toBe('Countdown');
    expect(cd.countdown).toBeGreaterThan(170);
    while (session.state().phase !== 'Running') session.step(frame(tick), tick++);
    port.speed = 60;
    while (session.state().phase === 'Running' && tick < 5000) {
      port.s += port.speed / 60;
      session.step(frame(tick, { throttle: 127 }), tick++);
    }
    session.step(frame(tick), tick++);
    const last = huds[huds.length - 1]!;
    expect(last.phase).toBe('Results');
    expect(last.timerMs).toBeGreaterThan(5000);
  });

  it('the HUD builder converts units and clamps rpm', () => {
    const vm = buildHud({
      speedMps: 30, unit: 'mph', rpm: 9000, redlineRpm: 8000, gear: 4, nitro01: 0.5, place: 2, of: 4, lap: 1, laps: 3, gate: 5, gates: 20, timerMs: 12345, timeLeftMs: null, split: null,
      damage: { body: 0.8, engine: 0.9, tires: [1, 1, 0.5, 1] }, driftScore: null, wrongWay: false, prompt: null, phase: 'Running', countdown: 0,
    });
    expect(vm.speed).toBe(67);
    expect(vm.rpm01).toBe(1);
    expect(vm.damage.tires).toEqual([1, 1, 0.5, 1]);
    expect(JSON.stringify(vm).length).toBeLessThan(1024);
  });

  it('renders into a DOM-free element stand-in', () => {
    const el = { innerHTML: '', dataset: {} as Record<string, string | undefined> };
    const { huds, session } = makeSession();
    session.step(frame(0), 0);
    renderHud(el, huds[0]!);
    expect(el.innerHTML).toContain('dv-race-speed');
    expect(el.dataset['phase']).toBe('Grid');
  });
});

describe('telemetry', () => {
  it('racing.start and racing.finish are registered client names with schemas, and their props validate with no tier', () => {
    expect(CLIENT_TELEMETRY_NAMES).toContain('racing.start');
    expect(CLIENT_TELEMETRY_NAMES).toContain('racing.finish');
    const { port, telemetry, session } = makeSession();
    let tick = 0;
    session.command('ready');
    while (session.state().phase !== 'Running') session.step(frame(tick), tick++);
    port.speed = 60;
    while (session.state().phase === 'Running' && tick < 5000) {
      port.s += port.speed / 60;
      session.step(frame(tick, { throttle: 127 }), tick++);
    }
    expect(telemetry.map((t) => t.name)).toEqual(['racing.start', 'racing.finish']);
    for (const t of telemetry) {
      const validate = ajv.compile(schemas.$defs[t.name] as object);
      expect(validate(t.props), `${t.name}: ${JSON.stringify(validate.errors)} ${JSON.stringify(t.props)}`).toBe(true);
      expect(Object.keys(t.props)).not.toContain('tier');
      expect(Object.keys(t.props).length).toBeLessThanOrEqual(16);
    }
    expect(telemetry[0]!.props).toEqual({ raceKind: 'sprint', class: 'A', profile: 'canonical' });
    expect(telemetry[1]!.props['outcome']).toBe('finish');
  });

  it('the helpers bucket durations and medals', () => {
    expect(durBucket(59_999)).toBe('<60');
    expect(durBucket(60_000)).toBe('60-120');
    expect(durBucket(500_000)).toBe('>480');
    expect(medalsFor({ medals: [100, 90, 80] }, 79_000)).toBe(3);
    expect(medalsFor({ medals: [100, 90, 80] }, 95_000)).toBe(1);
    expect(medalsFor({ medals: [100, 90, 80] }, 120_000)).toBe(0);
    expect(startProps({ kind: 'drift' }, { class: 'C' }, 'local')).toEqual({ raceKind: 'drift', class: 'C', profile: 'local' });
    expect(finishProps({ kind: 'sprint' }, 'dnf', 70_000, 1, 0)).toEqual({ raceKind: 'sprint', outcome: 'dnf', durBucket: '60-120', place: 1, medals: 0 });
  });
});

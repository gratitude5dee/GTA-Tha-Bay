/**
 * M05a2 AC-5 and AC-6: the DirectorScript runner (actors on their marks, the first shot on the arming tick, cues as subtitles,
 * the end marks, the same run twice, the mission RNG untouched), `defineDirector`, and the XR vantage with 300 ms fades.
 */
import type { CameraDirective } from '@dv/shared';
import { Rng } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import { describe, expect, it } from 'vitest';
import { at, beat, circle, defineDirector, DirectorAuthoringError, defineMission, dirAction, dirActor, dirCue, dirShot, markLocal, npc, stage, waitFor } from '../src/authoring/index.ts';
import { DirectorRunner, type RunnerEnv } from '../src/director/runner.ts';
import type { Comfort, Vec3 } from '../src/director/types.ts';
import { fakeWorld } from './fixtures/director-world.ts';
import { ll, makeHarness } from './harness.ts';

const SCRIPT: DirectorScript = defineDirector({
  id: 'm.t.dir.two',
  durationSec: 6,
  seed: 5,
  marks: {
    a0: markLocal(0, 0, 0, 0),
    b0: markLocal(10, 0, 0, 90),
    a1: markLocal(4, 0, -4, 0),
    b1: markLocal(6, 0, -4, 0),
    cam: markLocal(8, 0, 8),
  },
  actors: [dirActor('player', 'a0', 'a1'), dirActor('buddy', 'b0', 'b1')],
  shots: [
    dirShot(0, 'establish', 'player', { lens: 'wide', from: 'cam' }),
    dirShot(2, 'two-shot', 'player', { secondary: 'buddy' }),
    dirShot(4, 'single', 'buddy', { lens: 'tele' }),
  ],
  actions: [dirAction(1, 'buddy', 'moveTo', 'b1'), dirAction(1, 'player', 'moveTo', 'a1')],
  cues: [dirCue('line.t.hello', 500, 2500, { speaker: 'buddy' }), dirCue('line.t.bye', 3000, 5500, { speaker: 'player' })],
});

interface Trace {
  places: { tick: number; who: string; pos: Vec3; yaw: number }[];
  published: { tick: number; d: CameraDirective }[];
  subtitles: { tick: number; v: { speaker: string; line: string; startMs: number; endMs: number } | null }[];
  acts: { tick: number; do: string; who: string; mark: Vec3 | null }[];
}

function playScript(script: DirectorScript, comfort: Comfort, seed: number, ticks = script.durationSec * 60 + 10): { trace: Trace; runner: DirectorRunner; rng: Rng } {
  const world = fakeWorld({ subject: [0, 0, 0], others: { buddy: [10, 0, 0] } });
  const trace: Trace = { places: [], published: [], subtitles: [], acts: [] };
  let tick = 0;
  const rng = new Rng(seed);
  const env: RunnerEnv = {
    world,
    comfort: () => comfort,
    publish: (d) => trace.published.push({ tick, d }),
    markPos: (a) => ('local' in a ? [a.local[0], a.local[1], a.local[2]] : null),
    place: (who, pos, yaw) => trace.places.push({ tick, who, pos, yaw }),
    act: (a, mark) => trace.acts.push({ tick, do: a.do, who: a.who, mark }),
    subtitle: (v) => trace.subtitles.push({ tick, v }),
    rng,
  };
  const runner = new DirectorRunner(script, env);
  for (tick = 100; tick < 100 + ticks; tick++) {
    if (tick === 100) runner.arm(tick);
    else runner.step(tick);
    if (runner.done && tick >= 100 + script.durationSec * 60) break;
  }
  runner.finish(true, tick);
  return { trace, runner, rng };
}

describe('DirectorScript runner (AC-5)', () => {
  it('places the actors on their start marks and publishes the first shot on the arming tick', () => {
    const { trace } = playScript(SCRIPT, { reducedMotion: false, xr: false }, 5);
    const start = trace.places.filter((p) => p.tick === 100);
    expect(start.map((p) => [p.who, p.pos])).toEqual([['player', [0, 0, 0]], ['buddy', [10, 0, 0]]]);
    expect(start[1]?.yaw).toBeCloseTo(Math.PI / 2, 9);
    expect(trace.published[0]?.tick).toBe(100);
    expect(trace.published[0]?.d.mode).toBe('cinematic');
    expect(trace.published[0]?.d.shot?.kind).toBe('spline');
    expect(trace.published[0]?.d.letterbox).toBe(true);
  });

  it('shows each cue at its startMs and clears it at its end', () => {
    const { trace } = playScript(SCRIPT, { reducedMotion: false, xr: false }, 5);
    const shown = trace.subtitles.filter((s) => s.v !== null);
    expect(shown.map((s) => [s.v?.line, s.tick - 100])).toEqual([['line.t.hello', 30], ['line.t.bye', 180]]);
    expect(shown[0]?.v).toMatchObject({ speaker: 'buddy', startMs: 500, endMs: 2500 });
    const cleared = trace.subtitles.filter((s) => s.v === null).map((s) => s.tick - 100);
    expect(cleared[0]).toBe(150);
  });

  it('starts the actions at their time and puts the actors on their end marks at the end', () => {
    const { trace } = playScript(SCRIPT, { reducedMotion: false, xr: false }, 5);
    expect(trace.acts.map((a) => [a.tick - 100, a.who, a.do, a.mark])).toEqual([
      [60, 'buddy', 'moveTo', [6, 0, -4]],
      [60, 'player', 'moveTo', [4, 0, -4]],
    ]);
    const end = trace.places.filter((p) => p.tick > 100);
    expect(end.map((p) => [p.who, p.pos])).toEqual([['player', [4, 0, -4]], ['buddy', [6, 0, -4]]]);
  });

  it('changes shot at 2 s and 4 s, and gives the same shots, subtitles and placements on a second run with the same seed', () => {
    const a = playScript(SCRIPT, { reducedMotion: false, xr: false }, 5).trace;
    const b = playScript(SCRIPT, { reducedMotion: false, xr: false }, 5).trace;
    expect(a.published.map((p) => p.tick - 100)).toEqual([0, 120, 240]);
    expect(a.published.map((p) => p.d.shot?.kind)).toEqual(['spline', 'fixed', 'fixed']);
    expect(b).toEqual(a);
  });

  it('draws only from its own stream and leaves the mission RNG alone', () => {
    const orbit = defineDirector({ id: 'm.t.dir.orbit', durationSec: 3, marks: { a: markLocal(0, 0, 0) }, shots: [dirShot(0, 'orbit', 'player', { lens: 'wide' })] });
    const { rng, trace } = playScript(orbit, { reducedMotion: false, xr: false }, 9);
    expect(new Rng(9).getState()).not.toEqual(rng.getState());   // the script's stream moved
    expect(trace.published[0]?.d.shot?.kind).toBe('heli');
  });

  it('keeps the mission RNG state, the mission clock and the stage across a beat in the runtime', () => {
    const script = defineDirector({
      id: 'm.t.beat',
      durationSec: 3,
      seed: 3,
      marks: { p0: markLocal(1, 0, 1), p1: markLocal(2, 0, 2) },
      actors: [dirActor('player', 'p0', 'p1')],
      shots: [dirShot(0, 'orbit', 'player'), dirShot(1, 'single', 'player')],
      cues: [dirCue('line.t.hello', 200, 1500, { speaker: 'player' })],
    });
    const ir = defineMission({
      id: 'm.t.beat',
      version: 1,
      district: 'd1',
      cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(8, 8)) }) },
      zones: { z: circle(...ll(50, 0), 5) },
      stages: [stage('a', [waitFor(5, { id: 'hold' })], { onEnter: [beat({ director: 'm.t.beat' })] })],
    });
    const h = makeHarness({ directors: new Map([[script.id, script]]), flags: { beats: 'normal' } });
    const direct: CameraDirective[] = [];
    (h.ctx.camera as { direct: (d: CameraDirective) => void }).direct = (d) => void direct.push(d);
    h.start(ir);
    const before = h.rt.rng.getState().join(',');
    h.step(2);
    expect(direct[0]?.mode).toBe('cinematic');
    expect(h.rt.beating).toBe(true);
    h.step(20);
    expect(h.vm.get('hud.subtitle')).toMatchObject({ speaker: 'player', text: 'line.t.hello' });
    h.step(250);
    expect(h.rt.beating).toBe(false);
    expect(h.rt.rng.getState().join(',')).toBe(before);
    // 272 ticks were stepped and the beat took 180 of them: those are not mission time
    expect(h.rt.clock).toBeGreaterThan(80);
    expect(h.rt.clock).toBeLessThan(100);
  });
});

describe('XR and reduced motion for a script (AC-6)', () => {
  it('in XR publishes one directive with the vantage and 300 ms fades, and never cuts', () => {
    const { trace } = playScript(SCRIPT, { reducedMotion: false, xr: true }, 5);
    const xr = trace.published;
    // one directive on arming (fade in) and one on finishing (fade out)
    expect(xr).toHaveLength(2);
    for (const p of xr) {
      expect(p.d.mode).toBe('xr');
      expect(p.d.shot).toBeUndefined();
      expect(p.d.xr?.vantage?.pos).toEqual([0, 0, 0]);
      expect(p.d.fade?.sec).toBe(0.3);
    }
    expect(xr[0]?.d.fade?.to).toBe(0);
    expect(xr[1]?.d.fade?.to).toBe(1);
    // the actors still perform and the subtitles still show
    expect(trace.acts).toHaveLength(2);
    expect(trace.subtitles.filter((s) => s.v !== null)).toHaveLength(2);
  });

  it('with reduced motion keeps the shots of a script at least 2 s apart and fades the change', () => {
    const quick = defineDirector({
      id: 'm.t.dir.quick',
      durationSec: 8,
      marks: { a: markLocal(0, 0, 0) },
      shots: [dirShot(0, 'establish', 'player'), dirShot(0.5, 'single', 'player'), dirShot(1, 'reaction', 'player'), dirShot(5, 'insert', 'player')],
    });
    const { trace } = playScript(quick, { reducedMotion: true, xr: false }, 1);
    const ticks = trace.published.map((p) => p.tick - 100);
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i] as number) - (ticks[i - 1] as number)).toBeGreaterThanOrEqual(120);
      expect(trace.published[i]?.d.fade).toEqual({ to: 0, sec: 0.4 });
    }
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('defineDirector', () => {
  const base = { id: 'm.t.d', durationSec: 4, marks: { a: markLocal(0, 0, 0) }, shots: [dirShot(0, 'establish', 'player')] };

  it('fills in the schema, a stable seed, the letterbox and a vantage on the first mark', () => {
    const s = defineDirector(base);
    expect(s.schema).toBe('director/1');
    expect(s.letterbox).toBe(true);
    expect(s.seed).toBe(defineDirector(base).seed);
    expect(s.xrVantage).toEqual({ mark: 'a', yawDeg: 0 });
  });

  it('sorts shots and actions by time and refuses a script the runner could not play', () => {
    const s = defineDirector({ ...base, shots: [dirShot(2, 'single', 'player'), dirShot(0, 'establish', 'player')] });
    expect(s.shots.map((x) => x.atSec)).toEqual([0, 2]);
    const bad: [string, Parameters<typeof defineDirector>[0]][] = [
      ['first shot', { ...base, shots: [dirShot(1, 'single', 'player')] }],
      ['unknown mark', { ...base, actors: [dirActor('player', 'nowhere', 'a')] }],
      ['outside', { ...base, shots: [dirShot(0, 'single', 'player'), dirShot(9, 'single', 'player')] }],
      ['moveTo', { ...base, actions: [dirAction(1, 'player', 'moveTo', 'nowhere')] }],
      ['cue', { ...base, cues: [dirCue('line.t.hello', 500, 400)] }],
      ['vantage', { ...base, xrVantage: { mark: 'nope', yawDeg: 0 } }],
    ];
    for (const [needle, input] of bad) expect(() => defineDirector(input), needle).toThrow(DirectorAuthoringError);
  });
});

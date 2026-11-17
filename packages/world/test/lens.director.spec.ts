import type { CameraDirective, ShotKind } from '@dv/shared';
import { Rng } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import { describe, expect, it } from 'vitest';
import { CameraRigImpl, type CameraLike } from '../../engine/src/client/camera/rig.ts';
import { defineDirector, dirShot, markLocal } from '../../modes/story/src/authoring/index.ts';
import { AutoDirector, ON_FOOT_VOCAB, pickKind } from '../../modes/story/src/director/auto.ts';
import { DirectorRunner, type RunnerEnv } from '../../modes/story/src/director/runner.ts';
import { fakeWorld, type FakeWorld } from '../../modes/story/test/fixtures/director-world.ts';
import { LensDecider, type LensShot } from '../src/client/chunks/lens-clear.ts';
import { LOOK } from '../src/client/look/config.ts';

/**
 * BD-FIX-LENS-CLEAR-04 and -05: the real publishers of cinematic shots (the story's `DirectorRunner` and `AutoDirector`) through the real
 * camera rig into the decider of the lens-clear rule, one frame per sim tick. What the pools would do is counted on the decider:
 * `decide` walks every resident tree, so a shot must be decided once (rule 3: the set is held through the shot), and only the director's
 * `fixed` and `spline` shots give the pools a lens at all (rule 1).
 */
const FRAME = { alpha: 0, dtSec: 1 / 60, reducedMotion: false, drawDistanceM: 800 };
const REDECIDE_M = LOOK.vegetation.lens.redecideM;
const CALM = { reducedMotion: false, xr: false };
/** Walking pace, metres per tick. */
const WALK = 1.4 / 60;

function fakeCamera(): CameraLike & { pos: [number, number, number] } {
  const cam = {
    pos: [0, 0, 0] as [number, number, number],
    fov: 50,
    near: 0.5,
    far: 10,
    position: { set: (x: number, y: number, z: number) => { cam.pos = [x, y, z]; } },
    quaternion: { set: () => undefined },
    updateProjectionMatrix: () => undefined,
  };
  return cam;
}

interface Frame {
  tick: number;
  /** The kind of the shot the rig obeyed (null: no cinematic shot). */
  kind: ShotKind | null;
  /** The lens the pools were given (null: none). */
  key: string | null;
  step: ReturnType<LensDecider['step']>;
  /** Where the rig put the camera. */
  cam: [number, number, number];
}

/** Runs a publisher for `ticks` ticks: its directives go to the rig, the rig's lens of each frame to the decider. */
function film(ticks: number, each: (tick: number, publish: (d: CameraDirective) => void) => void): { frames: Frame[]; decider: LensDecider } {
  const camera = fakeCamera();
  const rig = new CameraRigImpl({ camera, targetPose: () => null, look: () => ({ yaw: 0, pitch: 0 }) });
  const decider = new LensDecider();
  const frames: Frame[] = [];
  let last: CameraDirective | null = null;
  const publish = (d: CameraDirective): void => {
    last = d;
    rig.apply(d);
  };
  for (let tick = 0; tick < ticks; tick++) {
    each(tick, publish);
    rig.update(FRAME);
    const placed = rig.placedLens;
    const shot: LensShot | null = placed ? { ...placed, aspect: 16 / 9 } : null;
    const d = last as CameraDirective | null;
    frames.push({ tick, kind: d?.mode === 'cinematic' ? (d.shot?.kind ?? null) : null, key: shot?.key ?? null, step: decider.step(shot, REDECIDE_M), cam: [...camera.pos] });
  }
  return { frames, decider };
}

/** A director script played over a fake world; `walk` moves the player along +x at walking pace. */
function play(script: DirectorScript, o: { walk?: boolean } = {}): { frames: Frame[]; decider: LensDecider; world: FakeWorld } {
  const world = fakeWorld({ subject: [0, 0, 0] });
  let runner: DirectorRunner | null = null;
  const out = film(script.durationSec * 60, (tick, publish) => {
    if (o.walk) world.at = [tick * WALK, 0, 0];
    if (!runner) {
      const env: RunnerEnv = {
        world,
        comfort: () => CALM,
        publish,
        refresh: publish,
        markPos: (a) => ('local' in a ? [a.local[0], a.local[1], a.local[2]] : null),
        place: () => undefined,
        act: () => undefined,
        subtitle: () => undefined,
        rng: new Rng(7),
      };
      runner = new DirectorRunner(script, env);
      runner.arm(tick);
    } else runner.step(tick);
  });
  return { ...out, world };
}

const decisions = (frames: readonly Frame[]): number => frames.filter((f) => f.step === 'decide').length;
const keys = (frames: readonly Frame[]): string[] => [...new Set(frames.map((f) => f.key).filter((k): k is string => k !== null))];

describe('lens clear: the director through the rig (BD-FIX-LENS-CLEAR-04, -05)', () => {
  it('an alternate of the auto-director counts its ticks down and is still one shot: one decision, held to its end', () => {
    // a seed whose first two shots on foot are `shoulder` (0.6 m to the subject's right)
    let seed = -1;
    for (let s = 0; s < 5000 && seed < 0; s++) if ([0, 1].every((i) => pickKind(ON_FOOT_VOCAB, s, i, false) === 'shoulder')) seed = s;
    expect(seed).toBeGreaterThanOrEqual(0);
    // every camera to the subject's right is blocked, so each shoulder shot goes to its first alternate (`mirror`): a `fixed` shot that the
    // auto-director re-publishes every tick with the ticks it has left
    const world = fakeWorld({ subject: [0, 0, 0], ray: (from, _dir, maxM) => (from[0] > 0.1 ? maxM * 0.4 : null) });
    const cuts: { tick: number; kind: ShotKind; ticks: number }[] = [];
    let auto: AutoDirector | null = null;
    let now = 0;
    const { frames, decider } = film(900, (tick, publish) => {
      now = tick;
      if (!auto) {
        auto = new AutoDirector({
          world, comfort: () => CALM, subject: 'player', seed, refresh: publish,
          publish: (d) => {
            if (d.shot) cuts.push({ tick: now, kind: d.shot.kind, ticks: d.shot.durationTicks });
            publish(d);
          },
        });
        auto.start(tick);
      } else auto.step(tick);
    });
    // the publisher's own record: shoulder, its alternate one tick later, and the same again when the first shot's time is up
    expect(cuts.slice(0, 4).map((c) => c.kind)).toEqual(['shoulder', 'fixed', 'shoulder', 'fixed']);
    const [, alt1, cut2, alt2] = cuts as [typeof cuts[0], typeof cuts[0], typeof cuts[0], typeof cuts[0]];
    expect(alt1.tick).toBe(1);
    expect(alt2.tick).toBe(cut2.tick + 1);
    expect(alt1.ticks).toBeGreaterThan(200);
    // the first alternate runs from tick 1 to the cut: every frame has the lens, and the set is decided on its first frame only
    const first = frames.filter((f) => f.tick >= alt1.tick && f.tick < cut2.tick);
    expect(first.length).toBe(alt1.ticks);
    expect(first.every((f) => f.kind === 'fixed' && f.key !== null)).toBe(true);
    expect(keys(first)).toEqual([`fixed|1|${seed}|${alt1.ticks}|60`]);
    expect(first.map((f) => f.step)).toEqual(['decide', ...Array.from({ length: first.length - 1 }, () => 'hold')]);
    // the cut to the next shoulder shot (a kind the rig is not given a lens for) clears the set; its alternate is a new shot and decides once
    expect(frames[cut2.tick]).toMatchObject({ kind: 'shoulder', key: null, step: 'clear' });
    const second = frames.filter((f) => f.tick >= alt2.tick && f.kind === 'fixed');
    expect(second.length).toBeGreaterThan(200);
    expect(second.filter((f) => f.step === 'decide').map((f) => f.tick)).toEqual([alt2.tick]);
    // over the whole run: as many decisions as `fixed` shots were published, not one per tick
    expect(decider.decisions).toBe(cuts.filter((c) => c.kind === 'fixed').length);
    expect(frames.filter((f) => f.key !== null).length).toBeGreaterThan(400);
  });

  it('the auto-director on a walking subject with a clear view publishes only kinds of its vocabulary: no lens, no decision', () => {
    const world = fakeWorld({ subject: [0, 0, 0] });
    let auto: AutoDirector | null = null;
    const { frames, decider } = film(600, (tick, publish) => {
      world.at = [tick * WALK, 0, 0];
      if (!auto) {
        auto = new AutoDirector({ world, comfort: () => CALM, subject: 'player', seed: 3, publish, refresh: publish });
        auto.start(tick);
      } else auto.step(tick);
    });
    const seen = [...new Set(frames.map((f) => f.kind))];
    expect(seen.length).toBeGreaterThan(0);
    for (const k of seen) expect(ON_FOOT_VOCAB).toContain(k);
    // the rig obeys the pose the director placed (the camera travels with the subject: behind it, at most 0.6 m to its side) ...
    for (const f of frames) expect(Math.abs(f.cam[0] - f.tick * WALK), `tick ${f.tick}`).toBeLessThan(0.61);
    expect((frames[599] as Frame).cam[0]).toBeGreaterThan(13);
    // ... but gives the pools no lens for these kinds
    expect(frames.every((f) => f.key === null && f.step === 'idle')).toBe(true);
    expect(decider.decisions).toBe(0);
  });

  it('a script: `establish` (a push-in) is decided once; `tracking`, `orbit` and `over-shoulder` give no lens; `single` decides once', () => {
    const script = defineDirector({
      id: 'm.t.dir.lens',
      durationSec: 10,
      seed: 5,
      marks: { a: markLocal(0, 0, 0), cam: markLocal(8, 0, 8) },
      shots: [
        dirShot(0, 'establish', 'player', { lens: 'wide', from: 'cam' }),
        dirShot(2, 'tracking', 'player'),
        dirShot(4, 'orbit', 'player'),
        dirShot(6, 'over-shoulder', 'player'),
        dirShot(8, 'single', 'player', { lens: 'tele' }),
      ],
    });
    const { frames, decider } = play(script);
    const span = (fromSec: number): Frame[] => frames.slice(fromSec * 60, fromSec * 60 + 120);
    expect(span(0).map((f) => f.kind)).toEqual(Array.from({ length: 120 }, () => 'spline'));
    expect(keys(span(0))).toEqual(['spline|1|5|120|75']);
    expect(span(0).map((f) => f.step)).toEqual(['decide', ...Array.from({ length: 119 }, () => 'hold')]);
    for (const [sec, kind] of [[2, 'chase'], [4, 'heli'], [6, 'shoulder']] as const) {
      expect(span(sec).every((f) => f.kind === kind), kind).toBe(true);
      expect(span(sec).every((f) => f.key === null), kind).toBe(true);
      expect(decisions(span(sec)), kind).toBe(0);
    }
    // the cut from the push-in to the tracking shot is the frame the trees come back; the placed kinds between are idle
    expect((frames[120] as Frame).step).toBe('clear');
    expect(frames.slice(121, 480).every((f) => f.step === 'idle')).toBe(true);
    // an orbit moves its camera all the time (0.35 rad/s at 10 m): the rig follows it without a lens
    expect(Math.hypot((frames[359] as Frame).cam[0] - (frames[240] as Frame).cam[0], (frames[359] as Frame).cam[2] - (frames[240] as Frame).cam[2])).toBeGreaterThan(5);
    expect(keys(span(8))).toEqual(['fixed|1|5|120|28']);
    expect(span(8).map((f) => f.step)).toEqual(['decide', ...Array.from({ length: 119 }, () => 'hold')]);
    expect(decider.decisions).toBe(2);
  });

  it('a `single` that follows a walking subject decides again every redecideM of lens travel, and at no other frame', () => {
    const script = defineDirector({ id: 'm.t.dir.walk', durationSec: 8, seed: 5, marks: { a: markLocal(0, 0, 0) }, shots: [dirShot(0, 'single', 'player')] });
    const { frames, decider } = play(script, { walk: true });
    expect(keys(frames)).toEqual(['fixed|1|5|480|50']);
    const at = frames.filter((f) => f.step === 'decide');
    // 1.4 m/s for 8 s is 11.2 m: the cut, and then each time the lens is more than 2 m from where the set was decided
    expect(at.length).toBe(1 + Math.floor((479 * WALK) / REDECIDE_M));
    for (let i = 1; i < at.length; i++) {
      const moved = (at[i] as Frame).cam[0] - (at[i - 1] as Frame).cam[0];
      expect(moved).toBeGreaterThan(REDECIDE_M);
      expect(moved).toBeLessThan(REDECIDE_M + 2 * WALK);
    }
    expect(decider.decisions).toBe(at.length);
    expect(frames.filter((f) => f.step === 'hold').length).toBe(480 - at.length);
  });
});

/**
 * M05a2 AC-4 and AC-6: the in-engine director's view checks (line of sight, the six alternates, the 48-tick cut, the 8-ray budget,
 * the hill rule, heli clearance) and its comfort rules (reduced motion, XR).
 */
import { describe, expect, it } from 'vitest';
import type { CameraDirective, ShotKind } from '@dv/shared';
import { AutoDirector, ON_FOOT_VOCAB, VEHICLE_VOCAB, pickKind, shotSeconds } from '../src/director/auto.ts';
import { ALTERNATES, RayBudget, adjustKind, gradeAhead } from '../src/director/validate.ts';
import { MAX_RAYS_PER_TICK, OCCLUSION_CUT_TICKS, type DirEvent, type Vec3 } from '../src/director/types.ts';
import { fakeWorld } from './fixtures/director-world.ts';

/** A seed whose first shot on foot (or in a vehicle) is `kind`. */
function seedFor(kind: ShotKind, vehicle = false, index = 0): number {
  for (let s = 0; s < 5000; s++) if (pickKind(vehicle ? VEHICLE_VOCAB : ON_FOOT_VOCAB, s, index, true) === kind) return s;
  throw new Error(`no seed gives ${kind}`);
}

const calm = { reducedMotion: false, xr: false };

interface Run {
  published: { tick: number; d: CameraDirective }[];
  log: DirEvent[];
  raysPerTick: Map<number, number>;
}

/** Runs an auto-director for `ticks` ticks over a fake world and records what it published and how many rays each tick cost. */
function run(opts: { world: ReturnType<typeof fakeWorld>; seed: number; ticks: number; comfort?: typeof calm }): Run {
  const out: Run = { published: [], log: [], raysPerTick: new Map() };
  let tick = 0;
  const dir = new AutoDirector({
    world: opts.world,
    comfort: () => opts.comfort ?? calm,
    subject: 'player',
    seed: opts.seed,
    publish: (d) => out.published.push({ tick, d }),
    log: out.log,
  });
  for (tick = 0; tick < opts.ticks; tick++) {
    const before = opts.world.rays.length;
    if (tick === 0) dir.start(tick);
    else dir.step(tick);
    out.raysPerTick.set(tick, opts.world.rays.length - before);
  }
  return out;
}

describe('director line of sight (AC-4)', () => {
  it('tries the six alternates in the stated order, then cuts after exactly 48 blocked ticks', () => {
    const seed = seedFor('shoulder');
    // a wall that every ray meets 40 % of the way: no camera and no alternate sees the subject
    const wall = fakeWorld({ ray: (_from, _dir, maxM) => maxM * 0.4 });
    const r = run({ world: wall, seed, ticks: 120 });
    const alts = r.log.filter((e) => e.t === 'alt' && e.tick === 1).map((e) => e.detail.split(' ')[0]);
    expect(alts).toEqual([...ALTERNATES]);
    const cuts = r.log.filter((e) => e.t === 'cut');
    expect(cuts.length).toBeGreaterThanOrEqual(1);
    const first = cuts[0] as DirEvent;
    // the shot starts on tick 0, is blocked from tick 1 on, and is cut on the 48th blocked tick
    expect(first.tick).toBe(OCCLUSION_CUT_TICKS);
    expect(first.detail).toBe(`blocked ${OCCLUSION_CUT_TICKS} ticks`);
    // a new shot starts on that tick
    expect(r.log.some((e) => e.t === 'shot' && e.tick === first.tick)).toBe(true);
    expect(r.published.filter((p) => p.tick === first.tick)).toHaveLength(1);
  });

  it('uses the first alternate that clears and then stays on it without counting toward a cut', () => {
    const seed = seedFor('shoulder');
    // only a camera 10 m or more above the subject sees it: mirror and pull-in-high are blocked, top-down (16 m) clears
    const world = fakeWorld({ ray: (from, _dir, maxM) => (from[1] >= 10 ? null : maxM * 0.4) });
    const r = run({ world, seed, ticks: 100 });
    const alts = r.log.filter((e) => e.t === 'alt' && e.tick === 1).map((e) => e.detail);
    expect(alts).toEqual(['mirror blocked', 'pull-in-high blocked', 'top-down clear']);
    const used = r.published.find((p) => p.tick === 1);
    expect(used?.d.shot?.kind).toBe('fixed');
    expect((used?.d.shot?.pos as Vec3)[1]).toBeGreaterThanOrEqual(10);
    expect(r.log.some((e) => e.t === 'cut')).toBe(false);
  });

  it('never casts more than 8 rays in one tick, including the start of a shot', () => {
    for (const kind of ['heli', 'rearlow', 'front', 'flyby', 'side'] as ShotKind[]) {
      const vehicle = true;
      const seed = seedFor(kind, vehicle);
      const world = fakeWorld({ vehicle, ray: (_f, _d, maxM) => maxM * 0.4 });
      const r = run({ world, seed, ticks: 300 });
      expect(Math.max(...r.raysPerTick.values()), `first kind ${kind}`).toBeLessThanOrEqual(MAX_RAYS_PER_TICK);
      expect(Math.max(...r.raysPerTick.values()), `first kind ${kind}`).toBeGreaterThan(0);
    }
  });

  it('replaces rearlow and front by side on a 16 % grade, and keeps them on a 10 % grade', () => {
    const slope = (g: number) => fakeWorld({ vehicle: true, ray: (from, dir) => (dir[1] === -1 ? from[1] - g * -from[2] : null) });
    // ground height g x (-z): a vertical ray at z = -10 (10 m ahead on a body facing -z) meets the ground at g x 10
    for (const kind of ['rearlow', 'front'] as ShotKind[]) {
      const steep = slope(0.16);
      const d = adjustKind(new RayBudget(steep), steep, 'player', kind, true);
      expect(d.kind, kind).toBe('side');
      expect(d.why).toContain('hill');
      const gentle = slope(0.1);
      expect(adjustKind(new RayBudget(gentle), gentle, 'player', kind, true).kind).toBe(kind);
    }
    const w = slope(0.16);
    expect(gradeAhead(new RayBudget(w), [0, 0, 0], 0, -1)).toBeCloseTo(0.16, 5);
  });

  it('plays the replaced shot in the auto-director: side, not rearlow', () => {
    const seed = seedFor('rearlow', true);
    const world = fakeWorld({ vehicle: true, ray: (from, dir) => (dir[1] === -1 ? from[1] - 0.16 * -from[2] : null) });
    const r = run({ world, seed, ticks: 5 });
    expect(r.published[0]?.d.shot?.kind).toBe('side');
    expect(r.log.some((e) => e.t === 'hill')).toBe(true);
  });

  it('demotes heli under 29 m of clearance to rearlow (12 m or more) or chase (less), and to shoulder on foot', () => {
    const above = (m: number, vehicle: boolean) => fakeWorld({ vehicle, ray: (_f, dir, maxM) => (dir[1] === 1 && m < maxM ? m : null) });
    let w = above(20, true);
    expect(adjustKind(new RayBudget(w), w, 'player', 'heli', true)).toMatchObject({ kind: 'rearlow' });
    w = above(8, true);
    expect(adjustKind(new RayBudget(w), w, 'player', 'heli', true)).toMatchObject({ kind: 'chase' });
    w = above(8, false);
    expect(adjustKind(new RayBudget(w), w, 'player', 'heli', false)).toMatchObject({ kind: 'shoulder' });
    w = above(35, true);
    expect(adjustKind(new RayBudget(w), w, 'player', 'heli', true)).toMatchObject({ kind: 'heli', why: '' });
    // flyby and side need only 12 m
    w = above(14, true);
    expect(adjustKind(new RayBudget(w), w, 'player', 'flyby', true).kind).toBe('flyby');
    w = above(9, true);
    expect(adjustKind(new RayBudget(w), w, 'player', 'side', true).kind).toBe('chase');
  });
});

describe('auto-director vocabulary (D6.2)', () => {
  it('keeps the vocabulary and the durations of the pattern', () => {
    expect(ON_FOOT_VOCAB).toEqual(['shoulder', 'shoulder', 'wide', 'shoulder', 'heli']);
    expect(VEHICLE_VOCAB).toEqual(['chase', 'chase', 'flyby', 'flyby', 'side', 'front', 'heli', 'rearlow', 'enemy', 'chase']);
    expect(shotSeconds('flyby', 1, 0)).toBe(3.8);
    expect(shotSeconds('front', 1, 0)).toBe(3.2);
    for (let i = 0; i < 40; i++) {
      const s = shotSeconds('chase', 9, i);
      expect(s).toBeGreaterThanOrEqual(4.2);
      expect(s).toBeLessThan(6.8);
    }
  });

  it('is a function of (seed, shot index) and skips enemy when no pursuer exists', () => {
    for (let i = 0; i < 60; i++) {
      expect(pickKind(VEHICLE_VOCAB, 5, i, true)).toBe(pickKind(VEHICLE_VOCAB, 5, i, true));
      expect(pickKind(VEHICLE_VOCAB, 5, i, false)).not.toBe('enemy');
    }
    const kinds = new Set(Array.from({ length: 200 }, (_, i) => pickKind(VEHICLE_VOCAB, 3, i, true)));
    expect(kinds.has('enemy')).toBe(true);
  });
});

describe('director comfort (AC-6)', () => {
  it('with reduced motion keeps cuts at least 2 s apart, with fades and no shake, over 60 s', () => {
    // a view that is blocked half of the time so that occlusion cuts are tried as well as timer cuts
    const world = fakeWorld({ vehicle: true, ray: (_f, _d, maxM) => (Math.floor(world.rays.length / 16) % 2 === 0 ? maxM * 0.4 : null) });
    const r = run({ world, seed: 11, ticks: 3600, comfort: { reducedMotion: true, xr: false } });
    const cuts = r.published.filter((p, i) => i > 0 && p.d.shot?.kind !== 'fixed');
    expect(cuts.length).toBeGreaterThan(3);
    const ticks = r.published.map((p) => p.tick);
    for (let i = 1; i < ticks.length; i++) {
      const d = r.published[i] as { tick: number; d: CameraDirective };
      // an alternate (kind fixed) keeps the shot; every real cut is at least 2 s after the one before
      if (d.d.shot?.kind === 'fixed') continue;
      const prevCut = [...r.published.slice(0, i)].reverse().find((p) => p.d.shot?.kind !== 'fixed');
      if (prevCut) expect(d.tick - prevCut.tick, `cut ${i}`).toBeGreaterThanOrEqual(120);
      expect(d.d.fade, `cut ${i} fades`).toEqual({ to: 0, sec: 0.4 });
    }
    for (const p of r.published) expect(p.d.shake).toBeUndefined();
  });

  it('in XR the auto-director publishes nothing: no cut, no motion', () => {
    const world = fakeWorld({ ray: () => null });
    const r = run({ world, seed: 4, ticks: 3600, comfort: { reducedMotion: false, xr: true } });
    expect(r.published).toEqual([]);
    expect(r.log.some((e) => e.t === 'cut')).toBe(false);
  });

  it('with normal motion does cut on its timer and holds each shot for its time', () => {
    const world = fakeWorld({ ray: () => null });
    const r = run({ world, seed: 2, ticks: 3600 });
    const shots = r.log.filter((e) => e.t === 'shot');
    expect(shots.length).toBeGreaterThan(8);
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1] as DirEvent;
      expect((shots[i] as DirEvent).tick - prev.tick).toBe(Number(prev.detail.split(' ')[2]));
    }
  });
});

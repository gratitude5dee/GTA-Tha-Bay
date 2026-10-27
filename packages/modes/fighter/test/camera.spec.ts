/**
 * AC-10 (FC8.4): the side camera frames the midpoint, the distance is clamped to the stage, a super dollies in over 20 frames, and
 * reduced motion has no dolly and no shake.
 */
import { FF, FIGHTER_BASE, St } from '@dv/shared/fight';
import { describe, expect, it } from 'vitest';
import { ARENA_ORIGIN, DOLLY_FRAMES, advanceCam, newCamState, planCamera, toDirective } from '../src/sim/camera.ts';
import { stageDef } from '../src/sim/data.ts';
import { newMatch } from './helpers.ts';

const cam = stageDef('powell_turntable').camera;

function at(x0: number, x1: number, over: { st0?: number; hitstop?: number } = {}): Int32Array {
  const m = newMatch();
  m.buf[(FIGHTER_BASE[0] as number) + FF.X] = x0;
  m.buf[(FIGHTER_BASE[1] as number) + FF.X] = x1;
  if (over.st0 !== undefined) m.buf[(FIGHTER_BASE[0] as number) + FF.State] = over.st0;
  if (over.hitstop !== undefined) m.buf[(FIGHTER_BASE[0] as number) + FF.Hitstop] = over.hitstop;
  return m.buf;
}

describe('the fight camera', () => {
  it('frames the midpoint and clamps the distance to the stage', () => {
    const st = newCamState();
    const close = planCamera(at(-100, 100), cam, st, false);
    expect(close.cx).toBe(0);
    expect(close.dist).toBe(Math.max(cam.minD, cam.a + Math.trunc((200 * cam.b) / 1000)));
    const wide = planCamera(at(-5900, 5900), cam, st, false);
    expect(wide.dist).toBe(cam.maxD);
    expect(wide.dist).toBeGreaterThan(close.dist);
    const apart = planCamera(at(1000, 3000), cam, st, false);
    expect(apart.cx).toBe(2000);
  });

  it('a super dollies in over 20 frames while the freeze runs', () => {
    const st = newCamState();
    const buf = at(-300, 300, { st0: St.Super });
    const dists: number[] = [];
    for (let t = 0; t < 30; t++) {
      advanceCam(buf, st);
      dists.push(planCamera(buf, cam, st, false).dist);
    }
    expect(dists[0] as number).toBeLessThan(planCamera(at(-300, 300), cam, newCamState(), false).dist);
    for (let i = 1; i < DOLLY_FRAMES; i++) expect(dists[i] as number).toBeLessThanOrEqual(dists[i - 1] as number);
    expect(dists[DOLLY_FRAMES - 1]).toBe(dists[DOLLY_FRAMES + 5]);
    expect(planCamera(buf, cam, st, false).dollyFrames).toBe(DOLLY_FRAMES);
  });

  it('reduced motion has no dolly and no shake', () => {
    const st = newCamState();
    const buf = at(-300, 300, { st0: St.Super, hitstop: 20 });
    for (let t = 0; t < 25; t++) advanceCam(buf, st);
    const calm = planCamera(buf, cam, st, true);
    expect(calm.dollyFrames).toBe(0);
    expect(calm.dist).toBe(calm.baseDist);
    expect(calm.shakeMilli).toBe(0);
    const lively = planCamera(buf, cam, st, false);
    expect(lively.dollyFrames).toBeGreaterThan(0);
    expect(lively.shakeMilli).toBeGreaterThan(0);
  });

  it('the directive is a locked cinematic side shot placed above the city', () => {
    const d = toDirective(planCamera(at(-300, 300), cam, newCamState(), false));
    expect(d.mode).toBe('cinematic');
    expect(d.shot.kind).toBe('side');
    expect(d.lockPlayerToggle).toBe(true);
    expect(d.shot.pos[1]).toBeGreaterThan(ARENA_ORIGIN[1]);
  });
});

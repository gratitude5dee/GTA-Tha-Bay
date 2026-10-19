import type { CameraDirective } from '@dv/shared';
import { describe, expect, it, vi } from 'vitest';
import { CameraRigImpl, type CameraLike } from '../src/client/camera/rig.ts';
import { DEFAULT_TP_FOLLOW } from '../src/sim/camera/collision.ts';

const DT = 1 / 60;
const FRAME = { alpha: 0, dtSec: DT, reducedMotion: false, drawDistanceM: 800 };
const CHEST = 1.35;
const HEAD = 1.7;

function fakeCamera(): CameraLike & { pos: [number, number, number]; quat: [number, number, number, number]; projections: number } {
  const cam = {
    pos: [0, 0, 0] as [number, number, number],
    quat: [0, 0, 0, 1] as [number, number, number, number],
    projections: 0,
    fov: 50,
    near: 0.5,
    far: 10,
    position: { set: (x: number, y: number, z: number) => { cam.pos = [x, y, z]; } },
    quaternion: { set: (x: number, y: number, z: number, w: number) => { cam.quat = [x, y, z, w]; } },
    updateProjectionMatrix: () => { cam.projections++; },
  };
  return cam;
}

function setup(target = { x: 0, y: 0, z: 0 }, look = { yaw: 0, pitch: 0 }) {
  const camera = fakeCamera();
  const state = { target, look };
  const rig = new CameraRigImpl({ camera, targetPose: (h) => (h === 7 ? state.target : null), look: () => state.look });
  const directive = (over: Partial<CameraDirective> & { allowedDistanceOpposite?: number } = {}): CameraDirective => ({
    mode: 'tp',
    follow: { ...DEFAULT_TP_FOLLOW, target: 7, offset: [...DEFAULT_TP_FOLLOW.offset] as [number, number, number] },
    allowedDistance: 2.8,
    lockPlayerToggle: false,
    reason: 'player',
    ...over,
  });
  const dist = (): number => Math.hypot(camera.pos[0], camera.pos[1] - (state.target.y + CHEST), camera.pos[2]);
  return { camera, rig, state, directive, dist };
}

describe('CameraRig distance: pull in at once, ease out over 0.3 s (AC-8)', () => {
  it('starts at the allowed distance, drops to 1.0 m on the next update, and is back at 2.8 m after 0.3 s +/- one frame, not before 0.25 s', () => {
    const { rig, directive, dist } = setup();
    rig.apply(directive());
    for (let i = 0; i < 5; i++) rig.update(FRAME);
    expect(dist()).toBeCloseTo(2.8, 9);

    rig.apply(directive({ allowedDistance: 1.0 }));
    rig.update(FRAME);
    expect(dist()).toBeLessThanOrEqual(1.0 + 1e-9);
    rig.update(FRAME);
    expect(dist()).toBeLessThanOrEqual(1.0 + 1e-9); // stays pulled in while the wall is there

    rig.apply(directive({ allowedDistance: 2.8 }));
    let frames = 0;
    let reached = -1;
    for (let i = 1; i <= 40 && reached < 0; i++) {
      rig.update(FRAME);
      frames = i;
      if (dist() >= 2.8 - 1e-6) reached = i;
    }
    expect(reached).toBeGreaterThan(0);
    const t = (reached * DT);
    expect(t).toBeGreaterThanOrEqual(0.25);
    expect(t).toBeGreaterThanOrEqual(0.3 - DT - 1e-9);
    expect(t).toBeLessThanOrEqual(0.3 + DT + 1e-9);
    expect(frames).toBe(reached);
    // Not before 0.25 s: at 15 frames it is still short.
    const { rig: r2, directive: d2, dist: dist2 } = setup();
    r2.apply(d2({ allowedDistance: 1.0 }));
    r2.update(FRAME);
    r2.apply(d2({ allowedDistance: 2.8 }));
    for (let i = 0; i < 15; i++) r2.update(FRAME);
    expect(dist2()).toBeLessThan(2.8 - 0.05);
  });

  it('easing out takes 0.3 s whatever the gap: 1.9 m to 2.8 m also takes 18 frames', () => {
    const { rig, directive, dist } = setup();
    rig.apply(directive({ allowedDistance: 1.9 }));
    rig.update(FRAME);
    rig.apply(directive({ allowedDistance: 2.8 }));
    let n = 0;
    while (dist() < 2.8 - 1e-6 && n < 60) {
      rig.update(FRAME);
      n++;
    }
    expect(n).toBe(18);
  });

  it('a distance longer than the offset is capped at the offset length (2.88 m)', () => {
    const { rig, directive, dist } = setup();
    rig.apply(directive({ allowedDistance: 50 }));
    rig.update(FRAME);
    expect(dist()).toBeCloseTo(Math.hypot(0.6, 0.35, 2.8), 9);
  });

  it('the camera looks along the view direction with the player at the shoulder offset', () => {
    const { rig, directive, camera } = setup({ x: 5, y: 0, z: -3 }, { yaw: 0, pitch: 0 });
    rig.apply(directive({ allowedDistance: 99 }));
    rig.update(FRAME);
    // Facing north (-Z): behind is +Z, right is +X.
    expect(camera.pos[0]).toBeCloseTo(5 + 0.6, 9);
    expect(camera.pos[1]).toBeCloseTo(CHEST + 0.35, 9);
    expect(camera.pos[2]).toBeCloseTo(-3 + 2.8, 9);
    expect(camera.quat[0]).toBeCloseTo(0, 12);
    expect(camera.quat[1]).toBeCloseTo(0, 12);
    expect(camera.quat[2]).toBeCloseTo(0, 12);
    expect(camera.quat[3]).toBeCloseTo(1, 12);
  });

  it('swapping the shoulder moves the camera to the left and uses the left shoulder\'s allowed distance', () => {
    const { rig, directive, camera, dist } = setup();
    rig.apply(directive({ allowedDistance: 99, allowedDistanceOpposite: 1.2 }));
    rig.update(FRAME);
    expect(camera.pos[0]).toBeGreaterThan(0);
    rig.swapShoulder();
    expect(rig.currentShoulder).toBe('left');
    // The swap eases over 0.25 s (M01b2): 16 frames of 1/60 s are enough.
    for (let i = 0; i < 16; i++) rig.update(FRAME);
    expect(camera.pos[0]).toBeLessThan(0);
    expect(dist()).toBeLessThanOrEqual(1.2 + 1e-9);
    rig.swapShoulder();
    for (let i = 0; i < 16; i++) rig.update(FRAME);
    expect(camera.pos[0]).toBeGreaterThan(0);
  });
});

describe('CameraRig modes and the toggle lock (AC-8, R-PLAT-04)', () => {
  it('toggleFpTp flips between tp and fp and tells the listeners', () => {
    const { rig, directive } = setup();
    const seen: string[] = [];
    const off = rig.onModeChange((m) => seen.push(m));
    rig.apply(directive());
    expect(rig.mode).toBe('tp');
    expect(rig.toggleFpTp()).toBe(true);
    expect(rig.mode).toBe('fp');
    expect(rig.playerHidden).toBe(true);
    rig.apply(directive()); // the sim keeps saying tp; the player's choice stands
    expect(rig.mode).toBe('fp');
    expect(rig.toggleFpTp()).toBe(true);
    expect(rig.mode).toBe('tp');
    expect(rig.playerHidden).toBe(false);
    expect(seen).toEqual(['fp', 'tp']);
    off();
    rig.toggleFpTp();
    expect(seen).toHaveLength(2);
    expect(rig.lastToggleRefused).toBe(false);
  });

  it('under lockPlayerToggle, toggleFpTp returns false, the mode is unchanged, and the refusal is recorded', () => {
    const { rig, directive } = setup();
    rig.apply(directive());
    rig.toggleFpTp(); // fp
    const listener = vi.fn();
    rig.onModeChange(listener);
    rig.apply(directive({ lockPlayerToggle: true, reason: 'debug' }));
    expect(rig.toggleFpTp()).toBe(false);
    expect(rig.mode).toBe('fp');
    expect(rig.lastToggleRefused).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    rig.apply(directive({ lockPlayerToggle: false }));
    expect(rig.toggleFpTp()).toBe(true);
    expect(rig.mode).toBe('tp');
    expect(rig.lastToggleRefused).toBe(false);
  });

  it('a cinematic or XR directive takes the view and the toggle is refused until it ends', () => {
    const { rig, directive } = setup();
    rig.apply(directive({ mode: 'cinematic', lockPlayerToggle: true, reason: 'cutscene' }));
    expect(rig.mode).toBe('cinematic');
    expect(rig.toggleFpTp()).toBe(false);
    rig.apply(directive({ mode: 'xr', lockPlayerToggle: false }));
    expect(rig.mode).toBe('xr');
    expect(rig.toggleFpTp()).toBe(false); // not locked, but XR is not toggleable
    rig.apply(directive());
    expect(rig.mode).toBe('tp');
    expect(rig.toggleFpTp()).toBe(true);
  });

  it('near planes are 0.1 m (tp) and 0.05 m (fp); FOV is 65 and 75; far is the draw distance', () => {
    const { rig, directive, camera } = setup();
    rig.apply(directive());
    rig.update(FRAME);
    expect([camera.near, camera.fov, camera.far]).toEqual([0.1, 65, 800]);
    expect(camera.projections).toBe(1);
    rig.update(FRAME);
    expect(camera.projections).toBe(1); // unchanged: no needless matrix rebuild
    rig.toggleFpTp();
    rig.update(FRAME);
    expect([camera.near, camera.fov]).toEqual([0.05, 75]);
    expect(camera.projections).toBe(2);
  });

  it('first person puts the eye at the head anchor with no lag and ignores the offset', () => {
    const { rig, directive, camera, state } = setup({ x: 1, y: 0, z: 2 });
    rig.apply(directive());
    rig.toggleFpTp();
    rig.update(FRAME);
    expect(camera.pos).toEqual([1, HEAD, 2]);
    state.target = { x: 4, y: 0, z: 2 };
    state.look = { yaw: Math.PI / 2, pitch: 0 };
    rig.update(FRAME);
    expect(camera.pos).toEqual([4, HEAD, 2]);
    expect(camera.quat[1]).toBeCloseTo(Math.sin(Math.PI / 4), 12);
    expect(camera.quat[3]).toBeCloseTo(Math.cos(Math.PI / 4), 12);
  });

  it('returning to third person eases the camera out from the head instead of jumping', () => {
    const { rig, directive, dist } = setup();
    rig.apply(directive());
    rig.update(FRAME);
    rig.toggleFpTp();
    rig.update(FRAME);
    rig.toggleFpTp();
    rig.update(FRAME);
    expect(dist()).toBeLessThan(0.5);
    for (let i = 0; i < 30; i++) rig.update(FRAME);
    expect(dist()).toBeCloseTo(2.8, 6);
  });
});

describe('CameraRig lag smoothing', () => {
  it('the anchor follows with k = 1 - e^(-dt g), g = 9; a jump over 8 m snaps', () => {
    const { rig, directive, camera, state } = setup();
    rig.apply(directive({ allowedDistance: 99 }));
    rig.update(FRAME);
    const x0 = camera.pos[0];
    state.target = { x: 4, y: 0, z: 0 };
    rig.update(FRAME);
    const k = 1 - Math.exp(-DT * 9);
    expect(camera.pos[0] - x0).toBeCloseTo(4 * k, 9);
    state.target = { x: 100, y: 0, z: 0 };
    rig.update(FRAME);
    expect(camera.pos[0]).toBeCloseTo(100 + 0.6, 9);
  });

  it('the view angle follows with g = 12 along the shortest arc', () => {
    const { rig, directive, camera, state } = setup();
    rig.apply(directive({ allowedDistance: 99 }));
    rig.update(FRAME);
    state.look = { yaw: 0.5, pitch: 0 };
    rig.update(FRAME);
    const k = 1 - Math.exp(-DT * 12);
    // quaternion y = sin(yaw / 2)
    expect(camera.quat[1]).toBeCloseTo(Math.sin((0.5 * k) / 2), 9);
    // Across the 2 pi seam the short way is taken.
    const t = setup({ x: 0, y: 0, z: 0 }, { yaw: 0.1, pitch: 0 });
    t.rig.apply(t.directive({ allowedDistance: 99 }));
    t.rig.update(FRAME);
    t.state.look = { yaw: 2 * Math.PI - 0.1, pitch: 0 };
    t.rig.update(FRAME);
    // The short way from 0.1 to -0.1 is -0.2 rad, not +6.08 rad.
    expect(t.camera.quat[1]).toBeCloseTo(Math.sin((0.1 - 0.2 * k) / 2), 9);
  });

  it('does nothing before a directive, without a followed entity, or when the target is not in the snapshot', () => {
    const { rig, camera, directive } = setup();
    rig.update(FRAME);
    expect(camera.pos).toEqual([0, 0, 0]);
    rig.apply({ mode: 'tp', lockPlayerToggle: false, reason: 'player' });
    rig.update(FRAME);
    expect(camera.pos).toEqual([0, 0, 0]);
    const d = directive();
    rig.apply({ ...d, follow: { ...(d.follow as NonNullable<CameraDirective['follow']>), target: 99 } });
    rig.update(FRAME);
    expect(camera.pos).toEqual([0, 0, 0]);
  });

  it('follow(target, params) is a shorthand for apply and keeps the lock', () => {
    const { rig, camera } = setup();
    rig.follow(7, { fovDeg: 70 });
    rig.update(FRAME);
    expect(camera.fov).toBe(70);
    expect(rig.locked).toBe(false);
    rig.setVehicleView('hood');
    expect(rig.currentVehicleView).toBe('hood');
  });
});

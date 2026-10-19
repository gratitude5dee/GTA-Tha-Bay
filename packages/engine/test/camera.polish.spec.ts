import type { CameraDirective } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { CameraRigImpl, FADE_NEAR_M, SHOULDER_SWAP_SEC, type CameraLike } from '../src/client/camera/rig.ts';
import { DEFAULT_TP_FOLLOW } from '../src/sim/camera/collision.ts';

const DT = 1 / 60;
const FRAME = { alpha: 0, dtSec: DT, reducedMotion: false, drawDistanceM: 800 };

function fakeCamera(): CameraLike & { pos: [number, number, number] } {
  const cam = {
    pos: [0, 0, 0] as [number, number, number],
    fov: 50,
    near: 0.5,
    far: 10,
    position: { set: (x: number, y: number, z: number) => { cam.pos = [x, y, z]; } },
    quaternion: { set: () => {} },
    updateProjectionMatrix: () => {},
  };
  return cam;
}

function setup() {
  const camera = fakeCamera();
  const rig = new CameraRigImpl({ camera, targetPose: (h) => (h === 7 ? { x: 0, y: 0, z: 0 } : null), look: () => ({ yaw: 0, pitch: 0 }) });
  const directive = (over: Partial<CameraDirective> & { allowedDistanceOpposite?: number } = {}): CameraDirective => ({
    mode: 'tp',
    follow: { ...DEFAULT_TP_FOLLOW, target: 7, offset: [...DEFAULT_TP_FOLLOW.offset] as [number, number, number] },
    allowedDistance: 2.8,
    lockPlayerToggle: false,
    reason: 'player',
    ...over,
  });
  return { camera, rig, directive };
}

describe('camera polish (AC-6)', () => {
  it('the player mesh opacity is 0 when the camera is within 0.6 m of the head and 1 at a normal distance', () => {
    const { rig, directive } = setup();
    rig.apply(directive());
    rig.update(FRAME);
    expect(rig.playerOpacity).toBe(1);
    // A wall pulls the camera in to 0.25 m from the chest anchor.
    rig.apply(directive({ allowedDistance: 0.25 }));
    rig.update(FRAME);
    expect(rig.playerOpacity).toBe(0);
    // In between it is a fraction: fade starts at 0.6 m and ends at 1.0 m from the head.
    expect(FADE_NEAR_M).toBe(0.6);
    rig.apply(directive({ allowedDistance: 1.5 }));
    for (let i = 0; i < 30; i++) rig.update(FRAME);
    expect(rig.playerOpacity).toBeGreaterThan(0.99);
  });

  it('first person hides the player entirely', () => {
    const { rig, directive } = setup();
    rig.apply(directive());
    rig.update(FRAME);
    rig.toggleFpTp();
    rig.apply(directive());
    rig.update(FRAME);
    expect(rig.playerHidden).toBe(true);
    expect(rig.playerOpacity).toBe(0);
  });

  it('with a standard depth buffer and far 8,200 m the near plane is 0.41 m; reversed depth keeps 0.1 m', () => {
    const { rig, directive, camera } = setup();
    rig.apply(directive());
    rig.update({ ...FRAME, drawDistanceM: 8200, depthPolicy: 'standard' });
    expect(camera.near).toBeCloseTo(0.41, 9);
    expect(camera.far).toBe(8200);
    rig.update({ ...FRAME, drawDistanceM: 8200, depthPolicy: 'reversed' });
    expect(camera.near).toBe(0.1);
    // Unreported means standard.
    rig.update({ ...FRAME, drawDistanceM: 8200 });
    expect(camera.near).toBeCloseTo(0.41, 9);
    // A short far plane leaves the base near.
    rig.update({ ...FRAME, drawDistanceM: 800 });
    expect(camera.near).toBe(0.1);
  });

  it('reduced motion ignores shake; without it the camera moves', () => {
    const still = setup();
    const shaken = setup();
    const reduced = setup();
    const shake = { amp: 1, decayPerSec: 0 };
    still.rig.apply(still.directive());
    shaken.rig.apply(shaken.directive({ shake }));
    reduced.rig.apply(reduced.directive({ shake }));
    for (let i = 0; i < 20; i++) {
      still.rig.update(FRAME);
      shaken.rig.update(FRAME);
      reduced.rig.update({ ...FRAME, reducedMotion: true });
    }
    expect(reduced.camera.pos).toEqual(still.camera.pos);
    expect(shaken.camera.pos).not.toEqual(still.camera.pos);
    // Shake decays by itself.
    const decaying = setup();
    decaying.rig.apply(decaying.directive({ shake: { amp: 1, decayPerSec: 8 } }));
    for (let i = 0; i < 120; i++) decaying.rig.update(FRAME);
    const rest = setup();
    rest.rig.apply(rest.directive());
    rest.rig.update(FRAME);
    for (let i = 0; i < 120; i++) rest.rig.update(FRAME);
    expect(decaying.camera.pos[0]).toBeCloseTo(rest.camera.pos[0], 3);
  });

  it('a shoulder swap eases over 0.25 s', () => {
    const { rig, directive, camera } = setup();
    rig.apply(directive());
    for (let i = 0; i < 5; i++) rig.update(FRAME);
    const right = camera.pos[0];
    expect(rig.shoulderBlend).toBe(1);
    rig.swapShoulder();
    expect(rig.currentShoulder).toBe('left');
    rig.update(FRAME);
    const early = rig.shoulderBlend;
    expect(early).toBeLessThan(1);
    expect(early).toBeGreaterThan(-1);
    // Half-way (about 0.125 s) the blend is near zero; at 0.25 s it is -1.
    for (let i = 1; i < Math.round((SHOULDER_SWAP_SEC / 2) / DT); i++) rig.update(FRAME);
    expect(Math.abs(rig.shoulderBlend)).toBeLessThan(0.15);
    for (let i = 0; i < 10; i++) rig.update(FRAME);
    expect(rig.shoulderBlend).toBe(-1);
    // The camera sits on the other side of the player.
    expect(Math.sign(camera.pos[0])).toBe(-Math.sign(right));
  });
});

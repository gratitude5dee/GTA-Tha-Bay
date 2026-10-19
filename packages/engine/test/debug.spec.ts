import type { ControlId, InputContextId } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import type { CameraLike } from '../src/client/camera/rig.ts';
import { FREE_CAM_FAST, FREE_CAM_SPEED, FreeCam } from '../src/client/debug/free-cam.ts';
import { fpsFromDeltas, median } from '../src/client/debug/sim-panel.ts';

describe('sim panel numbers (AC-10)', () => {
  it('the median ignores one long frame and the fps is 1000 over it', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const frames = Array.from({ length: 120 }, () => 16.6667);
    frames[40] = 400;
    expect(fpsFromDeltas(frames)).toBeCloseTo(60, 1);
    expect(fpsFromDeltas([])).toBe(0);
    expect(fpsFromDeltas([33.3333])).toBeCloseTo(30, 1);
  });
});

function setup() {
  const held = new Set<string>();
  const stack: InputContextId[] = ['onFoot'];
  const controls = new Map<ControlId, number>();
  const router = {
    push: (c: InputContextId) => void stack.push(c),
    pop: (c: InputContextId) => {
      const i = stack.lastIndexOf(c);
      if (i > 0) stack.splice(i, 1);
    },
    raw: { controls: { get: (k: ControlId) => (held.has(k) ? 1 : controls.get(k)), has: (k: ControlId) => held.has(k) } as unknown as ReadonlyMap<ControlId, number> },
  };
  const camera = {
    pos: [0, 0, 0] as [number, number, number],
    quat: [0, 0, 0, 1] as [number, number, number, number],
    fov: 60, near: 0.1, far: 100,
    position: { set: (x: number, y: number, z: number) => { camera.pos = [x, y, z]; } },
    quaternion: { set: (x: number, y: number, z: number, w: number) => { camera.quat = [x, y, z, w]; } },
    updateProjectionMatrix: () => {},
  } satisfies CameraLike & { pos: number[]; quat: number[] };
  const free = new FreeCam({ router, camera });
  return { held, stack, free, camera };
}

describe('free cam', () => {
  it('pushes the debug context on and pops it off; the sim keeps the on-foot context under it', () => {
    const { free, stack } = setup();
    expect(free.toggle({ pos: [1, 2, 3], yaw: 0, pitch: 0 })).toBe(true);
    expect(stack).toEqual(['onFoot', 'debug']);
    expect(free.pos).toEqual([1, 2, 3]);
    expect(free.toggle()).toBe(false);
    expect(stack).toEqual(['onFoot']);
  });

  it('W moves 10 m/s along the view direction (north is -Z at yaw 0) and Shift moves 40 m/s', () => {
    const { free, held, camera } = setup();
    free.toggle({ pos: [0, 5, 0], yaw: 0, pitch: 0 });
    held.add('key:KeyW');
    free.update(1);
    expect(camera.pos[2]).toBeCloseTo(-FREE_CAM_SPEED, 9);
    expect(camera.pos[0]).toBeCloseTo(0, 9);
    held.add('key:ShiftLeft');
    free.update(1);
    expect(camera.pos[2]).toBeCloseTo(-FREE_CAM_SPEED - FREE_CAM_FAST, 9);
  });

  it('D moves right, a quarter turn changes the heading, pitch lifts the camera, nothing moves when it is off', () => {
    const { free, held, camera } = setup();
    free.update(1);
    expect(camera.pos).toEqual([0, 0, 0]); // off: no write
    free.toggle({ pos: [0, 0, 0], yaw: Math.PI / 2, pitch: 0 });
    held.add('key:KeyW');
    free.update(1);
    expect(camera.pos[0]).toBeCloseTo(-FREE_CAM_SPEED, 9); // yaw pi/2 faces -X
    held.clear();
    held.add('key:KeyD');
    free.update(1);
    expect(camera.pos[2]).toBeCloseTo(-FREE_CAM_SPEED, 9); // right of -X is -Z... (cos yaw, 0, -sin yaw) = (0, 0, -1)
    held.clear();
    free.look.pitch = Math.PI / 4;
    held.add('key:KeyW');
    const y0 = camera.pos[1];
    free.update(1);
    expect(camera.pos[1]).toBeGreaterThan(y0 + 5);
  });
});

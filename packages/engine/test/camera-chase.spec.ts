/**
 * M02g1 AC-7: the vehicle chase camera follows the vehicle. The sim casts and publishes a far distance of 1.6 x length + 1.5 m from the
 * half extents of the physics body (never the attachment nodes), with the anchor at roof height; the page scales the near and mid
 * views from it; the rest pitch puts the horizon 35 to 40 % from the top; a tow boom in the way fades. The state hash is the one it was.
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import {
  ANCHOR_UP_MAX_M, ANCHOR_UP_MIN_M, CHASE_BASE_M, CHASE_MAX_M, CHASE_MIN_M, CHASE_PER_LENGTH, VEHICLE_ANCHOR_UP, VEHICLE_FAR_M, chaseDims, publishedCamera,
} from '../src/sim/camera/collision.ts';
import { CHASE_DISTANCE_M, CHASE_REST_PITCH, VehicleCamera, horizonFromTop } from '../src/client/vehicle/vehicle-camera.ts';
import { ARCHETYPES, buildGrayboxVehicle, GrayboxAssets, vehicleFootprint } from '../src/client/vehicle/vehicle-view.ts';
import { ObjectPool } from '../src/client/snapshot/object-pool.ts';
import { Scene } from 'three/webgpu';
import { createVehicleWorld, drive } from './vehicle-sim.ts';

const PREFAB_HALF: Record<string, [number, number, number]> = {
  'vehicle.compact': [0.85, 0.42, 1.85],
  'vehicle.sedan': [0.92, 0.42, 2.35],
  'vehicle.pickup': [1.0, 0.42, 2.65],
  'vehicle.truck': [1.15, 0.42, 3.2],
};
const expectedFar = (half: readonly number[]): number => Math.min(CHASE_MAX_M, Math.max(CHASE_MIN_M, CHASE_PER_LENGTH * 2 * Math.max(half[0] as number, half[2] as number) + CHASE_BASE_M));

describe('chaseDims (pure)', () => {
  it('is 1.6 x length + 1.5 m, with the anchor at roof height, from the body half extents', () => {
    const d = chaseDims([1.0, 0.42, 2.65]);
    expect(d.far).toBeCloseTo(1.6 * 5.3 + 1.5, 9);
    expect(d.anchorUp).toBeCloseTo(0.92, 9);
    expect(d.lift).toBeCloseTo((0.6 * d.far) / VEHICLE_FAR_M, 9);
  });

  it('is longer for a longer vehicle, clamps at both ends and falls back to 11 m without a shape', () => {
    expect(chaseDims([0.85, 0.42, 1.85]).far).toBeLessThan(chaseDims([0.92, 0.42, 2.35]).far);
    expect(chaseDims([0.92, 0.42, 2.35]).far).toBeLessThan(chaseDims([1.0, 0.42, 2.65]).far);
    expect(chaseDims([0.1, 0.1, 0.1]).far).toBe(CHASE_MIN_M);
    expect(chaseDims([2, 1, 30]).far).toBe(CHASE_MAX_M);
    expect(chaseDims([3, 0.1, 0.2]).far).toBeCloseTo(1.6 * 6 + 1.5, 9);
    expect(chaseDims([1, 40, 2]).anchorUp).toBe(ANCHOR_UP_MAX_M);
    expect(chaseDims([1, 0.01, 2]).anchorUp).toBe(ANCHOR_UP_MIN_M);
    for (const bad of [null, undefined, [], [1], [0, 1, 1], [1, -1, 1], [Number.NaN, 1, 1]] as const) {
      expect(chaseDims(bad as never)).toEqual({ far: VEHICLE_FAR_M, anchorUp: VEHICLE_ANCHOR_UP, lift: 0.6 });
    }
  });
});

describe('the sim publishes the chase distance of the followed vehicle', () => {
  for (const [prefab, half] of Object.entries(PREFAB_HALF)) {
    it(`${prefab}: far = 1.6 x length + 1.5 m of its body, anchor at roof height, in the directive`, async () => {
      const w = await createVehicleWorld({ prefab });
      drive(w, 6);
      const cam = w.sim.services.camera;
      expect(cam.reason).toBe('vehicle');
      expect(cam.chaseM).toBeCloseTo(expectedFar(half), 6);
      expect(cam.anchorUpM).toBeCloseTo((half[1] as number) + 0.5, 6);
      const d = publishedCamera(w.sim.services);
      expect(d?.follow?.offset[2]).toBeCloseTo(expectedFar(half), 6);
      expect(d?.follow?.offset[1]).toBeCloseTo((0.6 * expectedFar(half)) / VEHICLE_FAR_M, 6);
      expect(d?.chaseAnchorUp).toBeCloseTo((half[1] as number) + 0.5, 6);
      expect(d?.allowedDistance).toBeGreaterThan(0);
    });
  }

  it('does not change the state hash: the chase numbers are derived, not simulation state', async () => {
    const a = await createVehicleWorld({ prefab: 'vehicle.pickup' });
    const b = await createVehicleWorld({ prefab: 'vehicle.pickup' });
    drive(a, 30);
    drive(b, 30);
    // one world's derived camera numbers are wiped: the hash must not notice
    delete b.sim.services.camera.chaseM;
    delete b.sim.services.camera.anchorUpM;
    expect(a.sim.hash()).toBe(b.sim.hash());
  });
});

describe('the page puts the camera at that distance', () => {
  const camera = (): PerspectiveCamera => new PerspectiveCamera();
  const pose = { x: 0, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  it('scales near and mid from the far distance and holds the bounds rule: distance = view share x far, nothing closer than the sim allows', () => {
    for (const far of [7.4, 9, 10, 11.7]) {
      const v = new VehicleCamera();
      for (const view of ['chase-near', 'chase-mid', 'chase-far'] as const) {
        v.setView(view);
        const c = camera();
        const look = { yaw: 0, pitch: 0 };
        v.reset();
        v.update({ camera: c as never, pose, look, allowed: null, dtSec: 1, idleSec: 0, drawDistanceM: 1000, farM: far, anchorUpM: 0.92 });
        const want = (CHASE_DISTANCE_M[view] * far) / VEHICLE_FAR_M;
        // the offset is [0, lift, want] in view space, lift = 0.6 per 11 m
        const lift = (0.6 * want) / VEHICLE_FAR_M;
        expect(v.last.distance, `${view} far ${far}`).toBeCloseTo(Math.hypot(want, lift), 6);
        expect(v.last.y).toBeCloseTo(pose.y + 0.92 + lift, 6);
      }
    }
  });

  it('a short allowed distance (a wall) wins over the wanted one', () => {
    const v = new VehicleCamera();
    v.setView('chase-far');
    v.update({ camera: camera() as never, pose, look: { yaw: 0, pitch: 0 }, allowed: 2.5, dtSec: 1, idleSec: 0, drawDistanceM: 1000, farM: 10, anchorUpM: 0.92 });
    expect(v.last.distance).toBeCloseTo(2.5, 9);
  });

  it('without the sim numbers it is the M03a1 camera: 11 m far, 0.9 m anchor', () => {
    const v = new VehicleCamera();
    v.setView('chase-far');
    const c = camera();
    v.update({ camera: c as never, pose, look: { yaw: 0, pitch: 0 }, allowed: null, dtSec: 1, idleSec: 0, drawDistanceM: 1000 });
    expect(v.last.y).toBeCloseTo(1 + VEHICLE_ANCHOR_UP + 0.6, 6);
    expect(v.last.distance).toBeCloseTo(Math.hypot(VEHICLE_FAR_M, 0.6), 6);
  });

  it('the rest pitch puts the horizon 35 to 40 % from the top of the picture at the chase field of view', () => {
    const h = horizonFromTop(CHASE_REST_PITCH, 70);
    expect(h).toBeGreaterThanOrEqual(0.35);
    expect(h).toBeLessThanOrEqual(0.4);
    // a level camera has the horizon in the middle; looking down moves it up the picture
    expect(horizonFromTop(0, 70)).toBeCloseTo(0.5, 9);
    expect(horizonFromTop(-0.3, 70)).toBeLessThan(horizonFromTop(-0.1, 70));
  });

  it('settles at the rest pitch behind the car after the idle time', () => {
    const v = new VehicleCamera();
    const look = { yaw: 0.9, pitch: 0.4 };
    for (let i = 0; i < 400; i++) v.recentre(look, 0, 5, 1 / 60);
    expect(look.pitch).toBeCloseTo(CHASE_REST_PITCH, 3);
    expect(look.yaw).toBeCloseTo(0, 3);
    expect(horizonFromTop(look.pitch, 70)).toBeGreaterThanOrEqual(0.35);
    expect(horizonFromTop(look.pitch, 70)).toBeLessThanOrEqual(0.4);
  });
});

describe('the tow boom fades while it is between the camera and the anchor (render-only)', () => {
  it('the pickup has a boom attachment with materials of its own; the sedan has none', () => {
    const a = new GrayboxAssets();
    const pickup = buildGrayboxVehicle(a, 'pickup');
    expect(pickup.attachments).toHaveLength(1);
    expect(pickup.attachments?.[0]?.node.name).toBe('attach_boom');
    const sedan = buildGrayboxVehicle(a, 'sedan');
    expect(sedan.attachments).toBeUndefined();
    a.dispose();
  });

  it('is the footprint of the body that the blob uses, not of the attachment', () => {
    const f = vehicleFootprint('vehicle/graybox.pickup');
    expect(f?.halfLength).toBeCloseTo((ARCHETYPES['pickup']?.length ?? 0) / 2, 9);
    expect(vehicleFootprint('prop/graybox.crate')).toBeNull();
  });

  it('fades to 0.12 when the segment from the camera to the anchor passes through it, and comes back when it does not', () => {
    const scene = new Scene();
    const pool = new ObjectPool(scene);
    const key = new Map([[1, 'vehicle/graybox.pickup']]);
    const poses = [{ handle: 7, renderKey: 1, px: 0, py: 1, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, flags: 1, animState: 0, animP0: 0, animP1: 0 }];
    pool.sync(poses as never, 1, (k) => key.get(k), 1 / 60, null);
    // the camera is 9 m behind (+z) at the height of the boom; the anchor is on the vehicle
    const behind = { x: 0, y: 2.2, z: 9 };
    const anchor = { x: 0, y: 1.9, z: 0 };
    let o = 1;
    for (let i = 0; i < 60; i++) o = pool.fadeAttachments(7, behind, anchor, 1 / 30);
    expect(o).toBeLessThan(0.2);
    // from the side the boom is not in the way
    const side = { x: 9, y: 2.2, z: -1.5 };
    for (let i = 0; i < 90; i++) o = pool.fadeAttachments(7, side, { x: 0, y: 1.9, z: -1.5 }, 1 / 30);
    expect(o).toBeGreaterThan(0.95);
    // an unknown handle and a vehicle with no attachment are 1
    expect(pool.fadeAttachments(99, behind, anchor, 1 / 30)).toBe(1);
    pool.dispose();
  });
});

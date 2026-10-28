/**
 * M02g1 AC-3: the blob shadows. One instanced radial quad for every car, pedestrian and the player's vehicle: +1 render object and no
 * shadow pass, however many; sized from the archetype half extents, laid on the ground under the pose.
 */
import { describe, expect, it } from 'vitest';
import { Scene } from 'three/webgpu';
import { RenderBudgetMeter } from '../../engine/src/platform/perf/meter.ts';
import { PerspectiveCamera } from 'three/webgpu';
import { ARCHETYPES } from '../src/sim/traffic/components.ts';
import { PED_ASSETS } from '../src/sim/peds/components.ts';
import { AVATAR_BLOB_HALF_M, BLOB_GROW_M, BLOB_LIFT_M, BlobShadows, CAR_BLOB_RANGE_M, PED_BLOB_HALF_M, PED_BLOB_RANGE_M, blobMatrix, blobStyleOf, poseYaw } from '../src/client/look/blob-shadows.ts';

type Pose = { handle: number; renderKey: number; px: number; py: number; pz: number; qx: number; qy: number; qz: number; qw: number; flags: number; animState: number; animP0: number; animP1: number };
const pose = (handle: number, renderKey: number, x: number, y: number, z: number, o: Partial<Pose> = {}): Pose =>
  ({ handle, renderKey, px: x, py: y, pz: z, qx: 0, qy: 0, qz: 0, qw: 1, flags: 1, animState: 0, animP0: 0, animP1: 0, ...o });

const KEYS = new Map<number, string>([
  [1, ARCHETYPES[1]?.asset ?? ''], // sedan
  [2, PED_ASSETS[0] ?? ''],
  [3, 'prop/graybox.capsule'],
  [4, 'vehicle/graybox.pickup'],
  [5, 'prop/graybox.crate'],
  [6, 'vehicle/graybox.heli'],
]);
const frame = (poses: Pose[], cam: [number, number, number] = [0, 5, 0]) =>
  ({ poses: poses as never, poseCount: poses.length, poseKeys: KEYS, camera: { pos: cam, dir: [0, 0, -1] as [number, number, number] } });

describe('blobMatrix and poseYaw', () => {
  it('a yaw of 0 scales x and z and puts the blob at the position', () => {
    const m = new Float32Array(16);
    blobMatrix(m, 0, 3, 4, 5, 0, 2, 6);
    expect([m[0], m[5], m[10], m[12], m[13], m[14], m[15]]).toEqual([2, 1, 6, 3, 4, 5, 1]);
  });

  it('a yaw of 90 degrees swaps the footprint axes', () => {
    const m = new Float32Array(16);
    blobMatrix(m, 0, 0, 0, 0, Math.PI / 2, 2, 6);
    // local +x maps to world -z, local +z to world +x
    expect(m[0]).toBeCloseTo(0, 6);
    expect(m[2]).toBeCloseTo(-2, 6);
    expect(m[8]).toBeCloseTo(6, 6);
    expect(m[10]).toBeCloseTo(0, 6);
  });

  it('poseYaw reads the heading of a quaternion: 0 faces -Z, a quarter turn faces -X', () => {
    expect(poseYaw({ qx: 0, qy: 0, qz: 0, qw: 1 })).toBeCloseTo(0, 9);
    const half = Math.PI / 4;
    expect(poseYaw({ qx: 0, qy: Math.sin(half), qz: 0, qw: Math.cos(half) })).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('blobStyleOf', () => {
  it('knows the traffic archetypes, the pedestrian bodies, the capsule and the gray-box vehicles, and nothing else', () => {
    for (const a of ARCHETYPES) {
      const s = blobStyleOf(a.asset);
      expect(s?.halfWidth).toBe(a.halfWidth);
      expect(s?.halfLength).toBe(a.halfLength);
      expect(s?.dropM).toBe(a.lift);
      expect(s?.range).toBe(CAR_BLOB_RANGE_M);
    }
    for (const k of PED_ASSETS) expect(blobStyleOf(k)).toMatchObject({ halfWidth: PED_BLOB_HALF_M, dropM: 0, range: PED_BLOB_RANGE_M });
    expect(blobStyleOf('prop/graybox.capsule')).toMatchObject({ halfWidth: AVATAR_BLOB_HALF_M });
    expect(blobStyleOf('vehicle/graybox.pickup')?.halfLength).toBeCloseTo(2.65, 6);
    expect(blobStyleOf('prop/graybox.crate')).toBeNull();
    expect(blobStyleOf('vehicle/graybox.heli')).toBeNull();
    expect(blobStyleOf('dbg/box/1x1x1')).toBeNull();
  });
});

describe('BlobShadows', () => {
  it('feeds one blob per shown car, pedestrian and actor, on the ground under the pose', () => {
    const scene = new Scene();
    const b = new BlobShadows({ parent: scene, cap: 64 });
    const sedan = ARCHETYPES[1]!;
    b.begin();
    b.feed(frame([pose(1, 1, 10, 0.7, -20), pose(2, 2, 3, 0, 4), pose(3, 3, -2, 0, 1), pose(4, 4, 6, 0.67, 8)]));
    b.commit();
    expect(b.count).toBe(4);
    expect(b.mesh.count).toBe(4);
    expect(b.mesh.visible).toBe(true);
    const m = b.mesh.instanceMatrix.array as Float32Array;
    // the first is the sedan at x 10, z -20, lift above the ground at py - lift
    expect(m[12]).toBe(10);
    expect(m[13]).toBeCloseTo(0.7 - sedan.lift + BLOB_LIFT_M, 6);
    expect(m[14]).toBe(-20);
    expect(m[0]).toBeCloseTo((sedan.halfWidth + BLOB_GROW_M) * 2, 6);
    expect(m[10]).toBeCloseTo((sedan.halfLength + BLOB_GROW_M) * 2, 6);
    b.dispose();
  });

  it('skips hidden poses, props, aircraft, and those beyond the range of their kind', () => {
    const b = new BlobShadows({ parent: new Scene(), cap: 64 });
    b.begin();
    b.feed(frame([
      pose(1, 1, 0, 0.7, 0, { flags: 0 }), // hidden
      pose(2, 5, 0, 0, 3), // a crate
      pose(3, 6, 0, 0, 3), // a helicopter
      pose(4, 1, CAR_BLOB_RANGE_M + 5, 0.7, 0), // a car too far
      pose(5, 2, PED_BLOB_RANGE_M + 5, 0, 0), // a pedestrian too far
      pose(6, 2, 20, 0, 0), // a pedestrian in range
    ]));
    b.commit();
    expect(b.count).toBe(1);
    b.dispose();
  });

  it('never draws more than its cap and starts every frame from zero', () => {
    const b = new BlobShadows({ parent: new Scene(), cap: 8 });
    const many = Array.from({ length: 30 }, (_, i) => pose(i + 1, 2, i, 0, 0));
    b.begin();
    b.feed(frame(many));
    b.commit();
    expect(b.count).toBe(8);
    b.begin();
    b.commit();
    expect(b.count).toBe(0);
    expect(b.mesh.visible).toBe(false);
    b.dispose();
  });

  it('is one render object and no shadow pass for any number of blobs; zero when the layer is off', () => {
    const scene = new Scene();
    const b = new BlobShadows({ parent: scene, cap: 64 });
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 5, 10);
    cam.updateMatrixWorld();
    const meter = new RenderBudgetMeter(8);
    const count = (): number => meter.measure(scene, cam, 3).renderObjects;
    expect(count()).toBe(0);
    b.begin();
    b.feed(frame(Array.from({ length: 20 }, (_, i) => pose(i + 1, 2, (i % 5) - 2, 0, -3 - i * 0.2)), [0, 5, 10]));
    b.commit();
    expect(b.mesh.castShadow).toBe(false);
    expect(count()).toBe(1);
    expect(b.info()).toMatchObject({ count: 20, objects: 1 });
    b.setEnabled(false);
    b.feed(frame([pose(1, 2, 0, 0, -3)]));
    expect(count()).toBe(0);
    expect(b.info()).toMatchObject({ count: 0, objects: 0 });
    // switching back on draws the instances that are still in the buffer, with no new frame
    b.setEnabled(true);
    expect(count()).toBe(1);
    expect(b.info().count).toBeGreaterThan(0);
    b.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('the core darkens with the strength the look writes, clamped to 0..1', () => {
    const b = new BlobShadows({ parent: new Scene(), cap: 8 });
    b.setStrength(0.4);
    expect(b.info().strength).toBeCloseTo(0.4, 9);
    b.setStrength(7);
    expect(b.info().strength).toBe(1);
    b.setStrength(-1);
    expect(b.info().strength).toBe(0);
    b.dispose();
  });
});

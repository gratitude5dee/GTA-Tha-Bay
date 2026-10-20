/**
 * M03b1 instanced traffic (AC-10, the render half): one `InstancedMesh` for every archetype (one draw, one render object), stable
 * slots per entity handle, the archetype's scale in the instance matrix, never more instances than the tier cap, freed slots go dark,
 * far cars are refreshed one frame in three, and records that are not flagged ambient are not drawn.
 */
import { describe, expect, it } from 'vitest';
import { Group } from 'three/webgpu';
import { ARCH, ARCHETYPES } from '../src/sim/traffic/components.ts';
import { createSkyNodes } from '../src/client/sky/nodes.ts';
import { FAR_EVERY, FAR_M, TrafficRenderer } from '../src/client/traffic/instances.ts';

type Frame = Parameters<TrafficRenderer['update']>[0];
type Pose = NonNullable<Frame['poses']>[number];

function pose(handle: number, arch: number, x: number, z: number, flags = 2): Pose {
  return { handle, renderKey: arch + 1, px: x, py: 0, pz: z, qx: 0, qy: 0, qz: 0, qw: 1, animState: 0, animP0: 0, animP1: 3, flags, snapped: true };
}

const KEYS = new Map<number, string>(ARCHETYPES.map((a) => [a.id + 1, a.asset] as const));
const camera = { pos: [0, 2, 0] as [number, number, number], dir: [0, 0, -1] as [number, number, number] };
const frame = (poses: Pose[]): Frame => ({ poses, poseCount: poses.length, poseKeys: KEYS, camera });

function make(cap: number): { r: TrafficRenderer; parent: Group } {
  const parent = new Group();
  return { r: new TrafficRenderer({ parent, sky: createSkyNodes(), cap }), parent };
}

describe('TrafficRenderer', () => {
  it('draws every archetype with one mesh: one draw, one render object', () => {
    const { r, parent } = make(50);
    expect(parent.children[0]?.children).toHaveLength(1);
    const poses = ARCHETYPES.map((a, i) => pose(i + 1, a.id, i * 4, -10));
    expect(r.update(frame(poses), 0)).toBe(ARCHETYPES.length);
    const info = r.info();
    expect(info.draws).toBe(1);
    expect(info.objects).toBe(1);
    expect(info.instances).toBe(ARCHETYPES.length);
    expect(info.perArchetype.every((n) => n === 1)).toBe(true);
    r.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('the matrix carries the archetype scale: a truck is longer and taller than a compact', () => {
    const { r, parent } = make(10);
    r.update(frame([pose(1, ARCH.compact, 0, -10), pose(2, ARCH.truck, 5, -10)]), 0);
    const mesh = parent.children[0]?.children[0] as unknown as { instanceMatrix: { array: Float32Array }; count: number };
    const m = mesh.instanceMatrix.array;
    const len = (o: number): number => Math.hypot(m[o + 8] as number, m[o + 9] as number, m[o + 10] as number);
    const height = (o: number): number => Math.hypot(m[o + 4] as number, m[o + 5] as number, m[o + 6] as number);
    expect(len(16)).toBeGreaterThan(len(0));
    expect(height(16)).toBeGreaterThanOrEqual(height(0));
    expect(m[12]).toBe(0);
    expect(m[16 + 12]).toBe(5);
    expect(mesh.count).toBe(2);
    r.dispose();
  });

  it('never draws more than the tier cap and counts what it dropped', () => {
    const { r } = make(5);
    const poses = Array.from({ length: 12 }, (_, i) => pose(i + 1, ARCH.sedan, i * 3, -10));
    expect(r.update(frame(poses), 0)).toBe(5);
    expect(r.info().dropped).toBe(7);
    expect(r.instances).toBeLessThanOrEqual(5);
    r.dispose();
  });

  it('keeps a car in its slot while it lives, frees the slot when it leaves, and reuses it', () => {
    const { r, parent } = make(10);
    const mesh = parent.children[0]?.children[0] as unknown as { instanceMatrix: { array: Float32Array }; count: number };
    r.update(frame([pose(1, ARCH.sedan, 0, -10), pose(2, ARCH.sedan, 4, -10), pose(3, ARCH.sedan, 8, -10)]), 0);
    expect(mesh.count).toBe(3);
    r.update(frame([pose(1, ARCH.sedan, 1, -10), pose(3, ARCH.sedan, 9, -10)]), 0);
    expect(r.instances).toBe(2);
    expect(mesh.instanceMatrix.array[16 + 15]).toBe(0);
    expect(mesh.instanceMatrix.array[12]).toBe(1);
    expect(mesh.instanceMatrix.array[32 + 12]).toBe(9);
    r.update(frame([pose(1, ARCH.sedan, 1, -10), pose(3, ARCH.sedan, 9, -10), pose(4, ARCH.van, 20, -10)]), 0);
    expect(mesh.instanceMatrix.array[16 + 12]).toBe(20);
    expect(mesh.count).toBe(3);
    // all gone: nothing is drawn and the mesh is hidden
    r.update(frame([]), 0);
    expect(r.instances).toBe(0);
    expect(r.info().draws).toBe(0);
    expect((parent.children[0]?.children[0] as { visible: boolean }).visible).toBe(false);
    r.dispose();
  });

  it('far cars are rewritten one frame in three; near cars every frame', () => {
    const { r, parent } = make(10);
    const mesh = parent.children[0]?.children[0] as unknown as { instanceMatrix: { array: Float32Array } };
    r.update(frame([pose(1, ARCH.sedan, 0, -20), pose(2, ARCH.sedan, FAR_M + 50, 0)]), 0);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      r.update(frame([pose(1, ARCH.sedan, 0.1 * (i + 1), -20), pose(2, ARCH.sedan, FAR_M + 50 + 0.1 * (i + 1), 0)]), 0);
      seen.push(mesh.instanceMatrix.array[16 + 12] as number);
    }
    const changes = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(Math.ceil(5 / FAR_EVERY) + 1);
    expect(changes).toBeGreaterThan(0);
    expect(mesh.instanceMatrix.array[12]).toBeCloseTo(0.6, 5);
    r.dispose();
  });

  it('ignores records that are not flagged ambient and keys it does not know', () => {
    const { r } = make(10);
    const keys = new Map(KEYS);
    const poses = [pose(1, ARCH.sedan, 0, -10, 0), pose(2, ARCH.sedan, 4, -10, 2), { ...pose(3, ARCH.sedan, 8, -10, 2), renderKey: 999 }];
    expect(r.update({ poses, poseCount: poses.length, poseKeys: keys, camera }, 0)).toBe(1);
    r.dispose();
  });
});

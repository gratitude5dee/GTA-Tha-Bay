import { sampleHeight } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { CONTROL_STATE } from '../src/sim/control/states.ts';
import { CIVIC_GRAYBOX } from '../src/sim/scenarios/civic-graybox.ts';
import { GrayboxWorld } from '../src/client/graybox/load.ts';
import { buildChunkMesh, MAX_OBJECTS_PER_CHUNK, meshObjectCount, meshTriangleCount, type MeshBuffers } from '../src/client/graybox/mesher.ts';
import { createGrayboxSim, fixtureChunks, fixturePacks, boxesOf } from './graybox-helpers.ts';
import { frame, player } from './walk-sim.ts';

describe('the gray-box sim (AC-4)', () => {
  it('adds the chunk statics on 4 consecutive ticks, one per tick, nearest chunk first', async () => {
    const sim = await createGrayboxSim();
    const added: { tick: number; n: number; key: string }[] = [];
    for (let i = 0; i < 8; i++) {
      sim.step(1);
      for (const e of sim.services.events.drain()) if (e.t === 'world.chunk') added.push({ tick: e.tick, n: e.n ?? 0, key: e.s ?? '' });
    }
    expect(added.map((a) => a.tick)).toEqual([0, 1, 2, 3]);
    expect(added.map((a) => a.n)).toEqual([1, 2, 3, 4]);
    // The spawn (89, 60) is inside 9/256/256, which comes first; every key is distinct.
    expect(added[0]?.key).toBe('9/256/256');
    expect(new Set(added.map((a) => a.key)).size).toBe(4);
    sim.dispose();
  });

  it('keeps the player in the teleport wait until ground exists, then grounds it on the terrain within 60 ticks', async () => {
    const sim = await createGrayboxSim();
    const first = player(sim);
    expect(first.state).toBe(CONTROL_STATE.teleportPending);
    let groundedAt = -1;
    for (let i = 0; i < 60 && groundedAt < 0; i++) {
      sim.step(1);
      const p = player(sim);
      if (p.grounded && p.state === CONTROL_STATE.idle) groundedAt = sim.tick;
    }
    expect(groundedAt).toBeGreaterThan(0);
    expect(groundedAt).toBeLessThanOrEqual(60);
    const p = player(sim);
    const ground = sampleHeight(fixtureChunks().sim[0]!.height, CIVIC_GRAYBOX.spawn[0], CIVIC_GRAYBOX.spawn[2]);
    expect(p.x).toBeCloseTo(CIVIC_GRAYBOX.spawn[0], 6);
    expect(p.z).toBeCloseTo(CIVIC_GRAYBOX.spawn[2], 6);
    expect(Math.abs(p.y - ground)).toBeLessThan(0.15);
    sim.dispose();
  });

  it('walks across the chunk boundary at z = 128 without dropping below the terrain', async () => {
    const sim = await createGrayboxSim();
    sim.step(40); // settle
    // Face south (+Z): forward is (-sin yaw, -cos yaw), so yaw pi.
    const yaw = 32768;
    const chunks = fixtureChunks().sim;
    const terrainAt = (x: number, z: number): number => {
      const c = chunks.find((k) => k.height.originX <= x && x < k.height.originX + 256 && k.height.originZ <= z && z < k.height.originZ + 256);
      return c ? sampleHeight(c.height, x, z) : NaN;
    };
    let crossed = false;
    let worstDrop = 0;
    for (let i = 0; i < 1600 && !crossed; i++) {
      sim.step(1, (tick) => frame({ tick, moveY: -127, camYaw: yaw, buttons: 0 }));
      const p = player(sim);
      const t = terrainAt(p.x, p.z);
      if (!Number.isNaN(t)) worstDrop = Math.max(worstDrop, t - p.y);
      if (p.z > 140) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(worstDrop).toBeLessThan(0.1);
    sim.dispose();
  });

  it('is deterministic: two runs give the same state hash', async () => {
    const run = async (): Promise<string> => {
      const sim = await createGrayboxSim();
      sim.step(120, (tick) => frame({ tick, moveY: -100, camYaw: 32768 }));
      const h = sim.hash();
      sim.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });

  it('the fixture has the 12 boxes the milestone names', () => {
    const { sim } = fixtureChunks();
    expect(sim).toHaveLength(4);
    expect(sim.flatMap((c) => boxesOf(c.prisms))).toHaveLength(12);
  });
});

/** Geometric normal of triangle t of a buffer set. */
function faceNormal(m: MeshBuffers, t: number): [number, number, number] {
  const i = [m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]] as [number, number, number];
  const p = (k: number, o: number): number => m.positions[i[k] * 3 + o] as number;
  const ux = p(1, 0) - p(0, 0), uy = p(1, 1) - p(0, 1), uz = p(1, 2) - p(0, 2);
  const vx = p(2, 0) - p(0, 0), vy = p(2, 1) - p(0, 1), vz = p(2, 2) - p(0, 2);
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

describe('the gray-box mesher (AC-5)', () => {
  const { sim, render } = fixtureChunks();
  const meshes = sim.map((c) => buildChunkMesh(c, render.find((r) => r.key === c.key) ?? null));

  it('makes at most 6 render objects per chunk, and every chunk has terrain and buildings', () => {
    expect(meshes).toHaveLength(4);
    for (const m of meshes) {
      expect(meshObjectCount(m), m.key).toBeLessThanOrEqual(MAX_OBJECTS_PER_CHUNK);
      expect(m.parts.terrain, m.key).toBeDefined();
      expect(m.parts.buildings, m.key).toBeDefined();
    }
    // The junction chunk has the roads.
    expect(meshes.find((m) => m.key === '9/256/256')?.parts.roads).toBeDefined();
  });

  it('indices are in range, every number is finite and the vertex normals are unit length', () => {
    for (const m of meshes) {
      for (const [name, b] of Object.entries(m.parts)) {
        const n = b.positions.length / 3;
        expect(b.normals.length, `${m.key} ${name}`).toBe(b.positions.length);
        expect(b.colors.length, `${m.key} ${name}`).toBe(b.positions.length);
        expect(Math.max(...b.indices), `${m.key} ${name}`).toBeLessThan(n);
        expect(b.indices.length % 3).toBe(0);
        for (const v of b.positions) expect(Number.isFinite(v)).toBe(true);
        for (let i = 0; i < n; i += 7) {
          expect(Math.hypot(b.normals[i * 3] as number, b.normals[i * 3 + 1] as number, b.normals[i * 3 + 2] as number), `${m.key} ${name}`).toBeCloseTo(1, 4);
        }
      }
    }
  });

  it('terrain and road triangles face up; wall triangles wind the way their vertex normals point', () => {
    for (const m of meshes) {
      for (const name of ['terrain', 'roads'] as const) {
        const b = m.parts[name];
        if (!b) continue;
        for (let t = 0; t < b.indices.length / 3; t += 5) expect(faceNormal(b, t)[1], `${m.key} ${name} tri ${t}`).toBeGreaterThanOrEqual(0);
      }
      const bl = m.parts.buildings as MeshBuffers;
      for (let t = 0; t < bl.indices.length / 3; t += 3) {
        const g = faceNormal(bl, t);
        const v = bl.indices[t * 3] as number;
        const n: [number, number, number] = [bl.normals[v * 3] as number, bl.normals[v * 3 + 1] as number, bl.normals[v * 3 + 2] as number];
        if (g[0] === 0 && g[1] === 0 && g[2] === 0) continue; // a degenerate triangle
        expect(g[0] * n[0] + g[1] * n[1] + g[2] * n[2], `${m.key} building tri ${t}`).toBeGreaterThan(0);
      }
    }
  });

  it('the terrain follows the height posts and the buildings stand on the l0 records', () => {
    const c = sim[0]!;
    const terrain = meshes[0]!.parts.terrain as MeshBuffers;
    // First cell, first vertex: post (0, 0).
    expect(terrain.positions[0]).toBe(c.height.originX);
    expect(terrain.positions[2]).toBe(c.height.originZ);
    expect(terrain.positions[1]).toBeCloseTo((c.height.dm[0] as number) / 10, 4);
    const bl = meshes[0]!.parts.buildings as MeshBuffers;
    const rec = render[0]!.buildings[0]!;
    let maxY = -Infinity;
    for (let i = 1; i < bl.positions.length; i += 3) maxY = Math.max(maxY, bl.positions[i] as number);
    expect(maxY).toBeGreaterThanOrEqual((rec.baseDm + rec.heightDm) / 10 - 1e-4);
  });

  it('GrayboxWorld builds one group per chunk with at most 6 meshes and reports it', () => {
    const world = new GrayboxWorld(fixturePacks());
    const info = world.info();
    expect(info.chunks).toBe(4);
    expect(info.objectsPerChunk).toHaveLength(4);
    expect(info.maxObjectsPerChunk).toBeLessThanOrEqual(6);
    expect(info.triangles).toBe(meshes.reduce((a, m) => a + meshTriangleCount(m), 0));
    expect(info.keys).toContain('9/257/257');
    world.dispose();
  });
});

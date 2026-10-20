import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GroundClass, latLngFromEnu, type ChunkKey, type SimChunk } from '@dv/shared';
import { createWorldApi, type WorldServices } from '../src/sim/api/world-api.ts';
import { chunkOf, roads, topologyOf } from './fixtures/roads.ts';
import { indexOf, landmarkAt, loadAll, storeOf } from './fixtures/world.ts';

const K = '9/256/256' as ChunkKey;

async function worldWith(chunk: SimChunk, f: ReturnType<typeof roads>, landmarks = [landmarkAt('lm.test-hall', 40, 20, K)]): Promise<WorldServices> {
  const store = storeOf([chunk]);
  await loadAll(store, [chunk.key]);
  return createWorldApi(store, indexOf({ landmarks }), { tick: () => 0 }, { topology: topologyOf(f) });
}

describe('WorldResolver.snap', () => {
  const f = roads([[-100, 0], [100, 0]], [{ a: 0, b: 1 }]);

  it('snaps to a road 24 m away (distM <= 25) and gives up on one 26 m away', async () => {
    const w = await worldWith(chunkOf(K, f, { heightM: 5 }), f);
    const near = w.resolver.snap({ at: latLngFromEnu(10, 24), snap: 'road' });
    expect(near).not.toBeNull();
    expect(near!.distM).toBeLessThanOrEqual(25);
    expect(near!.distM).toBeCloseTo(24, 1);
    expect(near!.pos[2]).toBeCloseTo(0, 1);
    expect(near!.pos[0]).toBeCloseTo(10, 1);
    const far = w.resolver.snap({ at: latLngFromEnu(10, 26), snap: 'road' });
    expect(far).toBeNull();
  });

  it('gives the heading of the road, or the requested yaw', async () => {
    const w = await worldWith(chunkOf(K, f, { heightM: 5 }), f);
    // 3 m south of an east-west road: the eastbound edge (right of travel is south), heading east = yaw 3 pi / 2
    const east = w.resolver.snap({ at: latLngFromEnu(0, 3), snap: 'road' })!;
    expect(east.yaw).toBeCloseTo(Math.PI * 1.5, 2);
    const west = w.resolver.snap({ at: latLngFromEnu(0, -3), snap: 'road' })!;
    expect(west.yaw).toBeCloseTo(Math.PI / 2, 2);
    const forced = w.resolver.snap({ at: latLngFromEnu(0, 3), snap: 'road', yawDeg: 90 })!;
    expect(forced.yaw).toBeCloseTo(Math.PI / 2, 5);
    const wrapped = w.resolver.snap({ at: latLngFromEnu(0, 3), snap: 'none', yawDeg: -90 })!;
    expect(wrapped.yaw).toBeCloseTo(Math.PI * 1.5, 5);
  });

  it('snaps to ground off the water, to sidewalks and returns the point for none', async () => {
    // x < 0 is water; a pedestrian node at (30, 40)
    const base = chunkOf(K, f, { heightAt: (x) => (x < 0 ? -3 : 5), ground: (i) => (i < 32 ? GroundClass.Water : GroundClass.Paved) });
    const chunk: SimChunk = { ...base, pedNodes: [{ id: 0, x: 30, y: 5, z: 40, flags: 0 }], pedEdges: [] };
    const w = await worldWith(chunk, f);
    const dry = w.resolver.snap({ at: latLngFromEnu(20, -50), snap: 'ground' })!;
    expect(dry.distM).toBe(0);
    expect(dry.pos[1]).toBeCloseTo(5, 3);
    // 10 m into the water: the nearest dry point is 10 m east (x = 0)
    const wet = w.resolver.snap({ at: latLngFromEnu(-10, -50), snap: 'ground' })!;
    expect(wet.distM).toBeCloseTo(10, 0);
    expect(wet.pos[0]).toBeGreaterThanOrEqual(0);
    // 40 m into the water: nothing within 25 m
    expect(w.resolver.snap({ at: latLngFromEnu(-40, -50), snap: 'ground' })).toBeNull();
    const walk = w.resolver.snap({ at: latLngFromEnu(32, 45), snap: 'sidewalk' })!;
    expect(walk.pos).toEqual([30, 5, 40]);
    expect(walk.distM).toBeCloseTo(Math.hypot(2, 5), 1);
    expect(w.resolver.snap({ at: latLngFromEnu(32, 100), snap: 'sidewalk' })).toBeNull();
    const raw = w.resolver.snap({ at: latLngFromEnu(5, 9), snap: 'none', y: 12 })!;
    expect(raw.pos[1]).toBe(12);
    expect(raw.distM).toBe(0);
  });

  it('resolves a landmark to its position and chunk, and an unknown id to null', async () => {
    const w = await worldWith(chunkOf(K, f, { heightM: 5 }), f);
    expect(w.resolver.landmark('lm.test-hall')).toEqual({ enu: [40, 5, 20], chunkKey: K });
    expect(w.resolver.landmark('lm.nope')).toBeNull();
    expect(w.resolver.bake).toBe(w.places.landmarks().length > 0 ? 'c'.repeat(64) : '');
    const viaLandmark = w.resolver.snap({ at: { landmark: 'lm.test-hall' }, snap: 'road' });
    expect(viaLandmark!.distM).toBeCloseTo(20, 1);
    const [x, y, z] = w.resolver.toEnu(latLngFromEnu(12, -34));
    expect([Math.round(x), y, Math.round(z)]).toEqual([12, 5, -34]);
  });

  it('plans the edges between consecutive points on the topology', async () => {
    const f2 = roads([[-100, 0], [0, 0], [100, 0]], [{ a: 0, b: 1 }, { a: 1, b: 2 }]);
    const w = await worldWith(chunkOf(K, f2, { heightM: 5 }), f2);
    // eastbound along the south lane
    const r = w.resolver.route([latLngFromEnu(-90, 2), latLngFromEnu(90, 2)]);
    expect(r).toEqual([f2.ids[0]![0], f2.ids[1]![0]]);
    const three = w.resolver.route([latLngFromEnu(-90, 2), latLngFromEnu(50, 2), latLngFromEnu(90, 2)]);
    expect(three).toEqual([f2.ids[0]![0], f2.ids[1]![0]]);
    expect(w.resolver.route([latLngFromEnu(-90, 2)])).toBeNull();
    expect(w.resolver.route([latLngFromEnu(-90, 2), latLngFromEnu(5000, 5000)])).toBeNull();
  });
});

describe('every landmark of 02-world-bake.md section 7 resolves to the chunk the table lists', () => {
  const md = readFileSync(fileURLToPath(new URL('../../../spec/domains/02-world-bake.md', import.meta.url)), 'utf8');
  const rows = [...md.matchAll(/^\| \d+ \| (lm\.[a-z0-9.-]+) \| [^|]*\| ([-−0-9., ]+) \| (9\/\d+\/\d+) \|/gm)].map((m) => ({
    id: m[1] as string,
    xz: (m[2] as string).replace(/−/g, '-').split(',').map((v) => Number(v.trim())) as [number, number],
    chunk: m[3] as ChunkKey,
  }));

  it('reads all 37 rows of the table', () => {
    expect(rows).toHaveLength(37);
    expect(rows.find((r) => r.id === 'lm.city-hall')!.chunk).toBe('9/256/256');
  });

  it('matches the authored seeds in content/world/landmarks.json', async () => {
    const seeds = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../content/world/landmarks.json', import.meta.url)), 'utf8')) as { landmarks: { id: string; x: number; z: number; chunk: ChunkKey }[] }).landmarks;
    const store = storeOf([]);
    const w = createWorldApi(store, indexOf({ landmarks: seeds.map((s) => landmarkAt(s.id, s.x, s.z, s.chunk)) }), { tick: () => 0 });
    for (const r of rows) {
      const got = w.resolver.landmark(r.id as `lm.${string}`);
      expect(got, r.id).not.toBeNull();
      expect(got!.chunkKey, r.id).toBe(r.chunk);
    }
    expect(w.resolver.landmark('lm.city-hall')!.chunkKey).toBe('9/256/256');
  });
});

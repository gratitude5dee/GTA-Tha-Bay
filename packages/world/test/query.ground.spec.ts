import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GroundClass, decodeP0, sampleHeight, type ChunkKey, type DistrictGrid, type DistrictRecord, type PedEdge, type PedNode, type SimChunk } from '@dv/shared';
import { WorldQueryImpl } from '../src/sim/api/query.ts';
import { chunkOf, roads } from './fixtures/roads.ts';
import { loadAll, storeOf } from './fixtures/world.ts';

const graybox = fileURLToPath(new URL('../../../tests/fixtures/world/civic-graybox/p0-64-64.pack', import.meta.url));
const none = roads([], []);
const K = (x: number, y: number): ChunkKey => `9/${x}/${y}` as ChunkKey;

async function queryOver(chunks: SimChunk[], grid: DistrictGrid | null = null, districts: DistrictRecord[] = []): Promise<WorldQueryImpl> {
  const store = storeOf(chunks);
  await loadAll(store, chunks.map((c) => c.key));
  return new WorldQueryImpl(store, grid, districts);
}

describe('WorldQuery.groundY on the gray-box fixture', () => {
  it('equals sampleHeight within 1 mm on terrain, and is null where no chunk is resident', async () => {
    const chunks = decodeP0(new Uint8Array(readFileSync(graybox)));
    expect(chunks.length).toBe(4);
    const q = await queryOver(chunks);
    let n = 0;
    for (const c of chunks) {
      const h = c.height;
      for (let k = 0; k < 40; k++) {
        const x = h.originX + 0.37 + (k * 6.1) % 255.2;
        const z = h.originZ + 0.91 + (k * 11.3) % 254.9;
        const y = q.groundY(x, z);
        // no slab or hood lies over this block's ground, so the terrain is the answer
        expect(y).not.toBeNull();
        const expected = Math.max(sampleHeight(h, x, z), ...slabTops(c, x, z));
        expect(Math.abs((y as number) - expected)).toBeLessThan(0.001);
        n++;
      }
    }
    expect(n).toBe(160);
    expect(q.groundY(5000, 5000)).toBeNull();
    expect(q.groundY(-100000, 0)).toBeNull();
  });
});

/** Tops of the slab and hood prisms of a chunk whose footprint holds (x, z). */
function slabTops(c: SimChunk, x: number, z: number): number[] {
  const out: number[] = [];
  for (const pack of [c.slabs, c.hoods]) {
    let i = 0;
    while (i < pack.length) {
      const n = pack[i] as number;
      let inside = false;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const ax = pack[i + 3 + a * 2] as number, az = pack[i + 4 + a * 2] as number, bx = pack[i + 3 + b * 2] as number, bz = pack[i + 4 + b * 2] as number;
        if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
      }
      if (inside) out.push((pack[i + 1] as number) + (pack[i + 2] as number));
      i += 3 + n * 2;
    }
  }
  return out;
}

describe('WorldQuery.groundY with slabs and hoods', () => {
  // a flat 10 m terrain; a deck 9 m above it over x -20..20, z -10..10 (base 18, 1 m thick); a hood roof over x 50..70 at 12.5 m
  const deck = [4, 18, 1, -20, -10, 20, -10, 20, 10, -20, 10];
  const hood = [4, 10, 2.5, 50, -10, 70, -10, 70, 10, 50, 10];
  const chunk = chunkOf(K(256, 256), none, { heightM: 10, slabs: deck, hoods: hood });

  it('returns the deck top near the deck and the terrain below it otherwise', async () => {
    const q = await queryOver([chunk]);
    expect(q.groundY(0, 0, 19)).toBe(19);
    expect(q.groundY(0, 0, 18.4)).toBe(19);
    expect(q.groundY(0, 0, 10)).toBe(10);
    expect(q.groundY(0, 0, 9)).toBe(10);
    expect(q.groundY(0, 0, 14.4)).toBe(10);
    expect(q.groundY(0, 0, 14.6)).toBe(19);
    // without a hint, the highest surface
    expect(q.groundY(0, 0)).toBe(19);
    // beside the deck
    expect(q.groundY(30, 0)).toBe(10);
    expect(q.groundY(30, 0, 19)).toBe(10);
    // a hood is a roof over a carved corridor: the corridor floor is the terrain, the roof the hood top
    expect(q.groundY(60, 0, 10)).toBe(10);
    expect(q.groundY(60, 0, 12.5)).toBe(12.5);
    expect(q.groundY(60, 0)).toBe(12.5);
  });

  it('sees a deck that overhangs the next chunk', async () => {
    // a deck in chunk 257 whose footprint reaches 3 m into chunk 256 (x < 128)
    const over = [4, 18, 1, 125, -10, 140, -10, 140, 10, 125, 10];
    const east = chunkOf(K(257, 256), none, { heightM: 10, slabs: over });
    const q = await queryOver([chunk, east]);
    expect(q.groundY(127, 0, 19)).toBe(19);
    expect(q.groundY(127, 0, 10)).toBe(10);
    expect(q.groundY(120, 0)).toBe(10);
  });
});

describe('WorldQuery water, districts and walking', () => {
  it('reads water from the ground classes and the depth from the terrain below sea level', async () => {
    // the west half of the chunk (x < 0) is water, 2 m deep; shallow water for z > 40
    const c = chunkOf(K(256, 256), none, {
      heightAt: (x) => (x < 0 ? -2 : 5),
      ground: (i, j) => (i < 32 ? (j > 42 ? GroundClass.WaterShallow : GroundClass.Water) : GroundClass.Paved),
    });
    const q = await queryOver([c]);
    expect(q.isWater(-50, -50)).toBe(true);
    expect(q.isWater(-50, 100)).toBe(true);
    expect(q.isWater(50, 0)).toBe(false);
    expect(q.isWater(9000, 9000)).toBe(false);
    expect(q.waterDepth(-60, 0)).toBeCloseTo(2, 5);
    expect(q.waterDepth(60, 0)).toBe(0);
    expect(q.chunkReady(K(256, 256))).toBe(true);
    expect(q.chunkReady(K(257, 256))).toBe(false);
  });

  it('answers nhoodAt and districtAt from the grid, and 255 and null without one', async () => {
    const cells = new Uint8Array(4 * 4).fill(255);
    cells[0] = 3;   // x 0..64, z 0..64
    cells[1] = 4;   // x 64..128, z 0..64
    cells[4 + 1] = 40;
    const grid: DistrictGrid = { bakeId: 'a'.repeat(64), cellM: 64, minX: 0, minZ: 0, cols: 4, rows: 4, nhoods: Array.from({ length: 41 }, (_v, i) => `nh-${i}`), cells };
    const districts: DistrictRecord[] = [
      { id: 'd1', kind: 'district', parent: null, nameKey: 'district.d1', tier: 'A', nhoods: ['nh-3'], densityProfile: 0 },
      { id: 'outer', kind: 'district', parent: null, nameKey: 'district.outer', tier: 'C', nhoods: ['nh-4', 'nh-40'], densityProfile: 0 },
      { id: 'nh-3', kind: 'nhood', parent: 'd1', nameKey: 'nhood.nh-3', tier: 'A', nhoods: [], densityProfile: 0 },
      { id: 'nh-4', kind: 'nhood', parent: 'outer', nameKey: 'nhood.nh-4', tier: 'C', nhoods: [], densityProfile: 0 },
      { id: 'nh-40', kind: 'nhood', parent: 'outer', nameKey: 'nhood.nh-40', tier: 'C', nhoods: [], densityProfile: 0 },
    ];
    const q = await queryOver([], grid, districts);
    expect(q.nhoodAt(10, 10)).toBe(3);
    expect(q.nhoodAt(100, 10)).toBe(4);
    expect(q.nhoodAt(100, 100)).toBe(40);
    expect(q.nhoodAt(200, 10)).toBe(255);
    expect(q.nhoodAt(-5, 10)).toBe(255);
    expect(q.districtAt(10, 10)).toBe('d1');
    expect(q.districtAt(100, 100)).toBe('outer');
    expect(q.districtAt(200, 10)).toBeNull();
    const bare = await queryOver([]);
    expect(bare.nhoodAt(10, 10)).toBe(255);
    expect(bare.districtAt(10, 10)).toBeNull();
  });

  it('finds the nearest walkable point on the pedestrian graph, on a node or along an edge', async () => {
    const nodes: PedNode[] = [{ id: 0, x: 0, y: 5, z: 0, flags: 0 }, { id: 1, x: 100, y: 7, z: 0, flags: 0 }];
    const edges: PedEdge[] = [{ a: 0, b: 1, kind: 0, widthM: 2, junction: -1, movement: -1 }];
    const c: SimChunk = { ...chunkOf(K(256, 256), none), pedNodes: nodes, pedEdges: edges };
    const q = await queryOver([c]);
    expect(q.nearestWalkable(50, 8, 20)).toEqual({ x: 50, y: 6, z: 0 });
    expect(q.nearestWalkable(-3, 4, 20)).toEqual({ x: 0, y: 5, z: 0 });
    expect(q.nearestWalkable(50, 30, 20)).toBeNull();
    expect(q.nearestWalkable(5000, 0, 20)).toBeNull();
  });

  it('measures the distance to building footprints for the teleport clearance', async () => {
    const building = [4, 0, 20, 10, 10, 30, 10, 30, 30, 10, 30];
    const c = chunkOf(K(256, 256), none, { prisms: building });
    const q = await queryOver([c]);
    expect(q.distToBuildings(20, 20, 5)).toBe(0);
    expect(q.distToBuildings(35, 20, 10)).toBeCloseTo(5, 5);
    expect(q.distToBuildings(100, 100, 10)).toBeCloseTo(98.99, 1);
    expect(q.distToBuildings(9000, 9000, 10)).toBe(Infinity);
  });
});

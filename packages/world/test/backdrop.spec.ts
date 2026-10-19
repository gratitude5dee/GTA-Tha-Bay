/**
 * AC-14 (unit half): the backdrop of each flat tier. The `far-bay-dem` ring at 80 km and massing on the two desktop tiers, cards at
 * 20 km on `mobile` and 10 km on `mobile-low` with no massing, at most three backdrop render objects, exactly one upload at boot on
 * every tier; with the Effort fallback (`world.massing` off) massing is false on every tier and the report says so (R-MAP-02, DL-697).
 * Plus the geometry builders on the baked far packs.
 */
import { readFileSync } from 'node:fs';
import { decodeFarDem, decodeFarMassing, type FarDem, type QualityTierId } from '@dv/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { BackdropLayer, type JobClient } from '../src/client/backdrop/backdrop-layer.ts';
import { BACKDROP, cardsLayout, demHeightAt, massingInstances, ringMesh } from '../src/client/backdrop/far-mesh.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

/** A small DEM: 9 x 9 posts of 256 m, land in the middle, sea around. */
function tinyDem(): FarDem {
  const nx = 9, nz = 9;
  const heights = new Int16Array(nx * nz);
  const land = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const dry = i >= 2 && i <= 6 && j >= 2 && j <= 6;
      land[j * nx + i] = dry ? 1 : 0;
      heights[j * nx + i] = dry ? 300 + i * 10 : -20;
    }
  }
  return { bakeId: '0'.repeat(64), minX: -1024, minZ: -1024, nx, nz, cellM: 256, heights, land };
}

describe('ring, massing and cards builders', () => {
  it('the ring has one vertex per post at stride 1, sea flat at the sea level and land on the DEM', () => {
    const dem = tinyDem();
    const r = ringMesh(dem, 1);
    expect(r.buffers.positions.length / 3).toBe(81);
    expect(r.buffers.indices.length / 3).toBe(2 * 8 * 8);
    expect(r.originX).toBe(-1024);
    const sea = BACKDROP.ring.seaLevelM;
    // post (0, 0) is sea, post (4, 4) is land at 30 + 4 m.
    expect(r.buffers.positions[1]).toBe(sea);
    expect(r.buffers.positions[(4 * 9 + 4) * 3 + 1]).toBeCloseTo(34, 3);
    expect(ringMesh(dem, 2).buffers.positions.length / 3).toBe(25);
    expect(demHeightAt(dem, 0, 0)).toBeCloseTo(34, 1);
  });

  it('massing instances place a unit box on the DEM with the box yaw', () => {
    const dem = tinyDem();
    const inst = massingInstances({ bakeId: dem.bakeId, originX: -1000, originZ: -1000, cellM: 1000, boxes: Float32Array.from([0, 0, 20, 10, 40, 0, 100, 100, 10, 30, 90, Math.PI / 2]), lines: [] }, dem);
    expect(inst.count).toBe(2);
    const m = inst.matrices;
    // Box 0: x axis scaled by w = 20, y by h = 40, z by d = 10, centred at (0 - originX, ., 0 - originZ).
    expect([m[0], m[5], m[10]]).toEqual([20, 40, 10]);
    expect(m[12]).toBe(1000);
    expect(m[14]).toBe(1000);
    // Box 1 turned a quarter turn: the x axis points along +z.
    expect(m[16 + 0]).toBeCloseTo(0, 5);
    expect(m[16 + 2]).toBeCloseTo(10, 5);
  });

  it('cards: one quad per cluster, UVs inside the atlas, distance clamped to the tier, the row nearest the view azimuth', () => {
    const far = cardsLayout({ x: 0, z: 0 }, 20);
    const near = cardsLayout({ x: 0, z: 0 }, 10);
    expect(far.cards.length).toBe(BACKDROP.clusters.length);
    expect(far.indices.length).toBe(far.cards.length * 6);
    for (const u of far.uvs) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
    for (const c of far.cards) expect(c.distM).toBeLessThanOrEqual(20_000);
    for (const c of near.cards) expect(c.distM).toBeLessThanOrEqual(10_000);
    // Oakland downtown is about 13 km away: 10 km on mobile-low, its true distance on mobile.
    const oaklandFar = far.cards.find((c) => c.id === 'oakland-downtown');
    const oaklandNear = near.cards.find((c) => c.id === 'oakland-downtown');
    expect(oaklandFar?.distM).toBeGreaterThan(12_000);
    expect(oaklandNear?.distM).toBe(10_000);
    // Seen from the spawn, a card in the east looks west: row 0 (azimuth 270).
    expect(oaklandFar?.row).toBe(0);
    for (const c of far.cards) expect([0, 1, 2]).toContain(c.row);
  });

  it('the synth bake far packs decode and mesh', () => {
    const bake = requireBake('synth', 'backdrop.spec synth bake');
    if (!bake) return;
    const dem = decodeFarDem(new Uint8Array(readFileSync(`${bake.dir}/packs/far-bay-dem.pack`)));
    const massing = decodeFarMassing(new Uint8Array(readFileSync(`${bake.dir}/packs/far-bay-massing.pack`)));
    expect(dem.nx * dem.nz).toBe(dem.heights.length);
    const ring = ringMesh(dem, 1);
    expect(ring.buffers.positions.length / 3).toBe(dem.nx * dem.nz);
    expect(ring.buffers.indices.length / 3).toBe(2 * (dem.nx - 1) * (dem.nz - 1));
    // The ring is under 3 M triangles at stride 1 (budget: one render object).
    expect(ring.buffers.indices.length / 3).toBeLessThan(400_000);
    const inst = massingInstances(massing, dem);
    expect(inst.count).toBeGreaterThan(1000);
    expect(inst.matrices.length).toBe(inst.count * 16);
  });
});

// ---- tiers ---------------------------------------------------------------------------------------------------------------

const tinyRing = (): unknown => ringMesh(tinyDem(), 1);
const tinyMassing = (): unknown => massingInstances({ bakeId: '0'.repeat(64), originX: 0, originZ: 0, cellM: 1000, boxes: Float32Array.from([10, 10, 20, 10, 40, 0]), lines: [] }, null);

function fakeJobs(): JobClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    job: async (name, args) => {
      const a = args as { name: string };
      calls.push(`${name}:${a.name}`);
      if (a.name === 'ring') return tinyRing();
      if (a.name === 'massing') return tinyMassing();
      return { png: new ArrayBuffer(8) };
    },
  };
}

describe('BackdropLayer reports per tier (AC-14)', () => {
  beforeAll(() => {
    // The atlas decode needs createImageBitmap, which Node does not have.
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => ({ width: 2048, height: 1024, close: () => {} });
  });

  const expectations: { tier: QualityTierId; ringKm: number | null; cardsKm: number | null; massing: boolean }[] = [
    { tier: 'desktop-ultra', ringKm: 80, cardsKm: null, massing: true },
    { tier: 'desktop', ringKm: 80, cardsKm: null, massing: true },
    { tier: 'mobile', ringKm: null, cardsKm: 20, massing: false },
    { tier: 'mobile-low', ringKm: null, cardsKm: 10, massing: false },
    { tier: 'xr-visionpro', ringKm: null, cardsKm: 20, massing: false },
    { tier: 'xr-quest', ringKm: null, cardsKm: 10, massing: false },
  ];

  it.each(expectations)('$tier: ring $ringKm km, cards $cardsKm km, massing $massing, at most three objects, one upload at boot', async ({ tier, ringKm, cardsKm, massing }) => {
    const layer = new BackdropLayer({ tier, jobs: fakeJobs(), flags: { cards: true, massing: true }, spawn: { x: 0, z: 0 } });
    expect(layer.info().bootUploads).toBe(0);
    await layer.load();
    const info = layer.info();
    expect(info.ringKm).toBe(ringKm);
    expect(info.cardsKm).toBe(cardsKm);
    expect(info.massing).toBe(massing);
    expect(info.renderObjects).toBeGreaterThan(0);
    expect(info.renderObjects).toBeLessThanOrEqual(3);
    expect(info.bootUploads).toBe(1);
    layer.dispose();
  });

  it.each(expectations)('$tier with world.massing off (the Effort fallback): massing is false and the ring or cards stay', async ({ tier, ringKm, cardsKm }) => {
    const jobs = fakeJobs();
    const layer = new BackdropLayer({ tier, jobs, flags: { cards: true, massing: false }, spawn: { x: 0, z: 0 } });
    await layer.load();
    const info = layer.info();
    expect(info.massing).toBe(false);
    expect(info.ringKm).toBe(ringKm);
    expect(info.cardsKm).toBe(cardsKm);
    expect(jobs.calls.some((c) => c.endsWith(':massing'))).toBe(false);
    expect(info.bootUploads).toBe(1);
    layer.dispose();
  });

  it('with world.cards off the card tiers draw no backdrop and report no upload', async () => {
    const layer = new BackdropLayer({ tier: 'mobile', jobs: fakeJobs(), flags: { cards: false, massing: true }, spawn: { x: 0, z: 0 } });
    await layer.load();
    expect(layer.info()).toEqual({ ringKm: null, cardsKm: null, massing: false, renderObjects: 0, bootUploads: 0 });
  });
});

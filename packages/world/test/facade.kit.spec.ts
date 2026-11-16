/**
 * M02h7 AC-2 (the kit geometry in the mesher): hand-built fixtures (walls facing a segment at 10 m, at 20 m and at 45 degrees, a 3 m wall, two
 * touching row houses) meshed through `addBuilding` with a kit, and the `synth` and `civic-excerpt` bakes meshed twice per profile:
 *  - buffers are byte-identical run to run, and the `mobile-low` (`low`) and legacy (XR) bytes equal the parent commit's (committed hashes);
 *  - awnings only on street-passing `FLAG_SHOP` walls, bays only on ResLow/ResMid street walls at or above the ground floor, cornices only on
 *    `desktop` flat-roof ResMid/Commercial/Civic buildings;
 *  - no building exceeds `trisPerBuilding + kit.trisPerBuilding`, and every surface id is in the table.
 * `DV_LOOK_WRITE=1` rewrites the committed hashes (only on the parent commit of a change that must not move them).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { QualityTierId, SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { AWNING_TRIS, BAY_TRIS, KIT, emptyKitStats, inRing, localSegments, type BuildingKit } from '../src/client/chunks/facade-kit.ts';
import type { MeshBuffers, UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { MESHER, MeshBuilder, addBuilding, meshChunk, profileOf } from '../src/client/chunks/mesher.ts';
import { facadeClassOf } from '../src/client/look/config.ts';
import { FLAG_BAY, FLAG_CORNICE, FLAG_SHOP, SURFACE_COUNT, Surf, wallSurf } from '../src/client/look/surfaces.ts';
import { bakeTiles, type Tile } from './curbs.support.ts';

const HASHES = new URL('./fixtures/facade-kit-hashes.json', import.meta.url);
const AREAS = ['synth', 'civic-excerpt'] as const;
const TILES: Record<string, Tile[]> = Object.fromEntries(AREAS.map((a) => [a, bakeTiles(a, `facade.kit ${a}`, 2)]));

const desktop = MESHER.profiles.desktop;
const mobile = MESHER.profiles.mobile;

function kitFor(segs: Float32Array[], others: number[][] = [], o: Partial<BuildingKit> = {}): BuildingKit {
  return { segs, others, allowance: KIT.trisPerBuilding.desktop, bays: KIT.bay.perWall.desktop, cornice: true, stats: emptyKitStats(), ...o };
}

/** The triangles of `b` whose surface id is `id`, as [flags, min y, max y] triples. */
function trisOf(b: MeshBuilder, id: number): { flags: number; y0: number; y1: number }[] {
  const out: { flags: number; y0: number; y1: number }[] = [];
  for (let t = 0; t < b.idx.length; t += 3) {
    const v = b.idx[t] as number;
    if (b.surf[v * 4] !== id) continue;
    const ys = [0, 1, 2].map((k) => b.pos[(b.idx[t + k] as number) * 3 + 1] as number);
    out.push({ flags: b.surf[v * 4 + 3] as number, y0: Math.min(...ys), y1: Math.max(...ys) });
  }
  return out;
}

/** A road along x at z (absolute ENU triples, the unit corner at 0, 0). */
const road = (z: number): { pts: Float32Array } => ({ pts: new Float32Array([-100, 0, z, 0, 0, z, 100, 0, z]) });

/** A 12 x 10 m box whose +z wall (from (12, 10) to (0, 10)) faces a road at `z`. */
const box = (x = 0): number[] => [x, 0, x + 12, 0, x + 12, 10, x, 10];

type Rec = Parameters<typeof addBuilding>[4];
const recOf = (r: { kind: number; roof: number; palette: number; seed: number }): Rec => r as unknown as Rec;

describe('kit fixtures (AC-2)', () => {
  const commercial = { kind: 2, roof: 0, palette: 1, seed: 1234 };
  const resLow = { kind: 0, roof: 0, palette: 2, seed: 77 };

  it('only the wall facing a segment at 10 m gets an awning (not 20 m, not 45 degrees)', () => {
    for (const [z, expected] of [[20, 1], [30, 0]] as const) {
      const b = new MeshBuilder({ facade: true });
      const kit = kitFor(localSegments([road(z)], 0, 0));
      addBuilding(b, box(), 0, 12, recOf(commercial), desktop, undefined, undefined, kit);
      expect(kit.stats.awnings, `road at ${z - 10} m`).toBe(expected);
      expect(kit.stats.shopWalls).toBe(expected);
    }
    const r = (45 * Math.PI) / 180;
    const diag = { pts: new Float32Array([6 - 40 * Math.cos(r), 0, 18 - 40 * Math.sin(r), 6 + 40 * Math.cos(r), 0, 18 + 40 * Math.sin(r)]) };
    const b = new MeshBuilder({ facade: true });
    const kit = kitFor(localSegments([diag], 0, 0));
    addBuilding(b, box(), 0, 12, recOf(commercial), desktop, undefined, undefined, kit);
    expect(kit.stats.awnings).toBe(0);
  });

  it('a 3 m wall never qualifies', () => {
    const b = new MeshBuilder({ facade: true });
    const kit = kitFor(localSegments([road(15)], 0, 0));
    addBuilding(b, [0, 0, 3, 0, 3, 10, 0, 10], 0, 12, recOf(commercial), desktop, undefined, undefined, kit);
    expect(kit.stats.shopWalls).toBe(0);
    expect(kit.stats.awnings).toBe(0);
  });

  it('awnings carry the Awning surface on FLAG_SHOP walls, below the ground floor line', () => {
    const b = new MeshBuilder({ facade: true });
    const kit = kitFor(localSegments([road(20)], 0, 0));
    addBuilding(b, box(), 0, 12, recOf(commercial), desktop, undefined, undefined, kit);
    const aw = trisOf(b, Surf.Awning);
    expect(aw.length).toBe(AWNING_TRIS);
    const gf = facadeClassOf(2).groundFloorM;
    for (const t of aw) expect(t.y1).toBeLessThanOrEqual(gf + 1e-4);
    const shopWalls = trisOf(b, wallSurf(2)).filter((t) => (t.flags & FLAG_SHOP) !== 0);
    expect(shopWalls.length).toBeGreaterThan(0);
  });

  it('bays sit on ResLow street walls at or above the ground floor; a bay whose corner falls in a touching footprint is skipped', () => {
    const b = new MeshBuilder({ facade: true });
    const kit = kitFor(localSegments([road(20)], 0, 0));
    addBuilding(b, box(), 0, 10, recOf(resLow), desktop, undefined, undefined, kit);
    expect(kit.stats.bays).toBeGreaterThan(0);
    const gf = facadeClassOf(0).groundFloorM;
    const bay = trisOf(b, wallSurf(0)).filter((t) => (t.flags & FLAG_BAY) !== 0);
    expect(bay.length).toBe(kit.stats.bays * BAY_TRIS);
    for (const t of bay) expect(t.y0).toBeGreaterThanOrEqual(gf - 1e-4);

    // two touching row houses: the neighbour stands 0.5 m proud of this one's street wall along its whole front, so every bay corner is inside it
    const neighbour = [-2, 9, 14, 9, 14, 10.5, -2, 10.5];
    const b2 = new MeshBuilder({ facade: true });
    const kit2 = kitFor(localSegments([road(20)], 0, 0), [neighbour]);
    addBuilding(b2, box(), 0, 10, recOf(resLow), desktop, undefined, undefined, kit2);
    expect(kit2.stats.bays).toBe(0);
    expect(kit2.stats.baysBlocked).toBeGreaterThan(0);
    expect(inRing(neighbour, 6, 10.3)).toBe(true);
  });

  it('cornices only with the profile flag and on flat-roof ResMid, Commercial and Civic', () => {
    const run = (rec: { kind: number; roof: number; palette: number; seed: number }, cornice: boolean): number => {
      const b = new MeshBuilder({ facade: true });
      const kit = kitFor(localSegments([road(20)], 0, 0), [], { cornice });
      addBuilding(b, box(), 0, 14, recOf(rec), desktop, undefined, undefined, kit);
      expect(trisOf(b, wallSurf(rec.kind)).filter((t) => (t.flags & FLAG_CORNICE) !== 0).length > 0).toBe(kit.stats.cornices > 0);
      return kit.stats.cornices;
    };
    expect(run(commercial, true)).toBe(1);
    expect(run(commercial, false)).toBe(0);
    expect(run({ ...commercial, kind: 1 }, true)).toBe(1);
    expect(run({ ...commercial, kind: 5 }, true)).toBe(1);
    expect(run({ ...commercial, kind: 0 }, true)).toBe(0);
    expect(run({ ...commercial, kind: 3 }, true)).toBe(0);
    expect(run({ ...commercial, kind: 4 }, true)).toBe(0);
    expect(run({ ...commercial, roof: 1, kind: 1 }, true)).toBe(0);
  });

  it('a shrinking allowance drops the cornice, then the bay, then the awning', () => {
    // a ResMid shop with one street wall: an awning, bays and a cornice
    const seed = [...Array(400).keys()].find((s) => {
      const k = kitFor(localSegments([road(20)], 0, 0));
      addBuilding(new MeshBuilder({ facade: true }), box(), 0, 14, recOf({ kind: 1, roof: 0, palette: 0, seed: s }), desktop, undefined, undefined, k);
      return k.stats.awnings === 1 && k.stats.bays >= 1 && k.stats.cornices === 1;
    });
    expect(seed).toBeDefined();
    const rec = { kind: 1, roof: 0, palette: 0, seed: seed as number };
    const counts = (allowance: number): [number, number, number] => {
      const k = kitFor(localSegments([road(20)], 0, 0), [], { allowance });
      addBuilding(new MeshBuilder({ facade: true }), box(), 0, 14, recOf(rec), desktop, undefined, undefined, k);
      return [k.stats.cornices, k.stats.bays, k.stats.awnings];
    };
    const full = counts(1000);
    expect(full[0]).toBe(1);
    expect(counts(AWNING_TRIS + full[1] * BAY_TRIS)).toEqual([0, full[1], 1]);
    expect(counts(AWNING_TRIS)).toEqual([0, 0, 1]);
    expect(counts(0)).toEqual([0, 0, 0]);
  });

  it('with a kit allowance of 0 the building meshes exactly as without a kit', () => {
    const a = new MeshBuilder({ facade: true });
    const b = new MeshBuilder({ facade: true });
    addBuilding(a, box(), 0, 12, recOf(commercial), mobile);
    addBuilding(b, box(), 0, 12, recOf(commercial), mobile, undefined, undefined, kitFor(localSegments([road(20)], 0, 0), [], { allowance: 0, bays: 0, cornice: false }));
    expect(b.idx).toEqual(a.idx);
    expect(b.surf).toEqual(a.surf);
    expect(b.pos).toEqual(a.pos);
  });
});

// ---- the bakes ----------------------------------------------------------------------------------------------------------

const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];
/** The tiers whose bytes must not move (`low` and the legacy look of the XR tiers). */
const FROZEN: QualityTierId[] = ['mobile-low', 'xr-quest', 'xr-visionpro'];

const mesh = (t: Tile, sim: SimChunk, tier: QualityTierId): UnitMesh =>
  meshChunk(sim, t.renders.find((r) => r.key === sim.key) ?? null, { tier, distM: 0, tile: t.sims });

function hashOf(objects: readonly MeshBuffers[], h = createHash('sha256')): ReturnType<typeof createHash> {
  for (const o of objects) {
    h.update(o.kind);
    for (const a of [o.positions, o.normals, o.colors, o.ao, o.indices, o.surf, o.facade, o.road]) if (a) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
  return h;
}

interface HashFile {
  $comment: string;
  areas: Record<string, { bakeId: string; tiers: Record<string, string> }>;
}

describe.each(AREAS)('the kit on the %s bake (AC-2)', (area) => {
  const tiles = TILES[area] as Tile[];

  it.each(TIERS)('%s: two runs are byte-identical, every surface id is known, no building exceeds its allowance', (tier) => {
    if (tiles.length === 0) return;
    const { id } = profileOf(tier);
    const cap = MESHER.profiles[id].trisPerBuilding + KIT.trisPerBuilding[id];
    for (const t of tiles) {
      for (const sim of t.sims) {
        const a = mesh(t, sim, tier), b = mesh(t, sim, tier);
        expect(hashOf(a.objects).digest('hex'), `${sim.key} on ${tier}`).toBe(hashOf(b.objects).digest('hex'));
        expect(a.stats.maxBuildingTris).toBeLessThanOrEqual(cap);
        for (const o of a.objects) for (let k = 0; k < o.surf.length; k += 4) expect((o.surf[k] as number) < SURFACE_COUNT).toBe(true);
        if (KIT.trisPerBuilding[id] === 0 || tier.startsWith('xr')) expect(a.stats.kitTriangles ?? 0).toBe(0);
        // the kit adds no render object: the unit's object list is the same without it (AC-6's +0 objects)
        const plain = meshChunk(sim, t.renders.find((r) => r.key === sim.key) ?? null, { tier, distM: 0, tile: t.sims, facadeKit: false });
        expect(a.objects.map((o) => o.kind)).toEqual(plain.objects.map((o) => o.kind));
        const tris = (m: UnitMesh): number => m.objects.filter((o) => o.kind === 'buildings').reduce((n, o) => n + o.indices.length / 3, 0);
        expect(tris(a) - tris(plain), `${sim.key} kit triangles`).toBe(a.stats.kitTriangles ?? 0);
      }
    }
  });

  it('desktop and mobile carry the kit; cornices only on desktop', () => {
    if (tiles.length === 0) return;
    const sum = (tier: QualityTierId): { shopWalls: number; awnings: number; bays: number; cornices: number; tris: number } => {
      const s = { shopWalls: 0, awnings: 0, bays: 0, cornices: 0, tris: 0 };
      for (const t of tiles) {
        for (const sim of t.sims) {
          const k = mesh(t, sim, tier).stats.kit;
          if (!k) continue;
          s.shopWalls += k.shopWalls;
          s.awnings += k.awnings;
          s.bays += k.bays;
          s.cornices += k.cornices;
          s.tris += k.triangles;
        }
      }
      return s;
    };
    const d = sum('desktop'), m = sum('mobile');
    expect(d.shopWalls).toBeGreaterThan(0);
    expect(d.awnings + d.bays).toBeGreaterThan(0);
    if (area === 'synth') {
      expect(d.awnings).toBeGreaterThan(0);
      expect(d.bays).toBeGreaterThan(0);
      expect(d.cornices).toBeGreaterThan(0);
      expect(m.awnings).toBeGreaterThan(0);
    }
    expect(m.cornices).toBe(0);
    expect(m.tris).toBeLessThanOrEqual(d.tris);
  });

  it('the low and legacy bytes equal the committed hashes of the parent commit', () => {
    if (tiles.length === 0) return;
    const bakeId = tiles[0]?.sims[0]?.bakeId as string;
    const tiers: Record<string, string> = {};
    for (const tier of FROZEN) {
      const h = createHash('sha256');
      for (const t of tiles) for (const sim of t.sims) hashOf(mesh(t, sim, tier).objects, h);
      tiers[tier] = h.digest('hex');
    }
    const file: HashFile = existsSync(HASHES)
      ? (JSON.parse(readFileSync(HASHES, 'utf8')) as HashFile)
      : { $comment: 'M02h7 AC-2: sha-256 of the L0 objects of the two busiest tiles per bake on the tiers the kit must not move, from the parent commit of M02h7 (DV_LOOK_WRITE=1 writes).', areas: {} };
    if (process.env['DV_LOOK_WRITE'] === '1') {
      file.areas[area] = { bakeId, tiers };
      writeFileSync(HASHES, `${JSON.stringify(file, null, 2)}\n`);
      return;
    }
    const committed = file.areas[area];
    expect(committed, `no committed hashes for ${area}`).toBeDefined();
    if (committed?.bakeId !== bakeId) {
      console.log(`SKIP facade.kit hashes: ${area} bake ${bakeId} is not the committed bake ${String(committed?.bakeId)}`);
      return;
    }
    expect(tiers).toEqual(committed.tiers);
  });
});

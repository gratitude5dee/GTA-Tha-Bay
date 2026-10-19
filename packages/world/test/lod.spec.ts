/**
 * L1 and L2 (02-world.md 5.3): the S11 pack decoders and the LOD mesher, on the synth bake. A unit's terrain follows the posts at
 * every 1st / 2nd / 4th, water is flat at the sea level, a skirt closes the edge, roads follow the surface, and the objects per
 * unit stay at three (`terrain`, `massing`, `roads`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { LOD_LAND_CLASS, TERRAIN_POSTS, decodeLod, type LodUnit, type QualityTierId } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { meshLod } from '../src/client/chunks/lod-mesher.ts';
import { MESHER, profileOf } from '../src/client/chunks/mesher.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low'];

function units(bakeDir: string, family: 'l1' | 'l2'): LodUnit[] {
  const dir = `${bakeDir}/packs`;
  const out: LodUnit[] = [];
  for (const f of readdirSync(dir).filter((n) => n.startsWith(`${family}-`))) out.push(...decodeLod(new Uint8Array(readFileSync(`${dir}/${f}`))));
  return out;
}

describe('decodeLod and meshLod on the synth bake', () => {
  const bake = requireBake('synth', 'lod.spec synth bake');

  it('decodes every l1 and l2 pack: 65 x 65 heights, rings inside the unit, keys at z=7 and z=5', () => {
    if (!bake) return;
    const l1 = units(bake.dir, 'l1');
    const l2 = units(bake.dir, 'l2');
    expect(l1.length).toBeGreaterThan(20);
    expect(l2.length).toBeGreaterThan(3);
    for (const u of [...l1, ...l2]) {
      expect(u.key.startsWith(u.level === 'l1' ? '7/' : '5/')).toBe(true);
      expect(u.heights.length).toBe(TERRAIN_POSTS * TERRAIN_POSTS);
      expect(u.postM).toBe(u.edgeM / 64);
      for (const m of u.massing) {
        for (let i = 0; i < m.ring.length; i += 2) {
          expect(Math.abs((m.ring[i] as number) - u.centreX)).toBeLessThanOrEqual(u.edgeM);
          expect(Math.abs((m.ring[i + 1] as number) - u.centreZ)).toBeLessThanOrEqual(u.edgeM);
        }
      }
    }
    // Interior units carry a land outline; the unit under City Hall does.
    const hall = l1.find((u) => u.key === '7/64/64');
    expect(hall?.landuse.some((l) => l.cls === LOD_LAND_CLASS)).toBe(true);
    expect(hall?.massing.length).toBeGreaterThan(0);
    expect(hall?.roads.length).toBeGreaterThan(0);
  });

  it.each(TIERS)('%s: meshes a dense L1 tile and an L2 block into at most three objects, deterministically', (tier) => {
    if (!bake) return;
    const stride = profileOf(tier).profile.lodStride;
    const verts = 64 / stride + 1;
    for (const family of ['l1', 'l2'] as const) {
      const list = units(bake.dir, family);
      const u = [...list].sort((a, b) => b.massing.length - a.massing.length)[0] as LodUnit;
      const a = meshLod(u, tier);
      const b = meshLod(u, tier);
      expect(a.objects.length).toBeLessThanOrEqual(3);
      expect(a.objects.map((o) => o.kind)).toEqual(b.objects.map((o) => o.kind));
      const terrain = a.objects.find((o) => o.kind === 'terrain');
      expect(terrain).toBeDefined();
      // verts x verts posts plus the skirt copy of the edge ring.
      const edge = 4 * (verts - 1);
      expect(terrain?.positions.length).toBe((verts * verts + edge) * 3);
      expect(Buffer.compare(Buffer.from((terrain?.positions as Float32Array).buffer), Buffer.from((b.objects[0]?.positions as Float32Array).buffer))).toBe(0);
      expect(a.stats.triangles).toBeGreaterThan(0);
      // Local positions stay inside the unit (plus the skirt's drop).
      for (const o of a.objects) {
        expect(o.bounds[0]).toBeGreaterThanOrEqual(-70);
        expect(o.bounds[3]).toBeLessThanOrEqual(u.edgeM + 70);
      }
    }
  });

  it('water is flat at the sea level and the skirt hangs 8 m below the edge', () => {
    if (!bake) return;
    const all = units(bake.dir, 'l2');
    // A unit with water: some terrain vertices at the sea level.
    const wet = all.find((u) => u.heights.some((h) => h <= 0));
    expect(wet).toBeDefined();
    const m = meshLod(wet as LodUnit, 'desktop');
    const t = m.objects.find((o) => o.kind === 'terrain');
    const ys = new Set<number>();
    const verts = 65;
    for (let i = 0; i < verts * verts; i++) ys.add(Math.round((t?.positions[i * 3 + 1] as number) * 100) / 100);
    expect(ys.has(Math.round(MESHER.lod.waterLevelM * 100) / 100)).toBe(true);
    // The first skirt vertex is a copy of post 0 dropped by skirtM.
    const first = t?.positions[1] as number;
    const skirt = t?.positions[(verts * verts) * 3 + 1] as number;
    expect(first - skirt).toBeCloseTo(MESHER.lod.skirtM, 3);
  });
});

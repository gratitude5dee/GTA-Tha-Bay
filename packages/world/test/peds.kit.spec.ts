/** M10d4 AC-6: the pedestrian kit built on mock asset bytes (the committed mobile variants). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { BufferAttribute, SkinnedMesh } from 'three/webgpu';
import { PED_ASSETS, PED_BODIES, PED_PALETTE } from '../src/sim/peds/components.ts';
import { loadPedKit, PED_ART, type PedKitAssets } from '../src/client/peds/kit.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const bytesOf = (ref: string, variant = 'mobile'): Uint8Array => {
  const [kind, id] = ref.split('/') as [string, string];
  return new Uint8Array(readFileSync(path.join(repo, 'assets/src', kind, id, `${variant}.glb`)));
};
const mock = (variant = 'mobile', edge = 512): PedKitAssets => ({
  bytes: async (ref) => bytesOf(ref, variant),
  image: async () => ({ width: edge, height: edge, source: { width: edge, height: edge } as unknown as ImageBitmap }),
});

describe('config/world/ped-art.json', () => {
  it('validates against its schema and maps every sim key of PED_ASSETS to a body and a far figure', () => {
    const schema = JSON.parse(readFileSync(path.join(repo, 'config/schemas/ped-art.schema.json'), 'utf8')) as object;
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
    expect(validate(PED_ART), JSON.stringify(validate.errors)).toBe(true);
    expect(Object.keys(PED_ART.bodies)).toEqual([...PED_ASSETS]);
    expect(PED_BODIES).toBe(8);
    expect(PED_ART.outfits).toHaveLength(PED_PALETTE.length);
  });
});

describe('loadPedKit', () => {
  it('builds a near ped as one SkinnedMesh with one material, the palette on the garments and the skin tone on the skin', async () => {
    const kit = await loadPedKit(mock());
    expect(kit).not.toBeNull();
    const k = kit as NonNullable<typeof kit>;
    const a = k.near(PED_ASSETS[0] as string, 2, 0xcc2222, 1);
    const meshes: SkinnedMesh[] = [];
    a.root.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
    });
    expect(meshes).toHaveLength(1);
    expect(Array.isArray(a.mesh.material)).toBe(false);
    expect(a.mesh.skeleton.bones).toHaveLength(22);
    expect(a.bones.size).toBe(22);
    // the colour attribute: some vertices are the skin tone, some the palette colour, and a repaint moves only the garments
    const col = a.mesh.geometry.getAttribute('color') as BufferAttribute;
    const first = (i: number): string => `${col.getX(i).toFixed(3)},${col.getY(i).toFixed(3)},${col.getZ(i).toFixed(3)}`;
    const before = new Set(Array.from({ length: col.count }, (_, i) => first(i)));
    a.setTint(0x2222cc);
    const after = new Set(Array.from({ length: col.count }, (_, i) => first(i)));
    expect(before.size).toBeGreaterThan(3);
    expect([...before].some((c) => !after.has(c))).toBe(true);
    expect([...after].some((c) => before.has(c))).toBe(true);
    // two skin tones give two different figures
    const b = k.near(PED_ASSETS[0] as string, 2, 0xcc2222, 4);
    const colB = b.mesh.geometry.getAttribute('color') as BufferAttribute;
    let differs = 0;
    for (let i = 0; i < col.count; i++) if (Math.abs(colB.getX(i) - (a.mesh.geometry.getAttribute('color') as BufferAttribute).getX(i)) > 1e-4) differs++;
    expect(differs).toBeGreaterThan(0);
    k.dispose();
  });

  it('gives every body a far figure of at most 300 triangles with the gait attributes and the skin marker', async () => {
    const kit = (await loadPedKit(mock('desktop'))) as NonNullable<Awaited<ReturnType<typeof loadPedKit>>>;
    expect(kit.keys).toHaveLength(8);
    for (const key of kit.keys) {
      const g = kit.far(key);
      expect((g.getIndex()?.count ?? 0) / 3).toBeLessThanOrEqual(300);
      expect(g.getAttribute('aSwing').count).toBe(g.getAttribute('position').count);
      expect(g.getAttribute('aPivot').count).toBe(g.getAttribute('position').count);
      const col = g.getAttribute('color');
      let skin = 0, cloth = 0;
      for (let i = 0; i < col.count; i++) {
        if (col.getZ(i) === 0) skin++;
        else cloth++;
      }
      expect(skin).toBeGreaterThan(0);
      expect(cloth).toBeGreaterThan(0);
    }
    expect(kit.far(kit.keys[0] as string)).toBe(kit.far(kit.keys[0] as string));
    kit.dispose();
  });

  it('reports the art block: near and far kit, the bodies, the placeholder clips and the atlas bytes within the table of each profile', async () => {
    const limit = PED_ART.limits.textureMegabytes;
    const cases: [string, number, number][] = [['desktop', 1024, limit.full], ['mobile', 512, limit.lite], ['mobile-low', 256, limit.min]];
    for (const [variant, edge, mb] of cases) {
      const kit = (await loadPedKit(mock(variant, edge))) as NonNullable<Awaited<ReturnType<typeof loadPedKit>>>;
      const info = kit.info();
      expect(info.near).toBe('kit');
      expect(info.far).toBe('kit');
      expect(info.bodies).toBe(8);
      expect(info.clips).toBe('placeholder');
      expect(info.textureBytes).toBeGreaterThan(0);
      expect(info.textureBytes / (1024 * 1024), variant).toBeLessThanOrEqual(mb);
      kit.dispose();
    }
  });

  it('falls back (null, so the mannequin stays) when any asset fails to load or is not a people GLB', async () => {
    const failing: PedKitAssets = { bytes: async (ref) => { if (ref.endsWith('ped.outfit.07')) throw new Error('404'); return bytesOf(ref); } };
    expect(await loadPedKit(failing)).toBeNull();
    const garbage: PedKitAssets = { bytes: async () => new Uint8Array(64) };
    expect(await loadPedKit(garbage)).toBeNull();
  });

  it('draws without the atlas when it cannot be had (one material, no map)', async () => {
    const kit = (await loadPedKit({ bytes: async (ref) => bytesOf(ref), image: async () => null })) as NonNullable<Awaited<ReturnType<typeof loadPedKit>>>;
    expect(kit.info().textureBytes).toBe(0);
    const f = kit.near(PED_ASSETS[3] as string, 11, 0x33aa55, 0);
    expect((f.mesh.material as { map: unknown }).map).toBeNull();
    kit.dispose();
  });
});

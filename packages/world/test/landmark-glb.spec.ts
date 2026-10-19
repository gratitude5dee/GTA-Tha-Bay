/**
 * M02d1: the runtime reader of the landmark `.glb` files reads every committed model: the triangle count equals the VariantStats of
 * its asset.json, the buffers are sane, and a file the recipes did not write is refused.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LandmarkGlbError, landmarkTransferList, readLandmarkGlb } from '../src/client/chunks/landmark-glb.ts';

const root = new URL('../../../assets/src/building/', import.meta.url);
const ids = readdirSync(root).filter((n) => n.startsWith('lm.')).sort();

describe('landmark glb reader', () => {
  it('finds the twelve committed landmark assets', () => {
    expect(ids).toHaveLength(12);
  });

  it.each(ids)('%s: all three fidelities read, with the recorded triangle counts and sane buffers', async (id) => {
    const spec = JSON.parse(readFileSync(new URL(`${id}/asset.json`, root), 'utf8')) as { variants: Record<string, string>; stats: Record<string, { tris: number; verts: number; primitives: number }> };
    for (const variant of ['desktop', 'mobile', 'mobile-low']) {
      const bytes = readFileSync(new URL(`${id}/${variant}.glb`, root));
      const m = await readLandmarkGlb(new Uint8Array(bytes));
      const stats = spec.stats[variant]!;
      expect(m.id).toBe(id);
      expect(m.triangles, `${id} ${variant}`).toBe(stats.tris);
      expect(m.vertices).toBe(stats.verts);
      expect(m.primitives).toHaveLength(stats.primitives);
      for (const p of m.primitives) {
        expect(p.positions.length).toBe(p.normals.length);
        expect(p.positions.length).toBe(p.colors.length);
        expect(Math.max(...p.indices)).toBeLessThan(p.positions.length / 3);
        for (let i = 0; i < p.colors.length; i++) {
          expect(p.colors[i]).toBeGreaterThanOrEqual(0);
          expect(p.colors[i]).toBeLessThanOrEqual(1);
        }
        for (let i = 0; i < p.normals.length; i += 3) {
          const l = Math.hypot(p.normals[i]!, p.normals[i + 1]!, p.normals[i + 2]!);
          expect(l).toBeGreaterThan(0.99);
          expect(l).toBeLessThan(1.01);
        }
      }
      expect(m.bounds.every(Number.isFinite)).toBe(true);
      expect(['ground', 'sea']).toContain(m.anchor);
    }
  });

  it('the bridges are anchored to the sea, the rest to the ground, and the models stand on y = -10 or above', async () => {
    const anchor = async (id: string): Promise<string> => (await readLandmarkGlb(new Uint8Array(readFileSync(new URL(`${id}/mobile-low.glb`, root))))).anchor;
    expect(await anchor('lm.golden-gate-bridge')).toBe('sea');
    expect(await anchor('lm.bay-bridge-ybi')).toBe('sea');
    expect(await anchor('lm.city-hall')).toBe('ground');
    const m = await readLandmarkGlb(new Uint8Array(readFileSync(new URL('lm.coit-tower/desktop.glb', root))));
    expect(m.bounds[1]).toBeGreaterThanOrEqual(-10);
    expect(m.bounds[4]).toBeGreaterThan(55);
    expect(landmarkTransferList(m).length).toBeGreaterThan(0);
  });

  it('refuses a file that is not a landmark glb', async () => {
    await expect(readLandmarkGlb(new Uint8Array(40))).rejects.toBeInstanceOf(LandmarkGlbError);
    const bytes = new Uint8Array(readFileSync(new URL('lm.coit-tower/mobile.glb', root)));
    bytes[0] = 0;
    await expect(readLandmarkGlb(bytes)).rejects.toBeInstanceOf(LandmarkGlbError);
  });
});

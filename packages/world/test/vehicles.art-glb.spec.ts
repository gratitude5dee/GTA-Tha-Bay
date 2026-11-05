/**
 * M10d1: the reader of the vehicle and prop `.glb` files (`vehicles/art-glb.ts`): the committed files of the 24 assets decode, carry the
 * part attribute and the C07 node names, are turned to -Z forward, and a file the recipes did not write is refused.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PART } from '@dv/shared';
import { artNodeWorld, findArtNode, walkArt } from '@dv/engine/client/vehicle/art-model';
import { ART_REFS } from '@dv/engine/client/vehicle/art-model';
import { ArtGlbError, readArtGlb } from '../src/client/vehicles/art-glb.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const file = (ref: string, variant: 'desktop' | 'mobile' | 'mobile-low'): Uint8Array => readFileSync(path.join(root, 'assets/src', ref, `${variant}.glb`));

describe('readArtGlb', () => {
  it('decodes the committed variants of every art asset with parts, colours and indices', async () => {
    for (const ref of ART_REFS) {
      for (const v of ['desktop', 'mobile', 'mobile-low'] as const) {
        const m = await readArtGlb(file(ref, v));
        expect(m.ref, `${ref} ${v}`).toBe(ref);
        expect(m.triangles).toBeGreaterThan(0);
        walkArt(m, (n) => {
          for (const p of n.primitives) {
            const verts = p.positions.length / 3;
            expect(p.normals.length).toBe(verts * 3);
            expect(p.colors.length).toBe(verts * 3);
            expect(p.parts.length).toBe(verts);
            expect(Math.max(...p.indices)).toBeLessThan(verts);
          }
        });
      }
    }
  }, 120_000);

  it('turns the model to -Z forward: the front wheels have the smaller z, and the left wheel the smaller x', async () => {
    const m = await readArtGlb(file('vehicle/traffic.sedan', 'desktop'));
    const fl = artNodeWorld(m, 'wheel_fl') as [number, number, number];
    const rl = artNodeWorld(m, 'wheel_rl') as [number, number, number];
    const fr = artNodeWorld(m, 'wheel_fr') as [number, number, number];
    expect(fl[2]).toBeLessThan(rl[2]);
    expect(fl[0]).toBeLessThan(fr[0]);
    expect(fl[1]).toBeCloseTo(0.32, 2);
    const unflipped = await readArtGlb(file('vehicle/traffic.sedan', 'desktop'), { flip: false });
    const ufl = artNodeWorld(unflipped, 'wheel_fl') as [number, number, number];
    expect(ufl[2]).toBeCloseTo(-fl[2], 5);
    expect(ufl[0]).toBeCloseTo(-fl[0], 5);
  });

  it('keeps the part ids of the lamps and the glass, the collider out of the bounds and the make in the extras', async () => {
    const m = await readArtGlb(file('vehicle/police.cruiser', 'desktop'));
    const seen = new Set<number>();
    walkArt(m, (n) => {
      if (n.name === 'collider_hull') return;
      for (const p of n.primitives) for (const v of p.parts) seen.add(v);
    });
    for (const part of [PART.paint, PART.glass, PART.lampHead, PART.lampBrake, PART.sirenRed, PART.sirenBlue, PART.tyre, PART.rim]) expect(seen.has(part)).toBe(true);
    expect(findArtNode(m, 'collider_hull')?.primitives[0]?.positions.length).toBeLessThanOrEqual(64 * 3);
    expect(m.extras['fictionalMake']).toBeTruthy();
    // the bounds are the car's body: about 5 m long, under 2 m high, standing on y = 0
    expect(m.bounds[5] - m.bounds[2]).toBeGreaterThan(4.8);
    expect(m.bounds[4] - m.bounds[1]).toBeLessThan(2);
    expect(m.bounds[1]).toBeCloseTo(0, 2);
  });

  it('refuses a file that is not a glTF binary, one that is too short and one with a rotated node', async () => {
    await expect(readArtGlb(new Uint8Array(40))).rejects.toBeInstanceOf(ArtGlbError);
    await expect(readArtGlb(new Uint8Array(4))).rejects.toBeInstanceOf(ArtGlbError);
    // a glb whose JSON gives a node a rotation
    const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'x', rotation: [0, 1, 0, 0] }] });
    const pad = (4 - (json.length % 4)) % 4;
    const body = new TextEncoder().encode(json + ' '.repeat(pad));
    const out = new Uint8Array(12 + 8 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, out.length, true);
    dv.setUint32(12, body.length, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(body, 20);
    await expect(readArtGlb(out)).rejects.toThrow(/rotation or a scale/);
  });
});

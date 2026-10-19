/**
 * AC-2 (upload gate): the gate never releases two chunks in one frame or more than 2 MB on `mobile-low`, highest priority first.
 * The chunk renderer on top of it uploads one unit per frame, re-records a bundle only on a swap (`bundleRerecords`, DL-682),
 * hides the cells of a coarse unit whose finer unit is resident and has faded in, and brings every unit back one per frame after a
 * GPU loss. Node only: three's scene objects, no renderer.
 */
import { readFileSync } from 'node:fs';
import { decodeL0, decodeP0, type ChunkKey } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { ChunkRenderer } from '../src/client/chunks/chunk-renderer.ts';
import { createWorldMaterials } from '../src/client/chunks/materials.ts';
import { meshChunk } from '../src/client/chunks/mesher.ts';
import type { UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { ChunkUploadGate } from '../src/client/chunks/upload-gate.ts';
import { basePlan } from '../src/sim/streaming/plan.ts';
import { Group } from 'three/webgpu';

describe('ChunkUploadGate', () => {
  it('releases at most one item per frame, highest priority first, ties by arrival', () => {
    const g = new ChunkUploadGate<string>(null);
    g.enqueue({ id: 'a', priority: 5, bytes: 10, payload: 'a' });
    g.enqueue({ id: 'b', priority: 1, bytes: 10, payload: 'b' });
    g.enqueue({ id: 'c', priority: 1, bytes: 10, payload: 'c' });
    expect(g.release(1)?.id).toBe('b');
    expect(g.release(1)).toBeNull();
    expect(g.release(2)?.id).toBe('c');
    expect(g.release(3)?.id).toBe('a');
    expect(g.release(4)).toBeNull();
    expect(g.stats.maxPerFrame).toBe(1);
    expect(g.stats.released).toBe(3);
  });

  it('never releases more than the byte cap in a frame on a capped tier, and skips an item that does not fit for one that does', () => {
    const cap = basePlan('mobile-low').uploadBytes as number;
    expect(cap).toBe(2 * 1024 * 1024);
    const g = new ChunkUploadGate<string>(cap);
    g.enqueue({ id: 'big', priority: 0, bytes: cap + 1, payload: 'big' });
    g.enqueue({ id: 'small', priority: 9, bytes: 1000, payload: 'small' });
    const first = g.release(1);
    expect(first?.id).toBe('small');
    expect(first?.bytes).toBeLessThanOrEqual(cap);
    // Only the oversize item is left: it goes alone (and is counted), never together with another.
    const second = g.release(2);
    expect(second?.id).toBe('big');
    expect(g.stats.oversize).toBe(1);
    expect(g.stats.maxPerFrame).toBe(1);
  });

  it('replaces an item queued twice and drops a removed one', () => {
    const g = new ChunkUploadGate<number>(null);
    g.enqueue({ id: 'x', priority: 3, bytes: 1, payload: 1 });
    g.enqueue({ id: 'x', priority: 2, bytes: 1, payload: 2 });
    expect(g.size).toBe(1);
    expect(g.remove('x')).toBe(true);
    expect(g.release(1)).toBeNull();
  });
});

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/world/civic-graybox/${name}`, import.meta.url)));
const sim = decodeP0(fixture('p0-64-64.pack'));
const render = decodeL0(fixture('l0-64-64.pack'), sim);
const meshOf = (key: ChunkKey): UnitMesh => {
  const s = sim.find((c) => c.key === key);
  if (!s) throw new Error(`fixture has no ${key}`);
  return meshChunk(s, render.find((r) => r.key === key) ?? null, { tier: 'mobile-low', distM: 0, maxBytes: basePlan('mobile-low').uploadBytes });
};

/** A coarse stand-in over the same terrain: an L1 unit that covers the fixture chunks, built by relabelling a chunk mesh. */
const asL1 = (m: UnitMesh, key: ChunkKey, ox: number, oz: number): UnitMesh => ({ ...m, level: 'l1', key, originX: ox, originZ: oz });

function makeRenderer(fade = 0): { r: ChunkRenderer; parent: Group } {
  const parent = new Group();
  const r = new ChunkRenderer({ parent, materials: createWorldMaterials({ fadeSeconds: fade }), uploadBytes: basePlan('mobile-low').uploadBytes, fadeSeconds: fade });
  return { r, parent };
}
const cam = { pos: [0, 30, 0] as [number, number, number], dir: [0, 0, -1] as [number, number, number] };

describe('ChunkRenderer', () => {
  it('uploads one unit per frame, at most six objects each, and never more than 2 MB in a frame on mobile-low', () => {
    const { r } = makeRenderer();
    const keys = sim.map((c) => c.key);
    keys.forEach((k, i) => r.enqueue(meshOf(k), i));
    let frames = 0;
    while (r.gate.size > 0 && frames < 50) {
      frames++;
      r.update(frames / 60, cam);
      expect(r.uploadsThisFrame).toBeLessThanOrEqual(1);
    }
    expect(r.units.size).toBe(keys.length);
    expect(r.maxUploadsInFrame).toBe(1);
    expect(r.gate.stats.maxBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(r.gate.stats.oversize).toBe(0);
    for (const u of r.units.values()) expect(u.objects).toBeLessThanOrEqual(6);
    for (const u of r.units.values()) expect((u.group as unknown as { static: boolean }).static).toBe(true);
  });

  it('re-records a bundle only on a swap: idle frames change no counter, a cover change and a re-mesh each add one request', () => {
    const { r } = makeRenderer(0);
    const [k0] = sim.map((c) => c.key);
    const l0 = meshOf(k0 as ChunkKey);
    // An L1 tile that contains chunk 9/254/254 .. (x/4 = 63, y/4 = 63) is 7/63/63; relabel for the test.
    const l1 = asL1(l0, '7/64/64' as ChunkKey, -128, -128);
    r.enqueue(l1, 0);
    r.update(0.0, cam);
    expect(r.bundleRerecords()['l1:7/64/64']).toBe(0);
    for (let f = 1; f <= 30; f++) r.update(f / 60, cam);
    expect(r.bundleRerecords()['l1:7/64/64']).toBe(0);
    // A resident L0 child inside the tile (9/256/256 -> tile 7/64/64) covers its cell once faded in (fade 0: at once).
    r.enqueue({ ...l0, key: '9/256/256' as ChunkKey }, 0);
    r.update(1, cam);
    r.update(1.1, cam);
    expect(r.bundleRerecords()['l1:7/64/64']).toBe(1);
    const tile = r.units.get('l1:7/64/64');
    expect(tile?.mask).toBe(1 << 0);
    for (let f = 0; f < 20; f++) r.update(1.2 + f / 60, cam);
    expect(r.bundleRerecords()['l1:7/64/64']).toBe(1);
    // Evicting the child clears the cell: one more request.
    r.drop('l0', '9/256/256' as ChunkKey);
    r.update(2, cam);
    expect(tile?.mask).toBe(0);
    expect(r.bundleRerecords()['l1:7/64/64']).toBe(2);
    // Meshing a unit again is a swap too.
    r.enqueue({ ...l0, key: '9/257/256' as ChunkKey }, 0);
    r.update(3, cam);
    r.enqueue({ ...l0, key: '9/257/256' as ChunkKey }, 0);
    r.update(4, cam);
    expect(r.bundleRerecords()['l0:9/257/256']).toBe(1);
  });

  it('a cover mask waits until the child has faded in (0.5 s) before the parent hides the cell', () => {
    const { r } = makeRenderer(0.5);
    const l0 = meshOf(sim[0]?.key as ChunkKey);
    r.enqueue(asL1(l0, '7/64/64' as ChunkKey, -128, -128), 0);
    r.update(0, cam);
    r.enqueue({ ...l0, key: '9/257/257' as ChunkKey }, 0);
    r.update(0.1, cam);
    expect(r.units.get('l1:7/64/64')?.mask).toBe(0);
    r.update(0.4, cam);
    expect(r.units.get('l1:7/64/64')?.mask).toBe(0);
    r.update(0.7, cam);
    // 9/257/257: cell (257 mod 4 = 1, 257 mod 4 = 1) of the tile.
    expect(r.units.get('l1:7/64/64')?.mask).toBe(1 << (1 * 4 + 1));
  });

  it('hides units behind the camera and keeps the others; rebuilds every unit one per frame after a GPU loss, without a refetch', async () => {
    const { r } = makeRenderer();
    const l0 = meshOf(sim[0]?.key as ChunkKey);
    r.enqueue({ ...l0, key: '9/256/250' as ChunkKey, originX: 0, originZ: -1500 }, 0);
    r.enqueue({ ...l0, key: '9/256/262' as ChunkKey, originX: 0, originZ: 1500 }, 1);
    r.update(0, cam);
    r.update(0.02, cam);
    for (let f = 0; f < 10; f++) r.update(0.1 + f * 0.02, cam);
    // Camera at the origin looking north (-Z): the unit at z = -1500 is ahead, the one at z = +1500 behind.
    expect(r.units.get('l0:9/256/250')?.group.visible).toBe(true);
    expect(r.units.get('l0:9/256/262')?.group.visible).toBe(false);
    expect(r.cullPasses).toBeGreaterThan(0);
    // A GPU loss: everything hides, then returns one per frame.
    await r.onRendererReplaced(null as never, null);
    expect(r.rebuilding).toBe(2);
    expect([...r.units.values()].every((u) => !u.group.visible)).toBe(true);
    r.update(1, cam);
    expect(r.uploadsThisFrame).toBe(1);
    expect(r.rebuilding).toBe(1);
    r.update(1.02, cam);
    expect(r.rebuilding).toBe(0);
    expect(r.units.size).toBe(2);
  });
});

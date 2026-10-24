/**
 * M02d1 AC-5: the LandmarkLayer against a mock asset client and a scripted camera. Resident landmarks never exceed the tier cap, a
 * landmark loads only inside its tier's swap distance, the farthest is released first, a failed load leaves the proxy meshed, and
 * leaving the swap distance restores the proxy (one remesh per chunk each way, the model removed only when the chunks are back).
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { ChunkKey, QualityTierId } from '@dv/shared';
import { LANDMARKS_RUNTIME, type LandmarkDeps } from '../src/client/chunks/landmark-layer.ts';
import { flush, harness, model, type Harness } from './fixtures/landmark-harness.ts';
import type { LandmarkModelData } from '../src/client/chunks/landmark-glb.ts';
import { chunksHolding, desiredMask, proxyIdOf, sameMask, staleChunks } from '../src/client/chunks/proxy-mask.ts';

const TIERS = Object.keys(LANDMARKS_RUNTIME.tiers) as QualityTierId[];
const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));

const shownIds = (h: Harness): string[] => h.layer.report().resident.filter((r) => r.phase === 'shown').map((r) => r.id).sort();

describe('config/world/landmarks-runtime.json', () => {
  it('validates against its schema and has the caps and swap distances of 02-world-bake.md section 7', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('config/schemas/world-landmarks-runtime.schema.json') as object);
    expect(validate(read('config/world/landmarks-runtime.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
    const caps = Object.fromEntries(TIERS.map((t) => [t, LANDMARKS_RUNTIME.tiers[t].resident]));
    expect(caps).toEqual({ 'desktop-ultra': 8, desktop: 8, 'xr-visionpro': 6, mobile: 4, 'xr-quest': 3, 'mobile-low': 3 });
    const swap = Object.fromEntries(TIERS.map((t) => [t, LANDMARKS_RUNTIME.tiers[t].swapM]));
    expect(swap).toEqual({ 'desktop-ultra': 1200, desktop: 1200, 'xr-visionpro': 900, mobile: 500, 'xr-quest': 400, 'mobile-low': 350 });
  });

  it('agrees with the swapM the bake writes into every landmark record', () => {
    const src = readFileSync(new URL('../../../tools/map/src/stages/s10-places.ts', import.meta.url), 'utf8');
    const m = /const SWAP_M[^=]*=\s*(\{[^}]*\})/.exec(src);
    expect(m).not.toBeNull();
    const baked = JSON.parse((m![1] as string).replace(/(\w[\w-]*)\s*:/g, '"$1":').replace(/'/g, '"').replace(/"([a-z-]+)"\s*:\s*"/g, '"$1":"')) as Record<string, number>;
    for (const t of TIERS) expect(baked[t], t).toBe(LANDMARKS_RUNTIME.tiers[t].swapM);
  });
});

describe('proxy masks (pure)', () => {
  it('desiredMask keeps only the proxies the chunk holds and the shown landmarks ask for', () => {
    expect(desiredMask([3, 5, 9], new Set([5, 9, 12]))).toEqual([5, 9]);
    expect(desiredMask([3], new Set())).toEqual([]);
    expect(sameMask([1, 2], [1, 2])).toBe(true);
    expect(sameMask([1], [1, 2])).toBe(false);
  });

  it('staleChunks lists the chunks whose mesh disagrees, sorted, and skips chunks without proxies', () => {
    const states = [
      { key: '9/2/0' as ChunkKey, proxies: [3], masked: [] },
      { key: '9/1/0' as ChunkKey, proxies: [2], masked: [2] },
      { key: '9/0/0' as ChunkKey, proxies: [], masked: [] },
      { key: '9/3/0' as ChunkKey, proxies: [4], masked: [4] },
    ];
    expect(staleChunks(states, new Set([3, 4]))).toEqual([
      { key: '9/1/0', mask: [] },
      { key: '9/2/0', mask: [3] },
    ]);
    expect(chunksHolding(states, 4)).toEqual(['9/3/0']);
  });
});

describe('LandmarkLayer', () => {
  it.each(TIERS)('%s: resident landmarks never exceed the tier cap, and the cap is reached', async (tier) => {
    const cap = LANDMARKS_RUNTIME.tiers[tier].resident;
    const h = harness(tier, Array.from({ length: cap + 4 }, (_, i) => i * 10), { auto: true });
    await h.step(0, 40);
    const r = h.layer.report();
    expect(r.cap).toBe(cap);
    expect(r.maxResident).toBe(cap);
    expect(r.resident.length).toBeLessThanOrEqual(cap);
    expect(shownIds(h)).toHaveLength(cap);
    // nearest first: the landmarks at x = 0, 10, 20, ...
    expect(shownIds(h)).toEqual(Array.from({ length: cap }, (_, i) => `lm.s${i}`).sort());
  });

  it.each(TIERS)('%s: a landmark loads only inside its swap distance', async (tier) => {
    const swap = LANDMARKS_RUNTIME.tiers[tier].swapM;
    const h = harness(tier, [swap + 1, swap + 40, swap - 1], { auto: true });
    await h.step(0, 20);
    expect(h.loads).toEqual(['lm.s2']);
    expect(shownIds(h)).toEqual(['lm.s2']);
    // nothing outside the swap distance is ever asked for, however long the camera waits
    await h.step(0, 40);
    expect(h.loads).toEqual(['lm.s2']);
    // walking toward the nearest of the others brings it in once it is inside
    await h.step(40, 20);
    expect(h.loads).toContain('lm.s0');
  });

  it('releases the farthest landmark first, and only for a nearer one', async () => {
    const h = harness('mobile-low', [0, 100, 200, 300, 400], { auto: true });
    await h.step(400, 30);
    // x = 400: the landmarks at 400, 300 and 200 fill the cap of three; 100 is farther than all of them and does not displace one
    expect(shownIds(h)).toEqual(['lm.s2', 'lm.s3', 'lm.s4']);
    expect(h.disposed).toEqual([]);
    await h.step(0, 80);
    // x = 0: the far ones (400, then 300) go first; the near ones (0, 100) come in; 200 stays
    expect(h.disposed).toEqual(['lm.s4', 'lm.s3']);
    expect(shownIds(h)).toEqual(['lm.s0', 'lm.s1', 'lm.s2']);
    expect(h.layer.report().maxResident).toBe(3);
  });

  it('a failed load leaves the proxy meshed, is reported, and is tried again after retryMs', async () => {
    const h = harness('desktop', [10, 20], { auto: true });
    h.fail.add('lm.s0');
    await h.step(0, 20);
    expect(h.layer.report().failed.map((f) => f.id)).toEqual(['lm.s0']);
    expect(shownIds(h)).toEqual(['lm.s1']);
    // the failed landmark's proxy was never masked
    expect(h.remeshes.every((r) => !r.mask.includes(proxyIdOf(0)))).toBe(true);
    expect(h.chunks.get('9/0/0' as ChunkKey)!.masked).toEqual([]);
    const loadsBefore = h.loads.filter((x) => x === 'lm.s0').length;
    await h.step(0, 30);
    expect(h.loads.filter((x) => x === 'lm.s0').length).toBe(loadsBefore);
    h.fail.clear();
    h.clock.ms += LANDMARKS_RUNTIME.retryMs + 100;
    await h.step(0, 20);
    expect(shownIds(h)).toEqual(['lm.s0', 'lm.s1']);
    expect(h.chunks.get('9/0/0' as ChunkKey)!.masked).toEqual([proxyIdOf(0)]);
  });

  it('masks the chunks that hold its proxies with one remesh each, and counts one re-record each', async () => {
    const h = harness('mobile', [10], { auto: false });
    // a second chunk holds a second footprint of the same landmark
    h.chunks.set('9/7/7' as ChunkKey, { proxies: [proxyIdOf(0)], masked: [], rerecords: 0 });
    await h.step(0, 10);
    expect(h.remeshes.map((r) => [r.key, r.mask])).toEqual([['9/0/0', [1]], ['9/7/7', [1]]]);
    h.settle();
    await h.step(0, 20);
    // nothing more is asked once the chunks carry the mask
    expect(h.remeshes).toHaveLength(2);
    expect([...h.chunks.values()].map((c) => c.rerecords)).toEqual([1, 1]);
    const rep = h.layer.report().resident[0]!;
    expect(rep.chunks).toEqual([{ key: '9/0/0', masked: true, bundleRerecords: 1 }, { key: '9/7/7', masked: true, bundleRerecords: 1 }]);
  });

  it('a chunk that comes up after the landmark is masked when it arrives', async () => {
    const h = harness('mobile', [10], { auto: true });
    h.chunks.set('9/5/5' as ChunkKey, { proxies: [proxyIdOf(0)], masked: [], rerecords: 0 });
    const late = h.chunks.get('9/5/5' as ChunkKey)!;
    h.chunks.delete('9/5/5' as ChunkKey);
    await h.step(0, 20);
    h.chunks.set('9/5/5' as ChunkKey, late);
    await h.step(0, 10);
    expect(late.masked).toEqual([1]);
    expect(late.rerecords).toBe(1);
  });

  it('leaving the swap distance meshes the proxies back first and removes the model only when the chunks are back', async () => {
    const swap = LANDMARKS_RUNTIME.tiers.mobile.swapM;
    const h = harness('mobile', [0], { auto: false });
    await h.step(0, 10);
    h.settle();
    await h.step(0, 5);
    expect(h.mounted).toEqual(['lm.s0']);
    expect(h.chunks.get('9/0/0' as ChunkKey)!.masked).toEqual([1]);
    // inside the hysteresis band nothing changes
    await h.step(swap * 1.02, 10);
    expect(h.layer.report().resident[0]?.phase).toBe('shown');
    // beyond swapM x unloadFactor: the proxy is asked back, the model stays until it is
    await h.step(swap * 1.2, 10);
    expect(h.remeshes.at(-1)).toEqual({ key: '9/0/0', mask: [] });
    expect(h.layer.report().resident[0]?.phase).toBe('leaving');
    expect(h.disposed).toEqual([]);
    h.settle();
    await h.step(swap * 1.2, 5);
    expect(h.disposed).toEqual(['lm.s0']);
    expect(h.layer.report().resident).toEqual([]);
    expect(h.chunks.get('9/0/0' as ChunkKey)!.masked).toEqual([]);
    expect(h.chunks.get('9/0/0' as ChunkKey)!.rerecords).toBe(2);
    // coming back loads it again
    await h.step(0, 10);
    expect(h.loads).toEqual(['lm.s0', 'lm.s0']);
  });

  it('a landmark that is released before its chunks answer is removed after the timeout, not held forever', async () => {
    const swap = LANDMARKS_RUNTIME.tiers.mobile.swapM;
    const h = harness('mobile', [0], { auto: false });
    await h.step(0, 10);
    h.settle();
    await h.step(swap * 2, 5);
    expect(h.layer.report().resident[0]?.phase).toBe('leaving');
    h.clock.ms += 3000;
    await h.step(swap * 2, 2);
    expect(h.disposed).toEqual(['lm.s0']);
  });

  it('coming back inside the swap distance while leaving keeps the model', async () => {
    const swap = LANDMARKS_RUNTIME.tiers.mobile.swapM;
    const h = harness('mobile', [0], { auto: false });
    await h.step(0, 10);
    h.settle();
    await h.step(swap * 1.2, 3);
    expect(h.layer.report().resident[0]?.phase).toBe('leaving');
    await h.step(swap * 0.5, 3);
    expect(h.layer.report().resident[0]?.phase).toBe('shown');
    expect(h.disposed).toEqual([]);
  });

  it('waits for the ground under a ground-anchored model, but not for a sea-anchored one', async () => {
    const h = harness('desktop', [0, 50], { auto: true, seaIds: ['lm.s1'] });
    h.ground.ready = false;
    await h.step(0, 10);
    // the sea-anchored model (lm.s1) needs no terrain; the ground-anchored one (lm.s0) waits
    expect(h.mounted).toEqual(['lm.s1']);
    h.ground.ready = true;
    await h.step(0, 10);
    expect(h.mounted).toContain('lm.s0');
    const sea = harness('desktop', [0], { auto: true, seaIds: ['lm.s0'] });
    sea.ground.ready = false;
    await sea.step(0, 10);
    expect(sea.mounted).toEqual(['lm.s0']);
  });

  it('a landmark that leaves range while it is still loading is dropped, and its late model is not mounted', async () => {
    const h = harness('mobile', [0], { auto: true });
    let release!: () => void;
    const slow = new Promise<LandmarkModelData>((res) => {
      release = () => res(model('lm.s0'));
    });
    (h.layer as unknown as { o: LandmarkDeps }).o.load = (): Promise<LandmarkModelData> => slow;
    h.layer.update({ x: 0, z: 0 }, 1);
    h.layer.update({ x: 5000, z: 0 }, 1.1);
    release();
    await flush();
    h.layer.update({ x: 5000, z: 0 }, 1.2);
    expect(h.mounted).toEqual([]);
    expect(h.layer.report().resident).toEqual([]);
  });

  it('reports the objects and triangles of the mounted models, and disposes them with the layer', async () => {
    const h = harness('desktop', [0, 10, 20], { auto: true });
    await h.step(0, 30);
    expect(h.layer.budget()).toEqual({ objects: 9, triangles: 300 });
    h.layer.dispose();
    expect(h.disposed.sort()).toEqual(['lm.s0', 'lm.s1', 'lm.s2']);
  });
});

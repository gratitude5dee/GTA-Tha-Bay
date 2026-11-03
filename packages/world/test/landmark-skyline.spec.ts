/**
 * M02d2 AC-5: the always-resident skyline set of the LandmarkLayer, and the staged swap commit. A mock asset client per tier and a
 * scripted camera: the seven skyline landmarks are resident at `lo` within the building draw distance regardless of the tier cap, a
 * skyline landmark that becomes resident at full fidelity hides its skyline instance, the cap still limits full-fidelity landmarks,
 * and a swap never leaves a frame with neither the proxy nor the model.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChunkKey, QualityTierId } from '@dv/shared';
import { LANDMARKS_RUNTIME } from '../src/client/chunks/landmark-layer.ts';
import { proxyIdOf } from '../src/client/chunks/proxy-mask.ts';
import { inSkylineRange, nextSkylineLoad, skylineRings } from '../src/client/chunks/skyline.ts';
import { flush, harness, type Harness } from './fixtures/landmark-harness.ts';

const TIERS = Object.keys(LANDMARKS_RUNTIME.tiers) as QualityTierId[];
const R2: Record<QualityTierId, number> = { 'desktop-ultra': 8200, desktop: 8200, 'xr-visionpro': 3000, mobile: 2500, 'xr-quest': 1500, 'mobile-low': 1500 };
const SEVEN = ['lm.golden-gate-bridge', 'lm.bay-bridge-ybi', 'lm.sutro-tower', 'lm.crown-tower', 'lm.pyramid-tower', 'lm.coit-tower', 'lm.ferry-building'];

/** Landmarks named for the skyline set on a line at the given x positions. */
function skyHarness(tier: QualityTierId, xs: number[], o: { auto?: boolean; qa?: boolean; ids?: string[] } = {}): Harness {
  const ids = o.ids ?? SEVEN.slice(0, xs.length);
  return harness(tier, xs, { auto: o.auto ?? true, qa: o.qa ?? true, ids, skyline: { rangeM: R2[tier], ids } });
}
const skyUp = (h: Harness): string[] => h.layer.report().skyline.entries.filter((e) => e.visible).map((e) => e.id).sort();
const masked = (h: Harness, i: number): boolean => (h.chunks.get(`9/${i}/0` as ChunkKey)?.masked ?? []).includes(proxyIdOf(i));

describe('config/world/landmarks-runtime.json skyline', () => {
  it('names the seven skyline landmarks of 02-world-bake.md section 7 rule 4, with rings that grow outward', () => {
    expect([...LANDMARKS_RUNTIME.skyline.ids].sort()).toEqual([...SEVEN].sort());
    const { loadFactor, mountFactor, releaseFactor } = LANDMARKS_RUNTIME.skyline;
    expect(mountFactor).toBeGreaterThan(1);
    expect(releaseFactor).toBeGreaterThan(mountFactor);
    expect(loadFactor).toBeGreaterThan(mountFactor);
  });

  it('agrees with the skyline flags of content/world/landmarks.json', () => {
    const doc = JSON.parse(readFileSync(new URL('../../../content/world/landmarks.json', import.meta.url), 'utf8')) as { landmarks: { id: string; skyline: boolean }[] };
    expect(doc.landmarks.filter((l) => l.skyline).map((l) => l.id).sort()).toEqual([...SEVEN].sort());
  });
});

describe('skyline rings (pure)', () => {
  const rings = skylineRings(1000, { ids: [], loadFactor: 2, mountFactor: 1.5, releaseFactor: 1.7 });

  it('are factors of the draw distance', () => {
    expect(rings).toEqual({ rangeM: 1000, loadM: 2000, mountM: 1500, releaseM: 1700 });
  });

  it('come in inside the mount ring and go out beyond the release ring: a hysteresis band between', () => {
    expect(inSkylineRange(false, 1499, rings)).toBe(true);
    expect(inSkylineRange(false, 1501, rings)).toBe(false);
    expect(inSkylineRange(true, 1699, rings)).toBe(true);
    expect(inSkylineRange(true, 1701, rings)).toBe(false);
  });

  it('pick the nearest readable landmark inside the load ring, ties by id, a failed one only after its retry time', () => {
    const e = (id: string, distM: number, phase = 'idle', retryAt = 0): { id: string; phase: string; distM: number; retryAt: number } => ({ id, phase, distM, retryAt });
    expect(nextSkylineLoad([e('b', 900), e('a', 900), e('c', 100, 'loading'), e('d', 2100)], rings, 0)?.id).toBe('a');
    expect(nextSkylineLoad([e('d', 2100)], rings, 0)).toBeNull();
    expect(nextSkylineLoad([e('f', 50, 'failed', 500)], rings, 100)).toBeNull();
    expect(nextSkylineLoad([e('f', 50, 'failed', 500)], rings, 600)?.id).toBe('f');
  });
});

describe('the staged swap commit', () => {
  it('waits for the model and every prepared chunk mesh, then joins the scene before any proxy is masked: never a hole', async () => {
    const h = harness('mobile', [10], { auto: false, qa: true });
    h.chunks.set('9/7/7' as ChunkKey, { proxies: [proxyIdOf(0)], masked: [], rerecords: 0 });
    h.hold.on = true;
    await h.step(0, 6);
    // both chunks were asked for a masked mesh in the worker; nothing is drawn differently yet
    expect(h.remeshes.map((r) => [r.key, r.mask, r.staged])).toEqual([['9/0/0', [1], true], ['9/7/7', [1], true]]);
    expect(h.queued).toEqual([]);
    expect(h.mounted).toEqual([]);
    h.releasePrepared();
    await flush();
    await h.step(0, 3);
    // the commit is queued through the gate, ahead of the chunk uploads, and still nothing changed on screen
    expect(h.queued.map((t) => [t.id, t.priority < -1, t.bytes > 0])).toEqual([['full:lm.s0', true, true]]);
    expect(h.mounted).toEqual([]);
    expect([...h.chunks.values()].map((c) => c.masked)).toEqual([[], []]);
    // the gate releases it: the model is up while both proxies are still drawn
    h.runTasks();
    expect(h.mounted).toEqual(['lm.s0']);
    expect([...h.chunks.values()].map((c) => c.masked)).toEqual([[], []]);
    h.layer.update({ x: 0, z: 0 }, 2);
    // the prepared meshes follow, one per frame in the real gate; the proxy goes only after its mesh lands
    h.commit();
    await h.step(0, 4);
    expect([...h.chunks.values()].map((c) => c.masked)).toEqual([[1], [1]]);
    const r = h.layer.report();
    expect(r.frames.holes).toBe(0);
    expect(r.frames.sampled).toBeGreaterThan(0);
    // the log: the model first, then each chunk, every commit one upload, and no commit ever leaves neither a proxy nor a model
    expect(r.swaps.map((e) => [e.step, e.key ?? null])).toEqual([['model', null], ['chunk', '9/0/0'], ['chunk', '9/7/7']]);
    for (const e of r.swaps) {
      expect(e.uploads, e.step).toBeLessThanOrEqual(1);
      expect(e.model || e.proxy, `${e.step} leaves a frame with neither`).toBe(true);
      expect(e.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('a swap cancelled while its meshes are being made never mounts and never masks', async () => {
    const h = harness('mobile', [0], { auto: false });
    h.hold.on = true;
    await h.step(0, 5);
    expect(h.layer.report().resident[0]?.phase).toBe('preparing');
    // out of range before the worker answers
    await h.step(5000, 3);
    expect(h.layer.report().resident).toEqual([]);
    h.releasePrepared();
    await flush();
    await h.step(5000, 3);
    h.settle();
    expect(h.queued).toEqual([]);
    expect(h.mounted).toEqual([]);
    expect(h.chunks.get('9/0/0' as ChunkKey)?.masked).toEqual([]);
  });

  it('a landmark with no resident chunk commits at once, and a chunk that streams in later arrives masked (the mask list)', async () => {
    const h = harness('mobile', [0], { auto: true });
    h.chunks.clear();
    await h.step(0, 6);
    expect(h.mounted).toEqual(['lm.s0']);
    expect(h.layer.maskList()).toEqual([1]);
    expect(h.layer.maskFor([1, 5])).toEqual([1]);
  });

  it('gives up when the chunk meshes never come back: the proxy stays meshed, the failure is reported', async () => {
    const h = harness('mobile', [0], { auto: false });
    h.hold.on = true;
    await h.step(0, 3);
    h.clock.ms += 9000;
    await h.step(0, 2);
    const r = h.layer.report();
    expect(r.failed.map((f) => f.id)).toEqual(['lm.s0']);
    expect(h.mounted).toEqual([]);
    expect(h.chunks.get('9/0/0' as ChunkKey)?.masked).toEqual([]);
  });
});

/**
 * BD-FIX-LANDMARK-PREPARE-01: the swap's 8 s count what the worker did with its prepares, on the worker's own account, never how long a
 * reply waited on a page busy with long frames or a request waited in a busy worker's queue. Every case drives the layer through what
 * a player would see: the failed list, the phase, what is mounted and what is masked.
 */
describe('the staged swap waits on the worker, not on the clock', () => {
  const phases = (h: Harness): string[][] => h.layer.report().resident.map((e) => [e.id, e.phase]);
  const masks = (h: Harness): number[] => h.chunks.get('9/0/0' as ChunkKey)?.masked ?? [];
  /** Lets the gate run the commit and the prepared mesh land, the way the frames after it do. */
  const commitSwap = async (h: Harness): Promise<void> => {
    h.runTasks();
    h.layer.update({ x: 0, z: 0 }, h.clock.ms / 1000);
    h.commit();
    await h.step(0, 4);
  };
  /** After `retryMs` the load is tried again; the frames run the gate as they go. */
  const retry = async (h: Harness): Promise<void> => {
    h.clock.ms += LANDMARKS_RUNTIME.retryMs;
    for (let i = 0; i < 8; i++) {
      await h.step(0, 1);
      h.settle();
    }
  };

  it('a prepared mesh the worker posted that waits on a busy page for 30 s of long frames is taken: the swap commits, nothing is reported failed', async () => {
    const h = harness('mobile', [0], { auto: false, qa: true });
    // the page is busy with frames of 5 s each: what the worker posts waits on it
    h.inbox.on = true;
    await h.step(0, 3);
    expect(phases(h)).toEqual([['lm.s0', 'preparing']]);
    for (let i = 0; i < 6; i++) {
      h.clock.ms += 5000;
      await h.step(0, 1);
    }
    // 30 s after the prepare went out, and the worker answered it at once: nothing is given up
    expect(h.layer.report().failed).toEqual([]);
    expect(phases(h)).toEqual([['lm.s0', 'preparing']]);
    // the page gets to its messages: the prepared mesh first, then the worker's answer about it
    h.drain();
    await flush();
    await h.step(0, 2);
    expect(h.queued.map((t) => t.id)).toEqual(['full:lm.s0']);
    await commitSwap(h);
    const r = h.layer.report();
    expect(r.failed).toEqual([]);
    expect(phases(h)).toEqual([['lm.s0', 'shown']]);
    expect(h.mounted).toEqual(['lm.s0']);
    // one load and one prepare: nothing was retried
    expect(h.loads).toEqual(['lm.s0']);
    expect(h.remeshes.filter((m) => m.staged).length).toBe(1);
    expect(masks(h)).toEqual([1]);
    expect(r.frames.holes).toBe(0);
  });

  it('a prepare a busy worker took up late and is still reading when asked is not lost: the swap waits for it and commits', async () => {
    const h = harness('mobile', [0], { auto: false, qa: true });
    // the worker's queue holds earlier work, so the prepare waits there; once taken up, its read of the store is slow
    h.worker.busy = true;
    h.hold.on = true;
    await h.step(0, 3);
    h.clock.ms += 9000;
    // past the time: the layer asks the worker, and the question waits in the worker's queue behind the prepare
    await h.step(0, 2);
    expect(h.layer.report().failed).toEqual([]);
    // the worker gets to its queue: it takes the prepare up (the read starts) and then answers that it holds it
    h.worker.run();
    await flush();
    await h.step(0, 2);
    expect(h.layer.report().failed).toEqual([]);
    expect(phases(h)).toEqual([['lm.s0', 'preparing']]);
    // the read takes 5 s of the worker's clock, within the limit
    h.clock.ms += 5000;
    await h.step(0, 2);
    expect(h.layer.report().failed).toEqual([]);
    h.releasePrepared();
    await flush();
    await h.step(0, 2);
    expect(h.queued.map((t) => t.id)).toEqual(['full:lm.s0']);
    await commitSwap(h);
    expect(h.layer.report().failed).toEqual([]);
    expect(phases(h)).toEqual([['lm.s0', 'shown']]);
    expect(h.mounted).toEqual(['lm.s0']);
    expect(h.loads).toEqual(['lm.s0']);
    expect(h.remeshes.filter((m) => m.staged).length).toBe(1);
    expect(masks(h)).toEqual([1]);
  });

  it('a prepared mesh lost on its way is given up once the worker answers that it no longer holds it, even on a busy page, and the load is tried again', async () => {
    const h = harness('mobile', [0], { auto: false });
    // the worker answers the prepare, but its reply never reaches the page; and the page is busy
    h.worker.lose = true;
    h.inbox.on = true;
    await h.step(0, 3);
    for (let i = 0; i < 4; i++) {
      h.clock.ms += 3000;
      await h.step(0, 1);
    }
    // 12 s on, the worker's answer still waits on the page: nothing is known yet, nothing is given up
    expect(h.layer.report().failed).toEqual([]);
    expect(phases(h)).toEqual([['lm.s0', 'preparing']]);
    h.drain();
    await flush();
    await h.step(0, 1);
    expect(h.layer.report().failed).toEqual([{ id: 'lm.s0', error: 'the chunk meshes did not come back' }]);
    expect(h.mounted).toEqual([]);
    expect(masks(h)).toEqual([]);
    h.worker.lose = false;
    await retry(h);
    expect(h.loads).toEqual(['lm.s0', 'lm.s0']);
    expect(h.mounted).toEqual(['lm.s0']);
    expect(h.layer.report().failed).toEqual([]);
    expect(masks(h)).toEqual([1]);
  });

  it('a prepare the worker holds past the limit on its own clock is given up, its late mesh dropped, and the load tried again', async () => {
    const h = harness('mobile', [0], { auto: false });
    // the worker takes the prepare up at once and its read does not end
    h.hold.on = true;
    await h.step(0, 3);
    h.clock.ms += 5000;
    await h.step(0, 2);
    expect(h.layer.report().failed).toEqual([]);
    h.clock.ms += 4000;
    await h.step(0, 2);
    expect(h.layer.report().failed).toEqual([{ id: 'lm.s0', error: 'the worker held the chunk meshes too long' }]);
    expect(h.mounted).toEqual([]);
    expect(masks(h)).toEqual([]);
    // the read ends after all: the mesh is dropped, nothing mounts, nothing is masked
    h.releasePrepared();
    await flush();
    await h.step(0, 3);
    h.settle();
    expect(h.mounted).toEqual([]);
    expect(masks(h)).toEqual([]);
    await retry(h);
    expect(h.loads).toEqual(['lm.s0', 'lm.s0']);
    expect(h.mounted).toEqual(['lm.s0']);
    expect(h.layer.report().failed).toEqual([]);
    expect(masks(h)).toEqual([1]);
  });

  it('a worker that answers nothing at all (its loop blocked, or gone) is given up after 8 s of silence counted at most 250 ms a frame, and the load is tried again', async () => {
    const h = harness('mobile', [0], { auto: false });
    h.worker.dead = true;
    await h.step(0, 3);
    h.clock.ms += 8000;
    // past the time: the layer asks, and nothing comes back
    await h.step(0, 1);
    // frames of 4 s each (software GL on a starved core): 80 s of wall clock, but at most 250 ms of silence per frame, 5 s in all
    for (let i = 0; i < 20; i++) {
      h.clock.ms += 4000;
      await h.step(0, 1);
    }
    expect(h.layer.report().failed).toEqual([]);
    expect(phases(h)).toEqual([['lm.s0', 'preparing']]);
    // 13 frames more: past 8 s of silence
    for (let i = 0; i < 13; i++) {
      h.clock.ms += 4000;
      await h.step(0, 1);
    }
    expect(h.layer.report().failed).toEqual([{ id: 'lm.s0', error: 'the asset worker does not answer' }]);
    expect(h.mounted).toEqual([]);
    expect(masks(h)).toEqual([]);
    // the slot is free and the load is tried again after retryMs; with the worker answering again, the landmark comes up
    expect(h.layer.report().resident).toEqual([]);
    h.worker.dead = false;
    await retry(h);
    expect(h.loads).toEqual(['lm.s0', 'lm.s0']);
    expect(h.mounted).toEqual(['lm.s0']);
    expect(h.layer.report().failed).toEqual([]);
  });

  it('a worker the client knows has failed (the question is refused) gives the swap up at once', async () => {
    const h = harness('mobile', [0], { auto: false });
    h.hold.on = true;
    await h.step(0, 3);
    h.worker.gone = true;
    h.clock.ms += 9000;
    await h.step(0, 2);
    expect(h.layer.report().failed).toEqual([{ id: 'lm.s0', error: 'the asset worker is gone' }]);
    expect(h.mounted).toEqual([]);
    expect(masks(h)).toEqual([]);
  });
});

describe('terrain under a far landmark', () => {
  it('a skyline landmark is placed on the coarse terrain before any L0 chunk is near and moved to the exact height when it arrives', async () => {
    const h = skyHarness('mobile', [1500], { ids: ['lm.sutro-tower'] });
    h.ground.exact = false;
    await h.step(0, 30);
    expect(h.heights.get('lm.sutro-tower#sky')).toBe(12.5);
    h.ground.exact = true;
    h.ground.exactY = 31;
    await h.step(0, 40);
    expect(h.heights.get('lm.sutro-tower#sky')).toBe(31);
  });

  it('a sea-anchored model needs no terrain and is never moved', async () => {
    const h = harness('mobile', [1500], { auto: true, ids: ['lm.golden-gate-bridge'], seaIds: ['lm.golden-gate-bridge'], skyline: { rangeM: 2500, ids: ['lm.golden-gate-bridge'] } });
    h.ground.ready = false;
    await h.step(0, 30);
    expect(h.heights.get('lm.golden-gate-bridge#sky')).toBe(0);
    h.ground.ready = true;
    h.ground.exactY = 40;
    await h.step(0, 40);
    expect(h.heights.get('lm.golden-gate-bridge#sky')).toBe(0);
  });
});

describe('the skyline', () => {
  it('waits for the world reveal, then reads the lo model of the nearest first, one at a time, and none beyond the load ring', async () => {
    const range = R2.mobile;
    const far = range * LANDMARKS_RUNTIME.skyline.loadFactor;
    const h = skyHarness('mobile', [0, 400, 1000, far - 10, far + 10]);
    h.revealed.value = false;
    await h.step(0, 10);
    expect(h.skyLoads).toEqual([]);
    h.revealed.value = true;
    await h.step(0, 40);
    expect(h.skyLoads).toEqual([SEVEN[0], SEVEN[1], SEVEN[2], SEVEN[3]]);
    // the full-fidelity loads are separate: only what lies inside the swap distance
    expect(h.loads).toEqual([SEVEN[0], SEVEN[1]].slice(0, 2).filter((_, i) => [0, 400][i]! <= LANDMARKS_RUNTIME.tiers.mobile.swapM));
  });

  it.each(TIERS)('%s: the skyline stays resident regardless of the tier cap; the cap still limits full-fidelity landmarks', async (tier) => {
    const cap = LANDMARKS_RUNTIME.tiers[tier].resident;
    const xs = SEVEN.map((_, i) => i * 20);
    const h = skyHarness(tier, xs);
    await h.step(0, 80);
    const r = h.layer.report();
    expect(r.cap).toBe(cap);
    // every one of the seven is up as a lo model (the ones that also hold a full model are hidden under it: one model each)
    expect(r.skyline.entries.map((e) => e.fidelity)).toEqual(Array(7).fill('lo'));
    expect(r.skyline.entries.every((e) => e.phase === 'shown')).toBe(true);
    const full = r.resident.filter((e) => e.phase === 'shown');
    expect(full).toHaveLength(Math.min(cap, 7));
    expect(r.maxResident).toBeLessThanOrEqual(cap);
    // one visible model per landmark: a skyline instance shows exactly when its landmark has no full model
    for (const e of r.skyline.entries) expect(e.visible, e.id).toBe(!full.some((f) => f.id === e.id));
    expect(r.skyline.entries.filter((e) => !e.visible).every((e) => e.hiddenBy === 'full')).toBe(true);
  });

  it('puts a skyline model in the scene within mountFactor x the draw distance and parks it beyond releaseFactor x (hysteresis)', async () => {
    const range = R2['mobile-low'];
    const { mountFactor, releaseFactor } = LANDMARKS_RUNTIME.skyline;
    const h = skyHarness('mobile-low', [0]);
    await h.step(range * mountFactor + 50, 30);
    expect(h.layer.report().skyline.entries[0]?.phase).toBe('ready');
    expect(h.mounted).toEqual([]);
    await h.step(range * mountFactor - 50, 30);
    expect(h.layer.report().skyline.entries[0]?.phase).toBe('shown');
    expect(h.mounted).toEqual([`${SEVEN[0]}#sky`]);
    // between the mount and the release ring nothing changes
    await h.step(range * releaseFactor - 50, 30);
    expect(h.layer.report().skyline.entries[0]?.phase).toBe('shown');
    await h.step(range * releaseFactor + 50, 30);
    const e = h.layer.report().skyline.entries[0]!;
    expect(e.phase).toBe('parked');
    expect(e.visible).toBe(false);
    expect(e.hiddenBy).toBe('range');
    expect(h.disposed).toEqual([]);
    // it comes back without a second read
    await h.step(range * mountFactor - 50, 30);
    expect(h.layer.report().skyline.entries[0]?.visible).toBe(true);
    expect(h.skyLoads).toEqual([SEVEN[0]]);
  });

  it('one visible model per landmark: a full model hides the skyline instance in the frame it commits, and it is shown again in the frame the full model goes', async () => {
    const h = skyHarness('mobile', [0], { auto: false, ids: ['lm.coit-tower'] });
    // far enough that only the skyline comes up
    await h.step(2000, 10);
    h.settle();
    await h.step(2000, 4);
    h.settle();
    expect(h.visible.get('lm.coit-tower#sky')).toBe(true);
    expect(masked(h, 0)).toBe(true);
    // walk to the landmark: the full model loads, prepares and commits; the proxy mask is already there (the skyline owns it)
    await h.step(0, 10);
    expect(h.visible.get('lm.coit-tower#sky')).toBe(true);
    expect(h.mounted).toEqual(['lm.coit-tower#sky']);
    h.runTasks();
    expect(h.mounted).toEqual(['lm.coit-tower#sky', 'lm.coit-tower']);
    expect(h.visible.get('lm.coit-tower')).toBe(true);
    expect(h.visible.get('lm.coit-tower#sky')).toBe(false);
    expect(h.layer.report().skyline.entries[0]).toMatchObject({ visible: false, hiddenBy: 'full' });
    // no chunk had to be remeshed for the swap: the proxy was already out
    expect(h.remeshes.filter((r) => r.staged).length).toBe(1);
    // leaving: the full model is removed and the skyline instance is back in the same step; the proxies stay masked throughout
    await h.step(2000, 10);
    h.settle();
    await h.step(2000, 4);
    expect(h.disposed).toEqual(['lm.coit-tower']);
    expect(h.visible.get('lm.coit-tower#sky')).toBe(true);
    expect(masked(h, 0)).toBe(true);
    expect(h.layer.report().frames.holes).toBe(0);
  });

  it('owns the proxy mask while it is up, and meshes the proxies back before it is parked: never a hole', async () => {
    const h = skyHarness('mobile', [0], { auto: false, ids: ['lm.sutro-tower'] });
    await h.step(2000, 8);
    h.settle();
    await h.step(2000, 4);
    h.settle();
    expect(masked(h, 0)).toBe(true);
    expect(h.layer.maskList()).toEqual([1]);
    // out of the release ring: the proxy is asked back first and the model stays drawn until it is
    await h.step(R2.mobile * LANDMARKS_RUNTIME.skyline.releaseFactor + 200, 6);
    expect(h.remeshes.at(-1)).toMatchObject({ key: '9/0/0', mask: [] });
    expect(h.layer.report().skyline.entries[0]?.phase).toBe('leaving');
    expect(h.visible.get('lm.sutro-tower#sky')).toBe(true);
    h.settle();
    await h.step(R2.mobile * LANDMARKS_RUNTIME.skyline.releaseFactor + 200, 4);
    expect(masked(h, 0)).toBe(false);
    expect(h.visible.get('lm.sutro-tower#sky')).toBe(false);
    expect(h.layer.report().frames.holes).toBe(0);
    expect(h.layer.maskList()).toEqual([]);
  });

  it('is read in the lo variant and a failed read is tried again after retryMs, outside the cap', async () => {
    const h = skyHarness('mobile', [0, 100]);
    h.fail.add(SEVEN[0] as string);
    await h.step(0, 30);
    const r = h.layer.report();
    // the landmark inside the swap distance fails twice over: its full model and its skyline instance
    expect([...new Set(r.failed.map((f) => f.id))]).toEqual([SEVEN[0]]);
    expect(r.skyline.entries.find((e) => e.id === SEVEN[1])?.fidelity).toBe('lo');
    h.fail.clear();
    h.clock.ms += LANDMARKS_RUNTIME.retryMs + 100;
    await h.step(0, 30);
    expect(h.layer.report().failed).toEqual([]);
    expect(skyUp(h).length + h.layer.report().skyline.entries.filter((e) => e.hiddenBy === 'full').length).toBe(2);
  });

  it('every skyline landmark inside the draw distance is drawn on every sampled frame of a walk past all seven', async () => {
    const range = R2['mobile-low'];
    const xs = SEVEN.map((_, i) => i * 900);
    const h = skyHarness('mobile-low', xs);
    await h.step(0, 60);
    h.layer.resetStats();
    // 90 m/s at 60 fps: 1.5 m a frame, the length of the line plus a little
    for (let x = 0; x <= 6 * 900 + 300; x += 1.5 * 8) await h.step(x, 1);
    const r = h.layer.report();
    expect(r.frames.sampled).toBeGreaterThan(300);
    expect(r.frames.skylineMissing).toBe(0);
    expect(r.frames.holes).toBe(0);
    expect(range).toBe(1500);
    // the skyline never counted against the cap
    expect(r.maxResident).toBeLessThanOrEqual(LANDMARKS_RUNTIME.tiers['mobile-low'].resident);
  });

  it('counts a frame in which a skyline landmark inside the draw distance is not drawn (the counter is not vacuous)', async () => {
    const h = skyHarness('mobile', [1000]);
    h.revealed.value = false;
    await h.step(0, 10);
    expect(h.layer.report().frames.skylineMissing).toBe(10);
  });
});

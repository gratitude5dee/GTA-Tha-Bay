/**
 * A teleport waits for colliders at its destination, far from the player (M01b1 ownership machine). The statics feed takes the
 * destination as a second focus: the player's own chunks first, the destination's after, at most one chunk per call, and nothing
 * near either is dropped while the teleport is pending (02-world.md 5.2).
 */
import type { ChunkKey, SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { ChunkStore } from '../src/sim/streaming/chunk-store.ts';
import { boundsOf, type Focus } from '../src/sim/streaming/priority.ts';
import { StaticsFeeder } from '../src/sim/streaming/statics.ts';

const centre = (key: ChunkKey): Focus => {
  const b = boundsOf(key);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, vx: 0, vz: 0 };
};

describe('StaticsFeeder with a teleport destination', () => {
  function setup(): { store: ChunkStore<SimChunk>; feeder: StaticsFeeder; added: string[]; removed: string[]; here: Focus; there: Focus } {
    const added: string[] = [];
    const removed: string[] = [];
    const feeder = new StaticsFeeder({ addChunkStatics: (k: string) => void added.push(k), removeChunkStatics: (k: string) => void removed.push(k) } as never);
    // A grid of chunks that all "fail" at once: the feed gives each an invisible wall, which needs no payload.
    const here = centre('9/256/256' as ChunkKey);
    const there = centre('9/276/256' as ChunkKey); // 20 chunks east: far outside any physics radius
    const store = new ChunkStore<SimChunk>({
      levels: ['p0'],
      tier: 'desktop',
      exists: () => true,
      request: () => undefined,
      now: () => 0,
      retry: { firstDelay: 1, maxDelay: 1, maxAttempts: 1 },
    });
    store.want(here);
    for (const [x, z] of [[256, 256], [257, 256], [256, 257], [276, 256], [277, 256]] as const) {
      const key = `9/${x}/${z}` as ChunkKey;
      store.preload([{ level: 'p0', key }]);
      store.settle('p0', key, { ok: false, reason: 'corrupt' });
    }
    return { store, feeder, added, removed, here, there };
  }

  it('without a destination only the chunks near the player are fed', () => {
    const { store, feeder, added, here } = setup();
    for (let i = 0; i < 6; i++) feeder.step(store, here, 400);
    expect(added.sort()).toEqual(['9/256/256', '9/256/257', '9/257/256']);
  });

  it('with a destination the player first, then the destination, one chunk per call, and nothing is dropped', () => {
    const { store, feeder, added, removed, here, there } = setup();
    const perCall: (string | null)[] = [];
    for (let i = 0; i < 8; i++) perCall.push(feeder.step(store, here, 400, there).added);
    expect(perCall.filter((a) => a !== null)).toHaveLength(5);
    expect(perCall.slice(0, 3).sort()).toEqual(['9/256/256', '9/256/257', '9/257/256']);
    expect(perCall.slice(3, 5).sort()).toEqual(['9/276/256', '9/277/256']);
    expect(added).toHaveLength(5);
    expect(removed).toEqual([]);
  });

  it('when the teleport ends the destination chunks leave with the next step', () => {
    const { store, feeder, removed, here, there } = setup();
    for (let i = 0; i < 6; i++) feeder.step(store, here, 400, there);
    expect(feeder.keys()).toHaveLength(5);
    feeder.step(store, here, 400, null);
    expect(removed.sort()).toEqual(['9/276/256', '9/277/256']);
  });
});

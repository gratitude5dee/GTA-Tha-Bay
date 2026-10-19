/**
 * The county-line and portal barriers (M02c1) ride in the statics of the chunk they stand in: `StaticsFeeder.extras` adds their prisms
 * to the chunk's own when it is fed, and `refresh` rebuilds a fed chunk when a portal changes state.
 */
import { describe, expect, it } from 'vitest';
import type { ChunkKey, Portal, SimChunk } from '@dv/shared';
import { createWorldApi } from '../src/sim/api/world-api.ts';
import { barrierPrism } from '../src/sim/api/boundaries.ts';
import { StaticsFeeder } from '../src/sim/streaming/statics.ts';
import { chunkOf, roads } from './fixtures/roads.ts';
import { indexOf, loadAll, storeOf } from './fixtures/world.ts';

const K = '9/256/256' as ChunkKey;
const portal = (id: string, kind: Portal['kind'], x: number, z: number): Portal => ({ id, x, y: 3, z, yaw: 0, widthM: 12, kind, state: 'closed', toArea: null, edges: [] });

function rig() {
  const shapes = new Map<string, Float32Array>();
  const removed: string[] = [];
  const feeder = new StaticsFeeder({
    addChunkStatics: (k: string, s: { prisms: Float32Array }) => void shapes.set(k, s.prisms),
    removeChunkStatics: (k: string) => {
      removed.push(k);
      shapes.delete(k);
    },
  } as never);
  return { feeder, shapes, removed };
}

describe('statics extras', () => {
  it('adds the barrier prisms of the chunk to its own prisms when the chunk is fed', async () => {
    const own = [4, 0, 20, 10, 10, 30, 10, 30, 30, 10, 30];
    const chunk: SimChunk = chunkOf(K, roads([], []), { heightM: 5, prisms: own });
    const store = storeOf([chunk]);
    await loadAll(store, [K]);
    const w = createWorldApi(store, indexOf({ portals: [portal('portal.cl.1', 'county-line', 20, 20), portal('portal.far', 'county-line', 5000, 5000), portal('portal.ferry', 'ferry', 40, 40)] }), { tick: () => 0 });
    const { feeder, shapes } = rig();
    feeder.extras = (key) => w.barrierPrisms(key);
    const focus = { x: 0, z: 0, vx: 0, vz: 0 };
    feeder.step(store, focus, 400);
    const prisms = shapes.get(K)!;
    // its own building, then one barrier for the county-line portal in this chunk; neither the far portal nor the ferry
    expect([...prisms]).toEqual([...own, ...barrierPrism(portal('x', 'county-line', 20, 20))].map((v) => Math.fround(v)));
    expect(prisms.length).toBe(own.length + 11);
  });

  it('rebuilds the chunk when a portal opens, and a sealed or closed bridge portal stands as a barrier', async () => {
    const chunk: SimChunk = chunkOf(K, roads([], []), { heightM: 5 });
    const store = storeOf([chunk]);
    await loadAll(store, [K]);
    const changed: ChunkKey[] = [];
    const w = createWorldApi(store, indexOf({ portals: [portal('portal.ggb', 'bridge', 20, 20)] }), { tick: () => 0 }, { onBarrierChange: (k) => changed.push(k) });
    const { feeder, shapes, removed } = rig();
    feeder.extras = (key) => w.barrierPrisms(key);
    feeder.step(store, { x: 0, z: 0, vx: 0, vz: 0 }, 400);
    expect(shapes.get(K)!.length).toBe(11);
    expect(w.bounds.setPortalState('portal.ggb', 'open', 'story')).toBe(true);
    expect(changed).toEqual([K]);
    expect(feeder.refresh(K, store)).toBe(true);
    expect(removed).toEqual([K]);
    expect(shapes.get(K)!.length).toBe(0);
    w.bounds.setPortalState('portal.ggb', 'sealed', 'pursuit');
    feeder.refresh(K, store);
    expect(shapes.get(K)!.length).toBe(11);
    expect(feeder.refresh('9/300/300' as ChunkKey, store)).toBe(false);
  });
});

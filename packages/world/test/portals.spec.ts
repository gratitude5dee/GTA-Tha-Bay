import { describe, expect, it } from 'vitest';
import { Fnv64, type ChunkKey, type Portal } from '@dv/shared';
import { ByteReader, ByteWriter } from '@dv/engine/sim';
import { createWorldApi, type WorldServices } from '../src/sim/api/world-api.ts';
import { chunkOf, roads, topologyOf } from './fixtures/roads.ts';
import { indexOf, loadAll, storeOf } from './fixtures/world.ts';

const K = '9/256/256' as ChunkKey;

/** A bridge: S - A - (deck 1, deck 2) - B - T along x; the Golden Gate portal sits on the deck edges. */
const NODES: [number, number][] = [[-100, 0], [-50, 0], [0, 0], [50, 0], [100, 0]];
const fixture = () => roads(NODES, [{ a: 0, b: 1, twoWay: false }, { a: 1, b: 2, twoWay: false }, { a: 2, b: 3, twoWay: false }, { a: 3, b: 4, twoWay: false }]);

const portal = (id: string, kind: Portal['kind'], edges: number[], state: Portal['state'] = 'closed'): Portal => ({ id, x: 0, y: 10, z: 0, yaw: 0, widthM: 12, kind, state, toArea: null, edges });

async function world(portals: Portal[], barrier?: (k: ChunkKey) => void): Promise<{ w: WorldServices; f: ReturnType<typeof fixture> }> {
  const f = fixture();
  const store = storeOf([chunkOf(K, f, { heightM: 5 })]);
  await loadAll(store, [K]);
  const w = createWorldApi(store, indexOf({ portals }), { tick: () => 0 }, { topology: topologyOf(f), ...(barrier ? { onBarrierChange: barrier } : {}) });
  return { w, f };
}

const route = (w: WorldServices) => w.graph.route({ from: { edge: 0, s: 1, lane: 0 }, to: { edge: 3, s: 1, lane: 0 }, maxExpand: 1000 });

describe('portals', () => {
  it('starts every portal closed, whatever the bake wrote', async () => {
    const { w } = await world([portal('portal.ggb', 'bridge', [1, 2], 'open'), portal('portal.cl.7', 'county-line', [], 'open'), portal('portal.ferry', 'ferry', [])]);
    expect(w.bounds.portals().map((p) => [p.id, p.state])).toEqual([['portal.cl.7', 'closed'], ['portal.ferry', 'closed'], ['portal.ggb', 'closed']]);
    expect(w.bounds.sealedPortals()).toEqual([]);
  });

  it('seals a portal by closing its edges, lists it, and restores `closed` on release', async () => {
    const changes: ChunkKey[] = [];
    const { w } = await world([portal('portal.ggb', 'bridge', [1, 2]), portal('portal.baybridge', 'bridge', [])], (k) => changes.push(k));
    const closures: { edges: readonly number[]; closed: boolean; by: string }[] = [];
    w.bounds.onClosureChange((e) => closures.push(e));
    expect(route(w)!.edges).toEqual([0, 1, 2, 3]);

    expect(w.bounds.setPortalState('portal.ggb', 'sealed', 'pursuit')).toBe(true);
    expect(w.bounds.sealedPortals()).toEqual(['portal.ggb']);
    expect(w.bounds.portals().find((p) => p.id === 'portal.ggb')!.state).toBe('sealed');
    expect(w.traffic.isClosed(1) && w.traffic.isClosed(2)).toBe(true);
    expect(route(w)).toBeNull();   // the only way over is shut
    expect(closures).toEqual([{ edges: [1, 2], closed: true, by: 'pursuit' }]);
    expect(changes).toEqual([K]);

    w.bounds.release('pursuit');
    expect(w.bounds.sealedPortals()).toEqual([]);
    expect(w.bounds.portals().find((p) => p.id === 'portal.ggb')!.state).toBe('closed');
    expect(route(w)!.edges).toEqual([0, 1, 2, 3]);
    expect(closures[1]).toEqual({ edges: [1, 2], closed: false, by: 'pursuit' });
  });

  it('opens a portal for a scripted finale and closes it again', async () => {
    const { w } = await world([portal('portal.ggb', 'bridge', [1, 2])]);
    expect(w.bounds.setPortalState('portal.ggb', 'open', 'story')).toBe(true);
    expect(w.bounds.portals()[0]!.state).toBe('open');
    expect(w.bounds.setPortalState('portal.ggb', 'closed', 'story')).toBe(true);
    expect(w.bounds.portals()[0]!.state).toBe('closed');
    expect(w.bounds.setPortalState('portal.nope', 'sealed', 'pursuit')).toBe(false);
    expect(w.bounds.setPortalState('portal.ggb', 'sealed', '')).toBe(false);
  });

  it('stays sealed while any owner holds it, and falls back when the closures are released in TrafficControl', async () => {
    const { w } = await world([portal('portal.ggb', 'bridge', [1, 2])]);
    w.bounds.setPortalState('portal.ggb', 'sealed', 'a');
    w.bounds.setPortalState('portal.ggb', 'sealed', 'b');
    w.bounds.release('a');
    expect(w.bounds.sealedPortals()).toEqual(['portal.ggb']);
    expect(w.traffic.isClosed(1)).toBe(true);
    w.traffic.release('b');   // the owner's closures go: the portal falls back too
    expect(w.bounds.sealedPortals()).toEqual([]);
    expect(w.traffic.isClosed(1)).toBe(false);
    // an unrelated owner's release changes nothing
    w.bounds.setPortalState('portal.ggb', 'sealed', 'c');
    w.bounds.release('someone-else');
    expect(w.bounds.sealedPortals()).toEqual(['portal.ggb']);
  });

  it('hashes and checkpoints portal states', async () => {
    const hashOf = (w: WorldServices): string => {
      const h = new Fnv64();
      w.portals.resource().hash(h);
      return h.hex();
    };
    const a = (await world([portal('portal.ggb', 'bridge', [1, 2]), portal('portal.baybridge', 'bridge', [])])).w;
    const b = (await world([portal('portal.baybridge', 'bridge', []), portal('portal.ggb', 'bridge', [1, 2])])).w;
    expect(hashOf(a)).toBe(hashOf(b));
    a.bounds.setPortalState('portal.ggb', 'sealed', 'pursuit');
    expect(hashOf(a)).not.toBe(hashOf(b));
    const bytes = new ByteWriter();
    a.portals.resource().save(bytes);
    b.portals.resource().load(new ByteReader(bytes.toBytes()));
    expect(hashOf(b)).toBe(hashOf(a));
    expect(b.bounds.sealedPortals()).toEqual(['portal.ggb']);
  });
});

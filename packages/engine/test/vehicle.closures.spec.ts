/**
 * Barrier props for closed edges (M03a1, DL-663): one `prop.barrier` at each end of every closed edge, removed when the edge
 * reopens; an edge whose chunk is not resident is skipped.
 */
import { describe, expect, it } from 'vitest';
import type { EdgeId, Portal, ShoreNode, WorldApi } from '@dv/shared';
import { Transform } from '../src/sim/ecs/components.ts';
import { barrierKey } from '../src/sim/world/closures.ts';
import type { WorldBoundsPort } from '../src/sim/world/index.ts';
import { createVehicleWorld, drive } from './vehicle-sim.ts';

type Listener = (e: { edges: readonly EdgeId[]; closed: boolean; by: string }) => void;

/** Edge 7 runs from (0, 0, -50) to (0, 0, -150) heading north (yaw 0); edge 8 is not resident. */
function fakeWorld(): { port: WorldBoundsPort; api: WorldApi; fire: Listener; subscribers: () => number } {
  const listeners = new Set<Listener>();
  const port: WorldBoundsPort = {
    portals: (): readonly Portal[] => [],
    setPortalState: () => false,
    release: () => undefined,
    sealedPortals: (): readonly string[] => [],
    nearestShore: (): ShoreNode | null => null,
    waterDepth: () => 0,
    onClosureChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
  const api = {
    graph: {
      edge: (id: EdgeId) => (id === 7 ? ({ id: 7 } as never) : null),
      laneCentre(e: { edge: EdgeId; s: number }, out: Float64Array) {
        const s = Math.min(e.s, 100);
        out[0] = 0; out[1] = 0; out[2] = -50 - s; out[3] = 0;
      },
    },
  } as unknown as WorldApi;
  return { port, api, fire: (e) => { for (const l of [...listeners]) l(e); }, subscribers: () => listeners.size };
}

describe('closure barriers', () => {
  it('stand at both ends of a closed edge and go when it reopens', async () => {
    const w = await createVehicleWorld({ prefab: null, playerAt: [0, 0, 0] });
    const world = fakeWorld();
    w.sim.services.world.bounds = world.port;
    w.sim.services.world.api = world.api;
    drive(w, 2);
    expect(world.subscribers()).toBe(1);

    world.fire({ edges: [7, 8], closed: true, by: 'race' });
    drive(w, 2);
    const ecs = w.sim.ecs;
    const a = ecs.byKey(barrierKey(7, 0));
    const b = ecs.byKey(barrierKey(7, 1));
    expect(a).not.toBe(0);
    expect(b).not.toBe(0);
    const tr = ecs.store(Transform);
    const ia = ecs.resolve(a) as number;
    const ib = ecs.resolve(b) as number;
    expect([tr.px[ia], tr.pz[ia]]).toEqual([0, -50]);
    expect([tr.px[ib], tr.pz[ib]]).toEqual([0, -150]);
    // the non-resident edge got nothing
    expect(ecs.byKey(barrierKey(8, 0))).toBe(0);
    expect(ecs.byKey(barrierKey(8, 1))).toBe(0);

    // closing again spawns no duplicates
    world.fire({ edges: [7], closed: true, by: 'mission' });
    drive(w, 2);
    expect(ecs.byKey(barrierKey(7, 0))).toBe(a);

    world.fire({ edges: [7], closed: false, by: 'race' });
    drive(w, 2);
    expect(ecs.byKey(barrierKey(7, 0))).toBe(0);
    expect(ecs.byKey(barrierKey(7, 1))).toBe(0);
    w.sim.dispose();
  });

  it('subscribes again when the port is replaced and unsubscribes from the old one', async () => {
    const w = await createVehicleWorld({ prefab: null, playerAt: [0, 0, 0] });
    const first = fakeWorld();
    const second = fakeWorld();
    w.sim.services.world.bounds = first.port;
    w.sim.services.world.api = first.api;
    drive(w, 2);
    w.sim.services.world.bounds = second.port;
    drive(w, 2);
    expect(first.subscribers()).toBe(0);
    expect(second.subscribers()).toBe(1);
    w.sim.dispose();
  });
});

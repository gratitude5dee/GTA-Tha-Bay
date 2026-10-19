/**
 * Barrier props for closed edges (DL-663, M03a1). When an owner closes edges (`TrafficControl.closeEdges`, a race, a mission,
 * the pursuit director), the world publishes the change through `WorldBoundsPort.onClosureChange`; this system spawns one
 * `prop.barrier` at each end of every closed edge, at the lane centre (`WorldApi.graph.laneCentre`), and removes them when the
 * event reports `closed: false`. An edge whose `graph.edge(id)` is `null` (its chunk is not resident) is skipped.
 *
 * The engine owns the port (`world/index.ts`), so `@dv/engine` never imports `@dv/world` (DL-685). The subscription is made
 * on the first tick the world hub has a port, and again if the port is replaced.
 *
 * Sim code under the C02 lint.
 */
import { NULL_HANDLE, SimStage, type EcsApi, type EdgeId, type StableKey, type SystemDef } from '@dv/shared';
import type { PrefabService } from '../prefabs/registry.ts';
import type { EngineServices } from '../services.ts';

export const CLOSURE_BARRIERS_ID = 'engine.world.closure-barriers';
export const BARRIER_PREFAB = 'prop.barrier';
const FAR = 1e9;

export const barrierKey = (edge: EdgeId, end: 0 | 1): StableKey => `pfb:${BARRIER_PREFAB}:e${edge}:${end}` as StableKey;

export interface ClosureBarrierOptions {
  prefabs: Pick<PrefabService, 'spawn' | 'despawn'>;
  services: Pick<EngineServices, 'world'>;
}

export function closureBarrierSystem(opts: ClosureBarrierOptions): SystemDef {
  const out = new Float64Array(4);
  let bound: object | null = null;
  let unsub: (() => void) | null = null;

  const add = (edge: EdgeId, ecs: Pick<EcsApi, 'byKey'>): void => {
    const api = opts.services.world.api;
    if (!api || api.graph.edge(edge) === null) return;
    for (const end of [0, 1] as const) {
      const key = barrierKey(edge, end);
      if (ecs.byKey(key) !== NULL_HANDLE) continue;
      api.graph.laneCentre({ edge, s: end === 0 ? 0 : FAR, lane: 0 }, out);
      if (Number.isNaN(out[0] as number)) continue;
      opts.prefabs.spawn(BARRIER_PREFAB, { pos: [out[0] as number, out[1] as number, out[2] as number], yaw: out[3] as number }, key);
    }
  };

  const remove = (edge: EdgeId, ecs: Pick<EcsApi, 'byKey'>): void => {
    for (const end of [0, 1] as const) {
      const h = ecs.byKey(barrierKey(edge, end));
      if (h !== NULL_HANDLE) opts.prefabs.despawn(h);
    }
  };

  return {
    id: CLOSURE_BARRIERS_ID, owner: 'S01', stage: SimStage.Streaming, order: 50,
    run: ({ ecs }) => {
      const port = opts.services.world.bounds;
      if (port === bound) return;
      unsub?.();
      unsub = null;
      bound = port;
      if (!port) return;
      unsub = port.onClosureChange((e) => {
        for (const edge of e.edges) {
          if (e.closed) add(edge, ecs);
          else remove(edge, ecs);
        }
      });
    },
  };
}

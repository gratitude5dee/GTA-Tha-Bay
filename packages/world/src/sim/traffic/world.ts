/**
 * The traffic's view of the world (M03b1): the road network, the junction runtime, `TrafficControl` and the resident `p0` chunks,
 * taken from the `WorldServices` of M02c1 and the `ChunkStore` behind them. Pure; C02 lint applies.
 */
import type { ChunkKey, SimChunk } from '@dv/shared';
import type { WorldServices } from '../api/world-api.ts';
import type { TrafficWorld } from './sim.ts';

/** The part of the chunk store the traffic reads. `ChunkStore<SimChunk>` fits. */
export interface TrafficChunkSource {
  payload(key: ChunkKey): SimChunk | null;
  residentKeys(level?: 'p0'): ChunkKey[];
}

export function trafficWorldOf(w: WorldServices, store: TrafficChunkSource): TrafficWorld {
  return {
    net: w.network,
    graph: w.graph,
    control: w.traffic,
    chunk: (key) => store.payload(key),
    cells: () => store.residentKeys('p0'),
  };
}

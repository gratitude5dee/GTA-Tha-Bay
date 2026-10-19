/**
 * `createWorldApi` (M02c1): the one object that wires the C08 services together for the engine and, from M04a1, for
 * `ModeContext.world` (C06 1.1). `store` is the sim's `p0` `ChunkStore` (or anything shaped like it); the road network follows
 * its residency, the topology and the district grid are loaded once.
 *
 *   const world = createWorldApi(store, index, { tick: () => tick }, { topology, districtGrid, host, ... });
 *   world.graph.route(...); world.teleport.request('sandbox', { landmark: 'lm.coit-tower' });
 *
 * Besides the `WorldApi` members it carries what the sim module needs (`step`, `resources`, `bounds`). Pure; C02 lint applies.
 */
import type { ChunkKey, DistrictGrid, GraphTopology, SimChunk, WorldApi, WorldIndex } from '@dv/shared';
import { chunkKeyAt } from '@dv/shared';
import type { SimResource, WorldBoundsPort } from '@dv/engine/sim';
import boundsJson from '../../../../../config/world.bounds.json';
import { Blackout } from '../env/blackout.ts';
import { RoadNetwork } from '../graph/adjacency.ts';
import { RoadGraph } from '../graph/query.ts';
import { MapApiImpl, type MapPatch } from '../map/map-api.ts';
import { TrafficControlImpl } from '../traffic/control.ts';
import { BoundaryRuntime, nearestShoreNode, shoreRespawnPose, type WorldBoundaryEvent } from './boundaries.ts';
import { PlaceIndexImpl, type LabelFn } from './places.ts';
import { PortalRuntime } from './portals.ts';
import { WorldQueryImpl, type ChunkSource } from './query.ts';
import { WorldResolverImpl } from './resolver.ts';
import { SANDBOX_POLICY, TeleportService, type PreStream, type TeleportHost, type TeleportPolicy, type TransitConfig } from './teleport.ts';

/** The chunk store the services read: residency, the pre-stream and the residency events. `ChunkStore<SimChunk>` fits. */
export interface WorldStore extends ChunkSource, PreStream {
  onChunk(fn: (e: { level: 'p0' | 'l0' | 'l1' | 'l2'; k: ChunkKey; ev: string }) => void): () => void;
  residentKeys(level?: 'p0'): ChunkKey[];
}

export interface WorldApiDeps {
  /** `map_data/sf-graph.v1`; without it the network is the union of the resident chunks. */
  topology?: GraphTopology | null;
  /** `data/district-grid.v1`. */
  districtGrid?: DistrictGrid | null;
  /** M02b2's hashed blackout switch; a fresh one when absent. */
  blackout?: Blackout;
  /** The engine's teleport and the player; a host with no player when absent. */
  host?: TeleportHost;
  policy?: TeleportPolicy;
  labels?: LabelFn;
  transit?: TransitConfig;
  /** Called when a boundary event fires (the module turns it into a `SimEvent`). */
  onBoundary?: (e: WorldBoundaryEvent) => void;
  /** Called with the chunks whose static colliders must be rebuilt (a portal changed). */
  onBarrierChange?: (key: ChunkKey) => void;
}

export interface WorldServices extends WorldApi {
  readonly graph: RoadGraph;
  readonly traffic: TrafficControlImpl;
  readonly map: MapApiImpl;
  readonly teleport: TeleportService;
  readonly query: WorldQueryImpl;
  readonly places: PlaceIndexImpl;
  readonly resolver: WorldResolverImpl;
  readonly network: RoadNetwork;
  readonly portals: PortalRuntime;
  readonly boundaries: BoundaryRuntime;
  readonly blackout: Blackout;
  /** The port the engine reaches the world's edges through. */
  readonly bounds: WorldBoundsPort;
  /** The play box of config/world.bounds.json. */
  readonly play: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  /** One sim tick of the services that run on a clock (the teleport in flight, the boundaries). */
  step(tick: number, player: { x: number; z: number } | null): void;
  /** The map patch to publish at `SimStage.Publish`, or null. */
  flushMap(tick: number): MapPatch | null;
  /** Hashed resources: densities and closures, portals. (The blackout is registered by its owner.) */
  resources(): SimResource[];
  /** Respawn pose at the nearest shore node, for the vehicle water wall (`TeleportApi.request('respawn', pose)`). */
  shoreRespawn(x: number, z: number, roadAdjacent: boolean): { x: number; z: number; yaw: number } | null;
  dispose(): void;
}

const NO_PLAYER: TeleportHost = {
  playerPos: () => null,
  begin: () => ({ ok: false, reason: 'no-player' }),
  active: () => false,
  fade: () => undefined,
};

export function createWorldApi(store: WorldStore, index: WorldIndex, clock: { tick(): number }, deps: WorldApiDeps = {}): WorldServices {
  const play = (boundsJson as unknown as { play: WorldServices['play'] }).play;
  const net = new RoadNetwork(deps.topology ?? null);
  const blackout = deps.blackout ?? new Blackout();
  const traffic = new TrafficControlImpl(blackout);
  const graph = new RoadGraph(net, { tick: () => clock.tick(), blackout: () => traffic.blackout, closed: (e) => traffic.isClosed(e) });
  const query = new WorldQueryImpl(store, deps.districtGrid ?? null, index.districts);
  const places = new PlaceIndexImpl(index, graph, deps.labels);
  const resolver = new WorldResolverImpl(index.bakeId, graph, query, places);
  const host = deps.host ?? NO_PLAYER;
  const map = new MapApiImpl({ graph, player: () => { const p = host.playerPos(); return p ? { x: p[0], z: p[2] } : null; } });
  const portals = new PortalRuntime(index.portals, traffic);
  const boundaries = new BoundaryRuntime(index.portals, deps.onBoundary);
  const teleport = new TeleportService({
    stream: store, query, places, index, play, host, now: () => clock.tick(), policy: deps.policy ?? SANDBOX_POLICY, ...(deps.transit ? { config: deps.transit } : {}),
  });

  // the road network follows the residency of the p0 chunks
  const sync = (k: ChunkKey): void => {
    const c: SimChunk | null = store.payload(k);
    if (c) net.addChunk(c);
    else net.removeChunk(k);
  };
  for (const k of store.residentKeys('p0')) sync(k);
  const off = store.onChunk((e) => {
    if (e.level !== 'p0') return;
    if (e.ev === 'ready') sync(e.k);
    else if (e.ev === 'evicted') net.removeChunk(e.k);
  });

  // a portal that opens or seals changes the colliders of its chunk
  const offPortal = portals.onChange((id) => {
    const p = portals.get(id);
    if (p) deps.onBarrierChange?.(chunkKeyAt(9, p.x, p.z));
  });

  const bounds: WorldBoundsPort = {
    portals: () => portals.list(),
    setPortalState: (id, state, by) => portals.setState(id, state, by),
    release: (by) => portals.release(by),
    sealedPortals: () => portals.sealed(),
    nearestShore: (x, z, roadAdjacent) => nearestShoreNode(store, store.residentKeys('p0'), x, z, roadAdjacent, graph),
    waterDepth: (x, z) => query.waterDepth(x, z),
    onClosureChange: (cb) => traffic.onClosureChange(cb),
  };

  return {
    graph, traffic, map, teleport, query, places, resolver, network: net, portals, boundaries, blackout, bounds, play,
    step(tick, player) {
      teleport.step(tick);
      boundaries.step(tick, player);
    },
    flushMap: (tick) => map.flush(tick),
    resources: () => [traffic.resource(), portals.resource()],
    shoreRespawn(x, z, roadAdjacent) {
      const n = bounds.nearestShore(x, z, roadAdjacent);
      return n ? shoreRespawnPose(n) : null;
    },
    dispose() {
      off();
      offPortal();
    },
  };
}

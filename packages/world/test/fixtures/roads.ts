/**
 * Hand-built road fixtures for the M02c1 specs: a street list in, resident `SimChunk`s and a `GraphTopology` out, with the same
 * id rules as the bake (segments in street order, the forward edge before the backward edge, global dense ids).
 */
import {
  EdgeFlag, GroundClass, NodeControl, RoadClass, chunkBounds, chunkKeyAt,
  type ChunkKey, type GraphTopology, type Junction, type Movement, type RoadEdge, type RoadNode, type RoadSegment, type SimChunk,
} from '@dv/shared';

export const BAKE = 'c'.repeat(64);

export interface Street {
  a: number;
  b: number;
  twoWay?: boolean;
  cls?: RoadClass;
  lanes?: number;
  laneWidthM?: number;
  speedMps?: number;
  /** Extra centreline points between a and b, x, z pairs. */
  via?: number[];
  /** y at a and b (default 0). */
  ya?: number;
  yb?: number;
  layer?: number;
}

export interface RoadFixture {
  nodes: RoadNode[];
  segments: RoadSegment[];
  edges: RoadEdge[];
  /** Edge ids per street: [forward, backward or -1]. */
  ids: [number, number][];
}

const dist = (ax: number, az: number, bx: number, bz: number): number => Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));

export function roads(nodePos: readonly [number, number][], streets: readonly Street[], controls: Record<number, NodeControl> = {}): RoadFixture {
  const nodes: RoadNode[] = nodePos.map(([x, z], id) => ({ id, x, y: 0, z, layer: 0, control: controls[id] ?? NodeControl.None, junction: -1 }));
  for (const s of streets) {
    if (s.ya !== undefined) (nodes[s.a] as RoadNode).y = s.ya;
    if (s.yb !== undefined) (nodes[s.b] as RoadNode).y = s.yb;
  }
  const segments: RoadSegment[] = [];
  const edges: RoadEdge[] = [];
  const ids: [number, number][] = [];
  streets.forEach((s, i) => {
    const a = nodePos[s.a] as [number, number];
    const b = nodePos[s.b] as [number, number];
    const pts: number[] = [a[0], s.ya ?? 0, a[1]];
    const via = s.via ?? [];
    for (let k = 0; k < via.length; k += 2) pts.push(via[k] as number, 0, via[k + 1] as number);
    pts.push(b[0], s.yb ?? 0, b[1]);
    let len = 0;
    for (let k = 3; k < pts.length; k += 3) len += dist(pts[k - 3] as number, pts[k - 1] as number, pts[k] as number, pts[k + 2] as number);
    segments.push({ id: i, pts: Float32Array.from(pts), lengthM: len, widthM: 8, osmWay: 1000 + i, cnn: 0 });
    const twoWay = s.twoWay ?? true;
    const base: Omit<RoadEdge, 'id' | 'dir' | 'from' | 'to' | 'twin'> = {
      seg: i, cls: s.cls ?? RoadClass.Local, lanes: s.lanes ?? 1, laneWidthM: s.laneWidthM ?? 3, speedMps: s.speedMps ?? 10,
      flags: twoWay ? 0 : EdgeFlag.OneWay, layer: s.layer ?? 0, medianM: 0, parkingSides: 0, maxGradePct: 0, nhood: 255,
    };
    const fid = edges.length;
    const bid = twoWay ? fid + 1 : -1;
    edges.push({ ...base, id: fid, dir: 1, from: s.a, to: s.b, twin: bid });
    if (twoWay) edges.push({ ...base, id: bid, dir: -1, from: s.b, to: s.a, twin: fid });
    ids.push([fid, bid]);
  });
  return { nodes, segments, edges, ids };
}

/** The topology (what `sf-graph.v1` holds) of a fixture. */
export function topologyOf(f: RoadFixture): GraphTopology {
  return {
    bakeId: BAKE,
    nodes: f.nodes.map((n) => ({ x: n.x, z: n.z, y: n.y, layer: n.layer, control: n.control })),
    edges: f.edges.map((e) => ({
      from: e.from, to: e.to, lengthM: (f.segments[e.seg] as RoadSegment).lengthM, cls: e.cls, lanes: e.lanes, flags: e.flags, dir: e.dir, layer: e.layer, speedMps: e.speedMps,
    })),
  };
}

const emptyTags = (): SimChunk['tags'] => ({ hidingSpots: [], pursuitBreakers: [], chokePoints: [], jumpZones: [], portals: [], shoreNodes: [] });

export interface ChunkOptions {
  /** Terrain height of every post, metres. */
  heightM?: number;
  /** Replaces the height grid posts with a function of (x, z). */
  heightAt?: (x: number, z: number) => number;
  prisms?: number[];
  slabs?: number[];
  hoods?: number[];
  ground?: (i: number, j: number) => number;
  junctions?: Junction[];
}

/** A resident chunk at `key` holding the given share of a road fixture (everything whose `from` node lies in it by default). */
export function chunkOf(key: ChunkKey, f: RoadFixture, o: ChunkOptions & { inside?: (x: number, z: number) => boolean } = {}): SimChunk {
  const b = chunkBounds(key);
  const inside = o.inside ?? ((x: number, z: number): boolean => chunkKeyAt(9, x, z) === key);
  const owns = (n: number): boolean => inside((f.nodes[n] as RoadNode).x, (f.nodes[n] as RoadNode).z);
  const edges = f.edges.filter((e) => owns(e.from));
  const segIds = new Set(edges.map((e) => e.seg));
  const nodes = f.nodes.filter((n) => inside(n.x, n.z));
  const dm = new Int16Array(65 * 65);
  for (let j = 0; j < 65; j++) {
    for (let i = 0; i < 65; i++) dm[j * 65 + i] = Math.round((o.heightAt ? o.heightAt(b.minX + i * 4, b.minZ + j * 4) : (o.heightM ?? 0)) * 10);
  }
  const ground = new Uint8Array(64 * 64);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) ground[j * 64 + i] = o.ground ? o.ground(i, j) : GroundClass.Paved;
  return {
    key, bakeId: BAKE, height: { originX: b.minX, originZ: b.minZ, cellM: 4, dm },
    prisms: Float32Array.from(o.prisms ?? []), slabs: Float32Array.from(o.slabs ?? []), hoods: Float32Array.from(o.hoods ?? []),
    segments: f.segments.filter((s) => segIds.has(s.id)), edges, nodes, junctions: o.junctions ?? [],
    pedNodes: [], pedEdges: [], tags: emptyTags(), spawn: { cellKey: key, densityProfile: 0, trafficSlots: 0, pedSlots: 0, parked: [] }, ground,
  };
}

/** A junction at `node` whose movements are the listed (in, out) pairs. */
export function junctionAt(id: number, f: RoadFixture, node: number, pairs: readonly [number, number][], extra: Partial<Junction> = {}): Junction {
  const n = f.nodes[node] as RoadNode;
  n.junction = id;
  const movements: Movement[] = pairs.map(([inEdge, outEdge], i) => ({ id: i, inEdge, outEdge, turn: 'straight', lengthM: 10, conflicts: [] }));
  return { id, nodes: [node], x: n.x, z: n.z, control: NodeControl.AllWayStop, movements, program: null, stopApproaches: [], ...extra };
}

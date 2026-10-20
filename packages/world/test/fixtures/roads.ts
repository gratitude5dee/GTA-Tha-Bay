/**
 * Hand-built road fixtures for the M02c1 specs: a street list in, resident `SimChunk`s and a `GraphTopology` out, with the same
 * id rules as the bake (segments in street order, the forward edge before the backward edge, global dense ids).
 */
import {
  EdgeFlag, GroundClass, NodeControl, RoadClass, chunkBounds, chunkKeyAt,
  type ChunkKey, type GraphTopology, type Junction, type Movement, type RoadEdge, type RoadNode, type RoadSegment, type SignalProgram, type SimChunk,
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

// ---- M03b1: a four-way crossing for the traffic specs ------------------------------------------------------------------------

export interface CrossOptions {
  /** Length of each arm, metres (default 100, so that every node lies in chunk 9/256/256). */
  armM?: number;
  /** Control of the centre junction (default a signal with a two-phase program). */
  control?: NodeControl;
  /** Speed limit of the arms, m/s (default 11.25, a local street). */
  speedMps?: number;
  /** Lanes per direction (default 1). */
  lanes?: number;
  /** Signal timing in ticks (default green 1200, amber 180, clear 60). */
  green?: number;
  amber?: number;
  clear?: number;
}

export interface CrossRoads {
  fixture: RoadFixture;
  chunk: SimChunk;
  junctions: Junction[];
  /** Arm 0 north, 1 east, 2 south, 3 west. The edge into the centre and the edge out of it. */
  inEdge: [number, number, number, number];
  outEdge: [number, number, number, number];
  /** The node at the far end of each arm. */
  armNode: [number, number, number, number];
  /** Movement id of (in arm, out arm) at the centre. */
  movement: (inArm: number, outArm: number) => number;
}

/** Unit direction of travel away from the centre along each arm: north, east, south, west (+X east, -Z north). */
const ARM_DIR: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * A crossing of four two-way streets at the origin with a junction at the centre (12 movements with their conflict sets, a
 * two-phase signal program or a stop-sign control) and a dead-end junction with a U-turn at the end of every arm.
 */
export function crossRoads(o: CrossOptions = {}): CrossRoads {
  const L = o.armM ?? 100;
  const control = o.control ?? NodeControl.Signal;
  const nodePos: [number, number][] = [[0, 0]];
  for (const d of ARM_DIR) nodePos.push([d[0] * L, d[1] * L]);
  const streets: Street[] = [1, 2, 3, 4].map((b) => ({ a: 0, b, twoWay: true, cls: RoadClass.Local, lanes: o.lanes ?? 1, speedMps: o.speedMps ?? 11.25 }));
  const f = roads(nodePos, streets, { 1: NodeControl.DeadEnd, 2: NodeControl.DeadEnd, 3: NodeControl.DeadEnd, 4: NodeControl.DeadEnd });
  // street i: forward edge 2i leaves the centre, backward edge 2i + 1 comes in
  const outEdge = [0, 2, 4, 6] as [number, number, number, number];
  const inEdge = [1, 3, 5, 7] as [number, number, number, number];
  const armNode = [1, 2, 3, 4] as [number, number, number, number];

  // a movement's path: quadratic from the lane it leaves (1.5 m right of travel, 6 m before the centre) to the lane it lands in
  type P = [number, number];
  const right = (d: readonly [number, number]): P => [-d[1], d[0]];
  const path = (a: number, b: number): P[] => {
    const travelIn: P = [-(ARM_DIR[a] as readonly [number, number])[0], -(ARM_DIR[a] as readonly [number, number])[1]];
    const travelOut = ARM_DIR[b] as readonly [number, number];
    const ri = right(travelIn), ro = right(travelOut);
    const p0: P = [-travelIn[0] * 6 + ri[0] * 1.5, -travelIn[1] * 6 + ri[1] * 1.5];
    const p2: P = [travelOut[0] * 6 + ro[0] * 1.5, travelOut[1] * 6 + ro[1] * 1.5];
    // control point: where the two lane lines meet (the corner of the box), or the midpoint for a straight movement
    const ctrl: P = a === (b + 2) % 4 ? [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2] : [Math.abs(travelIn[0]) > 0 ? p0[0] * 0 + p2[0] : p0[0], Math.abs(travelIn[0]) > 0 ? p0[1] : p2[1]];
    const pts: P[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * ctrl[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * ctrl[1] + t * t * p2[1]]);
    }
    return pts;
  };
  const pairs: [number, number][] = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) pairs.push([a, b]);
  const turnOf = (a: number, b: number): Movement['turn'] => {
    const d = (b - a + 4) % 4; // 0 same, 1 clockwise from the approach arm
    // arm a is where the car comes from: it travels towards the centre; out arm b is where it leaves to
    if (d === 2) return 'straight';
    // coming from the north (arm 0) and leaving by the east arm (1) is a left turn; by the west arm (3) a right turn
    return d === 1 ? 'left' : 'right';
  };
  const movements: Movement[] = pairs.map(([a, b], id) => ({ id, inEdge: inEdge[a] as number, outEdge: outEdge[b] as number, turn: turnOf(a, b), lengthM: 12, conflicts: [] }));
  const paths = pairs.map(([a, b]) => path(a, b));
  movements.forEach((m, i) => {
    for (let k = 0; k < movements.length; k++) {
      if (k === i || (movements[k] as Movement).inEdge === m.inEdge) continue;
      let near = false;
      for (const p of paths[i] as P[]) for (const q of paths[k] as P[]) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 2) near = true;
      if (near) m.conflicts.push(k);
    }
  });

  const green = o.green ?? 1200, amber = o.amber ?? 180, clear = o.clear ?? 60;
  const ns = movements.filter((_, i) => (pairs[i] as [number, number])[0] % 2 === 0).map((m) => m.id);
  const ew = movements.filter((_, i) => (pairs[i] as [number, number])[0] % 2 === 1).map((m) => m.id);
  const phase = green + amber + clear;
  const program: SignalProgram = {
    id: 0, cycleTicks: phase * 2, offsetTicks: 0, pedWalkTicks: 0,
    phases: [
      { startTick: 0, greenTicks: green, amberTicks: amber, clearTicks: clear, movements: ns },
      { startTick: phase, greenTicks: green, amberTicks: amber, clearTicks: clear, movements: ew },
    ],
  };
  const centre = f.nodes[0] as RoadNode;
  centre.junction = 0;
  centre.control = control;
  const junctions: Junction[] = [{
    id: 0, nodes: [0], x: 0, z: 0, control, movements, program: control === NodeControl.Signal ? program : null,
    stopApproaches: control === NodeControl.MinorStop ? [inEdge[1] as number, inEdge[3] as number] : [],
  }];
  for (let a = 0; a < 4; a++) {
    const n = f.nodes[armNode[a] as number] as RoadNode;
    n.junction = junctions.length;
    junctions.push({
      id: junctions.length, nodes: [armNode[a] as number], x: n.x, z: n.z, control: NodeControl.DeadEnd,
      movements: [{ id: 0, inEdge: outEdge[a] as number, outEdge: inEdge[a] as number, turn: 'uturn', lengthM: 12, conflicts: [] }],
      program: null, stopApproaches: [],
    });
  }
  const chunk = chunkOf('9/256/256' as ChunkKey, f, { junctions });
  return { fixture: f, chunk, junctions, inEdge, outEdge, armNode, movement: (a, b) => pairs.findIndex(([x, y]) => x === a && y === b) };
}

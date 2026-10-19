/**
 * The gray-box Civic Center fixture (M01f): four 256 m chunks around City Hall, a 2 % slope rising to the north,
 * 12 boxes, one signalised four-way junction and sidewalks. Data in code: no network, no randomness.
 * Layout and numbering are described in tests/fixtures/world/civic-graybox/README.md.
 */
import {
  GroundClass, NodeControl, PedEdgeKind, PedNodeFlag, RoadClass, BuildingKind, TERRAIN_POSTS,
  canonicalize, chunkBounds, chunkKeyAt, sha256Hex,
  type BuildingRecord, type ChunkKey, type ChunkTags, type Junction, type Movement, type ParkedSlot, type PedEdge,
  type PedNode, type RenderChunk, type RoadEdge, type RoadNode, type RoadSegment, type SignalProgram, type SimChunk,
  type Turn,
} from '../../../../packages/shared/src/index.ts';
import { encodeL0, encodeP0, type PackHeaderInput } from '../pack/encode.ts';

export const GRAYBOX_TOOL_VERSION = 'graybox@1';
export const GRAYBOX_BAKE_ID = sha256Hex(canonicalize({ sourceHashes: {}, toolVersion: GRAYBOX_TOOL_VERSION, configHashes: {} }));
export const GRAYBOX_KEYS: readonly ChunkKey[] = ['9/256/256', '9/257/256', '9/256/257', '9/257/257'];
export const GRAYBOX_HEADER: PackHeaderInput = { tileX: 64, tileY: 64, hostZ: 7, bakeId: GRAYBOX_BAKE_ID };
export const GRAYBOX_FILES = { p0: 'p0-64-64.pack', l0: 'l0-64-64.pack' } as const;

/** Terrain in decimetres: 17.6 m at City Hall, rising 2 % to the north (-Z). A function of global z only. */
export const terrainDm = (z: number): number => 176 - Math.round(z / 5);
const terrainM = (z: number): number => terrainDm(z) / 10;
/** Snaps a metre value to the 0.1 m grid. */
const snap = (v: number): number => Math.round(v * 10) / 10;

// ---- roads ---------------------------------------------------------------------------------------------------
const J = { x: 100, z: 100 };
const BOX_HALF_DM = 93; // carriageway half width 9.3 m
const LANE_DM = 35; // lateral offset of the movement paths, 3.5 m
interface Arm { name: 'W' | 'N' | 'E' | 'S'; end: { x: number; z: number }; step: number; node: number; seg: number; outEdge: number; inEdge: number; gradePct: number }
const ARMS: readonly Arm[] = [
  { name: 'W', end: { x: -120, z: 100 }, step: 20, node: 1, seg: 0, outEdge: 0, inEdge: 4, gradePct: 0 },
  { name: 'N', end: { x: 100, z: -120 }, step: 20, node: 2, seg: 1, outEdge: 1, inEdge: 5, gradePct: 2 },
  { name: 'E', end: { x: 376, z: 100 }, step: 12, node: 3, seg: 2, outEdge: 2, inEdge: 6, gradePct: 0 },
  { name: 'S', end: { x: 100, z: 376 }, step: 12, node: 4, seg: 3, outEdge: 3, inEdge: 7, gradePct: 2 },
];
// Compass arms in clockwise order; used for the movement geometry. Vectors are (x east, z south).
const COMPASS = ['N', 'E', 'S', 'W'] as const;
const DIR: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const armOf = (name: string): Arm => ARMS.find((a) => a.name === name) as Arm;

const SEGMENT_WIDTH_M = 18.6; // 2 x 2 x 3.5 m lanes + 2 x 2.3 m parking
const SIDEWALK_OFFSET = 10.8;

type P = [number, number];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const dot = (a: P, b: P): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: P, b: P): number => a[0] * b[1] - a[1] * b[0];
const right = (v: P): P => [-v[1], v[0]];
const scale = (v: P, k: number): P => [v[0] * k, v[1] * k];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];

function segIntersect(p1: P, p2: P, p3: P, p4: P): boolean {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (a: P, b: P, c: P): boolean =>
    Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  return (d1 === 0 && on(p3, p4, p1)) || (d2 === 0 && on(p3, p4, p2)) || (d3 === 0 && on(p1, p2, p3)) || (d4 === 0 && on(p1, p2, p4));
}

/** Path through the junction box in decimetres relative to J: entry lane point, optional corner, exit lane point. */
function movementPath(approach: number, turn: 0 | 1 | 2): P[] {
  const dirA = DIR[approach] as P;
  const h = scale(dirA, -1) as P;
  const entry = add(scale(dirA, BOX_HALF_DM), scale(right(h), LANE_DM));
  const exitArm = (approach + (turn === 0 ? 2 : turn === 1 ? 1 : 3)) % 4;
  const dirB = DIR[exitArm] as P;
  const exit = add(scale(dirB, BOX_HALF_DM), scale(right(dirB), LANE_DM));
  if (turn === 0) return [entry, exit];
  const corner = add(entry, scale(h, dot(sub(exit, entry), h)));
  return [entry, corner, exit];
}
const pathLenDm = (path: P[]): number => {
  let s = 0;
  for (let i = 1; i < path.length; i++) { const d = sub(path[i] as P, path[i - 1] as P); s += Math.sqrt(d[0] * d[0] + d[1] * d[1]); }
  return Math.round(s);
};
const pathsCross = (a: P[], b: P[]): boolean => {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) if (segIntersect(a[i - 1] as P, a[i] as P, b[j - 1] as P, b[j] as P)) return true;
  return false;
};

function buildJunction(): Junction {
  const movements: Movement[] = [];
  const meta: { id: number; approach: number; turn: 0 | 1 | 2; path: P[]; out: number }[] = [];
  const turns: Turn[] = ['straight', 'left', 'right'];
  for (let a = 0; a < 4; a++) {
    for (const t of [0, 1, 2] as const) {
      const exitArm = (a + (t === 0 ? 2 : t === 1 ? 1 : 3)) % 4;
      meta.push({ id: a * 3 + t, approach: a, turn: t, path: movementPath(a, t), out: armOf(COMPASS[exitArm] as string).outEdge });
    }
  }
  for (const m of meta) {
    const conflicts = meta
      .filter((o) => o.id !== m.id && o.approach !== m.approach && (o.out === m.out || pathsCross(m.path, o.path)))
      .map((o) => o.id);
    movements.push({
      id: m.id, inEdge: armOf(COMPASS[m.approach] as string).inEdge, outEdge: m.out, turn: turns[m.turn] as Turn,
      lengthM: pathLenDm(m.path) / 10, conflicts,
    });
  }
  const phaseOf = (approaches: number[]): number[] => meta.filter((m) => approaches.includes(m.approach)).map((m) => m.id);
  const program: SignalProgram = {
    id: 0, cycleTicks: 3600, offsetTicks: 0, pedWalkTicks: 0,
    phases: [
      { startTick: 0, greenTicks: 1500, amberTicks: 240, clearTicks: 60, movements: phaseOf([0, 2]) },
      { startTick: 1800, greenTicks: 1500, amberTicks: 240, clearTicks: 60, movements: phaseOf([1, 3]) },
    ],
  };
  return { id: 0, nodes: [0], x: J.x, z: J.z, control: NodeControl.Signal, movements, program, stopApproaches: [] };
}

// ---- per-chunk accumulators -----------------------------------------------------------------------------------
interface Acc {
  key: ChunkKey; ox: number; oz: number;
  nodes: RoadNode[]; edges: RoadEdge[]; segments: RoadSegment[]; junctions: Junction[];
  pedNodes: PedNode[]; pedEdges: PedEdge[]; prisms: number[]; tags: ChunkTags; parked: ParkedSlot[];
  buildings: BuildingRecord[]; trees: number[]; lamps: number[];
}
const accs = (): Map<ChunkKey, Acc> => {
  const m = new Map<ChunkKey, Acc>();
  for (const key of GRAYBOX_KEYS) {
    const b = chunkBounds(key);
    m.set(key, {
      key, ox: b.minX, oz: b.minZ, nodes: [], edges: [], segments: [], junctions: [], pedNodes: [], pedEdges: [], prisms: [],
      tags: { hidingSpots: [], pursuitBreakers: [], chokePoints: [], jumpZones: [], portals: [], shoreNodes: [] },
      parked: [], buildings: [], trees: [], lamps: [],
    });
  }
  return m;
};
const chunkAt = (m: Map<ChunkKey, Acc>, x: number, z: number): Acc => {
  const a = m.get(chunkKeyAt(9, x, z));
  if (!a) throw new Error(`graybox: (${x}, ${z}) is outside the fixture chunks`);
  return a;
};

function addRoads(m: Map<ChunkKey, Acc>): void {
  const nodePos: { id: number; x: number; z: number }[] = [{ id: 0, ...J }, ...ARMS.map((a) => ({ id: a.node, ...a.end }))];
  for (const n of [...nodePos].sort((a, b) => a.id - b.id)) {
    const isJ = n.id === 0;
    chunkAt(m, n.x, n.z).nodes.push({
      id: n.id, x: n.x, y: terrainM(n.z), z: n.z, layer: 0, control: isJ ? NodeControl.Signal : NodeControl.DeadEnd, junction: isJ ? 0 : -1,
    });
  }
  const mkEdge = (id: number, a: Arm, dir: 1 | -1, from: number, to: number, twin: number): RoadEdge => ({
    id, seg: a.seg, dir, from, to, twin, cls: RoadClass.Arterial, lanes: 2, laneWidthM: 3.5, speedMps: 13.5, flags: 0, layer: 0,
    medianM: 0, parkingSides: 2, maxGradePct: a.gradePct, nhood: 255,
  });
  const edges: { e: RoadEdge; at: { x: number; z: number } }[] = [];
  for (const a of ARMS) {
    edges.push({ e: mkEdge(a.outEdge, a, 1, 0, a.node, a.inEdge), at: J });
    edges.push({ e: mkEdge(a.inEdge, a, -1, a.node, 0, a.outEdge), at: a.end });
  }
  for (const { e, at } of edges.sort((p, q) => p.e.id - q.e.id)) chunkAt(m, at.x, at.z).edges.push(e);

  // Segments are stored once, with the lower-id (outward) direction, in the chunk that owns that edge: all in 256/256.
  for (const a of ARMS) {
    const horizontal = a.end.z === J.z;
    const len = Math.abs(horizontal ? a.end.x - J.x : a.end.z - J.z);
    const n = len / a.step;
    const sign = Math.sign(horizontal ? a.end.x - J.x : a.end.z - J.z);
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const x = horizontal ? J.x + sign * a.step * i : J.x;
      const z = horizontal ? J.z : J.z + sign * a.step * i;
      pts.push(snap(x), terrainM(z), snap(z));
    }
    let lengthM = 0;
    for (let i = 3; i < pts.length; i += 3) {
      lengthM += Math.sqrt(((pts[i] as number) - (pts[i - 3] as number)) ** 2 + ((pts[i + 1] as number) - (pts[i - 2] as number)) ** 2 + ((pts[i + 2] as number) - (pts[i - 1] as number)) ** 2);
    }
    chunkAt(m, J.x, J.z).segments.push({ id: a.seg, pts: Float32Array.from(pts), lengthM, widthM: SEGMENT_WIDTH_M, osmWay: 0, cnn: 0 });
  }
  chunkAt(m, J.x, J.z).junctions.push(buildJunction());
}

// ---- sidewalks ---------------------------------------------------------------------------------------------------
function addPedestrians(m: Map<ChunkKey, Acc>): void {
  const lo = J.x - SIDEWALK_OFFSET; // 89.2
  const hi = J.x + SIDEWALK_OFFSET; // 110.8
  const nodeSpec: { label: string; x: number; z: number; flags: number }[] = [
    { label: 'CNW', x: lo, z: lo, flags: PedNodeFlag.Crossing }, { label: 'CNE', x: hi, z: lo, flags: PedNodeFlag.Crossing },
    { label: 'CSE', x: hi, z: hi, flags: PedNodeFlag.Crossing }, { label: 'CSW', x: lo, z: hi, flags: PedNodeFlag.Crossing },
    { label: 'Wn', x: -120, z: lo, flags: 0 }, { label: 'Ws', x: -120, z: hi, flags: 0 },
    { label: 'Nw', x: lo, z: -120, flags: 0 }, { label: 'Ne', x: hi, z: -120, flags: 0 },
    { label: 'Bxn', x: 128, z: lo, flags: 0 }, { label: 'Bxs', x: 128, z: hi, flags: 0 },
    { label: 'Bzw', x: lo, z: 128, flags: 0 }, { label: 'Bze', x: hi, z: 128, flags: 0 },
    // duplicate boundary nodes in the neighbour chunk, then the far ends
    { label: "Bxn'", x: 128, z: lo, flags: 0 }, { label: "Bxs'", x: 128, z: hi, flags: 0 },
    { label: 'En', x: 376, z: lo, flags: 0 }, { label: 'Es', x: 376, z: hi, flags: 0 },
    { label: "Bzw'", x: lo, z: 128, flags: 0 }, { label: "Bze'", x: hi, z: 128, flags: 0 },
    { label: 'Sw', x: lo, z: 376, flags: 0 }, { label: 'Se', x: hi, z: 376, flags: 0 },
  ];
  // Duplicate boundary nodes sit exactly on the chunk edge, so the owning chunk is chosen by label.
  const ownerOf = (label: string, x: number, z: number): Acc => {
    if (label === "Bxn'" || label === "Bxs'") return m.get('9/257/256') as Acc;
    if (label === "Bzw'" || label === "Bze'") return m.get('9/256/257') as Acc;
    if (label === 'Bxn' || label === 'Bxs' || label === 'Bzw' || label === 'Bze') return m.get('9/256/256') as Acc;
    return chunkAt(m, x, z);
  };
  const ids = new Map<string, number>();
  let next = 0;
  for (const key of GRAYBOX_KEYS) {
    for (const n of nodeSpec) {
      const owner = ownerOf(n.label, n.x, n.z);
      if (owner.key !== key) continue;
      ids.set(n.label, next);
      owner.pedNodes.push({ id: next, x: snap(n.x), y: terrainM(n.z), z: snap(n.z), flags: n.flags });
      next++;
    }
  }
  const id = (l: string): number => ids.get(l) as number;
  const edge = (acc: Acc, a: string, b: string, kind: PedEdgeKind, widthM: number, junction: number, movement: number): void => {
    acc.pedEdges.push({ a: id(a), b: id(b), kind, widthM, junction, movement });
  };
  const c0 = m.get('9/256/256') as Acc;
  const sw = (a: string, b: string): void => edge(c0, a, b, PedEdgeKind.Sidewalk, 3, -1, -1);
  sw('Wn', 'CNW'); sw('Ws', 'CSW'); sw('Nw', 'CNW'); sw('Ne', 'CNE'); sw('CNE', 'Bxn'); sw('CSE', 'Bxs'); sw('CSW', 'Bzw'); sw('CSE', 'Bze');
  // Crosswalks (4 m): the movement is the parallel straight movement (N leg: from W, E leg: from S, S leg: from E, W leg: from N).
  edge(c0, 'CNW', 'CNE', PedEdgeKind.Crosswalk, 4, 0, 9);
  edge(c0, 'CNE', 'CSE', PedEdgeKind.Crosswalk, 4, 0, 6);
  edge(c0, 'CSE', 'CSW', PedEdgeKind.Crosswalk, 4, 0, 3);
  edge(c0, 'CSW', 'CNW', PedEdgeKind.Crosswalk, 4, 0, 0);
  const c1 = m.get('9/257/256') as Acc;
  edge(c1, "Bxn'", 'En', PedEdgeKind.Sidewalk, 3, -1, -1);
  edge(c1, "Bxs'", 'Es', PedEdgeKind.Sidewalk, 3, -1, -1);
  const c2 = m.get('9/256/257') as Acc;
  edge(c2, "Bzw'", 'Sw', PedEdgeKind.Sidewalk, 3, -1, -1);
  edge(c2, "Bze'", 'Se', PedEdgeKind.Sidewalk, 3, -1, -1);
}

// ---- boxes, tags, spawn, render objects ------------------------------------------------------------------------------
const BOXES: readonly { key: ChunkKey; x: number; z: number; w: number; d: number; h: number }[] = [
  { key: '9/256/256', x: 40, z: 40, w: 20, d: 20, h: 12 }, { key: '9/256/256', x: -60, z: 40, w: 30, d: 16, h: 24 },
  { key: '9/256/256', x: 40, z: -60, w: 16, d: 30, h: 6 },
  { key: '9/257/256', x: 200, z: 40, w: 24, d: 24, h: 30 }, { key: '9/257/256', x: 300, z: -60, w: 20, d: 40, h: 9 },
  { key: '9/257/256', x: 300, z: 50, w: 12, d: 12, h: 1 },
  { key: '9/256/257', x: 40, z: 200, w: 20, d: 20, h: 15 }, { key: '9/256/257', x: -60, z: 300, w: 30, d: 30, h: 4.5 },
  { key: '9/256/257', x: 40, z: 300, w: 10, d: 10, h: 3 },
  { key: '9/257/257', x: 200, z: 200, w: 30, d: 20, h: 18 }, { key: '9/257/257', x: 300, z: 300, w: 40, d: 40, h: 27 },
  { key: '9/257/257', x: 220, z: 320, w: 8, d: 8, h: 2 },
];
const KIND_CYCLE = [BuildingKind.Commercial, BuildingKind.ResMid, BuildingKind.Civic] as const;

function addBoxes(m: Map<ChunkKey, Acc>): void {
  BOXES.forEach((b, index) => {
    const acc = m.get(b.key) as Acc;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    const baseDm = terrainDm(z1); // ground at the southern (lowest) edge
    const corners: P[] = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]; // NW, SW, SE, NE
    acc.prisms.push(4, baseDm / 10, b.h);
    for (const [x, z] of corners) acc.prisms.push(x, z);
    const ring = new Int16Array(8);
    corners.forEach(([x, z], i) => { ring[i * 2] = Math.round((x - acc.ox) * 10); ring[i * 2 + 1] = Math.round((z - acc.oz) * 10); });
    acc.buildings.push({
      baseDm, heightDm: Math.round(b.h * 10), kind: KIND_CYCLE[index % 3] as BuildingKind, roof: 0, palette: index, seed: index, proxyOf: 0, ring,
    });
  });
}

function addDressing(m: Map<ChunkKey, Acc>): void {
  const lo = J.x - SIDEWALK_OFFSET, hi = J.x + SIDEWALK_OFFSET;
  const trees: [number, number][] = [[40, lo], [160, hi], [-60, hi], [260, lo], [lo, 40], [hi, -60], [lo, 200], [hi, 300]];
  trees.forEach(([x, z], i) => chunkAt(m, x, z).trees.push(snap(x), snap(z), 1, i % 3));
  for (let k = 0; k < 4; k++) {
    const x = 130 + 30 * k;
    chunkAt(m, x, hi).lamps.push(x, snap(hi), 0); // E-W street, south sidewalk
    const z = 130 + 30 * k;
    chunkAt(m, lo, z).lamps.push(snap(lo), z, 64 * (6.283185307179586 / 256)); // N-S street, west sidewalk
  }
}

function addTagsAndSpawn(m: Map<ChunkKey, Acc>): void {
  (m.get('9/256/256') as Acc).tags.teleportNodes = [
    { id: 'tp.graybox.spawn', x: 89, y: terrainM(60), z: 60, yaw: 0, kind: 'spawn' },
  ];
  for (const [key, seg] of [['9/256/256', 0], ['9/257/256', 2]] as const) {
    const acc = m.get(key) as Acc;
    [30, 50, 70, 90].forEach((s, i) => acc.parked.push({ slot: 512 + i, seg, s, side: i % 2 === 0 ? 1 : -1, yawJitterDm: 0 }));
  }
}

function groundGrid(acc: Acc): Uint8Array {
  const g = new Uint8Array(64 * 64);
  const centre = (origin: number, i: number): number => (origin + 4 * i + 2) * 10;
  for (let r = 0; r < 64; r++) {
    for (let c = 0; c < 64; c++) {
      const x = centre(acc.ox, c), z = centre(acc.oz, r);
      const inX = x >= -1200 && x <= 3760, inZ = z >= -1200 && z <= 3760;
      const ewRoad = inX && Math.abs(z - 1000) <= 93, nsRoad = inZ && Math.abs(x - 1000) <= 93;
      const ewWalk = inX && (Math.abs(z - 892) <= 15 || Math.abs(z - 1108) <= 15);
      const nsWalk = inZ && (Math.abs(x - 892) <= 15 || Math.abs(x - 1108) <= 15);
      g[r * 64 + c] = ewRoad || nsRoad ? GroundClass.Asphalt : ewWalk || nsWalk ? GroundClass.Sidewalk : GroundClass.Grass;
    }
  }
  return g;
}

export interface Graybox { header: PackHeaderInput; sim: SimChunk[]; render: RenderChunk[] }

export function buildGraybox(): Graybox {
  const m = accs();
  addRoads(m);
  addPedestrians(m);
  addBoxes(m);
  addDressing(m);
  addTagsAndSpawn(m);
  const sim: SimChunk[] = [];
  const render: RenderChunk[] = [];
  for (const key of GRAYBOX_KEYS) {
    const a = m.get(key) as Acc;
    const dm = new Int16Array(TERRAIN_POSTS * TERRAIN_POSTS);
    for (let r = 0; r < TERRAIN_POSTS; r++) for (let c = 0; c < TERRAIN_POSTS; c++) dm[r * TERRAIN_POSTS + c] = terrainDm(a.oz + 4 * r);
    const height = { originX: a.ox, originZ: a.oz, cellM: 4, dm };
    const ground = groundGrid(a);
    sim.push({
      key, bakeId: GRAYBOX_BAKE_ID, height, prisms: Float32Array.from(a.prisms), slabs: new Float32Array(0), hoods: new Float32Array(0),
      segments: a.segments, edges: a.edges, nodes: a.nodes, junctions: a.junctions, pedNodes: a.pedNodes, pedEdges: a.pedEdges,
      tags: a.tags, spawn: { cellKey: key, densityProfile: 0, trafficSlots: 8, pedSlots: 16, parked: a.parked }, ground,
    });
    render.push({
      key, z: 9, bakeId: GRAYBOX_BAKE_ID, height, ground, buildings: a.buildings, trees: Float32Array.from(a.trees),
      lamps: Float32Array.from(a.lamps), furniture: new Float32Array(0), landmarks: [],
    });
  }
  return { header: GRAYBOX_HEADER, sim, render };
}

export function encodeGraybox(): Record<(typeof GRAYBOX_FILES)[keyof typeof GRAYBOX_FILES], Uint8Array> {
  const g = buildGraybox();
  return { [GRAYBOX_FILES.p0]: encodeP0(g.sim, g.header), [GRAYBOX_FILES.l0]: encodeL0(g.render, g.header) };
}

/**
 * The road network the router and the queries read (M02c1; 02-world-contracts.md rules 8 and 9). It merges two sources that
 * share one id space (`EdgeId` and `NodeId` are dense per bake):
 *
 *  - the always-resident topology `map_data/sf-graph.v1` (nodes, edges, lengths, classes, flags; no geometry), which holds every
 *    edge of the bake and so fixes the structure;
 *  - the resident `p0` chunks, which add geometry, lanes, junction movements and signal programs for the edges around the player.
 *
 * Without a topology (hand-built fixtures, a session that has not loaded it yet) the structure is the union of the resident
 * chunks and is rebuilt after every residency change. With one, residency only adds detail and never changes the structure.
 * Pure; C02 lint applies.
 */
import type { ChunkKey, EdgeId, GraphTopology, Junction, NodeId, RoadEdge, RoadNode, RoadSegment, SimChunk } from '@dv/shared';

/** A resident directed edge with its shared segment. */
export interface ResidentEdge {
  edge: Readonly<RoadEdge>;
  seg: Readonly<RoadSegment>;
  chunk: ChunkKey;
}

interface ChunkRecord {
  edges: EdgeId[];
  nodes: NodeId[];
  junctions: number[];
  moves: EdgeId[];
}

const EMPTY: Int32Array = new Int32Array(0);

export const EDGE_ONEWAY = 1;

export class RoadNetwork {
  /** Bumped by every residency change; caches keyed on it stay valid between changes. */
  version = 0;

  private topo: GraphTopology | null;
  private readonly residentEdges = new Map<EdgeId, ResidentEdge>();
  private readonly residentNodes = new Map<NodeId, RoadNode>();
  private readonly junctionById = new Map<number, Junction>();
  private readonly movesByIn = new Map<EdgeId, EdgeId[]>();
  private readonly chunks = new Map<ChunkKey, ChunkRecord>();
  private readonly chunkEdgeIds = new Map<ChunkKey, EdgeId[]>();

  // dense tables (from the topology once, from the resident chunks when there is none)
  private dirty = true;
  private nEdges = 0;
  private nNodes = 0;
  private eFrom = new Int32Array(0);
  private eTo = new Int32Array(0);
  private eLen = new Int32Array(0);
  private eCls = new Uint8Array(0);
  private eFlags = new Uint16Array(0);
  private eSpeed = new Float32Array(0);
  private eLayer = new Int8Array(0);
  private eLanes = new Uint8Array(0);
  private nX = new Float64Array(0);
  private nY = new Float64Array(0);
  private nZ = new Float64Array(0);
  private nLayer = new Int8Array(0);
  private nControl = new Uint8Array(0);
  private outStart = new Int32Array(1);
  private outList = EMPTY;
  private inStart: Int32Array | null = null;
  private inList = EMPTY;

  constructor(topology: GraphTopology | null = null) {
    this.topo = topology;
  }

  /** Installs the topology once it has loaded (it arrives after the first chunks): the structure is rebuilt from it. */
  setTopology(t: GraphTopology): void {
    this.topo = t;
    this.dirty = true;
    this.version++;
  }

  get hasTopology(): boolean {
    return this.topo !== null;
  }

  get bakeId(): string | null {
    return this.topo?.bakeId ?? null;
  }

  // ---- residency ---------------------------------------------------------------------------------------------------------

  hasChunk(key: ChunkKey): boolean {
    return this.chunks.has(key);
  }

  /** Adds the road data of a resident chunk (replacing what the same key held). */
  addChunk(c: Readonly<SimChunk>): void {
    if (this.chunks.has(c.key)) this.removeChunk(c.key);
    const rec: ChunkRecord = { edges: [], nodes: [], junctions: [], moves: [] };
    const segs = new Map<number, RoadSegment>();
    for (const s of c.segments) segs.set(s.id, s);
    const ids: EdgeId[] = [];
    for (const e of c.edges) {
      const seg = segs.get(e.seg);
      if (!seg) continue;
      this.residentEdges.set(e.id, { edge: e, seg, chunk: c.key });
      rec.edges.push(e.id);
      ids.push(e.id);
    }
    this.chunkEdgeIds.set(c.key, ids);
    for (const n of c.nodes) {
      this.residentNodes.set(n.id, n);
      rec.nodes.push(n.id);
    }
    for (const j of c.junctions) {
      this.junctionById.set(j.id, j);
      rec.junctions.push(j.id);
      const byIn = new Map<EdgeId, EdgeId[]>();
      for (const m of j.movements) {
        const list = byIn.get(m.inEdge) ?? [];
        if (list.indexOf(m.outEdge) < 0) list.push(m.outEdge);
        byIn.set(m.inEdge, list);
      }
      for (const [inEdge, outs] of byIn) {
        outs.sort((a, b) => a - b);
        this.movesByIn.set(inEdge, outs);
        rec.moves.push(inEdge);
      }
    }
    this.chunks.set(c.key, rec);
    this.touch();
  }

  removeChunk(key: ChunkKey): void {
    const rec = this.chunks.get(key);
    if (!rec) return;
    for (const e of rec.edges) this.residentEdges.delete(e);
    for (const n of rec.nodes) this.residentNodes.delete(n);
    for (const j of rec.junctions) this.junctionById.delete(j);
    for (const m of rec.moves) this.movesByIn.delete(m);
    this.chunks.delete(key);
    this.chunkEdgeIds.delete(key);
    this.touch();
  }

  residentKeys(): ChunkKey[] {
    return [...this.chunks.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Resident edge ids of one chunk, ascending as stored. */
  chunkEdges(key: ChunkKey): readonly EdgeId[] {
    return this.chunkEdgeIds.get(key) ?? [];
  }

  private touch(): void {
    this.version++;
    if (!this.topo) this.dirty = true;
  }

  // ---- resident detail ---------------------------------------------------------------------------------------------------

  resident(e: EdgeId): ResidentEdge | undefined {
    return this.residentEdges.get(e);
  }

  residentNode(n: NodeId): RoadNode | undefined {
    return this.residentNodes.get(n);
  }

  junction(id: number): Junction | undefined {
    return this.junctionById.get(id);
  }

  /** Out-edges a vehicle may take after `inEdge` according to the resident junction movements, or undefined when none are known. */
  movements(inEdge: EdgeId): readonly EdgeId[] | undefined {
    return this.movesByIn.get(inEdge);
  }

  // ---- dense tables ------------------------------------------------------------------------------------------------------

  private ensure(): void {
    if (this.dirty) this.build();
  }

  private build(): void {
    this.dirty = false;
    this.inStart = null;
    if (this.topo) {
      const t = this.topo;
      const ne = t.edges.length;
      const nn = t.nodes.length;
      this.nEdges = ne;
      this.nNodes = nn;
      this.eFrom = new Int32Array(ne);
      this.eTo = new Int32Array(ne);
      this.eLen = new Int32Array(ne);
      this.eCls = new Uint8Array(ne);
      this.eFlags = new Uint16Array(ne);
      this.eSpeed = new Float32Array(ne);
      this.eLayer = new Int8Array(ne);
      this.eLanes = new Uint8Array(ne);
      for (let i = 0; i < ne; i++) {
        const e = t.edges[i]!;
        this.eFrom[i] = e.from;
        this.eTo[i] = e.to;
        this.eLen[i] = Math.round(e.lengthM * 10);
        this.eCls[i] = e.cls;
        this.eFlags[i] = e.flags;
        this.eSpeed[i] = e.speedMps;
        this.eLayer[i] = e.layer;
        this.eLanes[i] = e.lanes;
      }
      this.nX = new Float64Array(nn);
      this.nY = new Float64Array(nn);
      this.nZ = new Float64Array(nn);
      this.nLayer = new Int8Array(nn);
      this.nControl = new Uint8Array(nn);
      for (let i = 0; i < nn; i++) {
        const n = t.nodes[i]!;
        this.nX[i] = n.x;
        this.nY[i] = n.y;
        this.nZ[i] = n.z;
        this.nLayer[i] = n.layer;
        this.nControl[i] = n.control;
      }
    } else {
      let maxE = -1;
      let maxN = -1;
      for (const [id, r] of this.residentEdges) {
        if (id > maxE) maxE = id;
        if (r.edge.from > maxN) maxN = r.edge.from;
        if (r.edge.to > maxN) maxN = r.edge.to;
      }
      for (const id of this.residentNodes.keys()) if (id > maxN) maxN = id;
      const ne = maxE + 1;
      const nn = maxN + 1;
      this.nEdges = ne;
      this.nNodes = nn;
      this.eFrom = new Int32Array(ne).fill(-1);
      this.eTo = new Int32Array(ne).fill(-1);
      this.eLen = new Int32Array(ne);
      this.eCls = new Uint8Array(ne);
      this.eFlags = new Uint16Array(ne);
      this.eSpeed = new Float32Array(ne);
      this.eLayer = new Int8Array(ne);
      this.eLanes = new Uint8Array(ne);
      for (const [id, r] of this.residentEdges) {
        this.eFrom[id] = r.edge.from;
        this.eTo[id] = r.edge.to;
        this.eLen[id] = Math.round(r.seg.lengthM * 10);
        this.eCls[id] = r.edge.cls;
        this.eFlags[id] = r.edge.flags;
        this.eSpeed[id] = r.edge.speedMps;
        this.eLayer[id] = r.edge.layer;
        this.eLanes[id] = r.edge.lanes;
      }
      this.nX = new Float64Array(nn);
      this.nY = new Float64Array(nn);
      this.nZ = new Float64Array(nn);
      this.nLayer = new Int8Array(nn);
      this.nControl = new Uint8Array(nn);
      for (const [id, n] of this.residentNodes) {
        this.nX[id] = n.x;
        this.nY[id] = n.y;
        this.nZ[id] = n.z;
        this.nLayer[id] = n.layer;
        this.nControl[id] = n.control;
      }
    }
    // out-edges per node, ascending edge id
    const nn = this.nNodes;
    const ne = this.nEdges;
    const start = new Int32Array(nn + 1);
    for (let e = 0; e < ne; e++) {
      const f = this.eFrom[e] as number;
      if (f >= 0) start[f + 1] = (start[f + 1] as number) + 1;
    }
    for (let i = 0; i < nn; i++) start[i + 1] = (start[i + 1] as number) + (start[i] as number);
    const fill = start.slice(0, nn);
    const list = new Int32Array(start[nn] as number);
    for (let e = 0; e < ne; e++) {
      const f = this.eFrom[e] as number;
      if (f < 0) continue;
      list[fill[f] as number] = e;
      fill[f] = (fill[f] as number) + 1;
    }
    this.outStart = start;
    this.outList = list;
  }

  private ensureIn(): void {
    this.ensure();
    if (this.inStart) return;
    const nn = this.nNodes;
    const ne = this.nEdges;
    const start = new Int32Array(nn + 1);
    for (let e = 0; e < ne; e++) {
      const t = this.eTo[e] as number;
      if (t >= 0 && (this.eFrom[e] as number) >= 0) start[t + 1] = (start[t + 1] as number) + 1;
    }
    for (let i = 0; i < nn; i++) start[i + 1] = (start[i + 1] as number) + (start[i] as number);
    const fill = start.slice(0, nn);
    const list = new Int32Array(start[nn] as number);
    for (let e = 0; e < ne; e++) {
      const t = this.eTo[e] as number;
      if (t < 0 || (this.eFrom[e] as number) < 0) continue;
      list[fill[t] as number] = e;
      fill[t] = (fill[t] as number) + 1;
    }
    this.inStart = start;
    this.inList = list;
  }

  get edgeCount(): number {
    this.ensure();
    return this.nEdges;
  }

  get nodeCount(): number {
    this.ensure();
    return this.nNodes;
  }

  has(e: EdgeId): boolean {
    this.ensure();
    return Number.isInteger(e) && e >= 0 && e < this.nEdges && (this.eFrom[e] as number) >= 0;
  }

  from(e: EdgeId): NodeId {
    this.ensure();
    return this.eFrom[e] as number;
  }
  to(e: EdgeId): NodeId {
    this.ensure();
    return this.eTo[e] as number;
  }
  /** Length in decimetres (the unit of every route cost). */
  lenDm(e: EdgeId): number {
    this.ensure();
    return this.eLen[e] as number;
  }
  cls(e: EdgeId): number {
    this.ensure();
    return this.eCls[e] as number;
  }
  flags(e: EdgeId): number {
    this.ensure();
    return this.eFlags[e] as number;
  }
  speedMps(e: EdgeId): number {
    this.ensure();
    return this.eSpeed[e] as number;
  }
  layer(e: EdgeId): number {
    this.ensure();
    return this.eLayer[e] as number;
  }
  lanes(e: EdgeId): number {
    this.ensure();
    return this.eLanes[e] as number;
  }

  nodeX(n: NodeId): number {
    this.ensure();
    return this.nX[n] as number;
  }
  nodeY(n: NodeId): number {
    this.ensure();
    return this.nY[n] as number;
  }
  nodeZ(n: NodeId): number {
    this.ensure();
    return this.nZ[n] as number;
  }
  nodeLayer(n: NodeId): number {
    this.ensure();
    return this.nLayer[n] as number;
  }
  nodeControl(n: NodeId): number {
    this.ensure();
    return this.nControl[n] as number;
  }
  hasNode(n: NodeId): boolean {
    this.ensure();
    return Number.isInteger(n) && n >= 0 && n < this.nNodes;
  }

  /** Out-edges of a node, ascending by id (a view into the table; do not modify). */
  out(n: NodeId): Int32Array {
    this.ensure();
    if (!(n >= 0 && n < this.nNodes)) return EMPTY;
    return this.outList.subarray(this.outStart[n] as number, this.outStart[n + 1] as number);
  }

  /** In-edges of a node, ascending by id. */
  into(n: NodeId): Int32Array {
    this.ensureIn();
    if (!(n >= 0 && n < this.nNodes)) return EMPTY;
    const s = this.inStart as Int32Array;
    return this.inList.subarray(s[n] as number, s[n + 1] as number);
  }

  /** True when `f` runs back along the street `e` came from (the same two nodes, opposite direction, equal length). */
  isReverseOf(f: EdgeId, e: EdgeId): boolean {
    return this.to(f) === this.from(e) && this.from(f) === this.to(e) && this.lenDm(f) === this.lenDm(e);
  }
}

/**
 * The vegetation pools (M02h4; C08 1.1 rule 12): the street trees of every resident L0 unit drawn by a few global `InstancedMesh`es
 * outside the unit bundles, one per geometry of the active set (`chunks/tree-forms.ts`), instead of one instanced mesh per unit.
 *
 *  - Pools: 10 on `full` (five forms, each a `near` and a `far` pool), 5 on `lite`, 2 on `low`, 1 on `cone` (`world.treeForms: false`).
 *    On `full` the units within `dynamicCasterRadiusM` of the focus put their trees in the `near` pools, the only ones that cast
 *    (M02g1's tree casters, on the `casters` layer); the rest in the `far` pools.
 *  - Ranges: every L0 unit owns a range in every pool its trees use, allocated on upload and freed on removal. The ranges of the units
 *    whose trees are drawn (within `tree.drawM`, 10 % hysteresis) are packed at the front of the pool, and `count` is their sum; the
 *    hidden units' ranges lie beyond it, where freed ranges are reused first fit. A unit that crosses `tree.drawM` moves only the tail
 *    of the drawn prefix (the units after it slide down, or it joins at the end), written with a partial upload (`addUpdateRange`, which
 *    three@0.186.1 has on both backends). Capacity only doubles; a doubling rebuilds the pool's mesh with the larger buffers.
 *  - `frustumCulled = false` (the pools span the city) and `visible = count > 0`, so an empty pool is no render object.
 *  - The instance data: the matrix (the tree's position, yaw and height scale) and `aTint` (the crown tint, and the height in metres in
 *    `w` for the wind, `look/wind.ts`).
 *
 * `PoolLayout` is the range bookkeeping alone (no `three`), so the tests drive it through thousands of steps; `VegetationPools` owns the
 * meshes.
 *
 * M02h5 (the scatter, `ScatterPoolOptions`): the understory pools (`full` shrub and hedge, `lite` shrub; on `low` shrubs and hedges are
 * flattened instances of the `crown` pool) and the impostor pools (`full`, `lite` crown and palm cards, `min` the crown card; none on
 * `legacy` or the cone). Each kept instance has a band: within `tree.drawM` (the unit's `drawn`) a tree draws once, as its form's mesh
 * within `impostorM` (10 % hysteresis), otherwise as an impostor (`chunks/impostors.ts`); shrubs and hedges within `shrubDrawM`. Bands are
 * decided when a unit lands and re-decided after `rebandM` of camera travel for the units whose distance interval reaches a band edge
 * (crossing units only); a changed band makes the unit's entry in the affected pools stale, and the stale entries are written at most
 * `writeCap` instance writes per frame (counted against the tier's upload cap too). Thinning (bit 7 only, a positional hash against
 * `keepTree` / `keepShrub`) decides once per record; street trees are never thinned.
 */
import { BufferAttribute, BufferGeometry, type Group, InstancedBufferAttribute, InstancedMesh, type Material, Sphere, Vector3 } from 'three/webgpu';
import { TreeForm, isUnderstoryForm, treeFormOfByte } from '@dv/shared';
import { IMPOSTOR_IDS, buildImpostorSet } from './impostors.ts';
import { TREE_STRIDE, laneForm, laneScatter, laneTint } from './mesher.ts';
import {
  SET_GEOMETRIES, buildTreeSet, buildUnderstorySet, geometryOfForm, instanceScaleOf, tintOf, type TreeGeometryData, type TreeGeometryId, type TreeSet,
} from './tree-forms.ts';

// ---- the range bookkeeping --------------------------------------------------------------------------------------------------

export interface PoolRange {
  start: number;
  len: number;
  drawn: boolean;
}

/** One write the pool owes the GPU: the unit's instances at `start` (its source data, `len` instances). */
export interface PoolWrite {
  id: string;
  start: number;
  len: number;
}

export const MIN_CAPACITY = 64;

export class PoolLayout {
  capacity: number;
  /** The drawn prefix: the sum of the drawn ranges. */
  count = 0;
  readonly ranges = new Map<string, PoolRange>();
  /** The drawn units in prefix order. */
  readonly order: string[] = [];
  /** Free intervals `[start, end)` beyond `count`, sorted and merged. */
  readonly free: [number, number][] = [];
  /** Doublings so far (each one rebuilds the mesh). */
  grows = 0;

  constructor(capacity = MIN_CAPACITY) {
    let c = MIN_CAPACITY;
    while (c < capacity) c *= 2;
    this.capacity = c;
    this.free.push([0, c]);
  }

  /** Adds a unit with `len` instances, drawn (in the prefix) or hidden. Returns the writes it causes. */
  add(id: string, len: number, drawn: boolean): PoolWrite[] {
    if (this.ranges.has(id)) throw new Error(`pool: ${id} is already in the pool`);
    if (len <= 0) return [];
    const out: PoolWrite[] = [];
    if (drawn) this.appendDrawn(id, len, out);
    else {
      const start = this.alloc(len, out);
      this.ranges.set(id, { start, len, drawn: false });
      out.push({ id, start, len });
    }
    return out;
  }

  /** Removes a unit: a drawn one closes its gap in the prefix, a hidden one frees its range. */
  remove(id: string): PoolWrite[] {
    const r = this.ranges.get(id);
    if (!r) return [];
    const out: PoolWrite[] = [];
    if (r.drawn) this.leavePrefix(id, r, out);
    else this.release(r.start, r.start + r.len);
    this.ranges.delete(id);
    return out;
  }

  /** A unit's trees cross the draw distance. */
  setDrawn(id: string, drawn: boolean): PoolWrite[] {
    const r = this.ranges.get(id);
    if (!r || r.drawn === drawn) return [];
    const out: PoolWrite[] = [];
    if (drawn) {
      this.release(r.start, r.start + r.len);
      this.ranges.delete(id);
      this.appendDrawn(id, r.len, out);
    } else {
      this.leavePrefix(id, r, out);
      const start = this.alloc(r.len, out);
      this.ranges.set(id, { start, len: r.len, drawn: false });
      out.push({ id, start, len: r.len });
    }
    return out;
  }

  /** M02h5: an independent copy (the re-banding dry-runs a step on it to count its writes before it commits). */
  clone(): PoolLayout {
    const c = new PoolLayout(this.capacity);
    c.capacity = this.capacity;
    c.count = this.count;
    c.grows = this.grows;
    for (const [k, r] of this.ranges) c.ranges.set(k, { ...r });
    c.order.push(...this.order);
    c.free.length = 0;
    for (const f of this.free) c.free.push([f[0], f[1]]);
    return c;
  }

  /** Instances held, drawn or not. */
  get used(): number {
    let n = 0;
    for (const r of this.ranges.values()) n += r.len;
    return n;
  }

  private appendDrawn(id: string, len: number, out: PoolWrite[]): void {
    while (this.count + len > this.capacity) this.grow();
    // the window [count, count + len) joins the prefix: the hidden ranges in it move out first
    const lo = this.count, hi = this.count + len;
    const moved: [string, PoolRange][] = [];
    for (const [k, r] of this.ranges) if (!r.drawn && r.start < hi && r.start + r.len > lo) moved.push([k, r]);
    for (const [, r] of moved) this.release(r.start, r.start + r.len);
    this.take(lo, hi);
    this.count = hi;
    this.ranges.set(id, { start: lo, len, drawn: true });
    this.order.push(id);
    out.push({ id, start: lo, len });
    for (const [k, r] of moved) {
      const start = this.alloc(r.len, out);
      r.start = start;
      out.push({ id: k, start, len: r.len });
    }
  }

  private leavePrefix(id: string, r: PoolRange, out: PoolWrite[]): void {
    const i = this.order.indexOf(id);
    this.order.splice(i, 1);
    // the tail of the prefix slides down over the gap
    for (let j = i; j < this.order.length; j++) {
      const k = this.order[j] as string;
      const w = this.ranges.get(k) as PoolRange;
      w.start -= r.len;
      out.push({ id: k, start: w.start, len: w.len });
    }
    this.count -= r.len;
    this.ranges.delete(id);
    this.release(this.count, this.count + r.len);
  }

  /** First fit beyond the prefix; doubles the capacity when nothing fits. */
  private alloc(len: number, out: PoolWrite[]): number {
    for (;;) {
      for (let i = 0; i < this.free.length; i++) {
        const f = this.free[i] as [number, number];
        if (f[1] - f[0] < len) continue;
        const start = f[0];
        if (f[1] - f[0] === len) this.free.splice(i, 1);
        else f[0] += len;
        return start;
      }
      this.grow();
      void out;
    }
  }

  private grow(): void {
    const old = this.capacity;
    this.capacity *= 2;
    this.grows++;
    this.release(old, this.capacity);
  }

  /** Marks `[lo, hi)` free (merging with its neighbours). */
  private release(lo: number, hi: number): void {
    if (hi <= lo) return;
    let i = 0;
    while (i < this.free.length && (this.free[i] as [number, number])[0] < lo) i++;
    this.free.splice(i, 0, [lo, hi]);
    // merge with the previous and the next
    if (i > 0 && (this.free[i - 1] as [number, number])[1] === lo) {
      (this.free[i - 1] as [number, number])[1] = hi;
      this.free.splice(i, 1);
      i--;
    }
    const cur = this.free[i] as [number, number];
    const nxt = this.free[i + 1];
    if (nxt && cur[1] === nxt[0]) {
      cur[1] = nxt[1];
      this.free.splice(i + 1, 1);
    }
  }

  /** Takes `[lo, hi)` out of the free list (it must be free). */
  private take(lo: number, hi: number): void {
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i] as [number, number];
      if (f[0] <= lo && f[1] >= hi) {
        const parts: [number, number][] = [];
        if (f[0] < lo) parts.push([f[0], lo]);
        if (hi < f[1]) parts.push([hi, f[1]]);
        this.free.splice(i, 1, ...parts);
        return;
      }
    }
    throw new Error(`pool: [${lo}, ${hi}) is not free`);
  }
}

// ---- the meshes ---------------------------------------------------------------------------------------------------------------

/** How a pool draws its instances: the form's mesh, or the impostor card turned to the camera (M02h5). */
export type PoolMode = 'mesh' | 'impostor';

/** One pool: a geometry of the set in one band (`near`, `far`, or `all` off `full` and for the M02h5 pools). */
interface Pool {
  key: string;
  geometry: TreeGeometryId;
  band: 'near' | 'far' | 'all';
  /** M02h5: an understory or impostor pool (not one of M02h4's tree pools). */
  extra: boolean;
  mode: PoolMode;
  data: TreeGeometryData;
  base: BufferGeometry;
  layout: PoolLayout;
  mesh: InstancedMesh;
  matrices: Float32Array;
  tints: Float32Array;
  /** Per unit: its instances' matrices (16 floats) and tints (4 floats), the source of every write. */
  src: Map<string, { m: Float32Array; t: Float32Array; form: number[] }>;
}

/**
 * M02h5: the scatter on the client (look.json `vegetation.scatter`, the `world.scatter` flag). Absent: M02h4's pools alone, every record
 * drawn as a mesh within `tree.drawM`.
 */
export interface ScatterPoolOptions {
  /** `world.scatter` (and the `scatter` layer): bit-7 records are drawn, thinned by the keeps; false skips them and adds no pool. */
  enabled: boolean;
  /** The set has impostor pools (a look profile other than `legacy`, never the cone). */
  impostors: boolean;
  /** Share of the scatter trees and of the shrubs and hedges kept (`scatterKeep`, `shrubKeep` of the look profile). */
  keepTree: number;
  keepShrub: number;
  /** Metres: a tree within `impostorM` is a mesh, beyond it an impostor; shrubs and hedges draw within `shrubDrawM`. */
  impostorM: number;
  shrubDrawM: number;
  /** A mesh stays a mesh up to `x (1 + hysteresis)`. */
  hysteresis: number;
  /** Camera travel (metres) between re-bandings. */
  rebandM: number;
  /** Instance writes of the re-banding per frame. */
  writeCap: number;
}

export interface VegetationPoolsOptions {
  parent: Group;
  set: TreeSet;
  /** The material of every pool (the look's `vegetation` or the legacy one). */
  material: () => Material;
  receiveShadow: () => boolean;
  /** M02h5: the scatter (absent: M02h4's behaviour). */
  scatter?: ScatterPoolOptions | undefined;
  /** M02h5: the impostor pools' material (the billboard, `look/look-materials.ts`); required when `scatter.impostors`. */
  impostorMaterial?: (() => Material | null) | undefined;
}

/** What the QA bridge reports (`look().vegetation`): the set, the pools and the per-form instances. */
export interface VegetationPoolReport {
  set: TreeSet;
  pools: number;
  /** Pools drawing now (count above 0): each is one render object. */
  drawnPools: number;
  forms: { form: string; instances: number; drawn: number; tris: number }[];
  /** M02h5: the scatter, the bands and the per-pool triangles. */
  scatter: ScatterReport;
  poolTris: { key: string; mode: PoolMode; count: number; tris: number }[];
}

/** M02h5: the scatter part of the report. */
export interface ScatterReport {
  enabled: boolean;
  scatterLayer: boolean;
  impostorLayer: boolean;
  /** Impostor pools of the set (0 with `world.scatter` off, on `legacy` and the cone). */
  impostorPools: number;
  /** Understory pools of the set. */
  understoryPools: number;
  /** Scatter records resident after thinning (bit 7), and the ones thinning dropped. */
  scatterInstances: number;
  thinned: number;
  /** Instances drawn now: as impostors, shrubs, hedges, tree meshes. */
  impostors: number;
  shrubs: number;
  hedges: number;
  meshTrees: number;
  /** The re-banding's instance writes: the cap, the most in one frame, the total, steps waiting, steps over the cap on their own. */
  bandWrites: { cap: number; maxInFrame: number; total: number; pending: number; overCap: number; rebands: number };
  impostorM: number;
  shrubDrawM: number;
}

const FORM_NAMES = ['plane', 'ficus', 'conifer', 'eucalyptus', 'palm', 'shrub', 'hedge'] as const;

/** Band of an instance: 0 drawn as its form's mesh, 1 as an impostor, 2 not drawn. */
export const BAND_MESH = 0;
export const BAND_IMPOSTOR = 1;
export const BAND_NONE = 2;

/** A positional hash in [0, 1) of a record (the thinning's keep test): the same record keeps or drops on every run. */
export function keepHash(x: number, z: number): number {
  let h = (Math.imul(Math.round(x * 10) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 10) | 0, 0x165667b1) ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * M02h5: the band an instance wants at `d` metres from the camera, given the band it has (`prev`; the hysteresis keeps a mesh a mesh up to
 * `x (1 + hysteresis)`). Understory: a mesh within `shrubDrawM`, else not drawn. A tree: a mesh within `impostorM`; beyond, an impostor
 * when the set has impostors and the layer is on, not drawn when the layer is off, and a mesh (M02h4) when the set has none.
 */
export function bandOfInstance(
  understory: boolean, d: number, prev: number, o: { impostorM: number; shrubDrawM: number; hysteresis: number; impostorPools: boolean; impostorLayer: boolean },
): number {
  const k = prev === BAND_MESH ? 1 + o.hysteresis : 1;
  if (understory) return d <= o.shrubDrawM * k ? BAND_MESH : BAND_NONE;
  if (!o.impostorPools) return BAND_MESH;
  if (d <= o.impostorM * k) return BAND_MESH;
  return o.impostorLayer ? BAND_IMPOSTOR : BAND_NONE;
}

/** The impostor card a form draws with beyond `impostorM` (none for the understory): the palm's own on `full` and `lite`, else the crown. */
export function impostorOfForm(set: TreeSet, form: TreeForm): TreeGeometryId | null {
  if (isUnderstoryForm(form)) return null;
  return form === TreeForm.Palm && set !== 'low' ? 'imp-palm' : 'imp-crown';
}

/** M02h5: one unit's kept instances: the record index, the world position, the form, the scatter flag and the band. */
interface UnitInstances {
  idx: Uint32Array;
  x: Float32Array;
  z: Float32Array;
  form: Uint8Array;
  band: Uint8Array;
  scatter: number;
}

interface UnitState {
  trees: Float32Array;
  ox: number;
  oz: number;
  near: boolean;
  drawn: boolean;
  inst: UnitInstances;
  /** The unit's distance interval from the camera at the last check (for the crossing test). */
  dMin: number;
  dMax: number;
  /** Pools whose entry for the unit no longer matches `inst.band` (the re-banding writes them, capped per frame). */
  stale: Set<Pool>;
}

export class VegetationPools {
  readonly set: TreeSet;
  readonly pools: Pool[] = [];
  /** The units in the pools: their band (`near` on `full` when within the caster radius) and whether their trees are drawn. */
  private readonly units = new Map<string, UnitState>();
  /** Bytes written this frame (instance matrices and tints), against the tier's upload cap. */
  bytesThisFrame = 0;
  maxBytesInFrame = 0;
  totalWrites = 0;
  private castNear = false;
  // M02h5: the scatter and the bands
  private readonly sc: ScatterPoolOptions | null;
  private scatterLayer = true;
  private impostorLayer = true;
  private cam: { x: number; z: number } | null = null;
  private rebandAt: { x: number; z: number } | null = null;
  /** Units with stale pools, oldest first. */
  private readonly bandQueue = new Set<string>();
  bandWritesThisFrame = 0;
  maxBandWritesInFrame = 0;
  totalBandWrites = 0;
  bandOverCap = 0;
  rebands = 0;
  thinned = 0;

  constructor(private readonly o: VegetationPoolsOptions) {
    this.set = o.set;
    this.sc = o.scatter && o.scatter.enabled ? o.scatter : null;
    const bands: ('near' | 'far' | 'all')[] = o.set === 'full' ? ['near', 'far'] : ['all'];
    const datas = buildTreeSet(o.set);
    for (const band of bands) for (const data of datas) this.pools.push(this.makePool(data, band, false, 'mesh'));
    if (this.sc) {
      for (const data of buildUnderstorySet(o.set)) this.pools.push(this.makePool(data, 'all', true, 'mesh'));
      if (this.sc.impostors && o.set !== 'cone') {
        for (const data of buildImpostorSet(o.set === 'low' ? ['imp-crown'] : IMPOSTOR_IDS)) this.pools.push(this.makePool(data, 'all', true, 'impostor'));
      }
    }
  }

  private makePool(data: TreeGeometryData, band: 'near' | 'far' | 'all', extra: boolean, mode: PoolMode): Pool {
    const base = new BufferGeometry();
    base.setAttribute('position', new BufferAttribute(data.positions, 3));
    base.setAttribute('normal', new BufferAttribute(data.normals, 3));
    base.setAttribute('color', new BufferAttribute(data.colors, 3));
    base.setAttribute('aLeaf', new BufferAttribute(data.leaf, 1));
    if (data.sway) base.setAttribute('sway', new BufferAttribute(data.sway, 1));
    base.setIndex(new BufferAttribute(data.indices, 1));
    const layout = new PoolLayout();
    const pool = { key: `${data.id}:${band}`, geometry: data.id, band, extra, mode, data, base, layout, src: new Map() } as unknown as Pool;
    this.makeMesh(pool);
    return pool;
  }

  /** Pools of the set: 10 `full`, 5 `lite`, 2 `low`, 1 `cone`; M02h5 adds 4 / 3 / 1 (`min`) / 0 with the scatter on. */
  get poolCount(): number {
    return this.pools.length;
  }

  private materialOf(p: Pool): Material {
    if (p.mode === 'impostor') return this.o.impostorMaterial?.() ?? this.o.material();
    return this.o.material();
  }

  private makeMesh(p: Pool): void {
    const cap = p.layout.capacity;
    const g = new BufferGeometry();
    for (const [name, a] of Object.entries(p.base.attributes)) g.setAttribute(name, a);
    g.setIndex(p.base.index);
    const tints = new Float32Array(cap * 4);
    const tAttr = new InstancedBufferAttribute(tints, 4);
    g.setAttribute('aTint', tAttr);
    g.boundingSphere = new Sphere(new Vector3(), 1e7);
    const mesh = new InstancedMesh(g, this.materialOf(p), cap);
    mesh.name = `world.vegetation:${p.key}`;
    mesh.userData['kind'] = 'vegetation';
    mesh.userData['pool'] = p.key;
    mesh.userData['mode'] = p.mode;
    mesh.frustumCulled = false;
    mesh.receiveShadow = this.o.receiveShadow();
    mesh.castShadow = this.casts(p);
    const old = (p as Partial<Pool>).mesh;
    if (old) {
      this.o.parent.remove(old);
      old.geometry.dispose();
    }
    p.mesh = mesh;
    p.matrices = mesh.instanceMatrix.array as Float32Array;
    p.tints = tints;
    // every unit's range again, from its source
    for (const [id, r] of p.layout.ranges) this.writeRange(p, id, r.start, r.len, false);
    mesh.count = p.layout.count;
    mesh.visible = mesh.count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    tAttr.needsUpdate = true;
    this.o.parent.add(mesh);
  }

  /** Only M02h4's `near` tree pools cast (the `casters` layer on `full`); the understory and the impostors never do. */
  private casts(p: Pool): boolean {
    return p.band === 'near' && !p.extra && this.castNear;
  }

  private writeRange(p: Pool, id: string, start: number, len: number, partial: boolean): void {
    const s = p.src.get(id);
    if (!s) return;
    p.matrices.set(s.m.subarray(0, len * 16), start * 16);
    p.tints.set(s.t.subarray(0, len * 4), start * 4);
    if (partial) {
      p.mesh.instanceMatrix.addUpdateRange(start * 16, len * 16);
      const t = p.mesh.geometry.getAttribute('aTint') as InstancedBufferAttribute;
      t.addUpdateRange(start * 4, len * 4);
      p.mesh.instanceMatrix.needsUpdate = true;
      t.needsUpdate = true;
    }
    this.bytesThisFrame += len * 80;
    this.maxBytesInFrame = Math.max(this.maxBytesInFrame, this.bytesThisFrame);
    this.totalWrites++;
  }

  /** Applies a layout's writes (a doubling rebuilds the mesh and writes everything). Returns the instances written. */
  private apply(p: Pool, writes: readonly PoolWrite[], grows0: number): number {
    let n = 0;
    if (p.layout.grows !== grows0) {
      this.makeMesh(p);
      n = p.layout.used;
    } else {
      for (const w of writes) {
        this.writeRange(p, w.id, w.start, w.len, true);
        n += w.len;
      }
    }
    p.mesh.count = p.layout.count;
    p.mesh.visible = p.mesh.count > 0;
    return n;
  }

  private bandOf(near: boolean): 'near' | 'far' | 'all' {
    return this.set === 'full' ? (near ? 'near' : 'far') : 'all';
  }

  /** The pools a unit's instances may go to: M02h4's pools of its band and every M02h5 pool. */
  private poolsFor(near: boolean): Pool[] {
    const b = this.bandOf(near);
    return this.pools.filter((p) => p.band === b || p.extra);
  }

  private bandOpts(): { impostorM: number; shrubDrawM: number; hysteresis: number; impostorPools: boolean; impostorLayer: boolean } {
    const sc = this.sc;
    return {
      impostorM: sc?.impostorM ?? Infinity, shrubDrawM: sc?.shrubDrawM ?? Infinity, hysteresis: sc?.hysteresis ?? 0,
      impostorPools: this.pools.some((p) => p.mode === 'impostor'), impostorLayer: this.impostorLayer,
    };
  }

  /** The instances of a unit after thinning, banded from the camera (all meshes before the first camera). */
  private instancesOf(trees: Float32Array, ox: number, oz: number): UnitInstances {
    const n = Math.floor(trees.length / TREE_STRIDE);
    const keep: number[] = [];
    let scatter = 0;
    for (let i = 0; i < n; i++) {
      const lane = trees[i * TREE_STRIDE + 5] as number;
      if (!laneScatter(lane)) {
        keep.push(i);
        continue;
      }
      // M02h5: a scatter record, thinned by its positional hash; none at all with the scatter off
      const sc = this.sc;
      if (!sc || !this.scatterLayer) continue;
      const x = ox + (trees[i * TREE_STRIDE] as number), z = oz + (trees[i * TREE_STRIDE + 2] as number);
      const k = isUnderstoryForm(laneForm(lane)) ? sc.keepShrub : sc.keepTree;
      if (keepHash(x, z) < k) {
        keep.push(i);
        scatter++;
      } else this.thinned++;
    }
    const inst: UnitInstances = {
      idx: new Uint32Array(keep), x: new Float32Array(keep.length), z: new Float32Array(keep.length), form: new Uint8Array(keep.length),
      band: new Uint8Array(keep.length), scatter,
    };
    const bo = this.bandOpts();
    keep.forEach((i, k) => {
      const o = i * TREE_STRIDE;
      inst.x[k] = ox + (trees[o] as number);
      inst.z[k] = oz + (trees[o + 2] as number);
      const form = treeFormOfByte(laneForm(trees[o + 5] as number));
      inst.form[k] = form;
      inst.band[k] = this.cam ? bandOfInstance(isUnderstoryForm(form), Math.hypot(inst.x[k] - this.cam.x, inst.z[k] - this.cam.z), BAND_NONE, bo) : BAND_MESH;
    });
    return inst;
  }

  /**
   * Adds (or replaces) a unit's trees: `trees` is `UnitMesh.trees` (`TREE_STRIDE` floats per tree, local to the unit's corner `ox, oz`).
   * M02h5: a landing unit is banded from the last camera at once (no re-banding write later).
   */
  addUnit(id: string, trees: Float32Array, ox: number, oz: number, drawn: boolean, near: boolean): void {
    if (this.units.has(id)) this.removeUnit(id);
    if (trees.length < TREE_STRIDE) return;
    const inst = this.instancesOf(trees, ox, oz);
    const u: UnitState = { trees, ox, oz, near, drawn, inst, dMin: 0, dMax: 0, stale: new Set() };
    this.measure(u);
    this.units.set(id, u);
    for (const p of this.poolsFor(near)) this.fillPool(id, u, p);
  }

  /** The instances of the unit a pool draws now (by mode, geometry and band). */
  private pick(u: UnitState, p: Pool): number[] {
    const out: number[] = [];
    const n = u.inst.idx.length;
    for (let k = 0; k < n; k++) {
      const form = u.inst.form[k] as TreeForm;
      const band = u.inst.band[k] as number;
      if (p.mode === 'impostor') {
        if (band === BAND_IMPOSTOR && impostorOfForm(this.set, form) === p.geometry) out.push(k);
      } else if (band === BAND_MESH && geometryOfForm(this.set, form) === p.geometry) out.push(k);
    }
    return out;
  }

  /** Writes the unit's entry in one pool from its instances' bands (the entry is removed first when present). Returns instances written. */
  private fillPool(id: string, u: UnitState, p: Pool): number {
    let written = 0;
    if (p.layout.ranges.has(id)) {
      const g0 = p.layout.grows;
      const writes = p.layout.remove(id);
      p.src.delete(id);
      written += this.apply(p, writes, g0);
    }
    const list = this.pick(u, p);
    if (list.length === 0) return written;
    const m = new Float32Array(list.length * 16);
    const t = new Float32Array(list.length * 4);
    const forms: number[] = [];
    list.forEach((k, j) => {
      const o = (u.inst.idx[k] as number) * TREE_STRIDE;
      const lane = u.trees[o + 5] as number;
      const form = u.inst.form[k] as TreeForm;
      const tint = laneTint(lane);
      const h = u.trees[o + 3] as number;
      const x = u.ox + (u.trees[o] as number), y = u.trees[o + 1] as number, z = u.oz + (u.trees[o + 2] as number);
      if (p.mode === 'impostor') {
        // no rotation (the billboard turns the card); the `low` crown's shape and colour per form; aTint.w carries the horizontal scale
        const [sx, sy] = instanceScaleOf(p.geometry === 'imp-palm' ? 'lite' : 'low', form, h);
        m.set([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sx, 0, x, y, z, 1], j * 16);
        const col = tintOf(p.geometry === 'imp-palm' ? 'lite' : 'low', form, tint);
        t.set([col[0], col[1], col[2], sx], j * 4);
      } else {
        const yaw = u.trees[o + 4] as number;
        const [sx, sy] = instanceScaleOf(this.set, form, h);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        // column-major: rotation about y times the scale, then the translation
        m.set([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sx, 0, c * sx, 0, x, y, z, 1], j * 16);
        const col = tintOf(this.set, form, tint);
        t.set([col[0], col[1], col[2], h], j * 4);
      }
      forms.push(form);
    });
    p.src.set(id, { m, t, form: forms });
    const g0 = p.layout.grows;
    written += this.apply(p, p.layout.add(id, list.length, u.drawn), g0);
    return written;
  }

  private emptyPool(id: string, p: Pool): void {
    if (!p.layout.ranges.has(id)) return;
    const g0 = p.layout.grows;
    const writes = p.layout.remove(id);
    p.src.delete(id);
    this.apply(p, writes, g0);
  }

  removeUnit(id: string): void {
    const u = this.units.get(id);
    if (!u) return;
    for (const p of this.poolsFor(u.near)) this.emptyPool(id, p);
    this.units.delete(id);
    this.bandQueue.delete(id);
  }

  hasUnit(id: string): boolean {
    return this.units.has(id);
  }

  /** The unit's trees cross `tree.drawM`: only the prefix tail of each of its pools moves. */
  setDrawn(id: string, drawn: boolean): void {
    const u = this.units.get(id);
    if (!u || u.drawn === drawn) return;
    u.drawn = drawn;
    for (const p of this.poolsFor(u.near)) {
      if (!p.layout.ranges.has(id)) continue;
      const g0 = p.layout.grows;
      this.apply(p, p.layout.setDrawn(id, drawn), g0);
    }
  }

  drawnOf(id: string): boolean | null {
    return this.units.get(id)?.drawn ?? null;
  }

  /** `full`: the unit moves between the `near` and the `far` tree pools (the M02h5 pools stay as they are). Returns whether it moved. */
  setNear(id: string, near: boolean): boolean {
    const u = this.units.get(id);
    if (!u || this.set !== 'full' || u.near === near) return false;
    for (const p of this.pools) if (!p.extra && p.band === this.bandOf(u.near)) this.emptyPool(id, p);
    u.near = near;
    for (const p of this.pools) if (!p.extra && p.band === this.bandOf(near)) this.fillPool(id, u, p);
    return true;
  }

  nearOf(id: string): boolean | null {
    return this.units.get(id)?.near ?? null;
  }

  /** The `near` pools cast (the `casters` layer on a `full` tier); every other pool never does. */
  setCasting(on: boolean): void {
    this.castNear = on;
    for (const p of this.pools) p.mesh.castShadow = this.casts(p);
  }

  setMaterial(m: Material, receive: boolean): void {
    for (const p of this.pools) {
      // the impostors keep the billboard material (the cards face +z without it)
      if (p.mode !== 'impostor') p.mesh.material = m;
      p.mesh.receiveShadow = receive;
    }
  }

  /** The renderer was replaced (a GPU loss): every pool's mesh is built again from the sources. */
  rebuild(): void {
    for (const p of this.pools) this.makeMesh(p);
  }

  startFrame(): void {
    this.bytesThisFrame = 0;
    this.bandWritesThisFrame = 0;
  }

  // ---- M02h5: the bands ---------------------------------------------------------------------------------------------------

  /** The unit's distance interval from the camera (its 256 m box), for the crossing test. */
  private measure(u: UnitState): void {
    if (!this.cam) return;
    const cx = this.cam.x, cz = this.cam.z;
    const x0 = u.ox, z0 = u.oz, x1 = u.ox + 256, z1 = u.oz + 256;
    const dx = Math.max(x0 - cx, 0, cx - x1), dz = Math.max(z0 - cz, 0, cz - z1);
    u.dMin = Math.hypot(dx, dz);
    u.dMax = Math.hypot(Math.max(Math.abs(cx - x0), Math.abs(cx - x1)), Math.max(Math.abs(cz - z0), Math.abs(cz - z1)));
  }

  /**
   * Whether a unit can hold an instance on the wrong side of a band edge: its distance interval reaches a threshold (with hysteresis),
   * or it still holds a band its whole interval rules out (the camera jumped).
   */
  private crossing(u: UnitState): boolean {
    const sc = this.sc;
    if (!sc || u.inst.idx.length === 0) return false;
    const h = 1 + sc.hysteresis;
    for (const t of [sc.impostorM, sc.shrubDrawM]) if (u.dMin <= t * h && u.dMax >= t) return true;
    // the interval lies on one side of every edge: re-band only if a band the interval rules out is still held
    const n = u.inst.idx.length;
    const bo = this.bandOpts();
    for (let k = 0; k < n; k++) {
      const want = bandOfInstance(isUnderstoryForm(u.inst.form[k] as TreeForm), u.dMin, BAND_NONE, bo);
      if (want !== u.inst.band[k]) return true;
    }
    return false;
  }

  /** Recomputes a unit's bands; the pools whose entries change become stale. Returns whether any did. */
  private reband(id: string, u: UnitState): boolean {
    if (!this.cam) return false;
    const bo = this.bandOpts();
    const before = new Map<Pool, string>();
    const pools = this.poolsFor(u.near);
    const n = u.inst.idx.length;
    let changed = false;
    const next = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      next[k] = bandOfInstance(isUnderstoryForm(u.inst.form[k] as TreeForm), Math.hypot((u.inst.x[k] as number) - this.cam.x, (u.inst.z[k] as number) - this.cam.z), u.inst.band[k] as number, bo);
      if (next[k] !== u.inst.band[k]) changed = true;
    }
    if (!changed) return false;
    for (const p of pools) before.set(p, this.pick(u, p).join(','));
    u.inst.band = next;
    for (const p of pools) if (this.pick(u, p).join(',') !== before.get(p)) u.stale.add(p);
    if (u.stale.size > 0) this.bandQueue.add(id);
    return u.stale.size > 0;
  }

  /** The instance writes a pool step would cost: a dry run of the remove and the add on a copy of the layout. */
  private stepCost(id: string, u: UnitState, p: Pool): number {
    const l = p.layout.clone();
    const g0 = l.grows;
    let n = 0;
    for (const w of l.remove(id)) n += w.len;
    const len = this.pick(u, p).length;
    if (len > 0) for (const w of l.add(id, len, u.drawn)) n += w.len;
    return l.grows !== g0 ? l.used : n;
  }

  /**
   * M02h5, once per frame: the camera; after `rebandM` of travel the crossing units are re-banded, and the stale pool entries are written
   * oldest first while the frame has room: at most `writeCap` instance writes (a step larger than the whole cap goes alone in a frame of
   * its own and is counted in `overCap`), and no step once the frame's bytes reach `capBytes` (the tier's upload cap; null: none).
   */
  update(camX: number, camZ: number, capBytes: number | null = null): void {
    const sc = this.sc;
    if (!sc) return;
    this.cam = { x: camX, z: camZ };
    const moved = !this.rebandAt || Math.hypot(camX - this.rebandAt.x, camZ - this.rebandAt.z) >= sc.rebandM;
    if (moved) {
      this.rebandAt = { x: camX, z: camZ };
      this.rebands++;
      for (const [id, u] of this.units) {
        this.measure(u);
        if (this.crossing(u)) this.reband(id, u);
      }
    }
    this.flushBands(sc.writeCap, capBytes);
  }

  private flushBands(cap: number, capBytes: number | null): void {
    for (const id of [...this.bandQueue]) {
      const u = this.units.get(id);
      if (!u) {
        this.bandQueue.delete(id);
        continue;
      }
      for (const p of [...u.stale]) {
        if (capBytes !== null && this.bytesThisFrame >= capBytes && this.bandWritesThisFrame > 0) return;
        const cost = this.stepCost(id, u, p);
        if (this.bandWritesThisFrame + cost > cap) {
          if (this.bandWritesThisFrame > 0) return;
          this.bandOverCap++;
        }
        const n = this.fillPool(id, u, p);
        u.stale.delete(p);
        this.bandWritesThisFrame += n;
        this.totalBandWrites += n;
        this.maxBandWritesInFrame = Math.max(this.maxBandWritesInFrame, this.bandWritesThisFrame);
      }
      this.bandQueue.delete(id);
    }
  }

  /** QA `setLookLayer('impostors', on)`: off, the trees beyond `impostorM` are not drawn; every unit is re-banded (capped as ever). */
  setImpostorLayer(on: boolean): boolean {
    if (!this.pools.some((p) => p.mode === 'impostor')) return false;
    this.impostorLayer = on;
    for (const [id, u] of this.units) this.reband(id, u);
    return true;
  }

  /** QA `setLookLayer('scatter', on)`: off, no scatter record is drawn (street trees only); every unit is filled again. */
  setScatterLayer(on: boolean): boolean {
    if (!this.sc) return false;
    this.scatterLayer = on;
    for (const [id, u] of [...this.units]) this.addUnit(id, u.trees, u.ox, u.oz, u.drawn, u.near);
    return true;
  }

  /** Render objects now (pools drawing) and their triangles. */
  totals(): { objects: number; triangles: number; casting: number } {
    let objects = 0, triangles = 0, casting = 0;
    for (const p of this.pools) {
      if (!p.mesh.visible || p.mesh.count <= 0) continue;
      objects++;
      triangles += p.mesh.count * p.data.triangles;
      if (p.mesh.castShadow) casting++;
    }
    return { objects, triangles, casting };
  }

  report(): VegetationPoolReport {
    const forms = FORM_NAMES.map((form) => ({ form, instances: 0, drawn: 0, tris: 0 }));
    let impostors = 0, shrubs = 0, hedges = 0, meshTrees = 0;
    for (const p of this.pools) {
      for (const [id, s] of p.src) {
        const r = p.layout.ranges.get(id);
        for (const f of s.form) {
          const row = forms[f] as { instances: number; drawn: number; tris: number };
          row.instances++;
          if (r?.drawn) {
            row.drawn++;
            row.tris += p.data.triangles;
            if (p.mode === 'impostor') impostors++;
            else if (f === TreeForm.Shrub) shrubs++;
            else if (f === TreeForm.Hedge) hedges++;
            else meshTrees++;
          }
        }
      }
    }
    let scatterInstances = 0;
    for (const u of this.units.values()) scatterInstances += u.inst.scatter;
    const sc = this.sc;
    return {
      set: this.set, pools: this.pools.length, drawnPools: this.totals().objects, forms,
      scatter: {
        enabled: sc !== null, scatterLayer: this.scatterLayer, impostorLayer: this.impostorLayer,
        impostorPools: this.pools.filter((p) => p.mode === 'impostor').length, understoryPools: this.pools.filter((p) => p.extra && p.mode === 'mesh').length,
        scatterInstances, thinned: this.thinned, impostors, shrubs, hedges, meshTrees,
        bandWrites: {
          cap: sc?.writeCap ?? 0, maxInFrame: this.maxBandWritesInFrame, total: this.totalBandWrites, pending: this.bandQueue.size, overCap: this.bandOverCap, rebands: this.rebands,
        },
        impostorM: sc?.impostorM ?? 0, shrubDrawM: sc?.shrubDrawM ?? 0,
      },
      poolTris: this.pools.map((p) => ({ key: p.key, mode: p.mode, count: p.mesh.visible ? p.mesh.count : 0, tris: p.mesh.visible ? p.mesh.count * p.data.triangles : 0 })),
    };
  }

  /** M02h5 (tests): the bands of a unit's kept instances, with their world positions and forms. */
  bandsOf(id: string): { x: number; z: number; form: number; band: number }[] {
    const u = this.units.get(id);
    if (!u) return [];
    return [...u.inst.band].map((band, k) => ({ x: u.inst.x[k] as number, z: u.inst.z[k] as number, form: u.inst.form[k] as number, band }));
  }

  /** M02h5 (tests): how many times each kept instance of a unit is drawn, over every pool (drawn prefixes only). */
  drawCounts(id: string): Map<number, { mesh: number; impostor: number }> {
    const out = new Map<number, { mesh: number; impostor: number }>();
    const u = this.units.get(id);
    if (!u) return out;
    for (const p of this.pools) {
      const r = p.layout.ranges.get(id);
      if (!r || !r.drawn) continue;
      for (const k of this.pick(u, p)) {
        const row = out.get(k) ?? { mesh: 0, impostor: 0 };
        if (p.mode === 'impostor') row.impostor++;
        else row.mesh++;
        out.set(k, row);
      }
    }
    return out;
  }

  /** Units waiting for band writes (tests, QA). */
  get pendingBands(): number {
    return this.bandQueue.size;
  }

  /** Instances drawn now over every pool (the sum of the drawn prefixes). */
  drawnInstances(): number {
    let n = 0;
    for (const p of this.pools) n += p.layout.count;
    return n;
  }

  /** The pool keys and their geometry ids, in order (QA). */
  keys(): { key: string; geometry: TreeGeometryId; band: string; count: number; capacity: number; cast: boolean; mode: PoolMode }[] {
    return this.pools.map((p) => ({ key: p.key, geometry: p.geometry, band: p.band, count: p.mesh.count, capacity: p.layout.capacity, cast: p.mesh.castShadow, mode: p.mode }));
  }

  dispose(): void {
    for (const p of this.pools) {
      this.o.parent.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.base.dispose();
    }
    this.pools.length = 0;
    this.units.clear();
    this.bandQueue.clear();
  }
}

/** The pools of each set (AC-4: 10, 5, 2; the cone 1). */
export const POOLS_PER_SET: Readonly<Record<TreeSet, number>> = {
  full: SET_GEOMETRIES.full.length * 2,
  lite: SET_GEOMETRIES.lite.length,
  low: SET_GEOMETRIES.low.length,
  cone: 1,
};

/** M02h5: the pools the scatter adds per look profile (AC-4: 4 `full`, 3 `lite`, 1 `min`, 0 `legacy`). */
export const SCATTER_POOLS: Readonly<Record<'full' | 'lite' | 'min' | 'legacy', number>> = { full: 4, lite: 3, min: 1, legacy: 0 };

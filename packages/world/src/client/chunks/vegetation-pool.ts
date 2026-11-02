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
 */
import { BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, type Material, Sphere, Vector3 } from 'three/webgpu';
import { TreeForm, treeFormOfByte } from '@dv/shared';
import { TREE_STRIDE } from './mesher.ts';
import { SET_GEOMETRIES, buildTreeSet, geometryOfForm, instanceScaleOf, tintOf, type TreeGeometryData, type TreeGeometryId, type TreeSet } from './tree-forms.ts';

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

/** One pool: a geometry of the set in one band (`near`, `far`, or `all` off `full`). */
interface Pool {
  key: string;
  geometry: TreeGeometryId;
  band: 'near' | 'far' | 'all';
  data: TreeGeometryData;
  base: BufferGeometry;
  layout: PoolLayout;
  mesh: InstancedMesh;
  matrices: Float32Array;
  tints: Float32Array;
  /** Per unit: its instances' matrices (16 floats) and tints (4 floats), the source of every write. */
  src: Map<string, { m: Float32Array; t: Float32Array; form: number[] }>;
}

export interface VegetationPoolsOptions {
  parent: Group;
  set: TreeSet;
  /** The material of every pool (the look's `vegetation` or the legacy one). */
  material: () => Material;
  receiveShadow: () => boolean;
}

/** What the QA bridge reports (`look().vegetation`): the set, the pools and the per-form instances. */
export interface VegetationPoolReport {
  set: TreeSet;
  pools: number;
  /** Pools drawing now (count above 0): each is one render object. */
  drawnPools: number;
  forms: { form: string; instances: number; drawn: number; tris: number }[];
}

const FORM_NAMES = ['plane', 'ficus', 'conifer', 'eucalyptus', 'palm'] as const;

export class VegetationPools {
  readonly set: TreeSet;
  readonly pools: Pool[] = [];
  /** The units in the pools: their band (`near` on `full` when within the caster radius) and whether their trees are drawn. */
  private readonly units = new Map<string, { trees: Float32Array; ox: number; oz: number; near: boolean; drawn: boolean }>();
  /** Bytes written this frame (instance matrices and tints), against the tier's upload cap. */
  bytesThisFrame = 0;
  maxBytesInFrame = 0;
  totalWrites = 0;
  private castNear = false;

  constructor(private readonly o: VegetationPoolsOptions) {
    this.set = o.set;
    const bands: ('near' | 'far' | 'all')[] = o.set === 'full' ? ['near', 'far'] : ['all'];
    const datas = buildTreeSet(o.set);
    for (const band of bands) {
      for (const data of datas) {
        const base = new BufferGeometry();
        base.setAttribute('position', new BufferAttribute(data.positions, 3));
        base.setAttribute('normal', new BufferAttribute(data.normals, 3));
        base.setAttribute('color', new BufferAttribute(data.colors, 3));
        base.setAttribute('aLeaf', new BufferAttribute(data.leaf, 1));
        if (data.sway) base.setAttribute('sway', new BufferAttribute(data.sway, 1));
        base.setIndex(new BufferAttribute(data.indices, 1));
        const layout = new PoolLayout();
        const pool = { key: `${data.id}:${band}`, geometry: data.id, band, data, base, layout, src: new Map() } as unknown as Pool;
        this.makeMesh(pool);
        this.pools.push(pool);
      }
    }
  }

  /** Pools of the set: 10 `full`, 5 `lite`, 2 `low`, 1 `cone`. */
  get poolCount(): number {
    return this.pools.length;
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
    const mesh = new InstancedMesh(g, this.o.material(), cap);
    mesh.name = `world.vegetation:${p.key}`;
    mesh.userData['kind'] = 'vegetation';
    mesh.userData['pool'] = p.key;
    mesh.frustumCulled = false;
    mesh.receiveShadow = this.o.receiveShadow();
    mesh.castShadow = p.band === 'near' && this.castNear;
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

  /** Applies a layout's writes (a doubling rebuilds the mesh and writes everything). */
  private apply(p: Pool, writes: readonly PoolWrite[], grows0: number): void {
    if (p.layout.grows !== grows0) this.makeMesh(p);
    else for (const w of writes) this.writeRange(p, w.id, w.start, w.len, true);
    p.mesh.count = p.layout.count;
    p.mesh.visible = p.mesh.count > 0;
  }

  private poolsOf(band: 'near' | 'far' | 'all'): Pool[] {
    return this.pools.filter((p) => p.band === band);
  }

  private bandOf(near: boolean): 'near' | 'far' | 'all' {
    return this.set === 'full' ? (near ? 'near' : 'far') : 'all';
  }

  /**
   * Adds (or replaces) a unit's trees: `trees` is `UnitMesh.trees` (`TREE_STRIDE` floats per tree, local to the unit's corner `ox, oz`).
   */
  addUnit(id: string, trees: Float32Array, ox: number, oz: number, drawn: boolean, near: boolean): void {
    if (this.units.has(id)) this.removeUnit(id);
    if (trees.length < TREE_STRIDE) return;
    this.units.set(id, { trees, ox, oz, near, drawn });
    this.fill(id, this.bandOf(near), drawn);
  }

  private fill(id: string, band: 'near' | 'far' | 'all', drawn: boolean): void {
    const u = this.units.get(id);
    if (!u) return;
    const pools = this.poolsOf(band);
    const byGeom = new Map<TreeGeometryId, number[]>();
    const n = Math.floor(u.trees.length / TREE_STRIDE);
    for (let i = 0; i < n; i++) {
      const lane = u.trees[i * TREE_STRIDE + 5] as number;
      const g = geometryOfForm(this.set, treeFormOfByte(lane & 7));
      const list = byGeom.get(g) ?? [];
      list.push(i);
      byGeom.set(g, list);
    }
    for (const p of pools) {
      const list = byGeom.get(p.geometry);
      if (!list || list.length === 0) continue;
      const m = new Float32Array(list.length * 16);
      const t = new Float32Array(list.length * 4);
      const forms: number[] = [];
      list.forEach((i, k) => {
        const o = i * TREE_STRIDE;
        const lane = u.trees[o + 5] as number;
        const form = treeFormOfByte(lane & 7);
        const tint = Math.floor(lane / 8);
        const h = u.trees[o + 3] as number;
        const yaw = u.trees[o + 4] as number;
        const [sx, sy] = instanceScaleOf(this.set, form, h);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        // column-major: rotation about y times the scale, then the translation
        m.set([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sx, 0, c * sx, 0, u.ox + (u.trees[o] as number), u.trees[o + 1] as number, u.oz + (u.trees[o + 2] as number), 1], k * 16);
        const col = tintOf(this.set, form as TreeForm, tint);
        t.set([col[0], col[1], col[2], h], k * 4);
        forms.push(form);
      });
      p.src.set(id, { m, t, form: forms });
      const g0 = p.layout.grows;
      this.apply(p, p.layout.add(id, list.length, drawn), g0);
    }
  }

  private empty(id: string, band: 'near' | 'far' | 'all'): void {
    for (const p of this.poolsOf(band)) {
      if (!p.layout.ranges.has(id)) continue;
      const g0 = p.layout.grows;
      const writes = p.layout.remove(id);
      p.src.delete(id);
      this.apply(p, writes, g0);
    }
  }

  removeUnit(id: string): void {
    const u = this.units.get(id);
    if (!u) return;
    this.empty(id, this.bandOf(u.near));
    this.units.delete(id);
  }

  hasUnit(id: string): boolean {
    return this.units.has(id);
  }

  /** The unit's trees cross `tree.drawM`: only the prefix tail of each of its pools moves. */
  setDrawn(id: string, drawn: boolean): void {
    const u = this.units.get(id);
    if (!u || u.drawn === drawn) return;
    u.drawn = drawn;
    for (const p of this.poolsOf(this.bandOf(u.near))) {
      if (!p.layout.ranges.has(id)) continue;
      const g0 = p.layout.grows;
      this.apply(p, p.layout.setDrawn(id, drawn), g0);
    }
  }

  drawnOf(id: string): boolean | null {
    return this.units.get(id)?.drawn ?? null;
  }

  /** `full`: the unit moves between the `near` and the `far` pools. Returns whether it moved. */
  setNear(id: string, near: boolean): boolean {
    const u = this.units.get(id);
    if (!u || this.set !== 'full' || u.near === near) return false;
    this.empty(id, this.bandOf(u.near));
    u.near = near;
    this.fill(id, this.bandOf(near), u.drawn);
    return true;
  }

  nearOf(id: string): boolean | null {
    return this.units.get(id)?.near ?? null;
  }

  /** The `near` pools cast (the `casters` layer on a `full` tier); every other pool never does. */
  setCasting(on: boolean): void {
    this.castNear = on;
    for (const p of this.pools) p.mesh.castShadow = p.band === 'near' && on;
  }

  setMaterial(m: Material, receive: boolean): void {
    for (const p of this.pools) {
      p.mesh.material = m;
      p.mesh.receiveShadow = receive;
    }
  }

  /** The renderer was replaced (a GPU loss): every pool's mesh is built again from the sources. */
  rebuild(): void {
    for (const p of this.pools) this.makeMesh(p);
  }

  startFrame(): void {
    this.bytesThisFrame = 0;
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
    for (const p of this.pools) {
      for (const [id, s] of p.src) {
        const r = p.layout.ranges.get(id);
        for (const f of s.form) {
          const row = forms[f] as { instances: number; drawn: number; tris: number };
          row.instances++;
          if (r?.drawn) {
            row.drawn++;
            row.tris += p.data.triangles;
          }
        }
      }
    }
    return { set: this.set, pools: this.pools.length, drawnPools: this.totals().objects, forms };
  }

  /** Instances drawn now over every pool (the sum of the drawn prefixes). */
  drawnInstances(): number {
    let n = 0;
    for (const p of this.pools) n += p.layout.count;
    return n;
  }

  /** The pool keys and their geometry ids, in order (QA). */
  keys(): { key: string; geometry: TreeGeometryId; band: string; count: number; capacity: number; cast: boolean }[] {
    return this.pools.map((p) => ({ key: p.key, geometry: p.geometry, band: p.band, count: p.mesh.count, capacity: p.layout.capacity, cast: p.mesh.castShadow }));
  }

  dispose(): void {
    for (const p of this.pools) {
      this.o.parent.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.base.dispose();
    }
    this.pools.length = 0;
    this.units.clear();
  }
}

/** The pools of each set (AC-4: 10, 5, 2; the cone 1). */
export const POOLS_PER_SET: Readonly<Record<TreeSet, number>> = {
  full: SET_GEOMETRIES.full.length * 2,
  lite: SET_GEOMETRIES.lite.length,
  low: SET_GEOMETRIES.low.length,
  cone: 1,
};

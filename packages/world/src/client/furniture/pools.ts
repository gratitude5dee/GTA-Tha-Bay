/**
 * The global furniture pools (M02h6; C08 1.1 rule 12, DL-741): one `InstancedMesh` per pool of the look profile (`full` signal, post,
 * shelter, pole and wire; `lite` signal, post and shelter; `min` signal and post; none on `legacy`) across every resident L0 unit, outside
 * the chunk bundles. A unit's records (`UnitMesh.furniture`) take slots when it is uploaded and give them back when it is unloaded; a freed
 * slot is a zero-scale matrix and the mesh `count` is the highest slot in use. A pool full at its cap (`config/world/furniture.json` `pools`)
 * gives the slots of the unit farthest from the focus to a nearer one (farthest dropped first). Geometry is code-built (`kit.ts`), the
 * materials TSL (`faces.ts`); the pools receive the sun's shadows, cast none and have no collider, like the M02b2 lamps. An empty or hidden
 * pool is no render object (`visible = count > 0` and the `furniture` layer on).
 *
 * The signal pool's heads take their aspect from `signals.ts` at 10 Hz within 200 m of the camera.
 */
import { BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, type Material, type Object3D } from 'three/webgpu';
import type { Aspect } from '@dv/shared';
import { FURNITURE_STRIDE, FurnitureKind, type UnitMesh } from '../chunks/mesh-types.ts';
import { FURNITURE, POOL_OF_KIND } from '../chunks/mesher.ts';
import type { SkyNodes } from '../sky/nodes.ts';
import { createFurnitureMaterial } from './faces.ts';
import { kitGeometry, poolsOf, type FurniturePoolName, type FurnitureProfile, type KitGeometry } from './kit.ts';
import { SignalClock, type HeadSlot } from './signals.ts';
import { clearFurnitureMatrix, writeFurnitureMatrix } from './wires.ts';

export interface FurniturePoolsOptions {
  parent: Pick<Object3D, 'add' | 'remove'>;
  profile: FurnitureProfile;
  sky: SkyNodes;
  /** Instance caps per pool (default `config/world/furniture.json` `pools[profile]`). */
  caps?: Readonly<Record<string, number>>;
  /** The look's shadow receiving (the `full` and `lite` looks receive). */
  receiveShadow?: () => boolean;
}

interface Pool {
  name: FurniturePoolName;
  kit: KitGeometry;
  mesh: InstancedMesh;
  kind: InstancedBufferAttribute;
  aspect: InstancedBufferAttribute | null;
  material: Material;
  cap: number;
  free: number[];
  high: number;
  live: number;
}

interface UnitSlots {
  cx: number;
  cz: number;
  /** pool index, slot */
  slots: [number, number][];
  heads: HeadSlot[];
  mesh: UnitMesh;
}

export interface FurniturePoolsReport {
  profile: FurnitureProfile;
  /** Per pool: the instances in use and the cap. */
  pools: Record<string, { instances: number; cap: number }>;
  /** Render objects the pools add now (each pool drawing at least one instance, with the layer on). */
  objects: number;
  /** Records the caps left out since the last report reset. */
  dropped: number;
  heads: { n: number; aspects: Record<Aspect, number>; total: number };
  layer: boolean;
  /** Triangles the drawn instances cost. */
  triangles: number;
}

export class FurniturePools {
  readonly group = new Group();
  readonly profile: FurnitureProfile;
  private readonly pools: Pool[] = [];
  private readonly poolOf = new Map<FurniturePoolName, number>();
  private readonly units = new Map<string, UnitSlots>();
  private readonly clock: SignalClock;
  private focus: { x: number; z: number } = { x: 0, z: 0 };
  private layerOn = true;
  private lookOn = true;
  private dropped = 0;
  private disposed = false;

  constructor(private readonly o: FurniturePoolsOptions) {
    this.profile = o.profile;
    this.group.name = 'world.furniture';
    this.clock = new SignalClock(FURNITURE.headsM, FURNITURE.headsHz);
    const caps = o.caps ?? FURNITURE.pools[o.profile];
    for (const name of poolsOf(caps)) {
      const cap = Math.max(1, caps[name] ?? 0);
      this.poolOf.set(name, this.pools.length);
      this.pools.push(this.makePool(name, cap));
    }
    o.parent.add(this.group);
  }

  private makePool(name: FurniturePoolName, cap: number): Pool {
    const kit = kitGeometry(name, this.profile, FURNITURE.signal);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(kit.positions, 3));
    g.setAttribute('normal', new BufferAttribute(kit.normals, 3));
    g.setAttribute('color', new BufferAttribute(kit.colors, 3));
    g.setAttribute('uv', new BufferAttribute(kit.uvs, 2));
    g.setAttribute('part', new BufferAttribute(kit.part, 1));
    g.setAttribute('face', new BufferAttribute(kit.face, 1));
    g.setAttribute('lamp', new BufferAttribute(kit.lamp, 1));
    g.setIndex(new BufferAttribute(kit.indices, 1));
    const kind = new InstancedBufferAttribute(new Float32Array(cap), 1);
    g.setAttribute('aKind', kind);
    let aspect: InstancedBufferAttribute | null = null;
    if (name === 'signal') {
      aspect = new InstancedBufferAttribute(new Float32Array(cap), 1);
      g.setAttribute('aAspect', aspect);
    }
    const material = createFurnitureMaterial({ pool: name, profile: this.profile, sky: this.o.sky });
    const mesh = new InstancedMesh(g, material, cap);
    mesh.name = `furniture.${name}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = this.o.receiveShadow?.() ?? false;
    mesh.count = 0;
    mesh.visible = false;
    (mesh.instanceMatrix.array as Float32Array).fill(0);
    this.group.add(mesh);
    return { name, kit, mesh, kind, aspect, material, cap, free: [], high: 0, live: 0 };
  }

  /** The focus the caps measure "farthest" from (the stream focus). */
  setFocus(x: number, z: number): void {
    this.focus = { x, z };
  }

  private dist2(u: { cx: number; cz: number }): number {
    const dx = u.cx - this.focus.x, dz = u.cz - this.focus.z;
    return dx * dx + dz * dz;
  }

  /** A unit was uploaded: its records join the pools (replacing what it had). */
  addUnit(id: string, mesh: UnitMesh): void {
    this.removeUnit(id);
    const recs = mesh.furniture;
    if (!recs || recs.length < FURNITURE_STRIDE) return;
    const u: UnitSlots = { cx: mesh.originX + 128, cz: mesh.originZ + 128, slots: [], heads: [], mesh };
    this.units.set(id, u);
    const touched = new Set<number>();
    for (let i = 0; i + FURNITURE_STRIDE - 1 < recs.length; i += FURNITURE_STRIDE) {
      const kind = recs[i] as number;
      const pi = this.poolOf.get(POOL_OF_KIND[kind] as FurniturePoolName);
      if (pi === undefined) continue;
      const p = this.pools[pi] as Pool;
      const slot = this.take(p, pi, u);
      if (slot < 0) {
        this.dropped++;
        continue;
      }
      const x = mesh.originX + (recs[i + 1] as number), y = recs[i + 2] as number, z = mesh.originZ + (recs[i + 3] as number);
      writeFurnitureMatrix(p.mesh.instanceMatrix.array as Float32Array, slot * 16, kind, x, y, z, recs[i + 4] as number, recs[i + 5] as number);
      (p.kind.array as Float32Array)[slot] = kind;
      u.slots.push([pi, slot]);
      touched.add(pi);
      if (kind === FurnitureKind.signal && p.aspect) {
        const head = mesh.heads[recs[i + 5] as number];
        if (head) u.heads.push({ head, x, z, slot });
        (p.aspect.array as Float32Array)[slot] = 0;
      }
    }
    for (const pi of touched) this.flush(this.pools[pi] as Pool);
    if (u.heads.length > 0) this.clock.poke();
  }

  /** A free slot of pool `p` for unit `u`, taking one from a farther unit when the pool is at its cap; -1 when `u` is the farthest. */
  private take(p: Pool, pi: number, u: UnitSlots): number {
    const reuse = p.free.pop();
    if (reuse !== undefined) return reuse;
    if (p.high < p.cap) return p.high++;
    // at the cap: the farthest unit holding a slot of this pool gives one up if it is farther than `u`
    let far: { id: string; u: UnitSlots; d: number } | null = null;
    for (const [id, v] of this.units) {
      if (v === u || !v.slots.some(([q]) => q === pi)) continue;
      const d = this.dist2(v);
      if (!far || d > far.d) far = { id, u: v, d };
    }
    if (!far || far.d <= this.dist2(u)) return -1;
    const k = far.u.slots.findIndex(([q]) => q === pi);
    const [, slot] = far.u.slots[k] as [number, number];
    far.u.slots.splice(k, 1);
    far.u.heads = far.u.heads.filter((h) => !(pi === this.poolOf.get('signal') && h.slot === slot));
    this.dropped++;
    return slot;
  }

  /** A unit was unloaded: its slots are freed (zero scale). */
  removeUnit(id: string): void {
    const u = this.units.get(id);
    if (!u) return;
    this.units.delete(id);
    const touched = new Set<number>();
    for (const [pi, slot] of u.slots) {
      const p = this.pools[pi] as Pool;
      clearFurnitureMatrix(p.mesh.instanceMatrix.array as Float32Array, slot * 16);
      p.free.push(slot);
      touched.add(pi);
    }
    for (const pi of touched) this.flush(this.pools[pi] as Pool);
  }

  /** Recounts a pool's live slots, lowers its high mark past freed slots at the top and asks for an upload. */
  private flush(p: Pool): void {
    const pi = this.pools.indexOf(p);
    const used = new Set<number>();
    for (const u of this.units.values()) for (const [q, s] of u.slots) if (q === pi) used.add(s);
    p.live = used.size;
    while (p.high > 0 && !used.has(p.high - 1)) {
      p.high--;
      const at = p.free.indexOf(p.high);
      if (at >= 0) p.free.splice(at, 1);
    }
    p.mesh.count = p.high;
    p.mesh.instanceMatrix.needsUpdate = true;
    p.kind.needsUpdate = true;
    if (p.aspect) p.aspect.needsUpdate = true;
    p.mesh.visible = this.layerOn && this.lookOn && p.live > 0;
  }

  /** The `furniture` layer (M02g1 `setLookLayer`): off hides every pool (render only; the slots stay). */
  setLayer(on: boolean): void {
    this.layerOn = on;
    for (const p of this.pools) p.mesh.visible = on && this.lookOn && p.live > 0;
  }

  /** The look switched at runtime (QA `setLook`): the legacy look draws no furniture. */
  setLookOn(on: boolean): void {
    this.lookOn = on;
    this.setLayer(this.layerOn);
  }

  get layer(): boolean {
    return this.layerOn;
  }

  /** Every frame: the heads near the camera at 10 Hz. `tick` and `blackout` are the newest snapshot's. */
  update(tick: number, blackout: boolean, camX: number, camZ: number, nowMs: number): void {
    const pi = this.poolOf.get('signal');
    if (pi === undefined) return;
    const p = this.pools[pi] as Pool;
    if (!p.aspect || p.live === 0) return;
    const heads = this.headSlots();
    if (this.clock.update(heads, p.aspect.array as Float32Array, tick, blackout, camX, camZ, nowMs)) p.aspect.needsUpdate = true;
  }

  private *headSlots(): Generator<HeadSlot> {
    for (const u of this.units.values()) yield* u.heads;
  }

  setReceiveShadow(receive: boolean): void {
    for (const p of this.pools) {
      if (p.mesh.receiveShadow === receive) continue;
      p.mesh.receiveShadow = receive;
      p.material.needsUpdate = true;
    }
  }

  /** Render objects the pools add now. */
  get objects(): number {
    return this.pools.filter((p) => p.mesh.visible && p.mesh.count > 0).length;
  }

  report(): FurniturePoolsReport {
    const pools: Record<string, { instances: number; cap: number }> = {};
    let triangles = 0;
    for (const p of this.pools) {
      pools[p.name] = { instances: p.live, cap: p.cap };
      if (!p.mesh.visible) continue;
      // each live instance draws the parts of its kind
      for (const u of this.units.values()) {
        for (const [q, s] of u.slots) if (q === this.pools.indexOf(p)) triangles += p.kit.triangles[(p.kind.array as Float32Array)[s] as number] ?? 0;
      }
    }
    let total = 0;
    for (const u of this.units.values()) total += u.heads.length;
    const h = this.clock.info();
    return { profile: this.profile, pools, objects: this.objects, dropped: this.dropped, heads: { n: h.n, aspects: h.aspects, total }, layer: this.layerOn, triangles };
  }

  /** The aspect codes of the heads in the signal pool (tests and the QA bridge). */
  headCodes(): { junction: number; movement: number; x: number; z: number; code: number }[] {
    const pi = this.poolOf.get('signal');
    const p = pi === undefined ? null : (this.pools[pi] as Pool);
    if (!p?.aspect) return [];
    const codes = p.aspect.array as Float32Array;
    return [...this.headSlots()].map((h) => ({ junction: h.head.junction, movement: h.head.movement, x: h.x, z: h.z, code: codes[h.slot] as number }));
  }

  /** The pool names of the profile, in order. */
  get names(): FurniturePoolName[] {
    return this.pools.map((p) => p.name);
  }

  /** A replaced renderer (device loss): every buffer is uploaded again. */
  rebuild(): void {
    for (const p of this.pools) this.flush(p);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.o.parent.remove(this.group);
    for (const p of this.pools) {
      p.mesh.geometry.dispose();
      p.material.dispose();
      p.mesh.dispose();
    }
  }
}

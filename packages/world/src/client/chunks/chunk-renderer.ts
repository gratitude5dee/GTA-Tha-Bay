/**
 * ChunkRenderer (02-world.md section 5.2; C08 rule 12; M02b1): draws the meshed units of the three LOD levels on the host's scene.
 *
 *  - One static `BundleGroup` per unit, at most six objects in it (terrain, buildings, roads, vegetation, and the empty furniture and
 *    extras). A bundle is re-recorded (`needsUpdate`) only on a LOD swap (a cover mask changed) or a re-mesh, and each request
 *    increments the unit's `bundleRerecords`: a render bundle is recorded only on the WebGPU backend [research/stack-rendering-platform.md
 *    1.5], so the tests count the requests, which every backend makes alike (DL-682).
 *  - `ChunkUploadGate`: at most one unit uploads per frame (<= 2 MB on `mobile-low` and `xr-quest`), highest priority first. A unit
 *    is "uploaded" the frame its objects join the scene; three uploads the buffers in that frame's render call.
 *  - Cover masks: an L1 tile hides the cells (4 x 4 of 256 m) whose L0 chunk is resident and has finished fading in, an L2 block the
 *    cells (4 x 4 of 1,024 m) whose L1 tile is. The mask is a vertex attribute (`aCover`), so the material never changes.
 *  - Visibility every 8 frames, on a camera jump of more than 60 m or a turn of more than 6 degrees; units behind the camera (dot <
 *    -0.35) and units outside the view frustum (with a margin) are hidden: the render-object plan of 02-world.md 5.4 counts the visible
 *    40 % of the resident units.
 *  - GPU loss: `onRendererReplaced` hides every unit and brings them back one per frame from the meshes it still holds, without a
 *    refetch.
 */
import {
  BufferAttribute, BufferGeometry, Color, type Frustum, Group, InstancedMesh, Matrix4, Mesh, type Object3D, BundleGroup, Sphere, Vector3, type WebGPURenderer,
} from 'three/webgpu';
import { MESHER, hexToLinear } from './mesher.ts';
import type { MeshBuffers, UnitMesh } from './mesh-types.ts';
import type { WorldMaterials } from './materials.ts';
import { ChunkUploadGate } from './upload-gate.ts';
import { CHUNK_EDGE_M, type ChunkKey } from '@dv/shared';

export type RenderLevel = 'l0' | 'l1' | 'l2';

/** GPU work that is not a chunk but takes a slot of the upload gate: a landmark swap commit (M02d2). */
export interface GateTask {
  run(info: { uploads: number }): void;
}
const isTask = (p: UnitMesh | GateTask): p is GateTask => typeof (p as GateTask).run === 'function';
const idOf = (level: RenderLevel, key: ChunkKey): string => `${level}:${key}`;

/** Camera jump that forces a visibility pass, metres. */
export const CULL_JUMP_M = 60;
export const CULL_EVERY_FRAMES = 8;
export const BEHIND_DOT = -0.35;
/** A turn of the heading that forces a visibility pass: cos 6 degrees. */
export const CULL_TURN_COS = 0.9945;
/** A unit's bounding sphere grows by this factor and this many metres before the frustum test (a turn between passes, a skirt). */
const FRUSTUM_MARGIN = 1.15;
const FRUSTUM_SLACK_M = 24;

/** What `update` needs of the camera: where it is, where it looks, and (when the host has one) its view frustum. */
export interface CullCamera {
  pos: [number, number, number];
  dir: [number, number, number];
  frustum?: Frustum | null;
}

export interface RenderedUnit {
  level: RenderLevel;
  key: ChunkKey;
  group: BundleGroup;
  objects: number;
  triangles: number;
  bytes: number;
  uploadedAt: number;
  /** Seconds at which the unit's fade-in is over (the time its parent may start to hide the cell under it). */
  coverFrom: number;
  mask: number;
  rerecords: number;
  centre: [number, number, number];
  radius: number;
  geometries: BufferGeometry[];
  mesh: UnitMesh;
  /** M02g2: the unit's instanced trees, or null; `vegShown` is false while they are beyond `tree.drawM` (one object and their triangles fewer). */
  vegetation: InstancedMesh | null;
  vegShown: boolean;
  /** Triangles of the instanced trees, taken off the unit's total while they are hidden. */
  vegTriangles: number;
}

/**
 * What the look pass tells the renderer (M02e): whether the meshes receive shadows, and which L0 `buildings` objects cast them.
 * Casters are decided when a unit is committed (the stream ranks the units around the focus first, so the units near the player are
 * the ones within the radius) and on a re-record, never by a re-record of their own.
 */
export interface LookRuntime {
  /** Meshes receive shadows (a shadow map exists on this tier). */
  receive: boolean;
  /** Casters are in use at all. */
  casting: boolean;
  /** L0 `buildings` objects of units within this many metres of the focus cast. */
  casterRadiusM: number;
  /** M02g1: the trees of L0 units within `dynamicCasterRadiusM` of the focus cast too (the `casters` layer, desktop tiers). */
  dynamicCasting?: boolean;
  dynamicCasterRadiusM?: number;
  /** The stream focus now. */
  focus(): { x: number; z: number };
}

export interface ChunkRendererOptions {
  parent: Object3D;
  materials: WorldMaterials;
  /** C13 `maxChunkUploadBytes`; null = no byte cap (one unit per frame still holds). */
  uploadBytes: number | null;
  /** Dithered fade-in over this many seconds; 0 swaps hard (mobile-low and Quest). */
  fadeSeconds: number;
  /**
   * M02g2: the trees of an L0 unit further than this many metres from the camera are not drawn (`tree.drawM` of the tier's mesher
   * profile). Infinity or absent: always drawn. A shown unit hides above `x (1 + hysteresis)`, a hidden one shows again within `x`.
   */
  treeDrawM?: number;
  /** M02g2: the hysteresis of the above; 0.1 when absent. */
  treeHysteresis?: number;
}

/** The trees of the resident L0 units as the camera sees them (QA, `look().vegetation`). */
export interface VegetationReport {
  /** L0 units whose trees are drawn / hidden now. */
  shown: number;
  hidden: number;
  /** The distance of the farthest drawn unit (its nearest edge) from the camera, metres; 0 with none. */
  farthestM: number;
  drawM: number;
  /** Times a unit's trees changed between drawn and hidden (each one a bundle re-record). */
  crossings: number;
}

/** The shared tree: a four-sided trunk and a six-sided cone, vertex coloured, 20 triangles. */
function treeGeometry(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const trunk = hexToLinear(MESHER.tree.trunk);
  const leaf = hexToLinear(MESHER.tree.leaves[0] as string);
  const ring = (y: number, r: number, n: number, rot: number): number[] => {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      ids.push(pos.length / 3);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
    return ids;
  };
  const addCols = (n: number, c: readonly [number, number, number]): void => {
    for (let i = 0; i < n; i++) col.push(c[0], c[1], c[2]);
  };
  const b0 = ring(0, 0.22, 4, Math.PI / 4);
  addCols(4, trunk);
  const b1 = ring(2.2, 0.18, 4, Math.PI / 4);
  addCols(4, trunk);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(b0[i] as number, b1[j] as number, b0[j] as number, b0[i] as number, b1[i] as number, b1[j] as number);
  }
  const c0 = ring(1.8, 1.7, 6, 0);
  addCols(6, leaf);
  const apex = pos.length / 3;
  pos.push(0, 6.2, 0);
  addCols(1, leaf);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    idx.push(c0[i] as number, apex, c0[j] as number);
  }
  const n = pos.length / 3;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aAO', new BufferAttribute(new Float32Array(n).fill(1), 1));
  g.setAttribute('aBirth', new BufferAttribute(new Float32Array(n), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class ChunkRenderer {
  readonly root = new Group();
  readonly gate: ChunkUploadGate<UnitMesh | GateTask>;
  /** Uploaded units by `level:key`. */
  readonly units = new Map<string, RenderedUnit>();
  /** Uploads per frame seen so far: the frame's count and the maximum. */
  uploadsThisFrame = 0;
  maxUploadsInFrame = 0;
  lastUploadBytes = 0;
  totalUploads = 0;
  cullPasses = 0;
  /** M02e: set by the look view; null leaves the legacy flags (no shadows). */
  look: LookRuntime | null = null;

  private readonly o: ChunkRendererOptions;
  private readonly treeDrawM: number;
  private readonly treeHysteresis: number;
  private readonly trees = treeGeometry();
  private readonly leafColors = MESHER.tree.leaves.map((h) => new Color().setRGB(...hexToLinear(h)));
  private readonly dirty = new Set<string>();
  private readonly pendingCover: { id: string; at: number }[] = [];
  private readonly rebuild: string[] = [];
  private readonly rerecords = new Map<string, number>();
  private frame = 0;
  /** M02g2: the camera the last visibility pass saw, and how often a unit's trees crossed the draw distance. */
  private camPos: [number, number, number] | null = null;
  private treeCrossings = 0;
  private lastCull = -1000;
  private lastCam = new Vector3(1e9, 1e9, 1e9);
  private lastDir: [number, number, number] = [0, 0, 0];
  private readonly ball = new Sphere();

  constructor(o: ChunkRendererOptions) {
    this.o = o;
    this.treeDrawM = o.treeDrawM ?? Infinity;
    this.treeHysteresis = o.treeHysteresis ?? 0.1;
    this.root.name = 'world.chunks';
    this.gate = new ChunkUploadGate<UnitMesh | GateTask>(o.uploadBytes);
    o.parent.add(this.root);
  }

  // ---- uploads -------------------------------------------------------------------------------------------------------------

  /** Queues a meshed unit for upload. `priority`: lower first (the stream rank). */
  enqueue(mesh: UnitMesh, priority: number): void {
    this.gate.enqueue({ id: idOf(mesh.level, mesh.key), priority, bytes: mesh.stats.bytes, payload: mesh });
  }

  /** Queues a task that takes one upload slot: it runs in the frame the gate releases it (the landmark swap commit). */
  enqueueTask(id: string, priority: number, bytes: number, task: GateTask): void {
    this.gate.enqueue({ id: `task:${id}`, priority, bytes, payload: task });
  }

  /** Removes a unit (evicted from the stream) from the scene and the queue; frees its geometry. */
  drop(level: RenderLevel, key: ChunkKey): void {
    const id = idOf(level, key);
    this.gate.remove(id);
    const u = this.units.get(id);
    if (!u) return;
    this.units.delete(id);
    this.root.remove(u.group);
    for (const g of u.geometries) g.dispose();
    this.markParent(level, key);
  }

  has(level: RenderLevel, key: ChunkKey): boolean {
    return this.units.has(idOf(level, key));
  }

  uploadedKeys(level: RenderLevel): ChunkKey[] {
    const out: ChunkKey[] = [];
    for (const u of this.units.values()) if (u.level === level) out.push(u.key);
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Per-unit re-record requests (every unit that ever had one, evicted or not). */
  bundleRerecords(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, n] of [...this.rerecords.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) out[id] = n;
    return out;
  }

  /** Re-record requests of one unit so far (0 before its first upload and while it has never been replaced). */
  rerecordsOf(level: RenderLevel, key: ChunkKey): number {
    return this.rerecords.get(idOf(level, key)) ?? 0;
  }

  private commit(mesh: UnitMesh, now: number): RenderedUnit {
    const id = idOf(mesh.level, mesh.key);
    const old = this.units.get(id);
    if (old) {
      this.root.remove(old.group);
      for (const g of old.geometries) g.dispose();
    }
    const level = mesh.level;
    const cellM = level === 'l1' ? CHUNK_EDGE_M[9] : level === 'l2' ? CHUNK_EDGE_M[7] : 0;
    const group = new BundleGroup();
    group.static = true;
    group.name = id;
    group.position.set(mesh.originX, 0, mesh.originZ);
    const geometries: BufferGeometry[] = [];
    let triangles = 0;
    let objects = 0;
    let vegetation: InstancedMesh | null = null;
    let vegTriangles = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const cast = this.castsShadows(level, mesh);
    for (const o of mesh.objects) {
      const g = this.geometryOf(o, now, cellM);
      geometries.push(g);
      const m = new Mesh(g, this.o.materials.materialFor(level, o.kind));
      m.name = `${id}:${o.kind}`;
      m.userData['kind'] = o.kind;
      m.receiveShadow = this.look?.receive ?? false;
      m.castShadow = cast && o.kind === 'buildings';
      // The bundle replays every draw, so three's own frustum test does not run inside it; the group is culled as a whole.
      m.frustumCulled = false;
      group.add(m);
      objects++;
      triangles += o.indices.length / 3;
      minX = Math.min(minX, o.bounds[0]); minY = Math.min(minY, o.bounds[1]); minZ = Math.min(minZ, o.bounds[2]);
      maxX = Math.max(maxX, o.bounds[3]); maxY = Math.max(maxY, o.bounds[4]); maxZ = Math.max(maxZ, o.bounds[5]);
    }
    if (mesh.trees.length > 0) {
      const count = mesh.trees.length / 5;
      const inst = new InstancedMesh(this.trees, this.o.materials.materialFor(level, 'vegetation'), count);
      inst.userData['kind'] = 'vegetation';
      inst.receiveShadow = this.look?.receive ?? false;
      inst.castShadow = this.treesCast(level, mesh);
      const mat = new Matrix4();
      for (let i = 0; i < count; i++) {
        const s = mesh.trees[i * 5 + 3] as number;
        mat.makeScale(s, s, s).setPosition(mesh.trees[i * 5] as number, mesh.trees[i * 5 + 1] as number, mesh.trees[i * 5 + 2] as number);
        inst.setMatrixAt(i, mat);
        inst.setColorAt(i, this.leafColors[(mesh.trees[i * 5 + 4] as number) % this.leafColors.length] as Color);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.name = `${id}:vegetation`;
      inst.frustumCulled = false;
      group.add(inst);
      objects++;
      vegTriangles = (this.trees.index?.count ?? 0) / 3 * count;
      triangles += vegTriangles;
      vegetation = inst;
    }
    if (!Number.isFinite(minX)) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
    // The first upload records the bundle (count 0); every later commit of the unit is a swap, one more request.
    const prev = this.rerecords.get(id);
    const rr = prev === undefined ? 0 : prev + 1;
    this.rerecords.set(id, rr);
    const u: RenderedUnit = {
      level, key: mesh.key, group, objects, triangles, bytes: mesh.stats.bytes, uploadedAt: now,
      coverFrom: now + this.o.fadeSeconds, mask: 0, rerecords: rr, geometries,
      centre: [mesh.originX + (minX + maxX) / 2, (minY + maxY) / 2, mesh.originZ + (minZ + maxZ) / 2],
      radius: Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2) / 2,
      mesh, vegetation, vegShown: true, vegTriangles,
    };
    // A unit that arrives beyond the draw distance never draws its trees (no re-record: the bundle is recorded after this).
    if (vegetation && level === 'l0' && this.camPos && this.treeDistance(u, this.camPos) > this.treeDrawM) {
      vegetation.visible = false;
      u.vegShown = false;
    }
    this.units.set(id, u);
    this.root.add(group);
    this.markParent(level, mesh.key);
    this.pendingCover.push({ id, at: u.coverFrom });
    return u;
  }

  private geometryOf(o: MeshBuffers, now: number, cellM: number): BufferGeometry {
    const g = new BufferGeometry();
    const n = o.positions.length / 3;
    g.setAttribute('position', new BufferAttribute(o.positions, 3));
    g.setAttribute('normal', new BufferAttribute(o.normals, 3));
    g.setAttribute('color', new BufferAttribute(o.colors, 3));
    g.setAttribute('aAO', new BufferAttribute(o.ao, 1));
    g.setAttribute('aBirth', new BufferAttribute(new Float32Array(n).fill(now), 1));
    // M02e: the surface ids and the façade coordinates, uploaded normalised (unorm8, snorm16); the look materials read them.
    g.setAttribute('surf', new BufferAttribute(o.surf, 4, true));
    if (o.facade) g.setAttribute('facade', new BufferAttribute(o.facade, 4, true));
    if (cellM > 0) {
      g.setAttribute('aCover', new BufferAttribute(new Float32Array(n), 1));
      g.setAttribute('aCell', new BufferAttribute(new Float32Array(n).fill(cellM), 1));
    }
    g.setIndex(new BufferAttribute(o.indices, 1));
    const b = o.bounds;
    const c = new Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    g.boundingSphere = new Sphere(c, Math.sqrt((b[3] - b[0]) ** 2 + (b[4] - b[1]) ** 2 + (b[5] - b[2]) ** 2) / 2);
    return g;
  }

  /** Whether the L0 `buildings` object of a unit casts shadows: the look casts, and the unit lies within the caster radius of the focus. */
  private castsShadows(level: RenderLevel, mesh: UnitMesh): boolean {
    const look = this.look;
    if (!look || !look.casting || level !== 'l0' || !(look.casterRadiusM > 0)) return false;
    const f = look.focus();
    const cx = mesh.originX + 128, cz = mesh.originZ + 128;
    return Math.hypot(cx - f.x, cz - f.z) <= look.casterRadiusM + 128;
  }

  /** M02g1: whether the trees of an L0 unit cast shadows: the `casters` layer is on and the unit lies within the dynamic caster radius of the focus. */
  private treesCast(level: RenderLevel, mesh: UnitMesh): boolean {
    const look = this.look;
    const radius = look?.dynamicCasterRadiusM ?? 0;
    if (!look || look.dynamicCasting !== true || level !== 'l0' || !(radius > 0)) return false;
    const f = look.focus();
    const cx = mesh.originX + 128, cz = mesh.originZ + 128;
    return Math.hypot(cx - f.x, cz - f.z) <= radius + 128;
  }

  /**
   * M02g1: the focus moved or the `casters` layer was switched: the trees of each resident L0 unit take the flag its distance gives.
   * A unit whose flag changes is recorded again (one re-record). Returns how many units changed.
   */
  refreshTreeCasters(): number {
    let changed = 0;
    for (const u of this.units.values()) {
      if (u.level !== 'l0') continue;
      const want = this.treesCast(u.level, u.mesh);
      let flip = false;
      for (const child of u.group.children) {
        if (child.userData['kind'] !== 'vegetation') continue;
        const m = child as Mesh;
        if (m.castShadow !== want) {
          m.castShadow = want;
          flip = true;
        }
      }
      if (flip) {
        this.requestRerecord(u);
        changed++;
      }
    }
    return changed;
  }

  /** Trees now flagged as shadow casters (the look reports `trees` among the dynamic casters when this is above 0). */
  treeCasterCount(): number {
    let n = 0;
    for (const u of this.units.values()) for (const child of u.group.children) if (child.userData['kind'] === 'vegetation' && (child as Mesh).castShadow) n++;
    return n;
  }

  /**
   * The look was switched (QA `setLook`) or its shadow state changed: every resident mesh takes the material and the shadow flags of
   * the new state and its bundle is recorded again, one re-record per resident unit.
   */
  applyLook(): void {
    for (const u of this.units.values()) {
      const cast = this.castsShadows(u.level, u.mesh);
      for (const child of u.group.children) {
        const kind = child.userData['kind'] as MeshBuffers['kind'] | undefined;
        if (!kind) continue;
        const m = child as Mesh;
        m.material = this.o.materials.materialFor(u.level, kind);
        m.receiveShadow = this.look?.receive ?? false;
        m.castShadow = kind === 'buildings' ? cast : kind === 'vegetation' ? this.treesCast(u.level, u.mesh) : false;
      }
      this.requestRerecord(u);
    }
  }

  /** The shadow casters now: how many objects, and the distinct `level:kind` pairs (the look reports them; only L0 `buildings` cast). */
  casterReport(): { count: number; kinds: string[] } {
    const kinds = new Set<string>();
    let count = 0;
    for (const u of this.units.values()) {
      for (const child of u.group.children) {
        // the buildings only: the trees that cast on the `casters` layer are reported by `treeCasterCount`
        if (!(child as Mesh).castShadow || child.userData['kind'] !== 'buildings') continue;
        count++;
        kinds.add(`${u.level}:${String(child.userData['kind'] ?? '?')}`);
      }
    }
    return { count, kinds: [...kinds].sort() };
  }

  private requestRerecord(u: RenderedUnit): void {
    (u.group as unknown as BundleGroup).needsUpdate = true;
    u.rerecords++;
    this.rerecords.set(idOf(u.level, u.key), u.rerecords);
  }

  // ---- cover masks ---------------------------------------------------------------------------------------------------------

  /** The parent unit (L1 tile of an L0 chunk, L2 block of an L1 tile) needs its mask recomputed. */
  private markParent(level: RenderLevel, key: ChunkKey): void {
    if (level === 'l2') return;
    const m = /^(\d)\/(\d+)\/(\d+)$/.exec(key);
    if (!m) return;
    const x = Number(m[2]) >> 2, y = Number(m[3]) >> 2;
    const parent = level === 'l0' ? idOf('l1', `7/${x}/${y}` as ChunkKey) : idOf('l2', `5/${x}/${y}` as ChunkKey);
    this.dirty.add(parent);
  }

  private maskOf(parent: RenderedUnit, now: number): number {
    const child: RenderLevel = parent.level === 'l1' ? 'l0' : 'l1';
    const z = child === 'l0' ? 9 : 7;
    const m = /^\d\/(\d+)\/(\d+)$/.exec(parent.key) as RegExpExecArray;
    const px = Number(m[1]), py = Number(m[2]);
    let mask = 0;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const c = this.units.get(idOf(child, `${z}/${px * 4 + i}/${py * 4 + j}` as ChunkKey));
        if (c && c.coverFrom <= now) mask |= 1 << (j * 4 + i);
      }
    }
    return mask;
  }

  private applyMask(u: RenderedUnit, mask: number): void {
    for (const g of u.geometries) {
      const a = g.getAttribute('aCover') as BufferAttribute | undefined;
      if (!a) continue;
      (a.array as Float32Array).fill(mask);
      a.needsUpdate = true;
    }
    u.mask = mask;
    this.requestRerecord(u);
  }

  // ---- the frame -----------------------------------------------------------------------------------------------------------

  /**
   * One frame. Releases at most one unit from the gate, brings back one unit after a GPU loss, refreshes the cover masks and runs
   * the visibility pass. Returns the unit uploaded this frame, if any.
   */
  update(nowSec: number, cam: CullCamera): RenderedUnit | null {
    this.frame++;
    this.o.materials.setTime(nowSec);
    this.uploadsThisFrame = 0;
    let uploaded: RenderedUnit | null = null;

    // A unit that came back after a GPU loss takes the frame's upload slot first.
    const back = this.rebuild.shift();
    if (back) {
      const u = this.units.get(back);
      if (u) {
        u.group.visible = true;
        this.uploadsThisFrame++;
        uploaded = u;
        this.requestRerecord(u);
      }
    } else {
      const item = this.gate.release(this.frame);
      if (item) {
        const payload = item.payload;
        this.uploadsThisFrame++;
        this.totalUploads++;
        this.lastUploadBytes = item.bytes;
        if (isTask(payload)) payload.run({ uploads: this.uploadsThisFrame });
        else uploaded = this.commit(payload, nowSec);
      }
    }
    this.maxUploadsInFrame = Math.max(this.maxUploadsInFrame, this.uploadsThisFrame);

    // Fade-in over: the parent may hide the cell under the child now.
    for (let i = this.pendingCover.length - 1; i >= 0; i--) {
      const p = this.pendingCover[i] as { id: string; at: number };
      if (p.at <= nowSec) {
        const u = this.units.get(p.id);
        if (u) this.markParent(u.level, u.key);
        this.pendingCover.splice(i, 1);
      }
    }
    for (const id of [...this.dirty]) {
      this.dirty.delete(id);
      const parent = this.units.get(id);
      if (!parent) continue;
      const mask = this.maskOf(parent, nowSec);
      if (mask !== parent.mask) this.applyMask(parent, mask);
    }

    // Visibility: every 8 frames or on a camera jump.
    const cp = new Vector3(cam.pos[0], cam.pos[1], cam.pos[2]);
    const turned = cam.dir[0] * this.lastDir[0] + cam.dir[1] * this.lastDir[1] + cam.dir[2] * this.lastDir[2] < CULL_TURN_COS;
    if (this.frame - this.lastCull >= CULL_EVERY_FRAMES || cp.distanceTo(this.lastCam) > CULL_JUMP_M || turned) {
      this.lastCull = this.frame;
      this.lastCam.copy(cp);
      this.lastDir = [cam.dir[0], cam.dir[1], cam.dir[2]];
      this.cullPasses++;
      this.cull(cam);
      this.camPos = [cam.pos[0], cam.pos[1], cam.pos[2]];
      this.cullTrees(this.camPos);
    }
    return uploaded;
  }

  private cull(cam: CullCamera): void {
    for (const u of this.units.values()) {
      if (this.rebuild.includes(idOf(u.level, u.key))) continue;
      const dx = u.centre[0] - cam.pos[0], dy = u.centre[1] - cam.pos[1], dz = u.centre[2] - cam.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= u.radius * 1.2) {
        u.group.visible = true;
        continue;
      }
      const dot = (dx * cam.dir[0] + dy * cam.dir[1] + dz * cam.dir[2]) / d;
      // A unit whose radius spans the camera's side planes stays; only clearly-behind units are hidden.
      const angleSlack = Math.min(1, u.radius / d);
      let seen = dot + angleSlack >= BEHIND_DOT;
      if (seen && cam.frustum) {
        this.ball.center.set(u.centre[0], u.centre[1], u.centre[2]);
        this.ball.radius = u.radius * FRUSTUM_MARGIN + FRUSTUM_SLACK_M;
        seen = cam.frustum.intersectsSphere(this.ball);
      }
      u.group.visible = seen;
    }
  }

  // ---- far trees (M02g2) ---------------------------------------------------------------------------------------------------

  /** Metres from the camera to the nearest point of the unit's 256 m square, in plan. */
  private treeDistance(u: RenderedUnit, cam: readonly number[]): number {
    const half = CHUNK_EDGE_M[9] / 2;
    const dx = Math.max(0, Math.abs(u.mesh.originX + half - (cam[0] as number)) - half);
    const dz = Math.max(0, Math.abs(u.mesh.originZ + half - (cam[2] as number)) - half);
    return Math.hypot(dx, dz);
  }

  /**
   * The trees of the L0 units beyond `treeDrawM` are not drawn: they hide above `treeDrawM x (1 + hysteresis)` and show again within
   * `treeDrawM`. A change is one re-record of the unit's bundle, counted like every other.
   */
  private cullTrees(cam: readonly number[]): void {
    if (!(this.treeDrawM < Infinity)) return;
    for (const u of this.units.values()) {
      if (!u.vegetation) continue;
      const d = this.treeDistance(u, cam);
      const want = u.vegShown ? d <= this.treeDrawM * (1 + this.treeHysteresis) : d <= this.treeDrawM;
      if (want === u.vegShown) continue;
      u.vegShown = want;
      u.vegetation.visible = want;
      this.treeCrossings++;
      this.requestRerecord(u);
    }
  }

  /** The state of the trees for the QA bridge. */
  vegetationReport(): VegetationReport {
    let shown = 0, hidden = 0, farthest = 0;
    const cam = this.camPos;
    for (const u of this.units.values()) {
      if (!u.vegetation) continue;
      if (u.vegShown) {
        shown++;
        if (cam) farthest = Math.max(farthest, this.treeDistance(u, cam));
      } else hidden++;
    }
    return { shown, hidden, farthestM: farthest, drawM: this.treeDrawM, crossings: this.treeCrossings };
  }

  // ---- GPU loss ------------------------------------------------------------------------------------------------------------

  /**
   * The renderer was replaced after a device loss (C13 5.8). The CPU-side meshes are still here: hide every unit and bring them
   * back one per frame, nearest first, without refetching anything.
   */
  onRendererReplaced(_next: WebGPURenderer, _prev: WebGPURenderer | null): Promise<void> {
    this.rebuild.length = 0;
    const list = [...this.units.values()].sort((a, b) => a.level.localeCompare(b.level) || (a.key < b.key ? -1 : 1));
    for (const u of list) {
      u.group.visible = false;
      this.rebuild.push(idOf(u.level, u.key));
    }
    return Promise.resolve();
  }

  /** Units waiting to come back after a GPU loss. */
  get rebuilding(): number {
    return this.rebuild.length;
  }

  // ---- numbers for the bridge ----------------------------------------------------------------------------------------------

  totals(): { objects: number; triangles: number; bytes: number } {
    let objects = 0, triangles = 0, bytes = 0;
    for (const u of this.units.values()) {
      if (!u.group.visible) continue;
      // trees beyond the draw distance are neither an object nor triangles (M02g2)
      const veg = u.vegetation && !u.vegShown;
      objects += u.objects - (veg ? 1 : 0);
      triangles += u.triangles - (veg ? u.vegTriangles : 0);
      bytes += u.bytes;
    }
    return { objects, triangles, bytes };
  }

  dispose(): void {
    for (const u of this.units.values()) for (const g of u.geometries) g.dispose();
    this.units.clear();
    this.o.parent.remove(this.root);
    this.trees.dispose();
  }
}

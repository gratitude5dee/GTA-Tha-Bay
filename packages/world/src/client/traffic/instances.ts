/**
 * The instanced traffic (02-world-living.md section 2.6; M03b1, final art M10d1). Ambient cars and parked cars are snapshot records
 * flagged ambient (`flags & 2`); the object pool skips them and this renderer draws them: per look profile a few families, each one
 * `InstancedMesh` (two on `full`, the glass pass split off) that draws the base body of one model with its wheels merged
 * (`config/world/traffic-art.json`). The members of a family differ by the scale of their instance matrix, a body colour (`aTint`), the
 * light bits (`aLights`) and a livery bit. Until a family's model has arrived it draws a gray-box car on the same materials. The total
 * never exceeds the C13 `CrowdLimits.maxTrafficInstances` of the tier.
 *
 * Slots are stable per entity handle: a car keeps its instance index in its family while it lives, a freed slot is a zero-scale matrix,
 * and the mesh `count` is the highest slot in use. Far cars (beyond `FAR_M`) rewrite their matrix one frame in `FAR_EVERY`.
 */
import { Group, InstancedBufferAttribute, InstancedMesh, type BufferGeometry, type Material, type Object3D } from 'three/webgpu';
import { uniform as uniformNode } from 'three/tsl';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import type { ArtLoader, ArtProfile } from '@dv/engine/client/vehicle/art';
import { ARCHETYPES, PALETTE } from '../../sim/traffic/components.ts';
import type { LookProfile } from '../look/config.ts';
import type { SkyNodes } from '../sky/nodes.ts';
import type { U } from '../sky/tsl.ts';
import { familiesOf, familyOf, mergeModel, placeholderGeometry, TRAFFIC_ART, type FamilyGeometry, type TrafficArtFile } from './archetype-mesh.ts';
import { LIVERY_BIT, makeArtMaterial, materialKindOf, type ArtMaterialKind } from './materials.ts';

/** Beyond this distance from the camera a car's matrix is refreshed one frame in `FAR_EVERY`. */
export const FAR_M = 150;
export const FAR_EVERY = 3;

type Pose = NonNullable<WorldFrame['poses']>[number];

export interface TrafficInfo {
  /** Instances in use across all families. */
  instances: number;
  /** Draw calls the traffic costs: the meshes of the families that have a car in use. */
  draws: number;
  /** Instances per archetype, in `ARCHETYPES` order. */
  perArchetype: number[];
  /** Highest slot in use (the mesh count) per family, in family order. */
  slots: number[];
  /** Matrices written in the last update. */
  written: number;
  /** Poses of the last update that were ambient but over the cap and so not drawn. */
  dropped: number;
  /** The cap the renderer enforces. */
  cap: number;
  /** Render objects the renderer adds to the scene (every mesh of every family). */
  objects: number;
  /** M10d1: the families of the look profile, and how many of them have their model loaded. */
  families: number;
  loaded: number;
  /** Triangles the drawn instances cost: each family's live count times the triangles of its geometry. */
  triangles: number;
}

export interface TrafficRendererOptions {
  parent: Pick<Object3D, 'add' | 'remove'>;
  sky: SkyNodes;
  /** C13 `CrowdLimits.maxTrafficInstances` of the tier. */
  cap: number;
  /** The look profile (default `legacy`: one family). */
  profile?: LookProfile;
  /** Loads the model of an asset ref at a variant; without it every family keeps its gray-box car. */
  load?: ArtLoader;
  /** The families config (default `config/world/traffic-art.json`). */
  config?: TrafficArtFile;
}

const COLORS = PALETTE.map((hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255] as const);
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLinear = (hex: string): readonly [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [toLinear(((v >> 16) & 255) / 255), toLinear(((v >> 8) & 255) / 255), toLinear((v & 255) / 255)];
};

/** A cheap deterministic [0, 1) from a handle: the livery bit does not flicker between runs. */
const unitOf = (handle: number): number => {
  let h = (handle ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

interface Family {
  name: string;
  /** Archetype ids this family draws. */
  members: number[];
  baseRef: string;
  opaque: InstancedMesh;
  glass: InstancedMesh | null;
  tint: InstancedBufferAttribute;
  lights: InstancedBufferAttribute;
  free: number[];
  high: number;
  live: number;
  size: readonly [number, number, number];
  loaded: boolean;
  /** Triangles of one instance (opaque and glass geometry). */
  tris: number;
  /** The glass geometry holds triangles (the model has glass and the profile splits it). */
  hasGlass: boolean;
  /** Rewrite every live matrix on the next update (the geometry changed, so the scales did). */
  rewrite: boolean;
}

interface SlotInfo {
  fam: number;
  slot: number;
  ai: number;
  livery: boolean;
}

export class TrafficRenderer {
  readonly group = new Group();
  readonly profile: LookProfile;
  private readonly cap: number;
  private readonly cfg: TrafficArtFile;
  private readonly families: Family[] = [];
  private readonly famOfArch: (number | undefined)[] = [];
  /** Per archetype: the instance scale over the family's base bounds. */
  private readonly scale: [number, number, number][] = [];
  private readonly slotOf = new Map<number, SlotInfo>();
  private readonly liveBy: number[] = ARCHETYPES.map(() => 0);
  private readonly archByKey = new Map<string, number>();
  private readonly seen = new Set<number>();
  private readonly uTime = uniformNode(0) as unknown as U<number>;
  private readonly materials: Material[] = [];
  private live = 0;
  private frame = 0;
  private written = 0;
  private dropped = 0;
  private disposed = false;

  constructor(private readonly o: TrafficRendererOptions) {
    this.cap = o.cap;
    this.cfg = o.config ?? TRAFFIC_ART;
    this.profile = o.profile ?? 'legacy';
    this.group.name = 'traffic';
    const split = this.cfg.profiles[this.profile].splitGlass;
    const n = Math.max(1, o.cap);
    const artProfile: ArtProfile = this.profile;
    const opaqueMat = makeArtMaterial({ profile: artProfile, sky: o.sky, pass: 'opaque', instanced: true, uTime: this.uTime });
    this.materials.push(opaqueMat);
    const glassMat = split ? makeArtMaterial({ profile: artProfile, sky: o.sky, pass: 'glass', instanced: true, uTime: this.uTime }) : null;
    if (glassMat) this.materials.push(glassMat);
    for (const a of ARCHETYPES) this.archByKey.set(a.asset, a.id);

    for (const name of familiesOf(this.cfg, this.profile)) {
      const baseRef = this.cfg.bases[name] as string;
      const tint = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      const lights = new InstancedBufferAttribute(new Float32Array(n), 1);
      const ph = placeholderGeometry();
      const mk = (geo: BufferGeometry, mat: Material, suffix: string): InstancedMesh => {
        geo.setAttribute('aTint', tint);
        geo.setAttribute('aLights', lights);
        const mesh = new InstancedMesh(geo, mat, n);
        mesh.name = `traffic.${name}${suffix}`;
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.visible = false;
        (mesh.instanceMatrix.array as Float32Array).fill(0);
        this.group.add(mesh);
        return mesh;
      };
      const opaque = mk(ph.opaque, opaqueMat, '');
      let glass: InstancedMesh | null = null;
      if (glassMat) {
        // an empty geometry until the model brings its glass; it shares the matrices and the attributes of the opaque mesh
        const empty = placeholderGeometry().opaque;
        empty.setIndex([]);
        glass = mk(empty, glassMat, '.glass');
        glass.instanceMatrix = opaque.instanceMatrix;
      }
      const members: number[] = [];
      for (const a of ARCHETYPES) if (familyOf(this.cfg, this.profile, a.asset) === name) members.push(a.id);
      const fam: Family = { name, members, baseRef, opaque, glass, tint, lights, free: [], high: 0, live: 0, size: ph.size, tris: ph.triangles, loaded: false, hasGlass: false, rewrite: false };
      this.families.push(fam);
      this.setScales(fam);
    }
    for (const a of ARCHETYPES) {
      const f = this.families.findIndex((fam) => fam.members.includes(a.id));
      this.famOfArch[a.id] = f >= 0 ? f : undefined;
    }
    o.parent.add(this.group);
    if (o.load) this.loadModels(o.load);
  }

  /** The material class of this renderer's paint (`physical` only on `full`). */
  get materialKind(): ArtMaterialKind {
    return materialKindOf(this.profile);
  }

  /** Total instances drawn. */
  get instances(): number {
    return this.live;
  }

  /** The names of the families, in order (tests and the QA bridge). */
  get familyNames(): string[] {
    return this.families.map((f) => f.name);
  }

  /** Asset refs of the base models the families draw. */
  get refs(): string[] {
    return this.families.map((f) => f.baseRef);
  }

  private setScales(fam: Family): void {
    for (const id of fam.members) {
      const a = ARCHETYPES[id];
      if (!a) continue;
      const m = this.cfg.members[a.asset];
      if (!m) continue;
      this.scale[id] = [m.size[0] / fam.size[0], m.size[1] / fam.size[1], m.size[2] / fam.size[2]];
    }
  }

  private loadModels(load: ArtLoader): void {
    const variant = this.cfg.profiles[this.profile].variant;
    const split = this.cfg.profiles[this.profile].splitGlass;
    for (const fam of this.families) {
      void load(fam.baseRef, variant).then(
        (model) => {
          if (!model || this.disposed) return;
          const g: FamilyGeometry = mergeModel(model, split);
          this.swap(fam, g);
        },
        () => undefined,
      );
    }
  }

  private swap(fam: Family, g: FamilyGeometry): void {
    const old = fam.opaque.geometry;
    g.opaque.setAttribute('aTint', fam.tint);
    g.opaque.setAttribute('aLights', fam.lights);
    fam.opaque.geometry = g.opaque;
    old.dispose();
    if (fam.glass) {
      const oldGlass = fam.glass.geometry;
      if (g.glass) {
        g.glass.setAttribute('aTint', fam.tint);
        g.glass.setAttribute('aLights', fam.lights);
        fam.glass.geometry = g.glass;
      } else {
        const empty = placeholderGeometry().opaque;
        empty.setIndex([]);
        empty.setAttribute('aTint', fam.tint);
        empty.setAttribute('aLights', fam.lights);
        fam.glass.geometry = empty;
      }
      oldGlass.dispose();
    }
    fam.size = g.size;
    fam.tris = g.triangles;
    fam.hasGlass = g.glass !== null;
    fam.loaded = true;
    fam.rewrite = true;
    this.setScales(fam);
  }

  /** M02g1: the traffic meshes cast and receive sun shadows (the `casters` layer on the desktop tiers). The glass never casts. */
  setShadows(cast: boolean, receive: boolean): void {
    for (const fam of this.families) {
      const m = fam.opaque;
      if (m.castShadow === cast && m.receiveShadow === receive) continue;
      m.castShadow = cast;
      if (m.receiveShadow !== receive) {
        m.receiveShadow = receive;
        (m.material as Material).needsUpdate = true;
      }
      if (fam.glass && fam.glass.receiveShadow !== receive) {
        fam.glass.receiveShadow = receive;
        (fam.glass.material as Material).needsUpdate = true;
      }
    }
  }

  /** Whether the traffic meshes cast shadows now. */
  get casting(): boolean {
    return this.families.some((f) => f.opaque.castShadow);
  }

  info(): TrafficInfo {
    const perMesh = this.families[0]?.glass ? 2 : 1;
    return {
      instances: this.live,
      draws: this.families.filter((f) => f.live > 0).length * perMesh,
      perArchetype: [...this.liveBy],
      slots: this.families.map((f) => f.high),
      written: this.written,
      dropped: this.dropped,
      cap: this.cap,
      objects: this.families.length * perMesh,
      families: this.families.length,
      loaded: this.families.filter((f) => f.loaded).length,
      triangles: this.families.reduce((a, f) => a + f.live * f.tris, 0),
    };
  }

  /**
   * Draws the ambient poses of a frame. `camera` is the draw camera position; `timeSec` drives the hazard flash. Returns the number
   * of instances drawn.
   */
  update(f: Pick<WorldFrame, 'poses' | 'poseCount' | 'poseKeys' | 'camera'>, timeSec: number): number {
    this.frame++;
    this.written = 0;
    this.dropped = 0;
    const poses = f.poses;
    const keys = f.poseKeys;
    const count = f.poseCount ?? 0;
    this.uTime.value = timeSec;
    if (!poses || !keys) return this.live;
    this.seen.clear();
    const cx = f.camera.pos[0], cz = f.camera.pos[2];
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      const p = poses[i] as Pose;
      if ((p.flags & 2) === 0) continue;
      const key = keys.get(p.renderKey);
      const ai = key === undefined ? undefined : this.archByKey.get(key);
      if (ai === undefined) continue;
      const fi = this.famOfArch[ai];
      if (fi === undefined) continue;
      const fam = this.families[fi] as Family;
      if (drawn >= this.cap) {
        this.dropped++;
        continue;
      }
      drawn++;
      let info = this.slotOf.get(p.handle);
      const fresh = info === undefined;
      if (info === undefined) {
        const slot = fam.free.pop() ?? fam.high++;
        if (slot >= fam.opaque.instanceMatrix.count) {
          this.dropped++;
          fam.free.push(slot);
          continue;
        }
        const share = this.cfg.members[ARCHETYPES[ai]?.asset ?? '']?.liveryShare ?? 0;
        info = { fam: fi, slot, ai, livery: unitOf(p.handle) < share };
        this.slotOf.set(p.handle, info);
        this.liveBy[ai] = (this.liveBy[ai] as number) + 1;
        fam.live++;
        this.live++;
      }
      this.seen.add(p.handle);
      const dx = p.px - cx, dz = p.pz - cz;
      const far = dx * dx + dz * dz > FAR_M * FAR_M;
      if (!fresh && far && !fam.rewrite && (this.frame + info.slot) % FAR_EVERY !== 0) {
        (fam.lights.array as Float32Array)[info.slot] = p.animState + (info.livery ? LIVERY_BIT : 0);
        continue;
      }
      this.write(fam, info, p, fresh);
    }
    // slots whose entity left the snapshot go dark
    for (const [h, info] of this.slotOf) {
      if (this.seen.has(h)) continue;
      const fam = this.families[info.fam] as Family;
      this.slotOf.delete(h);
      fam.free.push(info.slot);
      fam.live--;
      this.live--;
      this.liveBy[info.ai] = (this.liveBy[info.ai] as number) - 1;
      (fam.opaque.instanceMatrix.array as Float32Array).fill(0, info.slot * 16, info.slot * 16 + 16);
      this.trim(fam);
      fam.opaque.instanceMatrix.needsUpdate = true;
    }
    for (const fam of this.families) {
      fam.opaque.visible = fam.live > 0;
      fam.opaque.count = fam.high;
      if (fam.glass) {
        fam.glass.visible = fam.live > 0 && fam.hasGlass;
        fam.glass.count = fam.high;
      }
      if (fam.live > 0) fam.opaque.instanceMatrix.needsUpdate = true;
      fam.tint.needsUpdate = true;
      fam.lights.needsUpdate = true;
      fam.rewrite = false;
    }
    return this.live;
  }

  /** Lowers the highest slot past the freed ones at the top. */
  private trim(fam: Family): void {
    const used = new Set<number>();
    for (const i of this.slotOf.values()) if (this.families[i.fam] === fam) used.add(i.slot);
    while (fam.high > 0 && !used.has(fam.high - 1)) {
      fam.high--;
      const at = fam.free.indexOf(fam.high);
      if (at >= 0) fam.free.splice(at, 1);
    }
  }

  private write(fam: Family, info: SlotInfo, p: Pose, fresh: boolean): void {
    const m = fam.opaque.instanceMatrix.array as Float32Array;
    const o = info.slot * 16;
    const { qx, qy, qz, qw } = p;
    const [sx, sy, sz] = (this.scale[info.ai] ?? [1, 1, 1]) as [number, number, number];
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    m[o] = (1 - (yy + zz)) * sx;
    m[o + 1] = (xy + wz) * sx;
    m[o + 2] = (xz - wy) * sx;
    m[o + 3] = 0;
    m[o + 4] = (xy - wz) * sy;
    m[o + 5] = (1 - (xx + zz)) * sy;
    m[o + 6] = (yz + wx) * sy;
    m[o + 7] = 0;
    m[o + 8] = (xz + wy) * sz;
    m[o + 9] = (yz - wx) * sz;
    m[o + 10] = (1 - (xx + yy)) * sz;
    m[o + 11] = 0;
    // the pose is the centre of the physics box; the model stands on the road, `lift` below it along the body's own up axis
    const lift = ARCHETYPES[info.ai]?.lift ?? 0;
    m[o + 12] = p.px - lift * (xy - wz);
    m[o + 13] = p.py - lift * (1 - (xx + zz));
    m[o + 14] = p.pz - lift * (yz + wx);
    m[o + 15] = 1;
    this.written++;
    const t = fam.tint.array as Float32Array;
    if (fresh) {
      const member = this.cfg.members[ARCHETYPES[info.ai]?.asset ?? ''];
      let c: readonly [number, number, number] | undefined;
      if (member && !member.tint && member.paint) c = hexLinear(member.paint);
      else {
        const pc = COLORS[Math.round(p.animP1) % COLORS.length] ?? COLORS[0];
        if (pc) c = [toLinear(pc[0]), toLinear(pc[1]), toLinear(pc[2])];
      }
      if (c) {
        t[info.slot * 3] = c[0];
        t[info.slot * 3 + 1] = c[1];
        t[info.slot * 3 + 2] = c[2];
      }
    }
    // the light bits of the sim (animState) and the livery bit of the renderer
    (fam.lights.array as Float32Array)[info.slot] = p.animState + (info.livery ? LIVERY_BIT : 0);
  }

  dispose(): void {
    this.disposed = true;
    this.o.parent.remove(this.group);
    for (const fam of this.families) {
      fam.opaque.geometry.dispose();
      fam.glass?.geometry.dispose();
      fam.opaque.dispose();
      fam.glass?.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}

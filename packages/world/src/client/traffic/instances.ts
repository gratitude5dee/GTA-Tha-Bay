/**
 * The instanced traffic (02-world-living.md section 2.6; M03b1). Ambient cars and parked cars are snapshot records flagged ambient
 * (`flags & 2`); the object pool skips them and this renderer draws them: one `InstancedMesh` per archetype (the draws), a body colour
 * and the light bits as instance attributes, a two-box gray-box shape until the art lands (M10d1, Q-39), distance throttling of the
 * far cars' matrices, and a total that never exceeds the C13 `CrowdLimits.maxTrafficInstances` of the tier.
 *
 * Slots are stable per entity handle: a car keeps its instance index while it lives, a freed slot is a zero-scale matrix, and the
 * mesh `count` is the highest slot in use. Far cars (beyond `FAR_M`) rewrite their matrix one frame in `FAR_EVERY`.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, MeshStandardNodeMaterial, type Object3D,
} from 'three/webgpu';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import { ARCHETYPES, PALETTE, type Archetype } from '../../sim/traffic/components.ts';
import type { SkyNodes } from '../sky/nodes.ts';
import { asNode, attribute, float, vertexColor, vec3, type L } from '../sky/tsl.ts';
import { lampEmissive, type LampNodes } from './lights.ts';

/** Beyond this distance from the camera a car's matrix is refreshed one frame in `FAR_EVERY`. */
export const FAR_M = 150;
export const FAR_EVERY = 3;

type Pose = NonNullable<WorldFrame['poses']>[number];

export interface TrafficInfo {
  /** Instances in use across all archetypes. */
  instances: number;
  /** Draw calls the meshes cost: archetypes with at least one instance. */
  draws: number;
  /** Instances per archetype, in `ARCHETYPES` order. */
  perArchetype: number[];
  /** Highest slot in use per archetype (the mesh count). */
  slots: number[];
  /** Matrices written in the last update. */
  written: number;
  /** Poses of the last update that were ambient but over the cap and so not drawn. */
  dropped: number;
  /** The cap the renderer enforces. */
  cap: number;
  /** Render objects the renderer adds to the scene. */
  objects: number;
}

export interface TrafficRendererOptions {
  parent: Pick<Object3D, 'add' | 'remove'>;
  sky: SkyNodes;
  /** C13 `CrowdLimits.maxTrafficInstances` of the tier. */
  cap: number;
}

interface Layer {
  arch: Archetype;
  mesh: InstancedMesh;
  lamps: LampNodes;
  tint: InstancedBufferAttribute;
  lights: InstancedBufferAttribute;
  slotOf: Map<number, number>;
  free: number[];
  high: number;
  live: number;
}

const COLORS = PALETTE.map((hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255] as const);
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Body, cabin and a dark skirt in one geometry, origin at the centre of the physics box, forward -Z. */
export function carGeometry(arch: Archetype): BufferGeometry {
  const hw = arch.halfWidth, hl = arch.halfLength, hh = arch.halfHeight;
  const parts: { w: number; h: number; l: number; x: number; y: number; z: number; c: [number, number, number] }[] = [
    { w: hw * 2, h: 0.12, l: hl * 2 - 0.2, x: 0, y: -hh + 0.06, z: 0, c: [0.1, 0.1, 0.11] },
    { w: hw * 2, h: hh * 0.5, l: hl * 2, x: 0, y: -hh + 0.12 + hh * 0.25, z: 0, c: [1, 1, 1] },
    { w: hw * 1.7, h: hh * 0.42, l: hl * 1.0, x: 0, y: -hh + 0.12 + hh * 0.5 + hh * 0.21, z: hl * 0.12, c: [0.16, 0.18, 0.22] },
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const p of parts) {
    const g = new BoxGeometry(p.w, p.h, p.l);
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i) + p.x, gp.getY(i) + p.y, gp.getZ(i) + p.z);
      nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      col.push(p.c[0], p.c[1], p.c[2]);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
    base += gp.count;
    g.dispose();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(Float32Array.from(nor), 3));
  geo.setAttribute('color', new BufferAttribute(Float32Array.from(col), 3));
  geo.setIndex(idx);
  return geo;
}

export class TrafficRenderer {
  readonly group = new Group();
  private readonly layers: Layer[] = [];
  private readonly cap: number;
  private frame = 0;
  private written = 0;
  private dropped = 0;
  private readonly archByKey = new Map<string, number>();
  private readonly seen = new Set<number>();

  constructor(private readonly o: TrafficRendererOptions) {
    this.cap = o.cap;
    this.group.name = 'traffic';
    for (const arch of ARCHETYPES) {
      const geo = carGeometry(arch);
      const n = Math.max(1, o.cap);
      const tint = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      const lights = new InstancedBufferAttribute(new Float32Array(n), 1);
      geo.setAttribute('aTint', tint);
      geo.setAttribute('aLights', lights);
      const lamps = lampEmissive(o.sky, arch.halfWidth, arch.halfLength);
      const m = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.15 });
      m.colorNode = asNode((vertexColor(0) as L).mul(attribute('aTint', 'vec3') as L) as L);
      m.emissiveNode = lamps.emissive;
      const mesh = new InstancedMesh(geo, m, n);
      mesh.name = `traffic.${arch.prefab}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      const zero = mesh.instanceMatrix.array as Float32Array;
      zero.fill(0);
      this.group.add(mesh);
      this.layers.push({ arch, mesh, lamps, tint, lights, slotOf: new Map(), free: [], high: 0, live: 0 });
      this.archByKey.set(arch.asset, arch.id);
    }
    o.parent.add(this.group);
    void float;
    void vec3;
  }

  /** Total instances drawn. */
  get instances(): number {
    let n = 0;
    for (const l of this.layers) n += l.live;
    return n;
  }

  info(): TrafficInfo {
    return {
      instances: this.instances,
      draws: this.layers.filter((l) => l.live > 0).length,
      perArchetype: this.layers.map((l) => l.live),
      slots: this.layers.map((l) => l.high),
      written: this.written,
      dropped: this.dropped,
      cap: this.cap,
      objects: this.layers.length,
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
    for (const l of this.layers) l.lamps.uTime.value = timeSec;
    if (!poses || !keys) return this.instances;
    this.seen.clear();
    const cx = f.camera.pos[0], cz = f.camera.pos[2];
    let live = 0;
    for (let i = 0; i < count; i++) {
      const p = poses[i] as Pose;
      if ((p.flags & 2) === 0) continue;
      const key = keys.get(p.renderKey);
      const ai = key === undefined ? undefined : this.archByKey.get(key);
      if (ai === undefined) continue;
      if (live >= this.cap) {
        this.dropped++;
        continue;
      }
      live++;
      const layer = this.layers[ai] as Layer;
      let slot = layer.slotOf.get(p.handle);
      const fresh = slot === undefined;
      if (slot === undefined) {
        slot = layer.free.pop() ?? layer.high++;
        if (slot >= layer.mesh.instanceMatrix.count) {
          this.dropped++;
          layer.free.push(slot);
          continue;
        }
        layer.slotOf.set(p.handle, slot);
        layer.live++;
      }
      this.seen.add(p.handle);
      const dx = p.px - cx, dz = p.pz - cz;
      const far = dx * dx + dz * dz > FAR_M * FAR_M;
      if (!fresh && far && (this.frame + slot) % FAR_EVERY !== 0) continue;
      this.write(layer, slot, p, fresh);
    }
    // slots whose entity left the snapshot go dark
    for (const l of this.layers) {
      let freed = false;
      for (const [h, slot] of l.slotOf) {
        if (this.seen.has(h)) continue;
        l.slotOf.delete(h);
        l.free.push(slot);
        l.live--;
        const m = l.mesh.instanceMatrix.array as Float32Array;
        m.fill(0, slot * 16, slot * 16 + 16);
        freed = true;
      }
      while (l.high > 0 && !this.slotUsed(l, l.high - 1)) {
        l.high--;
        const at = l.free.indexOf(l.high);
        if (at >= 0) l.free.splice(at, 1);
      }
      l.mesh.count = l.high;
      if (freed || l.live > 0) l.mesh.instanceMatrix.needsUpdate = true;
      l.tint.needsUpdate = true;
      l.lights.needsUpdate = true;
    }
    return this.instances;
  }

  private slotUsed(l: Layer, slot: number): boolean {
    for (const s of l.slotOf.values()) if (s === slot) return true;
    return false;
  }

  private write(l: Layer, slot: number, p: Pose, fresh: boolean): void {
    const m = l.mesh.instanceMatrix.array as Float32Array;
    const o = slot * 16;
    const { qx, qy, qz, qw } = p;
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    m[o] = 1 - (yy + zz);
    m[o + 1] = xy + wz;
    m[o + 2] = xz - wy;
    m[o + 3] = 0;
    m[o + 4] = xy - wz;
    m[o + 5] = 1 - (xx + zz);
    m[o + 6] = yz + wx;
    m[o + 7] = 0;
    m[o + 8] = xz + wy;
    m[o + 9] = yz - wx;
    m[o + 10] = 1 - (xx + yy);
    m[o + 11] = 0;
    m[o + 12] = p.px;
    m[o + 13] = p.py;
    m[o + 14] = p.pz;
    m[o + 15] = 1;
    this.written++;
    // colour (animP1 holds the palette index) and the light bits (animState)
    const t = l.tint.array as Float32Array;
    if (fresh) {
      const c = COLORS[Math.round(p.animP1) % COLORS.length] ?? COLORS[0];
      if (c) {
        t[slot * 3] = toLinear(c[0]);
        t[slot * 3 + 1] = toLinear(c[1]);
        t[slot * 3 + 2] = toLinear(c[2]);
      }
    }
    (l.lights.array as Float32Array)[slot] = p.animState;
  }

  dispose(): void {
    this.o.parent.remove(this.group);
    for (const l of this.layers) {
      l.mesh.geometry.dispose();
      (l.mesh.material as MeshStandardNodeMaterial).dispose();
      l.mesh.dispose();
    }
    this.layers.length = 0;
  }
}

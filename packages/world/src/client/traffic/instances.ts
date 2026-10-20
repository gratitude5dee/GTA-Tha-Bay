/**
 * The instanced traffic (02-world-living.md section 2.6; M03b1). Ambient cars and parked cars are snapshot records flagged ambient
 * (`flags & 2`); the object pool skips them and this renderer draws them: ONE `InstancedMesh` for every archetype (one draw, one render
 * object whatever the mix; the archetypes differ by the scale of their instance matrix over a reference two-box car), a body colour
 * and the light bits as instance attributes, a gray-box shape until the art lands (M10d1, Q-39), distance throttling of the far
 * cars' matrices, and a total that never exceeds the C13 `CrowdLimits.maxTrafficInstances` of the tier.
 *
 * Slots are stable per entity handle: a car keeps its instance index while it lives, a freed slot is a zero-scale matrix, and the
 * mesh `count` is the highest slot in use. Far cars (beyond `FAR_M`) rewrite their matrix one frame in `FAR_EVERY`.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, MeshStandardNodeMaterial, type Object3D,
} from 'three/webgpu';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import { ARCH, ARCHETYPES, PALETTE, type Archetype } from '../../sim/traffic/components.ts';
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
  /** Draw calls the traffic costs: 1 when any car is drawn. */
  draws: number;
  /** Instances per archetype, in `ARCHETYPES` order. */
  perArchetype: number[];
  /** Highest slot in use (the mesh count), one entry. */
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

/** The reference car the one geometry is built for (the sedan); every archetype scales it. */
const REF = ARCHETYPES[ARCH.sedan] as Archetype;
const SCALE = ARCHETYPES.map((a) => [a.halfWidth / REF.halfWidth, a.halfHeight / REF.halfHeight, a.halfLength / REF.halfLength] as const);

export class TrafficRenderer {
  readonly group = new Group();
  private readonly cap: number;
  private readonly mesh: InstancedMesh;
  private readonly lamps: LampNodes;
  private readonly tint: InstancedBufferAttribute;
  private readonly lights: InstancedBufferAttribute;
  private readonly slotOf = new Map<number, number>();
  private readonly archOfSlot: number[] = [];
  private readonly free: number[] = [];
  private high = 0;
  private live = 0;
  private readonly liveBy: number[] = ARCHETYPES.map(() => 0);
  private frame = 0;
  private written = 0;
  private dropped = 0;
  private readonly archByKey = new Map<string, number>();
  private readonly seen = new Set<number>();

  constructor(private readonly o: TrafficRendererOptions) {
    this.cap = o.cap;
    this.group.name = 'traffic';
    const geo = carGeometry(REF);
    const n = Math.max(1, o.cap);
    this.tint = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    this.lights = new InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('aTint', this.tint);
    geo.setAttribute('aLights', this.lights);
    this.lamps = lampEmissive(o.sky, REF.halfWidth, REF.halfLength);
    const m = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.15 });
    m.colorNode = asNode((vertexColor(0) as L).mul(attribute('aTint', 'vec3') as L) as L);
    m.emissiveNode = this.lamps.emissive;
    this.mesh = new InstancedMesh(geo, m, n);
    this.mesh.name = 'traffic.cars';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    (this.mesh.instanceMatrix.array as Float32Array).fill(0);
    this.group.add(this.mesh);
    for (const a of ARCHETYPES) this.archByKey.set(a.asset, a.id);
    o.parent.add(this.group);
    void float;
    void vec3;
  }

  /** Total instances drawn. */
  get instances(): number {
    return this.live;
  }

  info(): TrafficInfo {
    return {
      instances: this.live,
      draws: this.live > 0 ? 1 : 0,
      perArchetype: [...this.liveBy],
      slots: [this.high],
      written: this.written,
      dropped: this.dropped,
      cap: this.cap,
      objects: 1,
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
    this.lamps.uTime.value = timeSec;
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
      if (drawn >= this.cap) {
        this.dropped++;
        continue;
      }
      drawn++;
      let slot = this.slotOf.get(p.handle);
      const fresh = slot === undefined;
      if (slot === undefined) {
        slot = this.free.pop() ?? this.high++;
        if (slot >= this.mesh.instanceMatrix.count) {
          this.dropped++;
          this.free.push(slot);
          continue;
        }
        this.slotOf.set(p.handle, slot);
        this.archOfSlot[slot] = ai;
        this.liveBy[ai] = (this.liveBy[ai] as number) + 1;
        this.live++;
      }
      this.seen.add(p.handle);
      const dx = p.px - cx, dz = p.pz - cz;
      const far = dx * dx + dz * dz > FAR_M * FAR_M;
      if (!fresh && far && (this.frame + slot) % FAR_EVERY !== 0) continue;
      this.write(slot, ai, p, fresh);
    }
    // slots whose entity left the snapshot go dark
    let freed = false;
    for (const [h, slot] of this.slotOf) {
      if (this.seen.has(h)) continue;
      this.slotOf.delete(h);
      this.free.push(slot);
      this.live--;
      const ai = this.archOfSlot[slot] as number;
      this.liveBy[ai] = (this.liveBy[ai] as number) - 1;
      (this.mesh.instanceMatrix.array as Float32Array).fill(0, slot * 16, slot * 16 + 16);
      freed = true;
    }
    if (freed) {
      const used = new Set(this.slotOf.values());
      while (this.high > 0 && !used.has(this.high - 1)) {
        this.high--;
        const at = this.free.indexOf(this.high);
        if (at >= 0) this.free.splice(at, 1);
      }
    }
    this.mesh.visible = this.live > 0;
    this.mesh.count = this.high;
    if (freed || this.live > 0) this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.lights.needsUpdate = true;
    return this.live;
  }

  private write(slot: number, ai: number, p: Pose, fresh: boolean): void {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const o = slot * 16;
    const { qx, qy, qz, qw } = p;
    const [sx, sy, sz] = SCALE[ai] as readonly [number, number, number];
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
    m[o + 12] = p.px;
    m[o + 13] = p.py;
    m[o + 14] = p.pz;
    m[o + 15] = 1;
    this.written++;
    // colour (animP1 holds the palette index) and the light bits (animState)
    const t = this.tint.array as Float32Array;
    if (fresh) {
      const c = COLORS[Math.round(p.animP1) % COLORS.length] ?? COLORS[0];
      if (c) {
        t[slot * 3] = toLinear(c[0]);
        t[slot * 3 + 1] = toLinear(c[1]);
        t[slot * 3 + 2] = toLinear(c[2]);
      }
    }
    (this.lights.array as Float32Array)[slot] = p.animState;
  }

  dispose(): void {
    this.o.parent.remove(this.group);
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardNodeMaterial).dispose();
    this.mesh.dispose();
  }
}

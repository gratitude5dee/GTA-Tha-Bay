/**
 * The instanced pedestrians (02-world-living.md section 4.5; M03b2). Ambient pedestrians are snapshot records flagged ambient
 * (`flags & 2`) whose render key is one of the eight `character/ped.ambient.{a..h}` bodies; the object pool skips them and this
 * renderer draws them:
 *
 *  - far level: ONE `InstancedMesh` per body of a rigid low-poly figure (72 triangles) whose legs and arms swing in the vertex
 *    shader (TSL) with a phase per instance; the clothing colour (one of 20 outfits) is an instance attribute;
 *  - near level (within 25 m): the nearest pedestrians, up to the tier's skinned cap (24 desktop, 16 Vision Pro, 12 mobile, 8 Quest,
 *    6 mobile-low), are drawn as the skinned mannequin on `bay_rig_v1` driven by the engine anim states, and leave the far level;
 *  - the total drawn never exceeds the C13 `CrowdLimits.maxPedInstances` of the tier. Excess near pedestrians draw as far figures.
 *
 * Slots are stable per entity handle; a freed slot is a zero-scale matrix and the mesh `count` is the highest slot in use.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, MeshStandardNodeMaterial, type Object3D,
} from 'three/webgpu';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import { MannequinAnimator } from '@dv/engine/client/anim';
import { PED_ASSETS, PED_BODIES, PED_PALETTE } from '../../sim/peds/components.ts';
import { NEAR_PED_M } from '../../sim/peds/density.ts';
import { asNode, attribute, cos, float, sin, vec3, vertexColor, positionLocal, type L } from '../sky/tsl.ts';
import { buildNearFigure, type NearFigure } from './mannequin.ts';

type Pose = NonNullable<WorldFrame['poses']>[number];

export interface PedInfo {
  /** Instances drawn at the far level, near skinned figures, and their sum. */
  far: number;
  near: number;
  instances: number;
  /** Far instances per body. */
  perBody: number[];
  /** Draw calls the pedestrians cost: far meshes in use plus near figures. */
  draws: number;
  /** Render objects the renderer adds to the scene (visible meshes). */
  objects: number;
  cap: number;
  nearCap: number;
  dropped: number;
}

export interface PedRendererOptions {
  parent: Pick<Object3D, 'add' | 'remove'>;
  /** C13 `CrowdLimits.maxPedInstances` of the tier. */
  cap: number;
  /** Skinned near-LOD cap of the tier. */
  nearCap: number;
  /**
   * M02h2: the render lift of a foot at world (x, z) (the curb height on a curbed sidewalk, chunks/sidewalks.ts); the figures draw that much
   * higher. Absent: 0. Render only: the sim keeps its heights.
   */
  lift?: (x: number, z: number) => number;
}

const COLORS = PED_PALETTE.map((hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255] as const);
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** A walking cycle of the far figure, radians per metre walked. */
const GAIT_PER_M = 4.2;
const SWING = 0.55;
const SKIN_TONES: readonly (readonly [number, number, number])[] = [
  [1, 0.8, 0.66], [0.78, 0.55, 0.4], [0.55, 0.38, 0.27], [0.93, 0.72, 0.58], [0.4, 0.27, 0.2], [0.86, 0.66, 0.5], [0.68, 0.47, 0.34], [0.97, 0.78, 0.64],
];

const HIP_Y = 0.9;
const SHOULDER_Y = 1.45;

/** The far figure: torso, head, two legs, two arms as boxes; `aSwing` is the swing direction of a part, `aPivot` its pivot height. */
export function figureGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const swing: number[] = [];
  const pivot: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, c: [number, number, number], sw: number, pv: number): void => {
    const g = new BoxGeometry(w, h, l);
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i) + x, gp.getY(i) + y, gp.getZ(i) + z);
      nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      col.push(c[0], c[1], c[2]);
      swing.push(sw);
      pivot.push(pv);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
    base += gp.count;
    g.dispose();
  };
  // clothing is white (it takes the tint); skin parts are marked by the blue channel being 0 and take the body's skin tone
  const W: [number, number, number] = [1, 1, 1];
  const S: [number, number, number] = [1, 1, 0];
  box(0.4, 0.62, 0.22, 0, 1.18, 0, W, 0, HIP_Y); // torso
  box(0.22, 0.24, 0.22, 0, 1.62, 0, S, 0, HIP_Y); // head
  box(0.15, 0.9, 0.16, 0.1, 0.45, 0, W, 1, HIP_Y); // left leg
  box(0.15, 0.9, 0.16, -0.1, 0.45, 0, W, -1, HIP_Y); // right leg
  box(0.1, 0.62, 0.12, 0.26, 1.16, 0, S, -1, SHOULDER_Y); // left arm
  box(0.1, 0.62, 0.12, -0.26, 1.16, 0, S, 1, SHOULDER_Y); // right arm
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(Float32Array.from(nor), 3));
  geo.setAttribute('color', new BufferAttribute(Float32Array.from(col), 3));
  geo.setAttribute('aSwing', new BufferAttribute(Float32Array.from(swing), 1));
  geo.setAttribute('aPivot', new BufferAttribute(Float32Array.from(pivot), 1));
  geo.setIndex(idx);
  return geo;
}

interface BodyMesh {
  mesh: InstancedMesh;
  tint: InstancedBufferAttribute;
  gait: InstancedBufferAttribute;
  slotOf: Map<number, number>;
  free: number[];
  high: number;
  live: number;
  /** Walk phase per slot (radians). */
  phase: Float32Array;
}

interface NearSlot {
  fig: NearFigure;
  anim: MannequinAnimator;
  handle: number;
  pending: number;
  outfit: number;
}

export class PedRenderer {
  readonly group = new Group();
  private readonly bodies: BodyMesh[] = [];
  private readonly archByKey = new Map<string, number>();
  private readonly near: NearSlot[] = [];
  private readonly nearBy = new Map<number, NearSlot>();
  private readonly seen = new Set<number>();
  private readonly cand: { p: Pose; d: number }[] = [];
  private readonly geo: BufferGeometry;
  private info0: PedInfo;
  private lastT = 0;

  constructor(private readonly o: PedRendererOptions) {
    this.group.name = 'peds';
    this.geo = figureGeometry();
    const n = Math.max(1, o.cap);
    for (let b = 0; b < PED_BODIES; b++) {
      this.archByKey.set(PED_ASSETS[b] as string, b);
      const tint = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      const gait = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
      const g = this.geo.clone();
      g.setAttribute('aTint', tint);
      g.setAttribute('aGait', gait);
      const skin = SKIN_TONES[b] as readonly [number, number, number];
      const m = new MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.02 });
      const vc = vertexColor(0) as L;
      const isSkin = float(1).sub(vc.b);
      const tintA = attribute('aTint', 'vec3') as L;
      m.colorNode = asNode(tintA.mul(float(1).sub(isSkin)).add(vec3(skin[0], skin[1], skin[2]).mul(isSkin)));
      const swingA = (attribute('aSwing', 'float') as L).mul((attribute('aGait', 'vec2') as L).y).mul(sin((attribute('aGait', 'vec2') as L).x));
      const pivotA = attribute('aPivot', 'float') as L;
      const p = positionLocal;
      const dy = p.y.sub(pivotA);
      const y2 = pivotA.add(dy.mul(cos(swingA))).sub(p.z.mul(sin(swingA)));
      const z2 = dy.mul(sin(swingA)).add(p.z.mul(cos(swingA)));
      m.positionNode = asNode(vec3(p.x, y2, z2));
      const mesh = new InstancedMesh(g, m, n);
      mesh.name = `peds.far.${String.fromCharCode(97 + b)}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      (mesh.instanceMatrix.array as Float32Array).fill(0);
      this.group.add(mesh);
      this.bodies.push({ mesh, tint, gait, slotOf: new Map(), free: [], high: 0, live: 0, phase: new Float32Array(n) });
    }
    this.info0 = this.blank();
    o.parent.add(this.group);
  }

  private blank(): PedInfo {
    return { far: 0, near: 0, instances: 0, perBody: this.bodies.map(() => 0), draws: 0, objects: 0, cap: this.o.cap, nearCap: this.o.nearCap, dropped: 0 };
  }

  info(): PedInfo {
    return this.info0;
  }

  /** M02h2 QA: the drawn feet of up to `max` pedestrians (the far instances' translations and the near figures' roots). */
  drawnFeet(max = 64): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (const s of this.near) {
      if (out.length >= max) return out;
      if (s.handle !== 0) out.push({ x: s.fig.root.position.x, y: s.fig.root.position.y, z: s.fig.root.position.z });
    }
    for (const body of this.bodies) {
      const m = body.mesh.instanceMatrix.array as Float32Array;
      for (const slot of body.slotOf.values()) {
        if (out.length >= max) return out;
        out.push({ x: m[slot * 16 + 12] as number, y: m[slot * 16 + 13] as number, z: m[slot * 16 + 14] as number });
      }
    }
    return out;
  }

  /** M02h2: the render lift at a foot (0 without a lift source). */
  private liftAt(x: number, z: number): number {
    return this.o.lift ? this.o.lift(x, z) : 0;
  }

  /** Draws the ambient pedestrian poses of a frame; returns the instances drawn (far and near). */
  update(f: Pick<WorldFrame, 'poses' | 'poseCount' | 'poseKeys' | 'camera'>, timeSec: number): number {
    const dt = this.lastT > 0 ? Math.min(0.1, Math.max(0, timeSec - this.lastT)) : 0;
    this.lastT = timeSec;
    const poses = f.poses;
    const keys = f.poseKeys;
    const count = f.poseCount ?? 0;
    const info = this.blank();
    if (!poses || !keys) {
      this.finish(info);
      return 0;
    }
    this.seen.clear();
    this.cand.length = 0;
    const cx = f.camera.pos[0], cz = f.camera.pos[2];
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      const p = poses[i] as Pose;
      if ((p.flags & 2) === 0) continue;
      const key = keys.get(p.renderKey);
      if (key === undefined || !this.archByKey.has(key)) continue;
      if (drawn >= this.o.cap) {
        info.dropped++;
        continue;
      }
      drawn++;
      const dx = p.px - cx, dz = p.pz - cz;
      this.cand.push({ p, d: dx * dx + dz * dz });
    }
    // the nearest pedestrians within the near radius take the skinned figures
    const r2 = NEAR_PED_M * NEAR_PED_M;
    const nearSet = new Set<number>();
    if (this.o.nearCap > 0) {
      const within = this.cand.filter((c) => c.d <= r2).sort((a, b) => (a.d !== b.d ? a.d - b.d : a.p.handle - b.p.handle));
      for (let i = 0; i < within.length && nearSet.size < this.o.nearCap; i++) nearSet.add((within[i] as { p: Pose }).p.handle);
    }
    for (const c of this.cand) {
      const p = c.p;
      this.seen.add(p.handle);
      if (nearSet.has(p.handle)) this.drawNear(p, dt, info);
      else this.drawFar(p, keys.get(p.renderKey) as string, dt, info);
    }
    this.sweep(nearSet);
    this.finish(info);
    return info.instances;
  }

  private drawFar(p: Pose, key: string, dt: number, info: PedInfo): void {
    const b = this.archByKey.get(key) as number;
    const body = this.bodies[b] as BodyMesh;
    let slot = body.slotOf.get(p.handle);
    const fresh = slot === undefined;
    if (slot === undefined) {
      slot = body.free.pop() ?? body.high++;
      if (slot >= body.mesh.instanceMatrix.count) {
        info.dropped++;
        body.free.push(slot);
        return;
      }
      body.slotOf.set(p.handle, slot);
      body.live++;
    }
    const t = body.tint.array as Float32Array;
    if (fresh) {
      const c = COLORS[Math.round(p.animP1) % COLORS.length] ?? COLORS[0];
      if (c) {
        t[slot * 3] = toLinear(c[0]);
        t[slot * 3 + 1] = toLinear(c[1]);
        t[slot * 3 + 2] = toLinear(c[2]);
      }
      body.phase[slot] = ((p.handle * 2654435761) >>> 0) / 4294967296 * 6.2832;
    }
    // the stride follows the speed: phase per metre walked
    const sp = p.animState === 2 ? Math.max(p.animP0, 2.4) : p.animP0;
    body.phase[slot] = (body.phase[slot] as number) + sp * dt * GAIT_PER_M;
    const g = body.gait.array as Float32Array;
    g[slot * 2] = body.phase[slot] as number;
    g[slot * 2 + 1] = sp > 0.1 ? SWING * Math.min(1.6, sp / 1.4) : 0;
    this.writeMatrix(body.mesh, slot, p, 1);
    info.far++;
    info.instances++;
    (info.perBody as number[])[b] = (info.perBody[b] as number) + 1;
  }

  private writeMatrix(mesh: InstancedMesh, slot: number, p: Pose, scale: number): void {
    const m = mesh.instanceMatrix.array as Float32Array;
    const o = slot * 16;
    const { qx, qy, qz, qw } = p;
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    m[o] = (1 - (yy + zz)) * scale;
    m[o + 1] = (xy + wz) * scale;
    m[o + 2] = (xz - wy) * scale;
    m[o + 3] = 0;
    m[o + 4] = (xy - wz) * scale;
    m[o + 5] = (1 - (xx + zz)) * scale;
    m[o + 6] = (yz + wx) * scale;
    m[o + 7] = 0;
    m[o + 8] = (xz + wy) * scale;
    m[o + 9] = (yz - wx) * scale;
    m[o + 10] = (1 - (xx + yy)) * scale;
    m[o + 11] = 0;
    m[o + 12] = p.px;
    m[o + 13] = p.py + this.liftAt(p.px, p.pz);
    m[o + 14] = p.pz;
    m[o + 15] = 1;
  }

  private drawNear(p: Pose, dt: number, info: PedInfo): void {
    let s = this.nearBy.get(p.handle);
    if (!s) {
      s = this.near.find((n) => n.handle === 0) ?? this.makeNear();
      s.handle = p.handle;
      s.pending = 0;
      s.outfit = -1;
      this.nearBy.set(p.handle, s);
      s.fig.root.visible = true;
    }
    if (s.outfit !== Math.round(p.animP1)) {
      s.outfit = Math.round(p.animP1);
      s.fig.setTint(PED_PALETTE[s.outfit % PED_PALETTE.length] as number);
    }
    s.fig.root.position.set(p.px, p.py + this.liftAt(p.px, p.pz), p.pz);
    s.fig.root.quaternion.set(p.qx, p.qy, p.qz, p.qw);
    s.pending += dt;
    // states the mannequin graph knows (0 to 3); everything else stands
    const st = p.animState === 1 || p.animState === 2 || p.animState === 3 ? p.animState : 0;
    s.anim.update(dt, st, p.animP0, s.pending);
    s.pending = 0;
    info.near++;
    info.instances++;
  }

  private makeNear(): NearSlot {
    const fig = buildNearFigure();
    const slot: NearSlot = { fig, anim: new MannequinAnimator(fig), handle: 0, pending: 0, outfit: -1 };
    this.group.add(fig.root);
    this.near.push(slot);
    return slot;
  }

  /** Frees the slots of pedestrians that left the snapshot or moved to the other level. */
  private sweep(nearSet: ReadonlySet<number>): void {
    for (const [h, s] of this.nearBy) {
      if (this.seen.has(h) && nearSet.has(h)) continue;
      this.nearBy.delete(h);
      s.handle = 0;
      s.fig.root.visible = false;
    }
    for (const body of this.bodies) {
      let freed = false;
      for (const [h, slot] of body.slotOf) {
        if (this.seen.has(h) && !nearSet.has(h)) continue;
        body.slotOf.delete(h);
        body.free.push(slot);
        body.live--;
        (body.mesh.instanceMatrix.array as Float32Array).fill(0, slot * 16, slot * 16 + 16);
        freed = true;
      }
      if (freed) {
        const used = new Set(body.slotOf.values());
        while (body.high > 0 && !used.has(body.high - 1)) {
          body.high--;
          const at = body.free.indexOf(body.high);
          if (at >= 0) body.free.splice(at, 1);
        }
        body.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private finish(info: PedInfo): void {
    let meshes = 0;
    for (const body of this.bodies) {
      body.mesh.visible = body.live > 0;
      body.mesh.count = body.high;
      if (body.live > 0) {
        body.mesh.instanceMatrix.needsUpdate = true;
        body.tint.needsUpdate = true;
        body.gait.needsUpdate = true;
        meshes++;
      }
    }
    info.draws = meshes + info.near;
    info.objects = meshes + info.near;
    this.info0 = info;
  }

  dispose(): void {
    this.o.parent.remove(this.group);
    for (const b of this.bodies) {
      b.mesh.geometry.dispose();
      (b.mesh.material as MeshStandardNodeMaterial).dispose();
      b.mesh.dispose();
    }
    for (const n of this.near) {
      n.anim.dispose();
      n.fig.dispose();
    }
    this.geo.dispose();
  }
}

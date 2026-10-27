/**
 * Blob shadows (M02g1; the C13 `blob` shadow mode as an effect of its own). Cars, pedestrians and the player float without a
 * shadow: only buildings cast, and the `blob` mode of `mobile-low` and Quest drew nothing. One `InstancedMesh` of a radial quad lies on
 * the ground under every car, pedestrian and the player's vehicle, on every flat tier: +1 render object and 0 shadow passes, however
 * many there are. The quad is black with an alpha that falls off from a dark core to a soft edge (a superellipse, so a car's
 * footprint is a rounded box), drawn after the ground with depth test on and depth write off, never through the fog.
 *
 * The instances are fed from the frame's poses once a frame (`feed`): the same poses the traffic, pedestrian and object-pool renderers
 * draw, so a blob and its body never disagree. Sizes come from the archetype half extents; the ground is the pose minus the height
 * of the centre above the ground. Pure placement maths (`blobMatrix`) is separate so the tests run in Node.
 */
import { DoubleSide, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry, type Object3D } from 'three/webgpu';
import { uniform as uniformNode } from 'three/tsl';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import { vehicleFootprint } from '@dv/engine/client/vehicle/vehicle-view';
import { ARCHETYPES } from '../../sim/traffic/components.ts';
import { PED_ASSETS } from '../../sim/peds/components.ts';
import { abs, asNode, float, pow, smoothstep, uv, vec3, type L, type U } from '../sky/tsl.ts';

type Pose = NonNullable<WorldFrame['poses']>[number];

/** The blob sits this far above the ground so it never z-fights with it. */
export const BLOB_LIFT_M = 0.04;
/** A car's blob is its footprint grown by this much on each side (metres): the contact shadow spills a little. */
export const BLOB_GROW_M = 0.22;
/** Cars beyond this distance from the camera get no blob (it would be a few pixels); pedestrians likewise. */
export const CAR_BLOB_RANGE_M = 160;
export const PED_BLOB_RANGE_M = 60;
export const PED_BLOB_HALF_M = 0.32;
export const AVATAR_BLOB_HALF_M = 0.38;

export interface BlobStyle {
  halfWidth: number;
  halfLength: number;
  /** Metres from the pose origin down to the ground. */
  dropM: number;
  range: number;
}

const ASSET_STYLE = new Map<string, BlobStyle>();
for (const a of ARCHETYPES) ASSET_STYLE.set(a.asset, { halfWidth: a.halfWidth, halfLength: a.halfLength, dropM: a.lift, range: CAR_BLOB_RANGE_M });
for (const k of PED_ASSETS) ASSET_STYLE.set(k, { halfWidth: PED_BLOB_HALF_M, halfLength: PED_BLOB_HALF_M, dropM: 0, range: PED_BLOB_RANGE_M });
ASSET_STYLE.set('prop/graybox.capsule', { halfWidth: AVATAR_BLOB_HALF_M, halfLength: AVATAR_BLOB_HALF_M, dropM: 0, range: CAR_BLOB_RANGE_M });

/** The blob style of a C07 asset key, or null for a thing that casts none (props, pickups, aircraft). */
export function blobStyleOf(key: string): BlobStyle | null {
  const known = ASSET_STYLE.get(key);
  if (known) return known;
  const v = vehicleFootprint(key);
  if (!v) return null;
  const style: BlobStyle = { halfWidth: v.halfWidth, halfLength: v.halfLength, dropM: v.dropM, range: CAR_BLOB_RANGE_M };
  ASSET_STYLE.set(key, style);
  return style;
}

/** The yaw of a pose, radians about +Y (0 faces -Z). */
export function poseYaw(p: Pick<Pose, 'qx' | 'qy' | 'qz' | 'qw'>): number {
  const fx = -2 * (p.qx * p.qz + p.qw * p.qy);
  const fz = -(1 - 2 * (p.qx * p.qx + p.qy * p.qy));
  return Math.atan2(-fx, -fz);
}

/** Writes the instance matrix (column-major, 16 floats at `o`) of a blob: yaw about Y, scale to the footprint, translation. */
export function blobMatrix(out: Float32Array, o: number, x: number, y: number, z: number, yaw: number, sizeX: number, sizeZ: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // rotation about Y: x' = c x + s z, z' = -s x + c z
  out[o] = c * sizeX;
  out[o + 1] = 0;
  out[o + 2] = -s * sizeX;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = 1;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = s * sizeZ;
  out[o + 9] = 0;
  out[o + 10] = c * sizeZ;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

export interface BlobOptions {
  parent: Pick<Object3D, 'add' | 'remove'>;
  /** Most blobs at once (the tier's traffic plus pedestrian caps plus a few actors). */
  cap: number;
}

export interface BlobInfo {
  /** Blobs drawn this frame. */
  count: number;
  /** Render objects the blobs add: 1 while any is drawn and the layer is on, else 0. */
  objects: number;
  /** The darkness of the core, 0..1. */
  strength: number;
  cap: number;
}

export class BlobShadows {
  readonly mesh: InstancedMesh;
  count = 0;
  private readonly cap: number;
  private readonly uStrength: U<number>;
  private on = true;
  private readonly o: BlobOptions;

  constructor(o: BlobOptions) {
    this.o = o;
    this.cap = Math.max(8, o.cap);
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.uStrength = uniformNode(0.55) as unknown as U<number>;
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, fog: false, side: DoubleSide });
    // A superellipse falloff: 0 at the centre, 1 at the edge of the quad; the alpha is a dark core and a soft edge.
    const p = uv().sub(0.5).mul(2);
    const d = pow(pow(abs(p.x), 3).add(pow(abs(p.y), 3)), 1 / 3);
    const a = pow(float(1).sub(smoothstep(0.28, 1.0, d)), 1.5);
    m.colorNode = asNode(vec3(0, 0, 0));
    (m as unknown as { opacityNode: unknown }).opacityNode = a.mul(this.uStrength as unknown as L);
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    this.mesh = new InstancedMesh(geo, m, this.cap);
    this.mesh.name = 'look.blobs';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.count = 0;
    this.mesh.visible = false;
    o.parent.add(this.mesh);
  }

  get enabled(): boolean {
    return this.on;
  }

  /** The layer on or off (QA `setLookLayer`, the profile). Off draws nothing and costs no render object. */
  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) {
      this.count = 0;
      this.mesh.count = 0;
      this.mesh.visible = false;
    }
  }

  /** The darkness of the core: the sun's strength by day, a faint contact shadow by night. */
  setStrength(v: number): void {
    this.uStrength.value = Math.max(0, Math.min(1, v));
  }

  begin(): void {
    this.count = 0;
  }

  /** Adds a blob for a footprint of half extents (`halfW`, `halfL`) standing on the ground at `y`. */
  push(x: number, groundY: number, z: number, yaw: number, halfW: number, halfL: number): void {
    if (!this.on || this.count >= this.cap) return;
    blobMatrix(this.mesh.instanceMatrix.array as Float32Array, this.count * 16, x, groundY + BLOB_LIFT_M, z, yaw, (halfW + BLOB_GROW_M) * 2, (halfL + BLOB_GROW_M) * 2);
    this.count++;
  }

  /** The pose loop: one blob for every shown car, pedestrian and actor of the frame that has a footprint. */
  feed(f: Pick<WorldFrame, 'poses' | 'poseCount' | 'poseKeys' | 'camera'>): void {
    if (!this.on) return;
    const poses = f.poses;
    const keys = f.poseKeys;
    if (!poses || !keys) return;
    const n = f.poseCount ?? 0;
    const cx = f.camera.pos[0], cz = f.camera.pos[2];
    for (let i = 0; i < n; i++) {
      const p = poses[i] as Pose;
      if ((p.flags & 1) === 0) continue;
      const key = keys.get(p.renderKey);
      if (key === undefined) continue;
      const style = blobStyleOf(key);
      if (!style) continue;
      const dx = p.px - cx, dz = p.pz - cz;
      if (dx * dx + dz * dz > style.range * style.range) continue;
      this.push(p.px, p.py - style.dropM, p.pz, poseYaw(p), style.halfWidth, style.halfLength);
    }
  }

  /** Publishes the frame's instances. */
  commit(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.on && this.count > 0;
    if (this.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  info(): BlobInfo {
    return { count: this.on ? this.count : 0, objects: this.on && this.count > 0 ? 1 : 0, strength: this.uStrength.value, cap: this.cap };
  }

  dispose(): void {
    this.o.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
    this.mesh.dispose();
  }
}

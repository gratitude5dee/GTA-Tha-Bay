/**
 * Transit as set dressing (02-world-living.md section 5; M03b2). Buses, Metro trains, cable cars, ferries, airliners and the Bay Rail
 * entrances are snapshot records flagged ambient (`flags & 2`) whose render key is one of the transit gray-box assets; the object pool
 * skips them and this renderer draws them, one `InstancedMesh` per kind (gray-box shapes in original liveries until M10d1, Q-39).
 *
 *  - a Metro train is two cars: the entity pose is the first car and the second trails it by `METRO_CAR_GAP_M` along its heading;
 *  - buses share the traffic cap (`CrowdLimits.maxTrafficInstances`): the page tells how many cars are drawn and the buses take
 *    what is left, so cars and buses together never pass the cap;
 *  - the names and liveries are fictional (NameRegistry keys); nothing here carries a real brand.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Group, InstancedMesh, MeshStandardNodeMaterial, type Object3D,
} from 'three/webgpu';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import { METRO_CAR_GAP_M, TRANSIT_PREFABS, type TransitPrefab } from '../../sim/transit/components.ts';

type Pose = NonNullable<WorldFrame['poses']>[number];

export type TransitKindName = 'bus' | 'metro' | 'cablecar' | 'ferry' | 'airliner' | 'entrance';

export interface TransitInfo {
  /** Instances drawn per kind (a train counts its two cars). */
  perKind: Record<TransitKindName, number>;
  /** Bus instances, which count against the traffic cap. */
  buses: number;
  draws: number;
  objects: number;
  dropped: number;
}

export interface TransitRendererOptions {
  parent: Pick<Object3D, 'add' | 'remove'>;
  /** C13 `CrowdLimits.maxTrafficInstances` of the tier. */
  trafficCap: number;
  /** Cars drawn by the traffic renderer this frame. */
  carsDrawn: () => number;
}

interface Livery {
  body: number;
  stripe: number;
}

const LIVERY: Record<TransitKindName, Livery> = {
  bus: { body: 0x1f7a8c, stripe: 0xe8e1c8 },
  metro: { body: 0x2f4a8f, stripe: 0xd7dde6 },
  cablecar: { body: 0x7a2530, stripe: 0xd9b45a },
  ferry: { body: 0xe8eef2, stripe: 0x1c5d99 },
  airliner: { body: 0xf2f4f6, stripe: 0x3a6ea5 },
  entrance: { body: 0x39424e, stripe: 0xffc23d },
};

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: number): readonly [number, number, number] => [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];

/** Hull, a stripe along the sides and a dark window band, origin at the centre of the prefab box (forward -Z). */
export function bodyGeometry(p: TransitPrefab, l: Livery, kind: TransitKindName): BufferGeometry {
  const hw = p.halfWidth, hh = p.halfHeight, hl = p.halfLength;
  const parts: { w: number; h: number; d: number; x: number; y: number; z: number; c: readonly [number, number, number] }[] = [];
  const body = rgb(l.body), stripe = rgb(l.stripe), dark = rgb(0x151a22);
  if (kind === 'entrance') {
    parts.push({ w: hw * 2, h: hh * 2, d: hl * 2, x: 0, y: 0, z: 0, c: body });
    parts.push({ w: hw * 2.3, h: 0.25, d: hl * 2.3, x: 0, y: hh + 0.12, z: 0, c: stripe });
    // a tall post with a bright cap, so the entrance reads from the street
    parts.push({ w: 0.3, h: 3.2, d: 0.3, x: 0, y: hh + 1.7, z: 0, c: body });
    parts.push({ w: 1.3, h: 0.9, d: 0.2, x: 0, y: hh + 3.4, z: 0, c: stripe });
  } else if (kind === 'airliner') {
    parts.push({ w: 3.4, h: 3.4, d: hl * 2, x: 0, y: 0, z: 0, c: body });
    parts.push({ w: hw * 2, h: 0.5, d: 7, x: 0, y: -0.2, z: 0, c: stripe });
    parts.push({ w: 0.5, h: 6, d: 5, x: 0, y: 3.6, z: hl - 3, c: stripe });
  } else if (kind === 'ferry') {
    parts.push({ w: hw * 2, h: hh, d: hl * 2, x: 0, y: -hh * 0.5, z: 0, c: stripe });
    parts.push({ w: hw * 1.6, h: hh * 0.9, d: hl * 1.3, x: 0, y: hh * 0.45, z: hl * 0.1, c: body });
    parts.push({ w: hw * 1.2, h: hh * 0.5, d: hl * 0.35, x: 0, y: hh * 1.1, z: -hl * 0.1, c: body });
  } else {
    parts.push({ w: hw * 2, h: hh * 2 - 0.35, d: hl * 2, x: 0, y: 0.18, z: 0, c: body });
    parts.push({ w: hw * 2.02, h: 0.28, d: hl * 2.02, x: 0, y: -0.1, z: 0, c: stripe });
    parts.push({ w: hw * 2.04, h: hh * 0.55, d: hl * 1.7, x: 0, y: hh * 0.42, z: 0, c: dark });
  }
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  let base = 0;
  for (const q of parts) {
    const g = new BoxGeometry(q.w, q.h, q.d);
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i) + q.x, gp.getY(i) + q.y, gp.getZ(i) + q.z);
      nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      col.push(q.c[0], q.c[1], q.c[2]);
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

interface Layer {
  kind: TransitKindName;
  mesh: InstancedMesh;
  n: number;
  /** Matrices written this frame. */
  count: number;
}

const ASSET_KIND = new Map<string, TransitKindName>([
  [TRANSIT_PREFABS.bus.asset, 'bus'],
  [TRANSIT_PREFABS.cablecar.asset, 'cablecar'],
  [TRANSIT_PREFABS.ferry.asset, 'ferry'],
  [TRANSIT_PREFABS.airliner.asset, 'airliner'],
  [TRANSIT_PREFABS.entrance.asset, 'entrance'],
]);

const CAPACITY: Record<TransitKindName, number> = { bus: 64, metro: 24, cablecar: 24, ferry: 12, airliner: 12, entrance: 16 };

export class TransitRenderer {
  readonly group = new Group();
  private readonly layers = new Map<TransitKindName, Layer>();
  private info0: TransitInfo;

  constructor(private readonly o: TransitRendererOptions) {
    this.group.name = 'transit';
    const prefab: Record<TransitKindName, TransitPrefab> = {
      bus: TRANSIT_PREFABS.bus, metro: TRANSIT_PREFABS.bus, cablecar: TRANSIT_PREFABS.cablecar, ferry: TRANSIT_PREFABS.ferry,
      airliner: TRANSIT_PREFABS.airliner, entrance: TRANSIT_PREFABS.entrance,
    };
    for (const kind of Object.keys(CAPACITY) as TransitKindName[]) {
      const n = CAPACITY[kind];
      const mat = new MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.1, vertexColors: true });
      const mesh = new InstancedMesh(bodyGeometry(prefab[kind], LIVERY[kind], kind), mat, n);
      mesh.name = `transit.${kind}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.group.add(mesh);
      this.layers.set(kind, { kind, mesh, n, count: 0 });
    }
    this.info0 = this.blank();
    o.parent.add(this.group);
  }

  private blank(): TransitInfo {
    return { perKind: { bus: 0, metro: 0, cablecar: 0, ferry: 0, airliner: 0, entrance: 0 }, buses: 0, draws: 0, objects: 0, dropped: 0 };
  }

  info(): TransitInfo {
    return this.info0;
  }

  update(f: Pick<WorldFrame, 'poses' | 'poseCount' | 'poseKeys'>): number {
    const info = this.blank();
    for (const l of this.layers.values()) l.count = 0;
    const poses = f.poses;
    const keys = f.poseKeys;
    const n = f.poseCount ?? 0;
    if (poses && keys) {
      const busRoom = Math.max(0, this.o.trafficCap - this.o.carsDrawn());
      for (let i = 0; i < n; i++) {
        const p = poses[i] as Pose;
        if ((p.flags & 2) === 0) continue;
        const key = keys.get(p.renderKey);
        if (key === undefined) continue;
        let kind = ASSET_KIND.get(key);
        if (!kind) continue;
        const metro = kind === 'bus' && p.animP1 === 1;
        if (metro) kind = 'metro';
        if (kind === 'bus' && info.perKind.bus >= busRoom) {
          info.dropped++;
          continue;
        }
        if (kind === 'metro') {
          this.write('metro', p, 0, info);
          this.write('metro', p, METRO_CAR_GAP_M, info);
        } else {
          this.write(kind, p, 0, info);
        }
      }
    }
    let draws = 0;
    for (const l of this.layers.values()) {
      l.mesh.count = l.count;
      l.mesh.visible = l.count > 0;
      if (l.count > 0) {
        l.mesh.instanceMatrix.needsUpdate = true;
        draws++;
      }
    }
    info.buses = info.perKind.bus;
    info.draws = draws;
    info.objects = draws;
    this.info0 = info;
    return Object.values(info.perKind).reduce((a, b) => a + b, 0);
  }

  /** Writes one instance; `trail` metres behind the pose along its forward direction (the second car of a train). */
  private write(kind: TransitKindName, p: Pose, trail: number, info: TransitInfo): void {
    const l = this.layers.get(kind) as Layer;
    if (l.count >= l.n) {
      info.dropped++;
      return;
    }
    const m = l.mesh.instanceMatrix.array as Float32Array;
    const o = l.count * 16;
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
    // forward is -Z of the model: the trailing car sits at +Z of the model, i.e. along the third column
    m[o + 12] = p.px + (m[o + 8] as number) * trail;
    m[o + 13] = p.py + (m[o + 9] as number) * trail;
    m[o + 14] = p.pz + (m[o + 10] as number) * trail;
    m[o + 15] = 1;
    l.count++;
    info.perKind[kind]++;
  }

  dispose(): void {
    this.o.parent.remove(this.group);
    for (const l of this.layers.values()) {
      l.mesh.geometry.dispose();
      (l.mesh.material as MeshStandardNodeMaterial).dispose();
      l.mesh.dispose();
    }
  }
}

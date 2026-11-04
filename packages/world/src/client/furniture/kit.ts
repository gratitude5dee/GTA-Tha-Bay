/**
 * The street furniture kit (M02h6): original, code-built geometry for the global furniture pools, one geometry per pool and look profile.
 * Pure and `three`-free, so a test builds the same bytes; `pools.ts` turns them into `BufferGeometry`. No texture, no font, no model file:
 * the sign faces are signed-distance shapes in the material (`faces.ts`) on the `uv` of the face quads.
 *
 * Every item stands at the origin on its foot, its face looking along local -Z (the record's yaw turns it) and, for a signal, the mast arm
 * reaching along local +X over the lanes. A pool's geometry holds the parts of every kind it draws; `part` says which kind a vertex belongs
 * to and the instance's `aKind` keeps only its own parts (the others collapse to a point), so one pool is one draw:
 *
 *   post     stop sign (octagon, and a blank street-name blade above it on `full` and `lite`), hydrant, parking meter, one-way sign
 *   signal   pole, mast arm, a three-lamp head at the arm's end (`lamp` 1 red, 2 amber, 3 green; `signalEmissive` lights them)
 *   shelter  bus shelter with its stop flag, and the bench
 *   pole     wooden utility pole with a cross arm
 *   wire     two trolley wires one metre long along local -Z (the instance scales them by the span)
 *
 * A later Track B import may swap a pool's geometry for a licensed or generated prop through this file (DL-OWN-06, DL-755). The colours are
 * design values (sRGB hex, linearised here); 24 to 150 triangles per item.
 */
import { FurnitureKind } from '../chunks/mesh-types.ts';
import { hexToLinear, type Rgb } from '../chunks/mesher.ts';

export type FurniturePoolName = 'signal' | 'post' | 'shelter' | 'pole' | 'wire';
export type FurnitureProfile = 'full' | 'lite' | 'min';
export const FURNITURE_POOLS: readonly FurniturePoolName[] = ['signal', 'post', 'shelter', 'pole', 'wire'];

/** Face ids of the `face` attribute (`faces.ts` draws them); 0 is no face. */
export const FACE = { none: 0, stop: 1, oneway: 2, blade: 3, busFlag: 4 } as const;
/** Lamp ids of the `lamp` attribute: the signal head's red, amber and green lenses. */
export const LAMP = { none: 0, red: 1, amber: 2, green: 3 } as const;

export interface KitGeometry {
  pool: FurniturePoolName;
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB. */
  colors: Float32Array;
  /** The `FurnitureKind` a vertex belongs to. */
  part: Float32Array;
  face: Float32Array;
  uvs: Float32Array;
  lamp: Float32Array;
  indices: Uint16Array;
  /** Triangles per kind the pool draws. */
  triangles: Partial<Record<number, number>>;
}

const C = {
  steel: hexToLinear('#7d8288'),
  darkSteel: hexToLinear('#3e4247'),
  signalBody: hexToLinear('#2d3a2f'),
  lensOff: hexToLinear('#1b1d1f'),
  red: hexToLinear('#b3261e'),
  white: hexToLinear('#e9e9e4'),
  hydrant: hexToLinear('#c7a43a'),
  hydrantCap: hexToLinear('#9b2f25'),
  meterHead: hexToLinear('#4c5359'),
  shelterFrame: hexToLinear('#5d646b'),
  glass: hexToLinear('#8fa7b3'),
  roof: hexToLinear('#4a5056'),
  bench: hexToLinear('#6b4f35'),
  wood: hexToLinear('#5b4632'),
  wire: hexToLinear('#202224'),
  green: hexToLinear('#2f6b45'),
};

class Builder {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  readonly part: number[] = [];
  readonly face: number[] = [];
  readonly uv: number[] = [];
  readonly lamp: number[] = [];
  readonly idx: number[] = [];
  readonly tris = new Map<number, number>();
  kind = 0;

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, col: Rgb, face: number, u: number, v: number, lamp: number): number {
    const i = this.p.length / 3;
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(col[0], col[1], col[2]);
    this.part.push(this.kind);
    this.face.push(face);
    this.uv.push(u, v);
    this.lamp.push(lamp);
    return i;
  }

  private tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
    this.tris.set(this.kind, (this.tris.get(this.kind) ?? 0) + 1);
  }

  /** A box centred at (cx, cy, cz) with full sizes (sx, sy, sz); the -Z side may carry a face (uv 0..1 across it) or a lamp. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: Rgb, o: { face?: number; faceCol?: Rgb; lamp?: number } = {}): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // each side: normal, and the two in-plane axes
    const sides: [number, number, number, number, number, number, number, number, number][] = [
      [0, 0, -1, -1, 0, 0, 0, 1, 0], [0, 0, 1, 1, 0, 0, 0, 1, 0], [1, 0, 0, 0, 0, -1, 0, 1, 0],
      [-1, 0, 0, 0, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0, -1], [0, -1, 0, 1, 0, 0, 0, 0, 1],
    ];
    for (const [nx, ny, nz, ux, uy, uz, vx, vy, vz] of sides) {
      const front = nz === -1;
      const face = front ? (o.face ?? 0) : 0;
      const lamp = front ? (o.lamp ?? 0) : 0;
      const col2 = front && o.faceCol ? o.faceCol : col;
      const ext = (ax: number, ay: number, az: number): number => Math.abs(ax) * hx + Math.abs(ay) * hy + Math.abs(az) * hz;
      const eu = ext(ux, uy, uz), ev = ext(vx, vy, vz), en = ext(nx, ny, nz);
      const at = (su: number, sv: number): number =>
        this.vert(cx + nx * en + ux * eu * su + vx * ev * sv, cy + ny * en + uy * eu * su + vy * ev * sv, cz + nz * en + uz * eu * su + vz * ev * sv, nx, ny, nz, col2, face, (su + 1) / 2, (sv + 1) / 2, lamp);
      const a = at(-1, -1), b = at(1, -1), c = at(1, 1), d = at(-1, 1);
      this.tri(a, b, c);
      this.tri(a, c, d);
    }
  }

  /** An open cylinder around the Y axis at (cx, cz) from y0 to y1, `seg` sides, with a top cap. */
  cyl(cx: number, cz: number, y0: number, y1: number, r: number, seg: number, col: Rgb, cap = true): void {
    const ring: [number, number][] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    for (let i = 0; i < seg; i++) {
      const [ax, az] = ring[i] as [number, number];
      const [bx, bz] = ring[(i + 1) % seg] as [number, number];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, ml = Math.hypot(mx, mz);
      const p0 = this.vert(cx + ax * r, y0, cz + az * r, mx / ml, 0, mz / ml, col, 0, 0, 0, 0);
      const p1 = this.vert(cx + bx * r, y0, cz + bz * r, mx / ml, 0, mz / ml, col, 0, 0, 0, 0);
      const p2 = this.vert(cx + bx * r, y1, cz + bz * r, mx / ml, 0, mz / ml, col, 0, 0, 0, 0);
      const p3 = this.vert(cx + ax * r, y1, cz + az * r, mx / ml, 0, mz / ml, col, 0, 0, 0, 0);
      this.tri(p0, p2, p1);
      this.tri(p0, p3, p2);
    }
    if (!cap) return;
    const c0 = this.vert(cx, y1, cz, 0, 1, 0, col, 0, 0, 0, 0);
    for (let i = 0; i < seg; i++) {
      const [ax, az] = ring[i] as [number, number];
      const [bx, bz] = ring[(i + 1) % seg] as [number, number];
      const a = this.vert(cx + ax * r, y1, cz + az * r, 0, 1, 0, col, 0, 0, 0, 0);
      const b = this.vert(cx + bx * r, y1, cz + bz * r, 0, 1, 0, col, 0, 0, 0, 0);
      this.tri(c0, b, a);
    }
  }

  /** A flat regular octagon plate of width `w` (flat to flat), centred at (0, cy, cz), thickness `t`: face on -Z, back plain. */
  octagon(cy: number, cz: number, w: number, t: number, col: Rgb, back: Rgb, face: number): void {
    const r = w / 2 / Math.cos(Math.PI / 8);
    const pts: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const zf = cz - t / 2, zb = cz + t / 2;
    // front fan, uv across the plate's width
    const cf = this.vert(0, cy, zf, 0, 0, -1, col, face, 0.5, 0.5, 0);
    const front = pts.map(([x, y]) => this.vert(x, cy + y, zf, 0, 0, -1, col, face, 0.5 - x / w, 0.5 + y / w, 0));
    const cb = this.vert(0, cy, zb, 0, 0, 1, back, 0, 0, 0, 0);
    const rear = pts.map(([x, y]) => this.vert(x, cy + y, zb, 0, 0, 1, back, 0, 0, 0, 0));
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      this.tri(cf, front[j] as number, front[i] as number);
      this.tri(cb, rear[i] as number, rear[j] as number);
      const [ax, ay] = pts[i] as [number, number];
      const [bx, by] = pts[j] as [number, number];
      const mx = (ax + bx) / 2, my = (ay + by) / 2, ml = Math.hypot(mx, my);
      const a = this.vert(ax, cy + ay, zf, mx / ml, my / ml, 0, back, 0, 0, 0, 0);
      const b = this.vert(bx, cy + by, zf, mx / ml, my / ml, 0, back, 0, 0, 0, 0);
      const c = this.vert(bx, cy + by, zb, mx / ml, my / ml, 0, back, 0, 0, 0, 0);
      const d = this.vert(ax, cy + ay, zb, mx / ml, my / ml, 0, back, 0, 0, 0, 0);
      this.tri(a, b, c);
      this.tri(a, c, d);
    }
  }

  build(pool: FurniturePoolName): KitGeometry {
    const triangles: Partial<Record<number, number>> = {};
    for (const [k, n] of this.tris) triangles[k] = n;
    return {
      pool,
      positions: Float32Array.from(this.p),
      normals: Float32Array.from(this.n),
      colors: Float32Array.from(this.c),
      part: Float32Array.from(this.part),
      face: Float32Array.from(this.face),
      uvs: Float32Array.from(this.uv),
      lamp: Float32Array.from(this.lamp),
      indices: Uint16Array.from(this.idx),
      triangles,
    };
  }
}

/** The kit geometry of one pool on one look profile. `armM` and `poleM` are the signal's (`config/world/furniture.json` `signal`). */
export function kitGeometry(pool: FurniturePoolName, profile: FurnitureProfile, signal: { armM: number; poleM: number } = { armM: 4.5, poleM: 5.6 }): KitGeometry {
  const b = new Builder();
  const seg = profile === 'full' ? 8 : 6;
  if (pool === 'post') {
    b.kind = FurnitureKind.stop;
    b.cyl(0, 0, -0.2, 2.35, 0.035, 6, C.steel);
    b.octagon(2.05, -0.06, 0.76, 0.03, C.red, C.steel, FACE.stop);
    if (profile !== 'min') b.box(0, 2.5, -0.04, 0.9, 0.16, 0.02, C.green, { face: FACE.blade, faceCol: C.green });
    b.kind = FurnitureKind.hydrant;
    b.cyl(0, 0, -0.1, 0.55, 0.13, seg, C.hydrant, false);
    b.cyl(0, 0, 0.55, 0.68, 0.1, seg, C.hydrantCap);
    b.box(0, 0.38, -0.15, 0.1, 0.1, 0.1, C.hydrant);
    b.box(0.15, 0.38, 0, 0.1, 0.09, 0.09, C.hydrant);
    b.kind = FurnitureKind.oneway;
    b.cyl(0, 0, -0.2, 2.55, 0.035, 6, C.steel);
    b.box(0, 2.3, -0.06, 0.9, 0.3, 0.02, C.darkSteel, { face: FACE.oneway, faceCol: C.darkSteel });
    if (profile !== 'min') {
      b.kind = FurnitureKind.meter;
      b.cyl(0, 0, -0.2, 1.1, 0.03, 6, C.darkSteel);
      b.box(0, 1.28, 0, 0.2, 0.36, 0.16, C.meterHead);
    }
    return b.build('post');
  }
  if (pool === 'signal') {
    b.kind = FurnitureKind.signal;
    b.cyl(0, 0, -0.3, signal.poleM, 0.12, seg, C.signalBody);
    // the mast arm over the lanes (+X) and the head hung at its end, the lenses on its -Z face
    b.box(signal.armM / 2, signal.poleM - 0.25, 0, signal.armM, 0.12, 0.12, C.signalBody);
    const hx = signal.armM - 0.3, hy = signal.poleM - 0.95;
    b.box(hx, hy, 0, 0.36, 1.0, 0.3, C.signalBody);
    b.box(hx, hy + 0.31, -0.16, 0.22, 0.22, 0.03, C.lensOff, { lamp: LAMP.red });
    b.box(hx, hy, -0.16, 0.22, 0.22, 0.03, C.lensOff, { lamp: LAMP.amber });
    b.box(hx, hy - 0.31, -0.16, 0.22, 0.22, 0.03, C.lensOff, { lamp: LAMP.green });
    // a pedestrian-height head on the pole itself (the near-side view)
    b.box(0, 2.9, -0.2, 0.3, 0.8, 0.26, C.signalBody);
    return b.build('signal');
  }
  if (pool === 'shelter') {
    b.kind = FurnitureKind.shelter;
    for (const [x, z] of [[-1.5, -0.6], [1.5, -0.6], [-1.5, 0.6], [1.5, 0.6]] as const) b.box(x, 1.2, z, 0.08, 2.4, 0.08, C.shelterFrame);
    b.box(0, 2.45, 0, 3.3, 0.1, 1.6, C.roof);
    b.box(0, 1.3, 0.6, 3.0, 1.9, 0.03, C.glass);
    b.box(0, 0.45, 0.35, 2.4, 0.06, 0.4, C.bench);
    b.cyl(2.0, -0.5, -0.2, 2.9, 0.04, 6, C.steel);
    b.box(2.0, 2.6, -0.55, 0.45, 0.45, 0.02, C.white, { face: FACE.busFlag, faceCol: C.white });
    b.kind = FurnitureKind.bench;
    b.box(0, 0.45, 0, 1.8, 0.06, 0.42, C.bench);
    b.box(0, 0.75, 0.2, 1.8, 0.4, 0.05, C.bench);
    b.box(-0.8, 0.22, 0, 0.06, 0.45, 0.4, C.darkSteel);
    b.box(0.8, 0.22, 0, 0.06, 0.45, 0.4, C.darkSteel);
    return b.build('shelter');
  }
  if (pool === 'pole') {
    b.kind = FurnitureKind.pole;
    b.cyl(0, 0, -0.5, 9.5, 0.14, seg, C.wood);
    b.box(0, 8.9, 0, 2.2, 0.12, 0.12, C.wood);
    b.box(-0.9, 9.05, 0, 0.08, 0.18, 0.08, C.white);
    b.box(0.9, 9.05, 0, 0.08, 0.18, 0.08, C.white);
    return b.build('pole');
  }
  b.kind = FurnitureKind.wire;
  b.box(-0.3, 0, -0.5, 0.02, 0.02, 1, C.wire);
  b.box(0.3, 0, -0.5, 0.02, 0.02, 1, C.wire);
  return b.build('wire');
}

/** The pools a look profile draws (`config/world/furniture.json` `pools`), in `FURNITURE_POOLS` order. */
export function poolsOf(pools: Readonly<Record<string, number>>): FurniturePoolName[] {
  return FURNITURE_POOLS.filter((p) => pools[p] !== undefined);
}

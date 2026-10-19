/** Spatial index over building prism rings (flat [x0, z0, ...], ENU): point-in-prism and distance queries. */
import { distToRing, pointInRing, ringBbox } from './rings.ts';

export class PrismIndex {
  private readonly rings: number[][] = [];
  private readonly boxes: { minX: number; minZ: number; maxX: number; maxZ: number }[] = [];
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly cell = 32) {}

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  add(ring: readonly number[]): void {
    if (ring.length < 6) return;
    const r = Array.from(ring);
    const b = ringBbox(r);
    const id = this.rings.length;
    this.rings.push(r);
    this.boxes.push(b);
    const i0 = Math.floor(b.minX / this.cell), i1 = Math.floor(b.maxX / this.cell), j0 = Math.floor(b.minZ / this.cell), j1 = Math.floor(b.maxZ / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      const l = this.cells.get(k);
      if (l) l.push(id); else this.cells.set(k, [id]);
    }
  }

  get size(): number {
    return this.rings.length;
  }

  /** Distance to the nearest prism (0 inside one), looking no further than `max`; Infinity beyond. */
  distance(x: number, z: number, max: number): number {
    let best = Infinity;
    const i0 = Math.floor((x - max) / this.cell), i1 = Math.floor((x + max) / this.cell), j0 = Math.floor((z - max) / this.cell), j1 = Math.floor((z + max) / this.cell);
    const seen = new Set<number>();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.cells.get(this.key(i, j));
      if (!l) continue;
      for (const id of l) {
        if (seen.has(id)) continue;
        seen.add(id);
        const b = this.boxes[id] as { minX: number; minZ: number; maxX: number; maxZ: number };
        if (x < b.minX - max || x > b.maxX + max || z < b.minZ - max || z > b.maxZ + max) continue;
        const r = this.rings[id] as number[];
        const d = pointInRing(x, z, r) ? 0 : distToRing(x, z, r);
        if (d < best) best = d;
      }
    }
    return best <= max ? best : Infinity;
  }

  /** True when (x, z) is inside a prism or within `margin` of one. */
  near(x: number, z: number, margin: number): boolean {
    return this.distance(x, z, margin) <= margin;
  }
}

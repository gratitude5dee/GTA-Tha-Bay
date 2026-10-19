/**
 * Byte raster with scanline polygon fill. A raster sample (i, j) sits at ENU
 * (originX + (i + offset) * step, originZ + (j + offset) * step): offset 0 puts samples on the terrain posts, offset 0.5 on
 * cell centres. Fill is even-odd across all rings handed to one call, so holes are rings of opposite winding or nesting.
 */

export class Raster {
  readonly data: Uint8Array;
  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly step: number,
    readonly w: number,
    readonly h: number,
    readonly offset: number,
    init = 0,
  ) {
    this.data = new Uint8Array(w * h);
    if (init !== 0) this.data.fill(init);
  }

  /** ENU x of column i. */
  xOf(i: number): number {
    return this.originX + (i + this.offset) * this.step;
  }
  zOf(j: number): number {
    return this.originZ + (j + this.offset) * this.step;
  }

  /** Value of the nearest sample, or `outside` beyond the raster. */
  at(x: number, z: number, outside = 0): number {
    const i = Math.round((x - this.originX) / this.step - this.offset);
    const j = Math.round((z - this.originZ) / this.step - this.offset);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return outside;
    return this.data[j * this.w + i] as number;
  }

  /** Even-odd fill of the union of `rings` (each a flat [x, z, ...] ring, implicitly closed) with `value`. */
  fillRings(rings: readonly ArrayLike<number>[], value: number, guard?: (current: number) => boolean): void {
    const rows = new Map<number, number[]>();
    for (const r of rings) {
      const n = r.length / 2;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const x0 = r[b * 2] as number, z0 = r[b * 2 + 1] as number, x1 = r[a * 2] as number, z1 = r[a * 2 + 1] as number;
        if (z0 === z1) continue;
        const zlo = z0 < z1 ? z0 : z1;
        const zhi = z0 < z1 ? z1 : z0;
        let j0 = Math.ceil((zlo - this.originZ) / this.step - this.offset);
        let j1 = Math.ceil((zhi - this.originZ) / this.step - this.offset) - 1;
        if (j0 < 0) j0 = 0;
        if (j1 > this.h - 1) j1 = this.h - 1;
        const slope = (x1 - x0) / (z1 - z0);
        for (let j = j0; j <= j1; j++) {
          const z = this.originZ + (j + this.offset) * this.step;
          let list = rows.get(j);
          if (!list) rows.set(j, (list = []));
          list.push(x0 + (z - z0) * slope);
        }
      }
    }
    for (const [j, xs] of rows) {
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k] as number;
        const xb = xs[k + 1] as number;
        let i0 = Math.ceil((xa - this.originX) / this.step - this.offset);
        let i1 = Math.ceil((xb - this.originX) / this.step - this.offset) - 1;
        if (i0 < 0) i0 = 0;
        if (i1 > this.w - 1) i1 = this.w - 1;
        const base = j * this.w;
        for (let i = i0; i <= i1; i++) if (!guard || guard(this.data[base + i] as number)) this.data[base + i] = value;
      }
    }
  }

  /** Number of samples equal to `value`, optionally inside an ENU box. */
  count(value: number, box?: { minX: number; minZ: number; maxX: number; maxZ: number }): number {
    let n = 0;
    for (let j = 0; j < this.h; j++) {
      if (box) {
        const z = this.zOf(j);
        if (z < box.minZ || z >= box.maxZ) continue;
      }
      for (let i = 0; i < this.w; i++) {
        if ((this.data[j * this.w + i] as number) !== value) continue;
        if (box) {
          const x = this.xOf(i);
          if (x < box.minX || x >= box.maxX) continue;
        }
        n++;
      }
    }
    return n;
  }
}

/**
 * Poisson-disk sampling (M02h5, Bridson 2007) for the vegetation scatter of S13 (`stages/s13-scatter.ts`). Pure and deterministic: the
 * random numbers are `@dv/shared` `xoshiro128**` (`Rng`), the angles and roots detmath, and the order of every loop is fixed, so the same
 * domain, seed and hash give the same points on every machine.
 *
 * One `PointHash` holds the points of one layer (trees, or shrubs) over the whole area: every polygon samples against it in id order, so
 * two polygons that touch never put two points of the layer closer than the radius the later one asks for.
 *
 * `bridson` covers a domain that may be split into many pieces (a park cut by roads, a wood by paths): it walks a lattice of `rMin` over the
 * domain's box in row order and tries one jittered seed per lattice cell; every seed that lands runs the active-list growth of Bridson's
 * algorithm (`k` candidates in the annulus `[rMin, 2 rMin)` per active point) until its piece is full. The density this reaches on open
 * ground is `BRIDSON_DENSITY / rMin^2` points per square metre (measured, `tools/map/test/poisson.spec.ts`).
 */
import { Rng, dcos, dsin, dsqrt } from '../../../../packages/shared/src/index.ts';

/** Points per square metre times `rMin^2` that `bridson` reaches on open ground with `k = 30` (the scatter's target density). */
export const BRIDSON_DENSITY = 0.63;
/** Candidates per active point (Bridson's `k`). */
export const BRIDSON_K = 30;

const TWO_PI = 6.283185307179586;

/** The points of one layer in a uniform grid of `cell` metres: insertion order kept, queries by radius. */
export class PointHash {
  private readonly cells = new Map<number, number[]>();
  /** Every point, flat `x, z`, in insertion order. */
  readonly points: number[] = [];

  constructor(readonly cell: number) {}

  private key(i: number, j: number): number {
    return (i + 1048576) * 2097152 + (j + 1048576);
  }

  get size(): number {
    return this.points.length / 2;
  }

  add(x: number, z: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const l = this.cells.get(k);
    const id = this.points.length / 2;
    if (l) l.push(id);
    else this.cells.set(k, [id]);
    this.points.push(x, z);
  }

  /** Whether any point lies closer than `r` to `(x, z)`. */
  near(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    const i0 = Math.floor((x - r) / this.cell), i1 = Math.floor((x + r) / this.cell);
    const j0 = Math.floor((z - r) / this.cell), j1 = Math.floor((z + r) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const l = this.cells.get(this.key(i, j));
        if (!l) continue;
        for (const id of l) {
          const dx = (this.points[id * 2] as number) - x, dz = (this.points[id * 2 + 1] as number) - z;
          if (dx * dx + dz * dz < r2) return true;
        }
      }
    }
    return false;
  }

  /** The smallest distance between two points (brute force over neighbouring cells; tests). */
  minPairDistance(within: number): number {
    let best = Infinity;
    const n = this.size;
    for (let a = 0; a < n; a++) {
      const x = this.points[a * 2] as number, z = this.points[a * 2 + 1] as number;
      const i0 = Math.floor((x - within) / this.cell), i1 = Math.floor((x + within) / this.cell);
      const j0 = Math.floor((z - within) / this.cell), j1 = Math.floor((z + within) / this.cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        for (const b of this.cells.get(this.key(i, j)) ?? []) {
          if (b <= a) continue;
          const dx = (this.points[b * 2] as number) - x, dz = (this.points[b * 2 + 1] as number) - z;
          const d = dsqrt(dx * dx + dz * dz);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

export interface PoissonDomain {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Whether a candidate may stand at `(x, z)`: inside the polygon and outside every exclusion. */
  accept(x: number, z: number): boolean;
}

/**
 * Bridson's Poisson-disk sampling over `domain` against `hash` (points of earlier polygons included): every point added is at least `rMin`
 * from every point of the hash. Returns the new points (flat `x, z`), which are also added to the hash.
 */
export function bridson(domain: PoissonDomain, rMin: number, rng: Rng, hash: PointHash, k = BRIDSON_K): number[] {
  const out: number[] = [];
  const active: number[] = [];
  const tryAdd = (x0: number, z0: number): boolean => {
    // on the decimetre grid the pack stores, so the spacing holds for the packed records too
    const x = Math.round(x0 * 10) / 10, z = Math.round(z0 * 10) / 10;
    if (x < domain.minX || x >= domain.maxX || z < domain.minZ || z >= domain.maxZ) return false;
    if (hash.near(x, z, rMin)) return false;
    if (!domain.accept(x, z)) return false;
    hash.add(x, z);
    out.push(x, z);
    active.push(out.length / 2 - 1);
    return true;
  };
  const grow = (): void => {
    while (active.length > 0) {
      // the newest active point first (a stack): a fixed order, so the result never depends on a random pick of the list
      const id = active[active.length - 1] as number;
      const px = out[id * 2] as number, pz = out[id * 2 + 1] as number;
      let placed = false;
      for (let t = 0; t < k; t++) {
        const a = rng.nextFloat() * TWO_PI;
        const r = rMin * (1 + rng.nextFloat());
        if (tryAdd(px + dcos(a) * r, pz + dsin(a) * r)) {
          placed = true;
          break;
        }
      }
      if (!placed) active.pop();
    }
  };
  const nx = Math.max(1, Math.ceil((domain.maxX - domain.minX) / rMin));
  const nz = Math.max(1, Math.ceil((domain.maxZ - domain.minZ) / rMin));
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = domain.minX + (i + rng.nextFloat()) * rMin;
      const z = domain.minZ + (j + rng.nextFloat()) * rMin;
      if (tryAdd(x, z)) grow();
    }
  }
  return out;
}

/** A point in the disc of radius `r` about `(cx, cz)`, uniform by area (detmath). */
export function discPoint(rng: Rng, cx: number, cz: number, r: number): [number, number] {
  const a = rng.nextFloat() * TWO_PI;
  const d = r * dsqrt(rng.nextFloat());
  return [cx + dcos(a) * d, cz + dsin(a) * d];
}

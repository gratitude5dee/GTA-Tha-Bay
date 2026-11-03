/**
 * S13 vegetation scatter (M02h5): the trees, shrubs and hedges no source maps one by one, placed after M02h3's cover and before the l0
 * TREE records are written. Pure: polygons, rasters and records in; scatter records and a report out. Every record carries bit 7 of the
 * TREE byte (`treeByte(form, true)`); street trees never come through here.
 *
 * Layers, each over the whole area against one `PointHash` (`geom/poisson.ts`), polygons in id order, each polygon its own `xoshiro128**`
 * stream seeded `fnv32(seed|polyId)` (`vegetation.json` `seed`):
 *  1. wood (`natural=wood`, `landuse=forest`): Bridson trees at `wood.rMin` with the `wood.mix` forms; then understory shrubs, Bridson at
 *     `wood.understory.rMin`, each kept with `share`.
 *  2. scrub (`natural=scrub`): shrubs, Bridson at `scrub.rMin`, each kept with `share`.
 *  3. park: the 4-connected pieces of park cells (M02h3 `CoverClass.Park`, the base `Park` ground without cover) outside every wood, each
 *     a polygon `park@<first cell>`: grove centres Bridson at `park.centreRMin`, `groveMin`..`groveMax` trees within `groveRadiusM` of a
 *     centre (`treeRMin` apart), and per grove tree an edge shrub with `edgeShrubShare` just outside the grove. Lawns between the groves
 *     stay open.
 *  4. hedges: a block every `hedge.blockM` along each `barrier=hedge` line; and along the frontage of yard cells (M02h3 yard and mixed cells
 *     beside a sidewalk cell), `insetM` inside the yard, for the `lotM` lots whose hash is below `hedgeShare` (uniform citywide). Frontage
 *     blocks sit on one global lattice of `blockM`, so a run over several cells keeps its spacing.
 *  5. yard shrubs: a yard or mixed cell whose hash is below `yard.shrubShare` gets one shrub.
 * Exclusions, for every layer: footprints + `footprintM`, landmark proxies + `landmarkM`, road centrelines + half width + `roadM`, ped edges
 * + half width + `pedM`, ground Water, Pier, Sand, Rock, Asphalt, Sidewalk and Rail, driveways, `excludedPolys` (pitches, playgrounds) and
 * chunks without terrain. Points sit on the decimetre grid the pack stores.
 */
import {
  CoverClass, GroundClass, PedEdgeKind, Rng, TREE_FORM_NAMES, TreeForm, VEG_FORM_NAMES, chunkKeyAt, fnv32, treeByte,
  type ChunkKey, type VegFormName,
} from '../../../../packages/shared/src/index.ts';
import type { AreaGrid, FormMix, VegetationConfig } from '../config.ts';
import { PointHash, bridson, discPoint, type PoissonDomain } from '../geom/poisson.ts';
import { pointAt, polyLength } from '../geom/poly.ts';
import { PrismIndex } from '../geom/prisms.ts';
import { Raster } from '../geom/raster.ts';
import { pointInRing, ringBbox } from '../geom/rings.ts';
import { cellHash01 } from './s13-cover.ts';
import type { VegetationLine, VegetationPoly } from './s3-water.ts';

/** Ground classes nothing is scattered on. */
const BLOCKED_GROUND: ReadonlySet<number> = new Set([
  GroundClass.Water, GroundClass.WaterShallow, GroundClass.Pier, GroundClass.Sand, GroundClass.Rock, GroundClass.Asphalt, GroundClass.Sidewalk, GroundClass.Rail,
]);

export interface ScatterInputs {
  grid: AreaGrid;
  cfg: VegetationConfig;
  /** Ground classes at the cell centres, cover applied. */
  ground: Raster;
  /** `CoverClass` per cell (M02h3), or null when the bake has no cover. */
  cover: Raster | null;
  polys: readonly VegetationPoly[];
  hedges: readonly VegetationLine[];
  excluded: readonly { id: string; rings: number[][] }[];
  /** Footprint rings (ENU) and whether a landmark replaces the building. */
  footprints: Iterable<{ prism: readonly number[]; proxy: boolean }>;
  /** Road centrelines with their width (tunnels left out by the caller). */
  roads: Iterable<{ pts: readonly number[]; widthM: number }>;
  /** Ped edges as segments with their width. */
  peds: Iterable<{ x0: number; z0: number; x1: number; z1: number; widthM: number }>;
  chunkExists: (key: ChunkKey) => boolean;
}

export interface ScatterReport {
  wood: { polys: number; m2: number; trees: number; shrubs: number };
  scrub: { polys: number; m2: number; shrubs: number };
  /**
   * The m2 of the wood and scrub polygons no record may stand on, by the exclusion that blocks it (sampled on a 4 m lattice): the
   * operator's check that a polygon is not empty for a reason the bake can explain.
   */
  blockedM2: Record<string, number>;
  park: { pieces: number; m2: number; groves: number; trees: number; shrubs: number };
  hedge: { lines: number; m: number; blocks: number };
  yard: { frontageCells: number; hedgeLots: number; hedgeBlocks: number; shrubs: number };
  /** Records per form (the seven of the byte). */
  forms: Record<VegFormName, number>;
  records: number;
}

export interface ScatterProduct {
  /** Flat `x, z, scale, byte` per record, the street-tree layout of `WaterProduct.trees`, bit 7 set on every byte. */
  records: number[];
  report: ScatterReport;
}

const q1 = (v: number): number => Math.round(v * 10) / 10;

/** A uniform segment grid: the distance from a point to the nearest segment, less that segment's half width. */
class SegmentIndex {
  private readonly segs: number[] = [];
  private readonly cells = new Map<number, number[]>();
  private maxHalf = 0;
  constructor(private readonly cell = 32) {}
  private key(i: number, j: number): number {
    return (i + 65536) * 131072 + (j + 65536);
  }
  add(x0: number, z0: number, x1: number, z1: number, half: number): void {
    const id = this.segs.length / 5;
    this.segs.push(x0, z0, x1, z1, half);
    this.maxHalf = Math.max(this.maxHalf, half);
    const i0 = Math.floor((Math.min(x0, x1) - half) / this.cell), i1 = Math.floor((Math.max(x0, x1) + half) / this.cell);
    const j0 = Math.floor((Math.min(z0, z1) - half) / this.cell), j1 = Math.floor((Math.max(z0, z1) + half) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      const l = this.cells.get(k);
      if (l) l.push(id);
      else this.cells.set(k, [id]);
    }
  }
  /** Whether a segment's band (half width + `extra`) holds the point. */
  within(x: number, z: number, extra: number): boolean {
    const l = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!l) return this.near(x, z, extra);
    for (const id of l) if (this.hit(id, x, z, extra)) return true;
    return this.near(x, z, extra);
  }
  /** The neighbouring cells, for bands that reach across a cell edge. */
  private near(x: number, z: number, extra: number): boolean {
    const r = this.maxHalf + extra;
    const ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
    const i0 = Math.floor((x - r) / this.cell), i1 = Math.floor((x + r) / this.cell), j0 = Math.floor((z - r) / this.cell), j1 = Math.floor((z + r) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      if (i === ci && j === cj) continue;
      for (const id of this.cells.get(this.key(i, j)) ?? []) if (this.hit(id, x, z, extra)) return true;
    }
    return false;
  }
  private hit(id: number, x: number, z: number, extra: number): boolean {
    const s = this.segs;
    const ax = s[id * 5] as number, az = s[id * 5 + 1] as number, bx = s[id * 5 + 2] as number, bz = s[id * 5 + 3] as number, h = (s[id * 5 + 4] as number) + extra;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - x, ez = az + t * dz - z;
    return ex * ex + ez * ez < h * h;
  }
}

/** The exclusions every layer obeys (the test of `tools/map/test/scatter.spec.ts` reads the same rules from the same inputs). */
export class ScatterExclusion {
  private readonly prisms = new PrismIndex();
  private readonly proxies = new PrismIndex();
  private readonly roads = new SegmentIndex();
  private readonly peds = new SegmentIndex();
  private readonly polys: { box: { minX: number; minZ: number; maxX: number; maxZ: number }; rings: number[][] }[] = [];

  constructor(private readonly inp: ScatterInputs) {
    for (const f of inp.footprints) (f.proxy ? this.proxies : this.prisms).add(f.prism as number[]);
    for (const r of inp.roads) {
      for (let i = 0; i + 3 < r.pts.length; i += 2) this.roads.add(r.pts[i] as number, r.pts[i + 1] as number, r.pts[i + 2] as number, r.pts[i + 3] as number, r.widthM / 2);
    }
    for (const e of inp.peds) this.peds.add(e.x0, e.z0, e.x1, e.z1, e.widthM / 2);
    for (const p of inp.excluded) {
      const outer = p.rings[0];
      if (outer && outer.length >= 6) this.polys.push({ box: ringBbox(outer), rings: p.rings });
    }
  }

  /** Whether nothing may stand at `(x, z)`, and why (QA, tests). */
  reason(x: number, z: number): string | null {
    const c = this.inp.cfg.exclusion;
    if (!this.inp.chunkExists(chunkKeyAt(9, x, z))) return 'chunk';
    if (BLOCKED_GROUND.has(this.inp.ground.at(x, z, GroundClass.Water))) return 'ground';
    if (this.inp.cover && this.inp.cover.at(x, z, 0) === CoverClass.Driveway) return 'driveway';
    if (this.prisms.distance(x, z, c.footprintM) < c.footprintM || this.prisms.distance(x, z, 0.001) === 0) return 'footprint';
    if (this.proxies.distance(x, z, c.landmarkM) < c.landmarkM || this.proxies.distance(x, z, 0.001) === 0) return 'landmark';
    if (this.roads.within(x, z, c.roadM)) return 'road';
    if (this.peds.within(x, z, c.pedM)) return 'ped';
    for (const p of this.polys) {
      if (x < p.box.minX || x > p.box.maxX || z < p.box.minZ || z > p.box.maxZ) continue;
      let inside = false;
      for (const r of p.rings) if (pointInRing(x, z, r)) inside = !inside;
      if (inside) return 'excluded';
    }
    return null;
  }

  excluded(x: number, z: number): boolean {
    return this.reason(x, z) !== null;
  }
}

/** The form of a mix draw `u` in [0, 1): the mix's forms in `TREE_FORM_NAMES` order, each over its share (the last takes the rest). */
export function formOfMix(mix: FormMix, u: number): TreeForm {
  const names = TREE_FORM_NAMES.filter((n) => (mix[n] ?? 0) > 0);
  let acc = 0;
  for (const n of names) {
    acc += mix[n] as number;
    if (u < acc) return TREE_FORM_NAMES.indexOf(n) as TreeForm;
  }
  return TREE_FORM_NAMES.indexOf(names[names.length - 1] ?? 'plane') as TreeForm;
}

/** A 1 m inside-mask of a polygon (even-odd over its rings) over its box clipped to the area: the scatter's fast containment test. */
function polyMask(rings: readonly number[][], grid: AreaGrid): { r: Raster; cells: number } | null {
  const outer = rings[0];
  if (!outer || outer.length < 6) return null;
  const b = ringBbox(outer);
  const minX = Math.max(grid.minX, Math.floor(b.minX)), minZ = Math.max(grid.minZ, Math.floor(b.minZ));
  const maxX = Math.min(grid.maxX, Math.ceil(b.maxX)), maxZ = Math.min(grid.maxZ, Math.ceil(b.maxZ));
  if (maxX <= minX || maxZ <= minZ) return null;
  const r = new Raster(minX, minZ, 1, maxX - minX, maxZ - minZ, 0.5);
  r.fillRings(rings, 1);
  let cells = 0;
  for (let k = 0; k < r.data.length; k++) if (r.data[k] === 1) cells++;
  return cells > 0 ? { r, cells } : null;
}

const emptyForms = (): Record<VegFormName, number> => Object.fromEntries(VEG_FORM_NAMES.map((n) => [n, 0])) as Record<VegFormName, number>;

export function runScatter(inp: ScatterInputs): ScatterProduct {
  const { cfg, grid } = inp;
  const ex = new ScatterExclusion(inp);
  const records: number[] = [];
  const report: ScatterReport = {
    wood: { polys: 0, m2: 0, trees: 0, shrubs: 0 },
    scrub: { polys: 0, m2: 0, shrubs: 0 },
    blockedM2: {},
    park: { pieces: 0, m2: 0, groves: 0, trees: 0, shrubs: 0 },
    hedge: { lines: 0, m: 0, blocks: 0 },
    yard: { frontageCells: 0, hedgeLots: 0, hedgeBlocks: 0, shrubs: 0 },
    forms: emptyForms(),
    records: 0,
  };
  const trees = new PointHash(Math.max(2, cfg.wood.rMin));
  const shrubs = new PointHash(Math.max(1, cfg.scrub.rMin));
  const rngOf = (id: string): Rng => new Rng(fnv32(`${cfg.seed}|${id}`));
  const push = (x: number, z: number, form: TreeForm, rng: Rng): void => {
    records.push(x, z, (24 + Math.floor(rng.nextFloat() * 17)) / 32, treeByte(form, true));
    report.forms[VEG_FORM_NAMES[form] as VegFormName]++;
  };
  const inGrid = (x: number, z: number): boolean => x >= grid.minX && x < grid.maxX && z >= grid.minZ && z < grid.maxZ;

  // a layer of shrubs over a domain: Bridson against a scratch hash (so the dropped share never blocks a later polygon), each point kept
  // with `share` and only when no shrub of an earlier polygon stands within `rMin`
  const shrubLayer = (dom: PoissonDomain, rMin: number, share: number, rng: Rng): number => {
    const scratch = new PointHash(Math.max(1, rMin));
    const guarded: PoissonDomain = { ...dom, accept: (x, z) => !shrubs.near(x, z, rMin) && dom.accept(x, z) };
    const pts = bridson(guarded, rMin, rng, scratch);
    let n = 0;
    for (let i = 0; i < pts.length; i += 2) {
      if (rng.nextFloat() >= share) continue;
      const x = pts[i] as number, z = pts[i + 1] as number;
      shrubs.add(x, z);
      push(x, z, TreeForm.Shrub, rng);
      n++;
    }
    return n;
  };

  // 1, 2: woods and scrub, in id order; the wood mask on the cell grid keeps the groves out of the woods
  const woodCells = new Raster(inp.ground.originX, inp.ground.originZ, inp.ground.step, inp.ground.w, inp.ground.h, inp.ground.offset);
  const polys = [...inp.polys].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const p of polys) {
    const m = polyMask(p.rings, grid);
    if (!m) continue;
    const dom: PoissonDomain = {
      minX: m.r.originX, minZ: m.r.originZ, maxX: m.r.originX + m.r.w, maxZ: m.r.originZ + m.r.h,
      accept: (x, z) => m.r.at(x, z, 0) === 1 && !ex.excluded(x, z),
    };
    for (let j = 0; j < m.r.h; j += 4) {
      for (let i = 0; i < m.r.w; i += 4) {
        const x = m.r.originX + i + 0.5, z = m.r.originZ + j + 0.5;
        if (m.r.at(x, z, 0) !== 1) continue;
        const why = ex.reason(x, z);
        if (why) report.blockedM2[why] = (report.blockedM2[why] ?? 0) + 16;
      }
    }
    if (p.kind === 'wood') {
      woodCells.fillRings(p.rings, 1);
      report.wood.polys++;
      report.wood.m2 += m.cells;
      const rng = rngOf(p.id);
      const pts = bridson(dom, cfg.wood.rMin, rng, trees);
      for (let i = 0; i < pts.length; i += 2) push(pts[i] as number, pts[i + 1] as number, formOfMix(cfg.wood.mix, rng.nextFloat()), rng);
      report.wood.trees += pts.length / 2;
      report.wood.shrubs += shrubLayer(dom, cfg.wood.understory.rMin, cfg.wood.understory.share, rngOf(`${p.id}|understory`));
    } else {
      report.scrub.polys++;
      report.scrub.m2 += m.cells;
      report.scrub.shrubs += shrubLayer(dom, cfg.scrub.rMin, cfg.scrub.share, rngOf(p.id));
    }
  }

  // 3: park pieces outside the woods
  const g = inp.ground;
  const parkAt = (k: number): boolean => woodCells.data[k] !== 1 && (inp.cover ? inp.cover.data[k] === CoverClass.Park : g.data[k] === GroundClass.Park);
  const seen = new Uint8Array(g.w * g.h);
  const stack: number[] = [];
  const groves = new PointHash(Math.max(4, cfg.park.centreRMin));
  for (let start = 0; start < g.w * g.h; start++) {
    if (seen[start] === 1 || !parkAt(start)) continue;
    // the piece: a flood fill over the 4-connected park cells
    let minI = Infinity, minJ = Infinity, maxI = -Infinity, maxJ = -Infinity, cells = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const k = stack.pop() as number;
      const i = k % g.w, j = (k - i) / g.w;
      cells++;
      if (i < minI) minI = i;
      if (i > maxI) maxI = i;
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
      const visit = (q: number): void => {
        if (seen[q] !== 1 && parkAt(q)) { seen[q] = 1; stack.push(q); }
      };
      if (i > 0) visit(k - 1);
      if (i < g.w - 1) visit(k + 1);
      if (j > 0) visit(k - g.w);
      if (j < g.h - 1) visit(k + g.w);
    }
    report.park.pieces++;
    report.park.m2 += cells * g.step * g.step;
    const id = `park@${start}`;
    const rng = rngOf(id);
    const inPark = (x: number, z: number): boolean => {
      const i = Math.round((x - g.originX) / g.step - g.offset), j = Math.round((z - g.originZ) / g.step - g.offset);
      return i >= 0 && j >= 0 && i < g.w && j < g.h && parkAt(j * g.w + i);
    };
    const dom: PoissonDomain = {
      minX: g.originX + minI * g.step, minZ: g.originZ + minJ * g.step, maxX: g.originX + (maxI + 1) * g.step, maxZ: g.originZ + (maxJ + 1) * g.step,
      accept: (x, z) => inPark(x, z) && !ex.excluded(x, z),
    };
    const centres = bridson(dom, cfg.park.centreRMin, rng, groves);
    for (let c = 0; c < centres.length; c += 2) {
      const cx = centres[c] as number, cz = centres[c + 1] as number;
      const want = cfg.park.groveMin + Math.floor(rng.nextFloat() * (cfg.park.groveMax - cfg.park.groveMin + 1));
      report.park.groves++;
      let placed = 0;
      for (let t = 0; t < want * 12 && placed < want; t++) {
        const [px, pz] = discPoint(rng, cx, cz, cfg.park.groveRadiusM);
        const x = q1(px), z = q1(pz);
        if (!inGrid(x, z) || trees.near(x, z, cfg.park.treeRMin) || !dom.accept(x, z)) continue;
        trees.add(x, z);
        push(x, z, formOfMix(cfg.park.mix, rng.nextFloat()), rng);
        placed++;
        report.park.trees++;
        if (rng.nextFloat() < cfg.park.edgeShrubShare) {
          // the edge shrub: out from the centre through the tree, just past the grove's rim
          const dx = x - cx, dz = z - cz, d = Math.sqrt(dx * dx + dz * dz);
          const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
          const r = cfg.park.groveRadiusM + rng.nextFloat() * cfg.park.edgeShrubM;
          const sx = q1(cx + ux * r), sz = q1(cz + uz * r);
          if (inGrid(sx, sz) && !shrubs.near(sx, sz, cfg.park.shrubRMin) && dom.accept(sx, sz)) {
            shrubs.add(sx, sz);
            push(sx, sz, TreeForm.Shrub, rng);
            report.park.shrubs++;
          }
        }
      }
    }
  }

  // 4a: hedge lines, a block every `blockM` from half a block in
  const hedges = [...inp.hedges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hb = cfg.hedge.blockM;
  for (const h of hedges) {
    const len = polyLength(h.pts);
    if (!(len > 0)) continue;
    report.hedge.lines++;
    report.hedge.m += len;
    const rng = rngOf(h.id);
    for (let k = 0; (k + 0.5) * hb <= len; k++) {
      const p = pointAt(h.pts, (k + 0.5) * hb);
      const x = q1(p.x), z = q1(p.z);
      if (!inGrid(x, z) || ex.excluded(x, z)) continue;
      push(x, z, TreeForm.Hedge, rng);
      report.hedge.blocks++;
    }
  }

  // 4b, 5: yard frontage hedges and yard shrubs, cell by cell in raster order (cover only)
  const cov = inp.cover;
  if (cov) {
    const isYard = (v: number): boolean => v === CoverClass.Yard || v === CoverClass.Mixed;
    const rngH = rngOf('yard-hedges'), rngS = rngOf('yard-shrubs');
    const hedgeSeed = fnv32(`${cfg.seed}|hedge-lots`), shrubSeed = fnv32(`${cfg.seed}|yard-shrubs`);
    const lots = new Set<string>();
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const k = j * g.w + i;
        if (!isYard(cov.data[k] as number)) continue;
        const cx = g.xOf(i), cz = g.zOf(j);
        const x0 = cx - g.step / 2, z0 = cz - g.step / 2;
        // the frontage: each side whose neighbour is a sidewalk cell, in a fixed order (north, south, west, east)
        const sides: [number, number, number][] = [];
        if (j > 0 && g.data[k - g.w] === GroundClass.Sidewalk) sides.push([0, -1, 0]);
        if (j < g.h - 1 && g.data[k + g.w] === GroundClass.Sidewalk) sides.push([0, 1, 0]);
        if (i > 0 && g.data[k - 1] === GroundClass.Sidewalk) sides.push([-1, 0, 0]);
        if (i < g.w - 1 && g.data[k + 1] === GroundClass.Sidewalk) sides.push([1, 0, 0]);
        if (sides.length > 0) {
          report.yard.frontageCells++;
          const lx = Math.floor(cx / cfg.hedge.lotM), lz = Math.floor(cz / cfg.hedge.lotM);
          if (cellHash01(lx, lz, hedgeSeed) < cfg.hedge.hedgeShare) {
            lots.add(`${lx},${lz}`);
            for (const [sx, sz] of sides) {
              // the line `insetM` inside the yard from the shared edge; blocks on the global `blockM` lattice along it
              const alongX = sx === 0;
              const fixed = alongX ? (sz < 0 ? z0 + cfg.hedge.insetM : z0 + g.step - cfg.hedge.insetM) : (sx < 0 ? x0 + cfg.hedge.insetM : x0 + g.step - cfg.hedge.insetM);
              const lo = alongX ? x0 : z0;
              for (let t = Math.ceil((lo - hb / 2) / hb - 1e-9) * hb + hb / 2; t < lo + g.step - 1e-9; t += hb) {
                const x = q1(alongX ? t : fixed), z = q1(alongX ? fixed : t);
                if (!inGrid(x, z) || ex.excluded(x, z)) continue;
                push(x, z, TreeForm.Hedge, rngH);
                report.yard.hedgeBlocks++;
              }
            }
          }
        }
        if (cellHash01(i, j, shrubSeed) < cfg.yard.shrubShare) {
          const x = q1(cx + (rngS.nextFloat() - 0.5) * g.step * 0.75), z = q1(cz + (rngS.nextFloat() - 0.5) * g.step * 0.75);
          if (inGrid(x, z) && !shrubs.near(x, z, cfg.yard.shrubRMin) && !ex.excluded(x, z)) {
            shrubs.add(x, z);
            push(x, z, TreeForm.Shrub, rngS);
            report.yard.shrubs++;
          }
        }
      }
    }
    report.yard.hedgeLots = lots.size;
  }
  report.hedge.m = Math.round(report.hedge.m * 10) / 10;
  report.records = records.length / 4;
  return { records, report };
}

/**
 * The ped edges of S8's chunks as segments (node ids are local to their chunk). The plaza and park lattice (`PedEdgeKind.Plaza`, 12 m
 * walking cells over open ground, no paved path) is left out: it would empty every park.
 */
export function pedSegments(chunks: Iterable<{ nodes: readonly { id: number; x: number; z: number }[]; edges: readonly { a: number; b: number; widthM: number; kind?: number }[] }>): { x0: number; z0: number; x1: number; z1: number; widthM: number }[] {
  const out: { x0: number; z0: number; x1: number; z1: number; widthM: number }[] = [];
  for (const c of chunks) {
    const at = new Map<number, { x: number; z: number }>();
    for (const n of c.nodes) at.set(n.id, n);
    for (const e of c.edges) {
      if (e.kind === PedEdgeKind.Plaza) continue;
      const a = at.get(e.a), b = at.get(e.b);
      if (a && b) out.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z, widthM: e.widthM });
    }
  }
  return out;
}

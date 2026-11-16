/**
 * The software silhouette rasterizer of the skyline cards (02-world-maps.md section 4.3; M10d2). Pure and deterministic: no `three`,
 * no clock, no randomness beyond seeded streams, integer pixel loops, so two runs give the same bytes.
 *
 * One card per cluster and azimuth (W, SW, NW in `config/world/backdrop.json`): an orthographic view of the cluster from that side.
 * The card's column `i` is the position along the card (the right-hand vector of the view, `-widthM/2 .. +widthM/2`), its row `j` the
 * height above sea level (`heightM` at the top row, 0 at the bottom), exactly the quad `cardsLayout` builds in the client. Per column
 * the rasterizer walks the cluster's depth from far to near and paints, painter's order:
 *   - the terrain of the far DEM (`far-bay-dem` posts, bilinear), in layers that fade into the haze with distance;
 *   - where the DEM holds no land under the cluster (an area bake without the far mosaic), a seeded ridge of the cluster's `ridgeM`;
 *   - a seeded set of boxes for the cluster's built-up part (`towers`, `towerMaxM`, `houses`): plain massing with a lit edge, no
 *     windows, text, signs or logos (02-world-bake.md section 4 S4 rule 8).
 * Water (height at or under 0) stays transparent, so the sky and the DEM ring show through. The top tenth of every card stays clear.
 */
import { Rng, fnv32 } from '../../../../packages/shared/src/index.ts';

export interface CardCluster {
  id: string;
  col: number;
  enu: [number, number];
  widthM: number;
  heightM: number;
  /** Peak of the seeded ridge used where the DEM has no land (m). */
  ridgeM?: number;
  /** Seeded built-up part: towers (count, tallest m) and low houses (count). */
  towers?: number;
  towerMaxM?: number;
  houses?: number;
}

export interface CardAtlasLayout {
  cols: number;
  rows: number;
  cardPx: [number, number];
  sizePx: [number, number];
  azimuthsDeg: number[];
}

/** A height sampler over ENU metres: terrain height in m, or null where the DEM holds water or nothing. */
export type HeightAt = (x: number, z: number) => number | null;

export interface Rgba { width: number; height: number; data: Uint8Array }

/** Colours of the atlas (sRGB bytes); the card material multiplies them by `colors.card`. */
const HAZE: readonly [number, number, number] = [214, 222, 230];
const HILL_NEAR: readonly [number, number, number] = [132, 146, 118];
const HILL_FAR: readonly [number, number, number] = [176, 186, 178];
const BUILT: readonly [number, number, number] = [196, 192, 184];
const BUILT_LIT: readonly [number, number, number] = [236, 230, 218];
const BUILT_SHADE: readonly [number, number, number] = [150, 150, 152];

/** Depth step of the terrain walk (m). */
export const DEPTH_STEP_M = 64;

interface Box { u: number; t: number; halfU: number; halfT: number; h: number; lit: boolean }

const mix = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [
  Math.round((a[0] as number) + ((b[0] as number) - (a[0] as number)) * k),
  Math.round((a[1] as number) + ((b[1] as number) - (a[1] as number)) * k),
  Math.round((a[2] as number) + ((b[2] as number) - (a[2] as number)) * k),
];

/** Compass azimuth (0 = north = -Z, 90 = east) to the unit vector pointing that way in ENU (x east, z south). */
export function azimuthVector(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Math.round(Math.sin(a) * 1e9) / 1e9, Math.round(-Math.cos(a) * 1e9) / 1e9];
}

/** Seeded value noise in one dimension, smoothstep between lattice points, in [0, 1]. */
function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number): number => (fnv32(`${seed}:${n}`) % 10007) / 10006;
  const s = f * f * (3 - 2 * f);
  return h(i) * (1 - s) + h(i + 1) * s;
}

/** The seeded ridge profile of a cluster at card position `u` (m) and depth layer `k` (0 near .. 2 far), in m. */
export function ridgeHeight(c: CardCluster, u: number, k: number): number {
  const peak = c.ridgeM ?? 0;
  if (peak <= 0) return 0;
  const seed = fnv32(`ridge:${c.id}:${k}`);
  const x = u / c.widthM; // -0.5 .. 0.5
  // a broad shoulder that falls off towards the card's ends (offset per layer so the ridges do not peak together)
  const ax = Math.min(1, Math.max(0, (Math.abs(x + (k - 1) * 0.08) - 0.12) / 0.36));
  const env = 1 - ax * ax * (3 - 2 * ax);
  const n = 0.55 * noise1(seed, x * 4) + 0.3 * noise1(seed + 1, x * 11) + 0.15 * noise1(seed + 2, x * 29);
  const layer = [0.55, 0.8, 1][k] as number;
  return peak * layer * env * (0.35 + 0.65 * n);
}

/** The seeded boxes of a cluster's built-up part, in cluster space (`u` east-west-ish along the cluster's own axis, `t` across). */
export function clusterBoxes(c: CardCluster): { x: number; z: number; w: number; d: number; h: number }[] {
  const rng = new Rng(fnv32(`skyline:${c.id}`));
  const r01 = (): number => rng.nextU32() / 4294967296;
  const out: { x: number; z: number; w: number; d: number; h: number }[] = [];
  const towers = c.towers ?? 0;
  const maxH = c.towerMaxM ?? 0;
  const core = c.widthM * 0.16;
  for (let i = 0; i < towers; i++) {
    // a core of towers, tallest near the centre
    const rx = (r01() + r01() + r01() - 1.5) / 1.5, rz = (r01() + r01() - 1) ;
    const x = rx * core, z = rz * core * 0.6;
    const fall = 1 - Math.min(1, Math.hypot(rx, rz) * 0.8);
    const h = Math.max(12, maxH * (0.25 + 0.75 * fall) * (0.45 + 0.55 * r01()));
    out.push({ x: Math.round(x), z: Math.round(z), w: 18 + Math.floor(r01() * 30), d: 18 + Math.floor(r01() * 30), h: Math.round(h) });
  }
  const houses = c.houses ?? 0;
  for (let i = 0; i < houses; i++) {
    const x = (r01() - 0.5) * c.widthM * 0.8, z = (r01() - 0.5) * c.widthM * 0.4;
    out.push({ x: Math.round(x), z: Math.round(z), w: 30 + Math.floor(r01() * 60), d: 30 + Math.floor(r01() * 40), h: 6 + Math.floor(r01() * 10) });
  }
  return out;
}

/**
 * One card: `cardPx` pixels of the cluster seen from compass azimuth `azDeg` (the side the viewer stands on). `heightAt` samples the
 * far DEM; `demLand` says whether the DEM holds any land under the cluster (else the seeded ridge stands in).
 */
export function rasterCard(c: CardCluster, azDeg: number, cardPx: [number, number], heightAt: HeightAt, demLand: boolean): Rgba {
  const [W, H] = cardPx;
  const data = new Uint8Array(W * H * 4);
  // view: from the viewer (at azimuth azDeg of the cluster) towards the cluster; right: the card's +u, as in cardsLayout
  const [toX, toZ] = azimuthVector(azDeg); // direction from the cluster to the viewer
  const viewX = -toX, viewZ = -toZ;
  const rightX = toZ, rightZ = -toX;
  const topM = c.heightM * 0.9;
  const rowOf = (hM: number): number => Math.max(0, Math.min(H, Math.round((Math.min(hM, topM) / c.heightM) * H)));
  const near = -c.widthM * 0.5, far = c.widthM * 1.5;

  // boxes in card space; the cluster's own frame is the ENU frame (x east, z south)
  const boxes: Box[] = clusterBoxes(c).map((b) => {
    const u = b.x * rightX + b.z * rightZ;
    const t = b.x * viewX + b.z * viewZ;
    const halfU = (Math.abs(b.w * rightX) + Math.abs(b.d * rightZ)) / 2;
    const halfT = (Math.abs(b.w * viewX) + Math.abs(b.d * viewZ)) / 2;
    return { u, t, halfU, halfT, h: b.h, lit: false };
  });
  boxes.sort((p, q) => q.t - p.t || p.u - q.u || p.h - q.h);

  const paint = (i: number, top: number, rgb: readonly number[]): void => {
    // rows count from the top of the image: row 0 is heightM, row H-1 is sea level
    for (let r = H - top; r < H; r++) {
      const o = (r * W + i) * 4;
      data[o] = rgb[0] as number; data[o + 1] = rgb[1] as number; data[o + 2] = rgb[2] as number; data[o + 3] = 255;
    }
  };
  const groundAt = (u: number, t: number): number => {
    const x = c.enu[0] + u * rightX + t * viewX, z = c.enu[1] + u * rightZ + t * viewZ;
    if (demLand) return Math.max(0, heightAt(x, z) ?? 0);
    return 0;
  };

  for (let i = 0; i < W; i++) {
    const u = ((i + 0.5) / W - 0.5) * c.widthM;
    if (demLand) {
      // terrain, far to near: one layer per depth step, hazier with distance
      const steps = Math.floor((far - near) / DEPTH_STEP_M);
      for (let s = steps; s >= 0; s--) {
        const t = near + s * DEPTH_STEP_M;
        const k = (t - near) / (far - near); // 0 near .. 1 far
        const h = groundAt(u, t);
        if (h <= 0.5) continue;
        paint(i, rowOf(h), mix(mix(HILL_NEAR, HILL_FAR, k), HAZE, k * k * 0.6));
      }
    } else {
      // three seeded ridge layers at fixed depths stand in for the DEM
      for (const [layer, k] of [[2, 0.85], [1, 0.5], [0, 0.15]] as const) {
        const h = ridgeHeight(c, u, layer);
        if (h > 0.5) paint(i, rowOf(h), mix(mix(HILL_NEAR, HILL_FAR, k), HAZE, k * k * 0.6));
      }
    }
    // a strip of low land along the shore under the middle of the card, so every card stands on ground
    if (Math.abs(u) < c.widthM * 0.3) paint(i, Math.max(rowOf(c.heightM * 0.02), 2), mix(HILL_NEAR, HAZE, 0.25));
    // boxes, far to near, standing on the ground at their spot
    for (const b of boxes) {
      if (u < b.u - b.halfU || u > b.u + b.halfU) continue;
      const k = Math.max(0, Math.min(1, (b.t - near) / (far - near)));
      const edge = (u - (b.u - b.halfU)) / Math.max(1, 2 * b.halfU); // 0 left .. 1 right
      const base = edge < 0.22 ? BUILT_LIT : edge > 0.85 ? BUILT_SHADE : BUILT;
      paint(i, rowOf(groundAt(b.u, b.t) + b.h), mix(base, HAZE, k * 0.5));
    }
  }
  return { width: W, height: H, data };
}

/** The atlas: cluster `col` x azimuth row, `sizePx` RGBA, transparent where no card paints. */
export function rasterAtlas(clusters: readonly CardCluster[], layout: CardAtlasLayout, heightAt: HeightAt, demLandOf: (c: CardCluster) => boolean): { atlas: Rgba; cards: number } {
  const [AW, AH] = layout.sizePx;
  const [cw, ch] = layout.cardPx;
  const data = new Uint8Array(AW * AH * 4);
  let cards = 0;
  for (const c of clusters) {
    const land = demLandOf(c);
    layout.azimuthsDeg.forEach((az, row) => {
      const card = rasterCard(c, az, [cw, ch], heightAt, land);
      for (let y = 0; y < ch; y++) {
        const src = y * cw * 4;
        data.set(card.data.subarray(src, src + cw * 4), ((row * ch + y) * AW + c.col * cw) * 4);
      }
      cards++;
    });
  }
  return { atlas: { width: AW, height: AH, data }, cards };
}

/** Bilinear sampler over a DEM grid of `cellM` posts (heights in m; NaN or a non-land post reads as water). */
export function demSampler(g: { minX: number; minZ: number; nx: number; nz: number; cellM: number; heights: Float32Array; land: Uint8Array }): HeightAt {
  return (x, z) => {
    const fx = (x - g.minX) / g.cellM, fz = (z - g.minZ) / g.cellM;
    if (fx < 0 || fz < 0 || fx > g.nx - 1 || fz > g.nz - 1) return null;
    const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.nz - 2, Math.floor(fz));
    const ax = fx - i, az = fz - j;
    let sum = 0, wsum = 0, land = 0;
    for (const [di, dj, w] of [[0, 0, (1 - ax) * (1 - az)], [1, 0, ax * (1 - az)], [0, 1, (1 - ax) * az], [1, 1, ax * az]] as const) {
      const p = (j + dj) * g.nx + (i + di);
      sum += (g.heights[p] as number) * w; wsum += w;
      if (g.land[p]) land += w;
    }
    return land >= 0.5 && wsum > 0 ? sum / wsum : null;
  };
}

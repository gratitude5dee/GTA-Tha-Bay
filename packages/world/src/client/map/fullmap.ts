/**
 * The full map (M02c2; 02-world-maps.md section 3): 0.25 to 8 m/px, a legend of layers, blips, the GPS line and neighbourhood and
 * landmark labels. Below 2 m/px it redraws the vectors of the visible chunks (at most 25,000 draw operations; the sim is paused, so the
 * host redraws on input only). From 2 m/px it composites cached tiles (z9 up to 3 m/px, z7 beyond), which arrive from the rasteriser and
 * call `onDirty` so the host redraws once. Pure of the DOM except the canvas it is given.
 */
import { CHUNK_EDGE_M, GRID_MIN_M, type MapBlip, type MapBuildings, type MapData } from '@dv/shared';
import { clampToRim, drawBlip, drawRoute, type Ctx2D } from './blips.ts';
import { drawHoodOutlines, drawRegion, hillImage, type CanvasFactory } from './raster.ts';
import type { TileImage, TileRaster } from './minimap.ts';
import { LAYER, LAYERS_ALL, type FullMapView, type LayerMask, type MapFrame, type MapPalette, type MapPick, type Viewport } from './views.ts';

export const FULLMAP_MIN_M_PER_PX = 0.25;
export const FULLMAP_MAX_M_PER_PX = 8;
/** Below this the vectors are redrawn; from it the cached tiles are composited. */
export const FULLMAP_VECTOR_BELOW = 2;
export const FULLMAP_MAX_OPS = 25_000;
export const FULLMAP_MAX_TILES = 96;
export const FULLMAP_MAX_BLIPS = 256;

export interface FullMapDeps {
  raster: TileRaster;
  data(): MapData | null;
  bldg(): MapBuildings | null;
  /** Called when something the last frame lacked (a tile, the data) has arrived: draw again. */
  onDirty(): void;
  make?: CanvasFactory | null;
}

interface TileEntry { state: 'pending' | 'ready' | 'empty'; img: TileImage | null }

export const clampZoom = (mPerPx: number): number =>
  mPerPx < FULLMAP_MIN_M_PER_PX ? FULLMAP_MIN_M_PER_PX : mPerPx > FULLMAP_MAX_M_PER_PX ? FULLMAP_MAX_M_PER_PX : mPerPx;

export class FullMapImpl implements FullMapView {
  private ctx: Ctx2D | null = null;
  private palette: MapPalette | null = null;
  private readonly tiles = new Map<string, TileEntry>();
  private lastBlips: readonly MapBlip[] = [];
  private disposed = false;
  /** QA: what the last draw did. */
  last = { mode: 'none' as 'none' | 'vector' | 'tiles', level: 9 as 9 | 7 | 5, ops: 0, tilesDrawn: 0, pending: 0 };

  constructor(private readonly deps: FullMapDeps) {}

  attach(canvas: HTMLCanvasElement | OffscreenCanvas, palette: MapPalette): void {
    this.ctx = (canvas.getContext('2d') as Ctx2D | null) ?? null;
    this.palette = palette;
  }

  setPalette(p: MapPalette): void {
    this.palette = p;
  }

  get tilesResident(): number {
    return this.tiles.size;
  }

  private requestTile(level: 9 | 7, cx: number, cy: number, key: string): void {
    if (this.tiles.size >= FULLMAP_MAX_TILES) {
      for (const [k, e] of this.tiles) {
        if (e.state !== 'pending') {
          e.img?.close?.();
          this.tiles.delete(k);
          break;
        }
      }
    }
    const e: TileEntry = { state: 'pending', img: null };
    this.tiles.set(key, e);
    void this.deps.raster.raster(level, cx, cy).then(
      (img) => {
        if (this.disposed) {
          img?.close?.();
          return;
        }
        e.img = img;
        e.state = img ? 'ready' : 'empty';
        this.deps.onDirty();
      },
      () => {
        e.state = 'empty';
      },
    );
  }

  draw(v: Viewport, f: MapFrame, blips: readonly MapBlip[], route: Float32Array | null, layers: LayerMask = LAYERS_ALL): void {
    const ctx = this.ctx, p = this.palette;
    if (!ctx || !p || this.disposed) return;
    const mPerPx = clampZoom(v.mPerPx);
    const k = 1 / mPerPx;
    const data = this.deps.data();
    this.lastBlips = blips;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    ctx.fillStyle = (layers & LAYER.water) !== 0 ? p.water : p.land;
    ctx.fillRect(0, 0, v.w, v.h);
    const minX = v.cx - (v.w / 2) * mPerPx, maxX = v.cx + (v.w / 2) * mPerPx, minZ = v.cz - (v.h / 2) * mPerPx, maxZ = v.cz + (v.h / 2) * mPerPx;
    let ops = 0, tilesDrawn = 0, pending = 0;
    let mode: 'vector' | 'tiles' = mPerPx < FULLMAP_VECTOR_BELOW ? 'vector' : 'tiles';
    const level: 9 | 7 | 5 = mPerPx < 1 ? 9 : mPerPx <= 3 ? 7 : 5;
    if (!data) {
      mode = 'vector';
    } else if (mode === 'vector') {
      ctx.save();
      ctx.translate(v.w / 2, v.h / 2);
      ctx.scale(k, k);
      ctx.translate(-v.cx, -v.cz);
      ops += drawRegion(ctx, data, {
        level: level === 5 ? 7 : level, minX, minZ, maxX, maxZ, pxPerM: k, layers, palette: p, hill: hillImage(data, this.deps.make ?? null), bldg: this.deps.bldg(), labels: true,
      });
      ops += drawHoodOutlines(ctx, data, { minX, minZ, maxX, maxZ, pxPerM: k, palette: p });
      ctx.restore();
    } else {
      const tl: 9 | 7 = mPerPx < 3 ? 9 : 7;
      const edge = CHUNK_EDGE_M[tl];
      const cx0 = Math.max(0, Math.floor((minX - GRID_MIN_M) / edge)), cx1 = Math.floor((maxX - GRID_MIN_M) / edge);
      const cy0 = Math.max(0, Math.floor((minZ - GRID_MIN_M) / edge)), cy1 = Math.floor((maxZ - GRID_MIN_M) / edge);
      const want: { cx: number; cy: number; key: string; d: number }[] = [];
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const mx = GRID_MIN_M + (cx + 0.5) * edge - v.cx, mz = GRID_MIN_M + (cy + 0.5) * edge - v.cz;
          want.push({ cx, cy, key: `${tl}/${cx}/${cy}`, d: mx * mx + mz * mz });
        }
      }
      want.sort((a, b) => a.d - b.d);
      let started = 0;
      for (const w of want) {
        let e = this.tiles.get(w.key);
        if (!e && started < 6) {
          this.requestTile(tl, w.cx, w.cy, w.key);
          e = this.tiles.get(w.key);
          started++;
        }
        if (!e) {
          pending++;
          continue;
        }
        if (e.state === 'pending') pending++;
        if (e.state !== 'ready' || !e.img) continue;
        const ox = GRID_MIN_M + w.cx * edge, oz = GRID_MIN_M + w.cy * edge;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(e.img, (ox - v.cx) * k + v.w / 2, (oz - v.cz) * k + v.h / 2, edge * k + 0.5, edge * k + 0.5);
        tilesDrawn++;
        ops++;
      }
    }

    // overlays in screen space: neighbourhood and landmark labels, the GPS line, blips and the player
    const toScreen = (x: number, z: number, out: [number, number]): void => {
      out[0] = (x - v.cx) * k + v.w / 2;
      out[1] = (z - v.cz) * k + v.h / 2;
    };
    if (data && (layers & LAYER.labels) !== 0) ops += this.drawLabels(ctx, data, p, v, mPerPx, toScreen);
    ops += drawRoute(ctx, trimRoute(route, f.x, f.z), toScreen, p, 4) > 0 ? 1 : 0;
    const tmp: [number, number] = [0, 0];
    let drawn = 0;
    for (const b of blips) {
      if (drawn >= FULLMAP_MAX_BLIPS) break;
      if (b.kind === 'route') continue;
      if (b.minZoomMPerPx !== undefined && mPerPx > b.minZoomMPerPx) continue;
      toScreen(b.x, b.z, tmp);
      const ang = clampToRim(tmp[0] - v.w / 2, tmp[1] - v.h / 2, Math.min(v.w, v.h) / 2 - 14, tmp);
      // outside the circle that fits the canvas the glyph sits on its rim
      tmp[0] += v.w / 2;
      tmp[1] += v.h / 2;
      drawBlip(ctx, b, tmp[0], tmp[1], p, { sizePx: 16, rimAngle: ang, ...(b.radiusM ? { radiusPx: b.radiusM * k } : {}) });
      drawn++;
      ops++;
    }
    toScreen(f.x, f.z, tmp);
    drawBlip(ctx, { kind: 'player' }, tmp[0], tmp[1], p, { sizePx: 18, rotateRad: -f.yaw });
    ctx.restore();
    this.last = { mode, level, ops, tilesDrawn, pending };
  }

  private drawLabels(ctx: Ctx2D, data: MapData, p: MapPalette, v: Viewport, mPerPx: number, toScreen: (x: number, z: number, out: [number, number]) => void): number {
    let ops = 0;
    const tmp: [number, number] = [0, 0];
    const maxTier = mPerPx > 5 ? 1 : mPerPx > 2.5 ? 2 : 3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const h of data.hoods) {
      if (h.tier > maxTier) continue;
      toScreen(h.labelX, h.labelZ, tmp);
      if (tmp[0] < -80 || tmp[0] > v.w + 80 || tmp[1] < -20 || tmp[1] > v.h + 20) continue;
      ctx.font = `${h.tier === 1 ? 700 : 600} ${h.tier === 1 ? 14 : 12}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = p.land;
      ctx.strokeText(h.name, tmp[0], tmp[1]);
      ctx.fillStyle = p.label;
      ctx.fillText(h.name, tmp[0], tmp[1]);
      ops += 2;
    }
    if (mPerPx <= 4) {
      ctx.font = '600 11px system-ui, sans-serif';
      for (const l of data.labels) {
        if (l.kind !== 4) continue;
        toScreen(l.x, l.z, tmp);
        if (tmp[0] < -80 || tmp[0] > v.w + 80 || tmp[1] < -20 || tmp[1] > v.h + 20) continue;
        drawBlip(ctx, { kind: 'landmark' }, tmp[0], tmp[1], p, { sizePx: 11 });
        if (mPerPx <= 2) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = p.land;
          ctx.strokeText(l.text, tmp[0], tmp[1] + 14);
          ctx.fillStyle = p.label;
          ctx.fillText(l.text, tmp[0], tmp[1] + 14);
          ops += 2;
        }
        ops++;
      }
    }
    return ops;
  }

  /** What lies under a canvas point: a blip (within 12 px), a landmark pin, a neighbourhood, or bare ground. */
  pick(px: number, py: number, v: Viewport): MapPick | null {
    const mPerPx = clampZoom(v.mPerPx);
    const x = v.cx + (px - v.w / 2) * mPerPx, z = v.cz + (py - v.h / 2) * mPerPx;
    const r = 12 * mPerPx;
    let best: MapBlip | null = null;
    let bestD = r * r;
    for (const b of this.lastBlips) {
      if (b.kind === 'route') continue;
      const d = (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best) return { kind: 'blip', id: best.id, x: best.x, z: best.z };
    const data = this.deps.data();
    if (!data) return { kind: 'ground', id: null, x, z };
    for (const l of data.labels) {
      if (l.kind !== 4) continue;
      if ((l.x - x) * (l.x - x) + (l.z - z) * (l.z - z) <= r * r) return { kind: 'landmark', id: l.text, x: l.x, z: l.z };
    }
    const hood = hoodAtPoint(data, x, z);
    if (hood) return { kind: 'nhood', id: hood, x, z };
    return { kind: 'ground', id: null, x, z };
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.tiles.values()) e.img?.close?.();
    this.tiles.clear();
    this.ctx = null;
  }
}

/** The slug of the neighbourhood polygon containing (x, z), or null. */
export function hoodAtPoint(data: MapData, x: number, z: number): string | null {
  const ux = x * 2, uz = z * 2;
  for (const h of data.hoods) {
    for (const rings of h.polys) {
      const outer = rings[0];
      if (!outer || !inRing(outer, ux, uz)) continue;
      let inHole = false;
      for (let i = 1; i < rings.length; i++) if (inRing(rings[i] as Int32Array, ux, uz)) inHole = true;
      if (!inHole) return h.slug;
    }
  }
  return null;
}

function inRing(r: Int32Array, x: number, z: number): boolean {
  let inside = false;
  const n = r.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2] as number, zi = r[i * 2 + 1] as number, xj = r[j * 2] as number, zj = r[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The route from the nearest point to (x, z) on, with the player's position as its first point: the line follows the driver. */
export function trimRoute(route: Float32Array | null, x: number, z: number): Float32Array | null {
  if (!route || route.length < 4) return route;
  const n = route.length >> 1;
  let bi = 0, bd = Infinity;
  for (let i = 0; i + 1 < n; i++) {
    const ax = route[i * 2] as number, az = route[i * 2 + 1] as number, bx = route[i * 2 + 2] as number, bz = route[i * 2 + 3] as number;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - x, ez = az + t * dz - z;
    const d = ex * ex + ez * ez;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  const out: number[] = [x, z];
  for (let i = bi + 1; i < n; i++) out.push(route[i * 2] as number, route[i * 2 + 1] as number);
  return out.length >= 4 ? Float32Array.from(out) : route;
}

export function createFullMap(deps: FullMapDeps): FullMapImpl {
  return new FullMapImpl(deps);
}

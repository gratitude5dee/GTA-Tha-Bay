/**
 * The minimap (M02c2; 02-world-maps.md section 2): a tile cache and a compositor.
 *
 *  - Tiles are rasterised once per chunk and level by a `TileRaster` (asset.worker on an `OffscreenCanvas`, returning an `ImageBitmap`,
 *    or the main thread at most one chunk per frame) and kept in an LRU of at most 48 tiles (256 x 256 RGBA, about 12.6 MB).
 *  - A frame composites at most 3 x 3 tiles rotated to the player's heading (north-up on request), draws at most 64 blips (out of
 *    range ones clamp to the rim), the GPS line and the player arrow. The radius is 150 m on foot, `clamp(250 + 3 v, 250, 450)` driving
 *    and 600 racing; the tile level is z9 (256 m) up to a 256 m radius and z7 (1024 m, 4 m/px) beyond, so the 3 x 3 window always
 *    covers the circle.
 *  - It draws at `refreshHz` (30, 20 or 10), shows no attribution label, and holds no state the sim needs.
 */
import { CHUNK_EDGE_M, GRID_MIN_M, type MapBlip } from '@dv/shared';
import { clampToRim, drawBlip, drawRoute, type Ctx2D } from './blips.ts';
import { minimapRadiusM, type MapFrame, type MinimapOptions, type MinimapView } from './views.ts';

export const MINIMAP_MAX_TILES = 48;
export const MINIMAP_MAX_BLIPS = 64;
export const MINIMAP_VISIBLE_TILES = 9;
/** Tiles started per frame when the rasteriser runs in a worker, and in the main-thread fallback (one chunk per frame). */
export const WORKER_STARTS_PER_FRAME = 3;
export const MAIN_STARTS_PER_FRAME = 1;
const MAX_IN_FLIGHT = 6;

export type TileImage = CanvasImageSource & { close?: () => void };

export interface TileRaster {
  /** True when tiles are drawn off the main thread (`asset.worker`, `OffscreenCanvas`); false for the main-thread fallback. */
  readonly inWorker: boolean;
  /** Rasterises the tile of `level` at chunk (cx, cy); null when the map has nothing there. */
  raster(level: 9 | 7, cx: number, cy: number): Promise<TileImage | null>;
}

interface Entry {
  state: 'pending' | 'ready' | 'empty';
  img: TileImage | null;
}

export interface MinimapDeps {
  raster: TileRaster;
  /** Milliseconds; `performance.now` by default. */
  now?: () => number;
}

export interface MinimapStats {
  drawMs: number;
  tileMisses: number;
  tilesResident: number;
  /** QA: the last frame. */
  last: { level: 9 | 7; radiusM: number; tilesDrawn: number; blipsDrawn: number; rimBlips: number; started: number; routePoints: number; skipped: boolean };
}

export class MinimapImpl implements MinimapView {
  private ctx: Ctx2D | null = null;
  private o: MinimapOptions | null = null;
  private readonly tiles = new Map<string, Entry>();
  private inFlight = 0;
  private lastDrawAt = -Infinity;
  private disposed = false;
  private misses = 0;
  private readonly now: () => number;
  private drawMs = 0;
  private lastFrame: MinimapStats['last'] = { level: 9, radiusM: 150, tilesDrawn: 0, blipsDrawn: 0, rimBlips: 0, started: 0, routePoints: 0, skipped: false };
  /** Player-relative screen position of the last frame's player (QA). */
  playerPx: [number, number] = [0, 0];

  constructor(private readonly deps: MinimapDeps) {
    this.now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  get stats(): MinimapStats {
    return { drawMs: this.drawMs, tileMisses: this.misses, tilesResident: this.tiles.size, last: this.lastFrame };
  }

  get tileKeys(): string[] {
    return [...this.tiles.keys()];
  }

  attach(canvas: HTMLCanvasElement | OffscreenCanvas, o: MinimapOptions): void {
    this.o = o;
    this.ctx = (canvas.getContext('2d') as Ctx2D | null) ?? null;
    if (this.ctx && canvas.width !== o.sizePx) {
      canvas.width = o.sizePx;
      canvas.height = o.sizePx;
    }
    this.lastDrawAt = -Infinity;
  }

  /** Changes the options of an attached view (north-up toggle, palette, refresh rate). */
  setOptions(o: Partial<MinimapOptions>): void {
    if (this.o) this.o = { ...this.o, ...o };
  }

  private touch(key: string, e: Entry): void {
    this.tiles.delete(key);
    this.tiles.set(key, e);
  }

  private evict(): void {
    while (this.tiles.size > MINIMAP_MAX_TILES) {
      let victim: string | null = null;
      for (const [k, e] of this.tiles) {
        if (e.state !== 'pending') {
          victim = k;
          break;
        }
      }
      if (victim === null) return;
      const e = this.tiles.get(victim) as Entry;
      e.img?.close?.();
      this.tiles.delete(victim);
    }
  }

  private start(level: 9 | 7, cx: number, cy: number, key: string): void {
    const e: Entry = { state: 'pending', img: null };
    this.tiles.set(key, e);
    this.inFlight++;
    this.misses++;
    void this.deps.raster.raster(level, cx, cy).then(
      (img) => {
        this.inFlight--;
        if (this.disposed) {
          img?.close?.();
          return;
        }
        e.img = img;
        e.state = img ? 'ready' : 'empty';
        this.evict();
      },
      () => {
        this.inFlight--;
        e.state = 'empty';
      },
    );
  }

  frame(f: MapFrame, blips: readonly MapBlip[], route: Float32Array | null): void {
    const o = this.o, ctx = this.ctx;
    if (!o || !ctx || this.disposed) return;
    const t0 = this.now();
    if (t0 - this.lastDrawAt < 1000 / o.refreshHz - 1) {
      this.lastFrame = { ...this.lastFrame, skipped: true };
      return;
    }
    this.lastDrawAt = t0;
    const size = o.sizePx;
    const radius = minimapRadiusM(f.mode, f.speedMps);
    const level: 9 | 7 = radius <= CHUNK_EDGE_M[9] ? 9 : 7;
    const edge = CHUNK_EDGE_M[level];
    const k = size / 2 / radius;                  // pixels per metre
    const c = size / 2;
    const pcx = Math.floor((f.x - GRID_MIN_M) / edge), pcy = Math.floor((f.z - GRID_MIN_M) / edge);

    // the visible tiles: the 3 x 3 window around the player's tile, keeping those that meet the view square
    const want: { cx: number; cy: number; key: string; d: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = pcx + dx, cy = pcy + dy;
        if (cx < 0 || cy < 0) continue;
        const ox = GRID_MIN_M + cx * edge, oz = GRID_MIN_M + cy * edge;
        if (ox > f.x + radius || ox + edge < f.x - radius || oz > f.z + radius || oz + edge < f.z - radius) continue;
        want.push({ cx, cy, key: `${level}/${cx}/${cy}`, d: Math.abs(dx) + Math.abs(dy) });
      }
    }
    want.sort((a, b) => a.d - b.d || a.cy - b.cy || a.cx - b.cx);

    // start missing tiles, nearest first
    const budget = this.deps.raster.inWorker ? WORKER_STARTS_PER_FRAME : MAIN_STARTS_PER_FRAME;
    let started = 0;
    for (const w of want) {
      if (this.tiles.has(w.key)) continue;
      if (started >= budget || this.inFlight >= MAX_IN_FLIGHT) continue;
      this.start(level, w.cx, w.cy, w.key);
      started++;
    }
    this.evict();

    // draw
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    if (o.shape === 'circle') ctx.arc(c, c, c, 0, Math.PI * 2);
    else ctx.rect(0, 0, size, size);
    ctx.clip();
    ctx.fillStyle = o.palette.water;
    ctx.fillRect(0, 0, size, size);
    const yaw = o.northUp ? 0 : f.yaw;
    ctx.translate(c, c);
    ctx.rotate(yaw);
    let tilesDrawn = 0;
    for (const w of want) {
      const e = this.tiles.get(w.key);
      if (!e || e.state !== 'ready' || !e.img) continue;
      this.touch(w.key, e);
      const ox = GRID_MIN_M + w.cx * edge, oz = GRID_MIN_M + w.cy * edge;
      ctx.drawImage(e.img, (ox - f.x) * k, (oz - f.z) * k, edge * k, edge * k);
      tilesDrawn++;
    }
    // route and blips in screen space (the glyphs stay upright)
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    ctx.rotate(-yaw);
    const routePoints = drawRoute(ctx, route, (x, z, out) => {
      const rx = (x - f.x) * k, rz = (z - f.z) * k;
      out[0] = rx * cos - rz * sin;
      out[1] = rx * sin + rz * cos;
    }, o.palette, Math.max(2, size / 40));
    const mPerPx = 1 / k;
    const gl = Math.max(8, size / 13);
    let drawn = 0, rim = 0;
    const tmp: [number, number] = [0, 0];
    for (const b of blips) {
      if (drawn >= MINIMAP_MAX_BLIPS) break;
      if (b.kind === 'route') continue;
      if (b.minZoomMPerPx !== undefined && mPerPx > b.minZoomMPerPx) continue;
      const rx = (b.x - f.x) * k, rz = (b.z - f.z) * k;
      const dx = rx * cos - rz * sin, dy = rx * sin + rz * cos;
      const ang = clampToRim(dx, dy, c - gl * 0.9, tmp);
      if (ang !== null) rim++;
      drawBlip(ctx, b, tmp[0], tmp[1], o.palette, { sizePx: gl, rimAngle: ang, ...(b.radiusM ? { radiusPx: b.radiusM * k } : {}) });
      drawn++;
    }
    // the player arrow, pointing along the heading
    drawBlip(ctx, { kind: 'player' }, 0, 0, o.palette, { sizePx: gl * 1.1, rotateRad: o.northUp ? -f.yaw : 0 });
    this.playerPx = [c, c];
    ctx.restore();
    this.drawMs = this.now() - t0;
    this.lastFrame = { level, radiusM: radius, tilesDrawn, blipsDrawn: drawn, rimBlips: rim, started, routePoints, skipped: false };
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.tiles.values()) e.img?.close?.();
    this.tiles.clear();
    this.ctx = null;
    this.o = null;
  }
}

export function createMinimap(deps: MinimapDeps): MinimapImpl {
  return new MinimapImpl(deps);
}

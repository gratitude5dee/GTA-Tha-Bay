/**
 * The page half of the maps (M02c2): `MapLayer` is what `WorldView` owns. It
 *
 *  - rasterises tiles for both views through the `world.map.tile` job (asset.worker, `OffscreenCanvas`), and on the main thread when the
 *    worker has no `OffscreenCanvas` (`AutoRaster`, one chunk per frame);
 *  - drives the HUD minimap canvas (`#dv-minimap-canvas`, found again whenever the HUD remounts) from the newest snapshot and the
 *    sim's `world.map` patch, at 30 Hz (20 Hz `mobile-low`, 10 Hz in XR);
 *  - runs the neighbourhood banner from `data/district-grid.v1` and reports each banner to `onArea` (the app patches `hud.area`);
 *  - opens the full map for the phone Map app (`openFullMap`) and answers its searches (`search`) through the `world.map.geocode` job.
 * A world baked before M02c2 has no map files; then the tiles come back empty and the minimap shows the water colour.
 */
import { NHOOD_NONE, decodeDistrictGrid, nhoodIndexAt, MapBuildings, MapData, type DistrictGrid, type MapBlip, type QualityTierId } from '@dv/shared';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import type { JobClient } from '../backdrop/backdrop-layer.ts';
import type { GeocodeHit } from '../../sim/map/geocoder.ts';
import { AreaBannerTracker, type AreaBannerPatch } from './banner.ts';
import { FullMapImpl, clampZoom, FULLMAP_MAX_M_PER_PX, FULLMAP_MIN_M_PER_PX } from './fullmap.ts';
import { MinimapImpl, type TileImage, type TileRaster } from './minimap.ts';
import { rasterTile, type CanvasFactory } from './raster.ts';
import { LAYER, LAYERS_ALL, mapPaletteOf, type LayerMask, type MapFrame, type MapMode, type MapPalette, type MapPick, type PaletteName } from './views.ts';

export type { GeocodeHit };

/** Minimap refresh rate by tier: 30 Hz, 20 Hz on `mobile-low`, 10 Hz in XR. */
export function refreshHzFor(tier: QualityTierId): 30 | 20 | 10 {
  return tier === 'mobile-low' ? 20 : tier === 'xr-quest' || tier === 'xr-visionpro' ? 10 : 30;
}

/** The layers a minimap tile carries: no street names (they would be unreadable at 1 px/m in 160 px). */
export const MINIMAP_LAYERS: LayerMask = LAYER.water | LAYER.parks | LAYER.buildings | LAYER.streets | LAYER.hillshade;

type AssetsJobs = JobClient & { job(name: string, args: unknown): Promise<unknown> };

/** The yaw of the engine for a heading vector (forward is (-sin yaw, -cos yaw)). */
export const yawOfDir = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** Rasterises on the main thread when the worker cannot. */
class MainRaster {
  private data: Promise<{ map: MapData | null; bldg: MapBuildings | null }> | null = null;
  constructor(private readonly assets: AssetsJobs, private readonly tier: QualityTierId, private readonly palette: () => MapPalette, private readonly doc: Document | null) {}

  private make: CanvasFactory = (w, h) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const cv = (this.doc as Document).createElement('canvas');
    cv.width = w;
    cv.height = h;
    return cv;
  };

  private load(): Promise<{ map: MapData | null; bldg: MapBuildings | null }> {
    this.data ??= (async () => {
      const bytes = async (which: 'map' | 'bldg'): Promise<ArrayBuffer | null> => ((await this.assets.job('world.map.bytes', { which, tier: this.tier })) as { bytes: ArrayBuffer | null }).bytes;
      const m = await bytes('map');
      const b = await bytes('bldg').catch(() => null);
      return { map: m ? MapData.decode(m) : null, bldg: b ? MapBuildings.decode(b) : null };
    })();
    return this.data;
  }

  async raster(level: 9 | 7, cx: number, cy: number, layers: LayerMask): Promise<TileImage | null> {
    if (!this.doc && typeof OffscreenCanvas === 'undefined') return null;
    const d = await this.load();
    if (!d.map) return null;
    return rasterTile(this.make, d.map, level === 9 ? d.bldg : null, level, cx, cy, this.palette(), layers) as TileImage | null;
  }
}

export class AutoRaster implements TileRaster {
  inWorker = true;
  private main: MainRaster | null = null;
  generation = 0;

  constructor(
    private readonly assets: AssetsJobs,
    private readonly tier: QualityTierId,
    private readonly palette: () => MapPalette,
    private readonly layers: () => LayerMask,
    private readonly doc: Document | null,
  ) {}

  raster(level: 9 | 7, cx: number, cy: number, layers?: LayerMask): Promise<TileImage | null> {
    const mask = layers ?? this.layers();
    if (this.main) return this.main.raster(level, cx, cy, mask);
    return this.assets.job('world.map.tile', { level, cx, cy, tier: this.tier, palette: this.palette(), layers: mask }).then((r) => {
      const res = r as { bitmap?: ImageBitmap; empty?: boolean; unsupported?: boolean };
      if (res.unsupported) {
        this.inWorker = false;
        this.main = new MainRaster(this.assets, this.tier, this.palette, this.doc);
        return this.main.raster(level, cx, cy, mask);
      }
      return res.bitmap ?? null;
    });
  }
}

export interface MapPlace {
  label: string;
  x: number;
  z: number;
  kind: string;
  cnn: number;
}

/** What the phone Map app drives (the UI package declares the same shape, `MapSessionPort`). */
export interface FullMapSession {
  draw(): void;
  resize(w: number, h: number): void;
  panBy(dxPx: number, dyPx: number): void;
  /** Zooms by `factor` (> 1 zooms out) keeping the point under (px, py) fixed. */
  zoomBy(factor: number, px?: number, py?: number): void;
  setZoom(mPerPx: number): void;
  centreOn(x: number, z: number): void;
  centreOnPlayer(): void;
  setLayers(mask: LayerMask): void;
  state(): { cx: number; cz: number; mPerPx: number; layers: LayerMask; w: number; h: number };
  pick(px: number, py: number): MapPick | null;
  /** The ENU point under a canvas pixel. */
  pointAt(px: number, py: number): { x: number; z: number };
  /** The candidate marker (a waypoint pin) drawn until replaced or cleared. */
  setMarker(p: { x: number; z: number } | null): void;
  dispose(): void;
}

export interface MapLayerOptions {
  assets: AssetsJobs;
  tier: QualityTierId;
  /** The document holding the HUD canvas and the main-thread fallback canvases; null in tests without a DOM. */
  doc?: Document | null;
  palette?: PaletteName;
  now?: () => number;
  /** Called once per neighbourhood banner (`nhood.<slug>`, at most once per 3 s). */
  onArea?: (p: AreaBannerPatch) => void;
}

/** The newest `world.map` patch of the sim. */
export interface MapPatchView {
  rev: number;
  blips: unknown[];
  route: unknown;
}

const HUD_CANVAS_ID = 'dv-minimap-canvas';
const CANVAS_LOOKUP_EVERY = 20;

export class MapLayer {
  readonly raster: AutoRaster;
  readonly minimap: MinimapImpl;
  private paletteName: PaletteName;
  private palette: MapPalette;
  private canvas: HTMLCanvasElement | null = null;
  private frames = 0;
  private mode: MapMode = 'foot';
  private northUp = false;
  private grid: DistrictGrid | null = null;
  private gridLoading = false;
  private tracker: AreaBannerTracker | null = null;
  private lastPatch: MapPatchView | null = null;
  private lastFrame: MapFrame = { x: 0, z: 0, yaw: 0, speedMps: 0, mode: 'foot', heat: 0, tick: 0 };
  private data: MapData | null = null;
  private dataLoading: Promise<MapData | null> | null = null;
  private bldg: MapBuildings | null = null;
  private readonly now: () => number;
  private readonly sessions = new Set<FullMapSessionImpl>();
  /** QA: the last banner and how many. */
  lastBanner: AreaBannerPatch | null = null;
  bannerCount = 0;
  private disposed = false;

  constructor(private readonly o: MapLayerOptions) {
    this.now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.paletteName = o.palette ?? 'default';
    this.palette = mapPaletteOf(this.paletteName);
    this.raster = new AutoRaster(o.assets, o.tier, () => this.palette, () => MINIMAP_LAYERS, o.doc ?? null);
    this.minimap = new MinimapImpl({ raster: this.raster, now: this.now });
  }

  setPalette(name: PaletteName): void {
    if (name === this.paletteName) return;
    this.paletteName = name;
    this.palette = mapPaletteOf(name);
    this.minimap.invalidate();
    this.minimap.setOptions({ palette: this.palette });
    for (const s of this.sessions) s.setPalette(this.palette);
  }

  setMode(m: MapMode): void {
    this.mode = m;
  }

  setNorthUp(on: boolean): void {
    this.northUp = on;
    this.minimap.setOptions({ northUp: on });
  }

  get northUpOn(): boolean {
    return this.northUp;
  }

  /** The newest sim patch (blips and the GPS line). */
  setPatch(p: MapPatchView | null): void {
    this.lastPatch = p;
  }

  get patch(): MapPatchView | null {
    return this.lastPatch;
  }

  /** The frame of the last `frame()` call (the full map centres on it). */
  get player(): MapFrame {
    return this.lastFrame;
  }

  private blips(): readonly MapBlip[] {
    return (this.lastPatch?.blips ?? []) as MapBlip[];
  }

  private routeLine(): Float32Array | null {
    const r = this.lastPatch?.route as { points?: number[] } | null | undefined;
    return r?.points && r.points.length >= 4 ? Float32Array.from(r.points) : null;
  }

  private ensureGrid(): void {
    if (this.grid || this.gridLoading) return;
    this.gridLoading = true;
    void this.o.assets
      .job('world.map.bytes', { which: 'district', tier: this.o.tier })
      .then((r) => {
        const bytes = (r as { bytes: ArrayBuffer | null }).bytes;
        if (!bytes) return;
        this.grid = decodeDistrictGrid(bytes);
        this.tracker = new AreaBannerTracker(this.grid.nhoods);
      })
      .catch(() => undefined);
  }

  /** Every frame, after the snapshot sync (WorldView.frame). */
  frame(f: WorldFrame): void {
    if (this.disposed || !f.player) return;
    this.frames++;
    const p = f.player;
    const speed = Math.hypot(p.vel[0], p.vel[2]);
    const yaw = yawOfDir(f.camera.dir[0], f.camera.dir[2]);
    const mode: MapMode = this.mode === 'race' ? 'race' : p.owner === 2 ? 'vehicle' : 'foot';
    const tick = Math.floor(this.now() * 0.06);
    this.lastFrame = { x: p.pos[0], z: p.pos[2], yaw, speedMps: speed, mode, heat: 0, tick };

    // the neighbourhood banner
    this.ensureGrid();
    if (this.grid && this.tracker) {
      const patch = this.tracker.update(tick, nhoodIndexAt(this.grid, p.pos[0], p.pos[2]));
      if (patch) {
        this.lastBanner = patch;
        this.bannerCount++;
        this.o.onArea?.(patch);
      }
    }

    // the HUD canvas
    const doc = this.o.doc;
    if (doc && (this.frames % CANVAS_LOOKUP_EVERY === 1 || !this.canvas || !this.canvas.isConnected)) {
      const cv = doc.getElementById(HUD_CANVAS_ID) as HTMLCanvasElement | null;
      if (cv !== this.canvas) {
        this.canvas = cv;
        if (cv) {
          this.minimap.attach(cv, {
            sizePx: cv.width || 160, shape: 'circle', northUp: this.northUp, refreshHz: refreshHzFor(this.o.tier), palette: this.palette,
          });
        }
      }
    }
    if (this.canvas) this.minimap.frame(this.lastFrame, this.blips(), this.routeLine());
    for (const s of this.sessions) s.followIfDirty();
  }

  // ---- the full map ---------------------------------------------------------------------------------------------------------------

  /** Loads the vector data of the full map (once); resolves null when the world has no map files. */
  loadData(): Promise<MapData | null> {
    this.dataLoading ??= (async () => {
      const bytes = async (which: 'map' | 'bldg'): Promise<ArrayBuffer | null> => ((await this.o.assets.job('world.map.bytes', { which, tier: this.o.tier })) as { bytes: ArrayBuffer | null }).bytes;
      const m = await bytes('map');
      this.data = m ? MapData.decode(m) : null;
      void bytes('bldg').then((b) => {
        this.bldg = b ? MapBuildings.decode(b) : null;
        for (const s of this.sessions) s.invalidate();
      }).catch(() => undefined);
      for (const s of this.sessions) s.invalidate();
      return this.data;
    })();
    return this.dataLoading;
  }

  /** Opens the full map on a canvas (the phone Map app). `onChange` is called when something arrives that needs a redraw. */
  openFullMap(canvas: HTMLCanvasElement, onChange: () => void): FullMapSession {
    void this.loadData();
    const s = new FullMapSessionImpl(this, canvas, this.palette, onChange);
    this.sessions.add(s);
    return s;
  }

  /** @internal */
  closeSession(s: FullMapSessionImpl): void {
    this.sessions.delete(s);
  }

  /** @internal */
  get tier(): QualityTierId {
    return this.o.tier;
  }

  /** @internal */
  get assets(): AssetsJobs {
    return this.o.assets;
  }

  /** @internal */
  get doc(): Document | null {
    return this.o.doc ?? null;
  }

  /** @internal */
  get mapData(): MapData | null {
    return this.data;
  }

  /** @internal */
  get bldgData(): MapBuildings | null {
    return this.bldg;
  }

  /** Searches addresses, streets, landmarks, points of interest and neighbourhoods (the geocoder runs in asset.worker). */
  async search(text: string, limit = 8): Promise<MapPlace[]> {
    const r = (await this.o.assets.job('world.map.geocode', { text, limit, tier: this.o.tier })) as { hits: GeocodeHit[] };
    return r.hits.map((h) => ({ label: h.label, x: h.x, z: h.z, kind: h.kind, cnn: h.cnn }));
  }

  /** QA: what the layer is doing. */
  qa(): { frames: number; canvas: boolean; grid: boolean; banners: number; lastBanner: AreaBannerPatch | null; inWorker: boolean; minimap: MinimapImpl['stats']; sessions: number } {
    return {
      frames: this.frames, canvas: this.canvas !== null, grid: this.grid !== null, banners: this.bannerCount, lastBanner: this.lastBanner,
      inWorker: this.raster.inWorker, minimap: this.minimap.stats, sessions: this.sessions.size,
    };
  }

  /** The district grid index at a point (QA, and the banner), or 255 before the grid arrived. */
  nhoodAt(x: number, z: number): number {
    return this.grid ? nhoodIndexAt(this.grid, x, z) : NHOOD_NONE;
  }

  get nhoodSlugs(): readonly string[] {
    return this.grid?.nhoods ?? [];
  }

  dispose(): void {
    this.disposed = true;
    this.minimap.dispose();
    for (const s of [...this.sessions]) s.dispose();
    this.sessions.clear();
  }
}

class FullMapSessionImpl implements FullMapSession {
  private readonly view: FullMapImpl;
  private vp = { cx: 0, cz: 0, mPerPx: 2, w: 320, h: 480 };
  private mask: LayerMask = LAYERS_ALL;
  private dirty = true;
  private disposed = false;
  private raf = 0;
  private maskForTiles: LayerMask = LAYERS_ALL;
  private marker: { x: number; z: number } | null = null;

  constructor(private readonly layer: MapLayer, private readonly canvas: HTMLCanvasElement, palette: MapPalette, private readonly onChange: () => void) {
    const raster = {
      get inWorker() {
        return layer.raster.inWorker;
      },
      raster: (level: 9 | 7, cx: number, cy: number): Promise<TileImage | null> => layer.raster.raster(level, cx, cy, this.mask),
    };
    this.view = new FullMapImpl({
      raster,
      data: () => layer.mapData,
      bldg: () => layer.bldgData,
      onDirty: () => this.invalidate(),
      make: layer.doc ? ((w, h) => {
        const cv = (layer.doc as Document).createElement('canvas');
        cv.width = w;
        cv.height = h;
        return cv;
      }) : null,
    });
    this.view.attach(canvas, palette);
    const p = layer.player;
    this.vp = { cx: p.x, cz: p.z, mPerPx: 2, w: canvas.width || 320, h: canvas.height || 480 };
  }

  setPalette(p: MapPalette): void {
    this.view.setPalette(p);
    this.view.invalidate();
    this.invalidate();
  }

  invalidate(): void {
    if (this.disposed || this.dirty) return;
    this.dirty = true;
    this.onChange();
  }

  /** Redraws when something changed (the host calls this each animation frame while the map is open). */
  followIfDirty(): void {
    if (this.dirty && !this.disposed) this.draw();
  }

  draw(): void {
    if (this.disposed) return;
    if (this.maskForTiles !== this.mask) {
      this.maskForTiles = this.mask;
      this.view.invalidate();
    }
    this.dirty = false;
    const p = this.layer.player;
    const blips = (this.layer.patch?.blips ?? []) as MapBlip[];
    const withMarker = this.marker
      ? [...blips, { id: 'candidate', kind: 'waypoint', shape: 'pin', colorToken: 'map.waypoint', x: this.marker.x, z: this.marker.z, priority: 101 } as MapBlip]
      : blips;
    this.view.draw(this.vp, p, withMarker, routeOf(this.layer.patch), this.mask);
  }

  setMarker(p: { x: number; z: number } | null): void {
    this.marker = p ? { x: p.x, z: p.z } : null;
    this.draw();
  }

  resize(w: number, h: number): void {
    this.vp.w = Math.max(1, Math.floor(w));
    this.vp.h = Math.max(1, Math.floor(h));
    if (this.canvas.width !== this.vp.w) this.canvas.width = this.vp.w;
    if (this.canvas.height !== this.vp.h) this.canvas.height = this.vp.h;
    this.dirty = false;
    this.draw();
  }

  panBy(dxPx: number, dyPx: number): void {
    this.vp.cx -= dxPx * this.vp.mPerPx;
    this.vp.cz -= dyPx * this.vp.mPerPx;
    this.draw();
  }

  zoomBy(factor: number, px = this.vp.w / 2, py = this.vp.h / 2): void {
    const before = this.pointAt(px, py);
    this.vp.mPerPx = clampZoom(this.vp.mPerPx * factor);
    // keep the point under the pointer where it was
    this.vp.cx = before.x - (px - this.vp.w / 2) * this.vp.mPerPx;
    this.vp.cz = before.z - (py - this.vp.h / 2) * this.vp.mPerPx;
    this.draw();
  }

  setZoom(mPerPx: number): void {
    this.vp.mPerPx = Math.min(FULLMAP_MAX_M_PER_PX, Math.max(FULLMAP_MIN_M_PER_PX, mPerPx));
    this.draw();
  }

  centreOn(x: number, z: number): void {
    this.vp.cx = x;
    this.vp.cz = z;
    this.draw();
  }

  centreOnPlayer(): void {
    const p = this.layer.player;
    this.centreOn(p.x, p.z);
  }

  setLayers(mask: LayerMask): void {
    this.mask = mask;
    this.draw();
  }

  state(): { cx: number; cz: number; mPerPx: number; layers: LayerMask; w: number; h: number } {
    return { ...this.vp, layers: this.mask };
  }

  pointAt(px: number, py: number): { x: number; z: number } {
    return { x: this.vp.cx + (px - this.vp.w / 2) * this.vp.mPerPx, z: this.vp.cz + (py - this.vp.h / 2) * this.vp.mPerPx };
  }

  pick(px: number, py: number): MapPick | null {
    return this.view.pick(px, py, this.vp);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf);
    this.view.dispose();
    this.layer.closeSession(this);
  }
}

function routeOf(p: MapPatchView | null): Float32Array | null {
  const r = p?.route as { points?: number[] } | null | undefined;
  return r?.points && r.points.length >= 4 ? Float32Array.from(r.points) : null;
}

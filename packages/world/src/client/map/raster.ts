/**
 * The map rasteriser (M02c2; 02-world-maps.md sections 1 and 2.1). `drawRegion` paints a rectangle of the world onto a Canvas 2D
 * context whose transform maps metres (ENU) to pixels: water, land, landuse and parks, a hillshade image, building footprints (z9
 * only), streets by class with casings (bridges above, tunnels dashed), one-way arrows and street names. The same function draws
 * the cached tiles of the minimap and the full map (in `asset.worker` on an `OffscreenCanvas`, or on the main thread), and the vector
 * redraw of the full map below 2 m/px. It reports its draw operations so the budget (25,000 per frame) can be checked.
 *
 * Colours are palette tokens (`MapPalette`) except the hillshade, which is black and white at low alpha.
 */
import { CHUNK_EDGE_M, GRID_MIN_M, MapPolyKind, type MapBuildings, type MapData, type MapLevel, type MapPoly, type MapStreetLine } from '@dv/shared';
import type { Ctx2D } from './blips.ts';
import { LAYER, type LayerMask, type MapPalette } from './views.ts';

export type CanvasFactory = (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement;

export interface RegionOptions {
  /** The street record level: 9 below 1 m/px, 7 from 1 to 3, 5 above. */
  level: MapLevel;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Pixels per metre of the current transform. */
  pxPerM: number;
  layers: LayerMask;
  palette: MapPalette;
  /** The hillshade image (`hillImage`); null draws none. */
  hill: CanvasImageSource | null;
  bldg: MapBuildings | null;
  /** Street names along the lines. */
  labels: boolean;
  /** One-way arrows (at 3 m/px and finer). */
  arrows?: boolean;
}

/** Base widths in pixels at 1 px/m by DataSF classcode: 1 freeway, 2 and 3 arterial, 4 collector, 5 local, 6 ramp, 0 service. */
const BASE_PX: Record<number, number> = { 0: 2, 1: 7, 2: 5.5, 3: 5.5, 4: 4.5, 5: 3.5, 6: 3.5 };
const ORDER = [0, 5, 4, 6, 3, 2, 1];

export function streetWidthPx(classcode: number, pxPerM: number): number {
  const base = BASE_PX[classcode] ?? 3;
  const k = Math.pow(Math.max(pxPerM, 0.05), 0.6);
  return Math.min(base * 3, Math.max(1, base * k));
}

const colourOfKind = (kind: number, p: MapPalette): { fill: string; alpha: number } | null => {
  switch (kind) {
    case MapPolyKind.Land: return { fill: p.land, alpha: 1 };
    case MapPolyKind.Water: return { fill: p.water, alpha: 1 };
    case MapPolyKind.Pier: return { fill: p.building, alpha: 1 };
    default: {
      const i = kind - MapPolyKind.LanduseBase;
      if (i === 3 || i === 4) return { fill: p.park, alpha: 1 };           // grass, park
      if (i === 5 || i === 6 || i === 7) return { fill: p.neutral, alpha: 0.1 }; // sand, plaza, rock
      if (i >= 0 && i <= 2) return { fill: p.building, alpha: 0.12 };      // residential, commercial, industrial tint
      return null;
    }
  }
};

function pathPoly(ctx: Ctx2D, p: MapPoly): void {
  ctx.beginPath();
  for (const ring of p.rings) {
    const n = ring.length >> 1;
    if (n < 3) continue;
    ctx.moveTo((ring[0] as number) * 0.5, (ring[1] as number) * 0.5);
    for (let i = 1; i < n; i++) ctx.lineTo((ring[i * 2] as number) * 0.5, (ring[i * 2 + 1] as number) * 0.5);
    ctx.closePath();
  }
}

/** The hillshade of a map as a one-pixel-per-cell image (white highlights and black shadows at low alpha), cached per data object. */
const hillCache = new WeakMap<MapData, CanvasImageSource | null>();
export function hillImage(data: MapData, make: CanvasFactory | null): CanvasImageSource | null {
  const cached = hillCache.get(data);
  if (cached !== undefined) return cached;
  let out: CanvasImageSource | null = null;
  const h = data.hill;
  if (h && make) {
    try {
      const cv = make(h.cols, h.rows);
      const ctx = cv.getContext('2d') as Ctx2D | null;
      if (ctx) {
        const img = ctx.createImageData(h.cols, h.rows);
        for (let i = 0; i < h.cells.length; i++) {
          const d = ((h.cells[i] as number) - 128) / 127;
          const o = i * 4;
          if (d > 0.01) {
            img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
            img.data[o + 3] = Math.min(255, Math.round(d * 90));
          } else if (d < -0.01) {
            img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
            img.data[o + 3] = Math.min(255, Math.round(-d * 130));
          }
        }
        ctx.putImageData(img, 0, 0);
        out = cv as CanvasImageSource;
      }
    } catch {
      out = null;
    }
  }
  hillCache.set(data, out);
  return out;
}

function overlaps(level: MapLevel, cx: number, cy: number, o: RegionOptions): boolean {
  const e = CHUNK_EDGE_M[level];
  const x0 = GRID_MIN_M + cx * e, z0 = GRID_MIN_M + cy * e;
  return x0 < o.maxX && x0 + e > o.minX && z0 < o.maxZ && z0 + e > o.minZ;
}

/** Draws the region; returns the number of draw operations (fills, strokes, images and texts). */
export function drawRegion(ctx: Ctx2D, data: MapData, o: RegionOptions): number {
  let ops = 0;
  const p = o.palette;
  const wantWater = (o.layers & LAYER.water) !== 0, wantParks = (o.layers & LAYER.parks) !== 0;

  // 1-4: water, land, landuse, parks (file order)
  for (const poly of data.polysIn(o.level, o.minX, o.minZ, o.maxX, o.maxZ)) {
    const isWater = poly.kind === MapPolyKind.Water || poly.kind === MapPolyKind.Pier;
    if (isWater && !wantWater && poly.kind === MapPolyKind.Water) continue;
    const c = colourOfKind(poly.kind, p);
    if (!c) continue;
    const park = poly.kind === MapPolyKind.LanduseBase + 3 || poly.kind === MapPolyKind.LanduseBase + 4;
    if (park && !wantParks) continue;
    if (poly.kind === MapPolyKind.Water && !wantWater) continue;
    ctx.globalAlpha = c.alpha;
    ctx.fillStyle = c.fill;
    pathPoly(ctx, poly);
    ctx.fill('evenodd');
    ops++;
  }
  ctx.globalAlpha = 1;

  // hillshade
  const hs = data.hill;
  if ((o.layers & LAYER.hillshade) !== 0 && o.hill && hs) {
    const sx = Math.max(0, Math.floor((o.minX - hs.minX) / hs.cellM)), sz = Math.max(0, Math.floor((o.minZ - hs.minZ) / hs.cellM));
    const ex = Math.min(hs.cols, Math.ceil((o.maxX - hs.minX) / hs.cellM)), ez = Math.min(hs.rows, Math.ceil((o.maxZ - hs.minZ) / hs.cellM));
    if (ex > sx && ez > sz) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(o.hill, sx, sz, ex - sx, ez - sz, hs.minX + sx * hs.cellM, hs.minZ + sz * hs.cellM, (ex - sx) * hs.cellM, (ez - sz) * hs.cellM);
      ops++;
    }
  }

  // 5: footprints (z9 only, finer than 1.5 m/px)
  if ((o.layers & LAYER.buildings) !== 0 && o.bldg && o.level === 9 && o.pxPerM >= 1 / 1.5) {
    ctx.fillStyle = p.building;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    for (const c of o.bldg.chunks()) {
      if (!overlaps(9, c.cx, c.cy, o)) continue;
      const ox = GRID_MIN_M + c.cx * CHUNK_EDGE_M[9], oz = GRID_MIN_M + c.cy * CHUNK_EDGE_M[9];
      for (const f of o.bldg.footprints(c.cx, c.cy)) {
        const n = f.pts.length >> 1;
        if (n < 3) continue;
        ctx.moveTo(ox + (f.pts[0] as number) * 0.5, oz + (f.pts[1] as number) * 0.5);
        for (let i = 1; i < n; i++) ctx.lineTo(ox + (f.pts[i * 2] as number) * 0.5, oz + (f.pts[i * 2 + 1] as number) * 0.5);
        ctx.closePath();
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ops++;
  }

  // 6: streets by class
  if ((o.layers & LAYER.streets) !== 0) {
    const lines: { line: MapStreetLine; ox: number; oz: number }[] = [];
    const e = CHUNK_EDGE_M[o.level];
    const cx0 = Math.max(0, Math.floor((o.minX - GRID_MIN_M) / e)), cx1 = Math.floor((o.maxX - GRID_MIN_M) / e);
    const cy0 = Math.max(0, Math.floor((o.minZ - GRID_MIN_M) / e)), cy1 = Math.floor((o.maxZ - GRID_MIN_M) / e);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!data.hasChunk(o.level, cx, cy)) continue;
        const ox = GRID_MIN_M + cx * e, oz = GRID_MIN_M + cy * e;
        for (const line of data.streets(o.level, cx, cy)) lines.push({ line, ox, oz });
      }
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const pathOf = (sel: (l: MapStreetLine) => boolean, cc: number): boolean => {
      ctx.beginPath();
      let any = false;
      for (const { line, ox, oz } of lines) {
        if (line.classcode !== cc || !sel(line)) continue;
        const n = line.pts.length >> 1;
        ctx.moveTo(ox + (line.pts[0] as number) * 0.5, oz + (line.pts[1] as number) * 0.5);
        for (let i = 1; i < n; i++) ctx.lineTo(ox + (line.pts[i * 2] as number) * 0.5, oz + (line.pts[i * 2 + 1] as number) * 0.5);
        any = true;
      }
      return any;
    };
    const pass = (sel: (l: MapStreetLine) => boolean, dash: boolean, casing: boolean): void => {
      for (const cc of ORDER) {
        const w = streetWidthPx(cc, o.pxPerM) / o.pxPerM;
        if (!pathOf(sel, cc)) continue;
        ctx.setLineDash(dash ? [w * 2.2, w * 1.6] : []);
        if (casing) {
          ctx.strokeStyle = p.land;
          ctx.lineWidth = w + 1.6 / o.pxPerM;
          ctx.stroke();
          ops++;
          pathOf(sel, cc);
        }
        ctx.strokeStyle = cc === 1 || cc === 6 ? p.freeway : p.street;
        ctx.lineWidth = w;
        ctx.stroke();
        ops++;
      }
      ctx.setLineDash([]);
    };
    pass((l) => !l.bridge && !l.tunnel, false, true);
    pass((l) => l.tunnel, true, false);
    pass((l) => l.bridge, false, true);

    // 7: one-way arrows
    if (o.arrows !== false && o.pxPerM >= 1 / 3 && o.level === 9) {
      ctx.fillStyle = p.label;
      ctx.beginPath();
      let any = false;
      const s = 3 / o.pxPerM;
      for (const { line, ox, oz } of lines) {
        if (line.oneway === 0) continue;
        const n = line.pts.length >> 1;
        // total length, then an arrow at every 60 px along the line
        let total = 0;
        for (let i = 1; i < n; i++) total += Math.hypot((line.pts[i * 2] as number) - (line.pts[i * 2 - 2] as number), (line.pts[i * 2 + 1] as number) - (line.pts[i * 2 - 1] as number)) * 0.5;
        if (total * o.pxPerM < 24) continue;
        const every = 60 / o.pxPerM;
        let next = Math.min(every / 2, total / 2);
        let acc = 0;
        for (let i = 1; i < n && next <= total; i++) {
          const x0 = ox + (line.pts[i * 2 - 2] as number) * 0.5, z0 = oz + (line.pts[i * 2 - 1] as number) * 0.5;
          const x1 = ox + (line.pts[i * 2] as number) * 0.5, z1 = oz + (line.pts[i * 2 + 1] as number) * 0.5;
          const len = Math.hypot(x1 - x0, z1 - z0);
          while (next <= acc + len) {
            const t = (next - acc) / (len || 1);
            const ax = x0 + (x1 - x0) * t, az = z0 + (z1 - z0) * t;
            const dir = line.oneway === 1 ? 1 : -1;
            const ux = ((x1 - x0) / (len || 1)) * dir, uz = ((z1 - z0) / (len || 1)) * dir;
            ctx.moveTo(ax + ux * s, az + uz * s);
            ctx.lineTo(ax - ux * s * 0.7 - uz * s * 0.8, az - uz * s * 0.7 + ux * s * 0.8);
            ctx.lineTo(ax - ux * s * 0.7 + uz * s * 0.8, az - uz * s * 0.7 - ux * s * 0.8);
            ctx.closePath();
            any = true;
            next += every;
          }
          acc += len;
        }
      }
      if (any) {
        ctx.fill();
        ops++;
      }
    }

    // street names along the longest line of each name per chunk
    if (o.labels && (o.layers & LAYER.labels) !== 0 && o.level === 9 && o.pxPerM >= 0.5) {
      const px = 10 / o.pxPerM;
      ctx.font = `600 ${px}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 / o.pxPerM;
      ctx.lineJoin = 'round';
      const best = new Map<string, { line: MapStreetLine; ox: number; oz: number; len: number }>();
      for (const L of lines) {
        const n = L.line.pts.length >> 1;
        if (n < 2) continue;
        let len = 0;
        for (let i = 1; i < n; i++) len += Math.hypot((L.line.pts[i * 2] as number) - (L.line.pts[i * 2 - 2] as number), (L.line.pts[i * 2 + 1] as number) - (L.line.pts[i * 2 - 1] as number)) * 0.5;
        const key = `${L.line.nameId}:${L.ox}:${L.oz}`;
        const cur = best.get(key);
        if (!cur || len > cur.len) best.set(key, { ...L, len });
      }
      for (const b of best.values()) {
        const name = data.strings[b.line.nameId];
        if (!name || b.len * o.pxPerM < name.length * 6 + 12) continue;
        // the middle vertex pair
        const n = b.line.pts.length >> 1;
        const i = Math.max(1, n >> 1);
        const x0 = b.ox + (b.line.pts[i * 2 - 2] as number) * 0.5, z0 = b.oz + (b.line.pts[i * 2 - 1] as number) * 0.5;
        const x1 = b.ox + (b.line.pts[i * 2] as number) * 0.5, z1 = b.oz + (b.line.pts[i * 2 + 1] as number) * 0.5;
        let ang = Math.atan2(z1 - z0, x1 - x0);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate((x0 + x1) / 2, (z0 + z1) / 2);
        ctx.rotate(ang);
        ctx.strokeStyle = p.land;
        ctx.strokeText(name, 0, 0);
        ctx.fillStyle = p.label;
        ctx.fillText(name, 0, 0);
        ctx.restore();
        ops += 2;
      }
    }
  }
  return ops;
}

/** Neighbourhood outlines (layer 9), a thin dashed line in the label colour. */
export function drawHoodOutlines(ctx: Ctx2D, data: MapData, o: Pick<RegionOptions, 'minX' | 'minZ' | 'maxX' | 'maxZ' | 'pxPerM' | 'palette'>): number {
  let ops = 0;
  ctx.strokeStyle = o.palette.label;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1 / o.pxPerM;
  ctx.setLineDash([6 / o.pxPerM, 4 / o.pxPerM]);
  for (const h of data.hoods) {
    ctx.beginPath();
    for (const rings of h.polys) {
      const outer = rings[0];
      if (!outer) continue;
      const n = outer.length >> 1;
      ctx.moveTo((outer[0] as number) * 0.5, (outer[1] as number) * 0.5);
      for (let i = 1; i < n; i++) ctx.lineTo((outer[i * 2] as number) * 0.5, (outer[i * 2 + 1] as number) * 0.5);
      ctx.closePath();
    }
    ctx.stroke();
    ops++;
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  return ops;
}

export const TILE_PX = 256;

/**
 * Rasterises one chunk tile (256 x 256 px) of `level` (9: 256 m at 1 px/m, 7: 1024 m at 4 m/px) onto a fresh canvas and returns it.
 * The caller turns it into an `ImageBitmap` when it runs in a worker.
 */
export function rasterTile(
  make: CanvasFactory, data: MapData, bldg: MapBuildings | null, level: 9 | 7, cx: number, cy: number, palette: MapPalette, layers: LayerMask,
): OffscreenCanvas | HTMLCanvasElement | null {
  if (!data.hasChunk(level, cx, cy) && data.polys.length === 0) return null;
  const edge = CHUNK_EDGE_M[level];
  const minX = GRID_MIN_M + cx * edge, minZ = GRID_MIN_M + cy * edge;
  const cv = make(TILE_PX, TILE_PX);
  const ctx = cv.getContext('2d') as Ctx2D | null;
  if (!ctx) return null;
  const k = TILE_PX / edge;
  ctx.fillStyle = (layers & LAYER.water) !== 0 ? palette.water : palette.land;
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-minX, -minZ);
  // a few metres of margin so strokes and polygons reach the tile edge
  const m = 4 / k;
  drawRegion(ctx, data, {
    level, minX: minX - m, minZ: minZ - m, maxX: minX + edge + m, maxZ: minZ + edge + m, pxPerM: k, layers, palette, hill: hillImage(data, make), bldg, labels: level === 9, arrows: true,
  });
  ctx.restore();
  return cv;
}


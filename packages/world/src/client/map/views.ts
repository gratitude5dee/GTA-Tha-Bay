/**
 * The map view types (M02c2; 02-world-maps.md section 2, verbatim) and the palette helper. The views are drawn by S02, hosted by S10 (HUD
 * slot `bl`, the phone Map app, later the XR wrist panel). Nothing here touches `three`: the maps are Canvas 2D.
 */
import type { MapBlip } from '@dv/shared';
import palettesJson from '../../../../../config/ui/palettes.json';

export type MapMode = 'foot' | 'vehicle' | 'race';
export interface MapFrame { x: number; z: number; yaw: number; speedMps: number; mode: MapMode; heat: number; tick: number }
export type PaletteToken = 'friendly' | 'danger' | 'warning' | 'objective' | 'neutral' | 'water' | 'land' | 'park' | 'building' | 'street' | 'freeway' | 'label';
export type MapPalette = Readonly<Record<PaletteToken, string>>;           // CSS colours from config/ui/palettes.json (S10), colour-blind variants included
export interface MinimapOptions { sizePx: number; shape: 'circle' | 'square'; northUp: boolean; refreshHz: 30 | 20 | 10; palette: MapPalette }
export interface MinimapView {
  attach(canvas: HTMLCanvasElement | OffscreenCanvas, o: MinimapOptions): void;
  frame(f: MapFrame, blips: readonly MapBlip[], route: Float32Array | null): void;   // x,z pairs
  dispose(): void;
  readonly stats: { drawMs: number; tileMisses: number; tilesResident: number };
}
export interface Viewport { cx: number; cz: number; mPerPx: number /* 0.25..8 */; w: number; h: number }
export type LayerMask = number;                                                       // bit per layer in the legend
export interface MapPick { kind: 'blip' | 'landmark' | 'poi' | 'nhood' | 'ground'; id: string | null; x: number; z: number }
export interface FullMapView {
  attach(canvas: HTMLCanvasElement | OffscreenCanvas, palette: MapPalette): void;
  draw(v: Viewport, f: MapFrame, blips: readonly MapBlip[], route: Float32Array | null, layers: LayerMask): void;
  pick(px: number, py: number, v: Viewport): MapPick | null;
  dispose(): void;
}

/** Layer bits of the legend (`LayerMask`). */
export const LAYER = {
  water: 1,
  parks: 2,
  buildings: 4,
  streets: 8,
  transit: 16,
  hillshade: 32,
  labels: 64,
} as const;
export const LAYERS_ALL: LayerMask = LAYER.water | LAYER.parks | LAYER.buildings | LAYER.streets | LAYER.transit | LAYER.hillshade | LAYER.labels;
/** Legend order and the localization keys the S10 legend renders. */
export const LAYER_LEGEND: readonly { id: keyof typeof LAYER; bit: number }[] = [
  { id: 'water', bit: LAYER.water }, { id: 'parks', bit: LAYER.parks }, { id: 'buildings', bit: LAYER.buildings }, { id: 'streets', bit: LAYER.streets },
  { id: 'transit', bit: LAYER.transit }, { id: 'hillshade', bit: LAYER.hillshade }, { id: 'labels', bit: LAYER.labels },
];

export type PaletteName = 'default' | 'deutan' | 'protan' | 'tritan';
const SEMANTIC = ['friendly', 'danger', 'warning', 'objective', 'neutral'] as const;
interface PalettesFile { palettes: Record<PaletteName, Record<(typeof SEMANTIC)[number], string>>; mapSurfaces: Record<Exclude<PaletteToken, (typeof SEMANTIC)[number]>, string> }
const FILE = palettesJson as unknown as PalettesFile;

/** The map palette of one HUD palette: its five semantic tokens plus the surface colours of `mapSurfaces`. */
export function mapPaletteOf(name: PaletteName = 'default'): MapPalette {
  const p = FILE.palettes[name] ?? FILE.palettes.default;
  return Object.freeze({ ...FILE.mapSurfaces, ...p }) as MapPalette;
}
export const PALETTE_NAMES: readonly PaletteName[] = ['default', 'deutan', 'protan', 'tritan'];

/** Minimap radius in metres by mode and speed (02-world-maps.md section 2.3): 150 on foot, `clamp(250 + 3 v, 250, 450)` driving, 600 racing. */
export function minimapRadiusM(mode: MapMode, speedMps: number): number {
  if (mode === 'foot') return 150;
  if (mode === 'race') return 600;
  const r = 250 + 3 * (Number.isFinite(speedMps) ? speedMps : 0);
  return r < 250 ? 250 : r > 450 ? 450 : r;
}

/** Hex colour to `r, g, b` for blending in the tile raster. */
export function rgbOf(css: string): [number, number, number] {
  const h = css.replace('#', '');
  return [Number.parseInt(h.slice(0, 2), 16) || 0, Number.parseInt(h.slice(2, 4), 16) || 0, Number.parseInt(h.slice(4, 6), 16) || 0];
}

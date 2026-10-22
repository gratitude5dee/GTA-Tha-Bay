/**
 * The seam between the phone Map app and the world's full map (M02c2). The UI package never imports `@dv/world`; the app builds a
 * `MapPort` from the world view and hands it to the shell as `ShellProps.map`. The shapes follow `FullMapSession` and `MapLayer` of
 * `packages/world/src/client/map/layer.ts` (structural typing; a world-side change that breaks them fails the app typecheck).
 */

/** Layer bits of the legend (the same numbers as `LAYER` of the world package). */
export const MAP_LAYER_BITS = { water: 1, parks: 2, buildings: 4, streets: 8, transit: 16, hillshade: 32, labels: 64 } as const;
export type MapLayerId = keyof typeof MAP_LAYER_BITS;
export const MAP_LAYERS_ALL = 127;

export interface MapPlaceHit {
  label: string;
  x: number;
  z: number;
  kind: string;
  cnn: number;
}

export interface MapPickHit {
  kind: 'blip' | 'landmark' | 'poi' | 'nhood' | 'ground';
  id: string | null;
  x: number;
  z: number;
}

export interface MapSessionPort {
  draw(): void;
  resize(w: number, h: number): void;
  panBy(dxPx: number, dyPx: number): void;
  /** > 1 zooms out, < 1 in; keeps the point under (px, py) fixed. */
  zoomBy(factor: number, px?: number, py?: number): void;
  setZoom(mPerPx: number): void;
  centreOn(x: number, z: number): void;
  centreOnPlayer(): void;
  setLayers(mask: number): void;
  state(): { cx: number; cz: number; mPerPx: number; layers: number; w: number; h: number };
  pick(px: number, py: number): MapPickHit | null;
  pointAt(px: number, py: number): { x: number; z: number };
  /** The candidate marker (a pin) drawn until it is replaced or cleared. */
  setMarker(p: { x: number; z: number } | null): void;
  dispose(): void;
}

export interface MapPort {
  /** Opens the full map on a canvas; `onChange` is called when something arrives that needs a redraw. */
  open(canvas: HTMLCanvasElement, onChange: () => void): MapSessionPort;
  search(text: string, limit: number): Promise<MapPlaceHit[]>;
  /** The minimap's north-up switch (the HUD slot toggles it). */
  northUp(): boolean;
  setNorthUp(on: boolean): void;
}

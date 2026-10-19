/** GeoJSON geometry to flat ENU rings (C08 frame), plus the OSM GeoJSON-lines reader. */
import { existsSync, readFileSync } from 'node:fs';
import { enuFromLatLng } from '../../../../packages/shared/src/index.ts';

export type Pos = [number, number];
export interface Geometry { type: string; coordinates: unknown }
export interface PolyEnu { outer: number[]; holes: number[][] }

export function ringToEnu(coords: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  for (const c of coords) {
    const p = enuFromLatLng(c[1] as number, c[0] as number);
    out.push(p.x, p.z);
  }
  return out;
}

export function polygonsOf(g: Geometry | null | undefined): PolyEnu[] {
  if (!g || !g.coordinates) return [];
  const toPoly = (rings: unknown): PolyEnu | null => {
    if (!Array.isArray(rings) || rings.length === 0) return null;
    return { outer: ringToEnu(rings[0] as number[][]), holes: (rings.slice(1) as number[][][]).map(ringToEnu) };
  };
  if (g.type === 'Polygon') {
    const p = toPoly(g.coordinates);
    return p ? [p] : [];
  }
  if (g.type === 'MultiPolygon') {
    const out: PolyEnu[] = [];
    for (const poly of g.coordinates as unknown[]) {
      const p = toPoly(poly);
      if (p) out.push(p);
    }
    return out;
  }
  return [];
}

export function linesOf(g: Geometry | null | undefined): number[][] {
  if (!g || !g.coordinates) return [];
  if (g.type === 'LineString') return [ringToEnu(g.coordinates as number[][])];
  if (g.type === 'MultiLineString') return (g.coordinates as number[][][]).map(ringToEnu);
  return [];
}

export interface OsmFeature { id: string; tags: Record<string, string>; geometry: Geometry }

/** Reads `osm.geojsonl` (one GeoJSON Feature per line; the osmium export route or a hand-supplied file). */
export function readOsm(file: string): OsmFeature[] {
  if (!existsSync(file)) return [];
  const out: OsmFeature[] = [];
  let anon = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.replace(/^\u001e/, '').trim();
    if (t.length === 0) continue;
    const f = JSON.parse(t) as { id?: string | number; properties?: Record<string, unknown>; geometry?: Geometry | null };
    if (!f.geometry) continue;
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.properties ?? {})) if (!k.startsWith('@') && v !== null && v !== undefined) tags[k] = String(v);
    const props = f.properties ?? {};
    const rawId = f.id ?? (props['@id'] !== undefined ? `${String(props['@type'] ?? 'x')[0] ?? 'x'}${String(props['@id'])}` : `x${anon++}`);
    out.push({ id: String(rawId), tags, geometry: f.geometry });
  }
  return out;
}

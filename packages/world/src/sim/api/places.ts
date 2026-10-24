/**
 * `PlaceIndex` (M02c1; C08 section 3): the landmarks and points of interest of the world index, with the searches the map, the
 * mission compiler and the NPC brains ask.
 *
 *  - `poisNear`: the POIs inside a radius, nearest first, ties by id;
 *  - `pedRoute`: the commute polyline between two POIs along the road topology, at most 64 points;
 *  - `findPlace`: a prefix and token match over landmark and POI labels; with a geocoder installed (`setGeocoder`, M02c2) also addresses,
 *    streets and neighbourhoods from `sf-geocode.v1`, loaded on the first search.
 *
 * Labels. The index carries name keys (`place.coit-tower`), not text, and the sim has no catalogue, so a label is the injected
 * `labels(key)` when it answers and otherwise the last segment of the key in title case ("Coit Tower"). Pure; C02 lint applies.
 */
import type { LandmarkId, LandmarkRecord, PlaceIndex, PoiId, PoiRecord, WorldIndex } from '@dv/shared';
import type { RoadGraph } from '../graph/query.ts';
import type { Geocoder } from '../map/geocoder.ts';

export const PED_ROUTE_MAX_POINTS = 64;
/** How far a POI looks for a road when a commute is planned, metres. */
export const PED_ROUTE_SNAP_M = 150;
/** Route budget of a commute (states taken from the heap). */
export const PED_ROUTE_EXPAND = 60_000;

export type LabelFn = (nameKey: string) => string | undefined;

/** "place.coit-tower" and "poi.mission.dolores-cafe" give "Coit Tower" and "Dolores Cafe". */
export function labelFromKey(key: string): string {
  const last = key.slice(key.lastIndexOf('.') + 1);
  return last
    .split('-')
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const tokensOf = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);

interface Entry {
  label: string;
  lower: string;
  tokens: string[];
  x: number;
  z: number;
  kind: string;
  landmark: boolean;
  id: string;
}

export class PlaceIndexImpl implements PlaceIndex {
  private readonly lms: readonly LandmarkRecord[];
  private readonly lmById = new Map<string, LandmarkRecord>();
  private readonly poiById = new Map<string, PoiRecord>();
  private entries: Entry[] | null = null;
  private geocoderLoader: (() => Promise<Geocoder | null>) | null = null;
  private geocoder: Promise<Geocoder | null> | null = null;

  constructor(
    index: Pick<WorldIndex, 'landmarks' | 'pois'>,
    private readonly graph: RoadGraph | null = null,
    private readonly labels: LabelFn = () => undefined,
  ) {
    this.lms = index.landmarks;
    for (const l of index.landmarks) this.lmById.set(l.id, l);
    for (const p of index.pois) this.poiById.set(p.id, p);
  }

  landmarks(): readonly LandmarkRecord[] {
    return this.lms;
  }

  landmark(id: LandmarkId): LandmarkRecord | null {
    return this.lmById.get(id) ?? null;
  }

  poi(id: PoiId): PoiRecord | null {
    return this.poiById.get(id) ?? null;
  }

  poisNear(x: number, z: number, radiusM: number, kind?: PoiRecord['kind']): readonly PoiRecord[] {
    const r2 = radiusM * radiusM;
    const hits: { p: PoiRecord; d2: number }[] = [];
    for (const p of this.poiById.values()) {
      if (kind !== undefined && p.kind !== kind) continue;
      const dx = p.x - x, dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2) hits.push({ p, d2 });
    }
    hits.sort((a, b) => a.d2 - b.d2 || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0));
    return hits.map((h) => h.p);
  }

  poiPos(id: PoiId): [number, number, number] | null {
    const p = this.poiById.get(id);
    return p ? [p.x, p.y, p.z] : null;
  }

  /**
   * The commute between two POIs: their positions with the road nodes of the shortest drivable route between, thinned to at most
   * 64 points (the ends always kept). Without a graph, or when no road joins them, the straight line.
   */
  pedRoute(a: PoiId, b: PoiId): [number, number, number][] {
    const pa = this.poiPos(a), pb = this.poiPos(b);
    if (!pa || !pb) return [];
    const pts: [number, number, number][] = [pa];
    const g = this.graph;
    if (g) {
      const route = g.route({ from: { x: pa[0], z: pa[2] }, to: { x: pb[0], z: pb[2] }, maxExpand: PED_ROUTE_EXPAND, useTopology: true });
      if (route && route.edges.length > 0) {
        const net = g.net;
        pts.push([net.nodeX(net.from(route.edges[0] as number)), net.nodeY(net.from(route.edges[0] as number)), net.nodeZ(net.from(route.edges[0] as number))]);
        for (const e of route.edges) {
          const n = net.to(e);
          pts.push([net.nodeX(n), net.nodeY(n), net.nodeZ(n)]);
        }
      }
    }
    pts.push(pb);
    return thin(pts, PED_ROUTE_MAX_POINTS);
  }

  private build(): Entry[] {
    if (this.entries) return this.entries;
    const out: Entry[] = [];
    const add = (key: string, id: string, x: number, z: number, kind: string, landmark: boolean): void => {
      const label = this.labels(key) ?? labelFromKey(key);
      out.push({ label, lower: label.toLowerCase(), tokens: tokensOf(label), x, z, kind, landmark, id });
    };
    for (const l of this.lms) add(l.nameKey, l.id, l.x, l.z, 'landmark', true);
    const pois = [...this.poiById.values()].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    for (const p of pois) if (p.landmark === null) add(p.nameKey, p.id, p.x, p.z, p.kind, false);
    this.entries = out;
    return out;
  }

  /** Installs the lazy geocoder (M02c2): `load` runs on the first search that needs it and resolves to null when there is no `sf-geocode.v1`. */
  setGeocoder(load: (() => Promise<Geocoder | null>) | null): void {
    this.geocoderLoader = load;
    this.geocoder = null;
  }

  findPlace(text: string, limit: number): Promise<readonly { label: string; x: number; z: number; kind: string }[]> {
    const own = this.findOwn(text, limit);
    if (!this.geocoderLoader || !(limit > 0)) return Promise.resolve(own);
    this.geocoder ??= this.geocoderLoader().catch(() => null);
    return this.geocoder.then((g) => {
      if (!g) return own;
      const n = Math.floor(limit);
      const addr = g.address(text, n).map((h) => ({ label: h.label, x: h.x, z: h.z, kind: h.kind }));
      const hoods = g.names(text, n).filter((h) => h.kind === 'nhood').map((h) => ({ label: h.label, x: h.x, z: h.z, kind: h.kind }));
      const streets = g.streets(text, n).map((h) => ({ label: h.label, x: h.x, z: h.z, kind: h.kind }));
      const merged = /^\s*\d/.test(text) ? [...addr, ...own, ...hoods, ...streets] : [...own, ...hoods, ...streets, ...addr];
      return merged.slice(0, n);
    });
  }

  private findOwn(text: string, limit: number): { label: string; x: number; z: number; kind: string }[] {
    const q = text.toLowerCase().trim();
    const qt = tokensOf(q);
    if (qt.length === 0 || !(limit > 0)) return [];
    const scored: { e: Entry; score: number }[] = [];
    for (const e of this.build()) {
      let score = 0;
      if (e.lower === q) score = 100;
      else if (e.lower.startsWith(q)) score = 80;
      else if (qt.every((t) => e.tokens.some((et) => et.startsWith(t)))) score = 60;
      else continue;
      if (e.landmark) score += 5;
      scored.push({ e, score });
    }
    scored.sort((a, b) => b.score - a.score || (a.e.label < b.e.label ? -1 : a.e.label > b.e.label ? 1 : 0) || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
    return scored.slice(0, Math.floor(limit)).map(({ e }) => ({ label: e.label, x: e.x, z: e.z, kind: e.kind }));
  }
}

/** At most `max` points, always keeping the first and the last, evenly spaced by index. */
export function thin<T>(pts: readonly T[], max: number): T[] {
  if (pts.length <= max) return [...pts];
  const out: T[] = [];
  const last = pts.length - 1;
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * last) / (max - 1))] as T);
  return out;
}

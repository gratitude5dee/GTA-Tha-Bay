# 02 — World & Map, part 5: maps, boundaries and backdrop, teleports, attribution, expansion

> S02, Wave 2, 2026-10-18. Part of `spec/domains/02-world.md`. Requirements: R-MAP-03 (map, minimap, markers, fast travel), R-MAP-01 (bridges as boundaries and portals), R-MAP-02 (rest of the Bay as backdrop now, districts later). Decisions: D-25 (in-engine Canvas 2D from `sf-map.v1.bin`; MapLibre and PMTiles only on web surfaces; the Mapbox CLI is dev-only). S10 hosts the canvases (HUD slot `bl`, the phone map app, the XR wrist panel) and supplies layout, pan/pinch/zoom controls, search box, legend and the attribution UI; S02 draws.

## 1. Map data packs (bake S12)

All are C07 assets (`map_data` or `data`), identity-encoded, in the boot set after the first chunk.

| Asset | Content | Size gate |
|---|---|---|
| `map_data/sf-map.v1` (`sf-map.v1.bin`) | header (`DVMP`, version, `bakeId`, grid), string table (≈ 2,567 active street names [research/auth-ugc-input-maps.md §5.2]; a size reference, never a gate, DL-675), 41 neighbourhood polygons (DP 5 m), labels, hillshade (32 m cells, `u8`), chunk index, records per chunk and level | ≤ 4 MiB (fail); estimate 2.5–3.5 MiB, only the road layer was measured (794 KB gzip, 1.67 MB raw [research/auth-ugc-input-maps.md §5.3]) |
| `map_data/sf-map-bldg.v1` | simplified footprints (DP 1.5 m, area ≥ 40 m², tall buildings flagged by height class) | ≤ 4 MiB, loaded lazily, drawn at ≤ 1.5 m/px |
| `map_data/sf-geocode.v1` | 224,290 base addresses `{streetId u16, number u16, suffix u8, x i16, z i16, chunk u16}` sorted by (street, number), street table, landmark, POI and neighbourhood name trie | estimate 2.2–3 MB, lazy |
| `map_data/sf-graph.v1` | drivable topology (nodes with position, edges with from/to/length/class/flags; no geometry) for GPS and long routes | ≈ 1 MB, always resident after boot |
| `data/district-grid.v1` | `u8` neighbourhood index per 64 m cell (255 = none) | ≈ 55 KB |
| `data/anchor-mask.v1` (private; file `anchor-mask.v1.bin`) | 8 m cells, 2-bit class (0 water or outside, 1 right-of-way, 2 park, 3 other land), RLE; residential-parcel flag added when the `acdm-wktn` land-use field is verified (S12 U12) | ≤ 400 KB |

**Layers and draw order** (extends [research/auth-ugc-input-maps.md §5.6]): (1) water, (2) land and parks, (3) landuse tint, (4) hillshade, (5) footprints, (6) streets by class (widths per class, bridges above, tunnels dashed), (7) one-way arrows (≤ 3 m/px), (8) rail, cable-car and Metro lines, (9) neighbourhood boundaries, (10) labels (neighbourhood tiers 1–3, street names along polylines, landmark pins), (11) dynamic blips. **Levels:** `z=9` records (256 m, 0.5 m `i16` quantization relative to the chunk NW corner), `z=7` records (classes ≤ 3, parks, water), `z=5` records (coast, freeways, major arterials, big parks); the view picks `z=9` below 1.0 m/px, `z=7` from 1.0 to 3.0, `z=5` above. Every street segment carries its `cnn`; GPS routes come from the drivable graph, not from the map. Hillshade is on by default (≈ 0.25 MB; Q-MAP-03), contours are not baked (the dataset `rnbg-2qxw` exposes no tabular fields on 2026-10-18, **new**).

## 2. Minimap

```ts
// packages/world/src/client/map/views.ts — drawn by S02, hosted by S10 (HUD slot `bl`, phone map app, XR wrist panel)
import type { MapBlip } from '@dv/shared/world/c08-api';
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
```

1. **Cache.** `MinimapView` rasterizes each 256 m chunk once per zoom level at 1 px/m into a tile (LRU ≤ 48 tiles, 256 × 256 RGBA, ≈ 12.6 MB). Rasterization runs in `asset.worker` on an `OffscreenCanvas` 2D context and returns `ImageBitmap`s (Safari 16.4+ per the research [research/auth-ugc-input-maps.md §5.5]); if unavailable it rasterizes on the main thread at most one chunk per frame. This follows the pre-baked-image minimap of gta-sa-earth [research/auth-ugc-input-maps.md §5.7].
2. **Frame.** Composite the ≤ 3 × 3 visible tiles rotated to the player heading (`ctx.rotate`), then draw ≤ 64 blips and the player arrow. Budgets: ≤ 0.6 ms (desktop tiers), ≤ 1.0 ms (iPhone tiers) at 30 Hz; 20 Hz on `mobile-low`; 10 Hz in XR [research/auth-ugc-input-maps.md §5.7; spec/domains/10-ui-hud-xr.md].
3. **Zoom.** Radius by mode and speed: on foot 150 m; driving `clamp(250 + 3 × speed, 250, 450)` m; racing 600 m. Heading-up by default with a north-up toggle (Q-MAP-01); XR is north-up only.
4. **Banner.** On a neighbourhood change (`nhoodAt`), emit the `AreaBanner` text key `nhood.<slug>`, at most once per 3 s.
5. **Out-of-range blips** (mission, waypoint, route end) clamp to the rim as arrows with the same shape code.
6. **No permanent attribution label** on the minimap; it is in the full map, the pause credits and the boot splash (§6).

## 3. Full map, markers, route, search

1. **View.** `FullMapView.draw` supports 0.25–8 m/px. Below 2 m/px it redraws vectors for the visible chunks (≤ 25,000 draw ops per frame; the sim is paused, so redraw only on input); at 2 m/px and above it composites cached tiles. Layer toggles live in the legend (water, parks, buildings, streets, transit, hillshade, labels).
2. **Blips** (`MapApi`): shape as well as colour, colour from the S10 palette tokens so every colour-blind palette works:

| Kind | Shape | Token | Source |
|---|---|---|---|
| mission | diamond | objective | S03 markers |
| waypoint | pin | objective | player |
| route | line with chevrons | objective | GPS |
| police | ring (search circle) | danger | PursuitApi |
| experience | hexagon | friendly | route 37, moderated only (C17) |
| property, shop | house, bag | neutral | S03, S10 |
| transit | square | neutral | stations, fast-travel nodes |
| landmark | star | neutral | landmark table |
| fast travel | ring with dot | friendly | unlocked nodes |
| player, friend | arrow, triangle | white, friendly | sim, rooms |

3. **GPS.** `MapApi.setRoute` plans with `RoadGraphQuery.route` (topology graph for long routes), recomputes when the player is > 25 m off the route and at most every 3 s, decimates to ≤ 400 points, draws a 4 px line with casing. No turn-by-turn voice in v1.
4. **Search.** `PlaceIndex.findPlace` searches addresses (offline EAS), landmarks, POIs and neighbourhoods; the geocoder is lazy-loaded; a result offers waypoint and (where allowed) fast travel. Mission and experience coordinates come from the same geocoder, never from the Mapbox CLI [research/auth-ugc-input-maps.md §5.5].
5. **Experiences.** S12's `ExperienceIndex` pushes pins (≤ 40 public per chunk, ≤ 64 drawn in view; clusters above 3 m/px); tapping one opens S10's marker card.
6. **"Coming later".** East Bay, Marin and the Peninsula draw as flat grey silhouettes from the `far-bay-massing` land mask with a "Coming later" label (R-MAP-02).

## 4. Boundaries, portals, backdrop

**4.1 Boundaries.** (a) *Water* is a soft wall: a vehicle in water deeper than 0.6 m at the wheels stalls after 1.5 s, then fades and respawns at the nearest road-adjacent `ShoreNode`; on foot S01 swims and respawns at the nearest shore node [01-engine.md §2.4]. (b) The *county line* (southern edge, Lake Merced, Daly City) is a soft wall: a traffic barrier prop, a fog ramp over the last 150 m (fog far plane scaled to 40 %) and the toast `world.boundary.countyLine` ("Leaving SF — coming soon") [research/gamedesign-decomposition.md §2.4]. (c) The *play bounds* in `world.bounds.json` plus 50 m are an invisible capsule wall for ground bodies; aircraft and cameras clamp at `maxY` 600 m. (d) *Below the world* is a safety net for any placement or collision gap (DL-734). A body that has been airborne for 120 ticks (2 s) while it is under `play.minY` (−80 m) or more than 3 m under the lowest resident surface at its (x, z) is put back. On foot it goes to the nearest walkable point within 60 m, else the top of the ground at its (x, z), else a target at y 150 m that the 701 probe settles once colliders arrive. A vehicle carrying the player, as driver or passenger, respawns with the player on the nearest drivable lane, using the teleport's own fade. If no lane takes it, the player is set down on foot and the on-foot rule applies; the car stays behind. An ambient vehicle with no player aboard under `play.minY` is despawned. A rescue runs through the ownership machine's move (states 700/701, the same placement as §5 step 4), not `TeleportApi.request`, because mode rules, heat or a cooldown must never block it. Each rescue emits `control.recover`. The net is off without a baked world, so gray-box scenes and their hashes do not change (DL-734).

**4.2 Portals.** Golden Gate (north) and Bay Bridge (east, at the Yerba Buena Island east mouth) are `Portal` entities (`portal.ggb`, `portal.baybridge`): the deck is drivable up to a toll/closure set piece, `state: 'closed'`. They open only in scripted finales (S03 sets `open`, a cutscene, then returns). At heat 5 the PursuitDirector seals them (`sealedPortals`) with roadblocks. The Ferry Building ferry is the portal to East Bay content. In M15+ a portal becomes a streaming handoff to its `toArea`.

**4.3 Backdrop (East Bay, Marin, Peninsula).** `far-bay-*` packs cover lat 37.30–37.99, lng −122.56…−121.83 (Atlas-style flat massing, about 3 MB for the region [research/repos-world.md P16]):
- `world_pack/far-bay-dem`: Terrarium z12 resampled to 256 m posts (513 × 513 `i16` ≈ 0.5 MB) plus the land mask; drawn as a ring mesh out to 80 km on desktop tiers and 20 / 10 km elsewhere.
- `world_pack/far-bay-massing`: buildings ≥ 15 m as boxes in 1 km cells (Int16 deltas) and arterials, one instanced draw; desktop tiers only.
- `texture/far-bay-cards`: ≤ 24 camera-facing cards (clusters: Oakland downtown, Oakland hills, Berkeley, Emeryville–Richmond, Alameda, Marin Headlands, Sausalito–Tiburon, Daly City ridge, Brisbane–SFO, Peninsula) baked by a software silhouette rasterizer from three azimuths (W, SW, NW) in `tools/map`; 2048 × 1024 KTX2. Skyline cards serve `xr-visionpro` and `mobile` to 20 km and `mobile-low` and `xr-quest` to 10 km; `desktop-ultra` and `desktop` use the ring plus massing out to 80 km [research/stack-rendering-platform.md, Performance budgets; 11-platform.md §4.5].
- The Bay Bridge east span beyond the Yerba Buena Island portal is an instanced truss prop along the OSM way in the far pack, visible and not drivable.
Total backdrop cost: ≤ 3 render objects (ring, massing, cards), ≤ 1 upload at boot.

## 5. Teleports and fast travel

`TeleportApi.request(kind, to)` is the single entry (sandbox menu, map, story fast travel, XR, respawn, QA). Kinds: `sandbox` (landmark list, waypoint, saved position, previous spot; sandbox mode only, never in missions or rooms; the sandbox menu's jumps and the phone map's `map.travel` both go through `request('sandbox', …)`, and `sandbox.teleport` no longer calls the ownership machine directly, M04e2), `fast-travel` (unlocked nodes: Bay Rail stations, cable-car stops, robotaxi, ferry; heat 0; story rules), `xr-comfort` (S11 arcs, snapping to `teleportNodes` within 3 m on stairs and ≥ 15 % slopes), `respawn`, `debug` (QA builds).

1. **Validate:** mode rules, heat, bounds (`out-of-bounds`), cooldown (30 s for fast travel), then resolve the target to ENU (landmarks use their `arrival` pose, which the bake guarantees is on ground ≥ 3 m from water and prisms).
2. **Pre-stream:** request the destination `p0` tile plus a one-tile ring as `needNow`; wait up to 8 s. On timeout return `not-loaded` and do not move the player (message key `world.teleport.notLoaded`; English value in our own words, M04e5).
3. **Fade out** (≤ 200 ms), `Control` state 700, then colliders wait (state 701).
4. **Place:** cast down from `y + 300 m` against the heightfield, slabs and hoods; reject water (`water`) and prisms (`blocked`) by searching the nearest valid `arrival`/walkable point within 40 m; a driver keeps the vehicle only when the target lies on a drivable edge.
5. **Fade in.** In rooms, a non-sandbox teleport waits for the server's `EV TeleportGrant` (reason `fast_travel`); sandbox teleport is disabled there.
Fast-travel fares are integer cents from `config/world/transit.json` (`bay-rail` 200 + 50 per stop, cable car 100, robotaxi 300 + 120 per km; design values) and go through `EconomyApi` with an idempotency key.

## 6. Attribution screen

`config/attribution.world.json` (generated) lists `{id, text, licence, licenceUrl, source, surfaces[]}`; S10 renders it.

| Id | Text | Licence | Surfaces |
|---|---|---|---|
| osm | © OpenStreetMap contributors | ODbL 1.0, https://www.openstreetmap.org/copyright | splash, full map, credits |
| datasf | City and County of San Francisco (building footprints, streets, neighbourhoods, parks, addresses, trees) | PDDL | full map, credits |
| sfmta | SFMTA (stops and routes, via DataSF) | PDDL | credits |
| terrain | Terrain Tiles (Mapzen); 3DEP data courtesy of the U.S. Geological Survey | public domain | credits |
| protomaps | Protomaps © OpenStreetMap | ODbL | web surfaces only |
| usgs-imagery | U.S. Geological Survey | public domain | only if `--imagery` is on |
| overture | © OpenStreetMap contributors, Overture Maps Foundation | ODbL | M15a onward |

Rules: (1) boot splash line for 3 s; (2) the full map shows the OSM and DataSF line in a corner and collapses it to an "(i)" after 5 s, still reachable; (3) pause › Credits lists every entry plus the ODbL notice: "World data derived from OpenStreetMap is available under the ODbL; bake tools and packs are published" with the repository link; (4) the minimap needs no label [research/auth-ugc-input-maps.md §5.7; OSMF game guideline]; (5) `provenance:check` verifies that every `ProvenanceRecord.attribution` string appears in `credits.json`; (6) XR shows the credits panel from the wrist menu.

## 7. Web surfaces

Forum, experience browser, Mod Studio anchor picker and share pages use MapLibre GL JS 6.15.x with a self-hosted `sf.pmtiles` (Protomaps v4, z0–14, ≈ 3.9 MB gzip for the SF bbox) and the OSM credit [research/auth-ugc-input-maps.md §5.3, §5.5]. `pnpm map:webtiles` extracts the SF bbox from a pinned Protomaps daily build into our archive (writer library UNVERIFIED; scheduled with M13b; owner S02 tool, run in S10/S12's milestone). Lint rule: `maplibre-gl` may not be imported by `packages/engine`, `packages/world` or `apps/web` game code, so no second WebGL context appears on iPhone; `mapbox-gl`, `@mapbox/mapbox-gl-*`, `3d-tiles-renderer` and `@googlemaps/*` may not be imported anywhere in `packages/*` or `apps/web` (M02c2, DL-676). Whether Workers static assets honour `Range` for `.pmtiles` is UNVERIFIED; the fallback fetches the whole archive.

## 8. Expansion plan (R-MAP-02, M15+)

The same grid, pipeline, packs and tags extend to new `AreaRecord`s. Rules: (1) `--area <id>` selects a bbox and a source recipe; (2) DataSF is replaced by OSM buildings with the Atlas height rules (`height`, then `building:levels × 3.3 + 1.2`, then type heuristics) unless M15a's spike shows Overture buildings are better (Overture is ODbL with credit "© OpenStreetMap contributors, Overture Maps Foundation"; its transportation layer's drivability is untested [research/repos-world.md §4, §8]); (3) `world.bounds.json` `play` becomes the union of unlocked areas (C11 validation reads the unlocked set from the room's world version); (4) areas unlock through C06 `UnlockDef.grants.districts`; (5) the backdrop for an area is replaced by its packs and its cards are dropped; (6) portals switch from `closed` to a handoff: the sim pre-warms the destination `p0` tiles while on the bridge, fades, then re-bases the physics origin; (7) Story Act 4+ content, races and fighter stages for each area are separate (S03, S06, S07); Act 1 and the v1 stages stay SF-only.

| Milestone | Area id and core | Approx. ENU of core | Portal | Source and notes | Sessions |
|---|---|---|---|---|---|
| M15a | multi-area framework: `AreaRecord`s, bounds v2, handoff, per-area density, OSM-only building recipe, Overture spike | — | — | no new geometry | 2 |
| M15b | `ea-oakland-core`: downtown, Jack London, West Oakland, Lake Merritt | x 10.5…16.7 km, z −5.6…−0.1 km | Bay Bridge east span | OSM; port cranes as landmarks | 2 |
| M15c | `ea-berkeley-richmond`: Berkeley, Emeryville, Richmond corridor | x 7.0…14.9, z −18.9…−7.8 | I-80 from Oakland | OSM; hills via Terrarium z15 | 1–2 |
| M15d | `marin-gateway`: Sausalito, Marin Headlands | x −8.9…−2.7, z −12.3…−4.5 | Golden Gate | OSM | 1 |
| M15e | `pen-north`: Daly City, South SF, SFO surroundings | x −7.1…6.1, z 7.7…19.9 | southern county line | OSM | 1–2 |
| M15f | `pen-vc-row`: San Mateo to Palo Alto/Menlo Park (VC row for Tycoon) | x 6.1…28.1, z 19.9…42.1 | I-280 / US-101 | OSM | 2 |
| M15g | `south-bay-sj`: San Jose downtown, Santa Clara | x 32.5…54.6, z 42.1…58.7 | US-101 | OSM; inside the ±65 km grid | 2 |

Boxes are rough bounding boxes (the core is a fraction of them). The grid stays at ±65 km, so no re-index is needed.

## 9. Platform notes

| | Desktop (ultra, desktop) | iPhone (mobile, mobile-low) | Quest 3 (xr-quest) | Vision Pro (xr-visionpro) |
|---|---|---|---|---|
| Minimap | HUD canvas, 30 Hz | HUD canvas, 30 / 20 Hz | wrist `CanvasTexture` 512 px, 10 Hz, north-up, no per-frame re-raster | same as Quest |
| Full map | pan, scroll zoom, search box | pinch, pan, on-screen search | wrist panel, ray pointer, search through an XR keyboard panel | pinch ray, hand pan |
| Teleport | sandbox menu, map | sandbox menu, map | comfort arc + `teleportNodes` | comfort arc + `teleportNodes` |
| Backdrop | ring 80 km + massing | cards 20 / 10 km | cards 10 km | cards 20 km |
| Tile raster | `asset.worker` | `asset.worker` | `asset.worker`, only on moves > 32 m | same |

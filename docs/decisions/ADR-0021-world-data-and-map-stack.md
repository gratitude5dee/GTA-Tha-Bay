# ADR-0021 — World data sources and map stack

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-14 and D-25; R-MAP-01…03; contract C08

## Context
The owner wants an accurate, recognizable San Francisco that players can mod, with the rest of the Bay deferred. Geometry, terrain and map data must be redistributable in a shipped game, derived data must be cacheable offline, and licences must be machine-checkable in CI. In-game maps must run on an iPhone without a second WebGL context.

## Options considered
1. **Google Photorealistic 3D Tiles.** Terms forbid caching, offline use and derived works; billed per thousand tiles after a free allowance [F-055].
2. **Mapbox tiles or data as geometry.** Terms forbid deriving and caching; only the Mapbox CLI (MIT, 2026-10-08) is usable, as a dev tool [F-056].
3. **Runtime Overpass queries.** Rate-limited and non-deterministic [research/repos-world.md §4].
4. **Open data baked offline** (chosen), with in-engine Canvas 2D maps. Rejected for maps: MapLibre or Mapbox inside the game document (second WebGL context on iPhone) and raster tiles (10–20 MB, blurry when rotated) [research/auth-ugc-input-maps.md §5.4].

## Decision
- **Sources (D-14).** DataSF building footprints `ynuv-fyni`, streets `3psu-pn9h`, neighborhoods `j2bu-swwd` and Address Points (EAS) `ramy-di5m` (PDDL, 224,290 addresses) [F-054]; OpenStreetMap through Geofabrik under ODbL, which requires attribution and share-alike for the derived database [F-053]; Terrarium elevation at zoom 15 for the core. No Google 3D Tiles, no Mapbox tiles. No NAIP/USGS colour sampling (licence UNVERIFIED, DL-107).
- **Frame.** ENU metres from San Francisco City Hall (+X east, +Y up, −Z north); f64 in the sim, f32 on the wire; lat/lng only in authored data, tools and C17 anchors.
- **Bake.** `pnpm map:build` is deterministic (raw snapshot lock; same inputs, same bytes) and gated: building count within ±5 % of 176,777, strongly connected drivable graph ≥ 98 %, a route from City Hall to every portal, packs ≤ 4 MiB, attribution file listing every source. Outputs are C07 `world_pack` and `map_data` assets with provenance (`ODbL-1.0`, `PDDL-1.0`); one bake has one `bakeId`, which equals C05 `worldBake` and C17 `worldVersion`.
- **Maps (D-25).** In-engine Canvas 2D minimap and full map from `sf-map.v1.bin` (heading-up minimap with a north-up toggle; no fog of war; hillshade on); geocoding from the baked `sf-geocode.v1`. MapLibre 6.15.0 with PMTiles (z0–14 ≈ 3.9 MB) is used only on web surfaces (store, forum tiles), never in the game document. Mapbox is never baked or cached.
- **Attribution.** OSM and DataSF credit appears on the splash screen, full map and credits.
- **Expansion.** The same grid, packs and tags serve later Bay areas (M15a–g); v1 renders the rest of the Bay as `far-bay-*` backdrop (ADR-0005).

## Consequences
- (+) Clean, cacheable, redistributable data; the bake is reproducible and CI-gated; one place to fix an error (data commit plus rebake).
- (+) A rebake re-resolves mission references, races and experience anchors, so content survives world updates.
- (−) ODbL share-alike obliges publishing the derived database; the repository is planned open source (Q-08).
- (−) Open data lags real construction; landmark and street names come from DataSF and OSM and may need manual fixes.
- (−) Geofabrik and Overpass routes, SPDX strings for ODbL and PDDL, and per-pack GET speed without a batch route are UNVERIFIED items listed for S02 (U-W-series; M02a1 and M02b1 measure them).

## Affected contracts and milestones
C08 (grid, packs, `WorldIndex`), C07 (`world_pack`, `map_data`, provenance), C17 (`worldVersion`), C05 (`worldBake`). M01f (fixture), M02a1–M02a2 (bake), M02c2 (maps), M13b2 (web tiles, anchor mask), M15a–M15g.

## Links
`research/repos-world.md`; `research/auth-ugc-input-maps.md` §5; `research/INDEX.md` §1.14, §1.25; `spec/domains/02-world.md`, `02-world-bake.md`, `02-world-maps.md`; `spec/11-decision-log.md` DL-105…DL-112; ADR-0005.

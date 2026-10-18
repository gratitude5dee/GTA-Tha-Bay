# M02c2 — maps

## Goal
After this session the player can read San Francisco. Bake stage S12 turns the SF bake into three compact map assets:
- `map_data/sf-map.v1` (streets with their `cnn`, the 41 neighbourhood polygons, labels, hillshade, a chunk index at levels z9, z7 and z5);
- `map_data/sf-map-bldg.v1` (simplified footprints);
- `map_data/sf-geocode.v1` (the offline EAS address geocoder plus a landmark, POI and neighbourhood trie).

S02's in-engine Canvas 2D views draw them (D-25). The minimap appears in the HUD slot M04b2 left empty. The full map, with its legend, search box, waypoint and fast-travel actions, runs in the phone Map app. Blips have shapes as well as colours from the S10 palette tokens. GPS routes come from the drivable graph. The neighbourhood banner fires on area change. The OSM and DataSF attribution appears on the boot splash, in the full-map corner and in the credits. Nothing at runtime uses Mapbox or any third-party map service.

## Requirements
- R-MAP-03: an in-app full map and minimap from `sf-map.v1.bin` with mission markers, waypoint, search, and fast travel where the story allows (experience markers arrive with M13b2 through the same blip API).
- R-MAP-01 (support): street names, neighbourhood banners and addresses come from the real city data, so players recognise where they are.
- R-IP-01 (support): attribution for ODbL and PDDL data is shown in the three required places and joined against provenance.

## Depends on
- **M02c1** (graph-services-teleports): `RoadGraphService` and `RoadGraphQuery.route`, `TeleportApi`, `WorldResolver`, `PlaceIndex`, districts and the POI table, `WorldApi` wiring, and the SF world source used by `@world-teleport`.
- **M04b2** (creator-phone-hud-kit): the HUD grid with the empty minimap slot `bl`, the phone registry with the Map app frame, `config/ui/palettes.json`.
- Through those: M02a1–a2 (S0 raw snapshot, graph, `config/attribution.world.json`), M01e (`asset.worker`), M04b1 (credits and settings pages, i18n).
- Contracts: C08 1.0.0 (`MapBlip`, `WorldApi.map`, `PlaceIndex`, `nhoodAt`), C07 1.1.0 (`map_data` assets, provenance), C06 1.1.0 (`VmKey` `hud.map`, `hud.area`).

## Scope in
- **Bake stage S12** (`tools/map/src/stages/s12/`), selected by `--stage map`:
  - `sf-map.v1` (`DVMP` header with `bakeId`, string table, polygons at DP 5 m, labels, 32 m `u8` hillshade, per-chunk records at z9/z7/z5 with 0.5 m `i16` quantisation, every segment with its `cnn`);
  - `sf-map-bldg.v1` (DP 1.5 m, area ≥ 40 m², height class);
  - `sf-geocode.v1` (base addresses sorted by street and number, street table, name trie).

  It reuses `sf-graph.v1` and `district-grid.v1` when earlier stages wrote them, otherwise writes them. Gates: size limits and street-name count equality within ±0.5 %. The stage is deterministic (`02-world-bake.md` §3 rule 3). `anchor-mask.v1` is out of scope (M13b2).
- **Format module** `packages/shared/src/world/map-format.ts`: a pure reader and writer shared by the bake and the client.
- **Views** (`packages/world/src/map/`), implementing `02-world-maps.md` §2 verbatim: `MinimapView`, `FullMapView`, `MapFrame`, `MapPalette`, `Viewport`, `LayerMask`, `MapPick`.
  - Minimap: per-chunk tiles rasterised once per zoom in `asset.worker` on an `OffscreenCanvas`, returned as `ImageBitmap`s, LRU ≤ 48. The main-thread fallback rasterises at most one chunk per frame. Composite ≤ 3 × 3 tiles, ≤ 64 blips, heading-up with a north-up toggle. Zoom radius by mode and speed (§2.3); rim arrows for out-of-range blips; no attribution label.
  - Full map: 0.25–8 m/px, vector redraw below 2 m/px only on input, cached tiles above, layer toggles, the "Coming later" silhouettes.
- **Blips and `MapApi`** (§3.2 table): a shape per kind, colour from palette tokens, `setRoute` GPS on `RoadGraphQuery.route` (recompute when > 25 m off and at most every 3 s, ≤ 400 points), and the waypoint.
- **Search:** a lazy geocoder over `sf-geocode.v1` through `PlaceIndex.findPlace` (addresses, landmarks, POIs, neighbourhoods). The result card offers a waypoint, and fast travel through `TeleportApi` where the story allows. A CLI **`map:geocode`** (`pnpm map:geocode -- "<text>" | --export`) uses the same code.
- **Banner:** on a `nhoodAt` change, `hud.area` gets the key `nhood.<slug>`, at most once per 3 s.
- **S10 hosting** (thin): the minimap canvas in slot `bl` (30 Hz desktop, 20 Hz `mobile-low`), the full map in the phone Map app with pan, pinch, zoom, legend, search box and the attribution corner that collapses to "(i)" after 5 s.
- **Credits:** generated from `config/attribution.world.json` plus `credits.json` with the ODbL notice (§6 rule 3). The boot-splash line stays for 3 s.
- **Fixture** `tests/fixtures/map/eas-excerpt.csv`: the EAS rows inside the civic-excerpt bbox, cut from the S0 raw snapshot by **`pnpm map:fixture eas-excerpt [--check]`**, with a PDDL provenance record (F-054).
- A lint rule that bans `maplibre-gl` imports in `packages/engine`, `packages/world` and `apps/web` game code (§7).
- QA bridge `__dvBridge.world.map.{minimapPlayerPx, nhoodAt, geocode, banner}` (QA builds only).

## Scope out
- Web surfaces (MapLibre, `sf.pmtiles`, `map:webtiles`) and `anchor-mask.v1`: M13b2.
- Experience markers' data source (route 37): M13a3/M13b2; the blip kind exists here.
- XR wrist minimap and full-map panel: M11b1/M11b2.
- Mission markers' content: M05c1 (it calls `MapApi`).
- Device timing of the minimap (≤ 0.6 ms desktop, ≤ 1.0 ms iPhone are design budgets): recorded in M11a1.

## Deliverables
- `tools/map/src/stages/s12/{index.ts, map-pack.ts, bldg.ts, geocode.ts}`; `tools/map/src/fixtures/eas-excerpt.ts`; `tools/map/src/cli/geocode.ts` (root script `map:geocode`); `tests/fixtures/map/eas-excerpt.csv` plus provenance.
- `packages/shared/src/world/map-format.ts`.
- `packages/world/src/map/{views.ts, minimap.ts, fullmap.ts, raster.ts, blips.ts, gps.ts, geocoder.ts, banner.ts, index.ts}`; `packages/engine/src/workers/asset/map-raster.ts`.
- `packages/ui/src/hud/minimap-slot.tsx`; `packages/ui/src/phone/map-app.tsx`; credits page update (attribution section).
- `config/eslint/` rule entry for `maplibre-gl`; `tools/ci/test/fixtures/lint/maplibre-import.ts` plus a case in `tools/ci/test/lint-fixtures.test.ts`.
- `tools/map/test/stage.map.spec.ts`; `packages/world/test/{map.format.spec.ts, minimap.spec.ts, blips.spec.ts, gps.spec.ts, geocoder.spec.ts, banner.spec.ts}`.
- `tests/e2e/world/map.spec.ts` (`@world-map`, `@world-attribution`); `tests/fixtures/map/banner-points.json` (20 points ≥ 30 m from neighbourhood borders, generated by the bake test helper).
- About 34 files.

## Interfaces
- C08 1.0: `MapBlip`, `WorldApi.map`, `PlaceIndex.findPlace`, `nhoodAt`, `RoadGraphQuery.route`, `TeleportApi`; consumed verbatim. The view types of `02-world-maps.md` §2 are S02 client types, not contract members.
- C07 1.1: `map_data/*` and `data/district-grid.v1` assets with provenance (ODbL/PDDL world provenance, 1.1).
- C06 1.1: `hud.map` and `hud.area` patches.
- No contract change.

## Acceptance criteria
- AC-1 Given the civic-excerpt inputs When stage S12 runs twice Then the three map assets are byte-identical across runs, decode through `map-format.ts`, and every street segment carries its `cnn` — proof: `pnpm check:unit -- tools/map`
- AC-2 Given the full SF raw snapshot (public, F-053, F-054) When the map stage runs Then `sf-map.v1` and `sf-map-bldg.v1` are each ≤ 4 MiB, the active street-name count is within ±0.5 % of 2,567, 41 neighbourhood polygons exist, and the run exits 0 — proof: `pnpm map:build -- --area sf --stage map`
- AC-3 Given the minimap with a fake raster When the player moves on foot, drives at 40 m/s and races Then the view radius is 150 m, `clamp(250 + 3 × 40, 250, 450)` = 370 m and 600 m. At most 9 tiles and 64 blips draw per frame, the tile LRU never exceeds 48, out-of-range blips clamp to the rim, and without `OffscreenCanvas` at most one chunk rasterises per frame — proof: `pnpm check:unit -- packages/world`
- AC-4 Given every blip kind of §3.2 and the four palettes When blips render Then each kind has a distinct shape, and colours come only from palette tokens — proof: `pnpm check:unit -- packages/world`
- AC-5 Given a route request on the graph When the player leaves the route by 30 m and keeps moving Then the route recomputes no more often than every 3 s and holds ≤ 400 points — proof: `pnpm check:unit -- packages/world`
- AC-6 Given the EAS excerpt fixture When each address string is geocoded Then the result lies within 10 m of the EAS coordinate on the same `cnn`. Landmark, POI and neighbourhood names resolve, and the fixture reproduces byte-identically — proof: `pnpm map:fixture eas-excerpt --check && pnpm check:unit -- packages/world`
- AC-7 Given a path crossing three neighbourhoods twice within 3 s When the banner logic runs Then it emits `nhood.<slug>` once per change, at most once per 3 s — proof: `pnpm check:unit -- packages/world`
- AC-8 Given the QA build on the SF world When the e2e runs Then:
  - after teleports to 10 landmarks, the minimap player position is within 5 m of the landmark's projected position;
  - the banner matches the street's `nhood` at the 20 fixture points;
  - 50 seeded EAS addresses geocode within 10 m on the same `cnn`.
  — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @world-map`
- AC-9 Given the QA build When the boot splash, the full map and the credits open Then the splash shows the OSM line for 3 s, the full-map corner collapses to "(i)" after 5 s and still opens it, and the credits list every `attribution.world.json` entry plus the ODbL notice — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @world-attribution`
- AC-10 Given the new assets and strings When the IP gates run Then every map asset has a provenance record, every attribution string appears in `credits.json`, and no shipped string fails the name lint — proof: `pnpm provenance:check && pnpm names:lint`
- AC-11 Given the lint fixture `maplibre-import.ts` (a `packages/world` source importing `maplibre-gl`) When the M00 lint-fixtures test lints it Then the import is reported, while the repo itself lints clean — proof: `pnpm check:unit -- tools/ci && pnpm lint`
- AC-12 Given the branch When the standard gates, the dist verifier and the preview deploy run Then all pass and the deployed app shows the minimap and the phone map — proof: `pnpm typecheck && pnpm check:unit && pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit:**
  - `tools/map/stage.map` (`pnpm check:unit -- tools/map`);
  - `world/map.format`, `map.minimap`, `map.blips`, `map.gps`, `map.geocoder`, `map.banner` (`pnpm check:unit -- packages/world`).
- **Bake:** `pnpm map:build -- --area sf --stage map` (also part of the nightly `map:verify` run).
- **Fixture:** `pnpm map:fixture eas-excerpt --check`.
- **E2E:** `@world-map` and `@world-attribution` on `chromium-webgl2`.
- **IP:** `provenance:check`, `names:lint`.

## Demo script
1. `pnpm map:build -- --area sf --stage map`: prints sizes and the street-count gate.
2. `pnpm dev`, start free roam: the minimap turns with the player, and the banner shows the neighbourhood.
3. Open Phone › Map, zoom to 0.5 m/px, search an address, set a waypoint: the route line appears and follows.
4. Wait 5 s: the attribution corner collapses to "(i)"; tap it.
5. Pause › Credits: the data and map credits with the ODbL notice.

## Effort
1 Builder session; about 34 files; risk **medium**. The binary map format and the tile cache are the core; keep the UI hosting thin.

## Risks & fallbacks
- **The full SF bake is not cached locally.** `--stage map` needs the M02a1 raw snapshot. Run `pnpm map:fetch` (public data, no secret) once. If the network is blocked, AC-2 and AC-8 stay open and are reported; the excerpt-based ACs still run.
- **`sf-map.v1` above 4 MiB.** Raise the DP tolerance for z7/z5 records, never for z9 streets. Record the change.
- **No `OffscreenCanvas` 2D in a browser.** The main-thread fallback (one chunk per frame) is the behaviour and is tested in AC-3.

## Notes for the Builder
- Read first: `02-world-maps.md` §1–§3 and §6–§7; `02-world-bake.md` §2–§3 and the S12 row; `10-ui-hud-xr.md` §2.10 (map hosting); `02-world.md` §8 (M02c2 seeds) and §9.
- Facts: F-053 (OSM ODbL attribution), F-054 (EAS and DataSF are PDDL), F-056 (no Mapbox at runtime; the Mapbox CLI is dev-only and nothing it returns is committed).
- World data for the e2e comes from the same source as M02c1's `@world-teleport`; do not add a second path.
- Order of work: format module, S12 stage and gates, raster job, minimap, full map, blips and GPS, geocoder and CLI, banner, UI hosting and credits, fixtures, e2e.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). No genAI spend, no owner gate.

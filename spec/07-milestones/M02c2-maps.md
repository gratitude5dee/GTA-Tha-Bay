# M02c2 — maps

## Goal
After this session the player can read the city. Bake stage S12 (stage id `map`) turns a bake into three compact map assets:
- `map_data/sf-map.v1` (streets with their `cnn`, the 41 neighbourhood polygons, labels, hillshade, chunk records at z9, z7 and z5);
- `map_data/sf-map-bldg.v1` (simplified footprints);
- `map_data/sf-geocode.v1` (the offline EAS address geocoder plus a landmark, POI and neighbourhood trie).

S02's in-engine Canvas 2D views draw them (D-25), fed by the `MapApi` data M02c1 publishes. The minimap fills the HUD slot that M04b2 left empty. The full map, with legend, search, waypoint and fast travel, runs in the phone Map app. Blips have shapes as well as colours from the S10 palette tokens, and the GPS route line follows the driver. The neighbourhood banner fires on area change. The OSM and DataSF attribution appears on the boot splash, in the full-map corner and in the credits. Nothing at runtime uses Mapbox or another third-party map service.

## Requirements
- R-MAP-03: an in-app full map and minimap from `sf-map.v1.bin` with mission markers, waypoint, search, and fast travel where the story allows (experience pins arrive through the same blip kinds in M13a3/M13b2).
- R-MAP-01 (support): street names, neighbourhood banners and addresses come from the city's own data.
- R-IP-01 (support): ODbL and PDDL attribution in the three required places, joined against provenance.

## Depends on
- **M02c1** (graph-services-teleports): `MapApi` data in `packages/world/src/sim/map/map-api.ts` (blips, waypoint, `setRoute`, published as a view-model patch), `RoadGraphQuery`, `TeleportApi`, `PlaceIndex` (the geocoder plugs in here), `nhoodAt`, `data/district-grid.v1` (stage `s12-district-grid.ts`), the `@world-teleport` bridge.
- **M04b2** (creator-phone-hud-kit): the HUD grid with the empty minimap slot `bl`, the phone registry with the Map app frame, `config/ui/palettes.json`.
- Through those: M02a1–a2 (`synth` and `civic-excerpt` areas, raw snapshot, `config/attribution.world.json`, `sf-graph.v1`), M02b1 (`DV_WORLD=synth` builds), M01e (`asset.worker`), M04b1 (credits page, i18n).
- Contracts: C08 1.0.0 (`MapApi`, `MapBlip`, `PlaceIndex`, `nhoodAt`), C07 1.1.0 (`map_data` assets, ODbL/PDDL provenance), C06 1.1.0 (`hud.map`, `hud.area`).

## Scope in
- **Stage S12 map** (`tools/map/src/stages/{s12-map.ts, s12-bldg.ts, s12-geocode.ts}`, id `map`):
  - `sf-map.v1`: `DVMP` header with `bakeId`, string table, polygons at DP 5 m, labels, 32 m `u8` hillshade, per-chunk records at z9/z7/z5 with 0.5 m `i16` quantisation, every street segment with its `cnn`;
  - `sf-map-bldg.v1`: DP 1.5 m, area ≥ 40 m², height class;
  - `sf-geocode.v1`: base addresses sorted by street and number, street table, name trie.

  Gates: ≤ 4 MiB per map file, street-name count equality ±0.5 % on `sf`, reproducible output (`02-world-bake.md` §3 rule 3). `anchor-mask.v1` stays out (M13b2).
- **Address sources for test areas:**
  - the synth generator emits EAS-shaped address rows along its streets (seeded);
  - `map:fetch -- --area civic-excerpt --fixture` also cuts the EAS rows inside the excerpt (or synthesises them offline, the M02a1 rule) into `tests/fixtures/map/civic-excerpt/`.
- **Format module** `packages/shared/src/world/map-format.ts`: a pure reader and writer shared by the bake and the client.
- **Views** (`packages/world/src/client/map/`), implementing `02-world-maps.md` §2 verbatim (`MinimapView`, `FullMapView`, `MapFrame`, `MapPalette`, `Viewport`, `LayerMask`, `MapPick`):
  - Minimap: per-chunk tiles rasterised once per zoom in `asset.worker` on an `OffscreenCanvas`, returned as `ImageBitmap`s, LRU ≤ 48, with a main-thread fallback of at most one chunk per frame. Composite ≤ 3 × 3 tiles and ≤ 64 blips, heading-up with a north-up toggle. Zoom by mode and speed (§2.3), rim arrows, no attribution label.
  - Full map: 0.25–8 m/px, vector redraw below 2 m/px on input only, cached tiles above, layer toggles, "Coming later" silhouettes.
- **Blip drawing and GPS line** from the `MapApi` patch: a shape per kind (§3.2), colours from palette tokens only. `setRoute` recompute rules: > 25 m off, at most every 3 s, ≤ 400 points, enforced in the M02c1 `map-api.ts` if not already.
- **Search:** a lazy geocoder over `sf-geocode.v1` plugged into `PlaceIndex.findPlace` (addresses, landmarks, POIs, neighbourhoods). Results offer a waypoint, and fast travel through `TeleportApi` where allowed. The CLI **`map:geocode`** (`pnpm map:geocode -- "<text>" [--area <id>]`) uses the same code.
- **Banner:** a `nhoodAt` change patches `hud.area` with `nhood.<slug>`, at most once per 3 s.
- **S10 hosting** (thin): the minimap canvas in slot `bl` (30 Hz desktop, 20 Hz `mobile-low`); the phone Map app with pan, pinch, zoom, legend, search box and the attribution corner that collapses to "(i)" after 5 s.
- **Credits:** generated from `config/attribution.world.json` plus `credits.json`, with the ODbL notice (§6 rule 3). The boot splash line stays 3 s.
- Lint: `maplibre-gl` is banned in `packages/engine`, `packages/world` and `apps/web` game code (§7).
- QA bridge `__dvBridge.world.map.{minimapPlayerPx, nhoodAt, geocode, banner}` (QA builds only).

## Scope out
- Web surfaces (MapLibre, `sf.pmtiles`, `map:webtiles`), `anchor-mask.v1`: M13b2.
- Experience pins' data (route 37): M13a3/M13b2.
- XR wrist minimap and map panel: M11b1/M11b2. Mission marker content: M05c1.
- Device timing of the minimap (≤ 0.6 ms desktop and ≤ 1.0 ms iPhone are design budgets): M11a1–M11a2.

## Deliverables
- `tools/map/src/stages/{s12-map.ts, s12-bldg.ts, s12-geocode.ts}`; `tools/map/src/sources/synth.ts` (address rows); `tools/map/src/cli/geocode.ts` (root script `map:geocode`); EAS rows in `tests/fixtures/map/civic-excerpt/` with its `raw.lock.json` updated.
- `packages/shared/src/world/map-format.ts`.
- `packages/world/src/client/map/{views.ts, minimap.ts, fullmap.ts, raster.ts, blips.ts, route-line.ts, banner.ts, index.ts}`; `packages/world/src/sim/map/geocoder.ts`; `packages/engine/src/workers/asset/map-raster.ts` (or the world job entry M02b1 composes in `apps/web/src/workers/`).
- `packages/ui/src/hud/minimap-slot.tsx`; `packages/ui/src/phone/map-app.tsx`; the credits page attribution section.
- `config/eslint/` rule for `maplibre-gl`; `tools/ci/test/fixtures/lint/maplibre-import.ts` plus a case in `tools/ci/test/lint-fixtures.test.ts`.
- `tools/map/test/stage.map.spec.ts`; `packages/world/test/{map.format.spec.ts, minimap.spec.ts, blips.spec.ts, gps.spec.ts, geocoder.spec.ts, banner.spec.ts}`.
- `tests/e2e/world-map.spec.ts` (`@world-map`, `@world-attribution`).
- About 34 files.

## Interfaces
- C08 1.0: `MapApi`, `MapBlip`, `PlaceIndex.findPlace`, `nhoodAt`, `RoadGraphQuery.route`, `TeleportApi`; consumed verbatim. The §2 view types are S02 client types, not contract members.
- C07 1.1: `map_data/*` assets with world provenance (1.1).
- C06 1.1: `hud.map`, `hud.area` patches. No contract change.

## Acceptance criteria
- AC-1 Given the `civic-excerpt` area When stages through `map` run twice Then the three map assets are byte-identical across runs, decode through `map-format.ts`, and every street segment carries its `cnn` — proof: `pnpm map:build -- --area civic-excerpt --repro && pnpm check:unit -- tools/map`
- AC-2 Given the civic-excerpt EAS rows When each address string is geocoded Then the result lies within 10 m of the row's coordinate on the same `cnn`, and landmark, POI and neighbourhood names resolve — proof: `pnpm map:build -- --area civic-excerpt && pnpm check:unit -- packages/world`
- AC-3 Given the minimap with a fake raster When the player walks, drives at 40 m/s and races Then the view radius is 150 m, `clamp(250 + 3 × 40, 250, 450)` = 370 m and 600 m. At most 9 tiles and 64 blips draw per frame, the tile LRU never exceeds 48, out-of-range blips clamp to the rim, and without `OffscreenCanvas` at most one chunk rasterises per frame — proof: `pnpm check:unit -- packages/world`
- AC-4 Given every blip kind of §3.2 and the four palettes When blips render Then each kind has a distinct shape and colours come only from palette tokens — proof: `pnpm check:unit -- packages/world`
- AC-5 Given an active route When the player drifts 30 m off it and keeps moving Then the route recomputes no more often than every 3 s and holds ≤ 400 points — proof: `pnpm check:unit -- packages/world`
- AC-6 Given a path crossing three neighbourhoods twice within 3 s When the banner logic runs Then it emits `nhood.<slug>` once per change, at most once per 3 s — proof: `pnpm check:unit -- packages/world`
- AC-7 Given a `DV_WORLD=synth` QA build When the e2e runs Then all of these hold:
  - after teleports to the landmarks of M02c1's `@world-teleport` list that land, the minimap player position is within 5 m of each landmark's projected position;
  - the banner equals `nhoodAt` at 20 seeded points ≥ 30 m from neighbourhood borders;
  - 50 seeded addresses geocode within 10 m on the same `cnn`.
  — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-map`
- AC-8 Given the same build When the boot splash, the full map and the credits open Then the splash shows the OSM line for 3 s, the full-map corner collapses to "(i)" after 5 s and still opens it, and the credits list every `attribution.world.json` entry plus the ODbL notice — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-attribution`
- AC-9 Given the new assets and strings When the IP gates run Then every map asset has a provenance record, every attribution string appears in `credits.json`, and no shipped string fails the name lint — proof: `pnpm provenance:check && pnpm names:lint`
- AC-10 Given the lint fixture `maplibre-import.ts` When the M00 lint-fixtures test lints it Then the import is reported, while the repo itself lints clean — proof: `pnpm check:unit -- tools/ci && pnpm lint`
- AC-11 Given an operator workstation with the M02a1 `sf` snapshot When the operator runs the `map` stage on `sf` twice and geocodes 50 seeded EAS addresses Then `sf-map.v1` and `sf-map-bldg.v1` are each ≤ 4 MiB, the street-name count is within ±0.5 % of 2,567, both runs are identical, all 50 addresses land within 10 m on the same `cnn`, and the run writes `docs/bake-runs/M02c2/notes.json` — proof: manual: operator workstation, `pnpm map:build -- --area sf --stage map --repro`, then `pnpm map:geocode -- --area sf --sample 50`, commit the notes file
- AC-12 Given the branch When the standard gates, the dist verifier and the preview deploy run Then all pass, the gray-box boot still works, and the Preview passes its header checks — proof: `pnpm typecheck && pnpm check:unit && pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit:** `tools/map/stage.map` (`pnpm check:unit -- tools/map`); `world/map.format`, `map.minimap`, `map.blips`, `map.gps`, `map.geocoder`, `map.banner` (`pnpm check:unit -- packages/world`).
- **Bake:** `--repro` on `civic-excerpt` in CI; `sf` by the operator (AC-11).
- **E2E:** `@world-map` and `@world-attribution` with `DV_WORLD=synth`.
- **IP and lint:** `provenance:check`, `names:lint`, the lint-fixtures case.

## Demo script
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, start free roam: the minimap turns with the player and the banner names the neighbourhood.
2. Phone › Map: zoom to 0.5 m/px, search an address, set a waypoint; the route line appears and follows.
3. Wait 5 s: the attribution collapses to "(i)"; tap it.
4. Pause › Credits: data and map credits with the ODbL notice.
5. `pnpm map:geocode -- "<an address from the excerpt>" --area civic-excerpt`.

## Effort
1 Builder session; about 34 files; risk **medium**. The binary format and the tile cache are the core; keep the UI hosting thin.

## Risks & fallbacks
- **`sf-map.v1` above 4 MiB on `sf`.** Raise the DP tolerance of z7/z5 records, never of z9 streets, and record it.
- **No `OffscreenCanvas` 2D in a browser.** The main-thread fallback is the behaviour and is tested (AC-3).
- **No network for the excerpt EAS cut.** Use the offline synthesis path of M02a1 and mark the rows `synthetic` in the fixture README.

## Notes for the Builder
- Read first: `02-world-maps.md` §1–§3, §6–§7; `02-world-bake.md` §2–§3 (S12 row); `10-ui-hud-xr.md` §2.10 (map hosting); `02-world.md` §8 (M02c2 seeds) and §9; the M02a1, M02b1 and M02c1 files.
- Facts: F-053 (OSM ODbL attribution), F-054 (EAS and DataSF are PDDL), F-056 (no Mapbox at runtime; the Mapbox CLI is dev-only and nothing it returns is committed). The 2,567 active street names come from [research/auth-ugc-input-maps.md §5.2].
- `map:geocode --sample <n>` (seeded sample against the source rows) is part of this milestone's CLI.
- Order of work: format module, stage and gates, address sources, geocoder and CLI, raster job, minimap, full map, blips and route line, banner, UI hosting and credits, e2e.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). The `sf` run needs public downloads only. No genAI spend, no owner gate.

# M02a1 — bake-core

## Goal
After this session `tools/map` is a real bake pipeline for the parts of San Francisco that do not need roads: S0 fetch with a pinned `raw.lock`, S2 terrain, S3 water, landuse and street trees, S4 buildings, the S13 pack writer (`p0` and `l0` `DVWP` v1 packs, `data/world-index`, attribution, provenance) and the gates of those stages. Three areas exist: `sf` (the real city; network; baked and published by the operator), `civic-excerpt` (a committed 1 km² source excerpt around City Hall; proves byte-reproducible bakes in CI) and `synth` (offline seeded sources in the same raw formats over the whole `play` box; the full-size CI world for M02b1–M02d2). `pnpm map:pack` turns a bake into C07 manifests with provenance and publishes it to a `dir:` or `r2:` target. Roads, landmarks and POIs come in M02a2.

## Requirements
- R-MAP-01: real footprints (DataSF `ynuv-fyni`), real terrain (Terrarium), real coastline and landuse (OSM, DataSF parks) baked in the ENU frame of C08.
- R-IP-01: open data only, with per-pack provenance (`origin: derived`, ODbL/PDDL source stamps, DL-161) and an attribution file; Google 3D Tiles and Mapbox are never sources (F-055, F-056).

## Depends on
- **M01f:** C08 types, `pack-codec.ts` (decoder), `tools/map` package with `encodeP0`/`encodeL0`, `map:fixture`, `config/world.bounds.json`.
- **M01d:** C07 catalog builder, `assets:*` scripts, `uploader-dir.ts` and `uploader-rclone.ts`, `assets/assets.lock.json`, `config/asset-budgets.json`.
- Contracts: C08 1.0 (`02-world-contracts.md` §1–§5), C07 1.1 (`world_pack`, `data` kinds; world provenance per `05-assets-pipeline.md` §14, DL-161).

## Scope in
- **CLI** (`tools/map/src/cli.ts`, extended): `map:fetch [-- --area sf|civic-excerpt] [--archive] [--fixture]`, `map:build [-- --area sf|civic-excerpt|synth] [--stage <ids>] [--force] [--repro]`, `map:pack [-- --bake <bakeId>] --target dir:<path>|r2:<env>`. `--stage` takes a comma list of `fetch,terrain,water,buildings,pack` (later stages add ids). `--repro` runs the selected stages twice with `--force` into two output directories and fails if any output byte differs.
- **Areas** in `config/world/sources.json` (schema in `tools/map/schemas/`): dataset ids and URLs (`02-world-bake.md` §2), licence and attribution text per source, and per-area gate parameters. The Geofabrik URL and the `osmium` commands are recorded there exactly as the operator first runs them (U-W1); `map:fetch` prints them before running.
- **S0 fetch** (`tools/map/src/sources/`): Socrata paging `$order=:id&$limit=45000&$offset=…` for `ynuv-fyni`, `j2bu-swwd`, `gtr9-ntp6`, `tkzw-k3nq` (streets, EAS and Muni are fetched here too, used from M02a2); Terrarium z15 tiles over `stream` ∪ `play` and z12 over `far`; OSM via `osmium extract` with the two bboxes of §2 and export to GeoJSON lines. Output `.cache/map/raw/<area>/` plus `raw.lock.json` (URL, retrieval date, SHA-256, row count per source). For `sf`, the lock is committed as `content/world/raw.lock.sf.json`; `--archive` uploads the snapshot to `tha-bay-private-staging` (rclone, keys from `R2_PRIVATE_ACCESS_KEY_ID` / `R2_PRIVATE_SECRET_ACCESS_KEY`: a separate R2 API token scoped to `tha-bay-private-{staging,prod}`, because M01d's token covers only the media buckets; DL-287). Socrata requests send the optional app token from `SOCRATA_APP_TOKEN` (shell environment) when set; absent, they run unauthenticated. Without network, without `osmium` or with `DV_MAP_OFFLINE=1`, it prints `SKIP map:fetch <source>: <reason>` and exits 0.
- **`synth` sources** (`tools/map/src/sources/synth.ts`, `config/world/synth.json`): seeded generator that writes the same raw formats S0 writes (Socrata-shaped JSON rows, Terrarium PNG tiles, OSM-shaped GeoJSON lines) for: a land rectangle inside `play` with water strips north and east, smooth hills (City Hall post 17.6 m), 41 rectangular neighbourhood polygons carrying the 41 real names of `02-world-bake.md` §8, parks, and buildings by density band (a downtown band at the C08 rule-20 limit of 1,500 per chunk, ≤ 200 elsewhere). Its stamps are `origin: authored`, licence `LicenseRef-DeeVerse-Owned`; synth packs are QA-only and never enter `assets/assets.lock.json`.
- **`civic-excerpt`:** committed raw files in `tests/fixtures/map/civic-excerpt/` (footprints, two Terrarium tiles, an OSM GeoJSON extract, parks, neighbourhoods, its own `raw.lock.json` and `README.md`). `map:fetch -- --area civic-excerpt --fixture` cuts the real 1 km² around City Hall when the session has network; otherwise the Builder generates it with the synth generator restricted to that square and the README and stamps say `synthetic: true` (the operator re-runs the real cut later; Builder decision).
- **S2 terrain:** rules 1–5 of `02-world-bake.md` §4 S2 (Terrarium decode, 4 m bilinear posts, water clamps, piers). Edge posts come from one global grid, so neighbours are equal by construction; `sampleHeight` from `@dv/shared`.
- **S3 water, landuse, trees:** §4 S3 rules (coastline chaining, rings > 0.25 km², DP 4 m, landuse classes); street trees from `tkzw-k3nq` into `l0` TREE records.
- **S4 buildings:** rules 1–5 and 7–8 of §4 S4 (text height columns parsed, blend, clamp, ring cleaning, CCW, vertex caps, OSM gap fill ≤ 5 %, kinds, roofs, palette by `hash(sf16_bldgid)`). Rule 6 (landmark proxies) writes `proxyOf = 0` until M02a2 seeds landmarks. Over-limit chunks (> 1,500 buildings) fail the gate; nothing is split.
- **S13 pack and index:** `p0` sections HEIGHT, STRINGS, PRISM, GROUND; `l0` sections BUILDING, LANDUSE, TREE (LAMP and FURNITURE empty until later stages). Packs only for `z=7` tiles that intersect land or piers. `bakeId` = SHA-256 of canonical `{sourceHashes, toolVersion, configHashes}` (C08 rule 16); `worldSeed` = first 4 bytes. `data/world-index` validated against `tools/map/schemas/world-index.schema.json` (all §5 required properties; `landmarks`, `pois`, `portals`, `transit` may be empty until M02a2, whose `map:verify` enforces the v1 counts). `config/world.bounds.json` regenerated and unchanged. Outputs in `dist/world/<bakeId>/` with `bake-report.json` (counts, gates, sizes, stage times).
- **Gates** (`tools/map/src/verify/gates.ts`), parameters per area: S0 row counts; S2 City Hall height 10–25 m, minimum ≥ −130 m, shared edge posts equal; S3 land area within ±3 % of the summed neighbourhood polygon areas (they partition the city); S4 baked DataSF buildings ≥ 98 % of the `ynuv-fyni` row count in `raw.lock.json` before proxies (dropped ≤ 2 %); OSM supplement ≤ 5 %, each addition listed by OSM id in `bake-report.json`; S13 every pack ≤ 4 MiB (warn > 2.5 MiB) and no key-like string in outputs.
- **Attribution:** `config/attribution.world.json` generated from `sources.json` alone (`{id, text, licence, licenceUrl, source, surfaces}` per source), so it is reproducible offline; each bake copies the entries of its area next to its packs.
- **`map:pack`:** writes one C07 `AssetManifest` per pack (`world_pack/p0-<x>-<y>`, `world_pack/l0-<x>-<y>`, `data/world-index`, variant `default`), one `ProvenanceRecord` per pack (`origin: derived`, `tool: tools/map@<version>`, `derived_from` = the source stamps' SHA-256s, each stamp its own `open_data` record; synth stamps `authored`), and `dist/world/<bakeId>/catalog.fragment.json`; then copies through the M01d uploader. Target `r2:<env>` additionally writes the lock entries and provenance records under `assets/` for a PR (operator, `sf` only).
- **QA build hook:** when `DV_WORLD=<bakeId|area>` is set (an area name means that area's latest bake), the `@dv/web` QA build step runs `map:pack -- --bake <bakeId> --target dir:apps/web/media-local` before the M01e media-local publish, so the QA catalog contains that world. Production builds ignore it.

## Scope out
- S5–S10 (roads, junctions, grading, ped graph, tags, spawn, landmarks, POIs, transit), `map:verify`, `map:landmarks`, `map:pois`: M02a2. S11 LOD and far packs (`l1`, `l2`, `far-bay-*`): M02b1. S12 map packs and geocoder: M02c1 (district grid) and M02c2.
- Automatic CI publishing of `sf` packs: the operator runs `map:pack -- --target r2:staging` (AC-9); a CI trigger waits until the measured bake time fits the runner.
- `--imagery` (U-W3, off by default).

## Deliverables
- `tools/map/src/{cli.ts (extended), config.ts, raw-lock.ts, bake.ts}`, `tools/map/src/sources/{socrata.ts, terrarium.ts, osm.ts, synth.ts}`, `tools/map/src/stages/{s0-fetch.ts, s2-terrain.ts, s3-water.ts, s4-buildings.ts, s13-pack.ts}`, `tools/map/src/geom/{dp.ts, rings.ts, raster.ts}`, `tools/map/src/verify/gates.ts`, `tools/map/src/pack/{index.ts, attribution.ts, publish.ts}`.
- `tools/map/schemas/{sources.schema.json, synth.schema.json, world-index.schema.json, bake-report.schema.json}`.
- `config/world/{sources.json, synth.json}`, `config/attribution.world.json`.
- `tests/fixtures/map/civic-excerpt/*` (data) and `tools/map/test/{stage.terrain.spec.ts, stage.water.spec.ts, stage.buildings.spec.ts, pack.index.spec.ts, bake.repro.spec.ts, synth.spec.ts, publish.spec.ts}`.
- `apps/web/package.json` (QA build hook), `.gitignore` (`.cache/`, `dist/world/`).
- Root scripts: **`map:fetch`**, **`map:build`**, **`map:pack`** (all through `tools/ci/run.ts` `args()`).
- Pins (not in the ledger; take what pnpm resolves, record in `spec/03`): a PNG codec for Terrarium tiles. `osmium` is an operator tool, not a dependency.
- ≈ 33 code files; fixtures and JSON configs are data.

## Interfaces
- C08 1.0 used unchanged (`encodeP0`/`encodeL0` from M01f, `WorldIndex` per §5). C07 1.1 manifests and provenance unchanged.
- New tool APIs (not contracts): `runBake`, `BakeReport`, `SourceStamp {id, url, retrievedAt, sha256, rows, licence}`.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the `civic-excerpt` raw files When the stage tests run Then terrain decodes City Hall within 10–25 m and shared edge posts of all neighbouring chunks are equal, coastline rings close, building rings are CCW with ≤ 28 vertices and no area < 4 m², heights stay within 3.5–340 m, and kinds and roofs follow the S4 rules on table-driven cases — proof: `pnpm check:unit -- tools/map`
- AC-3 Given the `civic-excerpt` area When it is baked twice from scratch Then every pack, the world index and `bake-report.json` are byte-identical across both runs, all gates pass, and every pack is ≤ 4 MiB — proof: `pnpm map:build -- --area civic-excerpt --repro`
- AC-4 Given no network When the `synth` area is generated and baked Then packs exist for every land tile on the straight line from (2275, −1804) to (−8300, 500), the world index validates against its schema, every chunk holds ≤ 1,500 buildings, every pack is ≤ 4 MiB, and no output contains a key-like string — proof: `pnpm map:build -- --area synth && pnpm check:secrets -- dist/world`
- AC-5 Given a `synth` bake When `map:pack` publishes it to a directory target Then one manifest and one provenance record exist per pack, each record validates, `catalog.fragment.json` resolves every `world_pack` ref for all six tiers through `default`, and `assets/assets.lock.json` is unchanged — proof: `pnpm check:unit -- tools/map && pnpm provenance:check && pnpm check:assets`
- AC-6 Given `config/world/sources.json` When attribution is regenerated Then `config/attribution.world.json` lists every source with licence and licence URL ("© OpenStreetMap contributors" with ODbL 1.0, "City and County of San Francisco" with PDDL, the USGS 3DEP credit for Terrarium), and no excluded source (3D Tiles, Mapbox) appears — proof: `pnpm check:unit -- tools/map`
- AC-7 Given `DV_MAP_OFFLINE=1` (the same path a session without network or without `osmium` takes) When `map:fetch -- --area sf` runs Then every source prints its `SKIP map:fetch <source>: offline` line, nothing is written to `content/world/` and the command exits 0 — proof: `DV_MAP_OFFLINE=1 pnpm map:fetch -- --area sf`
- AC-8 Given the default QA build and the production build When they are built and deployed to a Preview Then the app is unchanged (no world in the catalog unless `DV_WORLD` is set) and the Preview passes the header checks — proof: `pnpm build && pnpm deploy:preview`
- AC-9 Given an operator workstation with network, `osmium`, the media R2 secrets and the private-bucket pair `R2_PRIVATE_ACCESS_KEY_ID` / `R2_PRIVATE_SECRET_ACCESS_KEY` When the operator fetches `sf` with `--archive`, bakes `--stage terrain,water,buildings,pack --repro`, runs `check:secrets -- dist/world`, and packs to `r2:staging` Then baked DataSF buildings ≥ 98 % of the `ynuv-fyni` row count in `raw.lock.json` before proxies (dropped ≤ 2 %); OSM supplement ≤ 5 %, each addition listed by OSM id in `bake-report.json`, every pack is ≤ 4 MiB, both runs are identical, the lock and provenance PR is opened, and the run records U-W1 (URL and osmium flags used), U-W11 (gap-fill count) and the bake time in `docs/bake-runs/M02a1/notes.json` — proof: manual: operator workstation, `pnpm map:fetch -- --area sf --archive`, `pnpm map:build -- --area sf --stage terrain,water,buildings,pack --repro`, `pnpm check:secrets -- dist/world`, `pnpm map:pack -- --target r2:staging`, then commit `content/world/raw.lock.sf.json` and the notes file

## Test plan
- **Unit** (`pnpm check:unit -- tools/map`): `tools/map/stage.terrain`, `stage.water`, `stage.buildings`, `pack.index`, `synth.deterministic`, `publish.dir`, `attribution`.
- **Bake** (`ci.yml` `content` job, added here): `pnpm map:build -- --area civic-excerpt --repro`; `synth` runs where needed from M02b1, cached under `.cache/map` keyed on `tools/map/**` and `config/world/**`.
- **Gates:** `provenance:check`, `check:assets`, `check:secrets -- dist/world`. **Operator:** AC-9 once.

## Demo script
1. `pnpm map:build -- --area civic-excerpt --repro`: two identical bakes, gates printed.
2. `pnpm map:build -- --area synth`, then `pnpm map:pack -- --bake <bakeId> --target dir:/tmp/dv-world`; inspect `bake-report.json`, one manifest and its provenance record.

## Effort
1 Builder session; about 33 code files; risk **medium**. Ring cleaning and coastline closure are the main time sinks; keep the synth generator to one file.

## Risks & fallbacks
- **OSM extract route** (U-W1, U-W2) unknown until the operator runs it: the OSM reader accepts GeoJSON lines from any route (osmium export or a hand-supplied file at `.cache/map/raw/sf/osm.geojsonl`); record what worked in `sources.json`.
- **Coastline assembly fails on the real extract:** use `natural=water` polygons plus the neighbourhood-union land mask; log the gate result.
- **Synth bake too slow** (target ≤ 5 min on the runner): halve the downtown band, flatten Terrarium outside `play`; keep the AC-4 route tiles.
- **Footprint gaps after 2010** (U-W11): the OSM gap fill is capped at 5 %; the ≥ 98 % source-count gate counts DataSF records only, before the supplement.

## Notes for the Builder
- Read first: `02-world-bake.md` §1–§5, §8; `02-world-contracts.md` §1, §4–§5; `05-assets-pipeline.md` §14; M01f's pack-codec layout choices.
- No `Math.random`, no timestamps in packs, stage seeds `sha256(bakeId + stageId)`, ids sorted; quantize to integers before encoding. Never call Nominatim, Overpass, Google or Mapbox from the bake.
- 176,777 (research/repos-world.md §1.2) is the SF example repo's output count from different inputs and its own simplification; an informational reference only, never a gate (DL-288). Do not open that repo to reconcile counts (clean-room).
- Secrets (`spec/08-test-and-ci.md` §8): optional `SOCRATA_APP_TOKEN` from the shell environment (never written to outputs, never read from `.dev.vars`); `R2_PRIVATE_ACCESS_KEY_ID` / `R2_PRIVATE_SECRET_ACCESS_KEY` only for `--archive`; `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` only for `r2:` targets (each absent → `SKIP … <VAR> not set`, exit 0). Branch `m02a1-bake-core`.

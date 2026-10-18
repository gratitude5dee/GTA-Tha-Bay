# M15f — peninsula-vc-row

## Goal
After this session the venture-capital corridor of the Peninsula is playable: `pen-vc-row` (a core around Menlo Park, Palo Alto and Sand Hill, reaching toward San Mateo) is baked from OpenStreetMap and Terrarium z15 with the M15a framework, entered from `pen-north` by freeway or arterial, and passes every area gate. The twelve fictional investors of the Business Tycoon roster each get a place to stand: a `tycoon-sites.json` maps every `vc-*` slug to a point of interest in this area, and the check fails when one is missing or unreachable. San Francisco's and the earlier areas' bytes do not change. The area opens for players who hold `unlock.area.pen-north`.

## Requirements
- R-MAP-02: the next link in the Peninsula chain, the VC row the Business Tycoon story points at.
- R-MODE-04: investors become places (`tycoon-sites.json`), so the founder-versus-VC fiction has a map.
- R-MAP-03: map pack, rail stations, in-area search.
- R-MAP-04: office-park, residential and sparse density profiles for the new districts.
- R-IP-01: OSM and Terrarium credit; every firm, tower and venue is fictional (W-15); no university or company marks.
- R-ENG-02: pack and arrival-bootset caps.

## Depends on
- **M15e** (`pen-north` baked and registered; the framework of M15a through it). Contracts: C08 1.0, C06 1.1, C07 1.1, C13 1.1 (unchanged).

## Scope in
- **Registry entry.** `pen-vc-row`: `search` is the §8 box (x 6.1…28.1 km, z 19.9…42.1 km); `bboxEnu` a core with `maxPlayKm2` 35, `maxPackMiB` 80 and `arrivalBootsetMiB` 30 (design caps) that contains Sand Hill, a downtown rail station and a bay-front strip; `requires: ['unlock.area.pen-north']`; `unlock: 'unlock.area.pen-vc-row'`; `cards`: the Peninsula cluster. `status` becomes `playable` only when AC-5 and AC-6 pass. The core need not touch `pen-north`: the seam is a fade, and the far-bay massing and the title banner `world.area.pen-vc-row` carry the gap.
- **Entries (1 to 2).** From the `pen-north` index `portals`: the two highest-class `county-line` portals on its southern edge (a freeway and an arterial where both exist), `radiusM` 100, each with an `arrival` on the matching drivable edge of the core, heading south, ≥ 100 m apart.
- **Excerpt.** A 1 km² excerpt around the Sand Hill office cluster (a crest road with curvature), committed under `tests/fixtures/map/pen-vc-row-excerpt/`.
- **Districts** (`content/world/areas/pen-vc-row/districts.json`, authored polygons, ODbL-derived, credited): `pv-sand-hill` (tier B, `residential-park`), `pv-menlo` (B, `residential`), `pv-palo-alto` (B, `cbd-tech`), `pv-san-mateo` (C, `residential`), `pv-baylands` (C, `sparse`).
- **Landmarks (≥ 8, `lm.pv-*`).** Seeds confirmed against OSM at build time: a foothill radio dish, the Sand Hill crest overlook, two rail stations, a baylands boardwalk end, a main-street clock tower, and two fictional office towers (one for `vc-fogindex-hardball`, one for `vc-sovereign-slow`, the roster's hero investors). Anything failing the 120 m rule is replaced.
- **POIs** ≥ 60, fictional names, anonymous homes, each bound to a pedestrian node ≤ 25 m; they include the 12 investor sites.
- **Tycoon sites.** `content/world/areas/pen-vc-row/tycoon-sites.json`: `{ "<vc slug>": "<PoiId>" }` for all 12 roster slugs of `08-tycoon-finance.md` §10 and any further `vc-*` id that appears under `content/tycoon/`. Each site is a `work`, `cafe` or `venue` POI with `hours` set; angels and scouts meet at cafes.
- **Transit.** ≥ 4 `bay-rail` nodes (factual station names), `fastTravel: true`; fares by `crossAreaCents`.

## Scope out
- Tycoon scenes, pitch cutscenes and NPC schedules that use the sites: unscheduled (Act 4+ and mode content owners).
- San Jose and the South Bay: M15g.
- Publishing packs to staging R2 (operator).

## Deliverables
- `config/world/areas.json` (entries), `content/world/areas/pen-vc-row/{districts,pois,landmarks,transit,tycoon-sites}.json`, `tests/fixtures/map/pen-vc-row-excerpt/`.
- `tools/map/src/landmarks/pv-*.ts` (eight recipes on the M02d1 kit) with `assets/landmarks/` outputs and `origin: authored` provenance; `assets/provenance/world/pen-vc-row/` bake records.
- `tools/map/test/{area.penvc.excerpt.spec.ts, area.penvc.content.spec.ts, area.penvc.tycoonSites.spec.ts}`, `packages/world/test/places.tycoonSites.spec.ts`.

## Interfaces
- C08 1.0: new `PoiRecord`, `LandmarkRecord`, `DistrictRecord`, `TransitNode`, `Portal` instances; index `data/world-index.pen-vc-row`; `PlaceIndex.poi` resolves them through `AreaDirectory`. C06 1.1 `grants.districts` through M15a. C07 1.1 new assets. C13 1.1 read only. The tycoon roster (`vc-*` slugs) is read, not changed. No contract change.

## Acceptance criteria
- AC-1 Given the Sand Hill excerpt When the area is built twice offline Then pack hashes match, packs are ≤ 4 MiB, the maximum road grade is ≤ 40 % and building heights follow the OSM rule table — proof: `pnpm check:unit -- tools/map`
- AC-2 Given the registry and content files When the content test runs Then districts cover the core without overlap, ≥ 8 landmarks and ≥ 60 POIs have well-formed ids, and each entry resolves to exactly one portal per side — proof: `pnpm check:unit -- tools/map && pnpm names:lint`
- AC-3 Given `tycoon-sites.json` and the roster When the sites test runs Then every `vc-*` slug under `08-tycoon-finance.md` §10 and `content/tycoon/` has a site, each `PoiId` exists in the area index with kind `work`, `cafe` or `venue`, `hours` set and a pedestrian node ≤ 25 m, and no site is shared by two hero investors — proof: `pnpm check:unit -- tools/map`
- AC-4 Given a mock `AreaDirectory` with `pen-vc-row` loaded When `PlaceIndex.poi` is called for each site Then it returns the record, and returns `null` while the area index is not loaded — proof: `pnpm check:unit -- packages/world`
- AC-5 Given a fresh OSM snapshot When the area is baked and verified Then gates A1–A10 pass: the strongly connected component is ≥ 98 % of drivable edges, a route runs from each arrival to the core centre, signal junctions have ≥ 2 phases, each arrival is on ground ≥ 3 m from water, the core is ≤ 35 km², packs total ≤ 80 MiB, the arrival bootset is ≤ 30 MiB, and two runs give identical hashes — proof: `pnpm map:build -- --area pen-vc-row && pnpm map:verify -- --area pen-vc-row`
- AC-6 Given the landmark seeds When the gate runs Then each is within 120 m of its OSM feature and within its class triangle budget — proof: `pnpm map:landmarks -- --area pen-vc-row && pnpm check:unit -- tools/map`
- AC-7 Given `pen-north`'s excerpt When it is built with the `pen-vc-row` entry in the registry and with it removed Then `bakeId` and pack hashes are identical, as are the SF civic excerpt's — proof: `pnpm check:unit -- tools/map && pnpm check:secrets -- dist/world`
- AC-8 Given pack provenance and attribution When the checks run Then records validate and every attribution string appears in the credits — proof: `pnpm provenance:check && pnpm check:assets && pnpm ip:strings`
- AC-9 Given the branch When the production build is verified Then no fixture or QA code ships — proof: `pnpm build && pnpm --filter @dv/web verify:dist`

## Test plan
- Unit: the specs above (`pnpm check:unit`). Static gates: `map:build`, `map:verify`, `map:landmarks`. CI builds the excerpt per PR; the full bake runs nightly via `pnpm map:verify -- --area pen-vc-row`. No device test.

## Demo script
1. `pnpm map:build -- --area pen-vc-row`, then `pnpm map:verify -- --area pen-vc-row`.
2. On a build with `?unlockAll=1`, ride a fast-travel rail station from San Francisco to a Peninsula station.
3. Open the full map; search a fictional investor office.
4. Drive the crest road past the office cluster.

## Effort
1 Builder session (data as JSON and recipes); about 18 hand-written files; risk medium (OSM completeness in office parks, pack size, roster drift).

## Risks & fallbacks
- A roster slug is renamed or added after this file: the sites test fails by design; add the site, never delete the check.
- Fewer than 60 POIs fit the core: add cafes and residential anchors; never lower `min.pois`.
- Pack cap exceeded: shrink `bboxEnu` toward Sand Hill, never raise the cap.
- OSM download blocked: keep AC-1 to AC-4, AC-7 and report "Blocked on: OSM download".

## Notes for the Builder
- Read first: the M15a and M15e files; `02-world-bake.md` §8–§9 (district tiers, POI rules); `08-tycoon-finance.md` §10 (roster).
- Order: `pen-north` index → excerpt → entries → districts, POIs, sites → bake and verify → landmarks → transit → tests.
- Gates and stubs: `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` for `assets:publish` (SKIP line); `DV_NAMES_REAL_JSON` CI-only for `names:lint`. No fal. Branch `m15f-peninsula-vc-row`.

# M15b — oakland-core

## Goal
After this session Oakland's core is a playable area: `ea-oakland-core` (downtown, Jack London, West Oakland, Lake Merritt, and the port edge) is baked from OpenStreetMap and Terrarium with the M15a framework, packed for publishing, and reached by driving onto the Bay Bridge portal from Yerba Buena Island or boarding the Ferry Building portal. It has a road and pedestrian graph, signals, eight original landmarks (the port cranes among them), at least 60 fictional points of interest, four fast-travel rail stations, its own map pack and districts, and it passes every area gate. San Francisco's bytes do not change. The area opens only for players who hold `unlock.district.d10` (the finale), and the first device pass is recorded here.

## Requirements
- R-MAP-02: the first real expansion district behind its portal.
- R-MAP-01: the Bay Bridge stops being a wall (`02-world-maps.md` §4.2: "In M15+ a portal becomes a streaming handoff").
- R-MAP-03: Oakland map pack, stations and in-area search.
- R-MAP-04: traffic, pedestrians and density profiles for the new districts.
- R-IP-01: OSM and Terrarium credit on every surface; fictional venue names; original landmark recipes.
- R-ENG-02: pack and arrival-bootset caps; an iPhone 15 pass at `mobile-low`.

## Depends on
- **M15a** (area registry, `--area` bakes, `buildings-osm`, area gates, `AreaDirectory`, handoff). Contracts: C08 1.0, C06 1.1, C07 1.1, C13 1.1 (all unchanged).

## Scope in
- **Registry entry.** `ea-oakland-core` in `config/world/areas.json`: `search` is the §8 box (x 10.5…16.7 km, z −5.6…−0.1 km) widened west to the Bay Bridge touchdown and the port, read from OSM; `bboxEnu` is a core the Builder cuts inside it with `maxPlayKm2` 30, `maxPackMiB` 80 and `arrivalBootsetMiB` 30 (design caps); `requires: ['unlock.district.d10']`; two entries from `sf`: the SF `portal.baybridge` (radius 100 m), `arrival` on the first drivable Oakland edge east of the span, yaw east; and the SF ferry portal near `lm.ferry-building` (radius 150 m, `kind: 'ferry'`), `arrival` at the Jack London ferry landing; `cards`: the Oakland downtown and Oakland hills clusters. `unlock` is `unlock.area.ea-oakland-core`, emitted on the first arrival. `status` becomes `playable` only when AC-3 and AC-4 pass.
- **Excerpt.** A 1 km² excerpt in downtown (`--write-excerpt`), committed under `tests/fixtures/map/ea-oakland-core-excerpt/` with its attribution file.
- **Districts.** `content/world/areas/ea-oakland-core/districts.json` with simplified authored polygons (≤ 24 vertices each, ODbL-derived, credited): `oak-downtown` (tier B, `cbd`), `oak-jack-london` (B, `tourist-dense`), `oak-lake-merritt` (B, `residential-park`), `oak-west` (C, `industrial`), `oak-port` (C, `industrial`). Neighbourhood slugs come from OSM place names.
- **Landmarks (≥ 8, `lm.oak-<slug>`).** Seeds, confirmed against OSM by build-time lookup (≤ 1 request/s, cached): port gantry cranes (hero), Bay Bridge touchdown tower (hero), city hall, lakeside pavilion, Jack London waterfront, downtown clock tower, rail plaza, West Oakland rail yard. A seed that fails the 120 m rule is replaced, never waived. Brand-bearing venues are fictional (W-15); recipes only, no photographs.
- **POIs.** `content/world/areas/ea-oakland-core/pois.json`: ≥ 60 `PoiRecord`s, id prefix equal to the neighbourhood slug of the point, homes anonymous, each bound to a pedestrian node ≤ 25 m.
- **Transit.** ≥ 4 `bay-rail` `TransitNode`s (`fastTravel: true`) from OSM `railway=station` with factual names; fares by M15a's `crossAreaCents`.
- **Perf path.** `route-portal-ea-oakland-core` (arrival to Lake Merritt) beside the other path files, for the device run in AC-9.

## Scope out
- Berkeley, Emeryville and Richmond: M15c. Missions, races, fighter stages, NPC schedules in Oakland: unscheduled (Act 4+).
- Rooms in Oakland (rooms stay SF-only, M15a).
- Publishing the packs to staging R2: the operator runs `pnpm assets:publish -- --env staging` with the R2 keys.

## Deliverables
- `config/world/areas.json` (entries), `content/world/areas/ea-oakland-core/{districts,pois,landmarks,transit}.json`, `tests/fixtures/map/ea-oakland-core-excerpt/`.
- `tools/map/src/landmarks/oak-*.ts` (eight recipes on the M02d1 kit), `assets/landmarks/oak-*` outputs with provenance (`origin: authored`), `assets/provenance/world/ea-oakland-core/` bake records.
- `tools/map/test/{area.oakland.excerpt.spec.ts, area.oakland.content.spec.ts}`, `packages/world/test/transit.crossArea.spec.ts`.
- `tools/ci/checklists/M15b-iphone15.json`; results under `docs/device-runs/M15b/iphone15/`.

## Interfaces
- C08 1.0: new `PoiRecord`, `LandmarkRecord`, `DistrictRecord`, `TransitNode` and `Portal` instances only; the area index is `data/world-index.ea-oakland-core`. C06 1.1 `UnlockDef.grants.districts` (via M15a). C07 1.1: new `world_pack`, `map_data`, `building` assets. C13 1.1 budgets are read, not changed. No contract change.

## Acceptance criteria
- AC-1 Given the committed excerpt When `ea-oakland-core` is built twice offline Then every pack hash matches, every pack is ≤ 4 MiB, building heights follow the OSM rule table and the kinds and roofs are assigned — proof: `pnpm check:unit -- tools/map`
- AC-2 Given the registry and content files When the content test runs Then districts cover the core without overlap, ≥ 8 landmarks and ≥ 60 POIs exist with well-formed ids, no real business name appears in `pois.json`, and both entries resolve to exactly one portal on each side — proof: `pnpm check:unit -- tools/map && pnpm names:lint`
- AC-3 Given a fresh OSM snapshot When the area is baked and verified Then gates A1–A10 pass: the strongly connected component is ≥ 98 % of drivable edges, a route runs from the arrival to the core centre, every signal junction has ≥ 2 phases, the arrival is on ground ≥ 3 m from water, the area plays inside 30 km², packs total ≤ 80 MiB, the arrival bootset is ≤ 30 MiB, and two runs give identical hashes — proof: `pnpm map:build -- --area ea-oakland-core && pnpm map:verify -- --area ea-oakland-core`
- AC-4 Given the baked landmarks When the seed gate runs Then each is within 120 m of its OSM feature and within its class triangle budget — proof: `pnpm map:landmarks -- --area ea-oakland-core && pnpm check:unit -- tools/map`
- AC-5 Given SF and Oakland both registered When the SF civic excerpt is rebuilt Then its `bakeId` and pack hashes are unchanged, and no secret is in `dist/world` — proof: `pnpm check:unit -- tools/map && pnpm check:secrets -- dist/world`
- AC-6 Given a fast-travel request from an SF station to an Oakland station When Oakland is locked, then unlocked Then the first returns `out-of-bounds` with `world.teleport.areaLocked`, the second charges 600 cents once (idempotency key) and prewarms the destination — proof: `pnpm check:unit -- packages/world`
- AC-7 Given the pack provenance and attribution When the checks run Then every record validates and every attribution string appears in the credits — proof: `pnpm provenance:check && pnpm check:assets && pnpm ip:strings`
- AC-8 Given the branch When the build is verified and previewed Then the production bundle holds no fixture code and Preview is healthy — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-9 Given an iPhone 15 Home Screen app on the staging build with the packs published When the operator unlocks Oakland with `?unlockAll=1`, crosses the Bay Bridge portal and drives 5 minutes in `route-portal-ea-oakland-core` at `mobile-low` Then `perf:verify` passes and no abnormal exit is logged — proof: manual: iPhone 15 Home Screen app, run `tools/ci/checklists/M15b-iphone15.json`, commit `perf.json` and `notes.json`, then `pnpm perf:verify -- docs/device-runs/M15b/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M15b-iphone15.json`

## Test plan
- Unit: the specs above (`pnpm check:unit`). Static gates: `map:build`, `map:verify`, `map:landmarks`. Device: AC-9. CI runs the excerpt build on every PR; the full bake runs nightly with `pnpm map:verify -- --area ea-oakland-core`.

## Demo script
1. `pnpm map:build -- --area ea-oakland-core`; `pnpm map:verify -- --area ea-oakland-core`.
2. Publish to staging (operator), open the staging URL with `?unlockAll=1`.
3. Teleport to the Bay Bridge portal, drive east, cross the fade; or board the ferry portal at the Ferry Building.
4. Open the full map: Oakland is drawn, not grey; search a downtown street.
5. Ride a rail station back to San Francisco.

## Effort
1 Builder session (landmark recipes and POIs are data, not code); about 20 hand-written files; risk medium (bake size, OSM completeness, iPhone memory).

## Risks & fallbacks
- Core exceeds the pack cap: shrink `bboxEnu`, never raise the cap; drop `oak-port` first.
- The Geofabrik route fails (U-W1 as recorded by M02a1): use the fallback it recorded; if none works, report "Blocked on: OSM download" and keep the excerpt ACs (AC-1, AC-2, AC-5).
- Fewer than 8 seeds pass the 120 m rule: add generic civic landmarks (library, ferry terminal) from OSM.
- No iPhone 15 (Q-13): AC-9 is recorded "not run" and Oakland stays `backdrop`.

## Notes for the Builder
- Read first: the M15a file; `02-world-maps.md` §4.2, §8; `02-world-bake.md` §4, §7–§9; `02-world-living.md` §5 for station naming.
- Order: excerpt → registry entry → districts and POIs → bake and verify → landmarks → transit and fares → checklist.
- Gates and stubs: Q-13 (iPhone 15 for AC-9); `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` for `assets:publish` (SKIP line, operator publishes); `DV_NAMES_REAL_JSON` is CI-only, so `names:lint` runs its real-side half there and prints SKIP locally. No fal (DL-OWN-01 untouched). Branch `m15b-oakland-core`.

# M15c — berkeley-richmond

## Goal
After this session the East Bay north of Oakland is playable: `ea-berkeley-richmond` (Berkeley, Emeryville and the Richmond corridor, including the Berkeley hills) is baked from OpenStreetMap and Terrarium z15 with the M15a framework, entered from the Oakland core over a land seam on I-80, and passes every area gate. It is the first area with steep streets, so road grading, hill jump zones and the 40 % grade gate are exercised on real terrain. Oakland and San Francisco bytes do not change. The area opens for players who hold `unlock.area.ea-oakland-core`.

## Requirements
- R-MAP-02: second district in the Bay expansion chain (San Francisco, Oakland, Berkeley and Richmond).
- R-MAP-01: hills and a freeway seam as real traversal, not backdrop.
- R-MAP-03: map pack, stations, ferry node and in-area search.
- R-MAP-04: density profiles and pedestrians (derived sidewalks) for the new districts.
- R-IP-01: OSM and Terrarium credit; fictional venues; no public art reproduced (W-15).
- R-ENG-02: pack and arrival-bootset caps.

## Depends on
- **M15b** (Oakland core baked and registered; the framework of M15a through it). Contracts: C08 1.0, C06 1.1, C07 1.1, C13 1.1 (unchanged).

## Scope in
- **Registry entry.** `ea-berkeley-richmond`: `search` is the §8 box (x 7.0…14.9 km, z −18.9…−7.8 km); `bboxEnu` a core cut inside it with `maxPlayKm2` 30, `maxPackMiB` 80, `arrivalBootsetMiB` 30 (design caps), spanning at least one hills street and one waterfront street; `requires: ['unlock.area.ea-oakland-core']`; one entry from `ea-oakland-core` with `fromPortalAt` set from the Oakland index: the baked `county-line` portal on the core's northern edge nearest I-80 (radius 150 m; the resolver must find exactly one); `arrival` on the first drivable edge of the new area beyond that seam, heading north; `cards`: the Berkeley and Emeryville–Richmond clusters. `status` becomes `playable` only when AC-3 and AC-4 pass.
- **Excerpt in the hills.** A 1 km² excerpt where OSM roads include an edge of grade ≥ 12 %, committed under `tests/fixtures/map/ea-berkeley-richmond-excerpt/`. It exercises S7 grading (24 m moving average, slope clamp 40 %) on terrain the flat Oakland and SF excerpts do not.
- **Districts** (`content/world/areas/ea-berkeley-richmond/districts.json`, authored polygons, ODbL-derived, credited): `bk-downtown` (tier B, `civic-dense`), `bk-hills` (C, `residential`), `bk-waterfront` (C, `sparse`), `em-emeryville` (B, `cbd-tech`), `rc-richmond` (C, `industrial`).
- **Landmarks (≥ 8, `lm.bk-*`, `lm.rc-*`, `lm.em-*`).** Seeds confirmed against OSM at build time: campus bell tower, marina pier, hills overlook, Richmond shipyard cranes, Richmond ferry terminal, waterfront promenade end, bay overlook on I-80, a regional rail station. Anything failing the 120 m rule is replaced. No mural, sculpture or public art, and no university or club marks (W-15).
- **POIs** ≥ 60, fictional business names, homes anonymous, each bound to a pedestrian node ≤ 25 m.
- **Transit.** ≥ 4 `bay-rail` and ≥ 1 `ferry` `TransitNode`s with `fastTravel: true`, factual station names; fares by `crossAreaCents` between areas.
- **Hills content.** `jumpZones` from crest curvature (S9 rules) are kept; `hidingSpots` and `pursuitBreakers` come from the generic OSM derivation only.
- **Unlock chain.** `requires` makes Berkeley reachable only after the first Oakland arrival; `unlock` is `unlock.area.ea-berkeley-richmond`, emitted on its first arrival.

## Scope out
- Marin: M15d. Peninsula and South Bay: M15e, M15f, M15g.
- Missions, races, stages and NPC schedules here: unscheduled (Act 4+).
- Berkeley campus interiors, murals and Richmond refinery detail.
- Publishing packs to staging R2 (operator).

## Deliverables
- `config/world/areas.json` (entries), `content/world/areas/ea-berkeley-richmond/{districts,pois,landmarks,transit}.json`, `tests/fixtures/map/ea-berkeley-richmond-excerpt/`.
- `tools/map/src/landmarks/{bk,rc,em}-*.ts` (eight recipes on the M02d1 kit) and their `assets/landmarks/` outputs with `origin: authored` provenance; `assets/provenance/world/ea-berkeley-richmond/` bake records.
- `tools/map/test/{area.berkeley.excerpt.spec.ts, area.berkeley.content.spec.ts}`, `packages/world/test/areas.unlockChain.spec.ts`.

## Interfaces
- C08 1.0: new `PoiRecord`, `LandmarkRecord`, `DistrictRecord`, `TransitNode`, `Portal` instances; index `data/world-index.ea-berkeley-richmond`. C06 1.1 `grants.districts` through M15a. C07 1.1 new `world_pack`, `map_data`, `building` assets. C13 1.1 read only. No contract change.

## Acceptance criteria
- AC-1 Given the hills excerpt When the area is built twice offline Then pack hashes match, packs are ≤ 4 MiB, the maximum road grade is ≤ 40 %, at least one edge has grade ≥ 12 %, and building heights follow the OSM rule table — proof: `pnpm check:unit -- tools/map`
- AC-2 Given the registry and content files When the content test runs Then districts cover the core without overlap, ≥ 8 landmarks and ≥ 60 POIs have well-formed ids, and both ends of the entry resolve to exactly one portal — proof: `pnpm check:unit -- tools/map && pnpm names:lint`
- AC-3 Given a fresh OSM snapshot When the area is baked and verified Then gates A1–A10 pass: the strongly connected component is ≥ 98 % of drivable edges, a route runs from the arrival to the core centre, signal junctions have ≥ 2 phases, the arrival is on ground ≥ 3 m from water, the core is ≤ 30 km², packs total ≤ 80 MiB, the arrival bootset is ≤ 30 MiB, and two runs give identical hashes — proof: `pnpm map:build -- --area ea-berkeley-richmond && pnpm map:verify -- --area ea-berkeley-richmond`
- AC-4 Given the landmark seeds When the gate runs Then each is within 120 m of its OSM feature and within its class triangle budget — proof: `pnpm map:landmarks -- --area ea-berkeley-richmond && pnpm check:unit -- tools/map`
- AC-5 Given Oakland's excerpt When it is built with the Berkeley entry in the registry and with it removed Then `bakeId` and pack hashes are identical, as are the SF civic excerpt's — proof: `pnpm check:unit -- tools/map && pnpm check:secrets -- dist/world`
- AC-6 Given the registry When `unlock.area.ea-oakland-core` is missing, then held, then held together with `unlock.area.ea-berkeley-richmond` Then the Berkeley portal (in Oakland) is `closed`, `open`, `open`, and the Berkeley `requires` list names only the Oakland unlock — proof: `pnpm check:unit -- packages/world`
- AC-7 Given pack provenance and attribution When the checks run Then records validate and every attribution string appears in the credits — proof: `pnpm provenance:check && pnpm check:assets && pnpm ip:strings`
- AC-8 Given the branch When the production build is verified Then no fixture or QA code ships — proof: `pnpm build && pnpm --filter @dv/web verify:dist`

## Test plan
- Unit: the specs above (`pnpm check:unit`). Static gates: `map:build`, `map:verify`, `map:landmarks`. CI builds the hills excerpt per PR; the full bake runs nightly via `pnpm map:verify -- --area ea-berkeley-richmond`. No device test (the code paths match M15b's).

## Demo script
1. `pnpm map:build -- --area ea-berkeley-richmond`, then `pnpm map:verify -- --area ea-berkeley-richmond`.
2. On a build with `?unlockAll=1`, teleport to the Oakland I-80 portal and drive north.
3. Climb a hills street; check the grade gauge in the QA panel and the jump zone marker on the map.
4. Ride the ferry node back toward Oakland.

## Effort
1 Builder session; about 17 hand-written files; risk medium (steep-road grading, OSM sidewalk gaps, pack size in Richmond industrial land).

## Risks & fallbacks
- The grade gate fails on a real street: do not loosen the 40 % clamp; exclude the street from the core and record it.
- Oakland has no portal on its northern edge: use the nearest Oakland `county-line` portal and put `arrival` on the nearest drivable edge of the new core; record the choice in the PR.
- Pack cap exceeded: shrink `bboxEnu` (Richmond first), never raise the cap.
- OSM download blocked: keep AC-1, AC-2, AC-5, AC-6 and report "Blocked on: OSM download".

## Notes for the Builder
- Read first: the M15a and M15b files; `02-world-bake.md` §4 (S7 grading, S9 tags); `02-world-maps.md` §8.
- Order: Oakland index → choose the seam → hills excerpt → entries → districts, POIs → bake and verify → landmarks → transit → unlock test.
- Gates and stubs: `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` for `assets:publish` (SKIP line); `DV_NAMES_REAL_JSON` CI-only for `names:lint`. No fal. Branch `m15c-berkeley-richmond`.

# M15e — peninsula-north

## Goal
After this session the first stretch of the Peninsula is playable: `pen-north` (Daly City, South San Francisco and the airport surroundings) is baked from OpenStreetMap and Terrarium z15 with the M15a framework, entered over the southern county line by up to three freeway and arterial seams, and passes every area gate. It is the first area with several land entries, so closed county-line walls become open roads, and the first with an airport: the airside is not drivable or walkable. San Francisco's bytes do not change. The area opens for players who hold `unlock.district.d10`.

## Requirements
- R-MAP-02: the Peninsula chain starts here (M15f and M15g depend on it).
- R-MAP-01: the county-line soft wall becomes a road where a seam opens.
- R-MAP-03: map pack, rail stations, ferry node, in-area search.
- R-MAP-04: residential, industrial and sparse density profiles; decorative aircraft.
- R-IP-01: OSM and Terrarium credit; fictional venues; no airport marks or livery.
- R-ENG-02: pack, bootset and chunk-limit gates.

## Depends on
- **M15a** (registry, `--area` bakes, area gates, `AreaDirectory`, handoff). Contracts: C08 1.0, C06 1.1, C07 1.1, C13 1.1 (unchanged).

## Scope in
- **Registry entry.** `pen-north`: `search` is the §8 box (x −7.1…6.1 km, z 7.7…19.9 km); `bboxEnu` a core of `maxPlayKm2` 30, `maxPackMiB` 80, `arrivalBootsetMiB` 30 (design caps) whose northern edge is the SF `play` southern edge (z 8,900 m), so the boxes stay disjoint; `requires: ['unlock.district.d10']`; `unlock: 'unlock.area.pen-north'`; `cards`: the Daly City ridge and Brisbane–SFO clusters. `status` becomes `playable` only when AC-3 and AC-4 pass.
- **Entries (1 to 3).** Read the SF index `portals`; take the `county-line` portals on the southern edge in road-class order (freeways first), at most three; each entry gets `radiusM` 100 and an `arrival` on the matching drivable edge of the core, heading south, at least 100 m from the other arrivals. Remaining SF county-line portals stay closed walls with their current fog, barrier and toast.
- **Open seam.** An `open` county-line portal has no barrier prop, no fog ramp and no `world.boundary.countyLine` toast (find the soft-wall code with `git grep countyLine`); a closed one keeps all three.
- **Airside.** Polygons tagged `aeroway=aerodrome` (and runway, taxiway, apron ways) carry no drivable edges and no pedestrian nodes; ground is `Paved`; a fence of thin prisms (segments ≤ 12 m) follows the boundary, counted against the 1,500-building chunk limit (gate A2). Decorative `aircraft.airliner` corridors from the SF bake are kept; no ground aircraft.
- **Excerpt.** A 1 km² excerpt that includes an airport boundary and a road along it, committed under `tests/fixtures/map/pen-north-excerpt/`.
- **Districts** (`content/world/areas/pen-north/districts.json`, authored polygons, ODbL-derived, credited): `pn-daly-city` (tier B, `residential`), `pn-south-sf` (C, `industrial`), `pn-airport` (C, `sparse`).
- **Landmarks (≥ 8, `lm.pn-*`).** Seeds confirmed against OSM at build time: airport control tower, hillside sign, bay-front marina or ferry landing, ridge overlook, mountain summit overlook, two rail stations, an arena (fictional name). Anything failing the 120 m rule is replaced. Recipes only; no brand marks.
- **POIs** ≥ 60 (fictional venues, anonymous homes, each bound to a pedestrian node ≤ 25 m).
- **Transit.** ≥ 4 `bay-rail` nodes (factual station names) and ≥ 1 `ferry` node, all `fastTravel: true`; fares by `crossAreaCents`.

## Scope out
- Missions, races, stages and NPC schedules here: unscheduled (Act 4+).
- Airside gameplay, terminals and interiors; ground aircraft.
- The Peninsula south of this core: M15f and M15g.
- Publishing packs to staging R2 (operator).

## Deliverables
- `config/world/areas.json` (entries), `content/world/areas/pen-north/{districts,pois,landmarks,transit}.json`, `tests/fixtures/map/pen-north-excerpt/`.
- `tools/map/src/stages/airside.ts` (fence prisms, drivable and pedestrian exclusion), `tools/map/src/landmarks/pn-*.ts` (eight recipes on the M02d1 kit) with `assets/landmarks/` outputs and `origin: authored` provenance; `assets/provenance/world/pen-north/` bake records.
- The soft-wall code found by `git grep countyLine` (edit).
- `tools/map/test/{area.pennorth.excerpt.spec.ts, area.pennorth.content.spec.ts, stage.airside.spec.ts}`, `packages/world/test/boundary.openSeam.spec.ts`.

## Interfaces
- C08 1.0: new `PoiRecord`, `LandmarkRecord`, `DistrictRecord`, `TransitNode`, `Portal` and prism instances; index `data/world-index.pen-north`. C06 1.1 `grants.districts` through M15a. C07 1.1 new assets. C13 1.1 read only. No contract change.

## Acceptance criteria
- AC-1 Given the airport excerpt When the area is built twice offline Then pack hashes match, packs are ≤ 4 MiB, no drivable edge or pedestrian node lies inside the aerodrome polygon, fence prisms follow its boundary, and no chunk exceeds 1,500 buildings including fence prisms — proof: `pnpm check:unit -- tools/map`
- AC-2 Given the registry and content files When the content test runs Then the core box is disjoint from `sf`, ≥ 8 landmarks and ≥ 60 POIs have well-formed ids, one to three entries each resolve to exactly one portal per side, and the arrivals are ≥ 100 m apart — proof: `pnpm check:unit -- tools/map && pnpm names:lint`
- AC-3 Given a fresh OSM snapshot When the area is baked and verified Then gates A1–A10 pass: the strongly connected component is ≥ 98 % of drivable edges, a route runs from each arrival to the core centre, signal junctions have ≥ 2 phases, each arrival is on ground ≥ 3 m from water, the core is ≤ 30 km², packs total ≤ 80 MiB, the arrival bootset is ≤ 30 MiB, and two runs give identical hashes — proof: `pnpm map:build -- --area pen-north && pnpm map:verify -- --area pen-north`
- AC-4 Given the landmark seeds When the gate runs Then each is within 120 m of its OSM feature and within its class triangle budget — proof: `pnpm map:landmarks -- --area pen-north && pnpm check:unit -- tools/map`
- AC-5 Given the selected SF county-line portal and `pen-north` playable When `requires` is met, then unmet Then the portal is `open` with no barrier prop, fog ramp or toast, then `closed` with all three; an unselected county-line portal is `closed` in both cases — proof: `pnpm check:unit -- packages/world`
- AC-6 Given the SF civic excerpt When it is rebuilt with `pen-north` registered Then its `bakeId` and pack hashes are unchanged and `dist/world` holds no secret — proof: `pnpm check:unit -- tools/map && pnpm check:secrets -- dist/world`
- AC-7 Given pack provenance and attribution When the checks run Then records validate and every attribution string appears in the credits — proof: `pnpm provenance:check && pnpm check:assets && pnpm ip:strings`
- AC-8 Given the branch When the production build is verified Then no fixture or QA code ships — proof: `pnpm build && pnpm --filter @dv/web verify:dist`

## Test plan
- Unit: the specs above (`pnpm check:unit`). Static gates: `map:build`, `map:verify`, `map:landmarks`. CI builds the excerpt per PR; the full bake runs nightly via `pnpm map:verify -- --area pen-north`. No device test (streaming paths passed on iPhone in M15b).

## Demo script
1. `pnpm map:build -- --area pen-north`, then `pnpm map:verify -- --area pen-north`.
2. On a build with `?unlockAll=1`, drive south along the freeway entry; the barrier and fog are gone and the fade ends in the new area.
3. Take a surface street entry; compare the arrival points.
4. Walk to the airport boundary: fence, no way in.
5. Ride a rail station back to San Francisco.

## Effort
1 Builder session (all data authored as JSON and recipes); about 19 hand-written files; risk medium (airside exclusion, chunk limits near the airport, three-seam resolution).

## Risks & fallbacks
- A chunk exceeds 1,500 buildings with fence prisms: merge fence segments to ≤ 24 m, then to ≤ 40 m; never raise the limit.
- Fewer than three county-line portals on the southern edge: use what exists (at least one); if none exists, stop and report, since SF's S9 rule guarantees none otherwise.
- Pack cap exceeded: shrink `bboxEnu` from the south first, never raise the cap.
- OSM download blocked: keep AC-1, AC-2, AC-5, AC-6 and report "Blocked on: OSM download".

## Notes for the Builder
- Read first: the M15a file; `02-world-maps.md` §4.1–§4.2, §8; `02-world-bake.md` §4 (S5 exclusions, S9 portals); `02-world-living.md` §5.
- Order: SF portals → excerpt → entries → airside stage → districts, POIs → bake and verify → landmarks → transit → open-seam test.
- Gates and stubs: `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` for `assets:publish` (SKIP line); `DV_NAMES_REAL_JSON` CI-only for `names:lint`. No fal. Branch `m15e-peninsula-north`.

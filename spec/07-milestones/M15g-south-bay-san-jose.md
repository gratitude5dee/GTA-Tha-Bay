# M15g — south-bay-san-jose

## Goal
After this session the Bay expansion chain is complete: `south-bay-sj` (San Jose downtown and Santa Clara) is baked from OpenStreetMap and Terrarium z15 with the M15a framework, entered from `pen-vc-row` by freeway or arterial, and passes every area gate. It is the largest and flattest area, the first with light rail on the surface and the first with a stacked freeway interchange, so surface rail splines and multi-layer slabs are exercised on real data. A whole-registry check closes the series: every playable area reaches San Francisco through a tree of entries, every `requires` names a real unlock, and the regenerated `data/world-areas` lists them all. Earlier areas' bytes do not change. The area opens for players who hold `unlock.area.pen-vc-row`.

## Requirements
- R-MAP-02: the last district of the Bay expansion, and the check that the whole chain holds together.
- R-MAP-01: freeway seams and an interchange stack as traversable roads.
- R-MAP-03: map pack, rail nodes, in-area search.
- R-MAP-04: cbd, cbd-tech, residential and sparse density; light-rail set dressing.
- R-IP-01: OSM and Terrarium credit; fictional venues, arenas and towers; no company marks.
- R-ENG-02: pack, bootset and stacked-layer gates.

## Depends on
- **M15f** (`pen-vc-row` baked and registered; the framework of M15a through it). Contracts: C08 1.0, C06 1.1, C07 1.1, C13 1.1 (unchanged).

## Scope in
- **Registry entry.** `south-bay-sj`: `search` is the §8 box (x 32.5…54.6 km, z 42.1…58.7 km, inside the ±65 km grid); `bboxEnu` a core of `maxPlayKm2` 40, `maxPackMiB` 90 and `arrivalBootsetMiB` 30 (design caps) that holds downtown, a rail hub and one freeway interchange; `requires: ['unlock.area.pen-vc-row']`; `unlock: 'unlock.area.south-bay-sj'`; `cards: []` (the backdrop has no San Jose card; massing cells and the DEM ring are cut out as for any playable area). `status` becomes `playable` only when AC-4 and AC-5 pass.
- **Entries (1 to 2).** From the `pen-vc-row` index `portals`: the two highest-class `county-line` portals on its south-eastern edge, `radiusM` 100, each with an `arrival` on the matching drivable edge of the core, ≥ 100 m apart. If the Builder cut `pen-vc-row` so that none exists, stop and report.
- **Excerpt.** A 1 km² downtown excerpt that includes a light-rail line and a station, committed under `tests/fixtures/map/south-bay-sj-excerpt/`.
- **Light rail.** OSM `railway=light_rail|tram` ways in the core become `city-metro` splines for the M03b2 train set dressing; stops become `TransitNode`s with `fastTravel: false` (not boardable in v1).
- **Interchange stack.** Edges with `layer ≥ 2` get S7 slabs at terrain + 5.5 m × layer; new gate A12 requires slab clearance ≥ 5.5 m between stacked levels and a shared node at every ramp.
- **Airport.** If the airport lies in the core, the M15e `airside` stage applies unchanged.
- **Districts** (`content/world/areas/south-bay-sj/districts.json`, authored polygons, ODbL-derived, credited): `sj-downtown` (tier B, `cbd`), `sj-santa-clara` (B, `cbd-tech`), `sj-willow-glen` (C, `residential`), `sj-guadalupe` (C, `residential-park`), `sj-airport` (C, `sparse`, only if in the core).
- **Landmarks (≥ 8, `lm.sj-*`).** Seeds confirmed against OSM at build time: city hall, the interchange stack (hero), a rail hub, a riverside park footbridge, a downtown theatre, an arena and a stadium (fictional names), a tech tower (fictional). Anything failing the 120 m rule is replaced. Recipes only; no brand marks.
- **POIs** ≥ 60 (fictional venues, anonymous homes, each bound to a pedestrian node ≤ 25 m).
- **Transit.** ≥ 3 `city-metro` stops and ≥ 2 `bay-rail` nodes with `fastTravel: true`; fares by `crossAreaCents`.
- **Chain check.** `tools/map/test/areas.chain.spec.ts` walks `areas.json` after all entries exist.

## Scope out
- Missions, races, stages and NPC schedules in the South Bay: unscheduled (Act 4+).
- Anything south or east of the core (Los Gatos, Milpitas), and the rest of the Bay Area.
- Publishing packs to staging R2 (operator).

## Deliverables
- `config/world/areas.json` (entries), `content/world/areas/south-bay-sj/{districts,pois,landmarks,transit}.json`, `tests/fixtures/map/south-bay-sj-excerpt/`.
- `tools/map/src/verify/area-gates.ts` (gate A12, edit), `tools/map/src/landmarks/sj-*.ts` (eight recipes on the M02d1 kit) with `assets/landmarks/` outputs and `origin: authored` provenance; `assets/provenance/world/south-bay-sj/` bake records.
- `tools/map/test/{area.sj.excerpt.spec.ts, area.sj.content.spec.ts, area.gates.layers.spec.ts, areas.chain.spec.ts}`.

## Interfaces
- C08 1.0: new `PoiRecord`, `LandmarkRecord`, `DistrictRecord`, `TransitNode`, `Portal` and slab instances; index `data/world-index.south-bay-sj`. C06 1.1 `grants.districts` through M15a. C07 1.1 new assets. C13 1.1 read only. No contract change.

## Acceptance criteria
- AC-1 Given the downtown excerpt When the area is built twice offline Then pack hashes match, packs are ≤ 4 MiB, at least one light-rail spline and one `city-metro` stop exist with `fastTravel: false`, and building heights follow the OSM rule table — proof: `pnpm check:unit -- tools/map`
- AC-2 Given a synthetic bake with three stacked levels and a copy with one level 3 m too low When gate A12 runs Then the first passes and the second fails with `A12` — proof: `pnpm check:unit -- tools/map`
- AC-3 Given the registry and content files When the content test runs Then districts cover the core without overlap, ≥ 8 landmarks and ≥ 60 POIs have well-formed ids, each entry resolves to exactly one portal per side, and the arrivals are ≥ 100 m apart — proof: `pnpm check:unit -- tools/map && pnpm names:lint`
- AC-4 Given a fresh OSM snapshot When the area is baked and verified Then gates A1–A10 and A12 pass: the strongly connected component is ≥ 98 % of drivable edges, a route runs from each arrival to the core centre, signal junctions have ≥ 2 phases, each arrival is on ground ≥ 3 m from water, the core is ≤ 40 km², packs total ≤ 90 MiB, the arrival bootset is ≤ 30 MiB, and two runs give identical hashes — proof: `pnpm map:build -- --area south-bay-sj && pnpm map:verify -- --area south-bay-sj`
- AC-5 Given the landmark seeds When the gate runs Then each is within 120 m of its OSM feature and within its class triangle budget — proof: `pnpm map:landmarks -- --area south-bay-sj && pnpm check:unit -- tools/map`
- AC-6 Given the whole registry When the chain test runs Then every playable area reaches `sf` through entries (a tree, no cycle), every `requires` names `unlock.district.d10` or the `unlock.area.*` of an ancestor, playable boxes are pairwise disjoint, and the `world-areas` stage, run with stub `bakeId`s, validates against `world-areas.schema.json` and lists each playable area once — proof: `pnpm check:unit -- tools/map && pnpm check:unit -- packages/world`
- AC-7 Given the SF civic excerpt and `pen-vc-row`'s excerpt When each is rebuilt with `south-bay-sj` registered and with it removed Then `bakeId` and pack hashes are identical, and `dist/world` holds no secret — proof: `pnpm check:unit -- tools/map && pnpm check:secrets -- dist/world`
- AC-8 Given pack provenance and attribution When the checks run Then records validate and every attribution string appears in the credits — proof: `pnpm provenance:check && pnpm check:assets && pnpm ip:strings`
- AC-9 Given the branch When the production build is verified and previewed Then no fixture or QA code ships and Preview is healthy — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- Unit: the specs above (`pnpm check:unit`). Static gates: `map:build`, `map:verify`, `map:landmarks`. CI builds the excerpt per PR; the full bake runs nightly via `pnpm map:verify -- --area south-bay-sj`. No device test.

## Demo script
1. `pnpm map:build -- --area south-bay-sj`, then `pnpm map:verify -- --area south-bay-sj`.
2. On a build with `?unlockAll=1`, fast travel from San Francisco to a South Bay rail node.
3. Drive the interchange stack on the lowest and highest level.
4. Watch a light-rail train stop at a downtown station.
5. Open the full map and zoom out: every playable area is drawn from its own pack.

## Effort
1 Builder session (data as JSON and recipes); about 18 hand-written files; risk medium (largest OSM extract, stacked layers, light-rail splines).

## Risks & fallbacks
- The extract is too large for the CI runner: bake only the core's bounding rectangle plus the stream margin; never widen the core.
- Stacked slabs fail A12 on a real interchange: cut the interchange out of the core (the freeway then ends at a seam) and record it.
- Light rail ways are broken in OSM: skip the spline for that line and keep the stops.
- OSM download blocked: keep AC-1, AC-2, AC-3, AC-6, AC-7 and report "Blocked on: OSM download".

## Notes for the Builder
- Read first: the M15a and M15f files; `02-world-bake.md` §4 (S7 slabs, S9 portals); `02-world-living.md` §5 (City Metro).
- Order: `pen-vc-row` index → excerpt → entries → districts, POIs → bake and verify → A12 → landmarks → transit → chain test (last).
- Gates and stubs: `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` for `assets:publish` (SKIP line); `DV_NAMES_REAL_JSON` CI-only for `names:lint`. No fal. Branch `m15g-south-bay-san-jose`.

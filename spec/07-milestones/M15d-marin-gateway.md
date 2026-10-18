# M15d — marin-gateway

## Goal
After this session the Golden Gate is a road you can cross: `marin-gateway` (Sausalito, the waterfront and the Marin Headlands) is baked from OpenStreetMap and Terrarium z15 with the M15a framework, entered through the existing San Francisco portal `portal.ggb`, and passes every area gate. It is the smallest area, the first with long coastline and cliffs, and the first whose road network includes a tunnel mouth right behind the seam. San Francisco's bytes do not change. The area opens for players who hold `unlock.district.d10`.

## Requirements
- R-MAP-02: Marin as the first district north of the city.
- R-MAP-01: the Golden Gate stops being a wall; the bridge deck stays in SF, the seam sits at its north end.
- R-MAP-03: map pack, ferry node and in-area search.
- R-MAP-04: sparse and tourist density profiles; boats on the shoreline spawn slots.
- R-IP-01: OSM and Terrarium credit; fictional venues; original landmark recipes.
- R-ENG-02: pack and arrival-bootset caps.

## Depends on
- **M15a** (registry, `--area` bakes, area gates, `AreaDirectory`, handoff). Contracts: C08 1.0, C06 1.1, C07 1.1, C13 1.1 (unchanged).

## Scope in
- **Registry entry.** `marin-gateway`: `search` is the §8 box (x −8.9…−2.7 km, z −12.3…−4.5 km); `bboxEnu` a core with `maxPlayKm2` 25, `maxPackMiB` 60, `arrivalBootsetMiB` 30 (design caps) whose southern edge is the SF `play` northern edge (z −6,300 m), so the boxes stay disjoint; `requires: ['unlock.district.d10']`; `unlock: 'unlock.area.marin-gateway'`; one entry from `sf` at `portal.ggb` (radius 100 m); `arrival` on the first drivable Marin edge beyond the bridge's north end, heading north (the gap is about one kilometre of bridge, drawn by the far prop during the fade); `cards`: the Marin Headlands and Sausalito–Tiburon clusters. `status` becomes `playable` only when AC-4 and AC-5 pass.
- **Excerpt.** A 1 km² excerpt on the Sausalito waterfront (streets plus shore), committed under `tests/fixtures/map/marin-gateway-excerpt/`; it exercises coastline assembly and `shoreNodes` in a town.
- **Tunnel and cliff handling.** Any drivable `tunnel=yes` way inside the core gets S7 hoods over its whole length and its mouths become `chokePoints`; cliff and rock cells get `GroundClass.Rock`; the water soft wall and swim respawn use the new area's `shoreNodes`.
- **Districts** (`content/world/areas/marin-gateway/districts.json`, authored polygons, ODbL-derived, credited): `mg-sausalito` (tier B, `tourist-dense`), `mg-headlands` (C, `sparse`), `mg-bridgeway` (C, `residential`).
- **Landmarks (≥ 6, `lm.mg-*`).** Seeds confirmed against OSM at build time: headlands overlook, bridge north anchorage, fort pier, Sausalito ferry terminal, a beach or cove on the Headlands, a hillside battery. Anything failing the 120 m rule is replaced. Recipes only; no photographs.
- **POIs** ≥ 40 (fictional shops, cafes, offices; homes anonymous; each bound to a pedestrian node ≤ 25 m).
- **Transit.** ≥ 1 `ferry` `TransitNode` (`fastTravel: true`); fares by `crossAreaCents`.
- **Seal.** The existing `PursuitApi.sealedPortals` seal at heat 5 applies to `portal.ggb`; the handoff refuses at heat > 0 with `world.portal.heat`.

## Scope out
- Marin County beyond the Headlands and Sausalito (Mill Valley, Tiburon, San Rafael): not scheduled.
- Missions, races, stages and NPC schedules in Marin: unscheduled (Act 4+).
- Publishing packs to staging R2 (operator).

## Deliverables
- `config/world/areas.json` (entries), `content/world/areas/marin-gateway/{districts,pois,landmarks,transit}.json`, `tests/fixtures/map/marin-gateway-excerpt/`.
- `tools/map/src/landmarks/mg-*.ts` (six recipes on the M02d1 kit) with `assets/landmarks/` outputs and `origin: authored` provenance; `assets/provenance/world/marin-gateway/` bake records.
- `tools/map/src/verify/area-gates.ts` (gate A11: every drivable tunnel edge has hoods over its full length; edit).
- `tools/map/test/{area.marin.excerpt.spec.ts, area.marin.content.spec.ts, area.gates.tunnel.spec.ts}`.

## Interfaces
- C08 1.0: new `PoiRecord`, `LandmarkRecord`, `DistrictRecord`, `TransitNode`, `Portal`, hood and shore instances; index `data/world-index.marin-gateway`. C06 1.1 `grants.districts` through M15a. C07 1.1 new assets. C13 1.1 read only. No contract change.

## Acceptance criteria
- AC-1 Given the waterfront excerpt When the area is built twice offline Then pack hashes match, packs are ≤ 4 MiB, at least 20 `shoreNodes` exist with outward normals, and building heights follow the OSM rule table — proof: `pnpm check:unit -- tools/map`
- AC-2 Given the registry and content files When the content test runs Then the core box is disjoint from `sf`, ≥ 6 landmarks and ≥ 40 POIs have well-formed ids, and the entry resolves to `portal.ggb` on the SF side and exactly one portal on the Marin side — proof: `pnpm check:unit -- tools/map && pnpm names:lint`
- AC-3 Given a drivable way tagged `tunnel=yes` in a synthetic test bake and its copy with the hoods removed When gate A11 runs Then the first passes and the second fails with `A11` — proof: `pnpm check:unit -- tools/map`
- AC-4 Given a fresh OSM snapshot When the area is baked and verified Then gates A1–A11 pass: the strongly connected component is ≥ 98 % of drivable edges, a route runs from the arrival to the core centre, signal junctions have ≥ 2 phases, the arrival is on ground ≥ 3 m from water, the core is ≤ 25 km², packs total ≤ 60 MiB, the arrival bootset is ≤ 30 MiB, and two runs give identical hashes — proof: `pnpm map:build -- --area marin-gateway && pnpm map:verify -- --area marin-gateway`
- AC-5 Given the landmark seeds When the gate runs Then each is within 120 m of its OSM feature and within its class triangle budget — proof: `pnpm map:landmarks -- --area marin-gateway && pnpm check:unit -- tools/map`
- AC-6 Given the SF civic excerpt When it is rebuilt with `marin-gateway` registered Then its `bakeId` and pack hashes are unchanged and `dist/world` holds no secret — proof: `pnpm check:unit -- tools/map && pnpm check:secrets -- dist/world`
- AC-7 Given a pursuit at heat 0, 1 and 5 near `portal.ggb` with Marin playable and `requires` met When the portal state and the handoff are asked Then they are `open` and allowed at 0, `open` but refused with `world.portal.heat` at 1, and `sealed` at 5 — proof: `pnpm check:unit -- packages/world`
- AC-8 Given pack provenance and attribution When the checks run Then records validate and every attribution string appears in the credits — proof: `pnpm provenance:check && pnpm check:assets && pnpm ip:strings`
- AC-9 Given the branch When the production build is verified Then no fixture or QA code ships — proof: `pnpm build && pnpm --filter @dv/web verify:dist`

## Test plan
- Unit: the specs above (`pnpm check:unit`). Static gates: `map:build`, `map:verify`, `map:landmarks`. CI builds the excerpt per PR; the full bake runs nightly via `pnpm map:verify -- --area marin-gateway`. No device test: the streaming path was exercised on iPhone in M15b.

## Demo script
1. `pnpm map:build -- --area marin-gateway`, then `pnpm map:verify -- --area marin-gateway`.
2. On a build with `?unlockAll=1`, teleport onto the Golden Gate deck and drive north.
3. Fade at the seam, arrive on the Marin side; drive through the tunnel mouth.
4. Open the full map; take the Sausalito ferry node back.
5. Raise heat to 5 near the bridge: the portal seals.

## Effort
1 Builder session; about 15 hand-written files; risk medium (coastline assembly, tunnel hoods, steep cliffs).

## Risks & fallbacks
- Tunnel hoods look wrong or collide (R-S02-01): shorten the core so the tunnel mouth is the northern edge, drop the tunnel from the drivable set, and record it.
- The SF `play` edge and the bridge end differ from the numbers above: keep the core disjoint from `sf`; the seam is where the SF bake left the bridge closed.
- Fewer than 6 seeds pass the 120 m rule: add generic civic points (library, ferry terminal) from OSM.
- OSM download blocked: keep AC-1, AC-2, AC-3, AC-6, AC-7 and report "Blocked on: OSM download".

## Notes for the Builder
- Read first: the M15a file; `02-world-maps.md` §4.1–§4.2, §8; `02-world-bake.md` §4 (S3 coastline, S7 hoods, S9 portals); `02-world-living.md` §1.8.
- Order: excerpt → entries → districts, POIs → bake and verify → tunnel gate → landmarks → transit → seal test.
- Gates and stubs: `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` for `assets:publish` (SKIP line); `DV_NAMES_REAL_JSON` CI-only for `names:lint`. No fal. Branch `m15d-marin-gateway`.

# M15a — bay-expansion-framework

## Goal
After this session the world can hold more than San Francisco without touching SF. An area registry (`config/world/areas.json`) lists the six expansion areas next to `sf`; `pnpm map:build` and `pnpm map:verify` take `--area <id>`, bake from OpenStreetMap and Terrarium only, and refuse a source whose licence is not allow-listed; each area gets its own `bakeId`, `data/world-index.<id>` and an entry in the runtime catalog `data/world-areas`. A portal handoff (prewarm, fade, place, rebase) moves a player between areas, tested on a hand-authored two-area fixture (`portal-pair`). Bounds, saves, the map and the backdrop learn about areas. No real geometry ships here: every area stays `backdrop`.

## Requirements
- R-MAP-02: the framework that turns backdrop into districts (maps §8).
- R-MAP-01: bridge and county-line portals become handoffs instead of walls.
- R-MAP-03: the map selects its pack by area.
- R-IP-01: every source carries an allow-listed licence and attribution; fixtures are original.
- R-ENG-02: the arrival bootset stays within the 30 MB cold-download budget.
- R-ROLL-02 (support): the pose validator reads area bounds; rooms stay SF-only.

## Depends on
- **M14a** (last v1 milestone). Contracts: C08 1.0 (`AreaRecord`, `WorldIndex`, `Portal`, packs `DVWP` 1: unchanged), C06 1.1 (`UnlockDef.grants.districts`), C07 1.1, C13 1.1, C05 1.1 (unchanged).

## Scope in
- **Registry.** Config types in `tools/map/src/areas.ts`. Per area: `id`; `status`; `search` (rough lat/lng box from `02-world-maps.md` §8); `bboxEnu` (the playable core, `null` while backdrop; `AreaRecord.bboxEnu`); `unlock` and `requires` (`UnlockEventId`s; `unlock.area.<id>`); `recipe {buildings: 'osm', terrainZoom: 15, extract}`; `caps {maxPlayKm2, maxPackMiB, arrivalBootsetMiB: 30}`; `min {landmarks, pois}`; `entries` (≥ 1 seams, each `{from, fromPortalAt, radiusM, arrival: {lat, lng, yawDeg}}`); `cards` (far-bay card cluster ids); `excerpt`. Only `id`, `search`, `bboxEnu`, `recipe`, shared bake configs, raw hashes and tool version enter a `bakeId`; the rest is release metadata.
- **Per-area bakes.** `--area <id>` selects the area; `--excerpt` builds from `tests/fixtures/map/<id>-excerpt/` offline; `--write-excerpt <lat>,<lng>` writes that 1 km² excerpt from the cached raw snapshot. It emits `dist/world/<bakeId>/`, `data/world-index.<id>`, `map_data/<id>-map.v1`, provenance and attribution. The home bake (`sf`) keeps its `bakeId` (= C05 `worldBake`) and its pack bytes (AC-3). The ADR records this reading of ADR-0021 ("one bake has one `bakeId`").
- **Licence gate.** `config/world/source-licences.json` allow-lists `ODbL-1.0` and Terrarium's public-domain entry; S0 stops on any other id before downloading.
- **Area gates** (`verify/area-gates.ts`; `map:verify -- --area <id>`, or `--fixture <name>` for A2–A4 only): A1 sources and licences; A2 packs ≤ 4 MiB each, total ≤ `maxPackMiB`, core ≤ `maxPlayKm2`, dropped buildings ≤ 2 %; A3 graph (strongly connected component ≥ 98 % of drivable edges, a route from arrival to the core centre, ≥ 2 phases per signal junction, grade ≤ 40 %); A4 portals (each entry resolves to exactly one portal on each side, arrival on a drivable edge, ground ≥ 3 m from water); A5 landmarks within 120 m of their OSM feature and inside the class triangle budgets; A6 POIs ≥ `min.pois`, each bound to a pedestrian node ≤ 25 m; A7 attribution and provenance; A8 two runs equal; A9 the home `bakeId` and pack hashes are unchanged; A10 arrival bootset ≤ `arrivalBootsetMiB`.
- **OSM building recipe** (stage `buildings-osm`, the Atlas rules): `height` (number, optional ` m`), else `building:levels × 3.3 + 1.2`, else a type heuristic from `config/world/area-recipes/osm-heights.json` († design values: house 7.5, apartments 15, commercial/retail/office 12, industrial/warehouse 9, garage/shed 3.5, other 8); clamp 3.5–340 m; ring cleaning, kinds and roofs as S4 rules 2, 4, 5. Roads, signals, pedestrian graph, tags and spawn tables reuse S5–S9 on OSM data.
- **Generic portals.** S9 emits one `Portal` per bridge/ferry way or drivable edge that leaves the core, `toArea: null`, `state: 'closed'`. Each entry selects one parent-side portal (exactly one within `radiusM`) and the child-side return portal near `arrival`; the runtime resolves them.
- **Runtime.** `AreaDirectory` loads `data/world-areas` at boot and each area index only when the player is within the prewarm radius or inside the area. `portalStateOf` is `sealed` if the pursuit sealed it, `open` if the target is `playable` and every `requires` is held, else `closed`; scripted S03 opens win; the first arrival emits the area's `unlock` once (`UnlockApi.emit`). The handoff: `idle→prewarming→ready→fading→placing→arrived|failed`, 600 m prewarm radius †, 480-tick prewarm timeout (8 s, maps §5), 12-tick fade, heat > 0 blocks. Placing reuses the `TeleportApi` ground cast and calls `PhysicsBackend.rebase` when the move exceeds 1,000 m. The directory registers one `UnlockDef` per area (`grants.districts: [<id>]`, `titleKey: world.area.<id>`). Cross-area fast travel runs the same pipeline at `crossAreaCents` 600 † (`config/world/transit.json`) and needs the target area's `unlock`.
- **Bounds.** `isInsidePlay(areas, unlocked, x, z)` in `@dv/shared`; the save loader's position check and the rooms pose validator call it; rooms pass the constant `['sf']`, so shipping an area never widens a room.
- **Map and backdrop.** `packFor(x, z)` picks `sf-map.v1` or `<id>-map.v1`; a playable area hides its far-bay massing cells and cards and gets a DEM-ring cut-out like the SF box (M02b1).
- **Overture spike** (Q-MAP-06, time-boxed, throwaway script not committed): compare Overture and OSM buildings on the SF civic excerpt against DataSF heights and record the outcome; adoption is out of scope.

## Scope out
- Real geometry for any area: M15b (Oakland), M15c, M15d, M15e, M15f, M15g.
- Story, races, stages and NPC schedules for new areas (Act 4+, unscheduled).
- Rooms in expansion areas; an Overture importer (only if the owner overrides Q-MAP-06).

## Deliverables
- Config: `config/world/{areas.json, source-licences.json}`, `config/world/area-recipes/{osm-heights.json, buildings-source.json}`; schemas `tools/map/schemas/{areas.schema.json, world-areas.schema.json}`; `data/world-areas` (`world-areas/1`): `{home, areas: [{id, status, bboxEnu, unlock, requires, indexAsset, bakeId, entries: [{from, fromPortalId, toPortalId, arrival}], cards}]}`.
- `tools/map/src/{areas.ts, excerpt.ts, stages/buildings-osm.ts, stages/world-areas.ts, verify/area-gates.ts, fixtures/portal-pair.ts}`; edits to `cli.ts` (`--area`, `--excerpt`, `--write-excerpt`, `--fixture`), `landmarks` (`--area`), attribution writer.
- `packages/shared/src/world/{areas.ts, portal-handoff.ts}` (pure, C02 lint): `areaOfPoint`, `unionPlay`, `isInsidePlay`, `nextHandoff`.
- `packages/world/src/areas/{directory.ts, handoff.ts}`, `packages/world/src/client/map/map-packs.ts`; edits to the save-loader position check (`git grep "nearest safehouse"`), the rooms pose validator (`git grep world.bounds services/rooms`), `TeleportApi` bounds check and fare, `config/world/transit.json`, `packages/ui/src/i18n/en.json` (`world.portal.{locked,heat,notLoaded}`, `world.teleport.areaLocked`, `world.area.<id>`).
- Fixture `tests/fixtures/world/portal-pair/` (generated: four packs `p0-`/`l0-64-64` and `-66-64`, `world-areas.json`, `hashes.json`, four `origin: authored` provenance records via `pnpm provenance:new`): `fx-a` (tile 7/64/64) and `fx-b` (tile 7/66/64, ground 3.4 m higher) are 1,536 m apart, each with one E–W road, two boxes and a `bridge` portal at its inner end.
- Path `portal-pair-crossing` next to the `route-ferry-ocean-beach` path file; QA bridge members `world.loadFixture(name)` and `world.areaState()` (QA builds, no URL flag).
- Tests: `packages/shared/test/world.areas.spec.ts` (areas and the handoff machine), `packages/world/test/{areas.directory.spec.ts (with map packs), areas.handoff.spec.ts}`, `packages/engine/test/save.areaPosition.spec.ts`, an extension of the rooms pose-validation Workers suite (`git grep -l cheat_speed services/rooms`), `tools/map/test/{areas.spec.ts (registry, licences, SF stability, spike record), buildings.osm.spec.ts, areas.gates.spec.ts, fixture.portalPair.spec.ts}`, `tests/e2e/world-portal.spec.ts` (`@world-portal`).
- `docs/decisions/ADR-<next free number>-multi-area-world.md` (per-area bakes, stable home `bakeId`, rooms SF-only), `docs/spikes/M15a-overture.md`.

## Interfaces
- C08 1.0: `AreaRecord`, `WorldIndex`, `Portal`, `DVWP` v1 as written; per-area index files and `data/world-areas` sit beside it. `02-world-contracts.md` §7 calls new `AreaRecord`s a minor bump, §5 lists the six areas as `backdrop` in the v1 index; this file follows §5 and the Architect confirms.
- C06 1.1 `UnlockDef.grants.districts`; C05 1.1 `worldBake` = the home index `bakeId`; C07 1.1 kinds `world_pack`, `map_data`, `data`; C13 1.1 budgets. No contract change.

## Acceptance criteria
- AC-1 Given `areas.json` When the registry test runs Then seven areas exist, ids match `^[a-z0-9-]{2,32}$`, every non-null `bboxEnu` lies inside the ±65 km grid, playable boxes are pairwise disjoint, `sf.bboxEnu` equals `config/world.bounds.json` `play`, and every other area is `backdrop` or `playable` with a non-null box — proof: `pnpm check:unit -- tools/map`
- AC-2 Given a source entry whose licence is not allow-listed When S0 starts Then the bake stops before any download with the source id in the error — proof: `pnpm check:unit -- tools/map`
- AC-3 Given the SF civic excerpt When it is built with the full registry and with a registry holding only `sf` Then `bakeId` and every pack hash are identical — proof: `pnpm check:unit -- tools/map`
- AC-4 Given the OSM height table (explicit `height`, `12 m`, levels, house, apartments, warehouse, no tags, 900 m) When `buildings-osm` runs Then heights are 45, 12, 17.7, 7.5, 15, 9, 8 and 340 m (clamped) — proof: `pnpm check:unit -- tools/map`
- AC-5 Given the spike ran or was blocked When `buildings-source.json` is validated Then `source` is `osm`, `spike` is one of `better`, `not-better`, `blocked`, and `docs/spikes/M15a-overture.md` exists — proof: `pnpm check:unit -- tools/map`
- AC-6 Given `portal-pair` When the fixture is regenerated and verified Then hashes equal the committed ones and the gates pass (A3 graph, A4 portals reciprocal, arrival on ground ≥ 3 m from water, packs ≤ 4 MiB); three mutated copies (arrival in water, no return portal, oversize pack) each fail with their gate id — proof: `pnpm map:fixture portal-pair --check && pnpm map:verify -- --fixture portal-pair && pnpm check:unit -- tools/map`
- AC-7 Given scripted ticks in Node When `fx-b` is `backdrop`, then `playable` with its `requires` unmet, then met Then the portal is `closed`, `closed`, `open`; heat > 0 blocks; a missing destination at tick 480 returns `not-loaded` and the player stays; success places the player on the `fx-b` arrival ground and calls `rebase` once (1,536 m); fast travel to an `fx-b` node is refused with `world.teleport.areaLocked` until its `unlock` is held, then charges 600 cents once — proof: `pnpm check:unit -- packages/world packages/shared`
- AC-8 Given the browser build When the player walks the `fx-a` approach with `?unlockAll=1` in Chromium and WebKit Then `areaState()` reports `fx-a`, `prewarming`, `fading`, `fx-b`; at most one chunk uploads per frame; no `PackUnavailable` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @world-portal && pnpm check:e2e -- --project=webkit-webgl2 --grep @world-portal`
- AC-9 Given areas `sf` and `fx-b` When a saved position inside `fx-b` loads without, then with the `fx-b` unlock, and a room pose inside `fx-b` is validated Then the loader snaps to the nearest safehouse, then accepts the position, and the rooms validator rejects the pose both times — proof: `pnpm check:unit -- packages/engine/test -t save.areaPosition && pnpm check:workers`
- AC-10 Given the map directory When `sf` is playable and the others are backdrop Then `packFor` returns `sf-map.v1` in SF and `null` (grey silhouette) elsewhere, and flipping an area to playable swaps it — proof: `pnpm check:unit -- packages/world`
- AC-11 Given the SF scenario When it runs Then render objects and uploads stay within the tier budget on `chromium-webgl2` — proof: `pnpm check:perf -- --scenario route-ferry-ocean-beach`
- AC-12 Given the branch When provenance, names and strings are checked Then fixtures have valid records and no gate reports a hit — proof: `pnpm provenance:check && pnpm names:lint && pnpm ip:strings && pnpm check:i18n`
- AC-13 Given the production build When verified and previewed Then no fixture or QA code ships and Preview is healthy — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- Unit: the specs above. Integration: `map:fixture`, `map:verify -- --fixture`. E2E: `@world-portal`. Device: M15b.

## Demo script
1. `pnpm map:fixture portal-pair`, then `pnpm map:verify -- --fixture portal-pair`.
2. `pnpm dev`, open `/?unlockAll=1`, run `__dvBridge.world.loadFixture('portal-pair')`.
3. Walk east; watch `__dvBridge.world.areaState()`; the fade ends in `fx-b` on higher ground.
4. Reload without `unlockAll`: the portal stays closed (`world.portal.locked`).

## Effort
1 Builder session (data work sits in M15b–M15g); about 39 files touched, generated data excluded; risk medium-high.

## Risks & fallbacks
- File budget: drop `map-packs.ts` (AC-10) and the e2e spec (AC-8); keep AC-7.
- Overture data not fetchable with a pnpm-installable tool: write `blocked`, keep `osm`.
- The home `bakeId` cannot stay stable (an SF stage reads areas): stop and report; the Architect chooses between per-area bakes and one composite bake.
- Rollback: packs ship through the catalog pointer, so a rollback restores `backdrop`.

## Notes for the Builder
- Read first: `02-world-maps.md` §3–§6, §8; `02-world-bake.md` §2–§5; `02-world-contracts.md` §1, §5. Never edit contracts.
- Order: registry and schemas, shared pure functions, `buildings-osm`, licence gate, `--area` plumbing and the SF-stable test (early), fixture, handoff, bounds, save, rooms, map, backdrop, e2e, spike (last, 1 h cap).
- Handoff sim steps count ticks; the fade is a main-thread message.
- No secrets; `assets:publish` SKIPs without `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`; no fal (DL-OWN-01 untouched). Branch `m15a-bay-expansion-framework`.

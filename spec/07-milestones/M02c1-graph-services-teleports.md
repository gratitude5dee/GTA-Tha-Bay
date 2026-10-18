# M02c1 — graph-services-teleports

## Goal
After this session the baked city answers questions and moves the player. `@dv/world` implements the C08 service interfaces of `02-world-contracts.md` §3 in its sim half: `RoadGraphQuery` with A* over resident lanes and the always-resident `sf-graph.v1` topology, the junction runtime (signal aspects from the pure `signalAspect`), `TrafficControl` (blackout, density overrides, closures), the data side of `MapApi` (blips, waypoint, GPS route), `WorldQuery` (ground, water, neighbourhood and district lookups), `TeleportApi` (validate, pre-stream, fade, place), `WorldResolver` and `PlaceIndex` (landmarks, POIs, ped routes, place search over names). The bake writes `data/district-grid.v1`. One `WorldApi` object wires them together for the engine and, from M04a1, for `ModeContext.world`. The player can teleport to any landmark from the sandbox list.

## Requirements
- R-MAP-01: positions, streets, neighbourhoods and landmarks resolve to the real baked geometry (`resolve`, `snap`, `nhoodAt`).
- R-MAP-03: GPS routes, blips and teleports (sandbox and fast travel) exist as the services the minimap and full map (M02c2) draw.

## Depends on
- **M02a2:** road graph sections, junctions and signal programs, ped graph, tags, landmarks with arrival poses, POIs, `sf-graph.v1` and `graph-codec.ts`, `synth` with roads.
- **M02b1:** `ChunkStore` (residency, `needNow` requests), statics feed, world boot, `DV_WORLD=synth` CI builds.
- Contracts: C08 1.0 (`c08-api.ts` interfaces implemented verbatim; `signalAspect`, `chunkKeyOf`), C06 1.1 (`ModeContext.world: WorldApi`, implemented here and wired into the context later), C01 1.0 (Control states 700/701 for teleport).

## Scope in
- **Graph** (`packages/world/src/sim/graph/`): adjacency from resident `p0` EDGE and JUNCTION sections plus `sf-graph.v1`; A* with a binary heap, ties broken by edge id, `maxExpand`, `avoid`, `classMask`, `allowWrongWay`, `useTopology`; lane-level inside resident chunks and topology beyond, `complete: false` when the expansion cap stops the search; `etaS` from edge speeds; `laneCentre` per C08 rule 10; `nearestEdge` with optional `y` to separate layers; `resolve(lat, lng)` through the C08 frame constants; `signal(node, movement)` from `signalAspect(program, tick, movement, blackout)`; `neighbours`.
- **`TrafficControl`** (`src/sim/traffic/control.ts`): adopts M02b2's hashed blackout resource; `setDensity(kind, mult, by)` with 0–1.5 clamp and owner release; `closeEdges(edges, by)` marks edges closed for planning (A* avoids them); `release(by)`. Barrier props for closures attach in M03a1 (prefab `prop.barrier`).
- **`MapApi`** data (`src/sim/map/map-api.ts`): blip table with priorities, waypoint, `setRoute` (GPS polyline from A* on drivable classes), published as a view-model patch at `SimStage.Publish`; views are M02c2.
- **`WorldQuery`** (`src/sim/api/query.ts`): `groundY` from heightfield, slabs and hoods (`yHint` picks the layer), `isWater` from GROUND classes, `nhoodAt` and `districtAt` from `data/district-grid.v1` and `content/world/districts.json`, `chunkReady`, `nearestWalkable` on the ped graph.
- **District grid** (`tools/map/src/stages/s12-district-grid.ts`): 64 m cells over `play`, `u8` neighbourhood index (255 none), from the neighbourhood polygons fetched in M02a1; packed as `data/district-grid.v1` (`map:pack`), listed in the world index; reproducible.
- **`TeleportApi`** (`src/sim/api/teleport.ts`, `02-world-maps.md` §5): kinds `sandbox`, `fast-travel`, `xr-comfort`, `respawn`, `debug`; validation order mode rules, heat, bounds, cooldown (30 s fast travel); a `TeleportPolicy` hook decides mode rules (default: the session is sandbox until ModeHost lands in M04a2; heat is 0 until M03c); targets `{x, z, yaw?}`, `{landmark}` (arrival pose) or `{node}` (`teleportNodes`, transit entrances); pre-stream the destination `p0` tile plus a one-tile ring as `needNow`, wait ≤ 8 s, else `not-loaded` with `world.teleport.notLoaded` and the player unmoved; fade out ≤ 200 ms, Control 700, colliders wait (701); place by casting down from `y + 300 m`, reject water (`water`) and prisms (`blocked`) by searching the nearest valid arrival or walkable point within 40 m; fade in. Fast-travel fares (`config/world/transit.json`, integer cents) are recorded but not charged until `EconomyApi` lands (M04a2). Message keys go to `packages/ui/src/i18n/en.json`.
- **`WorldResolver`** (`src/sim/api/resolver.ts`): `bake` = `WorldIndex.bakeId`; `toEnu`; `landmark(id)` with chunk key; `snap` with modes `ground`, `road`, `sidewalk`, `none`, returning `null` when the nearest valid target is > 25 m away; `route(via)` as A* between consecutive points.
- **`PlaceIndex`** (`src/sim/api/places.ts`): `landmarks()`, `landmark`, `poi`, `poisNear(x, z, r, kind?)`, `poiPos`, `pedRoute(a, b)` (decimated, ≤ 64 points, on the topology graph), `findPlace(text, limit)` over landmark and POI labels (prefix and token match); the geocoder (`sf-geocode.v1`) plugs in at M02c2.
- **`WorldApi` wiring** (`src/sim/api/world-api.ts`): `createWorldApi(store, index, clock)` returns `{graph, traffic, map, teleport, query, places, resolver}`; registered through the engine sim-module hook so `packages/engine/src/sim/world/` exposes it to S01 code and tests; `__dvBridge.world.teleport(id)`, `route(a, b)`, `resolve(lat, lng)` in QA builds.

## Scope out
- Minimap, full map, blip rendering, geocoder, map attribution surfaces: M02c2. Ambient agents obeying signals: M03b1. Fare charging: M04a2. Story fast-travel rules (story `TeleportPolicy`): M05c2 (DL-292). XR comfort arcs (the kind exists; its UI is M11b1). Rooms (`EV TeleportGrant`): M12b1.

## Deliverables
- `packages/world/src/sim/graph/{adjacency.ts, astar.ts, heap.ts, query.ts, junctions.ts}`, `src/sim/traffic/control.ts`, `src/sim/map/map-api.ts`, `src/sim/api/{query.ts, teleport.ts, resolver.ts, places.ts, world-api.ts}`, `src/client/teleport-fade.ts`.
- `tools/map/src/stages/s12-district-grid.ts`; `config/world/transit.json` (fares, design values) + schema.
- `packages/engine/src/sim/world/index.ts` (exposes the registered `WorldApi`); `apps/web/src/workers/sim.worker.ts` (registration); `packages/ui/src/i18n/en.json` (teleport messages).
- Tests: `packages/world/test/{graph.route.spec.ts, graph.closures.spec.ts, resolver.snap.spec.ts, query.ground.spec.ts, teleport.rules.spec.ts, places.spec.ts}`, `tools/map/test/stage.district-grid.spec.ts`, `tests/e2e/world-teleport.spec.ts` (`@world-teleport`, `@world-astar`).
- ≈ 27 code files.

## Interfaces
- C08 1.0: `RoadGraphQuery`, `TrafficControl`, `MapApi`, `TeleportApi`, `WorldQuery`, `PlaceIndex`, `WorldResolver`, `WorldApi` implemented verbatim from `c08-api.ts`; no shape change.
- C06 1.1 `ModeContext.world` is satisfied by the object `createWorldApi` returns (ModeHost wiring in M04a2, DL-235).

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and `packages/world/src/sim/**` passes the determinism lint — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given hand-built graph fixtures When routes are requested Then A* returns the shortest path with ties resolved by lower edge id, closed edges and masked classes are avoided, wrong-way edges are used only with `allowWrongWay`, a route beyond resident chunks continues on the topology graph, and an exhausted `maxExpand` returns `complete: false` — proof: `pnpm check:unit -- packages/world`
- AC-3 Given the resolver When `snap` targets a road 24 m away and another 26 m away Then the first returns a position with `distM` ≤ 25 and the second returns `null`; `landmark('lm.city-hall')` returns chunk `9/256/256` and every §7 landmark returns the chunk listed in `02-world-bake.md` §7 — proof: `pnpm check:unit -- packages/world`
- AC-4 Given the gray-box fixture and a slab fixture When `groundY` is sampled Then it equals `sampleHeight` within 1 mm on terrain, returns the deck top on a slab when `yHint` is near the deck and the terrain below otherwise, and returns `null` for a non-resident chunk; `isWater` and `nhoodAt` match the fixture classes — proof: `pnpm check:unit -- packages/world`
- AC-5 Given a mock store that never delivers the destination tile When a sandbox teleport is requested Then after 8 s it returns `not-loaded` with `world.teleport.notLoaded` and the player position is unchanged; a target in water lands on the nearest valid point within 40 m or returns `water`; a second fast travel within 30 s returns `cooldown`; a target outside `play` returns `out-of-bounds` — proof: `pnpm check:unit -- packages/world`
- AC-6 Given the `civic-excerpt` area When stages through the district grid run twice Then `data/district-grid.v1` is byte-identical, every cell index is 0–40 or 255, and every index maps through `districts.json` to one of `d1…d10`, `outer` or `stage` — proof: `pnpm map:build -- --area civic-excerpt --repro && pnpm check:unit -- tools/map`
- AC-7 Given a QA build with the `synth` world When the bridge teleports to `lm.city-hall`, `lm.coit-tower`, `lm.ferry-building`, `lm.pyramid-tower`, `lm.crown-tower`, `lm.sutro-tower`, `lm.twin-peaks`, `lm.painted-ladies`, `lm.dolores-park` and `lm.haight-ashbury` Then each request either lands with the player within 0.2 m of `groundY` at the landmark's arrival pose or returns a precondition message with the player unmoved, and at least eight land — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-teleport`
- AC-8 Given 50 seeded origin–destination pairs on the `synth` bake When the Playwright runner computes routes in Node with `@dv/world` and the page computes them in Chromium through the bridge Then edge lists and lengths are identical — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-astar`
- AC-9 Given a `synth` bake When `PlaceIndex` is queried Then `findPlace('coit', 5)` lists `lm.coit-tower` first, `poisNear` returns only POIs within the radius sorted by distance, and every `pedRoute` between two POIs has ≤ 64 points — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-10 Given the branch When the production build is verified and deployed to a Preview Then it succeeds and the Preview passes its header checks — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm check:unit -- packages/world tools/map`): `world/graph.route`, `graph.closures`, `resolver.snap`, `query.ground`, `teleport.rules`, `places.index`; `tools/map/stage.district-grid`.
- **E2E:** `@world-teleport`, `@world-astar` on `chromium-webgl2`; M02b1 and M02b2 tags stay green.
- No device check in this milestone.

## Demo script
1. `DV_WORLD=synth pnpm dev`, open `/?debug=1`; in the console run `__dvBridge.world.teleport('lm.coit-tower')`: fade, arrival on the hill.
2. `__dvBridge.world.route('lm.city-hall', 'lm.ferry-building')`: edge count, length and ETA print.

## Effort
1 Builder session; about 27 code files; risk **medium**. Teleport placement against slabs and prisms and the topology hand-off in A* are the main time sinks.

## Risks & fallbacks
- **Topology graph and lane graph disagree at chunk borders:** route on topology first, refine the resident part with lanes, and splice at the first resident node; log the rule.
- **Teleport into an unbaked area of `synth`** (water strips): AC-7 allows the precondition message; the real `sf` landmarks get arrival poses from M02a2's operator bake.

## Notes for the Builder
- Read first: `02-world-contracts.md` §1, §3; `02-world-maps.md` §5; `02-world.md` §3, §5.5; `02-world-living.md` §1.4–§1.8.
- Everything under `src/sim/**` runs in `sim.worker` under the C02 lint: `detmath` for any trigonometry, integer ticks, no `Date`.
- Secrets: none. Branch `m02c1-graph-services-teleports`.

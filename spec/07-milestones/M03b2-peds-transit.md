# M03b2 — peds-transit

## Goal
After this session the city has people and transit. Pedestrians walk the baked sidewalk graph, wait at red crossings and cross on the parallel green. They idle at waiting nodes, dodge and flee from fast cars, and gather around event attractors. Near the player they use deterministic local avoidance and keep 0.6 m clear of an XR head. They witness infractions for the PursuitDirector, and the tier's crowd limits cap them at near and far levels of detail. Transit runs as set dressing under fictional brands:
- Bay Rail station entrances with fast travel;
- City Metro trains;
- City Transit buses that dwell at stops;
- cable cars on their three lines;
- ferries on the water graph;
- decorative airliners on approach corridors.

The robotaxi fare and the Ride path (`TeleportApi.request('fast-travel', …)`) work. The cross-browser world hash now covers traffic and pedestrians together.

## Requirements
- R-MAP-04: pedestrians and transit complete the "living city" with traffic (M03b1).
- R-MAP-01 (support): station, stop and line positions come from the real data; only names and liveries are fictional.
- R-ENG-02: crowd counts per tier are asserted on `downtown-rush`.

## Depends on
- **M03b1** (traffic-robotaxis): traffic system, `SignalState`, witness sink, `traffic-synth` scenario and QA page, `downtown-rush`.
- Through it: M02a2 (ped graph, crossing links, transit nodes, `content/world/cablecars.json` chain check, `synth` bake), M02c1 (`TeleportApi` with fares recorded but not charged, `PlaceIndex`, `config/world/transit.json` fares), M02b1 (`DV_WORLD=synth` builds), M01b2 (anim graph v1 and the procedural mannequin on `bay_rig_v1`).
- Contracts: C08 1.0.0, C01 1.0.0, C02 1.1.0, C04 1.1.0 (`bay_rig_v1`, engine anim states 0–22), C13 1.1.0 (`CrowdLimits`).

## Scope in
- `packages/world/src/sim/peds/`:
  - component 257 `PedAgent`;
  - FSM states `Walk` (1.4 ± 0.2 m/s, stairs × 0.6), `Wait`, `Idle` (5–40 s at `Waiting` nodes), `Dodge` (vehicle within 6 m at > 6 m/s), `Flee` (2.8 m/s, 10 s), `Record`/`Cheer` (within 40 m of a `crowd.attract` source, cap 3 live), `Hit` (ragdoll-lite hand-off from M03a1) and `Witness` (seeded 3–6 s, then a `world.witness` event with witness `ped`);
  - transitions on the agent stream only.
- Crossings: a ped enters a signalled crosswalk only during the parallel vehicle green minus its last 5 s; mid-block crossings yield to traffic. Robotaxis now see occupied crosswalks and peds within 3 m of their lane (M03b1 read an empty set).
- Local avoidance: agents within 60 m of the player (≤ 48) run a pairwise repulsion step every third AI tick, in `StableKey` order. The XR rule keeps peds out of a 0.6 m radius around the head pose. No navmesh (`02-world-living.md` §4.3).
- Density: ped slots 256–511 per chunk through `activeSlots` with tier, hour and weather factors (§7). The `canonical` profile uses `mobile-low`. The prefix rule: lower-tier agents are a subset of higher-tier ones at the same `(cell, slot)`.
- Bodies (stub first): far LOD is one `InstancedMesh` per body of a rigid low-poly figure (≤ 300 triangles) with a vertex-shader gait phase (TSL). Near LOD (≤ 25 m) is the M01b2 procedural mannequin on `bay_rig_v1`, driven by engine anim states 0–3, with eight palette variants `ped.ambient.{a..h}`. Caps per tier as §4.5; totals obey `CrowdLimits`. No child bodies, no real likeness.
- Transit (`packages/world/src/sim/transit/`, components 260 `TransitVehicle`, 261 `AmbientBoat`, 264 `Aircraft`):
  - Bay Rail: 8 station entrances as `Interactable{Transit}`, fast travel between stations through `TeleportApi.request('fast-travel', …)`, fade ≤ 2.5 s, refused at heat ≥ 1;
  - City Metro: 2-car trains on surface splines;
  - City Transit buses: on snapped patterns, 8 s dwell, sharing the traffic cap;
  - cable cars: 4.2 m/s on the three authored chains, hop on and off at stops;
  - ferries: 7 m/s;
  - airliners: decorative and not hashed.

  Counts follow the §5 table per tier. Names come through `NameRegistry` keys (fictional brands); liveries are original.
- Robotaxi fare and Ride (§3.6): the robotaxi spawns ≥ 120 m away and arrives within 90 s, followed by a short in-engine cut and a teleport. The fare is 300 ¢ + 120 ¢/km and the Bay Rail fare 200 ¢ + 50 ¢ per stop (`config/world/transit.json`, created by M02c1). Both are refused at heat ≥ 1. **Payment:** the fare is computed and passed with an idempotency key. The charge is a no-op `FareSink` until M04a2 wires `EconomyApi`, and the sink records the call for tests.
- Scenario `traffic-peds-synth` (traffic and peds on, `synth` bake) with its Node golden. The `/qa/world-hash.html` page runs both scenarios.
- `downtown-rush` with peds on (`density: 'nominal'`).

## Scope out
- PursuitDirector consumption of ped witnesses: M03c.
- Phone Ride app UI and the transit map layer: M04b2 (phone frame), M02c2 (map lines).
- Final ped bodies and outfits (8 bodies × 20 outfits): M10d1 (art integration, Q-39; DL-390). The mannequin stays until then.
- Pedestrian dialogue or barks: M06c. Filler peds never call an LLM (D-21).
- Rooms behaviour for ambient peds: M12b1.

## Deliverables
- `packages/world/src/sim/peds/{components.ts, fsm.ts, crossing.ts, avoidance.ts, density.ts, attract.ts, witness.ts, system.ts, index.ts}`.
- `packages/world/src/sim/transit/{components.ts, rail.ts, metro.ts, bus.ts, cablecar.ts, ferry.ts, aircraft.ts, fares.ts, ride.ts, system.ts, index.ts}`.
- `packages/world/src/client/{peds/instances.ts, transit/render.ts}`.
- `config/world/transit.json` extended with counts per tier and speeds (schema from M02c1 extended).
- `packages/world/test/{ped.crossing.spec.ts, ped.fsm.spec.ts, ped.avoidance.spec.ts, density.prefix.spec.ts, transit.counts.spec.ts, transit.fares.spec.ts, peds.determinism.spec.ts}`, `packages/world/test/golden/traffic-peds-synth.json`.
- `apps/web/src/qa/world-hash.ts` (second scenario); `tests/e2e/world-hash.spec.ts` (both scenarios).
- About 33 files.

## Interfaces
- C08 1.0: ped graph, crossing links with `junction` and `movement`, transit nodes, spawn ranges and `activeSlots`, `TeleportApi` (`fast-travel` kind), all consumed verbatim.
- C01 1.0: components 257, 260, 261, 264; keys `amb:<cell>:<slot>`.
- C04 1.1: `bay_rig_v1`, engine anim states. C13 1.1: `CrowdLimits`.
- Engine-internal: the `FareSink` port, which M04a2 binds to C06 `EconomyApi`. No contract change.

## Acceptance criteria
- AC-1 Given a signalled crossing in the `civic-excerpt` bake When 600 s run in `canonical` Then no pedestrian steps onto a crosswalk while its parallel vehicle aspect is red, or within the last 5 s of its green, and waiting peds cross on the next green — proof: `pnpm map:build -- --area civic-excerpt && pnpm check:unit -- packages/world`
- AC-2 Given an XR head fixture (a moving pose at 1.6 m) among 48 near peds When 3,600 ticks run Then no ped centre comes within 0.6 m of the head, and the avoidance step visits agents in `StableKey` order every third AI tick — proof: `pnpm check:unit -- packages/world`
- AC-3 Given the same `(cell, slot)` set When densities are computed for `mobile-low`, `mobile` and `desktop` Then each lower tier's active agents are a subset of the next tier's, for pedestrians and traffic — proof: `pnpm check:unit -- packages/world`
- AC-4 Given a car approaching a walking ped at 8 m/s within 6 m When the brain ticks Then the ped enters `Dodge`. A witnessed collision yields one `world.witness` event with witness `ped` 3–6 s later (seeded) — proof: `pnpm check:unit -- packages/world`
- AC-5 Given each tier and a transit fixture (bus pattern, cable-car chain, ferry line, corridor) When transit spawns Then bus, cable-car, Metro, ferry and aircraft counts equal the `config/world/transit.json` row. Buses dwell 8 s at stops, cable cars move at 4.2 m/s and ferries at 7 m/s (± 0.1 m/s) — proof: `pnpm check:unit -- packages/world`
- AC-6 Given heat 0 and a Bay Rail entrance When the player fast-travels three stops Then the teleport lands at the target station, the `FareSink` records 350 ¢ once with one idempotency key, and the same request at heat 1 is refused with the precondition key and no movement — proof: `pnpm check:unit -- packages/world`
- AC-7 Given scenario `traffic-peds-synth` (seed 0xC0FFEE, `canonical`) When it runs 10,000 ticks twice in Node Then all checkpoints are identical and equal `traffic-peds-synth.json`, while `traffic-synth.json` from M03b1 still matches with peds off — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-8 Given a `DV_WORLD=synth` QA build When `/qa/world-hash.html` runs both scenarios Then Chromium and WebKit report hashes equal to both Node goldens — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-hash && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-hash`
- AC-9 Given `downtown-rush` with peds on When the CPU-side perf run executes on each flat tier Then ped and traffic instance totals, near-LOD skinned counts and render objects stay within C13 `CrowdLimits` and the tier rows — proof: `DV_WORLD=synth pnpm check:perf -- --scenario downtown-rush --fail`
- AC-10 Given the shipped strings When the IP gates run Then no real transit brand appears in `content/world`, `config/world` or UI catalogs, and every new mesh or texture has a provenance record — proof: `pnpm names:lint && pnpm ip:strings && pnpm provenance:check`
- AC-11 Given the branch When the build, dist verifier and preview deploy run Then they pass, no `qa/world-hash` page ships, the gray-box boot still works, and the Preview passes its header checks — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm check:unit -- packages/world`): `world/ped.crossing`, `ped.fsm`, `ped.avoidance` (with the XR head fixture), `density.prefix`, `transit.counts`, `transit.fares`, `peds.determinism`; M03b1's traffic tests stay green.
- **E2E:** `@world-hash` on both engines with both scenarios.
- **Perf:** `downtown-rush` counts with peds.
- **IP:** `names:lint`, `ip:strings`, `provenance:check`.
- **Device:** none new. M03b1's iPhone checklist is re-run in M11a1 with peds on.

## Demo script
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, walk along an arterial: peds walk, wait at red and cross on green.
2. Drive fast at a group: they dodge or flee.
3. Walk into a Bay Rail entrance and choose a station: fade, arrive, and the fare shows in the debug log.
4. Watch a bus dwell at a stop, a ferry cross the water strip and an airliner cross the sky (cable cars run on the `sf` bake's chains).
5. Open `/qa/world-hash.html`: both scenario hashes match their goldens.

## Effort
1 Builder session; about 33 files; risk **medium**. Avoidance determinism and the crossing timing against the signal phases need the most care.

## Risks & fallbacks
- **Avoidance breaks cross-engine equality.** Use `detmath`, fixed iteration order and integer tick counters. If a mismatch persists, drop near avoidance to two-lane edge following (no pairwise step) and record the decision. Do not loosen the hash test.
- **Cable-car chains missing from the bake.** M02a2's bake check fails on a missing chain. If `content/world/cablecars.json` is absent, ship buses and Metro, mark cable cars pending in the report, and keep AC-5's cable-car row failing until the chain exists. Never invent a route.
- **Too many skinned near peds on `mobile-low`.** The caps (6 at `mobile-low`) are hard. Excess near peds render as far-LOD instances.

## Notes for the Builder
- Read first: `02-world-living.md` §3.3–§3.6, §4, §5, §7, §8; `02-world.md` §8 (M03b2 seeds) and §9; `01-engine.md` §2.8 (anim graph, presentation only); M03b1's file.
- Facts: F-007 (crowd instancing within the object budget). Station positions are M02a2's S10 transit nodes in `WorldIndex.transit` (the Muni Metro positions of fact N4 plus authored BART and Caltrain seeds snapped by `map:landmarks`, U-W5) and Muni stops come from DataSF `i28k-bkz6`, both already stamped in M02a1's `sources.json`; no BART feed or GTFS is fetched (a new source needs an Architect DL entry with its licence, source stamp and attribution row first; DL-660). The BART developer licence forbids its marks [research/auth-ugc-input-maps.md §5.2], so names come from `NameRegistry` defaults ("Bay Rail", "City Metro", "City Transit", "Bay Ferry"), checked by `names:lint`.
- `traffic-peds-synth.json` follows M03b1's golden rule: it stores its source `bakeId`, `peds.determinism.spec.ts` fails with the regenerate message when the synth `bakeId` changes, and it is regenerated only with `DV_UPDATE_GOLDEN=1` outside CI under the `golden-update` label (DL-657).
- Order of work: ped FSM and crossings, density prefix, avoidance with the XR fixture, witness, transit movers, fares and Ride, render, goldens, QA page, perf.
- The fare sink is deliberate: M04a2 replaces it with `EconomyApi.debit(cents, 'fare', idemKey)`. Keep the idempotency key format `fare:<kind>:<tick>:<from>:<to>`.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). No genAI spend, no owner gate.

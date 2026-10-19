# M03b1 — traffic-robotaxis

## Goal
After this session San Francisco has traffic. Ambient cars follow the baked road graph with an IDM-style car-following model. They obey the junction protocol and the signal programs, plan turns, change lanes before a turn, and parked cars line the parking lanes. Robotaxis of the fictional operator drive at 0.95 × the limit, yield, and stall at dark signals during a blackout. Density follows the tier, hour and weather model, with the `canonical` profile always on `mobile-low` factors. Near agents get kinematic bodies, and a car the player hits or enters is promoted to a dynamic vehicle for up to 8 s. Robotaxi witness hooks report infractions as sim events for the PursuitDirector (M03c). The whole thing is deterministic: 10,000 `canonical` ticks on the `synth` world hash identically in Node, Chromium and WebKit. The perf scenario `downtown-rush` exists.

## Requirements
- R-MAP-04: traffic, including robotaxis, on the baked streets with signals and parked cars.
- R-ENG-02: `downtown-rush` asserts agent and render-object counts per tier in CI, and the iPhone checklist judges frame time on the device.
- R-PLAT-03 (support): per-agent seeded streams and canonical density keep the world sim identical across engines.

## Depends on
- **M02c1** (graph-services-teleports): `RoadGraphQuery`, junction runtime and `signal()`, `TrafficControl` in `packages/world/src/sim/traffic/control.ts` (blackout from M02b2's hashed resource, `setDensity`, `closeEdges`, `release`), `WorldQuery`, `WorldApi` wiring and the QA bridge.
- **M03a1** (vehicles-interaction-prefabs): prefabs `vehicle.{compact,sedan,rideshare,van,truck,pickup}`, `police.cruiser`, `robotaxi.default`; the vehicle system with `stepHandling`; `packages/shared/src/vehicle/quirks.ts`.
- **M02b2** (weather-time): blackout resource, `lampPitchM` in `config/world/density.json` (DL-219); the file, its ordered `profiles` with `perKm` and the schema come from M02a2 (DL-555).
- Through those:
  - M02a2: graph, junctions, signal programs, spawn capacities and density profiles, `synth` roads;
  - M02b1: `@dv/world` sim/client split, `DV_WORLD=synth` QA builds, scenario registration in `tests/perf/`;
  - M01c: perf runner, checklists.
- Contracts: C08 1.0.0, C01 1.0.0 (`amb:` keys), C02 1.1.0, C13 1.1.0 (`CrowdLimits`, `PerfScenario`).

## Scope in
- `packages/world/src/sim/traffic/` (under the C02 lint):
  - components 256 `TrafficAgent`, 258 `RobotaxiBrain`, 259 `ParkedCar`, 262 `SignalState` (derived, not hashed) and 263 `Witness` (`02-world-living.md` §8);
  - brain in `SimStage.AI` at 30 Hz (`AI_DIVISOR 2`), with component writes only in `AI` and `Rules`.
- IDM car following (§2.1.1): personality 0.92–1.08 from stream `amb:<cell>:<slot>`, curve limit with `dsqrt`, grade scaling. Turn planning 40 m before the edge end with weights 0.60/0.22/0.18. Dead-end handling. Lane change within the last 40 m.
- Junction protocol (§1.5–§1.6, §2.1.3): the stop line and amber rule, entry when the conflict set is free, the 20 s claim timeout with the lowest `StableKey` proceeding, all-way and minor stops, dark signals as all-way stops. The aspect comes from M02c1's `signal()`.
- Spawn and despawn by tier `R_amb` (§2.2) with the forward-cone rule and stuck despawn. Density through `activeSlots` with tier, hour, weather and the `TrafficControl.setDensity` override. Hour curves and weather and tier factors are **added** to `config/world/density.json` (M02a2 created the file and the ordered `profiles`; M02b2 added `lampPitchM`); keyed by profile name, never reordering `profiles` (DL-555).
- Simulation levels (§2.3): near kinematic bodies with tier caps; far level as data only; promotion to a dynamic vehicle (civilian preset) on ΔV ≥ 3 m/s or player entry for ≤ 8 s, then a wreck; promoted caps per tier.
- Reactions (§2.4): an intruding entity becomes the leader; a honk cue; pull right for a siren within 40 m.
- Archetype shares (§2.5) and parked cars (component 259, parking lanes, tier factor). Closed edges from `TrafficControl.closeEdges` are avoided at the next junction.
- Robotaxis (§3 items 1–5, 7): 0.95 × limit, `autoYield` 14 m, stop for peds in lane and at occupied crosswalks (the ped set is empty until M03b2), stall with probability 0.35 for a seeded 4–9 s with hazard lights, witness hook (≤ 4 LOS rays per tick, report after 2 s).
- **Witness hook:** writes component 263 and emits `SimEvent {t: 'world.witness', s: <InfractionKind>, n: <reportAtTick>}` with the witness kind. M03c subscribes; until then events are counted only.
- Rendering (`packages/world/src/client/traffic/`, §2.6): one `InstancedMesh` per archetype (box cars, stub first), colour and head/tail/hazard light state as instance attributes, distance throttling, two-box far LOD beyond 150 m, totals within C13 `CrowdLimits`.
- **Determinism scenario `traffic-synth`:** 10,000 `canonical` ticks, seed 0xC0FFEE, on the `synth` bake. Node golden; a QA page `apps/web/qa/world-hash.html` (QA builds only) runs it in `sim.worker` from the same packs served under `/media-local/` and publishes checkpoints on `__dvBridge.world.qa`.
- Perf scenario `downtown-rush`: path `config/perf/paths/downtown-rush.json` (ENU path through SoMa and FiDi at 17:00 weekday, `density: 'nominal'`), registered in `tests/perf/`. Device checklist `tools/ci/checklists/M03b1-iphone15.json`.

## Scope out
- Pedestrians, crossings, transit, aircraft, the robotaxi fare and Ride: M03b2.
- PursuitDirector, police dispatch, and heat behaviour of `police.cruiser`: M03c (patrol cruisers here are ordinary agents).
- Final vehicle art (ambient archetypes, `police.cruiser` and robotaxi liveries): M10d1 (art integration, Q-39). Until then the box cars are gray-box stand-ins, identified by `vehicle/graybox.*` AssetRefs and rows of M10d1's `config/art-placeholders.json` (no provenance field; C07 unchanged); M10d2's `assets:final` scan feeds the M14b3 `art-final` gate, which blocks `release` while one ships (DL-390).
- Room epochs for shared traffic: M12b1. Device tuning beyond the checklist: M11a1–M11a2.

## Deliverables
- `packages/world/src/sim/traffic/{components.ts, idm.ts, plan.ts, junction.ts, spawn.ts, density.ts, promote.ts, reactions.ts, robotaxi.ts, witness.ts, system.ts, index.ts}`; `control.ts` extended only where agents need hooks.
- `packages/world/src/client/traffic/{instances.ts, lights.ts}`.
- `config/world/density.json` (extended) and its schema `tools/map/schemas/density.schema.json` (extended; M02a2's file, DL-555).
- `packages/world/test/{traffic.idm.spec.ts, traffic.signals.spec.ts, traffic.junction.spec.ts, robotaxi.blackout.spec.ts, density.spawn.spec.ts, traffic.promotion.spec.ts, witness.spec.ts, traffic.determinism.spec.ts}`, `packages/world/test/golden/traffic-synth.json`.
- `apps/web/qa/world-hash.html`, `apps/web/src/qa/world-hash.ts`; `verify-dist.mjs` also rejects `world-hash`.
- `tests/e2e/world-hash.spec.ts` (`@world-hash`).
- `config/perf/paths/downtown-rush.json`, its entry in `tests/perf/`, `tools/ci/checklists/M03b1-iphone15.json`.
- About 33 files.

## Interfaces
- C08 1.0: `RoadGraphQuery`, `TrafficControl`, `SimChunk` lane graph, spawn ranges `(cellKey, slot)` with the `densityCap` prefix, `activeSlots`; consumed verbatim.
- C01 1.0: ambient keys `amb:<cell>:<slot>`; components 256–263 in the world range.
- C13 1.1: `CrowdLimits`; `PerfScenario` (`downtown-rush` is a listed id).
- Engine-internal: the `world.witness` SimEvent (typed in S02's part file per the C06 `SimEvent` rule). No contract change.

## Acceptance criteria
- AC-1 Given a `synth` bake with 50 agents When 36,000 ticks (600 s) run in `canonical` Then no agent crosses a stop line while its movement's aspect is red, or amber when it could stop at 3.5 m/s², and no junction claim is held longer than 20 s — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-2 Given the `civic-excerpt` bake (real junctions around City Hall) When the same 600 s run executes with 20 agents Then the same red-light and claim rules hold — proof: `pnpm map:build -- --area civic-excerpt && pnpm check:unit -- packages/world`
- AC-3 Given `TrafficControl` blackout on and 20 seeds When a robotaxi reaches a dark junction Then every stall lasts between 4 and 9 s, ambient agents treat the junction as an all-way stop with no deadlock, and a robotaxi never exceeds 0.95 × the edge limit — proof: `pnpm check:unit -- packages/world`
- AC-4 Given a stationary pedestrian dummy in lane When a robotaxi approaches at 14 m/s Then `autoYield` stops it without contact — proof: `pnpm check:unit -- packages/world`
- AC-5 Given each flat tier and the `canonical` profile When spawning runs around a moving player Then all of these hold:
  - spawns lie at 0.6–1.0 × `R_amb`, never inside the forward cone closer than 0.9 × `R_amb`;
  - despawns happen beyond 1.25 × `R_amb`;
  - the active count equals `activeSlots` for the tier, hour and weather (canonical = `mobile-low` factors);
  - `setDensity` 0 / 0.35 / 1.0 scales it;
  - closed edges are never entered.
  — proof: `pnpm check:unit -- packages/world`
- AC-6 Given a near agent When the player's vehicle hits it at ΔV ≥ 3 m/s Then it becomes a dynamic vehicle for at most 8 s and then a wreck, and the number of promoted agents never exceeds the tier cap — proof: `pnpm check:unit -- packages/world`
- AC-7 Given an infraction within 40 m and in line of sight of a robotaxi When 2 s pass Then exactly one `world.witness` event fires, and robotaxi LOS rays stay ≤ 4 per tick — proof: `pnpm check:unit -- packages/world`
- AC-8 Given scenario `traffic-synth` When it runs twice in Node Then the hashes at every 600th tick and the final hash are identical and equal `traffic-synth.json` — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-9 Given a `DV_WORLD=synth` QA build When `/qa/world-hash.html` runs the scenario in `sim.worker` Then Chromium and WebKit both report checkpoints equal to the Node golden — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-hash && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-hash`
- AC-10 Given `downtown-rush` on each flat tier When the CPU-side perf run executes in fail mode Then traffic agent counts, instanced draws and render objects stay within the tier rows of `config/tier-budgets.json` and C13 `CrowdLimits` — proof: `DV_WORLD=synth pnpm check:perf -- --scenario downtown-rush --fail`
- AC-11 Given an operator Preview built with the `synth` world, opened as an iPhone 15 Home Screen app at `?perf=1&tier=mobile-low&scenario=downtown-rush` When the operator runs the checklist Then `perf.json` and `notes.json` are committed under `docs/device-runs/M03b1/iphone15/` and pass at `mobile-low` (30 fps by the 08 §4.3 formula) — proof: manual: iPhone 15, steps of `pnpm perf:checklist -- tools/ci/checklists/M03b1-iphone15.json`, then `pnpm perf:verify -- docs/device-runs/M03b1/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M03b1-iphone15.json`
- AC-12 Given a production build When the dist verifier and the preview deploy run Then no `qa/world-hash` page is in `dist/`, the gray-box boot still works, and the Preview passes its header checks — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm check:unit -- packages/world`, after a `synth` and a `civic-excerpt` bake): `world/traffic.idm`, `traffic.signals`, `traffic.junction`, `robotaxi.blackout`, `robotaxi.autoYield`, `density.spawn`, `traffic.promotion`, `witness.robotaxi`, `traffic.determinism`.
- **E2E:** `@world-hash` on `chromium-webgl2` and `webkit-webgl2` with `DV_WORLD=synth` (nightly runs it per 08 §5.5).
- **Perf:** `downtown-rush` (warn on PRs; the AC uses `--fail`).
- **Device:** `M03b1-iphone15` (AC-11). Desktop real-GPU numbers are recorded in M11a2.

## Demo script
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`: cars drive, stop at red and turn.
2. In the debug panel, toggle blackout: signals go dark, cars take turns, and a robotaxi stalls with hazard lights.
3. Drive into a car: it tumbles as a dynamic body, then becomes a wreck.
4. Open `/qa/world-hash.html`: the final hash equals `traffic-synth.json`.
5. `DV_WORLD=synth pnpm check:perf -- --scenario downtown-rush`: counts per tier.

## Effort
1 Builder session; about 33 files; risk **high**. The junction protocol and cross-engine determinism with many agents are the time sinks.

## Risks & fallbacks
- **Cross-browser hash mismatch.** Bisect with the 600-tick checkpoints. Iterate agents in `StableKey` order and use `detmath` only. Never mark the test flaky.
- **Gridlock.** The 30 s stuck rule despawns unseen agents and nudges visible ones. If AC-1 still fails, report the junction id and fix the protocol; do not lower the agent count.
- **AI cost** (≤ 1.0 ms per AI tick at 540 agents is a design value †): measure and report, never assert it in CI.
- **A golden changes when the synth generator changes.** The M00d golden-update label rule applies. Regenerate only with that label, and explain in the PR.

## Notes for the Builder
- Read first: `02-world-living.md` §1–§3, §7–§8; `02-world-contracts.md` §2–§3; `02-world.md` §8 (M03b1 seeds) and §9; `06-racing-content.md` C.3.3 (robotaxi quirks); M02b1, M02b2 and M02c1 files (world package layout, blackout resource, `TrafficControl`).
- Facts: F-007 (instancing keeps the object count down). The December 2025 blackout behaviour is a cited design ground [research/gamedesign-decomposition.md §2.7]; the oracle is the 4–9 s rule.
- Order of work: density config, IDM, junction, spawn, robotaxi, promotion, witness, render, golden, QA page, perf path, checklist.
- Preview builds normally carry no world (M02b1). For AC-11 the operator builds one Preview with `pnpm map:build -- --area synth`, then `DV_WORLD=synth VITE_DV_QA=1 pnpm build`, then `pnpm deploy:preview`, and notes the URL in `notes.json`.
- AC-3 to AC-7 run on hand-built graph fixtures inside the test files. AC-1, AC-2 and AC-8 read `dist/world/` of the named area; without the bake they skip through M02a1's `requireBake` (DL-545 (a)) (`SKIP <suite>: no bake in dist/world`), and fail when `DV_REQUIRE_BAKE=1` (the CI `unit` job sets it after restoring or building both bakes, M02b1).
- Witness events go to a sink that M03c consumes. `@dv/world` never imports engine pursuit code.
- Owner gate: Q-13 (an iPhone 15 for AC-11; without it the AC is listed under "Blocked on"). Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally, CI runs it). No genAI spend.

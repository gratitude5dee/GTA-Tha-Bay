# M03b1 — traffic-robotaxis

## Goal
After this session San Francisco has traffic. Ambient cars follow the baked road graph with an IDM-style car-following model. They obey the junction protocol and the signal programs, plan turns, change lanes before a turn and park along the parking lanes. Robotaxis of the fictional operator drive at 0.95 × the limit, yield, and stall at dark signals during a blackout. Density follows the per-tier, hour and weather model, with the `canonical` profile always on `mobile-low` factors. Near agents get kinematic bodies, and a car the player hits or enters is promoted to a dynamic vehicle for up to 8 s. Robotaxi witness hooks report infractions as sim events for the PursuitDirector (M03c). The whole thing is deterministic: 10,000 `canonical` ticks hash identically in Node, Chromium and WebKit. The perf scenario `downtown-rush` exists.

## Requirements
- R-MAP-04: traffic, including robotaxis, on real SF streets with signals and parked cars.
- R-ENG-02: `downtown-rush` asserts agent and render-object counts per tier, and the iPhone checklist judges frame time on the device.
- R-PLAT-03 (support): the per-agent seeded streams and canonical density keep the world sim identical across engines.

## Depends on
- **M02c1** (graph-services-teleports): `RoadGraphService`, A*, junction runtime, `WorldQuery`, `WorldApi` wiring, signal programs from the bake.
- **M03a1** (vehicles-interaction-prefabs): vehicle prefabs `vehicle.{compact,sedan,rideshare,van,truck,pickup}`, `police.cruiser`, `robotaxi.default`, the vehicle system with `stepHandling` (promotion uses a civilian preset), `packages/shared/src/vehicle/quirks.ts`.
- Through those: M02a2 (graph, junctions, signals, spawn tables, ped graph, tags), M02b1 (chunk streaming, statics feed), M01c (perf runner, checklists), M01b2 (QA fixture-page pattern).
- Contracts: C08 1.0.0, C01 1.0.0 (`amb:` keys), C02 1.1.0, C06 1.1.0 (`ModeContext.world` only as wired by M02c1), C13 1.1.0 (`CrowdLimits`, `PerfScenario`).

## Scope in
- `packages/world/src/traffic/`:
  - agent component 256 `TrafficAgent`, 258 `RobotaxiBrain`, 259 `ParkedCar`, 262 `SignalState` (derived, not hashed) and 263 `Witness` (`02-world-living.md` §8);
  - brain in `SimStage.AI` at 30 Hz (`AI_DIVISOR 2`), with component writes only in `AI` and `Rules`.
- IDM car following (§2.1.1): personality 0.92–1.08 from the agent stream, curve limit with `dsqrt`, grade scaling. Turn planning 40 m before the edge end with weights 0.60/0.22/0.18. Dead-end handling.
- Junction protocol (§1.5–§1.6, §2.1.3):
  - stop line, amber rule;
  - conflict-set entry;
  - 20 s claim timeout with the lowest `StableKey` proceeding;
  - all-way and minor stops;
  - dark signals behave as all-way stops.
- Signal aspect as a pure function of the tick (`cycleTicks`, `offsetTicks`).
- Spawn and despawn by tier `R_amb` (§2.2), with the forward-cone rule and stuck despawn. Density through `activeSlots` with tier, hour (`config/world/density.json`), weather and `override` factors (§7). `TrafficControl.setDensity`, `closeEdges`/`release`, and `setBlackout(on, by)` as the single blackout switch.
- Simulation levels (§2.3): near kinematic bodies with tier caps, the far level as data only, and promotion to a dynamic vehicle (civilian preset) on ΔV ≥ 3 m/s or player entry, for ≤ 8 s, then a wreck. Promoted caps per tier.
- Reactions (§2.4): treat an intruding player or entity as the leader, honk cue, pull right for a siren within 40 m.
- Archetype shares (§2.5) and parked cars (component 259, parking lanes, tier factor).
- Robotaxis (§3, items 1–5, 7–8): speed 0.95 × limit, `autoYield` 14 m, stop for pedestrians in lane and at occupied crosswalks (ped presence arrives in M03b2; the check reads an empty ped set until then), stall with probability 0.35 for a seeded 4–9 s, hazard lights, and the witness hook (≤ 4 LOS rays per tick, report after 2 s). The fare (§3.6) is M03b2's.
- **Witness hook:** writes component 263 and emits `SimEvent {t: 'world.witness', s: <InfractionKind>, n: <reportAtTick>}` with the witness kind. M03c's PursuitDirector subscribes. Until then the events are only counted.
- Rendering (§2.6): one `InstancedMesh` per archetype using placeholder box cars (the stub-first rule); colour and light state as instance attributes; manual distance throttling; two-box far LOD beyond 150 m; totals obey C13 `CrowdLimits`.
- **Fixture `civic-excerpt`:** the offline 1 km² real excerpt baked by `pnpm map:build -- --area civic-excerpt` (M02a1–a2), copied to `tests/fixtures/world/civic-excerpt/` with C07 `ProvenanceRecord`s (ODbL/PDDL, F-053, F-054). It is reproduced by `pnpm map:fixture civic-excerpt --check`, and Node tests and the QA page use it.
- QA page `apps/web/qa/world-hash.html` (QA builds only) runs scenario `traffic-excerpt` in `sim.worker` and publishes checkpoint hashes on `__dvBridge.world.qa`.
- Perf scenario `downtown-rush`: path `config/perf/paths/downtown-rush.json` (SoMa/FiDi at 17:00 weekday, `density: 'nominal'`), registered with the M01c scenario runner. Device checklist `tools/ci/checklists/M03b1-iphone15.json`.

## Scope out
- Pedestrians, crossings, crowds, transit, aircraft, the robotaxi fare and Ride app: M03b2.
- PursuitDirector, police dispatch, and the `police.cruiser` heat behaviour: M03c. Patrol cruisers here are ordinary agents.
- Final vehicle art: S05/S06 art pass. Box cars stay until then.
- Room epochs for shared traffic (`(cell, slot, epoch)`): M12b1.
- Traffic tuning on real devices beyond the iPhone 15 checklist: M11a1.

## Deliverables
- `packages/world/src/traffic/{components.ts, idm.ts, plan.ts, junction.ts, signals.ts, spawn.ts, density.ts, promote.ts, reactions.ts, robotaxi.ts, witness.ts, control.ts, system.ts, index.ts}`.
- `packages/world/src/render/traffic-instances.ts`.
- `config/world/density.json` (hour curves, weather and tier factors; schema `packages/shared/schemas/world/density.schema.json`).
- `tools/map/src/fixtures/civic-excerpt.ts`. `map:fixture` gains the fixture name **`civic-excerpt`** (`pnpm map:fixture civic-excerpt [--check]`).
- `tests/fixtures/world/civic-excerpt/` and its provenance records under `assets/provenance/world/`.
- `packages/world/test/{traffic.idm.spec.ts, traffic.signals.spec.ts, traffic.junction.spec.ts, robotaxi.blackout.spec.ts, density.spawn.spec.ts, traffic.promotion.spec.ts, witness.spec.ts, traffic.determinism.spec.ts}`, `packages/world/test/golden/traffic-excerpt.json`.
- `apps/web/qa/world-hash.html`, `apps/web/src/qa/world-hash.ts`. `verify-dist.mjs` also rejects `world-hash`.
- `tests/e2e/world/world-hash.spec.ts` (`@world-hash`).
- `config/perf/paths/downtown-rush.json`, the scenario registration, `tools/ci/checklists/M03b1-iphone15.json`.
- About 34 files (the fixture and JSON data are not counted).

## Interfaces
- C08 1.0: `RoadGraph`, `SimChunk` lane graph, spawn ranges `(cellKey, slot)` with the `densityCap` prefix, `activeSlots`, `WorldApi.traffic` as specified; consumed verbatim, no change.
- C01 1.0: ambient keys `amb:<cell>:<slot>`; components 256–263 in the world range 256–511.
- C13 1.1: `CrowdLimits`, `PerfScenario` (`downtown-rush` is already a listed id).
- Engine-internal: the `world.witness` SimEvent (typed in S02's part file per the C06 `SimEvent` rule). No contract change.

## Acceptance criteria
- AC-1 Given the cached civic-excerpt inputs When the fixture is rebuilt Then the committed `tests/fixtures/world/civic-excerpt/` files are byte-identical, and every file has a provenance record — proof: `pnpm map:fixture civic-excerpt --check && pnpm provenance:check`
- AC-2 Given the excerpt with 50 agents and its signal programs When 36,000 ticks (600 s) run in `canonical` Then no agent crosses a stop line while its movement's aspect is red, or amber when it could stop at 3.5 m/s², and no junction claim is held longer than 20 s — proof: `pnpm check:unit -- packages/world`
- AC-3 Given `setBlackout(true, 'test')` and 20 seeds When a robotaxi reaches a dark junction Then every stall lasts between 4 and 9 s, ambient agents treat the junction as an all-way stop with no deadlock, and a robotaxi never exceeds 0.95 × the edge limit — proof: `pnpm check:unit -- packages/world`
- AC-4 Given a stationary pedestrian dummy in lane When a robotaxi approaches at 14 m/s Then `autoYield` stops it without contact — proof: `pnpm check:unit -- packages/world`
- AC-5 Given each flat tier and the `canonical` profile When spawning runs around a moving player Then:
  - spawns lie at 0.6–1.0 × `R_amb`, never inside the forward cone closer than 0.9 × `R_amb`;
  - despawns happen beyond 1.25 × `R_amb`;
  - the active count equals `activeSlots` for the tier, hour and weather (canonical = `mobile-low` factors);
  - `setDensity` 0 / 0.35 / 1.0 scales it.
  — proof: `pnpm check:unit -- packages/world`
- AC-6 Given a near agent When the player's vehicle hits it at ΔV ≥ 3 m/s Then it becomes a dynamic vehicle for at most 8 s and then a wreck, and the number of promoted agents never exceeds the tier cap — proof: `pnpm check:unit -- packages/world`
- AC-7 Given an infraction within 40 m and in line of sight of a robotaxi When 2 s pass Then exactly one `world.witness` event fires, and robotaxi LOS rays stay ≤ 4 per tick — proof: `pnpm check:unit -- packages/world`
- AC-8 Given scenario `traffic-excerpt` (seed 0xC0FFEE, `canonical`, traffic on) When it runs 10,000 ticks twice in Node Then the hashes at every 600th tick and the final hash are identical and equal `traffic-excerpt.json` — proof: `pnpm check:unit -- packages/world`
- AC-9 Given the QA build When `/qa/world-hash.html` runs the same scenario in `sim.worker` Then Chromium and WebKit both report checkpoint hashes equal to the Node golden — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @world-hash && pnpm check:e2e -- --project=webkit-webgl2 --grep @world-hash`
- AC-10 Given `downtown-rush` on each flat tier When the CPU-side perf run executes Then traffic agent counts, instanced draws and render objects stay within the tier rows of `config/tier-budgets.json` and C13 `CrowdLimits` — proof: `pnpm check:perf -- --scenario downtown-rush --fail`
- AC-11 Given an iPhone 15 Home Screen app on the preview URL at `?perf=1&tier=mobile-low&scenario=downtown-rush` When the operator runs the checklist Then `perf.json` and `notes.json` are committed under `docs/device-runs/M03b1/iphone15/` and pass at `mobile-low` (≥ 30 fps by the 08 §4.3 formula) — proof: manual: iPhone 15, steps of `pnpm perf:checklist -- tools/ci/checklists/M03b1-iphone15.json`, then `pnpm perf:verify -- docs/device-runs/M03b1/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M03b1-iphone15.json`
- AC-12 Given a production build When the dist verifier and the preview deploy run Then no `qa/world-hash` page or fixture is in `dist/`, and the deployed app shows traffic — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm check:unit -- packages/world`): `world/traffic.idm`, `traffic.signals`, `traffic.junction`, `robotaxi.blackout`, `robotaxi.autoYield`, `density.spawn`, `traffic.promotion`, `witness.robotaxi`, `traffic.determinism`.
- **Fixture:** `pnpm map:fixture civic-excerpt --check`, `pnpm provenance:check`.
- **E2E:** `@world-hash` on `chromium-webgl2` and `webkit-webgl2` (nightly also runs it per 08 §5.5).
- **Perf:** `pnpm check:perf -- --scenario downtown-rush` (warn on PRs; the AC uses `--fail`).
- **Device:** `M03b1-iphone15` (AC-11). Desktop real-GPU numbers for `downtown-rush` are recorded in M11a2.

## Demo script
1. `pnpm dev`, open the app, walk to a street in the gray-box or SF build: cars drive, stop at red and turn.
2. Open the debug panel and toggle blackout: signals go dark, cars take turns, and a robotaxi stalls with hazard lights.
3. Drive into a car: it tumbles as a dynamic body, then becomes a wreck.
4. Open `/qa/world-hash.html`: the final hash equals `traffic-excerpt.json`.
5. `pnpm check:perf -- --scenario downtown-rush`: prints counts per tier.

## Effort
1 Builder session; about 34 files; risk **high**. The junction protocol and cross-engine determinism with many agents are the time sinks.

## Risks & fallbacks
- **Cross-browser hash mismatch.** Bisect with the per-600-tick checkpoints. The usual causes are float order in IDM sums and un-sorted iteration, so iterate agents in `StableKey` order and use `detmath` only. Do not mark the test flaky.
- **Gridlock in the excerpt.** The 30 s stuck rule despawns unseen agents; a visible one is nudged. If AC-2 still fails, lower the test's 50 agents only if the tier cap of the excerpt cells is lower, and record that.
- **AI cost.** Budget targets (≤ 1.0 ms per AI tick at 540 agents) are design values (†): measure and report, never assert them in CI.
- **Real-world data in the QA page.** If the excerpt fixture exceeds the 6 MiB precache cap, exclude it from precache (QA builds only).

## Notes for the Builder
- Read first: `02-world-living.md` §1–§3, §7–§8; `02-world-contracts.md` §2–§3 (spawn ranges, `activeSlots`, `WorldApi.traffic`); `02-world.md` §8 (seeds) and §9; `06-racing-content.md` C.3.3 (robotaxi quirks); `11-platform-perf.md` §4; M01b2 (fixture-page pattern) and M01c (scenario runner, checklists).
- Facts: F-007 (instancing keeps the object count down). The December 2025 blackout behaviour is a cited design ground [research/gamedesign-decomposition.md §2.7], not a test oracle; the oracle is the 4–9 s rule.
- Order of work: fixture, signals, IDM, junction, spawn and density, robotaxi, promotion, witness, golden, QA page, perf scenario, checklist.
- Determinism: brains run at 30 Hz with streams `amb:<cell>:<slot>`; never `Math.random`; the signal aspect is derived from the tick and is not stored in the hash.
- Witness events go to a sink that M03c consumes. Do not import engine pursuit code here (the package direction is world → shared only for sim types).
- Owner gate: Q-13 (an iPhone 15 must exist for AC-11; without it the AC stays open and is listed under "Blocked on"). Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally, CI runs it). No genAI spend.

# M07a1 — racing-core-director-car

## Goal
After this session the repository has a racing mode that a QA build can start and finish on real San Francisco streets. `@dv/mode-racing` (`packages/modes/racing`) holds the real descriptor (still `comingSoon` to players), the race director state machine, the pure referee and gate logic in `packages/shared/src/racing/`, nitro, damage, the `RaceHudVm` publisher, six player cars (one per class) and the race schemas. `pnpm map:races compile|validate` turns an authored `source.json` into a committed, bake-pinned `race.json` for one race, `sf.sprint.ferry-ocean-beach`. The QA driver `racing.line` drives that race headless and in browsers with equal state hashes. **Split boundary (from `spec/domains/06-racing.md` §8, row M07a, and `_PLAN-2.md`):** M07a1 takes the mode package, referee, director, cars, nitro, damage, HUD view-model, schemas, compile and the line bot. M07a2 takes AI drivers, rubber-banding, validator rule V12 (par), the other two VS races, the pursuit event, replays, ghosts, `RacingSlice` and the story hook.

## Requirements
- R-MODE-02: sprint racing on real SF streets with referee, gates, nitro and damage on Forza-style handling from M03a.
- R-MODE-05 (support): the descriptor and `unlock.racing` definitions are registered now; the tile becomes `available` in M07a2.
- R-IP-01: every make and model is fictional (D-S06-01) and passes `names:lint` and `ip:strings`; gray-box vehicle assets carry provenance.
- R-MAP-01 (support): race routes are snapped to the baked C08 road graph from lat/lng waypoints.

## Depends on
- **M03a2** (handling model with the wheel-force path decided; `stepHandling`, `applyImpact`, `CLASS_ENVELOPE`, `pnpm --filter @dv/engine test:lines`), **M04a2** (`ModeHost`, `ModeContext`, unlock registry with the `racing` `comingSoon` stub, `pnpm --filter @dv/engine test:modes`), **M04d** (`CanonicalRunner`, `BotDriver` registry, det suite registry `tests/e2e/det/suites.ts`, mutant harness), **M02c1** (`RoadGraphService`, A*, `snap` ≤ 25 m, `WorldApi`).
- Contracts: C01 1.0, C02 1.1, C03 1.1, C04 1.1, C06 1.1, C07 1.1, C08 1.0, C13 1.1, C16 1.1.

## Scope in
- `packages/shared/src/racing/{race-def.ts, referee.ts, index.ts}` and schemas `packages/shared/schemas/racing/{race-source,race-def}.schema.json`, all as in `06-racing-data.md` §4.2: `crossedGate` (XZ segment test, |Δy| ≤ 6 m, positive motion along the tangent), `projectToRoute` (±120 m window), `refereeStep`, `placeOrder`, `RaceEvent`.
- Mode package `@dv/mode-racing`: descriptor (`id 'racing'`, `tile.order 2`, art `ui/mode-racing`, `standalone`, `embeddable`, `standaloneProfile: 'canonical'`, `saveSlot 'mode:racing'`, `sliceSchema 1`, lazy `sim`/`ui` imports) replacing the M04a2 stub, status `comingSoon`.
- Race director (`06-racing.md` §2.8): `Loading → Grid → Countdown (180 ticks) → Running → Finished | Failed → Results → Grid | exit`; colliders-not-ready holds `Loading`; jump start and perfect start; wrong-way warning and respawn; stuck/flip auto-reset; held reset with the +5 s penalty in timed events.
- Six player cars: `vehicle.ondine-pico` (D, from M03a) plus `kestrel-quill` (C), `brackenridge-rasp` (B), `aurelian-sorrel` (A), `solenne-skip` (S) and `halcyon-cormorant` (R): prefabs, handling JSON per `06-racing-content.md` C.1–C.3 (the roadster's `thrusterHop` and the robotaxi quirks are present as data but inactive until M07b1), gray-box models with the C07 1.1 vehicle node anchors.
- Nitro (`06-racing.md` §2.10: refill by drift, near miss, draft, airtime, perfect start; capacity, drain, fire threshold, 110 % ceiling) and damage (formula, front-engine share, spikes, landing, totaled → DNF, `powerScale`, tint and smoke only).
- Components 1024–1031 registered (C01 range); `AnimStateId` 128–159 constants per ADR-0016; SimEvents `race.*`, `veh.*`; telemetry `racing.start` and `racing.finish` (no `tier` prop, DL-166).
- `RaceHudVm` published each tick through `ModeContext.ui` (C06 1.1 `UiBridge`).
- `config/racing.json` (`RacingConfig`, schema-validated) with `tierCaps`, `race`, `nitro`, `damage`, `drift`, `models` blocks.
- `tools/map/src/race/`: `pnpm map:races compile|validate [-- <raceId>]` with rules V1–V11 and V13–V15 (`06-racing-data.md` §4.2.1); one broken fixture per rule.
- QA driver `racing.line` (pure pursuit on the compiled racing line, no opponents), registered in the M04d registry; det suite `@racing-det` (one car, seed 0xC0FFEE); two mutants.
- QA bridge `__dvBridge.racing` (`start(raceId, opts)`, `state()`, `hud()`), QA builds only.
- Racing touch layout (pedals, steer arc, nitro, handbrake, reset, look-behind) in S10's `TouchLayout` v1 shape.

## Scope out
- AI drivers, rubber-band, V12 par, the other VS races, `sf.pursuit.bayview-escape`, replays, ghosts, `RacingSlice`, story hook `m.a1.03`, `available` status, `config/pursuit.race.json`: M07a2.
- Other race kinds, quirks and hop, roadblocks and spikes in races, ladder, other cars: M07b1.
- Garage, upgrades UI, replay director, photo mode, dent shader and `desktop-ultra` look, audio wiring, intro cutscene refs: M07b2.
- Perf scenarios `race-sprint`, `race-pursuit-heat4`: M11a1. XR driving: M11b2. Multiplayer referee: M12e.

## Deliverables
- `packages/shared/src/racing/{race-def.ts, referee.ts, index.ts}`; `packages/shared/schemas/racing/{race-source,race-def}.schema.json`; `packages/shared/test/racing.referee.spec.ts`.
- `packages/modes/racing/package.json` (`@dv/mode-racing`; script **`test`** = `vitest run` through `tools/ci/run.ts`, picked up by `pnpm check:unit`), `tsconfig.json`, `README.md`.
- `packages/modes/racing/src/{index.ts, anim-states.ts, components.ts, config.ts}`.
- `packages/modes/racing/src/sim/{mode.ts, director.ts, nitro.ts, damage-system.ts, hud-vm.ts, telemetry.ts}`; `src/ui/index.ts` (mount, HUD view-model subscription); `src/qa/{bridge.ts, line-driver.ts}`.
- `packages/modes/racing/test/{referee.gates.spec.ts, damage.formula.spec.ts, nitro.spec.ts, director.spec.ts, hud.spec.ts, descriptor.spec.ts, line.headless.spec.ts}`.
- `content/vehicles/handling/{kestrel-quill,brackenridge-rasp,aurelian-sorrel,solenne-skip,halcyon-cormorant}.json`; `assets/prefabs/vehicle.<slug>.json` for the same five; gray-box glTFs with `assets/provenance/` records (`origin: authored`).
- `content/races/sf.sprint.ferry-ocean-beach/{source.json, race.json}`.
- `config/racing.json`, `config/schemas/racing.schema.json`; `unlock.racing` and `unlock.racing.class.{c,b,a,s}` rows in `config/unlocks.json`; `config/input/touch/vehicle-racing.json`.
- `tools/map/src/race/{cli.ts, snap.ts, compile.ts, validate.ts}`, `tools/map/test/race.validate.spec.ts`, `tools/map/test/fixtures/races/V*.source.json`.
- Root script **`map:races`** (`tsx tools/ci/run.ts map-races`).
- `tests/e2e/racing-touch.spec.ts` (`@racing-touch`); `@racing-det` entry in `tests/e2e/det/suites.ts`; `tests/golden/racing/line.ferry-ocean-beach.json`; `tools/ci/mutants/racing/{gate-order,rng-swap}.ts`.

## Interfaces
- Implements C06 1.1 `GameModeDescriptor`/`GameModeSim`/`GameModeUI` and publishes through `UiBridge`; uses C03 1.1 `vehicle` context and `BotInput`; C04 1.1 anim block 128–159 (ADR-0016); C01 ids 1024–1031; C16 1.1 names `racing.start`, `racing.finish`.
- S06-owned, not numbered contracts: `RaceSource`, `RaceDef`, `RefereeState`, `RacingConfig`, `RaceHudVm` exactly as in `06-racing-data.md`. No contract shape changes; any need goes to the Architect as a proposal.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0 and the racing sim files pass the C02 determinism lint — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given the five new handling profiles When the shared vehicle tests and the oracle lines run Then each profile is inside `CLASS_ENVELOPE`, declared `powerKw` is within 3 % of max T·ω, and the `aurelian-sorrel` lines meet C.3.1: 0–100 kph 3.4 ± 0.3 s, 100→0 in 30 m ± 8 %, skidpad 1.30 ± 0.08 g — proof: `pnpm --filter @dv/shared test && pnpm --filter @dv/engine test:lines`
- AC-3 Given a straight fixture route with five gates When positions cross gates in order, skip gate 3, drive the wrong way 35 m, and cross with |Δy| = 7 m Then gates count only in order, the skip is not counted, `race.wrongway` fires and a respawn at the last gate follows after 6 s, the 7 m crossing is rejected, and `placeOrder` sorts by (lap, gate, −distance to next, tick) — proof: `pnpm --filter @dv/mode-racing test -- referee`
- AC-4 Given a class-A car at difficulty normal When impacts of 15 and 30 m/s, a front impact, a spike strip and a 7 m/s landing are applied Then body loss is 0.23 ± 0.03 at 15 m/s, 30 m/s totals the car and emits `race.dnf {reason:'totaled'}`, the engine takes 0.5 × d on the front hit, crossed tires go to 0, the landing damages, and `powerScale` never drops below 0.6 — proof: `pnpm --filter @dv/mode-racing test -- damage`
- AC-5 Given a full nitro tank When nitro fires at 100 kph Then it lasts 4.0 s ± 1 tick, cannot start below 15, and speed never passes 110 % of class top; a throttle press within 0.25 s of GO adds 10, and moving 0.6 m before GO adds 3 s — proof: `pnpm --filter @dv/mode-racing test -- nitro director`
- AC-6 Given the director with colliders not yet ready When 600 ticks run Then it stays in `Loading`; after `ready` it counts down exactly 180 ticks to `race.go`, a finish gate leads to `Results`, `retry` returns to `Grid` with a fresh seed stream, and a car with `upY` < 0.3 for 3 s is reset to the last gate with +5 s — proof: `pnpm --filter @dv/mode-racing test -- director`
- AC-7 Given `content/races/sf.sprint.ferry-ocean-beach/source.json` When compile runs twice Then both `race.json` outputs are byte-identical to the committed file, route length is 10–12 km, gates are ≤ 260 m apart and ≥ 10 m wide, and validate passes; each `V*.source.json` fixture fails with exactly its rule id — proof: `pnpm map:races validate && pnpm check:unit -- tools/map`
- AC-8 Given driver `racing.line` on the sprint (seed 0xC0FFEE, canonical profile) When `CanonicalRunner` runs it twice in Node Then the car finishes, gate ticks are strictly increasing, both traces equal `tests/golden/racing/line.ferry-ocean-beach.json`, and the WebKit run of the same `RunSpec` gives the same trace — proof: `pnpm --filter @dv/mode-racing test -- line && pnpm check:e2e -- --project=webkit-webgl2 --grep @racing-det`
- AC-9 Given the mutants `gate-order` and `rng-swap` When the mutant harness applies them Then the racing suite fails for each, and the unmodified suite passes — proof: `pnpm check:unit -- tools/ci`
- AC-10 Given a running race When 60 ticks pass Then `RaceHudVm` is published every tick with speed, gear, nitro, place, gate and timer filled, and the emitted `racing.start`/`racing.finish` props validate against the C16 registry with no `tier` prop — proof: `pnpm --filter @dv/mode-racing test -- hud && pnpm check:telemetry`
- AC-11 Given WebKit at 844 × 390 with touch When the bridge starts the sprint, the right pedal is held 3 s, the steer arc is dragged, nitro is tapped and reset is held 1 s Then speed exceeds 30 kph, yaw changes, the `Nitro.on` flag is set, and the car respawns at the last gate — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @racing-touch`
- AC-12 Given a production-mode registry When the descriptor test runs Then racing is `comingSoon`, its lazy imports resolve, `unlock.racing` and the four class unlocks validate, and starting from the menu is refused while `__dvBridge.racing.start` works only in QA builds — proof: `pnpm --filter @dv/mode-racing test -- descriptor && pnpm --filter @dv/engine test:modes`
- AC-13 Given the new names, prefabs and gray-box assets When the IP gates run Then every make and model passes and each asset has a provenance record — proof: `pnpm names:lint && pnpm ip:strings && pnpm provenance:check && pnpm check:assets`
- AC-14 Given the branch When the unit suite and the preview deploy run Then both pass and the deployed app still boots — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `shared/racing.referee`; `racing/referee.gates`, `racing/damage.formula`, `racing/nitro`, `racing/director`, `racing/hud`, `racing/descriptor` (`pnpm --filter @dv/mode-racing test`); `shared/vehicle.envelope`, `shared/vehicle.powerCurve`; `tools/map/race.validate`.
- **Lines:** `engine/lines.sorrel.*` (`pnpm --filter @dv/engine test:lines`).
- **Bot and determinism:** `racing/line.headless` (Node), `@racing-det` (WebKit; nightly also Chromium); mutants under `pnpm check:unit -- tools/ci`.
- **E2E:** `@racing-touch` (WebKit 844 × 390).
- **Static:** `map:races validate`, `check:telemetry`, IP gates.

## Demo script
1. `pnpm map:races validate`: one race, all rules green.
2. `pnpm dev`, open `/?unlockAll=1&debug=1`, run `__dvBridge.racing.start('sf.sprint.ferry-ocean-beach', {vehicle: 'vehicle.aurelian-sorrel'})` in the console.
3. Watch the 3-second countdown, drive with W/A/S/D, fire nitro with Left Shift.
4. Drive the wrong way: the warning appears and the car respawns.
5. Finish: the results view-model shows time and place 1 of 1.

## Effort
1 Builder session; about 38 files (generated `race.json` and glTFs excluded); risk **medium**. Compiling on the real graph and the headless run on baked chunks take the most time.

## Risks & fallbacks
- **Bake availability in CI.** `map:races` and the headless run read the bake through the same loader as `pnpm map:verify` (M02a2). If a CI job lacks the bake, validate runs the `race.json`-only rules (schema, V3, V6, V8, V11, V13–V15) there and the full set nightly next to `map:verify`; record the split in "Builder decisions".
- **Tick cost with Rapier `deterministic-compat`** (U-RAC-2) is not asserted here; M1 cars are capped per tier by `config/racing.json` `models.m1MaxActive`.
- **Synthetic touch events in WebKit:** reuse the M01b2 fallback (dispatch `TouchEvent`s).
- **Supercar oracle miss after tuning:** tune `tire.muLong` and the launch ramp only (C.3.1); if two passes fail, keep the data, mark the line `todo` in the golden and report it.

## Notes for the Builder
- Read first: `06-racing.md` §2.1–§2.3, §2.8, §2.10, §5; `06-racing-data.md` §4.1–§4.2, §4.5–§4.7; `06-racing-content.md` C.1–C.3, C.9; `13-qa.md` §3.1–§3.6; ADR-0016.
- Order: shared racing types and referee → mode package and descriptor → director → nitro and damage → cars → `map:races` → line driver → HUD vm → touch e2e → det suite and mutants.
- Sim code under `packages/modes/racing/src/sim/**` is under the C02 lint: `detmath` only, seeded streams (`racing.*`), no timers. The bridge and UI halves are outside it.
- Keep the descriptor `comingSoon`: a story hook reaching racing before M07a2 must take the C09 stub path.
- Gates use C08 `LatLng` and `LandmarkId` imported from `world/c08-api` and `world/c08` (DL-077); never redeclare them.
- Secrets: none. `pnpm deploy:preview` needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (CI); locally it prints the SKIP line. No paid account, no fal.

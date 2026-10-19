# M11a1 — iphone-hardening-governor

## Goal
After this session the platform adapts to the device while the game runs, and the budgets become hard gates. A two-way `QualityGovernor` moves the C13 `DynamicQuality` knobs in their fixed order and demotes the tier only at a safe point. `MemoryBudget` enforces the accounted caps: it evicts at 85 % and steps the streaming radius down at 95 %. `FramePacer` renders 30 fps tiers on 60 and 90 Hz displays. Two racing perf scenarios, `race-sprint` and `race-pursuit-heat4`, run in CI. The nightly `pnpm check:perf -- --fail` becomes a required check. Route 4 accepts desktop Chrome crash reports. **Split boundary (`_PLAN-2.md`, M11a):** M11a1 takes everything provable in CI. M11a2 takes the offline relaunch, safe-point SW updates, the end-to-end abnormal-exit demotion, the iOS quirk pass, `desktop-ultra` calibration, the 30-minute soak and the device passes.

## Requirements
- R-PLAT-03: quality tiers now adapt at runtime (governor and tier demotion), not only at boot.
- R-PLAT-05: frame pacing and the governor are the mechanism that holds 30 fps on iPhone 15 and 60 fps on newer iPhones; M11a2 measures it on devices.
- R-ENG-02: every CPU-side budget row (counts, memory, cold download) fails the nightly build when breached, and the racing scenarios join the gate.

## Depends on
- **M02b1** (`ChunkStore`, streaming radius, chunk upload gate, `walk-civic-center` and `route-ferry-ocean-beach`). **M03b1** (traffic and `downtown-rush`, crowd density hook). **M07a2** (racing AI, 3 VS races, `sf.pursuit.bayview-escape`).
- Also used: M01c (`QualityService`, `PerfProbe`, `RenderBudgetMeter`, `PerfScenarioRunner`, `check:perf`, `perf:verify`, heartbeat), M01e (`WorldPackStore` eviction), M00b/M00d (`nightly.yml`), M05b1 (route 4 handler for CSP reports, `Reporting-Endpoints` header).
- Contracts: C13 1.1.0 (`QualityService`, `DynamicQuality`, `DynamicRange`, `TierDecisionSource`, `PerfScenario`), C12 1.1.0 (route 4), C16 1.2.0 (`app.crash`, DL-224), C02 1.1.0 (the fixed step is unchanged).

## Scope in
- **`FramePacer`** (`11-platform.md` §5.4). A `requestAnimationFrame` callback renders when `elapsed ≥ 1000 / targetFps − 1 ms`. The sim keeps its fixed 60 Hz step with interpolation, and the pacer is bypassed while an XR session is presenting.
- **`QualityGovernor`** (§5.5):
  - Signals: EMA of frame ms (α = 0.06) and p90 over 120 frames.
  - Downgrade when p90 > budget × 1.15 for 2 s. Upgrade when p90 < budget × 0.70 for 10 s. At most one change per 5 s and one upgrade per 30 s.
  - Knob order: `renderScale` in 10 % steps → `shadowDistanceScale` → `buildingDistanceScale` → `lodBias` → `crowdDensity` → `postLevel` → `atmosphereLevel` → `textureMipBias` → `foveation` (XR) → `targetFps`. Floors and ceilings come from `QualityTier.dynamic`, and changes are published through `QualityService.onDynamicChange`.
  - With `xr: true` the governor never touches `renderScale` and records a "next-entry framebuffer scale" request instead (M11b1 consumes it).
  - Tier demotion only after every knob has been at its floor for 20 s, at the next safe point, via `setTier(next, 'governor-demotion')`.
  - `?governor=off` (parsed but inert since M01c) now disables it.
- **`MemoryBudget` enforcement** (§5.6). The sum covers `renderer.info.memory`, wasm buffers, `asset.worker` caches, SAB blocks and the media estimate. At 85 % of any cap: evict LRU chunks (ChunkStore) and textures, raise `textureMipBias`, emit `onMemoryPressure('soft')`. At 95 %: drop the streaming radius one step and emit `'hard'`. A sustained `'hard'` at the floor radius leads to `setTier(next, 'memory-pressure')` at a safe point. `memEstMB` keeps feeding the heartbeat.
- **QA bridge** (QA builds only): `platform.governor.state()`, `platform.governor.inject(frameMs: number[])` (synthetic frame times fed to the governor's signal), `platform.memory.pressure()` and `platform.memory.injectMB(n)`.
- **Racing scenarios** (`11-platform-pwa.md` §11; `06-racing.md` §8, M11a row):
  - `config/perf/paths/race-sprint.json` runs `sf.sprint.ferry-ocean-beach` under the AI bot. `race-pursuit-heat4.json` runs `sf.pursuit.bayview-escape` with heat set to 4.
  - Both: 120 s after a 10 s warm-up, seed 0xC0FFEE, density `nominal`. The rival and police counts follow the tier rows of `06-racing.md` §6.2 as configured by M07a2/M07b1.
  - Both are registered in the `PerfScenarioRunner` and in `tests/perf`.
- **Nightly gate.** In `nightly.yml`, the `pnpm check:perf -- --fail` step loses any `continue-on-error`. `ci.yml` `perf` stays a warning on PRs (08 §5.1).
- **Route 4 crash reports** (`09-backend-contracts.md` row 4; `spec/05-api-and-realtime.md` row 4):
  - The handler accepts Reporting API bodies of `type: 'crash'` beside the existing CSP type. It keeps `body.reason`, `url` path only, `age` and a build id, and scrubs the rest with the C16 `scrub()` rules. It never reads `CF-Connecting-IP`, `User-Agent` or `Cookie`.
  - Bodies over 64 KB get 413; malformed bodies get 400. The handler returns 204, writes one structured log line `{kind: 'crash', reason, path, build}` and emits the server-only C16 1.2 event `app.crash {reason: 'oom' | 'unresponsive' | 'other', build}` (DL-224); this milestone sets `C16_VERSION = '1.2.0'` and adds the name's schema.
  - The `Reporting-Endpoints` header names a `crash-reporting` endpoint and a `default` endpoint, both pointing at route 4: Chromium delivers crash reports to `crash-reporting` (else `default`) with `body.reason` `oom` or `unresponsive`, and Safari sends none [research/gap-observability-cost-guardrails.md §2.1, "Verified facts"; DL-224]. Actual delivery from a real crash is a device observation, kept out of ACs.

## Scope out
- Offline relaunch, SW update at safe points, abnormal-exit demotion wiring and notice, the iOS quirk pass, `desktop-ultra` calibration, the 30-minute soak, and every device pass: M11a2.
- XR framebuffer scale application and XR refresh control (M11b1). Per-knob graphics overrides in Settings (out of v1, DN-S10-06).
- New perf scenarios other than the two racing ones (`npc-mission-crowd` belongs to M06c, `fight-stage` to M08a2).

## Deliverables
- `packages/engine/src/platform/governor/{governor.ts, knobs.ts, signals.ts, frame-pacer.ts}`.
- `packages/engine/src/platform/memory/{memory-budget.ts, eviction.ts}`. The ChunkStore and WorldPackStore hooks are small edits in `packages/world/src/sim/streaming/` (ChunkStore, M02b1) and `packages/engine/src/assets/store/` (WorldPackStore, M01e) (DL-247).
- Edits: `qa-flags.ts` (`?governor=off` active); the bridge (`probe.ts` / perf bridge) additions; `apps/web/src/main.ts` (start the pacer and governor after reveal).
- `config/perf/paths/{race-sprint,race-pursuit-heat4}.json`, the scenario registration in `packages/engine/src/platform/perf/scenario-runner.ts`, and `tests/perf/race.perf.spec.ts`; both ids appended to `config/perf/scenarios.json` (the `check:perf` registry, M02b1; DL-656 part 4).
- `services/edge/src/reports/browser.ts` (crash branch), `packages/shared/src/telemetry.ts` (`app.crash`, `C16_VERSION`), `packages/shared/schemas/telemetry/app.crash.json`, `services/edge/test/reports-crash.spec.ts` (suite `reports-crash`).
- `.github/workflows/nightly.yml` (required perf step) and `tools/ci/test/workflows.test.ts`.
- `packages/engine/test/platform/{governor.spec.ts, memory-budget.spec.ts, frame-pacer.spec.ts}`; `tests/e2e/governor.spec.ts` (`@governor`).
- About 24 files in all.

## Interfaces
- C13 1.1.0 is used verbatim: `QualityService.setTier(id, reason)` with `'governor-demotion'` and `'memory-pressure'`, `onDynamicChange`, `onMemoryPressure`, `DynamicQuality`, `DynamicRange`, `PerfScenario`. Scenario ids come from the 1.1 list.
- C12 1.1.0 route 4: same path, method and auth (`pub`), and quota class `tele`.
- C16 1.2.0: adds the server-only name `app.crash` with its schema (`09-backend-contracts-1.2.md` §3, DL-224) and sets `C16_VERSION`. No other contract change. Bridge members are QA-only engine APIs.

## Acceptance criteria
- AC-1 Given simulated frame series against `desktop` (16.7 ms) When p90 sits at 20 ms for 2 s, then at 11 ms for 10 s, then oscillates every second Then all of these hold:
  - the first downgrade lowers `renderScale` by one 10 % step;
  - the upgrade follows only after 10 s below 0.70 ×;
  - no two changes are closer than 5 s and no two upgrades closer than 30 s;
  - knobs move in the §5.5 order to their floors;
  - with `xr: true` `renderScale` never changes.
  — proof: `pnpm check:unit -- packages/engine/test/platform/governor.spec.ts`
- AC-2 Given every knob at its floor for 20 s When a safe point arrives Then exactly one `setTier(next, 'governor-demotion')` is issued, following `FLAT_LADDER`, and never below `mobile-low` — proof: `pnpm check:unit -- packages/engine/test/platform/governor.spec.ts`
- AC-3 Given a fake budget source at the `mobile` caps When accounted memory crosses 85 % and then 95 % Then `'soft'` fires once with LRU eviction callbacks and a raised `textureMipBias`, `'hard'` fires once and the streaming radius drops one step, and a sustained `'hard'` at the floor radius requests `'memory-pressure'` at the next safe point — proof: `pnpm check:unit -- packages/engine/test/platform/memory-budget.spec.ts`
- AC-4 Given rAF timestamps at 60 Hz and at 90 Hz When the pacer targets 30 fps Then it renders every 2nd and every 3rd callback respectively, within ±1 ms, and it renders every callback while XR presents — proof: `pnpm check:unit -- packages/engine/test/platform/frame-pacer.spec.ts`
- AC-5 Given a QA build on `chromium-webgl2` at `?tier=desktop&perf=1` When `platform.governor.inject` feeds 25 ms frames for 3 s Then `governor.state().dynamic.renderScale` drops below its ceiling. With `?governor=off` the same injection changes nothing — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @governor`
- AC-6 Given the QA build When the two racing scenarios run on `chromium-webgl2` and `webkit-webgl2` for every flat tier Then schema-valid `PerfReport`s exist with `scenario.id` `race-sprint` and `race-pursuit-heat4`, render objects and triangles are within each tier's budget, and the spawned rival count equals the tier's configured cap — proof: `pnpm check:perf -- --scenario race-sprint && pnpm check:perf -- --scenario race-pursuit-heat4`
- AC-7 Given all registered scenarios When `check:perf` runs in fail mode Then every count, memory and cold-download assertion passes for every project and flat tier — proof: `pnpm check:perf -- --fail`
- AC-8 Given the workflow files When the CI tests parse them Then the nightly `check:perf -- --fail` step has no `continue-on-error` and the PR `perf` job still warns only — proof: `pnpm check:unit -- tools/ci`
- AC-9 Given a Reporting API crash body, a 70 KB body and a body with an email in its URL When they are posted to route 4 in the Workers runtime Then the first gets 204, one log line holding only path, reason and build, and one `app.crash` event with `reason` and `build` only, the second gets 413, the email never appears in the log, and the existing CSP-report case still passes — proof: `pnpm check:workers -- reports-crash`
- AC-10 Given the branch When lint, typecheck, the production build with dist verification and the preview deploy run Then all pass and the production bundle contains no `governor.inject` or `injectMB` — proof: `pnpm lint && pnpm typecheck && pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit:** governor, memory budget and frame pacer specs (`11-platform-perf.md` §9 items 5–7), the workflow parse test, and the existing M01c platform specs. Command: `pnpm check:unit -- packages/engine tools/ci`.
- **Workers:** `pnpm check:workers -- reports-crash`.
- **E2E:** `@governor` on `chromium-webgl2`; `@renderer-host`, `@perf-meter` and `@telemetry` stay green.
- **Perf:** `pnpm check:perf -- --fail` over all scenarios. SwiftShader frame times are never asserted.

## Demo script
1. `pnpm dev`, open `/?perf=1&tier=mobile`, and run `__dvBridge.platform.governor.inject(Array(180).fill(30))`. The HUD shows `renderScale` stepping down; stop injecting and watch it climb back after 10 s.
2. Run `__dvBridge.platform.memory.injectMB(500)` and see the `soft`, then `hard`, events in the console and a smaller streaming radius.
3. Run `pnpm check:perf -- --scenario race-pursuit-heat4` and open `test-results/perf.race-pursuit-heat4.chromium-webgl2.mobile.json` (reports are keyed by scenario from M02b1).

## Effort
1 Builder session; about 24 files; risk **medium**. The governor and memory policies are well specified, so the time goes to wiring eviction into ChunkStore and making the racing scenarios deterministic in CI.

## Risks & fallbacks
- **A racing scenario exceeds the `mobile-low` object budget in CI.** That is a real finding, not a test problem: lower the scenario's crowd density through the governor floor or the racing tier caps (data), and report it. Never raise a budget in `config/tier-budgets.json` here; calibration is M11a2's.
- **Eviction thrash** (evict and immediately reload the same chunk): keep a pinned set (the current chunk plus its ring) and a 10 s re-admission delay, and log a Builder decision.
- **Nightly flakes after the gate turns required:** quarantine by tag per the flake policy (`13-qa.md` §5). Never loosen the fail mode.
- **Overrun:** the route 4 crash branch (AC-9) moves to M11a2 first, then the e2e (AC-5); the unit proofs stay.

## Notes for the Builder
- Read first: `11-platform.md` §4.5, §5.3–§5.6; `11-platform-perf.md` §4–§5, §9; `11-platform-pwa.md` §9, §11; `06-racing.md` §6.2, §8; `spec/08-test-and-ci.md` §4–§5.
- **Facts.** iPhone Safari is planned at 60 Hz; ProMotion above 60 is not assumed (U-PLT-3), so tests use 60 and 90 Hz synthetic timestamps only. `renderer.info` is authoritative on WebGL2 projects only (U-PLT-14). Budgets are S11 engineering targets (`11-platform.md` §4.5).
- **Secrets.** None for the code. `pnpm deploy:preview` needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (SKIP and exit 0 when absent). Q-13 devices are not needed until M11a2.
- **fal.** None.
- Paths: M01c put perf paths under `config/perf/paths/` and the heartbeat under `platform/telemetry/`; keep both (the canonical locations since DL-221; `_PLAN-2.md` is aligned).
- Branch `m11a1-iphone-hardening-governor`.

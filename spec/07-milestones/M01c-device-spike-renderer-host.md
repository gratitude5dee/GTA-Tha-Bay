# M01c — device-spike-renderer-host

## Goal
The minimal M00 `RendererHost` becomes the C13 platform core: pure device classification, a benchmarked and persisted tier, the renderer built per `BackendPolicy` with one WebGL2 retry and one device-loss recovery, perf tooling (`PerfReport`, `perf:verify`, a real `check:perf`), and a telemetry client with heartbeat. Scripted runs on iPhone 15, iPhone 16/17, Quest 3/3S, Vision Pro and a Mac are committed to `docs/device-spike/M01c-report.md` and decide `webgpu.mobile` (DN-S11-01).

## Requirements
- R-PLAT-03: one `WebGPURenderer` with automatic WebGL2 fallback, `?gl=1`, backend per tier, tier auto-selected.
- R-PLAT-05: first measured frame times on the iPhone 15 floor (`mobile-low`, 30 fps) and iPhone 16/17 (`mobile`, 60 fps).
- R-ENG-02: budgets become checks: `check:perf` counts render objects and triangles; `perf:verify` judges device reports.
- R-PLAT-01: heartbeat-based abnormal-exit detection for the iPhone PWA. iOS gives no crash reports (F-064).
- R-PLAT-02 (support): Quest and Vision Pro signals and backend recorded before M11b1.

## Depends on
- **M00:** minimal `renderer-host.ts`, `qa-flags.ts`, `probe.ts`/`__dvBridge.platform`, `config/tier-budgets.json`, C13 §4.1–§4.2 in `c13.ts`, the four Playwright projects.
- **M00a:** `POST /api/v1/t`, `packages/shared/src/telemetry.ts` (`CLIENT_TELEMETRY_NAMES`, envelope), name schemas.
- **M01a2:** home page boots `sim.worker`; `@dv/web verify:dist`. Optional **M01b2:** if the gray-box block exists, `graybox-walk` follows it.
- Contracts: C13 1.1 (`11-platform.md` §4, §5; `11-platform-pwa.md` §6, §9, §11; `11-platform-perf.md` §4), C16 1.1.

## Scope in
- **Types.** Copy `11-platform.md` §4.6 verbatim into `c13.ts`: `DeviceSignals`, `AdapterSummary`, `DeviceProfile`, `TierDecisionSource`, `BenchmarkResult`, `TierDecision` and `PlatformSettings` with the 1.1 `dev?` field. Copy `PerfScenario`, `PerfReport`, `Expectation` and `DeviceChecklist` into `packages/shared/src/platform/perf.ts`. `RendererHost` and `GpuResourceOwner` (§5.8) live in `packages/engine`, because `@dv/shared` never imports three.
- **`classifyDevice`.** Pure, in `packages/shared/src/platform/classify.ts`. It applies the ordered rules of §5.2 plus `lowMemoryHint` and `textureFamily`. `uaHash` and `adapterHash` are `sha256Hex(...)` truncated to 16 hex characters. `DeviceProbe` (engine) gathers the signals. It requests the adapter once and asks `isSessionSupported('immersive-vr')` only when `navigator.xr` exists.
- **Tier config.**
  - Each `config/tier-budgets.json` entry becomes a full `QualityTier`, adding `features` (§4.4), `backend` (§4.3; mobile tiers `device-spike-gated`), `dynamic` and `xr` (XR tiers only; `11-platform-xr.md` §4.1).
  - `dynamic` floors: `renderScale` 0.5, `postLevel` 0, `targetFps` = `minFps`. Ceilings are the tier values.
  - New `config/platform-flags.json`: `{"webgpu.mobile": false}`.
- **Tier selection.**
  - Provisional tier per §5.3.
  - `Benchmark`: 3 s (≤ 180 frames) on `BenchmarkScene`, a synthetic TSL chunk group at 80 % of the tier's render-object and triangle budget, orbited by a canned camera.
  - Step down one `FLAT_LADDER` rung when p90 > `frameBudgetMs` × 1.1, at most twice.
  - Promote to `desktop-ultra` only on a non-fallback WebGPU adapter with p90 ≤ 8.35 ms.
  - Persist to IDB `dv-platform/tier-decision`, validated against `tier-decision.v1`; a mismatch re-benchmarks. Re-run when `build`, `uaHash` or `adapterHash` changes.
  - `?tier=` works in QA builds only.
- **`QualityService`** (§4.2). `setTier` applies at safe points only (boot, title); otherwise it is queued.
- **`RendererHost`** (§5.1 steps 3–5, §5.8, plus the C13 1.1 `setMenuScene`/`clearMenuScene`).
  - The renderer comes from an injected `createRenderer` factory.
  - `xr.enabled` is set before `init()` on XR-capable profiles, using the XR tier's policy.
  - `forceWebGL` comes from the policy, from `?gl=1`, or from `webgpu.mobile === false` on mobile tiers. `?gpu=1` forces WebGPU (QA only).
  - After `init`: `reversedDepthBuffer` and `depthPolicy`, `PCFShadowMap`, `NeutralToneMapping`, `info.autoReset = false`.
  - A failed WebGPU init is retried once with `forceWebGL` and emits `err.gpu{kind:'init'}`. If WebGL2 also fails, show the M00 Unsupported page.
  - Device loss is recovered once, and every registered owner is called again. A second loss shows the reload prompt.
  - `installXrFallback()` throws `NotImplementedError('M11b1')`.
- **Perf (QA builds only).**
  - `PerfProbe`: a 36,000-sample `Float32Array` ring with percentiles and hitch counts.
  - `RenderBudgetMeter` per `11-platform-perf.md` §5.
  - `memory()`: counters only, from `renderer.info.memory` plus wasm bytes.
  - `PerfHud` on `?perf=1`, with an "Export" button that downloads `perf.json` and `notes.json` (signals, `persist()`, `estimate()`, UA).
  - `PerfScenarioRunner` with `graybox-walk` from `config/perf/paths/graybox-walk.json`: a 60 m orbit of the ENU origin, 120 s, seed 0xC0FFEE.
  - Bridge additions: `tier()`, `setTier(id)`, `signals()`, `memory()`, `perf.run(id, {durationS?})`, `perf.report()`.
- **Telemetry client** (pwa §9): batches ≤ 50 events and ≤ 64 KB with the C16 envelope to `/api/v1/t` (`sendBeacon` on `hidden`/`pagehide`); consent from `PlatformSettings`, default on (DL-140); errors deduplicated at ≤ 5 per fingerprint. Events: `app.start` (with `store: 'memory'` until M01e), `app.ready` (with `phaseWorldMs: 0`), `tier.decision`, `app.hidden`, `err.js`, `err.promise`, `err.gpu` and `perf.minute`.
- **Heartbeat** (`localStorage['dv.hb']`, every 5 s while visible).
  - At boot, a `running` record emits `app.abnormal_exit` and a `hidden` record emits `app.cold_resume`.
  - Two abnormal exits within 24 h on one tier, with `memEstMB` > 0.8 × (`maxAccountedHeapMB` + `maxGpuResourceMB`), demote the tier one rung (source `abnormal-exit-demotion`).
  - A 5 s rAF stall watchdog runs alongside.
- **Lifecycle (minimal):** `hidden` pauses the sim, marks the heartbeat and flushes telemetry; `visible` clamps the first `dt`.
- **QA page** `apps/web/qa/memory-bomb.html`: allocates 64 MB steps (`ArrayBuffer`s, then `DataTexture`s), writing the running total to `localStorage['dv.membomb']` before each step; on relaunch it shows the last total and the heartbeat state.
- **Device checklists** and the scripts `perf:checklist` and `perf:verify`.

## Scope out
- Two-way governor, `FramePacer`, `MemoryBudget` enforcement, 30-minute soak and threshold calibration: M11a.
- XR session, swap, input, comfort: M11b1. `FirstGestureUnlock` and the video pool: M04c.
- Settings UI (tier override, compatibility mode, re-run benchmark): M04b1. OPFS store: M01e. Boot-chunk benchmark: M02b1.

## Deliverables
- `packages/shared/src/platform/{c13.ts (extend), classify.ts, perf.ts}`, `packages/shared/schemas/tier-decision.v1.json`, `packages/shared/test/platform.classify.spec.ts`.
- `config/tier-budgets.json` (extended), `config/platform-flags.json`, `config/perf/paths/graybox-walk.json`.
- `packages/engine/src/platform/`:
  - `device-probe.ts`, `tier-select.ts`, `benchmark.ts`, `quality-service.ts`, `renderer-host.ts`, `platform-store.ts` (IDB `dv-platform`), `lifecycle.ts`, `index.ts` (`createPlatform`);
  - `qa-flags.ts`, adding only flags already listed in `11-platform-perf.md` §4: `?gpu=1`, `?perf=1`, `?governor=off` (parsed, inert), `?limits=`, `?scenario=`;
  - `probe.ts` (bridge additions);
  - `perf/{probe,meter,hud,scenario-runner,export}.ts`, `telemetry/{client,heartbeat,errors}.ts`.
- `packages/engine/test/platform/{tier-select,renderer-host,perf-probe,heartbeat,telemetry,config}.spec.ts`.
- `apps/web/src/main.ts` (boot via `createPlatform`); `apps/web/qa/memory-bomb.{html,ts}`; `verify-dist.mjs` also rejects `memory-bomb` and `PerfHud`.
- `tools/ci/{perf-check,perf-verify,perf-checklist}.ts`, `tools/ci/schemas/perf-report.v1.json`, `tools/ci/test/perf-verify.spec.ts`, `tools/ci/fixtures/perf/{ok,over}.json`.
- `tools/ci/fixtures/ua/{desktop-chrome,desktop-safari,iphone-safari,quest-browser,visionpro-safari}.json`: `{synthetic, signals, expect: {class, headset, provisionalTier}}`. Captured files replace the synthetic ones.
- `tools/ci/checklists/M01c-{iphone15,iphone16,quest3,visionpro,mac}.json`; `docs/device-spike/M01c-report.md` (template, then filled); `docs/device-spike/M01c/<device>/{perf.json,notes.json}`.
- `tests/e2e/platform-host.spec.ts` (`@renderer-host`, `@perf-meter`, `@telemetry`), `tests/perf/perf-budget.spec.ts`.
- Root scripts:
  - `check:perf` becomes real. It runs `tests/perf` on `chromium-webgl2` and `webkit-webgl2` for each flat tier and writes `test-results/perf.<project>.<tier>.json`. It then runs `perf-verify --counts-only`: warnings by default, failures with `-- --fail`.
  - New **`perf:verify -- <perf.json> --tier <id> [--checklist <f>] [--counts-only]`**.
  - New **`perf:checklist -- <checklist.json>`**.
- ≈ 36 code files. The JSON fixtures, paths and checklists are data and are not counted.

## Interfaces
- C13 1.1: §4.6 types, §5.8 interfaces and the 1.1 menu-scene members are copied verbatim. `PerfScenario`, `PerfReport` and `DeviceChecklist` are verbatim. No new `QaFlags`.
- C16 1.1: only registry names, with props per `09-backend-contracts.md` §3. No new names.
- Not contracts: `createPlatform`, `Benchmark`, the bridge methods. No contract change; gaps go into the report as proposals.

## Acceptance criteria
- AC-1 Given a clean clone after M01a2 When the standard gates run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build`
- AC-2 Given each `tools/ci/fixtures/ua/*.json` When `classifyDevice` runs with `window` and `navigator` deleted Then the class, headset and provisional tier equal `expect`, and every `FLAT_TIER_OF` value is on `FLAT_LADDER` — proof: `pnpm check:unit -- packages/shared`
- AC-3 Given a fake renderer and injected frame series When the selector runs Then: `desktop` at p90 20 ms becomes `mobile`; at 40 ms it becomes `mobile-low` and stops (two steps at most); a stored decision is reused for the same `build` and re-benchmarked after a change; a record with `v: 2` is ignored; `?tier=` is ignored unless `VITE_DV_QA` is `'1'` — proof: `pnpm check:unit -- packages/engine`
- AC-4 Given a fake factory whose WebGPU `init` rejects When `RendererHost.init` runs Then it retries once with `forceWebGL: true`, reports `webgl2` and emits one `err.gpu{kind:'init'}`. After two simulated device losses: exactly one recovery, every owner's `onRendererReplaced` called once, then the reload prompt — proof: `pnpm check:unit -- packages/engine`
- AC-5 Given the QA build When `/?tier=desktop` opens on `chromium-webgl2` and `/?gl=1&tier=desktop` opens on `chromium-webgpu` Then `backend()` is `webgl2` in both, `tier()` is `desktop`, and `depthPolicy` is set — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @renderer-host && pnpm check:e2e -- --project=chromium-webgpu --grep @renderer-host`
- AC-6 Given `chromium-webgl2` at `?tier=desktop&perf=1` When `perf.run('graybox-walk', {durationS: 10})` runs Then the meter's maximum triangle count is within ±10 % of `renderer.info.render.triangles`, and the report validates against `perf-report.v1.json` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @perf-meter`
- AC-7 Given `fixtures/perf/ok.json` and `over.json` When `perf:verify --tier mobile-low` runs Then `ok` exits 0, and `over` exits non-zero and prints one line per failed assertion — proof: `pnpm check:unit -- tools/ci`
- AC-8 Given the QA build When `check:perf` runs in fail mode Then 8 schema-valid reports exist (2 projects × 4 flat tiers), each with `renderObjectsMax` ≤ its tier budget — proof: `pnpm check:perf -- --fail`
- AC-9 Given a fake `localStorage` and clock When boots follow a `running` record, then a `hidden` record, then two `running` records within 24 h above the memory threshold at `mobile` Then the boots emit `app.abnormal_exit`, then `app.cold_resume`, then a demotion to `mobile-low` with source `abnormal-exit-demotion`. With Diagnostics off the record is written but nothing is sent — proof: `pnpm check:unit -- packages/engine`
- AC-10 Given `/api/v1/t` intercepted When the QA build boots Then the first batch holds `app.start` (`coi`, `store`, `backend`, `tier`), `tier.decision` and `app.ready`. Every name is in `CLIENT_TELEMETRY_NAMES`, no event has more than 16 props, and no body contains the user agent — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @telemetry`
- AC-11 Given a production build When the dist verifier runs Then there is no `qa/` page, no `memory-bomb`, no `PerfHud` and no `__dvBridge` — proof: `pnpm build && pnpm --filter @dv/web verify:dist`
- AC-12 Given an iPhone 15 Home Screen app on the preview URL When the operator runs a 10-minute `graybox-walk` at `?perf=1&tier=mobile-low`, exports, then runs the memory bomb and relaunches Then `perf.json` and `notes.json` are committed under `docs/device-spike/M01c/iphone15/`, `perf:verify` passes at `mobile-low`, the run logs no `app.abnormal_exit`, and the report holds the memory-bomb total — proof: manual: iPhone 15, steps of `pnpm perf:checklist -- tools/ci/checklists/M01c-iphone15.json`, then `pnpm perf:verify -- docs/device-spike/M01c/iphone15/perf.json --tier mobile-low`
- AC-13 Given Quest 3, Vision Pro (visionOS 26.2+) and the Mac (Chrome, Safari) When their checklists run Then the captured `DeviceSignals` files replace the synthetic fixtures and still pass AC-2, and the report records each device's backend, adapter summary and UA — proof: manual: each device per `tools/ci/checklists/M01c-*.json`, then `pnpm check:unit -- packages/shared`
- AC-14 Given the iPhone 15 WebGPU run (`?gpu=1`, 30 min, Home Screen) When it is recorded Then `webgpu.mobile` is `true` only if the run had no abnormal exit and p90 ≤ `frameBudgetMs`; otherwise it stays `false` and the report states the reason — proof: manual: iPhone 15, steps 7–9 of `M01c-iphone15.json`; the reviewer compares the report with `config/platform-flags.json`
- AC-15 Given the branch When the preview deploys Then isolation holds — proof: `pnpm deploy:preview && pnpm check:coi -- <preview-url>`

## Test plan
- **Unit** (`pnpm check:unit`): classify, config schemas, tier-select, renderer-host (fakes), perf-probe, heartbeat, telemetry, perf-verify.
- **e2e:** `@renderer-host`, `@perf-meter`, `@telemetry`; WebGPU asserted only with `DV_EXPECT_WEBGPU=1` (U-PLT-19). **Perf:** `pnpm check:perf`, counts only; SwiftShader frame times are never asserted [research/gap-ci-cd-release-assets.md §4.1].
- **Device:** AC-12–14. A device missing under Q-13 is marked "Blocked on Q-13" and does not block the merge; AC-12 is the floor gate.

## Demo script
1. `pnpm dev`, open `/?perf=1`: the HUD shows tier, backend, objects and triangles; `/?perf=1&gl=1&tier=mobile-low` shows `webgl2` and fewer objects.
2. Run `__dvBridge.platform.perf.run('graybox-walk', {durationS: 10})`, then `perf.report()`.
3. `pnpm perf:verify -- tools/ci/fixtures/perf/over.json --tier mobile-low` prints the failures.
4. Reload mid-run: the next boot's batch carries `app.abnormal_exit`. Open `docs/device-spike/M01c-report.md`.

## Effort
1 session; ≈ 36 code files plus data; risk **medium-high** (factory seams, r186 `info` names, device access per Q-13).

## Risks & fallbacks
- **iPhone 15 under 30 fps on the synthetic scene.** Record the run, re-run at 60 % object load, keep `mobile-low` as the floor and open an M11a item. AC-12 is reported as failed, not waived.
- **No SwiftShader WebGPU on the runner (U-PLT-19).** The unit test with the fake factory proves WebGPU init; e2e asserts the `?gl=1` path.
- **`renderer.info` names differ from S11-F1.** Read the installed `three` source, adapt, and log a Builder decision. The ±10 % AC stands.
- **Export blocked on device:** use Safari Web Inspector from the Mac. **Overrun:** stop after AC-11; memory bomb and checklist printer follow in a second PR.

## Notes for the Builder
- Read first: `11-platform.md` §4–§5; `11-platform-pwa.md` §6, §9, §11; `11-platform-perf.md` §3–§9; `09-backend-contracts.md` §3. Facts: F-002, F-004, F-005, F-009–F-013, F-062, F-064 [research/stack-rendering-platform.md §1.2, §3, §6.1, §6.3].
- Order: types/config → classify → selector → host → perf scripts → telemetry → memory bomb → checklists → e2e → devices. Detect the backend as M00's `probe.ts` does; request only the GPU limits the engine needs [research/gap-ci-cd-release-assets.md §4.1].
- The report records observations for U-PLT-1, U-PLT-2, U-PLT-4, U-PLT-6, U-PLT-7, U-PLT-9, U-PLT-14, U-PLT-15, U-PLT-18, U-ENG-5 and U-ENG-8. Never assert one. List them in the PR body for the Architect; do not edit `spec/99` or the domain specs.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (`deploy:preview`, CI). If absent, the M00 SKIP line applies. No paid account. Devices: Q-13.
- Branch `m01c-device-spike-renderer-host`.

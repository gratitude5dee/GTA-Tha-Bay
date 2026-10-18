# M11a2 — iphone-hardening-governor

## Goal
After this session the iPhone Home Screen app behaves like a native game across a long session. It relaunches offline into single-player from cached packs. Shell updates apply only at safe points and never during a mission. Two abnormal exits demote the tier, with a one-time notice the player can override in Settings. The iOS lifecycle quirks are handled: hidden-autosave, audio resume, Wake Lock during cutscenes and races, rotate overlay. The M11a2 device passes are recorded and judged by `perf:verify`: iPhone 15 at `mobile-low` with a 30-minute soak, iPhone 16/17 at `mobile`, and an Apple Silicon Mac at `desktop`. The `desktop-ultra` and † rows carry a calibration record, so `check:perf` knows which rows may fail and which only warn. **Split boundary:** M11a1 delivered the governor, memory enforcement, pacer, racing scenarios, the nightly gate and route 4 crash reports.

## Requirements
- R-PLAT-01: the installable PWA survives offline relaunch, updates safely and keeps the iPhone Home Screen app stable over a 30-minute soak.
- R-PLAT-05: device passes on iPhone 15 (30 fps floor) and iPhone 16/17 (60 fps) judged against the C13 frame acceptance.
- R-ENG-02: budgets on real devices become recorded, verified artifacts; uncalibrated † rows are explicit.

## Depends on
- **M11a1** (governor, `MemoryBudget`, `FramePacer`, racing scenarios, required nightly perf).
- Also used:
  - M00: `PwaUpdateController`, SW and `check:coi`.
  - M01c: heartbeat, the abnormal-exit decision, `perf:checklist` and `perf:verify`.
  - M01e: `WorldPackStore` pinning and `persist()`. M04c: `FirstGestureUnlock` and Wake Lock in the flat host.
  - M04b1/M04b2: Settings › Graphics, toasts, rotate overlay.
  - M05a1: mission start and end events.
- Contracts: C13 1.1.0 (`PwaUpdateController`, `TierDecision`, `PerfReport`, `DeviceChecklist`), C16 1.1.0 (`app.abnormal_exit`, `app.cold_resume`, `storage.persist`), C05 1.1.0 (`SaveReason 'hidden'`).

## Scope in
- **Offline relaunch** (`11-platform-pwa.md` §4–§5):
  - The precache holds the shell, `/asset-catalog.json`, the decoders and the Rapier wasm.
  - `WorldPackStore` pins the packs of the current district and the safehouse district.
  - Offline boot reads the cached catalog, skips network-only features (NPC dialogue falls back to ink; telemetry is queued and flushed when back online), reaches the menu and starts or continues single-player.
  - A clear "Offline" chip shows in the menu.
- **Safe-point SW updates** (§4). The S10 shell calls `markSafePoint('menu' | 'mission-end' | 'safehouse' | 'loading')` and `markUnsafe()`. Mission start, a mode child session (race, fight, tycoon week) and an active cutscene are unsafe. The update toast appears only at a safe point. `applyNow()` refuses while unsafe, and after an update `crossOriginIsolated` is still true.
- **Abnormal-exit demotion, end to end** (§9). At boot the tier selector honours the `abnormal-exit-demotion` `TierDecision` that M01c records. It shows a one-time notice (an S10 card with a LocKey). Settings › Graphics shows the tier with its decision source, and the player can raise it (`user-override`). A later `build` change re-runs the benchmark as §5.3 says.
- **iOS quirk pass** (§6 table):
  - On hidden: a C02 `save.request` with reason `hidden` within 100 ms, heartbeat `hidden`, Wake Lock released, audio suspended.
  - On visible: `AudioContext` resumed, with a "Tap to resume" card if interrupted; Wake Lock re-acquired during cutscenes and races; first `dt` clamped; GPU device liveness checked.
  - `navigator.audioSession.type = 'playback'` when the property exists.
  - An `idle()` helper over `MessageChannel`.
  - `navigator.storage.persist()` after story start, emitting `storage.persist`.
  - The rotate overlay during play but not in menus.
- **Calibration record.** `config/perf/calibration.json` lists, per tier and per † row, `{status: 'calibrated' | 'uncalibrated', source, measured?}`. `perf-check` and `perf-verify` fail only on rows that are not † or that are calibrated, and warn on the rest. Measured values that argue for different numbers go to the Architect as a proposal. Do not change `config/tier-budgets.json`: it mirrors the normative `11-platform.md` §4.5 table, which M00's test pins.
- **Device checklists** `tools/ci/checklists/M11a2-{iphone15,iphone16,mac,desktopB,desktopC}.json` (C13 `DeviceChecklist`):
  - a 120 s `route-ferry-ocean-beach` run exported as `perf.json` and a 120 s `race-sprint` run exported as `race-sprint.perf.json`;
  - a 30-minute free-play soak (walk, drive, Act 1 mission 1) with the heartbeat state and reload count in `notes.json`;
  - Low Power Mode on and off, an offline relaunch, the update toast at a safe point, and the thermal state after the soak.
  - Results go to `docs/device-runs/M11a2/<device>/{perf.json, notes.json}` (soak files `soak.notes.json`). `desktopB` and `desktopC` are optional (Q-13).

## Scope out
- XR device passes (M11b1, M11b4). New perf scenarios. Governor policy changes (M11a1).
- Changing any budget number in `config/tier-budgets.json` or the §4.5 table (Architect).
- Push notifications, background sync and app-store packaging (non-goals).

## Deliverables
- `apps/web/src/sw.ts` (offline catalog route, telemetry queue) and `apps/web/src/pwa-update.ts` (safe-point wiring).
- `packages/engine/src/platform/lifecycle/{lifecycle.ts, wake-lock.ts, audio-session.ts, idle.ts}`.
- `packages/engine/src/platform/telemetry/heartbeat.ts` (demotion applied at boot) and the tier-selector edit.
- `packages/ui/src/shell/` notice card, the Offline chip and the Settings › Graphics source line, plus `content/ui/i18n/en.json` keys.
- `config/perf/calibration.json`, the `tools/ci/{perf-check,perf-verify}.ts` edits and `tools/ci/test/calibration.spec.ts`.
- `tools/ci/checklists/M11a2-*.json` (5 files); `docs/device-runs/M11a2/README.md`; `docs/device-runs/M11a2/{iphone15,iphone16,mac}/…` (operator output).
- `tests/e2e/{offline-relaunch,sw-update,demotion,lifecycle}.spec.ts` (`@offline-relaunch`, `@sw-update`, `@demotion`, `@lifecycle`).
- About 30 hand-written files; device outputs are not counted.

## Interfaces
- C13 1.1.0 verbatim: `PwaUpdateController.markSafePoint/markUnsafe/applyNow`, `TierDecisionSource` values `abnormal-exit-demotion` and `user-override`, `DeviceChecklist`, `PerfReport`.
- C02 1.1.0 `SimControlMessage {t:'save.request', reason:'hidden'}` on the command ring. C16 1.1.0 names only.
- No contract change. `calibration.json` is tool config, not a C13 shape.

## Acceptance criteria
- AC-1 Given a warmed QA build that has played into the Civic Center district When the context goes offline and the page reloads Then the menu loads from the SW precache, "Continue" starts single-player from pinned packs without a network request leaving the page, and the Offline chip is visible. This holds in both WebKit and Chromium — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @offline-relaunch && pnpm check:e2e -- --project=chromium-webgl2 --grep @offline-relaunch`
- AC-2 Given a served build and then a second build with a changed SW When the page detects the update during an active mission Then no toast shows and `applyNow()` rejects. After the mission ends (`mission-end`), the toast shows, the update applies, and `crossOriginIsolated` is true after the reload — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @sw-update`
- AC-3 Given two `running` heartbeat records within 24 h at `mobile` above the memory threshold, injected before boot When the app boots on WebKit Then the tier is `mobile-low` with source `abnormal-exit-demotion`. The notice shows once and not after a second reload. Raising the tier in Settings records `user-override` — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @demotion`
- AC-4 Given a running story session on WebKit with a fake `navigator.wakeLock` When `visibilitychange` goes to hidden and back to visible during a cutscene Then a `hidden` save request is posted within 100 ms, the heartbeat state is `hidden`, the Wake Lock is released and then re-acquired, the first `dt` after resume is clamped, and the resume card shows when the `AudioContext` stays suspended — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @lifecycle`
- AC-5 Given perf fixtures that breach an uncalibrated † row and a calibrated row When `perf-verify` runs with `config/perf/calibration.json` Then the † breach prints a warning and exits 0, the calibrated breach exits non-zero, and every tier and † row of §4.5 has an entry in the calibration file — proof: `pnpm check:unit -- tools/ci`
- AC-6 Given an iPhone 15 Home Screen app on the preview URL When the operator follows the checklist (route and race runs at `mobile-low`, a 30-minute soak, Low Power Mode on and off, an offline relaunch) and commits the outputs Then `perf:verify` passes both reports at `mobile-low` and `soak.notes.json` records zero tab reloads and no `app.abnormal_exit`. The run records U-PLT-1, U-PLT-2, U-PLT-4, U-PLT-16, U-PLT-17 and U-ENG-8 — proof: manual: iPhone 15, steps of `pnpm perf:checklist -- tools/ci/checklists/M11a2-iphone15.json`, then `pnpm perf:verify -- docs/device-runs/M11a2/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M11a2-iphone15.json` and `pnpm perf:verify -- docs/device-runs/M11a2/iphone15/race-sprint.perf.json --tier mobile-low`
- AC-7 Given an iPhone 16 or 17 Home Screen app When the operator runs its checklist Then `perf:verify` passes at `mobile`, and the run records U-PLT-3 (the observed rAF rate) — proof: manual: iPhone 16/17, steps of `pnpm perf:checklist -- tools/ci/checklists/M11a2-iphone16.json`, then `pnpm perf:verify -- docs/device-runs/M11a2/iphone16/perf.json --tier mobile --checklist tools/ci/checklists/M11a2-iphone16.json`
- AC-8 Given an Apple Silicon Mac in Chrome and in Safari When the operator runs its checklist Then `perf:verify` passes at `desktop` for both browsers, and `calibration.json` records whether `desktop-ultra` was calibrated (only with a Desktop C run) or stays `uncalibrated`; `notes.json` records U-REC-2 (whether Chrome delivered a crash report to route 4 during the run) — proof: manual: Apple Silicon Mac, steps of `pnpm perf:checklist -- tools/ci/checklists/M11a2-mac.json`, then `pnpm perf:verify -- docs/device-runs/M11a2/mac/perf.json --tier desktop --checklist tools/ci/checklists/M11a2-mac.json`
- AC-9 Given the branch When the production build, dist verification, the isolation check on a served build and the preview deploy run Then all pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm check:coi -- --serve http://localhost:8788 && pnpm deploy:preview`

## Test plan
- **E2E:** `@offline-relaunch` (WebKit and Chromium), `@sw-update`, `@demotion` and `@lifecycle` (WebKit); M00's `@pwa` and `@coi` stay green.
- **Unit:** the calibration spec; the M01c heartbeat and tier-select specs stay green (`pnpm check:unit -- tools/ci packages/engine`).
- **Device:** AC-6 to AC-8. The `device-runs` CI job re-runs `perf:verify` on each committed `perf.json`. Desktop B and C are optional.

## Demo script
1. `pnpm build && pnpm check:e2e -- --project=webkit-webgl2 --grep @offline-relaunch`.
2. On an iPhone, open the preview, add it to the Home Screen, play a minute, enable Airplane Mode, relaunch, and Continue.
3. Start a mission while a new preview deploys: no toast appears. Finish the mission and the "Update ready" toast appears.

## Effort
1 Builder session for the code (about 30 files) plus an operator device session; risk **high**, because the device passes depend on Q-13 hardware and iOS behaviour that is not in the ledger.

## Risks & fallbacks
- **Q-13 devices unavailable:** AC-6 to AC-8 are reported as "Blocked on Q-13" with the checklists committed. The code ACs (AC-1 to AC-5, AC-9) still complete the milestone's CI part, and M14b3's release pass needs these runs.
- **iOS evicts OPFS between launches** (U-PLT-16): offline relaunch falls back to "Connect once to download the city". AC-1 covers the browser engines; the device run records the iOS result.
- **The soak shows a tab reload:** keep the run, record `memEstMB` at the last heartbeat, file the finding against the tier caps (Architect proposal), and do not loosen `perf:verify`.
- **Overrun:** the Settings source line and the Offline chip are the cut line (report them as open, and AC-1 and AC-3 then skip those assertions); demotion, lifecycle and offline relaunch stay.

## Notes for the Builder
- Read first: `11-platform-pwa.md` §4–§6, §9–§10; `11-platform.md` §4.5, §5.3; `11-platform-perf.md` §5–§6, §9; `spec/08-test-and-ci.md` §3.2–§3.3, §4.3; `spec/99-open-questions.md` Q-13 and U-PLT rows.
- **UNVERIFIED items are only recorded:** Home Screen vs tab WebGPU (U-PLT-1), jetsam limits (U-PLT-2), ProMotion (U-PLT-3), post-jetsam behaviour (U-PLT-4), `GPUDevice.lost` before a kill (U-PLT-5), OPFS eviction (U-PLT-16), Low Power Mode (U-PLT-17), suspension timing (U-ENG-8), IndexedDB durability under jetsam (U-ENG-9). None is asserted.
- **Secrets.** Only the deploy pair for `deploy:preview` (SKIP and exit 0 when absent). The operator uses the preview URL; no production deploy is needed.
- **Gates.** Q-13 devices (owner). No fal.
- Branch `m11a2-iphone-hardening-governor`.

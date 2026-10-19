# M08c2 — pose-calibration-gate

## Goal
After this session optional full-body pose control in Culture Wars can be turned on and is safe to ship. On top of M08c1's `pose.worker`, binder and classifier, it adds the consent gate, the calibration flow, a device-local calibration store, the `full`/`assisted`/`unavailable` capability decision, the camera indicator with stop-on-hide, the presence and freeze fallbacks, hybrid mode (C03 1.1 `setPoseHybrid`), the R-IP-04 privacy assertions, the `fight-stage-pose` scenario and the first device runs (iPhone 15, desktop webcam). Touch, pad and keys always work, and `unavailable` is a valid device outcome.

## Requirements
- R-MODE-03: optional pose control with calibration and fallback to pad, touch and keys.
- R-IP-04: frames and landmarks stay on the device, proven by request, storage and header assertions; consent card and delete control.
- R-ENG-02: the `fight-stage-pose` perf scenario and the device latency report.
- R-ENG-04: camera indicator, one-tap fallback, hybrid option.

## Depends on
- **M08c1**: `PoseClient`, `pose.worker`, `PoseBinder`, FSM and filters, fixture generator `tools/ci/pose-fixtures/gen.ts`, `fighter:pose-fixtures`, self-hosted `/pose/` assets, `Permissions-Policy: camera=(self)` (DL-191). Upstream: `FighterMode`/Training (M08a2), settings and age gate (M04b1), `UiSurface` (M04b2).
- Contracts: C03 1.1 (`PoseActionEvent`, `DeviceKind 'pose'`, rule 8, `InputRouter.setPoseHybrid`), C05 1.1 (`ProfileSettings.privacy`), C12 1.1 (`IdentityState.ageBracket`), C13 1.1 (`dv-platform` store `pose-calibration`, camera headers, `PerfScenario` `fight-stage-pose`, `DeviceChecklist`), C16 1.1 (`pose.calibrate`, `pose.session`).

## Scope in
- **Consent gate** (FP1.5). `poseOffered(settings, identity)` is true only for `privacy.cameraFeatures` and (`ageBracket === '18p'` or `privacy.parentalConsent`); a `null` bracket is not `18p`. When false, pose setup is hidden. Step 0 is a consent card (what is processed, that it stays on the device, how to turn it off); the browser prompt follows the confirm. "Remember calibration" defaults on for `18p`.
- **Calibration machine** (`calibration.ts`): FP4 steps 0–5 with their pass conditions, a timeout and three retries per step, then "use defaults" (best level `assisted`) or "back to controls". Thresholds rescale to 60 % of observed peaks.
- **Capability decision** (`capability.ts`): the FP5 `est95` formula and level table (desktop p95 budget 200 ms, iPhone tiers 240 ms, `assisted` up to budget + 60 ms); runtime step-down 30 → 24 → 15 fps, then `assisted`, then pause; break prompt after 20 minutes.
- **Calibration store** (`calibration-store.ts`): `PoseCalibration` v1 (FP4) in IndexedDB `dv-platform` store `pose-calibration`, key `[saveProfileId, cameraKey]`, added by a version upgrade of the engine's `dv-platform` opener. Never synced or exported; written only with "Remember" on; deleted by "Delete camera data", by turning `cameraFeatures` off and with the save profile; recalibration prompt after 30 days or three failed framing checks.
- **Session control** (`session.ts`): "Camera on" indicator with Stop; tracks stop on pause, blur, hidden, mode exit and setting off, and resume only on a tap; the FP6 presence pause, 2 s freeze detection ("Open in Safari") and failure table; Screen Wake Lock on iPhone with a notice if refused.
- **Hybrid mode:** `FighterSlice.settings.hybridPose` (default false) drives `InputRouter.setPoseHybrid`; the toggle shows only at `full` or `assisted`; off means C03 rule 8 applies.
- **Telemetry:** `pose.calibrate` and `pose.session` with the FP7.7 props only.
- **Tests and runs:** privacy and gate e2e (FP7.3, FP7.5, FP7.6); the `fight-stage-pose` scenario (the `fight-stage` path with a pose session and self-view open); device checklists `M08c2-iphone15` and `M08c2-webcam`.

## Scope out
- Pose in XR: not in v1 (FP1.6). The XR fighter work is M11b2.
- A learned temporal classifier: post-v1 (FP3 v2 option).
- Counsel on stored body proportions (Q-23(b)): before launch, M14b3; the FP4 default applies meanwhile.
- Enforcing CSP: M14b (DL-191); here `connect-src` is asserted in whichever CSP header exists.
- Pose budgets on more device classes and thermal soak: M11a1–a2.

## Deliverables
- `packages/modes/fighter/src/pose/{calibration.ts, capability.ts, calibration-store.ts, gate.ts, session.ts, hybrid.ts}`. Extend `client.ts` and `binder.ts` from M08c1 without changing their exports.
- `packages/modes/fighter/src/ui/pose/{ConsentCard.tsx, CalibrationView.tsx, CameraIndicator.tsx, PoseSetupPanel.tsx}` (Preact, rendered through the mode's `UiBridge` screens).
- `packages/engine/src/platform/storage/dv-platform.ts`: add store `pose-calibration` in an upgrade step, and export `deleteByProfile` and `deleteAll` helpers.
- `packages/ui/src/settings/privacy.tsx` ("Delete camera data"; `cameraFeatures` off deletes records), `content/ui/i18n/en.json` keys `pose.*` (DL-222, DL-247).
- `packages/modes/fighter/fixtures/pose/calibration/{good-desktop.json, good-phone.json, too-far.json, dark.json, two-people.json, freeze.json}`: landmark JSON produced with the M08c1 generator. No image or video files.
- Tests: `packages/modes/fighter/test/pose/{calibration,capability,gate,hybrid,session,store}.spec.ts`; `tests/e2e/fighter/{pose-privacy,pose-gate}.spec.ts` (tags `@fighter @pose`, `@pose-gate`; Chromium `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` via `test.use`).
- `packages/modes/fighter/perf/fight-stage-pose.ts`, registered in the C13 scenario registry.
- `tools/ci/checklists/{M08c2-iphone15.json, M08c2-webcam.json}` (C13 `DeviceChecklist`): a 60 s run reporting p50/p95 `est95`, delegate, camera FPS, level and end reason; frame budget at the device tier; `unavailable` valid.
- `tools/ci/check-dist.ts`: extend the header mode if M08c1 did not already assert `camera=()` on `/account/*` and the `connect-src` allow-list.
- `docs/device-runs/M08c2/{iphone15,webcam}/{perf.json,notes.json}` (operator). No new root script.

## Interfaces
- Consumed, not changed: C03 1.1 (`setPoseHybrid`, `PoseActionEvent`, rule 8), C13 1.1 (`pose-calibration` store, camera headers, `fight-stage-pose`), C16 1.1 (`pose.*`), C05 1.1 (`privacy`, read only).
- No contract shape changes; `PoseCalibration` is module-internal. If `FighterSlice.settings` lacks `hybridPose`, add it as an optional field of the S07 slice with a migration golden.

## Acceptance criteria
- AC-1 Given the fixtures `good-desktop.json` and `good-phone.json` When the calibration machine runs them through steps 1–5 Then each produces a `PoseCalibration` with `v: 1`, ratios in T units, a lead hand, `level` set, and thresholds equal to 60 % of the fixture's observed peaks; `too-far.json` and `dark.json` stop at step 1 with the prompts "move back" and "more light"; three failed retries offer "use defaults", whose level is never `full` — proof: `pnpm check:unit -- packages/modes/fighter/test/pose`
- AC-2 Given synthetic bench inputs When the capability function runs Then desktop `est95` 200 ms gives `full`, 260 ms `assisted` and 261 ms `unavailable`; iPhone tiers 240, 300 and 301 ms give the same three levels; a 10 s p95 inference above 1.5× the calibration value steps the camera rate 30 → 24 → 15, then `assisted`, then pause — proof: `pnpm check:unit -- packages/modes/fighter/test/pose`
- AC-3 Given each combination of `cameraFeatures` (true, false), `ageBracket` (`null`, `'18p'`) and `parentalConsent` (true, false) When `poseOffered` is evaluated Then it is true only for `cameraFeatures` true with `'18p'` or `parentalConsent`; and in a QA build with `cameraFeatures` false the fighter options show no pose setup and `getUserMedia` is never called — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pose-gate`
- AC-4 Given a fake camera stream and a 30 s pose session (consent, framing attempts, self-view) When Playwright records every request Then no request body exceeds 4 KB, none has an image or video MIME type, none uploads a `blob:` or `data:` URL, and every host is the app origin or a `BootConfig.hosts` origin — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pose`
- AC-5 Given that session run with "Remember" off, then again with it on When the test lists every `dv-*` IndexedDB, Cache Storage and OPFS Then nothing holds image or video data except the static `/pose/` files, no value holds a landmark array, the first run leaves `pose-calibration` empty and the second leaves one record with exactly the `PoseCalibration` fields — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pose`
- AC-6 Given live camera tracks When the player presses Stop, the page becomes hidden, the mode exits or `cameraFeatures` is turned off Then every track reads `ended` within 500 ms, the "Camera on" indicator disappears, and only a tap starts the camera again — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pose`
- AC-7 Given two stored calibrations for the current save profile When "Delete camera data" is pressed, or `cameraFeatures` is switched off, or the save profile is deleted Then the profile's `pose-calibration` records are gone and other profiles' records remain — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pose-gate`
- AC-8 Given pose active with hybrid off When a key or pad button is pressed Then the pose binder is disabled until re-enabled (C03 rule 8); with `hybridPose` true the same key moves the fighter while pose strikes still emit `sim.Attack`; the hybrid toggle is hidden at level `unavailable` — proof: `pnpm check:unit -- packages/modes/fighter/test/pose`
- AC-9 Given `two-people.json`, a presence drop below 0.5 for 1 s, and `freeze.json` (no frame for 2 s) When the session runs on a fake clock Then the first pauses to re-confirm framing, the second pauses the round clock ("Move into frame"), the third shows "Open in Safari" then falls back; one tap always returns control — proof: `pnpm check:unit -- packages/modes/fighter/test/pose`
- AC-10 Given a QA build served locally When headers are checked Then app documents carry `Permissions-Policy: camera=(self)`, `/account/` carries `camera=()`, and the CSP `connect-src` lists only `'self'` and the `BootConfig.hosts` origins — proof: `pnpm check:headers -- --serve http://localhost:8788`
- AC-11 Given a calibration and a session When telemetry batches are captured Then only `pose.calibrate` and `pose.session` appear, with registered props only, and the registry check passes — proof: `pnpm check:telemetry`
- AC-12 Given the built bundle When the static gates run Then the `pose.worker` bundle has no network call besides the same-origin `/pose/**` GET, no `face_landmarker` string exists, and no AGPL package is present — proof: `pnpm check:bundle && pnpm license:scan`
- AC-13 Given scenario `fight-stage-pose` When the CPU-side perf run executes on the flat tiers Then the report lists the scenario for each tier and no count or memory value exceeds its tier row in `config/tier-budgets.json` — proof: `pnpm check:perf -- --scenario fight-stage-pose --fail`
- AC-14 Given the preview build installed on an iPhone 15 Home Screen, phone on a stand 1.5–3.5 m away When the operator runs `M08c2-iphone15` (consent, calibration, 60 s Training) Then `perf.json` and `notes.json` are committed with the checklist fields and `perf:verify` passes at `mobile-low` (`unavailable` is valid); the run records U-FGT-1, U-FGT-5, U-FGT-6 — proof: manual: iPhone 15, steps in `tools/ci/checklists/M08c2-iphone15.json`, then `pnpm perf:verify -- docs/device-runs/M08c2/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M08c2-iphone15.json`
- AC-15 Given a webcam desktop in Chrome on the preview URL When the operator runs `M08c2-webcam` Then the same report is committed and `perf:verify` passes at `desktop`; it records U-FGT-1 — proof: manual: desktop webcam, steps in `tools/ci/checklists/M08c2-webcam.json`, then `pnpm perf:verify -- docs/device-runs/M08c2/webcam/perf.json --tier desktop --checklist tools/ci/checklists/M08c2-webcam.json`
- AC-16 Given the branch When the Preview deploys Then it succeeds and Training starts with pose off — proof: `pnpm build && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm check:unit -- packages/modes/fighter/test/pose`): calibration, capability, gate, hybrid, session (fake clock and tracks), store logic.
- **E2E** on `chromium-webgl2`: `@pose` (network, storage, indicator) and `@pose-gate` (gate, deletion). WebKit on Linux has no camera emulation; the iPhone run covers it.
- **Static:** `check:headers`, `check:bundle`, `license:scan`, `check:telemetry`. **Perf:** `fight-stage-pose`. **Device:** both checklists, judged by `perf:verify` in the `device-runs` job.

## Demo script
1. `VITE_DV_QA=1 pnpm dev`, open fighter Training, turn on camera features in Settings → Data & privacy.
2. Start pose setup: consent card, browser prompt, framing, poses, samples, benchmark; read the level and live latency.
3. Jab the dummy, press a key (pose disables), enable hybrid (keys move, jabs land).
4. Switch tabs: the indicator vanishes and the camera stops; tap to resume.
5. Press "Delete camera data": DevTools shows `pose-calibration` empty.

## Effort
1 Builder session; about 32 files; risk **high** (iOS camera lifecycle, step-4 benchmark on phones).

## Risks & fallbacks
- **iPhone latency over budget** (U-FGT-1): the decision yields `assisted` or `unavailable` and touch stays; the device AC records, never asserts, latency.
- **Standalone-PWA camera freeze** (U-FGT-5): the 2 s detector suggests Safari; the operator notes the behaviour.
- **Second WebGL context on `mobile-low`:** default the CPU delegate; skip the GPU benchmark without `OffscreenCanvas` WebGL.
- **`captureTime` missing** (U-FGT-6): use `CAMERA_LAG_ASSUMED` 60 ms.
- **Fake camera shows no person:** e2e asserts privacy and lifecycle only; calibration success is proven on fixtures (AC-1).

## Notes for the Builder
- MediaPipe model files (U-FGT-3, DL-236): the device runs need the real `lite` and `full` `.task` models. Before AC-14/AC-15 the operator obtains them from the vendor's published model card, vendors them with `pnpm assets:pose-vendor -- --from <dir>` (M08c1; size and SHA-256 are pinned in `config/pose-assets.json`) and records the source URL and date in `spec/03`. CI never downloads them.
- Read first: `07-fighter-pose.md` FP1, FP4–FP7, FP9–FP10; `11-platform-pwa.md` §11; `01-engine-contracts.md` C03 rule 8 and 1.1 section; `10-ui-pages.md` §2.
- Hybrid is in scope because `setPoseHybrid` is already in C03 1.1 (FP6's "until accepted" is stale).
- Order: store and gate → capability → calibration on fixtures → session → UI → e2e → perf path → checklists.
- Never persist landmarks; the self-view draws from in-memory messages. Add the store in the existing `dv-platform` upgrade chain; never recreate the database.
- Secrets: none (deploy uses `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` in CI). Owner gates: Q-23(b) before launch only; Q-13 devices. Record device results in `notes.json` and `spec/03` §6 "recorded".

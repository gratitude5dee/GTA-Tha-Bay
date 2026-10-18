# M08c1 — pose-pipeline-classifier

## Goal
After this session the optional pose control for Culture Wars has a working, privacy-checked pipeline up to the input layer, proven on landmark fixtures in CI. A lazy `pose.worker` loads MediaPipe Pose Landmarker (`@mediapipe/tasks-vision` pinned at 1.1.1, F-057) from same-origin `/pose/` assets and keeps 17 of the 33 landmarks. It filters them with One-Euro banks, extracts features, and runs a per-limb gesture FSM. It sends only gesture messages to the main thread. `PoseClient` pumps one camera frame at a time and never queues. `PoseBinder` turns gestures into C03 `pose:<id>` controls. A synthetic fixture generator and a classifier harness prove the accuracy targets. A static check proves that the worker bundle cannot send anything off the device. The camera `Permissions-Policy` header lands here (DL-191); calibration, consent, the capability gate, storage and device runs are M08c2.

## Requirements
- R-MODE-03: optional full-body pose control through MediaPipe Pose Landmarker on device, feeding the Simple scheme, with pad, touch and keys always available.
- R-IP-04: frames and landmarks never leave the worker except as gestures; no face landmarker; no network API in the worker beyond a same-origin GET of `/pose/**`.
- R-PLAT-03: WASM inference in a worker with CPU or GPU delegates.

## Depends on
- **M08a2** (fighter mode, Simple scheme, `FighterInput` mapping, `leniencyX100`, QA bridge `__dvBridge.fighter`).
- Contracts: C03 1.1 (`DeviceKind 'pose'`, `Binder`, `PoseActionEvent`, rule 8 device switching), C07 1.1 (`ProvenanceRecord` for vendored files), C13 1.1 (pose assets served same-origin, runtime-cached).

## Scope in
- Dependency `@mediapipe/tasks-vision@1.1.1` (exact), dynamic-imported only inside the worker; the main bundle never contains it.
- `pnpm assets:pose-vendor` (FP8): copies the package's loader and WASM files (SIMD and non-SIMD) into `apps/web/public/pose/`; places the `lite` and `full` `.task` models from `--from <dir>` or from the `url` in `config/pose-assets.json` when an operator has pinned one (the Google object path is not recorded, so `url` ships empty); refuses any file whose size differs from the pinned byte count; records SHA-256; writes a C07 `ProvenanceRecord` (`origin: 'licensed'`, `Apache-2.0`) per file and a licence snapshot under `docs/legal/licenses/`; when a model is missing it prints `SKIP pose model <name>: not vendored` and exits 0. Vendored binaries are git-ignored; `pnpm build` runs the vendor step for the WASM files.
- Service worker: `/pose/**` is a runtime `CacheFirst` route and is never precached (DL-164).
- `pose.worker.ts`, built as a classic IIFE worker (FP2): `init` → `PoseLandmarker` with model and delegate, `detectForVideo(bitmap, ts)`, `bitmap.close()`, keep landmarks 0, 11–16 and 23–32, discard the rest at once; messages `ready | error | gesture | stats | landmarks` (landmarks only while a preview flag is set); `numPoses: 1`. Inference sits behind a `PoseBackend` interface with a fake backend for tests.
- Pure modules (not sim code): `oneEuro.ts` (feature and onset banks), `features.ts` (FP3 features over a 12-frame window, mirror rule `x' = 1 − x`, lead and rear by stance and world z, never by MediaPipe labels), `fsm.ts` (IDLE → LOADING → COMMIT → RECOVER with 180 ms refractory, early commit carrying `captureTs`; the FP3 gesture table; conflict rules 1–4).
- `PoseClient` (main): `getUserMedia` user-facing 640 × 480 at 30 fps, no audio; `requestVideoFrameCallback` pump with `createImageBitmap` transfer, at most one frame in flight, drop instead of queue; stop on hide, blur, pause and mode exit; reachable only through `__dvBridge.fighter.pose` in QA builds until M08c2 adds the player flow.
- `PoseBinder`: C03 `Binder` with `device: 'pose'`; controls `pose:<gesture>`, `moveL`/`moveR` holds; default map `config/input/defaults.pose.fighter-simple.json`; pose matches set `leniencyX100 = 200` (FP5).
- Synthetic fixtures (FP9): `tools/ci/pose-fixtures/gen.ts` builds 33-landmark image and world arrays from a procedural `bay_rig_v1`-proportioned skeleton with keyframed gestures, σ 0.004 noise, 2 % dropout, 30 fps, labelled onset frames; separate seeds for tuning and for the test set; 10 minutes of idle, walking-by and sitting. Generated at test time from committed seeds; only landmark JSON is ever committed.
- Classifier harness `fighter:pose-fixtures`: confusion matrix, per-gesture recall, idle false positives per minute, recognition delay after onset.
- Camera header (DL-191): `Permissions-Policy: camera=(self)` on app documents and `camera=()` on `/account/*` in `apps/web/public/_headers` (and in `withIsolationHeaders` for Worker-served documents); `check:headers` asserts both.
- Static checks: worker-bundle network allow-list and "no MediaPipe in the main bundle" in `check:bundle`, whose size and precache budgets exclude the runtime-cached `/pose/**` files (they count in the media budget, FP2); no `face_landmarker` in dependencies or `/pose/`; no image or video file under `packages/modes/fighter/fixtures/`.

## Scope out
- Consent card, calibration flow and the `pose-calibration` store, capability decision (`full`/`assisted`/`unavailable`), `connect-src` assertions, network and storage e2e (`@pose`), hybrid mode, device runs, `fight-stage-pose`: M08c2. Enforcing CSP: M14b (DL-191).
- Pose in XR: never in v1 (FP1.6). Learned classifier (v2 option): out of v1.

## Deliverables
- `packages/modes/fighter/src/pose/{types.ts, client.ts, pose.worker.ts, backend.ts, oneEuro.ts, features.ts, fsm.ts, binder.ts, pump.ts}`.
- `packages/modes/fighter/test/pose/{oneEuro.spec.ts, fsm.spec.ts, features.spec.ts, binder.spec.ts, pump.spec.ts, worker-messages.spec.ts, leniency.spec.ts, fixtures-dir.spec.ts, bundle-scan.spec.ts}` with fixture bundles `test/pose/fixtures/bundles/*.js`.
- `tools/ci/pose-fixtures/{gen.ts, harness.ts, seeds.json}`; package script **`fighter:pose-fixtures`** in `packages/modes/fighter/package.json`.
- `tools/assets/pose-vendor.ts` and `tools/assets/test/pose-vendor.spec.ts`; root script **`assets:pose-vendor`**; `config/pose-assets.json`; `docs/legal/licenses/mediapipe-tasks-vision.txt`; provenance records under `assets/provenance/pose/`.
- `tools/ci/bundle/pose-worker-scan.ts` wired into `check:bundle`; `check:headers` path list gains one `/pose/` WASM path and the camera-policy rules; `apps/web/public/_headers` camera lines.
- `apps/web` service-worker runtime route for `/pose/**`; `apps/web/.gitignore` entry for vendored binaries; `config/input/defaults.pose.fighter-simple.json`.
- `docs/decisions/` note recording the worker packaging result.

## Interfaces
- Implements C03 1.1 `Binder` for `DeviceKind 'pose'` and emits `PoseGestureMsg extends PoseActionEvent` (FP2), with no C03 change. Vendored files carry C07 1.1 provenance. No contract change.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0 and the build places the pinned WASM files under `apps/web/dist/pose/` — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given the test-seed fixture set When the harness classifies it Then overall accuracy ≥ 90 %, every gesture's recall ≥ 85 %, idle clips give ≤ 1 false positive per minute, and median recognition delay after the labelled onset is ≤ 2 camera frames — proof: `pnpm --filter @dv/mode-fighter fighter:pose-fixtures`
- AC-3 Given scripted landmark streams When the filters and FSM run Then One-Euro outputs match the reference vectors, each limb fires once per 180 ms refractory and re-arms only when `e` < 0.6, `guard` suppresses strikes, two wrists within 100 ms emit `push`, `push` held ≥ 400 ms with 2 stocks emits Hype, presence < 0.5 for 1 s or camera FPS < 15 emits a pause, and a jittered QCF passes at `leniencyX100` 200 but fails at 100 — proof: `pnpm check:unit -- packages/modes/fighter/test/pose`
- AC-4 Given gesture messages When the binder polls Then `pose:<gesture>` controls produce an `InputFrame` with `deviceKind 'pose'`, a rebound pose control follows the `InputMap`, and any key, pad or touch input switches the active device away from pose — proof: `pnpm --filter @dv/mode-fighter test -- binder`
- AC-5 Given a fake backend taking 50 ms per frame When the pump receives 30 frames per second for 10 s Then at most one frame is in flight, extra frames are dropped, every `ImageBitmap` is closed, and outgoing worker messages carry no pixel buffer, stay under 4 KB, and include landmarks only while the preview flag is set — proof: `pnpm --filter @dv/mode-fighter test -- pump worker-messages`
- AC-6 Given the built app and fixture bundles that call `fetch` to another origin, `XMLHttpRequest`, `WebSocket` and `sendBeacon` When the bundle checks run Then the real worker passes, each fixture fails, the main chunks contain no `@mediapipe` code, no dependency or `/pose/` file contains `face_landmarker`, and the fixtures directory holds no image or video file — proof: `pnpm check:bundle && pnpm check:unit -- packages/modes/fighter`
- AC-7 Given `config/pose-assets.json` When the vendor step runs with no models available, then with a wrong-size model in `--from` Then the first run copies the WASM files with matching byte counts and SHA-256, writes provenance and prints the SKIP line with exit 0, and the second run refuses the model; the IP gates pass — proof: `pnpm assets:pose-vendor && pnpm check:unit -- tools/assets && pnpm provenance:check && pnpm license:scan`
- AC-8 Given a desktop Chrome with a webcam and both models vendored When the operator opens a QA build and runs the pose debug session from the bridge for 60 s Then the session reports `ready`, a delegate and camera FPS, gestures appear in the log, and `notes.json` records U-FGT-2 (classic-worker packaging) and records U-FGT-4 (label convention) — proof: manual: desktop browser with webcam, `pnpm dev`, run `__dvBridge.fighter.pose.debug({model:'lite'})` in the console, perform each gesture three times, save the log to `docs/device-runs/M08c1/webcam/notes.json`
- AC-9 Given the served build When headers are checked and the preview deploys Then `/` carries `Permissions-Policy: camera=(self)`, `/account/` carries `camera=()`, the `/pose/` WASM path carries the isolation headers, and the deploy succeeds — proof: `pnpm check:headers -- --serve http://localhost:8788 && pnpm deploy:preview`

## Test plan
- **Unit:** `pose/oneEuro`, `pose/fsm`, `pose/features`, `pose/binder`, `pose/pump`, `pose/worker-messages`, `pose/leniency`, `pose/fixtures-dir`, `pose/bundle-scan`; `tools/assets/pose-vendor`.
- **Fixtures:** `fighter:pose-fixtures` on every PR touching `pose/**`.
- **Static:** `check:bundle`, `license:scan`, `provenance:check`, `check:headers`.
- **Manual:** desktop webcam spike (AC-8). iPhone runs belong to M08c2 (Q-13).

## Demo script
1. `pnpm --filter @dv/mode-fighter fighter:pose-fixtures`: the confusion matrix prints with recall per gesture.
2. `pnpm assets:pose-vendor -- --from ~/pose-models`, then `pnpm dev`.
3. Open `/?unlockAll=1`, run `__dvBridge.fighter.pose.debug({model:'lite'})`, allow the camera.
4. Jab, cross, guard and crouch: gestures stream in the console and move the fighter in Training.
5. Press a key: control switches back to the keyboard at once.

## Effort
1 Builder session; about 34 files; risk **high**. Worker packaging under Vite 8 and fixture realism are the main risks.

## Risks & fallbacks
- **Classic IIFE worker cannot load `FilesetResolver` under Vite 8** (U-FGT-2): try a module worker; if neither loads, pose stays `unavailable` at runtime, the classifier and checks still ship, and the result goes to the Architect.
- **Model download path unknown** (U-FGT-3): models come only from `--from` or an operator-pinned `url`; CI never downloads them.
- **Mirrored left/right labels** (U-FGT-4): the classifier uses stance and mirrored x only, so either convention works.
- **Synthetic fixtures too easy:** keep the test seeds out of tuning, add the walking-by and sitting idle sets, and add recorded landmark JSON from team members when available.

## Notes for the Builder
- Read first: `07-fighter-pose.md` FP1–FP3, FP5, FP7–FP9; ADR-0024; ADR-0017 (worker topology); `01-engine-contracts.md` C03 binders; DL-191. Facts: F-057, F-058 (spec/03 §6).
- Order: types → backend seam and fake → One-Euro, features, FSM → generator and harness (tune to the targets) → worker → pump and client → binder → vendor script → bundle checks → spike.
- Pose code is not sim code: `Math` is allowed, but nothing in `pose/**` may import from `src/sim/**` or write to storage.
- Secrets: none besides the CI deploy pair. Owner gate Q-23(b) (biometric reading) applies to calibration storage in M08c2, not here.

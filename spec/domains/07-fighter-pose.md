# 07 — Fighter (S07), part D: pose-control mode

> S07, Wave 3, 2026-10-18. Part of `spec/domains/07-fighter.md`. Core rules: `07-fighter-core.md` (`FC#`); content: `07-fighter-content.md` (`FX#`). Covers R-MODE-03 (optional full-body pose control) and R-IP-04 (camera and pose data stay on device). Honors 06 v1.1 C03 (`PoseActionEvent`, `DeviceKind 'pose'`, rule 8), C05 (`privacy`), C13, C16, `spec/03` D-24 and D-30, `prompt-pack/01` constraint 22. Section ids `FP1…FP11`. Numbers marked † are starting values tuned on recorded fixtures and devices (M08c); they are budgets and thresholds, not facts about an external system.

## FP1 Rules (binding)

1. **On device only.** Camera frames never leave the device: not to our servers, not to peers, not to a third party, not to disk, not to IndexedDB, not to a `Blob` URL that outlives the session. Landmarks are not persisted or transmitted either; only derived action events cross the input layer [research/legal-ip-likeness.md §8 P1; R-IP-04].
2. **MediaPipe only.** `@mediapipe/tasks-vision`, exact stable version pinned at M08c start (1.1.1 was current on 2026-10-18), Pose Landmarker only; no Face Landmarker, no face mesh, no YOLO (AGPL-3.0 or Enterprise) [F-057, F-058; research/auth-ugc-input-maps.md §4.1, §4.6]. Inference sits behind a `PoseBackend` interface so a later permissively licensed model could be added by ADR.
3. **Always a fallback.** Pose is optional and never the only way to play. Touch, pad and keyboard work at all times; any failure returns control within one tap (FP6).
4. **Always a calibration step** before first use on a device or camera (FP4), with a visible camera-active indicator and a stop control.
5. **Gated.** Pose mode is offered only when `ProfileSettings.privacy.cameraFeatures === true` and (`IdentityState.ageBracket === '18p'` or `ProfileSettings.privacy.parentalConsent === true`). Under-13 is blocked from the product (D-30). A missing age bracket counts as not `18p`.
6. **Not in XR.** Webcam pose is desktop and phone only in v1; WebXR camera access on Quest is unconfirmed (Q-GD-08). XR uses controller and hand gestures (FX10).
7. **Separate ruleset, never ranked.** Pose matches use widened timing and slower CPU reactions (FP5). Pose never enters ranked play or online play (FC12).

## FP2 Architecture

```mermaid
sequenceDiagram
  participant M as main thread (PoseClient)
  participant W as PoseWorker (classic worker)
  participant I as InputRouter (C03 pose Binder)
  participant S as sim.worker (fighter mode)
  M->>M: getUserMedia (user-facing, 640x480 @30, no audio) → hidden/preview <video>
  loop requestVideoFrameCallback
    M->>W: createImageBitmap(video) transferred + captureTs + seq
    W->>W: PoseLandmarker.detectForVideo(bitmap, monotonicTs); bitmap.close()
    W->>W: keep 17 landmarks, drop the rest; One-Euro banks; features; gesture FSM
    W-->>M: PoseGestureMsg {gesture, phase, captureTs, confidence} (+ landmarks only while a preview overlay is open)
  end
  M->>I: pose Binder.poll → RawInputState.controls['pose:jab' …]
  I->>S: InputFrame (SimButton bits, moveX, deviceKind 'pose') each tick
  S->>S: fighter mode: FighterInput, leniency x2 (FC5.3, FP5)
```

| Module | Path | Thread | Role |
|---|---|---|---|
| `PoseClient` | `packages/modes/fighter/src/pose/client.ts` | main | camera lifecycle, frame pump, worker RPC, session state, indicators, stop-on-hide |
| `pose.worker` | `.../pose/pose.worker.ts` (build as a classic IIFE worker) | worker | MediaPipe load, inference, filters, features, FSM |
| `OneEuro`, `features`, `GestureFsm` | `.../pose/{oneEuro,features,fsm}.ts` | worker | pure TypeScript, unit-tested against fixtures (not sim code, `Math` is allowed) |
| `PoseBinder` | `.../pose/binder.ts` | main | implements C03 `Binder` with `device: 'pose'`; turns gesture messages into `pose:<id>` control values |
| `Calibration` | `.../pose/calibration.ts` | main + worker | state machine of FP4 |
| `PoseCapability` | `.../pose/capability.ts` | main | benchmark and the `full`/`assisted`/`unavailable` decision (FP5) |
| fixtures, harness | `packages/modes/fighter/fixtures/pose/`, `tools/ci/pose-fixtures/` | Node | landmark-only fixtures, synthetic generator, classifier harness |

```ts
// packages/modes/fighter/src/pose/types.ts — extends the frozen C03 shape; no C03 change needed
import type { PoseActionEvent } from '@dv/shared/contracts/c03-input';
export type PoseModel = 'lite' | 'full';
export type PoseDelegate = 'cpu' | 'gpu';
export type PoseControlId = PoseGestureId | 'moveL' | 'moveR';        // continuous leans are screen-space holds
export interface PoseGestureMsg extends PoseActionEvent {              // action = default-resolved ActionId (for tests and logs)
  gesture: PoseControlId;                                              // the binder maps `pose:<gesture>` through InputMap, so rebinding works (C03 rule 9)
  phase: 'press' | 'hold' | 'release';                                 // confidence 0 also means release
  fps: number;                                                         // camera frames per second over the last second
}
export interface PoseWorkerIn  { t: 'init'; model: PoseModel; delegate: PoseDelegate; baseUrl: string }
export interface PoseWorkerOut { t: 'ready' | 'error' | 'gesture' | 'stats' | 'landmarks'; /* payloads as named; no pixels */ }
export interface PoseThresholds { jabV: number; crossV: number; kickLift: number; guardDist: number; crouchDrop: number; jumpRise: number; pushWindowMs: number }
export type PoseCapabilityLevel = 'full' | 'assisted' | 'unavailable';
```

**Frame pump.** `requestVideoFrameCallback` drives capture (Safari iOS 15.4 and later [research/auth-ugc-input-maps.md §4.1]); the baseline transfer is `createImageBitmap(video)` to the worker, and the bitmap is closed after inference. Where `MediaStreamTrackProcessor` exists in a worker (Safari 18 worker-only) a `VideoFrame` path is an optimisation, not the baseline. At most one frame is in flight; if the worker is busy the pump drops the new frame (never queues), so latency cannot grow. The video element is `playsinline muted`, not part of the 3D scene, and shown only in a corner preview during calibration and an optional picture-in-picture-sized self-view during play.

**Self-hosted assets.** WASM, loader and `.task` files are served from the app origin under `/pose/` (static assets, ≤ 25 MiB each [spec/03 D-17]), never from Google at runtime, which keeps COEP simple, works offline and avoids any request to a third party. `pose_landmarker_lite.task` 5,777,746 B and `full` 9,398,198 B; WASM `vision_wasm_internal.wasm` 13,519,922 B (3,954,071 B gzip), SIMD and non-SIMD builds, no threaded build, so pose needs no cross-origin isolation [research/auth-ugc-input-maps.md §4.1]. They are fetched only after the player enables pose mode, cached by a service-worker runtime route (not precache), and counted in the media budget.

## FP3 Gesture classifier

**Landmarks kept** (indices of the 33): nose 0, shoulders 11–12, elbows 13–14, wrists 15–16, hips 23–24, knees 25–26, ankles 27–28, heels 29–30, foot index 31–32. All others (eyes, ears, mouth, hand points) are discarded in the worker immediately.

**Normalisation per frame.** Origin = mid-hip. Scale `T` = |mid-shoulder − mid-hip| (torso length). Depth-sensitive features use `worldLandmarks`; planar ones use image landmarks with `x' = 1 − x` (mirror), so screen-right in the mirrored preview is the player's right. Movement is expressed in screen space: leaning toward screen-right emits `moveR`, whatever the fighter's facing; the fighter core applies facing (FC5). The research's relative-to-opponent mapping is replaced by this mirror rule because the player watches a mirrored self-view; the effect is the same and it needs no facing feedback to the worker. Stance: calibration decides **lead** and **rear** wrist by which is nearer the camera in the guard pose (world z) and which foot is forward, never by MediaPipe's left/right labels (convention under a mirrored stream is `UNVERIFIED`).

**Filtering.** Two One-Euro bank sets per coordinate [Casiez et al., CHI '12; research/auth-ugc-input-maps.md §4.3]: a *feature* bank (min cutoff 1.0 Hz†, low β) and an *onset* bank (higher β†, lower lag). Tuning follows the published procedure: β = 0, raise min cutoff until rest jitter is acceptable, then raise β by factors of ten for fast-motion lag.

**Features** over a 12-frame window at camera rate: wrist extension ratio `e = |wrist − shoulder| / calibrated arm length`; elbow angle; wrist velocity `v` (T per second); wrist vertical velocity; shoulder-line yaw rate; ankle height above standing baseline (T); knee extension; hip height delta (T); both-wrists-to-nose distance (T); torso lean `(mid-shoulder − mid-hip)·x'` (T).

**Per-limb FSM.** `IDLE → LOADING (v rising) → COMMIT (emit) → RECOVER (refractory 180 ms, until e < 0.6) → IDLE`. COMMIT fires at the threshold crossing (early commit) and carries the frame's `captureTs`.

| Gesture | Maps to (Simple) | Commit rule (initial †; calibration rescales to 60 % of observed peaks) |
|---|---|---|
| `jab` | L (`sim.Attack`) | lead wrist: `e ≥ 0.80`, `v ≥ 2.5 T/s`, elbow ≥ 140° |
| `cross` | H (`sim.FightHeavy`) | rear wrist: same plus shoulder yaw rate ≥ 90°/s |
| `hook` | L (alternate) | wrist horizontal speed ≥ 2.5 T/s with elbow 70–110° |
| `uppercut` | H (alternate) | wrist upward speed ≥ 2.5 T/s starting below the shoulder |
| `frontKick` | H | ankle ≥ 0.45 T above baseline and knee extension ≥ 150° |
| `lowKick` | L | ankle lateral speed ≥ 2.0 T/s below knee height |
| `guard` | BL (hold) | both wrists ≤ 0.35 T from nose for ≥ 100 ms; release > 0.5 T |
| `crouch` | Down (hold) | hip drop ≥ 18 % T below the standing baseline |
| `jump` | Up (pulse) | hip rise ≥ 12 % T and both ankles rising |
| `push` | SP (tap); HY when held ≥ 400 ms with ≥ 2 stocks | both wrists commit within 100 ms; the direction held at commit (lean, crouch) picks the special (FC5.4) |
| `moveL`, `moveR` | `axis.MoveX` ∓/± (hold) | lean ≥ 0.15 T, hysteresis ±0.05 T |

These are the 10 research gestures plus two continuous leans; kicks and punches share Light and Heavy because the Simple scheme has no kick buttons (the animation does not change). Per-kit `MoveDef.gesture` is informational for the move list.

**Conflict rules.** (1) `guard` suppresses strikes. (2) If one wrist commits while the other wrist's `v` is rising, the single-hand action is held up to 50 ms for a `push` coincidence, then emitted. (3) One action per limb per refractory window. (4) Presence < 0.5 for 1 s, or camera FPS < 15, pauses with a "move into frame" prompt (FP6).

**v2 option (out of v1):** a small learned temporal classifier (≤ 50 k parameters) ships only if it beats the rule FSM by ≥ 5 points on the fixture set at equal latency.

## FP4 Calibration

Flow (target ≈ 15 s of poses; ≈ 40 s with framing, benchmark and test round). Each step has a timeout and three retries; failure offers "use defaults" (lower accuracy, `assisted` at best) or "back to pad/touch".

| Step | Content | Pass condition |
|---|---|---|
| 0 Consent card | what is processed, that it stays on the device, how to turn it off (revocation lives in Settings → Data & privacy, S10); optional "Remember calibration on this device" (default on for `18p`, off otherwise) | player confirms; then the browser permission prompt |
| 1 Framing | head, both wrists and both ankles visible with presence ≥ 0.7 for 1 s; estimated distance 1.5–3.5 m (the model card's limit is about 4 m); body height 45–95 % of frame; mean luma ≥ 60/255†, else "more light" | all true |
| 2 T-pose 3 s, neutral 3 s, guard 2 s | arm length and shoulder width as ratios of `T`, standing hip and ankle baseline, lead hand | stable (σ < 3 % T†) |
| 3 Samples | 3 jabs, 3 crosses, 1 kick, 1 jump, 1 crouch | each peak above 1.5× rest noise |
| 4 Delegate benchmark | 60 frames on CPU and 60 on GPU (when `OffscreenCanvas` WebGL is available); keep the lower p95 `inferMs`; default model: lite on phones and when both exceed budget, full on desktop when under budget | both complete |
| 5 Test round | passive dummy, live latency readout, `PoseCapability` decision (FP5) | player continues |

```ts
export interface PoseCalibration {          // dimensionless; no raw measurements in metres, no images
  v: 1; createdAt: number /* epoch ms */; cameraKey: string;   // first 12 hex of SHA-256(deviceId)
  model: PoseModel; delegate: PoseDelegate;
  ratios: { arm: number; shoulder: number; leg: number };      // each divided by T
  baseline: { hipY: number; ankleY: number };                  // in T units
  lead: 'left' | 'right'; thresholds: PoseThresholds;
  bench: { cpuP95Ms: number; gpuP95Ms: number | null; cameraFps: number };
  level: PoseCapabilityLevel;
}
```

**Storage (decision S07-D3).** Not in the C05 `mode:fighter` slice: cloud sync (M12a) would carry body-proportion data off the device, against R-IP-04 and because the calibration is camera- and room-specific. It lives in a device-scoped IndexedDB object store `pose-calibration` in `dv-platform` (S11 adds the store at M08c; proposal), keyed `[saveProfileId, cameraKey]`, never synced, never exported in `.dvsave`. Written only when "Remember calibration" is on. Deleted by "Delete camera data" (Settings → Data & privacy), when `cameraFeatures` is turned off and when the save profile is deleted. Recalibration is prompted after 30 days or after three failed framing checks. Whether stored normalised body proportions count as biometric data is a counsel question (Q-S07-2); the default stores no more than the thresholds above.

## FP5 Pose ruleset and latency budget

**Ruleset deltas** (`FightRules.leniencyX100 = 200`, FC5.3): motion window, button leeway, both buffers and dash-tap window ×2; CPU reaction ×1.5 and execution error −5 points; Simple scheme only (the 0.8 specials multiplier applies); no ranked, no online, no cross-input matchmaking. `autoBlock` is available as in story bouts.

**Budget** [proposal in research/auth-ugc-input-maps.md §4.5 adopted; replaces the 120 ms single figure in research/gamedesign-decomposition.md §4.6]. Onset-to-photon is measured from the first frame of motion to the first rendered frame showing the reaction.

| Stage | Desktop | iPhone (`mobile`, `mobile-low`) | How measured |
|---|---|---|---|
| Camera exposure → `requestVideoFrameCallback` | ≤ 50 ms | ≤ 60 ms | `captureTime` / `expectedDisplayTime` against `performance.now()` where exposed; else the constant `CAMERA_LAG_ASSUMED` 60 ms† |
| Transfer + inference | ≤ 15 ms | ≤ 30 ms | worker `inferMs` |
| Filter + features + FSM | ≤ 1 ms | ≤ 2 ms | `performance.now()` in the worker |
| Recognition delay after onset | ≤ 2 camera frames at 30 fps (67 ms) | same | fixture clips with labelled onset frames |
| Sim pickup (60 Hz) + render | ≤ 33 ms | ≤ 33 ms (≤ 50 ms at 30 fps render) | frame timestamps |
| **Total p50 / p95** | **≤ 150 / 200 ms** | **≤ 180 / 240 ms** | sum, plus a 240 fps phone-camera spot check (manual) |

**Per device class** (C13 tiers): desktop (`desktop-ultra`, `desktop`) model full by default, GPU delegate if its p95 is lower; iPhone and iPad (`mobile`, `mobile-low`) model lite, delegate decided by the benchmark (default CPU on `mobile-low` so a second WebGL context does not compete with the renderer); `android` best effort with the iPhone budget; Quest and Vision Pro: not offered. No first-party benchmark exists for PoseLandmarker in iPhone Safari, so **latency on iPhone is UNVERIFIED and the M08c device run is the gate** [research/auth-ugc-input-maps.md §4.1; F-ledger "PoseLandmarker latency on iPhone — M08c gate"].

**Capability decision** (step 5): `est95 = captureLag + inferP95 + 2 + 67 + simRender`. `est95 ≤ budget.p95` → `full`; `≤ budget.p95 + 60 ms` → `assisted` (leniency ×3, hybrid mode recommended); otherwise `unavailable`, the mode shows why and keeps pad/touch. Pose FPS adapts: camera 30 → 24 → 15; sustained < 15 pauses (FP6). Thermal and battery effects on iPhone are unmeasured: a soft prompt after 20 minutes suggests a break, and p95 inference rising above 1.5× its calibration value for 10 s steps the camera rate down.

## FP6 Fallbacks, hybrid mode, failures

- **Instant return.** Any touch, key or pad input switches the active device away from pose (C03 rule 8). **Hybrid mode** (stick/keys for movement, pose for strikes and guard) relaxes that rule through `InputRouter.setPoseHybrid(boolean)` (already in C03 1.1, DL-128); M08c2 ships it behind `FighterSlice.settings.hybridPose` (default false; DL-236).
- **Presence.** Presence < 0.5 for 1 s, or camera FPS < 15 → sim pauses (`paused` via the existing pause path), overlay "Move into frame"; one tap returns to touch/pad. Pause is immediate; the round clock does not run.

| Failure | Detection | Response |
|---|---|---|
| Permission denied or no camera | `getUserMedia` rejects `NotAllowedError`/`NotFoundError` | explainer plus "use controls"; setting stays off |
| Camera busy | `NotReadableError` | same message with "close other apps" |
| Track ended / `devicechange` | `track.onended` | pause, offer re-pick or fallback |
| Standalone-PWA camera freeze (reported regressions in iOS home-screen apps, `UNVERIFIED` for iOS 26/27) | no new `requestVideoFrameCallback` for 2 s | "Open in Safari" suggestion, then fallback |
| Worker or WASM load failure (offline first run) | `error` message | mode unavailable offline until assets are cached |
| Low light | luma < 40 for 3 s | prompt; presence drop handled above |
| Several people | `numPoses: 1` selects one subject | on a subject jump (hip position change > 0.5 T in one frame) pause and re-confirm framing |
| Tab hidden / app backgrounded | `visibilitychange` | stop all tracks; resume requires a tap |
| CPU/thermal overrun | p95 trigger above | step down camera rate, then `assisted`, then pause |

## FP7 Privacy enforcement (R-IP-04)

1. **Headers.** `Permissions-Policy: camera=(self)` on app documents (default `camera=()` elsewhere); CSP `connect-src` allow-lists only `'self'` (which serves `/api/v1` and `/pose/`) and the `BootConfig.hosts` origins (`media.`, `ugc.`, `rt.`, `id.`); no third-party origin is ever listed, so nothing can carry a frame off-device (C13 1.1, DL-093; `check:headers` asserts both).
2. **Messages.** Worker messages carry landmarks and gestures, never pixels; preview landmarks flow only while a calibration or self-view overlay is open.
3. **Network assertion (e2e, `@fighter @pose`).** Playwright intercepts every request during a pose session and asserts: no body larger than 4 KB, no image/video MIME, no `blob:` or `data:` upload, and no request to any host outside the allow-list.
4. **Static check.** `check:bundle` fails if the `pose.worker` bundle references `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` other than a same-origin GET of `/pose/**` (an allow-listed loader call site).
5. **Storage assertion.** A test lists IndexedDB, Cache Storage and OPFS after a session and finds no image data and no landmarks.
6. **Indicator.** A DOM status element "Camera on" with a Stop button is visible whenever tracks are live; tracks stop on pause, blur, hide, mode exit and when the setting is turned off.
7. **Telemetry.** Aggregates only: existing `pose.calibrate {ok, ms, delegate}` and `pose.session {durationS, camFpsP50, latencyEstP95Ms, level, endReason}` (C16 1.1, DL-103). No landmarks, no timings per frame.
8. **No face landmarks.** CI greps the dependency tree and `/pose/` for `face_landmarker` and the Face Landmarker task name; `license:scan` fails on AGPL packages or weights.
9. **Fixtures.** Only landmark JSON and synthetic data are committed; a `check:unit` test (`fighter/pose.privacy-fixtures`, DL-236) fails if any image or video file exists under `packages/modes/fighter/fixtures/`. Local `.webm` clips for the pipeline test mode are git-ignored.

## FP8 Packaging, provenance, licence

`pnpm assets:pose-vendor` (M08c) copies the pinned package files and downloads the two `.task` models at build time (the exact object path is `UNVERIFIED`; the script records size and SHA-256 and fails if sizes differ from the byte counts in FP2), writes a C07 `ProvenanceRecord` for each (`origin: 'licensed'`, SPDX `Apache-2.0`; the model card states Apache-2.0 [research/auth-ugc-input-maps.md §4.1]) and a licence snapshot under `docs/legal/licenses/`. The package is dynamic-imported only inside the worker; the main bundle does not contain it. Budgets: first enable downloads about 4 MB (WASM gzip) plus 5.8 MB (lite) or 9.4 MB (full); desktop with `full` is the only profile above the iPhone figure.

## FP9 Tests

| ID | Test | Command |
|---|---|---|
| T-P1 | One-Euro filter vectors; FSM transitions and refractory on scripted landmark streams | `pnpm check:unit -- packages/modes/fighter/src/pose` |
| T-P2 | Fixture classification: ≥ 90 % overall across the 10 gestures, every gesture recall ≥ 85 %, ≤ 1 false positive per minute on 10 minutes of idle, walking-by and sitting fixtures | `pnpm --filter @dv/mode-fighter fighter:pose-fixtures` (in `check:fighter`) |
| T-P3 | Leniency: a pose-mode replay with ×2 windows executes a QCF with jittered timings that the Classic windows reject | `check:unit` |
| T-P4 | Network, storage and header assertions (FP7.1–7.5) | `pnpm check:e2e -- --project=chromium-webgl2 --grep @pose` |
| T-P5 | Static bundle check and licence scan | `pnpm check:bundle`, `pnpm license:scan` |
| T-P6 | Capability decision table on synthetic bench inputs (`full`/`assisted`/`unavailable`) | `check:unit` |
| T-P7 | Device latency run (iPhone 15 or newest available, desktop webcam): 60 s session, report p50/p95 `est95` and measured spot check, delegate chosen, camera FPS, thermal note | `pnpm perf:checklist -- tools/ci/checklists/M08c2-iphone15.json` and `M08c2-webcam.json` (manual) |

The synthetic fixture generator `tools/ci/pose-fixtures/gen.ts` poses the `bay_rig_v1` mannequin from the shared base clips, projects joints through a virtual camera into 33-landmark arrays with image and world coordinates, and adds noise (σ 0.004 normalised†, 2 % dropout†) at 30 fps. Recorded fixtures are landmark JSON from team members under a release (no video kept).

## FP10 Platform notes

| | Desktop | iPhone / iPad PWA | Quest 3 | Vision Pro |
|---|---|---|---|---|
| Pose camera mode | yes, full model default | yes, lite model, phone on a stand 1.5–3.5 m, landscape | no | no |
| Camera API | `getUserMedia` | `getUserMedia` in Safari and Home Screen apps (reported regressions, fallback in FP6) | n/a | n/a |
| Wake lock | not needed | Screen Wake Lock requested during a pose session (supported in Home Screen apps since iOS 18.4 [research/gap-cutscene-delivery-playback.md §3.3]); notice if refused | n/a | n/a |
| Alternative | pad, keys | touch Simple scheme | controller and hand gestures (FX10) | hands only |

## FP11 Open items

Q-S07-1: whether `@mediapipe/tasks-vision` 1.1.1 runs in a classic IIFE worker under Vite 8 with `FilesetResolver` (module-worker use is `UNVERIFIED`; M08c spike step 1; default is the classic worker). Q-S07-2: counsel reading of locally stored normalised body-proportion thresholds under biometric-privacy statutes. Q-S07-3: iOS standalone-PWA camera behaviour on the Q-13 devices. Q-S07-4: `captureTime` accuracy on iOS Safari (default: the assumed constant). Decisions: hybrid mode depends on the C03 relaxation (FP6).

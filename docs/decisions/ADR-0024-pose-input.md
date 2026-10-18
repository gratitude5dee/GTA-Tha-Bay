# ADR-0024 — Pose input

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-24 (v1.1, DL-164); R-MODE-03, R-IP-04

## Context
R-MODE-03 asks for optional full-body control of the fighter from a camera, with a fallback to pad, touch and keys. The camera image is sensitive: R-IP-04 requires that no frames are uploaded or persisted and that no face landmarker is used. Candidate runtimes carry licence or platform constraints.

## Options considered
1. **YOLO pose models.** Ultralytics YOLO is AGPL-3.0 or an Enterprise licence; SaaS use needs Enterprise [F-058].
2. **ONNX Runtime Web with a third-party model.** Larger download and a second runtime; kept only as a future backend behind `PoseBackend`.
3. **MediaPipe tasks-vision 1.1.1** (Apache-2.0; CPU or GPU through WebGL2; no threaded build) [F-057] (chosen).
4. **Server-side inference.** Violates R-IP-04.

## Decision
- **Runtime.** `@mediapipe/tasks-vision` (1.1.1 current on 2026-10-18; the exact stable version is pinned at M08c start), Pose Landmarker only: no Face Landmarker, no face mesh. Model: `lite` on mobile, `full` on desktop when within budget and `lite` otherwise (DL-164). Inference runs in `pose.worker` (ADR-0017); the main thread pumps one camera frame at a time (`requestVideoFrameCallback` → `createImageBitmap`, transferred).
- **Output is gestures, not pixels.** The worker returns gestures only, which a C03 pose binder turns into `InputFrame` bits; a hybrid mode combines pad and pose (C03 1.1 `setPoseHybrid`, DL-128).
- **Privacy.** Frames are never stored or uploaded; models and wasm are served same-origin under `/pose/` and runtime-cached (`CacheFirst`, never precached, DL-164). A static check fails the build if the worker bundle uses any network API other than the allow-listed same-origin `GET /pose/**`. The camera permission is requested only after a consent screen; `Permissions-Policy: camera=(self)`; `connect-src 'self'` plus `BootConfig.hosts` (DL-093). Calibration (normalised body proportions) stays device-local in `dv-platform`, opt-in "remember", deletable, never synced; counsel reviews whether it is biometric data (Q-23b).
- **Capability gate.** A latency test round decides one of three levels, `full`, `assisted` (leniency ×3, hybrid recommended) or `unavailable`; `unavailable` is a valid outcome and the mode keeps pad and touch. PoseLandmarker latency on iPhone is UNVERIFIED (research/INDEX.md): the M08c2 device run records p50/p95, delegate and capability level, and the mode never depends on it.
- **Fighter rules.** Pose is disabled online (leniency forced to 100 %) and never enters a ranked queue (07-fighter-core FC12).
- **Fixtures.** The classifier meets ≥ 90 % overall and ≥ 85 % per-gesture recall with ≤ 1 false positive per minute on idle clips, measured on synthetic fixtures (M08c1).

## Consequences
- (+) A permissive licence, on-device only, no server cost, and the fighter plays fully without a camera.
- (+) `PoseBackend` keeps ORT as a later swap with no mode changes.
- (−) The tasks-vision build is single-thread; iPhone latency may rule pose out on weak devices, which the capability gate handles.
- (−) A classic IIFE worker under Vite 8 is UNVERIFIED (Q-S07-1); the M08c spike checks it.
- (−) iOS standalone-PWA camera behaviour is UNVERIFIED (Q-S07-3).

## Affected contracts and milestones
C03 (pose binder, `setPoseHybrid`, alias table), C13 (store, headers), C16 (`pose.session`). M08a2 (fighter mode without pose), M08c1 (pipeline, classifier), M08c2 (calibration, gate, device runs), M11b2 (XR rules).

## Links
`spec/domains/07-fighter-pose.md`; `research/auth-ugc-input-maps.md` §4; `spec/11-decision-log.md` DL-093, DL-127, DL-128, DL-164; ADR-0014, ADR-0017.

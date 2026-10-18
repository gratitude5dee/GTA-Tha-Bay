# M11b1 — webxr-port

## Goal
After this session the game is a WebXR port, not an XR smoke test. A gesture-bound `XrSessionController` enters `immersive-vr` on Quest 3/3S (WebGL2 backend, multiview, 72 → 90 Hz) and on Vision Pro (native WebGPU, with the WebGL2 renderer swap as fallback), behind a warm-up veil; interruption and exit restore the flat loop. The player walks the city with teleport and snap turn by default, opt-in smooth locomotion with a vignette, and hands-only presentation with forearm IK. Controllers, hands and Vision Pro transient pointers reach C03 by `XRInputSource` identity through three XR binders, and poses reach `sim.worker` through the seqlocked `XrPoseBlock`. `XrPanels` gives S10 a panel base. The `xr-walk` scenario checks per-pass budgets, and Quest and Vision Pro runs are recorded. In-headset UI is M11b3; per-mode XR and XR cutscene hosts are M11b2 and M11b4.

## Requirements
- R-PLAT-02: the full XR port core: immersive session, controller and hand input, comfort options, on Quest 3/3S and Vision Pro.
- R-ENG-04: XR comfort baseline: teleport and snap 30° by default, vignette only while moving, quantized velocity, seated mode, dominant hand, no head-locked UI and no camera shake.

## Depends on
- **M01c** (`RendererHost` with `installXrFallback` stub, `classifyDevice` with Quest and Vision Pro rules, XR tiers' `XrTierConfig`, `perf:verify`, `perf:checklist`). **M04b2** (`UiSurface` skeleton with an IWER test panel, wrist and phone registry). **M11a1** (governor `xr: true` rule and the next-entry framebuffer scale request; DL-219).
- Also used: M00 (`xr-quest3` project, IWER 2.6.0, `enterForTest`), M01b2 (XR smoke button, `xr` camera mode, `FrameSignal` per XR frame), M04a1 (C05 `ProfileSettings.xr` and the `XrComfortSettings` type file).
- Contracts: C13 1.1.0 (`XrTierConfig`, `XrComfortSettings`, `XrPanels` with registration, `RendererHost.installXrFallback`), C03 1.1.0 (`DeviceKind` `xr-controller` / `xr-hand` / `xr-transient`, control ids), C04 1.1.0 (`XRRigParams`, `CameraMode 'xr'`), C02 1.1.0 (`FrameSignal`, `SimServices.xrPoses`), C16 1.1.0 (`xr.session`).

## Scope in
- **`XrSessionController`** (`11-platform-xr.md` §3, §5.1–§5.2):
  - States: `unsupported`, `available`, `requesting`, `swapping`, `warming`, `presenting`, `interrupted`, `ending`. "XR armed" is reached only after `FirstGestureUnlock` has run and the XR seed is prepared.
  - `enter()` calls `navigator.xr.requestSession('immersive-vr', {optionalFeatures})` synchronously inside user activation, with features per headset (Quest omits `webgpu`). Outside activation it rejects with `XrGestureRequired` and never touches `navigator.xr`; the IWER `enterForTest()` path is QA-only.
  - Then `renderer.xr.setSession`, the veil, `setTier(xr tier, 'xr-session')`, `compileAsync` of the XR seed, 30 frames and a 300 ms fade.
  - Quest: `updateTargetFrameRate(72)`, then a request for 90 when p90 < 9 ms and `supportedFrameRates` includes 90 (`setRefreshHz`).
  - On session `hidden` or `visible-blurred`: `interrupted`, sim paused, audio ducked. On exit: the rAF loop is restored and the flat tier returns at the next safe point; the replaced renderer is kept.
  - Emits `xr.session{evt, fps}`.
- **Renderer swap.** `RendererHost.installXrFallback()` (a stub since M01c) installs three's `setupWebGLXRFallback` [S11-F3]. On fallback it calls `onRendererReplaced(next, prev)` on every registered `GpuResourceOwner` and swaps the canvas. It runs at most once per page.
- **`XrRig` and hands.** Dolly root plus XR camera, capsule sync, head-in-geometry fade with audio ducking, seated offset, `origin: 'feet'` (C04); hands-only with two-bone forearm IK (Q-ENG-05); shake, bob and FOV directives dropped in `xr` mode.
- **Input** (§5.4):
  - `XrInputRouter` keeps `Map<XRInputSource, XrSourceState>`, rebuilt on `inputsourceschange`, and never indexes `inputSources`. `sample(frame, block)` runs first in each XR frame.
  - `HandFeatures` computes pinch strength with hysteresis, grab, palm-up, wrist velocity and the two-hand wheel value that `xr:both:wheel` reads. Thresholds come from `config/xr-gestures.json` (S11 starting values).
  - The three C03 binders `xr-controller`, `xr-hand` and `xr-transient` are thin `Binder`s over the router cache. The last-used device is active; controllers win while held.
  - `config/xr-input-profiles.json` maps `xr-standard` indices 0–3 and sets every face button to `null` until a device pass records it (U-ENG-5); unknown face buttons use trigger and squeeze chords.
  - `HapticsPort` uses `gamepad.hapticActuators` and is a no-op elsewhere.
- **`XrPoseBlock`** (§4.3): SAB with a seqlock (main thread writes; readers retry on an odd or changed counter); `postMessage` once per frame without isolation; read by `SimServices.xrPoses`.
- **Locomotion and comfort** (§5.3):
  - Teleport arc from the dominant hand (or a pinch ray), valid within S01 `maxSlopeDeg` where a capsule fits, range 10 m, blink ≤ 200 ms, with chunk `teleportNodes` when present.
  - Snap turn by `snapAngleDeg`; smooth locomotion is opt-in at `smoothSpeedMps` (cap 6), quantized to stop, walk or run.
  - Vignette `clamp(0.6·|v|/vmax + 0.4·|ω|/ωmax, 0, 1) × comfortAssist × tierScale`, fade in 150 ms and out 300 ms, only while moving; `reduceMotion` forces at least `low`.
  - Settings are read from `ProfileSettings.xr`; the editing UI is M11b3.
- **`XrPanels` base.** `add`, `remove` and `setVisible` per C13 1.1. Quest uses `renderer.xr.createQuadLayer` or `createCylinderLayer` with a `rendercall` blit [S11-F4], and falls back to a scene plane when `layers` is not granted. Vision Pro uses `CanvasTexture` planes. Ray picking feeds `onRay(hit, pressed, hand)`, and head-locked anchors do not exist (by type).
- **Device entry:** M01b2's QA "Enter VR (smoke)" button now calls `enter()`; the player-facing button is M11b3's.
- **Perf.** Scenario `xr-walk` (`config/perf/paths/xr-walk.json`, Civic Center loop, 120 s). `check:perf` runs it on `xr-quest3` against `xr-quest`, and with `?tier=xr-visionpro` on `chromium-webgl2` per view pass (`viewPasses: 2`).
- **Device checklists** `tools/ci/checklists/M11b1-{quest3,visionpro}.json`: enter/exit, refresh (Quest), comfort defaults, hill teleport, 120 s `xr-walk`, face-button indices (Quest), hand-tracking accepted and denied (Vision Pro); outputs in `docs/device-runs/M11b1/<device>/`.

## Scope out
- In-headset UI: the Enter/Exit VR button, wrist panel, comfort card and XR settings pages (M11b3).
- Per-mode XR (racing, fighter: M11b2; tycoon desk, XR cutscene hosts `XrMediaHost`: M11b4).
- `immersive-ar`, PC VR acceptance and multi-user XR (non-goals or post-v1). Full-body IK (post-M11b ADR).

## Deliverables
- `packages/engine/src/platform/xr/{session-controller.ts, rig.ts, hands-ik.ts, input-router.ts, hand-features.ts, pose-block.ts, locomotion.ts, comfort.ts, panels.ts, haptics.ts, refresh.ts}` (11 files).
- `packages/engine/src/client/input/{xr-controller.ts, xr-hand.ts, xr-transient.ts}`, plus edits to `renderer-host.ts`, `sim/services.ts` (`xrPoses`) and `client/xr/smoke.ts`.
- `config/xr-input-profiles.json`, `config/xr-gestures.json`, `config/perf/paths/xr-walk.json`, and the `tools/ci/perf-check.ts` edit for `xr-walk`.
- `packages/engine/test/platform/xr/{gesture.spec.ts, swap.spec.ts, pose-block.spec.ts, comfort.spec.ts, refresh.spec.ts}`.
- `tests/e2e/xr/{xr-session.spec.ts, xr-input.spec.ts, xr-comfort.spec.ts, xr-panels-base.spec.ts}` (tags `@xr` plus `@xr-session`, `@xr-input`, `@xr-comfort`, `@xr-panels-base`).
- `tools/ci/checklists/M11b1-{quest3,visionpro}.json`; `docs/device-runs/M11b1/` (operator output).
- About 34 files.

## Interfaces
- C13 1.1.0 verbatim: `XrSessionController` and `XrState` (§3), `XrTierConfig`, `XrComfortSettings` (`packages/shared/src/platform/xr-comfort.ts`; copy verbatim if M04a1 did not create it), `XrPanels` with registration (`11-platform-pwa.md` §11), `XrPanel`, `XrInputRouter`, `XrSourceState`, `RendererHost.installXrFallback`.
- C03 1.1.0 device kinds and control ids (`xr:left:b0`, `xr:right:a1`, `xr:left:gesture:punch`, `xrt:pinch`, `xr:both:wheel`). C04 1.1.0 `XRRigParams`. No contract change.

## Acceptance criteria
- AC-1 Given IWER emulating Quest 3 at `?tier=xr-quest` When `enterForTest()` runs Then the state passes `requesting → warming → presenting`, `renderer.xr.isPresenting` is true, at least 10 XR frames render with backend `webgl2`, `onRendererReplaced` is never called, and after `exit()` rAF frames resume with the flat tier restored — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-session`
- AC-2 Given a production-mode controller When `enter()` is called outside user activation Then it rejects with `XrGestureRequired`, and the `navigator.xr.requestSession` spy has zero calls — proof: `pnpm check:unit -- packages/engine/test/platform/xr`
- AC-3 Given a fake WebGPU renderer and an XR session without `XRGPUBinding` When the session starts Then the fallback runs once, every registered owner receives `onRendererReplaced(next, prev)` exactly once, `RendererHost.renderer` is the new instance, and a second session does not swap again — proof: `pnpm check:unit -- packages/engine/test/platform/xr`
- AC-4 Given recorded IWER input (trigger, thumbstick flick, pinch) When it is replayed once in normal order and once with `inputSources` reversed Then both runs produce identical C03 `InputFrame` sequences. A thumbstick flick turns by exactly 30°, and a face-button-only binding resolves through its chord fallback — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-input`
- AC-5 Given default comfort settings When the player teleports and then switches to smooth locomotion Then all of these hold:
  - the first entry uses teleport and snap 30°;
  - a teleport target on a slope steeper than `maxSlopeDeg` is refused;
  - the vignette is above 0 while moving and back to 0 within 0.5 s of stopping;
  - `reduceMotion` keeps it at least `low`;
  - no camera shake directive reaches the XR camera.
  — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-comfort && pnpm check:unit -- packages/engine/test/platform/xr`
- AC-6 Given a concurrent writer worker updating the pose block every 1 ms When a reader polls it 100,000 times Then no read returns a torn frame, meaning every head and grip pose belongs to a single `frameId` — proof: `pnpm check:unit -- packages/engine/test/platform/xr`
- AC-7 Given a mock session whose `supportedFrameRates` includes 90 When p90 frame time drops below 9 ms Then the target rate rises from 72 to 90, and it returns to 72 when p90 rises above the `xr-quest` budget × 1.15 — proof: `pnpm check:unit -- packages/engine/test/platform/xr`
- AC-8 Given a test panel registered through `XrPanels.add` on `xr-quest3` When a simulated controller ray hits it and the trigger is pressed Then `onRay` receives the hit `{u, v}` with `pressed: true` and the panel reports its backing kind (quad layer or scene plane) — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-panels-base`
- AC-9 Given the QA build When `xr-walk` runs on `xr-quest3` and with `?tier=xr-visionpro` on `chromium-webgl2` Then the reports validate and render objects and triangles per view pass are within the `xr-quest` and `xr-visionpro` budgets — proof: `pnpm check:perf -- --scenario xr-walk`
- AC-10 Given a Quest 3 or 3S on the preview URL When the operator follows the checklist Then `perf:verify` passes at `xr-quest` with the XR frame rule, and the run records U-ENG-5 (face-button indices), U-PLT-12 and U-PLT-13 in `notes.json` — proof: manual: Quest 3, steps of `pnpm perf:checklist -- tools/ci/checklists/M11b1-quest3.json`, then `pnpm perf:verify -- docs/device-runs/M11b1/quest3/perf.json --tier xr-quest --checklist tools/ci/checklists/M11b1-quest3.json`
- AC-11 Given a Vision Pro on visionOS 26.2 or later When the operator follows the checklist Then `perf:verify` passes at `xr-visionpro` per view pass, and the run records which backend presented (native or the swap), U-PLT-10, and both the accepted and denied hand-tracking paths — proof: manual: Vision Pro, steps of `pnpm perf:checklist -- tools/ci/checklists/M11b1-visionpro.json`, then `pnpm perf:verify -- docs/device-runs/M11b1/visionpro/perf.json --tier xr-visionpro --checklist tools/ci/checklists/M11b1-visionpro.json`
- AC-12 Given the branch When the production build, dist verification and the preview deploy run Then all pass and the production bundle contains neither IWER nor `enterForTest` — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit:** gesture, swap, pose block (worker), comfort and refresh specs (`pnpm check:unit -- packages/engine`).
- **E2E (`xr-quest3`, IWER installed before the renderer, `forceInstall: true`):** `@xr-session`, `@xr-input`, `@xr-comfort`, `@xr-panels-base`. M01b2's `@xr-smoke` stays green. `xr-swap` on `chromium-webgpu` runs only when `DV_EXPECT_WEBGPU=1` (U-PLT-19) and is informational.
- **Perf:** `pnpm check:perf -- --scenario xr-walk`. **Device:** AC-10 and AC-11.

## Demo script
1. `pnpm check:e2e:xr`: all `@xr` specs pass.
2. On a Quest, press "Enter VR (smoke)" on the preview, teleport up a Russian Hill street, snap-turn, then try smooth locomotion and watch the vignette.
3. On a Vision Pro, deny hand tracking and walk with gaze and pinch.

## Effort
1 Builder session (about 34 files) plus an operator device session; risk **high** (two device paths, renderer swap, input identity).

## Risks & fallbacks
- **Vision Pro native WebGPU XR fails at `setSession`:** the fallback renderer path handles it. If both fail, the session ends with a toast and `xr.session{evt:'error'}`. Record it in `notes.json` and keep Vision Pro flat (the CI ACs still pass).
- **IWER lacks layers:** CI panels use scene planes; the Quest run records whether quad layers were granted.
- **Q-13 devices unavailable:** AC-10 and AC-11 are reported as "Blocked on Q-13"; the checklists are committed.
- **Overrun:** cut hands IK and haptics first (controller proxies stay).

## Notes for the Builder
- Read first: `11-platform-xr.md` §2–§5, §9; `11-platform.md` §5.1 step 3, §5.5; `01-engine-contracts.md` C03 and C04 1.1 sections; `10-ui-hud-xr.md` §2.12 (what M11b3 will build on your panels).
- **Rules:** `immersive-vr` only; `renderer.xr.enabled` before `init()`; rendering stays on the main thread [F-006]; nothing awaited before `requestSession`; framebuffer scale and foveation set before the session [S11-F4].
- **UNVERIFIED items (recorded, never asserted):** Quest face-button indices (U-ENG-5), Quest flags (U-PLT-12), session visibility events (U-PLT-13), Vision Pro framebuffer, refresh and cost (U-PLT-10), comfort constants and gesture thresholds (U-PLT-20). No required action sits on a face button.
- **Secrets.** Only the deploy pair (SKIP and exit 0 when absent). **Gates.** Q-13 devices. No fal.
- Branch `m11b1-webxr-port`.

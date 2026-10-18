# M11b2 — per-mode-xr-and-xr-cutscenes

## Goal
After this session racing and the fighter are playable in the headset. **Racing in XR** is a seated cockpit with the vehicle as the rest frame and an optional horizon lock. The vignette scales with yaw rate, and there is no shake, no FOV kick and no nitro blur. Steering works with controllers or a two-hand pinch wheel (`xr:both:wheel`), and pursuits can switch to the `diorama` chase view. Dash gauges are diegetic, results show on a world panel, and `xr: 'none'` event kinds are hidden. **The fighter in XR** (FX10) is a fixed tabletop arena (life-size optional) with no artificial locomotion. Its Simple scheme runs on controllers or hand gestures, its health bars float above the arena, and in-engine cinematic phases play from a fixed `vantage`. Vision Pro is hands-only for both modes. Settings › Controls › VR gains capture-based remap for controller bindings. Neither mode's sim changes, so the cross-browser hashes stay equal. **Split boundary (`_PLAN-2.md`):** M11b2 covers racing and fighter. M11b4 covers the tycoon desk, the XR cutscene video hosts and the per-mode device pass.

## Requirements
- R-PLAT-02: per-mode XR adaptations for racing and the fighter, with controller and hand input and comfort rules.
- R-MODE-02: racing (sprint, circuit, pursuit and the other `xr: 'full'` kinds) is drivable in XR within the Quest caps of 3 rivals and 3 police cars.
- R-MODE-03: Culture Wars is playable in XR with the Simple scheme on controllers and hands; webcam pose is not offered in XR.

## Depends on
- **M11b1** (session, rig, `XrInputRouter`, `HandFeatures` and its two-hand wheel value, XR binders, `XrPanels`). **M07b2** (garage and replay done, photo mode off in XR, racing visuals per tier). **M08b2** (stages, Cinematic phase, kill-switch remap, accessibility pass). **M11b3** (`UiSurface` world, wrist and lazy-follow panels; DL-219).
- Also used: M07b1 (all race kinds, `RaceDef.xr`), M08a2 (Simple scheme, fighter bindings), M04b1 (Settings › Controls).
- Contracts: C03 1.1.0 (`xr:both:wheel`, XR control ids, `InputMap`, `ControlsSettings`), C04 1.1.0 (`XRRigParams.origin` `seat` / `arena` / `diorama`, `vantage`), C06 1.1.0 (`UiBridge`, `mode.<id>.*` keys), C13 1.1.0 (`XrComfortSettings.chaseView`, `arenaScale`, `cockpitHorizonLock`).

## Scope in
- **Racing XR** (`06-racing.md` §6; `06-racing-content.md` C.9; `11-platform-xr.md` §5.3):
  - **Rig.** The rig uses `origin: 'seat'`, anchored to the prefab's driver-seat node (C07 1.1 vehicle node anchors). With `cockpitHorizonLock` the view keeps world-level roll and pitch while yaw follows the car. Shake, FOV kick, nitro blur and director cuts are dropped.
  - **Vignette.** Strength adds `vignetteBoostPerYawRate` × yaw rate plus a lateral-acceleration term to the M11b1 formula (constants from `config/racing.json` `xr`).
  - **Event list.** `RaceDef.xr: 'none'` kinds (drift, sideshow) are hidden from the XR event list. A deep link to one shows "Not available in VR".
  - **Caps.** Rivals and police follow the Quest row (3 · 3) and the Vision Pro row (5 · 6) of §6.2.
  - **Pursuit view.** Pursuits honour `chaseView: 'diorama'`: a tabletop third-person view with `origin: 'diorama'` and no camera motion beyond the dolly.
  - **Bindings** (`config/input/xr.racing.json`, C.9): right trigger throttle, left trigger brake, left thumbstick axis or the two-hand wheel for steering, left squeeze handbrake, right squeeze nitro, right thumbstick press hop, left thumbstick press look-behind, left grip hold reset. Hands: two-hand pinch wheel, `autoThrottle` on, pedal pinch zones, squeeze both hands for handbrake.
  - **Vision Pro gaze-only.** With transient pointers only (no hands), racing shows the "Hand tracking needed to drive" card (DN-S06-04).
  - **Panels.** Dash gauges (speed, gear, nitro, damage) on the `dashScreen` mount from `hud.vehicle`; a wrist glance with position, lap, heat and minimap; results on a `world` panel. Photo and the replay director stay off.
- **Fighter XR** (`07-fighter-content.md` FX10):
  - **Arena.** `origin: 'arena'` with a tabletop diorama about 1.2 m in front of the seated or standing player (`arenaScale: 'tabletop'`; `life-size` optional). No teleport or smooth locomotion while a bout runs; camera dolly only; no shake or super zoom.
  - **Controllers** (`config/input/xr.fighter.json`): trigger → L, squeeze → H, trigger + squeeze → SP, thumbstick → move (up jump, down crouch), thumbstick press → AS. Hype uses a face button only where `config/xr-input-profiles.json` knows it, otherwise grip + trigger.
  - **Hands:** right punch (`xr:right:gesture:punch`) → L, left punch → H, both hands push → SP, both fists near the face → BL, pinch-drag on a world-locked stick disc → move. Vision Pro is hands-only and never gaze-only. Thresholds come from `config/xr-gestures.json`, tuned against recorded fixtures.
  - **Panels.** Health, meter and round timer are drawn on the stage's `arenaAnchor`; menus are `world` panels.
  - **Cinematic phase.** Intros and in-engine cinematic phases render from a fixed C04 `vantage` with no cuts or camera motion (rule 5). Video hosts are M11b4's; until then the in-engine fallback plays from the vantage.
  - Pose mode is hidden in XR (Q-GD-08).
- **XR remap** (`10-ui-hud-xr.md` §2.12). Settings › Controls › VR becomes capture-based for controller bindings: "press the control to bind" writes `ControlsSettings`. `client.Pause` keeps its default (C03 rule 9). Hand gestures stay read-only.
- **Device pass.** M11b4's checklists (`M11b4-{quest,visionpro}.json`) carry the racing seated-drive and fighter tabletop rows; this milestone adds no checklist.

## Scope out
- The tycoon desk and pitch card in XR, `XrMediaHost` cutscene video in XR, and the per-mode device and perf pass: M11b4.
- Any sim change in racing or the fighter. Webcam pose in XR. Remap of hand gestures.
- Online XR (rooms) and XR photo mode.

## Deliverables
- `packages/modes/racing/src/xr/{cockpit-rig.ts, comfort.ts, diorama.ts, panels.ts, gating.ts}`.
- `packages/modes/fighter/src/xr/{arena.ts, gestures.ts, panels.ts, vantage.ts}`.
- `config/input/{xr.racing.json, xr.fighter.json}`; the `config/xr-gestures.json` tuning; `tests/fixtures/xr/hands/{punch-r,punch-l,push,block,wheel,idle-60s}.json`.
- The `packages/ui/src/pages/settings/controls` XR capture view.
- Tests:
  - `packages/modes/racing/test/xr.spec.ts`;
  - `packages/modes/fighter/test/xr.spec.ts`;
  - `packages/engine/test/platform/xr/hand-gestures.spec.ts`;
  - `tests/e2e/xr/{racing-xr.spec.ts, fighter-xr.spec.ts, xr-remap.spec.ts}` (tags `@xr` plus `@racing-xr`, `@fighter-xr`, `@xr-remap`).
- About 27 files in all.

## Interfaces
- C03 1.1.0 control ids (`xr:both:wheel`, `xr:<hand>:b<n>`, `xr:<hand>:gesture:<g>`, `xrt:pinch`) bound through `InputMap` data. No new `SimButton` and no `ClientAction` changes.
- C04 1.1.0 `XRRigParams` with `origin` `seat`, `arena` and `diorama`, and `vantage`. C13 1.1.0 `XrComfortSettings` fields read as defined.
- No contract change. The mode sims (`packages/modes/*/src/sim/**`) are untouched.

## Acceptance criteria
- AC-1 Given IWER Quest 3 and `sf.sprint.ferry-ocean-beach` started in XR When the bot drives the opening 60 s Then all of these hold:
  - the camera mode is `xr` with `origin: 'seat'`;
  - with `cockpitHorizonLock` the view roll stays within 1° through the race's crest;
  - no shake, FOV or cut directive reaches the XR camera;
  - the vignette rises above 0 in the first hard turn;
  - exactly 3 rivals spawn;
  - at the finish the results show on a `world` panel.
  — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @racing-xr`
- AC-2 Given the racing XR unit tests When they run Then all of these hold:
  - the XR event list excludes every `xr: 'none'` race;
  - a deep link to `sf.drift.bayview-yard` in XR is refused with the "Not available in VR" key;
  - a transient-only Vision Pro profile is refused with the "hand tracking needed" key;
  - recorded wheel fixtures at five angles give `xr:both:wheel` within ±0.02 of the expected values;
  - controller inputs mapped to C03 frames and replayed in Node reproduce the flat run's `endHash`.
  — proof: `pnpm --filter @dv/mode-racing test -- xr`
- AC-3 Given a pursuit event with `chaseView: 'diorama'` When it runs in XR Then the rig origin is `diorama`, the view moves only by the dolly, and switching back to `cockpit` at the next pause restores `seat` — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @racing-xr`
- AC-4 Given IWER Quest 3 in fighter Training on `powell_turntable` When the controllers press trigger, squeeze, trigger + squeeze and the thumbstick press Then the fighter performs L, H, SP and AS in order. The arena origin is `arena` at tabletop scale, locomotion input is ignored during the bout, health bars render on the `arenaAnchor` panel, and the Cinematic phase keeps the camera pose constant (fixed `vantage`) — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @fighter-xr`
- AC-5 Given recorded hand fixtures When the gesture classifier runs Then right punch, left punch, push and block are each recognised in every fixture, and the 60 s idle fixture yields zero gestures — proof: `pnpm check:unit -- packages/engine/test/platform/xr/hand-gestures.spec.ts`
- AC-6 Given a fighter input line recorded from XR controllers and converted to C03 frames When it is replayed in Node Then the checkpoint hashes equal those of the same frames fed through the flat binder, the fighter golden replays are unchanged, and the cross-browser fighter hash suite stays green — proof: `pnpm --filter @dv/mode-fighter test -- xr && pnpm --filter @dv/mode-fighter fighter:replay -- golden/vs-001.dvfight && pnpm check:e2e -- --project=webkit-webgl2 --grep @fighter-hash`
- AC-7 Given Settings › Controls › VR in a presenting session When the player captures the right trigger for nitro Then `ControlsSettings` stores the binding after `save.settings`, the racing XR binder then resolves nitro to the right trigger, and an attempt to rebind `client.Pause` is refused — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-remap`
- AC-8 Given the branch When the racing determinism suite, the flat racing and fighter e2e, the build and the preview deploy run Then all pass, showing XR changed no sim behaviour — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @racing-det && pnpm check:e2e -- --project=chromium-webgl2 --grep @racing-vs && pnpm build && pnpm deploy:preview`

## Test plan
- **Unit:** racing `xr` and fighter `xr` package suites; the engine `hand-gestures` spec.
- **E2E (`xr-quest3`):** `@racing-xr`, `@fighter-xr`, `@xr-remap`; every M11b1 and M11b3 `@xr` spec stays green (`pnpm check:e2e:xr`).
- **Regression:** `@racing-det`, `@racing-vs`, `@fighter-hash`, `@fighter-touch`.
- **Device:** in M11b4's pass; there is no device AC here (`_PLAN-2.md` row: gate none).

## Demo script
1. `pnpm check:e2e:xr` passes.
2. On a Quest preview: Enter VR, open Jobs › Racing, run `sf.circuit.embarcadero-vanness` with the two-hand wheel, and note the vignette in the hairpins.
3. Start a Training bout: the tabletop arena appears; punch with the right hand for L and push with both hands for SP.

## Effort
0.7 Builder session; about 27 files; risk **medium**. Both modes reuse M11b1's rig and router, and the work is bindings, rig origins and panels. Gesture tuning against fixtures is the uncertain part.

## Risks & fallbacks
- **M11b3 not merged** (it is not in `_PLAN.md` Depends on): build the panels directly on `XrPanels` with M04b2's `UiSurface` skeleton, and report it.
- **Horizon lock feels wrong on SF hills** in testing: keep the lock on pitch only and report it. The comfort default stays `cockpitHorizonLock: true`.
- **Gesture false positives:** raise the wrist-velocity threshold in `config/xr-gestures.json` (data). The controller path is unaffected.
- **Overrun:** XR remap (AC-7) is the cut line. The read-only list from M11b3 stays, and the remap is reported as open.

## Notes for the Builder
- Read first: `11-platform-xr.md` §5.3–§5.4; `06-racing.md` §6; `06-racing-content.md` C.9; `06-racing-data.md` `xr` config block; `07-fighter-content.md` FX10; `10-ui-hud-xr.md` §2.12 (per-mode panels, remap); `01-engine-contracts.md` C04 rule 5 and the 1.1 section.
- **UNVERIFIED (never asserted):** Quest face-button indices (U-ENG-5): no required action sits only on a face button; gesture thresholds (U-PLT-20); WebXR camera access on Quest (Q-GD-08), so there is no pose mode in XR.
- **Secrets.** Only the deploy pair (SKIP and exit 0 when absent). **Gates.** None for CI; Q-13 applies to M11b4's device pass. No fal.
- Branch `m11b2-per-mode-xr-and-xr-cutscenes`.

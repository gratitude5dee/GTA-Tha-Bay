# M11b4 — per-mode-xr-and-xr-cutscenes

## Goal
The XR port covers every mode and every cutscene path. M11b2 already did racing and fighter. When this session ends: the tycoon mode runs as a seated desk scene with world-locked panels (dashboard, cap table, inbox, pitch card) that work with trigger or pinch and need no hover. Cutscenes play in a headset through the S11 `XrMediaHost` implementations: a Quest media layer, a Vision Pro WebCodecs texture, and a plain video-texture fallback. Each runs in a paused cinema scene with a subtitle plane, 300 ms fades and skip by button or pinch. When no clip can play, the in-engine fallback runs from the fixed `xrVantage` with no cuts. Per-mode Quest and Vision Pro checklists exist, and the device pass is judged by `perf:verify`. This closes the XR rows needed at the single-player launchable point.

## Requirements
- R-PLAT-02: per-mode XR rules (tycoon desk) and XR cutscenes complete the full XR port on Quest 3/3S and Vision Pro.
- R-CUT-03: every XR cutscene has a non-generated fallback (fixed-vantage director with subtitles), so XR play never blocks on video.
- R-MODE-04: the tycoon mode is playable in XR.

## Depends on
- M11b2 (racing and fighter XR, per-mode panel pattern), M09b1 (tycoon UI, XR desk panel views through `UiSurface`), M05b2 (`CutscenePlayer` flat hosts, triggers, subtitles, AI chip, `cutscene.state` protocol).
- Contracts: C09 1.0 (`CutscenePlayer`, `PreparedClip`, `DirectorScript.xrVantage`, `FallbackTrigger`; `03-story-cutscenes.md` §D2, §D6, §D7), C13 1.1 (`XrMediaHost`, `XrPanels`, `FirstGestureUnlock` video pool; `11-platform-xr.md` §4.4, §5.5–§5.6), C04 1.1 (`XRRigParams.vantage`, origin `desk`), C06 1.1 (`UiCommand 'cutscene.state'`).

## Scope in
- `XrMediaHost` (`packages/engine/src/platform/xr/media/`), per `11-platform-xr.md` §5.6:
  - `xr-media-layer` (Quest): `XRMediaBinding(session).createQuadLayer(video, { space: localFloor, transform, width: 2.4, height: 2.4·h/w })`, appended after the projection layer in `session.renderState.layers`; target frame rate 72 for the clip, previous rate restored after.
  - `webcodecs-texture` (Vision Pro): `VideoDecoder` → `VideoFrameTexture` on a world-locked plane, every `VideoFrame` closed after upload; the mp4box dependency vendored same-origin (`11-platform-pwa.md` §2 rule 4).
  - `xr-texture` fallback: `VideoTexture` from a pooled element unlocked by `FirstGestureUnlock` before `requestSession`, `needsUpdate` also set when `currentTime` advanced since the last XR frame.
  - `selectXrHost(caps)`: chooses per the §D7 host table and falls back along its chain.
- Cinema scene (`packages/engine/src/platform/xr/cinema.ts`): only dimmed sky, screen ≈ 2.4 m wide at 3 m (≈ 44°) centred at seated eye height, floor and subtitle plane; the city does not render; controllers and hands hidden on Quest; 300 ms fades; skip by controller button or pinch.
- Subtitle plane: Quest quad layer drawn through the r186 `createQuadLayer(…, rendercall)` from the S10 subtitle text; Vision Pro a `CanvasTexture` plane; text from the clip cues (R-ENG-04).
- Story side (`packages/modes/story/src/cutscene/xr/`): the XR branch of `CutscenePlayer` picks the host and rendition `v768`; triggers `mid_stall` (also a frozen frame for 1 s in XR) and `budget` (XR p90 > budget × 1.15 for 2 s → `v540`, then fallback) per §D7; answers `cutscene.state` within 2.5 s (1.5 s prefetched); the in-engine fallback fades 300 ms, places the viewer at `xrVantage` (C04 `vantage`), applies no cuts or camera motion, shows subtitles on the plane, and leaves the same mission state as the flat path.
- Tycoon XR (`packages/modes/tycoon/src/xr/`): desk scene, rig `origin: 'desk'`, seated; panels dashboard, cap table, inbox and pitch card registered through `XrPanels` at `uiDistanceM`, world-locked; selection by trigger or pinch on `targetRaySpace`; no hover-only control; no locomotion; panels redraw on data change only, at most 2 texture updates per frame; free-text fields show "Exit VR to continue" (DL-142); flag `tycoon.xrDesk` turned on.
- Checklists `tools/ci/checklists/M11b4-quest.json` and `M11b4-visionpro.json` (C13 `DeviceChecklist`) with per-mode rows: enter and exit; story walk with teleport and snap turn; racing seated drive (M11b2 rules); fighter tabletop round; tycoon desk to pitch-card accept (gaze and pinch on Vision Pro); one 15 s cutscene with subtitles through the native host and one forced fallback (Settings › Generated cutscenes: Off, trigger `setting_off`); comfort defaults on first entry; Quest face-button capture; refresh rate.

## Scope out
- `immersive-ar`, PS VR2 controllers → post-v1 ADR-0027. XR remap capture UI → M11b2 (S10). Real generated clips beyond fixtures → M05c3, M10b (fal cap DL-OWN-01; none spent here).
- `desktop-ultra` and flat-tier calibration → M11a2. Release device pass → M14b3.

## Deliverables
- `packages/engine/src/platform/xr/media/{select.ts, media-layer-host.ts, webcodecs-host.ts, texture-host.ts, index.ts}`, `packages/engine/src/platform/xr/{cinema.ts, subtitle-plane.ts}`.
- `packages/engine/src/platform/xr/media/{select.test.ts, texture-host.test.ts}` (colocated so `check:unit -- packages/engine/src/platform` selects them).
- `packages/modes/story/src/cutscene/xr/{xr-player.ts, xr-fallback.ts, triggers.ts}`, `packages/modes/story/test/xr-cutscene.spec.ts`.
- `packages/modes/tycoon/src/xr/{desk-scene.ts, panels.ts, input.ts, index.ts}`; `config/tycoon.balance.json` flag `tycoon.xrDesk: true`.
- Vendored mp4box under `packages/engine/vendor/` with its licence snapshot (passes `license:scan`).
- `tests/e2e/xr-cutscene.spec.ts` (`@xr @xr-cutscene`), `tests/e2e/tycoon-xr.spec.ts` (`@xr @tycoon-xr`); both titles carry `@xr` so the `xr-quest3` project's `grep: /@xr/` selects them.
- `tools/ci/checklists/M11b4-quest.json`, `tools/ci/checklists/M11b4-visionpro.json`.
- `docs/device-runs/M11b4/{quest3,visionpro}/{perf.json, notes.json}` (from the device pass).

## Interfaces
- C09 1.0, C13 1.1, C04 1.1, C06 1.1 consumed as frozen; `PreparedClip` minimum per DL-061.
- No contract change.

## Acceptance criteria
- AC-1 Given capability sets (Quest with layers, Quest without layers, Vision Pro with `VideoFrameTexture`, Vision Pro without it) When `selectXrHost` runs and the chosen host fails Then it picks `xr-media-layer`, `xr-texture`, `webcodecs-texture` and `xr-texture` respectively and falls back along the §D7 chain; the texture host flags `needsUpdate` only on frames where `currentTime` advanced — proof: `pnpm check:unit -- packages/engine/src/platform`
- AC-2 Given the XR player with a scripted frame clock When a clip freezes for 1 s and when XR p90 exceeds 1.15 × the budget for 2 s Then the first holds `last.webp` and finishes in-engine from the matching cue with trigger `mid_stall`, and the second drops to `v540` and then falls back with trigger `budget` — proof: `pnpm check:unit -- packages/modes/story`
- AC-3 Given `xr-quest3` with IWER and a story beat whose status is `absent` When the beat fires in the headset Then `cutscene.state` is `fallback` within 2.5 s, the viewer sits at the `xrVantage` pose, the camera pose does not change between fade-in and fade-out, the subtitle plane shows each cue's text, and the mission state hash afterwards equals the flat `?beats=instant` run — proof: `pnpm check:e2e:xr -- --grep @xr-cutscene`
- AC-4 Given `xr-quest3` with IWER and a fixture manifest marked ready When the beat fires Then `test-results/xr-cutscene.json` records the selected host kind, the player answers `video` or `fallback` with a trigger within 2.5 s, a controller select skips to `done`, and the mission resumes with the same state as AC-3 — proof: `pnpm check:e2e:xr -- --grep @xr-cutscene`
- AC-5 Given `xr-quest3` with IWER and a tycoon run in the desk scene When the four panels open and a trigger select on the pitch card accepts the offer Then the rig origin is `desk`, every panel is world-locked at `uiDistanceM`, the accepted offer changes the run state exactly as the flat accept does, no element relies on hover, and thumbstick input does not move the rig — proof: `pnpm check:e2e:xr -- --grep @tycoon-xr`
- AC-6 Given the two new checklists When the checklist printer reads them Then both validate against the `DeviceChecklist` schema and list every per-mode row named in Scope in — proof: `pnpm perf:checklist -- tools/ci/checklists/M11b4-quest.json && pnpm perf:checklist -- tools/ci/checklists/M11b4-visionpro.json`
- AC-7 Given a Quest 3 on the Preview build When the operator runs `M11b4-quest` Then every row passes, the 15 s clip plays with subtitles, the forced fallback completes, and the uploaded run passes the judge; the run records U-ENG-5, U-PLT-12, U-PLT-13 and U-S03-6 in `notes.json` — proof: manual: Quest 3, Quest Browser, run `pnpm perf:checklist -- tools/ci/checklists/M11b4-quest.json`, follow each row, save `perf.json` and `notes.json` to `docs/device-runs/M11b4/quest3/`, then `pnpm perf:verify -- docs/device-runs/M11b4/quest3/perf.json --tier xr-quest --checklist tools/ci/checklists/M11b4-quest.json`
- AC-8 Given a Vision Pro on visionOS 26.2+ When the operator runs `M11b4-visionpro` with gaze and pinch only Then every row passes, including the pitch-card accept and the WebCodecs clip with subtitles, and the run passes the judge; the run records U-PLT-10 and U-PLT-13 — proof: manual: Vision Pro, Safari, run `pnpm perf:checklist -- tools/ci/checklists/M11b4-visionpro.json`, follow each row, save to `docs/device-runs/M11b4/visionpro/`, then `pnpm perf:verify -- docs/device-runs/M11b4/visionpro/perf.json --tier xr-visionpro --checklist tools/ci/checklists/M11b4-visionpro.json`
- AC-9 Given the branch When it builds, the licence scan runs and the Preview deploys Then all succeed with mp4box vendored and no runtime CDN import — proof: `pnpm build && pnpm license:scan && pnpm deploy:preview`

## Test plan
- Unit: `packages/engine/src/platform/xr/media/*.test.ts`; `packages/modes/story/test/xr-cutscene.spec.ts`.
- E2E (`xr-quest3`, IWER 2.6.0 before the renderer): `@xr-cutscene`, `@tycoon-xr`; assertions on bridge state, never pixels.
- Device: `M11b4-quest`, `M11b4-visionpro` judged by `perf:verify`; committing the runs triggers the `device-runs` CI job.

## Demo script
1. `pnpm dev`; open `/?xr-emulate=quest3`; enter VR from the button.
2. Set Generated cutscenes to Off and start a story beat: watch the fixed-vantage scene and the subtitle plane.
3. Start the same beat with the ready fixture: the cinema scene shows the clip; skip with the controller.
4. Open Tycoon from Modes in VR: the desk appears; accept the pitch-card offer with the trigger.
5. On a Quest, run the `M11b4-quest` checklist.

## Effort
0.7 Builder session; about 30 files; risk **medium**. The Quest media layer and WebCodecs host can only be confirmed on devices; CI covers the fallback paths.

## Risks & fallbacks
- Quest video textures freezing after XR entry (U-S03-6): elements come from the pre-session pool and the texture host polls `currentTime`; if it still freezes on device, the checklist row fails, `mid_stall` hands over to the in-engine fallback, and the run records it.
- XR media layers or `VideoFrameTexture` missing on the device build: `selectXrHost` falls back to `xr-texture`; the AC still passes when the checklist's clip row plays through any host.
- Vision Pro frame-rate control is unavailable (U-PLT-10): no rate change is attempted there.
- Q-13 devices absent: AC-7 and AC-8 stay open and are listed under "Blocked on"; CI ACs still pass.

## Notes for the Builder
- Read first: `11-platform-xr.md` §4.4, §5.1–§5.6, §9; `03-story-cutscenes.md` §D6 (XR line), §D7; `08-tycoon.md` §6 (platform table), §9 (`@tycoon-xr`); `10-ui-hud-xr.md` §2.12; `11-platform-perf.md` §4 (`DeviceChecklist`).
- XR sessions start only inside the Enter VR click handler (IWER tests excepted); create and unlock video elements before `requestSession`.
- Camera effects that move the view are disabled in XR; the cinema scene and the fallback expose only the dolly (C04 rule 5).
- Branch `m11b4-per-mode-xr-and-xr-cutscenes`.

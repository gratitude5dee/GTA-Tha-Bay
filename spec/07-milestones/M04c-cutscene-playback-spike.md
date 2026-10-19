# M04c — cutscene-playback-spike

## Goal
After this session the flat platform can play a cutscene clip the way every later cutscene will be played. `FirstGestureUnlock` resumes audio and unlocks a pool of three `<video>` elements on the first gesture (C13 1.1 `acquireVideo`/`releaseVideo`); a flat DOM host covers the canvas, pauses rendering and the sim, holds a screen wake lock on mobile and releases decoders cleanly; a media budget enforces "one decoding, one pre-rolled". The C09 cutscene types exist in `@dv/shared`, two original fixture clips ship with `CutsceneManifest`s, and S10's `CutsceneOverlay` shows skip, subtitles and the AI-generated chip. Device runs on iPhone 15 and Quest 3 record the Low Power Mode, wake-lock, MSE-gap and first-frame items (U-PLT-17, U-S03-4, U-S03-7). The full `CutscenePlayer` (resolve, triggers, sequences) is M05b2.

## Requirements
- R-CUT-03: the host is the video half of every cutscene; the fallback half arrives in M05a2/M05b2.
- R-PLAT-01: iPhone PWA playback rules (gesture, Low Power Mode, wake lock, memory line) are designed and measured.
- R-ENG-04: subtitles on by default with minimum cue duration; skippable by key, button and tap.

## Depends on
- M01c (`RendererHost`, `MemoryBudget` counters, `QaFlags`, perf HUD export, device checklist tools), M04b1 (shell, kit, toasts, focus navigation).
- Contracts: C09 1.0 (`03-story-cutscenes.md` §D2 types), C13 1.1 (`FirstGestureUnlock` + video pool API, `11-platform-pwa.md` §7, §11), C06 1.1 (`UiCommand` `cutscene.skip`, read only).

## Scope in
- `packages/shared/src/contracts/c09-cutscene.ts`: every type of §D2 verbatim (types and `declare function`s only; `cutsceneKey` lands in M05b2). It imports `LineId`, `CastName`, `LatLngTuple` from `./c09-mission`: create `c09-mission.ts` now holding exactly `C09_VERSION = '1.0.0'` and those three type lines from `03-story-missions.md` §C3; M05a1 completes the file. `PreparedClip` names `HTMLVideoElement`; `packages/shared` has no DOM lib, so add `packages/shared/src/contracts/dom-media.d.ts` with `declare global { interface HTMLVideoElement {} }` (merges with DOM where present; shape unchanged; Builder decision logged and reported as a proposal).
- `packages/shared/schemas/cutscene-manifest-1.schema.json` (hand-written from `CutsceneManifest`; a drift test compares required keys with the TypeScript).
- `packages/engine/src/platform/media/`:
  - `first-gesture.ts`: one listener for the first `pointerup`, `touchend` or `keydown` on the title screen; creates or resumes the shared `AudioContext` (M01b2 buses), sets `navigator.audioSession.type = 'playback'` when present, creates three `<video>` elements (`muted playsinline disableRemotePlayback crossorigin="anonymous" preload="auto"`), plays the 0.1 s same-origin blank clip in each, pauses; `state()` → `{audio, unlocked, pool, errors[]}`; `acquireVideo()`/`releaseVideo()`; idempotent on later gestures.
  - `media-budget.ts`: at most 1 decoding plus 1 pre-rolled element; a third `prepare` is refused with reason `budget`; reports media MB to `MemoryBudget` (64 MB line on mobile tiers).
  - `wake-lock.ts`: `navigator.wakeLock.request('screen')` while a clip covers the screen on mobile tiers; re-acquired on `visibilitychange` → visible; absent API → one warning, no throw.
  - `dom-host.ts` (`CutsceneHostKind 'dom-overlay'`): mounts the element above the canvas (`object-fit: contain` on black), calls `RendererHost` to stop `setAnimationLoop` and the sim to pause, keeps GPU resources resident, resumes on hide; release = `removeAttribute('src'); load()`; rendition pick: first rendition whose `codecs` passes `canPlayType`, preferring `v768`, `v540` when `PlatformSettings.dataSaver`.
  - `spike-player.ts`: QA-only driver for the fixtures: `play(fixtureId)` → `{path: 'video', skipped}` or `{path: 'fallback', trigger}` using the C09 `CutsceneOutcome` shape; an MSE (`ManagedMediaSource` where present, else `MediaSource`) `sequence`-mode playback of fixture A then B that measures the gap, and a ping-pong two-element variant. The source buffer type follows the container (DL-654): where `MediaSource` is absent and `ManagedMediaSource` is present (iPhone), `sequence()` appends only the H.264 fMP4 rendition (`video/mp4; codecs="avc1.640028"`) and, if the fixtures carry none, returns `{skipped: 'no-fmp4'}` and measures nothing; the VP9 WebM `sequence` path runs only where `MediaSource` exists (the CI path). Each `sequence()` result records `isTypeSupported` for both `video/mp4; codecs="avc1.640028"` and `video/webm; codecs="vp9"` on the source class it used.
- `packages/ui/src/cutscene/CutsceneOverlay.tsx`: skip button (Escape, gamepad B, tap) → `UiCommand {t: 'cutscene.skip'}`; subtitles from the manifest's VTT or a cue list, each cue shown at least `max(1.5 s, 0.06 s × characters)` and never before its start; **AI-generated** chip visible for the whole clip when `provenance.aiGenerated` (10-ui-hud-xr §2 item 3; §D7's "2 s at start" is a subset), absent otherwise; HUD hidden while covered.
- Fixtures `tests/fixtures/cutscenes/`: `fixture-a/` (8 s) and `fixture-b/` (6 s), original abstract animation (shapes and colour fields, no text, no logos), each with `v768.webm` (VP9, muted, the CI rendition), `v768.mp4` (the device-run rendition, DL-654: H.264 video-only CMAF fMP4 made by `make-fixtures.ts --fmp4` from the recorded WebM with the one `cut@1` `v768` recipe of [research/gap-cutscene-delivery-playback.md §2.4] for both fixtures (its `COMMON` flags, including `-movflags +frag_keyframe+empty_moov+default_base_moof+cmaf`, and its `v768` line; codecs `avc1.640028`); it needs `ffmpeg` on PATH, so CI and a Builder without ffmpeg skip it and the manifests then list only the WebM; the operator generates it, commits it with its provenance record and manifest rendition, and publishes the fixtures to `media-staging` before AC-8; a plain non-fragmented MP4 is never produced), `poster.webp`, `last.webp`, `subs.en.vtt` (two cues), `manifest.json` (`licence.status: 'pending'`, `provenance.aiGenerated: true`, as C09 requires of every manifest), and the blank clip `apps/web/public/media/blank.webm`. Generated once by `tests/fixtures/cutscenes/make-fixtures.ts` (Playwright Chromium `MediaRecorder` on a canvas) and committed with provenance records (origin `authored`, tool `make-fixtures.ts`).
- QA page `apps/web/qa/cutscene-spike.html` (built only when `VITE_DV_QA=1`, like the M01a2 determinism page; no new URL flag) mounts the title gesture target and the overlay host; `window.__dvBridge.media` = `{ state(), play(id), skip(), sequence(ids), useCanvasSource(on) }` (QA builds only).
- Device checklists `tools/ci/checklists/M04c-{iphone15,quest3}.json` (C13 `DeviceChecklist`): gesture unlock in Safari tab and Home Screen, with and without Low Power Mode; wake lock over a 60 s loop; first-frame time of `v768` (same-origin, and from `media-staging` when the operator has published the fixtures); MSE sequence gap vs ping-pong, on iPhone through `ManagedMediaSource` with the fMP4 rendition only, recording `ManagedMediaSource.isTypeSupported` for the fMP4 and the WebM VP9 type and whether `mode = 'sequence'` is accepted (DL-654); Quest Browser flat playback. Outputs to `docs/device-runs/M04c/<device>/{perf.json, notes.json}`.

## Scope out
- `CutscenePlayer` (index, route 27, triggers F1–F10, `playSequence`, prefetch), `cut.request` protocol, telemetry `cutscene.play`: M05b2.
- In-engine fallback director: M05a2. XR hosts (`xr-media-layer`, `webcodecs-texture`): M11b2. Audio sync against `requestVideoFrameCallback`: M05b2.

## Deliverables
- `packages/shared/src/contracts/{c09-cutscene.ts, c09-mission.ts (partial), dom-media.d.ts}`, `packages/shared/schemas/cutscene-manifest-1.schema.json`, `packages/shared/test/c09-cutscene.test.ts`.
- `packages/engine/src/platform/media/{index.ts, first-gesture.ts, media-budget.ts, wake-lock.ts, dom-host.ts, spike-player.ts}`, `packages/engine/test/media/{first-gesture.test.ts, dom-host.test.ts, media-budget.test.ts}`.
- `packages/ui/src/cutscene/{CutsceneOverlay.tsx, subtitles.ts}`, `packages/ui/test/cutscene-overlay.test.tsx`, i18n keys in `en.json`.
- `apps/web/public/media/blank.webm`, `apps/web/qa/cutscene-spike.html`, `apps/web/src/qa/media-bridge.ts`.
- `tests/fixtures/cutscenes/{make-fixtures.ts, fixture-a/*, fixture-b/*}`, provenance records.
- `tests/e2e/cutscene-spike.spec.ts` (tag `@cutscene`), `tools/ci/checklists/M04c-{iphone15,quest3}.json`.

## Interfaces
- C09 1.0 cutscene types created verbatim; C13 1.1 `FirstGestureUnlock.acquireVideo/releaseVideo` implemented; C06 1.1 `UiCommand` used as defined. No shape change; the type-only `dom-media.d.ts` shim is accepted (DL-232).

## Acceptance criteria
- AC-1 Given a page with no gesture yet When `acquireVideo()` is called Then it returns `null`; after one synthetic `pointerup` the mocked `AudioContext` is `running`, `state().pool` is 3, each element carries `muted`, `playsinline`, `disableRemotePlayback`, `crossorigin="anonymous"` and `preload="auto"`, three acquires succeed, a fourth returns `null`, a release makes one available again, and a second gesture changes nothing — proof: `pnpm check:unit -- packages/engine/test/media`
- AC-2 Given the DOM host with a mocked `RendererHost`, sim and wake-lock API on tier `mobile-low` When `show()` and then `hide()` run Then `setAnimationLoop(null)` and sim pause happen on show, a `screen` wake lock is held while shown and released on hide, the loop and sim resume, and release leaves the element with no `src`; without `navigator.wakeLock` the host warns once and does not throw — proof: `pnpm check:unit -- packages/engine/test/media`
- AC-3 Given one decoding and one pre-rolled clip When a third clip is prepared Then it is refused with reason `budget`, and the reported media MB equals the sum of the two renditions' `bytes` — proof: `pnpm check:unit -- packages/engine/test/media`
- AC-4 Given the overlay with a two-cue VTT and a manifest with `aiGenerated: true` When the clip plays Then each cue stays at least `max(1.5 s, 0.06 s × characters)`, the AI chip is visible from first to last frame, Escape, gamepad B and a tap each send exactly one `{t: 'cutscene.skip'}`; when the overlay shows a cue-only in-engine sequence (no manifest) no chip renders — proof: `pnpm check:unit -- packages/ui`
- AC-5 Given the two fixture manifests When the shared tests run Then each validates against `cutscene-manifest-1.schema.json`, every rendition's `bytes` and `sha256` match its file, and the schema's required keys equal the `CutsceneManifest` TypeScript keys — proof: `pnpm check:unit -- packages/shared`
- AC-6 Given a QA build on the page `/qa/cutscene-spike.html` When the test plays `fixture-a` before any gesture Then the outcome is `fallback` with trigger `not_permitted`; after clicking the title, `play('fixture-a')` reports `path: 'video'`, `currentTime` passes 1 s, cue 1 text is visible, `skip()` yields `done` with `skipped: true` within 300 ms, the element is released, the render loop runs again and `crossOriginIsolated` is still true — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @cutscene && pnpm check:e2e -- --project=chromium-webgl2 --grep @cutscene`
- AC-7 Given the committed fixtures When the provenance gate runs Then every fixture media file has a valid record and the gate passes — proof: `pnpm provenance:check`
- AC-8 Given an iPhone 15 on the Preview URL (Safari tab, then Home Screen app) When the operator runs `M04c-iphone15.json` with Low Power Mode off and on Then for each case `notes.json` records U-PLT-17 (did the pooled element play a new source after the gesture), records U-S03-7 (first-frame time of `v768`), records U-S03-4 (MSE gap versus ping-pong, measured with the `v768.mp4` fMP4 rendition through `ManagedMediaSource`, plus `ManagedMediaSource.isTypeSupported` for `video/mp4; codecs="avc1.640028"` and `video/webm; codecs="vp9"` and whether `sequence` mode was accepted; DL-654) and records whether the screen stayed on for 60 s; `perf.json` passes the tier judge — proof: manual: iPhone 15, steps in `tools/ci/checklists/M04c-iphone15.json`, commit `docs/device-runs/M04c/iphone15/`; then `pnpm perf:verify -- docs/device-runs/M04c/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M04c-iphone15.json`
- AC-9 Given a Quest 3 in Quest Browser (flat page) When the operator runs `M04c-quest3.json` Then `notes.json` records playback path, first-frame time and skip by controller button — proof: manual: Quest 3, steps in `tools/ci/checklists/M04c-quest3.json`, commit `docs/device-runs/M04c/quest3/notes.json`
- AC-10 Given the branch When the build and preview deploy run Then both pass and the shell is unchanged outside the QA flag — proof: `pnpm build && pnpm check:bundle && pnpm deploy:preview`

## Test plan
- Unit: `engine/media.first-gesture`, `engine/media.dom-host`, `engine/media.budget`, `ui/cutscene-overlay`, `shared/c09-cutscene` (schema, fixtures). `pnpm check:unit -- packages/engine/test/media packages/ui packages/shared`.
- E2E: `tests/e2e/cutscene-spike.spec.ts` (`@cutscene`) on `webkit-webgl2` and `chromium-webgl2`; assertions on `__dvBridge.media.state()` and DOM, never pixels.
- Static: `pnpm provenance:check`, `pnpm check:bundle` (QA media bridge absent from production chunks).
- Device: `M04c-iphone15`, `M04c-quest3` checklists (records only).

## Demo script
1. `pnpm dev`, open `/qa/cutscene-spike.html`; click the title.
2. Console: `__dvBridge.media.state()` shows `pool: 3`, `unlocked: true`.
3. `await __dvBridge.media.play('fixture-a')`: the clip covers the canvas with subtitles and the AI chip; press Escape.
4. `await __dvBridge.media.sequence(['fixture-a','fixture-b'])`: the console prints the measured gap.
5. Open the Preview URL on an iPhone and run the checklist.

## Effort
1 session; ≈ 30 hand-written files (fixture media generated by a script); risk medium.

## Risks & fallbacks
- Playwright's Chromium build lacks proprietary codecs, so CI fixtures are VP9 WebM and the H.264 rendition is absent in CI; production clips stay H.264 (`cut@1`) and are picked by `canPlayType`. WebM VP9 through `ManagedMediaSource` on iPhone is not assumed (U-S03-4, DL-654), so the iPhone sequence run uses only the operator-made fMP4 rendition; with no ffmpeg on the operator's machine, AC-8 records U-S03-4 as not measured and the ping-pong fallback stands.
- WebKit on Linux cannot decode either fixture codec (record `canPlayType` results in `test-results/codecs.webkit-webgl2.json`): the `@cutscene` spec calls `__dvBridge.media.useCanvasSource(true)` for that project only, which feeds the same host from `canvas.captureStream(24)` (no codec). AC-6 keeps its command; log a Builder decision.
- `MediaRecorder` output lacks a duration header: `make-fixtures.ts` writes `durationMs` and `frames` into the manifest from the recording plan, not from the file.
- An iPhone in Low Power Mode refuses even pooled playback: that is a recorded outcome (U-PLT-17), not a failure; M05b2's `not_permitted` trigger handles it.

## Notes for the Builder
- Codec support in Playwright's Chromium and WebKit builds is not in the ledger: the `@cutscene` run records U-REC-1 (VP9 decode of the fixtures); the canvas-source fallback keeps every AC command unchanged (DL-232).
- Read first: `11-platform-pwa.md` §6–§7 and §11; `03-story-cutscenes.md` §D2 and §D7 (hosts table, audio, subtitles); `10-ui-hud-xr.md` §2 (overlay); [research/gap-cutscene-delivery-playback.md §3, §4, §7].
- Order: shared types and schema → fixtures script → first-gesture → budget → wake lock → DOM host → overlay → spike player and bridge → e2e → checklists.
- The blank clip and fixtures are same-origin, so `crossorigin="anonymous"` passes COEP `require-corp` without CORP headers; keep them out of the service-worker precache except `blank.webm`.
- Never create cutscene `<video>` elements outside the pool (S03 relies on it). No secrets needed; `deploy:preview` SKIPs without Cloudflare secrets. Branch `m04c-cutscene-playback-spike`.

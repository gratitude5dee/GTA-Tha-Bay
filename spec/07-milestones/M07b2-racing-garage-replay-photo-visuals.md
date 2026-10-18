# M07b2 — racing-garage-replay-photo-visuals

## Goal
After this session racing is presentation-complete for v1. The garage sells and applies upgrades and liveries from the racing purse, with every car's fully upgraded PI kept inside its class band. Replays play through a director with the S03 shot vocabulary and can be scrubbed. Photo mode pauses a single-player race behind a clamped cinematic camera and saves a PNG. The `desktop-ultra` look (VR-1…VR-8) sits behind flags inside the tier budgets, racing audio sets are wired, and the econ-sim has a racing section. **Gap 11 closed here:** `RaceSource.intro` and `cut.race.intro.<raceId>` `CutsceneRef`s with an in-engine DirectorScript fallback for 12 events (R-CUT-02 SHOULD). In v1 these intros always play the fallback, because `03-story-cutscenes.md` §D9.1 funds no racing clip.

## Requirements
- R-MODE-02: garage, upgrades, replay director, photo mode and the "Forza-grade" look at `desktop-ultra`.
- R-CUT-02: racing event intro hooks exist as indexed refs.
- R-CUT-03: every racing intro has a DirectorScript fallback with subtitles, so the race never waits for generation.
- R-ENG-02 (support): visual features are flag-gated per tier and dropped by the governor first.

## Depends on
- **M07b1** (all events, ladder, cars, quirks), **M05b2** (`cutsceneKey`, `assets:cutscene-index`, templates and prompt lint, flat `CutscenePlayer`, the `@cutscene` suite; transitively M05a2's `defineDirector` and LOS check, M04b2's garage frame and M04d's econ-sim).
- Contracts: C05 1.1 (`CoreSlice.garage`), C06 1.1 (`UiBridge`, `EconomyApi`), C07 1.1 (`texture` livery, audio kinds), C09 1.0 (`CutsceneRef`, `CutscenePlayer`, `DirectorScript`), C13 1.1 (`PostNode`, `optionalPost`), C16 1.1.

## Scope in
- Garage (`06-racing-content.md` C.4, `06-racing-data.md` §4.1): view-models for S10's garage frame; upgrade levels 1–3 per slot with C.4 multipliers applied to the base profile at spawn; prices 2/4/7 % of base price; repair after an event at 8 % × (1 − health); livery as `texture/<id>` + hue + plate (≤ 7 chars, A–Z 0–9); purchases idempotent through `EconomyApi` keys against the racing purse.
- `content/vehicles/pi.lock.json` written by the headless oracle lines (PI₀ and ΔPI per slot and level); CI fails if a fully upgraded car leaves its class band.
- Replay director: racing shot weights chase, flyby, side, front, heli, rearlow over the S03 shot vocabulary and LOS check; seeded shot choice; scrub with keyframes every 300 ticks (`REPLAY_LIMITS.keyframeEveryTicks`), seeking re-simulates from the nearest keyframe or, if a snapshot round trip is not bit-exact, from the start.
- Photo mode (`06-racing.md` §2.11): pause via `FrameSignal.paused`, cinematic shot clamped to 30 m, C03 `photo` context, FOV 18–90°, depth of field, exposure ±2 EV, 8 LUTs, hide HUD, shutter → PNG via `toBlob`; iPhone path shows the image full-screen for press-and-hold saving; off in XR; telemetry `racing.photo {}`.
- Visual target (`06-racing-content.md` C.10): `tierCaps` per tier; VR-1 clear-coat TSL paint, VR-2 probes plus SSR, VR-3 wheel spoke blur and camera motion blur, VR-4–VR-6 post and lights, VR-7 cockpit interiors, VR-8 `_dent` vertex dent and dirt; `motionblur`, `ssr`, `dof`, `lut` only in `optionalPost` of `desktop-ultra` and `desktop` (C13 1.1); flags `racing.ssr`, `racing.motionBlur` default off; governor drop order skid, sparks, SSR, motion blur.
- Audio (C.7): `content/audio/needs.json` racing rows; engine mixer inputs (rpm and load for the nearest four M1 cars), tire, impact, nitro, shift, race UI and scanner cues; authored or CC0 placeholders with provenance; music slots silent until commissioned (Q-11).
- Econ-sim racing section: racing purse incomes and garage sinks in `config/econ-bands.json`, run by `check:balance -- --suite econ`.
- Intros: `RaceSource.intro?: boolean` (compiled into `RaceDef`), true for the ten ladder showdowns plus `sf.sprint.ferry-ocean-beach` and `sf.pursuit.bayview-escape`; `content/races/cutscenes.json` with 12 `CutsceneRef`s (`hook 'race.intro'`, template `race.intro@1`, stage `race.<raceId>@<ver>`, cast = rival drivers or empty, fallback `dir.race.intro.<raceId>`); DirectorScripts with `tracking` and `orbit` shots on the grid; intros play on standalone starts and are skippable; the validator gains rule `INTRO` (every intro ref exists and names an existing fallback); `assets:cutscene-index -- --count race`.
- Device checklist `tools/ci/checklists/M07b2-iphone15.json`.

## Scope out
- Generating any racing clip (stays in-engine in v1, §D9.1; no fal spend).
- Perf scenarios and governor calibration of SSR and motion blur on devices: M11a1–M11a2. XR photo and driving rules: M11b2.
- Leaderboards and ghost sharing: M12e. Vehicle-mod envelope hook: M13a7.

## Deliverables
- `packages/modes/racing/src/garage/{garage-vm.ts, upgrades.ts, livery.ts, repair.ts}`; `src/replay/{director.ts, scrub.ts}`; `src/photo/{photo-controller.ts, save.ts}`; `src/client/{paint.ts, dent.ts, wheel-blur.ts, vfx-tiers.ts, audio-mixer.ts}`; `src/cutscene/intros.ts`.
- `packages/shared/src/racing/race-def.ts` (`intro?`), schemas updated; `tools/map/src/race/validate.ts` (rule `INTRO`) and fixture `INTRO.source.json`; `tools/ci/pi-lock.ts` and `content/vehicles/pi.lock.json`.
- `tools/assets/cutscene-index` option `--count <family>` (used here as `--count race`, and by M08b2 as `--count fighter`).
- `content/races/cutscenes.json`; `content/races/<id>/source.json` and `race.json` for the 12 intro events; `content/prompts/genai/race.intro@1.md` (M05b2 leaves race templates to this milestone); `content/cutscenes/places.json` rows for the 12 grids.
- `content/audio/needs.json` racing rows and placeholder audio with provenance; `config/econ-bands.json` racing section; `config/platform-flags.json` keys `racing.ssr`, `racing.motionBlur`; `config/racing.json` `tierCaps`, `photo`.
- `packages/modes/racing/test/{garage.spec.ts, replay.scrub.spec.ts, replay.director.spec.ts, visuals.spec.ts, intros.spec.ts}`.
- `tests/e2e/racing-photo.spec.ts` (`@racing-photo`); a race-intro case in the `@cutscene` suite.
- `tools/ci/checklists/M07b2-iphone15.json`.

## Interfaces
- C09 1.0 `CutsceneRef` with `hook 'race.intro'` and id grammar `cut.race.intro.<raceId>` exactly as S03 defines; `CutscenePlayer.play` with fallback; C13 1.1 `PostNode` values in `optionalPost` only; C05 1.1 garage elements as `VehicleInstance`; C16 1.1 `racing.photo`, `racing.replay_view`, `cutscene.play` (`path`, `trigger`; DL-193). `RaceSource.intro` is an S06-owned field. No contract change.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0 and no GLSL appears — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given a class-A car with 1,000,000 cents in the purse When engine level 2 and tires level 3 are bought, a livery with plate `BAY 10` is rejected and `BAY10` accepted, and a 40 % damaged car is repaired Then torque is × 1.08, μ × 1.09, prices are 4 % and 7 % of base, a repeated purchase key charges once, repair costs 8 % × 0.4 of base, and every car's fully upgraded PI in `pi.lock.json` stays in its band — proof: `pnpm --filter @dv/mode-racing test -- garage && pnpm --filter @dv/shared test`
- AC-3 Given a recorded 9,000-tick race When the viewer seeks to tick 4,500 and plays on Then the state hash at 4,500 and the final `endHash` equal a linear playback, and the test log states which seek path ran — proof: `pnpm --filter @dv/mode-racing test -- replay.scrub`
- AC-4 Given the same replay and seed When the director plans shots twice Then both shot lists are identical, every shot passes the S03 LOS check, and `racing.replay_view {mode:'exact'}` is emitted — proof: `pnpm --filter @dv/mode-racing test -- replay.director`
- AC-5 Given a standalone race in Chromium When photo mode opens, the camera is pushed 50 m away, FOV is set to 10° and the shutter is pressed with HUD hidden Then the sim tick stops advancing, the camera stays within 30 m, FOV clamps to 18°, a PNG blob of the canvas size is produced, and `racing.photo` carries no props — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @racing-photo`
- AC-6 Given `config/racing.json` and the platform flags When the visuals test runs Then `tierCaps` equal C.10, `motionblur`/`ssr`/`dof`/`lut` appear only in `optionalPost` of `desktop-ultra` and `desktop`, both racing flags default off, and per-car render objects are ≤ 6/4/2 for hi/mid/lo — proof: `pnpm --filter @dv/mode-racing test -- visuals && pnpm check:assets`
- AC-7 Given the econ bands When the econ suite runs Then the racing section is within band and its out-of-band self-test fixture fails — proof: `pnpm check:balance -- --suite econ`
- AC-8 Given the 12 intro events When validate and the index builder run Then each intro ref resolves to a `CutsceneRef` with an existing DirectorScript, the `INTRO.source.json` fixture fails with rule `INTRO`, the race template passes prompt lint, and the race count is 12 — proof: `pnpm map:races validate && pnpm check:unit -- tools/map && pnpm assets:cutscene-index -- --count race`
- AC-9 Given race-intro status `absent` When a standalone intro event starts in Chromium Then the DirectorScript fallback starts within 2.5 s with subtitles, a skip input jumps to the grid, the countdown follows, and `cutscene.play` has `path:'fallback'`, `trigger:'not_ready'` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @cutscene`
- AC-10 Given an iPhone 15 Home Screen app at `mobile-low` When the operator runs the checklist (5-minute landscape sprint, one photo save, tilt steering opt-in) Then `perf:verify` passes the frame and memory rows, and the run records U-RAC-5 and records U-RAC-7 in `notes.json` — proof: manual: iPhone 15 Home Screen app, `pnpm perf:checklist -- tools/ci/checklists/M07b2-iphone15.json`, play the listed steps, upload `docs/device-runs/M07b2/iphone15/{perf.json,notes.json}`, then `pnpm perf:verify -- docs/device-runs/M07b2/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M07b2-iphone15.json`
- AC-11 Given the branch When the IP gates, the unit suite and the preview deploy run Then all pass — proof: `pnpm provenance:check && pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `racing/garage`, `racing/replay.scrub`, `racing/replay.director`, `racing/visuals`, `racing/intros`; `shared/vehicle.envelope` with PI lock; `tools/map/race.validate` (`INTRO`).
- **Bot runs:** `check:balance -- --suite econ`.
- **E2E:** `@racing-photo`, `@cutscene` (race intro case); earlier racing suites stay green.
- **Device:** `M07b2-iphone15` via `perf:checklist` and `perf:verify` (Q-13 device).

## Demo script
1. `pnpm dev`, `/?unlockAll=1`, Garage: buy engine level 2 for the Sorrel; the stat bars update.
2. Start the Ferry → Ocean Beach sprint: the in-engine intro orbits the grid with subtitles; skip it.
3. Finish, open the replay, scrub to the middle: the director cuts between chase, side and heli shots.
4. Start again, pause into photo mode, set FOV 30°, exposure +1, a LUT, take a photo.
5. Open `/?unlockAll=1&tier=desktop-ultra`, enable `racing.ssr`: wet-road reflections appear.

## Effort
1 Builder session; about 39 files (generated `race.json`, audio placeholders and `pi.lock.json` excluded); risk **medium**. The TSL paint, dent and blur nodes and the scrub path are the main time sinks.

## Risks & fallbacks
- **Snapshot round trip not bit-exact** (U-RAC-4): seek re-simulates from the start; AC-3 holds on either path.
- **PNG save on iPhone** (U-RAC-5) and **tilt permission in a Home Screen app** (U-RAC-7): defaults are the press-and-hold full-screen image and hidden tilt unless a permission request succeeds; the device run only records them.
- **SSR and motion blur cost** (U-RAC-6): flags stay off; M11a calibrates.
- **Session overrun:** drop VR-3 and VR-8 to the next racing-adjacent milestone and record it; keep garage, replay, photo and intros.

## Notes for the Builder
- Read first: `06-racing.md` §2.11–§2.12; `06-racing-data.md` §4.2, §4.4; `06-racing-content.md` C.4, C.7, C.10; `03-story-cutscenes.md` §D2–§D4, §D6, §D9.1; `13-qa.md` §3.9.
- Order: garage and PI lock → replay director and scrub → photo → intros and validator → econ section → visuals → audio → e2e → device checklist.
- Facts: F-007, F-008, F-011 (spec/03 §6).
- Materials are TSL only; no `ShaderMaterial` or `onBeforeCompile` (lint).
- Never call fal or request generation: `FAL_MODE=mock`; racing intros are not on any prewarm list in v1.
- Secrets: none besides the CI deploy pair. Owner gate: Q-13 (device) for AC-10 only.

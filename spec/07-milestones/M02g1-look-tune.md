# M02g1 — look-tune

## Goal
The first frames stop looking grey and floating, with no new asset or fal spend (look study fix session A, DL-OWN-07):
- per-weather grade and aerial haze; Karl fog no longer replaces the sky;
- blob shadows on every flat tier; desktop cascades for near cars, the player and trees;
- an analytic sky reflection without an environment map (all WebKit);
- a fitted chase camera, few lit windows at dawn, realistic asphalt.

m.a1.01 keeps its dawn intro and releases the clock at the `truck` stage, so the fog burns off into morning sun on the first drive. Step 0 is a `webkit-webgl2` golden of that stage (the owner-representative check). Every layer is gated per look profile; `legacy` (XR) adds 0.

## Requirements
- R-MAP-01: grounded objects, reflections and real asphalt read as a city.
- R-MAP-04: hour and weather drive grade, haze and windows; the burn-off.
- R-PLAT-03: TSL only, WebGPU and WebGL2, no environment map needed.
- R-PLAT-04: the chase camera fits each vehicle and its heading.
- R-PLAT-05 (s): `mobile-low` keeps its iPhone 15 budget.
- R-ENG-02: a render-object ledger per profile; `check:perf` green.

## Depends on
- **M02e:** `look.json`, profiles, `PostStack`, `createTonemap` (`packages/engine/src/platform/post/nodes.ts:74-76`, bloom `:35`), the blob stub (`look/shadows.ts:7`), the look bridge, `@look-golden`.
- **M02f2:** shares `world-view.ts`, `world-bridge.ts`, `boot-world.ts`.
- **M01c:** `RendererHost` (`PCFShadowMap`, `renderer-host.ts:4`), `RenderBudgetMeter`, probe `live()` (`platform/probe.ts:69`), `check:perf`, `perf:verify`.
- **M05c2:** m.a1.01, `?play=story&story=1`, `@story-start`, `mission.jump`.
- **The look study** (capture frames, render audit, art-source study) committed to the repository before this session starts (`_PLAN.md` §0 rule 10).
- Contracts: C13 1.2, C04 1.1, C06 1.1, C08 1.0, unchanged; C09 1.1 (06 v1.5, DL-741), which this session lands.

## Scope in
- **Step 0 (first commit):**
  - shots `a1-truck` (stage start, `karl-fog`) and `a1-burnoff` (60 s later, `clear`) in `config/world/look-shots.json`, chase pose behind the tow truck at the synth Yard;
  - the operator copies the owner's boot record (DL-725) into `docs/look/M02g1-owner.json` (default `safari`, `desktop`);
  - capture "before" `webkit-webgl2` frames at the owner tier and `mobile-low`, plus the render-object baseline; a `mobile` or `mobile-low` owner tier is checked first everywhere.
- **Grade** (`look/grade.ts`, new): lift/gamma/gain, saturation and a warm-sun/cool-shade split tone, per weather preset in `look.json`, blended with the weather blend. No LUT and no new `PostNode`.
  - In `tonemap` when the stack has a target (`grade(renderOutput(color))`, uniforms via `PostStack.setGrade`); on a tonemap-only list (`mobile-low`) in the fog nodes (`sky/fog.ts:33`, `:50`); exactly once.
  - `NeutralToneMapping` stays (`11-platform.md` §5.1); `docs/look/M02g1-aces-ab.png` is an informational ACES A/B; AgX is rejected.
- **Haze** in both fog nodes: sun in-scatter on `uSunDir`/`uSunColor` (`sky/nodes.ts:20-21`), exponential extinction, Rayleigh tint on clear days.
- **`look.json`** (data †):
  - `sky.keyframeWeight` `karl-fog` 1.0 → 0.35, `overcast` 1.0 → 0.6;
  - `bloom` moves from `POST_TUNING` into the file, with the threshold 1.05 → 1.4;
  - `Asphalt` and road classes: linear albedo 0.12-0.18 (`local` `#4a4c51` ≈ 0.07 today);
  - `windows.litFrac` `[hour, min, max]` rows replace the fixed 55-85 % (`facade.ts:121`), through a pure `look/windows.ts`;
  - `layers`: the layer ids each profile enables (`legacy: []`).
- **Shadows:**
  - `look/blob-shadows.ts`: the C13 `blob` mode as one instanced radial quad per car, ped and player on every flat tier, sized from archetype half-extents, fed by the pose loops: +1 object, 0 `shadowPasses`.
  - Desktop tiers add the player, the traffic mesh and trees within `dynamicCasterRadiusM` (70 †) as casters, with `PCFSoftShadowMap`; `mobile` is unchanged.
- **`skyReflect(R)`** (`look/sky-reflect.ts`): sky gradient plus sun lobe, times Fresnel, wherever no environment map exists (`full` on Safari, `lite`, `min`): glass, water (`water.ts:61-63`), traffic paint, and the player vehicle via a new `vehicle-view.ts` `setReflectHook`.
- **Chase camera:**
  - the offset comes from the chassis half-extents of the vehicle's physics body, never its attachment nodes, instead of `VEHICLE_FAR_M = 11` (`sim/camera/collision.ts:43`): distance ≈ 1.6 × length + 1.5 m †, roof-height anchor, and the horizon 35-40 % from the top. Detmath only (C02);
  - own attachments crossing the camera ray (the tow boom) fade, render-only; no FOV or XR change;
  - teleport and respawn set `camYaw` to the player's yaw (`client/camera/rig.ts:30`);
- **First drive (DL-OWN-07 (2)):**
  - **Checked first:** the dawn clip's key carries the weather indirectly: slots `dawn`/`fog` (`content/story/act1/cutscene-refs.ts:18-23`) feed `beatDigest` (`packages/modes/story/src/cutscene/beat.ts:25`), whose revision is in the key's `stage`. The ref is untouched, so nothing is re-keyed under M05c3.
  - `content/missions/m.a1.01/mission.ts:34`: the `to_gate` lock keeps `karl-fog`, hour 6 → 6.5 † (range 6-7, still dawn).
  - `truck` `onEnter` adds `clock({ unlock: true, lock: { weather: 'clear' } })`.
  - `vm/runtime.ts:1208-1212`: `unlock` plus `lock.weather` without `hour` runs `unlock`, then `forceWeather(weather, defaultBlendGameMinutes × 60)` (16 s real); other combinations are unchanged.
  - Resume and retry (check first how a restore brings the clock back today; m.a1.08, m.a1.10 and m.a1.11 also lock the clock in a stage `onEnter`): if the fog could return, restoring a checkpoint re-applies, in order, the `clock` ops of the `onEnter` lists of the stages before the checkpoint stage (`vm/checkpoint.ts` restore path; the `MissionCheckpointV1` bytes and hashes are unchanged), so a save resumed at `tow_home` (the checkpoint stage) or a checkpoint retry there comes back released and `clear`, never fogged; a fail-retry to `'start'` re-runs `to_gate` and its dawn lock. BD row; any other mission whose resume changes is named in the report with its `check:missions` result.
  - `version` → 2, then `missions:build`; stages unchanged.
- **Bridge (QA):** `look()` adds `layers`, `blobs`, `dynamicCasters` and `skyReflect`; `setLookLayer(id, on)`.
- **Ledger:** `docs/look/M02g1-render-ledger.json` `{commit, bakeId, tiers: {<tier>: {baseline, after, perLayer}}, xr}`, written with `DV_LOOK_WRITE=1`, else checked. Plan: blob +1 per flat tier, desktop casters ≈ +3 per casting object, other layers 0, `legacy` 0.

## Scope out
- Vertex AO, mesher defects, shimmer, `classify.ts`: M02g2. Markings to façades: M02h1-M02h7. `xr` profile, TRAA: M02h8.
- Sourced or fal art: M10d0 onward. HUD icons: DL-738. Speed FOV: deferred.

## Deliverables
- Engine: `packages/engine/src/platform/post/{nodes.ts, stack.ts}`, `platform/renderer-host.ts`, `sim/camera/collision.ts`, `client/camera/rig.ts`, `client/vehicle/vehicle-view.ts`; tests `packages/engine/test/platform/post-grade.spec.ts`, `packages/engine/test/camera-chase.spec.ts`.
- World: new `packages/world/src/client/look/{grade.ts, sky-reflect.ts, blob-shadows.ts, windows.ts}`; edits `look/{config.ts, shadows.ts, facade.ts, water.ts, look-view.ts}`, `sky/fog.ts`, `traffic/instances.ts`, `peds/instances.ts`, `chunks/chunk-renderer.ts`, `world-bridge.ts`; tests `packages/world/test/{look.tune.spec.ts, look.blob.spec.ts, look.windows.spec.ts}`.
- Story: `content/missions/m.a1.01/mission.ts`, `packages/modes/story/src/vm/{runtime.ts, checkpoint.ts}`, `packages/shared/src/contracts/c09-mission.ts` (`C09_VERSION`), `packages/modes/story/test/clock-burnoff.spec.ts`.
- E2E: `tests/e2e/{look-tune.spec.ts, story-burnoff.spec.ts, cam-chase.spec.ts, world-look.spec.ts}`.
- Data (not counted): `look.json` and schema, `look-shots.json`, `mission.m.a1.01` with provenance, goldens, `docs/look/M02g1-*`, `tools/ci/checklists/M02g1-iphone15.json`, BD rows. No new script or dependency.

## Interfaces
- C13 1.2 `blob`, C04 1.1 `FollowParams.offset` values, C06 1.1 `unlock`/`forceWeather`, C08 1.0: no shape change; `LookFile`, `setGrade` and bridge fields are internal.
- C09 1.1 (DL-741): `clock` with `unlock` plus `lock.weather` and no `hour` means release, then blend (`03-story-missions.md` §C3); before, it unlocked and re-locked, and no mission on `claude/build` used it. This session writes `C09_VERSION = '1.1.0'` in `packages/shared/src/contracts/c09-mission.ts`; no IR, schema or cutscene key changes.
- Contract change proposals: none beyond C09 1.1, which the Architect has made.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint (C02), unit tests and build run Then all exit 0 with no GLSL — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `look.json` When the config, grade and window tests run Then:
  - it validates;
  - `karl-fog` is 0.35 ± 0.05, `overcast` 0.6 ± 0.05, and the bloom threshold is ≥ 1.3;
  - every preset has a grade;
  - asphalt and the road classes are linear 0.12-0.18;
  - `windowLitFraction` is ≤ 0.3 at 06:30, 0.55-0.85 at 22:00, smooth (≤ 0.05 per game minute);
  - the grade applies once per path; `legacy` has no layers.
  - — proof: `pnpm check:unit -- packages/engine packages/world`
- AC-3 Given a synth QA build When `@look-tune` opens `?tier=desktop`, `mobile` and `mobile-low` in both browsers Then:
  - `look()` lists the profile's layers;
  - `blobs` is > 0 while traffic is resident;
  - `dynamicCasters` names the player, traffic and trees on desktop and nothing on `mobile`;
  - `skyReflect` is true wherever `envMap` is false;
  - `setLook(false)` reports `layers: []`.
  - — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-tune && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-tune`
- AC-4 Given the committed ledger When `@look-ledger` toggles each layer Then:
  - `baseline` equals the count with every layer off;
  - `mobile-low` `after` is ≤ 100 and ≤ baseline + 1;
  - the `@xr @world-look` case on `xr-quest3` reports `after` = `baseline`.
  - — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-5 Given the same build When every perf scenario runs in fail mode Then every flat tier is within budget — proof: `DV_WORLD=synth pnpm check:perf -- --fail`
- AC-6 Given the Step 0 frames When `@look-owner` captures `a1-truck` and `a1-burnoff` at the owner tier and `mobile-low` on `webkit-webgl2` Then:
  - each is within the M02e golden tolerance;
  - two captures are byte-identical;
  - the mean before/after difference per shot is ≥ 0.04;
  - `docs/look/M02g1-before-after-webkit.png` matches its JSON SHA-256.
  - — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-7 Given the pickup and a sedan When the camera tests and `@cam-chase` run Then:
  - distance and height follow the bounds rule;
  - no unfaded part is between the camera and the anchor;
  - the horizon is 35-40 % from the top;
  - after `teleport({x, z, yaw: 90})` the camera yaw is within 5° of the player's;
  - state hashes are unchanged.
  - — proof: `pnpm check:unit -- packages/engine && pnpm --filter @dv/engine test:determinism && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @cam-chase`
- AC-8 Given m.a1.01 v2 When the VM test and `@story-burnoff` (`?play=story&story=1`, `mission.jump(1)`) run Then:
  - the clock is unlocked at the `truck` start;
  - within 1,800 game s, `env().weather` is `clear` with the blend done, and the hour is ≥ 06:30 with the sun on;
  - every other `clock` combination is unchanged;
  - a save resumed at `tow_home` and a checkpoint retry at `tow_home` report the clock unlocked and `env().weather` `clear` within one blend; a fail-retry to `'start'` reports the `karl-fog` lock at 06:30 again;
  - `@story-start` passes.
  - — proof: `pnpm check:unit -- packages/modes/story && pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@story-burnoff|@story-start"`
- AC-9 Given the sources When the compiled output is checked Then:
  - `missions:build` writes nothing;
  - `beats.lock.json` and the `cut.story.m.a1.01.dawn` key `5d520f3942ed02af1f2ac3541e256008f213ab84495b45ae620bff7b9833bb3d` are unchanged (M05c3 spends nothing).
  - — proof: `pnpm missions:build -- --check && pnpm check:unit -- packages/modes/story`
- AC-10 Given the same build When the earlier suites run Then `@world-look`, `@world-sky`, `@look-golden` (regenerated under `golden-update`) and the XR smoke pass — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-look|@world-sky|@look-golden" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-11 Given the branch When the asset and IP gates run Then they pass with provenance for the mission and no new texture, model or licence — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings`
- AC-12 Given the production build When verified and deployed to a Preview Then `__dvBridge` is absent and headers pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-13 Given the `sf` bake When m.a1.01 runs its seeds Then it passes in band with matching hashes and refreshed goldens — proof: manual: operator workstation, `pnpm map:build -- --area sf`, then `DV_REQUIRE_BAKE=1 pnpm check:missions -- --mission m.a1.01`
- AC-14 Given a synth Preview on an iPhone 15 Home Screen app at `mobile-low` When the checklist runs `walk-civic-center` and `a1-burnoff` Then `perf:verify` passes and `notes.json` records the layers on/off delta — proof: manual: iPhone 15 (Home Screen app), `pnpm perf:checklist -- tools/ci/checklists/M02g1-iphone15.json`, upload to `docs/device-runs/M02g1/iphone15/`, then `pnpm perf:verify -- docs/device-runs/M02g1/iphone15/perf.json --tier mobile-low`

## Test plan
- **Unit:** the six specs in Deliverables.
- **E2E:** every new tag runs in the `DV_WORLD=synth` half; none matches `GRAYBOX_GREP` (`@story-burnoff` misses `@story( |$)`). `@look-tune` on Chromium and WebKit, `@look-owner` on `webkit-webgl2` only, the rest on `chromium-webgl2`; `xr-quest3` runs the `@xr @world-look` case.
- **Perf and device:** AC-5, AC-14.

## Demo script
How to see it:
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`; in Safari open `/?play=story&story=1&debug=1&tier=desktop`. The dawn intro plays.
2. Enter the tow truck: the fog thins over ≈ 16 s, low sun breaks through, the boom stays out of frame.
3. Blob shadows sit under cars and pedestrians; glass catches the sky.
4. Add `&tier=mobile-low` (same grade and haze); in Chrome add `&gl=1`; toggle layers in the debug panel.

## Effort
1 Builder session; ≈ 34 code files; risk medium-high (grade parity across paths, the `mobile-low` budget, WebKit goldens). Order: Step 0, data and grade, haze, shadows and ledger, `skyReflect`, windows, camera, m.a1.01, goldens.

## Risks & fallbacks
- **`mobile-low` baseline already at 100:** turn the blob off there through `layers` (data). Never raise a budget.
- **C09 1.1 is withdrawn by the Architect:** `to_stall` `onEnter` runs `clock({ lock: { weather: 'clear' } })` then `clock({ unlock: true })` behind the chase-camera cut. The burn-off becomes a cut, and the report says so.
- **WebKit golden flaky:** `@look-owner` moves to nightly; the PR suite asserts bridge state (DL row).
- **`@world-sky` gates fail:** tune grade data; gate changes go to the Architect.

## Notes for the Builder
- **M05c3 is not a dependency (DL-742).** It was held on an owner gate until DL-OWN-08 gave it a Workers Free path (DL-745, DL-747); it stays out of Depends on. The `cut.story.m.a1.01.dawn` key and `beats.lock.json` that AC-9 holds unchanged are already on `claude/build` (M05b2, M05c2). Whichever of this milestone and M05c3 merges second re-runs AC-9 at its rebase. M05c4 (the off-edge finish split from M05c3, DL-750) is not a dependency either; a live Act 1 run through it keeps these keys and re-keys nothing.
- Read `11-platform.md` §4.4, §5.1, `01-engine-save-modes.md` (clock), `03-story-missions.md` §C3, `03-story-cutscenes.md` §D3.4, M02e, and the study's render audit (items 0, 2, 3, 5, 9).
- Verify `PCFSoftShadowMap` in `three@0.186.1` (spec/03 §7). The target image is never committed; since DL-OWN-10 the owner's look references may be used as look inputs (a fal reference input, a side-by-side comparison, a palette), read from outside the repository. Clock: 30 game s per real s.
- Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (AC-12, AC-14; SKIP locally); AC-13 needs the `sf` bake, AC-14 Q-13. Branch `m02g1-look-tune`.

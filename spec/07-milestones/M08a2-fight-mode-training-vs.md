# M08a2 — fight-mode-training-vs

## Goal
After this session Culture Wars is a playable mode and the **VS-Fighter** checkpoint (`_PLAN.md` §3) is met. `FighterMode` runs the M08a1 core inside the sim loop, mirrors it to ECS (`FightDigest` feeds the engine state hash), drives a fixed side camera, and presents two gray-box fighters (`PLAYER_FIGHTER` and `RAP_NEW_WAVE`) with frame-locked clips on the gray-box stage `powell_turntable`. Players fight with the Classic or Simple scheme on keyboard, pad or touch, train in Training mode with a frame meter and hitbox overlay, and face a CPU at the FC10 levels. The fighter slice persists, the tile becomes `available`, and story mission `m.a1.05` starts `bout.a5` through its hook, which emits `unlock.fighter` once. Golden replays give equal hashes in Node, Chromium and WebKit.

## Requirements
- R-MODE-03: rounds, meters, specials and supers become playable with frame data shown in Training; Classic and Simple schemes on all flat devices.
- R-MODE-05: the first story fight unlocks the standalone tile once; the slice persists unlocks and settings.
- R-ENG-04: every fighter action is remappable, the HUD never relies on colour alone, and reduced motion removes shake and dolly.
- R-ENG-02 (support): the `fight-stage` scenario counts and the `step` cost budget are automated checks.

## Depends on
- **M08a1** (fight core, reference kit, `fighter:lint`, `fighter:replay`, `fighter.script`), **M04a2** (`ModeHost`, `ModeContext`, unlock registry, `test:modes`), **M04b2** (HUD kit, `UiSurface` skeleton, touch layouts and editor), **M04d** (`CanonicalRunner`, `BotDriver` registry, det suites, mutant harness), **M05c1** (mission `m.a1.05` with its stub hook and the `CombatApi` stub).
- Contracts: C01 1.0 (ids 1280–1283), C02 1.1, C03 1.1 (`fighterScheme`, fighter aliases), C04 1.1 (`CameraDirective`, `AnimStateId` 160–207), C05 1.1 (`mode:fighter`, `autoBlockStoryFights`), C06 1.1 (`GameModeDescriptor`, `UiBridge`), C07 1.1, C09 1.0 (`ModeHook`), C13 1.1 (`PerfScenario` `fight-stage`), C16 1.1.

## Scope in
- `FighterMode` (`07-fighter.md` §3): descriptor per FX8.1 (`status: 'available'`, `tile.order 3`, `simProfile: 'any'`, `world: 'stage'`, `physics: false`), `enter` (validate `FrameDataPack.hash`, load assets, hold `Load` until ready), `tick` in `SimStage.Script` (inputs → `FighterInput`, CPU for unattended slots, `step`, mirror, camera, events), `exit` with `ModeResult` (FX8.4) and `ctx.save.request('modeExit')`.
- ECS mirror: `FighterView` 1280, `FightDigest` 1281 (hashed every tick), `ProjectileView` 1282, `StageProp` 1283; `StableKey` `npc:<fighterId>` and `player:0`.
- Camera (FC8.4): side view, auto-zoom from the stage's integer coefficients, super dolly-in 20 frames; reduced motion: no shake, no dolly, fades.
- Presenter: procedural capsule-and-box fighters (`origin: authored`), `FrameLockedClipPlayer` (clip time = `FighterView.frame / 60`) over procedural keyframe clips per move on the `bay_rig_v1` mannequin; generic graph for non-move states; `AnimStateId` 160–207 constants (ADR-0016).
- Second kit `content/fighter/kits/rap_new_wave.json` (FX3 note: normals ±1–2 frames, Pulse Marker, Step Dash, Detonate) and the `trap` projectile behaviour in `packages/shared/src/fight/projectiles.ts`; both fighters are kit-bound placeholders with `original` likeness until the M08b1 roster loader.
- Schemes: `config/input/defaults.{kbm,pad,touch}.fighter-{classic,simple}.json`, `config/input/labels.fighter.json`, touch layout `config/input/touch/fighter-simple.json` (stick, L, H, Special, Assist, Hype, Dash); Classic hidden on phones; second pad as `frame(1)` for local Versus; `leniencyX100` 150 on 30 fps render tiers.
- Screens via `UiSurface` (FX9): mode hub (Versus, Training, Controls), character and stage select for the two gray-box fighters, pause with the move list per scheme, results; HUD view-model with health and round pips, timer, Hype diamonds, Composure squares with the hatched Rattled state, combo counter with scaling %, optional input display.
- Training (FC11): box overlay, frame meter with derived advantage, input display with buffer age, record/playback dummy, dummy states, reset, meter refill, damage and scaling readout, invulnerability display.
- CPU (FC10): perception ring delayed by `reaction`, decisions every 4–8 frames on even ticks, macro executor with execution error, punish rule (`advBlock ≤ −4` with a move of `startup ≤ −advBlock`), the four-level parameter table; driver `fighter.cpu`.
- Stage `powell_turntable` gray-box (`prop/stage-powell_turntable-day`) with `StageDef`.
- `FighterSlice` schema 1 and golden; `unlock.fighter` grants (initial selectable set: `PLAYER_FIGHTER` and the `bout.a5` opponent) on M04a2's row, keeping M05c1's `unlock.fighter.rap_new_wave`; `BoutDef` `content/fighter/bouts/bout.a5.json` (player vs `RAP_NEW_WAVE`, `powell_turntable`, CPU Normal, `exhibition: true`).
- QA bridge `__dvBridge.fighter` (`start`, `step`, `setInputs`, `state`, `hash`, `exportReplay`, `reloadTuning`).
- Registration of `fighter.script` and `fighter.cpu` through a QA-only `registerBot` import (`fighter.cpu` also plays slot 0 under `hooks: 'bot'`); det suite `@fighter-hash`; mutants; `fighter:bench`; `fight-stage` scenario path.

## Scope out
- Kits 3–8, full CPU habits, roster loader with tiers, `fighter:balance`, `check:fighter`: M08b1. Stages 2–6, cutscene hooks, Cinematic presentation, Arcade, Move Gallery, kill-switch remap: M08b2. Pose: M08c1–M08c2. XR: M11b2.
- Open-world `CombatApi` over the shared core (listed under M08a2 in `07-fighter.md` §8 but not in the `_PLAN` row): stays the M05c1 stub; reported to the Architect.

## Deliverables
- `packages/modes/fighter/src/{index.ts, anim-states.ts}`; `src/sim/{mode.ts, match.ts, mirror.ts, camera.ts, slice.ts, bouts.ts, cpu/{perception.ts, decide.ts, macro.ts, levels.ts}}`; `src/ui/{index.ts, hud.ts, training.ts, presenter.ts, graybox.ts}`; `src/qa/{bridge.ts, cpu-driver.ts}`.
- `packages/shared/src/fight/projectiles.ts` (`trap`); `content/fighter/kits/rap_new_wave.json`; `content/fighter/stages/powell_turntable.json`; `content/fighter/bouts/bout.a5.json`; gray-box assets and provenance.
- Config files listed in Scope in; `unlock.fighter` grants.
- `packages/modes/fighter/package.json` script **`fighter:bench`**; `packages/modes/fighter/scripts/bench.ts`.
- `packages/modes/fighter/test/{schemes.spec.ts, cpu.spec.ts, camera.spec.ts, slice.spec.ts, descriptor.spec.ts}`; `tests/golden/saves/fighter/slice.v1.json`.
- `tests/e2e/{fighter-hash.spec.ts (@fighter-hash), fighter-touch.spec.ts (@fighter-touch), fighter-training.spec.ts (@fighter-training)}`; `@fighter-hash` entries in `tests/e2e/det/suites.ts`; `tools/ci/mutants/fighter/{frame-off-by-one,rng-swap}.ts`.
- `tests/perf/paths/fight-stage.json` (scripted CPU-vs-CPU round for the `fight-stage` scenario).

## Interfaces
- Implements C06 1.1 descriptor, `GameModeSim`, `GameModeUI`; C04 1.1 `CameraDirective {mode:'cinematic', shot:{kind:'side'}}` and the 160–207 block; C03 1.1 `ControlsSettings.fighterScheme` and the fighter alias table; C05 1.1 `mode:fighter`; C09 1.0 hook `defId 'bout.a5'`, `params {kind:'story'}` (DL-157). No contract change.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0 — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given golden `vs-001.dvfight` When the bridge replays it in Chromium and in WebKit Then every checkpoint hash equals the Node golden and `FightDigest` changes the engine `stateHash` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @fighter-hash && pnpm check:e2e -- --project=webkit-webgl2 --grep @fighter-hash`
- AC-3 Given 10,000 steps of a CPU-versus-CPU match in Node When the bench runs Then `step` p99 ≤ 0.10 ms and snapshot plus restore ≤ 0.1 ms — proof: `pnpm --filter @dv/mode-fighter fighter:bench`
- AC-4 Given Training against a standing dummy in Chromium When 5L is performed on hit and then on block Then the frame meter reads startup 4, active 2, recovery 8, +4 on hit and +1 on block, the box overlay shows hit and hurt capsules, and a recorded dummy sequence plays back identically — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @fighter-training`
- AC-5 Given WebKit at 844 × 390 with touch and the Simple scheme When a best-of-3 with 10-second rounds is played against CPU Easy using the on-screen buttons Then at least one Special hit lands and the match reaches `MatchEnd` with a `ModeResult` — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @fighter-touch`
- AC-6 Given scheme fixtures When inputs are mapped Then Simple specials deal 80 %, `AS` runs the kit's auto-combo, `L+H` throws a grounded opponent in range and Checks otherwise, `HY` spends 3,000 when available else 2,000, every binding file validates, and a second pad drives slot 1 — proof: `pnpm --filter @dv/mode-fighter test -- schemes`
- AC-7 Given 50 seeded blocked Uplifts (−25) per level When the CPU decides Then Hard punishes at least 90 % and Easy fewer, decisions occur only on even ticks, and the CPU never reads raw opponent buttons — proof: `pnpm --filter @dv/mode-fighter test -- cpu`
- AC-8 Given mission `m.a1.05` with hooks on `bot` When the autoplayer runs three seeds twice Then each passes with equal end hashes, `unlock.fighter` is recorded exactly once, a win increments `core.stats.fightsWon`, and the stub path still passes — proof: `pnpm check:missions -- --mission m.a1.05`
- AC-9 Given the slice golden and the registry When the tests run Then `slice.v1.json` round-trips, a standalone session writes only `core`, `settings` and `mode:fighter`, and the descriptor is `available` with `simProfile: 'any'` — proof: `pnpm --filter @dv/mode-fighter test -- slice descriptor && pnpm --filter @dv/engine test:modes`
- AC-10 Given reduced motion on When a super starts Then the camera directive has no dolly or shake; with it off the dolly lasts 20 frames, and distance follows the stage clamp — proof: `pnpm --filter @dv/mode-fighter test -- camera`
- AC-11 Given mutants `frame-off-by-one` and `rng-swap` When the harness applies them Then `@fighter-hash` and `fighter:replay` fail for each — proof: `pnpm check:unit -- tools/ci`
- AC-12 Given scenario `fight-stage` When it runs on `chromium-webgl2` at each flat tier Then render objects and triangles stay within the tier budget — proof: `pnpm check:perf -- --scenario fight-stage --fail`
- AC-13 Given the branch When telemetry, the unit suite and the preview deploy run Then all pass — proof: `pnpm check:telemetry && pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `fighter/schemes`, `fighter/cpu`, `fighter/camera`, `fighter/slice`, `fighter/descriptor`; M08a1 suites stay green.
- **State hash:** `@fighter-hash` on both engines; nightly through `nightly.yml`.
- **E2E:** `@fighter-training` (Chromium), `@fighter-touch` (WebKit).
- **Bot runs:** `check:missions -- --mission m.a1.05`.
- **Perf:** `fighter:bench` (Node), `fight-stage` counts.

## Demo script
1. `pnpm dev`, `/?unlockAll=1`, main menu → Culture Wars → Versus.
2. Pick `PLAYER_FIGHTER` vs `RAP_NEW_WAVE` on Powell Turntable, CPU Hard; play with U I O / J K L.
3. Switch Controls → Simple; fight with J, K, L and `;`.
4. Training: enable the frame meter and box overlay; record a dummy sequence and play it back.
5. On an iPhone viewport, play with the touch buttons.
6. `pnpm check:missions -- --mission m.a1.05`: the story fight runs and unlocks the tile.

## Effort
1 Builder session; about 40 files (gray-box meshes and clip keyframes generated); risk **medium**. Presenter, Training overlays and touch input are the time sinks.

## Risks & fallbacks
- **Procedural clips look stiff:** acceptable in gray box; library clips arrive with M08b1 and art with M10a (Q-24).
- **Bench variance on CI runners:** run 3 × 10,000 steps and take the best p99; never weaken the per-tick no-allocation rule.
- **Session overrun:** keep hash, schemes, Training meter, touch, hook and slice; move the record/playback dummy and input-display polish to M08b1 and record it.

## Notes for the Builder
- Read first: `07-fighter.md` §2–§6; `07-fighter-core.md` FC3–FC8, FC10, FC11; `07-fighter-content.md` FX3, FX7–FX9; `13-qa.md` §3.1–§3.6.
- Facts: F-011 (iPhone touch limits, spec/03 §6).
- The buffer is the truth; presentation never feeds back into the sim (C02 rule 7).
- `simProfile: 'any'` lets the story embed the mode without a `SimHost.restart`.
- Secrets: none besides the CI deploy pair. No paid account.

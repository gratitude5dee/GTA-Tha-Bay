# M05a2 — autoplayer-director-preview

## Goal
After this session a mission can be proven by a bot and watched without playing it. The story autoplayer registers as `BotDriver` `story.autoplayer` in the M04d registry and drives the player through objectives; `pnpm check:missions` runs every mission in the release index (or one mission, or one act) × its three seeds twice under the `canonical` profile and fails on a missed pass, an out-of-band duration, a hash mismatch or a compiler error. The `TimelineRecorder` exports `.dvtl` timelines, and `pnpm missions:preview` plus a QA scrub page show a recorded run with chapters and subtitles. The in-engine director runs DirectorScripts, the auto-director vocabulary, line-of-sight alternates, the SF-hill rule, reduced-motion pacing and the XR fixed vantage as data; `defineDirector` authors scripts. This director is the fallback every cutscene uses (R-CUT-03).

## Requirements
- R-MODE-01: every mission is completable by a deterministic bot in CI within its `expectedSec` band.
- R-CUT-03: the in-engine DirectorScript path that replaces any generated clip.

## Depends on
- M05a1 (IR, compiler, VM, story mode, `m.dev.sample`), M04d (`CanonicalRunner`, `BotDriver` registry, golden store, det-suite registry, mutant harness).
- Contracts: C09 1.0 (`DirectorScript`, `DirectorShot`), C04 1.1 (`CameraDirective`, `ShotKind`, `XRRigParams.vantage`), C03 1.1 (`BotInput`), C06 1.1 (`TimelineRecorder`, `.external`), C02 1.1.

## Scope in
- Autoplayer (`packages/modes/story/src/autoplay/`): goal derivation and policies per `03-story-missions.md` §C9 table: A* on the C08 road graph (vehicle when distance > 150 m and a usable vehicle is within 60 m) or the ped graph, re-plan every 2.5 s; `follow` PD at the band middle; `chase` aims 1.5 s ahead; `escape`/`survive` toward the nearest `hidingSpots`/`pursuitBreakers` tag outside the search circle; `talk` uses `TalkDef.default`; `photo` goes to a vantage with LOS and presses `sim.Interact` in the `photo` context; `stealth` walks `autoplayPath`; `defeat` uses `CombatApi` when present (M05c1 adds the melee stub); `score` replays `config/autoplay/score.json`; `mode` uses the child mode's bot or the stub's policy. Seeded only from stream `bot`; reads only the observation surface; writes only player-0 `InputFrame`s. QA builds add `__dvBridge.mission.autoplay(on)` for live play (not an oracle).
- Scenario loader `missions` for `CanonicalRunner`: loads `data/mission.<id>` and the world whose bake id equals `mission.worldBake`, from `tests/fixtures/world/civic-graybox` or `dist/world/<bakeId>/` (the M02a1–M02a2 bake output); a missing bake fails with `world bake <id> not found: run pnpm map:build -- --area sf`.
- `pnpm check:missions [-- --mission <id> | --act <n>]` (`tools/ci/missions/check.ts`): compiles (`missions:build` in memory), runs each mission × 3 seeds × 2 runs with `flags {beats: 'instant', talk: 'scripted', hooks: 'bot' where the mode descriptor is available, else 'stub'}`, `maxTicks = expectedSec[1] × 60 × 1.5`; fails when a run does not pass, `elapsedSec` is outside `expectedSec`, the two runs of a seed differ in end hash, or any compiler error appears. Writes `test-results/missions/<id>.<seed>.{json,dvtl}` and a summary table.
- Mutants for suite `missions` (`tools/ci/mutants/missions/`): (1) the mission RNG seeded without `attempt`, (2) the mission clock counting beat ticks. Det tag: `m.dev.sample` seed 1 registered under `@determinism` in `tests/e2e/det/suites.ts` with its Node golden `tests/golden/missions/m.dev.sample.1.json`.
- CI: `ci.yml` `content` job runs `pnpm check:missions`; it restores `dist/world/` from `actions/cache` keyed on `hashFiles('config/world/**', 'tools/map/src/**', 'content/world/**')` and on a miss runs `pnpm map:build -- --area sf` before the missions step.
- Timeline: `TimelineRecorder` (C06; implement in `packages/engine/src/sim/script/timeline.ts` if M04a2 left a stub) records entity tracks every 2 ticks plus `mis.*` events and `external` async inputs; `export()` → `.dvtl` (versioned little-endian binary, documented in the package README); replaying recorded `external` inputs reproduces the run.
- Preview: `pnpm missions:preview -- --mission <id> --seed <n>` runs the headless autoplay at full speed and writes `test-results/preview/<id>.<seed>.dvtl` plus a chapter list (`mis.stage` events) on stdout; QA page `apps/web/qa/mission-preview.html?timeline=<file>` scrubs tracks with binary search (`lastBefore`), shows chapter markers and `mis.say` subtitles.
- Director (`packages/modes/story/src/director/`, sim system in `SimStage.Script`), per `03-story-cutscenes.md` §D6:
  - DirectorScript runner: `arm` places actors at start marks and publishes the first shot; timed `actions` drive VM NPC tasks; `cues` patch `hud.subtitle`; `finish(true)` places actors at end marks; RNG stream `cutscene:<scriptId>`;
  - shot presets compiled to C04 `ShotKind` (table in §D6.1);
  - auto-director vocabulary and durations (§D6.2) with a deterministic hash per `(seed, shot index)`;
  - validation: ≤ 8 rays per tick through `PhysicsQueries.castRay`; 6 alternates in order (mirror, pull-in high, top-down, front-left, front-right, overhead); cut after 0.8 s (48 ticks) of occlusion; clearance (flyby, heli, side ≥ 12 m; heli ≥ 29 m) demotes to chase or rearlow; hill rule on grades > 15 % replaces `rearlow` and `front` with `side`;
  - comfort: reduced motion keeps cuts ≥ 2 s apart, no shake, fades instead of whip pans; XR publishes `xrVantage` as C04 1.1 `vantage` with no cuts and 300 ms fades (presentation in M11b2);
  - `camera` op uses the auto-director; `beat` with a `director` ref now runs the full script (replacing M05a1's fixed shot).
- `defineDirector` (`src/authoring/director.ts`) and compilation of `content/missions/<id>/director/*.ts` to `data/director.<id>` (≤ 16 KiB) inside `missions:build`; `m.dev.sample` gains one DirectorScript beat.

## Scope out
- `cut.request`, `CutscenePlayer`, fallback triggers: M05b2. XR presentation of vantage and subtitle plane: M11b2.
- Act 1 missions and their DirectorScripts: M05c1–M05c2. `story-chase` perf scenario: M05c2.

## Deliverables
- `packages/modes/story/src/autoplay/{driver.ts, goals.ts, policies.ts}`, `src/director/{system.ts, runner.ts, auto.ts, validate.ts, presets.ts}`, `src/authoring/director.ts`, `src/scenario.ts`.
- `packages/modes/story/test/{autoplay.test.ts, director-los.test.ts, director-runner.test.ts, timeline.test.ts}`.
- `packages/engine/src/sim/script/timeline.ts` (only if missing), `config/autoplay/score.json`.
- `tools/ci/missions/{check.ts, preview.ts}`, root scripts `check:missions`, `missions:preview`; `tools/ci/mutants/missions/*.ts`.
- `tests/e2e/det/suites.ts` (story entry), `tests/golden/missions/m.dev.sample.1.json`, `apps/web/qa/mission-preview.html` + `apps/web/src/qa/mission-preview.ts`, `tests/e2e/mission-preview.spec.ts` (tag `@mission-preview`).
- `content/missions/m.dev.sample/director/intro.ts`; `.github/workflows/ci.yml` (`content` job steps).

## Interfaces
- C09 1.0 `DirectorScript`, `DirectorShot` as defined; C04 1.1 `CameraDirective` and `vantage`; C03 1.1 `BotInput`; C06 1.1 `TimelineRecorder.export/external`. No shape change. `story.autoplayer` implements the S13 `BotDriver` interface (M04d).

## Acceptance criteria
- AC-1 Given `m.dev.sample` in the gray-box fixture When `check:missions` runs it Then all 3 seeds pass twice, every `elapsedSec` is inside `expectedSec`, both runs per seed end with the same `stateHash`, and the summary and per-run JSON and `.dvtl` files exist under `test-results/missions/` — proof: `pnpm check:missions -- --mission m.dev.sample`
- AC-2 Given the `missions` mutant set When the mutant test runs Then each mutant makes `check:missions` on `m.dev.sample` fail and the unmodified suite passes — proof: `pnpm check:unit -- tools/ci`
- AC-3 Given a fixture whose `expectedSec` band ends 10 s before the bot's finish, and a fixture with a compiler error When `check:missions` runs on each through the test harness Then each exits non-zero with the mission id, seed and reason (`out_of_band`, `compile_error`) — proof: `pnpm check:unit -- tools/ci`
- AC-4 Given a static collider between camera and subject When a shot runs Then the director tries the six alternates in the stated order, cuts after exactly 48 occluded ticks when none clears, never casts more than 8 rays in one tick, replaces `rearlow` and `front` with `side` on a 16 % grade fixture, and demotes `heli` under 29 m clearance — proof: `pnpm check:unit -- packages/modes/story`
- AC-5 Given a DirectorScript with two actors, three shots and two cues When it is armed and run to the end twice with the same seed Then actors start at their start marks, the first shot is published on the arming tick, cue text reaches `hud.subtitle` at its `startMs`, actors end at their end marks, the shot sequence is identical across runs, and the `mission:<id>` RNG state is unchanged by the script — proof: `pnpm check:unit -- packages/modes/story`
- AC-6 Given reduced motion on, and separately the XR camera mode When the auto-director runs 60 s Then cuts are ≥ 2 s apart with fades only; in XR no cut occurs, the published directive carries `vantage` from `xrVantage`, and transitions are 300 ms fades — proof: `pnpm check:unit -- packages/modes/story`
- AC-7 Given a recorded run of `m.dev.sample` seed 1 with a scripted talk result When the `.dvtl` is replayed with its `external` inputs Then the replay's end hash equals the recording's, and `lastBefore` returns the recorded pose at 10 random ticks — proof: `pnpm check:unit -- packages/modes/story`
- AC-8 Given the preview command When it runs for `m.dev.sample` seed 1 Then it writes the `.dvtl`, prints one chapter per stage, and the QA scrub page loads it and shows the chapter markers and a `mis.say` subtitle at its tick — proof: `pnpm missions:preview -- --mission m.dev.sample --seed 1 && pnpm check:e2e -- --project=chromium-webgl2 --grep @mission-preview`
- AC-9 Given the story det entry When `@determinism` runs Then the browser trace of `m.dev.sample` seed 1 equals the Node golden in Chromium and WebKit — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @determinism && pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism`
- AC-10 Given `.github/workflows/ci.yml` When the workflow test runs Then the `content` job restores or builds the world bake before `pnpm check:missions` — proof: `pnpm check:unit -- tools/ci`
- AC-11 Given the branch When the production build, bundle check and preview deploy run Then the autoplayer and preview page are absent from production chunks and the app deploys — proof: `pnpm build && pnpm check:bundle && pnpm deploy:preview`

## Test plan
- Unit: `story/autoplay`, `story/director-los`, `story/director-runner`, `story/timeline`; `tools/ci/mutants`, `tools/ci/missions` harness, `tools/ci/workflows`. `pnpm check:unit -- packages/modes/story tools/ci`.
- Bot run: `pnpm check:missions -- --mission m.dev.sample` (oracle `bot-run`).
- State hash: `@determinism` story entry on both WebGL2 projects.
- E2E: `@mission-preview` on `chromium-webgl2`.

## Demo script
1. `pnpm check:missions -- --mission m.dev.sample`: a table of 6 runs with seconds and hashes.
2. `pnpm missions:preview -- --mission m.dev.sample --seed 1`; open the printed QA page URL; drag the scrubber across the chapters.
3. `pnpm dev`, `/?mission=m.dev.sample&seed=1`, then `__dvBridge.mission.autoplay(true)` in the console: the bot plays the sample live; the intro beat runs the DirectorScript.
4. Toggle reduced motion in Settings and watch the auto-director pace its cuts.

## Effort
1 session; ≈ 32 files; risk medium (autoplayer robustness on the gray-box block; bake time in CI).

## Risks & fallbacks
- A full SF bake does not fit the CI job time: the `content` job runs `check:missions` for missions on the gray-box fixture, and the nightly workflow runs `pnpm check:missions` on the full bake (add the step there); the local proofs of later milestones state "Given a local SF bake". Record the measured bake time.
- Live bot play in the browser (`__dvBridge.mission.autoplay(true)`, QA only; no new URL flag) diverges from Node because of `local` profile physics: the det entry always runs under `canonical`; the live demo is not an oracle.
- Autoplayer stalls on an objective: the run stops at `maxTicks` with outcome `timeout`, the last checkpoint and the stuck objective id, so the failure names its cause.

## Notes for the Builder
- Read first: `03-story-missions.md` §C9–§C10; `03-story-cutscenes.md` §D2 (`DirectorScript`) and §D6; `13-qa.md` §3.1–§3.6; `01-engine-contracts.md` C04 and its 1.1 section.
- Order: scenario loader → autoplayer → `check:missions` → mutants and det entry → CI step → timeline export → preview → director runner → auto-director and validation → comfort → `defineDirector` and the sample beat.
- The autoplayer must act only through `BotInput`; never set positions or objective state directly (the oracle would be vacuous).
- Director and autoplayer code under the C02 lint glob chosen in M05a1. No secrets. Branch `m05a2-autoplayer-director-preview`.

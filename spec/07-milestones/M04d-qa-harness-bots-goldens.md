# M04d — qa-harness-bots-goldens

## Goal
After this session every mode has one way to prove it is deterministic and correct. `packages/engine/src/qa` holds the `CanonicalRunner` (one `RunSpec` → one `StateHashTrace` in Node and in the browser determinism page), the `BotDriver` registry with the first driver `lines` (replays M03a1's `*.line.json`), the golden store with its update guard, and the cross-browser det-suite registry. `tools/ci/mutants` proves suites are not vacuous, `tools/ci/verifiers.lock.json` stops a PR from changing a verifier and its subject together without the `golden-update` label, and `tools/ci/econ-sim` (owner S01, wave5 gap 11) runs the economy bands behind `pnpm check:balance -- --suite econ`. Mode owners register their own drivers later (story M05a2, racing M07a1, fighter M08a1–a2, tycoon M09a2).

## Requirements
- R-ENG-01: deterministic, scriptable verification commands for agents and CI (no GUI step).
- R-ENG-02: the runner and det suites are the oracle for the canonical profile on which budgets and replays rest.
- R-MODE-01: the economy harness bounds mission and shop money from the first content section (Act 1 in M05c1).

## Depends on
- M04a2 (`ModeHost`, `ModeContext`, `EconomyApi` wallet), M03a1 (vehicles, lines recorder, `walk-drive.line.json`), M00d (C15 lint, trace report, `nightly.yml` det suites, `tools/ci/test/`). Through them: M01a1–M01a2 (headless host, Rapier, determinism page `@determinism`).
- Contracts: C02 1.1 (profiles, `stateHash`), C03 1.1 (`BotInput`, `DeviceKind 'bot'`), C06 1.1 (`EconomyApi`).

## Scope in
- `packages/engine/src/qa/runner.ts`: `RunSpec`, `StateHashTrace`, `CanonicalRunner` exactly as `13-qa.md` §3.1. It boots `createHeadlessSim` with Rapier under `profile: 'canonical'`, loads the scenario through a registered `ScenarioLoader` (`suite` → loader), steps with the bot's `BotInput.frame(tick)` written as player-0 `InputFrame`s, records FNV-1a-64 `stateHash` every `checkpointEvery` ticks and at the end, stops at `maxTicks` (failure with the last checkpoint). `build` = the git short sha or `local`.
- `packages/engine/src/qa/bots.ts`: `BotDriver`, `BotContext` as §3.2; `registerBot`, `getBot` (duplicate id throws; unknown id lists registered ids). Driver `lines` (`qa/drivers/lines.ts`): reads `{v:1, scenario, seed, frames}`, emits the recorded quantized frames, `done()` after the last frame with outcome `end`.
- Scenario loader `engine` for the gray-box fixture world (M01f) so `walk-drive.line.json` runs headless; other M03a1 lines join when their world fixture loads headless.
- Golden store `packages/engine/src/qa/golden.ts`: `tests/golden/<suite>/<name>.json` in `canonicalize` form; `DV_UPDATE_GOLDEN=1` rewrites only goldens under the paths of the current run; when `CI` is set and `DV_UPDATE_GOLDEN` is set the runner throws before running.
- Browser: the M01a2 determinism page accepts `?run=<base64url RunSpec>`, runs it in `sim.worker` and publishes the trace on `__dvBridge.engine.qa.trace`; `tests/e2e/det/suites.ts` lists each det tag (`@determinism`, `@racing-det`, `@fighter-hash`, `@world-hash`, `@tycoon-det`) with its `RunSpec`s and Node golden, or `pending: <milestone>`; `tests/e2e/det/det-suites.spec.ts` runs every listed spec for its tag and compares with the golden (this milestone fills `@determinism` with the `lines` specs).
- Mutants `tools/ci/mutants/<suite>/*.ts`: module overrides applied by `tools/ci/test/mutants.test.ts` through `vi.mock`. Suite `engine-lines`: (1) the `bot` RNG stream swapped for `world`, (2) one tick skipped in the runner loop. Suite `econ`: (1) a mission reward off by one cent, (2) the weekly dividend cap removed. Each must make its suite fail; a mutant that passes fails the test ("vacuous suite").
- Verifier lock `tools/ci/verifiers-lock.ts` and `tools/ci/verifiers.lock.json`, built on M00d's `golden-guard` (same changed-path source `git diff --name-only origin/$GITHUB_BASE_REF...HEAD` and labels from `DV_PR_LABELS`): the lock stores SHA-256 per verifier script and golden directory (runner, drivers, det spec, econ-sim, `tests/golden/**`, M01a1's package goldens, the save-migration goldens `packages/engine/src/sim/save/__golden__/**` of M04a1 and M09a1, and the world goldens `packages/world/test/golden/**`) and a map verifier → subject paths; `verify(changedPaths, labels, reason)` fails when a verifier or golden and its subject changed together without `golden-update` or without a non-empty reason (`DV_PR_REASON`, the PR body line), and when a hash differs without a lock refresh; `--write` refreshes hashes. Run by `tools/ci/test/verifiers-lock.test.ts` (fixtures always, live check when `GITHUB_BASE_REF` is set).
- `tools/ci/econ-sim/`: Monte-Carlo over a ledger model of C06 `EconomyApi` semantics (integer cents, idempotent keys). Inputs are sections (`sections/<id>.ts`: income table, sink table, policies `saver`, `spender`, `median`), N = 1,000 seeded runs per policy (seed stream `econ:<section>`). Bands in `config/econ-bands.json` (cents; per section: exact totals and percentile bands). Built-in self-test runs first: `fixtures/out-of-band.json` must be rejected or the command exits 1. Section `base` ships now: the tycoon-dividend counter capped at $10,000 per game week (DL-134) and an empty-ledger check; content sections arrive with content (Act 1 in M05c1, racing in M07b2, Acts 2–3 in M05e2 and M05f2).
- Root script `check:balance [-- --suite econ|tycoon]` (`tsx tools/ci/run.ts`; no `--suite` = all; `tycoon` prints `pending: lands in M09a2`). CI `content` job adds `pnpm check:balance`; the `unit` job adds `DV_PR_REASON` beside M00d's `DV_PR_LABELS`.
- `check:bundle` gains a forbidden-identifier scan: production chunks (`pnpm build` without `VITE_DV_QA`) contain no `CanonicalRunner`, `BotDriver` or `registerBot`.

## Scope out
- Mode drivers and their mutants: `story.autoplayer` (M05a2), `racing.line` (M07a1), `fighter.cpu`/`fighter.script` (M08a2; DL-236), `tycoon.<policy>` (M09a2).
- Tycoon bands B1–B12 and `tycoon:sim`: M09a2. Room load bots: M12c2. C15 lint and trace: M00d (done).

## Deliverables
- `packages/engine/src/qa/{index.ts, runner.ts, bots.ts, golden.ts, scenarios.ts, drivers/lines.ts}`, `packages/engine/test/qa/{runner.test.ts, bots.test.ts, golden.test.ts}`.
- `tests/golden/engine/walk-drive.json`; `tests/e2e/det/{suites.ts, det-suites.spec.ts}`; determinism page `?run=` support in `apps/web/qa/`.
- `tools/ci/mutants/{engine-lines,econ}/*.ts`, `tools/ci/test/{mutants.test.ts, verifiers-lock.test.ts, det-suites.test.ts}`, `tools/ci/test/workflows.test.ts` (M00d's, extended), `tools/ci/verifiers-lock.ts`, `tools/ci/verifiers.lock.json`; `tools/ci/golden-guard.ts` and `tools/ci/test/golden-guard.test.ts` (M00d's, extended: the pattern `**/__golden__/**` joins `**/golden/**` and `**/*.golden.json`, so C05 rule 5 save goldens need `golden-update`, with a fixture case on `packages/engine/src/sim/save/__golden__/core/v1.json`; DL-659).
- `tools/ci/econ-sim/{index.ts, model.ts, policies.ts, bands.ts, sections/base.ts, fixtures/out-of-band.json}`, `tools/ci/test/econ-sim.test.ts`, `config/econ-bands.json`, `tools/ci/schemas/econ-bands.schema.json`.
- `.github/workflows/ci.yml` (`content` += `pnpm check:balance`; `unit` += verifier-lock check), root `package.json` (`check:balance`), `tools/ci/check-dist.ts` (bundle identifier scan).
- `packages/engine/README.md` section "QA harness" (RunSpec, drivers, golden update procedure).

## Interfaces
- C02 1.1 and C03 1.1 consumed as defined (`BotInput` with `device: 'bot'`, QA builds and Node only). C06 1.1 `EconomyApi` semantics mirrored by the econ model; no shape change.
- New internal surfaces (S13): `RunSpec`, `StateHashTrace`, `CanonicalRunner`, `BotDriver`, `BotContext`, `ScenarioLoader`, econ section format. These are not contracts; mode owners implement them.

## Acceptance criteria
- AC-1 Given the `lines` driver and `walk-drive.line.json` on the gray-box fixture When the same `RunSpec` (seed 0xC0FFEE, checkpoint every 600 ticks) runs twice in Node Then both traces are byte-identical in canonical JSON and equal `tests/golden/engine/walk-drive.json` — proof: `pnpm check:unit -- packages/engine/test/qa`
- AC-2 Given `CI=true` and `DV_UPDATE_GOLDEN=1` in the test's environment When the runner starts Then it throws before stepping; with `CI` unset and `DV_UPDATE_GOLDEN=1` it rewrites only goldens under the run's path and leaves `tests/golden/` elsewhere untouched — proof: `pnpm check:unit -- packages/engine/test/qa`
- AC-3 Given the registry When a second driver with id `lines` registers, or a `RunSpec` names `nope` Then the first throws and the second fails with a message listing `lines`; a spec whose bot never finishes stops at `maxTicks` with outcome `timeout` and its last checkpoint — proof: `pnpm check:unit -- packages/engine/test/qa`
- AC-4 Given the QA build When `@determinism` runs the `lines` specs in the determinism page Then the Chromium and WebKit traces equal the Node goldens checkpoint by checkpoint — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism && pnpm check:e2e -- --project=chromium-webgl2 --grep @determinism`
- AC-5 Given `tests/e2e/det/suites.ts` and the nightly grep string in `.github/workflows/nightly.yml` When the det-suite test runs Then every tag in the grep string is listed, each listed `RunSpec` names a registered driver or is marked `pending: <milestone>`, and the `content` job runs `pnpm check:balance` — proof: `pnpm check:unit -- tools/ci`
- AC-6 Given the mutant sets `engine-lines` and `econ` When `mutants.test.ts` applies each mutant Then every suite fails under each of its mutants and passes without them; a fixture mutant that leaves its suite green makes the test fail with "vacuous suite" — proof: `pnpm check:unit -- tools/ci`
- AC-7 Given a changed-path fixture listing `packages/engine/src/qa/drivers/lines.ts` and `tests/golden/engine/walk-drive.json` When `verify` runs without labels, then with `golden-update` and an empty reason, then with the label and a reason Then it fails, fails, and passes; `golden-guard` fails a change to `packages/engine/src/sim/save/__golden__/core/v1.json` without `golden-update` and passes it with the label; and `verifiers.lock.json` matches the repository hashes — proof: `pnpm check:unit -- tools/ci`
- AC-8 Given `config/econ-bands.json` and section `base` When the economy suite runs Then it prints `self-test: out-of-band fixture rejected`, every band passes, a simulated week of dividends above $10,000 is credited as exactly 1,000,000 cents, and the command exits 0; `pnpm check:balance` without `--suite` additionally prints `tycoon: pending: lands in M09a2` — proof: `pnpm check:balance -- --suite econ && pnpm check:balance`
- AC-9 Given a production build When the bundle check runs Then no chunk contains `CanonicalRunner`, `BotDriver` or `registerBot`, while the QA build does — proof: `pnpm build && pnpm check:bundle`
- AC-10 Given the branch When lint, typecheck and the preview deploy run Then all pass and the app is unchanged outside QA pages — proof: `pnpm lint && pnpm typecheck && pnpm deploy:preview`

## Test plan
- Unit: `engine/qa.runner`, `engine/qa.bots`, `engine/qa.golden` (`pnpm check:unit -- packages/engine/test/qa`); `tools/ci/mutants`, `tools/ci/verifiers-lock`, `tools/ci/det-suites`, `tools/ci/workflows`, `tools/ci/econ-sim` (`pnpm check:unit -- tools/ci`).
- Bot run: `pnpm check:balance -- --suite econ` (oracle `bot-run`).
- State hash: `@determinism` on `webkit-webgl2` and `chromium-webgl2`; nightly runs every registered tag in both engines.
- Static: `pnpm check:bundle`.

## Demo script
1. `pnpm check:unit -- packages/engine/test/qa`: prints the `walk-drive` end hash.
2. Edit one frame in a copy of `walk-drive.line.json`, run it through the runner: the trace differs at the first checkpoint after the edit.
3. `pnpm check:balance -- --suite econ`: self-test line, then the `base` section bands.
4. `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism`: green, Node = WebKit.

## Effort
1 session; ≈ 38 files (two edited `golden-guard` files, DL-659); risk medium (Rapier canonical build parity inside the page worker, mutant override mechanics under Vitest).

## Risks & fallbacks
- `vi.mock` cannot override a module the runner imports dynamically: mutants export a `patch(runnerDeps)` function instead and the runner takes an injectable `deps` object in tests only. Same AC-6 command.
- The determinism page cannot accept a long `RunSpec` in the URL: post it through `__dvBridge.engine.qa.run(spec)` after load; the e2e command is unchanged.
- M03a1's lines are absent or renamed: record new lines with the M03a1 recorder on the gray-box block (walk 50 m, enter the default vehicle, drive one block) and commit them with their goldens through the update procedure.
- The changed-path list is empty on `push` to `main`: the lock check then only verifies hashes (no pair rule) and says so in the job summary.

## Notes for the Builder
- Read first: `13-qa.md` §2.3–§2.4, §3.1–§3.6, §3.9, §5, §9; `01-engine-contracts.md` C02 and C03 1.1 sections; `spec/08-test-and-ci.md` §2, §5.1, §5.5.
- Order: runner and golden → bots and `lines` → Node goldens → page `?run=` and det suites → mutants → verifier lock → econ-sim → CI wiring → bundle scan.
- Econ-sim is CI tooling (Node), outside the C02 lint scope, but it must still be seeded and reproducible: the same seed gives the same percentile table; print the seed.
- Never run CI with `DV_UPDATE_GOLDEN` set; golden updates go through a PR labelled `golden-update` with a one-line reason in the body.
- No secrets. Branch `m04d-qa-harness-bots-goldens`.

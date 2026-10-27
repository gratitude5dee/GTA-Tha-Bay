# M05c3 — act1-prewarm

## Goal
`pnpm assets:gen prewarm` exists and Act 1 ships fallback-only, fully playable, with a plan that cannot overspend. It reads the release's private `cutscene-requests.json`, walks group G1 (the 9 Act 1 refs, `03-story-cutscenes.md` §D9.1), applies the provider and sheet gates, checks the cache, computes each key's estimate and stops before the running estimate passes this milestone's line of **$16** (DN-S13-02, DL-209). Without `--live` it prints the dry-run plan. `--live` refuses on Workers Free until M05c4 lands the off-edge finish: the Worker has no transcoder, so a live job would pay fal and then fail (DL-OWN-08, DL-750). The production Worker build switches C2PA re-signing on, and a production run refuses if it is off. A mock pipeline scenario proves single flight. The release cutscene index records every Act 1 ref as in-engine (R-CUT-03). Every AC runs on Workers Free, with no provider, key or paid feature.

## Requirements
- R-CUT-01: the prewarm path picks only a `cleared` provider, and plans each deterministic key at most once (ready and pending keys are skipped). The live run and its AI-generated labelling are finished by M05c4.
- R-ENG-03: every planned call follows a cache check (HEAD, then catalog). The spend is estimated before any run and capped at the M05c3 line inside the USD 100 fal programme (DL-OWN-01).
- R-CUT-03 (support): every Act 1 ref without a clip keeps its DirectorScript fallback, and the index and the release note say so.

## Depends on
- **M05c2** (act1-vertical-slice): Act 1 refs, plates, `cutscene-requests.json` and index for the release tag.
- **M05d** (data-spine-supabase): `cutscene_catalog` sync, `genai_ledger` export, `budget_program` fal row.
- Earlier, through those: M05b1 (`GenJobWorkflow`, `MockFalPort`, `MockTranscodePort`, route 28, `check:pipeline`, `check:c2pa`, pinned C2PA tool) and M05b2 (`cutsceneKey`, `assets:cutscene-index`).
- Contracts: C09 1.0 (`CutsceneRequest`, `CutsceneIndex`, `CutsceneManifest`), C07 1.1 (registry `videoProviders`, `GenJob`), C12 1.1 (routes 27–28, `CutsceneStatus`). No internal pipeline port changes here (M05c4 adds `JobSinkPort.handoff()`).

## Scope in
- `assets:gen` CLI entry with the `prewarm` subcommand. Every other subcommand (`plan`, `run`, `gate`) prints `pending: lands in M10a1` and exits 0.
- `prewarm --release <tag> [--priority 1] [--cap-micros <n>] [--live] [--env staging|prod] [--report]`, plus test inputs `--requests <file>`, `--registry <file>`, `--sheets <file>` and `--offline` (no HEAD; every key counts as a miss; refuses `--live`):
  1. Load `cutscene-requests.json` for the tag (PRIVATE artifact from M05c2) and keep the G1 refs in index order.
  2. **Provider gate:** pick the provider by the C07 registry rule (`05-assets.md` §4.5). If none has `status: cleared`, print `blocked: no cleared provider (ADR-GENAI-01)`, make 0 network calls, and exit 0.
  3. **C2PA guard:** `--env prod --live` refuses when the `prod` Worker build (`services/edge/wrangler.jsonc` top-level `vars`) has `C2PA_RESIGN` off or unset. It reads the file only, before any network call.
  4. **`--live` on Workers Free:** after gates 2 and 3, print `blocked: no transcoder on Workers Free; lands in M05c4`, make 0 network calls, and exit 0. On `main` the live pipeline has no transcoder (`UnavailableTranscode` in `services/pipeline/src/env.ts`), so a live job would settle fal spend and fail at `transcode`. M05c4 replaces this step with submission and hand-off.
  5. **Sheet gate:** a recipe-K ref whose characters lack approved sheet crops (PRIVATE `sheets/<slug>/` lock entries) is `skip: sheet_missing`, estimate $0.
  6. **Cache check:** HEAD `cutscenes/<key>/manifest.json` on the target media host. A ready key is `skip: ready`. On a miss, a key that route 27 reports `pending` is `skip: pending` at $0.
  7. **Estimate** per ref, by the §D9.1 formula: shots × seconds × provider $/s × 1.5, plus shots × 1.5 × 39,600 micros for recipe-K keyframes. Accumulate, and stop before the running total would pass `--cap-micros` (default 16,000,000). The rest is `skip: over_line`.
  8. Print the plan table (ref, key prefix, status, estimate, running total) and the headroom left in the programme (`budget_program.cap` − `ledger.sumUsdMicros('fal')`; omitted with `--offline`).
  9. `--report` writes `docs/releases/<tag>/cutscenes.md` from the plan and the rebuilt index: every ref, its status, and whether it plays a clip or its DirectorScript.
- Production pipeline config: var `C2PA_RESIGN` in `services/edge/wrangler.jsonc`, `"1"` in production (step `resign`, `05-assets-pipeline.md` §6 step 9) and `"0"` in staging and previews.
- **Fallback-only index:** `assets:cutscene-index` (M05b2) rebuilds the release index after a plan. With no ready key, every Act 1 ref resolves to its DirectorScript and `--report` lists all 9 as in-engine.
- A mock scenario `prewarm-act1` added to `check:pipeline` (Miniflare, `FAL_MODE=mock`, `MockFalPort` and `MockTranscodePort`: the in-Worker path M05b1 runs today, fixture clips 15–21 KB). The first run submits the planned keys through route 28 and writes each manifest last; the second makes 0 `FalPort` calls.
- `check:c2pa` fixture additions: a `prod` manifest with `provenance.resigned: false` fails.
- **Free-plan config guard** `tools/ci/test/wrangler-free.test.ts`: no environment declares `containers`, a `TRANSCODER` binding, `limits.cpu_ms`, `tail_consumers` or `logpush`; at most 40 `vars` per environment (room for secrets within Free's 64 variables per Worker, DL-749); `C2PA_RESIGN` as above.

## Scope out
- **M05c4 `offedge-finish` (DL-750):** live submission, the `handed_off` state in `CutsceneJobDO`, the Workflow hand-off step, `TRANSCODE_MODE` and its pairing with `FAL_MODE`, `prewarm --finish`, the Worker publish phase that re-runs the gate, `check:c2pa --verify-signatures` and the strict explicit `--index`, the `ffmpeg` pin, `ladder.sh` and `Dockerfile.ladder`, the private-bucket uploader operations, and the live Act 1 run (DL-745, DL-748).
- The `TRANSCODER` Container, its `TranscoderContainer` class and the `web-v3` migration tag: parked with `claude/release-do-lifecycle-3` until the owner upgrades to Workers Paid (DL-OWN-08).
- Fighter finishers and face-offs (G2, G3; the rest of the $38 line after Act 1, DL-740, DL-741): M10b. Acts 2–3 and racing intros stay in-engine in v1 (DL-173).
- Lean sheet crops for the Act 1 cast: M10a1/M10a2. Until then the G1 refs are `sheet_missing`. The live re-run after M10a2 is an operator step carried by M10b (DL-232).
- `assets:gen plan|run|gate` and roster automation: M10a1. Kill purge and prefix purge: M10b.

## Deliverables
- `tools/assets/gen/{cli.ts, prewarm.ts, estimate.ts, gates.ts, report.ts}`, `tools/assets/test/{prewarm.spec.ts, estimate.spec.ts}` and `tools/assets/test/fixtures/{registry-none.json, registry-cleared.json, act1-requests.json, sheets-lock.json}` (no cleared provider; `h3.partner` cleared; the 9 G1 refs; a sheet lock with two characters missing).
- `services/pipeline/test/prewarm-act1.test.ts` and its entry in `services/pipeline/scripts/check-pipeline.ts`.
- `services/edge/wrangler.jsonc`: the `C2PA_RESIGN` var only; no `containers` key, no `TRANSCODER` binding, no new Durable Object class or migration tag; `/boot` exposes nothing new.
- `tools/ci/check-c2pa.ts` and `tools/ci/test/check-c2pa.test.ts` with the `prod` `resigned: false` fixture under `tools/ci/fixtures/c2pa/`.
- `tools/ci/test/wrangler-free.test.ts`.
- `docs/releases/README.md` (how `--report` files are produced).
- Root script: **`assets:gen`** (`tools/ci/run.ts assets-gen`; root `package.json`).
- About 20 files.

## Interfaces
- C09 1.0 read only: `CutsceneRequest`, `CutsceneIndex`, `CutsceneManifest.provenance.resigned`.
- C07 1.1: registry `videoProviders`, the `assertCallable` gate.
- C12 1.1: route 27 read by the CLI (`CutsceneStatus.state`); route 28 called only by the Miniflare scenario; shapes unchanged.
- No contract change and no internal port change.

## Acceptance criteria
- AC-1 Given the 9-ref request fixture and a registry with no `cleared` provider When `prewarm --live` runs Then it prints `blocked: no cleared provider (ADR-GENAI-01)`, a fetch spy records 0 calls, and the exit code is 0 — proof: `pnpm check:unit -- tools/assets/test/prewarm.spec.ts`
- AC-2 Given `h3.partner` cleared, all sheets present and nothing ready When the plan is computed with the default cap Then every G1 estimate equals the §D9.1 formula to the micro, the running total stays ≤ 16,000,000, and any ref that would pass it is `over_line` — proof: `pnpm check:unit -- tools/assets/test/estimate.spec.ts`
- AC-3 Given two Act 1 characters without sheet crops, one key already ready and one key that route 27 reports `pending` When the plan is computed Then refs with a missing character are `sheet_missing` at $0, the ready key is `ready` at $0, the pending key is `pending` at $0, and only the rest are planned — proof: `pnpm check:unit -- tools/assets/test/prewarm.spec.ts`
- AC-4 Given the fixture registry with `h3.partner` cleared, the 9-ref fixture requests and no `--live` flag When `prewarm` runs offline Then it prints the plan table with a total ≤ 16,000,000 micros and exits 0 without any network call — proof: `pnpm assets:gen prewarm -- --release fixture-act1 --requests tools/assets/test/fixtures/act1-requests.json --registry tools/assets/test/fixtures/registry-cleared.json --offline`
- AC-5 Given the Miniflare pipeline with `FAL_MODE=mock` and `MockFalPort` When `prewarm-act1` runs twice Then the first run produces ready manifests (written last) for the planned keys, and the second run makes 0 `FalPort` calls and 0 route 28 submissions — proof: `pnpm check:pipeline`
- AC-6 Given a production-environment manifest fixture with `resigned: false`, and one without `aiGenerated` When `check:c2pa` runs Then both fail, and the mock-prewarm outputs pass — proof: `pnpm check:c2pa`
- AC-7 Given a request for the `prod` env and a Worker build fixture with `C2PA_RESIGN` off When `prewarm --env prod --live` runs Then it refuses with the C2PA message before any network call and before the transcoder refusal — proof: `pnpm check:unit -- tools/assets/test/prewarm.spec.ts`
- AC-8 Given the release index after a plan with no ready key When the game plays Act 1 Then every Act 1 ref resolves to its in-engine DirectorScript, and the cutscene e2e is green — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @cutscene`
- AC-9 Given `h3.partner` cleared, all sheets present and `C2PA_RESIGN` on When `prewarm --live` runs for `staging` and for `prod` Then each prints `blocked: no transcoder on Workers Free; lands in M05c4`, a fetch spy records 0 calls, and the exit code is 0 — proof: `pnpm check:unit -- tools/assets/test/prewarm.spec.ts`
- AC-10 Given the branch When the Worker configuration and migrations are checked Then no environment declares `containers`, `TRANSCODER`, `limits.cpu_ms`, `tail_consumers` or `logpush`, no environment has more than 40 `vars`, `C2PA_RESIGN` is `"1"` in production and `"0"` in staging and previews, and no Durable Object class or migration tag is added — proof: `pnpm check:unit -- tools/ci/test/wrangler-free.test.ts && pnpm check:do-migrations`

## Test plan
- **Unit:** `tools/assets/prewarm` (provider gate, C2PA guard, the `--live` refusal, sheet gate, ready and pending skips), `tools/assets/estimate` (formula vectors per provider price row) — `pnpm check:unit -- tools/assets`.
- **Pipeline (Miniflare):** `prewarm-act1` — `pnpm check:pipeline`. **Config:** `wrangler-free.test.ts`, `pnpm check:do-migrations`.
- **Gate:** `pnpm check:c2pa`.
- **E2E:** `@cutscene` on `chromium-webgl2` (fallback path for every Act 1 ref).

## Demo script
1. Run the AC-4 command: read the plan. Swap in `registry-none.json`: `blocked: no cleared provider`.
2. Drop `--offline`, add `--live`: `blocked: no transcoder on Workers Free; lands in M05c4`.
3. `pnpm check:pipeline`: the second `prewarm-act1` run shows 0 calls.
4. `pnpm check:c2pa`: the unsigned prod fixture fails, the mock outputs pass.
5. `pnpm check:e2e -- --project=chromium-webgl2 --grep @cutscene`: Act 1 refs fall back cleanly.

## Effort
0.5 Builder session; about 20 files; risk **low** (no money moves here; the CLI, estimate, gates, report and fixtures exist on `claude/build-m05c3` and are re-applied to current `main`).

## Risks & fallbacks
- **No cleared provider (default, Q-30):** the milestone is complete with a fallback-only Act 1, and `docs/releases/<tag>/cutscenes.md` lists all 9 refs as in-engine.
- **M05c4 not merged yet:** `--live` refuses (AC-9) and Act 1 stays fallback-only. Nothing is spent, because the CLI is the only prewarm entry and route 28 needs `OPS_TOKEN`.
- **Sheet crops absent (M10a not run yet):** G1 refs are `sheet_missing`. The live run after M10a2 uses the same cap minus what was already spent (`--cap-micros` = 16,000,000 − ledger delta).
- **H3-family US licence (U-AST-16) unresolved:** production refuses `pending` providers by registry rule; previs jobs never feed the release index.

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §6 and §11–§12; `03-story-cutscenes.md` §D5 and §D9–§D9.1; `spec/06-asset-pipeline.md` §12; `docs/decisions/ADR-GENAI-01-video-model-licence-gate.md`; `09-backend-ops.md` §1.4.
- **Workers Free (DL-OWN-08, DL-750):** start from current `main`, not from `claude/build-m05c3` (built on an older base without the `BUILDER` queue, `MODERATION_MODE` and the 03:40 cron). Reuse its CLI, estimate, gates, report, fixtures and `prewarm-act1` scenario. Leave its `services/pipeline/transcoder/` (`Dockerfile`, `server.ts`, `package.json`), its Container test and its live submission path out; M05c4 takes `ladder.sh` and the signer code. Do not merge `claude/release-do-lifecycle-3`.
- No AC needs a secret; the live gates (ADR-GENAI-01 `cleared`, `FAL_KEY`, `OPS_TOKEN`, prepaid balance) are M05c4's.
- CI never runs live fal (`FAL_MODE=mock`). The CLI has no code path that calls fal directly; it only calls our Worker.
- Do not change key inputs. The key is S03's `cutsceneKey` (C09); `endpoint@pinnedUpdatedAt` comes from the registry. Whichever of this milestone and M02g1 merges second re-runs M02g1 AC-9 at its rebase (DL-742).
- Branch `m05c3-act1-prewarm`.

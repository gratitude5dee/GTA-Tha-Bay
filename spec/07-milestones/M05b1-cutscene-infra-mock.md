# M05b1 — cutscene-infra-mock

## Goal
`tha-bay-web` gains `CutsceneJobDO` (one per cache key, ready test = `HEAD cutscenes/<key>/manifest.json`), S05's `FalGateDO` semaphore, a minimal `BudgetGovernorDO` holding the DL-OWN-01 program cap of 100,000,000 USD micros, the S05 `GenJobWorkflow` with every cutscene stage behind ports and `MockFalPort`, routes 27 (status), 28 (prewarm, `OPS_TOKEN`), 29 (ED25519-verified fal webhook) and the non-production `_test` routes (49), and the media and private R2 bindings. The `web-v1` Durable Object migration ships alone first. `pnpm check:pipeline` proves a mock job end to end and a zero-call second run; `pnpm check:c2pa` and a dry-run-first `pnpm assets:gen prewarm` exist; the app documents gain the Report-Only CSP. Live fal calls stay impossible until ADR-GENAI-01 is `cleared`.

## Requirements
- R-CUT-01: request through the backend, store in R2, reuse by key, generate at most once per key.
- R-ENG-03: cache check before any spend, program cap in integer micros, governor levels, paid runs need `--live` after a printed estimate.
- R-NPC-02 (support): the same workflow, ports and mock serve the M10a1 character pipeline.

## Depends on
- M00a (router, `ApiError`, isolation headers, geo-gate, `_test` routes, `check:workers`, `check:prod-routes`, `check:do-migrations`, `deploy:prod`), M00c (registry `config/genai-endpoints.json`, recorded spike results), M01d (C07 catalog, `assets:*`, R2 layout, bucket config).
- Contracts: C09 1.0 (`CutsceneManifest`; `c09-cutscene.ts` from M04c, earlier in run order, or created here verbatim if absent), C12 1.1 (routes 4, 27–29, 49; `CutsceneStatus`; `BudgetGovernor`, `SpendEvent`, `Vendor`, `GovLevel` in `packages/shared/src/api/budget.ts`), C07 1.1 (`GenJob`, `JobKeyInput`, `jobKey`, `GateCode`, provenance).

## Scope in
- **Lifecycle PR first** (label `do-lifecycle`, nothing else in it): class skeletons and exports for `CutsceneJobDO`, `FalGateDO`, `BudgetGovernorDO`; `wrangler.jsonc` `durable_objects.bindings` (`CUTSCENE_JOB`, `FAL_GATE`, `GOVERNOR`) and migration `{"tag": "web-v1", "new_sqlite_classes": ["CutsceneJobDO","FalGateDO","BudgetGovernorDO"]}`, repeated under `env.staging` and `previews`; deployed with `wrangler deploy`. The logic PR follows.
- `packages/shared/src/api/budget.ts` (C12, `09-backend-ops.md` §5.3 verbatim) and `CutsceneStatus` in `api/v1.ts` (extend). `packages/shared/src/genai/types.ts` (C07 §4.6) and `jobKey` if M00c did not create them.
- `services/edge/src/cutscenes/`:
  - `CutsceneJobDO` (`ensure(job, {allowGenerate})`, `complete`, `fail`): states `absent → pending → ready | failed` (`09-backend.md` §5.1); one Workflow instance per key (id `cutscene_shot-<jobKey[0:12]>-<attempt>`, `05-assets.md` §5.1), concurrent `ensure` calls share it; `failed` re-armed by alarm after 1 h, at most 3 re-arms;
  - route 27 `GET /api/v1/cutscenes/:key` → `CutsceneStatus`: `ready` with `manifestUrl = MEDIA_ORIGIN + /cutscenes/<key>/manifest.json`; generation allowed only when the key is in the catalog, `ks:cutscene_gen` and `ks:genai:all` are off and the governor level < 3; otherwise `absent` with `reason` (`not_in_catalog`, `kill_switched`, `budget`); a kill scope answers `blocked`;
  - route 28 `POST /api/v1/admin/cutscenes/prewarm {keys[]}` → 202; `Authorization: Bearer <OPS_TOKEN>`; geo-exempt (DL-184);
  - catalog until M05d: `services/edge/src/generated/cutscene-catalog.json` (keys only; M05b2's index builder writes it).
- `services/edge/src/budget/BudgetGovernorDO.ts`: `level`, `reserve`, `settle` (idempotent by `jobId`), `forceLevel`; `ingest` accepts batches (dialogue path M06a3); program cap read from `config/guardrails.yaml` `genai.programCapUsdMicros` (create the file with only the `genai:` section: `programCapUsdMicros: 100000000`, `falConcurrency: 2`, `alarms: [0.5, 0.8, 1.0]`; M14b1 adds the rest); alarms at 50/80/100 % recorded as log events; L3 at 100 %; publishes `gov:level` to KV on transitions.
- `services/pipeline` (`@dv/pipeline`, compiled into `tha-bay-web`): ports (`FalPort`, `BlobPort`, `RosterPort`, `BudgetPort`, `ClockPort`, `TranscodePort`, `SignPort`), steps for `cutscene_shot` in `05-assets-pipeline.md` §6 order (gate → cache-check → budget-reserve → acquire → keyframes → plan → submit → wait → poll → copy-orig → transcode → captions → qa-gate → resign → subs → publish (manifest last) → record), `GenJobWorkflow` (`step.waitForEvent('fal-done', 20 min)` then 12 polls from 30 s exponential), `FalGateDO` (slots = `falConcurrency`, release always runs), `verifyFalWebhook` (ED25519 against the fal JWKS, cache ≤ 24 h, ±300 s skew) and `handleFalWebhook` mounted as route 29 (2xx within 15 s, `instance.sendEvent`).
- Mock mode (`FAL_MODE=mock`, the default in dev, CI, preview and staging): `MockFalPort` replays fixtures under `services/pipeline/fixtures/` (the M04c fixture clips as outputs; if absent, a 2 s VP9 clip made the M04c way) and posts a webhook signed with a test key served at `/api/v1/_test/fal-jwks`; `MockTranscodePort` returns fixture renditions, poster, last frame; `MockSignPort` marks `resigned: true` with a test claim; captions use a fixture VTT. `GENAI_ENV` becomes `test`.
- Gate (`services/pipeline/src/gate.ts`): provider status from the registry; production and `FAL_MODE=live` require `cleared` (`ENDPOINT_NOT_CLEARED` otherwise, before any `FalPort` call); kill switches `ks:genai:all`, `ks:fal`, `ks:fal:<endpointId>`, `ks:cutscene_gen`; `toon-pbr` presets for non-consented cast; prompt-lint hook (the linter itself lands in M05b2; until then the step runs a stub that fails on an empty prompt).
- `_test` routes (non-production): `run-scheduled`, `drain-queue`, `spend`, `fal-jwks`. Route 4 `POST /api/v1/reports/browser` accepts `csp-violation` bodies → 204 (crash bodies M11a).
- Headers (DL-191): `apps/web/public/_headers` and `withIsolationHeaders` add `Content-Security-Policy-Report-Only` (spec/05 §1.3, with `<domain>` and the account id substituted at build), `Reporting-Endpoints`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; `check:headers` asserts them.
- `pnpm check:pipeline` (Miniflare, `MockFalPort`): one cutscene job end to end, then the same key again.
- `pnpm check:c2pa` (`tools/ci/check-c2pa.ts`): for every manifest named by the shipped cutscene index (none until M05b2), fails without `provenance.origSha256`, without `resigned: true` on a `cleared` licence, or without `aiGenerated: true`; prints `0 shipped cutscenes` when the index is absent.
- `pnpm assets:gen prewarm -- --requests <cutscene-requests.json> [--env staging|production] [--live]` (`tools/assets/gen/{cli.ts, prewarm.ts}`): computes `budgetUsdMicros = shots × durationS × providerUsdPerS × 1.5 + keyframes × 39,600` per request (§D5), prints the per-key and total estimate and, with `--env`, the misses found by `HEAD` (without `--env` every key counts as a miss and no request is made); without `--live` it makes no POST; with `--live` it needs `OPS_TOKEN` and the target URL (`SKIP assets:gen prewarm: OPS_TOKEN not set`, exit 0 when absent), refuses when estimate + settled spend exceeds the remaining cap, then POSTs route 28.
- CI: `ci.yml` `unit` runs `pnpm check:pipeline`; `ip` runs `pnpm check:c2pa`.

## Scope out
- Live fal calls (ADR-GENAI-01 `cleared`, `FAL_KEY`): first paid runs M05c3 (≤ $16), M10b (≤ $24).
- The real Transcoder Container (`services/pipeline/transcoder/`, `TRANSCODER`) and the pinned C2PA signer: needed before the first live run (gap reported).
- `KillPurgeWorkflow` and `KILL_WF`: M10b. Supabase ledger and `cutscene_catalog` table: M05d. Staff JWTs replace `OPS_TOKEN`: M12a1.
- Keys, index builder, player: M05b2.

## Deliverables
- `services/edge/src/cutscenes/{CutsceneJobDO.ts, routes.ts}`, `services/edge/src/budget/BudgetGovernorDO.ts`, `services/edge/src/routes/reports-browser.ts`, `services/edge/src/generated/cutscene-catalog.json`, `services/edge/wrangler.jsonc`.
- `services/pipeline/{package.json, tsconfig.json, README.md}`, `src/{workflow.ts, fal.ts, gate.ts, ports.ts}`, `src/steps/cutscene.ts`, `src/do/FalGateDO.ts`, `src/mock/{MockFalPort.ts, MockTranscodePort.ts, MockSignPort.ts}`, `fixtures/*`.
- `packages/shared/src/api/{budget.ts, v1.ts}`, `packages/shared/src/genai/types.ts` (if absent).
- `services/edge/test/{cutscene-singleflight, genjob-poll-fallback, budget-cache-first, cutscene-status, cutscene-prewarm, fal-webhook-verify, governor-levels, genai-gate, reports-browser}.test.ts`.
- `tools/ci/check-c2pa.ts`, `tools/ci/test/check-c2pa.test.ts`, `tools/assets/gen/{cli.ts, prewarm.ts}`, `tools/assets/test/prewarm.test.ts`, `config/guardrails.yaml`.
- Root scripts `check:pipeline`, `check:c2pa`, `assets:gen`; `.github/workflows/ci.yml`; `apps/web/public/_headers`; `tools/ci/check-dist.ts` (header list).

## Interfaces
- C12 1.1: routes 4, 27–29, 49 and `CutsceneStatus`, `BudgetGovernor`, `SpendEvent` as defined. C07 1.1: `GenJob`, `jobKey`, `GateCode`. C09 1.0: `CutsceneManifest` written last. No shape change.

## Acceptance criteria
- AC-1 Given a catalog key whose manifest exists When 10 concurrent `GET /api/v1/cutscenes/:key` and one prewarm arrive Then all return `ready` and `MockFalPort` records 0 submits; given an absent catalog key When 10 concurrent `ensure()` calls arrive Then exactly 1 Workflow instance and 1 submit occur — proof: `pnpm check:workers -- cutscene-singleflight`
- AC-2 Given the mock webhook is dropped When `waitForEvent` times out Then polling completes the job, the step log shows `manifest.json` written last, and the status is `ready` — proof: `pnpm check:workers -- genjob-poll-fallback`
- AC-3 Given governor level 3, or `ks:cutscene_gen` set When a cached and an uncached catalog key are requested Then the cached one is `ready`, the uncached one `absent` with `reason` `budget` or `kill_switched`, and 0 submits occur — proof: `pnpm check:workers -- budget-cache-first`
- AC-4 Given a key outside the catalog, and a key under a kill scope When route 27 is called Then the answers are `absent` with `reason: 'not_in_catalog'` and `blocked`, with 0 Workflow instances — proof: `pnpm check:workers -- cutscene-status`
- AC-5 Given route 28 When called without a token, with a wrong token, and with `OPS_TOKEN` from a non-US country Then the answers are 401, 401 and 202 — proof: `pnpm check:workers -- cutscene-prewarm`
- AC-6 Given a webhook body signed with the test key, the same body with 301 s clock skew, and a tampered body When posted to route 29 Then the first is 2xx and wakes its instance, the others are 401 and wake nothing — proof: `pnpm check:workers -- fal-webhook-verify`
- AC-7 Given `config/guardrails.yaml` with a 100,000,000-micro cap When reservations total 50 %, 80 % and 100 % Then the governor records each alarm once, reaches level 3 at 100 %, refuses the next reservation with `ok: false`, and a repeated `settle` with the same `jobId` changes nothing — proof: `pnpm check:workers -- governor-levels`
- AC-8 Given `FAL_MODE=live` and every registry provider `pending` When a cutscene job starts Then the gate refuses with `ENDPOINT_NOT_CLEARED` and `FalPort.submit` is never called; the production build has no `/_test/` handler and no `FAL_MODE=mock` — proof: `pnpm check:workers -- genai-gate && pnpm check:prod-routes`
- AC-9 Given Miniflare and `MockFalPort` When `check:pipeline` runs one `cutscene_shot` job and then the same key again Then the first run writes renditions, poster, last frame, subtitles and the manifest last with `provenance.aiGenerated: true` and `resigned: true`, and the second makes 0 `FalPort` calls — proof: `pnpm check:pipeline`
- AC-10 Given good and bad manifest fixtures When the C2PA gate test runs Then manifests lacking `origSha256`, `aiGenerated` or (with a `cleared` licence) `resigned` fail, and the repository run prints `0 shipped cutscenes` and exits 0 — proof: `pnpm check:unit -- tools/ci && pnpm check:c2pa`
- AC-11 Given a fixture request file When `assets:gen prewarm` runs without `--live` Then it prints each key's estimate and the total in micros, makes no POST and exits 0; with `--live` and no `OPS_TOKEN` it prints the SKIP line and exits 0; an estimate above the remaining cap is refused in the unit test — proof: `pnpm assets:gen prewarm -- --requests services/pipeline/fixtures/cutscene-requests.json && pnpm check:unit -- tools/assets`
- AC-12 Given the QA build on port 8788 When headers are checked Then `/` carries the Report-Only CSP of spec/05 §1.3, `Reporting-Endpoints`, `nosniff` and `Referrer-Policy`, a Worker response carries the same isolation headers, and route 4 answers 204 to a `csp-violation` body — proof: `pnpm check:headers -- --serve http://localhost:8788 && pnpm check:workers -- reports-browser`
- AC-13 Given the lifecycle PR When the DO-migration check runs on its diff Then it passes and labels the PR `do-lifecycle`; the logic PR changes no `migrations` entry — proof: `pnpm check:do-migrations`
- AC-14 Given both PRs merged and `OPS_TOKEN` set on staging When `deploy.yml` deploys staging Then smoke passes and a prewarm of the fixture key followed by route 27 returns `ready` with a `manifestUrl` that serves the mock manifest — proof: manual: operator workstation, read the deploy run summary, then `pnpm check:smoke -- <staging-url>` and `pnpm assets:gen prewarm -- --requests services/pipeline/fixtures/cutscene-requests.json --env staging --live`

## Test plan
- Workers runtime: the nine `services/edge/test` suites (`pnpm check:workers -- <suite>`; all with `pnpm check:workers`).
- Pipeline: `pnpm check:pipeline`. Unit: `tools/ci/check-c2pa`, `tools/assets/prewarm`, pipeline gate rules.
- Static and deployed: `check:headers`, `check:prod-routes`, `check:do-migrations`; `check:smoke` on staging.

## Demo script
1. `pnpm dev`; `curl localhost:8788/api/v1/cutscenes/<fixture key>` → `absent`.
2. `OPS_TOKEN=dev pnpm assets:gen prewarm -- --requests services/pipeline/fixtures/cutscene-requests.json --live`: estimate, then 202.
3. Poll until `ready`; open the `manifestUrl`. Rerun the prewarm: `0 misses`.

## Effort
1 session; ≈ 40 files; risk high (Workflows in the Workers Vitest pool, DO lifecycle order).

## Risks & fallbacks
- The Workers Vitest pool cannot run a Workflow instance (record it): `check:pipeline` runs the steps through an in-process `WorkflowStep` shim and Miniflare tests only the binding and `sendEvent`. Same commands.
- Workflow creation with an existing id is UNVERIFIED (U-BE-6): single-flight lives in `CutsceneJobDO`, which never creates a second instance for a key.
- File budget: move `check:c2pa` and AC-10 to M05b2; say so.
- CSP Report-Only reports on staging are recorded only (U-API-1); enforcement is M14b.

## Notes for the Builder
- Read first: `09-backend.md` §3.3, §5.1, §8; `09-backend-ops.md` §1.2, §5; `05-assets.md` §3, §4.6, §5; `05-assets-pipeline.md` §6, §9; `03-story-cutscenes.md` §D5; `spec/05-api-and-realtime.md` §1.3, §3 rows 4, 27–29, 49.
- Secrets and gates: `OPS_TOKEN` (Worker secret, staging only until M12a1; absent → route 28 answers 401 and the CLI SKIPs). `FAL_KEY` is not used here; `FAL_MODE=mock` everywhere except production, where providers are `pending` (Q-30, ADR-GENAI-01) so the gate refuses. Never call fal from CI (DL-OWN-01).
- Previews have no own Workflows: their binding points at the staging `gen-job` (`09-backend-ops.md` §1.3).
- Spend is integer USD micros everywhere. Branches `m05b1-cutscene-infra-mock` (logic) and `m05b1-do-lifecycle` (first PR).

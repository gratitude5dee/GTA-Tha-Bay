# M00a — edge-api-skeleton

## Goal
`tha-bay-web` gains its Worker script (`services/edge`): `/api/v1/*` runs first in the Worker with isolation headers in code, the `ApiError` envelope, `X-Request-Id`, the US-only geo-gate and C12 routes 1–3 (`/health`, `/boot`, `/t` → Analytics Engine); `pnpm check:workers` runs Workers-runtime tests; CI gains `check:secrets`, `check:prod-routes`, `check:do-migrations`; `deploy:prod` becomes versions upload → 0 % smoke → 100 % with rollback, driven by `deploy.yml`. Later backend milestones add routes and bindings to this running Worker.

## Requirements
- R-PLAT-01: COOP/COEP/CORP on every Worker response, not only on static assets (F-019).
- R-ROLL-01: `/boot` never blocks single-player; a failing or blocked `/boot` means offline single-player still starts.
- R-ENG-01: deterministic deploy and check scripts; no dashboard step except the operator prerequisites.
- R-ENG-03: no genAI route exists; `check:prod-routes` proves test routes and mock modes never reach production.
- R-IP-03 (groundwork): `/api/v1/legal/*` is geo-exempt from day one.

## Depends on
M00. Contracts: C12 1.1 (`09-backend-contracts.md` §2.1, §2.2, §2.4 rows 1–3, §2.5 `BootConfig`; `09-backend-contracts-1.1.md` §2 `BootConfig.hosts`, `FeatureFlag` additions), C16 1.1 (`09-backend-contracts.md` §3; `09-backend-contracts-1.1.md` §4), C13 1.1 (`QualityTierId`, `DeviceClass` from M00).

## Scope in
- `wrangler.jsonc`: add `main: src/index.ts`, `assets.binding: ASSETS`, `assets.run_worker_first: ["/api/*"]` (navigation stays on the asset path, D-01); `analytics_engine_datasets: [{binding: AE, dataset: tha_bay_telemetry}]` (†); `observability` (†) with logs `head_sampling_rate: 0.25`, traces `0.05`, staging `1.0`; `vars` `ENVIRONMENT`, `GEO_ALLOW: "US"`, `BUILD_ID` (CI), `MIN_CLIENT_BUILD`, host origins (`workers.dev` placeholders until Q-15), `FLAGS_JSON` (all false), `FAL_MODE` (`mock` in staging/previews, `live` declared, unused, in prod); `secrets.required: []` (grows per milestone); `previews` block repeating `vars` and the AE binding with `ENVIRONMENT: "preview"` (bindings are not inherited) [research/gap-ci-cd-release-assets.md §1.5]. † keys are checked against `wrangler@4.151.1` with `wrangler deploy --dry-run`; record the outcome (U-BE-3).
- Router (no framework): method + path table; 404/405 as `ApiError`.
- `withIsolationHeaders(res)` on every Worker response (COOP `same-origin`, COEP `require-corp`, CORP `same-origin`), except paths under `/account/`, which get none of COOP/COEP (D-01, `11-platform-pwa.md` §2).
- `X-Request-Id`: UUIDv7 minted in the Worker on every response; the same value in `ApiError.error.requestId`. UUIDv7 and clock code live in `services/edge` (not in `@dv/shared`, which the C02 lint keeps free of `Date` and `crypto`).
- Geo-gate (A-10): `request.cf.country ∉ GEO_ALLOW` → `451 region_blocked` on every `/api/v1/*` route except `/api/v1/boot` (answers with `region: 'blocked'`), `/api/v1/legal/*` and `/.well-known/*`. Missing `cf.country` (local dev) counts as allowed.
- Route 1 `GET /api/v1/health` → `{ ok: true, build, env }`, never geo-gated.
- Route 2 `GET /api/v1/boot` → `BootConfig` from vars: `build`, `minClientBuild`, `region`, `hosts` (`api`, `rt`, `id`, `media`, `ugc`; no `modsUi`), `assetCatalog: ''` until M01d, `flags` from `FLAGS_JSON`, `gov: 0`. `Cache-Control: no-store`.
- Route 3 `POST /api/v1/t` (`TelemetryBatch`) → 204: body ≤ 64 KiB (413 `payload_too_large`), ≤ 50 events (413), `content-type: application/json` (415); envelope validated; events whose `name` is not in the client part of the C16 registry, or has no per-name schema yet, are dropped and counted; props ≤ 16 keys, strings ≤ 128 chars, scrubbed (query strings, emails, bearer tokens, hex/base64 runs ≥ 24 chars); server adds only `country`; never reads `CF-Connecting-IP`, `User-Agent` or `Cookie`. Each kept event → one `AE.writeDataPoint({ indexes: [name], blobs, doubles })` per `09-backend-contracts.md` §3 storage mapping (≤ 250 points per invocation).
- `/api/v1/legal/*` placeholder: `404 feature_disabled` (real routes in M13d), geo-exempt.
- `/api/v1/_test/*` namespace reserved: compiled only when `ENVIRONMENT !== 'prod'`; M00a ships `/api/v1/_test/echo-country` for the geo-gate e2e on previews.
- `pnpm dev` runs Vite and `wrangler dev` together; Vite proxies `/api`.

## Scope out
- KV `FLAGS`, R2, DOs, Queues, Workflows, rate-limit bindings → the milestones that first need them (M05b, M06a). Flags come from vars until then.
- Play tokens and identity (M06a), Supabase (M05d), `/reports/browser` (M11a), `check:api`, `check:telemetry` full registry schemas (each emitter milestone adds its names' schemas; M14b audits).
- Custom domains, the version-affinity Transform Rule and the 10/50/100 % gradual path → when Q-15 is answered and before `gradual: true` is first used (M12a). v1 single-player deploys go 0 % smoke → 100 %, which needs no affinity.
- Split CI tokens (`CF_API_TOKEN_DEPLOY`, `_ASSETS`, `_CACHE`, `09-backend-ops.md` §2) → M14b; until then one `CLOUDFLARE_API_TOKEN` (operator prerequisite).

## Deliverables
- `packages/shared/src/api/v1.ts`: `C12_VERSION = '1.1.0'`, `ApiErrorCode`, `ApiError`, `HTTP_FOR`, `BootConfig` (1.1 `hosts`), `FeatureFlag` (1.0 members plus `mods.enabled`, `mods.script`, `mods.ui`) — verbatim from the contract sections above.
- `packages/shared/src/telemetry.ts`: `C16_VERSION = '1.1.0'`, `TelemetryEvent`, `TelemetryBatch`, `TelemetryEnvelope`, `TelemetryName` (1.0 list plus the 1.1 table), `CLIENT_TELEMETRY_NAMES` and `SERVER_ONLY_TELEMETRY_NAMES` constant arrays.
- `packages/shared/schemas/telemetry/batch.schema.json` (envelope + limits) and `names.schema.json` (`$defs` per name for `app.start`, `app.ready`, `app.hidden`, `app.abnormal_exit`, `app.cold_resume`, `err.js`, `err.promise`, `err.gpu`, `perf.minute`, `tier.decision`, `storage.persist`, `pwa.install`, `ui.page`; props as `09-backend-contracts.md` §3 and `09-backend-contracts-1.1.md` §4).
- `services/edge/`: `tsconfig.json` (Workers types), `vitest.config.ts`, `src/index.ts`, `src/router.ts`, `src/env.ts`, `src/headers.ts`, `src/errors.ts`, `src/uuidv7.ts`, `src/geo.ts`, `src/scrub.ts`, `src/routes/{health,boot,telemetry,legal,test}.ts`, updated `wrangler.jsonc`.
- `services/edge/test/`: `headers.test.ts`, `geo-gate.test.ts`, `boot.test.ts`, `telemetry-privacy.test.ts` (seeded PII fixtures never reach the AE stub), `errors.test.ts`.
- `tools/ci/check-secrets.ts` (patterns `cfat_`, `cfut_`, `cfk_`, `sbp_`, `sb_secret_`, `sk-ant-`, fal key shape, PEM headers; scans the git-tracked tree and, with a path argument, a build dir), `tools/ci/check-prod-routes.ts` (builds the prod bundle with `wrangler deploy --dry-run --outdir`, fails on any `/_test/` string or `FAL_MODE` = `mock` in the prod config), `tools/ci/check-do-migrations.ts` (diff vs `origin/main`: a change to any `migrations`/`exports`/DO class list in a `wrangler.jsonc` plus any other runtime change fails; alone, it prints `label: do-lifecycle`), `tools/ci/check-smoke.ts -- <url> [--version <id>]` (GET `/` and `/api/v1/health`, header assertions, optional `Cloudflare-Workers-Version-Overrides: tha-bay-web="<id>"`), `tools/ci/test/ci-scripts.test.ts` (fixtures for all four).
- `tools/ci/deploy.ts`: `prod` mode rewritten per `09-backend-ops.md` §2 step 3: build → write `$RUNNER_TEMP/secrets.json` (empty object today) → `WRANGLER_OUTPUT_FILE_PATH=… wrangler versions upload [--env staging] --tag <sha12> --message <title> --secrets-file …` → parse `version_id` from the ND-JSON → find the current version (`wrangler deployments status --json`, parsed defensively, U-BE-20) → `versions deploy NEW@0% OLD@100% -y` → `check:smoke --version NEW` → `versions deploy NEW@100% -y` → on any failure `wrangler rollback OLD --message auto`; `--dry-run` prints the command plan without network; a PR labelled `do-lifecycle` takes `wrangler deploy` and prints `rollback floor: <id>`. `bootstrap` mode stays idempotent and also prints the custom-domain block to add once Q-15 names the domain.
- `.github/workflows/deploy.yml`: `push: main` → `pnpm deploy:prod -- --env staging`; `push: tags: ['v*']` or `workflow_dispatch` → production only when `github.actor` is in repo variable `DEPLOY_ALLOWED_ACTORS` (private personal repos cannot enforce environment reviewers, research §6); version id to the job summary.
- `.github/workflows/ci.yml`: `static` adds `pnpm check:secrets`, `pnpm check:do-migrations`; `unit` runs `pnpm check:workers`; `build` adds `pnpm check:prod-routes` and `pnpm check:secrets -- apps/web/dist`.
- Root scripts: `check:workers [-- <suite>]` (real now), `check:secrets [-- <dir>]`, `check:prod-routes`, `check:do-migrations`, `check:smoke -- <url>`, `dev:edge`.
- Pins: `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `ajv` are not in the ledger (UNVERIFIED): take the resolved version, record it in `spec/03` §5.
- Secrets: none new. `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` as in M00; repo variable `DEPLOY_ALLOWED_ACTORS`. Absent token → `deploy:*` SKIP exit 0 locally; in `deploy.yml` a missing secret fails the job (a silent production skip would hide a broken pipeline).

## Interfaces
- C12 1.1: routes 1–3, `ApiError`, `HTTP_FOR`, `BootConfig`, `FeatureFlag`, conventions (`X-Request-Id` UUIDv7, epoch ms, `X-Client-Build` read and ignored until `minClientBuild` matters). Shapes copied, not changed.
- C16 1.1: batch, envelope, registry, privacy rules, AE mapping.
- C13 1.1: `QualityTierId`, `DeviceClass` (envelope).
- No contract change. If the route table needs a test route documented, it stays under `/_test/` and outside C12.

## Acceptance criteria
- AC-1 Given `wrangler dev` serving the QA build When headers are checked Then `/api/v1/health` returns 200 with COOP `same-origin`, COEP `require-corp`, CORP `same-origin` and an `X-Request-Id` that parses as UUIDv7, and the M00 asset checks still pass — proof: `pnpm check:headers -- http://localhost:8788`
- AC-2 Given a Workers-runtime request with `cf.country = 'FR'` When `/api/v1/boot`, `/api/v1/legal/dmca` and `/api/v1/t` are called Then `/boot` is 200 with `region: 'blocked'`, the legal route is not 451, and `/t` is 451 with `error.code = 'region_blocked'`; with `cf.country = 'US'` `/t` accepts a valid batch — proof: `pnpm check:workers -- geo-gate`
- AC-3 Given the staging vars When `GET /api/v1/boot` runs Then the body has every `BootConfig` field, all flags false, `gov: 0`, no `modsUi` host, and `Cache-Control: no-store` — proof: `pnpm check:workers -- boot`
- AC-4 Given a valid 10-event batch with one unknown name and one event carrying an email, a bearer token and a 40-char hex run in its props When posted to `/api/v1/t` Then the response is 204, the AE stub holds 9 points with `indexes[0]` = the event name, no blob contains the email, token or hex run, and no point contains the request IP or user agent — proof: `pnpm check:workers -- telemetry-privacy`
- AC-5 Given a 51-event batch, a 65 KiB body and a `text/plain` body When each is posted Then the responses are 413, 413 and 415 as `ApiError` with `requestId` equal to the `X-Request-Id` header — proof: `pnpm check:workers -- errors`
- AC-6 Given the production build When `check:prod-routes` runs Then no `/_test/` handler string exists in the prod bundle and the prod `FAL_MODE` is not `mock` — proof: `pnpm check:prod-routes`
- AC-7 Given fixtures containing a `cfat_` token, an `sk-ant-` key and a PEM header When the scanner runs on them Then each is reported; the tracked tree and `apps/web/dist` are clean — proof: `pnpm check:unit -- tools/ci && pnpm check:secrets && pnpm check:secrets -- apps/web/dist`
- AC-8 Given a fixture diff touching `migrations` plus `src/index.ts` When `check:do-migrations` evaluates it Then it fails; the migrations-only fixture passes and prints `label: do-lifecycle` — proof: `pnpm check:unit -- tools/ci`
- AC-9 Given no network When `deploy:prod -- --env staging --dry-run` runs Then it prints, in order, the versions upload, 0 % deploy, smoke with the version override header, 100 % deploy and the rollback-on-failure commands — proof: `pnpm deploy:prod -- --env staging --dry-run`
- AC-10 Given the operator prerequisites When a commit lands on `main` Then `deploy.yml` uploads a version to `tha-bay-web-staging`, smoke passes at 0 %, the version reaches 100 %, and the job summary shows the version id — proof: manual: desktop browser, GitHub Actions › deploy › latest run on `main`, read the summary; then `pnpm check:smoke -- <staging workers.dev URL>`
- AC-11 Given a Preview URL from M00's workflow When `/api/v1/_test/echo-country` is requested Then it returns the edge-reported country, and the same path on the production build is 404 — proof: manual: desktop browser, open `<preview-url>/api/v1/_test/echo-country`; then `pnpm check:prod-routes`

## Test plan
- Workers runtime (Vitest with the Workers pool): the five suites above. `pnpm check:workers`; a single suite by file-name filter, e.g. `pnpm check:workers -- geo-gate`.
- Unit: `tools/ci/test/ci-scripts.test.ts`; schema fixtures for `batch.schema.json`. `pnpm check:unit -- tools/ci packages/shared`.
- E2E: M00 suites unchanged; `@smoke` additionally asserts `GET /api/v1/health` from the page is same-origin and isolated. `pnpm check:e2e -- --project=chromium-webgl2 --grep @smoke`.
- Deployed: `check:smoke` inside `deploy.ts`; `check:headers` on the Preview URL (M00 workflow).

## Demo script
1. `pnpm dev`; `curl -i` the dev URL's `/api/v1/health`: 200, isolation headers, `X-Request-Id`; `/api/v1/boot` shows the `BootConfig`.
2. `pnpm check:workers`; five suites pass.
3. `pnpm deploy:prod -- --env staging --dry-run`; read the plan.
4. Merge to `main`; the `deploy` run summary shows the version id; open the staging URL.

## Effort
0.8 session; ≈ 32 files; risk medium (Workers pool versus `wrangler@4.151.1` config, `deployments status` JSON shape).

## Risks & fallbacks
- The Workers Vitest pool cannot load this config (UNVERIFIED pairing): call the exported `fetch` handler from plain Node Vitest with a fake `env` (AE stub, vars) and a `cf` object; log a Builder decision; AC proofs keep the same command.
- `wrangler deployments status --json` fields differ (U-BE-20): fall back to `wrangler versions list --json` and take the newest version at 100 %; if neither parses, stop before `versions deploy` and fail the job (never deploy without a rollback target).
- A † key is rejected by `wrangler@4.151.1`: remove the key, keep the behaviour default, record it in `spec/03` §5 and `spec/99` U-BE-3.
- AE is unavailable in Previews: the binding is redeclared under `previews`; if Previews still reject it, `/t` returns 204 and drops events when `env.AE` is undefined (telemetry is never on the player's critical path).

## Notes for the Builder
- Read first: `09-backend-contracts.md` §2.1–§2.5 and §3, `09-backend-contracts-1.1.md` §2 and §4, `09-backend-ops.md` §1–§2 and §3.2 (Region row), `research/gap-ci-cd-release-assets.md` §1.3–§1.5, R3, R6.
- Order: shared types → headers/errors → routes → geo → telemetry → tests → CI scripts → `deploy.ts` → workflows.
- Navigation requests skip the Worker (`run_worker_first` covers `/api/*` only), so HTML headers still come from `_headers`; Worker responses need `withIsolationHeaders`.
- Never log request bodies or headers; logs are billed by volume from 2026-12-01 (F-027).
- `services/edge` imports only `@dv/shared` (later `@dv/net`). Branch `m00a-edge-api-skeleton`.

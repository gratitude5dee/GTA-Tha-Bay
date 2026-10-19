# M05d — data-spine-supabase

## Goal
The backend gets its database. Supabase staging and production projects exist and are reached only through the Worker. Migrations `0001_core.sql` and `0002_genai.sql` are applied by `pnpm db:push` inside `deploy.yml`. `packages/shared/src/data-port.ts` holds the C12 `DataPort` with an `InMemoryDataPort` for tests, and `services/edge/src/data/supabase/*` is the only real implementation. `check:db` (pgTAP, lint, a DataPort contract run against the local stack) and `check:db:types` gate every DB change in CI. Two jobs move from static files to the DB: the cutscene catalog that M05b1 read from a static JSON is now synced from the shipped cutscene index into `cutscene_catalog`, and the `BudgetGovernorDO` ledger is exported nightly to `genai_ledger`. A nightly keep-alive stops the staging project from pausing. Single-player still never touches the database.

## Requirements
- R-ROLL-02: persistence for the later online world lands on Supabase (G1, D-02), with RLS on every table from the first migration.
- R-ENG-03: `genai_ledger`, `budget_program` (fal row = 100,000,000 micros, DL-OWN-01) and the catalog gate make "nothing generates without a cache check" auditable in SQL.
- R-ROLL-01: no single-player path needs the DB. `/boot` and cached cutscenes keep working when Supabase is down.
- R-ENG-01: migrations, type generation, push and keep-alive are scripts. The only operator step is creating the two projects once.

## Depends on
- **M05b1** (cutscene-infra-mock): `CutsceneJobDO`, `BudgetGovernorDO` ledger table, route 27 catalog check against a static JSON, `/_test/run-scheduled` (route 49), `OPS_TOKEN`.
- **M00e** (owner-account-hardening): the `AUTH_PASSWORD_SIGNUP` switch, the preview state without Supabase vars and the `boot` suite's assertions on them (AC-6 there), which this milestone updates (`_PLAN.md` §0 rule 7; DL-621, DL-622).
- Contracts: C12 1.1 (`09-backend-contracts.md` §2.6 `DataPort`; `09-backend-db.md` §1–§3.2, §8; `spec/04-data-models-db.md` §3.2a), C09 1.0 (`CutsceneIndex` shape read by the sync), C07 1.1 (`GenJob` fields in `gen_job`).

## Scope in
- Supabase CLI project in `supabase/` (`config.toml`, migrations, `tests/`). The CLI is a root devDependency at the version pnpm resolves; record it in `spec/03`.
- `0001_core.sql` verbatim from `09-backend-db.md` §3.1: schema `app`, `app.pid()`, `app.tier()`, `profiles`, `device_keys`, `identities`, `refresh_tokens`, `staff_roles`, `idempotency_keys`, `audit_log` (INSERT-only for the service role, hash chain columns), `age_assurance`.
- `0002_genai.sql`: §3.2 tables (`cutscene_catalog`, `cutscenes`, `genai_ledger`, `budget_daily`, `telemetry_daily`) and the §3.2a S05 tables (`gen_run`, `gen_job`, `asset_index`, `bark_index`, `budget_program`), plus `insert into budget_program values ('fal', 100000000, '{0.5,0.8,1.0}')`. You may add columns, never rename the listed ones (DL-198). RLS is on everywhere and all of these tables are server-only.
- Migration lint in `tools/ci/check-db.ts`: contiguous `NNNN_` numbering, no `create index concurrently`, no `drop column` in the same file that adds a reader (expand-only), every `create table` followed by `enable row level security`.
- `DataPort` verbatim from C12 §2.6, plus the store interfaces "one method per route" (`09-backend-contracts.md` §2.6). `LedgerStore` has no route; give it `append(rows: SpendEvent[]): Promise<number>` and `sumUsdMicros(vendor: Vendor, sinceMs: number): Promise<number>`, and log that as a Builder decision. Members whose tables land later throw `NotImplementedError('<milestone>')` in both implementations (`npcMemory`, `roster` → M06a1; `moderation` → M06b1; `saves`, `identity` → M12a1; `progress`, `leaderboards` → M12c; `ugc`, `forum` → M13a2/M13b1).
- Implemented now in both ports: `profiles.ensureLocal` and `profiles.get`, `cutscenes.record` and `cutscenes.inCatalog`, `ledger.*`.
- Supabase port (`supabase-js@2.118.0`, F-016) on the service path with `SUPABASE_SECRET_KEY` (`sb_secret_…`, never the legacy `service_role` key, F-032). The user path (JWT) waits for M12a1.
- Catalog sync: the daily cron at 03:10 and `/_test/run-scheduled?job=catalog-sync` upsert every row of the cutscene index shipped in the Worker's static assets into `cutscene_catalog`, idempotently. Route 27 and prewarm switch from the static JSON to `DataPort.cutscenes.inCatalog`.
- Ledger export: the nightly job reads unexported `BudgetGovernorDO` ledger rows, appends them to `genai_ledger` with `env = ENVIRONMENT`, and marks them exported. A rerun adds nothing.
- Failure mode (`09-backend.md` §5.3): when the DataPort throws, `/boot` is unaffected, and route 27 answers `ready` for a key whose manifest HEADs in R2, `absent` otherwise, with zero `ensure()` calls.
- `pnpm db:push -- --env <staging|prod> [--dry-run]`: `supabase link` → `db push --dry-run` (to the job summary) → `db push`.
- `pnpm test:staging [-- <suite>]` with suites `keepalive` (one `select` on staging through the Worker's `/_test/` path or the secret key) and `smoke` (`/api/v1/health` and `/boot` on the staging host).

## Scope out
- Migrations 0003 (M06a1), 0004 (M06b1), 0005 (M12a1), 0006 (M12c), 0007 (M13a2/M13b1), 0008 (M13d1), 0009 (M14a).
- The user path with our ES256 JWT, `auth:tpa` and the RLS staging test `rls-thirdparty`: M12a1.
- Retention crons for NPC data and `/me` export or forget: M06a1. The telemetry rollup into `telemetry_daily`: M14b1.
- Hyperdrive: not used (U-BE-7).

## Deliverables
- `supabase/config.toml`, `supabase/migrations/{0001_core.sql, 0002_genai.sql}`, `supabase/tests/{rls_profiles.sql, server_only.sql, audit_append_only.sql, genai_seed.sql, password_user_denied.sql}`.
- `packages/shared/src/data-port.ts`, `packages/shared/src/data-port.memory.ts`, `packages/shared/src/db.gen.ts` (generated), `packages/shared/test/data-port/{contract.ts, memory.spec.ts}`.
- `services/edge/src/data/supabase/{index.ts, client.ts, profiles.ts, cutscenes.ts, ledger.ts}`, `services/edge/src/ops/{catalog-sync.ts, ledger-export.ts}`, cron wiring in `src/index.ts`, `services/edge/test/{catalog-sync.test.ts, ledger-export.test.ts, supabase-down.test.ts}`, `services/edge/test/db/dataport-supabase.db.test.ts` (run by `check:db`, not by `check:workers`).
- `services/edge/wrangler.jsonc`: `SUPABASE_URL` var per env and under `previews`, `secrets.required` adds `SUPABASE_SECRET_KEY`, cron `10 3 * * *` if absent; `services/edge/test/boot.test.ts` (M00e AC-6 assertions updated for `previews`, Notes).
- `tools/ci/{check-db.ts, check-db-types.ts, db-push.ts, test-staging.ts}`, `tools/ci/test/db-scripts.test.ts` (migration lint fixtures, push plan), `tests/staging/{vitest.config.ts, keepalive.test.ts, smoke.test.ts}`, `apps/web/test/no-supabase.test.ts` (greps `dist` for `supabase-js`, `sb_secret_`, the project ref).
- `config/supabase.projects.json` (`{staging: {ref, url}, prod: {ref, url}}`; refs are not secrets).
- Root scripts: **`check:db`**, **`check:db:types`**, **`db:push`**, **`test:staging`**, **`check:api`** (`tools/ci/check-api.ts` with `tools/ci/test/check-api.test.ts`: regenerates `packages/shared/schemas/api/*.schema.json` from the route DTOs in `packages/shared/src/api/v1.ts` and fails on drift, `09-backend-ops.md` §2; the TypeScript-to-JSON-Schema generator is the version pnpm resolves, recorded in `spec/03`; M00a scoped it out, DL-230).
- `.github/workflows/ci.yml` job `db` (paths `supabase/**`, `packages/shared/src/db*`, `packages/shared/src/data-port*`); `deploy.yml` job `migrate` before `web`; `nightly.yml` step `pnpm test:staging -- keepalive`.
- `docs/runbooks/supabase.md`: project creation, keys, restore, pause recovery.
- About 38 files.

## Interfaces
- C12 1.1: `DataPort`, `Ctx`, row types re-exported from `db.gen.ts`, migrations 0001–0002. Shapes are copied. The store interfaces are filled in by the "one method per route" rule. Any wider change is a proposal to the Architect in the PR, not an edit.
- C09 1.0 `CutsceneIndex` (read only). C07 1.1 `GenJob` (columns of `gen_job`).
- No new route.

## Acceptance criteria
- AC-1 Given a clean checkout with Docker available When `check:db` runs Then the local stack starts, `supabase db lint` reports no error, and the pgTAP files pass: profile A cannot select profile B's row, every server-only table returns 0 rows to `anon` and `authenticated`, `update` and `delete` on `audit_log` fail for the service role, and `budget_program` holds the `fal` row with 100,000,000 — proof: `pnpm check:db`
- AC-2 Given the local stack When the DataPort contract suite runs against the Supabase implementation Then `ensureLocal` returns `created`, then `exists`, then `key_mismatch` for a second key; `cutscenes.record` followed by `inCatalog` agrees with the rows; and `ledger.sumUsdMicros` equals the sum of the appended rows — proof: `pnpm check:db`
- AC-3 Given migrations 0001–0002 When types are regenerated Then `packages/shared/src/db.gen.ts` has no diff — proof: `pnpm check:db:types`
- AC-4 Given fixture migrations with `create index concurrently`, a gap in numbering, and a table without `enable row level security` When the migration lint runs Then each fails with its rule name, and the real migrations pass — proof: `pnpm check:unit -- tools/ci`
- AC-5 Given `InMemoryDataPort` When the same contract suite runs Then it passes, and every member owned by a later milestone throws `NotImplementedError` naming that milestone — proof: `pnpm check:unit -- packages/shared/test/data-port`
- AC-6 Given a shipped cutscene index with 3 refs, 2 of them not yet in the catalog When `catalog-sync` runs twice on the in-memory port Then `cutscene_catalog` equals the index keys after the first run and the second run writes 0 rows; a route 27 request for a key outside the index returns `absent` with 0 `ensure()` calls — proof: `pnpm check:workers -- catalog-sync`
- AC-7 Given a governor ledger with 5 rows, 2 already exported When `ledger-export` runs twice Then `genai_ledger` gains exactly 3 rows with equal `usd_micros` and `env = ENVIRONMENT`, and the second run adds 0 — proof: `pnpm check:workers -- ledger-export`
- AC-8 Given a DataPort that throws on every call When `/api/v1/boot` and route 27 for a key whose manifest exists in the R2 stub are requested Then `/boot` is 200 and route 27 returns `ready`, and an unknown key returns `absent` with 0 `ensure()` calls — proof: `pnpm check:workers -- supabase-down`
- AC-9 Given no network When `db:push` runs with `--dry-run` Then it prints, in order, the `link`, `db push --dry-run` and `db push` commands for staging; with `SUPABASE_ACCESS_TOKEN` unset and no `--dry-run` it prints `SKIP db:push: SUPABASE_ACCESS_TOKEN not set` and exits 0 — proof: `pnpm db:push -- --env staging --dry-run && env -u SUPABASE_ACCESS_TOKEN pnpm db:push -- --env staging`
- AC-10 Given the production build When the bundle is scanned Then it contains no `supabase-js` code, no `sb_secret_` pattern and no project ref — proof: `pnpm build && pnpm check:secrets -- apps/web/dist && pnpm check:unit -- apps/web/test/no-supabase.test.ts`
- AC-11 Given the operator prerequisites (both projects, GitHub repository secrets) When a commit lands on `main` Then `deploy.yml` runs `migrate` (dry-run plan in the summary) before `web`, the staging smoke passes, and the keep-alive query returns — proof: manual: desktop browser, GitHub Actions › deploy › latest `main` run, read the `migrate` summary; then `pnpm test:staging -- keepalive && pnpm check:smoke -- <staging workers.dev URL>`
- AC-12 Given the local stack and, inside the pgTAP file `password_user_denied`, one row inserted into `auth.users` with no matching `profiles` row When the file runs `set local role authenticated` and `set local request.jwt.claims` to `{"sub": <that id>, "role": "authenticated"}` Then every table returns no more rows than it does under `set local role anon`, and every insert, update and delete attempted affects 0 rows — proof: `pnpm check:db`

## Test plan
- **DB (pgTAP + Node against the local stack):** `rls_profiles`, `server_only`, `audit_append_only`, `genai_seed`, `password_user_denied`, `dataport-supabase.db` — `pnpm check:db`; types — `pnpm check:db:types`.
- **Unit:** `shared/data-port.memory` (contract suite), `tools/ci/db-scripts` (lint fixtures, push plan), `web/no-supabase` — `pnpm check:unit`.
- **Workers runtime:** `catalog-sync`, `ledger-export`, `supabase-down` — `pnpm check:workers`.
- **Staging:** `pnpm test:staging -- keepalive`, `pnpm test:staging -- smoke` (nightly and post-deploy).

## Demo script
1. `pnpm check:db`: the local stack starts and every pgTAP file passes.
2. `pnpm check:db:types`: no diff.
3. `pnpm db:push -- --env staging --dry-run`: read the plan.
4. `pnpm check:workers -- catalog-sync`, then `ledger-export`.
5. Merge to `main`; open the `deploy` run; `migrate` precedes `web`; then run `pnpm test:staging -- keepalive`.

## Effort
1 Builder session; about 38 files; risk **medium** (local-stack startup time in CI, keeping the generated types stable).

## Risks & fallbacks
- **Docker missing locally:** `check:db` prints `SKIP check:db: docker not available` and exits 0 outside CI. The `db` job on `ubuntu-24.04` has Docker and is required. Say in the report which checks were skipped.
- **Supabase CLI command shapes** are not in the ledger: wrap every call in `tools/ci/*`, parse output defensively, and record the resolved version and any flag differences in `spec/03`.
- **Free-tier staging pauses after 7 days** [research/gap-ci-cd-release-assets.md §3]: the nightly keep-alive covers it. If a pause happens anyway, the runbook restores the project and `db:push` re-applies.
- **Production plan (G1: Supabase Pro, `us-west-1`) not purchased yet:** staging-only is acceptable. `deploy.yml` skips `migrate` for production with `SKIP … SUPABASE_PROJECT_ID not set` and lists it under "Blocked on". Production single-player is unaffected.
- **Generated types churn across CLI versions:** pin the resolved CLI version in the lockfile and regenerate only in this job.

## Notes for the Builder
- Read first: `09-backend-db.md` §1–§3.2 and §8; `spec/04-data-models-db.md` §3.2a; `09-backend-contracts.md` §2.6; `09-backend-ops.md` §1.3 and §2; `09-backend.md` §5.3; ADR-0008.
- **Operator prerequisite (owner gate G1):** the production project already exists as `tha-bay` (see the next bullet); create only `tha-bay-staging` (Free is fine), confirm that `tha-bay` is on Pro (`us-west-1`; F-029, F-030), write both refs and URLs, and each project's current publishable key as `publishableKey` (publishable keys are treated as public, no rotation; DL-600), into `config/supabase.projects.json`, and put `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` (GitHub repository secrets, `_STAGING`/`_PRODUCTION` suffixed; `08-test-and-ci.md` §8) and `SUPABASE_SECRET_KEY` (Worker secret via `--secrets-file`) in place. Public sign-up is turned off on a project only after U-ACCT-3 is recorded in `spec/03` §7 (M00e Operator actions step 4; DL-600). Any secret missing: stub behind the variable, `SKIP … <VAR> not set`, exit 0 locally.
- **Live since 2026-10-19 (DL-512, ADR-ACCT-01):** the owner created project `tha-bay` (ref `jwvvllhxuvwkrynmnchb`, `us-west-1`); it is the prod project, and staging shares it until this milestone (RISK-28, DL-603). Builder: once `tha-bay-staging` is in `config/supabase.projects.json`, point the `env.staging` vars `SUPABASE_URL` and `SUPABASE_ANON_KEY` at its `url` and `publishableKey`, and give `previews` the same two vars (they had none since M00e, DL-601); keep `AUTH_PASSWORD_SIGNUP` as it is in each block, and update `services/edge/test/boot.test.ts` (M00e AC-6): `previews` now carry `SUPABASE_URL` and `SUPABASE_ANON_KEY` pointing at `tha-bay-staging` and still no `AUTH_PASSWORD_SIGNUP` (DL-621). If `publishableKey` is absent, leave the staging vars on `tha-bay`, keep previews without Supabase vars, print `SKIP staging Supabase vars: publishable key not provided` and list it under "Blocked on"; in that case the `boot` suite keeps M00e's absence assertion for `previews`. Supabase Auth already holds password users (routes 58–60): add `supabase/tests/password_user_denied.sql` (AC-12: a Supabase-native `authenticated` token reads no more rows than `anon` and writes 0 rows; DL-515), keep `apps/web/test/no-supabase.test.ts` grepping for the ref, and record in the report the project auth settings that U-ACCT-1, U-ACCT-3, U-ACCT-6 and U-ACCT-7 name (email requirement and auto-confirm, public sign-up on or off, whether user metadata stays user-writable, the dashboard sign-up switch).
- No supabase-js in `apps/web` or any client package (D-02). `services/edge` imports `@dv/shared` and `supabase-js` only.
- Order: migrations → pgTAP → types → `data-port.ts` and the in-memory port → Supabase port → contract run → cron jobs → scripts → workflows.
- Never log row contents or keys. Ids are UUIDv7 minted in the Worker; times in the DB are `timestamptz`, converted to epoch ms at the port boundary.
- Branch `m05d-data-spine-supabase`.

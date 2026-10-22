# Runbook: the Supabase data spine (M05d)

Scope: the database behind `tha-bay-web` (ADR-0008, G1). Single-player never touches it (R-ROLL-01): `/boot`, cached cutscenes and every game route work with the database down. Only the Worker reaches it, with the secret key; the browser never does (`apps/web/test/no-supabase.test.ts`). Steps marked **operator** are not Builder actions.

## Names

| Item | Where | Notes |
|---|---|---|
| `config/supabase.projects.json` | repository | `{staging, prod}` with ref, URL, publishable key. Public values. `staging` is null until the operator fills it. |
| `SUPABASE_URL` | Worker var | Per environment in `services/edge/wrangler.jsonc`. |
| `SUPABASE_SECRET_KEY` | Worker secret (`sb_secret_...`, never the legacy `service_role` key) | `wrangler secret put SUPABASE_SECRET_KEY [--env staging]` or `--secrets-file`. Listed in `secrets.required`. Absent: the Worker has no database and falls back to the static catalog; the jobs print `skipped: no_database`. |
| `SUPABASE_ACCESS_TOKEN` | GitHub repository secret | One account token for `supabase link` and `db push`. |
| `SUPABASE_PROJECT_ID_STAGING`, `SUPABASE_PROJECT_ID_PRODUCTION` | GitHub repository secrets | The project refs. `pnpm db:push` falls back to the ref in `config/supabase.projects.json`. |
| `SUPABASE_DB_PASSWORD_STAGING`, `SUPABASE_DB_PASSWORD_PRODUCTION` | GitHub repository secrets | The database password chosen at project creation. |

## 1. Create the projects (operator, once)

1. Production exists as `tha-bay` (ref `jwvvllhxuvwkrynmnchb`, `us-west-1`). Confirm it is on the Pro plan.
2. Create `tha-bay-staging` (Free plan is enough, same region). Write its ref, URL and publishable key into the `staging` entry of `config/supabase.projects.json` in a PR. In the same PR point the `SUPABASE_URL` and `SUPABASE_ANON_KEY` vars of `env.staging` and `previews` at it and change `services/edge/test/boot.test.ts` AC-6 to assert that previews carry them.
3. Add the GitHub repository secrets above and the Worker secret `SUPABASE_SECRET_KEY` for each deployed Worker.
4. Public sign-up on a project is turned off only after U-ACCT-3 is recorded in `spec/03` section 7 (see `docs/runbooks/supabase-auth.md`).

## 2. Migrations

- Files `supabase/migrations/NNNN_name.sql`, expand-only: a column drop ships one release after the code stops reading it. `pnpm check:db` lints the numbering, `create index concurrently`, drops next to new readers, and RLS on every table.
- `deploy.yml` job `migrate` (push to `main`, staging) and `migrate-production` (tag or manual run) call `pnpm db:push -- --env <staging|prod>`: `supabase link`, `supabase db push --dry-run` (the listing goes to the job summary), `supabase db push`. A missing token, project id or password prints one `SKIP db:push: <VAR> not set` line and passes.
- Read the plan without running anything: `pnpm db:push -- --env staging --dry-run`.
- Types: after a migration run `pnpm check:db:types -- --write` and commit `packages/shared/src/db.gen.ts`. CI (`db` job) fails when the file differs from the migrations.

## 3. Local checks

- With Docker: `pnpm check:db` starts the Supabase local stack, lints, runs the pgTAP files and the DataPort contract, and stops it.
- Without Docker: point `DV_DB_URL` at a throwaway database on a Postgres 16 or 17 that has the pgtap extension (the database is dropped and recreated), for example `DV_DB_URL=postgresql://postgres@127.0.0.1:5432/dv_check pnpm check:db`. The contract run also needs `DV_DB_API_URL` and `DV_DB_SECRET_KEY` for an API in front of that database; without them the script prints `SKIP check:db contract run`.

## 4. Scheduled jobs

The Cron Trigger `10 3 * * *` (UTC) runs `catalog-sync` (the shipped cutscene index into `cutscene_catalog`) and then `ledger-export` (settled `BudgetGovernorDO` rows into `genai_ledger`). Both are idempotent. After the first deploy of a fresh project `cutscene_catalog` is empty until the cron runs; on staging, run it at once with `POST /api/v1/_test/run-scheduled?job=catalog-sync` and, to check the export, `?job=ledger-export`. In production, route 27 answers `not_in_catalog` for index keys until the 03:10 run.

## 5. Keep-alive and pause recovery

The Free staging project pauses after 7 idle days. The nightly workflow runs `pnpm test:staging -- keepalive` (one select through the staging Worker). If the project paused anyway: Dashboard, the project, Restore project; wait until it is healthy; run `pnpm db:push -- --env staging` to re-apply anything missing; run `pnpm test:staging -- keepalive`. While the database is down the Worker keeps serving `/boot` and cached cutscenes, and route 27 answers `ready` for a key whose manifest is in R2 and `absent` otherwise, without starting any generation.

## 6. Restore

Production (Pro) keeps daily backups: Dashboard, Database, Backups, restore to a point in time. After a restore run `pnpm db:push -- --env prod --dry-run` and read the listing, then `pnpm check:db` locally against the same migrations. The restore drill suite arrives with M14b2.

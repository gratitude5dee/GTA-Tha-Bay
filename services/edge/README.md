# @dv/edge

The `tha-bay-web` Worker (and `tha-bay-web-staging`): static assets, the `/api/v1/*` routes (`src/router.ts`, `src/routes/`), the C12 error shape (`src/errors.ts`), the geo gate (`src/geo.ts`), isolation headers on every Worker response (`src/headers.ts`, `withIsolationHeaders`) and, from later milestones, Durable Objects and crons. Configuration: `wrangler.jsonc`.

## Import rules

- Imports only `@dv/shared` and `@dv/net` (never `apps/*`, `@dv/engine` or `@dv/ui`), plus `@supabase/supabase-js`, which only `src/data/supabase/` imports (M05d). No client package or app imports it.
- Every Worker response goes through `withIsolationHeaders`; `/account/*` is the only non-isolated path.
- No secret value is committed; local development reads `.dev.vars` (git-ignored). Worker secrets ride with versions.
- Only Workers named `tha-bay-*` are ever deployed from here.

## Data (M05d)

`src/data/supabase/` is the one real `DataPort` (service path, `SUPABASE_SECRET_KEY`); `InMemoryDataPort` (`@dv/shared/data-port.memory`) serves tests. `AppDeps.data(env)` returns the Supabase port or null when the Worker has no database (then the static key list of the shipped cutscene index gates route 27). `src/ops/` holds the scheduled jobs: `catalog-sync` (shipped index to `cutscene_catalog`), `ledger-export` (`BudgetGovernorDO` to `genai_ledger`) and `keepalive`. The cron `10 3 * * *` runs the first two; in staging and previews `POST /api/v1/_test/run-scheduled?job=<name>` runs any of the three. Tests that need a database live in `test/db/` and run under `pnpm check:db`. Runbook: `docs/runbooks/supabase.md`.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev:edge` | `wrangler dev` on port 8788 |
| `pnpm check:workers [-- <suite>]` | Workers-runtime tests (`services/edge/test`) |
| `pnpm check:prod-routes` | dry-run bundle; no `/_test/` route in production |
| `pnpm deploy:prod -- --env staging` | versions upload, 0 % smoke, 100 %, rollback on failure (needs Cloudflare credentials) |

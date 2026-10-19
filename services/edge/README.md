# @dv/edge

The `tha-bay-web` Worker (and `tha-bay-web-staging`): static assets, the `/api/v1/*` routes (`src/router.ts`, `src/routes/`), the C12 error shape (`src/errors.ts`), the geo gate (`src/geo.ts`), isolation headers on every Worker response (`src/headers.ts`, `withIsolationHeaders`) and, from later milestones, Durable Objects and crons. Configuration: `wrangler.jsonc`.

## Import rules

- Imports only `@dv/shared` and `@dv/net` (never `apps/*`, `@dv/engine` or `@dv/ui`).
- Every Worker response goes through `withIsolationHeaders`; `/account/*` is the only non-isolated path.
- No secret value is committed; local development reads `.dev.vars` (git-ignored). Worker secrets ride with versions.
- Only Workers named `tha-bay-*` are ever deployed from here.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev:edge` | `wrangler dev` on port 8788 |
| `pnpm check:workers [-- <suite>]` | Workers-runtime tests (`services/edge/test`) |
| `pnpm check:prod-routes` | dry-run bundle; no `/_test/` route in production |
| `pnpm deploy:prod -- --env staging` | versions upload, 0 % smoke, 100 %, rollback on failure (needs Cloudflare credentials) |

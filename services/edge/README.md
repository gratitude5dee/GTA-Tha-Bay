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

## NPC backend spine (M06a1)

No model is called yet; every limit that M06a3's dialogue route needs is already enforced here.

- **Play token and TOFU** (`src/id/`): `playtoken.ts` mints (route 5) and verifies with `PLAY_TOKEN_HMAC` plus `PLAY_TOKEN_HMAC_PREV`; `bind.ts` binds the device key to the profile on the first server write (another key is 403); `tofu.ts` is the `Authorization: PlayToken` check every P0 route uses; `nethash.ts` is the network key (SHA-256 of the /24 or /48 and a daily salt from `QUOTA_NET_SALT_SECRET`).
- **`PlayerQuotaDO`** (`src/budget/QuotaDO.ts`, `quota.ts`): per-player and per-network daily caps from `config/guardrails.yaml` (`npc:`), reserve before a call and settle after; a settled turn puts one `SpendEvent` on the `SPEND` queue; every refusal writes `quota.block`. Network counters: 50 play tokens and 3 password sign-ups a UTC day.
- **`EncounterDO`** (`src/npc/EncounterDO.ts`): server-held history, one turn at a time (`busy`, `cadence`, `turn_cap`, `killed`), transcript to PRIVATE and a `summarize` job 60 s after the last turn. An instance named `enc:index:<npcId>` keeps the open conversations of one NPC so a kill reaches them.
- **SSE transport** (`src/npc/sse.ts`): `sseStream` writes C10 `DialogueEvent`s in order and enforces the 4 s first-token rule; `watchKill` turns the encounter's `status().killed` into an AbortSignal. M06a3 supplies the upstream.
- **Roster kill switch** (`src/flags/roster.ts`, routes 30, 46, 47): `roster_flag` in Postgres through a 10 s isolate cache, KV `roster:flags` only when that read fails.
- **Route 14** (`src/routes/me.ts`): `GET /me`, `GET /me/export` (queued job, authenticated download for 7 days), `DELETE /me` (hidden at once, the forget job purges rows and R2 objects). Credential handlers for per-provider accounts register in `src/ops/forget.ts` (empty until M12a1).
- **Queues and crons**: `JOBS` (summarize, forget, export) and `SPEND` have consumers in `src/ops/jobs.ts`; `10 3`, `20 3` and `30 3` run transcript, memory and stub-profile retention (`src/ops/retention.ts`). Previews run neither: use `POST /api/v1/_test/run-scheduled?job=<transcripts|memory|stub-profiles>`.
- **Test seams** (never set by production code): `setClockForTests` (`src/clock.ts`), `setDataPortForTests` (`src/data/index.ts`), `setQueueSinksForTests` (`src/ops/queue.ts`), `setServerEventSinkForTests` (`src/telemetry/server.ts`). A Workers-pool test cannot fake timers inside a Durable Object, so tests drive these. Put a mocked clock in the real future: an alarm set before the real now is run by workerd on its own.

Secrets added here: `PLAY_TOKEN_HMAC` (+ `_PREV`), `QUOTA_NET_SALT_SECRET`; both required ones are in `secrets.required`, so a version upload without them fails. `tools/ci/deploy.ts` `buildSecretsJson` maps them from the environment; `deploy:bootstrap` creates the four queues.

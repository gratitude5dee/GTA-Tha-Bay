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

## Dialogue route (M06a3)

`POST /api/v1/npc/:npcId/talk` (route 31, `src/routes/npc-talk.ts` and `src/npc/`). Pre-stream failures are C12 `ApiError` JSON; from the first byte on a failure is a `fallback` event and the client plays ink.

- **`dialogue.ts`** is the service: play token, body schema (a client `history` is dropped), `npc.dialogue` flag (KV `flags:features` over the `FLAGS_JSON` var), `RL_TALK`, roster kill and `ks:*`, governor level (KV `gov:level`), soul version, input prefilter, `EncounterDO.begin`, quota reservation, prompt, stream, then settlement in `waitUntil`.
- **`prompt.ts`**: block A (1 h) and block B (1 h) in `system`, the server history, one 5 m breakpoint after 8 turns, the scene last, top-level automatic caching, `output_config.format = npc-turn-1.0`. No sampling parameter, no prefill.
- **`router.ts`**: Haiku by default; a hero (`roles.hero` and `modelTier sonnet`) is Sonnet with `between_tools` thinking and the server-side fallback beta; level 1 or `ks:anthropic:sonnet` sends heroes to Haiku with the same system blocks; level 3, `ks:anthropic`, `ks:genai:all` answer `budget_offline`. A Sonnet 429 is re-issued once, at once, as the Haiku request.
- **`upstream.ts`**: `@anthropic-ai/sdk` (imported on first live call), `baseURL = AIG_BASE` when set, headers `cf-aig-metadata` (hashed pid, tier, env) and `cf-aig-collect-log-payload: false`. `ANTHROPIC_MODE=live` calls Anthropic; any other value (the default) replays `test/fixtures/anthropic/*.sse` through `upstream-fixture.ts`. Production must be `live` (`check:prod-routes`).
- **`souls.ts`**: reads `souls/index.json`, `souls/<id>/<ver>/soul.{prompt.txt,compiled.json}` and `prompts/npc/rules@<n>.md` from PRIVATE (isolate LRU of 64). Outside live mode a missing object falls back to `src/generated/npc-fixtures.json` (`pnpm npc:edge-bundle`: the public rules example and the original `npc_test`).
- **`settle.ts`**: micros from `usage` at the F-034 prices of the response's `model`; an unlisted model is charged at the Opus 5.5 rates and logs `genai.cost.unpriced`.
- **`safety.ts`**: the shared prefilter, the NameRegistry check of the output (PRIVATE `names/real.json`, never in the repository) and the asynchronous moderation interface (logs `moderation: lands in M06b1`).
- **Test seams**: `setUpstreamForTests`, `setTimingForTests` (`upstream.ts`), `setFixtureSourceForTests`, `setModerationForTests`, `setNameRegistryForTests`, `dropSoulCache`, and `drainTalk()` (waits for the work after the last byte). `test/talk-helpers.ts` drives a virtual clock so the 4 s rule and the fixture pacing run in milliseconds.
- **Staging**: `GET /api/v1/_test/npc/usage?npc=&encounter=` (test routes only) returns the token counts of the caller's own encounter; `pnpm test:staging -- npc-cache` reads it.

Secret added: `ANTHROPIC_API_KEY` (workspace `npc-runtime`), in the production `secrets.required` only: staging and Previews run fixtures. Var `AIG_BASE` (AI Gateway `gw-dialogue`) is set by the operator once the gateway exists; unset, calls go to the Anthropic API directly (U-NPC-02).

## Memory and voice (M06a4)

- **`npc/memory.ts`**: retrieval (bge-m3 embedding of the player's text, `match_npc_memories`, top 6) and writes (scrub, no 9-word quote of the player, dedupe at cosine 0.92). Only a player whose age bracket is `18p` has memory; any failure gives an empty `<memory>` and the turn goes on.
- **`npc/summarize.ts`**: the `summarize` queue consumer (inline in the encounter DO when there is no queue). Haiku call with the `npc-summary-1.0` format; the summary is at most 1,200 chars, deltas are clamped to +-10, and every 10th encounter of a pair adds one `reflection`.
- **`npc/tts-router.ts`**: `planVoice` applies `effectiveTier` (soul tier, voice setting, identity, governor level, kill switches, `voice_line` quota). t1 is Workers AI Aura through the `AI` binding (`tts-workers-ai.ts`); t2 is ElevenLabs behind `ks:tts:elevenlabs` and `ELEVENLABS_API_KEY` (`tts-elevenlabs.ts`, stub-tested only). Audio goes out per sentence as `line.delta {audio}` before `line.done`; a failure leaves the text line alone.
- **Route 52**: `DELETE /api/v1/me/npc-memory[?npcId=]` deletes the player's memories and relationships (204).
- **Staging**: `POST /api/v1/_test/npc/tts?model=aura-1|aura-2&speaker=` answers codec, size and time of one Aura call; `pnpm test:staging -- npc-tts` records them in `tests/reports/npc/tts.json` (U-NPC-05).
- **Binding**: `ai` (Workers AI) in the root, staging and previews blocks. It is remote-only: `wrangler dev` needs `--local` without a Cloudflare token (the root `dev:edge` script, `pnpm dev` and the Playwright web server pass it), and `vitest.config.ts` and the pipeline's `getPlatformProxy` calls (`check:pipeline`, `gate.prompt-lint.test.ts`) set `remoteBindings: false`.

# M06a1 — npc-backend-spine

## Goal
The web Worker carries the backend that NPC dialogue runs on, though no model is called yet. Play tokens (route 5, minted since M04b3) are bound to their device key on first use (TOFU) and verified with dual-key rotation. `PlayerQuotaDO` reserves and settles per-player turns, voiced lines and cost. `EncounterDO` holds each conversation's history on the server. A reusable SSE transport enforces the 4 s first-token rule. Migration `0003_npc.sql` stores memory, relationships, transcripts, likeness subjects, consent and the roster kill-switch. Routes 30 (`/roster`), 46 (kill), 47 (flags) and 14 (`/me`, export, forget) work, and retention crons purge expired NPC data. M06a3 plugs the dialogue service into these parts, and every limit is already enforced before that milestone makes its first paid call.

## Requirements
- R-NPC-05: rate limits, per-player quotas and server-held history exist before any model call, so no key or history ever lives in the browser.
- R-NPC-04: the roster kill-switch is live within 60 s (D-29, DL-557): `roster_flag` is read from Postgres (strongly consistent) through a 10 s isolate cache, KV `roster:flags` is only the fallback when that read fails, clients poll route 30 every 30 s while visible (M06a3), and `EncounterDO.kill` stops open talks at once. Bound: 10 s cache + 30 s poll + one request ≤ 45 s, from any location.
- R-AUTH-01: P0 identity stays local; the play token is bound to the device key on first server write, and nothing requires sign-in.
- R-IP-02: `likeness_subject`, `consent_record` and `consent_event` exist with the research L2 columns; every kill and flag write is audited.

## Depends on
- **M05d** (data-spine-supabase): `DataPort`, migrations 0001–0002, `check:db`, `db:push`.
- **M04b3** (local-identity-play-token): `IdentityService` local adapter, device key, route 5 stateless mint (DL-182).
- Contracts: C12 1.1 (`09-backend-contracts.md` §2.3 play token, §2.4 rows 5, 14, 30, 46, 47, §2.6 `DataPort.npcMemory` and `roster`; `09-backend-contracts-1.1.md` §2–§3; `09-backend-ops.md` §5.2–§5.3 `PlayerQuota`), C10 1.0 (`NpcId`, memory types §B2.6, `FallbackReason`), C16 1.1 (`quota.block`, `budget.level`).

## Scope in
- **Play token:** verification of `Authorization: PlayToken <tok>` with `PLAY_TOKEN_HMAC`, plus `PLAY_TOKEN_HMAC_PREV` for a 24 h window. TOFU happens on the first server write for a `pid`: `profiles.ensureLocal(pid, thumbprint)` creates the `device_keys` row, and a later request with another key gets 403. The per-net cap is 50 tokens a day (`q:n:*`). `netHash` = SHA-256 of the /24 or /48 prefix plus a daily salt HMAC-derived from `QUOTA_NET_SALT_SECRET`. The raw IP is never stored.
- **`PlayerQuotaDO`** (`q:p:<pid>`, `q:n:<netHash>`): `reserve`, `settle`, `usage` per `09-backend-ops.md` §5.3. The table in §5.2 gives the limits (turns 150/400, 40 per NPC, voiced lines 60/200, cost cap $0.05/$0.15, `builder_text` 2/day for P0/P1 with 1 per draft per hour, `builder_job` 0). The UTC day rolls over, and per-net caps are 4× the P0 row. `settle` enqueues a `SpendEvent` to the `SPEND` queue. Every refusal writes the server-only telemetry event `quota.block`.
- **`EncounterDO`** (`enc:<pid>:<npcId>:<encounterId>`, `09-backend.md` §3.2): `begin` returns history or `busy`, `turn_cap` (12 default, hard 20), `cadence` (< 1.5 s) or `killed`. `complete` stores the user/assistant pair; `abort` drops the turn, so history always alternates. `kill` refuses new turns immediately and signals in-flight streams. The `alarm` fires 60 s after the last turn: transcript JSONL to PRIVATE `transcripts/<encounterId>.jsonl`, an `encounter_transcripts` row, and a `summarize` message on `JOBS` (its consumer lands in M06a4).
- **SSE transport** (`services/edge/src/npc/sse.ts`): it writes C10 `DialogueEvent`s in order and starts the first-token timer when the upstream starts. If no `line.delta` with text arrives within 4 s, it aborts the upstream, emits `fallback {reason:'timeout'}` and `done`, and calls `EncounterDO.abort('timeout')`. It also ends with `fallback {reason:'killed'}` on a kill signal. The upstream is an injected async iterator, and M06a3 supplies the Anthropic one.
- **Migration `0003_npc.sql`** verbatim from `09-backend-db.md` §3.3, including the C12 1.1 recency scale of 518,400 in `match_npc_memories`. The `DataPort.npcMemory` and `roster` stores are implemented in both ports.
- **Route 30** `GET /roster` → `RosterFlags`: ETag, 304, `Cache-Control: no-cache`. `src/flags/roster.ts` reads `roster_flag` through `DataPort.roster` (Postgres) with a 10 s in-memory isolate cache, so Postgres sees at most one read per isolate per 10 s; when that read fails it serves KV `roster:flags` (the copy route 46 writes), never an empty list. `isKilled` for routes 31–33 uses the same source and cache. KV is never on the live path because it can lag 60 s or more (DL-557).
- **Route 46** `POST /admin/roster/:npcId/kill` (staff:admin; `OPS_TOKEN` until M12a1) writes the `roster_flag` row and `audit_log`, rewrites the KV `roster:flags` fallback copy, drops this isolate's roster cache, and broadcasts `EncounterDO.kill` to the open encounters of that NPC. To find the open encounters, an `EncounterDO` instance named `enc:index:<npcId>` keeps the set of open instance names: `begin` registers, close unregisters, and `kill` fans out from it. No third DO class is added, because the lifecycle tag covers only these two. `KillPurgeWorkflow` is called through an interface whose M06a1 body logs `purge: lands in M10b`.
- **Route 47** `PUT /admin/flags/:flag` (`ks:*`, features): validated names from `09-backend-db.md` §5, KV write, audited.
- **Route 14** `GET /me` (`IdentityStateDTO`), `GET /me/export` (a ZIP of every row and R2 object keyed by the profile; 7-day presigned link once the export job finishes, within 24 h), and `DELETE /me` (`profiles.deleted_at`, `forget` job on `JOBS`, then cascade and R2 prefixes `transcripts/`, `exports/`, `saves/` within 24 h).
- **Retention crons** (`09-backend-db.md` §7): 03:10 transcripts, 03:20 `npc_memory` and `npc_relationship`, 03:30 stub profiles. Each one can also be triggered through `/_test/run-scheduled?job=<name>`.
- **Lifecycle:** the DO tag `web-v2` (`new_sqlite_classes: ["EncounterDO","PlayerQuotaDO"]`) ships first in its own PR with only the class skeletons, their exports and the tag (`09-backend-ops.md` §1.2), deployed with `wrangler deploy`. The logic follows in the milestone PR.

## Scope out
- Route 31 talk, prompt assembly, model routing and safety: M06a3. Memory writes and summaries, TTS, route 52: M06a4. Route 32: M06c. Builder routes: M06b1.
- AI Gateway layer-2 rules, vendor caps and the recon cron: M14b1. `KillPurgeWorkflow` and the R2 purge drill: M10b.
- Staff JWTs and `staff_roles` checks: M12a1. Until then `OPS_TOKEN` (M05b1) stands in.

## Deliverables
- `supabase/migrations/0003_npc.sql`; `supabase/tests/{memory_match.sql, server_only.sql (extended), forget_cascade.sql}`.
- `packages/shared/src/data-port.ts` and `data-port.memory.ts` (the `npcMemory`, `roster` and `profiles.exportAll/forget` members); `services/edge/src/data/supabase/{npc-memory.ts, roster.ts, profiles.ts}`; `packages/shared/src/db.gen.ts` (regenerated).
- `services/edge/src/id/{playtoken.ts, tofu.ts, nethash.ts}`; `services/edge/src/budget/QuotaDO.ts`; `services/edge/src/npc/{EncounterDO.ts, sse.ts}`; `services/edge/src/flags/{roster.ts, admin.ts}`; `services/edge/src/routes/{roster.ts, me.ts, admin-roster.ts, admin-flags.ts}`; `services/edge/src/ops/{retention.ts, forget.ts, export.ts}`.
- `services/edge/test/{play-token.test.ts, quota-turns.test.ts, encounter-server-history.test.ts, sse-transport.test.ts, killswitch.test.ts, flags-admin.test.ts, roster.test.ts, forget.test.ts, retention.test.ts}`.
- `services/edge/wrangler.jsonc`: DO bindings `ENCOUNTER` and `QUOTA`, migration `web-v2`, `JOBS` and `SPEND` queue producers and consumers (create the queues through `deploy:bootstrap` if M05b1 did not), `secrets.required` adds `PLAY_TOKEN_HMAC` (first added here; M04b3 leaves it out, DL-679) and `QUOTA_NET_SALT_SECRET`, crons `10 3 * * *`, `20 3 * * *`, `30 3 * * *`, all repeated under `previews` where allowed.
- `tools/ci/deploy.ts` (`writeSecrets` maps `PLAY_TOKEN_HMAC` and `QUOTA_NET_SALT_SECRET` from the environment) and its case in `tools/ci/test/deploy.test.ts` (DL-679).
- `config/guardrails.yaml` (`npc:` quota and estimate section; created here if absent), `packages/shared/schemas/telemetry/names.schema.json` (`quota.block`).
- About 38 files.

## Interfaces
- C12 1.1: routes 5 (verification and TOFU), 14, 30, 46, 47; `PlayTokenClaims`, `RosterFlags`, `KillScope`, `PlayerQuota`, `DataPort.npcMemory` and `roster`; migration 0003. Shapes copied.
- C10 1.0: `DialogueEvent` (writer side only), `MemoryWrite`, `MemoryHit`, `SummaryPatch` types imported.
- C16 1.1: `quota.block` (server-only).
- `check:do-migrations` must label the lifecycle PR. M05b1 widened it to accept DO class files plus their export lines (DL-233), so the `web-v2` PR passes as written.

## Acceptance criteria
- AC-1 Given a pid whose first token was signed by key K1 When the first server write arrives Then a `device_keys` row binds K1's thumbprint; a later token request for the same pid signed by K2 gets 403; a token signed with `PLAY_TOKEN_HMAC_PREV` still verifies inside the 24 h window and fails after it — proof: `pnpm check:workers -- play-token`
- AC-2 Given a P0 profile When it reserves its 151st `turn` of the UTC day Then the result is `{ok:false, reason:'quota'}`; the 41st turn for one NPC is `per_npc`; the reservation that would cross $0.05 is `cost_cap`; the counters reset at 00:00 UTC; and each refusal writes one `quota.block` point — proof: `pnpm check:workers -- quota-turns`
- AC-3 Given an encounter When a turn begins while another is streaming, two begins arrive 1.2 s apart, and 13 turns are attempted Then the results are `busy`, `cadence` and `turn_cap` in turn; an aborted turn is absent from the next `begin` history, which alternates user/assistant — proof: `pnpm check:workers -- encounter-server-history`
- AC-4 Given an encounter idle for 60 s When its alarm fires Then `transcripts/<encounterId>.jsonl` exists in the PRIVATE stub, an `encounter_transcripts` row with `expires_at = closed_at + 30 d` exists, and one `summarize` message is on `JOBS` — proof: `pnpm check:workers -- encounter-server-history`
- AC-5 Given an upstream iterator that yields its first text after 5 s When the SSE transport runs under a mocked clock Then the client receives `meta`, `fallback {reason:'timeout'}` and `done` at 4.0 ± 0.2 s, and the upstream is aborted; an iterator that yields at 1 s produces `meta`, `line.delta`…, `line.done`, `effects`, `done` in that order — proof: `pnpm check:workers -- sse-transport`
- AC-6 Given an open streaming encounter with `npc_test` When `POST /admin/roster/npc_test/kill {scope:['all']}` arrives with `OPS_TOKEN` Then the stream ends with `fallback {reason:'killed'}` within 1 s, the next `begin` returns `killed`, `/roster` lists `npc_test` within 10 s of mocked time with the KV stub never updated (stale), and one `audit_log` row exists — proof: `pnpm check:workers -- killswitch`
- AC-7 Given a request without `OPS_TOKEN` and one with an unknown flag name When route 47 is called Then the responses are 401 and 400; a valid `ks:anthropic` write lands in KV and in `audit_log` — proof: `pnpm check:workers -- flags-admin`
- AC-8 Given `/roster` returned ETag E When it is requested again with `If-None-Match: E` and no flag change Then the response is 304, and after a kill the ETag differs; with the Postgres port failing, the response is 200 from KV `roster:flags` — proof: `pnpm check:workers -- roster`
- AC-9 Given a profile with memories, a relationship, a transcript and an export When `DELETE /me` completes and the forget job runs Then no row keyed by that profile remains in any table and its R2 prefixes are empty; `match_npc_memories` orders a fixture by 0.5 relevance + 0.3 importance + 0.2 recency with the 518,400 scale — proof: `pnpm check:db && pnpm check:workers -- forget`
- AC-10 Given rows past their retention When `/_test/run-scheduled` runs `transcripts`, `memory` and `stub-profiles` Then only expired rows and objects are deleted, and fresh rows stay — proof: `pnpm check:workers -- retention`
- AC-11 Given the production build When it is scanned Then no `/_test/` handler and no secret pattern exists — proof: `pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`
- AC-12 Given the lifecycle PR and the logic PR When both merge to `main` Then the first is labelled `do-lifecycle` and deployed with `wrangler deploy` (rollback floor printed), the second deploys through versions, and staging smoke passes — proof: manual: desktop browser, GitHub Actions › deploy, read both run summaries; then `pnpm check:smoke -- <staging workers.dev URL>`

## Test plan
- **Workers runtime:** `play-token`, `quota-turns`, `encounter-server-history`, `sse-transport`, `killswitch`, `flags-admin`, `roster`, `forget`, `retention` — `pnpm check:workers` (each file runs alone with `-- <name>`).
- **DB:** `memory_match`, `forget_cascade`, extended `server_only` — `pnpm check:db`; `pnpm check:db:types`.
- **Static:** `pnpm check:prod-routes`, `pnpm check:secrets -- apps/web/dist`, `pnpm check:telemetry`.

## Demo script
1. `pnpm check:workers -- quota-turns`: read the 151st-turn refusal.
2. `pnpm check:workers -- killswitch`: the stream ends with `fallback killed`.
3. `pnpm dev`; `curl -i localhost:8788/api/v1/roster` twice with the ETag: 200, then 304.
4. `pnpm check:db`: `memory_match` passes.

## Effort
1 Builder session; about 38 files; risk **medium** (two new DO classes and their lifecycle PR, mocked clocks in the Workers pool).

## Risks & fallbacks
- **Workers pool cannot fake timers inside DOs:** inject a `Clock` into `EncounterDO`, `QuotaDO` and the transport, and drive it from tests. The proofs stay the same.
- **Queues unavailable in Previews** (F-061): queue and cron work is reached through `/_test/*`. Previews never run consumers.
- **KV propagation ≥ 60 s:** KV is off the live path (Postgres read, 10 s cache); the immediate stop for open talks is the DO broadcast. Only during a Postgres outage does route 30 fall back to KV, when removal outside the writing location can exceed 60 s; that window is logged (`roster.source = 'kv'`) and named in the M10b drill report.
- **AI Gateway catalog coverage of the 5.5 models (U-BE-17):** irrelevant here. Our ledger, from `usage`, is the source of spend.

## Notes for the Builder
- Read first: `09-backend.md` §3.2 and §5.1–§5.3; `09-backend-contracts.md` §2.3–§2.6; `09-backend-db.md` §3.3, §5–§7; `09-backend-ops.md` §1.2, §3, §5.2–§5.3, §6; `spec/05-api-and-realtime.md` §4.8.
- **Secrets:** `PLAY_TOKEN_HMAC` (+ `_PREV`), `QUOTA_NET_SALT_SECRET`, `SUPABASE_SECRET_KEY` (Worker, via `--secrets-file`), `OPS_TOKEN` (M05b1). If M04b3 minted with a development key, rotate to `PLAY_TOKEN_HMAC` here. Missing locally: stub in `.dev.vars` with a test value. Deploys (DL-679): `tools/ci/deploy.ts` `writeSecrets` maps `PLAY_TOKEN_HMAC` and `QUOTA_NET_SALT_SECRET` from the GitHub secrets into `$RUNNER_TEMP/secrets.json` (a unit case in `tools/ci/test/deploy.test.ts` asserts the keys, never values); because both are in `secrets.required`, a missing secret fails `versions upload` [research/gap-ci-cd-release-assets.md §0 item 4] rather than skipping, so the operator sets the GitHub secrets and, for Previews, `wrangler preview base-config secret put` for each before this PR's first Preview, and the report records whether `wrangler preview` enforced `secrets.required` (U-BE-22).
- Under-18 guard: no `age: '18p'` claim means no token, so nothing is stored (D-30). Add a test that a token without `18p` is refused.
- Order: lifecycle PR → 0003 and the ports → quota → encounter → transport → roster, kill and flags → `/me` → crons → CI.
- Branches `m06a1-npc-backend-spine-do` (lifecycle) and `m06a1-npc-backend-spine`.

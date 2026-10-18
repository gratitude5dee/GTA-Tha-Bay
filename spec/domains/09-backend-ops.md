# 09 — Backend, Data & Multiplayer · Part 4: deploy, CI/CD, secrets, abuse controls, observability, cost guardrails

> S09, Wave 1, 2026-10-18. Part of `spec/domains/09-backend.md` (§3 Components and §5 Runtime, operations half). S13 consolidates CI into `spec/08-test-and-ci.md` and costs into `spec/10-cost-model.md`; this part is the backend's source for both.

## 1. Workers, bindings and environments

### 1.1 Deployable units (spec/03 A-01)
| Worker | Package | Owns | Why separate |
|---|---|---|---|
| `tha-bay-web` | `services/edge` (imports `services/pipeline`) | static assets (SPA, `_headers`), `/api/v1/*`, `id.<domain>` issuer, `EncounterDO`, `PlayerQuotaDO`, `BudgetGovernorDO`, `CutsceneJobDO`, `FalGateDO`, `GenJobWorkflow`, Queue consumers, Cron Triggers | UI and API ship often |
| `tha-bay-rooms` | `services/rooms` | `rt.<domain>`: `RoomDO`, `DirectoryDO`, `PresenceDO`, room REST, upgrade gate | a deploy restarts every DO of the deployed script and drops its WebSockets [research/stack-cloudflare-backend.md §1.3]; rooms deploy only when `services/rooms/**` or `packages/net/**` changes, inside a drain window |

`services/pipeline` is a library compiled into `tha-bay-web` (no cross-Worker service binding, because a Preview's service bindings call production [research/gap-ci-cd-release-assets.md §1.5]). The web Worker never calls a rooms DO; the client talks to `rt.<domain>` directly. Rooms call the web Worker only for `progress.commit` over HTTPS with a service token (`INTERNAL_HMAC`), never by binding.

### 1.2 `services/edge/wrangler.jsonc` (normative content; key names marked † must be checked against the `wrangler@4.151.1` schema in M00 [research/stack-cloudflare-backend.md Unverified])
```jsonc
{
  "name": "tha-bay-web", "main": "src/index.ts", "compatibility_date": "2026-10-18",
  "assets": { "directory": "../../apps/web/dist", "binding": "ASSETS",
              "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "routes": [ { "pattern": "<domain>", "custom_domain": true }, { "pattern": "id.<domain>", "custom_domain": true } ],
  "workers_dev": false, "preview_urls": false,
  "durable_objects": { "bindings": [
    { "name": "ENCOUNTER", "class_name": "EncounterDO" }, { "name": "QUOTA", "class_name": "PlayerQuotaDO" },
    { "name": "GOVERNOR", "class_name": "BudgetGovernorDO" }, { "name": "CUTSCENE_JOB", "class_name": "CutsceneJobDO" },
    { "name": "FAL_GATE", "class_name": "FalGateDO" } ] },
  "migrations": [ { "tag": "web-v1", "new_sqlite_classes": ["CutsceneJobDO", "FalGateDO", "BudgetGovernorDO"] },      // M05b
                  { "tag": "web-v2", "new_sqlite_classes": ["EncounterDO", "PlayerQuotaDO"] } ],                       // M06a
  "r2_buckets": [ { "binding": "MEDIA", "bucket_name": "tha-bay-media-prod" }, { "binding": "PRIVATE", "bucket_name": "tha-bay-private-prod" },
                  { "binding": "UGC_STAGING", "bucket_name": "ugc-staging-prod" }, { "binding": "UGC_PUBLIC", "bucket_name": "ugc-public-prod" },
                  { "binding": "UGC_QUARANTINE", "bucket_name": "ugc-quarantine-prod" }, { "binding": "EVIDENCE", "bucket_name": "legal-evidence-prod" } ],
  "kv_namespaces": [ { "binding": "FLAGS", "id": "<prod-kv-id>" } ],
  "queues": { "producers": [ { "binding": "JOBS", "queue": "tha-bay-jobs" }, { "binding": "SPEND", "queue": "tha-bay-spend" },
                             { "binding": "UGC_SCAN", "queue": "tha-bay-ugc-scan" } ],
              "consumers": [ { "queue": "tha-bay-jobs", "max_batch_size": 50 }, { "queue": "tha-bay-spend", "max_batch_size": 100 },
                             { "queue": "tha-bay-ugc-scan", "max_batch_size": 10 } ] },
  "workflows": [ { "name": "gen-job", "binding": "GEN_WF", "class_name": "GenJobWorkflow" } ],                           // †
  "analytics_engine_datasets": [ { "binding": "AE", "dataset": "tha_bay_telemetry" }, { "binding": "AE_SPEND", "dataset": "tha_bay_spend" } ],  // †
  "analytics": { "binding": "ANALYTICS_SQL" },                                                                           // † (Wrangler ≥ 4.145.0)
  "ai": { "binding": "AI" },
  "ratelimits": [ /* one entry per class in §3.1, e.g. { "name": "RL_TALK", "namespace_id": "1001", "simple": { "limit": 4, "period": 10 } } */ ],  // †
  "triggers": { "crons": ["*/5 * * * *", "10 3 * * *", "0 * * * *"] },        // SLA pager + recon; retention; hourly expiries
  "observability": { "enabled": true, "logs": { "enabled": true, "head_sampling_rate": 0.25, "invocation_logs": true },
                     "traces": { "enabled": true, "head_sampling_rate": 0.05 }, "issues": { "enabled": true } },          // †
  "vars": { "ENVIRONMENT": "prod", "GEO_ALLOW": "US", "PUBLIC_ORIGIN": "https://<domain>", "ID_ISSUER": "https://id.<domain>",
            "RT_ORIGIN": "https://rt.<domain>", "MEDIA_ORIGIN": "https://media.<domain>", "SUPABASE_URL": "https://<ref>.supabase.co",
            "FAL_MODE": "live", "AIG_BASE": "https://gateway.ai.cloudflare.com/v1/<account>/gw-dialogue/anthropic" },
  "secrets": { "required": ["SUPABASE_SECRET_KEY", "PLAY_TOKEN_HMAC", "ID_SIGNING_JWK_CURRENT", "ID_SIGNING_JWK_NEXT",
               "INTERNAL_HMAC", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "FAL_KEY", "ANTHROPIC_API_KEY"] },             // † grows per milestone
  "env": { "staging": { "name": "tha-bay-web-staging", "preview_urls": true, "vars": { "ENVIRONMENT": "staging", "FAL_MODE": "mock" } /* + staging bindings */ } },
  "previews": { /* staging bindings repeated: MEDIA → tha-bay-media-staging, FLAGS → staging KV, JOBS/SPEND/UGC_SCAN producers → staging queues,
                   GEN_WF → deployed staging workflow, DO bindings repeated, vars.ENVIRONMENT = "preview" */ }
}
```
Each new migration tag ships in its own PR labelled `do-lifecycle`, containing only the class skeleton, the export and the tag (deployed with `wrangler deploy`); the logic follows in a normal PR.

`services/rooms/wrangler.jsonc` mirrors it with: route `rt.<domain>`; DO bindings `ROOM`, `DIRECTORY`, `PRESENCE`; migration `rooms-v1` `new_sqlite_classes: ["RoomDO","DirectoryDO","PresenceDO"]` (M12b); `FLAGS` KV; `AE` dataset; `RL_ROOMS`; observability `logs.head_sampling_rate: 0.001`, `invocation_logs: false` (an unsampled busy room would ingest ≈ 830 GB of logs a month after the 2026-12-01 pricing change [research/gap-observability-cost-guardrails.md §1.3]); secrets `ROOM_TICKET_HMAC`, `ROOM_RESUME_HMAC`, `INTERNAL_HMAC`, `SUPABASE_SECRET_KEY`; vars `ID_ISSUER`, `GEO_ALLOW`, `BUILD_ID` (set by CI), `CAP` (16).

### 1.3 Environments
| Env | Workers | Data | Hosts | Generation |
|---|---|---|---|---|
| dev | `wrangler dev` / Vite plugin, Miniflare DOs | Supabase CLI local stack | `localhost` | `FAL_MODE=mock`, Anthropic via staging key or recorded fixtures |
| preview (per PR) | `wrangler preview --env staging --name pr-<N>` for each changed Worker | staging project, staging buckets/queues/KV, fresh DO namespaces | `*.workers.dev` (noindex) | mock |
| staging | `tha-bay-web-staging`, `tha-bay-rooms-staging` | Supabase staging project (Free OK, keep-alive nightly) | `staging.<domain>`, `id-staging.<domain>`, `rt-staging.<domain>`, `media-staging.<domain>` | mock by default; `synthetic` Anthropic workspace for M14b |
| prod | `tha-bay-web`, `tha-bay-rooms` | Supabase Pro `us-west-1` | `<domain>`, `id.`, `rt.`, `media.`, `ugc.` | live |

Inside a Preview, Queue consumers, Cron Triggers and production routes do not run and Workflow bindings point at an existing Workflow; every queue/cron feature therefore has a `/api/v1/_test/*` route (compiled out of prod, proven by `check:prod-routes`) [research/gap-ci-cd-release-assets.md §1.5].

## 2. CI/CD (spec/03 D-27)
GitHub Actions, actions pinned by SHA, `runs-on: ubuntu-24.04`, `permissions: contents: read` by default [research/gap-ci-cd-release-assets.md R3]. Backend-relevant scripts (root `package.json`; S13 owns the full list):

| Script | Does |
|---|---|
| `check:workers` | Vitest with the Cloudflare Workers pool for `services/edge`, `services/rooms` (DOs, routes, codecs) |
| `check:db`, `check:db:types` | Part 3 §8 |
| `check:api` | regenerates `packages/shared/schemas/api/*.schema.json` from `v1.ts` and diffs; fails on drift |
| `check:telemetry` | privacy lint: no `request.headers` logging, no forbidden props, every `TelemetryName` has a schema |
| `check:do-migrations` | a PR that changes `migrations`/DO classes in any `wrangler.jsonc` must change nothing else; labels it `do-lifecycle` |
| `check:prod-routes` | builds prod bundles and asserts no `/_test/` handler and `FAL_MODE` ≠ `mock` |
| `check:secrets` | secret patterns incl. `cfat_`, `cfut_`, `cfk_`, `sbp_`, `sb_secret_`, `sk-ant-`, fal keys |
| `deploy:preview` | `wrangler preview --env staging --name pr-$PR --json` per changed Worker |
| `deploy:prod` | `tools/ci/deploy.ts` (below) |
| `db:push` | `supabase link` → `db push --dry-run` (to job summary) → `db push` |
| `auth:tpa` | Part 3 §8 |
| `rooms:drain` | `POST /api/v1/_ops/rooms/drain` and wait 30 s |

**Deploy pipeline (`deploy.yml`; push to `main` → staging; tag `v*` or `workflow_dispatch` by an allowlisted actor → prod):**
1. `db:push` (migrations are expand-only within a release; a column drop ships one release after the code stops reading it).
2. If `services/rooms/**` or `packages/net/**` changed: `rooms:drain`, then `wrangler deploy` of `tha-bay-rooms` (rooms use plain deploys: a gradual split cannot help sockets that are already restarted; deploys happen in the drain window 10:00–12:00 UTC on weekdays, outside SF evening play).
3. Web Worker: `wrangler versions upload --tag <sha12> --secrets-file $RUNNER_TEMP/secrets.json` → `versions deploy NEW@0% OLD@100%` → `check:smoke` with `Cloudflare-Workers-Version-Overrides` → `NEW@100%` (v1; the 10/50/100 gradual path is enabled from M12a with input `gradual: true`) → on failure `wrangler rollback OLD`. A `do-lifecycle` PR takes `wrangler deploy` instead and records a rollback floor (rollback cannot cross a DO lifecycle change) [research/gap-ci-cd-release-assets.md §1.4].
4. Version affinity: a zone Transform Rule sets `Cloudflare-Workers-Version-Key` from a cookie the Worker sets, created by the M00 bootstrap runbook through the Rulesets API, before the first split.
5. API compatibility: `/api/v1` changes are additive; a client older than `minClientBuild` gets `build_mismatch` and runs the PWA update flow.

CI auth: Cloudflare has no OIDC for CI; use account API tokens with a TTL, split `CF_API_TOKEN_DEPLOY` (Workers Editor), `CF_API_TOKEN_ASSETS` (R2), `CF_API_TOKEN_CACHE` (purge) [research/gap-ci-cd-release-assets.md §1.3]. First creation of each Worker is a one-time `pnpm deploy:bootstrap` by the operator with an Admin token (`versions upload` cannot create a Worker).

## 3. Abuse controls and rate limits

### 3.1 Rate-limit classes (Workers Rate Limiting binding; per-location and eventually consistent, so spam control only [research/stack-cloudflare-backend.md §1.10])
| Class | Binding | Key | Limit / period | Exact cap behind it |
|---|---|---|---|---|
| api | `RL_API` | pid, else netHash | 120 / 60 s | — |
| auth | `RL_AUTH` | netHash | 10 / 60 s | play-token and register also count in `PlayerQuotaDO q:n:*` (50 tokens/day per net) |
| talk | `RL_TALK` | pid | 4 / 10 s | `PlayerQuotaDO` turns/day |
| tele | `RL_TELE` | sessionId | 20 / 60 s | body ≤ 64 KiB, ≤ 50 events |
| ugc | `RL_UGC` | pid | 10 / 60 s | uploads/day in `PlayerQuotaDO` (device 20, linked 100) |
| forum | `RL_FORUM` | pid | 2 / 60 s | posts/day 20 for profiles < 7 days old, else 100; 1 post/30 s enforced in DO |
| report | `RL_REPORT` | pid | 5 / 60 s | reports/day 30 |
| legal | `RL_LEGAL` | netHash | 5 / 60 s | — (never block NCII intake below 1/min) |
| rooms | `RL_ROOMS` (rooms Worker) | pid | 10 / 60 s | per-socket token bucket 40/30 s⁻¹ (C11) |

### 3.2 Controls by threat
| Threat | Control |
|---|---|
| Junk WebSocket upgrades billing DOs | verify ticket, build, geo and rate limit in the rooms Worker before `stub.fetch` [research/stack-cloudflare-backend.md §4.2] |
| Forged ids / speed hacks | server-assigned `sid`/`slot`, seq monotonicity, pose validation, kick after 10 rejections/10 s (C11 §1.7) |
| Minting many P0 profiles for quota | device-key proof + TOFU binding; per-net daily caps; `BudgetGovernorDO` bounds total spend |
| Account-farming at P1 | Turnstile on `register` (verification API UNVERIFIED; M12a spike), 3 registrations per net per day |
| Jailbreak via forged history | history is server-held in `EncounterDO`; client sends only the new turn (C10 change proposal) |
| Payload abuse | Ajv on every body; size caps (JSON 64 KiB default, uploads by purpose: image ≤ 10 MiB, archive ≤ 128 MiB, backstory ≤ 20,000 chars); magic-byte checks at scan |
| Denial of wallet | three spend layers (§5), `ks:*` switches, `PlayerQuotaDO` reserve-before-call |
| Webhook forgery | fal ED25519 signature against the fal JWKS (strip `=` padding, ±300 s, cache ≤ 24 h) [research/genai-pipeline-fal.md §2]; failures alert A11 |
| Staff-route abuse | `scp` claims re-checked against `staff_roles` on every call; every admin write → `audit_log` |
| Region | `request.cf.country ∉ GEO_ALLOW` → `region_blocked` on all routes except `/boot`, `/legal/*`, `/.well-known/*`; rooms close 4006 [research/legal-ip-likeness.md §8 P7] |
| Age | no `18p` attestation → no play token, no registration (D-30); the neutral screen is S10's |

## 4. Observability and alerting
Design per [research/gap-observability-cost-guardrails.md Rec 1]:
- **Client → `/api/v1/t`** (C16) → Analytics Engine `tha_bay_telemetry` (`index1` = event name). The ingest path writes no Workers log lines.
- **Server metrics** → AE: `room.tick` every 10 s per room, `genai.cost` per settled call (`tha_bay_spend`), `quota.block`, `genjob.state`, `budget.level`, `auth.event` (`register|refresh|reuse_detected|link|merge`).
- **Errors** → Workers Issues (source maps uploaded by `deploy.ts`).
- **Logs/traces**: web 0.25 / 0.05; rooms 0.001 with no invocation logs; staging 1.0. OTel export off.
- **Alert sink**: `POST /api/v1/_ops/alerts` (HMAC `ALERT_HMAC` or Custom Alerts webhook secret) stores the alert in `audit_log` and forwards to `ALERT_WEBHOOK_URL` (chat). Custom Alerts (beta) run 1-minute SQL over AE and deliver by webhook; Budget alerts are email-only and next-day, so they are a backstop [research/gap-observability-cost-guardrails.md §1.5].
- **Dashboards**: `/admin/dash/{client,edge,spend,pipeline,recon}` read AE through the `ANALYTICS_SQL` binding (no API token) — D1–D5.

Backend-owned alerts (starting thresholds; S13 finalizes): S01 spend 50/70/85/100 % of daily ceiling; S02 ledger vs vendor drift > 10 % for 2 runs; S03 hourly spend z > 4; S04 quota bypass ≥ 1; S05 vendor cap hit; S06 fal balance < 3 days (warn) / < 1 day (page); S09 uncached cutscene generations > 20/day; A01 Worker 5xx > 1 % over 5 min; A07 `room.tick.p99Ms` > 10 ms for 5 min (warn) / > 16 ms (page); A08 room-hours/day > 2× 7-day mean; A09 queue backlog > 10k or oldest > 10 min; A10 GenJob errors > 5/h; A11 webhook signature failure ≥ 1 in 15 min; A12 telemetry 429/413 > 5 %; plus T&S: P0 case open > 15 min unassigned (page), NCII case at 24 h / 36 h / 40 h (re-page, escalate) [research/gap-trust-safety-tooling.md §6.5].

## 5. Cost guardrails (spec/03 D-28, G3)

### 5.1 Ceilings (G3, applied 2026-10-18)
Recurring $500/month ≈ $16.50/day: Anthropic $350 (≈ $11.67/day), voice $100 (≈ $3.33/day), moderation $25 (≈ $0.83/day), buffer $25. One-off production fal credit $1,000. Public fal spend $0 (generation internal-only) [research/INDEX.md §7]. All values live in `ops/guardrails.yaml`, the single source read by the governor, the quota DO and the nightly drift check.

### 5.2 Per-player quotas (`PlayerQuotaDO`, day = UTC)
| Quota | P0 `local` / P1 `device` | P2/P3 `linked` (18+) |
|---|---|---|
| NPC dialogue turns | 150 | 400 |
| Turns per NPC | 40 | 40 |
| Voiced lines | 60 | 200 |
| Cost cap | $0.05 | $0.15 |
| NPC builder jobs (fal-backed) | 0 | 3 (Lean build 1/day) |
| User cutscene generation | 0 | 0 |
Source [research/INDEX.md §7], [research/gap-observability-cost-guardrails.md Rec 2.3]. Per-net caps (`q:n:*`) are 4× the P0 row.

### 5.3 Three layers
```ts
// services/edge/src/budget/types.ts
export type Vendor = 'anthropic' | 'fal' | 'elevenlabs' | 'workers_ai' | 'openai_moderation';
export type GovLevel = 0 | 1 | 2 | 3;           // L1 ≥ 70 %: Sonnet→Haiku · L2 ≥ 85 %: voice→T1 · L3 ≥ 100 %: genAI off (cache hits still served)
export interface PlayerQuota {                  // PlayerQuotaDO RPC
  reserve(r: { kind: 'turn' | 'voice_line' | 'builder_job' | 'upload' | 'post' | 'report'; npcId?: string; estMicros: number }):
    Promise<{ ok: true; reservationId: string } | { ok: false; reason: 'quota' | 'cost_cap' | 'per_npc' }>;
  settle(reservationId: string, actualMicros: number): Promise<void>;   // also enqueues to SPEND queue
  usage(): Promise<Record<string, number>>;
}
export interface BudgetGovernor {               // BudgetGovernorDO RPC (singleton per env)
  level(): Promise<{ level: GovLevel; byVendor: Record<Vendor, number /* % of daily ceiling */> }>;
  reserve(v: Vendor, estMicros: number, jobId: string): Promise<{ ok: boolean; level: GovLevel }>;   // synchronous for fal/builder jobs
  settle(jobId: string, actualMicros: number, requestId?: string): Promise<void>;
  ingest(batch: SpendEvent[]): Promise<void>;   // from SPEND queue (dialogue path, batched 100 / 5 s)
  forceLevel(l: GovLevel, by: string, reason: string): Promise<void>;
}
export interface SpendEvent { ts: number; vendor: Vendor; model: string; kind: string; usdMicros: number; settled: boolean; requestId?: string; jobId?: string; env: string }
```
- **Layer 3 (ours, authoritative)**: quota reserve → call → settle from `usage`; governor publishes `gov:level` to KV on each transition and every 60 s; Workers read it with `cacheTtl: 30`. Rule: kill switches and budget levels never block cache hits (cached R2 cutscene, cached TTS, baked barks always served) [research/gap-observability-cost-guardrails.md Rec 2.3].
- **Layer 2 (AI Gateway, Anthropic only)**: `gw-dialogue` with cache, Guardrails and response DLP off (they buffer SSE), Unified Billing off, `cf-aig-collect-log-payload: false`; spend rules: global daily = 1.0 × ceiling, per-`pid` metadata split $0.20/day, Sonnet 0.4 × ceiling; Dynamic Route Sonnet → Haiku [research/gap-observability-cost-guardrails.md §5, Rec 2.2]. S04 owns the request body; S09 owns gateway config in `ops/guardrails.yaml`.
- **Layer 1 (vendor)**: Anthropic workspaces `npc-runtime` (1.2 × monthly ceiling), `npc-builder` (0.2×), `ci-evals` ($50), `synthetic` (minimum), Console notifications at 50/80 %; map 400 "You have reached your specified…" → `vendor_cap:anthropic` and 429 `enforced_spend_limit_reached` → no retry; fal prepaid balance ≤ 30 days of budget with per-use keys and allowed-model lists; ElevenLabs service-account keys with `character_limit` and `max_credit_limit_extension = 0` [research/gap-observability-cost-guardrails.md §3–§7].
- **Reconciliation cron** (every 5 min): Anthropic Usage API (1-min buckets), fal `/v1/models/usage`, ElevenLabs analytics query → `recon.drift`; > 10 % for 2 runs → S02 and vendor totals become truth.

### 5.4 Infrastructure cost (list prices; consolidate in spec/10)
| Item | 1k MAU | 10k MAU | 100k MAU | Source |
|---|---|---|---|---|
| Cloudflare (Workers Paid base $5, DO, R2, Queues, AE) | ≈ $6 | ≈ $30 | ≈ $300 | [research/stack-cloudflare-backend.md §9] |
| Supabase Pro + compute | ≈ $25 | ≈ $30 | ≈ $90–100 | same |
| Logs/traces after 2026-12-01 (rooms sampled 0.001) | $0 | $0 | ≈ $4.54 | [research/gap-observability-cost-guardrails.md §1.3] |
| Full 16-player room-hour | ≈ $0.014 | | | [research/stack-cloudflare-backend.md §4.7] |
| Thirdweb (from M14a, Growth) | $99 | $129 | $534 | [research/auth-ugc-input-maps.md §2.3] |
DO duration dominates at scale; AFK stop, empty-room GC and ack-lag kicks are the levers (A08).

## 6. Secrets (Wrangler secrets only; the DB vault is not used in v1)
| Secret | Worker | Milestone | Rotation |
|---|---|---|---|
| `PLAY_TOKEN_HMAC` (+ `_PREV`) | web | M06a | 90 d, dual-key window 24 h |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`) | web, rooms | M05d / M12b | 90 d |
| `ID_SIGNING_JWK_CURRENT`, `ID_SIGNING_JWK_NEXT` (ES256 private JWK) | web | M12a | 90 d, ≥ 30 min overlap |
| `ROOM_TICKET_HMAC`, `ROOM_RESUME_HMAC`, `INTERNAL_HMAC` | rooms (+ web for ticket/internal) | M12b | 90 d |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (bucket-scoped, for presigning) | web | M06b | 90 d |
| `FAL_KEY` (runtime, allowed-models list), `FAL_KEY_BILLING` | web | M05b / M14b | 90 d expiry set at creation |
| `ANTHROPIC_API_KEY` (workspace `npc-runtime`), `ANTHROPIC_ADMIN_KEY` (Usage API) | web | M06a / M14b | 90 d |
| `ELEVENLABS_API_KEY` (service account, `character_limit`) | web | S04 voice milestone | 90 d |
| `OPENAI_MODERATION_KEY` | web | M06b | 90 d |
| `TURNSTILE_SECRET` | web | M12a | yearly |
| `OPENAI_OIDC_CLIENT_SECRET` (flag `AUTH_OPENAI_WEB`) | web | M13c (only if OpenAI grants a client) | per OpenAI |
| `NCMEC_API_CREDENTIALS`, `PHOTODNA_KEY` | web | M13d (after program approval) | per program |
| `ALERT_HMAC`, `ALERT_WEBHOOK_URL`, `QUOTA_NET_SALT_SECRET` | web | M14b / M06a | 90 d |
| `OPS_TOKEN` (bearer for staff/CI routes before staff JWTs exist; removed in M12a) | web | M05b | 30 d |

CI writes secrets JSON to `$RUNNER_TEMP` and passes `--secrets-file` to `versions upload`, so code and secrets move together and rollback restores both; `wrangler secret put` is never used in the pipeline (it deploys immediately) [research/gap-ci-cd-release-assets.md §6]. Local dev uses `.dev.vars` (git-ignored). `CLAUDE.md` lists the names only.

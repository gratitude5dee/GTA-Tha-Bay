# M14b1 — launch-hardening-guardrails

## Goal
After this session the spend and abuse guardrails are complete, live on staging and proven by tests. **Split boundary (M14b, split 1 of 3):** M14b1 takes configuration, wiring and the release-candidate suite (T1–T3, T7–T9). M14b2 takes the nightly suite (T4–T6, T9), the restore drill, the rollout default and the telemetry audit. M14b3 takes the launch gate.

Afterwards one schema-checked `config/guardrails.yaml` drives the Worker, the gateway rules and the vendor caps; reconciliation, the alert sink and evaluator, the dashboards, vendor error mapping and a synchronous `ks:genai:all` stop are live on staging; and `pnpm test:ops -- --suite guardrails` runs on every release candidate.

## Requirements
- R-ENG-03: caps, budget alarms, reconciliation and kill switches are configured from one file and tested with synthetic spend; nothing generates without a cache check (T2).
- R-NPC-05: per-player limits and the offline fallback hold under abuse (T8) and vendor caps (T3).

## Depends on
- **M13d1** (T&S pages, `audit_log`), **M06a4** (voice tiers, the last genAI spender), **M05b1** (`BudgetGovernorDO`, `_test/*` incl. `spend`, `FAL_MODE=mock`).
- Contracts: C12 1.1 (`BudgetGovernor`, `PlayerQuota`, `SpendEvent`, `GovLevel`, `ApiError`), C16 1.1, C10 1.0 (unchanged).

## Scope in
- **`config/guardrails.yaml`** as the single source (`09-backend-ops.md` §5; research Rec 2), with schema `config/guardrails.schema.json`. Sections:
  - `ceilings`: G3 $500/month, the daily split Anthropic $350 / voice $100 / moderation $25 / buffer $25, all in USD micros.
  - `governor`: levels 70 / 85 / 100 %.
  - `genai`: `programCapUsdMicros` 100,000,000 with alarms 0.5 / 0.8 / 1.0 (DL-OWN-01, DL-171, DL-178) and `falConcurrency` 2. A value above 100,000,000 is valid only with an `ownerApproval: { by, date, ref }` entry, because a raise needs the owner's word (Q-14).
  - `quotas`: the `09-backend-ops.md` §5.2 table, with `builder_job` 0 for every tier.
  - `npc`: the estimate micros already used by M06a3.
  - `gateway`: `gw-dialogue` and `gw-builder` settings; spend rules global 1.0 × daily, per-`pid` $0.20/day, Sonnet 0.4 × daily, `env=synthetic` $0.05/day; Dynamic Route Sonnet → Haiku.
  - `vendors`: Anthropic workspaces `npc-runtime` 1.2 ×, `npc-builder` 0.2 ×, `ci-evals` $50, `synthetic` minimum, notifications 50/80 %. fal: prepaid ≤ 30 days of budget, auto-recharge off, keys `fal-runtime`, `fal-prewarm`, `fal-ci` with allowed-model lists and 90-day expiry, plus a `BILLING` key. ElevenLabs: `character_limit`, extension 0; the row stays dormant while t2 is off (Q-20). Cloudflare budget alerts $25/$100/$250.
  - `alerts`: SP-01…SP-06, SP-09, A01–A12, the T&S pages (P0 unassigned > 15 min; NCII at 24/36/40 h) and the program-cap alarms, each with `id`, `source`, `threshold`, `window`, `severity`, `route`.
  `tools/ci/guardrails-build.ts` (run by `pnpm build`) writes `services/edge/src/ops/guardrails.gen.json`; a unit test fails if it is stale.
- **Alert sink, route 56** `POST /api/v1/_ops/alerts`: HMAC `ALERT_HMAC` over the raw body, ±300 s timestamp. It writes `audit_log`, then forwards to `ALERT_WEBHOOK_URL`. Without that secret it stores the alert, logs `SKIP forward: ALERT_WEBHOOK_URL not set` and returns 204. Identical `(id, window)` alerts within 10 minutes are de-duplicated.
- **Alert evaluator** (`services/edge/src/ops/alerts-eval.ts`): a 1-minute cron runs the `alerts` rules as fixed Analytics Engine SQL through the `ANALYTICS_SQL` binding and posts results to route 56. Governor transitions post SP-01 directly. It is the primary path because Custom Alerts billing and limits are unverified (U-BE-15); Budget email alerts stay the backstop.
- **Dashboards, route 57** `GET /api/v1/admin/dash/:name` (`S:ops`; `client|edge|spend|pipeline|recon`): fixed SQL results as JSON. `client` returns sessions and `app.abnormal_exit` counts per build × device class for M14b2's release gate. DTOs in `packages/shared/src/api/ops.ts`.
- **Reconciliation cron** (`*/5 * * * *`, `services/edge/src/ops/recon.ts`): Anthropic Usage API (`ANTHROPIC_ADMIN_KEY`), fal usage (`FAL_KEY_BILLING`), ElevenLabs only when t2 is on; endpoints only from `research/gap-observability-cost-guardrails.md` §3–§7. It writes `recon.drift` to Analytics Engine. Drift > 10 % for 2 consecutive runs raises SP-02, and the governor adopts the vendor total. A missing key logs `SKIP recon:<vendor>` and is listed by T9.
- **Vendor error mapping** (`services/edge/src/ops/vendor-errors.ts`, used by the Anthropic client of M06a3):
  - Anthropic 400 `invalid_request_error` with a message starting "You have reached your specified" → `vendor_cap:anthropic`.
  - 429 with `error.details.error_code === 'enforced_spend_limit_reached'` → `vendor_cap:anthropic_tier`, with **no retry**.
  - Both raise SP-05, turn `ks:anthropic` on through the governor, and return the offline path (`budget_offline`, C12 client rule).
  - fal and ElevenLabs cap responses are unverified (U-BE-19): they map to `upstream_unavailable`, and T3 records them when first seen.
- **Kill switch**: route 47 `PUT /admin/flags/ks:genai:all` (and `tools/ops/ks.ts`) also calls `BudgetGovernorDO.forceLevel(3, by, reason)` before answering, so the next `reserve()` is refused at once. KV propagation is measured, not asserted.
- **Staging-only test surface**: route 49 gains `/_test/alerts` (stored alerts, newest first), compiled out of production like every `/_test/*` route; `/_test/spend` and `/_test/run-scheduled` are reused.
- **Suites.**
  - `services/edge/test/guardrails-*.test.ts`: T1, T2, T3, T7, T8 in the Workers runtime with mock upstreams; offline and deterministic.
  - `tools/ops/suites/guardrails.ts` (M10b runner): the same scenarios against staging, plus T9 config drift; report `tests/reports/ops/guardrails.json`.
  - T9 compares the live configuration with `guardrails.yaml` through the read APIs that research documents; a row with no documented read API is `manual`.
- **Operator plan**: `tools/ops/guardrails-plan.ts` (`pnpm exec tsx tools/ops/guardrails-plan.ts --env staging`) prints every value the operator sets by hand. Anthropic spend limits are Console-only (research §3), the one R-ENG-01 exception.

## Scope out
- T4–T6 nightly, three green nights, restore drill, gradual-rollout default, A03 release rule, telemetry registry audit, enforcing CSP → M14b2.
- Launch gate, device pass, sign-offs, flag flips → M14b3. Thirdweb → M14a.
- Any live fal call: none in this milestone (`FAL_MODE=mock` everywhere; T2 counts mock calls).

## Deliverables
- `config/guardrails.yaml`, `config/guardrails.schema.json`, `tools/ci/guardrails-build.ts`, `tools/ci/test/guardrails-config.test.ts`, `services/edge/src/ops/guardrails.gen.json` (generated).
- `services/edge/src/ops/{alerts-eval.ts, recon.ts, vendor-errors.ts, dash.ts, index.ts}`, `services/edge/src/alerts/sink.ts`. Edits: router (routes 56, 57, `/_test/alerts`), `BudgetGovernorDO` (SP-01 posts, adopt-vendor-total), route 47 handler (`forceLevel`), the M06a3 Anthropic client (mapping, retry rule), and `services/edge/wrangler.jsonc` (crons `*/5 * * * *` and `* * * * *` in `env.staging` and production only; `ANALYTICS_SQL` binding repeated under `previews` per F-061).
- `packages/shared/src/api/ops.ts` (`AlertReq`, `DashName`, `DashRes` verbatim from C12 1.2; `KickReq`/`KickRes` already there from M12c1).
- `services/edge/test/{guardrails-t1-levels, guardrails-t2-cache-first, guardrails-t3-vendor-errors, guardrails-t7-killswitch, guardrails-t8-abuse, guardrails-recon, guardrails-sink, guardrails-dash}.test.ts` and fixtures `services/edge/test/fixtures/vendor/*.json` (the two verified Anthropic error bodies; recon samples).
- `tools/ops/suites/guardrails.ts`, `tools/ops/suites/guardrails/{t1,t2,t3,t7,t8,t9}.ts`; `tools/ops/{guardrails-plan.ts, drift.ts}`, `tools/ops/test/drift.test.ts`.
- ≈ 38 files.

## Interfaces
- C12 1.1 as frozen (`BudgetGovernor.forceLevel`, `PlayerQuota.reserve`, `GovLevel`, `budget_offline`, `upstream_unavailable`); C16 1.1 names unchanged.
- Routes 56 and 57 are staff and ops routes added in `spec/05-api-and-realtime.md` (DL-182, DL-185) and typed by C12 1.2 (`09-backend-contracts-1.2.md` §1–§2, DL-223) in the contract file `packages/shared/src/api/ops.ts`.
- No contract change.

## Acceptance criteria
- AC-1 Given `config/guardrails.yaml` When the config test runs Then it validates against its schema, `genai.programCapUsdMicros` is 100,000,000 with alarms 0.5/0.8/1.0, the monthly ceiling is $500 split 350/100/25/25, governor levels are 70/85/100, `builder_job` quota is 0 for every tier, the generated JSON equals a fresh build, and a fixture with `programCapUsdMicros` 150,000,000 and no `ownerApproval` fails — proof: `pnpm check:unit -- tools/ci`
- AC-2 Given a $1 synthetic Anthropic ceiling When `/_test/spend` books 50, 70, 85 and 100 % in four steps Then the sink stores SP-01 at each step with the matching level, `gov:level` is written 1 → 2 → 3, route 31 answers `budget_offline` at L3 with zero upstream calls, and at L1 a Sonnet-tier turn reaches the mock upstream as Haiku — proof: `pnpm check:workers -- guardrails-t1`
- AC-3 Given governor level 3 When one cached and one uncached cutscene key and one cached and one uncached TTS line are requested Then the cached ones are served from R2, the uncached ones return the offline path, and the mock fal and TTS call counts are 0 — proof: `pnpm check:workers -- guardrails-t2`
- AC-4 Given the recorded Anthropic 400 workspace-limit body and the 429 `enforced_spend_limit_reached` body When the dialogue client receives each Then the reasons are `vendor_cap:anthropic` and `vendor_cap:anthropic_tier`, the 429 is attempted exactly once, SP-05 is stored, `ks:anthropic` is on, and the player gets the offline fallback — proof: `pnpm check:workers -- guardrails-t3`
- AC-5 Given route 47 setting `ks:genai:all` When the next `reserve()` runs in the same test tick Then it is refused, the KV flag exists and an `audit_log` row names the actor — proof: `pnpm check:workers -- guardrails-t7`
- AC-6 Given one P0 profile sending 500 dialogue turns in 10 simulated minutes When the quota applies Then turns past the cap return `quota_exhausted`, the governor level is unchanged and no SP-04 alert exists — proof: `pnpm check:workers -- guardrails-t8`
- AC-7 Given recon fixtures where vendor spend exceeds the ledger by 20 % When the cron runs once Then no alert fires. When it runs twice Then SP-02 is stored and the governor level is computed from the vendor total. A run without `ANTHROPIC_ADMIN_KEY` logs `SKIP recon:anthropic` and does not throw — proof: `pnpm check:workers -- guardrails-recon`
- AC-8 Given route 56 When a body arrives with a bad HMAC, a stale timestamp, or a valid signature Then the first two get 401 and the third gets 204, an `audit_log` row and one forwarded call (mocked); a repeat within 10 minutes is not forwarded again; route 57 refuses a non-staff JWT with 403 and returns the `client` dashboard shape for `S:ops` — proof: `pnpm check:workers -- guardrails-sink && pnpm check:workers -- guardrails-dash`
- AC-9 Given live-configuration fixtures with one loosened Anthropic workspace limit and one fal key without an allowed-model list When `drift` compares them with the YAML Then both rows are `drift` and the run fails; matching fixtures pass; rows without a read API are `manual` and listed — proof: `pnpm check:unit -- tools/ops`
- AC-10 Given the production build When the route check runs Then no `/_test/*` handler (including `/_test/alerts`) exists and `FAL_MODE` is not `mock` — proof: `pnpm check:prod-routes`
- AC-11 Given no staging credentials When the release-candidate suite runs Then it prints `SKIP test:ops guardrails: CLOUDFLARE_API_TOKEN/CI_STAFF_DEVICE_JWK not set` and exits 0 — proof: `env -u CLOUDFLARE_API_TOKEN -u CI_STAFF_DEVICE_JWK pnpm test:ops -- --suite guardrails`
- AC-12 Given staging deployed from this branch with its secrets When the suite runs Then T1, T2, T3, T7, T8 and T9 pass, `tests/reports/ops/guardrails.json` records the KV propagation times of T7 (recorded, not asserted), and T9 lists no `drift` row — proof: `pnpm test:ops -- --suite guardrails`
- AC-13 Given the branch When unit tests and the preview deploy run Then both pass and the app is deployable — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- Unit (`tools/ci`, `tools/ops`) and Workers runtime (`pnpm check:workers -- guardrails`: fake timers, mock Anthropic, fal and TTS upstreams, an in-memory stub for `ANALYTICS_SQL`).
- Ops (staging): `pnpm test:ops -- --suite guardrails`. T8 on staging spends at most the P0 cost cap ($0.05) on the `synthetic` workspace key that staging's `ANTHROPIC_API_KEY` holds; T1 and T2 use booked synthetic spend and mocks.

## Demo script
1. `pnpm check:workers -- guardrails`: all suites green.
2. `pnpm exec tsx tools/ops/guardrails-plan.ts --env staging`: the operator checklist prints.
3. With staging secrets: `pnpm test:ops -- --suite guardrails`; `GET /api/v1/_test/alerts` on staging shows SP-01 at four levels.

## Effort
1 session; ≈ 38 files; risk **medium** (vendor read APIs for T9; `ANALYTICS_SQL` dialect).

## Risks & fallbacks
- **Over 40 files:** move the dashboards `edge`, `pipeline`, `recon` to M14b2 (keep `client`, `spend`) and report it.
- **A vendor read API is not documented in research:** the T9 row is `manual`; never call an undocumented endpoint.
- **`ANALYTICS_SQL` unavailable in the Workers test pool:** inject a stub; the real SQL runs only in AC-12.
- **No `synthetic` workspace on staging (owner, Console only):** AC-12 is blocked; list it under "Blocked on".

## Notes for the Builder
- Earlier deliverables used as they stand: M06a1 (`PlayerQuotaDO`, route 47, `ks:*`), M06a3 (dialogue path, governor levels), M10b (`tools/ops/run.ts` runner, `tests/reports/ops/`), M12a1 (staff JWT; CI staff profile `CI_STAFF_DEVICE_JWK`, DL-192).
- Read first: `09-backend-ops.md` §3–§6; `research/gap-observability-cost-guardrails.md` §3–§7, Rec 2–3; `spec/05-api-and-realtime.md` routes 47, 49, 56, 57; `09-backend-db.md` §5.
- Facts: F-027, F-028 (gateway limits are eventually consistent), F-034, F-037, F-041, F-042, F-048 (fal has no spend cap), F-052, F-067. Recorded only: U-BE-15, U-BE-18, U-BE-19.
- Spend: **no fal** (`FAL_MODE=mock`; DL-OWN-01 untouched); Anthropic only on staging's `synthetic` workspace, bounded by the quota cap.
- Secrets: `ANTHROPIC_ADMIN_KEY`, `FAL_KEY_BILLING`, `ALERT_HMAC`, `ALERT_WEBHOOK_URL` (Worker); `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CI_STAFF_DEVICE_JWK` (CI). Absent → `SKIP … <VAR> not set`, exit 0.
- Owner gates: the Anthropic `synthetic` workspace and Console limits (Q-28 holds the $500 ceiling). Branch `m14b1-launch-hardening-guardrails`.

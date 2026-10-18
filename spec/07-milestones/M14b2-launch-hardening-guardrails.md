# M14b2 — launch-hardening-guardrails

## Goal
After this session the guardrails are proven against real vendors every night, the database can be restored on demand, and production releases stop on their own when mobile stability regresses. **Split boundary (M14b, split 2 of 3):** M14b1 delivered the configuration, wiring and release-candidate suite. This session adds:
- the nightly staging suite `guardrails-nightly` (T4–T6 and T9 [research/gap-observability-cost-guardrails.md Rec 3]) in `nightly.yml`, so the launch gate can require three consecutive green nights;
- the backup restore drill `restore-drill`;
- gradual production rollout as the default, with the A03 abnormal-exit rule deciding promotion;
- the full C16 telemetry registry audit in `check:telemetry`;
- the switch of the app documents' CSP from Report-Only to enforcing (DL-191).

M14b3 consumes all of this as launch-gate evidence.

## Requirements
- R-ENG-03: budget enforcement is exercised against the real AI Gateway and the vendor usage APIs on a schedule (T4–T6), and configuration drift is checked nightly (T9).
- R-PLAT-05: a release reaches 100 % only when its mobile abnormal-exit rate is no worse than 1.5 × the previous build over at least 500 mobile sessions [research/gap-observability-cost-guardrails.md Rec 4].

## Depends on
- **M14b1** (`guardrails.yaml`, alert sink and evaluator, recon cron, route 57 `client` dashboard, the `guardrails` suite, `/_test/alerts`).
- **M12c2** (the last migration and storage before launch; rooms load gate).
- Contracts: C16 1.1 (registry, schemas); C12 1.1 used as frozen; C13 1.1 `Telemetry` (emitter API).

## Scope in
- **`guardrails-nightly` suite** (`tools/ops/suites/guardrails-nightly.ts` in the M10b runner, staging only):
  - **T4 (real gateway spend limit).** A staging-only `/_test/gateway-ping` (route 49 family) sends one minimal Haiku 5.5 request through `gw-dialogue` with metadata `env=synthetic`. The request has no sampling parameters, thinking disabled, effort low and a small `max_tokens`, per CLAUDE.md. The suite loops until a 429 arrives, or until its own hard stop at an estimated $0.20 (4 × the $0.05 rule from `guardrails.yaml`). The 429 must arrive before the hard stop. The overshoot is recorded, not asserted: limits are eventually consistent (F-028). The first request of the next night's run must succeed (window reset), and that is checked on the following run.
  - **T5 (alert rule end to end).** `/_test/ae-write` writes `tha_bay_spend` points tagged `env='synthetic'` above the synthetic SP-01 threshold. The M14b1 evaluator must deliver the alert to the sink within 3 minutes, polled through `/_test/alerts`.
  - **T6 (reconciliation drift).** 20 real Haiku calls through `/_test/gateway-ping?ledger=0.5` book only half their cost in the ledger. Within 15 minutes the recon cron must raise SP-02, and the governor must report the vendor total.
  - **T9.** The M14b1 drift check runs nightly as well.
  - The report goes to `tests/reports/ops/guardrails-nightly.json` (uploaded as a nightly artifact).
  - Spend per night ≤ $0.25 on the Anthropic `synthetic` workspace (Haiku prices F-034). No fal call.
- **`nightly.yml`**: a `guardrails-nightly` job (environment `staging`) running `pnpm test:ops -- --suite guardrails-nightly`.
- **Restore drill** (`tools/ops/suites/restore-drill.ts`):
  - `--source fixture`: start the local Supabase stack, apply migrations 0001–0008 and a seed, dump, drop, restore, then compare per-table row counts and a SHA-256 over sorted primary keys. Run the pgTAP suite of `check:db`. Finally replay the profile deletions recorded after the dump time and assert that those profiles' rows are gone.
  - `--source staging`: dump the staging database (`SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`) and restore it into the local stack. Same checks; it records the elapsed restore time and writes `tests/reports/ops/restore-drill.json`.
  - The dump/restore commands come from the pinned Supabase CLI's `--help`, with `pg_dump`/`psql` as the fallback; record which one is used in `spec/03`.
  - Restoring production from Supabase Pro daily backups (7 days, research/stack-cloudflare-backend.md) is an owner runbook step, `docs/ops/restore.md`. R2 media are rebuilt from the asset lock (`assets:publish`); evidence buckets are retention-locked and are not restored.
- **Gradual rollout default.**
  - `deploy:prod` without `--env` (production) now runs: `versions upload` → 0 % smoke → 10 % → 50 % → hold.
  - A pure `releaseDecision(prev, next, cfg)` in `tools/ci/release-gate.ts` reads route 57 `client` for both builds, authenticated with the CI staff JWT. It answers `hold` while next has fewer than 500 mobile sessions or prev has no data. It answers `rollback` when next's rate is above 1.5 × prev's, or above the A03 page threshold (8 %). Otherwise it answers `promote`.
  - `pnpm deploy:prod -- --promote` applies the decision: 100 %, nothing, or `wrangler rollback`. It is a no-op when no version is held.
  - `deploy.yml` gains an hourly `schedule` that runs only the promote step.
  - Staging keeps 0 % → 100 %. The thresholds live in `guardrails.yaml` under `alerts.A03`.
- **Telemetry registry audit** (`check:telemetry`, extended):
  - every C16 1.1 `TelemetryName` has a schema under `packages/shared/schemas/telemetry/`;
  - every name has at least one emitter call site in `packages/**` or `services/**` (static scan of the C13 `Telemetry` emit calls), except names in `config/telemetry-allow-unemitted.json`, each with a reason and an owner milestone;
  - no schema allows more than 16 props, an id-like prop, free text or a sub-chunk position (the C16 privacy rules);
  - the seeded PII fixtures of `telemetry-privacy` stay blocked.
- **Enforcing CSP.** `apps/web/public/_headers` serves `Content-Security-Policy` (enforcing) with the exact directive set of `spec/05-api-and-realtime.md` §1.3 on app documents. `/account/*` keeps its own Report-Only policy, because the Turnstile and Thirdweb origins are unverified. `check:headers` asserts both. Precondition: route 4 shows zero app-document violations on staging for the last 7 days. The Builder states the count in the PR; if it is not zero, see Risks.

## Scope out
- Launch gate, three-night evidence record, device pass, flag flips → M14b3.
- Thirdweb origins in the `/account/*` CSP → M14a.
- Any change to C16 names or schemas: none (the audit only checks).

## Deliverables
- `tools/ops/suites/guardrails-nightly.ts` with `tools/ops/suites/guardrails-nightly/{t4,t5,t6}.ts` (T9 imported from M14b1); `tools/ops/suites/restore-drill.ts` with `tools/ops/suites/restore-drill/{dump.ts, compare.ts, seed.sql}`.
- `services/edge/src/test-routes/{gateway-ping.ts, ae-write.ts}` (route 49 family, compiled out of production), `services/edge/test/test-routes-absent.test.ts` extension.
- `tools/ci/release-gate.ts`, `tools/ci/test/release-gate.test.ts`. `tools/ci/deploy.ts` changes: production default, `--promote`.
- `tools/ci/check-telemetry.ts` extension, `config/telemetry-allow-unemitted.json`, `tools/ci/test/check-telemetry.test.ts` with fixtures.
- `apps/web/public/_headers` (CSP), `tools/ci/check-dist.ts` (headers mode asserts the directive set), `tests/e2e/csp.spec.ts` (tag `@csp`).
- `.github/workflows/{nightly.yml, deploy.yml}`, `tools/ci/test/workflows.test.ts`.
- `docs/ops/restore.md`.
- ≈ 28 files.

## Interfaces
- C16 1.1 and C12 1.1 used as frozen. Route 57's `client` DTO comes from M14b1 (`packages/shared/src/api/ops.ts`).
- No contract change.

## Acceptance criteria
- AC-1 Given `releaseDecision` When the table cases run (next 499 mobile sessions; prev missing; then, with 600 sessions each: next 2.0 % vs prev 1.5 %, next 2.4 % vs prev 1.5 %, next 9 % vs prev 8.5 %) Then the answers are `hold`, `hold`, `promote`, `rollback`, `rollback` — proof: `pnpm check:unit -- tools/ci`
- AC-2 Given no Cloudflare secrets and `AFFINITY_RULE_READY=1` (M12a1's affinity switch) When production and staging deploys run in dry-run mode Then production prints upload → 0 % smoke → 10 % → 50 % → hold for A03, staging prints upload → 0 % smoke → 100 %, and `--promote --dry-run` with no held version prints `nothing held`; without the variable production prints M12a1's `SKIP gradual` line and the 0 % → 100 % path — proof: `AFFINITY_RULE_READY=1 pnpm deploy:prod -- --dry-run && pnpm deploy:prod -- --env staging --dry-run && pnpm deploy:prod -- --promote --dry-run && pnpm deploy:prod -- --dry-run`
- AC-3 Given a QA build on port 8788 When headers are checked Then `/` and `/legal/terms` carry an enforcing `Content-Security-Policy` equal to the §1.3 directive set with no Report-Only twin, and `/account/` carries only its Report-Only policy — proof: `pnpm check:headers -- --serve http://localhost:8788`
- AC-4 Given the enforcing CSP When `@csp` loads title, main menu, the graybox world, a cutscene fallback and the mods UI fixture panel of `@mods-ui-isolation` Then no `securitypolicyviolation` event fires in Chromium or WebKit, and `@coi` stays green — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @csp && pnpm check:e2e -- --project=webkit-webgl2 --grep @csp`
- AC-5 Given the repository When the telemetry audit runs Then every registry name has a schema and an emitter, or an allow-list entry with a reason. Fixtures with an orphan name, a 17-prop schema and an id-like prop each fail and name the offender — proof: `pnpm check:telemetry && pnpm check:unit -- tools/ci`
- AC-6 Given the local Supabase stack (Docker, as `check:db` needs) When the fixture drill runs Then the per-table row counts and primary-key hashes match after restore, pgTAP passes, and the profiles deleted after the dump are absent after replay — proof: `pnpm test:ops -- --suite restore-drill --source fixture`
- AC-7 Given no staging credentials When the nightly suite runs Then it prints `SKIP test:ops guardrails-nightly: CLOUDFLARE_API_TOKEN/CI_STAFF_DEVICE_JWK not set` and exits 0 — proof: `env -u CLOUDFLARE_API_TOKEN -u CI_STAFF_DEVICE_JWK pnpm test:ops -- --suite guardrails-nightly`
- AC-8 Given staging with the `synthetic` workspace and the M14b1 rules When the nightly suite runs Then T4 sees a 429 before its $0.20 hard stop (overshoot recorded), T5's alert arrives within 3 minutes, T6 raises SP-02 within 15 minutes, T9 shows no `drift` row, and the report is written — proof: `pnpm test:ops -- --suite guardrails-nightly`
- AC-9 Given staging database credentials When the staging drill runs Then the restore completes, the checks of AC-6 pass, and the elapsed time is recorded (not asserted) — proof: `pnpm test:ops -- --suite restore-drill --source staging`
- AC-10 Given the workflows When the workflow test parses them Then `nightly.yml` runs `pnpm test:ops -- --suite guardrails-nightly` in environment `staging`, and `deploy.yml` has an hourly schedule that runs only `pnpm deploy:prod -- --promote` — proof: `pnpm check:unit -- tools/ci`
- AC-11 Given the production build When the route check runs Then `/_test/gateway-ping` and `/_test/ae-write` are absent — proof: `pnpm check:prod-routes`
- AC-12 Given the branch When unit tests and the preview deploy run Then both pass and the Preview passes `check:headers` with the enforcing CSP — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- Unit: `release-gate`, `check-telemetry` fixtures, `workflows` (`pnpm check:unit -- tools/ci`).
- E2E: `@csp` on `chromium-webgl2` and `webkit-webgl2`; `@coi`, `@smoke` unchanged.
- Ops: `restore-drill` (fixture locally, staging with secrets), `guardrails-nightly` (staging, nightly in CI).
- Deployed: Preview `check:headers` and `check:coi` (CI `preview.yml`).

## Demo script
1. `AFFINITY_RULE_READY=1 pnpm deploy:prod -- --dry-run`: see the 10 → 50 → hold plan.
2. `pnpm test:ops -- --suite restore-drill --source fixture`: counts and hashes match.
3. `pnpm check:headers -- --serve http://localhost:8788`: enforcing CSP.
4. On staging: run the nightly workflow by `workflow_dispatch`; open the `guardrails-nightly.json` artifact.

## Effort
1 session; ≈ 28 files; risk **medium** (real-vendor timing in T4/T6; the CSP switch can break a page).

## Risks & fallbacks
- **Route 4 shows app-document violations, or `@csp` finds a violation the Builder cannot fix in the page.** Keep Report-Only for app documents, list each violation in the PR, record a Builder decision, and leave AC-3/AC-4 open for M14b3's gate. Never widen the policy with `'unsafe-eval'` or wildcards.
- **T6 does not see the drift within 15 minutes**, because Usage API lag varies. Record the observed lag and fail the night. Do not widen the window without an Architect decision.
- **The Supabase CLI cannot dump or restore in its pinned version.** Use `pg_dump`/`psql` against the local stack's connection string and the staging pooler, and record it.
- **Hosted runners cannot hold a deploy for hours.** That is why promotion is the hourly scheduled `--promote` step, not a waiting job.

## Notes for the Builder
- Earlier deliverables used as they stand: M00a/M12a1 `tools/ci/deploy.ts` (`--gradual`, `--dry-run`, `AFFINITY_RULE_READY`), M05d `check:db`, M05b1 Report-Only CSP and route 4 intake, M00b/M00d `nightly.yml` and `workflows.test.ts`, M10b `test:ops` runner, DL-192 CI staff profile.
- Read first: `09-backend-ops.md` §2 (deploy pipeline), §4 (alerts A03), §5.3; `09-backend-db.md` §7 (retention and forget); `spec/05-api-and-realtime.md` §1.3 (CSP), route 4; `research/gap-observability-cost-guardrails.md` Rec 3–4; `spec/08-test-and-ci.md` §5.3, §5.5.
- Facts: F-027, F-028, F-034, F-037, F-061. Recorded, not asserted: U-API-1 (CSP browser behaviour; the M14b3 device pass checks it), U-BE-18.
- Spend: Anthropic `synthetic` workspace only, ≤ $0.25 per nightly run; **no fal**.
- Secrets (names): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CI_STAFF_DEVICE_JWK`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`; staging Worker `ANTHROPIC_API_KEY` holds the `synthetic` workspace key. Each absent secret gives a SKIP and exit 0 locally.
- Owner gate: the `synthetic` workspace (Console). Branch `m14b2-launch-hardening-guardrails`.

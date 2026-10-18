# M13d1 — legal-trust-safety-backend

## Goal
The trust-and-safety backend that public UGC needs. Migration 0008 adds takedown, NCMEC, evidence and hash-bank tables. Route 42 takes DMCA notices, counter-notices and NCII requests from anywhere. A valid NCII request disables its target at intake, starts the 48-hour clock watched by a 5-minute SLA pager, and sweeps identical copies. Route 43 serves every queue, route 44 records NCMEC cases and audits each evidence read before streaming, and route 45 manages the hash banks that M13c2's stage 4 reads. DMCA removals feed revocations and strikes; counter-notices restore on schedule. The `legal-evidence` bucket and retention locks exist. When these ACs pass on staging, `ugc.publish` may be turned on in production (DL-151).

## Requirements
- R-IP-03: DMCA and NCII flows, evidence preservation, a queue for every report category.
- R-MOD-03: the legal backstop that public forum and UGC visibility needs.

## Depends on
- **M13b1**: report policy and thresholds, forum objects, `P2_REVIEW` cases, migration 00071.
- Uses through the run order: M06b1/M06b2 (0004 tables, `uploads`, image hashes), M13c2 (`HashBankPort`, revocations), M12a1 (staff JWTs), M05b1 (`/_test/run-scheduled`).
- Contracts: C12 1.1.0 (routes 41–45, 47; `ReportCategory`, `ModSubject`; `09-backend-db.md` §3.4, §4, §7), C16 1.1.0 (server metrics only), C14 1.0.0 (`RevokedRes.reason`).

## Scope in
- `supabase/migrations/0008_legal.sql`:
  - `takedown_request` with exactly the columns of `09-backend-db.md` §3.4;
  - `ncmec_report` (`preserve_until` generated as `submitted_at + 1 year`), `evidence_object` and `hash_bank_entry`, as [research/gap-trust-safety-tooling.md §6.8];
  - all server-only (RLS on, no policies); ids are UUIDv7 from the Worker.
- `services/edge/src/legal/intake.ts`: route 42 `POST /legal/dmca`, `/legal/counter-notice`, `/legal/ncii` (pub, worldwide, geo-exempt since M00a; `RL_LEGAL` 5 per 60 s per netHash, except that NCII is never refused below 1 per minute) → 202 `{requestId}`.
  - Bodies carry the statutory elements as fields (work or image, target URLs or ids, contact, good-faith and accuracy statements, signature); a missing one → `bad_request` naming it; extras go to `requester jsonb`. Counsel wording: M13d2, Q-23.
  - NCII, if facially valid:
    - target disabled at once: forum post `held`, experience and mod version `unlisted_pending_review`, NPC soul `unpublished_pending_review`, and every public object moved from `ugc-public` to `ugc-quarantine/other/`;
    - `statutory_due_at = received_at + 48 h`;
    - a `P0_NCII` case, a page, and a copy-sweep job.
  - DMCA: a `P1_LEGAL` case (internal target 24 h). Counter-notice: linked to its takedown, it schedules a restore 10–14 business days out (10 used) unless staff record a court-action notice.
- `services/edge/src/legal/sweep.ts` (`UGC_SCAN` kind `copy_sweep`): content keys are SHA-256 addressed, so the sweep finds every row referencing the target's hashes (forum attachments, mod archives, experience thumbnails, NPC images; PDQ near-duplicates where M06b2 stored them), disables each, and writes `copies_found` and `copy_sweep_job`.
- `services/edge/src/ops/sla-pager.ts`: a cron every 5 minutes.
  - Pages: P0 cases unassigned for more than 15 minutes; NCII at intake, 24 h and 36 h; escalation to `admin` at 40 h; any queue past `sla_due_at`.
  - One page per (case, threshold), recorded in `audit_log` (action `page`) and as an AE point. When `ALERT_WEBHOOK_URL` is set it also posts there (the formal sink arrives with M14b1).
  - No email provider exists in v1. `requester_notified_at` is set when the trust lead records the notice through a case decision whose `user_notice_template` is set, and the NCII pager keeps paging until it is.
- `services/edge/src/admin/cases.ts`: route 43 for all queues (`P0_CSAM`, `P0_NCII`, `P1_SAFETY`, `P1_LEGAL`, `P2_REVIEW`, `P3_REVIEW`, `APPEAL`).
  - P0 decisions need `mod:trust_lead`; an `APPEAL` cannot be decided by the original reviewer; actions follow the `moderation_decision.action` enum.
  - A takedown `remove` writes a revocation (reason `dmca` for DMCA cases) and a `strike`; a third strike within 12 months adds `publish_ban`.
- `services/edge/src/admin/{ncmec,evidence}.ts`: route 44.
  - `POST /admin/cases/:id/ncmec` (`mod:trust_lead`) creates an `ncmec_report` (`environment` `test` outside prod, status `draft`) and copies original and context files to `legal-evidence/ncmec/<reportId>/` with `evidence_object` rows; a later call with `cybertip_report_id` (from the CyberTipline web form) sets `submitted`.
  - `GET /admin/evidence/:id` (`mod:trust_lead`) streams only after its `audit_log` insert commits; a failed insert → `internal`, no bytes.
- `services/edge/src/admin/{hash-banks,takedowns}.ts`: route 45.
  - `POST /admin/hash-banks/:bank` (banks `removed_takedown`, `rejected_real_person`, `roster_press`, `ncii_request`; `hash_type` `sha256|pdq|md5`); an NCII or DMCA `remove` adds the target's hashes automatically. `GET /admin/takedowns` lists requests with both clocks. M13c2's `HashBankPort` now reads `hash_bank_entry`.
- Restore cron (daily): counter-notices past their date without a court-action note restore the target (`restored_at`, state back, revocation removed) and record the decision.
- Buckets: `legal-evidence-<env>` (no public route; locks `ncmec/` 400 days, `legal_hold/` indefinite) and locks on `ugc-quarantine-<env>` (`csam/` 400 days, `other/` 90 days). `EVIDENCE` binding in `wrangler.jsonc` and `previews`. `pnpm deploy:bootstrap` creates buckets and locks idempotently; the operator runs it before this branch deploys (a binding to a missing bucket fails the deploy).

## Scope out
- Legal forms and pages → M13d2 (counsel text, Q-23).
- PhotoDNA, the HMA container and the CyberTipline API: wait for Q-16 approvals (`PHOTODNA_KEY`, `NCMEC_API_CREDENTIALS`). Until then the defaults are own banks with SHA-256 (PDQ where present) and the web form.
- Requester email (no provider in v1) and a creator appeal-filing route (none in C12 1.1; staff open `APPEAL` cases): listed for the Architect.
- Alert sink route 56, guardrails, and the formal pager wiring → M14b1.

## Deliverables
- `supabase/migrations/0008_legal.sql`; pgTAP `supabase/tests/legal_server_only.sql` (also asserts the `preserve_until` expression); `packages/shared/src/db.gen.ts`.
- `packages/shared/src/api/v1.ts`: `DmcaNoticeReq`, `CounterNoticeReq`, `NciiReq`, `NcmecRecordReq`, `HashBankAddReq`, `TakedownRow` (request and response bodies of routes 42–45, which C12's table leaves to "the same file"; the version is unchanged).
- `services/edge/src/legal/{intake,validate,disable,sweep,restore}.ts`; `services/edge/src/admin/{cases,ncmec,evidence,hash-banks,takedowns}.ts`; `services/edge/src/ops/sla-pager.ts`; `services/edge/src/ugc/mod-scan/hash-bank.ts` (DB-backed); router rows 42–45; cron entries.
- `services/edge/test/{legal-intake,ncii-clock,copy-sweep,dmca-flow,evidence-audit,ncmec-record,hash-banks,cases-queues}.test.ts`; `report-threshold` kept green.
- `tools/ci/deploy.ts` (`bootstrap` creates the legal and quarantine buckets and applies the lock rules); `services/edge/wrangler.jsonc` (`EVIDENCE` binding, crons).
- Secrets and gates: Q-16 owner filings (NCMEC ESP registration, PhotoDNA application, DMCA agent designation, Cloudflare CSAM-tool ticket). `NCMEC_API_CREDENTIALS` and `PHOTODNA_KEY` only after approval; absent → the web-form path and own banks, with `SKIP … not set` at boot. `ALERT_WEBHOOK_URL` is optional until M14b1.

## Interfaces
- C12 1.1: routes 42–45 as tabled, route 43 extended to all queues, and the DB schema of `09-backend-db.md` §3.4 and §4 as written. The route bodies are added to `v1.ts` without a version change.
- C14 1.0: revocation reasons `dmca`, `policy` and `security` as typed.
- No contract change.

## Acceptance criteria
- AC-1 Given a fresh local database with migrations through 0008 When the pgTAP suites run Then the four legal tables return 0 rows to `anon` and `authenticated`, `ncmec_report.preserve_until` equals `submitted_at + 1 year`, `audit_log` still refuses update and delete, and the generated types have no diff — proof: `pnpm check:db && pnpm check:db:types`
- AC-2 Given a published forum image post When a facially valid NCII request names it Then in the same request the post is `held`, its public object is in `ugc-quarantine/other/`, a `P0_NCII` case exists, `statutory_due_at − received_at = 48 h`, and one intake page is recorded; with the clock mocked the pager records exactly one page at 24 h, one at 36 h and one admin escalation at 40 h, and records none after the trust lead's notice decision sets `requester_notified_at` — proof: `pnpm check:workers -- ncii-clock`
- AC-3 Given an NCII body without a signature, a DMCA notice without the good-faith statement, and a valid DMCA notice sent with `cf.country = 'FR'` When each is posted Then the first two are `bad_request` naming the field with nothing disabled, the third is 202; six DMCA notices in a minute from one net give a `rate_limited` sixth, while one NCII request per minute is never refused — proof: `pnpm check:workers -- legal-intake`
- AC-4 Given one image hash referenced by two forum attachments and one experience thumbnail When an NCII intake disables one of them and the sweep job runs Then all three are disabled and `copies_found = 3` — proof: `pnpm check:workers -- copy-sweep`
- AC-5 Given a published mod version When a valid DMCA notice is decided `remove` by `mod:review` staff Then the version is `removed`, route 53 lists it with `reason: 'dmca'`, its archive hash is in bank `removed_takedown`, and the uploader has a strike; after two more upheld takedowns within 12 months the uploader has `publish_ban` and route 36 answers `forbidden`; a counter-notice on a fourth takedown restores the target when the restore cron runs 10 business days later — proof: `pnpm check:workers -- dmca-flow`
- AC-6 Given an evidence object When a `mod:trust_lead` requests it, a `mod:review` profile requests it, and the audit insert is made to fail Then the first streams only after its `audit_log` row is committed (the stub stream records the order), the second is `forbidden`, and the third is `internal` with no body bytes — proof: `pnpm check:workers -- evidence-audit`
- AC-7 Given a `P0_CSAM` case When the trust lead creates an NCMEC record and later posts a `cybertip_report_id` Then an `ncmec_report` with `environment: 'test'` and status `draft` exists with evidence under `legal-evidence/ncmec/<reportId>/` and `evidence_object` rows carrying `preserve_until`, and the second call sets `submitted` — proof: `pnpm check:workers -- ncmec-record`
- AC-8 Given a SHA-256 added to bank `ncii_request` through route 45 by a trust lead (a `mod:review` attempt is `forbidden`) When an archive containing that image is scanned by M13c2's pipeline Then it is quarantined at stage 4 — proof: `pnpm check:workers -- hash-banks`
- AC-9 Given cases in every queue When `mod:review` decides a `P0_CSAM` case, and the original reviewer decides the `APPEAL` of their own decision Then both are `forbidden`, and `GET /admin/cases?queue=P1_LEGAL` lists only that queue — proof: `pnpm check:workers -- cases-queues`
- AC-10 Given the M13b1 report rules When the report suite runs Then three distinct reporters still unlist and P0 categories still open at once — proof: `pnpm check:workers -- report-threshold`
- AC-11 Given operator credentials When `pnpm deploy:bootstrap` runs twice Then the first run creates `legal-evidence-staging` and applies the lock rules (or prints the exact manual rule if the pinned wrangler has no lock command), the second run changes nothing, and neither bucket has a public route — proof: manual: operator workstation, run `pnpm deploy:bootstrap` twice and list the buckets and their lock rules; record the output in the PR
- AC-12 Given this branch merged to `main` When `deploy.yml` deploys staging Then smoke passes and `POST /api/v1/legal/dmca` with an empty body answers `bad_request` (not `feature_disabled`) — proof: manual: desktop browser and terminal, `curl -X POST <staging-url>/api/v1/legal/dmca -d '{}'`; then `pnpm check:smoke -- <staging-url>`

## Test plan
- DB: `legal_server_only.sql` (`pnpm check:db`, `pnpm check:db:types`). Workers: the nine suites named in the ACs (mocked clock, R2 stubs that record call order, InMemoryDataPort). Static: `pnpm check:prod-routes`, `pnpm check:secrets`. Operator and deploy: AC-11, AC-12.

## Demo script
1. `pnpm dev`; post an NCII request for a seeded forum image; the post vanishes and a `P0_NCII` case appears.
2. Advance the clock 24 h and call `/api/v1/_test/run-scheduled`; read the page in `audit_log`. Record the requester notice; at 40 h no further page.
3. File a DMCA notice for a seeded mod; decide `remove`; route 53 lists it.
4. Fetch an evidence object as trust lead; the audit row is written first.
5. After the ACs pass on staging and Q-16's DMCA agent designation exists, an admin may set `ugc.publish` through route 47 in production; record it in `spec/11-decision-log.md`.

## Effort
1 session; ≈ 36 files; risk **high**: statutory clocks, audit-before-stream ordering and many disable paths.

## Risks & fallbacks
- **Bucket-lock command**: lock rules are a documented R2 feature [research/gap-trust-safety-tooling.md Verified facts], but the wrangler subcommand is not in the ledger. If the pinned wrangler lacks it, `bootstrap` prints the exact rule set and stops with `MANUAL:`. The operator applies the rules, and the Builder records how.
- **Migration order**: `0008` must sort after `00071`/`00072`. If the staging dry run lists anything other than `0008_legal.sql` as pending, stop before merge and report (see M13b1).
- **PDQ hashes absent**: the sweep uses SHA-256 only, `copies_found` counts exact copies, and a Builder note lists near-duplicate coverage as pending Q-16 (HMA).
- **Cron drift**: thresholds come from stored timestamps, never cron counts, so a late tick pages late but once.

## Notes for the Builder
- Read first: `09-backend.md` §3.4; `09-backend-db.md` §3.4, §4, §7; `09-backend-ops.md` §3.1, §4; [research/gap-trust-safety-tooling.md §6.5–§6.8]; `12-modding-publish.md` C§3.4; `spec/05-api-and-realtime.md` §3 rows 41–45; F-066.
- Remove first, review after, for NCII. Never forward a CSAM item to another vendor. Never log request bodies.
- Branch `m13d1-legal-trust-safety-backend`.

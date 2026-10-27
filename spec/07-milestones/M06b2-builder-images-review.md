# M06b2 — builder-images-review

## Goal
The NPC builder backend gains everything after the private text builder of M06b1. When this session ends: P1 players upload up to 6 reference images through presigned R2 PUTs (route 34). Each image runs the moderation chain on the `UGC_SCAN` queue: hash first, classify second, and only a text description survives. Attestation is enforced. P2 players submit a private, publishable NPC for review; P0 and P1 get `tier_required`. Reviewers decide NPC cases (route 43, queue `P2_REVIEW`). Published NPCs are listed in the community routes, and reports (route 41) unpublish after 3 distinct reporters. The dialogue panel's report button is turned on, and a reported NPC dialogue turn opens a case with the encounter's turns as evidence. The UGC buckets and the scan queue exist in staging and production. No fal call and no generated look anywhere (DL-OWN-01, DL-175).

## Requirements
- R-NPC-03: completes the upload and publish-through-moderation half of the native NPC builder.
- R-IP-03: report button target (route 41) for published NPCs and NPC dialogue turns, moderation queue and case decisions for NPC UGC.
- R-IP-02 (likeness policy per R-NPC-04): no face detection or face landmarks; images become text, are never shown to other players and are never generator inputs.

## Depends on
- M06a5 (dialogue panel, `dialogueCapabilities`, `tests/e2e/npc-dialogue.spec.ts`; DL-543), M06b1 (route 33 drafts, validate, soul, preview; migration 0004 with `uploads`, `moderation_*`, `npc_draft`, `npc_soul`; text moderation clients; queue `npc-builder`), M12a1 (ES256 JWT, staff scopes, `audit_log` writes, test keys).
- Contracts: C12 1.1 (routes 33, 34, 41, 43; `UploadReq/UploadRes`, `ReportReq`, `ModSubject 'npc_soul'`, `PlayerQuota.reserve` `upload`/`report`), C10 1.0 (`c10-npc-builder.ts`: `DraftView`, `AttachImagesReq`, `SubmitRes`, `CommunityNpc`, `Attestation`).

## Scope in
- Route 34: `POST /ugc/uploads` (J1; purposes `npc_image` only in this milestone; `image/png|jpeg|webp`; ≤ 10 MiB; 20 per day device, 100 linked) → presigned PUT to `<ACCOUNT_ID>.r2.cloudflarestorage.com`, bucket `ugc-staging-<env>`, key `incoming/<uploadId>`, 15 min, `Content-Type` signed [F-023; `09-backend-db.md` §4]; `POST /ugc/uploads/:id/commit` → HEAD size check, `uploads.state` `committed`, enqueue `UGC_SCAN`, 202.
- Route 33 sub-paths delivered here (DL-182): `POST /drafts/:id/images` (P1, ≤ 6 per draft), `POST /drafts/:id/submit` ⓘ (P2), `GET /community[/:npcId]` (pub).
- `UGC_SCAN` consumer (`max_batch_size` 10), per `04-npc-builder.md` §C5 item 2, in this order: magic bytes → SHA-256 (+ PDQ when a licensed library passes `license:scan`) → Haiku image semantics (structured output, "never identify anyone") → OpenAI `omni-moderation-latest` image. Minors × sexual → copy to `ugc-quarantine-<env>/csam/…`, `P0_CSAM` case, stop. `photo` with `real_human_visible` → `publishable = false`, stored derivative pixelated when `face_prominent`. `text_in_image` → `names:lint` aliases. Pass → Haiku description ≤ 400 characters offered for `visual_brief`. Image machine `uploaded → scanning → described | review | blocked | quarantined`.
- Q-16 stub: until the owner's filings are approved, any image classified `photo` sets `publishable = false` (constant `PHOTO_PUBLISHABLE = false` in `services/edge/src/ugc/policy.ts`).
- Attestation: only `original` plus the warranty checkbox; submit refuses drafts without both.
- Submit: P2, `private`, `publishable`, good standing → `moderation_case` in `P2_REVIEW` (SLA 72 h) with `subject_snapshot` (soul.md, compiled public JSON, lint, verdicts, descriptions, blurred thumbnails only, probe transcripts, attestation, account age, strikes).
- Route 43 for the NPC queue (staff `mod:review`): `approve` (next `soulVersion`, prompt to PRIVATE `souls/u_…/<ver>/soul.prompt.txt`, state `published`, community listing), `changes_requested {notes}`, `reject {reason}` (`real_person_likeness` adds a strike). Appeals go to `APPEAL` with a different reviewer.
- Route 41: `ReportReq` with target `npc_soul`; 3 distinct reporters or 1 `mod:trust_lead` → `unpublished_pending_review`; `copyright` → 409 with `details.redirect: '/legal/dmca'`; RL `report`, 30 per day.
- Route 41 with target `chat_turn` for NPC dialogue (`04-npc.md` §5 rule 7; DL-543), in `services/edge/src/reports/chat-turn.ts`:
  - ids are `enc:<npcId>:<encounterId>:<turnIndex>`; `room:<roomId>:<evSeq>` answers `feature_disabled` until M12c2 replaces that branch; any other form is `bad_request`;
  - the Worker addresses `EncounterDO` `enc:<pid>:<npcId>:<encounterId>` with the reporter's own `pid`, so a player reports only their own encounters (an unknown encounter is `not_found`);
  - it stores the last 20 turns up to and including `turnIndex` (exact user and assistant text, `npcId`, `soulVersion`) in `moderation_case.subject_snapshot`; when the DO no longer holds them it reads PRIVATE `transcripts/<encounterId>.jsonl`; when neither has them the snapshot is `{expired: true}` with the reporter's note;
  - the case goes to `P2_REVIEW` with no unlist action (case only, as M13b1's report table); the transcript text is never logged.
- Client: `packages/ui/src/dialogue/capabilities.ts` sets `dialogueCapabilities.reports = true`, so the M06a5 panel renders its `ReportButton`.
- Fail closed: a missing moderation key or an upstream error leaves the image in `review`, never `described`.
- Resources: `deploy:bootstrap -- --r2` creates `ugc-staging-<env>`, `ugc-public-<env>`, `ugc-quarantine-<env>` and queue `tha-bay-ugc-scan` idempotently and sets the `ugc-staging` CORS rule (`PUT` with `Content-Type` from the app origin); results recorded in `config/cloudflare.resources.json`.

## Scope out
- Builder pages → M06b3. `assets` sub-route and owner-approved look queue → M06b4.
- Hash banks, PhotoDNA, NCMEC reports, evidence bucket, all other queues of route 43 → M13d1. Other route-34 purposes: `forum_attachment` (image chain, hidden until it passes) → M13b1; `mod_archive` (zip, ≤ 128 MiB) and `experience_thumb` (image chain) → M13c2; `save_blob` presigns through route 19 (M12a1). Until a purpose's owner lands, route 34 answers it `bad_request`.

## Deliverables
- `services/edge/src/ugc/{uploads.ts, presign.ts, scan-consumer.ts, policy.ts, magic.ts}`; `services/edge/src/npc-builder/{images.ts, submit.ts, community.ts, review.ts}`; `services/edge/src/reports/{route.ts, chat-turn.ts}`; `packages/ui/src/dialogue/capabilities.ts` (flag on); `services/edge/src/moderation/{image-classifier.ts, describe.ts}` (ports with recorded-fixture implementations).
- `services/edge/wrangler.jsonc`: R2 bindings `UGC_STAGING`, `UGC_PUBLIC`, `UGC_QUARANTINE`; queue producer and consumer `tha-bay-ugc-scan`; `secrets.required` adds `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `OPENAI_MODERATION_API_KEY`, `ANTHROPIC_BUILDER_KEY`; all repeated under `previews` (staging names).
- `services/edge/src/_test/` gains `drain-queue` support for `tha-bay-ugc-scan` (route 49 family; compiled out of prod).
- `tests/fixtures/ugc/` (small original PNG/JPEG/WebP files, one wrong-magic file, recorded classifier and description responses).
- `services/edge/test/{ugc-uploads, npc-builder-moderation-order, npc-builder-images-text-only, npc-builder-submit-tier, npc-builder-review, npc-builder-report-unpublish, npc-builder-fail-closed, npc-chat-report}.test.ts`.
- `tests/e2e/npc-builder.spec.ts` (extend M06b1's API-level `@npc-builder` suite); `tests/e2e/npc-dialogue.spec.ts` (M06a5's, extended with an `@npc-report` case).
- `tools/ci/deploy.ts` (`bootstrap --r2`), `config/cloudflare.resources.json` (bucket and queue names, no secrets).

## Interfaces
- C12 1.1 and C10 1.0 shapes used as frozen; no new route. The presign signer is internal.
- No contract change.

## Acceptance criteria
- AC-1 Given route 34 When a P0 token requests an upload, a P1 profile declares 11 MiB, sends `image/gif`, requests a valid PNG, makes its 21st upload of the day, and commits an object whose HEAD size differs Then the answers are `tier_required`, `payload_too_large`, `unsupported_media_type`, an `UploadRes` whose `putUrl` host is the account's R2 S3 endpoint with a signed `Content-Type` and `expiresAt` 15 min ahead, `quota_exhausted`, and `bad_request`; a correct commit returns 202 and enqueues exactly one `UGC_SCAN` message — proof: `pnpm check:workers -- ugc-uploads`
- AC-2 Given fixture images and recorded classifiers When the scan consumer runs Then the hash stage is logged before any classifier call; a wrong-magic file is `blocked` with zero vendor calls; an image the recording marks minors × sexual is copied to `ugc-quarantine`, opens a `P0_CSAM` case and triggers no further vendor call — proof: `pnpm check:workers -- npc-builder-moderation-order`
- AC-3 Given a passing image and a `photo` with `real_human_visible` When both are scanned Then the first stores a description of at most 400 characters and the draft view exposes it only to the owner; the second sets `publishable: false`; no pipeline job input anywhere carries origin `user_upload` — proof: `pnpm check:workers -- npc-builder-images-text-only`
- AC-4 Given a private, publishable draft with attestation `original` and the warranty When P0, P1 and linked tokens call submit Then P0 and P1 get `tier_required`, linked gets a `SubmitRes` and a `P2_REVIEW` case whose `sla_due_at` is 72 h after creation and whose snapshot holds no full-resolution image; a non-publishable draft or one without the warranty gets `conflict` — proof: `pnpm check:workers -- npc-builder-submit-tier`
- AC-5 Given an open NPC case When a `mod:review` staff token approves it Then `soulVersion` increments, the prompt object exists at `souls/u_…/<ver>/soul.prompt.txt` in PRIVATE, the NPC appears in `GET /community`, and one `audit_log` row exists; `changes_requested` returns the draft to `soul_ready` with notes; a `real_person_likeness` reject adds one strike; a caller without the scope gets `forbidden` — proof: `pnpm check:workers -- npc-builder-review`
- AC-6 Given a published NPC When three distinct profiles report it Then it becomes `unpublished_pending_review` and leaves the community list, the same reporter three times counts once, one `mod:trust_lead` report has the same effect, a `copyright` report returns 409 with `redirect: '/legal/dmca'`, and the 31st report of a day is refused — proof: `pnpm check:workers -- npc-builder-report-unpublish`
- AC-7 Given the scan consumer with no moderation key binding or an upstream 5xx When an image is scanned Then it stays `review`, never `described`, and the consumer logs `SKIP moderation: OPENAI_MODERATION_API_KEY not set` once — proof: `pnpm check:workers -- npc-builder-fail-closed`
- AC-8 Given the local web server in recorded mode When the extended `@npc-builder` suite runs Then M06b1's flow still passes and an attached fixture image yields an owner-visible description — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder`
- AC-9 Given the production build When it is scanned and the branch is previewed Then no R2 key, moderation key or Anthropic key pattern appears, no `/_test/` route exists, and the Preview deploys with the new bindings repeated under `previews` — proof: `pnpm check:secrets -- apps/web/dist && pnpm check:prod-routes && pnpm deploy:preview`
- AC-10 Given no Cloudflare credentials When the resource bootstrap runs Then it prints `SKIP deploy:bootstrap: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set` and exits 0 — proof: `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID pnpm deploy:bootstrap -- --r2`
- AC-11 Given operator credentials When `pnpm deploy:bootstrap -- --r2` runs twice and then the branch deploys to staging Then the first run creates the three UGC buckets per environment and the queue, the second changes nothing, and a P1 test upload on staging reaches `described` after `/_test/drain-queue` — proof: manual: operator workstation, run the bootstrap twice, `pnpm deploy:prod -- --env staging`, then upload `tests/fixtures/ugc/ok.png` through routes 34 and 33 with a staging P1 token and read the draft
- AC-12 Given an encounter with 8 completed turns When its player reports turn 7 through route 41 with `chat_turn` id `enc:<npcId>:<encounterId>:7` Then one `P2_REVIEW` case exists whose `subject_snapshot` holds turns up to and including 7 verbatim (at most 20); after the DO has flushed, the snapshot comes from the PRIVATE transcript; with neither it holds `expired: true` and the note; another profile reporting the same id gets `not_found`; a `room:` id gets `feature_disabled`, an id without a prefix `bad_request`; and no transcript text appears in any log line — proof: `pnpm check:workers -- npc-chat-report`
- AC-13 Given a QA build with routes 31 and 41 intercepted When the player greets `npc_test` and activates Report on the line Then the report button is visible in the dialogue panel and route 41 receives `target {kind:'chat_turn', id:'enc:npc_test:<encounterId>:<turnIndex>'}` with the values of the line's `meta` event — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-report`

## Test plan
- Workers runtime: the eight suites above (`pnpm check:workers -- npc-builder` runs the five `npc-builder-*` suites with M06b1's).
- E2E: `@npc-builder` (API-level, recorded moderation, in-memory `DataPort`); `@npc-report` (dialogue panel, intercepted routes).
- Static: `check:secrets`, `check:prod-routes`, `license:scan` (PDQ library, if added).

## Demo script
1. `pnpm dev` in recorded mode; register a P1 identity with the QA bridge.
2. Create a draft (M06b1), request an upload, PUT `tests/fixtures/ugc/ok.png`, commit, call `/_test/drain-queue`.
3. `GET /drafts/:id`: the image is `described`; read the description.
4. Mint a linked test token in a Workers test; submit; approve with a staff token; `GET /community` lists the NPC.

## Effort
1 Builder session; about 39 files; risk **medium**. Presigning against the R2 S3 endpoint and the scan ordering are the main work; vendor calls stay behind recorded ports.

## Risks & fallbacks
- No PDQ implementation clears `license:scan`: ship SHA-256 only, record a Builder decision, and leave PDQ to M13d1 with the hash banks.
- SigV4 presigning library choice is not in the ledger: take what pnpm resolves (record it in `spec/03`), or implement SigV4 with WebCrypto; the AC asserts the host, signed header and expiry, not the library.
- Haiku image-input request shape: use only what `research/ai-npc-runtime.md` and `research/claude-5-5-model-facts.md` state; the ACs run on recorded responses.
- Q-16 filings pending: photos are never publishable (stub above); NCMEC reporting stays the CyberTipline web form until M13d1.

## Notes for the Builder
- Read first: `04-npc-builder.md` §C1, §C3, §C5, §C10; `09-backend-db.md` §3.4, §4; `spec/05-api-and-realtime.md` §1.2, §3 (routes 33, 34, 41, 43); `09-backend-ops.md` §3; DL-175, DL-182, DL-OWN-01.
- Order: bindings and bootstrap → route 34 → scan consumer (hash, classify, describe) → images sub-route → submit and snapshot → route 43 → community → route 41 (`npc_soul`, then `chat_turn`) → capability flag → e2e.
- **Workers Free (DL-OWN-08, DL-746):** Queue consumer CPU on Free is UNVERIFIED (`spec/03-decisions-and-facts-2.md` §8, RISK-31). Hash the image as a stream; on the AC-11 staging upload read the dashboard metric "Exceeded CPU Time Limits" for the consumer and record it in the report; if a 10 MiB image exceeds it, lower the route 34 size cap to the measured safe size and record a Builder decision. Each scanned image costs at least 3 of the 10,000 daily Queue operations.
- Previews run no queue consumers: test the consumer by direct invocation in Workers tests and through `/_test/drain-queue` on staging.
- Never log image bytes, descriptions of quarantined items, or the query string of a presigned URL.
- Branch `m06b2-builder-images-review`.

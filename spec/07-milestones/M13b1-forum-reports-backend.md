# M13b1 — forum-reports-backend

## Goal
The forum has a backend. A new migration adds the forum tables of `09-backend-db.md` §3.7 (boards, threads, posts, votes) with RLS, the counter trigger (thread and post scores, post counts, experience `rating_sum`/`rating_count`) and the six seed boards. `tha-bay-web` serves C12 routes 38–40: thread lists with `sort` and title search `q`, posts with `since` polling, votes. The posting rules apply: tier `device` or higher, registered ≥ 72 h ago, bracket `18p`, `RL_FORUM`, quotas and the 30-second spacing. Post text is moderated after posting, and a `review` verdict holds the post. Report route 41 (M06b2) now covers forum posts, forum attachments, experiences and mod versions: three distinct reporters (or one `mod:trust_lead`) unlist the target and open a `P2_REVIEW` case. The flag `forum.enabled` gates every route. Pages come in M13b4, and experience and mod links come in M13b2.

## Requirements
- R-MOD-03: forum backend for discussing and voting on experiences and mods. Reports unlist forum content and published UGC.
- R-IP-03: a report path on every forum object. `child_safety` and `intimate_image` reports open P0 at once. `copyright` redirects to the DMCA form.

## Depends on
- **M05d**: Supabase projects, migrations 0001–0002, `DataPort` and `InMemoryDataPort`, `check:db`, `check:db:types`, `db:push` in `deploy.yml`.
- **M06b1**: migration 0004 (`moderation_item`, `moderation_case`, `user_report`, `enforcement_action`, `uploads`), the text-moderation module (`names:lint`, OpenAI omni, Haiku classifier) and route 43 for `P2_REVIEW`.
- Contracts: C12 1.1.0 (`09-backend-contracts.md` §2.4 rows 38–41, §2.5 `ReportReq`, §2.6 `DataPort.forum`; `09-backend-contracts-1.1.md` §1 and §3), C17 1.0.0 (`rating`), C16 1.1.0.

## Scope in
- Migration `supabase/migrations/00071_forum.sql`. M13a2 created and applied `0007_ugc_forum.sql`, and an applied migration file is never edited. Read 0007 first. 00071 adds only the §3.7 forum objects that 0007 lacks: tables, indexes (including the GIN `tsv` index from DL-190), RLS and the policies `ft_public_read`, `fp_public_read`, `ft_author_insert`, `fp_author_insert`, `fv_self`. It also adds:
  - the trigger `forum_votes_apply`, which keeps `forum_threads.score`, `forum_posts.score` and `experiences.rating_sum`/`rating_count` in step on insert, update and delete of a vote. `up = (count + sum) / 2` stays derivable (C17);
  - the trigger `forum_posts_count`, which keeps `post_count` and `last_post_at`;
  - seed rows for `announcements` (`min_tier 'staff'`), `experiences`, `mods`, `field-notes`, `help` and `general` (`device`), as in `12-modding-publish.md` C§5.
- `packages/shared/src/mod/forum.ts` (pure): `FORUM_BOARDS` (ids, title keys, `minTier`, linked object; must equal the seed), `FORUM_LIMITS` (title 3–120, body 1–10,000, attachments ≤ 4, 30 s spacing, 20 per day under 7 days and 100 after, `q` 3–80), `validateFieldNote(body)` (C§5 sections) and `hotScore` (unused by routes; `sort` is `new|top` per DL-190).
- `packages/shared/src/api/v1.ts`: forum DTOs `ForumThreadDto`, `ForumPostDto`, `CreateThreadReq`, `CreatePostReq`, `VoteReq`, as `spec/05-api-and-realtime.md` §3 row 38 assigns to this milestone. `C12_VERSION` stays `'1.1.0'`.
- `services/edge/src/forum/`: routes 38–40 and the `ForumStore` half of `DataPort` (one method per route, `09-backend-contracts.md` §2.6), in `data/supabase` (user path with the caller's JWT for writes and votes) and in `InMemoryDataPort` (same semantics as the triggers).
- Posting rules for routes 38 and 39 POST:
  - tier `local` → `tier_required`;
  - bracket other than `18p` → `age_blocked`;
  - `profiles.registered_at` < 72 h ago → `forbidden`, `details.reason: 'account_age'`, `retryAfterMs`;
  - `forum_boards.min_tier` above the caller's tier → `tier_required`;
  - `RL_FORUM` (2 per 60 s per pid) → `rate_limited`;
  - `PlayerQuotaDO` kind `post`: 20 per day for profiles under 7 days old, else 100; one post per 30 s → `rate_limited` with `retryAfterMs`;
  - `publish_ban` or `suspend` in `enforcement_action` → `forbidden`;
  - `field-notes` bodies must pass `validateFieldNote` (`bad_request` with the missing section in `details`);
  - `experiences` threads need `experience_id`; `mods` threads take `mod_id` (both resolved from public ids; database UUIDs never leave the server).
- Moderation:
  - synchronous `names:lint` (public side) and a street-address pattern on title and body. A hit stores the post `held`.
  - Otherwise the post is `visible`, and a `UGC_SCAN` message of kind `forum_text` runs M06b1's text chain. `review` → `held` plus a `P2_REVIEW` case. `block` → `removed` plus a case.
  - The first three posts with attachments from an account under 7 days old are `held` (`P3_REVIEW`).
- Votes (route 40): `value` −1, 0 (delete) or 1; one per profile per target; self-votes → `forbidden`. Target kinds are `thread`, `post` and `experience`. An experience vote needs a `published` experience.
- Report extension in `services/edge/src/ugc/report-policy.ts`, a table from `ModSubject` to its unlist action:
  - `forum_post` → `held`; the opening post holds its thread. There is no `forum_thread` subject, so the forum UI reports a thread through its opening post.
  - `forum_attachment` → the attachment is hidden.
  - `experience` → `moderation_state 'unlisted_pending_review'`.
  - `mod_version` → state `unlisted_pending_review`.
  - `profile` and `chat_turn` → case only.
  - The threshold is 3 distinct reporters, or 1 `mod:trust_lead`. `child_safety` and `intimate_image` open P0 at the first report. `copyright` → 409 `conflict` with `details.redirect: '/legal/dmca'`.
- `forum.enabled` false → routes 38–40 return `feature_disabled`. Route 41 stays on.
- `services/edge/wrangler.jsonc`: `RL_FORUM` rate-limit binding (also under `previews`).

## Scope out
- Forum pages, composer and report buttons in the UI → M13b4.
- Auto-created experience and mod threads, store↔forum links, `rating` in route 37 cards → M13b2. Rating updates already happen here through the trigger.
- Attachment upload: route 34 with purpose `forum_attachment` exists from M06b2. This milestone stores committed upload ids only.
- Body full-text search (deferred by C§5), `hot` sort (DL-190), Realtime (polling only).
- Legal intake, all-queue case tooling and the SLA pager → M13d1.

## Deliverables
- `supabase/migrations/00071_forum.sql`; pgTAP `supabase/tests/rls_forum.sql` (anon reads visible only; `local` cannot insert; author-only insert; vote self-policy) and `supabase/tests/forum_counters.sql` (vote and post triggers, experience rating, seed equals `FORUM_BOARDS`).
- `packages/shared/src/mod/forum.ts`, `packages/shared/src/mod/forum.test.ts` (field-note fixtures, limits, board ids); `packages/shared/src/db.gen.ts` regenerated.
- `packages/shared/src/api/v1.ts` (forum DTOs).
- `services/edge/src/forum/{routes,threads,posts,votes,rules,moderation}.ts`; `services/edge/src/data/supabase/forum.ts`; `InMemoryDataPort` forum store; `services/edge/src/ugc/report-policy.ts` (route 41 handler updated); `services/edge/src/router.ts` (rows 38–40).
- `services/edge/test/`: `forum-post-rules.test.ts`, `forum-votes.test.ts`, `forum-search.test.ts`, `forum-moderation.test.ts`, `report-threshold.test.ts`.
- `services/edge/wrangler.jsonc` (`RL_FORUM`).
- Secrets: none new. `SUPABASE_SECRET_KEY` (M05d) and `OPENAI_MODERATION_API_KEY` (M06b1) are reused. Without the moderation key, the `forum_text` consumer prints `SKIP … OPENAI_MODERATION_API_KEY not set`, leaves posts `visible` after the synchronous checks, and tests use M06b1's recorded fixtures.

## Interfaces
- C12 1.1: routes 38–41 as tabled. Forum DTOs are added to `v1.ts` where `spec/05` §3 row 38 places them, and the version does not change. `ForumStore` gets one method per route as §2.6 states. `ReportReq` and `ModSubject` are unchanged.
- C17 1.0: `rating {sum, count}` is fed by `experiences.rating_sum`/`rating_count`. No shape change.
- No contract change. Forum boards are a shared constant, not a route.

## Acceptance criteria
- AC-1 Given a fresh local database with migrations 0001–0007 and 00071 When the pgTAP suites run Then `anon` reads only `visible`/`locked` threads and `visible` posts, a `local`-tier JWT cannot insert a thread, a `device` JWT inserts only with its own `author_profile_id`, a vote changes the target's `score` (and `rating_sum`/`rating_count` for an experience) and deleting it restores them, and the seeded board rows equal `FORUM_BOARDS` — proof: `pnpm check:db`
- AC-2 Given the migration When types are regenerated Then `packages/shared/src/db.gen.ts` has no diff — proof: `pnpm check:db:types`
- AC-3 Given profiles of tier `local`, of tier `device` registered 71 h ago, of tier `device` registered 73 h ago with bracket `18p`, and of tier `device` with a `publish_ban` When each posts a thread to `general` Then the answers are `tier_required`, `forbidden` with `details.reason = 'account_age'` and a `retryAfterMs`, 201, and `forbidden` — proof: `pnpm check:workers -- forum-post-rules`
- AC-4 Given a 73-hour-old profile under 7 days old When it posts twice within 30 s and then 21 times across a day (clock mocked) Then the second post is `rate_limited` with `retryAfterMs` ≤ 30,000, and post 21 is `rate_limited` — proof: `pnpm check:workers -- forum-post-rules`
- AC-5 Given a `field-notes` thread body without `## Verification` When posted Then the answer is `bad_request` naming the missing section; a complete body is accepted — proof: `pnpm check:unit -- packages/shared/src/mod` and `pnpm check:workers -- forum-post-rules`
- AC-6 Given 30 threads in one board When listed with `sort=new`, `sort=top`, `q=market` and `limit=10` Then the order is by `created_at` and by `score`, the search returns only titles matching the term, pages chain through `next`, and a `q` of 2 characters is `bad_request` — proof: `pnpm check:workers -- forum-search`
- AC-7 Given a profile voting +1, then −1, then 0 on another profile's post, and +1 on its own post When the votes land Then the post score goes 1, −1, 0, and the self-vote is `forbidden` — proof: `pnpm check:workers -- forum-votes`
- AC-8 Given a post whose recorded moderation fixture returns `review` When the `forum_text` consumer runs Then the post is `held`, a `P2_REVIEW` case exists, and route 39 GET no longer lists it for other callers — proof: `pnpm check:workers -- forum-moderation`
- AC-9 Given a visible forum post, a published experience and a published mod version When three distinct profiles report each one (`harassment_hate`) Then after the third report the post is `held`, the experience is `unlisted_pending_review`, the mod version is `unlisted_pending_review`, each has one `P2_REVIEW` case, and two reports alone changed nothing — proof: `pnpm check:workers -- report-threshold`
- AC-10 Given a single `intimate_image` report on a post and a `copyright` report on another When filed Then the first opens a `P0_NCII` case and holds the post at once, and the second answers 409 `conflict` with `details.redirect = '/legal/dmca'` — proof: `pnpm check:workers -- report-threshold`
- AC-11 Given `forum.enabled` false in `FLAGS_JSON` When routes 38–40 are called Then each returns `feature_disabled` and route 41 still accepts a report — proof: `pnpm check:workers -- forum-post-rules`
- AC-12 Given this branch's PR When `preview.yml` deploys the Preview Then the smoke check passes and `GET /api/v1/forum/threads?board=general` answers JSON — proof: manual: desktop browser, open the PR's Preview URL plus `/api/v1/forum/threads?board=general`; then `pnpm check:smoke -- <preview-url>`

## Test plan
- DB: `rls_forum.sql`, `forum_counters.sql`; `pnpm check:db`, `pnpm check:db:types`.
- Unit: `shared/mod.forum` (`validateFieldNote` fixtures, `FORUM_LIMITS`, board ids); `pnpm check:unit -- packages/shared/src/mod`.
- Workers: `forum-post-rules`, `forum-search`, `forum-votes`, `forum-moderation`, `report-threshold` (InMemoryDataPort, rate-limit and quota stubs, mocked clock); `pnpm check:workers -- forum` and `pnpm check:workers -- report-threshold`.
- Static: `pnpm check:prod-routes` (no `/_test/` handlers added).
- Deployed: Preview smoke (AC-12). Merging to `main` runs `db:push` to staging.

## Demo script
1. `pnpm check:db`; the forum pgTAP files pass.
2. `pnpm dev`. With a QA device profile, `curl` a POST to `/api/v1/forum/threads` (board `general`); the thread appears in the GET list.
3. Vote on the post from a second profile; the thread `score` changes in the list.
4. Report it from three profiles; the third report hides it, and `GET /api/v1/admin/cases?queue=P2_REVIEW` (staff JWT) lists the case.
5. Set `forum.enabled` false; the routes answer `feature_disabled`.

## Effort
1 session; ≈ 30 files; risk **medium**. The most work is in the rules matrix and in keeping `InMemoryDataPort` faithful to the triggers.

## Risks & fallbacks
- **Migration file name.** `00071` sorts between `0007` and `0008` as text. If `supabase db push --dry-run` against staging (printed by `db:push` in `deploy.yml`) does not list 00071 as the only pending file, stop before merge, record the CLI behaviour in `spec/03`, and report it. Never edit `0007_ugc_forum.sql` after it has been applied.
- **The user-path JWT is refused by RLS on staging** (TPA misconfigured): writes fall back to the service path, the Worker checks `author_profile_id = ctx.profileId` itself, and a Builder decision is logged. pgTAP still proves the policies.
- **The moderation vendor is down**: posts stay `visible` after the synchronous checks. The message is retried by the queue, and the report path still unlists.

## Notes for the Builder
- Read first: `09-backend-db.md` §3.7 and §8; `09-backend-contracts.md` §2.4 rows 38–41, §2.5, §2.6; `09-backend-ops.md` §3.1; `12-modding-publish.md` C§5; `spec/05-api-and-realtime.md` §3 rows 38–41; DL-190.
- Run order puts M13a2 (migration 0007: `mods`, `experiences`) before this milestone. The forum foreign keys need those tables. If 0007 is missing, stop and report.
- Order of work: migration and pgTAP → `forum.ts` → DTOs → store (Supabase and in-memory) → routes and rules → moderation consumer → report policy → tests → wrangler binding.
- User text is stored as given and returned as text. Rendering rules (no HTML) belong to M13b4.
- Branch `m13b1-forum-reports-backend`.

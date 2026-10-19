# M13c2 — publish-pipeline-server

## Goal
Publishing a mod or experience version works end to end on the server. Route 36 takes a version from the CLI token (M13c1) or a P2 browser JWT, records the attestation and enqueues a scan. `ModScanPipeline` runs the sixteen stages of `12-modding-publish.md` C§3.1: the local stages with the same shared validators as `dv mod check`, then hash banks first, server strings, classifiers, anchor rules and human review. The C§3.2 state machine moves versions and placements, reviewers decide through route 43, and archives are promoted or quarantined. Route 37 POST adds placements with server-computed anchors. A rebake Workflow re-validates placements, and removals feed route 53's revocation list. While `ugc.publish` is false (production, until M13d1) an approved version stays private to its owner.

## Requirements
- R-MOD-03: everything published is moderated; approval opens the forum thread.
- R-MOD-04: validated anchors; map markers only when `published ∧ public`.
- R-IP-03: hash-first scanning, quarantine, human review, revocation of installed copies.

## Depends on
- **M13c1**: CLI token (`aud: 'tha-bay-cli'`, `scp: ['mods:publish']`, typed by C12 1.2 `AccessClaims`), the `linked` tier rule, `audit_log` writes for identity actions.
- **M13a1**: C14/C17 types and schemas, shared validators `packages/shared/src/mod/check/*` (envelope, allowlist, schema, permissions, secrets, IP, provenance, caps, budget report, script lint), the 40-manifest parity corpus, `ModCheckResult`.
- **M13b1**: forum routes over the 0007 tables, report policy, DTOs.
- **M13b2**: `ensureLinkedThread` and the anchor-mask reader (DL-219).
- Contracts: C14 1.0.0, C17 1.0.0, C12 1.2.0 (routes 34–37, 41, 43, 53; `ModSubject`; `09-backend-contracts-1.1.md` §1 route 36 rule), C07 1.1.0 (`ProvenanceRecord`, mod `AssetSource`), C08 1.0.0 (`chunkKeyOf`, `WorldIndex.bakeId`, `DistrictId`).

## Scope in
- Route 34 purposes added to M06b2's purpose table (`services/edge/src/ugc/policy.ts`); auth for both is route 36's (CLI token with `mods:publish` or a `linked` JWT; bracket `18p`; no `publish_ban`) and both count against M06b2's `upload` quota:
  - `mod_archive`: `application/zip` only (else `unsupported_media_type`), ≤ 128 MiB (else `payload_too_large`; `spec/05-api-and-realtime.md` §3 row 34). The upload stays `issued` and is never scanned on its own: route 36 consumes it and enqueues the scan (C12 1.1 route 36 rule), and a route 34 commit on it → `bad_request`.
  - `experience_thumb`: `image/png|webp` (else `unsupported_media_type`), ≤ 10 MiB. Commit enqueues one `UGC_SCAN` message of kind `experience_thumb` that runs M06b2's image chain in its order (hash first; minors × sexual → `ugc-quarantine-<env>/csam/…` and a `P0_CSAM` case). C17 `thumbUrl` is set, and the image copied to `ugc-public-<env>`, only on verdict `allow`; any other verdict or a vendor error leaves `thumbUrl` absent.
- `services/edge/src/publish/route36.ts`: `POST /mods/:id/versions` ⓘ.
  - Auth: CLI token (`aud`, `scp` checked by value) or a `linked` JWT; bracket `18p`; no `publish_ban` (else `tier_required`, `age_blocked`, `forbidden`). Limits 5 versions/day and 20 mods per profile → `rate_limited` (`publish.rate`). Bad attestation → `bad_request` (`publish.attestation`). Another profile's `ModId` → `forbidden`.
  - `uploadId` must be an `issued` upload of purpose `mod_archive` owned by the caller. The handler HEAD-checks its size, creates `mods` if new, creates `mod_versions` (`scanning`) and one `moderation_item`, enqueues `UGC_SCAN` (kind `mod_archive`), and answers 202 `ModVersionsRes`.
  - The same `(modId, version)` with the same archive SHA-256 is idempotent (same ids). A different archive → `conflict`.
  - An inline `placement` creates an `experiences` row (`needs_review`) under the same case.
- `services/edge/src/publish/route37.ts`: `POST /experiences` ⓘ (P2), a later placement of a `published` version: ≤ 3 per version, ≤ 10 public per profile ≥ 100 m apart, radius ≤ authored and ≤ 250. The server computes `chunkKey`, `nhood`, `worldVersion` and `modSha256` and ignores client values. Each placement gets its own `P2_REVIEW` case.
- `services/edge/src/ugc/mod-scan/` (`ModScanPipeline`, `UGC_SCAN` consumer):
  - stages 1–3, 5–10: call the shared functions on a streamed archive (fflate), entry by entry, never holding the whole archive in memory;
  - stage 4: SHA-256 (and PDQ where M06b2's image chain computes it) of every image against `HashBankPort`. A match quarantines the whole archive to `ugc-quarantine/other/<item>/` (`csam/` when the bank says so), sets the version `removed`, opens a P0 case, and calls no other vendor stage;
  - stage 7 server half: real-side name strings from the PRIVATE object `config/names-real.json` (operator upload). Absent → public denylist only and a `SKIP` log;
  - stage 11: header parsing from the shared budget report (full validators stay CLI-side);
  - stage 12: M06b1's text chain over names, summaries, `strings`, sign texts and README;
  - stage 13: M06b2's image chain on thumbnails and photo-like textures (`real_human_visible ∧ is_photograph` blocks);
  - stage 14: anchor rules, plus the `uses.npcs` rule (in `anchor-rules.ts`; DL-545 (c)): every id is a built-roster id with `ugcCameo` true, or a `u_…` id whose `owner_profile_id` equals the server-stamped `author.id` and whose status is `published`; any other id is an `error` finding `likeness.tier` naming the id (C14 1.0 has no dedicated code; propose one in the report);
  - stage 15 (malware hygiene): a port that records `error: 'not_configured'` and never blocks;
  - stage 16: opens the human case, `P2_REVIEW` for experiences and `P3_REVIEW` for other mods, with `subject_snapshot` (manifest, budget report, signals, placement ring).
  - Each stage writes one `moderation_signal` (`source` = stage id). Creators see `ModFinding`s for L stages only, and a generic policy message for hash, classifier and quarantine outcomes.
- Anchor rules (`services/edge/src/mods/anchor-rules.ts`, on M13b2's mask):
  1. outside bounds or water → `anchor.outside_sf`;
  2. not within 15 m of class `right_of_way` and not in class `park` → `anchor.not_public_land`;
  3. with a residential layer present: anchor or `entryRules.start` inside residential, or under half of the radius disc non-residential → `anchor_residential`; without the layer → a `review` signal asking the reviewer to check the 25 m ring (`12-modding-publish.md` C§4);
  4. a street-address string in any text (number plus a street name from the `sf-geocode` street table) → `anchor.address_string` as `review`.
- `packages/shared/src/mod/publish-state.ts` (pure): the C§3.2 transitions for `ModVersionState` and `ExperienceModeration`. Every other transition throws.
- Route 43 decisions for subjects `mod_version` and `experience`:
  - `approve`: `published`. Visibility is the requested one if `ugc.publish` is true, else `private`. Copy the archive to `ugc-public/ugc/published/<sha256>.zip`. If the visibility is not `private`, call `ensureLinkedThread`.
  - `reject`: `rejected` (appeal window 7 days; the queue arrives in M13d1).
  - `remove`: `removed`, deletes the public object, adds a revocation entry that route 53 lists (reason from the policy code).
- `services/pipeline/rebake/workflow.ts` (`RebakeRevalidationWorkflow`). A daily cron starts it for placements whose `world_version` differs from the current `bakeId`; it re-runs stage 14 and `compat.world`, then sets `needs_update` (pin removed) or updates `world_version`. Workflow binding in `wrangler.jsonc` (not a DO class); Previews have no own Workflows, so steps are tested directly.

## Scope out
- Legal takedowns, the appeals queue, route 45 and `hash_bank_entry` → M13d1 (until then `HashBankPort` is a fixture bank in tests and empty when deployed).
- ClamAV hygiene container (stage 15) and server-side `gltf-validator`/`ktx validate` (stage 11 server half): post-v1 (DL-240); v1 runs stage 11 in `dv mod check` and the shared structural validators on the server.
- Author yank: no C12 route in v1 (DL-240); an author asks for removal on the help board and staff act through route 43.
- `dv mod publish` and `dv login` → M13c3. Flipping `ugc.publish` in production → after M13d1 (DL-151).

## Deliverables
- `services/edge/src/publish/{route36,route37,auth,limits,decisions,promote,upload-purposes}.ts`; `services/edge/src/ugc/mod-scan/{pipeline,stream,stages-local,hash-bank,strings,text,images,hygiene,case}.ts`; `services/edge/src/mods/anchor-rules.ts`; router rows 36–37; route 43 handler extension.
- `packages/shared/src/mod/publish-state.ts` with `publish-state.test.ts`.
- `services/pipeline/rebake/{workflow,cron}.ts`; `services/edge/wrangler.jsonc` (Workflow binding, cron, repeated under `previews` where allowed).
- `services/edge/test/{mod-publish-route,mod-upload-purposes,mod-scan-quarantine,mod-scan-parity,anchor-rules,publish-flag,revocation-list,rebake-revalidation}.test.ts` (`anchor-rules` extends M13b2's file); fixtures: archives built from M13a1's corpus, a fixture hash bank, a fixture mask with a residential layer, recorded classifier responses.
- Secrets: none new. `OPENAI_MODERATION_API_KEY` (M06b1) and `ANTHROPIC_API_KEY` (M06a3, classifier) are reused. Absent → stages 12–13 record `error: 'not_configured'` and route the item to human review, never to `published`; tests use recordings. `PHOTODNA_KEY` waits for Q-16 (M13d1).

## Interfaces
- C14 1.0 and C17 1.0 types as typed (server-owned `moderation`, `visibility`, `chunkKey`, `worldVersion`, `modSha256`, `thumbUrl`). C12 1.1: route 34 with `UploadReq.purpose` `mod_archive` and `experience_thumb` as already typed; routes 36–37 POST (route 36 takes both token kinds and enqueues the scan), route 43, `ModSubject`. C07 1.1 provenance through the shared gate cores; C08 1.0 `chunkKeyOf`, `bakeId`.
- Not in v1 (DL-240): an author yank route; a server-side glTF/KTX validation host.
- No contract change.

## Acceptance criteria
- AC-1 Given an archive whose thumbnail's SHA-256 is in the fixture bank When it is published and scanned Then the archive moves to `ugc-quarantine`, the version is `removed`, a P0 case exists, the text and image classifier mocks record 0 calls, and the creator-facing state carries only the generic policy message — proof: `pnpm check:workers -- mod-scan-quarantine`
- AC-2 Given M13a1's 40-manifest corpus packed as archives When the pipeline's local stages run in the Workers harness Then each verdict and finding code equals the CLI verdict recorded in the corpus — proof: `pnpm check:workers -- mod-scan-parity`
- AC-3 Given route 36 calls with a CLI token, a `linked` browser JWT, a `device` JWT, a CLI token without `mods:publish`, a body without attestation, a sixth version in one day, a replay of the same version and archive, the same version with another archive, and another profile's `ModId` When each is sent Then the answers are 202, 202, `tier_required`, `forbidden`, `bad_request` (`publish.attestation`), `rate_limited`, 202 with the same ids, `conflict` and `forbidden` — proof: `pnpm check:workers -- mod-publish-route`
- AC-4 Given the fixture mask with a residential layer When placements are validated at a water point, 30 m from right-of-way on other land, inside a residential polygon, with 60 % of the disc residential, and on a street Then the codes are `anchor.outside_sf`, `anchor.not_public_land`, `anchor_residential`, `anchor_residential`, and none; with the residential layer absent the street point passes with a `review` signal; a client-sent `chunkKey` is ignored and the stored one equals `chunkKeyOf(lat, lng)`; and a manifest whose `uses.npcs` names the author's `published` `u_…` NPC passes while one naming another profile's `u_…` NPC, or the author's `private` one, gets `likeness.tier` — proof: `pnpm check:workers -- anchor-rules`
- AC-5 Given a published version When a fourth placement, an eleventh public placement for the profile and a placement 80 m from the profile's other one are posted Then each is refused with a 4xx and the stored placements are unchanged — proof: `pnpm check:workers -- mod-publish-route`
- AC-6 Given `ugc.publish` false When a reviewer approves an experience version that requested `public` Then its state is `published`, its visibility `private`, anonymous route 35 and route 37 lists exclude it, its owner's listing includes it, and no forum thread exists; with `ugc.publish` true the same approval yields `public`, one linked thread, and a route 37 entry for its chunk — proof: `pnpm check:workers -- publish-flag`
- AC-7 Given every pair of states When the pure transition function is asked Then exactly the C§3.2 edges are allowed for versions and placements — proof: `pnpm check:unit -- packages/shared/src/mod`
- AC-8 Given a published version installed by a client fixture When staff decide `remove` with a DMCA policy code Then the public archive object is deleted, route 53 lists the version with `reason: 'dmca'`, and route 35 detail shows `removed` — proof: `pnpm check:workers -- revocation-list`
- AC-9 Given placements stamped with bake A, one whose mod's `compat.world` includes the new bake B and one whose does not When the rebake steps run against B Then the first stays `published` with `worldVersion` B, and the second becomes `needs_update` and leaves the route 37 public list — proof: `pnpm check:workers -- rebake-revalidation`
- AC-10 Given recorded classifier fixtures returning `review` for a sign text and `block` for a thumbnail When two archives are scanned Then the first reaches `needs_review` with the stage-12 signal and a `P2_REVIEW` case, and the second is `rejected` with a policy code and no case — proof: `pnpm check:workers -- mod-scan-quarantine`
- AC-11 Given the production build and the pipeline harness When checks run Then no `/_test/` handler exists and the mock pipeline still passes — proof: `pnpm check:prod-routes && pnpm check:pipeline`
- AC-12 Given this branch merged to `main` When `deploy.yml` deploys staging Then smoke passes and `POST /api/v1/mods/x.y/versions` without a token answers `unauthorized` — proof: manual: desktop browser and terminal, read the deploy summary, `curl -X POST` that path on staging; then `pnpm check:smoke -- <staging-url>`
- AC-13 Given route 34 When a `device` JWT requests a `mod_archive` upload, a CLI token requests one as `application/zip` at 129 MiB, as `image/png`, and as `application/zip` at 1 MiB and then commits it, and a `linked` JWT requests an `experience_thumb` whose recorded classifiers return minors × sexual and another returning `allow` Then the answers are `tier_required`, `payload_too_large`, `unsupported_media_type`, an `UploadRes`, and `bad_request` on the commit with no `UGC_SCAN` message; the first thumb is copied to `ugc-quarantine` with a `P0_CSAM` case and never yields a `thumbUrl`, the hash stage is logged before any classifier call, and the second yields a `ugc-public` `thumbUrl` only after the queue drains — proof: `pnpm check:workers -- mod-upload-purposes`

## Test plan
- Workers suites named in the ACs (InMemoryDataPort, R2 stubs for the three UGC buckets, queue drained through `/api/v1/_test/drain-queue` semantics, recorded vendor responses); unit `shared/mod.publish-state`; `pnpm check:pipeline`; `pnpm check:prod-routes`; staging smoke (AC-12).

## Demo script
1. `pnpm dev`; as a QA `linked` profile, upload M13a1's example experience and POST route 36.
2. Drain the queue; read the signals and the `P2_REVIEW` case.
3. Approve with a staff JWT: with `ugc.publish` false the version is `private`; with it true (local `FLAGS_JSON`) it is listed in route 37 and has a forum thread.
4. Remove it; route 53 lists the revocation.

## Effort
1 session; ≈ 38 files; risk **medium-high**. Stage adapters are mostly glue over M13a1, M06b1, M06b2 and M13b2.

## Risks & fallbacks
- **Archive size versus Worker memory and CPU** (U-BE-13 for queue consumers): stream entries and hash incrementally. If a 128 MiB fixture exceeds the limits, archives above the measured safe size get a `review` signal and wait for a human, and the Builder records the measured size. Never skip stages 1–4.
- **PDQ unavailable in the Worker**: SHA-256 only (AC-1 uses SHA-256); PDQ waits for M13d1's sweep.
- **Workflow config key rejected** by the pinned wrangler: run the same steps as a cron-driven queue job and log a Builder decision; AC-9 tests the steps directly.
- **`ugc.<domain>` cache** (Q-15 open): no custom domain means no cache, so removal is a delete; purge joins with the domain.

## Notes for the Builder
- Read first: `12-modding-publish.md` C§3, C§4, C§7; `12-modding-contracts.md` B§6–B§7; `12-modding.md` §2.1, §5.5; `09-backend.md` §3.4; `09-backend-db.md` §3.4, §3.7, §4; `spec/05-api-and-realtime.md` §3 rows 34–37, 43, 53.
- Order is load-bearing: stage 4 runs before any vendor sees an image.
- Run order puts M13a2 (tables `mods`, `mod_versions`, `experiences`), M13a3 (route 37 GET) and M13b2 (mask, `ensureLinkedThread`) before this milestone. Stop and report if any is missing.
- Branch `m13c2-publish-pipeline-server`.

# M06b4 — builder-publish-assets

## Goal
A linked 18+ player can ask for a custom 3D look for a private NPC draft through the builder's `assets` sub-route. That request never starts generation. It files a request that only the owner can approve (DL-175, DL-OWN-01). The owner, a staff profile with `admin`, approves it through route 43 with a written note. Approval reserves the estimate against the USD 100 fal programme cap and plans text-only Lean jobs. A staff operator then runs them with `pnpm assets:gen`: it always prints a dry-run estimate and spends only with `--live`, and CI and staging run it on `MockFalPort`. The generated character asset is attached to the draft. The NPC publish flow (submit, review, community listing) is then proven end to end, with either a generated look or the default creator-kit preset.

## Requirements
- R-NPC-03: the builder's publish path is complete, with the "same pipeline" for looks reached only through an owner-approved staff queue in v1.
- R-ENG-03: no player triggers spend. Every builder job is approved, estimated, reserved against the programme cap, and runs on mocks in CI.

## Depends on
- **M13c2**: route 43 decision handling across subjects, `audit_log` on staff writes, `P3_REVIEW` cases, the `linked` publishing rule and P2 tokens.
- **M06b3**: NPC builder pages (step 8 "Look", step 9 "Submit"), `@npc-builder` e2e.
- **M10a1**: `assets:gen` plan, run and gate, Lean recipe, human gates, publish (DL-219).
- Uses through the run order: M06b1/M06b2 (route 33, drafts, submit, community list), M05b1 (`BudgetGovernorDO` with `budget_program` = 100,000,000 micros, `MockFalPort`, `check:pipeline`).
- Contracts: C10 1.0.0 (`c10-npc-builder.ts`: `DraftView.jobs`, `JobAccepted`; soul `assets`), C07 1.1.0 (`GenJob`, `jobKey`, `GateCode`, `ProvenanceRecord`, `assetTier`), C12 1.1.0 (route 33 `assets`, route 43, `ModSubject 'npc_asset'`, `PlayerQuota`).

## Scope in
- `services/edge/src/npc-builder/assets.ts`: `POST /npc-builder/drafts/:id/assets` (P2).
  - Preconditions:
    - tier `linked` (`tier_required`);
    - bracket `18p` (`age_blocked`);
    - flag `npc.builder` on and `ks:npc_builder` off (`feature_disabled`);
    - caller is the owner (`not_found`);
    - draft state `private` with `publishable = true` (`forbidden`);
    - at most one open request per draft and one per profile (`conflict`).
  - Effect: opens a `moderation_case` in `P3_REVIEW` with subject `npc_asset`. Its `subject_snapshot` holds `{npcId, draftId, rev, visualBrief, imageDescriptions, recipe: 'lean', estimateUsdMicros}`, with the estimate taken from `assets:gen`'s shared price table for the Lean recipe. The draft gets a job `{kind: 'assets', state: 'queued'}`, and the route answers 202 `JobAccepted`.
  - It reserves no `builder_job` quota (that quota is 0 for every tier in v1) and calls no `FalPort` method.
- Route 43 decision rules for `npc_asset` cases (`services/edge/src/npc-builder/assets-decision.ts`):
  - only a staff profile with scope `admin` may decide (`forbidden` for `mod:review` alone);
  - `approve` needs a non-empty `note`, which is the owner's written word (spec/99 Q-26);
  - on `approve`, `BudgetGovernor.reserve` (vendor `fal`, kind `asset`) runs for the estimate against the programme cap. If the cap's remainder is below the estimate → `conflict` with `details.reason: 'program_cap'`, and nothing is written. Otherwise a `gen_run` (`requested_by: 'builder:<draftId>:<caseId>'`, `env` from `GENAI_ENV`, `budget_usd_micros` = estimate) and its planned `gen_job` rows with C07 `jobKey`s are written;
  - `reject` marks the draft job `failed` with the reviewer's notes, and the draft keeps its creator-kit preset.
- Text-only inputs: the plan's sheet prompt is built from `visual_brief` and the image *descriptions* only. No `user_upload` `InputFile` is ever attached, so S05's `FACE_REF_FORBIDDEN` rule cannot trip and is asserted in tests. The likeness tier is the user soul's `fictionalized` with basis `original` (`04-npc-builder.md` §C4).
- `tools/assets/gen/builder.ts`: `pnpm assets:gen run --builder <runId> [--live]`, an extension of M10a1's `run`.
  - It refuses a run without an approved `npc_asset` decision (`not_approved`, zero vendor calls).
  - It prints the estimate and the programme remainder first, and spends only with `--live`.
  - It stops at the same human gates as roster runs.
  - On completion it publishes `character/u_<npcId>` with provenance and an `asset_index` tag `char:u_<npcId>`, settles the ledger from the fal billing event, sets the draft's look to that asset, and marks the job `done`.
  - `ks:fal` or `ks:genai:all` → refused with `KILL_SWITCH`. `FAL_MODE=mock` selects `MockFalPort`.
- Builder UI step 8 (`packages/ui/src/pages/npc-builder`, M06b3): for P2 owners of a publishable private draft, a "Request a custom look" button with the state chips `queued`, `running`, `done`, `failed`, and the reviewer note on failure. Others see only the preset picker.
- An end-to-end publish proof for both looks: draft → (optional look) → submit (route 33) → `P2_REVIEW` approve → community card.

## Scope out
- Any player-triggered generation, a public `GenJob` route, or a non-zero `builder_job` quota: not in v1 (DL-175, DL-205).
- Voice designs and t2 voices for user NPCs (schema forbids; Q-20).
- Spending the $8 buffer: each approval is the owner's call and needs the written note (Q-26 default: unspent).

## Deliverables
- `services/edge/src/npc-builder/{assets,assets-decision}.ts`; route 33 and 43 router edits; `InMemoryDataPort` support for `gen_run`/`gen_job` writes.
- `services/edge/test/{npc-builder-assets,npc-builder-publish-e2e}.test.ts`.
- `tools/assets/gen/builder.ts` and `tools/assets/gen/test/builder.test.ts`; `services/pipeline` test fixture for a builder run (`MockFalPort`, fixture GLB and sheet).
- `packages/ui/src/pages/npc-builder/LookStep.tsx` (edit) and `en` strings; `tests/e2e/npc-builder.spec.ts` (extended, `@npc-builder`).
- Secrets and gates: `FAL_KEY` stays with the operator (Q-17) and is never in CI or the Worker for this path. The prepaid fal balance is ≤ the remaining cap, with auto-recharge off (DL-OWN-01). Owner approval per job (scope `admin`). Absent `FAL_KEY` → `assets:gen run --builder … --live` prints `SKIP … FAL_KEY not set` and exits 0.

## Interfaces
- C10 1.0: `DraftView.jobs` kind `assets` with the existing states; `JobAccepted`; the soul's model asset ref. No shape change.
- C07 1.1: `GenJob`, `jobKey`, `GateCode` (`KILL_SWITCH`, `BUDGET`, `FACE_REF_FORBIDDEN`) and the provenance record as typed. `not_approved` is a CLI error, not a `GateCode`.
- C12 1.1: route 33 `assets` (P2) as tabled ("files a request for the owner-approved queue and starts no fal job"), route 43 decisions, `ModSubject 'npc_asset'`, `BudgetGovernor.reserve` with kind `asset`.
- No contract change.

## Acceptance criteria
- AC-1 Given a `linked` `18p` owner of a private publishable draft When it posts `assets` Then the answer is 202 `JobAccepted`, the draft shows job `assets` `queued`, one `P3_REVIEW` case with subject `npc_asset` holds the estimate, the `FalPort` mock records 0 calls, and no `gen_run` exists; a `device`-tier owner gets `tier_required`, a second request gets `conflict`, and a non-publishable draft gets `forbidden` — proof: `pnpm check:workers -- npc-builder-assets`
- AC-2 Given that case When a `mod:review`-only staff profile approves, an `admin` approves with an empty note, an `admin` approves with a note while the programme remainder is below the estimate, and an `admin` approves with a note within the cap Then the answers are `forbidden`, `bad_request`, `conflict` (`details.reason = 'program_cap'`, nothing written) and 204 with one `gen_run` whose `budget_usd_micros` equals the estimate, planned `gen_job` rows, and one governor reservation for vendor `fal` — proof: `pnpm check:workers -- npc-builder-assets`
- AC-3 Given an unapproved and an approved builder run under `FAL_MODE=mock` When `assets:gen run --builder` runs for each, first without `--live` and then with it Then the unapproved run exits `not_approved` with zero `FalPort` calls; the approved run without `--live` prints the estimate and makes zero calls; with `--live` it completes on `MockFalPort`, publishes `character/u_<npcId>` with a provenance record of tier `fictionalized`, tags `asset_index` with `char:u_<npcId>`, and marks the draft job `done` — proof: `pnpm check:pipeline && pnpm check:unit -- tools/assets`
- AC-4 Given an approved run When its planned jobs are inspected Then no job has a `user_upload` input, the sheet prompt contains the `visual_brief` and image descriptions only, and with `ks:fal` on the run is refused with `KILL_SWITCH` — proof: `pnpm check:unit -- tools/assets`
- AC-5 Given two drafts, one with a completed generated look and one with a creator-kit preset When each is submitted, approved in `P2_REVIEW` and listed in the community Then both are `published`, and their community cards carry `character/u_<npcId>` and `character/<preset>` respectively — proof: `pnpm check:workers -- npc-builder-publish-e2e`
- AC-6 Given the full builder Workers suite When it runs Then every earlier builder case (limits, states, moderation order, submit tier) still passes together with the new assets cases — proof: `pnpm check:workers -- npc-builder`
- AC-7 Given a QA build with a `linked` owner's private draft When step 8 opens Then "Request a custom look" appears, pressing it shows the `queued` chip, and a `device` owner sees only the preset picker — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder`
- AC-8 Given this branch's PR When the Preview deploys Then smoke passes and `POST /api/v1/npc-builder/drafts/x/assets` without a token answers `unauthorized` — proof: manual: desktop browser and terminal, `curl -X POST` that path on the Preview URL; then `pnpm check:smoke -- <preview-url>`

## Test plan
- Workers: `npc-builder-assets`, `npc-builder-publish-e2e`, regression `npc-builder`; `pnpm check:workers -- npc-builder`.
- Pipeline and tool: builder run on `MockFalPort`; `pnpm check:pipeline`, `pnpm check:unit -- tools/assets`.
- E2E: `@npc-builder` step 8.
- Static: `pnpm check:secrets -- apps/web/dist` (no `FAL_KEY` shape in the bundle), `pnpm check:prod-routes`.

## Demo script
1. `pnpm dev`; as a QA `linked` player, open a private publishable draft › Look › Request a custom look.
2. As staff `admin`, list `GET /api/v1/admin/cases?queue=P3_REVIEW`; approve with a note.
3. `FAL_MODE=mock pnpm assets:gen run --builder <runId>`; read the estimate; rerun with `--live`.
4. Reload the draft; the look shows the generated character; submit; approve in `P2_REVIEW`; see it in the community list.

## Effort
0.5 session; ≈ 18 files; risk **medium**. The approval and reservation rules are small. Hooking into M10a1's run path without changing its roster behaviour needs care.

## Risks & fallbacks
- **M10a1's `run` cannot take a non-roster subject**: add a builder adapter that produces the same `GenJob` list from the snapshot. Roster tests must stay green (`pnpm check:pipeline`).
- **Lean price missing from the shared price table**: use the registry list price that `genai:price` maintains. If absent, refuse the approval with `conflict` (`details.reason: 'no_price'`). Never approve without an estimate.
- **Live run exceeds the reservation**: the governor settles the actual cost, and the run stops at the next stage once the run cap is hit (S05 rule). The overspend comes out of the buffer and is reported to the owner.

## Notes for the Builder
- Read first: `04-npc-builder.md` C1 (step 8, limits), C3 (`assets` row), C4 (server-owned tier), C5 (review), C7 (cost); `05-assets-pipeline.md` §11–§12 (programme, runbook); `spec/06-asset-pipeline.md` (programme, `assets:gen` commands); `spec/11-decision-log.md` DL-OWN-01, DL-175; `spec/99-open-questions.md` Q-17, Q-26.
- Never call fal from the Worker on this path. The Worker files and approves, and only the operator's CLI spends.
- Branch `m06b4-builder-publish-assets`.

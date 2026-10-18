# M06b1 — builder-text-private

## Goal
A P0 player can create an original NPC from text and talk to it privately. Route 33's P0 sub-paths cover drafts, text validation, soul generation and the SSE preview chat. Text runs through the moderation chain (names lint → OpenAI omni moderation → Haiku classifier, with Llama Guard 3 as the fallback). Sonnet 5.5 then turns the backstory into a schema-valid, linted `soul.md`, with at most one repair. Five safety probes must pass before the draft becomes `private`. At that point its prompt is written to PRIVATE storage and route 31 serves the NPC to its owner only. Builder limits (live drafts, soul generations, preview turns) are enforced through `PlayerQuotaDO` kind `builder_text`. Migration `0004_moderation.sql` creates the moderation, upload and builder tables, so M06b2 can add images, submit, reports and case decisions on top. The NPC builder screens come in M06b3. This milestone is API-complete and testable end to end without them.

## Requirements
- R-NPC-03: backstory → soul.md via an LLM, preview chat, private use. Publishing waits for P2 and M06b2.
- R-IP-03: every draft passes moderation before generation (hash and classify first, generate last). Real-person signals make a draft non-publishable, and a P0 CSAM-text case is opened when the thresholds of `04-npc-builder.md` §C5 are crossed.

## Depends on
- **M06a3** (dialogue-proxy): `DialogueService` and the SSE path reused for the preview and for private talk, `PromptAssembler`, the safety lists, fixture upstream mode.
- Through M06a1 and M06a2: `PlayerQuotaDO` (`builder_text`), `EncounterDO`, `DataPort`, migration 0003, C10 schemas, `soul-1.0.llm.schema.json`, `npc:lint` rules as a library, `compileSoul`.
- Contracts: C10 1.0 (`04-npc-builder.md` §C3 builder types; §B2–§B4), C12 1.1 (route 33, `PlayerQuota.reserve` kind `builder_text`, `ModSubject`, `DataPort.moderation`, migration 0004), C16 1.1 (`npc.builder.step`).

## Scope in
- **Migration `0004_moderation.sql`:** `moderation_item`, `moderation_signal`, `moderation_case`, `moderation_decision`, `user_report` and `enforcement_action`, exactly as [research/gap-trust-safety-tooling.md §6.8], with Worker-minted uuid ids and `moderation_case.subject_snapshot jsonb`. The `mod_subject` enum carries the C12 1.1 `ModSubject` values. Also `uploads`, plus `npc_draft` and `npc_soul` per `04-npc-builder.md` §C2. All tables are server-only. A 180-day purge of unpublished drafts joins the 03:40 cron.
- **`DataPort.moderation`** (only the members this milestone uses: record item and signals, open case, read draft verdicts) and the builder draft store, in both ports.
- **Route 33 P0 sub-paths** (`04-npc-builder.md` §C3): `POST /drafts` ⓘ, `GET /drafts[/:id]`, `PUT /drafts/:id` (`If-Match`; a stale rev → 409), `DELETE /drafts/:id`, `POST /drafts/:id/validate` and `/soul` (202 `JobAccepted`, jobs on Queue `npc-builder`), and `POST /drafts/:id/preview` (SSE `DialogueEvent`). `images` and `submit` return `tier_required` for P0 and `feature_disabled` otherwise until M06b2. `assets` returns `feature_disabled` (M06b4).
- **State machine** of `04-npc-builder.md` §C1, from `draft` through `private`. Illegal transitions → 409. Edits create a new revision.
- **Limits** from `config/guardrails.yaml` `npc.builder.*`: 3 live drafts, soul generations 1 per draft per hour and 2 per day, 20 preview turns per draft per day. Reserved as `builder_text` and billed to the `npc-builder` workspace.
- **Text moderation** (validate job), in this order:
  1. `names:lint` aliases on the name, bio and backstory;
  2. OpenAI `omni-moderation-latest`;
  3. Haiku classifier with the structured output fields listed in §C5.1;
  4. Llama Guard 3 (`@cf/meta/llama-guard-3-8b` through the `AI` binding [research/gap-trust-safety-tooling.md]) when OpenAI is unavailable or switched off in `config/npc.json`.
- **Combination rules** (§C5.1):
  - any `block` → `rejected_auto` with reasons;
  - `sexual/minors` ≥ 0.20 or Llama Guard S4 → block plus a `P0_CSAM` case with `subject_snapshot`;
  - `real_person_risk = explicit` → block;
  - `possible`, an alias hit or a named real person → `publishable = false`, private use still allowed;
  - `review` → `publishable = false`.
- **Soul generation** (§C4):
  - Sonnet 5.5 with adaptive thinking, effort `medium`, `max_tokens` 8,000, `output_config.format` = the generated LLM schema;
  - prompt `content/prompts/npc/builder-soul@1.md`; user text wrapped as `<character_sheet origin="user" trust="untrusted">` with the stripped strings removed;
  - server-owned fields filled in by the server; Ajv, then lints L1, L2, L3, L5, L6 and L12; at most one repair, then `soul_failed`;
  - the soul.md is written deterministically and a minimal ink file is derived from the tagged example lines.
- **Probes** (§C5.3): five scripted turns (jailbreak, a real-person private-life question, sexual, slur bait, greeting), checked deterministically and then by a Haiku judge. All 5 must pass for `private`; any failure returns the draft to `soul_ready` with reasons.
- **Private use:** on `private`, the server compiles the soul, writes `souls/u_…/<ver>/soul.prompt.txt` to PRIVATE and records `npc_soul (status 'private')`. Route 31 then serves that NPC to its owner only (another profile gets `not_found`), wrapped as untrusted in block B.
- **Fixture modes** for every vendor call (`ANTHROPIC_MODE`, plus `MODERATION_MODE` = `live|fixture`). `check:prod-routes` fails when either is `fixture` in prod.
- Flag `npc.builder` and `ks:npc_builder` → `feature_disabled`. Telemetry `npc.builder.step {step, ok}`.

## Scope out
- Images (route 34), `UGC_SCAN`, attestation choices beyond `original`, submit (P2), case decisions, the community list, reports (route 41) and the NPC queue of route 43: M06b2. This follows `spec/05-api-and-realtime.md` routes 41 and 43 and DL-182; the M06b1 row of `_PLAN-2.md` lists 41 and 43 here, and that conflict is reported to the Architect.
- Builder screens: M06b3. The owner-approved look queue: M06b4. The user NPC's 3D look stays a creator-kit preset (DL-175).

## Deliverables
- `supabase/migrations/0004_moderation.sql`, `supabase/tests/{builder_tables.sql, server_only.sql (extended)}`, `packages/shared/src/db.gen.ts` (regenerated).
- `packages/shared/src/data-port.ts` and `data-port.memory.ts` (moderation and draft members), `services/edge/src/data/supabase/{moderation.ts, drafts.ts}`.
- `services/edge/src/npc-builder/{routes.ts, states.ts, limits.ts, validate.ts, moderation-openai.ts, moderation-llamaguard.ts, classifier.ts, soul-gen.ts, soul-write.ts, probes.ts, private.ts, queue.ts}`.
- `services/edge/test/{npc-builder-limits, npc-builder-states, npc-builder-moderation-order, npc-builder-real-person, npc-builder-submit-tier, npc-builder-private-visibility, npc-builder-llm-schema, npc-builder-probes}.test.ts`, `services/edge/test/fixtures/{anthropic/builder-*.sse, openai/moderation-*.json}`.
- `packages/shared/src/npc/soul-write.ts` (deterministic soul.md writer), `packages/shared/test/npc/soul-write.spec.ts` (golden).
- `content/prompts/npc/builder-soul@1.md`; `config/npc.json` (moderation order switch); `config/guardrails.yaml` (`npc.builder.*`).
- `tests/e2e/npc-builder.spec.ts` (`@npc-builder`, API-driven with Playwright `request` and the QA bridge).
- `services/edge/wrangler.jsonc`: Queue `npc-builder` (producer and consumer, plus a `/_test/` drain), `MODERATION_MODE`, `secrets.required` adds `OPENAI_MODERATION_API_KEY` and `ANTHROPIC_BUILDER_KEY`.
- About 38 files.

## Interfaces
- C10 1.0: `DraftState`, `DraftFields`, `DraftView`, `CreateDraftReq`, `UpdateDraftReq`, `JobAccepted`, `Verdict`, `LintIssue`. Copied verbatim from `04-npc-builder.md` §C3 (created in M06a2).
- C12 1.1: route 33 (P0 part), `builder_text` quota, migration 0004, `ModSubject`.
- C16 1.1: `npc.builder.step`.

## Acceptance criteria
- AC-1 Given a P0 profile When it requests a third soul generation in one UTC day, a second for the same draft within an hour, a 21st preview turn for a draft, and a fourth live draft Then each is refused with `quota_exhausted`, and no upstream call is made — proof: `pnpm check:workers -- npc-builder-limits`
- AC-2 Given a draft When every transition of §C1 up to `private` is driven, and `soul` is requested in `draft` state and `preview` before `private` Then the legal transitions succeed and the illegal ones return 409 with the current state — proof: `pnpm check:workers -- npc-builder-states`
- AC-3 Given text fixtures When validation runs Then the call order recorded by the spies is names lint → OpenAI → Haiku classifier; with OpenAI failing, Llama Guard runs instead; a `sexual/minors` 0.25 fixture blocks the draft and opens one `P0_CSAM` case with `subject_snapshot`, and no soul generation call follows — proof: `pnpm check:workers -- npc-builder-moderation-order`
- AC-4 Given a backstory containing an alias from the name-registry fixture When validated and generated Then `publishable = false` with the reason listed, the draft still reaches `private`, and its owner can talk to it — proof: `pnpm check:workers -- npc-builder-real-person`
- AC-5 Given a P0 token When `POST /drafts/:id/submit` or `/images` is called Then the response is `tier_required` — proof: `pnpm check:workers -- npc-builder-submit-tier`
- AC-6 Given a `private` user NPC owned by profile A When profile B posts to route 31 for it Then the response is `not_found`; profile A's request streams with block B wrapped as `<character_sheet origin="user" trust="untrusted">` — proof: `pnpm check:workers -- npc-builder-private-visibility`
- AC-7 Given the generated LLM schema When it is inspected Then it has no numeric, length or `format` keyword, ≤ 24 optional and ≤ 16 union-typed parameters, and the request uses `output_config.format` without sampling parameters — proof: `pnpm check:workers -- npc-builder-llm-schema`
- AC-8 Given a recorded generation output When the soul is assembled Then the soul.md bytes equal the golden file and pass `npc:lint` rules L1, L2, L3, L5, L6 and L12; a fixture failing once triggers exactly one repair call — proof: `pnpm check:unit -- packages/shared/test/npc/soul-write.spec.ts && pnpm check:workers -- npc-builder-states`
- AC-9 Given probe fixtures where the jailbreak probe breaks a rail When probing runs Then the draft returns to `soul_ready` with `probes.failures` naming it, and with 5/5 passes it becomes `private` with a PRIVATE prompt file and an `npc_soul` row with status `private` — proof: `pnpm check:workers -- npc-builder-probes`
- AC-10 Given migrations 0001–0004 When the DB checks run Then every new table is server-only, deleting a profile cascades to its drafts, and the types have no diff — proof: `pnpm check:db && pnpm check:db:types`
- AC-11 Given a QA build in fixture mode When the e2e test creates a draft, validates it, generates a soul, previews 2 turns and talks to the private NPC through `__dvBridge.npc.talk` Then each step returns the expected state and the in-world talk streams a line with the AI badge text — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder`
- AC-12 Given the production config When it is checked Then neither `ANTHROPIC_MODE` nor `MODERATION_MODE` is `fixture`, no key pattern is in the client bundle, and with `OPENAI_MODERATION_API_KEY` unset a live validation uses the Llama Guard path — proof: `pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist && pnpm check:workers -- npc-builder-moderation-order`

## Test plan
- **Workers runtime:** the eight `npc-builder-*` suites — `pnpm check:workers -- npc-builder`.
- **Unit:** `shared/npc.soul-write` (golden bytes) — `pnpm check:unit -- packages/shared/test/npc`.
- **DB:** `builder_tables`, `server_only` — `pnpm check:db`, `pnpm check:db:types`.
- **E2E:** `@npc-builder` on `chromium-webgl2` (API-driven; the UI arrives in M06b3).
- **Static:** `pnpm check:prod-routes`, `pnpm check:secrets -- apps/web/dist`, `pnpm check:telemetry`.

## Demo script
1. `pnpm dev` (fixture modes). `curl` `POST /api/v1/npc-builder/drafts` with a play token and an original backstory.
2. `POST …/validate`, then `…/soul`; poll `GET …/drafts/:id` until `private`.
3. `POST …/preview` with `{turn:{intent:'greet'}}`: SSE events stream.
4. In the browser, `__dvBridge.npc.talk('<u_… id>', {intent:'greet'})`: the private NPC answers. A second profile gets `not_found`.

## Effort
1 Builder session; about 38 files; risk **medium** (vendor fixture coverage, and the moderation tables copied exactly from research).

## Risks & fallbacks
- **OpenAI moderation on non-OpenAI content is UNVERIFIED (U-NPC-07):** `config/npc.json` can switch the chain to Llama Guard only. Record the decision when it is verified. The ACs run on fixtures.
- **Sonnet output fails the schema twice:** the draft goes to `soul_failed` and the author edits by hand (§C1). This is not an error path.
- **Moderation table DDL drifts from research §6.8:** copy it exactly. Any needed change is a proposal, not an edit.

## Notes for the Builder
- Read first: `04-npc-builder.md` §C1–§C5, §C7 and §C10; `09-backend-db.md` §3.4; `spec/04-data-models-db.md` §3.4; [research/gap-trust-safety-tooling.md §2.2, §6.4, §6.8]; `spec/05-api-and-realtime.md` route 33.
- **Secrets and accounts:**
  - `OPENAI_MODERATION_API_KEY` (Worker; name per spec/08 §8);
  - `ANTHROPIC_BUILDER_KEY` (Anthropic workspace `npc-builder`, limit 0.2 × monthly ceiling; name per `09-backend-contracts-1.1.md` §3).
  - Absent: fixture mode locally; in live mode, the soul job → `upstream_unavailable` and validation falls back to Llama Guard. List them under "Blocked on".
- Never store or log backstory text outside `npc_draft.backstory`, and never send it to other players. Images are not accepted in this milestone.
- Branch `m06b1-builder-text-private`.

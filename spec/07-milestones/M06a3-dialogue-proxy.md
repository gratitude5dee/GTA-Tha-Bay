# M06a3 — dialogue-proxy

## Goal
A player can talk to an NPC, and the conversation never blocks the game. Route 31 (`POST /api/v1/npc/:npcId/talk`) validates the request, checks flags, the roster, budget and quota, and assembles the cached prompt (block A, block B, server-held history, the volatile scene). It routes to Haiku or Sonnet 5.5 through AI Gateway, streams the C10 `DialogueEvent`s through the M06a1 transport, checks the output, and runs the executor. On the client, `DialogueClient` reads the stream, and `InkRunner` takes over seamlessly on any fallback, error or offline state. A recorded-fixture upstream mode makes every path testable without a key. A staging probe proves prompt caching and records time to first token. A QA-only debug overlay lets anyone talk to `npc_test` before the real panel arrives in M06a5. Memory stays off until M06a4.

## Requirements
- R-NPC-05: the dialogue proxy is server-side (no key in the browser) with prompt caching, per-player limits, offline fallback lines and in-character safety rails.
- R-AUTH-01: talking needs only the P0 play token. Without one (offline, under-18), the client goes straight to ink.
- R-NPC-04 (support): a kill switch ends a live stream with `fallback killed`, and killed NPCs answer `kill_switched` before any upstream call.

## Depends on
- **M06a1** (npc-backend-spine): play-token verification, `PlayerQuotaDO`, `EncounterDO`, the SSE transport, the roster flags, `ks:*` and `gov:level`.
- **M06a2** (soul-contract-compiler): C10 types, compiled souls and `souls/index.json`, `renderScene`, `scrubPii`, `splitSentences`, the `npc-turn-1.0` schema, `data/ink.<id>`, `data/npc-roster`.
- Contracts: C10 1.1 (§B2.4 incl. the 1.1 `meta.data.safety?`, §B7; DL-226), C12 1.1 (route 31, `ApiError` codes, `PlayerQuota`, `BudgetGovernor`), C16 1.1 (`npc.turn.client`, `npc.encounter.client`), C05 1.1 (`ProfileSettings.npc.aiDialogue`).

## Scope in
- **`DialogueService`** (`services/edge/src/npc/dialogue.ts`) follows `04-npc.md` §5.1 steps 1–10. Memory retrieval (step 4) is a no-op hook until M06a4. Pre-stream errors are C12 `ApiError` JSON: `bad_request`, `unauthorized`, `age_blocked`, `not_found`, `conflict {reason}`, `rate_limited`, `quota_exhausted`, `budget_offline`, `feature_disabled`, `kill_switched`, `moderation_blocked`, `upstream_unavailable`.
- **`PromptAssembler`** builds the layout of §5.2 exactly:
  - block A with `cache_control {type:'ephemeral', ttl:'1h'}`, then block B (`soul.prompt.txt` bytes from PRIVATE, isolate LRU of 64, `ttl:'1h'`);
  - history verbatim from `EncounterDO`, with one 5 m breakpoint on the last assistant message after 8 turns;
  - the volatile user message from `renderScene`;
  - `output_config.format` = `npc-turn-1.0`;
  - no `temperature`, `top_p`, `top_k` or prefill (F-036).
- **`ModelRouter`** follows the §5.3 table:
  - Haiku: `thinking:{type:'disabled'}`, effort `low`;
  - Sonnet for `roles.hero && modelTier = sonnet`: `thinking:{type:'between_tools'}`, `fallbacks:'default'`;
  - L1 or `ks:anthropic:sonnet` routes heroes to Haiku; L3, `ks:anthropic` or `ks:genai:all` → `budget_offline`.
- **Upstream:** `@anthropic-ai/sdk` in the Worker only, `baseURL = AIG_BASE` when set, else the direct API (U-NPC-02 fallback). Var `ANTHROPIC_MODE` is `live` or `fixture`. In `fixture` mode the upstream replays `services/edge/test/fixtures/anthropic/<name>.sse` (recorded streams with timing). Previews and local dev default to `fixture`. `ANTHROPIC_API_KEY` unset in `live` → `upstream_unavailable`.
- **Stream handling:** a partial-JSON `line` scanner emits `line.delta` text as it grows. Branch on `stop_reason` before reading content: `refusal` → `fallback {refusal, knot:'deflect'}`; `max_tokens` or schema failure → `fallback {invalid_output}`. 429 or 529 gets one retry only if it fits inside the 4 s window. A spend-limit 400 or `enforced_spend_limit_reached` is never retried.
- **Safety:**
  - `SafetyFilter.pre` (§5.4.1): NFC, strip tags and controls, remove PII and flag it, slur list → `moderation_blocked`, self-harm list → `endConversation` forced. The lists live in `packages/shared/src/npc/safety-lists.ts` so the client can reuse them.
  - Output checks (§5.4.4): word limit + 5, truncated at a sentence; the NameRegistry check from the M00b library, where a failure → `fallback {moderation, knot:'deflect'}`.
  - Async moderation of player text is wired as an interface that logs `moderation: lands in M06b1`. `EncounterDO` keeps a `pendingSafety` flag that the interface can set; the next turn's `meta` carries `safety: 'crisis'` and clears it (C10 1.1, DL-226).
- **Executor** `validateTurn` in `packages/shared/src/npc/executor.ts` (pure, because `services/*` may import only `@dv/shared`; `packages/npc` re-exports it): `affinity_delta` clamped ±10, ≤ 2 memory writes of ≤ 240 chars, `action_arg ∈ offers`, `attack` and `call_police` only for `volatile` or `police` in `story` mode, `end_conversation` honoured.
- **Settlement:** actual micros are computed from `usage` at F-034 prices for the model and passed to `PlayerQuota.settle`. A `genai.cost` point is written.
- **Client (`packages/npc/src/client`):** `DialogueClient` uses `fetch` with a streamed reader (not `EventSource`); `NpcRuntime` (`talk`, `playKnot`, `refreshFlags` on start, mode entry, every 10 min and after `kill_switched`; `endEncounter`). On `fallback`, a network error, `/boot` failure or any of the four offline codes (`quota_exhausted`, `budget_offline`, `kill_switched`, `upstream_unavailable`), it continues with `InkRunner` from the returned knot, or `greeting`/`smalltalk` by intent, with no error UI. The `ProfileSettings.npc.aiDialogue = false` setting means ink only. Telemetry: `npc.turn.client {ttftMs, fallback, reason?}` per turn and `npc.encounter.client` on close.
- **`InkRunner`** (`packages/npc/src/ink`): inkjs runtime over the compiled `data/ink.<id>`, lazy-loaded (< 50 KB per NPC).
- **Debug overlay** (QA builds only, `VITE_DV_QA=1`): `window.__dvBridge.npc.talk(npcId, turn)` and a minimal DOM overlay showing events and the AI badge text. It is absent from production builds.
- **Flags:** `npc.dialogue` on in staging and previews. Production stays off in this milestone; the operator flips it with route 47 after M06a5.

## Scope out
- Memory retrieval and writes, summaries, TTS, lip-sync and evals: M06a4. Real dialogue panel UI, likeness card and report button: M06a5. Intents (route 32): M06c. Builder preview and private user NPCs: M06b1.
- Async moderation itself: M06b1 (it sets `pendingSafety`). The crisis card UI: M06a5.

## Deliverables
- `services/edge/src/npc/{dialogue.ts, prompt.ts, router.ts, upstream.ts, upstream-fixture.ts, scanner.ts, safety.ts, settle.ts}`, `services/edge/src/routes/npc-talk.ts`.
- `services/edge/test/{npc-talk-happy, npc-talk-timeout, npc-talk-refusal, npc-talk-invalid-json, npc-talk-killed, npc-talk-soulversion, npc-talk-quota, npc-talk-governor, npc-prompt-cache-order, npc-output-namelint}.test.ts`, `services/edge/test/fixtures/anthropic/*.sse` (recorded streams, no key material).
- `packages/shared/src/npc/{executor.ts, safety-lists.ts}`, `packages/shared/test/npc/executor.spec.ts`.
- `packages/npc/{package.json, README.md}`, `packages/npc/src/client/{runtime.ts, dialogue-client.ts, sse.ts}`, `packages/npc/src/ink/ink-runner.ts`, `packages/npc/src/debug/overlay.ts`, `packages/npc/test/{dialogue-client.spec.ts, ink-runner.spec.ts}`.
- `tests/staging/npc-cache.test.ts` (suite `npc-cache`), with output in `tests/reports/npc/ttft.json`.
- `tools/ci/check-prod-routes.ts`: also fails when prod `ANTHROPIC_MODE` is `fixture`.
- `services/edge/wrangler.jsonc`: `ANTHROPIC_MODE`, `AIG_BASE`, `RL_TALK`; `secrets.required` adds `ANTHROPIC_API_KEY`. Telemetry schemas for `npc.turn.client` and `npc.encounter.client`.
- About 38 files.

## Interfaces
- C10 1.1: `NPCDialogueRequest`, `DialogueEvent` (with `meta.data.safety?`), `FallbackReason`, `InkKnot`, `NpcRuntime` (client surface from `04-npc.md` §3). Shapes are copied; this milestone sets `C10_VERSION = '1.1.0'`.
- C12 1.1: route 31 and its error set.
- C16 1.1: `npc.turn.client`, `npc.encounter.client`, `genai.cost`.
- The crisis signal after asynchronous moderation (`04-npc.md` §5.4.2) is the additive C10 1.1 `meta.data.safety?: 'crisis'` (the proposal accepted in DL-226).

## Acceptance criteria
- AC-1 Given the recorded happy fixture When a P0 client posts a turn to `npc_test` Then the events arrive in the order `meta`, `line.delta`+, `line.done`, `effects`, `done`; `meta.disclosure.aiCharacter` is true; and `done.costMicros` equals the price of the fixture's `usage` — proof: `pnpm check:workers -- npc-talk-happy`
- AC-2 Given a fixture whose first text arrives at 5 s When the turn runs under the mocked clock Then `fallback {reason:'timeout'}` arrives at 4.0 ± 0.2 s, followed by `done`, and the encounter history gains no pair — proof: `pnpm check:workers -- npc-talk-timeout`
- AC-3 Given fixtures ending in `stop_reason: refusal` and in schema-invalid JSON When each turn runs Then the outcomes are `fallback {refusal, knot:'deflect'}` and `fallback {invalid_output}`, and neither is retried upstream — proof: `pnpm check:workers -- npc-talk-refusal && pnpm check:workers -- npc-talk-invalid-json`
- AC-4 Given `npc_test` killed before a turn and during a turn When talk is called Then the first gets `kill_switched` JSON (status from `HTTP_FOR`) before any upstream call, and the second ends with `fallback {reason:'killed'}` — proof: `pnpm check:workers -- npc-talk-killed`
- AC-5 Given a `soulVersion` two versions old When talk is called Then the response is `409 conflict` with `details.soulVersion` — proof: `pnpm check:workers -- npc-talk-soulversion`
- AC-6 Given a P0 profile at 150 turns today When it sends one more Then the response is 429 `quota_exhausted` with no upstream call — proof: `pnpm check:workers -- npc-talk-quota`
- AC-7 Given governor level 1 When a hero NPC is addressed Then the upstream request names `claude-haiku-5-5` with the same system blocks; at level 3 the response is 503 `budget_offline` — proof: `pnpm check:workers -- npc-talk-governor`
- AC-8 Given turn 3 of an encounter When the upstream request body is captured Then `system[0]` is block A with `ttl:'1h'`, `system[1]` equals the PRIVATE prompt bytes, the history equals the `EncounterDO` transcript even when the client body carried an extra `history` field, no sampling parameter or prefill exists, and `thinking` matches the model — proof: `pnpm check:workers -- npc-prompt-cache-order`
- AC-9 Given a fixture whose `line` contains a name from the name-registry fixture When the turn completes Then the client receives `fallback {reason:'moderation', knot:'deflect'}` and no `line.done` — proof: `pnpm check:workers -- npc-output-namelint`
- AC-10 Given chunk-split SSE fixtures, a mid-stream network drop and each offline `ApiError` code When `DialogueClient` consumes them Then the visible text is the `line` prefix at every chunk boundary, and every failure continues in `InkRunner` from the right knot without throwing — proof: `pnpm check:unit -- packages/npc packages/shared/test/npc/executor.spec.ts`
- AC-11 Given the production build When it is scanned Then no `sk-ant-` pattern, no `@anthropic-ai/sdk` code and no `__dvBridge` exist in `apps/web/dist`, and prod `ANTHROPIC_MODE` is not `fixture` — proof: `pnpm build && pnpm check:secrets -- apps/web/dist && pnpm check:prod-routes`
- AC-12 Given staging with `ANTHROPIC_API_KEY` (workspace `npc-runtime`) When the staging suite holds a 3-turn conversation with `npc_test` Then turn 2 and turn 3 report `cache_read_input_tokens > 0`, and TTFT values are written to `tests/reports/npc/ttft.json`; the run records U-NPC-01 and U-NPC-02 — proof: `pnpm test:staging -- npc-cache`

## Test plan
- **Workers runtime:** the ten `npc-*` suites above — `pnpm check:workers -- npc`.
- **Unit:** `npc/dialogue-client` (scanner, fallbacks), `npc/ink-runner` (knots, lazy load), `shared/npc.executor` (clamps, offers, action rules) — `pnpm check:unit -- packages/npc packages/shared/test/npc`.
- **Static:** `pnpm check:secrets -- apps/web/dist`, `pnpm check:prod-routes`, `pnpm check:telemetry`.
- **Staging:** `pnpm test:staging -- npc-cache` (needs the key and staging; prints `SKIP … ANTHROPIC_API_KEY not set` otherwise).

## Demo script
1. `pnpm dev` (fixture mode). In the console, `__dvBridge.npc.talk('npc_test', {intent:'greet'})`: the overlay shows the streamed line and the AI badge.
2. Kill `npc_test` with route 47 or 46 and `OPS_TOKEN`, then talk again: the ink `greeting` line appears with no error.
3. `pnpm check:workers -- npc`: ten suites pass.
4. On staging: `pnpm test:staging -- npc-cache`; open `tests/reports/npc/ttft.json`.

## Effort
1 Builder session; about 38 files; risk **medium** (streamed structured output through the SDK, timer behaviour in the Workers pool).

## Risks & fallbacks
- **AI Gateway buffers SSE (U-NPC-02):** unset `AIG_BASE`. Calls then go direct, layer-2 limits are lost, and layer 3 (quota and governor) still holds. Record the outcome.
- **Structured output arrives in one delta (U-NPC-03):** the scanner still works and the 4 s rule still holds; the visible text just appears all at once.
- **`between_tools` with structured outputs on Sonnet 5.5 fails (U-NPC-06):** route heroes to Haiku through config, and record it.
- **TTFT above the 800 ms target (U-NPC-01):** recorded, not asserted. The 4 s fallback keeps play smooth.

## Notes for the Builder
- Read first: `04-npc.md` §5.1–§5.5 and §5.10–§5.11; `04-npc-contracts.md` §B2.4 and §B7; `09-backend-ops.md` §5.3; `spec/05-api-and-realtime.md` §4.8.
- **Secrets and accounts:** `ANTHROPIC_API_KEY` for the `npc-runtime` workspace (Worker secret; GitHub repository secret for staging tests), and AI Gateway `gw-dialogue` created by the operator (cache, Guardrails and DLP off). Absent: fixture mode locally, `upstream_unavailable` in live mode, and `SKIP` in `test:staging`. List these under "Blocked on".
- Never log prompts, player text or model output. Transcripts go only to `EncounterDO` and R2 PRIVATE.
- The model never writes numbers that the game uses and never decides mission outcomes. Missions use `playKnot` only.
- Branch `m06a3-dialogue-proxy`.

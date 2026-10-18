# M06a4 — memory-voice-lipsync

## Goal
NPCs remember the player, speak, and move their mouths. Three things change on the server. `MemoryService` writes paraphrased, PII-scrubbed memories with bge-m3 embeddings and retrieves the top six per turn. A `summarize` queue consumer folds each closed encounter into the relationship summary. `TtsRouter` voices each completed sentence at the effective tier, which in v1 is `t1` Workers AI Aura with `t2` held off by `ks:tts:elevenlabs`. Route 52 lets a player delete NPC memory for one NPC or for all of them. On the client, `TtsPlayer` plays the audio chunks on the voice bus and `LipSyncDriver` animates the mouth atlas and jaw. The in-character evaluation harness (`npc:eval`) runs deterministic replay suites in CI and live suites weekly.

## Requirements
- R-NPC-05: memory gives continuity within the quotas; generated speech always has subtitles; evals check the in-character safety rails on every soul change.
- R-NPC-04: there is no real-voice cloning (`t3` needs `consented` + `voice_clone` + an unexpired consent). A `voice` kill scope forces text, and t2 needs a linked 18+ identity.
- R-ENG-04: subtitles for every voiced line; the voice setting (`all`, `heroes`, `off`) is honoured.

## Depends on
- **M06a3** (dialogue-proxy): `DialogueService`, the step-4 memory hook, `line.delta {audio}` slots, `NpcRuntime`, fixture upstream mode.
- Through M06a1: `DataPort.npcMemory`, migration 0003, the `JOBS` queue, `encounter_transcripts`.
- Contracts: C10 1.0 (§B2.6 memory types, §B2.7 voice catalog, `AudioChunk`, `VoiceTier`), C12 1.1 (route 52, `PlayerQuota` `voice_line`), C05 1.1 (`ProfileSettings.npc.voice`, `StorySlice.npcRelations`), C04 1.1 (`AudioService` bus `voice`, `HUMANOID_BONES` jaw), C07 1.1 (`mouth_atlas`, `audio_bark`, `extras.bones.jaw`), C16 1.1 (`npc.voice.client`).

## Scope in
- **Memory write** (`04-npc.md` §5.6), run in `ctx.waitUntil`:
  - up to 2 `memory_writes` → `scrubPii` → drop any write quoting > 8 consecutive words of the player's text;
  - embed with `@cf/baai/bge-m3` through the `AI` binding;
  - a write with cosine ≥ 0.92 against the pair's rows only refreshes `last_accessed_at`;
  - `promise` writes get importance ≥ 6; `game_time = context.clockT`.
- **Memory retrieve** (step 4): embed the player text, or the intent label plus the mission id; `topK(6)` plus the relationship summary (≤ 150 tokens) go into `<memory>`. Skipped without error when the DataPort or `AI` fails.
- **Summarize consumer** on `JOBS`:
  - Haiku with `npc-summary-1.0` (effort `low`, `max_tokens` 1,024) produces a `SummaryPatch`;
  - `applySummary` keeps the summary ≤ 1,200 chars by re-summarizing, adds 1 to `encounters`, and clamps affinity and trust deltas to ±10 per encounter;
  - every 10th encounter per pair adds one `reflection` (importance 8);
  - fixture upstream in tests.
- **Route 52** `DELETE /me/npc-memory?npcId=` → 204 (P0 token). Without `npcId` it deletes every NPC's memory and relationship rows for the profile.
- **`TtsRouter.effectiveTier`**: the minimum over the inputs listed in `04-npc.md` §5.7 (soul tier, setting, governor and switches, `voice` kill scope, `voice_line` quota, identity tier for t2, consent for t3). `speak(t1)` calls Workers AI Aura per sentence (≥ 12 chars, `splitSentences`) and emits `line.delta {audio:{codec:'mp3'}}` chunks. One `voice_line` reservation per `line.done`. t2 (ElevenLabs) is implemented behind `ks:tts:elevenlabs` (on by default, Q-20). With `ELEVENLABS_API_KEY` unset it is never selected.
- **Voice catalog** `config/voice-catalog.json`: Aura-1 default entries, with the Aura-2 `mp3` entries as fallback when the staging probe shows Aura-1 is unsuitable (U-NPC-05).
- **Client** `TtsPlayer` (`packages/npc/src/tts`) decodes mp3 (or PCM) after `FirstGestureUnlock` and plays it on `AudioService` bus `voice` with the NPC as emitter. Subtitles always show. It emits `npc.voice.client {ttfaMs, tier}`.
- **`LipSyncDriver`** (`packages/npc/src/lipsync`):
  - t1: an `AnalyserNode` RMS envelope maps to the Rhubarb shapes X/A/B/C/D, alternating with E/F by vowel density;
  - t2 alignment: port the TalkingHead English grapheme-to-viseme rules (logic only, MIT, no dependency);
  - baked lines read Rhubarb cue assets;
  - renders by offsetting the mouth-atlas UV cell (3×3) on the `AudioContext` clock with a 60 ms hold, and rotates the jaw when `extras.bones.jaw`;
  - at most 2 lip-synced speakers at once.
- **Evals** (`packages/npc/evals`, `04-npc-builder.md` §C6):
  - suites: `redteam/*.yaml` (≥ 40 probes), `golden/<npcId>.yaml` (10 conversations per active soul), `builder-probes.yaml`;
  - deterministic checks first, then a Sonnet 5.5 judge over the Batch API;
  - `--replay` uses recordings keyed by the sha256 of the request body. Ship hand-written synthetic recordings for the shipped souls, labelled `synthetic: true`. `--record` replaces them when a key is present;
  - `--live` uses the `ci-evals` workspace key;
  - judge gates are reports-only until M10c; deterministic failures exit non-zero;
  - output goes to `tests/reports/npc-evals/<run>/`.

## Scope out
- Baked barks and ink audio, voice designs, consented clones: M10c. Bark playback in the world: M06c.
- The dialogue panel and its subtitles UI: M06a5 (this milestone feeds `hud.subtitle` only through `NpcRuntime` events).
- Memory scopes `npc` and `world`, and rumors: M12c.

## Deliverables
- `services/edge/src/npc/{memory.ts, summarize.ts, tts-router.ts, tts-workers-ai.ts, tts-elevenlabs.ts}`, `services/edge/src/routes/me-npc-memory.ts`, queue consumer wiring in `src/index.ts`.
- `services/edge/test/{npc-memory-scrub, npc-memory-retrieve, npc-summarize, npc-forget-memory, npc-tts-gating}.test.ts`, `services/edge/test/fixtures/anthropic/summary-*.sse`, `services/edge/test/fixtures/ai/{bge-m3.json, aura.mp3}`.
- `packages/shared/src/npc/{voice-tier.ts, visemes.ts}` (pure), `packages/shared/test/npc/{voice-tier.matrix.spec.ts, visemes.spec.ts}`.
- `packages/npc/src/tts/{tts-player.ts}`, `packages/npc/src/lipsync/{driver.ts, rms.ts, atlas.ts}`, `packages/npc/test/{tts-player.spec.ts, lipsync.spec.ts}`.
- `packages/npc/evals/{runner.ts, checks.ts, judge.ts, recordings/, redteam/, golden/, builder-probes.yaml}`, `tools/soul/src/eval.ts`.
- `tests/staging/npc-tts.test.ts` (suite `npc-tts`); `supabase/tests/forget_npc_memory.sql`.
- `config/voice-catalog.json` (extended); telemetry schema `npc.voice.client`.
- Root script: **`npc:eval`**. `ci.yml` `content` adds `pnpm npc:eval -- --replay`; `weekly.yml` (created here if absent; cron `23 9 * * 1`) runs `pnpm npc:eval -- --live`.
- About 38 files.

## Interfaces
- C10 1.0: `MemoryWrite`, `MemoryHit`, `SummaryPatch`, `VoiceCatalogEntry`, `AudioChunk`, `VoiceTier`. Copied, not changed.
- C12 1.1: route 52; `DataPort.npcMemory.write/topK/applySummary`.
- C04 1.1 `AudioService` (consumer), C05 1.1 `ProfileSettings.npc` (reader).

## Acceptance criteria
- AC-1 Given a turn whose output carries 3 memory writes, one with an e-mail address and one quoting 10 words of the player's text When the turn settles Then exactly 1 row is written with the e-mail removed, no write quotes > 8 consecutive player words, and a fourth near-duplicate write (cosine ≥ 0.92 on the fixture embeddings) only refreshes `last_accessed_at` — proof: `pnpm check:workers -- npc-memory-scrub`
- AC-2 Given 10 stored memories for a pair When the next turn is assembled Then `<memory>` holds at most 6 hits in `topK` order plus the summary, and with a DataPort that throws, the turn still streams with an empty `<memory>` — proof: `pnpm check:workers -- npc-memory-retrieve`
- AC-3 Given a closed encounter and the summary fixture When the `summarize` message is consumed Then the summary is ≤ 1,200 chars, `encounters` grows by 1, the affinity and trust deltas are clamped to ±10, and the 10th encounter of a pair adds one `reflection` with importance 8 — proof: `pnpm check:workers -- npc-summarize`
- AC-4 Given memories for two NPCs When `DELETE /me/npc-memory?npcId=npc_test` and then `DELETE /me/npc-memory` are called Then the first removes only `npc_test` rows, the second removes the rest, and both return 204 — proof: `pnpm check:workers -- npc-forget-memory && pnpm check:db`
- AC-5 Given a t1 soul, voice setting `all` and the Aura stub When a two-sentence line streams Then each sentence yields `line.delta {audio:{codec:'mp3'}}` chunks after its text, one `voice_line` is reserved, and a kill scope `voice`, an exhausted `voice_line` quota, `ks:tts:all` or setting `off` each produce text only; a P0 profile never gets t2 even with `ks:tts:elevenlabs` off — proof: `pnpm check:workers -- npc-tts-gating`
- AC-6 Given a 36-row table derived from the `04-npc.md` §5.7 rules (soul tier t1/t2/t3 × setting all/heroes/off × identity P0/linked × `ks:tts:elevenlabs` on/off), written as data in `voice-tier.matrix.spec.ts` When `effectiveTier` is evaluated Then each result equals its row; the viseme mapper turns the fixture alignment strings into the expected Rhubarb shape sequences — proof: `pnpm check:unit -- packages/shared/test/npc`
- AC-7 Given a fake `AudioContext` and a recorded RMS envelope When `LipSyncDriver` runs for 3 s Then the atlas cell changes only on the 60 ms hold boundary, the jaw rotates only when `extras.bones.jaw` is true, and a third concurrent speaker is refused; `TtsPlayer` does nothing before the first-gesture unlock — proof: `pnpm check:unit -- packages/npc`
- AC-8 Given the shipped recordings When `npc:eval -- --replay` runs Then every deterministic check passes and a report is written; a self-test recording whose `action_arg` is not in `offers` makes the run exit non-zero — proof: `pnpm npc:eval -- --replay && pnpm check:unit -- packages/npc/evals`
- AC-9 Given `ANTHROPIC_EVALS_KEY` unset When a live run is requested Then it prints `SKIP npc:eval --live: ANTHROPIC_EVALS_KEY not set` and exits 0 — proof: `env -u ANTHROPIC_EVALS_KEY pnpm npc:eval -- --live --soul npc_test`
- AC-10 Given staging with the `AI` binding When the TTS probe voices one fixed sentence with Aura-1 and Aura-2 Then the codec, byte size and latency of each are written to `tests/reports/npc/tts.json`; the run records U-NPC-05 — proof: `pnpm test:staging -- npc-tts`

## Test plan
- **Workers runtime:** `npc-memory-scrub`, `npc-memory-retrieve`, `npc-summarize`, `npc-forget-memory`, `npc-tts-gating` — `pnpm check:workers -- npc`.
- **Unit:** `shared/npc.voice-tier.matrix` (36 cases), `shared/npc.visemes`, `npc/tts-player`, `npc/lipsync`, `npc/evals` self-tests — `pnpm check:unit -- packages/shared/test/npc packages/npc`.
- **DB:** `forget_npc_memory` — `pnpm check:db`.
- **Evals:** `pnpm npc:eval -- --replay` (CI), `--live` weekly.
- **Staging:** `pnpm test:staging -- npc-tts`.

## Demo script
1. `pnpm dev`; talk to `npc_test` twice with `__dvBridge.npc.talk` and mention a promise; the second turn's request shows the memory in `<memory>` (debug log in QA).
2. Enable voice with the Aura stub: the line plays with subtitles and the overlay shows viseme letters.
3. `pnpm npc:eval -- --replay`; open the report.
4. `curl -X DELETE` route 52 with the play token, then talk again: no memory.

## Effort
1 Builder session; about 38 files; risk **medium** (audio timing and the Workers AI response formats).

## Risks & fallbacks
- **Aura-1 encoding or latency is unsuitable (U-NPC-05):** switch the catalog default to Aura-2 `mp3` (encoding verified) and record it.
- **Ogg Opus decode on iOS is unconfirmed (U-AST-14):** use mp3 or PCM only.
- **ElevenLabs plan terms (U-NPC-08, Q-20):** t2 stays off. The code path is tested with a stub only.
- **Judge agreement unknown:** gates are reports-only until a 100-turn human-labelled set exists (M10c).

## Notes for the Builder
- Read first: `04-npc.md` §5.6–§5.8 and §6; `04-npc-builder.md` §C6–§C7; `04-npc-contracts.md` §B2.6–§B2.7; `09-backend-db.md` §3.3.
- **Secrets:**
  - `ANTHROPIC_API_KEY` (summaries, `npc-runtime`);
  - `ANTHROPIC_EVALS_KEY` (`ci-evals` workspace, GitHub secret; name per `09-backend-contracts-1.1.md` §3);
  - `ELEVENLABS_API_KEY` (optional, t2 off by Q-20).
  - Workers AI runs through the `AI` binding with no key. Any absent key: `SKIP … <VAR> not set`, exit 0, list it.
- Prices used for estimates come from F-025 and F-034 only.
- No memory without an `18p` token (guard test). Memories never quote raw player text.
- Branch `m06a4-memory-voice-lipsync`.

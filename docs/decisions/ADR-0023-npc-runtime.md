# ADR-0023 — NPC runtime: dialogue, memory and voice

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-21, D-22, D-23; R-NPC-05; contract C10

## Context
Named NPCs must speak in character, remember the player, and cost little, without exposing keys or letting players steer the model out of its rails. Claude Haiku 5.5 costs $0.10/$0.50 and Sonnet 5.5 $2/$10 per million tokens; cache reads cost $0.01/MTok on Haiku 5.5 (10 % of input) and $0.10/MTok on Sonnet 5.5 (5 % of input) [F-034]. The minimum cacheable prefix is 512 tokens and the cache is per workspace [F-035]. Haiku runs with thinking disabled; Sonnet needs `between_tools`; neither accepts sampling parameters or assistant prefill [F-036]. AI Gateway guardrails and DLP buffer streamed responses, and its spend limits are eventually consistent [F-028]. Workers AI offers `bge-m3` embeddings at $0.012 per million tokens and Aura-1 speech at $0.015 per 1,000 characters [F-025]. ElevenLabs Flash is about 75 ms at $0.04 per 1,000 characters, clones only the speaker's own voice, and bars apps directed at minors [F-051].

## Options considered
1. **Client-held history.** Forgeable; a forged assistant turn is a jailbreak path (DL-046).
2. **A Workers AI language model for dialogue or filler.** No cache discount, so no cost case; quality unverified [research/ai-npc-runtime.md §2.9].
3. **Single-use vendor voice tokens in the browser.** The browser could voice arbitrary text in a project voice; rejected.
4. **TalkingHead as a dependency.** Needs ARKit blend shapes; its viseme logic is ported instead.
5. **Server-built prompts, server-held history, tiered voice** (chosen).

## Decision
**Dialogue (D-21).** The browser sends enums, ids and at most 280 characters of player text to `POST /api/v1/npc/:id/talk`; the Worker builds every prompt from fixed templates and a compiled soul read from the private bucket (`souls/<id>/<ver>/soul.prompt.txt`), calls Anthropic through AI Gateway (BYOK, `byok_only`, Guardrails and DLP off), and streams SSE (`meta`, `line.delta`, `line.done`, `effects`, `fallback`, `done`). Default model `claude-haiku-5-5` (thinking disabled, effort low); the two hero VCs and heroes use `claude-sonnet-5-5` with `between_tools` until the governor drops them to Haiku at L1 (ADR-0015). A shared, byte-identical soul prefix keeps the cache warm; `EncounterDO` stores the exact rendered turns, so history cannot be forged. Actions are proposals: the executor accepts an action only if the soul's roles allow it and its argument is in `context.offers`. The model never writes numbers or decides mission flow (DL-085, DL-087). No first token within 4 s, quota, budget, a kill or an upstream error → SSE `fallback` → offline ink lines. Filler pedestrians never call the model; their lines are baked barks.

**Memory (D-22).** Postgres with pgvector `halfvec(1024)` from `bge-m3`, exact per-pair scan (no ANN index needed at this scale); transcripts kept 30 days; memories expire 180 days after last access; a relationship is deleted with its profile or after 180 days inactive; no memory for under-18 profiles (moot while all are blocked, ADR-0014); export and forget routes from day one. Memory flavors dialogue and never decides game state.

**Voice (D-23).** Tier 0 text only; tier 1 Workers AI Aura-1 or MeloTTS (default for heroes); tier 2 ElevenLabs Flash designed voices for at most three heroes behind `ks:tts:elevenlabs`, off unless the voice ceiling is raised (Q-20); tier 3 clones only with a `consented` record. TTS text is chosen server-side from the validated `line`. Lip-sync is a mouth-atlas driver with viseme logic ported from TalkingHead, no dependency.

## Consequences
- (+) A Haiku turn costs about $0.00028 [research/INDEX.md §6]; cached prefix reads cost $0.01/MTok on Haiku 5.5 (10 % of input) and $0.10/MTok on Sonnet 5.5 (5 % of input) [F-034].
- (+) Every NPC works offline through ink; kills and quotas degrade, never block.
- (−) Haiku time-to-first-token through AI Gateway and unbuffered SSE are UNVERIFIED (U-NPC series; M06a3 records them); the 4 s fallback bounds the damage.
- (−) Tier 2 voices need a plan fee above the voice ceiling, so heroes launch on tier 1.
- (−) Server-held history adds a Durable Object per encounter.

## Affected contracts and milestones
C10 (`NPCDialogueRequest`, `PlayerIntent`, SSE events), C12 (route 31–33, quotas), C13 (audio), C05 (`ProfileSettings.npc`). M06a1 (spine), M06a2 (soul compiler), M06a3 (proxy), M06a4 (memory, voice), M06a5, M06c, M09b2, M10c.

## Links
`research/ai-npc-runtime.md`; `spec/domains/04-npc.md` §2, §5; `04-npc-contracts.md`; `spec/11-decision-log.md` DL-046, DL-085, DL-087, DL-119; ADR-0013, ADR-0014, ADR-0015.

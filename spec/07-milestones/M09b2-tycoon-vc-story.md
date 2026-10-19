# M09b2 — tycoon-vc-story

## Goal
After this session tycoon investors are AI NPCs and the story unlocks the mode. The repository gains 12 fictional VC souls (t1 voices), the full negotiation state machine (mood, 24-question bank, `askMore`, `counter`, `bringCompetitor`, `sleepOnIt`, closing, re-trade), `TycoonPitchController` (C10 `context.tycoon` with ≤ 3 sim-computed `deals`, `effects` recorded as a clamped `vcSpoke` command, deterministic offline fallback), a pitch room (3D on desktop, 2D card on `mobile-low` and WebKit) with AI label and disclaimer, the `mini8w` preset, the story hook `tycoon.a2.curbshare` in `m.a2.01` that emits `unlock.tycoon`, the capped dividend counter credited by the story, a hardcore flag and tycoon telemetry. The descriptor becomes `available` in production; the tile stays locked until the unlock fires.

## Requirements
- R-MODE-04: AI-NPC investors negotiate inside a deterministic envelope; cap-table outcomes stay exact.
- R-MODE-05: the tycoon mode is first met in `m.a2.01` and then unlocks as a main-menu tile, persisted in the save.
- R-NPC-05: dialogue goes only through the server proxy. It has rate limits and quotas, and an offline fallback that never blocks a round.
- R-NPC-04 (support): VC likeness tier `fictionalized`, kill-switch with stand-in, disclosure label.

## Depends on
- **M09b1**: the views and pitch card, the VM, the three sectors.
- **M06a3**: `DialogueClient`, `InkRunner`, route 31 SSE, the executor's `offer_deal` check against `offers.dealIds`, recorded-fixture mode.
- **M05a1**: the mission IR, the builder, `missions:build` and C09 mode hooks.
- **M05a2**: `check:missions` for the AC proofs (DL-219).
- Through M06a3: M06a2 (`npc:*`, roster).
- Contracts: C10 1.0 (`NPCDialogueContext.tycoon.deals`, tycoon intents `pitch|answer|ask_more|counter|close`, `DialogueEvent`, `Emotion`), C09 1.0 (`ModeHook`, stub path, `unlockOnFirstEncounter`), C06 1.1 (`startChild`, `EconomyApi.credit` with idempotency key, `ledgerSince`), C12 1.1 (route 31, `ApiError` codes, `RosterFlags`), C16 1.1 (`tycoon.run_end`, `tycoon.round`, `tycoon.negotiation`).

## Scope in
- **Negotiation FSM** (`finance/negotiation.ts`, replaces M09a1's automatic midpoint): the §9 states, `MAX_MEETINGS_PER_RAISE` = 4, one meeting per week, founder focus; mood start formula and delta table, LLM tag capped ±8; questions from `content/tycoon/questions.json` (24, keyed to metric weaknesses) by stream `qa:<meetingId>:<n>`; `bringCompetitor` counts live sheets only; `vc.retrade`/`market.crash` may cut a sheet in closing.
- **`clampTerms(proposal, envelope)`** field by field at command time, recording `clamped: string[]` in the `ChoiceRecord`, so replay is identical everywhere.
- **`TycoonPitchController`** (B §11): request with `mode: 'tycoon'`, banded values, no prior free text, `deals` = midpoint at `t` plus neighbours at `t ± 0.15` with ids `deal.<meetingId>.<k>` mirrored in `offers.dealIds`, `maxTokens ≤ 220`; response maps `effects.mood` by the §9 table and a listed `offer_deal` arg to that deal, anything else to `pass`. **Fallback** (midpoint offer plus a templated line from `content/tycoon/vc-lines.json`, ≥ 6 lines per intent and style): `fallback` event, `quota_exhausted`, `budget_offline`, `kill_switched`, `upstream_unavailable`, network failure, no first token in 4 s, flag `tycoon.dialogue` off. The offer card shows before any model text.
- **VC roster:** the 12 B §10 slugs as originals in `content/npcs/vc-*/soul.md` (`fictionalized`, `pipeline: none`, `tycoon` and `stats.tycoon` blocks, Sonnet only for the two heroes (R4), t1 Aura voices per Q-20/DL-OWN-01, `standIn` null), roster entries, and one shared ink `content/npcs/vc-common/vc.ink` (`greeting`, `smalltalk`, `busy`, `deflect`, `farewell`, `pitch_*`). Bodies and portraits are creator-kit presets (DL-175, DL-180): no fal spend.
- **Pitch room:** descriptor v2 (`world: 'stage'`). Desktop: procedural gray-box `prop/stage-pitch-room` (authored) plus a creator-kit NPC prefab `npc:<vcSlug>`, fixed cinematic camera. `mobile-low` or a stage load failure: the 2D card. Both show "AI investor · fictional game", the `meta.disclosure` badge, subtitles and "In-game terms are a simulation, not financial or legal advice". Optional free text goes through the S04 classifier (blocked = `evasive`) and is hidden unless the bracket is `18p` (DL-139 default).
- **Mini-run** `mini8w` (`08-tycoon.md` §5.8): `miniWin`/`miniLose`, no score or history. Policy `autoFounder` = `median` plus a scripted pitch (BotDriver `tycoon.autoFounder`).
- **Story** `content/missions/m.a2.01/mission.ts` with `lines.en.json` (`03-story-missions.md` §C1; §B6): talk with `whitney_arlo`; hook `tycoon.a2.curbshare` → `startChild('tycoon', {defId: 'mini8w'})` with `unlockOnFirstEncounter: 'unlock.tycoon'`; pass on win or lose; win sets `coop_success`; stub = a three-choice talk setting the same flag.
- **Dividends:** `+= min(1,000,000, floor(founderPayoutCents·0.0002))` per winning standalone full run; on story entry the story credits `min(unclaimed, cap)` via `EconomyApi.credit(…, idemKey 'tycoon.div:<n>')` against `StorySlice.flags['tycoon.divClaimedCents']`, with the $10,000-per-game-week rule checked by `ledgerSince` over 1,209,600 game half-seconds (DN-S08-04).
- **Hardcore** (events ×1.5, cheques ×0.8) after the first `ramen` win. **Telemetry:** `tycoon.run_end`, `tycoon.round`, `tycoon.negotiation` (numeric and enum props).

## Scope out
- XR desk and pitch panels: M11b4.
- The leaderboard validator: M12e.
- Re-skinning up to four VCs as `parody` caricatures: needs Q-19/Q-25 and `names:lint`; post this milestone, by S04.
- Generated VC portraits or voices: not funded (DL-OWN-01).
- Acts 2 missions beyond `m.a2.01`: M05e1.

## Deliverables
- `packages/shared/src/tycoon/finance/{negotiation.ts, clamp.ts, negotiation.fsm.spec.ts, dialogue.clamp.spec.ts}`.
- `packages/modes/tycoon/src/pitch/{TycoonPitchController.ts, context.ts, effects.ts, fallback.ts}`, `src/ui/views/PitchRoom.tsx` (2D) and `src/stage/pitchRoom.ts` (3D, desktop).
- `packages/modes/tycoon/src/{descriptor.ts (v2, production 'available'), presets.ts (mini8w), dividends.ts}`.
- `packages/modes/tycoon/test/{dialogue.parse.spec.ts, dialogue.fallback.spec.ts, context.spec.ts, dividend.spec.ts, roster.tier.spec.ts}` and the recorded SSE fixtures `packages/modes/tycoon/test/fixtures/sse/*.json`.
- `tools/ci/tycoon-sim/policies.ts`: add `autoFounder`.
- `packages/modes/story/src/economy/tycoonDividends.ts`, called on story entry.
- Content:
  - `content/npcs/vc-*/soul.md` (12 files);
  - `content/npcs/vc-common/vc.ink`;
  - edit `content/npcs/roster.json`;
  - `content/tycoon/{questions.json, vc-lines.json}`;
  - `content/missions/m.a2.01/{mission.ts, lines.en.json}`;
  - edit `config/unlocks.json` if `unlock.tycoon` lacks `source: 'base'`;
  - `assets/src/prop/stage-pitch-room/asset.json`.
- `tests/e2e/tycoon/{tycoon-pitch.spec.ts, tycoon-story.spec.ts}`.
- `content/ui/i18n/en.json` keys `tycoon.pitch.*` (DL-222, DL-247).
- About 39 files. The 12 souls are short originals, about 900 words each.

## Interfaces
- C10 1.0: consumes `NPCDialogueRequest`, `context.tycoon` and `DialogueEvent`. The model never writes numbers, and `deals` come from the sim.
- C09 1.0: `ModeHook` with `defId: 'mini8w'`, no params (DL-157); stub path per `03-story-missions.md` §C8.
- C06 1.1: `startChild`, `EconomyApi.credit`/`ledgerSince` and descriptor v2 (`world: 'stage'`).
- C16 1.1 names as listed. No contract shape changes.

## Acceptance criteria
- AC-1 Given a recorded VC response whose `offer_deal` arg is not in `offers.dealIds` When the controller maps it Then the result is `pass`; and a forged `vcSpoke` proposal outside the envelope is clamped field by field in the sim, with `clamped` listing each changed field and replay giving the same result — proof: `pnpm check:unit -- packages/modes/tycoon packages/shared/src/tycoon/finance`
- AC-2 Given fixtures for `quota_exhausted`, `budget_offline`, `kill_switched`, `upstream_unavailable`, a `fallback` event, a network error and a stream with no first token for 5 s When a meeting turn runs Then each turn shows the envelope midpoint offer with a templated line (the timeout case at 4 s ± 0.2 s) and the round can close — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-3 Given a meeting When the controller builds the request Then `context.mode` is `'tycoon'`, `deals` has at most 3 entries all inside the envelope and their ids equal `offers.dealIds`, every band is an integer 0–4, no field carries earlier free text, `turn.intent` is a tycoon intent, and `maxTokens ≤ 220` — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-4 Given the negotiation FSM When illegal transitions, a fifth meeting in one raise, mood below 10, and two `askMore` within the band are applied Then illegal moves are rejected, the fifth meeting is refused, mood under 10 ends in `passed(mood_floor)`, and each `askMore` costs 4 mood; question draws for a seed equal the golden list — proof: `pnpm check:unit -- packages/shared/src/tycoon/finance`
- AC-5 Given the 12 VC souls, the shared ink and the roster When the NPC gates run Then lint L1–L14 pass, all 12 are `fictionalized` originals, only `vc-tourist-hedge` has `predatoryAllowed`, only the two hero VCs use Sonnet, and no voice is above t1 — proof: `pnpm npc:lint && pnpm likeness:gate`
- AC-6 Given mission `m.a2.01` with the `autoFounder` bot and a fixed seed When the autoplayer runs on 3 seeds Then the mini-run ends `miniWin` within 8 weeks, `unlock.tycoon` is emitted exactly once, flag `coop_success` is true, and the end hashes are equal across runs of a seed — proof: `pnpm check:missions -- --mission m.a2.01`
- AC-7 Given a QA build with `?hooks=stub` When the mission reaches the hook Then the three-choice talk runs, sets the same flag and emits `unlock.tycoon` once; the main menu then shows the tycoon tile unlocked with a "New mode unlocked" toast, and it stays unlocked after reload — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-story`
- AC-8 Given standalone winning runs with founder payouts of $1 M and $100 M When dividends accrue and the story is entered twice in the same game week Then the counter adds $200 and $10,000 (capped), never decreases, the story credits each amount once by idempotency key, and the weekly credit never exceeds $10,000 — proof: `pnpm check:unit -- packages/modes/tycoon packages/modes/story`
- AC-9 Given mocked SSE When the pitch room opens on desktop Then the 3D room shows the VC with subtitles, the AI label and the disclaimer; on the WebKit iPhone viewport the 2D card shows the same labels; the deterministic offer card is visible before the first line arrives — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-pitch` and `pnpm check:e2e -- --project=webkit-webgl2 --grep @tycoon-pitch`
- AC-10 Given a kill flag on `vc-fogindex-hardball` mid-meeting When the next turn runs Then the stand-in line source speaks, the envelope and offer are unchanged, and the meeting re-enters `qa` — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-11 Given a run with a round, a negotiation and an end When telemetry batches are captured Then only registered `tycoon.*` names appear with numeric or enum props, and no free text or id is sent — proof: `pnpm check:telemetry`
- AC-12 Given the balance gate with hardcore runs added and the `mini8w` preset excluded When it runs Then B1–B11 still pass — proof: `pnpm check:balance -- --suite tycoon`
- AC-13 Given the built bundle When the secret scan runs Then no key pattern appears — proof: `pnpm build && pnpm check:secrets -- apps/web/dist`

## Test plan
- **Unit:** parse, clamp, fallback, context, FSM, dividends, roster tiers (`pnpm check:unit -- packages/modes/tycoon packages/shared/src/tycoon/finance packages/modes/story`).
- **Bot-run:** `check:missions -- --mission m.a2.01`; `check:balance -- --suite tycoon`.
- **E2E:** `@tycoon-pitch` (both flat projects), `@tycoon-story` (stub path and tile unlock).
- **Static:** `npc:lint`, `likeness:gate`, `check:telemetry`, `check:secrets`.
- **Staging (optional, records only):** with `ANTHROPIC_API_KEY` on staging, one meeting turn on the Preview records TTFT (U-NPC-01) in the PR notes. It is not an AC.

## Demo script
1. `VITE_DV_QA=1 pnpm dev`, then start a new story profile and jump to `m.a2.01` with the mission debugger.
2. Talk to Whitney and enter the seed-round mini-run. Meet `vc-seedling-angel` in the pitch room.
3. Answer a question, ask for more and counter. Watch the mood meter and the offer card.
4. Block the network in DevTools and see the offline line and the midpoint offer appear.
5. Close the SAFE and return to the story. The toast "New mode unlocked" appears.
6. Open Tycoon from the main menu and play a standalone run.

## Effort
1 Builder session; about 39 files; risk **medium**. The content volume (12 souls) and the two pitch-room paths are the time sinks. The FSM and the clamp are small and pure.

## Risks & fallbacks
- **Souls fail lint L4 (block B ≥ 600 tokens).** Lengthen the `## Identity` and `## Example lines` sections. Token counting uses `messages.count_tokens` and needs `ANTHROPIC_API_KEY`. Without it L4 prints `SKIP … ANTHROPIC_API_KEY not set` (M06a2 behaviour), so run it once in CI where the key exists.
- **3D room time overrun.** Ship the 2D card on all tiers and keep the stage behind the mode-local constant `ui.room3d` in `config/tycoon.balance.json` (default false; not a C12 feature flag). Record the decision.
- **Live dialogue latency** (U-NPC-01): the offer card never waits. The `tycoon.dialogue` flag can be turned off without a release.

## Notes for the Builder
- Read first: `08-tycoon-finance.md` §8–§11; `08-tycoon.md` §3.1, §5.8, §5.11, §5.14–§5.15; `03-story-missions.md` §C7–§C9; `03-story-narrative.md` §B6 (`m.a2.01` row); `04-npc-contracts.md` B2.2, B2.4, B3, B5, B8.
- **Paths.** Souls live in `content/npcs/` (04-npc-contracts §B5) and mission sources in `content/missions/<id>/` (DL-220).
- **Secrets.**
  - `ANTHROPIC_API_KEY` (Worker secret, workspace `npc-runtime`; CI for lint L4 token counts). Absent: SKIP; all ACs run on recorded fixtures.
  - Q-23(c): the disclaimer text needs counsel sign-off before launch only.
- Facts: F-034, F-035 and F-036 (models, caching, no sampling parameters) are used by the proxy, not by this milestone's code. Never send `temperature`.

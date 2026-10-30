# Milestone plan — part 2: modes and NPC runtime, roster, Acts 2–3, hardening, XR (blocks D–E)

> S13 · 2026-10-18 · same field legend as `_PLAN-1.md`. Block E ends at the single-player launchable point (`_PLAN.md` §3).

## Block D — modes and NPC runtime (VS-Racing, VS-Fighter, VS-Tycoon)

### M06a1 · npc-backend-spine — 1 · risk M · S09 (+S04)
- **Goal:** play token (route 5, TOFU), `PlayerQuotaDO`, `EncounterDO`, SSE transport with 4 s timeout, migration 0003, roster flags, kill and flag routes (46, 47), `/me` export and forget (14), retention crons; DO tag `web-v2` alone.
- **R** R-NPC-04/05, R-AUTH-01, R-IP-02 · **Dep** M05d, M04b3 · **Read** `09-backend.md` §8; `09-backend-contracts.md` §2.4 rows 5, 14, 30, 46, 47; `09-backend-db.md` §3 (0003), §7; `09-backend-ops.md` §3, §5.2 · **Out** `services/edge/src/{npc,quota,id}`, `supabase/migrations/0003_npc.sql` · **C** C12 1.1, C10 1.0
- **Gate** `PLAY_TOKEN_HMAC`, `QUOTA_NET_SALT_SECRET`, `SUPABASE_SECRET_KEY` · **Proof** `pnpm check:workers -- quota-turns`; `pnpm check:workers -- killswitch`; `pnpm check:db && pnpm check:workers -- forget`

### M06a2 · soul-contract-compiler — 1 · risk L · S04
- **Goal:** C10 types and schemas, validators, `tools/soul` lint/compile/build, roster manifest, original test souls (`npc_test`, canary, stand-ins), ink scaffolds, consent-index export.
- **R** R-NPC-01/04, R-IP-02 · **Dep** M00b, M01d · **Read** `04-npc-contracts.md` B1–B9 · **Out** `packages/shared/src/npc`, `packages/shared/schemas/npc`, `tools/soul`, `content/npcs` · **C** C10 1.0, C07 1.1
- **Gate** Q-19, Q-25 (real roster waits; originals only) · **Proof** `pnpm npc:lint` (L1–L14 bad fixtures fail); `pnpm check:unit -- packages/shared/src/npc` (compile twice → identical sha256); `pnpm likeness:gate`

### M06a3 · dialogue-proxy — 1 · risk M · S04, S09
- **Goal:** server dialogue (`PromptAssembler`, `ModelRouter`, safety filter, executor), client `DialogueClient` + `InkRunner`, offline fallback, recorded-fixture mode, cache and TTFT staging probes, disclosure hooks.
- **R** R-NPC-05, R-AUTH-01 · **Dep** M06a1, M06a2 · **Read** `04-npc.md` §5; `04-npc-contracts.md` B7; `09-backend-ops.md` §5.3 · **Out** `services/edge/src/npc/dialogue`, `packages/npc/src/{client,ink}` · **C** C10 1.0, C12 1.1
- **Gate** `ANTHROPIC_API_KEY` (workspace `npc-runtime`), AI Gateway `gw-dialogue` · **Proof** `pnpm check:workers -- npc` (event order, 4 s ± 0.2 fallback, refusal, killed, quota, governor, prompt-cache order); `pnpm check:secrets -- apps/web/dist`; `pnpm test:staging -- npc-cache` (turn 2 reads cache; TTFT recorded, not asserted)

### M06a4 · memory-voice-lipsync — 1 · risk M · S04
- **Goal:** `MemoryService` and summarizer, t1 TTS (Workers AI Aura), `TtsPlayer`, `LipSyncDriver`, voice catalog, eval harness, route 52.
- **R** R-NPC-04/05, R-ENG-04, R-UI-01 · **Dep** M06a3, M04b2 · **Read** `04-npc.md` §5.6–§5.8; `04-npc-builder.md` C6 · **Out** `packages/npc/src/{tts,lipsync}`, `packages/npc/evals`, `services/edge/src/npc/memory` · **C** C10 1.0, C12 1.1
- **Gate** Q-20 (t2 voices off) · **Proof** `pnpm check:workers -- npc-tts-gating`; `pnpm npc:eval -- --replay`; `pnpm check:unit -- packages/npc` (viseme mapper; 36-case voice tier matrix)

### M06a5 · dialogue-panel-ui — 0.3 · risk L · S10
- **Goal:** dialogue bubble, choices, safety card, AI badge, likeness card, report button.
- **R** R-NPC-05, R-IP-03, R-ENG-04 · **Dep** M06a3, M04b2 · **Read** `10-ui-hud-xr.md` §2 (dialogue); `04-npc.md` §5 (disclosure) · **Out** `packages/ui/src/dialogue` · **C** C06 1.1 (`UiBridge`)
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc` (mocked SSE, badge, subtitles, report); `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-offline`

### M06c · npc-agency-barks — 1 · risk M · S04
- **Goal:** named-NPC brains and LOD, `whereIs`, intents (route 32), Talk handler, `BarkSystem`, archetype pools; scenario `npc-mission-crowd`.
- **R** R-NPC-01, R-MAP-04 · **Dep** M06a3, M03b2 · **Read** `04-npc-builder.md` C8–C9; `04-npc.md` §5 · **Out** `packages/npc/src/{brains,barks}` · **C** C10 1.0, C06 1.1 (`ModeContext.npc`)
- **Gate** none · **Proof** `pnpm check:unit -- packages/npc` (same seed → same trace; bark cooldowns; schedule across midnight); `pnpm check:workers -- npc-intent-throttle`; `pnpm check:perf -- --scenario npc-mission-crowd`

### M06b1 · builder-text-private — 1 · risk M · S04 (+S09 moderation base)
- **Goal:** NPC builder drafts (route 33: drafts, validate, soul, preview), text moderation, soul generation, preview chat, private use, limits; migration 0004. Reports (route 41) and the NPC case queue of route 43 land in M06b2 (DL-182, DL-234).
- **R** R-NPC-03, R-IP-03 · **Dep** M06a3 · **Read** `04-npc-builder.md` C1–C5, C7, C10; `09-backend-db.md` §3 (0004) · **Out** `services/edge/src/npc-builder`, `supabase/migrations/0004_moderation.sql` · **C** C10 1.0 (builder), C12 1.1
- **Gate** `OPENAI_MODERATION_API_KEY`; Anthropic workspace `npc-builder` · **Proof** `pnpm check:workers -- npc-builder` (limits, states, moderation order, real-person alias, submit tier); `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder`

### M07a1 · racing-core-director-car — 1 · risk M · S06
- **Goal:** racing mode package, descriptor and unlock, referee and gates, race director, six player cars, nitro, damage, HUD view-model, race schemas, `map:races` compile, `racing.line` bot.
- **R** R-MODE-02/05, R-IP-01 · **Dep** M03a2, M04a2, M04d, M02c1 · **Read** `06-racing.md` §2; `06-racing-data.md` §4.1–§4.2, §4.5–§4.7; `06-racing-content.md` C.1–C.3, C.9 · **Out** `packages/modes/racing`, `content/races`, `config/racing/*.json` · **C** C06 1.1, C04 1.1 (anim 128–159), C03 1.1
- **Gate** none · **Proof** `pnpm --filter @dv/mode-racing test` (`referee.gates`, `damage.formula`); `pnpm map:races validate`; `pnpm check:e2e -- --project=webkit-webgl2 --grep @racing-touch`

### M07a2 · racing-ai-replay-ghosts — 1 · risk M · S06 · **VS-Racing**
- **Goal:** AI drivers and rubber-band, validator V1–V15 and par, 3 VS races + `sf.pursuit.bayview-escape`, replay codec, ghosts, exact re-sim, `RacingSlice`, story hook (DL-157), `config/pursuit.race.json`.
- **R** R-MODE-02/05 · **Dep** M07a1, M03c, M05c1 · **Read** `06-racing-data.md` §4.2–§4.4; `06-racing-content.md` C.5, C.11–C.12 · **Out** `packages/modes/racing/src/{ai,replay}`, `content/races` · **C** C06 1.1, C05 1.1 (`mode:racing`)
- **Gate** none · **Proof** `pnpm map:races par -- --check` (±15 % of `parSec`); `pnpm check:e2e -- --project=webkit-webgl2 --grep @racing-det`; `pnpm --filter @dv/mode-racing test` (`replay.exact`, `ghost.track`, `bot.pursuit`); `pnpm check:e2e -- --project=chromium-webgl2 --grep @racing-vs`

### M07b1 · racing-content-events-ladder — 1 · risk M · S06
- **Goal:** the six remaining race kinds plus the pursuit `survive` success (DL-237), 16 more SF events, roadster hop and robotaxi quirks, roadblocks and spikes in races, the ladder with original rivals, progression, remaining cars.
- **R** R-MODE-02, R-MAP-01, R-IP-01 · **Dep** M07a2, M03b2 · **Read** `06-racing-content.md` C.4–C.6, C.11 · **Out** `content/races`, `packages/modes/racing/src/quirks` · **C** C06 1.1, C07 1.1
- **Gate** none · **Proof** `pnpm map:races validate`; `pnpm --filter @dv/mode-racing test` (`quirk.stall` holds 4–9 s over 20 seeds); `pnpm names:lint`

### M07b2 · racing-garage-replay-photo-visuals — 1 · risk M · S06
- **Goal:** garage and upgrades, replay director and scrub, photo mode, `desktop-ultra` look, audio wiring, econ-sim racing section, **`RaceDef.intro` flag and `cut.race.intro.<raceId>` refs with in-engine fallback (gap 11, R-CUT-02 SHOULD)**.
- **R** R-MODE-02, R-CUT-02/03 · **Dep** M07b1, M05b2 · **Read** `06-racing-data.md` §4.2, §4.4; `06-racing-content.md` C.7, C.10; `03-story-cutscenes.md` §D4 · **Out** `packages/modes/racing/src/{garage,photo}`, `content/races/*/race.json` · **C** C09 1.0 (`CutsceneRef`), C13 1.1 (`PostNode`)
- **Gate** none · **Proof** `pnpm map:races validate` (every intro ref resolves and has a fallback); `pnpm check:balance -- --suite econ`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @cutscene`; manual `M07b2-iphone15`

### M07b3 · sandbox-tune — 0.5 · risk M · S06 (+S01, S10) (study set, DL-716, DL-721)
- **Goal:** a Tune tab in the Sandbox app applies M07b2's upgrade levels to the player's session cars (M04e3) at no cost; guarded by the `veh:sbx` key and session-only state, never reaching the purse, `CoreSlice.garage`, a save or a race.
- **R** R-UI-03, R-MODE-02 (s), R-ROLL-02 (s), R-PLAT-02 (s), R-IP-01 (s) · **Dep** M07b2, M04e3, M04e5 · **Read** file `M07b3-sandbox-tune.md`; `06-racing-content.md` C.4; DL-721 · **Out** `packages/shared/src/vehicle/upgrades.ts`, `packages/modes/racing/src/garage/`, `packages/engine/src/sim/modes/builtin/sandbox-tune.ts`, `packages/ui/src/phone` · **C** C01 1.0, C05 1.2, C06 1.1 (read)
- **Gate** none · **Proof** `pnpm --filter @dv/mode-racing test -- sandbox-tune-guard`; `pnpm check:unit -- packages/engine/test/modes/sandbox-tune.spec.ts`; `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-tune`

### M08a1 · fight-core-sim-data — 1 · risk M · S07
- **Goal:** pure fighter core (`packages/shared/src/fight`, FC2–FC9), schemas, reference kit, input buffer, hash, replay, motion parser, `fighter:lint`, `fighter:replay`, golden vectors, the `fighter.script` input script (its M04d `BotDriver` registration and mutants land in M08a2, DL-236).
- **R** R-MODE-03 · **Dep** M01a1, M05a1 (C09 `RosterSlot` type, DL-163) · **Read** `07-fighter-core.md` FC1–FC9, FC11; `07-fighter-content.md` FX3 · **Out** `packages/shared/src/fight`, `packages/modes/fighter/golden` · **C** C02 1.1, C03 1.1 (fighter aliases)
- **Gate** none · **Proof** `pnpm --filter @dv/mode-fighter fighter:replay -- golden/vs-001.dvfight`; `pnpm check:unit -- packages/shared/src/fight` (motion parser; zero allocations per tick)

### M08a2 · fight-mode-training-vs — 1 · risk M · S07 · **VS-Fighter**
- **Goal:** `FighterMode`, camera, gray-box fighters, frame-locked clips, HUD, Classic and Simple schemes on kbm/pad/touch, Training, stage `powell_turntable`, CPU Easy/Hard, slice, unlock, story hook, `fight-stage`; `fighter.script`/`fighter.cpu` `BotDriver`s with mutants. Open-world `CombatApi` keeps the M05c1 core in v1 (DL-236).
- **R** R-MODE-03/05, R-ENG-04 · **Dep** M08a1, M04a2, M04b2, M04d, M05c1 · **Read** `07-fighter.md` §2; `07-fighter-core.md` FC3–FC8, FC10; `07-fighter-content.md` FX8–FX9 · **Out** `packages/modes/fighter` · **C** C06 1.1, C04 1.1 (anim 160–207), C05 1.1
- **Gate** none · **Proof** `pnpm check:e2e -- --project=webkit-webgl2 --grep @fighter-hash` (and `chromium-webgl2`); `pnpm check:e2e -- --project=webkit-webgl2 --grep @fighter-touch`; `pnpm --filter @dv/mode-fighter fighter:bench` (step p99 ≤ 0.10 ms)

### M08b1 · fight-roster-kits-ai — 1 · risk M · S07
- **Goal:** eight kits, full CPU, roster loader, tier and fame-domain gates, `fighter:balance`, name hygiene, `check:fighter`.
- **R** R-MODE-03, R-NPC-04, R-IP-02 · **Dep** M08a2, M06a2 · **Read** `07-fighter-content.md` FX1–FX2, FX4, FX11; `07-fighter-core.md` FC10 · **Out** `content/fighter/kits`, `packages/modes/fighter/src/cpu` · **C** C10 1.0 (fighter stats), C07 1.1
- **Gate** Q-24 (library clips until art-lead signatures) · **Proof** `pnpm --filter @dv/mode-fighter fighter:balance -- --bouts 1000` (28 pairs within 35–65 %); `pnpm check:fighter`; `pnpm likeness:gate`

### M08b2 · fight-stages-cutscenes-arcade — 1 · risk M · S07
- **Goal:** five more SF stages, cutscene hooks and refs with composed intros (`playSequence`), Cinematic phase, Arcade ladder, kill-switch remap, Move Gallery, accessibility pass.
- **R** R-MODE-03, R-CUT-02/03, R-NPC-04 · **Dep** M08b1, M05b2 · **Read** `07-fighter-content.md` FX5–FX6, FX9 · **Out** `content/fighter/{stages,cutscenes.json}` · **C** C09 1.0
- **Gate** none (real clips wait for M10b) · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @fighter-cutscene`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @fighter-kill`; `pnpm assets:cutscene-index -- --count fighter` (116 for N = 8, S = 6)

### M08c1 · pose-pipeline-classifier — 1 · risk H · S07
- **Goal:** `pose.worker` pipeline on MediaPipe Pose Landmarker (lite mobile, full desktop within budget), vendoring script, binder, gesture FSM, filters, synthetic fixtures, classifier harness.
- **R** R-MODE-03, R-IP-04 · **Dep** M08a2 · **Read** `07-fighter-pose.md` FP1–FP3, FP5, FP7–FP8 · **Out** `packages/modes/fighter/src/pose`, `apps/web/public/pose/` · **C** C03 1.1 (`PoseActionEvent`)
- **Gate** none · **Proof** `pnpm --filter @dv/mode-fighter fighter:pose-fixtures` (≥ 90 % overall, ≥ 85 % per gesture, ≤ 1 false positive per idle minute); `pnpm check:unit -- packages/modes/fighter` (worker network allow-list)

### M08c2 · pose-calibration-gate — 1 · risk H · S07
- **Goal:** calibration flow and device-local store, capability decision, consent gate, `Permissions-Policy: camera=(self)`, privacy tests, device runs, `fight-stage-pose`.
- **R** R-MODE-03, R-IP-04 · **Dep** M08c1 · **Read** `07-fighter-pose.md` FP4, FP6, FP7, FP9–FP10; `11-platform-pwa.md` §11 · **Out** `packages/modes/fighter/src/pose/calibration`, `tools/ci/checklists/M08c2-*.json` · **C** C13 1.1 (`dv-platform` store)
- **Gate** Q-23(b) counsel before launch only · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @pose` (no body over 4 KB, no image MIME); `pnpm check:headers -- http://localhost:8788`; manual `M08c2-{iphone15,webcam}` (records latency; `unavailable` is valid)

### M09a1 · tycoon-core-finance — 1 · risk L · S08
- **Goal:** pure tycoon core and finance (cap table, SAFE, priced round, waterfall, envelope), replay and `verifyRun`, `TycoonModeSim` with a QA panel, slice and golden.
- **R** R-MODE-04 · **Dep** M01a1, M04a2, M04d · **Read** `08-tycoon.md` §4–§5; `08-tycoon-finance.md` §2–§9, §13 · **Out** `packages/shared/src/tycoon`, `packages/modes/tycoon` · **C** C06 1.1, C05 1.1
- **Gate** none · **Proof** `pnpm check:unit -- packages/shared/src/tycoon/finance` (TV-1…TV-11, WF-1…WF-7 exact); `pnpm lint` (T-03 fixture); `pnpm check:e2e -- --project=webkit-webgl2 --grep @tycoon-det`

### M09a2 · tycoon-events-balance — 1 · risk M · S08 · **VS-Tycoon**
- **Goal:** shared event engine, 30 events, trend deck, four bot policies, `tools/ci/tycoon-sim`, bands and baseline, self-test fixtures; mode available behind `?unlockAll=1` in QA builds.
- **R** R-MODE-04/05 · **Dep** M09a1, M04d · **Read** `08-tycoon-events.md` §1–§9 · **Out** `packages/shared/src/events`, `tools/ci/tycoon-sim`, `content/tycoon/events` · **C** C06 1.1
- **Gate** none · **Proof** `pnpm check:balance` (B1–B12 at 2,000 runs per policy; four self-tests fail); `pnpm check:unit -- packages/shared/src/events` (200 replays equal live)

### M09b1 · tycoon-ui — 1 · risk M · S08
- **Goal:** dashboard, cap table, hiring, roadmap, inbox, board, summary, branch replay, two more sectors and 30 more events, accessibility, mobile layout, XR desk panels.
- **R** R-MODE-04, R-ENG-04, R-UI-03 · **Dep** M09a2, M04b2 · **Read** `08-tycoon.md` §5–§6 · **Out** `packages/modes/tycoon/src/ui` · **C** C06 1.1 (`UiBridge`)
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-a11y`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-save` (week 40 resumes with an identical hash)

### M09b2 · tycoon-vc-story — 1 · risk M · S08 (+S03 `m.a2.01`)
- **Goal:** 12 fictional VC souls, pitch controller with clamp and offline fallback, pitch room (3D with 2D fallback), `mini8w` preset, `unlock.tycoon`, story hook and `m.a2.01`, dividend counter, disclaimer.
- **R** R-MODE-04/05, R-NPC-05 · **Dep** M09b1, M06a3, M05a1, M05a2 · **Read** `08-tycoon-finance.md` §8–§11; `03-story-missions.md` §C8 · **Out** `packages/modes/tycoon/src/pitch`, `content/npcs/vc-*`, `content/missions/m.a2.01/` · **C** C10 1.0 (`tycoon.deals`), C09 1.0
- **Gate** Q-23(c) disclaimer text before launch · **Proof** `pnpm check:unit -- packages/modes/tycoon` (T-08 parse and clamp); `pnpm check:missions -- --mission m.a2.01` (T-10: `miniWin` within 8 weeks, unlock once)

## Block E — roster, Acts 2–3, hardening, XR (single-player launchable)

### M10a1 · roster-pipeline — 1 · risk H · S05 (split 1 of 2)
- **Goal:** extends M05c3's `assets:gen` with `plan`, `run`, `gate`, `ledger`; `assets:optimize`, `assets:retarget`; QA gates A3–A8 and human gates; the repo fal ledger `assets/ledger/fal-spend.jsonl`; canary `canary-mc` (Standard) plus the first Lean Act 1 cast entry (≈ $4.7 of the $42 roster cap; DL-234).
- **R** R-NPC-02/04, R-IP-02, R-ENG-03 · **Dep** M05b1, M06a2, M01d, M05c3 · **Read** `05-assets-pipeline.md` §1–§5, §11–§12; `05-assets.md` §4.5–§4.6 · **Out** `tools/assets/gen`, `services/pipeline/steps` · **C** C07 1.1, C10 1.0
- **Gate** `FAL_KEY` (operator), prepaid ≤ cap, Q-17; Q-19/Q-25 for real-derived slugs · **Proof** `pnpm assets:gen plan --roster <manifest> --tier standard` (zero vendor calls); `pnpm check:pipeline`; `pnpm provenance:check && pnpm likeness:gate` on the canary publish PR

### M10a2 · roster-pipeline — 1 · risk H · S05, S07 (split 2 of 2)
- **Goal:** batch inside DL-OWN-01 (≤ 8 Standard heroes, ≤ 12 Lean; others creator-kit or stand-ins), retarget to `bay_rig_v1`, S07 signature clips, publish and lock.
- **R** R-NPC-01/02, R-MODE-03 · **Dep** M10a1, M08b1 · **Read** `05-assets-pipeline.md` §4, §12; `07-fighter-content.md` FX7 · **Out** `assets/characters`, `assets/lock`, `assets/provenance` · **C** C07 1.1, C04 1.1
- **Gate** as M10a1; Q-24 · **Proof** `pnpm assets:gen plan --roster <manifest> --tier standard` (zero outstanding jobs); `pnpm check:assets`; `pnpm check:fighter` (every slot resolves on six tiers); manual ledger ≤ 42,000,000 micros

### M10b · qa-gates-kill-drill — 1 · risk M · S05 (+fighter prewarm)
- **Goal:** gate hardening, prewarm idempotence, kill-switch purge drill (`KillPurgeWorkflow`, `KILL_WF`), fighter intro/finisher prewarm within the rest of the $38 cutscene line after Act 1 (DN-S13-02, DL-741) via a `cleared` provider, and the operator re-run of M05c3's Act 1 prewarm once the M10a2 sheets exist (DL-232); both live runs finish through M05c4's `--finish` (DL-750).
- **R** R-NPC-04, R-IP-02, R-CUT-01, R-ENG-03 · **Dep** M10a2, M08b2, M06a3, M05c4 · **Read** `05-assets-pipeline.md` §10, §12; `07-fighter-content.md` FX6 · **Out** `services/pipeline/kill`, `tools/ops` (runner, `suites/kill-drill`) · **C** C07 1.1, C12 1.1 (route 46)
- **Gate** `CF_API_TOKEN_CACHE`; ADR-GENAI-01 `cleared` for paid prewarm · **Proof** `pnpm check:e2e -- --grep @kill-drill`; `pnpm test:ops -- --suite kill-drill`; `pnpm check:pipeline` (second prewarm: zero calls)

### M10c · roster-souls-ink-barks — 1 · risk M · S04
- **Goal:** normalize supplied research souls with human review, ink for Act 1 NPCs, baked barks, voice designs, consent-index export.
- **R** R-NPC-01, R-IP-02 · **Dep** M10a2, M06a4, M06c, M05c2 · **Read** `04-npc-contracts.md` B5–B6, B8; `04-npc.md` §5.7 · **Out** `content/npcs`, `content-private/` (mount) · **C** C10 1.1
- **Gate** Q-19, Q-25 (canary only while open), Q-20 · **Proof** `pnpm npc:lint`; `pnpm likeness:gate`; `pnpm check:missions -- --act 1`

### M10d0, M10d1, M10d4, M10d5 · art admission and art integration (DL-OWN-07, DL-739, DL-755)
The one-session M10d1 is split into M10d1 (vehicles, props, the placeholder registry) and M10d4 (pedestrians, creator parts), after the new M10d0 `art-admission`; M10d5 (the on-foot body) is carved from M10d3. Their rows, and Track B's order, are in `_PLAN-3.md` § Look program.

### M10f · emote-wheel — 0.6 · risk M · S01 (+S10) (study set, DL-716, DL-718)
- **Goal:** holding `SimButton.Emote` opens a wheel of eight original code-built clips played as `AnimStateId` 21, decided in the sim from the `InputFrame`; an Emotes list in the Sandbox app; closed in missions and while `net` is set (DL-719).
- **R** R-UI-03 (s), R-ENG-04 (s), R-IP-01 (s) · **Dep** M10d4, M04b2, M04e5 · **Read** file `M10f-emote-wheel.md`; `01-engine-contracts.md` (C03 `Emote`, C04 `AnimStateId`) · **Out** `packages/engine/src/sim/control/emote.ts`, `packages/engine/src/client/anim/emote-clips.ts`, `config/emotes.json`, `packages/ui/src/hud/emote-wheel.tsx` · **C** C01 1.0, C03 1.1, C04 1.1, C06 1.1 (read)
- **Gate** Q-13 iPhone 15 (manual touch run) · **Proof** `pnpm check:unit -- packages/engine/test/control.emote.spec.ts`; `pnpm check:e2e -- --project=webkit-webgl2 --grep @emote`; manual `M10f/iphone`

### M10d3 · art-integration — 1 · risk M · S05 (+S06, S07) (the last art row, after M10d5 and M10d2; DL-460, DL-739, DL-755)
- **Goal:** final v1 art for the 14 player cars with prefabs (`vehicle/<slug>` on the §7 node contract plus the `06-racing-content.md` C.8 nodes: cockpit, steering wheel, thrusters, `_dent`), the six fight-stage dioramas `prop/stage-<id>-{day,night}`, a creator-kit body for any fighter M10a2 leaves on its gray-box capsule; fills the three `owner: 'M10d3'` registry rows, so `assets:final` passes; vetted licensed bases or generated bodies within the vehicles-and-props line (DL-740), recipe fallback.
- **R** R-MODE-02, R-MODE-03, R-IP-01 · **Dep** M10d5, M10d2, M07b2, M08b2, M10a2 · **Read** file `M10d3-…md`; `05-assets-pipeline.md` §3, §4, §7; `06-racing-content.md` C.1, C.8, C.10; `07-fighter-content.md` FX4, FX5 · **Out** `assets/`, `content/fighter/{stages,roster.json}`, `config/art-placeholders.json`, `tools/assets/src/recipes`, `tools/assets/test/final.spec.ts` · **C** C07 1.1, C04 1.1, C13 1.1, C06 1.1 (read)
- **Gate** Q-39, Q-24 (defaults apply); optional `FAL_KEY` · **Proof** `pnpm provenance:check`; `pnpm check:assets`; `pnpm check:fighter`; `pnpm assets:vehicle -- --check`; `pnpm check:perf -- --scenario fight-stage --fail`; `pnpm assets:final`; `@art-cars`, `@art-stages`

### M10d2 · art-integration — 1 · risk M · S02 (+S05, S11) (DL-390, DL-460, DL-739; Track B 5, before M10d3, DL-755)
- **Goal:** KTX2 facade atlas (desktop and a `mobile` variant, DL-740), rasterized `texture/far-bay-cards`, landmark art pass at the same AssetIds where files are supplied, `desktop-ultra` atmosphere adapter and clouds behind a flag, and the `assets:final` placeholder scan that M14b3's `art-final` gate computes.
- **R** R-MAP-01, R-MAP-02 (s), R-MODE-02 (s), R-IP-01 · **Dep** M10d5, M10d4, M02h5 (the last Track A row that changes the bake output), M02d2, M02e (façade node, DL-704) · **Read** file `M10d2-…md`; `02-world-maps.md` §4; `02-world-bake.md` §6, §7; `02-world-living.md` §6 · **Out** `tools/map/src/far`, `tools/assets/src/final.ts`, `packages/world/src/client/{chunks,sky}` · **C** C07 1.1, C08 1.0, C13 1.1
- **Gate** Q-39 (default applies) · **Proof** `pnpm check:unit -- tools/assets` (`final.repo`); `pnpm map:landmarks -- --build --check`; `DV_WORLD=synth pnpm check:perf -- --scenario route-ferry-ocean-beach --fail`; `@art-skyline`, `@art-ultra`

### M05e1 · story-act2-part1 — 1 · risk M · S03 (+S08 event host)
- **Goal:** `m.a2.02`–`05`, refs and unlock defs; story businesses on `EventHost<BusinessState>` (DL-133) with their state in C05 1.2 `property.businesses[].state` (DL-225), events in the phone Bank app (DL-238).
- **R** R-MODE-01/05, R-CUT-02 · **Dep** M05c2, M07a2, M08b2, M09b2, M07b1 (races of `m.a2.02`, `m.a2.03`, `m.a3.03`) · **Read** `03-story-narrative.md` §B6–§B7; `08-tycoon-events.md` §7 · **Out** `content/missions/m.a2.0{2..5}/`, `content/story/businesses.json` · **C** C09 1.0, C06 1.1, C05 1.2
- **Gate** Q-21 for release · **Proof** `pnpm check:missions -- --act 2`

### M05e2 · story-act2-part2 — 1 · risk M · S03
- **Goal:** `m.a2.06`–`08`, Act 2 refs, econ-sim Act 2 section.
- **R** R-MODE-01, R-CUT-02 · **Dep** M05e1 · **Read** `03-story-narrative.md` §B6 · **Out** `content/missions/m.a2.0{6..8}/` · **C** C09 1.0
- **Gate** Q-21 for release · **Proof** `pnpm check:missions -- --act 2`; `pnpm check:balance -- --suite econ`

### M05f1 · story-act3-part1 — 1 · risk M · S03
- **Goal:** `m.a3.01`–`03` with refs.
- **R** R-MODE-01, R-CUT-02 · **Dep** M05e2, M10b · **Read** `03-story-narrative.md` §B6 · **Out** `content/missions/m.a3.0{1..3}/` · **C** C09 1.0
- **Gate** Q-21 for release · **Proof** `pnpm check:missions -- --act 3`

### M05f2 · story-act3-finale — 1 · risk M · S03
- **Goal:** `m.a3.04`–`06`, finale and endings, portal close, credits; econ-sim Acts 2–3 band ($70k–$110k added rewards).
- **R** R-MODE-01, R-CUT-02/03 · **Dep** M05f1 · **Read** `03-story-narrative.md` §B6 · **Out** `content/missions/m.a3.0{4..6}/` · **C** C09 1.0, C05 1.1
- **Gate** Q-21 for release · **Proof** `pnpm check:missions -- --act 3`; `pnpm check:balance -- --suite econ`; `pnpm check:e2e -- --project=webkit-webgl2 --grep @story`

### M10e · audio-integration — 1 · risk M · S05 (+S06, S07, S02, S03) (DL-500)
- **Goal:** every `content/audio/needs.json` row final (racing C.7 finals replacing M07b2's placeholders, fighter FX audio, sirens per unit tier, district ambience beds, story music cues); commissioned stems integrated with work-for-hire records (Q-11), music rows silent under the Q-40 default when none are supplied; original announcer, scanner and crowd lines rendered through M10c's route; `assets:final` rules 4–5 for audio placeholders, so M14b3's `art-final` gate covers audio; SFX recipe fallback, no genAI spend.
- **R** R-MODE-02 (s), R-MODE-03 (s), R-MAP-04 (s), R-ENG-04 (s), R-IP-01 · **Dep** M10d2, M10d3 (DL-755), M10c, M05f2, M07b2, M08b2, M03c, M02b2 · **Read** file `M10e-…md`; `05-assets-pipeline.md` §8, §9; `06-racing-content.md` C.7; `07-fighter-content.md` FX5 · **Out** `content/audio/`, `config/world/ambience.json`, `tools/assets/src/{import/audio.ts,audio-qa.ts,final.ts}`, `packages/world/src/client/ambience.ts` · **C** C07 1.1, C04 1.1, C09 1.0
- **Gate** Q-11, Q-40 (defaults apply), Q-20; `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for voiced lines · **Proof** `pnpm assets:final`; `pnpm provenance:check`; `pnpm check:assets`; `@audio-final`

### M11a1 · iphone-hardening-governor — 1 · risk M · S11 (+S06 scenarios) (split 1 of 2)
- **Goal:** two-way governor, `MemoryBudget` enforcement, `FramePacer`, nightly `check:perf -- --fail` required, `race-sprint` and `race-pursuit-heat4`, route 4 crash reports emitted as C16 1.2 `app.crash` (DL-224).
- **R** R-PLAT-03/05, R-ENG-02 · **Dep** M02b1, M03b1, M07a2, M04b5 (AC-11 enables the frame-cap row and proves the render-scale pin, DL-727) · **Read** `11-platform.md` §4.5, §5; `11-platform-perf.md` §5, §9 · **Out** `packages/engine/src/platform/{governor,memory}`, `config/perf/paths` · **C** C13 1.1, C12 1.1 (route 4), C16 1.2 (`app.crash`)
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/src/platform` (governor, memory budget, frame pacer specs); `pnpm check:perf -- --fail`; `pnpm check:perf -- --scenario race-sprint`

### M11a2 · iphone-hardening-governor — 1 · risk H · S11 (split 2 of 2)
- **Goal:** offline relaunch, safe-point SW updates, abnormal-exit demotion (completing M01c's part), iOS quirk pass, desktop-ultra calibration, 30-minute soak and the M11a2 device passes.
- **R** R-PLAT-01/05, R-ENG-02 · **Dep** M11a1 · **Read** `11-platform-pwa.md` §4, §6, §9–§10 · **Out** `apps/web/src/sw.ts`, `packages/engine/src/platform/telemetry/heartbeat.ts` (M01c), `tools/ci/checklists/M11a2-*.json` · **C** C13 1.1, C16 1.1
- **Gate** Q-13 devices · **Proof** `offline-relaunch.spec.ts` via `pnpm check:e2e -- --project=webkit-webgl2 --grep @offline-relaunch`; manual `M11a2-{iphone15,iphone16,mac}` then `pnpm perf:verify`

### M11b1 · webxr-port — 1 · risk H · S11
- **Goal:** XR session and renderer swap, locomotion, comfort, XR input, panel base, IWER e2e, `xr-walk`.
- **R** R-PLAT-02, R-ENG-04 · **Dep** M01c, M04b2, M11a1 (governor XR rule), M02h8 (the `xr` look profile and multiview check; shared XR render files, DL-741) · **Read** `11-platform-xr.md` §2–§5 · **Out** `packages/engine/src/platform/xr` · **C** C13 1.1 (`XrPanels`, `XrComfortSettings`), C04 1.1
- **Gate** Q-13 devices · **Proof** `pnpm check:e2e:xr` (session, input routing, comfort); `pnpm check:unit -- packages/engine/src/platform` (gesture rule); manual `M11b1-{quest3,visionpro}`

### M11b3 · xr-ui-panels-comfort — 0.8 · risk M · S10
- **Goal:** `UiSurface` on Quest layers and Vision Pro planes, Enter/Exit VR button, wrist panel, comfort settings in XR, the NPC dialogue bubble, flat-only text entry (DL-142).
- **R** R-PLAT-02, R-UI-02, R-ENG-04, R-NPC-05 · **Dep** M11b1, M06a5 (XR dialogue bubble), M04e1, M04e4 (new Sandbox `ScreenDef` tabs, DL-716) · **Read** `10-ui-hud-xr.md` §2, §6 · **Out** `packages/ui/src/xr` · **C** C13 1.1 (`XrPanels`)
- **Gate** none · **Proof** `pnpm check:e2e:xr` (Enter VR calls `enter()` synchronously in the click handler)

### M11b2 · per-mode-xr-and-xr-cutscenes — 0.7 · risk M · S11, S06, S07, S10 (split 1 of 2)
- **Goal:** racing XR (driving rules, hands wheel, vignette, diorama chase) and fighter XR (FX10) with their panels; XR cutscenes play the in-engine fallback until M11b4 (DL-229).
- **R** R-PLAT-02, R-MODE-02/03 · **Dep** M11b1, M07b2, M08b2, M11b3 (in-headset panels) · **Read** `11-platform-xr.md` §5.3; `06-racing.md` §6; `07-fighter-content.md` FX10 · **Out** `packages/modes/{racing,fighter}/src/xr` · **C** C03 1.1 (`xr:both:wheel`), C04 1.1 (`vantage`)
- **Gate** none · **Proof** `pnpm check:e2e:xr` (racing and fighter `@xr` specs)

### M11b4 · per-mode-xr-and-xr-cutscenes — 0.7 · risk M · S11, S08, S03 (split 2 of 2, new digit)
- **Goal:** tycoon XR desk and pitch card, XR cutscene hosts for story and fighter clips (`XrMediaHost`, fixed vantage, subtitle plane), per-mode Quest and Vision Pro checklists (incl. the S10 XR UI rows of `10-ui-hud-xr.md` §9) and perf pass (DL-229).
- **R** R-PLAT-02, R-CUT-03, R-MODE-04 · **Dep** M11b2, M09b1, M05b2 · **Read** `11-platform-xr.md` §5.3, §9; `03-story-cutscenes.md` §D7 · **Out** `packages/modes/tycoon/src/xr`, `packages/engine/src/client/cutscene/xr` (player), `packages/modes/story/src/cutscene/xr` (triggers) · **C** C09 1.0, C13 1.1 (`XrMediaHost`)
- **Gate** Q-13 devices · **Proof** `pnpm check:e2e:xr` (`@tycoon-xr`, XR cutscene fallback); manual `M11b4-{quest3,visionpro}` per-mode rows (15 s clip with subtitles) then `pnpm perf:verify`

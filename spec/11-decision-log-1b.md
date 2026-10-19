# 11 — Decision log, part 1b (living, dated)

> Moved unchanged from `spec/11-decision-log.md` for the 6,000-word cap (DL-341): DL-077…DL-170 and the owner decisions after Wave 4. Citations of `spec/11-decision-log.md` for these ids resolve here.

## 2026-10-18 — Waves 2–4 contract reconciliation (Architect, second reconciliation)

Inputs: the Wave 2–4 specs and `spec/.waves234-returns.json`. Result: 06 **v1.1** (all 17 contracts final), `spec/02-architecture.md` v0.5, register in `spec/00-plan.md`. No breaking change, so no major bump.

### A. Wave 2/4-owned contracts finalized (C08, C09, C10, C14, C17)

| ID | Topic | Decision | Reason |
|---|---|---|---|
| DL-077 | Id types redeclared by C09, C10, S06 | C08 owns `LatLng`, `ChunkKey`, `LandmarkId`, `PoiId`, `DistrictId`; C10 `NpcId`; C14 `ModId`. C09 uses `LatLngTuple`, `MissionDistrictId`; S06 `RacePoint`, lower-case districts | same name, different shape is a defect |
| DL-078 | C08 `SimChunk` vs C01 `StaticShapeSet`; S03 `WorldResolver` | pure `toStaticShapeSet`; S03 imports C08 `WorldResolver` | gap; consumer adapts |
| DL-079 | C08 finalization | `chunkKeyOf`; landmarks in `LandmarkLayer` (P3); `WorldApi` = `ModeContext.world` (P1) | anchors; budget |
| DL-080 | `MissionId` `{1,40}` vs 41-char `ModId` in `m.mod.<modId>.<name>` | pattern `{1,80}` | mod mission ids were invalid |
| DL-081 | Mixed fight-intro sequences (S07) | C09 `playSequence(playId, items[{ref \| null, fallback}])`; C06 1.1 `UiCommand 'cutscene.state'` with `item?` replaces `mode.cmd 'cut.state'` | gap; one protocol |
| DL-082 | C09 manifest | `a.m4a` optional (engine audio), `shots[]`, `licence.uiCredit` | generated audio off by default |
| DL-083 | Tier in the cache key (S04 proposed `fictionalized` for original souls) | C09 owner wins: key and asset tier = C10 `assetTier()` (`original` for original basis) | one mapping |
| DL-084 | C09 `mod` profile | rejects `give`, `rewards`, `unlocks`, story flags, `mode` hooks; ≤ 8 missions (C14) | `exp:` writes only `mod:<id>` |
| DL-085 | Mission talk (S03) | C10 wins: `missionStep = talkId`, normal intents, gates via `offers.dealIds`; knot `mission_<missionId>_<talkId>` (`.`/`-` → `_`); `effects.outcome` rejected | the player decides |
| DL-086 | Mode intents (S07, S08) | C10 `PlayerIntent` adds `pitch`, `answer`, `ask_more`, `counter`, `close` (mode `tycoon`) and `fight_pre`, `fight_post` (mode `fighter`) | prompts need the move |
| DL-087 | Tycoon offers (S08) | `context.tycoon` = bands + sim-computed `deals[≤3]`; `offer_deal` picks one | D-21 |
| DL-088 | UGC cameos (S12) | `CompiledSoulPublic.ugcCameo`, default false for `parody` | static policy belongs to the soul |
| DL-089 | C14 `compat.world` "sf@2026"; `uses.npcs` pattern | `compat.world` = C08 bakeIds or ≥ 12-hex prefixes; `uses.npcs` = C10 `NpcId` pattern | align to owners |
| DL-090 | C17 (S12 proposed 1.1; S10 needs neighbourhood) | C17 final at 1.0.0 with `worldVersion?` (bakeId), `modSha256?`, `anchor.chunkKey: ChunkKey`, `ExperienceCard.nhood` | nothing was frozen yet |
| DL-091 | `AnimStateId` 128–255 | 128–159 racing, 160–207 fighter (S07 frame-locked clip player), 208–255 tycoon (224–231 claimed); C04 1.1 | DL-012 reserve, no overlap |
| DL-092 | Hook def ids, board ids | mode owner owns `ModeHook.defId` (`RaceId`, `bout.<id>`, `mini8w`); boards `<mode>.<…>`; route 21 validator registry by prefix | owner of the def space |
| DL-093 | Camera CSP (S07: app + `media.` only) | `connect-src 'self'` + `BootConfig.hosts` origins; `Permissions-Policy: camera=(self)` | S07's list blocked rooms and UGC |

### B. Proposals against Wave 1 contracts (shapes in the owner specs; index in 06 v1.1 §4.2)

| ID | Contract | Decision |
|---|---|---|
| DL-094 | C02 → 1.1 | rule 3: stateless `ctrU32(seed, stream, counter)` allowed (S08) — `01-engine-contracts.md` (end) |
| DL-095 | C03 → 1.1 | `'bot'` device + QA `BotInput` (S03); `xr:both:wheel` (S06); `setPoseHybrid`, alias table, `fighterScheme?` (S07) — same file |
| DL-096 | C04 → 1.1 | `XRRigParams.vantage?` (S03), origin `'diorama'` (S06), DL-091 — same file |
| DL-097 | C05 → 1.1 | `SaveReason 'checkpoint'`, `ProfileSettings.cutscenes?` (S03), `npc?` (S04); rule 3 `exp:` writes only its mod slot (S12); avatar schema S10 — `01-engine-save-modes.md` (end) |
| DL-098 | C06 → 1.1 | `ui-bridge.ts`; `GameModeUI` extras; `ModeContext.world`, `.npc`; `standaloneProfile?`; `modSurface?`; `configRef?`, `setRouteHint`; `TimelineRecorder.external`; `weekdayOf`; Story↔`exp:` switch — same file |
| DL-099 | C07 → 1.1 | `05-assets-pipeline.md` §14 |
| DL-100 | C11 stays 1.0 | speed-cap rows are config (S06); `ActKind.FightInput` deferred |
| DL-101 | C12 → 1.1 | `09-backend-contracts-1.1.md` §1–3 |
| DL-102 | C13 → 1.1 | `11-platform-pwa.md` §11 |
| DL-103 | C16 → 1.1 | `09-backend-contracts-1.1.md` §4 |
| DL-104 | Deferred / rejected | Deferred: sloped strips (after M02a2), batch route, wheel readout (C06 1.2 at M03a2), `FightInput` (post-M12b ADR), `modsUi` (ADR), root `AGENTS.md` size (S13). Rejected: `effects.outcome`, `effects.offer`, JSON `action_arg` |


### C. Wave 2–4 `decisions_needed`, settled

| ID | DN | Decision |
|---|---|---|
| DL-105 | DN-S02-01 | landmarks from code recipes (M02d1–d2), Blender pass at the same AssetIds after M05c |
| DL-106 | DN-S02-02 | fictional transit operators, factual station names (counsel check in Q-23) |
| DL-107 | DN-S02-03 | no NAIP/USGS colour sampling (licence UNVERIFIED) |
| DL-108 | DN-S02-04 | carved tunnels with hoods; open cuts or teleport pairs if M02a2 drive tests fail |
| DL-109 | DN-S02-05 | no batch-range route in v1 |
| DL-110 | DN-S02-06 | `ModeContext.world` in C06 1.1 before M03b1 |
| DL-111 | DN-S02-07 | lower-case `d1…d10` everywhere |
| DL-112 | DN-S02-08 | minimap heading-up with north-up toggle, no fog of war, hillshade on |
| DL-113 | DN-S03-01 | tycoon unlock in the Act 2 opener `m.a2.01` |
| DL-114 | DN-S03-02 | generated clips: fictional cast only (fighters via S07 hooks) |
| DL-115 | DN-S03-03 | M05e1/e2 (after M07a2, M08b2, M09b2), M05f1/f2 (after M05e2, M10b) |
| DL-116 | DN-S03-04 | story dialogue in-engine; clips default to engine audio |
| DL-117 | DN-S03-06 | scripts `missions:build`, `missions:preview`, `check:missions`, `assets:plates`, `assets:cutscene-index` |
| DL-118 | DN-S04-01 | real-derived souls, research layer and production rails in private `content-private/` (repo creation: Q-25) |
| DL-119 | DN-S04-03 | P0/P1 text soul generation allowed via `builder_text` (2/day, 1 per draft per hour, private); fal builder jobs stay linked + 18+ (D-30 covers media generation) |
| DL-120 | DN-S04-04 | route 52 in M06a4 |
| DL-121 | DN-S06-01 | `standaloneProfile`; menu racing runs `canonical` |
| DL-122 | DN-S06-03 | plausibility-only leaderboards (`verified:false`); re-sim verifier after M12c |
| DL-123 | DN-S06-04 | Vision Pro without hands: racing shows "hands or controller required" |
| DL-124 | DN-S06-05 | sideshow and drift stay (Q-06), `xr: 'none'` |
| DL-125 | DN-S06-06 | separate racing purse and Rep; shared garage |
| DL-126 | S07-D2 | roster stays 8 (Q-14); two more original kits may follow the M08b1 balance run |
| DL-127 | S07-D3 | pose calibration device-local, deletable, never synced (counsel: Q-23) |
| DL-128 | S07-D4 | hybrid pose accepted (C03 1.1) before M08c2 |
| DL-129 | S07-D5 | in-fight cinematics default `first`; off in Training and online |
| DL-130 | S07-D6 | DL-091 blocks; fighter components 1280–1283 used |
| DL-131 | DN-S08-01 | D-21: Haiku default, Sonnet for the 2 hero VCs; engine decides terms |
| DL-132 | DN-S08-02 | pure tycoon core and event engine in `packages/shared/src/{tycoon,events}` |
| DL-133 | DN-S08-03 | story businesses wire `EventHost<BusinessState>` in M05e1 |
| DL-134 | DN-S08-04 | dividend counter in the tycoon slice, claimed via `StorySlice.flags`, $10,000/week cap |
| DL-135 | DN-S08-05 | ramen-profitable win needs ARR ≥ $1M (tunable) |
| DL-136 | DN-S08-06 | route 21 validator registry (DL-092) |
| DL-137 | DN-S08-07 | M09a1, M09a2, M09b1, M09b2 |
| DL-138 | Q-S08-01 | hardware/mobility political events ship disabled |
| DL-139 | DN-S10-01 | **every under-18 bracket blocked in v1** (D-30); `AgeBracket` kept for a later `TEEN_MODE` with no migration; resolves U-TYC-5 |
| DL-140 | DN-S10-02 | telemetry toggles default **on**, first-run card, one-tap off, device-scoped, US-only v1; revisit before EU/UK; counsel at M14b (Q-23) |
| DL-141 | DN-S10-03 | **New Game = new save profile**; `story:1…3` stay manual slots |
| DL-142 | DN-S10-04 | **XR text entry flat-only** ("Exit VR to continue") |
| DL-143 | DN-S10-05 | menu-scene slot accepted (C13 1.1) |
| DL-144 | DN-S10-06 | no per-knob graphics overrides in v1 |
| DL-145 | DN-S12-01 | before M14a, `linked` via `openai` (flag on) else `supabase-oauth` GitHub; ADR in Wave 5; UNVERIFIED until M13c1 |
| DL-146 | DN-S12-02 | UI tier: L2 panels first, L0 after the M13a5 matrix, no second domain, `mods.ui` off until recorded |
| DL-147 | DN-S12-03 | script tier on `mobile-low` only after the M13a4 iPhone spike passes |
| DL-148 | DN-S12-05 | flow B deferred behind an ADR; flow A supported |
| DL-149 | DN-S12-06 | experiences playable where server `tiersOk` includes the tier |
| DL-150 | DN-S12-07 | parody cameos off by default (DL-088) |
| DL-151 | DN-S12-08 | `ugc.publish` false in production until M13d1 ACs pass |
| DL-152 | DN-S12-09 | `mod.worker` = third lazy worker (D-08 amended in `spec/02-architecture.md`) |
| DL-153 | DN-S12-10 | data-tier creator place mode (M13b3) for players without an agent |
| DL-154 | DN-S12-11 | Story → experience is a mode switch with autosave and restore |

### D. Moved to the owner (`spec/99-open-questions.md`)
DN-S04-02 → **Q-20** (voice ceiling) · DN-S03-05 → **Q-21** (sensitivity read) · DN-S12-04 → **Q-22** (npm publication and licence) · DN-S06-02, Q-S07-2 and the counsel parts of DL-106, DL-127, DL-140 and the tycoon disclaimer → **Q-23** (counsel list) · S07-D1 → **Q-24** (animation staffing) · DN-S04-01 repo creation → **Q-25** (private content repo).

### E. Register and version
| ID | Decision |
|---|---|
| DL-155 | Register rebuilt in `spec/00-plan.md` from every Wave 2–4 proposal (DL-037). Above one session (Wave 5 splits): M01a, M01b, M04a, M10a, M11a, M11b2, M12b, M12c, M14b, M15a/b/c/e/f/g |
| DL-156 | 06 → **v1.1**, frozen: C01, C08–C11, C14, C15, C17 at 1.0; C02–C07, C12, C13, C16 at 1.1. A-01 adds `tools/soul`, `tools/fighter`, `content-private/`. Wave 5 may not change a contract shape |


## Owner decisions after Wave 4 (2026-10-18)
- **DL-OWN-01 (2026-10-18) fal.ai hard cap USD 100 total.** Owner instruction: "budget for fal shouldn't exceed $100". Replaces G3's $1,000 one-off. Allocation: M00c spike ≤ $10; M10a roster ≤ $42 (≤ 8 Standard hero fighters, ≤ 12 Lean characters; everyone else uses creator-kit bodies or stand-ins); cutscenes ≤ $40 (prioritize fighter intros/finishers and Act 1 beats; all other hooks use the in-engine director fallback, which R-CUT-03 already requires); buffer $8. Enforcement: BudgetGovernorDO `budget_program` cap 100,000,000 USD micros (fal and any other genAI production spend), fal prepaid balance ≤ $100 with auto-recharge off, `FAL_MODE=mock` default, paid jobs require `--live` and print a dry-run estimate, CI never runs live fal. Consequence: R-NPC-03 user NPCs get custom fal 3D only through an owner-approved queue counted against the cap; default user NPCs use creator-kit bodies. Affects spec/domains/05-assets*.md (costs, runbook), 03-story-cutscenes.md (prewarm counts), 04-npc*.md (builder), 07-fighter*.md (clip counts), spec/10-cost-model.md, M00c, M05b, M06b, M10a. Wave 5 authors apply it; where a domain spec states a larger fal budget, this entry wins.
- **DL-OWN-02 (2026-10-18) New Cloudflare resources.** Owner authorized new Workers/resources. Created R2 `tha-bay-media-{staging,prod}`, `tha-bay-private-{staging,prod}` and KV `tha-bay-flags-{staging,prod}` (ids in `config/cloudflare.resources.json`); UGC/evidence buckets, queues and Workers are created by the milestones that need them. Deploys need CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (not present in the build environment as of this entry).

## 2026-10-18 — Waves 2–4 consistency-check corrections (Architect)

Input: fresh-context checker verdict `fail` on the Waves 2–4 reconciliation (1 blocking, 20 major). `prompt-pack/06-SHARED-CONTEXT.md` stays **v1.1**: the rows below correct defects and add no contract shape (DL-156 rule). `spec/03-decisions-and-facts.md` moves to v1.1 for the A-01 and D-24 text.

| ID | Topic | Problem | Decision | Files changed |
|---|---|---|---|---|
| DL-157 | Story ↔ mode hook interface (blocking) | S03 hook defIds and params (`race.a1.*`, `fight.a*.*`, `tycoon.a*.*`, `{raceId}`, `{opponent, stage, rounds, difficulty, playerFighter}`, `{scenarioId, weeks}`) disagreed with the def owners (DL-092); S06/S07 used research mission numbers A3/A5/A7/A8/A11; no S08 board-vote run or `coop_success` result; M09b2 named the hook `tycoon.mini8w` | S03 §C8 item 4 points to the owner types: racing `defId` = `RaceId`, no params; fighter `defId` = `bout.<id>`, `params` = S07 `FighterEnterParams {kind:'story'}` (opponent, stage, CPU level and rules from the `BoutDef`); tycoon `defId` = `RunSetup.preset` `mini8w`, no params. §B4/§B6 hook cells read (`ModeHook.id`, owner defId): `m.a1.03` → `sf.pursuit.bayview-escape`, `m.a1.05` → `bout.a5` (CPU Normal), `m.a2.01` → `mini8w`, `m.a2.02` → `sf.hillclimb.filbert-hyde`, `m.a2.03` → `sf.robotaxirush.soma-haight`, `m.a2.08` → `bout.a11`, `m.a3.03` → `sf.speedtrap.great-highway-night`, `m.a3.04` → new S07 `bout.a3-final` (`mission_bay_court`, `RAP_LYRICIST`, Hard, M08b2). S06/S07 cite S03 mission ids (S03 owns missions). `mini8w` is the only story preset: `coop_success` is a story flag set in `m.a2.01` from the run's `win`; `m.a3.01` board vote becomes a talk chain (no S08 preset in v1). The roadster unlock becomes S06's `unlock.racing.event.sf.hillclimb.filbert-hyde`; `m.a2.03` emits S06's `unlock.racing.robotaxi` | 03-story-missions §C8; 03-story-narrative §B4, §B6, §B7; 03-story §10 A-HOOK-1; 06-racing §1, §2.13, M07a, A-S06-4; 06-racing-content C.5; 06-racing-data §4.4; 07-fighter-content FX5 stages, FX8.2–3; 07-fighter M08b2, AC-4; 08-tycoon §5.11, M09b2 |
| DL-158 | C03 1.0 `ControlsSettings` | 1.0 block declared required `fighterScheme`, 1.1 added it as optional | removed from the 1.0 block; only the optional 1.1 member remains (DL-095) | 01-engine-contracts §C03 |
| DL-159 | Photo shutter input | `sim.Camera` does not exist; `Camera`/`PhotoShutter` are `ClientAction`s | the `photo` input context's shutter is `sim.Interact` (clarifying text in C03 1.1, no new bit); `client.PhotoShutter` stays the UI screenshot action | 01-engine-contracts (1.1 section); 03-story §6; 03-story-missions §C9 |
| DL-160 | `cut.request` encoding | numeric `SimEvent.n` vs string `playId`; no ref separator | `n` = u32 play counter; `playId = String(n)`; `s` = ref ids comma-joined, empty field for a null sequence item | 03-story-cutscenes §D7; 10-ui §3.3 comment |
| DL-161 | C07 provenance fields | `parents` (no such field); IR origin `first_party_authored`, plate origin `first_party_generated` (GenJob `InputFile.origin` values) | `world_pack`/`map_data` records: `origin 'derived'`, `tool`, `derived_from` = `SourceStamp.sha256`s, each stamp an `open_data` record; mission IR `origin 'authored'`; plate records `origin 'derived'` (tool `assets:plates`); `InputFile.origin` for plates unchanged | 05-assets-pipeline §14; 02-world-bake §5; 03-story-missions §C1; 03-story-cutscenes §D5 |
| DL-162 | Consumer type precision | `talk.result.path` lacked `'scripted'`; C09 comment named "C08 LatLngTuple"; `livery/` is not a C07 kind; C10 and `WorldResolver.landmark` typed `chunkKey: string`; C14 `heat` 0..5 and weather `string` | union `'llm' \| 'ink' \| 'scripted'`; comment → C08 `LatLng`; livery `texture/<id>`; `ChunkKey`, `HeatLevel`, `WeatherPreset` imported from their owners (06 §4.1 rule 4) | 03-story-missions §C3, §C7; 06-racing-data §4.1; 04-npc-contracts; 02-world-contracts §3; 12-modding-contracts B§3 |
| DL-163 | Roster slot type | S07 `SlotId` collided with C05 `SlotId`; S03 named the same concept `RosterSlot` | one type: C09 `RosterSlot`; S07 `FighterSlotId = RosterSlot \| 'PLAYER_FIGHTER'` | 07-fighter-core FC2 and uses; 07-fighter-content FX1, FX8; 03-story-missions §C3 comment |
| DL-164 | Pose model and cache | S07 defaults desktop to `full`; D-24 and 02 said lite only; no `/pose/` runtime route | D-24 amended (spec/03 v1.1): lite on mobile, full on desktop when within budget; 02 §1/§3.1 aligned; `/pose/` `CacheFirst` runtime route, never precached | spec/03 D-24; 02-architecture §1, §3.1; 11-platform-pwa §4 |
| DL-165 | A-01 and layout paths | A-01 row lacked the DL-156 additions; `examples/`, `reports/`, `knowledge/` outside every layout; `@dv/ci` fallback | A-01 row cites DL-156 (spec/03 v1.1); mod examples → `packages/mod-sdk/examples/mods/`; reports → `tests/reports/` (CI artifacts); `knowledge/` marked as a creator-workspace path; `@dv/ci` fallback dropped (`check:balance` is in 06 §5) | spec/03 header, A-01; 02-architecture §2; 03-story-missions §C12; 12-modding-publish C§1; 04-npc §9; 04-npc-builder §C6; 08-tycoon-events §8 |
| DL-166 | C16 `tier` prop | `world.stream`, `racing.start`, `racing.photo` carried `tier` although C16 1.1 takes it from the envelope | `tier` props removed; no exception | 02-world §5.7; 06-racing-data §4.5 |
| DL-167 | Mode descriptors, economy note | fighter and tycoon both `tile.order: 3`; `ui/mode-fighter` vs `ui/mode-tile-tycoon`; A-S06-7 said a standalone mode has no `EconomyApi` | C06 descriptor comment fixes orders story 1, racing 2, fighter 3, tycoon 4, mods ≥ 100 and art `ui/mode-<GameModeId>`; tycoon → `ui/mode-tycoon`, order 4; A-S06-7: `economy` is always present, but standalone sessions cannot write `StorySlice.wallet`, so racing keeps `purseCents` | 01-engine-save-modes §C06; 08-tycoon §3.1; 06-racing §10 |
| DL-168 | Settings page | `?devmod=` URL flag and `UiPrefs.developer` against C13 1.1 `PlatformSettings.dev`; no controls for C05 1.1 `npc` and `cutscenes` | Developer options bound to `PlatformSettings.dev.mod {enabled, port}`, `UiPrefs.developer` removed; rows "NPC voices and AI dialogue" (`npc.*`) and "Cutscenes" (`cutscenes.*`), profile scope | 10-ui-pages §2.9, §4.3 |
| DL-169 | Stale headers, pointers, consumer lists | C12/C16/C13 headings at 1.0.0; Wave 2–4 headers at "06 v1.0 (frozen)" or "sketch"; `PlayerQuota.reserve` and EncounterDO key without 1.1 pointers; C03/C04 consumer lists differ from 06 §4.2; 01-engine §2.2 put NetIn/NetOut on the main thread; 06 C13 row omitted `11-platform-perf.md` §4 | headers → 06 v1.1, spec/03 v1.1 and current versions; `builder_text` and `enc:<pid>:<npcId>:<encounterId>` inline with 1.1 pointers; consumer lists = 06 §4.2; §2.2 reworded per DL-071; 06 C13 row adds `11-platform-perf.md` §4 (correction, no shape change) | 09-backend*, 11-platform §4, 05-assets §4.2, 01-engine §1, §2.2, 01-engine-contracts §C03/§C04 headers, 02-world, 03-story, 04-npc, 06-racing, 07-fighter*, 08-tycoon*, 10-ui, 12-modding headers; 06 §4.2 |
| DL-170 | Remaining stale cross-references | `npc_draft` report until `npc_soul`; S12 cited old S03 op names; DN-S03-03 schedule; `data/anchor-mask-v1` | report target `npc_soul` (C12 1.1); S12 cites the C09 `mod` profile (DL-084); DN-S03-03 cites DL-115; AssetId `data/anchor-mask.v1` (file `anchor-mask.v1.bin`) | 04-npc-builder §C5.5; 12-modding §5.3; 03-story §10; 02-world-maps §1; 02-world-bake §5 |

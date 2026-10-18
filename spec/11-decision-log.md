# 11 — Decision log (living, dated)

> **Continued in `spec/11-decision-log-2.md` (DL-171 onward).** This file is at its size cap.

## Index by topic
Entries below are unchanged; this index only finds them. DL-171 onward is in `spec/11-decision-log-2.md` (blocks by author and date). ADRs: `docs/decisions/README.md`.

| Topic | Entries |
|---|---|
| Layout, scripts, ids, versions | DL-009, 035–038, 050, 054–056, 074–077, 117, 132, 155, 156, 165, 169, 170 |
| Engine, sim, determinism, input, saves (C01–C06) | DL-002, 004–008, 029–031, 033, 057, 058, 066, 069–071, 094–098, 158, 159, 167; D-S01-01…07 |
| Platform, tiers, PWA, XR, telemetry (C13, C16) | DL-001, 003, 024–028, 032, 034, 042, 064, 065, 102, 103, 142–144, 164, 166, 168; DN-S11-01…07 |
| Assets, genAI, provenance (C07) | DL-016–021, 023, 039–041, 053, 059, 061, 067, 068, 072, 073, 099, 161; DN-S05; DL-OWN-01; part 2: DL-171–181, 202 |
| Backend, API, identity, data (C11, C12) | DL-005, 014, 015, 021, 043, 044, 060, 062, 063, 075, 100, 101, 145, 148, 151; Q-BE; part 2: DL-182–199 |
| Netcode and rooms | DL-010, 011, 013, 052, 071, 122; part 2: DL-183–188, 204 |
| World and maps (C08) | DL-049, 077–079, 105–112, 162; part 2: DL-201 |
| Story, missions, cutscenes (C09) | DL-045, 051, 061, 072, 073, 080–085, 113–117, 157, 159–161, 163 |
| NPCs, souls, dialogue (C10) | DL-022, 046, 083, 085–088, 118–120, 131 |
| Racing, fighter, tycoon | racing DL-121–125; fighter DL-081, 126–130, 163, 164; tycoon DL-087, 131–138 |
| UI, audience, privacy | DL-119, 139–144, 167, 168; part 2: DL-196, 205 |
| Modding and UGC (C14, C17) | DL-047, 048, 084, 088–090, 098, 145–154; part 2: DL-207 |
| Owner decisions and cost | DL-OWN-01, DL-OWN-02, DL-139, 140; part 2: DL-171–181 |
| Animation ids and workers | DL-012, 091, 152; part 2: DL-203 |
| ADR set and facts per milestone | part 2: DL-200–207 |

> Every contract change, conflict resolution and settled open decision, newest block last. Rule (master prompt `<orchestration>`): the contract owner wins unless the dissent exposes a real defect; then the owner's spec is fixed too. Decisions that are the owner's call go to `spec/99-open-questions.md` instead. ADRs (`docs/decisions/`) are written in Wave 5 and cite these entries.

## 2026-10-18 — Wave 1 contract reconciliation (Architect)

Inputs: `spec/domains/01-engine*.md` (S01), `05-assets*.md` (S05), `09-backend*.md` (S09), `11-platform*.md` (S11), `spec/.wave1-returns.json`. Result: `prompt-pack/06-SHARED-CONTEXT.md` v1.0 (frozen), `spec/02-architecture.md` v0.

### A. Conflicts resolved

| ID | Topic | Between | Decision | Reason | Files changed |
|---|---|---|---|---|---|
| DL-001 | C13 tier names | S11 (owner) vs S01 `QualityTierRef` (`xr-standalone`, `xr-pro`, `level`) and S09 telemetry tier enum | Six ids `desktop-ultra`, `desktop`, `mobile`, `mobile-low`, `xr-quest`, `xr-visionpro` everywhere; `level` retired | owner wins; no defect | 01-engine-contracts §C02; 01-engine §6; 09-backend-contracts §3 |
| DL-002 | AI update rate per tier | S11 table (`aiHz` 60 on desktop/XR) vs C02 `AI_DIVISOR` 2 (S01, owner of C02) | AI runs at 30 Hz on every tier; `SimLimits.aiHz` is the literal 30 | C02 owner wins, and S11's value was a defect: tier-dependent AI rates break the cross-tier ambient prefix rule (C01 rule 5) and DO-seeded shared traffic | 11-platform §4.2, §4.5 |
| DL-003 | XR physics radius | S01 proposal (Vision Pro 200 m) vs S11 (300 m†) | C13 values: Quest 150 m, Vision Pro 300 m (calibrate M11a) | C13 owner wins | 01-engine §6 |
| DL-004 | Engine tier knobs (anim bands, audio voices, ragdoll caps) | S01 asked C13 to carry them | They stay engine config, `config/engine-tiers.json` keyed by `QualityTierId`; physics radius and crowd caps come from C13 | keeps C13 a render/budget contract; no consumer other than the engine needs them | 01-engine §4, §6 |
| DL-005 | Cloud-save data model | S09 (`ns` story\|sandbox, slots `auto\|quick\|s01–s10`, SaveGame blob, SHA-256 checksum, 8 MiB) vs C05 owner S01 (`SlotId` model, one `SaveRecord` per slot, fnv1a64, 2 MiB) | C05 wins: the sync unit is one `SaveRecord` per C05 `SlotId`; routes use `:saveProfileId/:slot`; `save_records` keyed by `slot`; the Worker computes its own SHA-256; bytes ≤ 2 MiB | S09's model could not sync `core`, `settings`, `mode:*` or `mod:*` slots (defect in the consumer, not the owner) | 09-backend-contracts §2.4, §2.5; 09-backend-db §3.5; 09-backend §1, §3.5 |
| DL-006 | Local save store | S09 `IdbSaveStore` in `packages/shared/src/save-store.ts` vs S01 `SaveService` (`packages/engine/src/sim/save/`, IndexedDB `dv-saves`) | One store: S01 `SaveService` (M04a). S09 supplies only the `CloudSync` port (`packages/net/src/cloud-sync.ts`: `NullCloudSync` M04b, `HttpCloudSync` M12a) | owner wins; a second store would split atomicity, and IO cannot live in `packages/shared` (DL-009) | 09-backend §3.5, §8, §7 |
| DL-007 | Save conflict copies | S09 renamed local slot `slot~conflict-<ts>` (not a valid `SlotId`) | 409 copies go to a `conflicts` store in `dv-saves`; the player picks (C05 rule 10) | keep the slot grammar closed | 01-engine-save-modes §C05; 09-backend-contracts §2.5 |
| DL-008 | Determinism lint vs save IO | S01 internal: `SaveService` (needs `Date.now`, `crypto.getRandomValues`) sits under the banned `sim/**` scope | C02 rule 1 exempts `packages/engine/src/sim/save/**`; systems reach it only via `ModeContext.save.request` | real defect in the owner's spec; fixed there | 01-engine-contracts §C02 |
| DL-009 | `packages/shared` purity | S05 genAI helpers, S09 save store, S11 C13 loader vs C02 lint covering `packages/shared/**` | `packages/shared` stays pure (types, constants, pure functions); genAI helpers take parsed JSON and use the single `canonicalize`; IO lives in engine/net/identity/services/tools | sim code imports `@dv/shared`, so it must stay deterministic | 05-assets §3; 06 §5 |
| DL-010 | IN `buttons` width | S01 proposed u32 vs C11 owner S09 u16 | Keep u16 (bits 0–15 = net set); bits ≥ 16 (Respray, Emote, PhoneQuick) never travel in `IN`, rooms use `ACT` | owner wins; validated authority does not simulate inputs, so no defect; saves 2 B × 20 Hz and keeps the 12 B sample | 01-engine-contracts §C03; 09-backend-contracts §1.4 |
| DL-011 | Brake quantization | S09 u8 0..255 vs C03 `InputFrame.brake` 0..127 | Wire `brake` is u8 carrying the C03 value 0..127 | real defect: prediction replay needs identical quantization on both sides | 09-backend-contracts §1.4; 01-engine §2.13 |
| DL-012 | SNAP `anim` registry | S09 assumed a u8 `AnimStateId` registry S01 had not defined | `AnimStateId` (u8) added to C04 service types; 0–22 engine states, 23–127 S01 reserve, 128–255 mode blocks by ADR | gap in the owner's spec | 01-engine-contracts (engine service interfaces) |
| DL-013 | Mobile send rate vs `NET_DIVISOR` | S09 mobile 10 Hz × 2 samples vs C02 rule 6 (20 Hz) | Samples are produced at 20 Hz; desktop/XR send each, mobile batches two per frame | wording gap only | 01-engine-contracts §C02 rule 6 |
| DL-014 | C11 version | S09 `C11_VERSION` 2.0.0 vs freeze at 1.0 | Contract 1.0.0; wire `PROTOCOL_VERSION` stays 2 | one version scheme across 06 | 09-backend-contracts §1; 09-backend header |
| DL-015 | `EV World.weather` type | S09 `string` vs S01 `WeatherPreset` | `WeatherPreset` | type precision | 09-backend-contracts §1.5 |
| DL-016 | Asset addressing (C07) | 06 v0.95 sketch (`url`, `hash`, unhashed keys, `characters/{sheet,model,rig}`), S09 R2 table (`world/packs`, `manifests/world-*`, `BootConfig.worldManifest`), S11 `PackRef.hash` vs owner S05 | S05 wins: content-hashed `<root>/<variant>.<sha256[0:12]>.<ext>`, `key` + `sha256`, one catalog `manifests/assets-<sha256>.json` + `/asset-catalog.json` pointer, world packs = C07 kind `world_pack`, sheets private; `BootConfig.assetCatalog` | owner wins; immutable caching and prefix purge need it | 09-backend-db §4; 09-backend-contracts §2.5; 11-platform-pwa §5 |
| DL-017 | Canonical skeleton | S01 `dv-humanoid-v1` vs S05 `bay_rig_v1` (C07 `rigFamily`) | Id `bay_rig_v1`; canonical bone names are S01's 22 `HUMANOID_BONES`; S05 owns the vendor alias table; retarget `hip: 'hips'` | one skeleton id across runtime and pipeline; C07 already types it | 01-engine §2.8; 01-engine-contracts; 05-assets-pipeline §4 |
| DL-018 | GenAI job types | S09 `GenJob`/`FalProvider`/`GenStage` vs S05 `GenJob`/`FalPort`/`Step` | S05 types are canonical (part of C07); S09 hosts and binds them; `MockFalPort` | the pipeline owner owns its types; two `GenJob`s would diverge | 09-backend §3.3, §8 |
| DL-019 | GenJobWorkflow stage order | S09 (cache-check → reserve → gate) vs S05 (likeness gate → cache-check → … → re-gate → record) | S05 §5.1 order and S05 §5.2 retry classes; S09 supplies budget, gate, webhook and wait/poll infrastructure | S09's order had no likeness gate before submit (defect against R-NPC-04) | 09-backend §3.3 |
| DL-020 | Money units | S05 `budgetUsd`, `cost_usd` (float dollars) vs S09 USD micros | Integer USD micros on every boundary (`budgetUsdMicros`, `cost_usd_micros`); list prices stay decimal | avoid float drift between ledger and pipeline | 05-assets §4.3, §4.6, §5.3 |
| DL-021 | Pipeline migration number | S05 `0004_assets.sql` vs S09 `0004_moderation.sql` | S05 tables (`gen_run`, `gen_job`, `asset_index`, `bark_index`, `budget_program`) fold into `0002_genai.sql` (M05d); ledger kind adds `asset` | collision; genAI tables belong together; M05b runs on `InMemoryDataPort` | 09-backend-db §2, §3.2; 05-assets-pipeline §13 |
| DL-022 | `soulVersion` type | S05 number vs S09 string/`text` | Integer, DB `int` (fixed line in the C10 sketch) | ordering and consent revalidation need a number | 09-backend-db §3.3; 09-backend §3.2 (`EncounterDO.begin`) |
| DL-023 | Kill-switch client eviction | S05 assumed OPFS eviction by tag; S11 store had no tags | `PackRef.tags`, IDB row `tags`, `WorldPackStore.evictByTag()` | gap exposed by S05 against R-NPC-04 | 11-platform-pwa §5; 05-assets §5.5 |
| DL-024 | Telemetry client location | S09 `apps/web/src/telemetry.ts` vs S11 `packages/engine/src/platform/telemetry/` | S11's package location | engine code emits events and packages cannot import apps (dependency-direction defect) | 09-backend §2.1, §3.5 |
| DL-025 | Telemetry registry | S01 `engine.no_isolation`, `engine.sim_crash`; S11 `tier.decision`, `storage.persist`, `gpuMBEst`; envelope `deviceClass` lacked `unknown` | Add `tier.decision`, `storage.persist`, `err.sim`, `app.start` props, `gpuMBEst`; `engine.no_isolation` → `app.start{coi:false}`; envelope uses C13 `QualityTierId`/`DeviceClass` | unknown names are dropped at ingest | 09-backend-contracts §3; 01-engine §5 |
| DL-026 | `PlatformSettings` in C05 | S11 proposed `settings.platform` vs C05 owner S01 ("device-level graphics live with S11") | `PlatformSettings` is device-scoped (IndexedDB `dv-platform/settings`), not in C05 | owner wins, and the proposal was a defect: cloud sync (M12a) would carry a desktop tier override to an iPhone | 11-platform §4.6, §10 |
| DL-027 | XR comfort settings | S01 `settings.xr` (5 fields) vs S11 `XrComfortSettings` (richer) | One type, S11's, persisted in C05 `ProfileSettings.xr = XrComfortSettings & {heightCalibM}` | player preference belongs to the profile; one definition | 01-engine-save-modes §C05; 11-platform-xr §4.2 |
| DL-028 | Telemetry consent | C05 `privacy.telemetry` vs C16 two toggles, sent before any profile loads | `PlatformSettings.telemetryConsent {diagnostics, analytics}` (device); C05 privacy keeps `cameraFeatures`, `parentalConsent` | a per-profile flag cannot gate `app.start` and heartbeat events (defect) | 01-engine-save-modes §C05; 11-platform §4.6 |
| DL-029 | `immersive-ar` | S01 C04 allowed AR for tycoon desk and fighter tabletop vs S11 (visionOS AR UNVERIFIED, out of v1) | v1 is `immersive-vr` only; the AR union member is reserved for a post-M11b ADR; non-goal added to 06 §3 | no UNVERIFIED capability in v1 scope | 01-engine-contracts §C04; 01-engine §6; 06 §3 |
| DL-030 | C04 depth and XR camera | S01 left depth to S11; S11 answered | `reversedDepthBuffer` on every tier, `depthPolicy` published, near raised to `max(near, far/20000)` when standard; XR exposes only the dolly, head-in-geometry fades | accepted additive answers | 01-engine-contracts §C04 rules 3, 5 |
| DL-031 | C02/C03 XR hooks | S11 proposals | `FrameSignal` on every rAF/XR frame (rule 8); `SimServices.xrPoses`; XR binders read `XrInputRouter` | accepted additive | 01-engine-contracts §C02, §C03 |
| DL-032 | Debug flags and perf HUD | S01 `DV_DEBUG` (allowed in prod) and own HUD vs S11 `VITE_DV_QA` (prod ignores URL flags) and `PerfHud` | `VITE_DV_QA` only; one HUD (S11) with an engine sim panel | no debug surface in public builds; no duplicate HUD | 01-engine §2.11, §4 |
| DL-033 | Save on hide | S11 called a nonexistent `SaveGame.flush()` | Request the C05 autosave with reason `hidden` when eligible (C05 rule 4) | align to the owner's API | 11-platform-pwa §6, §10 test 7 |
| DL-034 | Browser storage names | `dv-saves` (S01) vs `tb-packs`, `tb-platform`, `tb.hb`, `tb-instance` (S11, S09) | Prefix `dv-` everywhere (`dv-saves`, `dv-packs`, `dv-platform`, `dv/packs`, `dv.hb`, `dv-instance`) | C05 owner's name kept; one prefix | 11-platform-pwa; 11-platform; 09-backend |
| DL-035 | Repository layout (A-01) | S09 `packages/identity`, `tools/ops`, `tools/cutscenes`, `ops/guardrails.yaml`; S05/S01 root `content/`, `assets/`; S09 `supabase/`, `tests/` | A-01 amended: add `packages/identity`, `tools/ops`, root `content/`, `assets/`, `supabase/`, `tests/`; `tools/cutscenes` → `tools/assets` (cutscene-index); guardrails → `config/guardrails.yaml` | R-AUTH-02 needs an isolated identity package; Supabase CLI convention; one config folder | 09-backend; 09-backend-ops; 09-backend-db; 06 §5; 02-architecture §2 |
| DL-036 | Script names | S01 `pnpm e2e`, `pnpm perf`; S05 `pnpm test`, `test:pipeline`, `pnpm e2e` vs S09/S11 `check:*` | Root CI gates are `pnpm check:*` (list in 06 §5); package-local `--filter @dv/<pkg>` allowed | one runnable vocabulary for the Builder | 01-engine §9; 05-assets §9 |
| DL-037 | Milestone ids | M01c used by S11 (device spike) and S05 (assets-publish); S11 `M02a2`; unnamed cutscene spike; M00 split; saves in M04a (S01) and M04b (S09) | M00 bootstrap + M00b ip-provenance-gates + M00c genai-spike; M01c device spike; **M01d** assets-publish; **M01e** asset-worker store; M04a saves/modes/unlocks (S01); M04b menus + identity; **M04c** cutscene-playback spike; M05d data spine; M12a/b/c; M13d (list in `spec/00-plan.md`) | unique ids; letter = scope, digit = session split | 11-platform*; 05-assets*; 09-backend §8 |
| DL-038 | Alert ids | S09 spend alerts S01–S09 (research ids) collide with subagent ids | Renamed SP-01…SP-09 | id hygiene | 09-backend-ops §4, §5.3 |
| DL-039 | Soul prompt storage | S09 put `souls/<id>/<ver>/soul.prompt.txt` in the public media bucket | Private bucket | publishing prompt rails eases jailbreaks; nothing public needs them (defect) | 09-backend-db §4 |
| DL-040 | Cutscene catalog source | S09 `tools/cutscenes` vs S05 release `cutscene-index` | One artifact, built by `tools/assets`, loaded into `cutscene_catalog` | duplicate artifact | 09-backend-db §3.2 |
| DL-041 | Missing bindings | S05 `KillPurgeWorkflow` and Transcoder Container absent from S09 wrangler | Added `KILL_WF` and `TRANSCODER` to `tha-bay-web` (M05b), keys checked in M00 | gap | 09-backend-ops §1.2 |
| DL-042 | Offline relaunch catalog | S11 precache list lacked the C07 pointer | Precache `/asset-catalog.json` | M11a offline-relaunch test needs it | 11-platform-pwa §4 |
| DL-043 | Kill route side effect | S05 needs route 46 to start `KillPurgeWorkflow` | Recorded on route 46 | contract completeness | 09-backend-contracts §2.4 |
| DL-044 | Profile id naming | C12 identity `profileId` (UUIDv7) vs C05 save `ProfileId` (32-hex) | Both kept, named "identity profile" and "save profile" in 06 §4.3 and the C12 comment | ambiguity only | 09-backend-contracts §2.3; 06 §4.3 |
| DL-045 | C09 cutscene layout | 06 v0.95 `cutscenes/<sha256>.mp4` vs S09/S05 directory per key with manifest written last | Directory layout + `cutscene-index` + `characters[]` and `licence` in the manifest (fixed lines in the C09 sketch) | multi-file outputs need an atomic ready signal | 06 §4.4 |
| DL-046 | C10 history | 06 v0.95 client `history[]` vs S09 security proposal | No client history; add `encounterId?`, `soulVersion` (fixed in the C10 sketch) | forged assistant turns are a jailbreak path | 06 §4.4 |
| DL-047 | C17 anchors | 06 v0.95 `lat/lng \| chunkKey` vs S09 | Both required, radius ≤ 250 m, moderation server-owned (fixed) | chunk-indexed queries and anchor checks | 06 §4.4 |
| DL-048 | C14 runtime hooks | S09 assumptions | `modsActive()`, closed `permissions[]`, C07 `ProvenanceRecord` per asset (fixed) | rooms refuse mods; publish fails closed | 06 §4.4 |
| DL-049 | C08 assumptions | S01, S11, S09 assumptions | Chunk fields, tags, `(cellKey, slot)` spawn tables, `z/x/y` key, `world.bounds.json`, ≤ 6 render objects (fixed lines in the C08 sketch); S02 defines the grid and pack AssetIds | three Wave 1 domains already depend on them | 06 §4.4 |
| DL-050 | R-ID wording | R-AUTH-01 "M12", R-MAP-03 "Mapbox … or ADR" vs D-04/D-25 | R-AUTH-01 → M12a; R-MAP-03 cites D-25 (in-engine Canvas 2D; Mapbox CLI dev-only) | consistency with binding decisions | 06 §2 |

### B. Wave 1 `decisions_needed`, settled

| ID | Question | Decision | Reason |
|---|---|---|---|
| D-S01-01 | One Rapier build per session or both live | One build per session; switch only at top-level mode entry behind the loading screen; measure restart cost in M01a (Q-ENG-01) | determinism profile integrity; already C02 rule 5 |
| D-S01-02 | Free roam on `deterministic-compat` | No; keep D-12 (`simd-compat` locally); revisit if M03a shows ≤ 10 % tick cost | performance first; canonical profile covers reproducibility needs |
| D-S01-03 | Save size caps | 2 MiB per record, 16 MiB per save profile, 64 save profiles, names 1–80, 2 generations; server cap 64 MiB per identity | fits Grand-V rules and iOS quotas |
| D-S01-04 | Game clock rate | 30 game s per real s (48-min day), `config/clock.json` (owner may tune without a spec change) | design value |
| D-S01-05 | Net socket thread | `sim.worker`, with a main-thread `MessagePort` relay if iOS workers lack WebSocket (decided in M12b, DL-052; UNVERIFIED) | keeps decode off the 72 Hz XR frame |
| D-S01-06 | XR player body | Hands only with forearm IK; full body via a post-M11b ADR | comfort, cost |
| D-S01-07 | Skateboard/scooter | Out of v1 | scope |
| Q-ENG-01…08 | engine technical defaults | Accepted as written in `01-engine.md` §10 | measured in the named milestones |
| DN-S11-01 | Who flips `webgpu.mobile` | S11/Builder flips it by PR only after the M01c iPhone 15 Home Screen run passes (30 min, no jetsam, p90 in budget), re-validated in M11a; until then mobile uses the WebGL2 backend | evidence-gated (F-009, F-012 UNVERIFIED parts) |
| DN-S11-02 | `postMessage` fallback without isolation | Yes, minimal, no perf guarantee | degrade instead of fail |
| DN-S11-03 | XR UI technique | Canvas 2D panels through S10's `UiSurface`; Quest quad layers, Vision Pro scene planes | DOM cannot render in XR; S10 must provide `UiSurface` |
| DN-S11-04 | Split M01b, add asset-worker milestone, name the spike | M01c device spike; M01e asset-worker store; M04c cutscene-playback spike (DL-037) | session size |
| DN-S11-05 | `desktop-ultra` promotion | Auto only on WebGPU with a real adapter and p90 ≤ 8.35 ms at desktop settings; else manual | † numbers need calibration |
| DN-S11-06 | PC VR / Quest Link | Best effort on `xr-quest`, not in acceptance | no device in the matrix |
| DN-S11-07 | Vision Pro hand tracking at entry | Request as an optional feature (one prompt); denial leaves gaze and pinch | one permission moment |
| DN-S05-1 | Split M00, add assets-publish | Yes: M00, M00b, M00c; assets-publish is M01d | session size |
| DN-S05-3 | Drop the fictionalized face-similarity check | Yes; use the H1 human checklist | biometric processing contradicts R-IP-04 intent and trust-safety rec 9 |
| DN-S05-4 | Who holds the production `FAL_KEY` | Policy: CLI-first; a staff key held by the art lead locally; CI and the Worker get separately scoped keys with allowed-model lists. The named holder is owner input (Q-17) | least privilege |
| DN-S05-5 | Vehicle sourcing | CC0 or authored low-poly for traffic and police; generated body + mandatory Blender pass for race and hero cars; measure Blender time in M03a | quality and instancing limits |
| Q-S05-01 | H3 written clearance | Unchanged: covered by owner default Q-03 (fallback chain) and A-08 | already decided |
| Q-S05-04 | Art-lead time per character | Measured in M00c and M03a; no owner input needed | measurement |
| Q-BE-01 | Issuer host | `id.<domain>` on the web Worker | Supabase TPA and JWKS clarity |
| Q-BE-02 | Rooms host | `rt.<domain>`; switch to zone route `<domain>/rt/*` only if the M12b spike shows COEP blocks the cross-origin socket (UNVERIFIED U1) | separate deploy unit |
| Q-BE-03 | Supabase from M05d | Yes (M05d data spine); Pro for prod at first public launch, Free for staging with keep-alive | backups, no pausing; within infra budget |
| Q-BE-04 | Forum posting at P1 | Allowed for `device` tier with account age ≥ 72 h and 18+ attestation; publishing NPCs, experiences, mods stays `linked` | non-empty forum before M13c, bounded abuse |
| Q-BE-05 | Turnstile at P1 | Yes; verify the API at M12a start; fallback per-net registration caps | account farming |
| Q-BE-06 | Cloud-save conflict policy | Keep both, player chooses (`conflicts` store, DL-007) | never lose progress silently |
| Q-BE-09 | New milestone ids | Adopt M05d, M12c, M13d | session size |
| R-S11-05 | UI-mod iframe under COEP | Stays open for S12 (Wave 4), listed in `spec/02-architecture.md` §7 | owner is S12 |

### C. Moved to the owner (`spec/99-open-questions.md`)
Q-S11-01 → **Q-13** (test devices) · DN-S05-2 and Q-S05-03 → **Q-14** (fal cap vs fallback video provider, fighter count) · Q-BE-08 → **Q-15** (domains, zone, repo plan) · Q-BE-07 → **Q-16** (NCMEC, PhotoDNA, DMCA agent, CSAM-tool ticket) · DN-S05-4 holder and Q-S05-02 → **Q-17** · Q-S05-05 → **Q-18** (counsel: "internal business use") · per-character research layer missing → **Q-19**.

## 2026-10-18 — Wave 1 consistency-check corrections (Architect)

Input: fresh-context checker verdict `fail` on the Wave 1 reconciliation (1 blocking, 23 major). `prompt-pack/06-SHARED-CONTEXT.md` stays **v1.0**; the rows below are corrections of defects, not contract changes, and `spec/03-decisions-and-facts.md` moves to v1 for the A-01/A-03/A-04 amendments.

| ID | Topic | Problem | Decision | Files changed |
|---|---|---|---|---|
| DL-051 | A-03 cache-key term | spec/03 said `endpointId@updatedAt`; 06 C09, S05 use the registry pin | A-03 amended to `endpointId@pinnedUpdatedAt` (changed only by `genai:repin`) | spec/03 §2; 05-assets-pipeline §6, §13 |
| DL-052 | A-04 milestones | spec/03 put `validated` in M12a; S09 has M12a = identity + cloud saves, `validated` in M12b, `authoritative` post-M12c ADR; S01 planned prediction in M12a | A-04 amended to S09's plan; engine netcode hooks (prediction ring, net slots, hash cadence) move to M12b; D-S01-05 decided in M12b | spec/03 §2; 01-engine §1.1, §2.12, §2.13, §8, §10; this log (D-S01-05) |
| DL-053 | Cross-domain asset references (blocking) | engine fields typed as bare C07 `AssetId`, which is unique only within a kind (`character/<slug>`, `portrait/<slug>`, `anim/<slug>.base`) | Every cross-domain reference is a C07 `AssetRef` `<kind>/<id>`: `RenderKey.asset` (StringTable id of the full ref), `ClipRef.asset`, `GameModeDescriptor.tile.art`, `PrefabDef.render.asset`, `ModeContext.assets.request/ready(AssetRef[])`; rule added to 06 §4.3 | 01-engine-contracts §C01, service interfaces; 01-engine-save-modes §C06, prefabs; 06 §4.3 |
| DL-054 | A-01 text | spec/03 A-01 row still v0 while 06 §5 cites it as amended (DL-035) | A-01 row amended in spec/03 v1, pointing to 06 §5 and 02 §2 | spec/03 §2 |
| DL-055 | Import direction | `DataPort`/`Ctx` in `@dv/shared` typed with `@dv/identity` types; `services/edge` imported `@dv/identity`; 06 §4.1 rule 1 contradicted C11's path | Identity token, tier and scope types move to `packages/shared/src/identity.ts` (re-exported by `@dv/identity`, which is client-only); 06 §4.1 rule 1 names C11 (`packages/net/src/protocol/**`, pure codec) as the one exception | 09-backend-contracts §0, §2.3, §2.6; 02-architecture §2; 06 §4.1, C12 row |
| DL-056 | Budget type location | `PlayerQuota`, `BudgetGovernor`, `GovLevel`, `Vendor`, `SpendEvent` in `services/edge` → pipeline↔edge import cycle | Types move to `packages/shared/src/api/budget.ts` (C12); DOs stay in `services/edge/src/budget/` | 09-backend-ops §5.3; 09-backend-contracts §0; 06 C12 row |
| DL-057 | Save positions | `StorySlice.position` and `SandboxSlice.savedPositions` used lat/lng against 06 §4.3 | ENU f64 `{x, y, z, yaw}` valid for the record's `worldBake`; mismatch snaps to the nearest safehouse | 01-engine-save-modes §C05 |
| DL-058 | Game-clock unit | C11 `EV World.tod` in game minutes; `npc_memory.game_time` and `topK(gameTime)` unitless | `clockT` = C06 `WorldClockState.t` (integer half-seconds) on the wire; `game_time` and `gameTime` are the same unit; row added to 06 §4.3 | 09-backend-contracts §1.5, §2.6; 09-backend-db §3.3; 06 §4.3 |
| DL-059 | Epoch-ms rule | ISO strings in `TierDecision.decidedAt`, `PerfReport.createdAt`, `AssetCatalog.createdAt`, provenance and registry files | Runtime records, catalogs and reports use epoch ms (`decidedAt`, `PerfReport.createdAt`, `AssetCatalog.createdAt` converted); logged exception in 06 §4.3: repo-committed, human-audited files (C07 `ProvenanceRecord` timestamps, registry `checkedAt`) use ISO-8601 UTC `Z`, and `pinnedUpdatedAt` copies the vendor value verbatim | 11-platform §4.6; 11-platform-perf §4; 05-assets §4.2, §4.3; 06 §4.3 |
| DL-060 | Undefined C11 payload types | `AppearanceV1` had no owner; `VehicleSpawn.modelId` named no id space | `AppearanceV1` is a fixed obligation on S10 (binary encoding of C05 `CoreSlice.avatar`, ≤ 512 B; 06 §4.3); `modelId` → `prefabId` (C06 `PrefabDef` id, kind `vehicle`) | 09-backend-contracts §1.5; 01-engine-save-modes §C05; 06 §4.3 |
| DL-061 | `PreparedClip` | C13 `XrMediaHost.prepare(PreparedClip)` cited a type the v1.0 C09 sketch lacked | Fixed line added to the C09 sketch with the minimum shape C13 needs (source element or decoder URL+codec, w/h, `durationMs`, cues, `degraded`) | 06 §4.4 C09; 11-platform-xr §4.4 |
| DL-062 | Unlock storage | `unlocks` keyed by `(profile_id, mode)` could not hold fighter or district unlocks | Key `(profile_id, unlock_id)`, `unlock_id` checked `^unlock\.`; 06 §4.3 row | 09-backend-db §3.5; 06 §4.3 |
| DL-063 | Save-profile sync | `save_records` FK to `save_profiles` but no route created, renamed or deleted a save profile | Routes 50 `PUT /api/v1/saves/:saveProfileId` (`SaveProfileUpsert {name, createdAt}`) and 51 `DELETE` (tombstone); `SaveSyncRes.profiles` gains `updatedAt`, `deletedAt`; `DataPort.saves.putProfile/deleteProfile`; route table #1–51 | 09-backend-contracts §2.4–2.6; 09-backend-db §3.5; 09-backend §7; 01-engine-save-modes rule 10; 06 C12 row, §4.3 |
| DL-064 | URL flags | S01 cited retired `?level`; S11 `QaFlags` lacked the engine flags | `?level` dropped; S11's single `QaFlags` parser carries `?debug`, `?seed`, `?profile`, `?mission`, `?stage`, `?unlockAll` and passes them to `sim.worker` | 01-engine §2.11; 11-platform §5.3; 11-platform-perf §4 |
| DL-065 | Perf scenario id | engine test 18 used `graybox-walk`, absent from S11's set | S11 adds `graybox-walk` (pre-world engine graybox, path owned by S01) to `PerfScenario.id` | 11-platform-perf §4 |
| DL-066 | Anim contract types | `SkeletonId`, `HUMANOID_BONES` declared in an engine client path S05 cannot import | `SkeletonId`, `HUMANOID_BONES`, `AnimStateId` live in `packages/shared/src/contracts/anim-states.ts` (as 06 C04 names); client anim graph types stay in the engine | 01-engine-contracts (service interfaces) |
| DL-067 | Per-character rig | 05 §4.1 and 06 §5 listed a `rig` part under `characters/<slug>/` while the rig is one family asset | No per-character rig asset; the only `rig` asset is `rig/bay_rig_v1` at `assets/rig/bay_rig_v1/`; rigging output is the skinned `character` model | 05-assets §4.1; 06 §5 |
| DL-068 | GenAI caps location | `GENAI_RUN_CAP_USD`, `GENAI_PROGRAM_CAP_USD`, `GENAI_ALARMS`, `FAL_CONCURRENCY` env vars; `budget_program` row as the cap | Caps live in `config/guardrails.yaml` `genai.*` in integer USD micros; `budget_program` is a mirror checked by the drift job | 05-assets §4.7, §5.3; 05-assets-pipeline §13 |
| DL-069 | Mode telemetry | `ModeContext.telemetry.emit(name: string)` untyped against the closed C16 registry | `emit(name: TelemetryName, …)`; modes propose registry additions to S09 before emitting | 01-engine-save-modes §C06 |
| DL-070 | Save on hide | main-thread `LifecycleController` called worker-side `SaveService` with no command; hidden pages run no ticks | C02 `SimControlMessage {t:'save.request', reason:'hidden'}` on the command ring, handled by the worker outside ticks (C02 rule 9); C05 rule 4 decides eligibility | 01-engine-contracts §C02; 01-engine-save-modes §C05 rule 4; 11-platform-pwa §6; 06 C02 row |
| DL-071 | NetIn/NetOut thread | `FramePhase` doc said "main thread" while the socket and `NetOut` run in `sim.worker` | NetIn/NetOut run in `sim.worker`; the rest of `FramePhase` on the main thread | 01-engine-contracts §C02 (enum comment, rule 6); 06 C02 row |
| DL-072 | Degraded cutscene rendition | container-failure output had no rendition id in the C09 fixed line | Rendition `p720` (progressive 720p MP4) with `degraded: true`, added to the C09 fixed line | 06 §4.4 C09; 05-assets §5.2; 05-assets-pipeline §6 |
| DL-073 | Cache-key helpers | S05 named `canonicalJson`/`sha256` in `packages/shared/src/genai` against DL-009 | `canonicalize` (`packages/shared/src/json.ts`) and `sha256Hex` (`packages/shared/src/hash.ts`, pure, sync) | 05-assets-pipeline §6; 01-engine §3; 06 §4.3, §4.4 C09 |
| DL-074 | Script names | `check:smoke`, `history:scan`, `terms:watch` outside DL-036 vocabulary | `check:smoke` added to 06 §5; `history:scan` → `ip:history`; `terms:watch` → `genai:terms-watch` | 06 §5; 05-assets; 05-assets-pipeline §9, §11 |
| DL-075 | Identity storage | `LocalIdentity` IndexedDB had no name | IndexedDB `dv-identity` (store `identity`) | 09-backend-contracts §2.3; 06 §5; 02-architecture §3.3 |
| DL-076 | Stale pre-freeze references | headers cited 06 v0.95/spec/03 v0; C01 rule 5 "proposal"; PWA "proposed additions"; 09-backend "local M04b"; perf Q-S11-01 | Headers → 06 v1.0 / spec/03 v1; C01 rule 5 cites the fixed C08 line (DL-049); C16 additions marked done (DL-025); local saves M04a (DL-006); Q-S11-01 → Q-13 | 01-engine*; 05-assets; 09-backend*; 11-platform* |

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

## Builder decisions

Small reversible choices the spec left open, recorded by the Builder (`prompt-pack/04-SONNET-KICKOFF.md`, protocol). The Architect reviews them; none changes a contract shape.

### M00 (2026-10-18, Builder Claude Sonnet 5.5)

| ID | Topic | Choice | Why and how to undo |
|---|---|---|---|
| BD-M00-01 | Tool versions not in the ledger | `eslint ^10.13.0` (resolved 10.13.0; 9.39.5 is marked deprecated on npm), `tsx ^4` (4.23.15), `@types/node ^22` (22.20.5), `@types/three 0.186.0` (the newest types for three 0.186.x; there is no 0.186.1), `sharp 0.35.5` (pulled in by `@vite-pwa/assets-generator`). pnpm 12.14.0 resolved all other pins from the milestone unchanged. | Versions the milestone did not pin; kept out of acceptance criteria. Change the range in the package that declares it. |
| BD-M00-02 | `BRAND.legalName` and `tagline` | `legalName: 'Dee-Verse (operating entity pending counsel review)'`, `tagline: 'An original story set in a Bay Area that feels like home.'` | The spec names the fields but gives no values; the operating entity depends on Q-23. Edit `config/brand.ts` only. |
| BD-M00-03 | Budget cells the §4.5 table leaves out | `sim.distantAnimHz`: 60 on `desktop-ultra`, `desktop`, `xr-visionpro`; 30 on `mobile`, `mobile-low`, `xr-quest`. The "2 MB" chunk-upload cells are 2 MiB (2,097,152 B). `alwaysVisibleRadiusM` and `maxChunkUploadBytes` are `null` where the table shows a dash. `altitudeBoostM` is 0 where the table shows no boost; the Quest "+ fog" note is not a number. | The `WorldLimits`/`SimLimits` fields are required by C13 but the table has no column for `distantAnimHz`. Calibrate in M11a with the other † values (`config/tier-budgets.json`). |
| BD-M00-04 | C13 file scope | `packages/shared/src/platform/c13.ts` holds §4.1 and §4.2 verbatim plus the §4.6 types that `QualityService` refers to (`DeviceSignals`, `AdapterSummary`, `DeviceProfile`, `TierDecisionSource`, `BenchmarkResult`, `TierDecision`, `PlatformSettings`). `classifyDevice` is declared only as the type `ClassifyDevice` (the spec line is a bodiless function declaration, which TypeScript rejects outside `declare`). | Without the §4.6 types `QualityService` does not compile. M01c implements `classifyDevice` and may replace the type with the function. |
| BD-M00-05 | `PwaUpdateController` | The interface (verbatim from `11-platform-pwa.md` §4) lives in `packages/shared/src/platform/pwa-update.ts` so `@dv/ui` (toast) and `apps/web` (implementation) share it without a package importing an app. Semantics: `updateAvailable` is true while a new worker waits; `onChange(fn)` reports whether an update can be offered now (waiting and at a safe point); `applyNow()` posts `SKIP_WAITING` and reloads on `controllerchange`; the shell boots as a safe point. The service worker calls `clientsClaim()` so first-install pages are controlled without a reload; updates still wait for `SKIP_WAITING` (prompt style). | The spec does not say how "shows only at safe points" maps onto the five members. Undo by moving the file; only `onChange` semantics are interpretive. |
| BD-M00-06 | Typecheck chain | `typecheck` is `tsc -p tsconfig.json --noEmit && tsc -p apps/web/tsconfig.sw.json --noEmit`. The service worker has its own config because it needs the `WebWorker` lib, which conflicts with `DOM` in the root config (root excludes `apps/web/src/sw.ts`). | Milestones append their configs to the chain (M00a: `services/edge/tsconfig.json`; M01a1: `packages/engine/tsconfig.sim.json`). |
| BD-M00-07 | `wrangler dev` and `_headers` (resolves the M00 fallback risk) | Verified: `wrangler dev` 4.151.1 on an assets-only Worker applies `public/_headers` locally, including the `! Header` removal for `/account/*` ("Parsed 3 valid header rules"; hashed JS carries `Cache-Control: public, max-age=31556952, immutable`). So `tools/ci/serve-dist.ts` was not built; `webServer` and `--serve` use `wrangler dev` directly. | The UNVERIFIED item is closed for local runs. The deployed Preview check (AC-14) stays authoritative. |
| BD-M00-08 | Argument shim and Playwright output | `run.ts` removes the first literal `--` anywhere in the argument list, not only a leading one, because `pnpm check:unit -- <path>` produces `vitest run -- <path>` (the fixed arguments come first). pnpm 12.14.0 does pass the literal `--` through, as the spec says. Playwright `outputDir` is `test-results/pw` so `test-results/gpu-probe.<project>.json` and `preview-url.txt` survive the per-run cleanup. | Both are internal to `tools/ci` and `playwright.config.ts`. |
| BD-M00-09 | Active backend in three r186 | After `await renderer.init()`, `renderer.backend.isWebGPUBackend === true` marks WebGPU and `renderer.backend.isWebGLBackend === true` marks WebGL2 (`renderers/webgpu/WebGPUBackend.js`, `renderers/webgl-fallback/WebGLBackend.js`; the fallback replaces `renderer.backend` inside `init()`). `RendererHost` reads these flags. M00 does not retry with a fresh canvas after a WebGPU init failure (11-platform.md §5.1 step 5); three's own fallback covers it and M01c adds the retry. | Confirmed in this session: Chromium without GPU flags reports `webgl2`; with SwiftShader flags `webgpu` (fallback adapter). |
| BD-M00-10 | QA code in production | `import.meta.env.VITE_DV_QA` is set by `define` in `apps/web/vite.config.ts` (`'1'` or `'0'`), so the literal comparison in `main.ts` removes the dynamic import of the probe, `three` and IWER from production builds. `check:bundle -- --forbid-qa` fails when a production build contains `__dvBridge` or the IWER runtime; CI runs it on a production build before the QA build. `tokens.css` is generated but committed, with a unit test that fails when it drifts from `config/ui/tokens.json`. | Extra guard beyond the milestone; delete the flag to undo. |
| BD-M00-11 | `deploy.ts` | Preview: `wrangler preview --env staging --name <n> --json`; on failure or no URL in the output, `wrangler versions upload --env staging --preview-alias <n>`; the path taken is printed. The shape of `wrangler preview --json` is not in the ledger (UNVERIFIED), so the URL is read defensively from JSON, NDJSON or text. Both flags exist in wrangler 4.151.1 `--help`. Without credentials every mode prints `SKIP deploy:<mode>: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set`, exits 0, and `preview` also deletes a stale `test-results/preview-url.txt`. Before any real deploy the script refuses unless every Worker name in `wrangler.jsonc` starts with `tha-bay-`. | The account holds about 32 unrelated Workers; the guard keeps `deploy:*` from touching them. |
| BD-M00-12 | Action pins | The workflow SHAs are copied from `research/gap-ci-cd-release-assets.md` §1.1; this session had no GitHub API access to re-resolve the tags. | Run `check:pins` (nightly, later) or resolve the tags once and compare. |
| BD-M00-13 | Where versions are recorded | The harness for this run limited spec edits to this file, so the resolved versions and the facts above are recorded here and not in `spec/03`. | Move rows to `spec/03` or `research/INDEX.md` §2 when convenient. |

### M00b (2026-10-18, Builder Claude Sonnet 5.5)

| ID | Topic | Choice | Why and how to undo |
|---|---|---|---|
| BD-M00b-01 | Schema validator | `ajv 8.20.0` (root devDependency, `ajv/dist/2020`) validates `packages/shared/schemas/*.schema.json` in CI tools and tests. The pure cores in `@dv/shared` do not use it: they hold the semantic rules only (Workers cannot compile schemas at run time, and M13a1 reuses the cores). | Version not in the ledger; kept out of acceptance criteria. M13a1 needs its own structural validator for mod packages. |
| BD-M00b-02 | Extra config fields and schemas | `config/ip-denylist.json` carries `terms` (substring), `words` (word-bounded), `patterns`, `nameRegex` (R-NAME-2), `extensions`, `wasmNameNeedles`, `faceDetectorTerms`, `datHeaderTerms` and `exceptions`, so no denylisted string appears in gate source. Schemas for the five non-provenance configs live beside the two the milestone names. | Needed because tracked source is itself string-scanned. Rename fields freely; `check:assets` validates them. |
| BD-M00b-03 | Exception for a contract value | `config/ip-denylist.json` `exceptions` has `timecyc-dome`: the C13 `SkyMode` values in `packages/shared/src/platform/c13.ts` contain the seed term `timecyc`. The contract text cannot change, so the exact string is excepted (reason recorded). | Follows the milestone's false-positive rule. The exception removes only that exact string. If the Architect renames the SkyMode value, drop the exception. |
| BD-M00b-04 | `packages/ui/test/i18n.test.ts` | Two expectations used the display-name literal; they now use `DISPLAY_NAME`. | `names:brand` forbids the literal outside `config/brand.ts`, tests included. |
| BD-M00b-05 | Provenance join | Join is by SHA-256, and in addition the dist-relative path must match the end of one of the record's `paths` (rule `path-not-recorded`). Identical bytes copied under a new name therefore need their own record, which is what the demo script (step 2) expects. | The spec says `paths` "resolve to these bytes". Drop the path rule if copies should be free. |
| BD-M00b-06 | Registry details | `pinnedUpdatedAt` stays `null`; liveness treats null as "not yet pinned" (no `updated` issue) until the reviewed `--update-pins` PR. `acceptsFaceRefs` is `false` everywhere (the spec says "true only on consented paths" but names no endpoint). `vision_qa` is priced per `gen` with the MTok rates in `note` (the `per` enum has no token unit). Video provider endpoint ids use only ids that appear in `research/genai-pipeline-fal.md`; `ltx25.fast` = `lightricks/ltx-2.5/image-to-video/fast`, `gemini.omniFlash11` has only the documented `reference-to-video` id. `termsSnapshot` is `none` for Anthropic (not one of the ten snapshots). | Flip `acceptsFaceRefs` per endpoint when M05b defines the consented path. |
| BD-M00b-07 | Vendor terms | Snapshots stored as plain text with a short header (7 fetched; hash in `index.json` is of the stored file). `minimax-h3-qa` has no URL (pending-manual as specified). `minimax-platform-tos` is a client-rendered page (0 text characters) and `openai-usage-policies` answers HTTP 403 to scripted requests: both `pending-manual`. Fetched pages include site navigation text. | The operator saves the two texts by hand and runs `pnpm legal:snapshot -- --only <id>` after pasting, or edits `index.json`. |
| BD-M00b-08 | `.dff`/`.txd` and IMG tests | RenderWare is detected by chunk type (`0x10`, `0x16`), a size that fits the file and a non-zero version stamp; IMG v2 by `VER2` plus an entry count that fits the file. | The spec names the headers but not the exact checks; tighten when real samples are available in Zone R. |
| BD-M00b-09 | Optional-secret form | `DV_NAMES_REAL_JSON` may hold the JSON document or a path to it. | Either form works in CI and locally. |
| BD-M00b-10 | Credits | `provenance:check --emit-credits` writes `dist/credits.json` (`credits/1`, attributions of active records); the CI `ip` job passes the flag. `credits.json` is not part of the ship set. | The credits page (M04b1) reads it. |

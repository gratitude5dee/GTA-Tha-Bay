# 06 — SHARED CONTEXT · canonical requirements, interface contracts, conventions, glossary

> **Version 1.0 — FROZEN** (Architect, 2026-10-18, after Wave 1 contract reconciliation; see §7 and `spec/11-decision-log.md`). Was 0.95 (end of Phase 0). Every subagent in Waves 2–5 reads this file first and honors §4 exactly. Every spec statement cites an R-ID. A contract changes only through the Architect: additive change = minor bump of this file and of the contract (1.x), breaking change = major bump plus an ADR and a one-release overlap. A Wave 2–4 subagent that needs a change writes it into its return block (`contract_change_proposals`) and keeps coding against the frozen shape.

## 1. Product in one paragraph
**Dee-Verse: GTA – Tha Bay** is an original, storyline-driven open-world game set in an accurate, recognizable San Francisco, delivered as a Three.js/WebGPU Progressive Web App on Cloudflare (desktop + iPhone-class mobile) and as a WebXR experience (Meta Quest, Apple Vision Pro). First- or third-person play. Single-player story first, then multiplayer. Three unlockable sub-games (Racing, Culture Wars fighter, Business Tycoon). AI NPCs built from Bay Area tech and culture figures via soul.md + a fal.ai character pipeline, plus a native NPC builder for players. Cutscenes generated once (MiniMax on fal.ai) and cached. Players mod with their own coding agent or ChatGPT sign-in and publish experiences to the map. The rest of the Bay Area ships later.

## 2. Canonical requirements (R-IDs)
Format: `R-<AREA>-<NN>` · statement · (source: owner brief unless noted). "MUST" unless marked SHOULD.

**Platform**
- R-PLAT-01 Hosted on Cloudflare; served as an installable PWA for desktop and mobile; iPhone is the primary mobile target.
- R-PLAT-02 Playable on WebXR headsets (Meta Quest 3/3S, Apple Vision Pro) as a full XR port (immersive session, hand/controller input, comfort options), not a flat screen in VR.
- R-PLAT-03 Three.js with a WebGPU-first renderer and automatic WebGL2 fallback; WASM for physics/decoding/pose inference where it pays; quality tiers auto-selected per device.
- R-PLAT-04 First-person (as the character) and third-person (behind-the-shoulder follow) cameras, switchable at any time outside cutscenes.
- R-PLAT-05 SHOULD run at 60 fps on current iPhones at the mobile tier and 72/90 fps on Quest 3 within the platform budgets.

**Auth and identity**
- R-AUTH-01 v1 launches with no sign-in: a local profile (device-bound, HMAC play token) with cloud sync deferred to P1 (M12a). Auth phases: P0 local → P1 device-registered → P2 ChatGPT link → P3 Thirdweb (spec/03 D-04).
- R-AUTH-02 Thirdweb sign-in (in-app wallet / social / email) is integrated LAST; the codebase isolates identity behind one interface so adding it is one milestone.
- R-AUTH-03 Optional ChatGPT linkage exists solely to enable the modding/publishing flow (R-MOD-02); it is never required to play. Website Sign-in-with-ChatGPT is a partner trial, so the shipped path is bring-your-own agent (Codex CLI signed in with ChatGPT) plus device-code publish login (spec/03 D-05).

**Rollout**
- R-ROLL-01 Milestone order: hosted single-player with storyline, tested on Cloudflare, before any multiplayer.
- R-ROLL-02 Multiplayer open world via realtime functions: authoritative rooms and presence on Cloudflare Durable Objects; persistence on Supabase (G1; Convex documented alternative).

**World / map**
- R-MAP-01 Accurate San Francisco first: real street grid, neighborhoods, landmarks, hills, waterfront, bridges as world boundaries/portals; players recognize where they are. (owner update 2026-10-18)
- R-MAP-02 Rest of the Bay (Oakland/East Bay, Peninsula, South Bay) as later expansion milestones; v1 renders them as low-detail backdrop.
- R-MAP-03 In-app full map and minimap (in-engine Canvas 2D from `sf-map.v1.bin` per spec/03 D-25; the Mapbox CLI is dev-only), with mission markers, player-published experiences, and fast travel where the story allows.
- R-MAP-04 Living city: traffic (incl. robotaxis), pedestrians, transit as set dressing, day/night and weather.

**Cutscenes**
- R-CUT-01 Cutscenes rendered with MiniMax H3 Max Turbo via fal.ai once its licence is cleared in writing (spec/03 A-08), otherwise with the fallback chain in `config/genai-endpoints.json`; requested through the backend, stored in R2, reused by deterministic cache key; generated at most once per key; labeled AI-generated.
- R-CUT-02 Cutscene hooks: story beats; fight intro (per matchup), special move/finisher (per character+move), fight ending (per winner); racing event intros SHOULD.
- R-CUT-03 Every cutscene has a non-generated fallback (in-engine camera sequence with subtitles) so the game never blocks on generation.

**AI NPCs**
- R-NPC-01 Roster of AI NPCs modeled on tech founders/influencers and Bay Area cultural legends, each driven by a `soul.md` (research layer exists) plus backstory reference images.
- R-NPC-02 Character pipeline on fal.ai: reference sheet (multi-view/T-pose) → image-to-3D T-pose model → auto-rig → animation retarget → glTF in R2, with provenance and QA gates.
- R-NPC-03 Native NPC builder: players upload a backstory (→ soul.md via LLM) and reference images (→ same pipeline), preview a chat, and publish through moderation.
- R-NPC-04 Likeness policy tiers (`consented` | `parody` | `fictionalized`) stored in soul.md, enforced by the pipeline and a live kill-switch; no real-voice cloning without `consented`.
- R-NPC-05 Runtime dialogue through a server-side proxy (no keys in the browser), with prompt caching, per-player rate limits, offline fallback lines, and in-character safety rails.

**Modes**
- R-MODE-01 Main story: original narrative in SF, mission system (intro → objectives → fail/success → rewards), wanted system, economy, property/garage.
- R-MODE-02 Racing: Forza-grade look at the desktop tier; NFS-Most-Wanted-style police pursuits with heat levels, roadblocks, spike strips; supercars, Waymo robotaxis, Tesla Roadsters; sprint/circuit/pursuit on real SF streets.
- R-MODE-03 Culture Wars: 1v1 fighter (Street Fighter/Mortal Kombat conventions: rounds, meters, specials, supers, finishers, frame data); roster of rappers/founders/athletes; stages at SF landmarks; optional full-body pose control (MediaPipe Pose Landmarker on-device; YOLO excluded for licence reasons) with calibration and fallback to pad/touch/keys; cutscene hooks per R-CUT-02.
- R-MODE-04 Business Tycoon: founder-vs-VC sim (idea → MVP → rounds → hiring → scale), cap-table math, AI-NPC investors, random-event engine (business/political/natural/cultural) with probability and impact model, win/lose conditions.
- R-MODE-05 Modes are encountered inside the story and unlock as standalone main-menu options when first encountered; unlock state persists in the save.

**Modding / UGC**
- R-MOD-01 Personal mods for any mode via the player's own coding agent: the repo ships an agent-friendly mod SDK (`AGENTS.md`, skills, knowledge base, typed mod API, local dev loop).
- R-MOD-02 Modding via Sign-in-with-ChatGPT (or the fallback flow in ADR) for players without a local agent.
- R-MOD-03 Forum in the main menu to submit, discuss and vote on worlds/experiences; moderation and DMCA flow.
- R-MOD-04 Published experiences appear as markers on the open-world map and load in a sandbox.

**UI**
- R-UI-01 Character creation UI and logic (body/face/outfit presets, name, voice pick, save to profile; later linked to the fal pipeline for custom looks).
- R-UI-02 Settings page (graphics tier, controls remap, audio, accessibility, XR comfort, camera, language, data/privacy).
- R-UI-03 Main menu and all implied pages: continue/new game, mode select with lock states, garage, NPC builder, forum, profile, save slots, credits/legal.

**IP / legal / safety**
- R-IP-01 Original content only; no Rockstar/Take-Two assets, code, data, names or plots; asset-provenance manifest + CI check; display name is one config value, default "Dee-Verse: Tha Bay"; "GTA" appears nowhere shipped (spec/03 A-07).
- R-IP-02 Likeness policy per R-NPC-04 with consent records and kill-switch.
- R-IP-03 UGC terms, moderation queue, DMCA agent/takedown flow, report button everywhere UGC shows.
- R-IP-04 Camera/pose data stays on device; no frames uploaded or persisted; no face landmarker. Audience: 18+ terms with 17+ content; under-13 blocked (spec/03 D-30).

**Engineering**
- R-ENG-01 Agent-friendly repo: `CLAUDE.md` < 200 lines importing deeper docs, `AGENTS.md`, per-package READMEs, deterministic scripts for build/test/deploy/perf, no GUI-only steps.
- R-ENG-02 Performance budgets per device class are acceptance criteria with automated checks where possible.
- R-ENG-03 GenAI cost model and controls (quotas, cache keys, budget alarms) in the spec; nothing generates without a cache check.
- R-ENG-04 Accessibility baseline: remappable controls, subtitles for generated speech, colorblind-safe HUD, reduced motion, XR comfort options.

## 3. Non-goals for v1
No native app stores. No full-detail East Bay/Peninsula (backdrop only). No user-authored code running inside multiplayer rooms (mods are personal/sandboxed until a later vetting milestone). No real-money or token economy. No voice cloning of real people. No photoreal likeness generation for non-consented people. No server-side rendering of the 3D scene. No passthrough AR (`immersive-ar`) in v1.

## 4. Interface contracts (v1.0, frozen)

### 4.1 Rules
1. The TypeScript in the **defined-in** section is normative; this table is the index and one-line summary. Contract types live in `packages/shared/src/**` (pure, §5) so every consumer imports them without importing an implementation. One exception: C11 lives in `packages/net/src/protocol/**` (types plus the pure codec, no IO; services may import `@dv/net`, `spec/02-architecture.md` §2). `@dv/shared` never imports another package (DL-055).
2. Each contract file exports `C##_VERSION`; all are `1.0.0` at this freeze. Wire or schema numbers are separate (C11 `PROTOCOL_VERSION` is 2; C05 slice `schema` and C07 `schema: 'asset/1'` count independently).
3. The owner wins a disagreement unless the dissent exposes a real defect; then the owner's spec is fixed too (all Wave 1 cases are logged in `spec/11-decision-log.md`).
4. C08, C09, C10, C14 and C17 belong to Wave 2/4 owners. Their §4.4 sketches already absorb what Wave 1 fixed; **the owner finalizes them in Wave 2/4** and may refine fields, but may not contradict a frozen contract or a sketch line marked *(fixed)* without coming back to the Architect.
5. No new contract ids came out of Wave 1. Interfaces Wave 1 introduced were folded into an existing contract: engine services into C06, rig and genAI job types into C07, identity, DataPort and budget types into C12, the platform service facade into C13.

### 4.2 Contract index

| # | Contract | Owner | Consumers | Defined in (spec · code) | Shape summary | Ver |
|---|---|---|---|---|---|---|
| C01 | `EntityId` + ECS conventions | S01 | all | `spec/domains/01-engine-contracts.md` §C01 · `packages/shared/src/contracts/c01-ecs.ts` | session-only dense `EntityId`; `EntityHandle` = gen·2²⁰+id (u32); `StableKey` (`player:` `veh:` `npc:` `amb:<cell>:<slot>` `mis:` `pfb:`) for saves, net, missions, mods; component id ranges per owner (engine 1–255 … net 1792–1919, mod 2048–4095); scalar-only SoA stores; structural changes via `CommandBuffer` in `sim.worker` | 1.0 |
| C02 | `GameLoop` phases + determinism | S01 | all | `01-engine-contracts.md` §C02 + "Determinism rules" · `c02-loop.ts` | `SIM_HZ` 60, `SIM_DT` 1/60, clamp 0.15 s, ≤ 9 ticks/frame, render one tick behind; `FramePhase` Input → NetIn → Sim (hand-off) → Anim → Audio → Render → NetOut (NetIn/NetOut run in `sim.worker`, the rest on the main thread); `SimControlMessage` (`save.request`, handled outside ticks); 10 `SimStage`s; `AI_DIVISOR` 2 (AI 30 Hz on every tier), `NET_DIVISOR` 3 (20 Hz); profiles `local` (Rapier simd-compat) / `canonical` (deterministic-compat, `mobile-low` density); detmath, xoshiro128** streams, lint bans (exception `sim/save/**`); `FrameSignal` every rAF and XR frame; `SimServices.xrPoses` | 1.0 |
| C03 | `InputAction` map | S01 | S06, S07, S10, S11, S12 | `01-engine-contracts.md` §C03 · `c03-input.ts` | `SimButton` bits (0–15 = net set, ≥ 16 local), `ClientAction`, `Axis`, `InputContextId`, `DeviceKind` (kbm, gamepad, touch, xr-controller, xr-hand, xr-transient, pose); quantized `InputFrame` (u32 bit sets, i8 axes, brake/throttle 0..127, u16 yaw, i16 pitch); `Binding`/`InputMap`; `ControlsSettings` persisted in C05; XR binders read S11's `XrInputRouter` | 1.0 |
| C04 | `CameraRig` (+ anim/audio service types) | S01 | S02, S03, S06, S07, S11 | `01-engine-contracts.md` §C04 + "Engine service interfaces" · `c04-camera.ts`, `contracts/anim-states.ts` | `CameraMode` fp\|tp\|cinematic\|xr; `FollowParams`, `CinematicShot`, `XRRigParams` (`immersive-vr` only in v1), `CameraDirective` published by the sim each tick; sim-side sphere-cast collision; depth from S11 `RendererHost.depthPolicy`; `SkeletonId 'bay_rig_v1'` with 22 `HUMANOID_BONES`; `AnimStateId` (u8 network anim state) | 1.0 |
| C05 | `SaveGame` | S01 | S09, S10, S03, S06, S07, S08, S12 | `01-engine-save-modes.md` §C05 · `c05-save.ts` | save `ProfileId` 32-hex (≤ 64 per identity); one `SaveRecord` per `SlotId` (`core`, `settings`, `sandbox`, `story:auto\|1\|2\|3`, `mode:<id>`, `mod:<id>`) with `schema`, `gen`, `savedAt` (ms), fnv1a64 `checksum`; ≤ 2 MiB per record, 16 MiB per save profile; `SaveGame` is an assembled read model; IndexedDB `dv-saves` (write → verify → pointer CAS, tombstones, `conflicts`); per-session write capabilities (sandbox never writes story); `ProfileSettings.xr = XrComfortSettings & {heightCalibM}`; device graphics and telemetry consent are not in C05 | 1.0 |
| C06 | `GameMode` + unlocks + `ModeContext` services | S01 | S03, S06, S07, S08, S10, S12 | `01-engine-save-modes.md` §C06 and the Pursuit, clock, interaction, prefab, mission-hook, economy/combat sections · `c06-modes.ts`, `engine-pursuit.ts`, `engine-world.ts` | `GameModeDescriptor` (status `available\|comingSoon`, `unlock`, `standalone`, `embeddable`, `requires`, `saveSlot`) + `GameModeSim` (enter/tick/exit/saveSlice) + `GameModeUI`; `ModeContext` is the only capability surface (mods get a filtered subset); stack depth ≤ 2; idempotent `UnlockRegistry`; `PursuitApi` (heat 0–5, scripted 6), `WorldClockApi`, `ZoneService`, `SimScheduler` (2,000 ops/thread/tick), `TimelineRecorder`, `InteractionApi`, `PrefabService`, `EconomyApi` (integer cents, idempotency keys), `CombatApi` | 1.0 |
| C07 | `AssetManifest` + addressing + provenance + genAI job types | S05 | S02, S03, S04, S06, S07, S09, S11, S12 | `spec/domains/05-assets.md` §4.1–4.7, Part B §4 · `packages/shared/src/assets/{c07,provenance,fidelity}.ts`, `genai/types.ts`, `rig/bay_rig_v1.json` | `AssetRef = <kind>/<id>`; immutable keys `<root>/<variant>.<sha256[0:12]>.<ext>` (roots `assets/<kind>/<id>/`, `characters/<slug>/<part>/`; cutscenes `cutscenes/<key>/`, barks `audio/barks/<sha256>.opus`); `variants` keyed by C13 `QualityTierId` or `default`, resolved by `VARIANT_FALLBACK`, never upward; `AssetVariant {key, sha256, bytes, contentType, encoding:'identity'}`; `ProvenanceSummary` + per-file `ProvenanceRecord` (`provenance/1.0`); `LikenessSummary`; `AssetCatalog` `manifests/assets-<sha256>.json` + `CatalogPointer` `/asset-catalog.json`; lock file `assets/assets.lock.json`; registry `config/genai-endpoints.json`; `GenJob` (no tier field, `budgetUsdMicros`), `jobKey`, `GateCode` | 1.0 |
| C08 | `WorldChunk` + `RoadGraph` + spawn tables | S02 (Wave 2) | S01, S03, S06, S09, S11, S12 | sketch §4.4 → `spec/domains/02-world.md` | owner finalizes in Wave 2 | 0.x |
| C09 | `MissionScript` + `CutsceneRequest`/`CutsceneAsset` | S03 (Wave 2) | S05, S06, S07, S09, S11 | sketch §4.4 → `spec/domains/03-story.md` | owner finalizes in Wave 2 | 0.x |
| C10 | `NPCSoul` + `NPCDialogueRequest` | S04 (Wave 2) | S03, S05, S07, S08, S09, S12 | sketch §4.4 → `spec/domains/04-npc.md` | owner finalizes in Wave 2 | 0.x |
| C11 | `NetMessage` + room protocol + authority | S09 | S01, S02, S06, S07, S08, S10, S13 | `spec/domains/09-backend-contracts.md` §1 · `packages/net/src/protocol/{v2,codec}.ts` | one WebSocket per player to `rt.<domain>`; c→s binary `IN` (16 B header + n × 12 B samples + 16 B pose; u16 `SimButton` bits 0–15; brake u8 0..127), `ACK`, `BYE`, `ACT`, `CHAT`; s→c binary `SNAP` (16 B + 28 B per entity; `anim` = u8 `AnimStateId`), `EV` (evSeq, JSON ≤ 1 KiB), JSON `welcome\|handoff\|notice\|kick`; 20 Hz server tick; CAP 16 (32 by flag); 64 m interest grid, 150/300 m + 70 m; `validated` authority; tickets, resume tokens, 60 s ghosts; close codes 4001–4008 (mods active → 4007); `PROTOCOL_VERSION` 2 | 1.0 |
| C12 | API surface + identity + DB schema | S09 | S03, S04, S05, S06, S10, S12, S13 | `09-backend-contracts.md` §2, `09-backend-db.md`, `09-backend-ops.md` §3, §5 · `packages/shared/src/api/v1.ts`, `api/budget.ts`, `data-port.ts`, `identity.ts`, `db.gen.ts`, `supabase/migrations/*` | `/api/v1/*` route table #1–51 on `tha-bay-web` and `tha-bay-rooms`; `ApiError` + `HTTP_FOR`; `Idempotency-Key`; UUIDv7 ids; epoch-ms times; hosts `<domain>`, `id.`, `rt.`, `media.`, `ugc.` from `BootConfig.hosts`; identity tiers `local\|device\|linked` (P0–P3), play token `pt1.…`, ES256 JWT (`sub` = identity profile id, UUIDv7); `IdentityService`; `DataPort` (no supabase-js in the client); `BootConfig` (`assetCatalog`, `flags`, `gov`); `CutsceneStatus`; `RosterFlags`/`KillScope`; `CloudSaveRecord` (C05 `SlotId`); `PlayerQuota`, `BudgetGovernor` (USD micros); migrations 0001–0009 | 1.0 |
| C13 | `QualityTier` + budgets + device detection + platform services | S11 | S01, S02, S03, S05, S06, S07, S08, S09, S10 | `spec/domains/11-platform.md` §4 (+ §3 facade, §5.8; `11-platform-xr.md` §3–4; `11-platform-pwa.md` §4, §5, §9) · `packages/shared/src/platform/{c13,xr-comfort}.ts`, `config/tier-budgets.json` | `QualityTierId` = `desktop-ultra\|desktop\|mobile\|mobile-low\|xr-quest\|xr-visionpro`; `FLAT_LADDER`, `FLAT_TIER_OF`, `VARIANT_FALLBACK`; `TierBudget` (frame, render objects/draw cmds/tris, memory, world, crowd, sim with `aiHz` 30, boot); `TierFeatures`, `BackendPolicy`, `DynamicQuality`; `DeviceClass`, `classifyDevice`, `TierDecision`; `QualityService`; device-scoped `PlatformSettings` (incl. `telemetryConsent`); `XrComfortSettings`; facade `RendererHost`, `XrSessionController`, `XrInputRouter`, `XrMediaHost`, `XrPanel`, `FirstGestureUnlock`, `LifecycleController`, `WorldPackStore`, `PwaUpdateController`, `Telemetry` | 1.0 |
| C14 | `ModManifest` + mod sandbox API | S12 (Wave 4) | S05, S09, S10 | sketch §4.4 → `spec/domains/12-modding.md` | owner finalizes in Wave 4 | 0.x |
| C15 | Milestone + acceptance-criteria format | S13 (Wave 5) | all | `prompt-pack/03-SPEC-TEMPLATE.md` §C | verbatim headings; numbered Given/When/Then, each with its proof command or scripted device checklist; one Sonnet 5.5 session, < ~40 files; no UNVERIFIED item in an AC | 1.0 |
| C16 | `TelemetryEvent` | S09 | all emitters; S13 | `09-backend-contracts.md` §3 · `packages/shared/src/telemetry.ts` + `schemas/telemetry/`; client `packages/engine/src/platform/telemetry/` (S11) | `{name: TelemetryName, ts, sessionId (per-launch UUID, never a profile id), props ≤ 16 keys}`; `TelemetryBatch {v, build, seq0, env, events ≤ 50, ≤ 64 KiB}`; envelope `{tier: QualityTierId, deviceClass: DeviceClass, osMajor, displayMode, backend}`; closed name registry (unknown names dropped), incl. `app.*`, `perf.minute`, `err.*` (incl. `err.sim`), `tier.decision`, `storage.persist`; privacy rules; consent is device-scoped | 1.0 |
| C17 | `ExperienceDescriptor` | S12 (Wave 4) | S02, S09, S10 | sketch §4.4 → `spec/domains/12-modding.md` | owner finalizes in Wave 4 | 0.x |

### 4.3 Shared identifiers and units (fixed for every contract)

| Thing | Rule | Source |
|---|---|---|
| Quality tier | C13 `QualityTierId` only; the names `xr-standalone`, `xr-pro`, `level` are retired | C13 |
| Identity profile id | UUIDv7 minted on device; JWT `sub`; DB `profile_id uuid` | C12 |
| Save profile id | C05 `ProfileId`, 32 lowercase hex; ≤ 64 per identity; route param `:saveProfileId` | C05, C12 |
| Save slot | C05 `SlotId` verbatim on the wire (routes 16–19) and in `save_records.slot`; save profiles are upserted and tombstoned by routes 50–51 before their slots sync | C05 |
| Unlock id | C06 `UnlockEventId` (`^unlock\.`) verbatim in C05 `CoreSlice.unlocks` and DB `unlocks.unlock_id` | C05, C06, C12 |
| Persistent entity identity | C01 `StableKey`; `EntityId` never leaves a session | C01 |
| Coordinates | ENU metres from SF City Hall (+X east, +Y up, −Z north): f64 in sim, f32 on the C11 wire; lat/lng only in authored data and C17 anchors | C08, C11 |
| Angles | radians in sim; u16 yaw and i16 pitch as turns × 65,536 on the wire | C03, C11 |
| Time | sim ticks 60 Hz (u32); server ticks 20 Hz; epoch ms (integer) in wire JSON, save and IndexedDB records, catalogs, reports and telemetry; game clock in half-seconds (30 game s per real s). Logged exception (DL-059): repo-committed, human-audited files (C07 `ProvenanceRecord` timestamps, `config/genai-endpoints.json` `checkedAt`) use ISO-8601 UTC strings ending in `Z`, and `pinnedUpdatedAt` is the vendor's `updated_at` copied verbatim | C02, C06, C07, C12 |
| Money | game economy: integer cents; genAI spend: integer USD micros (`*UsdMicros`, `usd_micros`); list prices in the registry stay decimal USD | C06, C07, C12 |
| Hashes | SHA-256 lowercase hex for content, cache keys and job keys; FNV-1a-64 only for sim `stateHash` and the C05 record checksum | C02, C05, C07 |
| Canonical JSON | RFC 8785, one implementation: `packages/shared/src/json.ts` `canonicalize`; SHA-256 hex: `packages/shared/src/hash.ts` `sha256Hex` (pure, sync) | C02, C07, C09 |
| Skeleton | `bay_rig_v1` (C07 `rigFamily`, asset `rig/bay_rig_v1`), canonical bone names = C04 `HUMANOID_BONES` | C04, C07 |
| Soul version | integer, +1 per compiled soul change; DB `int` | C10 (fixed) |
| Game clock on the wire and in the DB | C06 `WorldClockState.t` integer half-seconds (`clockT` in C11 `EV World`, `npc_memory.game_time`, `DataPort.npcMemory.topK(gameTime)`); never game minutes | C06, C11, C12 |
| Player appearance on the wire | *(fixed obligation on S10, Wave 3)* `AppearanceV1` = versioned binary encoding of C05 `CoreSlice.avatar` (S10 `PlayerAvatar`), ≤ 512 B, base64 in C11 `EV Joined`/`Appearance`; vehicles on the wire are C06 prefab ids (`EV VehicleSpawn.prefabId`) | C05, C11 |
| Likeness tier | `consented` \| `parody` \| `fictionalized`; C07 adds `original` for non-person assets | R-NPC-04, C07 |
| Asset reference | every cross-domain asset reference (components, prefabs, anim clips, mode tiles, `ModeContext.assets`, souls, manifests) is a C07 `AssetRef` `<kind>/<id>`; a bare `AssetId` is unique only within its kind and never crosses a domain boundary; ECS fields intern the full `AssetRef` string in the `StringTable` | C07, C01, C06 |

### 4.4 Wave 2/4 sketches (owner finalizes in Wave 2/4)

**C08 `WorldChunk` + `RoadGraph` + spawn tables — S02, Wave 2.**
- *(fixed)* Frame per §4.3; `config/world.bounds.json` is the SF ENU bounding box used by C11 pose validation.
- *(fixed)* A chunk key is a string `z/x/y`; it is the coarsest location C16 may carry and the `?chunk=` parameter of C12 route 37. S02 defines the grid. World packs are C07 assets of kind `world_pack`, ≤ 4 MiB; their AssetId must match `^[a-z0-9][a-z0-9._-]{1,62}$`, so S02 maps keys without `/`. Ambient cell keys contain no `:`.
- *(fixed)* Per chunk: buildings in ≤ 6 render objects, one `BundleGroup`, `static = true`; one heightfield shared by physics and render; collision `StaticShapeSet` (heightfield + building prisms); drivable road-graph edges (one-way, lanes, speed, layer/bridge/tunnel) usable by A*; a separate pedestrian graph; tags `hidingSpots`, `pursuitBreakers`, `chokePoints`, `jumpZones`, `portals`, `shoreNodes`; optional `teleportNodes[]` for XR; ≤ 1 chunk upload per frame.
- *(fixed)* Spawn tables keyed by `(cellKey, slot)` with a per-tier `densityCap`, so a lower tier runs a prefix of slots (C01 rule 5).
- Draw distance and far field per C13 tier (impostor ring 80 km desktop; skyline cards elsewhere); LOD ladder; landmark glTFs replace their extrusions (A-05).

**C09 `MissionScript` + `CutsceneRequest`/`CutsceneAsset` — S03, Wave 2.**
- Mission IR: TypeScript authoring compiled to JSON IR validated by JSON Schema (A-02). Ops run as C06 `SimScheduler` threads; zones resolve to ENU `ZoneShape` at load; mode hooks call `ModeContext.startChild` with `unlockOnFirstEncounter` and a `stub` objective fallback; checkpoints `{schema, data}` are stored opaque in C05 `StorySlice.activeMission`; time and weather locks go through `WorldClockApi.lock`.
- *(fixed)* Cache key (A-03) = SHA-256 of canonical JSON of `{templateId@ver, characters[{id, soulVersion, likenessTier}], move, stage, style@ver, endpointId@pinnedUpdatedAt, seed, inputHashes}`, computed with `canonicalize` (`packages/shared/src/json.ts`) and `sha256Hex` (`packages/shared/src/hash.ts`, pure and synchronous); licence status is not in the key.
- *(fixed)* Status via C12 route 27 → `CutsceneStatus` (`ready\|pending\|absent\|failed\|blocked`). Ready means R2 `cutscenes/<key>/manifest.json` exists; it is written last and lists renditions `v540`, `v768`, `v1080` (CMAF MP4) or, on the container-failure path only, `p720` (progressive 720p MP4, with `degraded: true`), `a.m4a`, `poster.webp`, `last.webp`, `subs.<lang>.vtt`, `characters[{id, soulVersion, tier}]`, a `licence` block, `provenance.aiGenerated: true` and `degraded?`. Originals stay in PRIVATE `cutscenes-orig/<key>/`.
- *(fixed)* S03 exports `PreparedClip` for C13 `XrMediaHost.prepare` with at least `{ key: string; source: { kind: 'element'; video: HTMLVideoElement } | { kind: 'decoder'; url: string; codec: string }; width: number; height: number; durationMs: number; cues: { startMs: number; endMs: number; text: string }[]; degraded: boolean }` (DL-061).
- *(fixed)* A release `cutscene-index` (CutsceneRef → key) feeds `cutscene_catalog`; generation is internal-only (catalog, staff, CI). `CutscenePlayer` reuses S11 `FirstGestureUnlock` (pool of 3 video elements) and `XrMediaHost`; the in-engine director fallback always exists (R-CUT-03); generated clips carry the AI label.

**C10 `NPCSoul` + `NPCDialogueRequest` — S04, Wave 2.**
- soul.md = YAML frontmatter + markdown sections. Frontmatter at least: `id` (= C07 asset slug), `name`, `tier`, `soulVersion` *(fixed: integer)*, `voice {tier, design_prompt}`, `tags`, `stats`, `relations`, `locations`, `schedule`, `rails`, `visual_brief` (text only, never photographs), `standIn` (AssetRef of an `original` asset), `moves` (Meshy action ids), `heightM`, `minor?`.
- Compiled soul exposes `assets.*` as C07 AssetRefs (`assets.rig = rig/bay_rig_v1`, `assets.anim`); the cached prompt prefix lives in PRIVATE `souls/<id>/<ver>/soul.prompt.txt`, never in a public bucket.
- *(fixed)* `NPCDialogueRequest = { npcId, encounterId?, soulVersion, turn: { text?, intent? }, context, maxTokens }`. No client `history[]`: history is server-held in `EncounterDO`.
- *(fixed)* Response on C12 route 31 is SSE with events `meta`, `line.delta`, `line.done`, `effects` (`{action?, mood?, memoryWrite?}`), `fallback`, `done`; no first token within 4 s → `fallback`; kill-switch through `RosterFlags`.

**C14 `ModManifest` + mod sandbox API — S12, Wave 4.**
- `{ id, name, version (semver), author, kind: 'experience'|'vehicle'|'character'|'rules', tier: 'data'|'script'|'ui' (D-26), entry, permissions[], assets[], provenance, compat }`.
- *(fixed)* `permissions[]` is a closed enum and publish fails closed on unknown values; every entry in `assets[]` carries a C07 `ProvenanceRecord`; `dv mod check` reuses the `tools/ci` validators.
- `ModAPI` is typed and versioned and is a capability-filtered `ModeContext` (C06 rule 7). Script mods run in a QuickJS-wasm Worker; UI mods run in an opaque-origin iframe, whose COEP `require-corp` compatibility is risk R-S11-05. Mod save data uses C05 `mod:<id>` slots (sandbox only); mod components use ids 2048–4095.
- *(fixed)* The runtime exposes `modsActive(): boolean`; C11 `AssignReq.modsActive` must be false (otherwise close 4007). Publishing goes through C12 route 36 (P2, CLI device token `mods:publish`).

**C17 `ExperienceDescriptor` — S12, Wave 4.**
- *(fixed)* `{ id, modId, modVersion, anchor: { lat, lng, chunkKey }, radius, entryRules, rating: { sum, count }, moderation, visibility }`. `anchor` carries both lat/lng and `chunkKey`; `radius ≤ 250 m`; `moderation` and `visibility` are server-owned and read-only to clients.
- Listing uses C12 route 37 (`?chunk=` or `bbox=`); anchors are checked against SF land, right-of-way and parcels; markers render on the map (S02, S10).

## 5. Conventions
- **Repository layout** (spec/03 A-01, amended 2026-10-18; tree and one line per package in `spec/02-architecture.md` §2):
  - `apps/web`
  - `packages/{shared, engine, world, net, identity, npc, ui, mod-sdk, modes/{story,racing,fighter,tycoon}}`
  - `services/{edge, rooms, pipeline}`
  - `tools/{map, assets, ci, cli, ops}`
  - root data folders `config/`, `content/` (authored data and prompt templates), `assets/` (lock file, provenance records, prefabs), `supabase/` (migrations, pgTAP), `tests/` (cross-package e2e, staging, load, ops)
  - `docs/` (incl. `docs/decisions/`, `docs/legal/`), `spec/`, `research/`, `prompt-pack/`
- **Package names**: `@dv/<dir>` (`@dv/shared`, `@dv/engine`, `@dv/identity`, …), `@dv/mode-<id>` for modes, `@dv/web`, `@dv/edge`, `@dv/rooms`, `@dv/pipeline`. The CLI binary is `dv`.
- **Purity and import direction**:
  - `packages/shared` is pure and deterministic, and the C02 lint covers all of it: types, constants and pure functions only, with no IO, clocks, randomness, DOM or `three`.
  - IO lives in `packages/engine` (client and workers), `packages/net`, `packages/identity`, `services/*` and `tools/*`.
  - Apps import packages and services; packages never import apps; sim code never imports `three`, `packages/engine/src/client/**` or DOM types.
- **Scripts** (root `package.json`; S13 consolidates them in `spec/08-test-and-ci.md`):
  - CI gates are `pnpm check:*`: `check:unit [-- <paths>]`, `check:e2e [-- --project=<p> --grep @tag]`, `check:e2e:xr`, `check:perf [-- --scenario <id>]`, `check:workers [-- <suite>]`, `check:pipeline`, `check:db`, `check:db:types`, `check:api`, `check:headers`, `check:coi`, `check:bundle`, `check:assets`, `check:secrets`, `check:telemetry`, `check:prod-routes`, `check:do-migrations`, `check:c2pa`, `check:smoke` (post-upload smoke against a version override, `09-backend-ops.md` §2).
  - IP gates are `provenance:check`, `ip:*` (incl. `ip:history`, full-history scan before the repo is public), `license:scan`, `names:lint` and `likeness:gate`, each with a `check:*` alias. Vendor-terms drift is `genai:terms-watch`.
  - Package-local `pnpm --filter @dv/<pkg> test[:suite]` is allowed when `check:unit` also runs it.
  - Device checks: `perf:verify`, `perf:checklist`. Special suites: `test:staging`, `test:ops`, `load:rooms`. Deploy: `deploy:preview`, `deploy:prod`, `deploy:bootstrap`, `db:push`, `auth:tpa`, `rooms:drain`. Content: `assets:*`, `genai:*`, `map:*`.
  - Playwright projects: `chromium-webgpu`, `chromium-webgl2`, `webkit-webgl2`, `xr-quest3`.
- **Build and QA flags**: `VITE_DV_QA=1` (dev, test, preview) enables URL flags, debug tools and `window.__dvBridge`; production builds ignore every URL flag.
- **Browser storage**: prefix `dv-`, i.e. IndexedDB `dv-saves` (C05), `dv-packs`, `dv-platform`, `dv-identity` (C12 `LocalIdentity`: identity profile id and the non-extractable device key); OPFS `dv/packs/<sha256>.bin`; `localStorage['dv.hb']`; `BroadcastChannel('dv-instance')`.
- **Cloudflare names**:
  - Workers `tha-bay-web` and `tha-bay-rooms` (`-staging`).
  - Buckets `tha-bay-media-<env>`, `tha-bay-private-<env>`, `ugc-staging-<env>`, `ugc-public-<env>`, `ugc-quarantine-<env>`, `legal-evidence-<env>`.
  - Hosts come from `BootConfig.hosts` and are never hard-coded.
  - All caps, ceilings and alert thresholds live in `config/guardrails.yaml`.
- **IDs**:
  - R-IDs as in §2. Contracts `C##`. ADRs `ADR-NNNN-slug`. Subagents `S##`. Risks `RISK-NN`.
  - Milestones `M##` + letter for a separate scope (M04c) + digit for a session split of one scope (M11b1, M11b2); the live list is in `spec/00-plan.md`.
  - Open questions `Q-NN`: Q-01–Q-12 are the owner defaults in `spec/00-plan.md`, and Q-13 onward are in `spec/99-open-questions.md`. Domain-local ids (`Q-ENG-…`, `Q-BE-…`, `DN-S11-…`, `DN-S05-…`) are settled in `spec/11-decision-log.md`.
  - Alert ids `A##` and `SP-##` (S09).
- **Asset keys** (C07):
  - immutable `<root>/<variant>.<sha256[0:12]>.<ext>`;
  - cutscenes `cutscenes/<key>/…` (manifest written last);
  - public character parts `characters/<slug>/{model,anim,portrait,mouth_atlas}/` (no per-character rig; the family rig is `rig/bay_rig_v1` at `assets/rig/bay_rig_v1/`); sheets stay private in `sheets/<slug>/`.
- **Branches**: `m##-slug` per milestone; conventional commits; PR per milestone (optional).
- **Facts**: any statement about an external system carries `[research/<file>.md]`, `F-NNN` or `UNVERIFIED`.
- **Text**: Mermaid for diagrams; TypeScript for types; JSON Schema only for runtime-validated data (soul.md frontmatter, mod manifests, mission IR, save records, provenance records, perf reports).
- **Display name**: `config/brand.ts → DISPLAY_NAME` (rename-ready; R-IP-01).

## 6. Glossary
Architect (Opus 5.5 orchestrator) · Builder (Sonnet 5.5 implementer) · Domain spec (one subagent's output) · Contract (C##) · Tier (C13 quality tier) · Render object (a draw-producing scene node, the unit of D-09 budgets) · Chunk (streamed world tile) · World pack (C07 `world_pack` asset holding chunk data) · Catalog (immutable C07 `AssetCatalog`; the pointer ships with the Worker) · Lock file (`assets/assets.lock.json`, the release gate) · Provenance record (per-file origin, licence and generator record) · Stand-in (original asset that replaces a killed character) · Kill-switch (roster flag that removes a character live in ≤ 60 s) · Soul (soul.md) · Encounter (one server-held NPC conversation, `EncounterDO`) · Cache key (deterministic cutscene identity, A-03) · Job key (deterministic genAI job identity) · Governor (`BudgetGovernorDO` levels L0–L3) · Identity profile (account, UUIDv7) · Save profile (C05 profile, 32-hex) · Slot / slice (C05 record unit / its data kind) · Play token (P0 HMAC token) · Ticket (30 s room-join token) · Ghost (a dropped socket's held slot) · Resume token · Canonical profile (cross-browser deterministic sim) · Experience (published UGC loaded in a sandbox) · Heat (pursuit level) · Frame data (fighter timing) · Round (tycoon fundraising event) · Wave (orchestration phase) · R2 (Cloudflare object storage) · DO (Durable Object) · PWA · WebXR · TSL (Three Shading Language) · OPFS (Origin Private File System).

## 7. Owner updates log
- 2026-10-18: SF-accurate-first; rest of the Bay later (R-MAP-01/02).
- 2026-10-18: sharkpaw/Grand-V (Turkish launcher/mod store/relay) added as example repo; use its logic patterns, translated; IP line unchanged.
- 2026-10-18 (v0.95, Phase 0 research): R-AUTH-01/03, R-ROLL-02, R-CUT-01, R-MODE-03, R-IP-01, R-IP-04 and C12 amended per spec/03-decisions-and-facts.md (D-02…D-05, D-24, D-30, A-07, A-08). Package layout per spec/03 A-01 supersedes §5's draft list.
- 2026-10-18 (**v1.0, frozen after Wave 1**): §4 replaced by the frozen contract index (C01–C07, C11–C13, C15, C16 at 1.0; C08–C10, C14, C17 as aligned sketches for their Wave 2/4 owners). Reconciled: C13 six tier ids everywhere; C05 slot model adopted by C12 cloud saves; C11 keeps u16 buttons and gets brake 0..127 plus `AnimStateId`; C11 contract version 1.0.0 (wire protocol 2); C07 content-hashed keys, single asset catalog, `bay_rig_v1`; genAI job types and stage order owned by S05 inside C07; AI fixed at 30 Hz; `PlatformSettings` and telemetry consent device-scoped; XR comfort in C05; `immersive-vr` only; telemetry client in `packages/engine`; A-01 amended (`packages/identity`, `tools/ops`, root `content/`, `assets/`, `supabase/`, `tests/`). R-AUTH-01 and R-MAP-03 wording aligned with M12a and D-25; non-goal "no passthrough AR in v1" added. Details and reasons: `spec/11-decision-log.md` 2026-10-18 entries.
- 2026-10-18 (v1.0 corrections, still frozen at 1.0): consistency-check fixes DL-051…DL-076 — `AssetRef` for every cross-domain asset reference; identity and budget types in `@dv/shared` (C11 is the one contract outside shared); game clock in half-seconds on the wire; epoch-ms rule with a logged exception for provenance/registry files; save-profile routes 50–51 and `unlock_id`; C09 fixed lines for `PreparedClip`, `p720` and the `canonicalize`/`sha256Hex` helpers; `SimControlMessage save.request`; NetIn/NetOut in `sim.worker`; no per-character rig; `check:smoke`, `dv-identity`, `AppearanceV1` obligation on S10.

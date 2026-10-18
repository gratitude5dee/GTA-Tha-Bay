# 06 — SHARED CONTEXT · canonical requirements, interface contracts, conventions, glossary

> Version 0.95 (Architect, end of Phase 0: research amendments applied; see §7). Was 0.9 (pre-architect). The Architect freezes v1.0 after Wave 1 and bumps the version on every contract change. Every subagent reads this file first. Every spec statement cites an R-ID. Contracts here are *shapes*; the named owner finalizes the TypeScript in `spec/04-data-models.md`.

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
- R-AUTH-01 v1 launches with no sign-in: a local profile (device-bound, HMAC play token) with cloud sync deferred to P1 (M12). Auth phases: P0 local → P1 device-registered → P2 ChatGPT link → P3 Thirdweb (spec/03 D-04).
- R-AUTH-02 Thirdweb sign-in (in-app wallet / social / email) is integrated LAST; the codebase isolates identity behind one interface so adding it is one milestone.
- R-AUTH-03 Optional ChatGPT linkage exists solely to enable the modding/publishing flow (R-MOD-02); it is never required to play. Website Sign-in-with-ChatGPT is a partner trial, so the shipped path is bring-your-own agent (Codex CLI signed in with ChatGPT) plus device-code publish login (spec/03 D-05).

**Rollout**
- R-ROLL-01 Milestone order: hosted single-player with storyline, tested on Cloudflare, before any multiplayer.
- R-ROLL-02 Multiplayer open world via realtime functions: authoritative rooms and presence on Cloudflare Durable Objects; persistence on Supabase (G1; Convex documented alternative).

**World / map**
- R-MAP-01 Accurate San Francisco first: real street grid, neighborhoods, landmarks, hills, waterfront, bridges as world boundaries/portals; players recognize where they are. (owner update 2026-10-18)
- R-MAP-02 Rest of the Bay (Oakland/East Bay, Peninsula, South Bay) as later expansion milestones; v1 renders them as low-detail backdrop.
- R-MAP-03 In-app full map and minimap (Mapbox CLI/GL JS or the alternative chosen by ADR), with mission markers, player-published experiences, and fast travel where the story allows.
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
No native app stores. No full-detail East Bay/Peninsula (backdrop only). No user-authored code running inside multiplayer rooms (mods are personal/sandboxed until a later vetting milestone). No real-money or token economy. No voice cloning of real people. No photoreal likeness generation for non-consented people. No server-side rendering of the 3D scene.

## 4. Interface contracts (owners finalize; everyone honors)

| # | Contract | Owner | Consumers | Shape (v0 sketch) |
|---|---|---|---|---|
| C01 | `EntityId` + ECS conventions | S01 | all | `type EntityId = number` (dense, recycled); components as typed arrays/structs; systems ordered by `GameLoop` phase |
| C02 | `GameLoop` phases | S01 | all | `input → netIn → sim(fixed dt) → anim → audio → render → netOut`; fixed-step sim at 60 Hz with interpolation |
| C03 | `InputAction` map | S01 | S06,S07,S10,S11 | `enum Action { Move, Look, Jump, Interact, Sprint, Attack, Block, Special, Enter, Brake, Handbrake, Nitro, Pause, Map, Camera, … }`; binders per platform (kbm, gamepad, touch, xr-controller, xr-hand, pose) |
| C04 | `CameraRig` | S01 | S02,S03,S06,S07 | `mode: 'fp' | 'tp' | 'cinematic' | 'xr'`; `follow(target, params)`; collision; shoulder offset; XR passthrough rules |
| C05 | `SaveGame` | S01 | S09,S10,modes | `{ version, profileId, story: {act, missionsDone[], flags}, unlocks: Mode[], garage[], inventory, npcRelations{}, settings, stats, modes: {racing:{}, fighter:{}, tycoon:{}}, checksum }`; migrations by version |
| C06 | `GameMode` | S01 | S06,S07,S08,S10 | `{ id, unlockEvent, enter(ctx), exit(), tick(dt), ui(), saveSlice() }` |
| C07 | `AssetManifest` + addressing | S05 | S02,S03,S04,S06,S07,S11 | `assets/<kind>/<id>/<variant>.<ext>`; manifest `{ id, kind, variants: {tier: {url, bytes, hash}}, provenance: {source, license, generator, promptHash}, deps[] }` |
| C08 | `WorldChunk` + `RoadGraph` + spawn tables | S02 | S01,S03,S06 | tiles keyed by `z/x/y` in a local metric CRS anchored at SF; chunk = {buildings glTF, roads mesh, terrain, props, nav/road graph edges, spawn tables}; LOD ladder |
| C09 | `MissionScript` + `CutsceneRequest`/`CutsceneAsset` | S03 | S07,S09,S05 | script = typed JSON (triggers, objectives, states, dialogue refs, cutscene refs, rewards); cutscene key = `sha256(template@ver | characters | move | stage | style@ver)` → R2 `cutscenes/<key>.mp4` + poster |
| C10 | `NPCSoul` + `NPCDialogueRequest` | S04 | S03,S07,S08,S09,S12 | soul.md = YAML frontmatter (id, name, tier, voice, tags, stats, relations, locations, schedule, rails) + markdown sections; request = `{ npcId, playerId, context, history[], intent?, maxTokens }` → streamed text + `{ action?, mood?, memoryWrite? }` |
| C11 | `NetMessage` + room protocol + authority | S09 | S01,S02,modes | envelope `{ t: type, seq, tick, payload }`, binary-packed; server-authoritative movement with client prediction for local player; interest radius; 15–20 Hz snapshots (final by ADR) |
| C12 | API surface + DB schema | S09 | S10,S12,S04 | REST/RPC under `/api/v1/*` on Workers; room/presence sockets on DOs; DB schema in `spec/04`; auth phases P0 local → P1 device-registered → P2 ChatGPT link → P3 Thirdweb (D-04); identity = Worker OIDC issuer (D-03) |
| C13 | `QualityTier` + budgets + device detection | S11 | S01,S02,S05 | `tier: 'mobile' | 'desktop' | 'xr-standalone' | 'xr-pro'`; budgets table (tris, draw calls, texture MB, JS heap, streaming radius, target fps) |
| C14 | `ModManifest` + mod sandbox API | S12 | S10,S09 | `{ id, name, version, author, kind: 'experience'|'vehicle'|'character'|'rules', entry, permissions[], assets[], provenance, compat }`; mods run in a sandbox (worker/iframe) against a typed, versioned `ModAPI` |
| C15 | Milestone + acceptance-criteria format | S13 | all | see `03-SPEC-TEMPLATE.md` |
| C16 | `TelemetryEvent` | S09 | all | `{ name, ts, sessionId, props }`; privacy-safe; sampled |
| C17 | `ExperienceDescriptor` (published UGC on the map) | S12 | S02,S10 | `{ id, modId, anchor: {lat, lng} | chunkKey, radius, entryRules, rating, moderation }` |

## 5. Conventions
- **Packages** (spec/03 A-01; ADR-0001 in Wave 5): `apps/web` (PWA shell), `packages/shared` (types, detmath, ids), `packages/engine`, `packages/world`, `packages/net`, `packages/npc`, `packages/ui`, `packages/mod-sdk`, `packages/modes/{story,racing,fighter,tycoon}`, `services/edge` (Workers, API, non-room DOs), `services/rooms` (room DOs, separate Worker), `services/pipeline` (genAI workflows), `tools/{map,assets,ci,cli}`, `config/`, `spec/`, `docs/`, `research/`, `prompt-pack/`.
- **IDs**: R-IDs as above; contracts `C##`; ADRs `ADR-NNNN-slug`; milestones `M##-slug`; subagents `S##`; risks `RISK-NN`; open questions `Q-NN`.
- **Asset keys**: `assets/<kind>/<id>/<variant>.<ext>`; cutscenes `cutscenes/<sha256>.mp4`; characters `characters/<slug>/{sheet,model,rig}/…`.
- **Branches**: `m##-slug` per milestone; conventional commits; PR per milestone (optional).
- **Facts**: any statement about an external system carries `[research/<file>.md]` or `UNVERIFIED`.
- **Text**: Mermaid for diagrams; TypeScript for types; JSON Schema only for runtime-validated data (soul.md frontmatter, mod manifests, mission scripts, save games).
- **Display name**: `config/brand.ts → DISPLAY_NAME` (rename-ready; see R-IP-01).

## 6. Glossary
Architect (Opus 5.5 orchestrator) · Builder (Sonnet 5.5 implementer) · Domain spec (one subagent's output) · Contract (C##) · Tier (quality tier) · Chunk (streamed world tile) · Soul (soul.md) · Cache key (deterministic cutscene identity) · Experience (published UGC loaded in sandbox) · Heat (police pursuit level) · Frame data (fighter timing: startup/active/recovery) · Round (tycoon fundraising event) · Wave (orchestration phase) · R2 (Cloudflare object storage) · DO (Durable Object) · PWA · WebXR · TSL (Three Shading Language).

## 7. Owner updates log
- 2026-10-18: SF-accurate-first; rest of the Bay later (R-MAP-01/02).
- 2026-10-18: sharkpaw/Grand-V (Turkish launcher/mod store/relay) added as example repo; use its logic patterns, translated; IP line unchanged.
- 2026-10-18 (v0.95, Phase 0 research): R-AUTH-01/03, R-ROLL-02, R-CUT-01, R-MODE-03, R-IP-01, R-IP-04 and C12 amended per spec/03-decisions-and-facts.md (D-02…D-05, D-24, D-30, A-07, A-08). Package layout per spec/03 A-01 supersedes §5's draft list.

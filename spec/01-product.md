# 01 — Product

> v1.0 · Wave 5 integration (author `product-traceability`) · 2026-10-18. For a builder who has never seen the owner's brief. Binding inputs: `prompt-pack/06-SHARED-CONTEXT.md` v1.2 (frozen; R-IDs, contracts, conventions), `spec/03-decisions-and-facts.md` v2, `spec/.wave5-notes.md`, the owner decisions DL-OWN-01 and DL-OWN-02, and the domain specs. Facts carry `F-NNN` (`research/INDEX.md` §2) or `[research/<file>.md]`. The traceability matrix (§13, now `spec/01-product-trace.md`, DL-531) is S13's seed matrix (`spec/domains/13-qa-trace.md` §2) with the corrections of DL-217; from M00d on, `tools/ci/trace.ts` regenerates it into `tests/reports/trace.md` and this section copies that report.

## 1. The product in one paragraph
An original, story-driven open-world game in an accurate, recognizable San Francisco. The shipped name is one config value, `config/brand.ts → DISPLAY_NAME`, default "Dee-Verse: Tha Bay"; the franchise word in the repository codename never ships (R-IP-01, A-07, F-067). It runs as an installable Progressive Web App hosted on Cloudflare Workers, on desktop and iPhone-class phones, and as a full WebXR port on Meta Quest 3/3S and Apple Vision Pro. Single-player story comes first, multiplayer rooms later (R-ROLL-01). Three sub-games (racing, the Culture Wars fighter, a business tycoon) are met inside the story and then unlock as standalone modes. NPCs are AI characters driven by `soul.md` files; players can build their own NPCs. Cutscenes are generated once, cached and always backed by an in-engine version. Players mod the game with their own coding agent and publish experiences that appear on the city map. The rest of the Bay Area follows after v1.

## 2. Player fantasy
You are **Coast** (the default name and callsign from `content/ui/creator/defaults.json`, so the player renames it; DL-OWN-05), a mechanic raised at a Bayview shipyard called the Yard. A robotaxi company is buying the right to San Francisco's curbs at a fictional Curb Allocation Board auction. You find its prototype curb-mapping *Atlas pod* in a stalled robotaxi, and its data shows the auction was rigged. The campaign *Hella Valuation* (Q-07) turns you into the most wanted driver in the city, and you win by exposure, not violence: tow, race, sneak, photograph, broadcast, testify (`03-story-narrative.md` §B1).

What the player should feel:
- **"I know where I am."** Real street grid, hills, neighbourhoods, waterfront and landmarks, built from open data (D-14). Filbert Street is steep, Ocean Beach is foggy, the Bay Bridge is the edge of the world in v1.
- **Hyphy car culture against hypergrowth.** Warm, comic and satirical in tone. Sideshows, pursuits and robotaxi jailbreaks, never firearms, gore, drug use or sexual content (Q-06, D-30). Pursuits end in busts and fines, never deaths.
- **A city that talks back.** Named NPCs answer in character through an LLM, remember the player within retention limits, and fall back to authored lines when offline (R-NPC-05, D-21, D-22).
- **Many games in one city.** The story hands the player a race, a fight and a startup; each then lives on as its own mode.
- **The city is yours to extend.** A player with a local coding agent (Claude Code, or Codex signed in with ChatGPT) can make a mod, test it locally and publish an experience to a pin on the map through device-code publish login (R-MOD-01…04, ADR-0018; publicly from M14a unless OpenAI grants a web client, Q-38). Modding with only a ChatGPT sign-in and no local agent (the website flow and the no-agent Studio, flow B) is not in v1 and waits on Q-38 (§8; §11 reading of R-MOD-02).

## 3. Platforms
One codebase, one `WebGPURenderer` (`three@0.186.1`, F-001) that falls back to WebGL2 by itself (F-002, D-07); materials are TSL only. The tier is chosen per device from six C13 `QualityTierId`s: `desktop-ultra`, `desktop`, `mobile`, `mobile-low`, `xr-quest`, `xr-visionpro` (`11-platform.md` §4).

| Platform | Target | Notes |
|---|---|---|
| Desktop browsers (Chrome, Safari 26+) | `desktop`, `desktop-ultra` | keyboard and mouse or gamepad; WebGPU with WebGL2 fallback; the guaranteed CI path is `chromium-webgl2` (F-062) |
| iPhone, Home Screen web app or Safari tab | iPhone 15 floor at `mobile-low`, 30 fps; iPhone 16/17 at `mobile`, 60 fps (Q-10, R-PLAT-05) | primary mobile target (R-PLAT-01). Safari 26 ships WebGPU and opens Home Screen sites as web apps (F-004). No install prompt (coach mark instead), fullscreen, orientation lock, vibration or Pointer Lock (F-011); WebContent is killed near 2 GB (F-009); storage can be evicted (F-010), so OPFS is a cache, never the only copy |
| Meta Quest 3 / 3S, Quest Browser | `xr-quest`, 72 Hz (90 when frame time allows) | full `immersive-vr` port; WebGL2 backend with multiview (D-07); budgets from F-013 (72 Hz minimum, < 200 draw calls, < 1.5 M triangles); WebGPU XR there is experimental only (F-005) |
| Apple Vision Pro, visionOS 26.2+ | `xr-visionpro`, 90 Hz | Safari 26.2 WebXR supports WebGPU (F-005); WebGL2 fallback |

Out of scope for v1: native app stores, `immersive-ar` passthrough, PC VR and Quest Link as accepted targets, Android XR, Pico, iPhone 120 Hz, Web Push (`11-platform.md` §1). Chromium on Android installs the PWA (`11-platform-pwa.md` §3) and runs at its classified tier, but no Android device is in the v1 device matrix (`spec/08-test-and-ci.md` §3.2). Input: keyboard and mouse, gamepad, touch, XR controllers and hands, all through remappable C03 bindings; the fighter adds optional on-device camera pose control (R-MODE-03, D-24). First- and third-person cameras switch at any time outside cutscenes (R-PLAT-04).

Hosting is Cloudflare only until M05d: Workers with static assets, Durable Objects, R2, Queues and Workflows (D-01; resources created, DL-OWN-02). Supabase Pro `us-west-1` (G1, D-02) becomes the data spine at M05d. v1 is US-only behind a geo-gate (A-10).

## 4. Modes and unlocks
Four modes share one world, one save profile and the C06 mode contract. Mode state lives in its own save slot (`mode:<id>`, C05); the main menu shows a tile per mode with its lock state (R-UI-03).

| Mode | What it is | Unlocked by | Spec |
|---|---|---|---|
| **Story** | *Hella Valuation*: 26 missions in three acts (Act 1 "Jump Start", 12 missions, SF districts D1–D4 and D6; Acts 2–3, 14 missions), each intro → objectives → fail or success → rewards; wanted system with heat, economy in integer cents, safehouses, garage and property (R-MODE-01). Free roam between missions | New Game | `03-story*.md`; `01-engine-save-modes.md` PursuitDirector |
| **Racing** | sprint, circuit, pursuit and seven more race kinds on real SF streets; classes D/C/B/A/S/R; police pursuits with heat levels, roadblocks and spike strips; supercars, robotaxis and a rocket roadster as fictional makes (R-MODE-02; INDEX §4 rule 15) | `unlock.racing`, first racing hook in mission `m.a1.03` | `06-racing*.md` |
| **Culture Wars** | 1v1 2.5D fighter: rounds, Health and Hype meters, specials, EX, supers, the Showstopper, the gore-free Shutdown finisher, frame data; 8 fighters in v1 (DL-174) on SF landmark stages; optional MediaPipe pose control with calibration and pad/touch/key fallback (R-MODE-03) | `unlock.fighter`, mission `m.a1.05` | `07-fighter*.md` |
| **Business Tycoon** | deterministic weekly founder-versus-VC sim: idea, MVP, rounds with cap-table math, hiring, scale, exit or failure; AI-NPC investors in pitch meetings; random events (business, political, natural, cultural) with probability and impact; presets `standard`, `mini8w`, `daily` (R-MODE-04) | `unlock.tycoon`, mission `m.a2.01` | `08-tycoon*.md` |

**Unlock rules (R-MODE-05, `03-story-narrative.md` §B7).** A mode unlocks the first time the story reaches its hook, whether the real mode or the stub plays. Unlock ids are C06 `UnlockEventId`s stored sorted in `CoreSlice.unlocks`; the event is idempotent. Further unlocks: one per district (`unlock.district.d1…d10`), fighters per mission pass (a killed real-derived slot grants its stand-in), racing events and the robotaxi class. A-06: a mode whose milestone has not shipped shows `comingSoon` even when unlocked. New Game creates a new save profile, so unlocks never leak between runs (DL-141).

**Vertical slices.** VS-Story = M05c2 (Act 1; racing and fighter reachable through stub hooks as `comingSoon`, tycoon locked until its Act 2 hook `m.a2.01`, M09b2, DL-391; opens the R-ROLL-01 gate), VS-Racing = M07a2, VS-Fighter = M08a2, VS-Tycoon = M09a2 (`spec/07-milestones/_PLAN.md` §3).

## 5. Rollout P0 → P3
The phases are the identity phases of D-04; each widens what a player can do without changing the game underneath (`spec/05-api-and-realtime.md` §2).

| Phase | Identity | What the player gets | Milestones |
|---|---|---|---|
| **P0 local** | no sign-in; device-bound profile, HMAC play token (R-AUTH-01) | the whole single-player game on Cloudflare: story, three modes, AI NPC dialogue, cutscenes, XR, the text NPC builder (private) | M00…M11b4 (blocks A–E); data spine M05d |
| **P1 device-registered** | ES256 JWT from the Worker issuer (D-03); 18+ attestation, every under-18 bracket blocked (DL-139) | cloud saves, multiplayer rooms (cap 16, 20 Hz, `validated` movement), presence and invites, leaderboards, forum, image uploads for the NPC builder | M12a1…M12e (rooms only after M05c2 passes on staging, R-ROLL-01) |
| **P2 linked** | ChatGPT web (flag, if granted; else public publishing waits for M14a, GitHub spike-only, DL-342); Codex-with-ChatGPT for authoring; device-code publish login (R-AUTH-03, ADR-0018, Q-38) | publishing mods, experiences and NPCs through moderation; never needed to play | M13a1…M13d2 |
| **Public launch** | P0–P1 (P2 publishing staging/private-to-owner until M14a or an OpenAI grant, Q-38) | release gate: DoD, guardrails, device pass, counsel sign-offs (Q-18, Q-21, Q-23) | M14c, M14b1…M14b3 (DL-211) |
| **P3 Thirdweb** | SIWE wallet link, identity only (R-AUTH-02) | cross-device sign-in and recovery | M14a, the last v1 milestone |
| **Bay expansion** | — | Oakland, Berkeley–Richmond, Marin, Peninsula, South Bay | M15a…M15g (post-v1) |

Online fighting is not in v1: the transport is decided by ADR-0028 after the M12c load test (DL-204). Mods never run in rooms (C14 `modsActive()`, close code 4007).

## 6. AI NPCs and the NPC builder
**Roster (R-NPC-01).** Named NPCs are modeled on Bay Area tech founders, influencers and cultural legends, each defined by a `soul.md` (C10 `soul/1.0`) plus reference images. Real people appear only through the name registry and a likeness tier: living people `parody`, the deceased and founders of real companies `fictionalized`, `consented` only with a consent record (D-29, G2). Every real-derived character has an authored stand-in; the kill-switch removes a character live within 60 s (R-NPC-04, ADR-0013). The research layer and real-derived souls live in a private mount (`content-private/`, Q-19, Q-25); development uses original characters.

**Pipeline (R-NPC-02).** Reference sheet → multi-image-to-3D T-pose → auto-rig → animation retarget → glTF in R2 with provenance and QA gates, all on fal.ai endpoints listed in `config/genai-endpoints.json` (D-18, F-044, F-045). Only 8 Standard fighter models and 12 Lean bodies are generated; everyone else uses creator-kit bodies (DL-OWN-01, DL-180, Q-27).

**Dialogue (R-NPC-05).** The browser never holds a key: dialogue goes through the Worker and AI Gateway to `claude-haiku-5-5` (heroes `claude-sonnet-5-5`), with a cached soul prefix, server-held history in `EncounterDO`, per-player quotas and a budget governor (D-21, D-28; F-034, F-035). If no first token arrives within 4 s, an authored ink line plays. Every NPC carries an "AI character" badge (F-038); the model never writes numbers or decides mission outcomes (C10). Voices are Workers AI Aura (t1) by default (F-025, Q-20); no real-voice clones (D-23).

**NPC builder (R-NPC-03, `04-npc-builder.md` §C1).** P0: basics, backstory (≤ 20,000 characters) → soul through structured output, voice pick from synthetic voices, preview chat (20 turns per draft per day), five automatic safety probes; the NPC stays private. P1: up to six reference images, which only ever become text descriptions. P2: submit to moderation and publish (publicly from M14a unless OpenAI grants a web client, Q-38). The look is a creator-kit body preset; custom 3D for a user NPC exists only through an owner-approved staff queue counted against the fal buffer (DL-175, DL-205).

## 7. Cutscenes
Hooks (R-CUT-02): story beats; fight walk-in and face-off per matchup; special, Showstopper and Shutdown per character and move; fight ending per winner; racing event intros (SHOULD). Each hook is a C09 `CutsceneRef` with a deterministic cache key (A-03); a clip is generated at most once per key, through the backend only, stored in R2, labelled AI-generated and played from the cache (R-CUT-01, D-19). The target model is MiniMax H3 Max Turbo on fal.ai, gated by ADR-GENAI-01: its licence excludes the USA (F-041), so no provider is `cleared` today and production uses the registry fallback chain or nothing (A-08, Q-03, Q-30). Every ref has a `DirectorScript` that plays in-engine with subtitles, so the game never waits on generation (R-CUT-03). Of 155 indexed refs, the baseline generates 46 clips (≈ 398 s, ≈ $37.6): Act 1 story, fighter finishers and face-offs; the rest stay in-engine in v1 (DL-173, `spec/10-cost-model.md` §5). If no provider clears before M05c3, nothing is spent and Act 1 ships fallback-only.

## 8. Modding and UGC
**Personal mods (R-MOD-01).** Three tiers: data (JSON Schema, no code), script (QuickJS in the lazy `mod.worker`), UI (opaque-origin iframe) (D-26, ADR-0012). A mod sees only the `ModContext` namespaces its closed `permissions[]` grant; it never runs in Story or in a room, only in `sandbox` and `exp:<id>` sessions, and saves only to its own `mod:<id>` slot (C14). The repository ships the kit: `AGENTS.md`, mirrored skills, a knowledge base, `@dv/mod-sdk` and the `dv` CLI with an MCP server (M13a6). `mods.script` and `mods.ui` stay off until their device recordings pass.

**ChatGPT path (R-MOD-02).** Website Sign in with ChatGPT is a limited trial (F-060), so the shipped path is a local agent (Codex CLI signed in with ChatGPT) plus device-code publish login; the website flow sits behind a flag (D-05, ADR-0019).

**Forum and moderation (R-MOD-03, R-IP-03).** The main menu has a forum to submit, discuss and vote on experiences, with a report button wherever UGC shows, a moderation queue, DMCA takedown within 24 h [research/INDEX.md §4 rule 18], NCII removal within 48 h (F-066) and CSAM reporting (Q-16). Published mods, experiences and NPCs are visible to other players only after automated checks pass and a human approves. Forum text is pre-moderated without human approval: synchronous `names:lint` and street-address checks, then a classifier that must return `allow` before the post becomes visible (a `review` or `block` verdict holds or removes it, and a vendor outage keeps it `pending`), and three distinct reporters hold it; forum image attachments stay hidden until their image scan returns `allow` (M13b1, `12-modding-publish.md` C§5, DL-470, DL-471). `ugc.publish` stays false in production until M13d1's criteria pass (DL-151).

**Experiences on the map (R-MOD-04).** A published experience is a C17 `ExperienceDescriptor` anchored by lat/lng and `ChunkKey` with a radius ≤ 250 m; it shows as a map marker and loads in a sandbox.

## 9. Accurate San Francisco first, the Bay later
v1 is San Francisco only (R-MAP-01): footprints, streets and addresses from DataSF (PDDL, F-054) and OSM (ODbL with attribution and share-alike, F-053), terrain from Terrarium tiles, ENU coordinates from City Hall, 256 m chunks streamed per tier, ≥ 25 authored landmarks at stable ids, ten districts `d1…d10` and 41 neighbourhood slugs (D-14, A-05, C08). No Google 3D Tiles and no Mapbox runtime, because their terms forbid caching or derivation (F-055, F-056). Bridges are world boundaries and portals; Oakland, the Peninsula and the South Bay render as low-detail skyline cards (D-15, R-MAP-02). A living city adds traffic with robotaxis, pedestrians, transit as set dressing, day and night and weather (R-MAP-04). The full map and minimap are drawn in-engine from `sf-map.v1.bin` (D-25, R-MAP-03). The Bay expansion milestones M15a…M15g follow M14a, each district streaming in through its portal.

## 10. The owner's USD 100 fal cap and what it implies
DL-OWN-01 caps all fal.ai spend at USD 100 in total: spike ≤ $10 (M00c), characters ≤ $42 (M10a1–M10a2), cutscenes ≤ $40 (M05c3 ≤ $16, M10b ≤ $24, DL-209), buffer $8 (owner sign-off per spend, Q-26). fal has no vendor spend cap and locks accounts below a balance threshold (F-048), so the cap is enforced in our code (G3, ADR-0015).

| Implication | Where it binds |
|---|---|
| The ledger is the cap: `programCapUsdMicros` = 100,000,000 in `BudgetGovernorDO`; prepaid tranches, auto-recharge off | M05b1, M14b1 |
| Dev and CI never call fal (`FAL_MODE=mock`); every paid job prints a dry-run estimate and needs `--live` | every milestone; `check:pipeline` |
| No player-triggered fal generation in v1: builder looks are creator-kit presets; custom 3D only through the owner-approved queue | M06b4, R-NPC-03 |
| Only 8 Standard fighters and 12 Lean bodies are generated; stand-ins, cars, props and voices are authored, CC0 or non-fal | M10a1–M10a2, M03a1, M06a4 |
| 46 of 155 cutscene refs are generated; the other 109 play in-engine; Acts 2–3 and racing intros are in-engine in v1 | M05c3, M10b, R-CUT-03 |
| 8 fighters, not 12; the 12-fighter target is post-v1 | M08b1, M10a2 |
| Raising the cap is a `config/guardrails.yaml` change on the owner's word only (Q-14) | — |

The recurring ceiling is separate: $500/month for LLM, voice and moderation (G3, Q-28; `spec/10-cost-model.md` §3).

## 11. Requirements (R-IDs, copied from 06 v1.2 §2)
"MUST" unless marked SHOULD. Source: owner brief unless noted. This table is not extended in Wave 5: every product need above maps to one of these 42 ids.

| R-ID | Requirement |
|---|---|
| R-PLAT-01 | Hosted on Cloudflare; served as an installable PWA for desktop and mobile; iPhone is the primary mobile target. |
| R-PLAT-02 | Playable on WebXR headsets (Meta Quest 3/3S, Apple Vision Pro) as a full XR port (immersive session, hand/controller input, comfort options), not a flat screen in VR. |
| R-PLAT-03 | Three.js with a WebGPU-first renderer and automatic WebGL2 fallback; WASM for physics/decoding/pose inference where it pays; quality tiers auto-selected per device. |
| R-PLAT-04 | First-person (as the character) and third-person (behind-the-shoulder follow) cameras, switchable at any time outside cutscenes. |
| R-PLAT-05 | SHOULD run at 60 fps on current iPhones at the mobile tier and 72/90 fps on Quest 3 within the platform budgets. |
| R-AUTH-01 | v1 launches with no sign-in: a local profile (device-bound, HMAC play token) with cloud sync deferred to P1 (M12a). Auth phases: P0 local → P1 device-registered → P2 ChatGPT link → P3 Thirdweb (spec/03 D-04). |
| R-AUTH-02 | Thirdweb sign-in (in-app wallet / social / email) is integrated LAST; the codebase isolates identity behind one interface so adding it is one milestone. |
| R-AUTH-03 | Optional ChatGPT linkage exists solely to enable the modding/publishing flow (R-MOD-02); it is never required to play. Website Sign-in-with-ChatGPT is a partner trial, so the shipped path is bring-your-own agent (Codex CLI signed in with ChatGPT) plus device-code publish login (spec/03 D-05). |
| R-ROLL-01 | Milestone order: hosted single-player with storyline, tested on Cloudflare, before any multiplayer. |
| R-ROLL-02 | Multiplayer open world via realtime functions: authoritative rooms and presence on Cloudflare Durable Objects; persistence on Supabase (G1; Convex documented alternative). |
| R-MAP-01 | Accurate San Francisco first: real street grid, neighborhoods, landmarks, hills, waterfront, bridges as world boundaries/portals; players recognize where they are. (owner update 2026-10-18) |
| R-MAP-02 | Rest of the Bay (Oakland/East Bay, Peninsula, South Bay) as later expansion milestones; v1 renders them as low-detail backdrop. |
| R-MAP-03 | In-app full map and minimap (in-engine Canvas 2D from `sf-map.v1.bin` per spec/03 D-25; the Mapbox CLI is dev-only), with mission markers, player-published experiences, and fast travel where the story allows. |
| R-MAP-04 | Living city: traffic (incl. robotaxis), pedestrians, transit as set dressing, day/night and weather. |
| R-CUT-01 | Cutscenes rendered with MiniMax H3 Max Turbo via fal.ai once its licence is cleared in writing (spec/03 A-08), otherwise with the fallback chain in `config/genai-endpoints.json`; requested through the backend, stored in R2, reused by deterministic cache key; generated at most once per key; labeled AI-generated. |
| R-CUT-02 | Cutscene hooks: story beats; fight intro (per matchup), special move/finisher (per character+move), fight ending (per winner); racing event intros SHOULD. |
| R-CUT-03 | Every cutscene has a non-generated fallback (in-engine camera sequence with subtitles) so the game never blocks on generation. |
| R-NPC-01 | Roster of AI NPCs modeled on tech founders/influencers and Bay Area cultural legends, each driven by a `soul.md` (research layer exists) plus backstory reference images. |
| R-NPC-02 | Character pipeline on fal.ai: reference sheet (multi-view/T-pose) → image-to-3D T-pose model → auto-rig → animation retarget → glTF in R2, with provenance and QA gates. |
| R-NPC-03 | Native NPC builder: players upload a backstory (→ soul.md via LLM) and reference images (→ same pipeline), preview a chat, and publish through moderation. |
| R-NPC-04 | Likeness policy tiers (`consented` \| `parody` \| `fictionalized`) stored in soul.md, enforced by the pipeline and a live kill-switch; no real-voice cloning without `consented`. |
| R-NPC-05 | Runtime dialogue through a server-side proxy (no keys in the browser), with prompt caching, per-player rate limits, offline fallback lines, and in-character safety rails. |
| R-MODE-01 | Main story: original narrative in SF, mission system (intro → objectives → fail/success → rewards), wanted system, economy, property/garage. |
| R-MODE-02 | Racing: Forza-grade look at the desktop tier; NFS-Most-Wanted-style police pursuits with heat levels, roadblocks, spike strips; supercars, Waymo robotaxis, Tesla Roadsters; sprint/circuit/pursuit on real SF streets. |
| R-MODE-03 | Culture Wars: 1v1 fighter (Street Fighter/Mortal Kombat conventions: rounds, meters, specials, supers, finishers, frame data); roster of rappers/founders/athletes; stages at SF landmarks; optional full-body pose control (MediaPipe Pose Landmarker on-device; YOLO excluded for licence reasons) with calibration and fallback to pad/touch/keys; cutscene hooks per R-CUT-02. |
| R-MODE-04 | Business Tycoon: founder-vs-VC sim (idea → MVP → rounds → hiring → scale), cap-table math, AI-NPC investors, random-event engine (business/political/natural/cultural) with probability and impact model, win/lose conditions. |
| R-MODE-05 | Modes are encountered inside the story and unlock as standalone main-menu options when first encountered; unlock state persists in the save. |
| R-MOD-01 | Personal mods for any mode via the player's own coding agent: the repo ships an agent-friendly mod SDK (`AGENTS.md`, skills, knowledge base, typed mod API, local dev loop). |
| R-MOD-02 | Modding via Sign-in-with-ChatGPT (or the fallback flow in ADR) for players without a local agent. |
| R-MOD-03 | Forum in the main menu to submit, discuss and vote on worlds/experiences; moderation and DMCA flow. |
| R-MOD-04 | Published experiences appear as markers on the open-world map and load in a sandbox. |
| R-UI-01 | Character creation UI and logic (body/face/outfit presets, name, voice pick, save to profile; later linked to the fal pipeline for custom looks). |
| R-UI-02 | Settings page (graphics tier, controls remap, audio, accessibility, XR comfort, camera, language, data/privacy). |
| R-UI-03 | Main menu and all implied pages: continue/new game, mode select with lock states, garage, NPC builder, forum, profile, save slots, credits/legal. |
| R-IP-01 | Original content only; no Rockstar/Take-Two assets, code, data, names or plots; asset-provenance manifest + CI check; display name is one config value, default "Dee-Verse: Tha Bay"; "GTA" appears nowhere shipped (spec/03 A-07). |
| R-IP-02 | Likeness policy per R-NPC-04 with consent records and kill-switch. |
| R-IP-03 | UGC terms, moderation queue, DMCA agent/takedown flow, report button everywhere UGC shows. |
| R-IP-04 | Camera/pose data stays on device; no frames uploaded or persisted; no face landmarker. Audience: 18+ terms with 17+ content; every under-18 bracket is blocked in v1 (spec/03 D-30, DL-139). |
| R-ENG-01 | Agent-friendly repo: `CLAUDE.md` < 200 lines importing deeper docs, `AGENTS.md`, per-package READMEs, deterministic scripts for build/test/deploy/perf, no GUI-only steps. |
| R-ENG-02 | Performance budgets per device class are acceptance criteria with automated checks where possible. |
| R-ENG-03 | GenAI cost model and controls (quotas, cache keys, budget alarms) in the spec; nothing generates without a cache check. |
| R-ENG-04 | Accessibility baseline: remappable controls, subtitles for generated speech, colorblind-safe HUD, reduced motion, XR comfort options. |

**How brief wording meets later decisions.** The R-IDs keep the owner's words; binding decisions narrow some of them without changing the id. Brand names in R-MODE-02 (robotaxi and roadster makes) ship as fictional makes that pass `names:lint` (R-IP-01; INDEX §4 rule 15; Q-23(a)). R-UI-01's "later linked to the fal pipeline" and R-NPC-03's "→ same pipeline" mean the owner-approved queue only in v1 (DL-OWN-01, DL-175). R-NPC-01's "research layer exists" is not yet true in the repository (Q-19). "Authoritative rooms" in R-ROLL-02 means `validated` client movement in v1; server physics waits for ADR-0029 (A-04). ADR-0018 narrows R-MOD-02 and R-AUTH-03 (ChatGPT for agent-less modders) and, through the `linked` tier, R-NPC-03, R-MOD-03 and R-MOD-04: website ChatGPT ships dark and GitHub is spike-only (DL-240), so public publishing of mods, experiences and NPCs likely waits for Thirdweb (M14a), after the M14b3 public launch, which then has no public UGC; the no-agent Studio (flow B) has no milestone (Q-38, DL-349). R-MOD-01's "for any mode" means `sandbox` and `exp:<id>` sessions in v1: never Story or rooms, and not standalone racing, fighter or tycoon, because no v1 milestone implements C06 `modSurface` (DL-553; owner Q-41, mapped in `spec/trace-gates.json`). R-ROLL-01's "single-player with storyline" is anchored on VS-Story: M05c2 (Act 1) is DONE and its ACs pass on staging (`_PLAN.md` §0 rule 4), and M00d's `check:rollout` enforces this on every rooms branch. Acts 2–3 (M05e1–M05f2) may land in parallel with block F under DL-246. This is the Architect's reading; the owner has not yet confirmed it (Q-37). If the owner wants the whole story first, M05f2 becomes a direct dependency of M12b1, which adds 6 sessions to the critical path.

## 12. Non-goals for v1
From 06 v1.2 §3 (binding):
- No native app stores.
- No full-detail East Bay or Peninsula (backdrop only; M15a…M15g after v1).
- No user-authored code running inside multiplayer rooms (mods are personal and sandboxed until a later vetting milestone).
- No real-money or token economy.
- No voice cloning of real people.
- No photoreal likeness generation for non-consented people.
- No server-side rendering of the 3D scene.
- No passthrough AR (`immersive-ar`).

Added from research and owner decisions:

| Non-goal | Why | Source |
|---|---|---|
| No firearms, gore, drug use, sexual content or real-person crimes; pursuits end in busts and fines | rating and likeness risk; satirical, exposure-driven story | Q-06, D-30, `03-story-narrative.md` §B1, [research/gamedesign-decomposition.md] |
| No real-money, web3 or premium-currency economy: game money is integer cents, no purchases, no cash-out, no tokens, NFTs or loot boxes; Thirdweb is identity only | 06 §3; vendor and gambling exposure | INDEX §4 rule 20, `08-tycoon.md` §1, R-AUTH-02 |
| No real-voice clones: voices are synthetic (Aura, MeloTTS); a clone only through the talent's own consented voice | vendor policies forbid cloning others; likeness law | D-23, F-051, Q-12, INDEX §4 rule 9 |
| US-only v1 behind a geo-gate (legal pages exempt) | licence territories (F-041), counsel scope, takedown law | A-10, ADR-0026, INDEX §4 rule 23 |
| No player-triggered fal generation in v1 (NPC looks, cutscenes, characters); all generation is internal and staff-run | USD 100 total cap; fal ToS forbids direct API exposure and requires 18+ end users (F-042) | DL-OWN-01, DL-175, DL-205, D-19 |
| No players under 18 in v1 | vendor end-user terms (F-038, F-042, F-051) | D-30, DL-139 |
| No camera frames, face landmarks or body data leaving the device; no YOLO | privacy and AGPL licence (F-058) | R-IP-04, D-24 |
| No online fighter matches | transport undecided until the M12c load test | DL-204, ADR-0028 |
| No authoritative server physics | `validated` movement is enough for v1 rooms | A-04, ADR-0029 |
| No Google 3D Tiles and no Mapbox tiles or runtime | terms forbid caching and derivation (F-055, F-056) | D-14, D-25 |
| No licensed or generated music | sync licensing | Q-11, INDEX §4 rule 14 |
| No phone Camera app and no Feed app in v1 (tiles stay `comingSoon`); story photo objectives use the in-world `photo` interact context (M05a2), racing has its own photo mode (M07b2), tycoon items go to Bank › Businesses | no v1 system needs them; keeps the phone scope bounded | DL-292, DL-238, `10-ui-hud-xr.md` §2 |
| No video model whose licence is not cleared in writing for US use; no self-hosted H3 weights | F-041 | A-08, ADR-GENAI-01, INDEX §4 rule 12 |
| No public publishing before the trust-and-safety backend passes | NCII and CSAM duties (F-065, F-066) | DL-151, M13d1 |

## 13. Traceability matrix

Moved unchanged to `spec/01-product-trace.md` for the 6,000-word cap (DL-531), with the owner gates on releases; citations of `spec/01-product.md` §13 resolve there.

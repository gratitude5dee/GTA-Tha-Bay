# 03 — Decisions and facts

> v1 (Architect, 2026-10-18; v0 was end of Phase 0; v1 amends A-01, A-03 and A-04 after Wave 1, see `spec/11-decision-log.md` DL-035, DL-051, DL-052). This file is binding on every domain subagent in Waves 1–4. Integration (Wave 5) expands it with ADR links and the full verified-facts ledger. Where this file and the master prompt's `<decided>` list disagree, **this file wins**; the superseded items are listed in §3.

## 1. Adopted decisions
Research decisions D-01…D-30 are `research/INDEX.md` §1 items 1–30, adopted as written, with the same numbering. Short form:

| ID | Decision | Source |
|---|---|---|
| D-01 | Workers + static assets (SPA, `run_worker_first: ["/api/*"]`), Workers Paid from M00; COOP/COEP/CORP in `_headers` and on Worker responses; `/account/*` not cross-origin-isolated | INDEX §1.1 |
| D-02 | **G1 = Supabase Pro `us-west-1`** (Postgres + RLS + pgvector); Convex is the documented alternative; `DataPort` rule: no supabase-js in the client except the auth module, all data via `/api/v1/*` | INDEX §1.2 |
| D-03 | Identity spine = Worker-hosted OIDC issuer (ES256, `kid`, `role`, `sub = profile_id`), trusted by DOs, Supabase Custom OIDC and Convex; Supabase anonymous sign-in is the fallback | INDEX §1.3 |
| D-04 | Auth phases: P0 local profile + HMAC play token (M00–M11) → P1 device-registered (M12) → P2 ChatGPT link (M13c) → P3 Thirdweb SIWE link (M14a, after Growth plan is paid) | INDEX §1.4 |
| D-05 | ChatGPT modding = bring-your-own agent (Codex CLI with Sign in with ChatGPT) + RFC 8628 device-code publish login; website SIWC behind a flag; never vendor the Noncommercial DevKit | INDEX §1.5 |
| D-06 | Rooms = `RoomDO` per instance + `DirectoryDO` + `PresenceDO` (Hibernation API); 50 ms tick only while connected; cap 16; 5 s checkpoints; resume tokens; protocol v2 from the Grand-V relay; binary frames; 150 m / 300 m interest | INDEX §1.6 |
| D-07 | One `WebGPURenderer` (`three@0.186.1`), TSL-only materials; WebGL2 guaranteed path (auto-fallback, `?gl=1`); Quest XR on the WebGL2 backend with multiview; Vision Pro native WebGPU XR with WebGL2 fallback | INDEX §1.7 |
| D-08 | Main-thread rendering in v1 with `sim.worker` + `asset.worker`; no render worker (XR is Window-only). Amended 2026-10-18 (DL-152): two lazy, non-rendering workers, `pose.worker` (S07) and `mod.worker` (S12) | INDEX §1.8 |
| D-09 | Budgets in render objects (issue #30560): `BundleGroup` per chunk, static, instancing; mobile ≤ 150 objects / ≤ 1.0 M tris | INDEX §1.9 |
| D-10 | No `postprocessing`, no `n8ao`; TSL `RenderPipeline` nodes; `DirectRenderPipeline` in XR; `PCFShadowMap` | INDEX §1.10 |
| D-11 | Vanilla three + TypeScript; no React Three Fiber | INDEX §1.11 |
| D-12 | Rapier 0.21.0: `simd-compat` for free-roam; `deterministic-compat` for replayed/server-verified sims; fighter uses `detmath` frame data without Rapier; floating origin | INDEX §1.12 |
| D-13 | bitECS 0.4.0; fixed 60 Hz sim; `detmath` + seeded RNG streams; lint bans `Math.random` and transcendental `Math.*` in sim code; cross-browser state-hash test in M01a | INDEX §1.13 |
| D-14 | Accurate SF from open data only (DataSF `ynuv-fyni`, `3psu-pn9h`, `j2bu-swwd`, `ramy-di5m`; OSM via Geofabrik under ODbL; Terrarium z15); ENU origin at City Hall; no Google 3D Tiles, no Mapbox tiles | INDEX §1.14 |
| D-15 | Buildings: baked Int16 footprint extrusions, worker-meshed, merged per chunk, ≤ 1 upload/frame; draw distance 8,200 m desktop / 2,500 m mobile / 1,500 m mobile-low and Quest / 3,000 m Vision Pro; far Bay = skyline cards | INDEX §1.15 |
| D-16 | Vite 8.3.4 + vite-plugin-pwa 2.0.0 (`injectManifest`, prompt updates), app shell only; world packs via `asset.worker` + OPFS; iOS coach mark, `persist()` after story start, 60 Hz cap | INDEX §1.16 |
| D-17 | glTF + meshopt; KTX2 (UASTC/ETC1S); identity-encoded `.glb/.ktx2` for Range; ≤ 25 MiB per static file | INDEX §1.17 |
| D-18 | All genAI endpoint ids live in `config/genai-endpoints.json` with a nightly liveness check; H3 family licence-gated (see A-08); sheet `openai/gpt-image-2.5/sunburst/edit`; mesh `meshy/v7.1/multi-image-to-3d`; rig `fal-ai/meshy/rigging/multi-animation`; TTS `fal-ai/minimax/speech-2.8-{turbo,hd}`; banned endpoints listed in INDEX | INDEX §1.18 |
| D-19 | Cutscene generation: `CutsceneJobDO` single-flight + one GenJobWorkflow (R2 HEAD → budget → submit + ED25519 webhook → poll fallback → R2 → transcode → captions → manifest); internal-only generation in v1 | INDEX §1.19 |
| D-20 | Cutscene playback: muted `<video>` pool unlocked on first gesture, audio via `AudioContext`; Quest media layer; Vision Pro `VideoFrameTexture`; in-engine fallback always | INDEX §1.20 |
| D-21 | NPC dialogue via Worker proxy (AI Gateway BYOK): `claude-haiku-5-5` thinking off, effort low; heroes `claude-sonnet-5-5` with `between_tools`; shared cached soul prefix; server-held history in `EncounterDO`; offline ink lines; filler peds without LLM | INDEX §1.21 |
| D-22 | NPC memory in pgvector (`halfvec(1024)`, bge-m3); retention 30 d transcripts / 180 d memories; none for under-18 profiles; export/forget from day one | INDEX §1.22 |
| D-23 | Voice tiers: text / Aura or MeloTTS / ElevenLabs Flash for ≤ 3 heroes / consented-only clones; mouth-atlas lip-sync | INDEX §1.23 |
| D-24 | Pose: MediaPipe tasks-vision 1.1.1 lite in a PoseWorker, on-device; no YOLO (AGPL); R-MODE-03 amended | INDEX §1.24 |
| D-25 | Maps: in-engine Canvas 2D minimap/full map from `sf-map.v1.bin`; MapLibre + PMTiles only on web surfaces; no Mapbox runtime; Mapbox CLI dev-only | INDEX §1.25 |
| D-26 | Modding tiers: data (JSON Schema) / script (QuickJS-wasm Worker) / UI (opaque-origin iframe); disabled in multiplayer; `AGENTS.md` ≤ 24 KiB; mirrored skills with CI check; `thabay-mcp` + CLI | INDEX §1.26 |
| D-27 | CI/CD: GitHub Actions; per-PR Workers previews; versioned uploads → smoke → gradual rollout; Playwright projects `chromium-webgpu`, `chromium-webgl2`, `webkit-webgl2`, `xr-quest3` (IWER); IP gates from M00 | INDEX §1.27 |
| D-28 | Cost controls: `PlayerQuotaDO` + `BudgetGovernorDO` (70/85/100 %); AI Gateway limits; vendor caps; kill switches never block cache hits | INDEX §1.28 |
| D-29 | Likeness: living people `parody`; deceased (Mac Dre) and founders of real companies `fictionalized`; `consented` needs a `consent_record`; kill-switch ≤ 60 s with stand-ins | INDEX §1.29 |
| D-30 | Audience: 18+ terms of service with 17+-rated content (`TEEN_MODE=false`); under-13 blocked, and in v1 every under-18 bracket is blocked (DL-139); no firearms, gore or real-person crimes; player-triggered media generation and premium voice need 18+ attestation and P2+ (builder text: DL-119) | INDEX §1.30, Q-02 |

## 2. Architect decisions (delegated to the Architect; ADRs written in Wave 5)

| ID | Decision | Rationale |
|---|---|---|
| A-01 | **Package layout**: pnpm workspaces monorepo — `apps/web` (PWA shell), `packages/shared` (types, detmath, ids), `packages/engine`, `packages/world`, `packages/net`, `packages/npc`, `packages/ui`, `packages/mod-sdk`, `packages/modes/{story,racing,fighter,tycoon}`, `services/edge` (Workers + DOs + API), `services/rooms` (room DOs as a separate Worker so UI deploys do not restart rooms), `services/pipeline` (genAI workflows), `tools/{map,assets,ci,cli}`, `config/`. **Amended v1 (DL-035):** adds `packages/identity`, `tools/ops`, root `content/`, `assets/`, `supabase/`, `tests/`; the authoritative list is `prompt-pack/06-SHARED-CONTEXT.md` §5 and the tree in `spec/02-architecture.md` §2 | Builder navigability; mod SDK publishable on its own; separate room Worker answers the backend report's open question |
| A-02 | **Mission scripting**: TypeScript authoring compiled to a JSON IR validated by JSON Schema; interpreter with threads/wait/yield, zone predicates, seeded determinism; autoplayer runs every mission in CI | gamedesign §2.6, repos-world gta-sa-earth pattern |
| A-03 | **Cutscene cache key** = `sha256(templateId@ver, characters[{id, soulVersion, likenessTier}], move, stage, style@ver, endpointId@pinnedUpdatedAt, seed, inputHashes)`. **Amended v1 (DL-051):** `pinnedUpdatedAt` is the registry pin in `config/genai-endpoints.json`, changed only by `genai:repin`, so a vendor-side `updatedAt` change never silently invalidates the cache | INDEX §1.19, gamedesign §4.5 |
| A-04 | **Netcode**: client sim 60 Hz, server snapshots 20 Hz, server-authoritative with client prediction for the local player. **Amended v1 (DL-052):** M12a is identity and cloud saves only; M12b ships rooms with `validated` client movement and the engine prediction hooks; `authoritative` server physics only by an ADR after the M12c load test | stack-cloudflare-backend §4–5 |
| A-05 | **Building representation**: per D-15 on every tier; landmark buildings (≥ 25) are hand-authored glTF replacing their extrusions | accurate-SF owner goal |
| A-06 | **v1 vertical slice** = hosted single-player Act 1 (M05c) with racing, fighter and tycoon reachable as unlocks only after their milestones; stubs register in the unlock registry with "coming soon" states | R-ROLL-01, R-MODE-05 |
| A-07 | **Display name** default "Dee-Verse: Tha Bay" from `config/brand.ts`; "GTA" appears nowhere shipped; owner may override after counsel review | INDEX §4 rule 1, legal-ip-likeness |
| A-08 | **Video model**: the owner's MiniMax H3 Max Turbo stays the target for cutscenes but is gated by ADR-GENAI-01 (licence clearance in writing); until cleared, production uses the INDEX §1.18 fallback chain; the endpoint registry makes the switch a config change | gap-video-model-licence-clearance, R-CUT-01 amended |
| A-09 | **Milestones**: INDEX §5 lettered sub-milestones M00 … M14b, M15+; a cutscene-playback spike precedes M05b | INDEX §5 |
| A-10 | **Region**: v1 US-only behind a geo-gate | INDEX §4 rule 23 |

## 3. Superseded items in the master prompt's `<decided>` list
- "Start on WebGL2 with the WebGPU renderer behind a flag" → D-07.
- Library pins `postprocessing@6.39.5`, `n8ao@2.0.1` → removed (D-10).
- "Supabase … anonymous-then-linked auth" as the identity spine → D-03 (anonymous sign-in is the fallback only).
- "MiniMax's current video model … exact endpoint verified by S00" → A-08 (licence-gated target with fallback chain).
- Example of real-person NPCs at `parody` by default → D-29 adds `fictionalized` for the deceased and for founders of real companies.

## 4. Gated decisions (applied as defaults on 2026-10-18; the run is unattended)
- **G1** Supabase (D-02).
- **G2** Living people `parody`; Mac Dre and founders of real companies `fictionalized`; consent outreach order per INDEX §7.
- **G3** Recurring ceiling $500/month (Anthropic $350, voice $100, moderation $25, buffer $25); one-off production $1,000 fal credit; per-player quotas and governor thresholds per INDEX §7.

## 5. Verified facts
The ledger is `research/INDEX.md` §2 (F-001 …). Domain specs cite `[research/<file>.md]` or `F-NNN`. Wave 5 copies the rows each milestone relies on into §6 of this file.

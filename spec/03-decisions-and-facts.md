# 03 — Decisions and facts

> v2 (Architect, Wave 5 `decisions-adrs`, 2026-10-18; v1.1 amended A-01 (DL-156) and D-24 (DL-164); v1 amended A-01, A-03 and A-04, DL-035, DL-051, DL-052). v2 adds an ADR link to every D-xx and A-xx (`docs/decisions/`, index in `docs/decisions/README.md`), clarifies A-05, A-04 and A-08 (DL-200…DL-207 in `spec/11-decision-log-2.md`) and adds §6, the facts each milestone relies on (rows M10d1–M10e for the milestones of DL-390, DL-460 and DL-500 added by DL-547). This file is binding on every domain subagent. Where this file and the master prompt's `<decided>` list disagree, **this file wins**; the superseded items are listed in §3.

## 1. Adopted decisions
Research decisions D-01…D-30 are `research/INDEX.md` §1 items 1–30, adopted as written, with the same numbering. Short form:

| ID | Decision | Source | ADR |
|---|---|---|---|
| D-01 | Workers + static assets (SPA, `run_worker_first: ["/api/*"]`), Workers Paid from M00; COOP/COEP/CORP in `_headers` and on Worker responses; `/account/*` not cross-origin-isolated | INDEX §1.1 | [ADR-0020](../docs/decisions/ADR-0020-hosting-and-web-delivery.md) |
| D-02 | **G1 = Supabase Pro `us-west-1`** (Postgres + RLS + pgvector); Convex is the documented alternative; `DataPort` rule: no supabase-js in the client except the auth module, all data via `/api/v1/*` | INDEX §1.2 | [ADR-0008](../docs/decisions/ADR-0008-supabase-over-convex.md) |
| D-03 | Identity spine = Worker-hosted OIDC issuer (ES256, `kid`, `role`, `sub = profile_id`), trusted by DOs, Supabase Custom OIDC and Convex; Supabase anonymous sign-in is the fallback | INDEX §1.3 | [ADR-0009](../docs/decisions/ADR-0009-identity-spine.md) |
| D-04 | Auth phases: P0 local profile + HMAC play token (M00–M11) → P1 device-registered (M12) → P2 ChatGPT link (M13c) → P3 Thirdweb SIWE link (M14a, after Growth plan is paid) | INDEX §1.4 | [ADR-0009](../docs/decisions/ADR-0009-identity-spine.md), [ADR-0018](../docs/decisions/ADR-0018-publish-identity-before-m14a.md) |
| D-05 | ChatGPT modding = bring-your-own agent (Codex CLI with Sign in with ChatGPT) + RFC 8628 device-code publish login; website SIWC behind a flag; never vendor the Noncommercial DevKit | INDEX §1.5 | [ADR-0019](../docs/decisions/ADR-0019-modding-agent-and-publish-login.md) |
| D-06 | Rooms = `RoomDO` per instance + `DirectoryDO` + `PresenceDO` (Hibernation API); 50 ms tick only while connected; cap 16; 5 s checkpoints; resume tokens; protocol v2 from the Grand-V relay; binary frames; 150 m / 300 m interest | INDEX §1.6 | [ADR-0004](../docs/decisions/ADR-0004-netcode-model.md) |
| D-07 | One `WebGPURenderer` (`three@0.186.1`), TSL-only materials; WebGL2 guaranteed path (auto-fallback, `?gl=1`); Quest XR on the WebGL2 backend with multiview; Vision Pro native WebGPU XR with WebGL2 fallback | INDEX §1.7 | [ADR-0010](../docs/decisions/ADR-0010-renderer-strategy.md) |
| D-08 | Main-thread rendering in v1 with `sim.worker` + `asset.worker`; no render worker (XR is Window-only). Amended 2026-10-18 (DL-152): two lazy, non-rendering workers, `pose.worker` (S07) and `mod.worker` (S12) | INDEX §1.8 | [ADR-0017](../docs/decisions/ADR-0017-worker-topology.md) |
| D-09 | Budgets in render objects (issue #30560): `BundleGroup` per chunk, static, instancing; mobile ≤ 150 objects / ≤ 1.0 M tris | INDEX §1.9 | [ADR-0010](../docs/decisions/ADR-0010-renderer-strategy.md) |
| D-10 | No `postprocessing`, no `n8ao`; TSL `RenderPipeline` nodes; `DirectRenderPipeline` in XR; `PCFShadowMap` | INDEX §1.10 | [ADR-0010](../docs/decisions/ADR-0010-renderer-strategy.md) |
| D-11 | Vanilla three + TypeScript; no React Three Fiber | INDEX §1.11 | [ADR-0010](../docs/decisions/ADR-0010-renderer-strategy.md) |
| D-12 | Rapier 0.21.0: `simd-compat` for free-roam; `deterministic-compat` for replayed/server-verified sims; fighter uses `detmath` frame data without Rapier; floating origin | INDEX §1.12 | [ADR-0011](../docs/decisions/ADR-0011-physics-and-determinism.md) |
| D-13 | bitECS 0.4.0; fixed 60 Hz sim; `detmath` + seeded RNG streams; lint bans `Math.random` and transcendental `Math.*` in sim code; cross-browser state-hash test in M01a | INDEX §1.13 | [ADR-0011](../docs/decisions/ADR-0011-physics-and-determinism.md) |
| D-14 | Accurate SF from open data only (DataSF `ynuv-fyni`, `3psu-pn9h`, `j2bu-swwd`, `ramy-di5m`; OSM via Geofabrik under ODbL; Terrarium z15); ENU origin at City Hall; no Google 3D Tiles, no Mapbox tiles | INDEX §1.14 | [ADR-0021](../docs/decisions/ADR-0021-world-data-and-map-stack.md) |
| D-15 | Buildings: baked Int16 footprint extrusions, worker-meshed, merged per chunk, ≤ 1 upload/frame; draw distance 8,200 m desktop / 2,500 m mobile / 1,500 m mobile-low and Quest / 3,000 m Vision Pro; far Bay = skyline cards | INDEX §1.15 | [ADR-0005](../docs/decisions/ADR-0005-building-representation.md) |
| D-16 | Vite 8.3.4 + vite-plugin-pwa 2.0.0 (`injectManifest`, prompt updates), app shell only; world packs via `asset.worker` + OPFS; iOS coach mark, `persist()` after story start, 60 Hz cap | INDEX §1.16 | [ADR-0020](../docs/decisions/ADR-0020-hosting-and-web-delivery.md) |
| D-17 | glTF + meshopt; KTX2 (UASTC/ETC1S); identity-encoded `.glb/.ktx2` for Range; ≤ 25 MiB per static file | INDEX §1.17 | [ADR-0020](../docs/decisions/ADR-0020-hosting-and-web-delivery.md) |
| D-18 | All genAI endpoint ids live in `config/genai-endpoints.json` with a nightly liveness check; H3 family licence-gated (see A-08); sheet `openai/gpt-image-2.5/sunburst/edit`; mesh `meshy/v7.1/multi-image-to-3d`; rig `fal-ai/meshy/rigging/multi-animation`; TTS `fal-ai/minimax/speech-2.8-{turbo,hd}`; banned endpoints listed in INDEX | INDEX §1.18 | [ADR-0022](../docs/decisions/ADR-0022-genai-pipeline-and-cutscene-delivery.md), [ADR-GENAI-01](../docs/decisions/ADR-GENAI-01-video-model-licence-gate.md) |
| D-19 | Cutscene generation: `CutsceneJobDO` single-flight + one GenJobWorkflow (R2 HEAD → budget → submit + ED25519 webhook → poll fallback → R2 → transcode → captions → manifest); internal-only generation in v1 | INDEX §1.19 | [ADR-0022](../docs/decisions/ADR-0022-genai-pipeline-and-cutscene-delivery.md) |
| D-20 | Cutscene playback: muted `<video>` pool unlocked on first gesture, audio via `AudioContext`; Quest media layer; Vision Pro `VideoFrameTexture`; in-engine fallback always | INDEX §1.20 | [ADR-0022](../docs/decisions/ADR-0022-genai-pipeline-and-cutscene-delivery.md) |
| D-21 | NPC dialogue via Worker proxy (AI Gateway BYOK): `claude-haiku-5-5` thinking off, effort low; heroes `claude-sonnet-5-5` with `between_tools`; shared cached soul prefix; server-held history in `EncounterDO`; offline ink lines; filler peds without LLM | INDEX §1.21 | [ADR-0023](../docs/decisions/ADR-0023-npc-runtime.md) |
| D-22 | NPC memory in pgvector (`halfvec(1024)`, bge-m3); retention 30 d transcripts / 180 d memories; none for under-18 profiles; export/forget from day one | INDEX §1.22 | [ADR-0023](../docs/decisions/ADR-0023-npc-runtime.md) |
| D-23 | Voice tiers: text / Aura or MeloTTS / ElevenLabs Flash for ≤ 3 heroes / consented-only clones; mouth-atlas lip-sync | INDEX §1.23 | [ADR-0023](../docs/decisions/ADR-0023-npc-runtime.md) |
| D-24 | Pose: MediaPipe tasks-vision 1.1.1 in a PoseWorker, on-device: lite model on mobile, full on desktop when within budget (lite otherwise; v1.1, DL-164); no YOLO (AGPL); R-MODE-03 amended | INDEX §1.24 | [ADR-0024](../docs/decisions/ADR-0024-pose-input.md) |
| D-25 | Maps: in-engine Canvas 2D minimap/full map from `sf-map.v1.bin`; MapLibre + PMTiles only on web surfaces; no Mapbox runtime; Mapbox CLI dev-only | INDEX §1.25 | [ADR-0021](../docs/decisions/ADR-0021-world-data-and-map-stack.md) |
| D-26 | Modding tiers: data (JSON Schema) / script (QuickJS-wasm Worker) / UI (opaque-origin iframe); disabled in multiplayer; `AGENTS.md` ≤ 24 KiB, tightened to kit ≤ 19,456 bytes with root + kit ≤ 32 KiB (DL-208); mirrored skills with CI check; `thabay-mcp` + CLI | INDEX §1.26 | [ADR-0012](../docs/decisions/ADR-0012-modding-tiers-and-sandboxes.md) |
| D-27 | CI/CD: GitHub Actions; per-PR Workers previews; versioned uploads → smoke → gradual rollout; Playwright projects `chromium-webgpu`, `chromium-webgl2`, `webkit-webgl2`, `xr-quest3` (IWER); IP gates from M00 | INDEX §1.27 | [ADR-0025](../docs/decisions/ADR-0025-ci-cd-and-release.md) |
| D-28 | Cost controls: `PlayerQuotaDO` + `BudgetGovernorDO` (70/85/100 %); AI Gateway limits; vendor caps; kill switches never block cache hits | INDEX §1.28 | [ADR-0015](../docs/decisions/ADR-0015-cost-controls.md) |
| D-29 | Likeness: living people `parody`; deceased (Mac Dre) and founders of real companies `fictionalized`; `consented` needs a `consent_record`; kill-switch ≤ 60 s with stand-ins | INDEX §1.29 | [ADR-0013](../docs/decisions/ADR-0013-likeness-tiers-and-kill-switch.md) |
| D-30 | Audience: 18+ terms of service with 17+-rated content (`TEEN_MODE=false`); under-13 blocked, and in v1 every under-18 bracket is blocked (DL-139); no firearms, gore or real-person crimes; player-triggered media generation and premium voice need 18+ attestation and P2+ (builder text: DL-119) | INDEX §1.30, Q-02 | [ADR-0014](../docs/decisions/ADR-0014-audience-and-content.md) |

## 2. Architect decisions (delegated to the Architect; ADRs in `docs/decisions/`)

| ID | Decision | Rationale | ADR |
|---|---|---|---|
| A-01 | **Package layout**: pnpm workspaces monorepo — `apps/web` (PWA shell), `packages/shared` (types, detmath, ids), `packages/engine`, `packages/world`, `packages/net`, `packages/npc`, `packages/ui`, `packages/mod-sdk`, `packages/modes/{story,racing,fighter,tycoon}`, `services/edge` (Workers + DOs + API), `services/rooms` (room DOs as a separate Worker so UI deploys do not restart rooms; restart scope per script is UNVERIFIED, U-BE-21; M12c1 AC-12 records it), `services/pipeline` (genAI workflows), `tools/{map,assets,ci,cli}`, `config/`. **Amended v1 (DL-035):** adds `packages/identity`, `tools/ops`, root `content/`, `assets/`, `supabase/`, `tests/`. **Amended v1.1 (DL-156):** adds `tools/soul`, `tools/fighter` (QA-only) and the private `content-private/` mount (Q-25); the authoritative list is `prompt-pack/06-SHARED-CONTEXT.md` §5 and the tree in `spec/02-architecture.md` §2 | Builder navigability; mod SDK publishable on its own; separate room Worker answers the backend report's open question | [ADR-0001](../docs/decisions/ADR-0001-package-layout.md) |
| A-02 | **Mission scripting**: TypeScript authoring compiled to a JSON IR validated by JSON Schema; interpreter with threads/wait/yield, zone predicates, seeded determinism; autoplayer runs every mission in CI | gamedesign §2.6, repos-world gta-sa-earth pattern | [ADR-0002](../docs/decisions/ADR-0002-mission-scripting-dsl.md) |
| A-03 | **Cutscene cache key** = `sha256(templateId@ver, characters[{id, soulVersion, likenessTier}], move, stage, style@ver, endpointId@pinnedUpdatedAt, seed, inputHashes)`. **Amended v1 (DL-051):** `pinnedUpdatedAt` is the registry pin in `config/genai-endpoints.json`, changed only by `genai:repin`, so a vendor-side `updatedAt` change never silently invalidates the cache | INDEX §1.19, gamedesign §4.5 | [ADR-0003](../docs/decisions/ADR-0003-cutscene-cache-key.md) |
| A-04 | **Netcode**: client sim 60 Hz, server snapshots 20 Hz, server-authoritative with client prediction for the local player. **Amended v1 (DL-052):** M12a is identity and cloud saves only; M12b ships rooms with `validated` client movement and the engine prediction hooks; `authoritative` server physics only by an ADR after the M12c load test (ADR-0029, proposed) | stack-cloudflare-backend §4–5 | [ADR-0004](../docs/decisions/ADR-0004-netcode-model.md), [ADR-0029](../docs/decisions/ADR-0029-authoritative-server-physics.md) |
| A-05 | **Building representation**: per D-15 on every tier; landmark buildings (≥ 25) are authored glTF at stable AssetIds replacing their extrusions (code recipes first, a Blender pass may replace the files later; DL-105, DL-201) | accurate-SF owner goal | [ADR-0005](../docs/decisions/ADR-0005-building-representation.md) |
| A-06 | **v1 vertical slice** = hosted single-player Act 1 (M05c) with racing, fighter and tycoon reachable as unlocks only after their milestones; stubs register in the unlock registry with "coming soon" states | R-ROLL-01, R-MODE-05 | [ADR-0006](../docs/decisions/ADR-0006-v1-vertical-slice.md) |
| A-07 | **Display name** default "Dee-Verse: Tha Bay" from `config/brand.ts`; "GTA" appears nowhere shipped; owner may override after counsel review | INDEX §4 rule 1, legal-ip-likeness | [ADR-0007](../docs/decisions/ADR-0007-display-name.md) |
| A-08 | **Video model**: the owner's MiniMax H3 Max Turbo stays the target for cutscenes but is gated by ADR-GENAI-01 (status `proposed`, owner-gated; licence clearance in writing); until cleared, production uses the INDEX §1.18 fallback chain; the endpoint registry makes the switch a config change | gap-video-model-licence-clearance, R-CUT-01 amended | [ADR-GENAI-01](../docs/decisions/ADR-GENAI-01-video-model-licence-gate.md) |
| A-09 | **Milestones**: INDEX §5 lettered sub-milestones M00 … M14b, M15+; a cutscene-playback spike precedes M05b | INDEX §5 | [ADR-0006](../docs/decisions/ADR-0006-v1-vertical-slice.md) |
| A-10 | **Region**: v1 US-only behind a geo-gate | INDEX §4 rule 23 | [ADR-0026](../docs/decisions/ADR-0026-us-only-region.md) |

## 3. Superseded items in the master prompt's `<decided>` list
- "Start on WebGL2 with the WebGPU renderer behind a flag" → D-07.
- Library pins `postprocessing@6.39.5`, `n8ao@2.0.1` → removed (D-10).
- "Supabase … anonymous-then-linked auth" as the identity spine → D-03 (anonymous sign-in is the fallback only).
- "MiniMax's current video model … exact endpoint verified by S00" → A-08 (licence-gated target with fallback chain).
- Example of real-person NPCs at `parody` by default → D-29 adds `fictionalized` for the deceased and for founders of real companies.

## 4. Gated decisions (applied as defaults on 2026-10-18; the run is unattended)
- **G1** Supabase (D-02; [ADR-0008](../docs/decisions/ADR-0008-supabase-over-convex.md)).
- **G2** Living people `parody`; Mac Dre and founders of real companies `fictionalized`; consent outreach order per INDEX §7 ([ADR-0013](../docs/decisions/ADR-0013-likeness-tiers-and-kill-switch.md)).
- **G3** Recurring ceiling $500/month (Anthropic $350, voice $100, moderation $25, buffer $25). **fal.ai: hard cap USD 100 total** (owner decision 2026-10-18, DL-OWN-01; supersedes the earlier $1,000 one-off figure): allocation spike ≤ $10 (M00c) · characters ≤ $42 (≤ 8 Standard heroes at ≈ $3.67 + ≤ 12 Lean at ≈ $1.05 = $41.96; DL-172: S05 recipe with programmatic crops; research's $3.73 priced vendor crops) · cutscenes ≤ $40 (Turbo/fallback chain, shortest clips that work; everything else in-engine) · buffer $8; enforced by `budget_program` = 100,000,000 USD micros in BudgetGovernorDO, a prepaid fal balance with auto-recharge off, `FAL_MODE=mock` by default in dev/CI, and a `--live` flag plus dry-run cost estimate on every paid job. No player-triggered fal generation in v1: the NPC builder uses creator-kit bodies; custom 3D for user NPCs goes through an owner-approved queue that counts against the cap. Per-player quotas and governor thresholds per INDEX §7. Layers and thresholds: [ADR-0015](../docs/decisions/ADR-0015-cost-controls.md).

## 5. Verified facts
Two homes, each fact in exactly one of them (DL-556). **Research facts:** the ledger `research/INDEX.md` §2 (F-001 … F-068, checked 2026-10-18); this file does not copy it, so there is one place to correct a fact. Domain specs cite `[research/<file>.md]` or `F-NNN`. §6 lists, per milestone, the ledger rows its scope and acceptance criteria rely on. **Builder-verified facts and resolved versions:** §7 of this file, which is where `CLAUDE.md`, `AGENTS.md`, the kickoff and the milestone notes mean by "record it in `spec/03`"; a Builder never edits `research/INDEX.md`. The Architect may move a §7 row into the ledger as a new F row at a checkpoint (moved, not copied: the §7 row is replaced by a pointer to the F id). Items that could not be verified are `UNVERIFIED` and listed in `spec/99-open-questions.md`.

### Builder-verified facts

Checked against the published packages and by running them; no URL beyond the package itself.

| Date | Fact | Source | Used by |
|---|---|---|---|
| 2026-10-18 | `@dimforge/rapier3d-simd-compat@0.21.0` and `@dimforge/rapier3d-deterministic-compat@0.21.0` export the same API from `dist/rapier.mjs` (default export `RAPIER`); `await RAPIER.init()` takes no arguments; `RAPIER.version()` is `0.21.0`. The embedded wasm makes the minified chunks 4.62 MB (simd) and 4.37 MB (deterministic). | typings in `dist/*.d.ts`, `vite build` output | M01a2 |
| 2026-10-18 | `ColliderDesc.heightfield(nrows, ncols, heights, scale)` takes `(nrows + 1) x (ncols + 1)` samples in column-major order; columns run along X, rows along Z; the collider is centred on its translation and `scale` is the full extent. | ray casts against a ramp in `packages/engine/test/physics.backend.spec.ts` | M01a2, M02a1 |
| 2026-10-18 | `RigidBody.handle` and `Collider.handle` are bit-cast f64 values (the first body is `0`, the first collider `5e-324`), not small integers. `World.takeSnapshot()` returns bytes and `World.restoreSnapshot(bytes)` is static and returns a new `World` with the same handles; re-running from a restored snapshot reproduces the original hash exactly (ECS, RNG and Rapier). | `physics.snapshot.spec.ts` | M01a2, M04a |
| 2026-10-18 | On the same input in Node 22, `simd-compat` and `deterministic-compat` give different state hashes for the `physics-drop` scenario; two runs of either build agree. The `deterministic-compat` hash is identical in Node 22, Chromium (Playwright 1.64.1) and WebKit 2370 on Linux. | `determinism.node.spec.ts`, `tests/e2e/determinism.spec.ts` | M01a2, U-ENG-1 |
| 2026-10-18 | `Atomics.waitAsync` is in the runtime (Node 22, Chromium, WebKit) but not in the TypeScript `ES2023` lib: call it through a structural cast. Playwright WebKit on Linux is cross-origin isolated and uses the SAB transport. | `sab-transport.ts`, `tests/e2e/boot.spec.ts` | M01a2 |
| 2026-10-19 | Rapier 0.21.0 `KinematicCharacterController` (from `World.createCharacterController(offset)`): `enableAutostep(maxHeight, minWidth, includeDynamicBodies)`, `enableSnapToGround(distance)`, `setMaxSlopeClimbAngle(rad)`, `setMinSlopeSlideAngle(rad)`, `setSlideEnabled(bool)`, `computeColliderMovement(collider, desired, filterFlags?, filterGroups?, predicate?)`, then `computedMovement()`, `computedGrounded()`, `numComputedCollisions()`, `computedCollision(i, out?)` (its `normal1` is the contact normal). This closes the UNVERIFIED call names in the M01b1 risks. With autostep 0.4 m / min width 0.2 m, snap 0.5 m, climb 45 degrees: a 0.35 m step is climbed, a 0.5 m step and a 50 degree slope block a head-on move. | typings in `dist/control/character_controller.d.ts`; `control.onfoot.spec.ts` | M01b1, M03a1 |
| 2026-10-19 | Rapier queries (`castRayAndGetNormal`, `castShape`, the KCC) do not see colliders added since the last `World.step()`: before the first step a ray hits nothing and a character falls through. A restored snapshot (`restoreSnapshot`) queries correctly at once. `castShape(pos, rot, vel, shape, targetDistance, maxToi, stopAtPenetration, flags, groups)` returns `time_of_impact` and `normal1`; a shape that starts touching returns time 0. | `physics.backend.spec.ts`, `control.ownership.spec.ts` | M01b1, M02b1 |
| 2026-10-19 | The M01b1 `walk-drop` scenario (10,000 ticks, `canonical`, the seeded bot driving the player through KCC moves, a 4 m drop and a forced rebase) gives the same 16 checkpoint hashes and final hash in Node 22, Chromium (Playwright 1.64.1) and WebKit 2370 on Linux (final `5444e209fdf70c56`). | `determinism.node.spec.ts`, `tests/e2e/determinism.spec.ts` | M01b1, U-ENG-1 |

**Builder-recorded (M01d, 2026-10-18).** `rclone` was not installed in the Builder environment, so no installed version is recorded and the flags below were not run against a real binary. Used as the research names them [research/gap-ci-cd-release-assets.md section 2.1, rclone 1.75.2]: `copy`, `--include`, `--exclude`, `--immutable`, `--ignore-existing`, `--header-upload`, and the env remote `RCLONE_CONFIG_R2_*` with `NO_CHECK_BUCKET=true`. Not in the research, therefore UNVERIFIED until the operator's first live run (M01d AC-11): `rclone lsjson -R --files-only --no-modtime --no-mimetype <remote>` for the size check, and the `Copied (new)` log wording that the `uploaded N` count reads under `-v`. R2 bucket-creation and CORS command syntax: dashboard path in `docs/runbooks/r2-media.md`.

## 6. Facts each milestone relies on
Milestone ids are the register in `spec/00-plan.md` (final per `spec/.wave5-notes.md` item 5). A split family appears as one row naming its parts (`1`, `2`, `3` digit suffixes; M11b2's second part is M11b4; M14b has three parts per DL-212); the row applies to every part (DL-206). "F rows" are `research/INDEX.md` §2 rows, so the number is the row id there. Where a domain keeps its own local fact (for example F-S12-01 in `12-modding.md` §7), the row names it. **Recorded, not asserted** lists UNVERIFIED items from `spec/99-open-questions.md` that a device run or spike writes down as checklist output; no acceptance criterion may assert them (C15). A milestone author who adds or drops a dependency edits the row in the same pull request.

| Milestone | F rows | What the scope and acceptance criteria rely on | Recorded, not asserted |
|---|---|---|---|
| M00 | F-001, F-002, F-011, F-016, F-018, F-019, F-061, F-062 | pins; three r186 and the WebGL2 fallback probe; iPhone manifest rules; Workers Paid; headers on static assets; Previews per PR; SwiftShader, WebKit-on-Linux and IWER limits | U-PLT-19, U-BE-3, U-BE-20 |
| M00a | F-018, F-019, F-027, F-061 | `/api/*` Worker-first with isolation headers in code; no request bodies logged (log billing); Preview URL echo | — |
| M00b | F-041, F-042, F-049, F-050, F-053, F-054, F-067 | registry statuses and vendor-terms snapshots; ODbL and PDDL allowlist entries; franchise mark in `ip:strings` | U-AST-9, U-AST-10 |
| M00c | F-017, F-039, F-040, F-041, F-042, F-043, F-044, F-045, F-046, F-047, F-048 | spike prices, codecs and C2PA probe, queue and webhook behaviour, no vendor cap | U-AST-1 to U-AST-4, U-AST-7, U-AST-8, U-AST-14 |
| M01a1, M01a2 | F-006, F-014, F-016, F-062 | pins; Rapier 0.21.0 builds and snapshot; no `navigator.xr` in workers; cross-browser hash runs in Chromium and WebKit | U-ENG-1, U-ENG-2 |
| M01b1, M01b2 | F-004, F-006, F-011, F-013, F-062 | no Pointer Lock or vibration on iPhone; Home Screen web apps; XR on the main thread; Quest 72 Hz; IWER smoke | U-ENG-5 |
| M01c | F-002, F-003, F-004, F-005, F-006, F-009, F-010, F-011, F-012, F-013, F-064 | device classification, memory-bomb page, renderer swap at XR entry, fewer encoders per frame, `GPUDevice.lost` | U-PLT-1, U-PLT-2, U-PLT-4, U-PLT-6, U-PLT-7, U-PLT-9, U-PLT-14, U-PLT-15, U-PLT-18, U-ENG-5, U-ENG-8 |
| M01d | F-017, F-018, F-019, F-023 | gltf-transform and KTX pins; 25 MiB per file; identity encoding for Range; R2 prices and presign | U-AST-13 |
| M01e | F-009, F-010, F-019 | WebContent memory; origin quota and `persist()`; Range through the pack store | U-PLT-16 |
| M01f | none | hand-authored fixture and pure codec; no external-system fact | — |
| M02a1 | F-017, F-023, F-053, F-054, F-055, F-056 | pack format and size; R2; ODbL attribution; PDDL footprints; sources excluded (3D Tiles, Mapbox) | S02 items (Geofabrik routes, SPDX strings) |
| M02a2 | F-053, F-054 | OSM road tags and DataSF streets for the graph | U-W5 |
| M02b1 | F-007, F-010, F-013, F-019, F-023 | render-object budgets; pack store quota; Range; Quest draw-call limit; pack download | pack GET speed (S02) |
| M02b2 | F-001 | three r186 node materials for sky and fog | — |
| M02c1 | none | pure services over baked data; no external-system fact | — |
| M02c2 | F-053, F-054, F-056 | OSM attribution; EAS addresses for geocoding; no Mapbox runtime | — |
| M02d1, M02d2 | F-007, F-017, F-053 | landmark objects inside the budget; glTF and KTX2 pipeline; OSM landmark ids | — |
| M03a1 | F-014, F-017 | ray-cast vehicle controller; prefab asset formats | U-ENG-6 |
| M03a2 | F-014 | Rapier per-wheel contact and impulse readout | U-RAC-1 |
| M03b1 | F-007 | ambient agents and instancing within the object budget | — |
| M03b2 | F-007 | crowd instancing within the object budget | — |
| M03c | none | pure sim; no external-system fact | — |
| M04a1, M04a2 | F-009, F-010 | killed-tab recovery; storage quota | U-ENG-9 |
| M04b1 | F-004, F-010, F-011 | coach mark instead of install prompt; Settings storage panel | — |
| M04b2 | F-004, F-011 | Home Screen web apps; no fullscreen, orientation lock or vibration | — |
| M04b3 | none | WebCrypto device key; no ledger row | — |
| M04c | F-004, F-005, F-043, F-063 | fixture clips match H3 output format; Low Power Mode video gesture; XR media paths | U-PLT-17, U-S03-4, U-S03-7, U-REC-1 |
| M05a1, M05a2 | none | pure sim, VM and CI autoplayer; no external-system fact | — |
| M05b1 | F-023, F-024, F-042, F-043, F-047, F-048 | `HEAD` readiness; Workflow limits; no browser-to-fal; webhook verification; no vendor cap | U-AST-5, U-AST-15, U-BE-6, U-BE-13 |
| M05b2 | F-039, F-040, F-043, F-063 | key inputs, fixture manifests, iOS video gesture | — |
| M05c1 | none | authored content on mocks; no external-system fact | — |
| M05c2 | F-039, F-041, F-042, F-043, F-050 | provider gate, licence exclusions, fallback chain | U-AST-16 |
| M05c3 | F-039, F-040, F-041, F-042, F-043, F-047, F-048, F-050 | prewarm through a cleared provider; webhook retries; cap | U-AST-16 |
| M05d | F-016, F-029, F-030, F-032 | supabase-js pin; Pro plan and `us-west-1`; publishable and secret keys | — |
| M05e1, M05e2, M05f1, M05f2 | none | authored story content; clips follow the M05b and M05c3 gates | — |
| M06a1 | F-020, F-021, F-022, F-025, F-028, F-029, F-034, F-037 | Durable Object limits and pricing; pgvector storage; embedding price; gateway limits; Anthropic prices and tiers | U-BE-17 |
| M06a2 | F-038, F-051 | AI disclosure; voice-clone rule | — |
| M06a3 | F-028, F-034, F-035, F-036, F-037, F-038 | gateway behaviour; cache prefix minimum; no sampling parameters; AI disclosure | Haiku TTFT (S04), U-BE-17 |
| M06a4 | F-025, F-029, F-051, F-052 | bge-m3 and Aura prices; pgvector; ElevenLabs terms and `character_limit` | ElevenLabs plan terms (Q-20) |
| M06a5 | F-038 | AI badge and disclosure copy | — |
| M06b1 | F-034, F-036, F-038 | Haiku drafting; text-only builder | — |
| M06b2 | F-042, F-065, F-066 | 18+ end users; CSAM tool scope; 48-hour removal | U-BE-9 |
| M06b3 | none | UI over S04 routes; no external-system fact | — |
| M06b4 | F-042, F-044, F-045, F-047, F-048 | owner-approved queue only (DL-175): Lean build prices, webhook, cap | — |
| M06c | F-025 | baked barks through Workers AI voices | — |
| M07a1, M07a2 | F-014 | ray-cast vehicle; `deterministic-compat` for replays and ghosts | S06 items (`06-racing.md` §7) |
| M07b1 | none | authored race content; no external-system fact | — |
| M07b2 | F-007, F-008, F-011 | visual pass without `postprocessing`; object budget; iPhone limits | SSR and motion-blur cost (S06) |
| M08a1 | none | pure `detmath` fight core; no external-system fact | — |
| M08a2 | F-011 | touch controls on iPhone | — |
| M08b1 | none | balance harness and roster gates; no external-system fact | — |
| M08b2 | F-039, F-040, F-043, F-063 | clip composition inputs; iOS video gesture | S07 clip-identity items |
| M08c1 | F-057, F-058 | MediaPipe tasks-vision 1.1.1; YOLO excluded | Q-S07-1 |
| M08c2 | F-057, F-058 | on-device pose; licence exclusion | PoseLandmarker latency on iPhone, Q-S07-3 |
| M09a1, M09a2 | none | pure tycoon sim and harness; no external-system fact | — |
| M09b1 | F-013 | XR desk panel budget | — |
| M09b2 | F-034, F-035, F-036 | Haiku and Sonnet pitch meetings; caching; no sampling parameters | Haiku TTFT (S04) |
| M10a1, M10a2 | F-017, F-042, F-044, F-045, F-046, F-047, F-048 | sheet, mesh and rig prices; webhook; glTF pipeline; cap | U-AST-1, U-AST-2, U-AST-17 |
| M10b | F-023, F-043, F-047, F-048 | prefix purge; C2PA re-sign inputs; idempotent prewarm; cap | U-BE-10 |
| M10c | F-025, F-046, F-051 | Workers AI and MiniMax voice prices; ElevenLabs terms | — |
| M10d1 | F-017 | KTX2 and meshopt tooling for the art-pass assets (DL-390, DL-547) | U-AST-10 (CC0 catalogue terms; the licence snapshot is the evidence) |
| M10d2 | F-017 | KTX2 facade atlas and skyline cards (DL-390, DL-547) | U-PLT-8 (takram atmosphere on r186, AC-9 record) |
| M10d3 | F-017 | KTX2 and meshopt tooling for player cars and fight stages (DL-460, DL-547) | U-AST-10 |
| M10e | F-018, F-025 | 25 MiB per static file; Workers AI voice render through the M10c route (DL-500, DL-547) | U-AST-10, U-AST-11 (sound-effects endpoint terms), U-AST-14 (bark container on iOS) |
| M11a1, M11a2 | F-004, F-007, F-009, F-010, F-011, F-012, F-013, F-062, F-063, F-064 | iPhone memory, quota and eviction; render-object cost; Quest budgets; Low Power Mode; crash visibility (Chromium `crash-reporting` group and `body.reason`, [research/gap-observability-cost-guardrails.md §2.1], DL-224) | U-PLT-1 to U-PLT-5, U-PLT-8, U-PLT-20, U-REC-2 |
| M11b1 | F-002, F-003, F-005, F-006, F-013, F-062 | XR session and renderer swap; visionOS and Quest support; Window-only `navigator.xr`; IWER | U-PLT-10, U-PLT-12, U-PLT-13 |
| M11b2, M11b4 | F-003, F-005, F-006, F-013, F-043, F-062 | per-mode XR; media layer and `VideoFrameTexture`; clip format | U-PLT-10, U-PLT-20 |
| M11b3 | F-005, F-006, F-013 | XR panels and comfort on Quest and Vision Pro | — |
| M12a1 | F-029, F-030, F-031, F-032 | Supabase Pro limits; anonymous-sign-in limits (fallback); Custom OIDC; keys | U-BE-2, U-BE-16 |
| M12a2 | none | UI over identity routes; no external-system fact | — |
| M12b1, M12b2 | F-020, F-021, F-022 | hibernating sockets, attachment size, deploy restarts; pricing; no timers while hibernating | U-BE-1, U-ENG-3, U-ENG-4 |
| M12c1, M12c2 | F-020, F-021, F-022, F-027 | room cap and cost; resume across deploys; log volume | U-BE-4, U-BE-5, U-BE-14, U-BE-21 |
| M12d | none | UI over presence routes; no external-system fact | — |
| M12e | none | plausibility validators in shared cores; no external-system fact | — |
| M13a1 | F-017, F-060 | validators for glTF and KTX2; `AGENTS.md` size cap | S12 U9 |
| M13a2 | F-010 | OPFS quota for installed mods | — |
| M13a3 | F-007, F-009, F-013 | per-tier budgets for mod content | — |
| M13a4 | F-009, F-013 | memory ceilings; script budget | S12 U1 |
| M13a5 | F-004, F-005, F-013 | frame behaviour on Safari 26, Quest Browser and visionOS Safari (also F-S12-01 and F-S12-02 in `12-modding.md` §7) | S12 U2, S12 U3 |
| M13a6 | F-060 | Codex `AGENTS.md` cap and skills location | Q-22 npm scope (S12 U5) |
| M13a7 | none | store pages over routes 35 to 37; no external-system fact | — |
| M13b1 | F-029, F-065, F-066 | forum tables; CSAM tool scope; 48-hour removal | U-BE-9 |
| M13b2 | F-053, F-054, F-056 | web tiles from OSM; DataSF anchor datasets; no Mapbox | — |
| M13b3 | F-007 | scene-op caps against render budgets | — |
| M13b4 | none | forum UI; no external-system fact | — |
| M13c1 | F-031, F-060 | device-code login; sign-in program limits | U-ADR-01 |
| M13c2 | F-024, F-054, F-065, F-066 | rebake Workflow; anchor datasets; scan pipeline; removal clocks | U-BE-9, S12 U11 |
| M13c3 | F-060 | plan-usage rules and kit licence | Q-22 |
| M13d1 | F-065, F-066 | CSAM tooling; 48-hour removal; evidence audit | U-BE-9, U-BE-11, U-BE-12 |
| M13d2 | F-066 | takedown forms | — |
| M14a | F-059 | thirdweb version and Growth plan price | thirdweb free tier |
| M14b1, M14b2, M14b3 | F-027, F-028, F-034, F-037, F-041, F-042, F-048, F-052, F-067 | alert rules and billing; vendor caps; terms-watch inputs; mark knock-out | U-BE-15, U-BE-18, U-BE-19, U-ENG-4 (M14b3 iPhone pass, DL-239) |
| M00d | none | C15 milestone-format lint and the trace test; repository-internal only (DL-212, DL-214) | — |
| M04d | F-014 | QA harness: headless canonical sim, state hash, autoplayer bots, goldens; deterministic Rapier build | U-ENG-1 |
| M14c | none | accessibility and i18n gates; no external-system fact | — |
| M15a to M15g | F-017, F-023, F-053, F-054 | same grid, packs and OSM and DataSF sources; other counties' open data is not in the ledger and is listed when those specs are written | — |

Rows that say "none" depend on no external system: their proofs are repository commands over pure code or authored data.

## 7. Builder-recorded facts and resolved versions
Builders append one row per fact they verify or library version pnpm resolves outside the ledger (CLAUDE.md "Facts and sources"; DL-556), in the same pull request as the milestone. A row never restates an F row; a fact that contradicts an F row is reported to the Architect and recorded here with the observed value, and the F row is corrected in `research/INDEX.md` by the Architect only. Versions recorded here stay out of acceptance criteria. Parallel Builders append at the end of the table and resolve merge conflicts by keeping both rows.

| Item | Value | URL | Date | Milestone |
|---|---|---|---|---|
| OPFS in Playwright WebKit (build 2370, Linux) | In a default (ephemeral) context, `navigator.storage.getDirectory()` rejects with `UnknownError` on the main thread and in a dedicated worker; in a `launchPersistentContext` context it resolves, `createWritable` exists on the file handle, and `createSyncAccessHandle` exists in workers only. `storage.estimate()` works in both (quota about 1 GB). Observed locally, not documented by the vendor. | observed: `webkit.launch()` against the QA build, 2026-10-19 | 2026-10-19 | M01e |
| OPFS write path per engine (M01e e2e) | Both Playwright `chromium` 1248 and `webkit` 2370 (persistent context) write packs through `createSyncAccessHandle` in the dedicated worker (`opfs write path = sync`); the `createWritable` fallback was not needed in either. | observed: `tests/e2e/pack-store.spec.ts` | 2026-10-19 | M01e |

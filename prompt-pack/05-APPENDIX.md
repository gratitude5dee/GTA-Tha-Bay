# 05 — APPENDIX · verified facts, decisions, constraints, likeness policy, risks, cost inputs

> Status 2026-10-18: facts below come from the reports in `research/` that exist today (example-repo analyses, Anthropic model facts, Claude Code deployment). The stack dimensions still to be verified (Cloudflare limits, Three.js/WebGPU/WebXR status, fal endpoints and prices, Thirdweb, Sign-in-with-ChatGPT, MediaPipe, legal) are produced by the Architect's S00 subagents in Phase 0 and land in `research/INDEX.md` as the F-NNN ledger. Nothing here is legal advice.

## A. Verified-facts ledger (seed)
| ID | Fact | Source | Date | Confidence |
|---|---|---|---|---|
| F-001 | Claude Opus 5.5 = `claude-opus-5-5`; 1M context; 128K max output; $4 / $20 per MTok (cache read $0.20); thinking always on; effort default `medium`; forced tool_choice removed | bundled Anthropic claude-api reference (cached 2026-10-06) | 2026-10-18 | high |
| F-002 | Claude Sonnet 5.5 = `claude-sonnet-5-5`; 1M / 128K; $2 / $10; effort default `high` (start `medium` for agentic coding); `thinking: {type:"between_tools"}` to turn thinking off | same | 2026-10-18 | high |
| F-003 | Claude Haiku 5.5 = `claude-haiku-5-5`; $0.10 / $0.50 per MTok up to 100K-token prompts; suitable for in-game NPC dialogue at scale | same | 2026-10-18 | high |
| F-004 | Structured outputs via `output_config.format`; prompt caching is prefix-based (tools → system → messages, ≤4 breakpoints); mid-conversation `{role:"system"}` messages keep the cached prefix; no assistant prefill on 5.x | same | 2026-10-18 | high |
| F-005 | Claude Code subagent frontmatter supports `name, description, tools, model (full id or alias), effort, maxTurns, background, permissionMode, memory, skills, hooks`; 20 concurrent subagents; depth 3; subagents see CLAUDE.md, not the conversation | code.claude.com/docs/en/sub-agents.md | 2026-10-18 | high |
| F-006 | Skills: `.claude/skills/<name>/SKILL.md`, `disable-model-invocation: true` makes it user-only; SKILL.md ≤ 500 lines; CLAUDE.md target < 200 lines; AGENTS.md read directly only when no CLAUDE.md exists (else import with `@AGENTS.md`) | code.claude.com/docs/en/skills.md, /memory.md | 2026-10-18 | high |
| F-007 | Headless: `claude -p` with `--model --effort --max-turns --max-budget-usd --permission-mode --allowedTools --agents --output-format stream-json --resume`; `-p`/SDK runs fail (do not pause) at subscription usage limits | code.claude.com/docs/en/headless.md, /cli-reference.md, /costs.md | 2026-10-18 | high |
| F-008 | DataSF building footprints (`ynuv-fyni`) are PDDL (public domain dedication) with attribution to the City and County of San Francisco; rows updated 2026-10-17 | research/repos-world.md §4 (Socrata metadata) | 2026-10-18 | high |
| F-009 | OpenStreetMap data is ODbL 1.0 (attribution required; derived databases share-alike; rendered game output is a "produced work") | research/repos-world.md §4 | 2026-10-18 | high |
| F-010 | AWS Terrain Tiles (Terrarium PNG, `s3://elevation-tiles-prod`) are public-domain 3DEP-derived with citation requirements | research/repos-world.md §4 | 2026-10-18 | high |
| F-011 | Google Photorealistic 3D Tiles terms prohibit pre-fetching, caching and offline use → not usable as cached game geometry | research/repos-world.md §4 | 2026-10-18 | high |
| F-012 | Mapbox Product Terms (2025-10-01) §1.6 forbid deriving/extracting content from the service; §1.4.1 mandates attribution → Mapbox tiles cannot become world geometry; the Mapbox CLI (MIT) is fine for tooling | research/repos-world.md §4 | 2026-10-18 | high |
| F-013 | Protomaps PMTiles can be served from an R2 bucket through a Worker with range requests; OSM attribution required | research/repos-world.md §4 | 2026-10-18 | medium |
| F-014 | Library versions observed on npm 2026-10-18: `three@0.186.1`, `postprocessing@6.39.5`, `n8ao@2.0.1`, `earcut@3.2.4`, `3d-tiles-renderer@0.5.3` | research/repos-world.md §5 | 2026-10-18 | medium (re-pin in S00) |
| F-015 | A working web-port runtime uses a main thread + IO worker + WebGPU worker with SharedArrayBuffer ring buffers (COOP/COEP required), a file manifest with ranges, and IndexedDB/OPFS caching; iOS forbids JIT and constrains memory → stream aggressively, cap textures, avoid large contiguous WASM heaps | research/repos-webport.md §2, §3.6 | 2026-10-18 | high (pattern), facts about iOS re-verified in S00 |
| F-016 | A verified relay-room protocol: JSON over WebSocket, `check/join → welcome{id,peers,hz:20}/joined/pose/left`, server-assigned 16-hex ids, monotonic seq, token bucket ~30/25 per s, coalesce-latest-pose, bounded queues closing slow receivers, 20 s heartbeat, 2 KB frames | research/repos-grand-v.md (relay.rs) | 2026-10-18 | high |
| F-017 | **Ideas only (DL-722, DL-732):** an unlicensed launcher answers one POST carrying many `[file,start,end]` runs (≤ 1000 runs, ≤ 64 MiB) with the runs concatenated and their lengths listed in a response header. Its path, query flags and header name are not ours; any batch route of ours (conditional, DL-722) defines its own framing and names | research/repos-grand-v.md (server.rs) | 2026-10-18 | high |
| F-018 | Mod-store/importer limits observed in a shipped web port: 64 packages, 512 MiB, traffic ≤16 models / ≤3 instances; mods and multiplayer not combinable | research/repos-grand-v.md | 2026-10-18 | high (as precedent, not a constraint) |
| F-019 | Example repos playgta5/muguet/Grand-V depend on Rockstar-derived game data (`game.wasm`, RPF/GXT, Menyoo hooks); upstream Grand-V has no license | research/repos-webport.md §5, research/repos-grand-v.md §5 | 2026-10-18 | high |

## B. Decision log (seed; the Architect converts these into ADRs)
1. Open-data world (DataSF + OSM + Terrarium + USGS); no Google 3D Tiles or Mapbox tiles in v1. 2. ENU frame at SF City Hall; bake pipeline with terrain, buildings, drivable + pedestrian graphs; East Bay/Peninsula as a flat "region" tier. 3. Instanced ambient life on baked graphs; keyframed time-of-day/weather base tier. 4. TypeScript mission DSL with simulate-once/record/scrub playback and an auto-director camera. 5. Start on WebGL2 with WebGPURenderer behind a flag until S00 confirms target-platform stability. 6. Protomaps PMTiles from R2 for map/minimap. 7. Batch-range chunk streaming via Worker + R2 with COOP/COEP. 8. One Durable Object per multiplayer room, modeled on the verified relay protocol, server-authoritative. 9. Sandboxed typed ModAPI; transactional install; mods off in multiplayer until vetted. 10. NPC dialogue proxy on `claude-haiku-5-5` / `claude-sonnet-5-5` with prompt caching. 11. Master prompt as a user-invoked skill; subagents pin model + effort. 12. Default G1 = Supabase (pgvector, RLS, anonymous-then-linked auth) with DO rooms; Convex documented as the alternative.

## C. Constraints block (engineering guidance; not legal advice)
1. Original content only; provenance manifest + CI check; display name is one config value. 2. Example repos: patterns only; never their data, shaders, hooks or mirrors. 3. Real-person NPCs carry a likeness tier (§D) enforced by pipeline + kill-switch; no real-voice cloning without `consented`. 4. World data under its licenses: attribute OSM/DataSF/Terrarium in-app; never cache Google 3D Tiles or derive from Mapbox tiles. 5. Pose camera frames stay on device; parental-consent flag gates camera features. 6. UGC: terms of service, moderation queue before public visibility, report button everywhere UGC renders, DMCA takedown path and designated agent. 7. No real-money or token economy in v1; Thirdweb is identity only. 8. Music: original or licensed; no artist recordings without a sync license; AI-music outputs tracked with provenance. 9. Everything about an external system cites research or is `UNVERIFIED`.

## D. Likeness policy (data model)
`soul.md` frontmatter: `likeness: { tier: consented | parody | fictionalized, consent_record?: path, display_name, real_name?: string (consented only), design_notes, voice: { mode: synthetic | consented-clone, consent_record? } }`. Pipeline rules: `consented` → reference images may be used for face generation; `parody` → altered name, stylized design, no face reference uploaded to generators, voice synthetic; `fictionalized` → archetype only. Kill-switch: a server-side `roster.json` flag removes a character from live builds (NPC spawns, fighter roster, cutscene cache) without a deploy. Consent record: who, what (likeness/voice/name), scope, date, revocation path.

## E. Risk register (seed)
| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| RISK-01 | WebGPU instability on iOS/Quest at launch | M | H | WebGL2 path first; WebGPU behind a flag with telemetry |
| RISK-02 | Accurate SF exceeds mobile memory budget | H | H | tiered building representation; pixel/DPR governor; streaming radius per tier |
| RISK-03 | Trademark/likeness complaints | M | H | rename-ready title; parody default; kill-switch; consent records |
| RISK-04 | GenAI cost runaway (cutscenes, NPC chat) | M | M | cache keys; per-player quotas; budget alarms; Haiku default |
| RISK-05 | Sign-in-with-ChatGPT unavailable or changed | M | M | fallback: bring-your-own-agent via mod SDK + local CLI |
| RISK-06 | Multiplayer authority/cheating | M | M | DO authoritative; rate limits; mods off in rooms |
| RISK-07 | Builder drift between milestones | M | H | contracts frozen; traceability; critic passes; one milestone per session |
| RISK-08 | Map-data license drift | L | M | pinned extracts with attribution; provenance manifest |
| RISK-09 | Pose-control latency makes the fighter unplayable | M | M | on-device landmarker, temporal smoothing, calibration, pad fallback |
| RISK-10 | Research facts stale by build time | H | M | ledger with dates; `/architect fix: facts` loop |

## F. Cost model inputs (to be completed by S00)
Known: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per MTok. To verify: fal.ai per-clip video price and duration, image-to-3D and rigging per asset, TTS per 1k characters, Cloudflare Workers/DO/R2 unit prices, Supabase/Convex tiers. Architect run ≈ $40–90; Builder ≈ $5–25 per milestone.

## G. Glossary
See `06-SHARED-CONTEXT.md` §6.

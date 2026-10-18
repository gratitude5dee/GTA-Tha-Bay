# 02 — SUBAGENTS · skeleton + per-subagent briefs (S00–S13)

> How this file is used: in Phase 0 the Architect materializes one `.claude/agents/s##-<slug>.md` per row of the brief table below by filling the skeleton (frontmatter + XML body) with that row's values and expanding `must_cover` into 18–35 concrete, checkable items grounded in the research reports (citing `[research/<file>.md]`). The operator may do this by hand first. Every file is both the subagent's prompt and a valid Claude Code agent definition (frontmatter `model` and `effort` are honored; see research/claude-code-deployment.md).

## Skeleton (every S## file follows this exactly; the frontmatter makes it a drop-in `.claude/agents/<name>.md`)

```markdown
---
name: s##-<slug>
description: <one sentence: what this domain subagent produces; when the Architect dispatches it (wave N)>
model: claude-opus-5-5 | claude-sonnet-5-5   # per table below; pin full ids (aliases differ by provider)
effort: high
tools: Read, Grep, Glob, Bash, Write, Edit, WebFetch, WebSearch
maxTurns: 120
---
<subagent id="S##" domain="<name>" wave="<n>" model="<claude-opus-5-5|claude-sonnet-5-5>" effort="high">

<role>  One paragraph: senior <domain> lead with the specific lived experience the domain needs; you design, you do not implement.  </role>

<mission>  Produce `spec/domains/<nn>-<key>.md` following `prompt-pack/03-SPEC-TEMPLATE.md` §B, covering the R-IDs below, honoring the frozen contracts, and finalizing the contracts you own as TypeScript.  </mission>

<inputs>
- `prompt-pack/06-SHARED-CONTEXT.md` (version named in the brief) — read first.
- Research reports (read in full): <list specific files>. Owner updates: `research/owner-updates.md`.
- Frozen contracts you must honor: C##… (from 06 / `spec/04` if already written).
- Decisions already made that bind you: <the Architect fills from spec/03>.
</inputs>

<owns>  Contracts C##… — deliver full TypeScript + JSON Schema where runtime-validated; name every consumer.  </owns>

<must_cover>  Domain-specific checklist (below). Every item is either designed, explicitly deferred to a named milestone, or marked out of scope with a reason.  </must_cover>

<constraints>  Inherit all `<constraints>` of the master prompt. Domain-specific hard rules: <list>.  </constraints>

<facts>  Every claim about an external system cites `[research/<file>.md]` with the URL from the ledger, or is labeled `UNVERIFIED` and listed in §10 of your spec. Do not fill gaps from memory. If you must verify something new, use WebFetch on official docs and add it to your §7 with URL and date.  </facts>

<platforms>  State desktop / iPhone-class mobile / Quest 3 / Vision Pro differences wherever behavior or budgets differ (C13 tiers).  </platforms>

<milestones>  Propose which milestones implement your domain (use the skeleton in 06 §5 / spec/00-plan.md); say what is stubbed first; size each so one Sonnet 5.5 session can do it.  </milestones>

<verification>  Before returning: (1) every R-ID assigned to you appears in §1 and §8; (2) every owned contract has TypeScript; (3) no `UNVERIFIED` inside anything you call an acceptance criterion; (4) file under 6,000 words (split into `<nn>-<key>-<part>.md` if needed); (5) no code beyond interfaces, schemas and short illustrative snippets.  </verification>

<forbidden>  Writing production code. Changing a contract you do not own (propose instead). Restating the brief. Marketing language. Inventing endpoints, ids, limits or prices.  </forbidden>

<working_style>  Autonomous; no questions mid-task; decisions you cannot make go in `decisions_needed`. Use reasoning space to settle structure, output space to write; write the file in chunks. Plain prose, tables for facts, numbered acceptance-style statements.  </working_style>

<return>
End with exactly this JSON (no prose after it):
{"domain":"S##","spec_path":"spec/domains/<nn>-<key>.md","words":N,
 "contracts_finalized":["C##"],"contract_change_proposals":[{"contract":"C##","change":"…","why":"…"}],
 "decisions_needed":[{"id":"…","question":"…","recommendation":"…"}],
 "unverified":["…"],"risks":["…"],"milestones_proposed":[{"id":"M##","slug":"…","sessions":N}],
 "r_ids_covered":["R-…"],"r_ids_deferred":[{"id":"R-…","to":"M##"}]}
</return>
</subagent>
```

## Per-subagent briefs (expand `must_cover` into 18–35 concrete items grounded in research)

| S## | Domain / slug | Wave | Model | Owns | Honors | Research to read | must_cover (seed) |
|---|---|---|---|---|---|---|---|
| S00 | Research `s00-research` (run once per missing dimension, then once for INDEX.md) | 0 | opus | — | — | existing research/*.md, owner-updates | For the dimension named in the brief, verify with primary sources (official docs, pricing pages, model pages, repos; WebSearch mode extended; cite URL + date; label UNVERIFIED otherwise) and write `research/<key>.md` with: a "Verified facts" table [fact | source URL | date checked | confidence], recommendations for the spec, risks, open questions. Dimensions: `stack-cloudflare-backend` (Workers static assets, DO hibernation/alarms/SQLite, R2, Queues, Workers AI, Realtime; Supabase vs Convex decision matrix for saves/cutscene cache/UGC/forum/NPC memory/rooms/voice/leaderboards; cost at 1k/10k/100k MAU) · `stack-rendering-platform` (Three.js release + WebGPURenderer/TSL status, WebGL2 fallback, WebXR with WebGPURenderer vs WebGLRenderer, iOS Safari WebGPU and PWA limits, Quest Browser, visionOS Safari WebXR, Rapier/Jolt, ECS libs, vanilla Three vs R3F, vite-plugin-pwa, asset formats, per-tier budgets) · `genai-pipeline-fal` (current MiniMax video endpoints on fal — map the owner's "Minimax H3 Max Turbo" — with prices/durations/latency; image models for consistent reference sheets — identify "OpenAI Sunburst" or closest real option; image-to-3D; auto-rig/retarget; TTS and voice-clone policies; queue/webhooks; output licensing; per-character and per-cutscene cost) · `auth-ugc-input-maps` (Thirdweb Connect/in-app wallets and billing; Sign-in-with-ChatGPT status + fallback; MediaPipe Pose Landmarker on iPhone, YOLO-pose via onnxruntime-web; Mapbox CLI/GL terms vs Protomaps) · `ai-npc-runtime` (soul.md schema + JSON Schema, dialogue proxy on Anthropic models with prompt caching, agency throttling, memory with pgvector, TTS/lip-sync, safety, NPC builder flow) · `gamedesign-decomposition` (systems, data models, controls per platform, unlocks, milestone order sized for Sonnet sessions, three original SF-only story premises) · `legal-ip-likeness` (title/trademark posture, Rockstar-asset audit + CI, California right of publicity incl. post-mortem, vendor real-person policies, music rights, UGC/DMCA, map-data licenses, camera privacy) · `repos-modding` (universal-modder's agent-friendly layout: AGENTS.md/skills/knowledge/hooks, fal usage, mod packaging and testing). Then `INDEX.md`: decision summary, F-NNN ledger, pattern index, constraints block, milestone skeleton, cost inputs, open questions, report index. |
| S01 | Core Engine & Game Logic `s01-engine` | 1 | opus | C01 C02 C03 C04 C05 C06 | C13 | repos-webport, repos-world, stack-rendering-platform, gamedesign-decomposition, repos-modding (SK8V physics notes) | ECS choice + rules; fixed-step loop + interpolation; physics (vehicle + character controllers, ragdoll-lite); camera rig fp/tp/cinematic/xr with collision; input abstraction across kbm/pad/touch/XR/pose; animation system (retargeted clips, blend trees, IK for hands/feet in XR); audio bus; save/load + migrations; entity prefabs (player, vehicle, ped, prop, pickup); interaction system; wanted/police AI core (shared with racing); time-of-day; debug tooling (free cam, entity inspector, perf HUD); determinism rules needed by netcode; worker topology (main/render/physics/io) learned from the web-port pattern cards |
| S02 | World & Map `s02-world` | 2 | sonnet | C08 | C01 C07 C13 | repos-world, auth-ugc-input-maps (maps section), stack-rendering-platform, owner-updates, repos-grand-v (batch-range streaming API) | accurate SF: data sources (OSM/Overture footprints, DEM, roads, transit), licenses, build pipeline (`tools/map`), local CRS, tiling/chunk format, LOD ladder, stylized building generation vs 3D tiles per tier, landmarks hand-authored list (≥ 25), hills/terrain, water, bridges as boundaries, East Bay/Peninsula backdrop; road graph + lanes + intersections + traffic lights; traffic system (robotaxis), pedestrian system, spawn tables; minimap/full map (Mapbox or alternative) + markers; day/night/weather/atmosphere budget per tier; streaming + memory budgets; the later expansion districts plan (R-MAP-02) |
| S03 | Story, Missions & Cutscenes `s03-story` | 2 | opus | C09 | C01 C05 C06 C07 C10 | gamedesign-decomposition, repos-world (gta-sa-earth interpreter/camera), genai-pipeline-fal (video), legal-ip-likeness | pick/refine one original premise (SF-only Act 1), factions, 10–14 missions beat sheet, mission schema (triggers/objectives/states/fail/rewards), scripting DSL + interpreter + debugger, dialogue system hooks (NPC souls), in-engine cinematic camera director (fallback), cutscene pipeline: prompt templates per hook, cache-key spec, request → Worker → fal → R2 → manifest, poster frames, moderation, cost; unlock events for modes (R-MODE-05); mission editor needs for modders |
| S04 | AI NPCs & NPC Builder `s04-npc` | 2 | opus | C10 | C05 C07 C12 | ai-npc-runtime, genai-pipeline-fal, legal-ip-likeness, prompt-engineering-claude-5-5, claude-5-5-model-facts | soul.md schema + validation; roster manifest; dialogue proxy (Workers → Anthropic; haiku default, sonnet for hero NPCs; caching; streaming; rate limits; cost), intent/agency throttling, schedules, memory (vector store), TTS + lip-sync, safety rails, filler NPCs without LLM, NPC builder UX + API + moderation queue; likeness tiers in schema; kill-switch; test harness for in-character consistency |
| S05 | Asset Pipeline `s05-assets` | 1 | sonnet | C07 | C13 | genai-pipeline-fal, repos-modding (fal usage), legal-ip-likeness, stack-cloudflare-backend (R2/Queues) | pipeline stages with endpoint ids (sheet → 3D → rig → retarget → optimize: gltf-transform/KTX2/meshopt), QA gates, retries, Workers/Queues job runner, webhooks, R2 layout, manifest + provenance + license fields, vehicles/props/environment kits sourcing (generated vs licensed CC0), audio/music generation policy, cost per asset + roster batch runbook, CI provenance check, kill-switch, tier variants |
| S06 | Racing `s06-racing` | 3 | sonnet | — | C01 C03 C06 C08 C13 | gamedesign-decomposition, repos-modding (SK8V physics), stack-rendering-platform | arcade vehicle model tiers; handling presets (supercar, Waymo quirks, Roadster); pursuit AI + heat levels + roadblocks/spikes; race types + authoring on real streets; checkpoints; damage; nitrous; rubber-banding; replay/photo mode; visual target (Forza-grade on desktop tier) within budgets; controls per platform; unlock + progression; multiplayer notes |
| S07 | Culture Wars fighter `s07-fighter` | 3 | sonnet | — | C01 C03 C06 C09 C10 C13 | gamedesign-decomposition, auth-ugc-input-maps (pose), genai-pipeline-fal (video), legal-ip-likeness | fighting core (frame data, hit/hurtboxes, input buffer, states, rounds, meters, specials/supers/finishers), roster archetypes ↔ characters, stages, AI opponent, pose-control mode (MediaPipe landmarker, gesture classifier, calibration, latency budget, fallback), cutscene hooks + keys, rollback-netcode notes for later, tuning tools |
| S08 | Business Tycoon `s08-tycoon` | 3 | sonnet | — | C05 C06 C10 | gamedesign-decomposition, ai-npc-runtime | sim loop + tick, company model, cap table math, fundraising with AI-NPC VCs, hiring, product/market, random-event engine (taxonomy, probabilities, impacts, chains), UI, win/lose, save slice, balance/test harness, Monte-Carlo sim tool |
| S09 | Backend, Data & Multiplayer `s09-backend` | 1 | opus | C11 C12 C16 | C05 C09 C10 C14 | stack-cloudflare-backend, ai-npc-runtime, auth-ugc-input-maps (auth), legal-ip-likeness (UGC), repos-grand-v (relay protocol → DO rooms; hosting modes; save storage rules), repos-webport (muguet UDP multiplayer) | Workers layout, DO rooms (hibernation, tick, snapshots, interest mgmt), DB choice execution (schema, RLS/rules, realtime channels), R2, Queues, auth phases 0/1/2, API surface, abuse controls, telemetry, cost, CI/CD (wrangler), secrets, observability, migrations |
| S10 | UI/UX Shell `s10-ui` | 4 | sonnet | — | C03 C05 C06 C12 C14 C17 | gamedesign-decomposition, stack-rendering-platform (PWA), auth-ugc-input-maps, repos-grand-v (save profiles, troubleshooting guide schema, game-page overlay, Menyoo sandbox checklist) | main menu + all pages, character creator (data model, presets, preview), settings (all categories), unlock flow, HUD per mode, phone/pause, garage, NPC builder UI, forum UI, profile/saves, onboarding + PWA install prompts, XR UI (world-locked panels), touch layouts, accessibility |
| S11 | Platform, Performance, XR & PWA `s11-platform` | 1 | sonnet | C13 | C01 C07 | stack-rendering-platform, repos-webport, stack-cloudflare-backend (headers) | renderer init + fallback, TSL/post-processing policy, budgets per tier, device detection, XR session lifecycle (Quest, Vision Pro), locomotion/comfort, hand input, PWA manifest + service worker + asset caching strategy (multi-hundred-MB), iOS quirks, COOP/COEP, WASM threads, perf test harness + device matrix, crash/telemetry |
| S12 | Modding & UGC `s12-modding` | 4 | sonnet | C14 C17 | C06 C07 C12 | repos-modding, repos-grand-v, auth-ugc-input-maps (ChatGPT sign-in), legal-ip-likeness | mod SDK (typed API, sandbox runtime, permissions), manifest, local dev loop for coding agents (`AGENTS.md`, skills, knowledge base, hot reload), ChatGPT sign-in flow + fallback, publish pipeline (moderation, provenance), map markers for experiences, forum data model, store UX (search/install/enable/disable, transactional install), versioning/compat |
| S13 | QA, Verification & Spec Integrator `s13-qa` | 5 | opus | C15 | all | prompt-engineering-claude-5-5, claude-5-5-prompting-guidance, repos-grand-v (compatibility-test patterns), all domain specs | traceability matrix, milestone plan consolidation + sizing, test pyramid + device matrix, perf-as-tests, CI jobs, the three critic lens prompts (executability/factual/scope) with finding format, DoD audit, cost model consolidation, risk register consolidation, open-questions consolidation, CLAUDE.md/AGENTS.md drafting, kickoff customization |

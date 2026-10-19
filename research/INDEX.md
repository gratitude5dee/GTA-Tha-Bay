# Research INDEX — Dee-Verse: GTA – Tha Bay (S00 digest, 2026-10-18)

Consolidates every report in `research/`; adds no new facts. Binding owner update: accurate San Francisco first, rest of the Bay later; Grand-V logic adopted. Contradictions are resolved per the completeness critic. Legal items are engineering guidance, not legal advice.

## 1. Decision summary

1. **Host on Workers + static assets (no Pages), Workers Paid from M00** — SPA mode, `run_worker_first: ["/api/*"]`, COOP/COEP/CORP in `_headers` and on Worker responses; R2 media on `media.<domain>` with CORS; `/account/*` non-isolated — [stack-cloudflare-backend, repos-webport]
2. **G1: Supabase `us-west-1` (Postgres + RLS + pgvector); Convex is the documented alternative** — West region (Convex has none), relational data; cost parity, so cost doesn't decide; Convex prices UNVERIFIED. Switch cost 5–7 sessions under the `DataPort` rule (no supabase-js in the client, all data via `/api/v1`); +4–6 if it leaks — [stack-cloudflare-backend §8]
3. **Identity spine = Worker OIDC issuer (ES256, `kid`, `role`, `sub=profile_id`)** — one JWT for DOs, Supabase Custom OIDC (Management API) and Convex `customJwt`; avoids unverified anon→Web3 linking and the 30/h/IP anon limit. *Disagreement:* backend report used Supabase anon as spine; resolved for auth §1.2, anon kept as fallback — [auth-ugc-input-maps, stack-cloudflare-backend]
4. **Auth: P0 local (M00–M11, HMAC play token) → P1 device-registered (M12) → P2 ChatGPT link (M13c) → P3 Thirdweb (M14a)** — fixes C12 order (R-AUTH-02). Thirdweb = SIWE-linked EOA, no `guest`, no 4337, only after Growth ($99/mo) — [auth-ugc-input-maps §1–2]
5. **ChatGPT fallback = Flow A: bring-your-own agent (Codex "Sign in with ChatGPT") + RFC 8628 device-code publish login** — website SIWC is a limited trial (flagged off); plan usage is loopback-only (ADR-gated); never vendor the Noncommercial DevKit — [auth-ugc-input-maps §3]
6. **Rooms = RoomDO per instance + DirectoryDO + PresenceDO, Hibernation API** — 50 ms `setInterval` tick only while connected, stop after 60 s AFK; never `setAlarm` per tick; CAP 16 (32 after load test); 5 s checkpoints; resume tokens (deploys restart DOs); ≈ $0.014 per 16-player room-hour vs ≈ $1.44/player-hour on Supabase Broadcast. Presence on PresenceDO: reword R-ROLL-02. Protocol v2 from the Grand-V relay, binary frames, 150/300 m interest — [stack-cloudflare-backend §4–5, repos-grand-v]
7. **Renderer: one `WebGPURenderer` (`three@0.186.1`), TSL-only materials (no GLSL)** — WebGL2 is the guaranteed path (auto-fallback, `?gl=1`, CI projects). Desktop/mobile WebGPU; Quest WebGL2 backend + multiview; Vision Pro WebGPU XR (no multiview in r186) with WebGL2 fallback. Supersedes repos-world rec 10 — [stack-rendering-platform §1, §4]
8. **XR constraint: main-thread rendering in v1 with `sim.worker` + `asset.worker`, no render worker** — `navigator.xr` is Window-only; `xr.enabled` before `init()`; `RendererHost` swaps renderer/canvas and re-warms at XR entry; one command encoder per frame; M01b device spike; revisit Quest native WebGPU XR at M11b. Supersedes repos-webport rec 1 — [stack-rendering-platform §5.4]
9. **Design for render-object count** — issue #30560; `BundleGroup` per chunk, `static = true`, instancing/batching, ≤ 6 objects per chunk; mobile ≤ 150 objects / ≤ 1.0 M tris — [stack-rendering-platform]
10. **Drop `postprocessing` and `n8ao`; use TSL `RenderPipeline` nodes; `DirectRenderPipeline` in XR; `PCFShadowMap`** — overrides repos-world rec 11 pins — [stack-rendering-platform §1.1]
11. **Vanilla three + TypeScript, no R3F** — R3F 9.8.2 caps React < 19.4, v10 is alpha, and it fights the worker topology and XR swap — [stack-rendering-platform §5.3]
12. **Physics: Rapier 0.21.0, one build per simulation** — free-roam `simd-compat`; replayed or server-verified sims use `deterministic-compat` live and in replay; fighter = detmath frame data, no Rapier; Jolt 1.1.0 as Racing swap; floating origin. Resolves gamedesign's "deterministic for everything" — [stack-rendering-platform §5.1, gamedesign-decomposition]
13. **ECS: bitECS 0.4.0 (koota alternative); fixed 60 Hz sim; `detmath` + seeded RNG; lint bans `Math.random`/`Math.sin`** — cross-browser state-hash test in M01a — [stack-rendering-platform, gamedesign-decomposition]
14. **Accurate-SF sources (open data only)** — DataSF footprints `ynuv-fyni`, streets `3psu-pn9h`, neighborhoods `j2bu-swwd`, EAS `ramy-di5m` (PDDL); OSM via Geofabrik (ODbL: attribution + share derived DB); Terrarium DEM z15 core; no Google 3D Tiles or Mapbox tiles; ENU origin City Hall — [repos-world §4, auth-ugc-input-maps §5]
15. **Buildings per tier: baked Int16 footprint extrusions, worker-meshed, merged per chunk, ≤ 1 upload/frame** — draw distance 8,200 m desktop / 2,500 m mobile / 1,500 m mobile-low and Quest / 3,000 m Vision Pro; far Bay = skyline cards — [repos-world P3–P4, stack-rendering-platform]
16. **PWA: Vite 8.3.4 + `vite-plugin-pwa` 2.0.0 (`injectManifest`, prompt updates), app shell only (6 MiB cap)** — world packs ≤ 4 MB via `asset.worker` + OPFS, not the SW; iOS: coach mark (no install prompt), `persist()` after story start, JS+wasm ≤ 600 MB, 60 Hz cap — [stack-rendering-platform §3, §6.5]
17. **Assets: glTF + meshopt; KTX2 UASTC/ETC1S → ASTC (Apple/Quest) or BC7; KTX-Software 4.4.2; identity-encoded `.glb/.ktx2` so Range works; ≤ 25 MiB per static file** — [stack-rendering-platform §1.6, stack-cloudflare-backend §1.2]
18. **fal endpoints from `config/genai-endpoints.json` with nightly liveness check** — video target `minimax/h3-max-turbo/image-to-video` (+`extend-video`) and `minimax/h3-max/reference-to-video`, licence-blocked until ADR-GENAI-01; production default `minimax/h3/{image,reference}-to-video` pending written answers; fallbacks `lightricks/ltx-2.5/image-to-video/fast`, then `google/gemini-omni-flash/v1.1/reference-to-video` (18+ only). Sheet `openai/gpt-image-2.5/sunburst/edit`; mesh `meshy/v7.1/multi-image-to-3d` (t-pose); rig `fal-ai/meshy/rigging/multi-animation`; TTS `fal-ai/minimax/speech-2.8-{turbo,hd}`. Banned: `recast`, face-swap, non-consented voice-clone, `seedance-2.5/image-to-video`. *Disagreement:* genai-pipeline-fal listed Gemini/Seedance US as fallbacks; resolved for gap-video §7 — [genai-pipeline-fal, gap-video-model-licence-clearance]
19. **Cutscene jobs: `CutsceneJobDO` single-flight + one GenJobWorkflow** — R2 HEAD → budget → submit + ED25519 webhook → `waitForEvent` → poll fallback → R2 → ffmpeg Container transcode → Whisper → manifest. Internal-only generation in v1; Queues only fan out prewarm; key includes endpoint, `updated_at`, seed, input hashes — [stack-cloudflare-backend §6, genai-pipeline-fal, gap-cutscene]
20. **Cutscene playback: muted `<video>` pool of 3 unlocked on first gesture, audio via `AudioContext`; ManagedMediaSource for fight intros; Quest media layer; Vision Pro `VideoFrameTexture`; no Cloudflare Stream; in-engine fallback** — [gap-cutscene-delivery-playback]
21. **NPC dialogue: Haiku 5.5 (thinking disabled, effort low); heroes Sonnet 5.5 (`between_tools`)** — Worker proxy via AI Gateway BYOK `byok_only`, no DLP/Guardrails; shared cached soul prefix; server-held history in `EncounterDO`; ink offline lines; filler peds use no LLM — [ai-npc-runtime §2, gap-observability]
22. **NPC memory: pgvector `halfvec(1024)` bge-m3, exact per-pair scan** — transcripts 30 d; memories expire 180 d after last access; relationship deleted with profile or after 180 d inactivity; none for under-18 profiles; export/forget day one — [ai-npc-runtime §4, legal-ip-likeness §8]
23. **Voice tiers text / Aura-MeloTTS / ElevenLabs Flash designed / consented-only; mouth-atlas lip-sync; port TalkingHead viseme logic, no dependency** — [ai-npc-runtime §5]
24. **Pose: MediaPipe tasks-vision 1.1.1 only (lite, PoseWorker, on-device); no YOLO (AGPL); ORT behind `PoseBackend`; amend R-MODE-03** — [auth-ugc-input-maps §4]
25. **Map stack: in-engine Canvas 2D minimap/full map from `sf-map.v1.bin`; MapLibre 6.15.0 + PMTiles (z0–14 ≈ 3.9 MB) only on web surfaces; no Mapbox runtime; Mapbox CLI dev-only, never stored** — coordinates from DataSF geocoder — [auth-ugc-input-maps §5.5]
26. **Modding: data (JSON Schema) / script (QuickJS-wasm Worker) / UI (opaque-origin iframe) tiers; disabled in multiplayer; `AGENTS.md` ≤ 24 KiB; skills mirrored with CI check; `thabay-mcp` + CLI** — [repos-modding, auth-ugc-input-maps §3.3]
27. **CI/CD: GitHub Actions; per-PR Workers Previews; `versions upload` → 0 % smoke → gradual; DO migrations via `wrangler deploy`; rclone to R2; Playwright `chromium-webgpu`/`-webgl2`/`webkit-webgl2`/`xr-quest3` (IWER); IP gates from M00** — [gap-ci-cd-release-assets]
28. **Cost controls in three layers** — `PlayerQuotaDO` + `BudgetGovernorDO` (70/85/100 %); AI Gateway limits (Anthropic only); vendor caps (Anthropic workspace, ElevenLabs `character_limit`, fal prepaid). List prices only; kill switches never block cache hits — [gap-observability, ai-npc-runtime §2.7]
29. **Likeness and brand** — living people `parody`; deceased (Mac Dre) and real-company founders `fictionalized`; `consented` needs a `consent_record`; kill-switch ≤ 60 s with stand-ins; no "GTA" in shipped name — [legal-ip-likeness]
30. **Audience vs content** — 17+, neutral age screen, under-13 blocked, AB 1043 signals from 2027-01-01; mild content (no firearms, gore, real-person crimes); player-triggered generation or premium voice needs 18+ attestation and P2+. *Disagreement:* trust-safety recommends 18+ ToS eligibility (Anthropic minors guidelines, fal §2); see Q-02 — [legal-ip-likeness, gamedesign-decomposition, gap-trust-safety-tooling]

## 2. Verified-facts ledger

All rows checked 2026-10-18 (date column). CF = developers.cloudflare.com; BCD = MDN browser-compat-data 8.1.6.

| F | Fact | Source | Date | Conf | Used by |
|---|---|---|---|---|---|
| F-001 | `three@0.186.1` latest (2026-09-24); r187 not out | registry.npmjs.org/three | 2026-10-18 | high | S01,S11 |
| F-002 | WebGPURenderer auto-falls back to WebGL2; r186 native WebGPU XR has no multiview | unpkg.com/three@0.186.1/src/renderers/common/XRManager.js | 2026-10-18 | high | S11 |
| F-003 | `setupWebGLXRFallback` swaps renderer when `XRGPUBinding` is absent | unpkg.com/three@0.186.1/examples/jsm/webxr/WebGLXRFallback.js | 2026-10-18 | high | S11 |
| F-004 | Safari 26 ships WebGPU on iOS/macOS/visionOS; Home Screen sites open as web apps | webkit.org/blog/17333 | 2026-10-18 | high | S10,S11 |
| F-005 | Safari 26.2 visionOS WebXR supports WebGPU; Quest Browser 146+ only experimental (flags) | webkit.org/blog/17640 ; developers.meta.com browser-release-notes | 2026-10-18 | high | S11 |
| F-006 | `navigator.xr` not on `WorkerNavigator`; `navigator.gpu` is | BCD | 2026-10-18 | high | S11 |
| F-007 | three issue #30560 (per-object UBO cost) open | github.com/mrdoob/three.js/issues/30560 | 2026-10-18 | high | S01,S11 |
| F-008 | `postprocessing@6.39.5` peer `three <0.187.0`; `n8ao@2.0.1` not WebGPU-compatible | registry.npmjs.org/postprocessing | 2026-10-18 | high | S11 |
| F-009 | iPhone 17 Pro WebContent killed at "ActiveHard 2048 MB" | developer.apple.com/forums/thread/823061 | 2026-10-18 | med | S11 |
| F-010 | Origin quota ≤ 60 % disk; standalone same quota; `persist()` heuristic | webkit.org/blog/14403 | 2026-10-18 | high | S11 |
| F-011 | iPhone lacks fullscreen, orientation lock, vibrate, Pointer Lock, `beforeinstallprompt`, COEP `credentialless` | BCD | 2026-10-18 | high | S10,S11 |
| F-012 | WebKit 303203: GPU-process leak; fewer encoders per frame mitigates | bugs.webkit.org/show_bug.cgi?id=303203 | 2026-10-18 | high | S11 |
| F-013 | Quest 3: 72 Hz min, < 200 draw calls, < 1.5 M tris | developers.meta.com device-optimization-comparison | 2026-10-18 | high | S11 |
| F-014 | Rapier 0.21.0 Apache-2.0; `-deterministic` cross-platform | registry.npmjs.org/@dimforge/rapier3d-simd-compat | 2026-10-18 | high | S01,S06 |
| F-015 | R3F 9.8.2 peer `react <19.4`; v10 alpha | registry.npmjs.org/@react-three/fiber | 2026-10-18 | high | S01 |
| F-016 | Pins: vite 8.3.4, vite-plugin-pwa 2.0.0, TS 6.0.3 (typescript-eslint needs < 6.1), wrangler 4.151.1, supabase-js 2.118.0 | registry.npmjs.org | 2026-10-18 | high | all |
| F-017 | gltf-transform 4.5.1 meshopt default; needs KTX-Software ≥ 4.4.0 (4.4.2 stable) | unpkg.com/@gltf-transform/cli@4.5.1 | 2026-10-18 | high | S05 |
| F-018 | Workers Paid $5; static asset requests free; no egress; 25 MiB/file | CF /workers/platform/pricing/ ; /limits/ | 2026-10-18 | high | S09 |
| F-019 | `_headers` not applied to Worker responses; CF ignores Range when decompressing | CF /workers/static-assets/headers/ ; /cache/reference/range-requests/ | 2026-10-18 | high | S05,S09 |
| F-020 | DO: 32,768 hibernatable sockets; attachment ≤ 16 KiB; ~500–1,000 req/s; deploys restart DOs | CF /durable-objects/ | 2026-10-18 | high | S09 |
| F-021 | DO: +$0.15/M req; $12.50/M GB-s at 128 MB; WS in 20:1, out free; `setAlarm` = row write | CF /durable-objects/platform/pricing/ | 2026-10-18 | high | S09,S13 |
| F-022 | DO hibernates after 10 s only without timers; location fixed at first `get()` | CF /durable-objects/concepts/durable-object-lifecycle/ | 2026-10-18 | high | S09 |
| F-023 | R2 $0.015/GB-mo, A $4.50/M, B $0.36/M, egress free; presign on S3 endpoint only | CF /r2/pricing/ | 2026-10-18 | high | S05,S09 |
| F-024 | Workflows 500 k steps included; step result ≤ 1 MiB | CF /workflows/reference/limits/ | 2026-10-18 | high | S05 |
| F-025 | Workers AI: no video/3D; bge-m3 $0.012/MTok; aura-1 $0.015/1 k chars | CF /workers-ai/platform/pricing/ | 2026-10-18 | high | S04 |
| F-026 | Realtime SFU/TURN 1,000 GB free then $0.05/GB | CF /realtime/sfu/platform/pricing/ | 2026-10-18 | high | S09 |
| F-027 | Logs/traces GB-billed from 2026-12-01: 50 GB then $0.25/GB | CF /observability/pricing/ | 2026-10-18 | high | S09,S13 |
| F-028 | AI Gateway spend limits eventually consistent; Unified Billing 200 req/60 s + 5 %; DLP/Guardrails buffer SSE | CF /ai-gateway/features/spend-limits/ | 2026-10-18 | high | S04,S13 |
| F-029 | Supabase Pro $25; MAU > 100 k $0.00325; Realtime $2.50/M; broadcast = 1 + receivers; 2,500 msg/s | supabase.com/pricing ; /docs/guides/realtime/limits | 2026-10-18 | high | S09 |
| F-030 | Supabase `us-west-1`; anon sign-in 30/h/IP, no cleanup | supabase.com/docs/guides/auth/auth-anonymous | 2026-10-18 | high | S09 |
| F-031 | Supabase Custom OIDC third-party provider (`kid`, `role`); not in CLI config | supabase.com/docs/guides/auth/third-party/custom-oidc | 2026-10-18 | high | S09 |
| F-032 | Supabase legacy anon/service_role keys end with 2026 | supabase.com/docs/guides/realtime/getting_started | 2026-10-18 | high | S09 |
| F-033 | Convex: no US West, region immutable; `customJwt` RS256/ES256 | docs.convex.dev/production/regions | 2026-10-18 | high | S09 |
| F-034 | Haiku 5.5 $0.10/$0.50 (cache $0.01); Sonnet 5.5 $2/$10 (cache $0.10); Opus 5.5 $4/$20 (cache $0.20) | platform.claude.com/docs/en/about-claude/pricing | 2026-10-18 | high | S04,S13 |
| F-035 | Min cacheable prefix 512 tokens; cache per workspace | platform.claude.com/docs/en/build-with-claude/prompt-caching | 2026-10-18 | high | S04 |
| F-036 | Haiku accepts thinking disabled at effort ≤ high; Sonnet needs `between_tools`; no sampling/prefill | claude-api skill (docs mirror) | 2026-10-18 | high | S04 |
| F-037 | Start tier 1,000 RPM; monthly caps Start $500 / Build $1,000 / Scale $200,000 | platform.claude.com/docs/en/api/rate-limits | 2026-10-18 | high | S04,S13 |
| F-038 | Anthropic AUP: AI disclosure; minors = under 18 | anthropic.com/legal/aup | 2026-10-18 | high | S04,S10 |
| F-039 | H3 Max Turbo T2V/I2V 0.92–15 s; 768P $0.04/s list (promo ends 2026-10-31) | fal.ai/models/minimax/h3-max-turbo/text-to-video | 2026-10-18 | high | S03 |
| F-040 | H3 Max ref2v ≤ 9 images, $0.08/s; `minimax/h3/*` partner $0.06/s | fal.ai/models/minimax/h3-max/reference-to-video/llms.txt | 2026-10-18 | high | S03,S07 |
| F-041 | H3 licence excludes USA/EU/UK/KR; covers derivatives + hosted; "MiniMax H3" credit | huggingface.co/MiniMaxAI/MiniMax-H3/raw/main/LICENSE | 2026-10-18 | high | S03,S05 |
| F-042 | fal ToS: End Users 18+ (§2); no direct API exposure (§4(b)) | fal.ai/legal/terms-of-service | 2026-10-18 | high | S05,S09 |
| F-043 | H3 output MP4 H.264 1344×768 @ 24 fps + AAC, fal C2PA; transcode strips it | ffprobe of fal samples (gap-cutscene §1) | 2026-10-18 | high | S03,S05 |
| F-044 | Sunburst edit ≤ 16 refs; 2560×1440 high $0.05529 | fal.ai/models/openai/gpt-image-2.5/sunburst/edit | 2026-10-18 | high | S05 |
| F-045 | Meshy 7.1 multi-image t-pose $1.20; rigging multi-animation $0.20 + $0.12/clip | fal.ai/models/meshy/v7.1/multi-image-to-3d/llms.txt | 2026-10-18 | high | S05,S07 |
| F-046 | MiniMax speech-2.8 turbo/hd $0.06/$0.10 per 1 k chars | fal.ai/models/fal-ai/minimax/speech-2.8-turbo/llms.txt | 2026-10-18 | high | S04 |
| F-047 | fal webhooks ED25519; retries end ≈ 6 min for ≥ 10 KB; concurrency 2 | fal.ai/docs/model-apis/model-endpoints/webhooks | 2026-10-18 | high | S05 |
| F-048 | fal: no spend cap; account locks below balance threshold | fal.ai/docs/documentation/model-apis/faq | 2026-10-18 | high | S13 |
| F-049 | Gemini API bars services likely accessed by under-18s | ai.google.dev/gemini-api/terms | 2026-10-18 | high | S03 |
| F-050 | LTX-2.x licence: no territory exclusion; ≥ $10 M revenue paid | raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2_x | 2026-10-18 | high | S03 |
| F-051 | ElevenLabs Flash ≈ 75 ms, $0.04/1 k; PVC own voice only; no under-18-directed apps | elevenlabs.io/use-policy ; /docs/models | 2026-10-18 | high | S04 |
| F-052 | ElevenLabs keys take monthly `character_limit` | elevenlabs.io/docs/api-reference/service-accounts/api-keys/create | 2026-10-18 | high | S13 |
| F-053 | OSM ODbL: attribution + share-alike for derived DBs | openstreetmap.org/copyright | 2026-10-18 | high | S02 |
| F-054 | DataSF `ynuv-fyni` and EAS `ramy-di5m` (224,290 addresses) are PDDL | data.sf.gov/api/views/ramy-di5m.json | 2026-10-18 | high | S02 |
| F-055 | Google 3D Tiles: no caching/offline/derivation; $6/1 k after 1,000 | developers.google.com/maps/documentation/tile/policies | 2026-10-18 | high | S02 |
| F-056 | Mapbox terms: no deriving or caching; Mapbox CLI (2026-10-08) MIT | mapbox.com/blog/new-mapbox-cli-for-coding-agents | 2026-10-18 | high | S02 |
| F-057 | MediaPipe tasks-vision 1.1.1: CPU/GPU(WebGL2), no threaded build; Apache-2.0 | registry.npmjs.org/@mediapipe/tasks-vision | 2026-10-18 | high | S07 |
| F-058 | Ultralytics YOLO AGPL-3.0/Enterprise; SaaS needs Enterprise | ultralytics.com/license | 2026-10-18 | high | S07 |
| F-059 | thirdweb 5.122.0; Growth $99/mo; wallets > 1,000 at $0.015 | thirdweb.com/pricing | 2026-10-18 | high | S09,S13 |
| F-060 | SIWC website = limited trial; plan usage for open-source local apps; DevKit Noncommercial; Codex AGENTS.md cap 32 KiB | developers.openai.com/siwc/website | 2026-10-18 | high | S12 |
| F-061 | Workers Previews per PR; Version URLs use production resources | CF /workers/previews/ | 2026-10-18 | high | S13 |
| F-062 | SwiftShader WebGPU headless works; Playwright WebKit Linux lacks `navigator.gpu`; IWER 2.6.0 runs three XR | container measurement (gap-ci-cd §4) | 2026-10-18 | high | S11,S13 |
| F-063 | iOS Low Power Mode needs a gesture for any video | WebKit main @5b2e266b (gap-cutscene §3) | 2026-10-18 | high | S03 |
| F-064 | iOS has no crash reports; `GPUDevice.lost` from iOS 26 | caniuse.com/mdn-api_gpudevice_lost | 2026-10-18 | high | S11 |
| F-065 | CF CSAM tool scans cached content only; R2 not documented | CF /cache/reference/csam-scanning/ | 2026-10-18 | high | S12 |
| F-066 | TAKE IT DOWN: 48 h removal; $53,088/violation | ftc.gov complying-take-it-down-act | 2026-10-18 | high | S12 |
| F-067 | Take-Two "GTA" mark Reg. 3439237 (game software) | trademarks.justia.com/771/44/gta-77144006.html | 2026-10-18 | high | S10 |
| F-068 | `preact` 11.0.1 is the npm `latest` dist-tag (published 2026-10-08), licence MIT | registry.npmjs.org/preact/latest | 2026-10-18 | high | S10, M00 |

**Unverified / must confirm (blocking impact)**
- US licence for H3 Max/Turbo and the governing terms for `minimax/h3/*` — blocks production cutscenes at M05b/M05c.
- Whether viewers of cached clips are fal "End Users" (counsel) — decides 17+ vs 18+ and Gemini use.
- iOS Home Screen vs Safari-tab WebGPU parity; GPU-process memory limit — blocks M01b/M11a budgets.
- PoseLandmarker latency on iPhone — M08c gate.
- Haiku TTFT ≤ 800 ms through AI Gateway — M06a AC.
- DO `send` backpressure; whether WS messages count against ~1,000 req/s — M12 room cap.
- Hyperdrive reach to Supabase — M12 (supabase-js HTTPS is default).
- Convex seat prices; Meshy bone names/face data; thirdweb free tier — non-blocking or M10a/M14a cost.

## 3. Reusable pattern index

| Pattern | Source | Application |
|---|---|---|
| ENU frame, flat-earth metres | San-Francisco `src/world/coords.ts` | `world/coords.ts` |
| Keyless bake + gates | San-Francisco `tools/*.ts`, `GATES.md` | `tools/map`, no-keys/luminance CI |
| Int16 per-cell buildings | San-Francisco `tools/buildings.ts` | C08 building layer |
| Priority-streamed worker meshing | San-Francisco `BuildingsLayer.ts` | ≤ 1 upload/frame |
| Shared heightfield sampler | San-Francisco `BakedTerrainSampler` | physics = visuals |
| Path graph + random walk + A* | gta-sa-earth `Wr/Ma` | traffic, police |
| Simulate-once timeline + autoplayer | gta-sa-earth `_h.run`, `autoplayer` | mission CI, previews |
| Auto-director | gta-sa-earth `Ah` | cutscene fallback, replays |
| Keyframed weather (`skycycle`) | gta-sa-earth `Xb/Yb` | mobile/XR sky |
| Coastline ring + far LOD | Atlas `build/geo.js` | Bay backdrop pack |
| Cached 2D map frame | Atlas `app/render.js` | minimap |
| Worker split + OPFS store | playgta5 `io_worker.js` | `asset.worker` cache |
| Pipeline seed + compile-ahead | playgta5 `pipelines.json` | boot reveal gate |
| Snapshot + clock estimator | muguet `src/` | netcode (re-implemented) |
| Relay vocabulary, token bucket | Grand-V `src/relay.rs` | RoomDO protocol v2 |
| Save profiles, Story/Sandbox | Grand-V `storage.rs` | C05 |
| Transactional install | Grand-V `kurulum.rs` | M13a mod install |
| AGENTS.md + mirrored skills | universal-modder | repo + mod kit |
| Oracle discipline | universal-modder `knowledge/techniques/` | every AC names its oracle |
| Generation manifest | universal-modder `um/fal.py` | C07 provenance |
| Fixed step + catch-up cap | SK8V `worker.rs` | C02 loop |
| Ownership state machine | SK8V `lifecycle.h` | foot/vehicle/cutscene control |
| Scripted input lines | SK8V `line.rs` | regression hashes |

## 4. Constraints block (paste-ready; engineering guidance, not legal advice)

1. No "GTA" in anything shipped; display name only from `config/brand.ts` (default "Dee-Verse: Tha Bay"); rename the repo before public.
2. No Rockstar/Take-Two material of any kind (code, data, formats, symbols, maps, missions, characters, brands, trade dress), including anything reachable through the example repos.
3. Clean room: builders never open the example repos; only pattern cards cross over; PRs attest. Amended 2026-10-19 by ADR-REUSE-01/D-31: files under `third_party/` listed `REUSE-WITH-ATTRIBUTION` in the register (`docs/legal/third-party-reuse.json`) may cross; everything else unchanged.
4. Provenance or it doesn't ship: SHA-256, origin, SPDX licence, generator {vendor, endpoint, request_id, prompt hash, terms snapshot}, likeness; CI `provenance:check`, `ip:*`, `license:scan`, `names:lint`, `likeness:gate`.
5. No GPL/AGPL/LGPL in the client without an ADR.
6. Real people only via `NameRegistry`; never hard-code names, aliases, catchphrases or marks.
7. Tiers `consented | parody | fictionalized` gate every stage; living → `parody`; deceased and real-company founders → `fictionalized`; minors never.
8. `parody` = renamed (edit distance ≥ 0.4), text-only caricature (no photo refs), no real tattoos/jerseys/logos/catchphrases, outside fame domain, never criminal/sexual/drug/gore, disclaimer, never in marketing.
9. Real faces or voices only with a scoped `consent_record`; clones only via the talent's own PVC or a licensed voice.
10. Kill-switch: live removal ≤ 60 s, purge ≤ 24 h, mandatory stand-ins, quarterly drill.
11. All generation Worker → vendor; never from the browser; flow vendor AUPs into our ToS.
12. Never self-host H3 weights; label cutscenes AI-generated.
13. Prompt hygiene: no real names, franchises, artists, songs or "in the style of".
14. Original music only.
15. Fictional teams, venues, vehicle makes and operators; no murals or public art.
16. OSM attribution + share derived DB; DataSF credit; no Google 3D Tiles; Mapbox never baked or cached.
17. UGC: IP scan, moderation, CSAM check, likeness attestation before visibility; report button everywhere.
18. DMCA agent and ≤ 24 h takedown; NCII removal within 48 h; CSAM reported to NCMEC and preserved 1 year.
19. NPCs stay game-topic bots with a safety card and an "AI character" badge.
20. Web3 is identity only: no tokens, NFTs, loot boxes or cash-out.
21. Age: 17+, neutral screen, under-13 blocked; honour age signals from 2027-01-01.
22. Pose camera on-device only; nothing leaves or persists; no face landmarker.
23. v1 US-only (geo-gate).
24. Every external claim cites `research/` or is UNVERIFIED; counsel signs off before launch.

## 5. Milestone skeleton (SF first; Bay last)

| ID | Title | Acceptance criterion |
|---|---|---|
| M00 | Bootstrap, CI, PWA on Workers | Preview shows COOP/COEP + `crossOriginIsolated`; IP gates fail a bad fixture; genAI spike ≤ $40 logged |
| M01a | Loop, ECS, detmath, physics wrapper | 10,000-tick hash identical in Chromium + WebKit |
| M01b | Controller, cameras, touch, device spike | iPhone PWA ≥ 30 fps; Quest enters `immersive-vr` |
| M02a | SF bake | building count ±5 % of reference; attribution file |
| M02b | Streaming, LOD, weather | ≤ 1 upload/frame, no frame > 50 ms on route |
| M02c | Graphs, in-engine maps, teleports | graph ≥ 98 % connected; minimap within 5 m at 10 landmarks |
| M03a–c | Vehicles, traffic, PursuitDirector | identical replay; bot reaches heat 3 and escapes |
| M04a–b | Saves, GameMode/unlocks, menus, creator | killed tab keeps last save; a11y zero critical |
| M05a | Mission IR + autoplayer + director | autoplay passes 3 seeds within `expectedSec` |
| M05b | Cutscene pipeline (DO + Workflow, mock provider) | repeat request makes zero fal calls; miss plays fallback |
| M05c | Act 1 = VS-Story | Act 1 completes under autoplay |
| M06a–b | NPC runtime; builder + moderation | no keys in bundle; cache read on turn 2; drafts private |
| M07a–b | Racing, pursuits, replays | ghost reproduces finish time exactly |
| M08a–c | Fighter, roster 8, pose | identical frame hashes; pose fixtures ≥ 90 %; no image bytes sent |
| M09a–b | Tycoon | cap-table vectors pass; LLM offer clamped |
| M10a–b | Roster pipeline, kill drill | 2 validated characters; live kill; idempotent prewarm |
| M11a | iPhone hardening | budgets as tests; 30-min soak |
| M11b | WebXR port | IWER e2e; Quest/Vision Pro checklists |
| M12a–b | Multiplayer (P1) | peers within 150 ms; forged-id tests pass |
| M13a–c | Mod SDK, experiences, forum/DMCA, ChatGPT link | sandbox blocks APIs; unmoderated item invisible; device-code publish |
| M14a | Thirdweb (P3) | SIWE link without data loss |
| M14b | Launch hardening | synthetic spend fires alarms; counsel sign-off |
| M15+ | Bay districts via portals | district streams through its portal |

40–47 sessions through M14b [gamedesign-decomposition §9]; add a cutscene-playback spike before M05b [gap-cutscene].

## 6. Cost model inputs (list prices)

| Unit | Cost | Source |
|---|---|---|
| Character (Standard) | $3.73 (Lean $1.05); 60 NPCs $224 | genai-pipeline-fal |
| Cutscene 15 s | Turbo $1.06; H3 partner $1.35; H3 Max ref $1.80; LTX $2.18 | genai-pipeline-fal |
| v1 video set (3,915 s) | $157 Turbo / $235 partner / $382 LTX | gap-video |
| NPC turn | Haiku $0.00028; Sonnet $0.0050 | ai-npc-runtime |
| TTS line (110 chars) | MeloTTS $0.00002; Aura-1 $0.00165; ElevenLabs $0.0044 | ai-npc-runtime |
| Cloudflare | $5 base; room-hour $0.014; R2 $0.015/GB-mo | stack-cloudflare-backend |
| Supabase / Convex | Pro $25 + compute / $25 per dev (UNVERIFIED) | stack-cloudflare-backend |
| Thirdweb | $99 + $0.015/MAW > 1,000 | auth-ugc-input-maps |

| Monthly | 1k MAU | 10k MAU | 100k MAU |
|---|---|---|---|
| CF + Supabase | $31 | $60 | $400 |
| NPC runtime default (lean) | $220 ($40) | $2,200 ($400) | $22,000 ($4,000) |
| Thirdweb | $99 | $129 | $534 |
| Trust & safety | ≈ $80 | ≈ $800 | ≈ $8,030 |
| Sum (computed here) | ≈ $430 | ≈ $3,190 | ≈ $31,000 |

## 7. Gated-decision recommendations

**G1 — Supabase.** Use Supabase Pro in `us-west-1`, with DOs for all realtime. The reasons are the West region, SQL, pgvector and Hyperdrive. Convex lacks US West, and its reactivity adds nothing beside DOs. Switch cost is 5–7 sessions under the `DataPort` rule (+4–6 if it leaks). The OIDC issuer shrinks the auth part of a switch.

**G2 — Likeness.** Living people default to `parody`. Mac Dre and real-company founders are `fictionalized`. Start consent outreach with Ray Fernando and Adil Mania, then P-Lo, Jay Anthony and 1 Umbrella, then the Mac Dre estate. Non-consented tiers get no photo references, no clones and no marketing use, and every real-derived character ships with a stand-in.

**G3 — Ceiling and quotas (derived; owner confirms).**
- **Recurring ceiling:** $500/month (≈ $16.50/day). Anthropic $350 (under the Start-tier $500 cap), voice $100, moderation $25, buffer $25. Public fal spend is $0 because generation is internal-only.
- **One-off production:** $1,000 of fal credit.
- **Scaling:** add ≈ $0.25 per MAU. Move to the Build tier before ≈ 2k MAU and to Scale before ≈ 8k MAU.
- **Per player:** anonymous 150 turns, 60 voiced lines and $0.05 per day. Linked (18+): 400 turns, 200 lines and $0.15 per day, plus 1 Lean NPC build a day. 40 turns per NPC per day. No user cutscene generation.
- **Governor:** at 70 % heroes drop to Haiku; at 85 % voice drops to t1; at 100 % the game goes offline.

## 8. Open questions for the product owner

1. Q-01 Title → "Dee-Verse: Tha Bay".
2. Q-02 ToS eligibility 17+ or 18+? → 18+ ToS with 17+ content (`TEEN_MODE=false`).
3. Q-03 H3 not cleared by the M05c content lock? → amend R-CUT-01 and use LTX-2.5 fast.
4. Q-04 Roster consent → G2.
5. Q-05 GenAI ceiling → G3.
6. Q-06 Content tone → no firearms or gore; sideshows allowed.
7. Q-07 Campaign → Premise A *Hella Valuation*.
8. Q-08 Commercial model and repo licence → open-source repo, ODbL world data.
9. Q-09 Thirdweb logins → email, passkey, Google, Apple; no guest.
10. Q-10 Device floor → iPhone 15 `mobile-low` at 30 fps; Quest 3/3S; Vision Pro on visionOS 26.2+.
11. Q-11 Music → commissioned originals.
12. Q-12 Hero voices → Aura t1; ElevenLabs for ≤ 3 heroes, only if 18+.

## 9. Report index

| File | Description | Words |
|---|---|---|
| ai-npc-runtime.md | soul.md, dialogue, memory, voice, builder, cost | 12,975 |
| auth-ugc-input-maps.md | Identity, Thirdweb, ChatGPT flows, pose, maps | 11,783 |
| claude-5-5-model-facts.md | Claude 5.5 ids/prices (Sonnet cache corrected to $0.10) | 400 |
| claude-5-5-prompting-guidance.md | 5.5 prompt-tuning excerpts | 6,048 |
| claude-code-deployment.md | Subagents, skills, hooks, headless | 1,921 |
| gamedesign-decomposition.md | Modes, controls, milestones, SF premises | 18,732 |
| gap-ci-cd-release-assets.md | CI/CD, Previews, R2 publishing, GPU/XR CI | 10,699 |
| gap-cutscene-delivery-playback.md | H3 output, transcoding, playback | 10,562 |
| gap-observability-cost-guardrails.md | Observability, crash detection, spend caps | 9,513 |
| gap-trust-safety-tooling.md | CSAM/NCII, classifiers, moderation, minors | 13,281 |
| gap-video-model-licence-clearance.md | Video licence matrix, ADR-GENAI-01 | 9,793 |
| genai-pipeline-fal.md | fal endpoints, pipelines, cost | 8,897 |
| legal-ip-likeness.md | IP, likeness, UGC, privacy, constraints | 13,784 |
| owner-updates.md | Binding owner updates | 199 |
| repos-grand-v.md | Grand-V launcher patterns | 6,661 |
| repos-modding.md | universal-modder, SK8V | 9,714 |
| repos-webport.md | playgta5/muguet architecture, IP line | 9,195 |
| repos-world.md | SF bake, Atlas, gta-sa-earth, map licences | 8,048 |
| stack-cloudflare-backend.md | CF primitives, DO rooms, Supabase vs Convex | 13,634 |
| stack-rendering-platform.md | three r186, iPhone PWA, WebXR, budgets | 10,529 |
| INDEX.md | This digest | — |

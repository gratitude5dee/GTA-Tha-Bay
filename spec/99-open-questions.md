# 99 — Open questions and UNVERIFIED register (living)

> Created 2026-10-18 by the Architect at Wave 1 reconciliation; Q-20…Q-25 and §3 added at the Waves 2–4 reconciliation (same day, `spec/11-decision-log.md` §D). Q-01–Q-12 (owner defaults from Phase 0) live in `spec/00-plan.md`; new owner questions start at Q-13. Every default below is applied now so the run continues unattended; the owner overrides with `/architect fix: <what>`. No UNVERIFIED item may appear in an acceptance criterion; where a device run must record one, the criterion is the recording. Wave 5 merges the Wave 2–4 lists into this file.

## 1. Owner questions (genuinely the owner's call)

| Q | Question | Default applied (2026-10-18) | Blocks | Source |
|---|---|---|---|---|
| Q-13 | Which physical test devices exist? | iPhone 15 + iPhone 16/17 + Quest 3 + Vision Pro (visionOS 26.2+) + an Apple Silicon Mac; Windows integrated and discrete GPUs are optional; without them `desktop-ultra` and weak-desktop calibration stay marked unverified | device acceptance of M01c, M04c, M11a, M11b (CI parts proceed) | Q-S11-01, `11-platform-perf.md` §6 |
| Q-14 | One-off fal production cap ($1,000, G3) if a fallback video provider becomes the default | Keep $1,000. With `h3.partner` the programme is ≈ $898 including 25 % experiments; if `ltx25.fast` or `gemini.omniFlash11` becomes the default, produce 8 fighters (≈ $975) instead of 12; raising the cap to $1,250 needs the owner | M05c prewarm, fighter cutscenes (M08), M10a batch | DN-S05-2, Q-S05-03, `05-assets-pipeline.md` §11 |
| Q-15 | Production and staging domains, Cloudflare zone plan, GitHub visibility and plan | One dedicated zone for `<domain>` with `id.`, `rt.`, `media.`, `ugc.` and `-staging` twins; prod deploys only from tags by an allowlisted actor until a Team org or a public repo exists | M00 `deploy:bootstrap` custom domains (previews work on `workers.dev`), M12a issuer host | Q-BE-08, `09-backend-ops.md` §1.3 |
| Q-16 | Owner filings: NCMEC ESP registration, PhotoDNA application, Tech Coalition Pathways, DMCA agent designation, Cloudflare CSAM-tool support ticket | File before M06b; until approved, photographic uploads stay private-only and CSAM reports go through the CyberTipline web form | public visibility of photo UGC (M06b), completion of M13d | Q-BE-07, `09-backend.md` §3.4 |
| Q-17 | Who holds the production staff `FAL_KEY`? | The art lead holds the staff key locally (CLI-first); CI and the Worker get separately scoped keys with allowed-model lists | M00c spike, M10a batch | DN-S05-4, Q-S05-02 |
| Q-18 | Counsel reading of fal ToS §4(a) "internal business use" for roster generation | Proceed with internal-only generation (D-19); counsel sign-off is a launch gate | M14b public launch (not development) | Q-S05-05, F-042 |
| Q-19 | The per-character research layer (`research/characters/<slug>/soul.md` + `refs/`) is not in the repository | S04 defines the soul schema, validator and roster manifest; the roster loads when supplied; development uses original test characters (`npc_test` and one `fictionalized` canary) | hero NPC content in M06a; real-roster runs of M10a (the canary runs without it) | `spec/00-plan.md` "Inputs found at start" |
| Q-20 | Raise the $100/month voice ceiling (G3) to cover an ElevenLabs plan fee so ≤ 3 heroes can use t2 voices? | No: heroes launch on t1 (Workers AI Aura); `ks:tts:elevenlabs` stays on (t2 off); t2 needs linked 18+ accounts when enabled | hero voice quality in M06a4 and M10c (not functionality) | DN-S04-02, `04-npc.md` §5.7 |
| Q-21 | Who runs the community sensitivity read of the D3 (Bayview–Hunters Point) and D4 (Tenderloin, Civic Center) missions? | The owner arranges it; CI and dev proceed, and the M05c2 **release** stays gated until `content/story/sensitivity.json` records a read for each tagged mission version | public release of Act 1 (M05c2 release step, M05e/M05f releases) | DN-S03-05, `03-story-narrative.md` §B3 |
| Q-22 | Publish `@dv/mod-sdk` and `@dv/cli` to npm under MIT, under which scope? (ties to Q-15 repo visibility) | Plan MIT and npm publication at M13c3 if the `@dv` scope is available (U5); until the owner confirms, ship both as tarballs on the release page | the publish step of M13a6/M13c3 only | DN-S12-04, `12-modding.md` §10 |
| Q-23 | Counsel review list before public launch: (a) trademark knock-out of placeholder vehicle makes, rival handles and fictional transit operators; (b) whether device-local normalised body proportions (pose calibration) are biometric data; (c) the tycoon "simulation, not financial advice" disclaimer; (d) default-on telemetry with a first-run notice for US players | (a) ship placeholders through `names:lint`, rename is a data commit; (b) calibration stays device-local, opt-in "remember", deletable; (c) disclaimer in the pitch room; (d) default on (DL-140) | M14b public launch (development proceeds) | DN-S06-02, Q-S07-2, DL-106, DL-127, DL-140, S08 risks |
| Q-24 | Is fighter animation authored by a human art lead (≈ 45 shared base clips + 12–16 signature clips per fighter, ≈ 160 Blender tasks)? | Yes in principle: M08a ships generic library clips; signatures follow through M10a; without art-lead time v1 ships library moves only | animation quality in M08b1/M10a | S07-D1, `07-fighter-content.md` FX7 |
| Q-25 | Create the private content repository mounted at `content-private/` (real-derived souls, research layer, production rails) and grant CI read access | Until it exists only original souls and the rules example build; real-roster content waits as for Q-19 | real-roster content in M10c; production rails before M14b | DN-S04-01, DL-118 |

## 2. UNVERIFIED register — Wave 1

Each row names the default the spec uses until the item is verified and the milestone that verifies it. Source ids are the domain specs' own.

### 2.1 Engine (S01, `01-engine.md` §7)
| ID | Item | Default while unverified | Verified in |
|---|---|---|---|
| U-ENG-1 | `Math.sqrt` bit-identical across JS engines | `detmath.sqrt` never delegates | M01a vectors |
| U-ENG-2 | Tick cost of `deterministic-compat` vs `simd-compat` | `simd-compat` for local play (D-12) | M01a, M03a |
| U-ENG-3 | Rapier wasm inside a Durable Object | kinematic validation only on the server | M12b spike |
| U-ENG-4 | WebSocket in a dedicated worker on iOS Safari | main-thread `MessagePort` relay fallback | M12a |
| U-ENG-5 | Quest A/B/X/Y indices in `xr-standard` | no required action only on a face button; `config/xr-input-profiles.json` entries start `null` | M01c, M11b device pass |
| U-ENG-6 | Rapier debug-render API | draw own shapes from `BodyDesc` | M03a |
| U-ENG-7 | Meshy rig bone names (also U-AST-1) | alias table written from the probe | M00c |
| U-ENG-8 | iOS PWA background-suspension timing | pause and autosave on every `hidden` | M01c, M11a |
| U-ENG-9 | IndexedDB commit durability under WebContent jetsam | two-phase write is safe either way | M04a `save-kill` e2e, M11a soak |

### 2.2 Platform (S11, `11-platform.md` §10)
| ID | Item | Default while unverified | Verified in |
|---|---|---|---|
| U-PLT-1 | iOS Home Screen vs Safari-tab WebGPU parity | mobile tiers on WebGL2 backend (`webgpu.mobile=false`) | M01c, M11a |
| U-PLT-2 | GPU-process jetsam limit; whether 2,048 MB WebContent kill applies to every iPhone | `mobile` accounted cap 600 MB, WebContent ceiling 1,200/900 MB | M01c memory bomb, M11a |
| U-PLT-3 | ProMotion rAF above 60 Hz | plan 60 Hz | M11a |
| U-PLT-4 | Post-jetsam behaviour (reload vs blank, nav type, `localStorage` durability) | heartbeat inference only | M01c, M11a |
| U-PLT-5 | `GPUDevice.lost` before a GPU-process kill | heartbeat + abnormal-exit demotion | M11a |
| U-PLT-6 | `adapter.info` content on Safari | benchmark decides the tier | M01c |
| U-PLT-7 | Safari `timestamp-query` | GPU timers optional, never asserted | M01c |
| U-PLT-8 | takram atmosphere with three r186 | removable adapter, `desktop-ultra` only | M11a |
| U-PLT-9 | visionOS user-agent string | capability-based detection; capture fixtures | M01c |
| U-PLT-10 | Vision Pro framebuffer size, refresh control, foveation, WebGPU-vs-WebGL XR cost | fixed scale 1.0, 90 Hz assumed, no rate control | M11b |
| U-PLT-11 | `immersive-ar` on visionOS; PS VR2 controllers as WebXR inputs | out of v1 | post-M11b ADR |
| U-PLT-12 | Quest Browser flag names; non-XR WebGPU default | Quest forced to WebGL2 backend | M11b |
| U-PLT-13 | XR session `visibilitychange` semantics | pause on `hidden` and `visible-blurred` | M11b |
| U-PLT-14 | `renderer.info.render.drawCalls` with `BundleGroup` on WebGPU | `RenderBudgetMeter` counts render objects; `info` authoritative on WebGL2 only | M01c |
| U-PLT-15 | `navigator.standalone` for Home Screen detection | `matchMedia('(display-mode: standalone)')` first | M01c |
| U-PLT-16 | OPFS 7-day eviction; cross-tab sync-handle behaviour | nothing assumes persistence; second tab read-only | M01e, M11a |
| U-PLT-17 | Low Power Mode effects on video and frame rate | video needs a gesture; pool unlocked at first gesture | M04c |
| U-PLT-18 | iPhone RAM sizes | benchmark-driven tiering | M01c |
| U-PLT-19 | SwiftShader WebGPU recipe on a GitHub runner | `gpu-probe.json` artifact decides | M00 |
| U-PLT-20 | † budget numbers, comfort constants, gesture thresholds | S11 starting values | M11a, M11b |

### 2.3 Asset pipeline (S05, `05-assets.md` §7)
| ID | Item | Default while unverified | Verified in |
|---|---|---|---|
| U-AST-1 | Meshy bone names, finger/jaw/face data, animation-clip licence | alias table from probe; human gate H4 | M00c |
| U-AST-2 | Meshy honours `image_urls` order | fixed crop order front, left, back, right | M00c |
| U-AST-3 | fal CDN `Content-Length`; retrieval with `X-Fal-Store-IO: 0` | copy to R2 immediately; lifecycle header 86,400 s | M00c |
| U-AST-4 | C2PA on fal outputs for each chosen endpoint | record state; re-sign renditions | M00c, M05b |
| U-AST-5 | Workers streaming SHA-256 (`DigestStream`); Workflow `waitForEvent` max timeout | hash in the container / CLI; 20 min wait + poll | M05b |
| U-AST-6 | wrangler `containers` / `workflows` config keys (also U-BE-3) | checked against the schema | M00 |
| U-AST-7 | GPT-image cost of extra input images | $0.01 assumed | M00c |
| U-AST-8 | Sunburst / Nano Banana refusal behaviour on real-person edits | never send real-person photos | M00c |
| U-AST-9 | Rhubarb licence | believed MIT; licence snapshot before use | M00b |
| U-AST-10 | CC0 catalogue terms (Poly Haven, ambientCG, Kenney, Quaternius, Freesound) | admit a pack only after a licence snapshot | M00b, M03b |
| U-AST-11 | ElevenLabs SFX endpoint terms and price | registry `pending` | M14b terms-watch |
| U-AST-12 | R2 tag-based cache purge (also U-BE-10) | prefix purge | M10b drill |
| U-AST-13 | basis_universal XUASTC with three's transcoder | do not use XUASTC | M01d |
| U-AST-14 | iOS decode of Ogg Opus via `decodeAudioData` | AAC fallback | M00c |
| U-AST-15 | pinned C2PA signing tool and version | chosen and pinned in M05b; `check:c2pa` blocks release | M05b |
| U-AST-16 | H3 family US licence (ADR-GENAI-01) | fallback chain; production refuses `pending` providers (Q-03) | owner / vendor |
| U-AST-17 | art-lead time per character (20–40 min) | estimate only | M00c, M10a |

### 2.4 Backend (S09, `09-backend.md` §7)
| ID | Item | Default while unverified | Verified in |
|---|---|---|---|
| U-BE-1 | Cross-origin WebSocket from a COEP `require-corp` page to `rt.<domain>` | keep `rt.`; zone-route fallback (Q-BE-02) | M12b AC-1 |
| U-BE-2 | Turnstile verification API and widget under COEP | per-net registration caps | M12a start |
| U-BE-3 | `wrangler@4.151.1` keys for workflows, AE, analytics, ratelimits, observability, previews | marked † in config; schema check | M00 |
| U-BE-4 | DO WebSocket `send` backpressure; WS messages vs ~1,000 req/s | CAP 16; slow-receiver degrade | M12c load test |
| U-BE-5 | DO memory limit (128 MB assumed) | checkpoint < 1 MB | M12c |
| U-BE-6 | Workflow create with an existing id | single-flight in `CutsceneJobDO` | M05b |
| U-BE-7 | Hyperdrive reach to Supabase | not used | — |
| U-BE-9 | Cloudflare CSAM tool coverage of R2 custom domains | cache rule on `ugc.`; support ticket (Q-16) | M13d |
| U-BE-10 | Cache-Tag purge for R2 objects | prefix purge | M10b |
| U-BE-11 | NCMEC CyberTipline API credential process | web form | M13d (Q-16) |
| U-BE-12 | PhotoDNA approval timing | own hash banks + PDQ | M13d (Q-16) |
| U-BE-13 | `limits.cpu_ms` for Workflow steps and queue consumers | heavy work in the container / CLI | M05b |
| U-BE-14 | Invocation log per hibernated WS message | rooms sampling 0.001, invocation logs off | M12c |
| U-BE-15 | Custom Alerts billing and rule limits | Budget email alerts as backstop | M14b |
| U-BE-16 | Full-page redirect sign-in inside an iOS Home Screen app | device-code flow first | M12a, M14a device check |
| U-BE-17 | AI Gateway pricing catalog covers `claude-haiku-5-5` / `claude-sonnet-5-5` | our ledger from `usage` is authoritative | M06a |
| U-BE-18 | Anthropic minimum workspace spend limit | `synthetic` workspace at the minimum accepted | M14b |
| U-BE-19 | fal auto-recharge; locked-account HTTP status | recharge off, small prepaid balance, governor reserve | M05b, M14b |
| U-BE-20 | `wrangler deployments status --json` field names | deploy script parses defensively | M00 |
| U-BE-21 | DO restarts scoped to the deploying script | split Workers anyway (costs nothing if false) | M12c |

## 3. UNVERIFIED register — Waves 2–4 (index; Wave 5 merges the rows into §2 format)

Each domain lists its items with the default it uses and the verifying milestone in its own spec; no item appears in an acceptance criterion. Counts from `spec/.waves234-returns.json`.

| Domain | Items | Listed in | Highest-impact items (default) |
|---|---|---|---|
| S02 world | 14 | `02-world.md` §10 | Geofabrik/Overpass routes (pinned raw snapshot); SPDX `ODbL-1.0`/`PDDL-1.0` strings; per-pack GET speed without a batch route (M02b1 measures); bake and meshing budgets † |
| S03 story | 8 (U-S03-1…8) | `03-story.md` §7 | keyframe identity across clips (M00c, M08b2); Safari MSE gaps and Low Power Mode video (M04c); C08 route snap inside the load budget (M05a1) |
| S04 NPC | 12 (U-NPC-01…12) | `04-npc.md` §7 | Haiku TTFT and unbuffered SSE through AI Gateway (M06a3); structured-output streaming; ElevenLabs plan terms (Q-20) |
| S06 racing | 8 (U-RAC-1…8) | `06-racing.md` §7 | Rapier per-wheel contact and impulses (M03a2 spike); deterministic tick cost; SSR/motion-blur cost (M11a) |
| S07 fighter | 11 | `07-fighter.md` §7, `07-fighter-pose.md` FP11 | PoseLandmarker latency on iPhone (M08c2 device gate); classic-worker packaging under Vite 8; biometric reading (Q-23) |
| S08 tycoon | 5 (U-TYC-1…5) | `08-tycoon.md` §7 | Carta dilution figure (design target only); Haiku TTFT (M06a3); U-TYC-5 resolved by DL-139 |
| S10 UI | 15 | `10-ui.md` §10 | Turnstile under COEP (M12a); OS age signals (2027); system keyboard in XR (flat-only, DL-142); Preact cost (M04b1) |
| S12 modding | 12 (U1…U12) | `12-modding.md` §10 | QuickJS cost on iPhone/Quest (M13a4); srcdoc iframe under COEP (M13a5); `@dv` npm scope (Q-22); Supabase GitHub OAuth beside TPA (M13c1, DL-145) |


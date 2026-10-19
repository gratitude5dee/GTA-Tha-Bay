# 99 — Open questions and UNVERIFIED register (living)

> Consolidated 2026-10-18 by the Architect (Wave 5, DL-248) from the former §1–§6 of this file, domain specs §7/§10, `spec/.wave1-returns.json`, `spec/.waves234-returns.json` and the milestone files ("Risks & fallbacks", "Notes for the Builder"). Q-01…Q-12 (Q-01 title, Q-02 18+ terms, Q-03 provider fallback, Q-06 tone, Q-07 premise, Q-10 device floor, Q-11 music, Q-12 hero voices) are Phase 0 defaults in `spec/00-plan.md` and `research/INDEX.md` §7; only Q-08's open part is carried here. Ids are stable; merged ids live in §3 as aliases. Milestone ids are the final register (`_PLAN.md` §1). Every default is applied now; the owner overrides with `/architect fix: <what>`. Rule (C15 lint L4): no AC line contains the token UNVERIFIED, and a U-id appears in an AC only after "records" or "decides".

## 0. Acceptance-criterion check (2026-10-18)

Scope: every `## Acceptance criteria` block of the 115 `spec/07-milestones/M*.md` files, case-insensitive, for `UNVERIFIED`, `U-…` ids and bare `U<n>` ids. 27 AC lines in 20 files name a U-id (62 mentions); 25 already pass L4 (each id follows "records"); no AC line holds the token.

| # | File · AC | Finding | Action |
|---|---|---|---|
| V-1 | M13a5 AC-6 | bare `U2` (ambiguous between S05 and S12) after "recording", not "records" | **fixed** (mechanical): "the run records the U-API-1 values …" |
| V-2 | M13a5 AC-9 | bare `U2` after "record" | **fixed**: "… and the run records the U-API-1 values" |
| F-1 | M00 AC-14 (frozen) | no U-id or token, but its pass depends on U-QA-8 (`_headers` on Preview URLs; expected, undocumented [research/gap-ci-cd-release-assets.md "Unverified"]) | not edited: frozen and not blocking. If AC-14 fails for this reason the Builder reports "Blocked on: U-QA-8" and the Architect moves the check to a recording in the next open milestone |
| — | M00d AC-3 | lower-case "unverified marker" describes the lint fixture, not a fact | passes (L4 matches the upper-case token) |

## 1. Operator questions

| Q | Question | Who can answer | Default assumed | Blocked milestones (final ids) | Date |
|---|---|---|---|---|---|
| Q-08 | Which licence does the open-source repository use (Q-08 chose open source; world data ODbL)? | owner | `LicenseRef-DeeVerse-Owned` placeholder in `REUSE.toml` (M00b) until the owner picks | M14b3 `public-repo` step only | 2026-10-18 |
| Q-13 | Which physical test devices exist? (was Q-S11-01) | owner | iPhone 15, iPhone 16/17, Quest 3, Vision Pro (visionOS 26.2+), Apple Silicon Mac; Windows GPUs optional, so `desktop-ultra` stays uncalibrated without them | device ACs only of M01b2, M01c, M01e, M02b1, M02b2, M03b1, M04b2, M04c, M07b2, M08c2, M11a2, M11b1, M11b4, M13a4, M13a5, M14a, M14b3, M15b (CI parts proceed) | 2026-10-18 |
| Q-14 | Raise the USD 100 fal cap (DL-OWN-01)? | owner | **closed: no.** Generation follows `03-story-cutscenes.md` §D9.1 and stops at the $40 line; a raise is a `programCapUsdMicros` change with `ownerApproval` | none | 2026-10-18 |
| Q-15 | Production and staging domains, zone plan, GitHub visibility and plan (was Q-BE-08, Q-CI-01/02) | owner | one zone with `id.`, `rt.`, `media.`, `ugc.` and `-staging` twins; until then `workers.dev` (no `workers.dev` host serves R2 media and `r2.dev` stays off, so deployed builds have no media host until `media-staging.<domain>` exists; DL-670 part 2); prod deploys from tags by an allowlisted actor | custom-domain steps of M00a, M01d, M12a1, M12b1, M12b2, M13a2, M13c2; M02c2 AC-14 (staging `sf` release) and through it M05c2 AC-7 to AC-9, the R-ROLL-01 anchor before M12b1; launch M14b3 | 2026-10-18; owner action raised 2026-10-19, needed before the M02c2 operator release (run order #30) |
| Q-16 | Owner filings: NCMEC ESP, PhotoDNA, Tech Coalition Pathways, DMCA agent, Cloudflare CSAM-tool ticket (was Q-BE-07) | owner | file before M06b2; photos private-only, CyberTipline web form, own hash banks | photo publishing in M06b2; PhotoDNA and NCMEC API in M13d1; agent block in M13d2; `ugc.publish` flip after M13d1 | 2026-10-18 |
| Q-17 | Who holds the production `FAL_KEY`? (was Q-S05-02) | owner | art lead holds the staff key locally; CI and Worker keys separately scoped with allowed-model lists | live runs of M00c, M05c3, M06b4, M10a1, M10a2, M10b | 2026-10-18 |
| Q-18 | Counsel reading of fal ToS §4(a) "internal business use" (was Q-S05-05) | counsel | internal-only generation (D-19); sign-off is a launch gate | M14b3 | 2026-10-18 |
| Q-19 | Supply the per-character research layer (`research/characters/<slug>/`) | owner | original test souls and one `fictionalized` canary | real-roster content in M06a2, M08b1, M10a1, M10a2, M10c | 2026-10-18 |
| Q-20 | Raise the $100/month voice line for ElevenLabs t2 (≤ 3 heroes)? (was DN-S04-02) | owner | no: t1 Aura; `ks:tts:elevenlabs` on (t2 off) | hero voice quality in M06a4, M10c | 2026-10-18 |
| Q-21 | Who runs the community sensitivity read of D3/D4 missions? (was DN-S03-05) | owner | owner arranges it; CI and staging proceed | production release of M05c2, M05e1 (`m.a2.03`), M05f2 (`m.a3.05`); M14b3 gate | 2026-10-18 |
| Q-22 | Publish `@dv/mod-sdk` and `@dv/cli` to npm under MIT, which scope? (was DN-S12-04, Q-S12-04, Q-MOD-03) | owner | tarballs on the release page until confirmed | npm step of M13a6 and M13c3 | 2026-10-18 |
| Q-23 | Counsel list: (a) trademark knock-out of makes, handles, operators; (b) pose calibration as biometric data; (c) tycoon disclaimer; (d) default-on telemetry; (e) launching on or after 2027-01-01 without a verified OS age-signal provider (AB 1043; DL-285); (f) the `vendorTerms` flow-down clauses in `content/legal/terms.json` (M13d2) (was DN-S06-02, Q-S06-03, Q-S07-2, U-FGT-11) | counsel | (a) placeholders via `names:lint`; (b) device-local, opt-in, deletable; (c) disclaimer in the pitch room; (d) on with first-run notice (DL-140); (e) release before 2027-01-01, otherwise gate `age-signals` blocks until M14b3's conditional slot ships a verified provider (blocked by U-UI-1); `Q-23e` is the fallback only (DL-493); (f) M13d2 placeholders from F-038, F-042; gate `Q-23f` blocks release | M14b3 launch (text in M07b1, M08c2, M09b2, M13d2 ships as placeholder) | 2026-10-18 |
| Q-24 | Does a human art lead author fighter animation (≈ 160 Blender tasks)? (was S07-D1) | owner | yes in principle; without art-lead time v1 ships library moves | animation quality in M08b1, M10a2 | 2026-10-18 |
| Q-25 | Create the private `content-private/` repository and grant CI read access (was DN-S04-01) | owner | only original souls and the rules example build | real-roster content in M10a1, M10a2, M10c; production rails before M14b3 | 2026-10-18 |
| Q-26 | How to spend the $8 fal buffer if unspent? | owner | unspent; any spend needs the owner's written word and a ledger entry | none | 2026-10-18 |
| Q-27 | Which 12 roster entries get Lean custom 3D bodies? | owner | the ten on-screen Act 1 fictional cast plus two Act 2–3 members picked at `assets:gen plan --roster` | M10a1, M10a2 plan | 2026-10-18 |
| Q-28 | Hold the $500/month recurring ceiling as MAU grows? | owner | hold; governor degrades at 70/85/100 %; revisit before 1,000 MAU | M14b1 alarms; post-launch | 2026-10-18 |
| Q-29 | Add a friend graph for presence? | owner | no: own status, notices and 6-character invite codes | friend list only (no v1 milestone); M12c1, M12d unaffected | 2026-10-18 |
| Q-30 | Send ADR-GENAI-01 clearance questions to fal and MiniMax; who stores the answers in `docs/legal/`? (also Q-03, Q-S05-01) | owner | not sent; no provider `cleared`; mocks, previs and in-engine fallbacks | live mode of M05b1, prewarm AC-9 of M05c3, M10b clip generation | 2026-10-18 |
| Q-31 | Preview URLs public or behind Cloudflare Access? (Q-CI-03, [research/gap-ci-cd-release-assets.md "Open questions"]) | owner | public (`preview_urls: true`, M00); no Access service token | none | 2026-10-18 |
| Q-32 | Toolchain pins `pnpm@12.14.0` and Node 22 LTS (research also asks Node 24) (Q-CI-04) | Builder (M00 records), owner may override | pins as in M00; resolved versions recorded in `spec/03` | none | 2026-10-18 |
| Q-33 | Who approves production deploys, and who holds `CF_API_TOKEN_CACHE`? (Q-CI-06) | owner | the owner, via `DEPLOY_ALLOWED_ACTORS` (M00a); purge-only token as a GitHub secret (DL-210) | M10b purge drill, M14b3 | 2026-10-18 |
| Q-34 | Budget for cloud real devices (BrowserStack or similar)? (Q-CI-07) | owner | none; Q-13 devices only; cloud devices optional for Safari-tab regressions (WebGPU, WebXR, Home Screen there UNVERIFIED [research/gap-ci-cd-release-assets.md §4.3]) | none | 2026-10-18 |
| Q-35 | Use Overture buildings for expansion areas? (Q-MAP-06) | owner | OSM; M15a records a time-boxed comparison; an importer only on override | none (M15a–M15g on OSM) | 2026-10-18 |
| Q-36 | When do `USER_NPC` fighters arrive? (Q-S07-5) | owner | post-v1, no milestone | none | 2026-10-18 |
| Q-37 | Is VS-Story (Act 1, M05c2 proven on staging) enough to open the R-ROLL-01 multiplayer gate, or must Acts 2–3 (M05f2) land first? | owner | Act 1 anchor (`_PLAN.md` §0 rule 4; `check:rollout`, M00d; `spec/01-product.md` §11) | M12b1 start under parallel Builders (DL-246); "whole story first" adds M05f2 to M12b1 Depends on (+6 sessions on the critical path) | 2026-10-18 |

Q-38 onward continue in `spec/99-open-questions-2.md` §1 (Q-38…Q-41 moved there unchanged on 2026-10-19 for the 6,000-word cap, DL-608).

## 2. UNVERIFIED facts

"Verified" names the milestone and AC that records the item (R&F = Risks & fallbacks, N = Notes for the Builder); a recording is never an assertion. "Blocks" lists ACs that cannot pass if the item is false; "none" means the default keeps every AC command valid.

| U | Claim | Where used | Verified (milestone + AC) | Default if it fails | Blocks |
|---|---|---|---|---|---|
| U-ENG-1 | `Math.sqrt` bit-identical across JS engines | 01-engine §7; C02 | M01a1 AC-2 vectors | `detmath.sqrt` never delegates | none |
| U-ENG-2 | tick cost of `deterministic-compat` vs `simd-compat`, incl. 8 M1 vehicles; restart cost (Q-ENG-01) | D-12; 06-racing §7 | M01a2 bench (Scope); M03a1 R&F; M07a1 cap | `simd-compat` locally; per-tier M1 cap | none |
| U-ENG-3 | Rapier wasm runs in a Durable Object | ADR-0029 | M12b1 R&F (not used) | kinematic validation only | none |
| U-ENG-4 | `WebSocket` in a dedicated worker on iOS Safari | 01-engine §2.13 | M14b3 AC-10 | main-thread `MessagePort` relay by feature detection | none |
| U-ENG-5 | Quest A/B/X/Y indices in `xr-standard` | C03 rule 6; 06-racing-content C.9; 10-ui | M01c AC-13 (N); M11b1 AC-10; M11b4 AC-7; M14b3 AC-11 | profile entries `null`; no required action only on a face button | none |
| U-ENG-6 | Rapier debug-render API | 01-engine §3 | M03a1 Scope | own wireframe from `BodyDesc` | none |
| U-ENG-8 | iOS PWA background-suspension timing | 01-engine §5 | M01c AC-12; M11a2 AC-6 | pause and autosave on every `hidden` | none |
| U-ENG-9 | IndexedDB commit durability under WebContent jetsam | C05 rule 1 | M04a1 AC-10 (Chromium only); M11a2 N | two-phase write is safe either way | none |
| U-PLT-1 | iOS Home Screen vs Safari-tab WebGPU parity | 11-platform §4.3 | M01c AC-14; M11a2 AC-6; M14b3 AC-10 | `webgpu.mobile=false` (WebGL2 backend) | none |
| U-PLT-2 | GPU-process jetsam limit; 2,048 MB WebContent kill on every iPhone | 11-platform §4.5 | M01c AC-12; M11a2 AC-6 | accounted cap 600 MB; ceiling 1,200/900 MB | none |
| U-PLT-3 | ProMotion rAF above 60 Hz | 11-platform §5 | M11a2 AC-7; M14b3 AC-10 | plan 60 Hz | none |
| U-PLT-4 | post-jetsam behaviour (reload vs blank, nav type, `localStorage`) | 11-platform-pwa | M01c AC-12; M11a2 AC-6; M14b3 AC-10 | heartbeat inference only | none |
| U-PLT-5 | `GPUDevice.lost` fires before a GPU-process kill | 11-platform-perf | M14b3 AC-10; M11a2 N | heartbeat plus abnormal-exit demotion | none |
| U-PLT-6 | `adapter.info` content on Safari | tier detection | M01c AC-13 | benchmark decides the tier | none |
| U-PLT-7 | Safari `timestamp-query` | 11-platform-perf §2 | M01c AC-13 | GPU timers optional, never asserted | none |
| U-PLT-8 | takram atmosphere works with three r186 | 02-world-living §6 | M10d2 AC-9 record (adapter, flag off by default); M11a2 N (desktop-ultra) | removable adapter, `desktop-ultra` only | none |
| U-PLT-9 | visionOS user-agent string | device classifier | M01c AC-13 | capability detection; captured fixtures | none |
| U-PLT-10 | Vision Pro framebuffer, refresh control, foveation, WebGPU-vs-WebGL XR cost | 11-platform-xr | M11b1 AC-11; M11b4 AC-8; M14b3 AC-11 | scale 1.0, 90 Hz assumed, no rate control | none |
| U-PLT-11 | `immersive-ar` on visionOS; PS VR2 controllers as WebXR inputs | C04 rule 5 | M11b1 N (out of v1; ADR-0027) | `immersive-vr` only | none |
| U-PLT-12 | Quest Browser flag names; non-XR WebGPU default | 11-platform-xr | M11b1 AC-10; M11b4 AC-7; M14b3 AC-11 | Quest forced to WebGL2 backend | none |
| U-PLT-13 | XR session `visibilitychange` semantics | 11-platform-xr; 10-ui-hud-xr Pause panel | M11b1 AC-10; M11b4 AC-7/8; M14b3 AC-11 | pause on `hidden` and `visible-blurred` | none |
| U-PLT-14 | `renderer.info.render.drawCalls` with `BundleGroup` on WebGPU | `RenderBudgetMeter` | M01c AC-13; M11a1 N | count render objects; `info` authoritative on WebGL2 | none |
| U-PLT-15 | `navigator.standalone` for Home Screen detection | 11-platform-pwa §2 | M01c AC-12 | `matchMedia('(display-mode: standalone)')` first | none |
| U-PLT-16 | OPFS 7-day eviction; cross-tab sync-handle behaviour | 11-platform-pwa §5 | M01e AC-11; M11a2 AC-6 | nothing assumes persistence; second tab read-only | none |
| U-PLT-17 | Low Power Mode: video and frame rate; a pooled unlocked element plays new sources | 11-platform-pwa §6; 03-story §7 | M04c AC-8; M11a2 AC-6 | gesture-unlocked pool; "Tap to play", then fallback | none |
| U-PLT-18 | iPhone RAM sizes | tiering | M01c AC-12 | benchmark-driven tiers | none |
| U-PLT-19 | SwiftShader WebGPU recipe on a GitHub runner | 08-test §3 | M00 AC-8 | `chromium-webgl2` is the required project | none |
| U-PLT-20 | † budgets, comfort constants, gesture thresholds | 11-platform §4.5 | M11a2, M11b1 calibration | S11 starting values | none |
| U-AST-1 | Meshy bone names, finger/jaw/face data, clip licence | 05-assets §7; 04-npc lip-sync | M00c AC-9; M10a1 R&F (`--probe-bones`) | alias table from the probe; gate H4 | none |
| U-AST-2 | Meshy honours `image_urls` order | 05-assets-pipeline §4 | M00c AC-9; M10a1 R&F | crops front, left, back, right | none |
| U-AST-3 | fal CDN `Content-Length`; retrieval with `X-Fal-Store-IO: 0` | 05-assets-pipeline §6 | M00c AC-9 | copy to R2 at once; lifecycle 86,400 s | none |
| U-AST-4 | C2PA present on fal outputs per endpoint | 06-asset-pipeline | M00c AC-9; M05b1 | record state; re-sign renditions | none |
| U-AST-5 | Workers `DigestStream`; Workflow `waitForEvent` max timeout | 05-assets §5 | M05b1 | hash in container or CLI; 20 min wait plus poll | none |
| U-AST-7 | GPT-image cost of extra input images | cost plan | M00c AC-9; M10a1 R&F | $0.01 assumed; ledger settles actuals | none |
| U-AST-8 | Sunburst and Nano Banana refusals on real-person edits | likeness rules | M00c AC-9 (optional R1) | never send real-person photos | none |
| U-AST-9 | Rhubarb licence (believed MIT) | lip-sync | M00b licence snapshot; M06a4 | no cues; RMS envelope | none |
| U-AST-10 | CC0 terms (Poly Haven, ambientCG, Kenney, Quaternius, Freesound) | 06-asset-pipeline | M00b; per-pack snapshot (M03b1, M07b2) | admit a pack only after a snapshot | none |
| U-AST-11 | ElevenLabs SFX endpoint terms and price | 06-asset-pipeline §2 | M14b3 `genai:terms-watch` | registry `pending` | none |
| U-AST-13 | basis_universal XUASTC with three's transcoder | 05-assets §5 | M01d | not used | none |
| U-AST-14 | iOS decodes Ogg Opus via `decodeAudioData` | barks, TTS | M00c AC-9 (container); M06a4 R&F; M10c | AAC or mp3 | none |
| U-AST-15 | pinned C2PA signing tool and version | `check:c2pa` | M05b1 Scope (recorded in `spec/03`) | `check:c2pa` blocks release | none |
| U-AST-16 | H3-family US licence (ADR-GENAI-01) | 03-story; 07-fighter FX6 | M05c3 AC-9 (runs only when `cleared`, Q-30) | fallback chain; in-engine clips | M05c3 AC-9 |
| U-AST-17 | art-lead effort: 20–40 min per character; ≈ 160 fighter clip tasks | 05-assets; 07-fighter FX7 | M00c AC-9; M10a1; M10a2 R&F | estimate only; library clips (Q-24) | none |
| U-AST-18 | Workers AI terms or AUP URL (no ledger fact; F-025 is prices only) | `vendorTerms` `workers_ai`; vendor-terms index | M13d2 Scope (`pending-manual` until recorded in `spec/03`) | entry shows "pending review"; `Q-23f` | none |
| U-BE-1 | cross-origin WebSocket from a COEP page to `rt.<domain>` | 09-backend §2 | M12b2 AC-9 | same-origin `/rt` (Q-BE-02 fallback) | none |
| U-BE-2 | Turnstile verification API and widget under COEP | `/account/register` | M12a1 R&F; M12a2 R&F | verifier mode `none`, per-net caps | none |
| U-BE-3 | `wrangler@4.151.1` keys: workflows, AE, analytics, ratelimits, observability, previews, containers | wrangler configs | M00a R&F; M05c3 Scope | drop the key, record it | none |
| U-BE-4 | DO WebSocket `send` backpressure; WS messages vs ~1,000 req/s | rooms | M12c2 AC-10 | CAP 16; slow-receiver degrade | none |
| U-BE-5 | DO memory limit (128 MB assumed) | rooms | M12c1 R&F; M12c2 | checkpoint < 1 MB | none |
| U-BE-6 | Workflow create with an existing id | cutscene jobs | M05b1 R&F | single-flight in `CutsceneJobDO` | none |
| U-BE-7 | Hyperdrive reaches Supabase | 09-backend #35 | M05d Scope out (not used) | supabase-js over HTTPS | none |
| U-BE-9 | Cloudflare CSAM tool covers R2 custom-domain responses | UGC serving | M13d1 (ticket, Q-16) | cache rule on `ugc.` | none |
| U-BE-10 | Cache-Tag purge for R2 objects | kill-switch | M10b R&F | prefix purge | none |
| U-BE-11 | NCMEC CyberTipline API credential process | T&S | M13d1 (Q-16) | web form | none |
| U-BE-12 | PhotoDNA approval timing | T&S | M13d1 (Q-16) | own hash banks plus PDQ | none |
| U-BE-13 | `limits.cpu_ms` for Workflow steps and queue consumers | pipeline, publish | M05b1; M13c2 R&F | heavy work in container or CLI; `review` above the measured size | none |
| U-BE-14 | invocation log per hibernated WS message | rooms logging | M12c2 AC-10 | sampling 0.001, invocation logs off | none |
| U-BE-15 | Custom Alerts billing and rule limits | ops alerts | M14b1 Scope | own cron evaluator; Budget emails | none |
| U-BE-16 | full-page redirect sign-in in an iOS Home Screen app | 10-ui-pages | M14a AC-10 | device code first; OTP and passkey, social hidden in standalone | none |
| U-BE-17 | AI Gateway price catalog covers the 5.5 models | spend | M06a1 R&F | own ledger from `usage` | none |
| U-BE-18 | Anthropic minimum workspace spend limit | guardrails | M14b1 N | `synthetic` workspace at the minimum accepted | none |
| U-BE-19 | fal auto-recharge, locked-account status; ElevenLabs cap response | guardrails | M14b1 Scope (T3 records); M05c3 | recharge off; map to `upstream_unavailable` | none |
| U-BE-20 | `wrangler deployments status --json` field names | `tools/ci/deploy.ts` | M00a R&F | `versions list --json`; else stop before deploy | none |
| U-BE-21 | DO restarts scoped to the deploying script | split Workers | M12c1 AC-12 | split Workers anyway | none |
| U-BE-22 | `wrangler preview` validates `secrets.required` like `deploy` and `versions upload` (research verifies only those two [research/gap-ci-cd-release-assets.md §0 item 4]) | `deploy:preview` after a secret joins `secrets.required` (DL-679) | M06a1 N (first Preview with `PLAY_TOKEN_HMAC` required) | set the Preview base secret with `wrangler preview base-config secret put` before the PR | none |
| U-COST-1 | fal minimum top-up, lock threshold, last dollars spendable | DL-OWN-01 tranches | M00c | $8 buffer absorbs it; recharge off | none |
| U-COST-2 | fal concurrency stays 2 under $100 total | batch plan | M10a1; M10a2 | batches of two | none |
| U-COST-3 | fal bills refused or errored requests | ledger | M05c3 R&F; M00c | assume billed; loss from the buffer | none |
| U-COST-4 | per-MAU usage and $25/h review rate | 10-cost-model | M14b1 (re-measure after launch) | research proposals | none |
| U-COST-5 | per-request fal billing is retrievable for reconciliation | ledger | M10a2 R&F | weekly dashboard reconcile; record drift | none |
| U-API-1 | full CSP on Safari 26, Quest Browser, visionOS; mod `srcdoc` frame under CSP and COEP (no isolation, no `SharedArrayBuffer`) | spec/05 §1.3; 12-modding §2.5 | M05b1 AC-11 (Report-Only); M13a5 AC-6, AC-9; M14b3 AC-10 | Report-Only until M14b2 enforces; frame keeps its own CSP; `mods.ui` off | none |
| U-API-2 | Thirdweb origins needed in the `/account/*` CSP | spec/05 §1.3 | M14a AC-10 | add the observed origins by PR | none |
| U-ADR-01 | Supabase GitHub provider beside our TPA issuer; OpenAI web sign-in grant | ADR-0018 | M13c1 AC-10 | public publishing waits for M14a | none |
| U-ADR-02 | DO relay latency for 60 Hz fight input | ADR-0028 | M12c2 AC-10 | no online fighter; C11 unchanged | none |
| U-REC-1 | VP9 fixture decode in Playwright Chromium and WebKit; H.264 decode in Playwright Chromium; blank-clip (`blank.mp4` / `blank.webm`) playback in the `webkit-webgl2` first-gesture unlock | M04c fixtures and unlock | M04c `@cutscene` run (AC-6 log, `test-results/codecs.<project>.json`) | canvas-source fallback for the fixtures (DL-232); a rejected blank `play()` leaves the pool acquirable with the error in `state().errors` (M04c AC-1) | none |
| U-REC-2 | Chromium delivers a crash report to route 4 | crash reporting | M11a2 AC-8 | endpoint unit-tested; delivery observed only | none |
| U-W1 | Geofabrik PBF URL, `osmium` subcommands, PBF-to-GeoJSON route | 02-world-bake §2 | M02a1 AC-9 | any GeoJSON-lines route; record in `sources.json` | none |
| U-W2 | Overpass endpoints as fallback | bake | M02a1 R&F | Geofabrik only | none |
| U-W3 | NAIP/USGS imagery licence | bake colour | M02a1 Scope out | `--imagery` off (DL-107) | none |
| U-W4 | map-layer and geocoder sizes beyond roads | 02-world-maps §1 | M02c2 | gates fail > 4 MiB | none |
| U-W5 | seeds for BART 16th, 24th, Balboa Park, Caltrain, GG portal | living §5 | M02a2 AC-8 | snapped by `map:landmarks` | none |
| U-W6 | cable-car street chains | living §5 | M02a2 AC-8 | bake checks within 6 m | none |
| U-W7 | resolved, not UNVERIFIED: SPDX `ODbL-1.0`, `PDDL-1.0` are in the merged M00b `config/license-allowlist.json` (`record`) as the research record schema proposes [research/legal-ip-likeness.md §2.3] (DL-687) | provenance | M00b (merged) | — | none |
| U-W8 | per-pack R2 GETs fast enough without a batch route | streaming | M02b1 AC-11 | measure; batch route needs an Architect decision | none |
| U-W9 | OSM sidewalk, crossing, ferry coverage | bake | M02a2 AC-8 | derived sidewalks, authored ferries | none |
| U-W10 | bake ≤ 25 min, meshing 12/25 ms, sky and agent ms (†) | bake; perf | M02b1 AC-11; M02b2 AC-9 | calibrate | none |
| U-W11 | DataSF footprints omit post-2010 buildings | bake | M02a1 AC-9 | OSM gap fill ≤ 5 % | none |
| U-W12 | Workers static assets honour `Range` for `.pmtiles` | web surfaces | M13b2 (first hosting surface; none in v1) | fetch the whole archive | none |
| U-W13 | writer library for `sf.pmtiles` extraction | `map:webtiles` | M13b2 R&F | `--plan` only | none |
| U-W14 | land mask: `natural=coastline` land clipped to the 41-polygon Analysis Neighborhoods union matches the union's area within ±3 % (design value; the `play` box also holds non-SF land, reported only) | bake S3 gate (DL-655) | M02a1 AC-9 (`notes.json`) | the Builder records the ratio and reports Blocked; the Architect sets the tolerance from it by a DL entry | M02a1 AC-9 (only if the ratio is outside ±3 %) |
| U-W15 | OSM↔DataSF agreement on `sf` meets the design gates: one-way agreement > 90 % in one F/T orientation, ≥ 98 % of OSM signal nodes within 25 m of a junction, largest SCC ≥ 98 % of drivable edges (design values; research verifies only the DataSF `oneway` counts) | bake S5, S6, S14 gates (DL-669) | M02a2 AC-8 (`notes.json`) | the Builder records the three measured ratios and worst segments and reports Blocked; the Architect sets the thresholds from them by a DL entry; `synth` and `civic-excerpt` keep the design values | M02a2 AC-8 (only if a ratio misses its design value) |
| U-W16 | Terrain Tiles source datasets and required credits over the `stream`/`play` boxes (bay and ocean bathymetry included; the SF example repo measured −114.3 m at the Golden Gate strait [research/repos-world.md §1.2]) and the z12 far box; research verifies only 3DEP and SRTM as public domain and the 3DEP credit [research/repos-world.md §4] | Terrarium stamp, `LicenseRef-PublicDomain-USGov`, world attribution (DL-672 part 2) | M02a1 AC-9 (`notes.json`, from the Terrain Tiles attribution document) | keep `LicenseRef-PublicDomain-USGov`, the 3DEP credit and the registry citation sentence dated from the lock's `retrievedAt`; any further credit enters `config/world/sources.json` by an Architect DL entry | M02c2 AC-14 (only if a covering dataset needs a credit not yet in `sources.json`) |
| U-S03-1 | keyframe-first keeps identity across clips | 03-story-cutscenes §D8 | M00c AC-9; M08b2 | human review; reject pins a new seed | none |
| U-S03-2 | providers honour "no text, no logos" | prompt hygiene | M05c2; M05c3 | vision QA `text_in_image`; screen text in-engine | none |
| U-S03-3 | `seed`, `prompt_expansion_mode` on H3 partner and LTX | cache key | M00c AC-9 | omit unsupported params | none |
| U-S03-4 | MSE `sequence` gaps on Safari 26.x; on iPhone `ManagedSourceBuffer` `sequence` mode (BCD `SourceBuffer.mode` iOS: partial, iPad only) and `ManagedMediaSource` with WebM VP9 are not assumed, so the device run uses an H.264 fMP4 rendition (DL-654) | player | M04c AC-8 | ping-pong | none |
| U-S03-6 | Quest video textures freeze after XR entry | XR cutscenes | M11b4 AC-7 | pre-session pool; poll `currentTime`; fallback | none |
| U-S03-7 | `v768` first frame from R2 ≤ 2.5 s on mobile | trigger thresholds | M04c AC-8 | thresholds in `config/cutscene.json` | none |
| U-S03-8 | C08 route snap fits the load budget in `sim.worker` | missions | M05a1 (Effort) | resolve behind a fade | none |
| U-NPC-01 | Haiku TTFT through AI Gateway ≤ 800 ms p50, also with structured output | dialogue; tycoon pitch | M06a3 AC-12 | 4 s fallback; offline offer | none |
| U-NPC-02 | AI Gateway passes Anthropic SSE unbuffered | dialogue | M06a3 AC-12 | unset `AIG_BASE` (direct API) | none |
| U-NPC-03 | structured output streams token by token in the TS SDK | dialogue | M06a3 R&F | one delta; 4 s rule holds | none |
| U-NPC-04 | token overhead of the structured-output system prompt | cost model | M06a3 | estimate in `04-npc-builder.md` C7 | none |
| U-NPC-05 | Aura-1 encodings and streaming latency | TTS | M06a4 AC-10 | Aura-2 `mp3` | none |
| U-NPC-06 | Sonnet 5.5 `between_tools` with structured outputs | hero routing | M06a3 R&F | heroes on Haiku | none |
| U-NPC-07 | OpenAI moderation usable on non-OpenAI content | builder moderation | M06b1 R&F | Llama Guard only | none |
| U-NPC-08 | ElevenLabs plan-to-character mapping and rights | t2 voices | M06a4 R&F (Q-20) | t2 off | none |
| U-NPC-09 | Haiku voice consistency at low effort, thinking off | souls | M06a3 eval harness; M10c | Sonnet for heroes per D-21 | none |
| U-NPC-12 | cost and limits of `messages.count_tokens` | `npc:lint` L4 | M06a2 R&F | cached per prompt hash; offline estimate | none |
| U-NPC-13 | Sonnet 5.5 server-side fallback target: model id in the response, price, caching, `output_config.format` and `between_tools` support (research: targets other models, routing unpublished) | hero settlement, quota, governor (DL-551) | M06a3 R&F | unlisted model charged at Opus 5.5 rates; schema failure → `invalid_output`; else drop hero `fallbacks` | none |
| U-RAC-1 | Rapier vehicle controller gives per-wheel contacts and takes impulses | 06-racing §2 | M03a2 AC-3 | own `castRay` + `applyImpulse` vehicle | none |
| U-RAC-3 | independent bodies in one Rapier world do not interact in results | ghosts | M07a2 AC-7 (design) | ghosts are kinematic tracks | none |
| U-RAC-4 | `takeSnapshot` round trip bit-exact | replay seek | M07b2 AC-3 (logs path) | re-simulate from start | none |
| U-RAC-5 | PNG save on iPhone | photo mode | M07b2 AC-10 | press-and-hold image | none |
| U-RAC-6 | cost of `SSRNode`, `MotionBlur`, `LightProbeGrid` at `desktop-ultra` | visuals | M07b2 R&F; M11a2 | flags off | none |
| U-RAC-7 | device-motion permission in an iOS Home Screen app | tilt steering | M07b2 AC-10 | tilt hidden unless granted | none |
| U-FGT-1 | PoseLandmarker latency/FPS on iPhone and desktop | pose gate | M08c2 AC-14, AC-15 | `assisted` or `unavailable` | none |
| U-FGT-2 | tasks-vision 1.1.1 in a classic worker under Vite 8 | pose worker | M08c1 AC-8 | module worker; else `unavailable` | none |
| U-FGT-3 | Google object path of the `.task` models | vendoring | M08c2 N (operator vendors, DL-236) | pinned size and SHA-256 | none |
| U-FGT-4 | MediaPipe left/right labels under a mirrored stream | classifier | M08c1 AC-8 | stance and mirrored x only | none |
| U-FGT-5 | iOS standalone camera reliability on iOS 26/27 | pose | M08c2 AC-14 | freeze detector suggests Safari | none |
| U-FGT-6 | `captureTime` accuracy on iOS | latency | M08c2 AC-14 | 60 ms constant | none |
| U-FGT-9 | WebXR camera access on Quest (Q-GD-08) | XR pose | M11b2 N | no pose mode in XR | none |
| U-TYC-1 | Carta Q1 2025 Series A dilution 17.9 % | term-sheet target | M09a2 (design constant only) | target 18–20 %, band 15–24 % | none |
| U-TYC-2 | YC two-cap example (≈ 15 %) | TV-2 | M09a1 (self-derived arithmetic) | no test depends on it | none |
| U-TYC-4 | YC "Company Capitalization" beyond the pool sentence | SAFE conversion | M09a1 | game convention §4 | none |
| U-UI-1 | browser shape of OS age signals (AB 1043, 2027-01-01) | `AgeSignalProvider` | M14c AC-8 (fake provider); real provider in M14b3's conditional slot once verified in `spec/03` | provider returns `null`; counsel `Q-23e` | M14b3 gate `age-signals` and its conditional age-signal provider slot, for a release on or after 2027-01-01 (DL-285, DL-493) |
| U-UI-2 | system keyboard inside an immersive session | XR text entry | M11b3 N | flat-only text entry (DL-142) | none |
| U-UI-3 | Preact 11.0.1 bundle size and iOS runtime cost | shell | M04b1 | `check:bundle` budget | none |
| U-UI-4 | forum list `sort` values and `q` on route 38 | forum UI | M13b4 | `sort` only | none |
| U-UI-5 | `<a download>` of `.dvsave` in iOS standalone | saves page | M11a2 iPhone run (N) | page tells the player to export from a Safari tab | none |
| U-UI-6 | minimum text angle 1.5° and XR panel pixel/count budgets | XR panels | M11b3 N | S11 starting values | none |
| U-UI-7 | UI frame, node-count and latency budgets (†) | 10-ui §2.7 | M04b1; M11a2 | starting values | none |
| U-UI-8 | `visualViewport` keyboard avoidance in iOS standalone | pages | M11a2 iPhone run (N) | single column, sticky action bars | none |
| U-UI-9 | colour-vision-deficiency simulation algorithm | palette CI | M04b2 (chosen, logged) | threshold never lowered | none |
| U-UI-10 | iPhone 15 landscape CSS viewport and `env(safe-area-inset-*)` values in a Safari tab and in the Home Screen app (research gives only the 2556 × 1179 px panel [research/stack-rendering-platform.md §3.4]) | `packages/ui/test/fixtures/iphone-landscape.json` (`10-ui-hud-xr.md` §2.9 rule 3); M04b1 AC-5, M04b2 AC-3 | M04b2 AC-12 (`notes.json`, recorded); the Architect then updates the fixture (DL-650 part 2) | the design fixture (844 × 390, insets 0/48/24/48) stays; layouts keep their margins | none |
| U-MOD-1 | QuickJS per-tick cost on iPhone and Quest | script tier | M13a4 AC-11 | script tier off on `mobile-low` (DL-147) | none |
| U-MOD-3 | renderer-process separation of sandboxed same-site frames | UI mods | M13a5 AC-9 notes | L2 panels first; `mods.ui` off | none |
| U-MOD-4 | Chrome Local Network Access gates WebSockets to 127.0.0.1 | `dv mod dev` | M13a6 R&F; M14b3 | local `pnpm dev` path | none |
| U-MOD-5 | `@dv` npm scope available | Q-22 | M13c3 (npm step) | tarballs | none |
| U-MOD-6 | ChatGPT plan usage covers a local Studio calling our API | flow A | M13a6 | flow A documented, no program; flow B scheduling is Q-38 | none |
| U-MOD-7 | Ajv runtime codegen in Workers | validators | M13a1 | build-time standalone code | none |
| U-MOD-8 | incremental SHA-256 beside `sha256Hex` | archive scan | M13c2 R&F | stream entries; `review` above measured size | none |
| U-MOD-9 | `gltf-validator`, `ktx validate` in a Worker | publish scan | M13c2 | scan Container | none |
| U-MOD-10 | offline SF geocoder export from `tools/map` | `world.find_place` | M13b2; M13a6 | `not_available` | none |
| U-MOD-12 | residential land-use attribute in DataSF Parcels | anchor rules | M13b2; M13c2 | polygon rule plus human review | none |
| U-QA-3 | Node 22 global `WebSocket` without a flag | load bots | M12c2 AC-10 | `ws` package | none |
| U-QA-4 | two load-bot locations land in distinct PoPs | load test | M12c2 AC-10 | operator machine as second site | none |
| U-QA-5 | `ip:similarity` tool and licence | clean room | M14b3 AC-7 | SKIP; blocks `public-repo` only | none |
| U-QA-6 | resolved, not UNVERIFIED: environment secrets are public-repo-only on GitHub Free, and required reviewers public-only on Free/Pro/Team [research/gap-ci-cd-release-assets.md §1 item 9, §6, verified row https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments, 2026-10-18]; the plan itself stays Q-15 | prod deploys, CI secret store | M00a (deploy.yml) | CI secrets are repository secrets (`08-test-and-ci.md` §8); tag-only prod by an allowlisted actor | none |
| U-QA-7 | Metal on standard macOS runners | CI | M00d nightly (informational) | no macOS project | none |
| U-QA-8 | `_headers` applied on Preview URLs | preview checks | M00 AC-14 | `serve-dist.ts` locally; report Blocked | M00 AC-14 (F-1) |
| U-QA-9 | a command or API that lists a Worker's Previews (research documents only `wrangler preview`, `preview delete --name`, `preview secret …` and `base-config` [research/gap-ci-cd-release-assets.md §1.5]) | nightly stale-Preview sweep | M00d R&F | sweep derives names from closed PRs (`gh pr list`) and deletes them, "not found" is success (DL-658) | none |
| U-BLD-1 | `wrangler dev` applies `_headers` locally | M00 R&F | M00 (Builder decision) | `tools/ci/serve-dist.ts` on 8788 | none |
| U-BLD-2 | Workers Vitest pool loads M00a's config | M00a R&F | M00a | plain Node Vitest with a fake `env` | none |
| U-BLD-3 | bitECS 0.4.0 id start and recycling order | M01a1 R&F | M01a1 | sentinel entity; own `Gen` store | none |
| U-BLD-4 | Rapier 0.21.0 `init()` shape, heightfield order, KCC `computeColliderMovement`/`computedGrounded` | M01a2, M01b1 R&F | M01a2; M01b1 (typings) | cast-and-slide over `castSphere` | none |
| U-BLD-5 | R2 bucket-creation and CORS command syntax | M01d R&F | M01d runbook | dashboard path | none |
| U-BLD-6 | versions outside the ledger (`eslint`, `tsx`, `ajv`, `@cloudflare/vitest-pool-workers`, `@axe-core/playwright`) | CLAUDE.md "Facts" | M00, M00a, M04b1 record resolved versions in `spec/03` | what pnpm resolves | none |

## 3. Aliases and closed ids

- **Merged U-ids** (old → kept): U-ENG-7, U-NPC-10 → U-AST-1 · U-AST-6 → U-BE-3 · U-AST-12 → U-BE-10 · U-NPC-11 → U-AST-9 · U-RAC-2 → U-ENG-2 · U-RAC-8 → U-ENG-5 · U-S03-5 → U-PLT-17 · U-FGT-7 → U-AST-17 · U-FGT-8 → U-ADR-02 · U-FGT-10 → U-AST-16 · U-FGT-11 → Q-23(b) · U-TYC-3 → U-NPC-01 · U-QA-1 → U-PLT-19 · U-QA-2 → U-BE-20 · U-TYC-5 closed by DL-139.
- **Bare ids:** S05 `Un` = U-AST-n and S09 `Un` = U-BE-n (U-BE-8 never existed); S12 `Un` = U-MOD-n except U2 → U-API-1 and U11 → U-BE-9. In milestone prose, bare `U7`, `U9`, `U14` in M10a1/M10c are S05; `U1`, `U4`, `U7`, `U10` in M13a1–M13a6 are S12. S02 return items 12–14 → U-W12, U-W13, U-MOD-12. S10 (`10-ui.md` §10 and return) items 1 → U-BE-2, 2 → U-BE-16, 5 → U-ENG-5, 6 → U-PLT-15, 12 → U-RAC-7, 15 → U-PLT-13; 3, 4, 7, 8, 9, 10, 11, 13, 14 → U-UI-1…9 in that order. S13 U-QA-1…8 as above. M12c2's Node `WebSocket` → U-QA-3; M01e's iOS OPFS eviction → U-PLT-16.
- **Moved to owner questions:** Q-S11-01 → Q-13 · Q-S05-03, DN-S05-2 → Q-14 · Q-BE-08, Q-CI-01, Q-CI-02 → Q-15 · Q-BE-07 → Q-16 · Q-S05-02, DN-S05-4 → Q-17 · Q-S05-05 → Q-18 · Q-S06-03, DN-S06-02, Q-S07-2 → Q-23 · Q-S12-04, DN-S12-04, Q-MOD-03 → Q-22 · Q-S05-01 → Q-30 · Q-CI-03 → Q-31 · Q-CI-04 → Q-32 · Q-CI-06 → Q-33 · Q-CI-07 → Q-34 · Q-MAP-06 → Q-35 · Q-S07-5 → Q-36.
- **Closed by decisions** (`spec/11-decision-log.md` §B unless named): Q-ENG-01 → U-ENG-2; Q-ENG-02 → U-ENG-1; Q-ENG-03 → U-ENG-4 (DL-052); Q-ENG-04, Q-MOD-06, Q-S12-08 out of v1 (D-S01-07); Q-ENG-05 hands-only (D-S01-06, ADR-0027); Q-ENG-06 48-minute day (D-S01-04); Q-ENG-07 → U-ENG-5; Q-ENG-08 → U-ENG-3 (ADR-0029); Q-BE-01, Q-BE-03, Q-BE-04, Q-BE-06, Q-BE-09 settled; Q-BE-02 → U-BE-1 fallback; Q-BE-05 → U-BE-2; Q-S05-04 → U-AST-17; Q-MAP-01, Q-MAP-03 DL-112; Q-MAP-02 DL-106; Q-MAP-04 DL-107; Q-MAP-05 DL-105; Q-MAP-07 → U-MOD-12; Q-MAP-08 DL-111; Q-S06-01 moot (Q-07 Premise A); Q-S06-02 DL-124; Q-S06-04 DL-122; Q-S07-1, Q-S07-3, Q-S07-4 → U-FGT-2, U-FGT-5, U-FGT-6; Q-S08-01 DL-138; Q-S12-01 DL-145 (→ U-ADR-01), Q-S12-02 DL-146, Q-S12-03 DL-147, Q-S12-05 DL-148, Q-S12-06 DL-149, Q-S12-07 DL-150; Q-GD-06, Q-GD-07 → Q-06 and DL-124; Q-GD-08 → U-FGT-9; Q-GD-09 DL-134; Q-CI-05 closed (M00a: 0 % smoke → 100 %, gradual from M12a1); every DN-S0x/DN-S1x by DL-105…DL-154 and DL-208…DL-214.

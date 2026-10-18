# 00 — Plan and status (living)

Architect: Claude Opus 5.5 (`claude-opus-5-5`). Started 2026-10-18. Shared context: `prompt-pack/06-SHARED-CONTEXT.md` **v1.0, frozen 2026-10-18** after Wave 1 reconciliation (was v0.95). Binding decisions: `spec/03-decisions-and-facts.md` v0, plus `spec/11-decision-log.md` (DL-001…DL-050). Architecture: `spec/02-architecture.md` v0. Open questions: `spec/99-open-questions.md`.

## Phase status
| Phase | Subagents | Status | Output |
|---|---|---|---|
| 0 Ingest + research | S00 × 8 dimensions, completeness critic, S00 × 5 gap reports, S00 INDEX | **done** 2026-10-18 | 13 new reports + `research/INDEX.md` (30 decisions, F-ledger, constraints, milestones, costs) |
| 1 Contracts | S01 engine · S09 backend · S11 platform · S05 assets | **done** 2026-10-18 | `spec/domains/01-engine*.md` (3 files), `09-backend*.md` (4), `11-platform*.md` (4), `05-assets*.md` (2); reconciliation → 06 **v1.0 frozen**, `spec/02-architecture.md` v0, `spec/11-decision-log.md`, `spec/99-open-questions.md` |
| 2 World + content | S02 world · S03 story · S04 NPC | ready (contracts frozen; may run concurrently with 3–4) | `spec/domains/02,03,04`; finalize C08, C09, C10 inside the 06 §4.4 sketches |
| 3 Modes | S06 racing · S07 fighter · S08 tycoon | ready | `spec/domains/06,07,08` |
| 4 Shell + UGC | S10 UI · S12 modding | ready | `spec/domains/10,12`; finalize C14, C17 inside the sketches |
| 5 Integration | S13 + integration authors | pending | `spec/01–12, 99`, milestones, ADRs, CLAUDE.md, AGENTS.md, kickoff |
| Verification | critics: executability · factual · scope | pending | critic log below |

## Inputs found at start
- Present: `prompt-pack/` (pack v1), `research/` repo analyses (webport, world, grand-v), Anthropic model facts, Claude Code deployment, prompting guidance, owner updates.
- Missing: the eight stack/design research reports (S00 is producing them) and **`research/characters/<slug>/soul.md` + refs** (the per-character research layer the brief says exists was not provided to this repo). Handling: S04 defines the soul.md schema, a validator and a roster manifest; the roster is data and is loaded when supplied (Q-19 in `spec/99-open-questions.md`).

## Gated decisions (asked once; proceeding on defaults because this run is unattended)
| ID | Question | Default applied | Date |
|---|---|---|---|
| G1 | Supabase vs Convex | **Supabase Pro `us-west-1`**; Durable Objects for rooms and presence; Convex documented alternative (switch cost 5–7 sessions) — spec/03 D-02 | 2026-10-18 |
| G2 | Likeness tier per named real person | living people `parody`; Mac Dre and founders of real companies `fictionalized`; `consented` only with a consent record — spec/03 D-29 | 2026-10-18 |
| G3 | GenAI monthly ceiling and per-player quotas | $500/month recurring ($350 Anthropic, $100 voice, $25 moderation, $25 buffer); $1,000 one-off fal production credit; quotas and governor per research/INDEX §7 | 2026-10-18 |

## Owner decisions applied as defaults (override with `/architect fix: <what>`)
| Q | Question | Default | Why |
|---|---|---|---|
| Q-01 | Public title | "Dee-Verse: Tha Bay" (no "GTA" shipped) | Take-Two holds live GTA marks; product titles get no parody shield [research/legal-ip-likeness.md] |
| Q-02 | Terms eligibility | 18+ terms, 17+ content | fal and Anthropic end-user terms [research/gap-trust-safety-tooling.md] |
| Q-03 | MiniMax H3 not cleared in time | fallback chain in `config/genai-endpoints.json` | H3 licence excludes the US [research/gap-video-model-licence-clearance.md] |
| Q-06 | Content tone | no firearms or gore; sideshows allowed | likeness and rating risk [research/gamedesign-decomposition.md] |
| Q-07 | Campaign premise | *Hella Valuation* (Premise A) | SF-only Act 1 [research/gamedesign-decomposition.md] |
| Q-10 | Device floor | iPhone 15 at `mobile-low` 30 fps; Quest 3/3S; Vision Pro on visionOS 26.2+ | [research/stack-rendering-platform.md] |
| Q-11 | Music | commissioned originals; no artist recordings | sync licensing [research/legal-ip-likeness.md] |
| Q-12 | Hero voices | Aura tier; ElevenLabs Flash for ≤ 3 heroes, 18+ only; no real-voice clones | vendor policies [research/ai-npc-runtime.md] |

Wave 1 added owner questions Q-13…Q-19 (devices, fal cap vs fallback provider, domains, T&S filings, `FAL_KEY` holder, counsel reading, missing character research layer) with defaults in `spec/99-open-questions.md`.

## Wave 1 result (2026-10-18)
- **Frozen at 1.0:** C01–C06 (S01), C07 (S05), C11, C12, C16 (S09), C13 (S11), C15 (format). **Sketches aligned, owner finalizes:** C08, C09, C10 (Wave 2), C14, C17 (Wave 4). No new contract ids; Wave 1 interfaces were folded into C06, C07, C12 and C13 (06 §4.1 rule 5).
- **Reconciliation:** 50 conflicts resolved (DL-001…DL-050) with minimal edits in all 13 domain files. 25 of the 29 Wave 1 `decisions_needed` settled; the other 4 (Q-S11-01, DN-S05-2, Q-BE-07, Q-BE-08) moved to the owner, and DN-S05-4 was settled as a policy with its named holder moved. Owner questions are Q-13…Q-19 in `spec/99`, and 66 UNVERIFIED items are registered there with defaults.
- **Re-run notes:** no re-run needed. All four specs are complete, carry return blocks, and contradicted a contract only where the decision log fixed it.
  - Size watch: `01-engine.md` (≈ 5,990 words) and `11-platform.md` (≈ 5,970) sit at the 6,000-word cap. Any further amendment must move a section into the existing part files.
  - Milestones estimated at ≥ 2 sessions must be split by a digit suffix in Wave 5 (C15): M01a, M01b, M04a, M05b, M10a, M11a, M11b, M12b, M12c, M14b. M00 (≈ 1.5 sessions) may split off an `M00a` edge-API skeleton.
- **Wave 2–4 briefs must cite:** 06 v1.0 §4.2–4.4 and §5 (names, scripts, storage, units), the decision log, and `spec/02-architecture.md` §7.

## Milestone register (after Wave 1; ids per DL-037; final files in Wave 5)
| ID | Slug | Domains | Est. sessions |
|---|---|---|---|
| M00 | bootstrap-ci-pwa-on-workers | S09, S11, S13 | 1.5 |
| M00b | ip-provenance-gates | S05 | 1 |
| M00c | genai-spike (≤ $40) | S05 | 1 |
| M01a | loop-ecs-detmath-physics | S01 | 1–2 |
| M01b | controller-cameras-touch | S01 | 1–2 |
| M01c | device-spike-renderer-host | S11 | 1 |
| M01d | assets-publish (catalog, lock, publish CLI) | S05 | 1 |
| M01e | asset-worker-opfs-store | S11 | 1 |
| M02a–c | SF bake · streaming/LOD/weather · graphs, maps, teleports | S02 (+ S01, S11) | Wave 2 |
| M03a | vehicles-interaction-prefabs | S01 (+ S06 handling) | 1 |
| M03b | traffic-peds | S02 (+ S01) | Wave 2 |
| M03c | pursuit-director | S01 | 1 |
| M04a | saves-gamemode-unlocks | S01 | 1–2 |
| M04b | menus-identity-creator | S10, S09 | Wave 4 (+ 0.5 S09) |
| M04c | cutscene-playback-spike | S11, S03 | 1 |
| M05a | mission-ir-autoplayer-director | S03 (+ S01) | Wave 2 |
| M05b | cutscene-pipeline-mock | S09, S05, S03 | 1–2 |
| M05c | act1-vertical-slice | S03 | Wave 2 |
| M05d | data-spine-supabase | S09 | 1 |
| M06a / M06b | npc-dialogue-proxy-quotas / npc-builder-moderation | S04, S09 (+ S10) | 1 + Wave 2 each |
| M07a–b | racing | S06 | Wave 3 |
| M08a–c | fighter (+ S05 retarget bake), roster, pose | S07 | Wave 3 |
| M09a–b | tycoon | S08 | Wave 3 |
| M10a / M10b | roster-pipeline / qa-gates-kill-drill | S05 | 2 / 1 |
| M11a | iphone-hardening-governor | S11 | 2 |
| M11b1 / M11b2 | webxr-port / per-mode XR + XR cutscenes | S11 (+ S06–S08) | 1 / 1 |
| M12a | p1-identity-cloud-saves | S09 | 1 |
| M12b | rooms-core-protocol-v2 | S09 (+ S01) | 2 |
| M12c | rooms-hardening-presence-loadtest | S09 | 2 |
| M13a | mod-sdk-experiences | S12 | Wave 4 |
| M13b | forum-reports-backend | S09 (+ S10) | 1 |
| M13c | device-code-publish-login | S12, S09 | 0.5 + Wave 4 |
| M13d | legal-trust-safety-backend | S09 | 1 |
| M14a | thirdweb-siwe-link | S09 | 1 |
| M14b | launch-hardening-guardrails | S09, S05, S13 | 2 |
| M15+ | bay-districts | S02 | later |

## Critic log
| Date | Lens | Blocking | Major | Minor | Notes |
|---|---|---|---|---|---|

## Definition of Done (03-SPEC-TEMPLATE §H)
Not yet evaluated.

# 00 — Plan and status (living)

Architect: Claude Opus 5.5 (`claude-opus-5-5`). Started 2026-10-18. Shared context: `prompt-pack/06-SHARED-CONTEXT.md` **v1.2, frozen, all 17 contracts final** (2026-10-18, after the Wave 5 milestone reconciliation; v1.1 after Waves 2–4, v1.0 the Wave 1 freeze). Binding decisions: `spec/03-decisions-and-facts.md` v2 plus `spec/11-decision-log.md` (DL-001…DL-170) and `spec/11-decision-log-2.md` (DL-171…DL-244, DL-OWN-01/02). Architecture: `spec/02-architecture.md` v0.5. Open questions: `spec/99-open-questions.md` (Q-13…Q-25).

## Phase status
| Phase | Subagents | Status | Output |
|---|---|---|---|
| 0 Ingest + research | S00 × 8 dimensions, completeness critic, S00 × 5 gap reports, S00 INDEX | **done** 2026-10-18 | 13 reports + `research/INDEX.md` |
| 1 Contracts | S01 engine · S09 backend · S11 platform · S05 assets | **done** 2026-10-18 | `spec/domains/01*`, `05*`, `09*`, `11*`; 06 v1.0 frozen; DL-001…DL-076 |
| 2 World + content | S02 world · S03 story · S04 NPC | **done** 2026-10-18 | `spec/domains/02-world*.md` (5 files), `03-story*.md` (4), `04-npc*.md` (3); C08, C09, C10 final |
| 3 Modes | S06 racing · S07 fighter · S08 tycoon | **done** 2026-10-18 | `spec/domains/06-racing*.md` (3), `07-fighter*.md` (4), `08-tycoon*.md` (3) |
| 4 Shell + UGC | S10 UI · S12 modding | **done** 2026-10-18 | `spec/domains/10-ui*.md` (3), `12-modding*.md` (3); C14, C17 final |
| Reconciliation 2 | Architect | **done** 2026-10-18 | 06 **v1.1**; DL-077…DL-156; Q-20…Q-25; register below; `02-architecture.md` v0.5 |
| 5 Integration | S13 + integration authors | **in progress** 2026-10-18: integration files, ADRs and all 115 milestone files written | `spec/01–12, 99`, milestone files (C15), ADRs, CLAUDE.md, AGENTS.md, kickoff |
| Reconciliation 3 | Architect | **done** 2026-10-18 | milestone-author defects resolved (`spec/.milestone-defects.md`); 06 **v1.2** (C05 1.2, C10 1.1, C12 1.2, C15 1.1, C16 1.2); DL-218…DL-244; mechanical sweep 65 → 0 findings |
| Verification | critics: executability · factual · scope | pending | critic log below |

## Inputs found at start
- Present: `prompt-pack/` (pack v1), `research/` repo analyses (webport, world, grand-v), Anthropic model facts, Claude Code deployment, prompting guidance, owner updates.
- Missing: **`research/characters/<slug>/soul.md` + refs** (the per-character research layer). S04 defined the soul schema, validator and roster manifest; the roster loads when supplied (Q-19), from the private `content-private/` mount (Q-25).

## Gated decisions (asked once; proceeding on defaults because this run is unattended)
| ID | Question | Default applied | Date |
|---|---|---|---|
| G1 | Supabase vs Convex | **Supabase Pro `us-west-1`**; Durable Objects for rooms and presence; Convex documented alternative — spec/03 D-02 | 2026-10-18 |
| G2 | Likeness tier per named real person | living people `parody`; Mac Dre and founders of real companies `fictionalized`; `consented` only with a consent record — D-29 | 2026-10-18 |
| G3 | GenAI monthly ceiling and per-player quotas | $500/month recurring; **fal.ai hard cap $100 total** (owner, DL-OWN-01): spike $10 · characters $42 · cutscenes $40 · buffer $8; no player-triggered fal in v1 | 2026-10-18 |

## Owner decisions applied as defaults (override with `/architect fix: <what>`)
| Q | Question | Default | Why |
|---|---|---|---|
| Q-01 | Public title | "Dee-Verse: Tha Bay" (no "GTA" shipped) | live GTA marks [research/legal-ip-likeness.md] |
| Q-02 | Terms eligibility | 18+ terms, 17+ content; every under-18 bracket blocked in v1 (DL-139) | vendor end-user terms [research/gap-trust-safety-tooling.md] |
| Q-03 | MiniMax H3 not cleared in time | fallback chain in `config/genai-endpoints.json` | US licence gap [research/gap-video-model-licence-clearance.md] |
| Q-06 | Content tone | no firearms or gore; sideshows allowed | likeness and rating risk [research/gamedesign-decomposition.md] |
| Q-07 | Campaign premise | *Hella Valuation* (Premise A) | SF-only Act 1 |
| Q-10 | Device floor | iPhone 15 at `mobile-low` 30 fps; Quest 3/3S; Vision Pro on visionOS 26.2+ | [research/stack-rendering-platform.md] |
| Q-11 | Music | commissioned originals only | sync licensing |
| Q-12 | Hero voices | Aura tier; ElevenLabs Flash for ≤ 3 heroes only if Q-20 raises the voice ceiling; no real-voice clones | vendor policies |

Owner questions Q-13…Q-19 (Wave 1) and **Q-20…Q-25** (Waves 2–4: voice ceiling, sensitivity read, npm publication, counsel list, animation staffing, private content repo) carry defaults in `spec/99-open-questions.md`.

## Waves 2–4 result (2026-10-18)
- **All 17 contracts are final** (06 v1.1). Finalized by their owners and accepted with Architect edits: C08 (S02), C09 (S03), C10 (S04), C14 and C17 (S12), all 1.0.0. Additive minor bumps: C02, C03, C04, C05, C06, C07, C12, C13, C16 → 1.1; C01, C11, C15 unchanged. No breaking change, so no major bump.
- **Reconciliation:** 17 contract conflicts resolved (DL-077…DL-093), 11 contract-bump or deferral rows (DL-094…DL-104), 50 `decisions_needed` settled (DL-105…DL-154), five moved to the owner and one owner action opened (Q-20…Q-25). Notable: one owner per id type (C08 `LatLng`, `ChunkKey`, places; C10 `NpcId`; C14 `ModId`); `playSequence` for mixed fight intros; mission talk uses existing C10 fields; tycoon numbers are sim-computed `deals`; `AnimStateId` 128–159 racing, 160–207 fighter, 208–255 tycoon; under-18 blocked; New Game = new save profile; XR text entry flat-only; telemetry default on.
- **Re-run notes:** none needed. All eight domains returned complete specs with return blocks; contradictions were fixed by minimal edits in the domain files.
- **Size watch:** `01-engine.md`, `11-platform.md`, `09-backend-contracts.md` and `spec/11-decision-log.md` sit at the 6,000-word cap. 1.1 additions went to part files (`09-backend-contracts-1.1.md`, `11-platform-pwa.md` §11, ends of `01-engine-contracts.md` and `01-engine-save-modes.md`, `05-assets-pipeline.md` §14). Wave 5 continues the decision log in a new part file.
- **UNVERIFIED:** Wave 2–4 items (85) are indexed in `spec/99-open-questions.md` §3; Wave 5 merges them into §2 rows.

## Milestone register (after the Wave 5 reconciliation; ids per DL-037 and DL-212, run order and dependencies in `spec/07-milestones/_PLAN.md`)

115 milestones: 108 for v1 (≈ 100.4 sessions) plus 7 Bay-expansion milestones (7 sessions, one each; DL-242). Split families keep their scope letter and gain digits (M01a1/2, M01b1/2, M04a1/2, M10a1/2, M11a1/2, M11b2 + M11b4, M12b1/2, M12c1/2, M14b1/2/3); M00d and M04d are the QA milestones of DL-212. A family id without its digit (for example M12a or M13b) names the whole scope in older text.

| ID | Slug | Domains | Sessions |
|---|---|---|---|
| M00 | bootstrap-ci-pwa-on-workers | S11, S13, S10 | 1 |
| M00a | edge-api-skeleton | S09 | 0.8 |
| M00b | ip-provenance-gates | S05 | 1 |
| M00c | genai-spike | S05 | 1 |
| M01a1 | loop-ecs-detmath-physics | S01 | 1 |
| M01a2 | loop-ecs-detmath-physics | S01 | 1 |
| M01b1 | controller-cameras-touch | S01 | 1 |
| M01b2 | controller-cameras-touch | S01 | 1 |
| M01c | device-spike-renderer-host | S11 | 1 |
| M01d | assets-publish | S05 | 1 |
| M01e | asset-worker-opfs-store | S11 | 1 |
| M01f | world-graybox-fixture-codec | S02 | 0.5 |
| M00d | qa-spec-gates | S13 | 0.5 |
| M02a1 | bake-core | S02 | 1 |
| M02a2 | bake-roads-graph | S02 | 1 |
| M02b1 | streaming-lod | S02 (+S11) | 1 |
| M02b2 | weather-time | S02 (+S01) | 1 |
| M02c1 | graph-services-teleports | S02 | 1 |
| M02d1 | landmarks-kit-and-heroes | S02 | 1 |
| M02d2 | landmarks-rest-and-swap | S02 | 1 |
| M03a1 | vehicles-interaction-prefabs | S01 | 1 |
| M03a2 | handling-model-wheel-spike | S06 (+S01) | 0.5 |
| M03b1 | traffic-robotaxis | S02 | 1 |
| M03b2 | peds-transit | S02 | 1 |
| M03c | pursuit-director | S01 | 1 |
| M04a1 | saves-gamemode-unlocks | S01 | 1 |
| M04a2 | saves-gamemode-unlocks | S01 | 1 |
| M04b1 | shell-ui-kit-menus-settings | S10 | 1 |
| M04b2 | creator-phone-hud-kit | S10 (+S05 creator kit) | 1 |
| M02c2 | maps | S02 (+S10) | 1 |
| M04b3 | local-identity-play-token | S09 | 0.5 |
| M04c | cutscene-playback-spike | S11, S03, S10 | 1 |
| M04d | qa-harness-bots-goldens | S13 (+S01 econ-sim) | 1 |
| M05a1 | mission-ir-vm | S03 | 1 |
| M05a2 | autoplayer-director-preview | S03 | 1 |
| M05b1 | cutscene-infra-mock | S09, S05 | 1 |
| M05b2 | cutscene-player-index | S03 | 1 |
| M05c1 | act1-missions-1-6 | S03 | 1 |
| M05c2 | act1-vertical-slice | S03 | 1 |
| M05d | data-spine-supabase | S09 | 1 |
| M05c3 | act1-prewarm | S05 | 0.7 |
| M06a1 | npc-backend-spine | S09 (+S04) | 1 |
| M06a2 | soul-contract-compiler | S04 | 1 |
| M06a3 | dialogue-proxy | S04, S09 | 1 |
| M06a4 | memory-voice-lipsync | S04 | 1 |
| M06a5 | dialogue-panel-ui | S10 | 0.3 |
| M06c | npc-agency-barks | S04 | 1 |
| M06b1 | builder-text-private | S04 | 1 |
| M07a1 | racing-core-director-car | S06 | 1 |
| M07a2 | racing-ai-replay-ghosts | S06 | 1 |
| M07b1 | racing-content-events-ladder | S06 | 1 |
| M07b2 | racing-garage-replay-photo-visuals | S06 | 1 |
| M08a1 | fight-core-sim-data | S07 | 1 |
| M08a2 | fight-mode-training-vs | S07 | 1 |
| M08b1 | fight-roster-kits-ai | S07 | 1 |
| M08b2 | fight-stages-cutscenes-arcade | S07 | 1 |
| M08c1 | pose-pipeline-classifier | S07 | 1 |
| M08c2 | pose-calibration-gate | S07 | 1 |
| M09a1 | tycoon-core-finance | S08 | 1 |
| M09a2 | tycoon-events-balance | S08 | 1 |
| M09b1 | tycoon-ui | S08 | 1 |
| M09b2 | tycoon-vc-story | S08 | 1 |
| M10a1 | roster-pipeline | S05, S07 | 1 |
| M10a2 | roster-pipeline | S05, S07 | 1 |
| M10b | qa-gates-kill-drill | S05 | 1 |
| M10c | roster-souls-ink-barks | S04 | 1 |
| M05e1 | story-act2-part1 | S03 (+S08) | 1 |
| M05e2 | story-act2-part2 | S03 | 1 |
| M05f1 | story-act3-part1 | S03 | 1 |
| M05f2 | story-act3-finale | S03 | 1 |
| M11a1 | iphone-hardening-governor | S11 (+S06) | 1 |
| M11a2 | iphone-hardening-governor | S11 (+S06) | 1 |
| M11b1 | webxr-port | S11 | 1 |
| M11b3 | xr-ui-panels-comfort | S10 | 0.8 |
| M11b2 | per-mode-xr-and-xr-cutscenes | S11, S06, S07, S10 | 0.7 |
| M11b4 | per-mode-xr-and-xr-cutscenes | S11, S03, S08 | 0.7 |
| M12a1 | p1-identity-cloud-saves | S09 | 1 |
| M12a2 | age-register-cloud-save-ui | S10 | 0.5 |
| M06b2 | builder-images-review | S04, S09 | 1 |
| M06b3 | npc-builder-ui | S10 | 1 |
| M12b1 | rooms-core-protocol-v2 | S09 (+S01) | 1 |
| M12b2 | rooms-core-protocol-v2 | S09 (+S01) | 1 |
| M12c1 | rooms-hardening-presence-loadtest | S09 | 1 |
| M12c2 | rooms-hardening-presence-loadtest | S09 | 1 |
| M12d | online-page-invites | S10 | 0.3 |
| M12e | mode-leaderboards | S06, S08 | 1 |
| M13a1 | mod-sdk-manifest-validators | S12 | 1 |
| M13a2 | mod-installer-store-client | S12 (+S09) | 1 |
| M13a3 | mod-runtime-data-experience | S12 | 1 |
| M13a4 | mod-script-sandbox | S12 | 1 |
| M13a5 | mod-ui-tier | S12 | 1 |
| M13a6 | mod-agent-kit | S12 | 1 |
| M13a7 | store-experience-pages | S10, S06 | 0.7 |
| M13b1 | forum-reports-backend | S09 | 1 |
| M13b2 | forum-ugc-links | S12, S02 | 0.8 |
| M13b3 | creator-place-mode | S12 (+S10) | 1 |
| M13b4 | forum-ui | S10 | 1 |
| M13c1 | device-code-publish-login | S09, S10 | 0.8 |
| M13c2 | publish-pipeline-server | S12 | 1 |
| M13c3 | publish-cli-link | S12 | 1 |
| M06b4 | builder-publish-assets | S04 (+S05) | 0.5 |
| M13d1 | legal-trust-safety-backend | S09 | 1 |
| M13d2 | legal-forms-ui | S10 | 0.3 |
| M14c | a11y-audit-i18n-gate | S10 | 0.5 |
| M14b1 | launch-hardening-guardrails | S09, S05, S13 (+S06) | 1 |
| M14b2 | launch-hardening-guardrails | S09, S05, S13 (+S06) | 1 |
| M14b3 | launch-hardening-guardrails | S09, S05, S13 (+S06) | 1 |
| M14a | thirdweb-siwe-link | S09 (+S10) | 1 |
| M15a | bay-expansion-framework | S02 | 1 |
| M15b | oakland-core | S02 | 1 |
| M15c | berkeley-richmond | S02 | 1 |
| M15d | marin-gateway | S02 | 1 |
| M15e | peninsula-north | S02 | 1 |
| M15f | peninsula-vc-row | S02 | 1 |
| M15g | south-bay-san-jose | S02 | 1 |

**Sessions:** every id is one session or less (C15 L7); the families above one session were split in Wave 5 (DL-212) and M15a–M15g are fitted to one session each (DL-242). **Ordering anchors:** R-ROLL-01 single-player first: no rooms milestone (M12b onward) starts before the hosted story slice M05c2 is shipped and tested on Cloudflare; A-06 vertical slice = M05c2 with racing, fighter and tycoon reachable through stubs; VS-Racing = M07a2, VS-Fighter = M08a2, VS-Tycoon = M09a2.

## Critic log
| Date | Lens | Blocking | Major | Minor | Notes |
|---|---|---|---|---|---|

## Definition of Done (03-SPEC-TEMPLATE §H)
Not yet evaluated.

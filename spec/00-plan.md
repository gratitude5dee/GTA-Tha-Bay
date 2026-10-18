# 00 — Plan and status (living)

Architect: Claude Opus 5.5 (`claude-opus-5-5`). Started 2026-10-18. Shared context: `prompt-pack/06-SHARED-CONTEXT.md` v0.95 (research amendments; freezes to v1.0 after Wave 1). Binding decisions: `spec/03-decisions-and-facts.md` v0.

## Phase status
| Phase | Subagents | Status | Output |
|---|---|---|---|
| 0 Ingest + research | S00 × 8 dimensions, completeness critic, S00 × 5 gap reports, S00 INDEX | **done** 2026-10-18 | 13 new reports + `research/INDEX.md` (30 decisions, F-ledger, constraints, milestones, costs) |
| 1 Contracts | S01 engine · S09 backend · S11 platform · S05 assets | running | `spec/domains/01,09,11,05`, 06 v1.0, `spec/02-architecture.md` v0 |
| 2 World + content | S02 world · S03 story · S04 NPC | pending | `spec/domains/02,03,04` |
| 3 Modes | S06 racing · S07 fighter · S08 tycoon | pending | `spec/domains/06,07,08` |
| 4 Shell + UGC | S10 UI · S12 modding | pending | `spec/domains/10,12` |
| 5 Integration | S13 + integration authors | pending | `spec/01–12, 99`, milestones, ADRs, CLAUDE.md, AGENTS.md, kickoff |
| Verification | critics: executability · factual · scope | pending | critic log below |

## Inputs found at start
- Present: `prompt-pack/` (pack v1), `research/` repo analyses (webport, world, grand-v), Anthropic model facts, Claude Code deployment, prompting guidance, owner updates.
- Missing: the eight stack/design research reports (S00 is producing them) and **`research/characters/<slug>/soul.md` + refs** (the per-character research layer the brief says exists was not provided to this repo). Handling: S04 defines the soul.md schema, a validator and a roster manifest; the roster is data and is loaded when supplied (Q-01).

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

## Critic log
| Date | Lens | Blocking | Major | Minor | Notes |
|---|---|---|---|---|---|

## Definition of Done (03-SPEC-TEMPLATE §H)
Not yet evaluated.

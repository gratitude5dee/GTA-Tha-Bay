# 00 — Plan and status (living)

Architect: Claude Opus 5.5 (`claude-opus-5-5`). Started 2026-10-18. Shared context: `prompt-pack/06-SHARED-CONTEXT.md` v0.9 (freezes to v1.0 after Wave 1).

## Phase status
| Phase | Subagents | Status | Output |
|---|---|---|---|
| 0 Ingest + research | S00 × 8 dimensions, S00 INDEX | running | `research/*.md`, `research/INDEX.md` |
| 1 Contracts | S01 engine · S09 backend · S11 platform · S05 assets | pending | `spec/domains/01,09,11,05`, 06 v1.0, `spec/02-architecture.md` v0 |
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
| G1 | Supabase vs Convex | pending Phase 0 decision matrix (default Supabase + Durable Objects for rooms) | 2026-10-18 |
| G2 | Likeness tier per named real person | `parody` for every named person until consent is recorded | 2026-10-18 |
| G3 | GenAI monthly ceiling and per-player quotas | pending Phase 0 cost model | 2026-10-18 |

## Critic log
| Date | Lens | Blocking | Major | Minor | Notes |
|---|---|---|---|---|---|

## Definition of Done (03-SPEC-TEMPLATE §H)
Not yet evaluated.

# 00 — Plan and status (living)

Architect: Claude Opus 5.5 (`claude-opus-5-5`). Started 2026-10-18. Shared context: `prompt-pack/06-SHARED-CONTEXT.md` **v1.2, frozen, all 17 contracts final** (2026-10-18, after the Wave 5 milestone reconciliation; v1.1 after Waves 2–4, v1.0 the Wave 1 freeze). Binding decisions: `spec/03-decisions-and-facts.md` v2 plus `spec/11-decision-log.md` (DL-001…DL-076), `spec/11-decision-log-1b.md` (DL-077…DL-170, DL-OWN-01/02), `spec/11-decision-log-2.md` (DL-171…DL-217, DL-245…DL-248), `spec/11-decision-log-3.md` (DL-218…DL-244), `spec/11-decision-log-4.md` (DL-249…DL-451; split DL-341), `spec/11-decision-log-4b.md` (DL-460…DL-493; split DL-530), `spec/11-decision-log-5.md` (DL-500 onward; owner updates 2026-10-19: DL-OWN-03, DL-OWN-04, D-31, D-32), `spec/11-decision-log-5b.md` (DL-518…DL-524, owner-update critic fixes), and Builder rows (BD-NNN) in `spec/11-decision-log-builder.md`. Architecture: `spec/02-architecture.md` **v1**. Open questions: `spec/99-open-questions.md` (Q-13…Q-41) and `spec/99-open-questions-2.md` (Q-42 onward, U-ACCT-*).

## Phase status
| Phase | Subagents | Status | Output |
|---|---|---|---|
| 0 Ingest + research | S00 × 8 dimensions, completeness critic, S00 × 5 gap reports, S00 INDEX | **done** 2026-10-18 | 13 reports + `research/INDEX.md` |
| 1 Contracts | S01 engine · S09 backend · S11 platform · S05 assets | **done** 2026-10-18 | `spec/domains/01*`, `05*`, `09*`, `11*`; 06 v1.0 frozen; DL-001…DL-076 |
| 2 World + content | S02 world · S03 story · S04 NPC | **done** 2026-10-18 | `spec/domains/02-world*.md` (5 files), `03-story*.md` (4), `04-npc*.md` (3); C08, C09, C10 final |
| 3 Modes | S06 racing · S07 fighter · S08 tycoon | **done** 2026-10-18 | `spec/domains/06-racing*.md` (3), `07-fighter*.md` (4), `08-tycoon*.md` (3) |
| 4 Shell + UGC | S10 UI · S12 modding | **done** 2026-10-18 | `spec/domains/10-ui*.md` (3), `12-modding*.md` (3); C14, C17 final |
| Reconciliation 2 | Architect | **done** 2026-10-18 | 06 **v1.1**; DL-077…DL-156; Q-20…Q-25; milestone register (now `_PLAN.md`); `02-architecture.md` v0.5 |
| 5 Integration | S13 + integration authors | **done** 2026-10-18 | `spec/01–12, 99`, 115 milestone files (C15), ADRs, CLAUDE.md, AGENTS.md, kickoff |
| Reconciliation 3 | Architect | **done** 2026-10-18 | milestone-author defects resolved (`spec/.milestone-defects.md`); 06 **v1.2** (C05 1.2, C10 1.1, C12 1.2, C15 1.1, C16 1.2); DL-218…DL-244; mechanical sweep 65 → 0 findings |
| Handoff | Architect | **done** 2026-10-18 | all 115 milestone files READY (12 fast-track frozen, M00 executing); full kickoff list; `02-architecture.md` v1; DL-245…DL-247 |
| Verification | critics: executability · factual · scope | **in progress (round 4)**; then per block, at the `_PLAN.md` §3 checkpoints, before each block's first milestone starts | critic log below |

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
| DL-OWN-03 | Reuse from the example repositories (2026-10-19) | narrowed to what the licences allow: register `docs/legal/third-party-reuse.json`; Atlas and a universal-modder subset vendored by operator or Architect; Mapbox CLI dev-time only pending Q-44 | ADR-REUSE-01, D-31 |
| DL-OWN-04 | Owner-merged PR #1: password accounts on Supabase Auth (2026-10-19) | accepted as a credential beside the spine; interim stop until the follow-ups land (Q-43) | ADR-ACCT-01, D-32 |

Owner questions Q-13…Q-19 (Wave 1) and **Q-20…Q-25** (Waves 2–4: voice ceiling, sensitivity read, npm publication, counsel list, animation staffing, private content repo) carry defaults in `spec/99-open-questions.md`.

## Waves 2–4 result (2026-10-18)
- **All 17 contracts are final** (06 v1.1). Finalized by their owners and accepted with Architect edits: C08 (S02), C09 (S03), C10 (S04), C14 and C17 (S12), all 1.0.0. Additive minor bumps: C02, C03, C04, C05, C06, C07, C12, C13, C16 → 1.1; C01, C11, C15 unchanged. No breaking change, so no major bump.
- **Reconciliation:** 17 contract conflicts resolved (DL-077…DL-093), 11 contract-bump or deferral rows (DL-094…DL-104), 50 `decisions_needed` settled (DL-105…DL-154), five moved to the owner and one owner action opened (Q-20…Q-25). Notable: one owner per id type (C08 `LatLng`, `ChunkKey`, places; C10 `NpcId`; C14 `ModId`); `playSequence` for mixed fight intros; mission talk uses existing C10 fields; tycoon numbers are sim-computed `deals`; `AnimStateId` 128–159 racing, 160–207 fighter, 208–255 tycoon; under-18 blocked; New Game = new save profile; XR text entry flat-only; telemetry default on.
- **Re-run notes:** none needed. All eight domains returned complete specs with return blocks; contradictions were fixed by minimal edits in the domain files.
- **Size watch:** `01-engine.md`, `11-platform.md`, `09-backend-contracts.md` and `spec/11-decision-log.md` sit at the 6,000-word cap. 1.1 additions went to part files (`09-backend-contracts-1.1.md`, `11-platform-pwa.md` §11, ends of `01-engine-contracts.md` and `01-engine-save-modes.md`, `05-assets-pipeline.md` §14). Wave 5 continues the decision log in a new part file.
- **UNVERIFIED:** Wave 2–4 items (85) are indexed in `spec/99-open-questions.md` §3; Wave 5 merges them into §2 rows.

## Milestones (register: `spec/07-milestones/_PLAN.md`)

The run order, dependencies, critical path and checkpoints are in `spec/07-milestones/_PLAN.md` §1–§3 (rows in `_PLAN-1/2/3.md`); file status is in `spec/07-milestones/README.md`; the Builder's list with gates is in `prompt-pack/04-SONNET-KICKOFF.md` `<milestones>`. Totals: **119 milestone files, all READY** — 112 for v1 (≈ 104.9 sessions, M00 … M14a; M10d1–M10d2 art integration added by DL-390, M10d3 player cars and fight stages by DL-460, M10e audio integration by DL-500) plus 7 post-v1 Bay-expansion milestones (M15a–M15g, one session each; DL-242) = 111.9 sessions. Every id is one session or less (C15 L7). Critical path 29.8 sessions to M14a, 33.8 to M15g (DL-219, DL-348, DL-552). Ordering anchors: R-ROLL-01 (no rooms milestone, M12b1 onward, before M05c2 is deployed to staging with its ACs passing); A-06 vertical slice = M05c2; VS-Racing M07a2, VS-Fighter M08a2, VS-Tycoon M09a2; launch gate M14b3; M14a (Thirdweb) last v1 milestone (R-AUTH-02).

## Start the Builder

Exact command to start the Builder on M00, from the repository root (a Builder is already executing M00); later milestones use the same command with their file stem, and `--effort high` for M01/M02/M05/M06/M12 ids [research/claude-code-deployment.md §4]:

```bash
claude -p "$(sed -n '/^<builder_prompt/,/^<\/builder_prompt>/p' prompt-pack/04-SONNET-KICKOFF.md | sed 's/<<MILESTONE>>/M00-bootstrap-ci-pwa-on-workers/g')" \
  --model claude-sonnet-5-5 --effort medium --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Write,Edit,Bash" --output-format stream-json --verbose
```

Operator prerequisites, the interactive alternative and `--resume` after a usage-limit failure are in `prompt-pack/04-SONNET-KICKOFF.md`.

**Next session (`_PLAN.md` §0 rule 7; milestones already executing merge as before):** the owner PR #1 follow-ups in `spec/followups/owner-pr1.md`, started with the command in that file (`--effort high`). Then the reuse gates in `spec/followups/reuse-gates.md` (`_PLAN.md` §0 rule 8: before the first vendoring PR, a gate for no milestone), started with the command in that file.

**Parallel Builders (DL-246):** one git worktree and one branch `m<id>-<slug>` per milestone (`git worktree add .claude/worktrees/m<id>-<slug> -b m<id>-<slug>`); a milestone starts only when every milestone in its Depends on is merged to the default branch; PRs merge in run order (`_PLAN.md` §1), each rebased and re-proved first; deploys run only from the default branch.

## Critic log
| Date | Lens | Blocking | Major | Minor | Notes |
|---|---|---|---|---|---|
| 2026-10-18 | executability | 2 | 12 | n/r | pass 1, full set; DL-249, DL-250, DL-281…DL-284, DL-287, DL-290, DL-291, DL-294, DL-297…DL-300 |
| 2026-10-18 | factual | 1 | 3 | n/r | pass 1, full set; DL-251, DL-286, DL-288, DL-293 |
| 2026-10-18 | scope | 1 | 6 | n/r | pass 1, full set; DL-252, DL-285, DL-289, DL-292, DL-295, DL-296, DL-301 |
| 2026-10-19 | executability | 1 | 0 | n/r | pass 2; DL-341 |
| 2026-10-19 | factual | 1 | 1 | n/r | pass 2; DL-340, DL-343 |
| 2026-10-19 | scope | 0 | 1 | n/r | pass 2; DL-342 |
| 2026-10-19 | executability | 1 | 1 | n/r | pass 3; DL-344, DL-346 |
| 2026-10-19 | factual | 0 | 1 | n/r | pass 3; DL-345 |
| 2026-10-19 | scope | 0 | 1 | n/r | pass 3; DL-347 |
| 2026-10-19 | executability | 0 | 2 | n/r | pass 4, in progress; DL-348, DL-421 |
| 2026-10-19 | factual | 0 | 0 | n/r | pass 4, in progress |
| 2026-10-19 | scope | 0 | 6 | n/r | pass 4, in progress; DL-349, DL-350, DL-390, DL-391, DL-420, DL-500 |

Counts are the fixes logged in `spec/11-decision-log-4.md`, `-4b.md` and `-5.md`, one per DL entry: "blocking" as the entry states it, every other logged fix major; the lens is the Architect's attribution where the block heading omits it. Minors were fixed in place without a DL entry (n/r: not recorded). §H.5 (two consecutive zero-blocking passes per lens) is not yet met.

## Definition of Done (03-SPEC-TEMPLATE §H)
Not yet evaluated.

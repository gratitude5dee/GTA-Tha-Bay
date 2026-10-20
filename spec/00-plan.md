# 00 — Plan and status (living)

Architect: Claude Opus 5.5 (`claude-opus-5-5`). Started 2026-10-18. Shared context: `prompt-pack/06-SHARED-CONTEXT.md` **v1.3, frozen, all 17 contracts final** (2026-10-19, additive C12 1.3 for the owner's password accounts, DL-604; v1.2 2026-10-18 after the Wave 5 milestone reconciliation, v1.1 after Waves 2–4, v1.0 the Wave 1 freeze). Binding decisions: `spec/03-decisions-and-facts.md` v2 plus `spec/11-decision-log.md` (DL-001…DL-076), `spec/11-decision-log-1b.md` (DL-077…DL-170, DL-OWN-01/02), `spec/11-decision-log-2.md` (DL-171…DL-217, DL-245…DL-248), `spec/11-decision-log-3.md` (DL-218…DL-244), `spec/11-decision-log-4.md` (DL-249…DL-451; split DL-341), `spec/11-decision-log-4b.md` (DL-460…DL-493; split DL-530), `spec/11-decision-log-5.md` (DL-500, DL-530…DL-559, DL-690…DL-694), `spec/11-decision-log-5b.md` (owner updates 2026-10-19: DL-OWN-03, DL-OWN-04, D-31, D-32, DL-501…DL-517 moved from part 5 by DL-608; critic fixes DL-518…DL-524), `spec/11-decision-log-5c.md` (DL-600…DL-645: Architect decisions on the owner updates, M00e and M00f), `spec/11-decision-log-5d.md` (DL-646…DL-649), `spec/11-decision-log-6.md` (DL-650…DL-660, DL-665…DL-677, DL-680…DL-689, DL-695…DL-701), `spec/11-decision-log-7.md` (DL-661…DL-664, DL-678, DL-679; part 2 rows of DL-654, DL-656, DL-687), `spec/11-decision-log-8.md` (DL-705…DL-713), and Builder rows (BD-NNN) in `spec/11-decision-log-builder.md` (rows for M00 … M01f, recorded on `claude/build` before the split, in `-builder-2.md` and `-builder-3.md`). Architecture: `spec/02-architecture.md` **v1**. Open questions: `spec/99-open-questions.md` (Q-13…Q-37, U-rows) and `spec/99-open-questions-2.md` (Q-38 onward, U-ACCT-*; DL-608).

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
| Verification | critics: executability · factual · scope | **in progress**: rounds r1–r5 and closeout c1–c2 run, each with a fix pass; stop rule (two consecutive zero-blocking rounds, all lenses) **not reached** (c2: 3 blocking); next a full round c3; then per block, at the `_PLAN.md` §3 checkpoints, before each block's first milestone starts | critic log and Definition of Done below; DL-249…DL-559 |

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
| DL-OWN-04 | Owner-merged PR #1: password accounts on Supabase Auth (2026-10-19) | accepted as a credential beside the spine; production sign-up behind `AUTH_PASSWORD_SIGNUP` until M00e's checks are live, sign-in and staging sign-up stay on (Q-43, DL-601); conformance in M00e | ADR-ACCT-01, D-32 |

Owner questions Q-13…Q-19 (Wave 1) and **Q-20…Q-25** (Waves 2–4: voice ceiling, sensitivity read, npm publication, counsel list, animation staffing, private content repo) carry defaults in `spec/99-open-questions.md`.

## Waves 2–4 result (2026-10-18)
- **All 17 contracts are final** (06 v1.1). Finalized by their owners and accepted with Architect edits: C08 (S02), C09 (S03), C10 (S04), C14 and C17 (S12), all 1.0.0. Additive minor bumps: C02, C03, C04, C05, C06, C07, C12, C13, C16 → 1.1; C01, C11, C15 unchanged. No breaking change, so no major bump.
- **Reconciliation:** 17 contract conflicts resolved (DL-077…DL-093), 11 contract-bump or deferral rows (DL-094…DL-104), 50 `decisions_needed` settled (DL-105…DL-154), five moved to the owner and one owner action opened (Q-20…Q-25). Notable: one owner per id type (C08 `LatLng`, `ChunkKey`, places; C10 `NpcId`; C14 `ModId`); `playSequence` for mixed fight intros; mission talk uses existing C10 fields; tycoon numbers are sim-computed `deals`; `AnimStateId` 128–159 racing, 160–207 fighter, 208–255 tycoon; under-18 blocked; New Game = new save profile; XR text entry flat-only; telemetry default on.
- **Re-run notes:** none needed. All eight domains returned complete specs with return blocks; contradictions were fixed by minimal edits in the domain files.
- **Size watch:** `01-engine.md`, `11-platform.md`, `09-backend-contracts.md` and `spec/11-decision-log.md` sit at the 6,000-word cap. 1.1 additions went to part files (`09-backend-contracts-1.1.md`, `11-platform-pwa.md` §11, ends of `01-engine-contracts.md` and `01-engine-save-modes.md`, `05-assets-pipeline.md` §14). Wave 5 continues the decision log in a new part file.
- **UNVERIFIED:** Wave 2–4 items (85) are indexed in `spec/99-open-questions.md` §3; Wave 5 merges them into §2 rows.

## Milestones (register: `spec/07-milestones/_PLAN.md`)

The run order, dependencies, critical path and checkpoints are in `spec/07-milestones/_PLAN.md` §1–§3 (rows in `_PLAN-1/2/3.md`); file status is in `spec/07-milestones/README.md`; the Builder's list with gates is in `prompt-pack/04-SONNET-KICKOFF.md` `<milestones>`. Totals: **123 milestone files, all READY** — 116 for v1 (≈ 107.9 sessions, M00 … M14a; M10d1–M10d2 art integration added by DL-390, M10d3 player cars and fight stages by DL-460, M10e audio integration by DL-500, M00e owner-account hardening and M00f third-party reuse gates by DL-605, M02e look pass after M02b2 by DL-704, M01d2 media route by DL-713) plus 7 post-v1 Bay-expansion milestones (M15a–M15g, one session each; DL-242) = 114.9 sessions. Every id is one session or less (C15 L7). Critical path 29.8 sessions to M14a, 33.8 to M15g (DL-219, DL-348, DL-552; unchanged by M00e and M00f, DL-605, and by M02e, DL-704). Ordering anchors: R-ROLL-01 (no rooms milestone, M12b1 onward, before M05c2 is deployed to staging with its ACs passing); A-06 vertical slice = M05c2; VS-Racing M07a2, VS-Fighter M08a2, VS-Tycoon M09a2; launch gate M14b3; M14a (Thirdweb) last v1 milestone (R-AUTH-02).

## Start the Builder

Exact command to start the Builder on M00, from the repository root (a Builder is already executing M00); later milestones use the same command with their file stem, and `--effort high` for M01/M02/M05/M06/M12 ids [research/claude-code-deployment.md §4]:

```bash
claude -p "$(sed -n '/^<builder_prompt/,/^<\/builder_prompt>/p' prompt-pack/04-SONNET-KICKOFF.md | sed 's/<<MILESTONE>>/M00-bootstrap-ci-pwa-on-workers/g')" \
  --model claude-sonnet-5-5 --effort medium --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Write,Edit,Bash" --output-format stream-json --verbose
```

Operator prerequisites, the interactive alternative and `--resume` after a usage-limit failure are in `prompt-pack/04-SONNET-KICKOFF.md`.

**Next sessions (`_PLAN.md` §0 rules 7–8; milestones already executing merge as before):** M00e `owner-account-hardening` first (with `--effort high`; its dependencies are merged into `claude/build`; no milestone that touches `services/edge/src`, `services/edge/test` or `services/edge/wrangler.jsonc` starts before it merges), M00d `qa-spec-gates` already in progress (not gated; merges as before, DL-648), then M00f `third-party-reuse-gates` (needs M00d; nothing is vendored before it merges, DL-607; order DL-622), started with the command above and their file stems. Operator action first: create `main` from `claude/build` and make it the default branch (Q-42 answered 2026-10-19, DL-606).

**Parallel Builders (DL-246):** one git worktree and one branch `m<id>-<slug>` per milestone (`git worktree add .claude/worktrees/m<id>-<slug> -b m<id>-<slug>`); a milestone starts only when every milestone in its Depends on is merged to the default branch, or, for a milestone with a row in `_PLAN.md` §4 (DL-700), when its start-after set is merged, building against the named stand-ins and re-proving the listed ACs at rebase; PRs merge in run order (`_PLAN.md` §1), each rebased and re-proved first; deploys run only from the default branch.

## Critic log
One row per verification round; counts per lens as E executability · F factual · S scope (a lens absent from a cell did not run that round). Every round with findings was followed by a fix pass; fixes are logged in `spec/11-decision-log-4.md`, `-4b.md` and `-5.md`.

| Round | Date | Blocking | Major | Minor | Notes |
|---|---|---|---|---|---|
| r1 | 2026-10-18 | E 4 · F 1 · S 1 | E 11 · F 2 · S 8 | E 13 · F 9 · S 8 | frozen-file defects (M00a AC-1, M00c `blocked` endpoints), test collection and filters, C02 lint scope, CI and secrets alignment, unowned XR dialogue and stubs, launch gates, trace matrix; DL-249…DL-301 |
| r2 | 2026-10-19 | E 1 · F 0 · S 2 | E 5 · F 5 · S 2 | E 14 · F 13 · S 9 | contract erratum (C13 sky names), DO restart scope stated as fact, Builder-decision file and cap, pre-M14a publish identity; DL-340…DL-343 |
| r3 | 2026-10-19 | E 0 · S 1 | E 6 · S 5 | E 12 · S 10 | build-dependent unit proof, `perf` job without a creating milestone, Quest draw budget vs F-013, Q-38 missing from the trace; DL-344…DL-347 |
| r4 | 2026-10-19 | S 3 | S 3 | S 8 | hidden world dependencies, no final-art milestone, public UGC at launch, unowned events and roll-ups; DL-348…DL-350, DL-390, DL-391, DL-420, DL-421 |
| r5 | 2026-10-19 | S 1 | S 6 | S 6 | player-car and fight-stage art owner, final audio owner, release-gate trace closure, launch scope, kill drill, forum moderation, age-signal provider; DL-450, DL-451, DL-460…DL-493, DL-500 |
| c1 | 2026-10-19 | E 1 · F 0 · S 0 | E 4 · F 3 · S 4 | E 11 · F 6 · S 8 | closeout: M13a3 over the C15 L7 file limit (blocking, DL-537); row drift between kickoff, `_PLAN` and README; files over the cap and stale counts; retired U-ids; price ratios; unowned mod namespaces; silent R-ID narrowing (Q-41) |
| c2 | 2026-10-19 | E 3 · F 0 · S 0 | E 8 · F 4 · S 3 | E 14 · F 6 · S 6 | closeout: proofs that cannot pass as written — synth world absent from the QA catalog (DL-542), M05b2 over L7 (DL-554), M00d `check:telemetry` red on the repo (DL-558); unowned paths and UI controls, unpriced fallback model, missing `spec/03` §6 rows, KV latency wording |

**Stop rule not reached.** §H.5 needs two consecutive rounds with zero blocking findings across all three lenses; no round so far qualifies (r4 and r5 ran the scope lens only). The c1 and c2 fix passes (DL-530…DL-559 in `spec/11-decision-log-5.md`) have not been re-checked by a fresh round, so their fixes are unconfirmed.

## Definition of Done (03-SPEC-TEMPLATE §H)
Evaluated 2026-10-19 after closeout round c2. **Verdict: not done** — H.5 is not met, and H.1, H.6 and H.7 are partly met.

| § | Item | Result | Evidence and what remains |
|---|---|---|---|
| H.1 | §A files exist, follow format, under the ceiling | partly met | all §A files and 31 ADRs exist; over the 6,000-word ceiling: `spec/99-open-questions.md` (≈ 6,260 at c2; split to ≈ 5,750 by DL-608) and `spec/domains/08-tycoon.md` (≈ 6,000); over §A targets (not the ceiling): this file, the kickoff (≈ 2,850 vs 1,500), 37 milestone files above 2,000 words |
| H.2 | Traceability matrix complete | met | `spec/01-product-trace.md`: 43 R-ID rows = 43 R-IDs in 06, no empty cell |
| H.3 | Every C## has owner, TypeScript in `spec/04`, a consumer milestone | met | owners S01–S13 in 06 §contracts; C01–C17 indexed in `spec/04-data-models.md` and typed in its part files; each cited by ≥ 7 milestone files |
| H.4 | No UNVERIFIED in any AC; all in `99` with defaults and blocks | met | no AC line holds the token (`99` §0 sweep, re-checked); 153 U rows in `99` §2 with default and blocks; residual: frozen M00 AC-14 depends on U-QA-8 (`99` §0 F-1) |
| H.5 | Two consecutive zero-blocking passes, all three lenses | **not met** | no qualifying round; c2 had 3 blocking (executability). Remains: a full three-lens round c3 with zero blocking, then a second (c4) |
| H.6 | `CLAUDE.md`/`AGENTS.md` < 200 lines; every command runs | partly met | 86 and 105 lines; the "commands run" proof is M00 (R-ENG-01 ACs), which is still executing |
| H.7 | Cost model, risk register, likeness, provenance check, kill-switch present and referenced | partly met | all present; likeness, `provenance:check` and kill-switch cited by 37, 37 and 13 milestone files; the register names an owner milestone per RISK row, but no milestone file cites `spec/09` or `spec/10` by path |
| H.8 | Kickoff customized, names M00, lists every milestone with sessions | met | `<milestones>`: 121 rows in run order with sessions, depends on, gate; row 1 is M00 (119 at the c2 evaluation; M00e, M00f added by DL-605) |
| H.9 | Gated decisions answered or defaulted with date | met | G1–G3 and Q-01…Q-12 above; Q-13 onward defaults in `99` §1 and `99-open-questions-2.md` §1 |
| H.10 | Final recap names the exact Builder command | met | "Start the Builder" above |

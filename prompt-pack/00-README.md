# 00 — README · Operator runbook for the Dee-Verse: GTA – Tha Bay prompt pack

> This pack turns an empty repository (github.com/gratitude5dee/GTA-Tha-Bay) into a complete Build Spec using Claude Opus 5.5 as the Architect, then into a working game using Claude Sonnet 5.5 as the Builder. The per-character research layer (`soul.md` files and reference images) is assumed done by you. The stack research is partly done (see `research/`); the Architect's Phase 0 (S00 subagents) verifies the rest before any design starts. Facts quoted in this pack were verified on 2026-10-18; re-check prices and endpoint ids before paying for anything.

## 1. What is in the pack

| File | Role | Who reads it |
|---|---|---|
| `00-README.md` | this runbook | you |
| `01-MASTER-PROMPT-OPUS-5.5.md` | the Architect prompt; installed as the `/architect` skill | Opus 5.5 |
| `02-SUBAGENTS.md` | the subagent skeleton + briefs for S00 (research) and S01–S13 (domains); the Architect materializes them as `.claude/agents/*.md` in Phase 0 | Opus 5.5 / Sonnet 5.5 (per frontmatter) |
| `03-SPEC-TEMPLATE.md` | the output contract the Architect must satisfy | Opus 5.5, Sonnet 5.5 |
| `04-SONNET-KICKOFF.md` | the Builder prompt, milestone protocol, `CLAUDE.md` template | Sonnet 5.5 |
| `05-APPENDIX.md` | verified-facts ledger, decisions, constraints block, likeness policy, risk register, cost model, glossary | everyone |
| `06-SHARED-CONTEXT.md` | canonical requirement IDs, interface contracts, conventions | everyone |
| `research/*.md` | the research reports that exist today (example-repo analyses, Anthropic model facts, Claude Code deployment, owner updates); the rest are produced by S00 | Opus 5.5 |
| `GTA-THA-BAY-PROMPT-PACK.md` | everything concatenated, for single-file paste | you |

## 2. Roles and artifact flow
```
you ──(brief, research layer)──▶ Architect (Opus 5.5, /architect skill)
                                   ├─ Phase 0: S00 research subagents fill research/*.md + INDEX.md; gated questions G1–G3
                                   ├─ Wave 1: S01 engine · S09 backend · S11 platform · S05 assets   → contracts frozen (06 v1)
                                   ├─ Wave 2: S02 world · S03 story/cutscenes · S04 NPCs
                                   ├─ Wave 3: S06 racing · S07 fighter · S08 tycoon
                                   ├─ Wave 4: S10 UI shell · S12 modding/UGC
                                   ├─ Wave 5: S13 QA/integrator → traceability, milestones, critics
                                   └─ writes spec/**, CLAUDE.md, AGENTS.md, ADRs, customized 04-SONNET-KICKOFF.md
you ──(one milestone per session)──▶ Builder (Sonnet 5.5) ──▶ the repository, deployable at every milestone
```
The Architect never writes code. The Builder never makes architecture decisions. Every spec line traces to an R-ID in 06.

## 3. Prerequisites
- Claude Code (v2.1.29x or newer — frontmatter `effort` and `.claude/rules` with `paths` are used) with either a Max plan or an `ANTHROPIC_API_KEY`. Headless runs (`claude -p`) do not pause at subscription usage limits; they fail and must be resumed (`--resume`). For a multi-hour architect run, an API key is the predictable path.
- The target repo cloned locally (it is empty). Node 22+, pnpm. `wrangler` logged in (Cloudflare) — needed by the Builder from M00, not by the Architect.
- The research layer in place (see §4). No fal/Supabase/Convex/Thirdweb/OpenAI secrets are needed for the Architect phase.

## 4. Prepare the repository (10 minutes)
```
repo/
  prompt-pack/                 ← copy this whole pack here (all files)
  research/
    *.md                       ← copy this pack's research/ folder here; S00 adds the missing reports and INDEX.md
    owner-updates.md           ← binding owner updates (SF-accurate-first; Grand-V patterns)
    characters/<slug>/soul.md  ← one per NPC (your research layer)
    characters/<slug>/refs/    ← reference images per NPC
    examples/                  ← optional: the example repos, shallow-cloned, read-only
  .claude/
    skills/architect/SKILL.md  ← = 01-MASTER-PROMPT-OPUS-5.5.md body, with the frontmatter shown below
    agents/s00-research.md … s13-qa.md ← materialized from 02-SUBAGENTS.md (by you, or by the Architect in Phase 0)
    rules/spec.md              ← spec-format rules, loads only when spec files are touched (see §9)
    settings.json              ← optional hooks (see §9)
  CLAUDE.md                    ← bootstrap version (see §9); the Architect replaces it at handoff
```
SKILL.md frontmatter to prepend to the master prompt:
```
---
name: architect
description: Runs the multi-agent architecture pass for Dee-Verse GTA Tha Bay and writes the Build Spec into spec/. User-invoked only.
disable-model-invocation: true
argument-hint: "[phase]"
effort: xhigh
---
```
Why a skill and not CLAUDE.md: CLAUDE.md is loaded into every session and should stay under 200 lines; a user-invoked skill loads the full prompt only when you run `/architect`, and keeps Claude from triggering it by itself. After context compaction only the first ~5,000 tokens of the skill are re-attached, which is why the master prompt puts its non-negotiables first.

## 5. Run the Architect
Interactive (recommended the first time, so you can answer the three gated decisions when they are asked):
```
cd repo && claude --model claude-opus-5-5
> /architect
```
Headless (unattended; the Architect proceeds on its recommended defaults for gated decisions and records them):
```
claude -p "/architect" --model claude-opus-5-5 --effort xhigh --max-turns 400 --max-budget-usd 150 \
  --permission-mode acceptEdits --allowedTools "Read,Grep,Glob,Write,Edit,Agent,Bash(git *),Bash(ls *),Bash(wc *)" \
  --output-format stream-json --verbose | tee architect-run.jsonl
```
Models and effort used (pinned ids; aliases map differently on Bedrock/Foundry):

| Agent | Model | Effort | Why |
|---|---|---|---|
| Architect | `claude-opus-5-5` | `xhigh` (`max` for the final verification pass) | architecture quality is the whole point; Opus 5.5 defaults to `medium`, so it must be set |
| S00 (research), S01, S03, S04, S09, S13 | `claude-opus-5-5` | `high` | research verification, contract-defining, narrative/AI-design heavy |
| S02, S05, S06, S07, S08, S10, S11, S12 | `claude-sonnet-5-5` | `high` | well-bounded domains with strong research inputs |
| Critics (via S13) | `claude-opus-5-5` | `high` | fresh-context verification |
| Builder | `claude-sonnet-5-5` | `medium` (routine milestones) / `high` (M01, M02, M05, M06, M12) | agentic coding sweet spot per Anthropic's effort guidance |

Expected duration and cost (rough; architect only): 2–5 hours wall-clock; 4–8M input tokens (mostly cached reads of the research) and 0.5–1.2M output tokens ≈ $40–90 at API rates; set `--max-budget-usd` accordingly. Builder: roughly $5–25 per milestone on Sonnet 5.5; 15 milestones ≈ $100–350 before reruns. GenAI content costs (fal, TTS, NPC dialogue) are filled into `spec/10-cost-model.md` by the Architect from S00's figures; `05-APPENDIX.md` §F lists what must be verified.

## 6. The three gated decisions (the only questions the Architect will ask)
- **G1 Supabase vs Convex** — asked only if S00's decision matrix leaves it open. Default: Supabase for persistence/auth/pgvector/presence with Durable Objects as room authority.
- **G2 Likeness tier per named real person** — default `parody` (altered name and design) for everyone until you confirm consent; `fictionalized` is the safe fallback; `consented` requires a signed release recorded in `research/characters/<slug>/consent.md`.
- **G3 GenAI monthly budget ceiling and per-player quotas** — default: the ceiling that keeps S00's 1k-MAU cost model under its lowest tier, with daily cutscene-generation caps and per-player dialogue rate limits.

## 7. Review the spec before starting the Builder (30–60 minutes)
Open `spec/00-plan.md` and confirm the Definition of Done checklist is all green and the critic log shows two consecutive clean passes. Then skim: `spec/01-product-trace.md` (traceability matrix has no empty rows), `spec/07-milestones/M00-*.md` (you can run every command in it), `spec/99-open-questions.md` (anything with a blocked milestone needs your answer), `spec/10-cost-model.md`, `CLAUDE.md` (< 200 lines, commands real). If something is wrong, do not fix it by hand: run `/architect fix: <what>` and let it update the spec and the decision log.

## 8. Run the Builder (one milestone per session)
```
cd repo && git checkout -b m00-bootstrap && claude --model claude-sonnet-5-5
> <paste 04-SONNET-KICKOFF.md's <builder_prompt> with <<MILESTONE>> = M00-bootstrap>
```
Or headless: `claude -p "$(sed 's/<<MILESTONE>>/M00-bootstrap/' prompt-pack/04-SONNET-KICKOFF.md)" --model claude-sonnet-5-5 --effort medium --max-turns 300 --max-budget-usd 40 --permission-mode acceptEdits`. Read the report at the end of each session; resolve "Blocked on" items; merge; next milestone. Milestones M00–M04 give you a hosted, playable gray-box SF; M05–M06 the story and NPCs; M07–M09 the modes; M10–M11 assets and platform hardening; M12 multiplayer; M13 modding; M14 auth; M15+ the rest of the Bay.

## 9. Bootstrap files
`CLAUDE.md` (bootstrap, replaced by the Architect at handoff):
```
# Dee-Verse: GTA – Tha Bay — bootstrap
This repository is being specified by the /architect skill. Read prompt-pack/00-README.md.
Rules: every claim about an external system cites research/ with a URL or is labeled UNVERIFIED; never invent endpoints; original content only (no Rockstar assets/code/data); display name comes from config.
```
`.claude/rules/spec.md`:
```
---
paths: ["spec/**/*.md", "docs/decisions/*.md"]
---
Spec files follow prompt-pack/03-SPEC-TEMPLATE.md exactly. Every external-system fact carries [research/<file>.md] or UNVERIFIED. No UNVERIFIED inside acceptance criteria. Files stay under 6,000 words; split rather than exceed. Types in TypeScript, diagrams in Mermaid, commands in fenced blocks.
```
Optional hooks in `.claude/settings.json` (structure checks only; they cannot judge truth):
```
{ "hooks": { "PreToolUse": [ { "matcher": "Write|Edit", "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/no-unverified-in-milestones.sh" } ] } ] } }
```
`.claude/hooks/no-unverified-in-milestones.sh` rejects any write to `spec/07-milestones/*.md` whose content contains `UNVERIFIED` (exit 2 with a reason on stderr). Keep it off for the first run if you want to see how the Architect handles gaps on its own.

## 10. Troubleshooting
- The run stops at a usage limit (`-p`): rerun with `--resume <session id>`; nothing is lost, the spec is on disk and `spec/00-plan.md` records progress.
- A subagent returns thin output: the master prompt tells the Architect to re-run it once with the defect named; if it happens again, run that subagent directly: `claude --agent s07-fighter` in a fresh session, pointing it at its brief.
- The Architect asks something other than G1–G3: answer it and add it to `spec/99-open-questions.md`; that is a sign the research is missing something — add a report to `research/` and re-run the affected wave.
- Compaction mid-run: the skill's first ~5,000 tokens (role, mission, inputs, constraints) survive; everything else is on disk. The Architect re-reads `spec/00-plan.md` and continues.
- Facts drift (prices, endpoint ids): update the ledger row in `research/INDEX.md`, then `/architect fix: facts`.

## 11. Provenance of this pack
Built 2026-10-18 from: the owner brief and two owner updates; three deep example-repo analyses (playgta5 + muguet, San-Francisco + SF-Bay-Area-AI-Atlas + gta-sa-earth, sharkpaw/Grand-V — architecture inspiration only, no code or data reused; SebasKitten/Grand-V was not reachable); Anthropic's current model reference and Claude Code documentation (verified 2026-10-18). The remaining research dimensions were scoped but not run in this session (budget), so the Architect's Phase 0 runs them; the pack's own adversarial verification pass is likewise left to the Architect's critics.

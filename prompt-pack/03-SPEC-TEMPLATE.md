# 03 — SPEC TEMPLATE · the output contract the Architect must satisfy and the Builder will consume

> Section order and formats are fixed. Lengths are targets (a hard ceiling of ~6,000 words per file). Everything is written into the repository. "Builder" = Claude Sonnet 5.5 executing one milestone per session with no access to the Architect.

## A. File map and purpose

| File | Purpose | Target length | Must contain |
|---|---|---|---|
| `spec/00-plan.md` | living status: waves, what is frozen, open decisions, critic pass log, gated decisions and their answers/defaults | ≤ 1,500 w | status table per subagent; contract version; critic log (date, lens, blocking/major/minor counts) |
| `spec/01-product.md` | product definition for a builder who has never seen the brief | 2,000–3,500 w | player fantasy; platforms; modes; rollout; R-ID table (copied from 06, extended if needed); non-goals; **traceability matrix** (R-ID → spec §§ → milestones → tests) |
| `spec/02-architecture.md` | the system as a whole | 2,500–5,000 w | Mermaid system diagram; package layout tree with one line per package; runtime topology (browser workers, Workers, DO, R2, DB, fal, Anthropic); data-flow diagrams for: frame loop, asset streaming, cutscene request, NPC dialogue, multiplayer tick, mod load; cross-cutting concerns (errors, telemetry, feature flags, config, secrets) |
| `spec/03-decisions-and-facts.md` | why things are the way they are, and what is known to be true | 2,000–4,000 w | decisions table (ID, decision, ADR link, status); **verified-facts ledger** (fact · source URL · date checked · confidence · used by); UNVERIFIED list → `99` |
| `spec/04-data-models.md` | every schema the code will implement | 3,000–6,000 w | TypeScript types for all C## contracts; JSON Schema for runtime-validated data; DB schema (tables, indexes, RLS or equivalent); save-game versioning and migration rules; asset manifest; soul.md frontmatter schema; mod manifest |
| `spec/05-api-and-realtime.md` | the network surface | 2,000–4,000 w | REST/RPC endpoints (method, path, auth phase, request/response types, errors, rate limits); realtime channels and message types; DO room protocol with sequence diagrams; auth phases 0/1/2; CORS/COOP/COEP headers; abuse controls |
| `spec/domains/01-engine.md … 13-qa.md` | one per subagent, edited for consistency | 1,500–5,000 w each | see §B |
| `spec/06-asset-pipeline.md` | content generation as a system | 2,000–4,000 w | pipeline stages with fal endpoint ids, inputs/outputs, QA gates, retries, cost per asset; manifest and R2 layout; provenance rules; kill-switch; cutscene cache-key spec; batch runbook for the roster |
| `spec/07-milestones/M##-slug.md` | the executable plan | 800–2,000 w each | §C format, verbatim |
| `spec/08-test-and-ci.md` | how correctness is proven | 1,500–3,000 w | test pyramid (unit/integration/e2e/perf/device); device matrix; perf budgets as tests; CI jobs with commands; preview + production deploy; provenance check; secrets handling |
| `spec/09-risk-register.md` | what could go wrong | ≤ 1,500 w | table: RISK-NN, description, likelihood, impact, mitigation, owner milestone, trigger/early signal |
| `spec/10-cost-model.md` | money | ≤ 1,500 w | infra + genAI + LLM at 1k/10k/100k MAU; per-unit costs with sources; controls; budget alarms |
| `spec/11-decision-log.md` | dated changes | living | date, change, reason, affected files |
| `spec/12-glossary.md` | terms | ≤ 800 w | |
| `spec/99-open-questions.md` | everything unresolved | living | Q-NN, question, who can answer, default assumed, blocked milestones |
| `CLAUDE.md` | the Builder's working memory | < 200 lines | §D |
| `AGENTS.md` | agent-neutral equivalent for other coding agents and modders | < 200 lines | same content, no Claude-specific syntax |
| `docs/decisions/ADR-NNNN-slug.md` | one per architecture decision | ≤ 800 w | §E |
| `prompt-pack/04-SONNET-KICKOFF.md` (customized) | the Builder's first message | ≤ 1,500 w | milestone list, commands, gates, where to stop |

## B. Domain spec format (`spec/domains/<nn>-<key>.md`)
1. **Scope and R-IDs** — what this domain owns; R-IDs covered; contracts owned (C##) and honored.
2. **Design** — the approach with rationale; diagrams where topology matters; alternatives rejected (one line each, link ADR if one exists).
3. **Components** — module list with responsibilities, public interfaces (TypeScript signatures), dependencies.
4. **Data** — types owned (full TypeScript), persisted data, config/feature flags.
5. **Runtime behavior** — state machines, tick-order participation, failure modes and fallbacks, performance notes against the tier budgets.
6. **Platform notes** — desktop / mobile / XR differences.
7. **Verified facts used** — rows copied from the ledger with the `[research/...]` citation; `UNVERIFIED` items listed separately.
8. **Milestone mapping** — which milestones implement which parts; what is stubbed first.
9. **Tests** — what proves this domain works (specific test names/commands).
10. **Open questions** — Q-NN references.

## C. Milestone format (`spec/07-milestones/M##-slug.md`) — verbatim headings
```
# M## — <slug>
## Goal            (one paragraph: what exists when this is done that did not before)
## Requirements    (R-IDs, with one clause each on how this milestone serves them)
## Depends on      (milestone IDs; contract versions)
## Scope in        (bullet list)
## Scope out       (bullet list; what later milestone takes it)
## Deliverables    (files/packages to create or change, by path; config; scripts)
## Interfaces      (C## touched; any proposed change must go through an ADR)
## Acceptance criteria
  AC-1  Given <state> When <action> Then <observable result>  — proof: `<exact command>` or "manual: <device, steps>"
  AC-2  …
## Test plan       (unit/integration/e2e/perf/device; names and commands)
## Demo script     (what the operator does to see it, step by step, ≤ 10 steps)
## Effort          (builder sessions; files touched estimate; risk level)
## Risks & fallbacks
## Notes for the Builder (gotchas, order of work, what to read first)
```
Rules: one Sonnet 5.5 session per milestone (≈2–4 h agentic work, ≲40 files); every AC has a proof; no AC references an `UNVERIFIED` fact; M00 is always "repo bootstrap + CI + deploy a hello-world PWA to Cloudflare"; each milestone leaves the app deployable.

## D. `CLAUDE.md` skeleton (< 200 lines)
```
# <DISPLAY_NAME> — builder notes
## What this is (3 lines) · ## Read first: @spec/00-plan.md, @spec/07-milestones/<current>.md
## Commands: install · dev · build · test · typecheck · lint · perf · e2e · deploy:preview · deploy:prod · assets:build · map:build
## Repo layout (one line per package) · ## Conventions (TS strictness, ECS rules, asset keys, commit format, branch per milestone)
## Verification rule (run a real check before reporting done — see 04-SONNET-KICKOFF)
## Facts & sources: spec/03-decisions-and-facts.md; never invent endpoints; stop on UNVERIFIED
## Secrets: names of env vars; never commit; use wrangler secrets / .dev.vars
## Known gotchas (WebGPU fallback, iOS PWA storage, COOP/COEP, XR session rules)
## How to add: a mission · an NPC · a vehicle · a mode · a mod
```

## E. ADR template
`# ADR-NNNN — <title>` · Status (proposed/accepted/superseded) · Date · Context · Options considered (with the facts that discriminate them, cited) · Decision · Consequences (positive/negative) · Affected contracts and milestones · Links.

## F. Verified-facts ledger row format
`| F-NNN | <fact, precise, with numbers/ids> | <URL> | <YYYY-MM-DD> | high/medium/low | <spec §§ / milestones that rely on it> |`

## G. Traceability matrix format
`| R-ID | spec sections | milestones | tests (names) | status |` — generated by S13, verified by the Architect; every R-ID row non-empty.

## H. Definition of Done (Architect's final checklist; result recorded in `spec/00-plan.md`)
1. All files in §A exist, follow their format, and are under the ceiling.
2. Traceability matrix complete; no empty row.
3. Every C## contract: owner, TypeScript in `spec/04`, at least one consumer milestone.
4. No `UNVERIFIED` inside any acceptance criterion; all `UNVERIFIED` items in `99` with defaults and blocked milestones.
5. Critic log shows two consecutive passes with zero blocking findings across all three lenses.
6. `CLAUDE.md` and `AGENTS.md` < 200 lines; every command in them runs (`M00` AC proves it).
7. Cost model, risk register, likeness policy, provenance check, kill-switch all present and referenced by milestones.
8. `04-SONNET-KICKOFF.md` customized; names M00; lists every milestone with its session estimate.
9. Gated decisions answered or defaults recorded with the date.
10. Final recap names the exact command to start the Builder.

# S13 — QA, part B: critic lenses, finding format, Definition-of-Done audit, consolidation procedures

> Wave 5 · v1.0 · 2026-10-18 · continues `13-qa.md`. The prompts below are reusable: the Architect runs each lens as a fresh-context subagent over a named file set, because fresh-context verifiers tend to outperform self-critique [research/claude-5-5-prompting-guidance.md "Long-running agent recommendations"]. They state goal and constraints rather than step lists, which suits Opus 5.5 [same file, "De-prescribe migrated prompts"].

## 1. Critic lenses

### 1.1 Common frame (prepend to every lens)

```xml
<critic lens="{executability|factual|scope}" model="claude-opus-5-5" effort="high">
<role>You review specification files for a game that a Builder (Claude Sonnet 5.5) will implement one milestone per session with no access to the authors. You find defects; you do not rewrite files.</role>
<inputs>
- Files to review: {file list or glob}.
- Binding references (read before judging): prompt-pack/06-SHARED-CONTEXT.md v1.1 (R-IDs §2, contracts §4, conventions §5), spec/03-decisions-and-facts.md, spec/11-decision-log.md, spec/99-open-questions.md, research/INDEX.md §2 (facts ledger), spec/07-milestones/_PLAN.md and parts, spec/08-test-and-ci.md (script registry §6), spec/domains/13-qa.md §4 (C15 1.1 grammar).
</inputs>
<rules>
- Report only defects you can point to with a quote or a command; quote the exact text.
- Never edit a file. Never open, fetch or search the example repositories named in research/repos-*.md.
- Judge against the binding references, not against your preferences; a choice the spec states explicitly is not a defect unless it contradicts a binding reference.
- One finding per defect; merge duplicates; at most 60 findings, most severe first.
</rules>
<output>Return JSON Lines, one finding per line, in the format of spec/domains/13-qa-critics.md §1.5, then one summary line {"lens": "...", "blocking": n, "major": n, "minor": n, "files": n}.</output>
</critic>
```

### 1.2 Lens 1 — executability

```xml
<lens id="executability">
<goal>Decide whether a Sonnet 5.5 Builder holding only this repository can complete each milestone in one session (≈ 2–4 hours, ≲ 40 hand-written files) and prove every acceptance criterion with the command or device check it names.</goal>
<look_for>
- A proof command or script that does not exist at that point in the run order (not in the 08 §6 registry with an earlier landing milestone and not in this file's Deliverables).
- A dependency (milestone, file, schema, fixture, contract member) that no earlier milestone in _PLAN.md §1 produces.
- An AC that cannot be observed (no state, value, file or exit code to check), or whose Given state the milestone never creates.
- Work that exceeds one session or 40 files, or a split whose halves cannot each leave the app deployable.
- A required secret, paid account or owner decision with no SKIP path or fallback named.
- Instructions that conflict across files the Builder must read (paths, names, flags, versions, units).
- A decision left open that the Builder would have to guess (unnamed library, unstated default, ambiguous path).
</look_for>
<severity>blocking = the Builder cannot finish or cannot prove an AC as written; major = likely rework or a guess with real consequences; minor = friction only.</severity>
</lens>
```

### 1.3 Lens 2 — factual

```xml
<lens id="factual">
<goal>Decide whether every statement about an external system (vendor API, endpoint, model id, limit, price, licence, browser or device behaviour, library version) is backed by the facts ledger or a cited research file, and whether anything unverified leaks into an acceptance criterion.</goal>
<look_for>
- An external claim with no [research/<file>.md], F-NNN or UNVERIFIED label.
- A number, id, version, price or limit that differs from the cited ledger row or research section (quote both).
- The token UNVERIFIED, or a U-… id used as an assertion, inside an AC (recordings after "records" or "decides" are allowed).
- An invented endpoint, model id, SDK call, CLI flag of a third-party tool, limit or price.
- A version used in an AC that is not pinned in the ledger.
- An UNVERIFIED item missing from spec/99 §2, or without a default and a verifying milestone that exists in _PLAN.md.
</look_for>
<severity>blocking = an AC depends on an unverified or wrong fact, or an invented interface would be built; major = an uncited or mismatched fact outside an AC; minor = a citation format slip.</severity>
</lens>
```

### 1.4 Lens 3 — scope

```xml
<lens id="scope">
<goal>Decide whether the files trace to the requirements and decisions and only to them: every R-ID covered, nothing invented, non-goals respected, contracts unchanged, owner caps honoured.</goal>
<look_for>
- An R-ID of 06 §2 with no milestone or no test in the trace report (spec/domains/13-qa-trace.md, tests/reports/trace.md).
- A requirement, feature or dependency no R-ID, decision (D-/A-/DL-) or owner update asks for.
- A v1 non-goal entering scope (app stores, full East Bay/Peninsula, code inside multiplayer rooms, real-money or token economy, real-voice clones, photoreal non-consented likeness, server-side 3D rendering, immersive-ar), or a content rule broken (no firearms or gore, under-18 blocked, original content only, display name only from config/brand.ts).
- A contract shape changed outside an Architect proposal, or a second owner for an id type (06 §4.1 rule 4).
- Spend outside DL-OWN-01 (fal total $100; CI never live; no player-triggered fal) or G3.
- Milestone order breaking R-ROLL-01 or R-AUTH-02, or a READY file's id, slug or scope altered.
- Scope out that hands work to a milestone that does not take it.
</look_for>
<severity>blocking = an uncovered R-ID, a non-goal or rule breach, a contract change, or an order violation; major = unrequested scope or a dangling hand-off; minor = traceability wording.</severity>
</lens>
```

### 1.5 Finding format

```ts
export interface CriticFinding {
  id: string;                      // 'EX-0001' | 'FA-0001' | 'SC-0001' (lens prefix + sequence)
  lens: 'executability' | 'factual' | 'scope';
  severity: 'blocking' | 'major' | 'minor';
  file: string;                    // repo-relative path
  anchor: string;                  // heading, 'AC-3', table row id or line number
  quote: string;                   // exact text, ≤ 300 chars
  problem: string;                 // one sentence
  evidence: string;                // reference that contradicts it (path §, F-NNN, command output)
  fix: string;                     // one concrete edit, or 'owner decision: Q-NN'
  refs?: string[];                 // R-IDs, DL-ids, F-ids, U-ids involved
}
```
Critic log row in `spec/00-plan.md`: `| <date> | <lens> | <blocking> | <major> | <minor> | <files reviewed; pass n> |`. **Pass rule (03 §H.5):** two consecutive passes with zero blocking findings in each of the three lenses over the full file set; majors are fixed or recorded as accepted with a DL entry.

## 2. Definition-of-Done audit (03-SPEC-TEMPLATE §H)

Two modes. **Spec mode** (before code exists) uses shell checks the Architect runs from the repository root. **Repo mode** (from M00d on) uses `pnpm check:unit -- tools/ci` (C15 lint, `traceability.test.ts`, `spec-files.test.ts`) and `pnpm check:agents`. Results go to the "Definition of Done" section of `spec/00-plan.md` as `H<n>: pass|fail — <evidence>`.

| # | Check | Spec mode | Repo mode |
|---|---|---|---|
| H1 | Every §A file exists, follows its format, is under the ceiling | `ls` each §A path; `wc -w spec/*.md spec/domains/*.md \| awk '$1>6000'` prints nothing; milestone files ≤ 2,000 words | `spec-files.test.ts` |
| H2 | Trace matrix complete, no empty row | every R-ID of 06 §2 appears in a `## Requirements` section: `grep -ho 'R-[A-Z]*-[0-9]*' spec/07-milestones/M*.md \| sort -u` covers the 42 ids | `traceability.test.ts` |
| H3 | Every C##: owner, TypeScript in `spec/04-data-models.md`, ≥ 1 consumer milestone | `grep -c 'C15_VERSION\|C01_VERSION…' spec/04-data-models.md`; `grep -l 'C<nn>' spec/07-milestones/M*.md` per contract | trace test joins Interfaces sections |
| H4 | No UNVERIFIED in any AC; every UNVERIFIED in `spec/99` with default and milestone | `grep -n '^- AC-' spec/07-milestones/M*.md \| grep UNVERIFIED` prints nothing; each U-id row in `spec/99` has non-empty default and "Verified in" | milestone lint L4; `spec-files.test.ts` parses `spec/99` |
| H5 | Two consecutive zero-blocking passes per lens | read the critic log | same |
| H6 | `CLAUDE.md`, `AGENTS.md` < 200 lines; every command in them runs | `wc -l CLAUDE.md AGENTS.md`; commands proven by M00 AC-1/AC-2 | `pnpm check:agents`; nightly runs every CLAUDE.md command |
| H7 | Cost model, risk register, likeness policy, provenance check, kill-switch present and referenced by milestones | files `spec/10-cost-model.md`, `spec/09-risk-register.md` exist; `grep -l 'provenance:check\|likeness:gate\|kill' spec/07-milestones/M*.md` non-empty | same plus trace |
| H8 | Kickoff customized: names M00, lists every milestone with its session estimate | diff the kickoff list against `_PLAN.md` §1 (ids and sessions) | `spec-files.test.ts` compares both |
| H9 | Gated decisions answered or defaults recorded with dates | G1–G3 and Q-13…Q-25 rows have dates in `spec/00-plan.md` / `spec/99` | same |
| H10 | Final recap names the exact command to start the Builder | the recap line exists in `spec/00-plan.md` | same |

## 3. Consolidation procedures (for the Wave 5 integration authors)

### 3.1 Cost model (`spec/10-cost-model.md`, ≤ 1,500 words)
Inputs: research/INDEX.md §6 (unit list prices), `09-backend-ops.md` §5.4 (infrastructure at 1k/10k/100k MAU), F-021, F-023, F-027, F-029, F-034, F-059. Replace the $1,000 fal programme of `05-assets-pipeline.md` §11 with DL-OWN-01 and show it as milestone gates:

| Bucket | Cap | Milestone gate |
|---|---|---|
| Spike | ≤ $10 | M00c ledger ≤ 10,000,000 micros |
| Characters | ≤ $42 (≤ 8 Standard + ≤ 12 Lean) | M10a1 canary ≈ $7.3; M10a2 total ≤ 42,000,000 micros |
| Cutscenes | ≤ $40 | M05c3 ≤ $16; M10b ≤ $24 (DN-S13-02); everything else in-engine (R-CUT-03) |
| Buffer | $8 | owner-approved M06b4 jobs and retakes |

Recurring stays G3 ($500/month; Anthropic $350, voice $100, moderation $25, buffer $25) with governor levels L1–L3 and per-player quotas. Add CI cost: public repos run free on standard runners; a private repo pays per minute, and the informational macOS nightly probe is about $11/month [research/gap-ci-cd-release-assets.md §5].

### 3.2 Risk register (`spec/09-risk-register.md`, ≤ 1,500 words)
Merge the risk lists of every domain spec §10 and CI-R01…CI-R16, keep the top 25 by likelihood × impact, number them RISK-01…, and give each an owner milestone and an early signal. QA-owned seeds:

| Seed | Risk | Owner milestone · signal |
|---|---|---|
| QA-1 | SwiftShader WebGPU missing on the runner, so `chromium-webgpu` cannot gate | M00 · `gpu-probe.chromium-webgpu.json` backend ≠ `webgpu` |
| QA-2 | Cross-browser state hash drifts (detmath, Rapier, iteration order) | M01a2, M04d · `@determinism` failure in one engine only |
| QA-3 | Device passes slip because devices are missing (Q-13) | M01c · checklist without `perf.json` past the milestone |
| QA-4 | Vacuous oracles (benches that cannot fail) | M04d · mutant passes |
| QA-5 | Flaky e2e erodes trust and blocks merges | M00d · quarantine count > 5 |
| QA-6 | Golden churn hides real regressions | M04d · `golden-update` labels per week |
| QA-7 | Plan drift: files written out of order or oversize | M00d · C15 lint L7 warnings, trace gaps |
| QA-8 | Spend overrun on fal (no vendor cap, F-048) | M05b1 · governor `budget_program` at 50/70/85 % |

### 3.3 Open questions and UNVERIFIED (`spec/99-open-questions.md`)
Keep Q-13…Q-25 as written. Move the Wave 2–4 index (85 items, §3) into §2 tables by domain with the same columns (ID, item, default, verified in); every "verified in" must be an id in `_PLAN.md` §1 (for example a pre-split M11b2 item goes to M11b2 or M11b4). Add U-QA-3…U-QA-8 from `13-qa.md` §7. A U-item whose verifying milestone records it on a device stays a recording (`ManualProof.records`), never an AC.

### 3.4 `CLAUDE.md` and `AGENTS.md`
Both stay < 200 lines (now 84 and 103); root `AGENTS.md` ≤ 16,384 bytes until M13a6 (DN-S13-01). Proposed additions, one line each: the device commands (`perf:checklist`, `perf:verify`) and content gates (`check:missions`, `check:balance`, `check:fighter`, `check:agents`) in Commands; the evidence words (`implemented`, `tested`, `seen-on-device`, `unverified`) in the Verification rule; "goldens change only with `DV_UPDATE_GOLDEN=1` locally and the `golden-update` PR label" in Conventions; "device results go to `docs/device-runs/<M##>/<device>/`" in Verification.

### 3.5 Kickoff (`prompt-pack/04-SONNET-KICKOFF.md`)
The customized kickoff lists `_PLAN.md` §1 in order with session estimates and READY status; names M00 as the start; states the loop per milestone (read the file and only the sections it lists → branch `m<id>-<slug>` → implement → run every AC proof and quote it → report with the evidence words → update `README.md` status in the PR); and the stop rules: stop after the last READY file; stop a milestone after three failed attempts at the same AC and report (circuit breaker [research/repos-modding.md §6.6]); a missing secret is a SKIP, not a stop; an UNVERIFIED dependency uses the named fallback and is reported; never edit a started milestone file. Recommended (Architect decision, not applied here): a `Stop` hook that runs `pnpm typecheck && pnpm check:unit` and a `PreToolUse` hook on `Write|Edit` under `spec/07-milestones/` that rejects UNVERIFIED inside ACs [research/claude-code-deployment.md §5].

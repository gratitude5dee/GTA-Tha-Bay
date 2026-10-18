# M00d — qa-spec-gates

## Goal
After this half-session the specification polices itself in CI. A C15 lint parses every milestone file in `spec/07-milestones/` and fails the build when a READY (or started) file breaks the format; a traceability report joins the R-IDs of `06-SHARED-CONTEXT.md` §2 to milestones and named tests and writes `tests/reports/trace.{json,md}`; a spec-files report automates the Definition-of-Done checks of `03-SPEC-TEMPLATE.md` §H that can be automated; `pnpm check:agents` keeps `CLAUDE.md` and `AGENTS.md` inside their size rules; a golden-update label rule stops silent golden rewrites; `ci.yml` gains a `device-runs` job that judges committed device reports with `perf:verify`; and `nightly.yml` (created by M00b) runs the full e2e matrix, the cross-browser determinism suites, `check:perf -- --fail` and a stale-Preview sweep. No game code changes and the deployed app is unchanged.

## Requirements
- R-ENG-01: every check above is one deterministic `pnpm` command (`check:unit -- tools/ci`, `check:agents`, `perf:verify`), and the agent-facing files stay within their limits.
- R-ENG-02: device reports committed under `docs/device-runs/` are judged by `perf:verify` in CI, and the nightly perf run fails on any budget breach.

## Depends on
- **M00:** `tools/ci/run.ts` (`args()`), `ci.yml`, `preview.yml`, `tools/ci/deploy.ts`, vitest workspace with `tools/ci/test/`.
- **M01c:** `perf:verify`, `perf:checklist`, `tools/ci/schemas/perf-report.v1.json`, `tools/ci/fixtures/perf/{ok,over}.json`, checklists `tools/ci/checklists/M01c-*.json`.
- Present from block A (it runs first, `_PLAN.md` §1): M00b's `nightly.yml` (cron `17 10 * * *`) and `ip` job. If `nightly.yml` is missing, create it with the M00b steps first.
- Contracts: C15 1.0 (`prompt-pack/03-SPEC-TEMPLATE.md` §C; 06 v1.1 §4.2). The C15 1.1 shapes in `spec/domains/13-qa.md` §4 are a **proposal** (13-qa calls it "proposed"); this milestone implements them as the lint's internal model only, because every rule is additive and accepts every 1.0 file. C13 1.1 (`PerfReport`, `DeviceChecklist`) is used unchanged.

## Scope in
- **`packages/shared/src/contracts/c15-milestone.ts`:** the TypeScript of `13-qa.md` §4.1 (`MILESTONE_ID_RE`, `MILESTONE_HEADINGS`, `OracleKind`, `Evidence`, `CommandProof`, `ManualProof`, `AcceptanceCriterion`, `MilestoneDoc`) with one deliberate difference: `export const C15_VERSION = '1.0.0'` and a comment `// 1.1.0 proposed in spec/domains/13-qa.md §4; the Architect bumps this constant when 06 accepts it`. Pure, no IO, under the C02 lint.
- **`tools/ci/milestone-lint.ts`:** parser plus rules L1–L8 of `13-qa.md` §4.3 and the inference table of §4.2.
  - The status of each file comes from the table in `spec/07-milestones/README.md`. Files whose status is READY, IN PROGRESS, DONE or frozen are **enforced** (any L1–L7 error fails). PENDING files are **reported** (errors become warnings with the rule id), because other authors are still writing them. L7's "files > 35" and L8 are warnings for every file.
  - L5 registry = every script name in `spec/08-test-and-ci.md` §6 (parsed from the backticks of its table) ∪ the 06 §5 script list ∪ every script a milestone **at or before this file in `_PLAN.md` §1 order** declares in its `## Deliverables` (bold names, `Root scripts` lines and `pnpm --filter <pkg> <script>` package scripts). Arguments after the script name are not checked.
  - L6 reads contract versions from the 06 §4.2 table; a version that differs is accepted only when the same line says "proposed".
  - Output: `tests/reports/milestones.json` (`{file, status, enforced, errors[], warnings[]}` per file) and one line per finding `<file>:<line> <rule> <message>`.
- **`tools/ci/trace.ts`** (`13-qa.md` §2.6): parses `## Requirements` and AC proofs of every milestone file plus the `**R**` fields of `_PLAN-1/2/3.md`, joins the 06 §2 R-ID list, and writes `tests/reports/trace.json` and `trace.md` (`| R-ID | spec sections | milestones | tests (names) | status |`, 03-SPEC-TEMPLATE §G). Status per row: `covered` (a READY or later milestone proves it with an automatable oracle), `planned` (only `_PLAN` rows or PENDING files), `device-only`, `empty`. With `--strict` (used by `release.yml` in M14b3) any `empty` row, or a `device-only` row whose domain §9 names an automatable test, fails; without it the report is written and pending rows are marked, never failed.
- **`tools/ci/spec-files.ts`** (`13-qa.md` §3.8): checks the 03-SPEC-TEMPLATE §A files exist, every `spec/**/*.md` is ≤ 6,000 words, every `spec/99` U-row names a default and a verifying milestone present in `_PLAN.md`, and the kickoff `<milestones>` list matches `_PLAN.md` §1. It writes `tests/reports/spec-files.json`; it fails only with `--strict` (M14b3), because the Wave 5 integration files are still landing.
- **`tools/ci/check-agents.ts`** and root script **`check:agents`**: `CLAUDE.md` and `AGENTS.md` each < 200 lines; root `AGENTS.md` ≤ 16,384 bytes (DN-S13-01 default; M13a6 raises the rule to root + kit ≤ 32,768 bytes); every `pnpm <script>` named in either file exists in the root `package.json` or is a `check:*` pending stub. Prints one line per rule and exits non-zero on a breach.
- Root script **`check:skills`** as a pending stub (`pending: lands in M13a6`, exit 0), so `ci.yml` can list it now.
- **Golden-update label rule:** `tools/ci/golden-guard.ts` exports `guard(changedPaths, labels)`; a change to any path matching `**/golden/**` or `**/*.golden.json` without the label `golden-update` fails. `tools/ci/test/golden-guard.test.ts` runs the fixtures always and, when `GITHUB_BASE_REF` is set, the live check over `git diff --name-only origin/$GITHUB_BASE_REF...HEAD` with labels from `DV_PR_LABELS` (comma list). `ci.yml` job `unit` passes `DV_PR_LABELS: ${{ join(github.event.pull_request.labels.*.name, ',') }}`. The verifier lock itself is M04d.
- **`perf:verify` additions** (extend `tools/ci/perf-verify.ts`, M01c): `--auto` takes the tier from the report's `tier` and the checklist from the path convention `.../<M##>/<device>/perf.json` → `<checklist-dir>/<M##>-<device>.json`; `--checklist-dir <dir>` defaults to `tools/ci/checklists`. A missing checklist under `--auto` fails with `no checklist for <M##>-<device>`.
- **Workflows:**
  - `ci.yml`: `static` adds `pnpm check:agents` and `pnpm check:skills`; new job `device-runs` (paths `docs/device-runs/**`, `docs/device-spike/**`): for each changed `perf.json`, `pnpm perf:verify -- <file> --auto`; `unit` uploads `tests/reports/` as an artifact.
  - `nightly.yml`: full e2e matrix including `@quarantine`; `pnpm check:e2e -- --project=chromium-webgl2 --grep "@determinism|@racing-det|@fighter-hash|@world-hash|@tycoon-det"` and the same on `webkit-webgl2`; `pnpm check:perf -- --fail`; `pnpm deploy:preview -- --sweep-closed`; the `macos-probe` job (`macos-15`, `continue-on-error: true`, informational).
- **`tools/ci/deploy.ts` `preview --sweep-closed`:** lists Previews of `tha-bay-web-staging` and deletes those whose PR (`gh pr view <N> --json state`) is closed; SKIPs without Cloudflare secrets like every deploy mode.
- `.gitignore` adds `tests/reports/`; `tests/reports/README.md` describes the layout (`trace.*`, `milestones.json`, `spec-files.json`).

## Scope out
- `CanonicalRunner`, bot registry, golden store procedure, mutant harness, verifier lock, `econ-sim`: M04d.
- Editing any spec file to make a report pass: findings go to the Architect in the PR report; the Builder never edits `spec/` (except `spec/07-milestones/README.md` status and `spec/11-decision-log*.md` Builder decisions).
- `release.yml` and the `--strict` runs: M14b3.

## Deliverables
- `packages/shared/src/contracts/c15-milestone.ts`; export from `packages/shared/src/contracts/index.ts`.
- `tools/ci/{milestone-lint.ts, trace.ts, spec-files.ts, check-agents.ts, golden-guard.ts, md-parse.ts}`; `tools/ci/perf-verify.ts` (extended); `tools/ci/deploy.ts` (`--sweep-closed`).
- `tools/ci/test/{milestone-format.test.ts, traceability.test.ts, spec-files.test.ts, check-agents.test.ts, golden-guard.test.ts, workflows.test.ts}`.
- Fixtures (data, not counted): `tools/ci/fixtures/milestones/{good-ready.md, bad-missing-heading.md, bad-ac-no-proof.md, bad-unverified-in-ac.md, bad-unknown-script.md, README.md}` with a fixture status table; `tools/ci/fixtures/trace/{uncovered/…}`; `tools/ci/fixtures/agents/{claude-201-lines.md, agents-oversize.md}`; `tools/ci/fixtures/device-runs/M00d/ci-fixture/perf.json` (copy of `ok.json`) and `tools/ci/fixtures/checklists/M00d-ci-fixture.json`.
- `.github/workflows/{ci.yml, nightly.yml}` (extended); `.gitignore`; `tests/reports/README.md`.
- Root scripts: **`check:agents`** (real), **`check:skills`** (pending stub). `check:unit` covers `tools/ci/test/`.
- ≈ 17 code files; fixtures and workflow edits are data.

## Interfaces
- C15 1.0 unchanged; `c15-milestone.ts` carries the 13-qa §4.1 model with `C15_VERSION = '1.0.0'` (proposal noted). No other contract change.
- New tooling APIs (not contracts): `lintMilestones(dir, opts)`, `buildTrace(opts)`, `checkSpecFiles(opts)`, `guard(paths, labels)`.

## Acceptance criteria
- AC-1 Given a clean clone after M01c When install, lint, typecheck, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build`
- AC-2 Given the repository's milestone files and the README status table When the milestone-format test runs Then every READY file (M00 … M01f) passes L1–L7 with zero errors, PENDING files appear in `tests/reports/milestones.json` with their findings as warnings, and the run exits 0 — proof: `pnpm check:unit -- tools/ci`
- AC-3 Given the four bad fixtures marked READY in the fixture status table When the lint runs over the fixture directory Then each fails with exactly its rule (L1 missing heading, L2 AC without proof, L4 `UNVERIFIED` in an AC, L5 unknown script) and `good-ready.md` passes — proof: `pnpm check:unit -- tools/ci`
- AC-4 Given a fixture milestone set in which one R-ID has no milestone When `buildTrace` runs with `strict: true` Then it fails naming that R-ID; given the repository When it runs without strict Then `tests/reports/trace.json` and `trace.md` exist, list every 06 §2 R-ID once, and mark R-IDs covered only by `_PLAN` rows as `planned` — proof: `pnpm check:unit -- tools/ci`
- AC-5 Given fixtures with a 6,001-word spec file, a U-row without a verifying milestone and a kickoff list missing one `_PLAN` id When `checkSpecFiles` runs with `strict: true` Then each produces one failure; on the repository without strict it writes `tests/reports/spec-files.json` and exits 0 — proof: `pnpm check:unit -- tools/ci`
- AC-6 Given the repository When `check:agents` runs Then it exits 0 and prints the line and byte counts of `CLAUDE.md` and `AGENTS.md`; given the 201-line and oversize fixtures Then the unit test sees a non-zero result for each — proof: `pnpm check:agents && pnpm check:unit -- tools/ci`
- AC-7 Given changed paths that touch `tests/golden/world/x.json` When `guard` runs without the `golden-update` label Then it fails, and with the label it passes; a change outside golden paths passes without a label — proof: `pnpm check:unit -- tools/ci`
- AC-8 Given the workflow files When `workflows.test.ts` parses them Then `ci.yml` has `check:agents` and `check:skills` in `static` and a `device-runs` job filtered to `docs/device-runs/**` and `docs/device-spike/**`, and `nightly.yml` runs the determinism grep on both `chromium-webgl2` and `webkit-webgl2`, `check:perf -- --fail` and `deploy:preview -- --sweep-closed` — proof: `pnpm check:unit -- tools/ci`
- AC-9 Given the fixture device run at `tools/ci/fixtures/device-runs/M00d/ci-fixture/perf.json` When `perf:verify --auto` runs with the fixture checklist directory Then it derives tier `mobile-low` and checklist `M00d-ci-fixture.json`, prints one line per assertion and exits 0; the M01c `over.json` still fails at `--tier mobile-low` — proof: `pnpm perf:verify -- tools/ci/fixtures/device-runs/M00d/ci-fixture/perf.json --auto --checklist-dir tools/ci/fixtures/checklists && pnpm perf:verify -- tools/ci/fixtures/perf/ok.json --tier mobile-low`
- AC-10 Given no Cloudflare secrets When the stale-Preview sweep runs Then it prints the SKIP line naming both variables and exits 0, and `check:skills` prints `pending: lands in M13a6` — proof: `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID pnpm deploy:preview -- --sweep-closed && pnpm check:skills`

## Test plan
- **Unit (Vitest, `pnpm check:unit -- tools/ci`):** `tools/ci/milestone-format` (repo + fixtures), `tools/ci/traceability`, `tools/ci/spec-files`, `tools/ci/check-agents`, `tools/ci/golden-guard`, `tools/ci/workflows`, plus the existing M01c `perf-verify.spec.ts` extended with `--auto`.
- **Static:** `pnpm check:agents` in `ci.yml` `static`.
- **Device-runs job:** exercised by the fixture in AC-9; real runs start with M01c's committed reports.
- No e2e change; the deployed app is unchanged, so no deploy AC beyond AC-10.

## Demo script
1. `pnpm check:unit -- tools/ci`; open `tests/reports/trace.md` and `tests/reports/milestones.json`.
2. Copy `tools/ci/fixtures/milestones/bad-unverified-in-ac.md` over a scratch file in a temp directory and run the lint against it: the L4 error names the line.
3. `pnpm check:agents`: counts printed, exit 0.

## Effort
0.5 Builder session; about 17 code files plus fixtures; risk **low**. The parser is the main time sink (two AC forms, nested expectation lists, proofs on trailing lines).

## Risks & fallbacks
- **A READY file fails a rule that 13-qa says it passes.** Do not edit the file (freeze rule). Narrow the parser where the READY text is legitimate (for example a proof chain joined with `&&` inside one backtick pair), log a Builder decision, and list the case in the report for the Architect.
- **Registry parsing of 08 §6** is brittle (script names in prose). Fallback: a checked-in `tools/ci/script-registry.json` generated once from 08 §6 by `trace.ts --emit-registry`, with a unit test that it still matches the table.
- **`gh` unavailable for the sweep** in a local run: `--sweep-closed` without `gh` prints `SKIP deploy:preview --sweep-closed: gh not found` and exits 0.

## Notes for the Builder
- Read first: `spec/domains/13-qa.md` §2.3, §2.6, §3.8, §4; `spec/08-test-and-ci.md` §5.1, §5.5, §6; `prompt-pack/03-SPEC-TEMPLATE.md` §C, §G, §H; `11-platform-perf.md` §4 (`PerfReport`, `DeviceChecklist`).
- The README status table is the only source of a file's status; parse its `| ID | Slug | Sessions | Status | File |` rows. A file whose id is absent from the table is treated as PENDING.
- Report findings about other authors' files as data in the PR body ("lint warnings on PENDING files"); never "fix" a spec file.
- Branch `m00d-qa-spec-gates`. Secrets: none new; the sweep uses `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (CI only) and `GITHUB_TOKEN` for `gh` in the nightly job.

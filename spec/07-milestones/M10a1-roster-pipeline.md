# M10a1 — roster-pipeline

## Goal
After this session the R-NPC-02 character pipeline is an automated CLI. `pnpm assets:gen` gains `plan`, `run`, `gate` and `ledger` next to M05c3's `prewarm`, walking a roster slug through tier check, sheet, crops, portrait and mouth atlas, two mesh candidates, Meshy rig, optimize, retarget, verify and publish, with automated gates A1–A8, recorded human gates H0–H5, `assertStageAllowed` at every stage, and a spend ledger checked against the DL-OWN-01 character line and the program cap. CI runs the chain on `MockFalPort` fixtures only. The operator then runs a live **canary** of two originals, `canary-mc` (Standard) and one Lean Act 1 cast member, within $7.30 of the $42 line (≈ $4.72 planned); its publish PR passes `provenance:check` and `likeness:gate`.

## Requirements
- R-NPC-02: the sheet → mesh → rig → retarget → glTF-in-R2 chain with provenance and QA gates.
- R-NPC-04 / R-IP-02: likeness gates at every stage (`FACE_REF_FORBIDDEN`, `NAME_IN_PROMPT`, `KILLED`, `TIER_UNKNOWN`); no real-person photo reaches any generator.
- R-ENG-03: nothing generates without a cache check, a dry-run estimate and a ledger reservation under the $100 program cap.

## Depends on
- **M05b1**: `GenJobWorkflow`, `FalGateDO`, `BudgetGovernorDO`, `MockFalPort`, `check:pipeline`, the webhook verifier.
- **M06a2**: the C10 compiled soul (`visual_brief`, `heightM`, `tier`, `standIn`, `moves`) and the roster manifest `content/npcs/roster.json` with its R1–R7 rules.
- **M01d**: the catalog, `assets:verify`, `assets:publish`, `assets:lock`, `resolveVariant`, rclone upload.
- **M05c3**: the `assets:gen` entry with `prewarm`, which this milestone extends (DL-219).
- Through M05b1: M00c (spike results and the Meshy bone probe).
- Contracts: C07 1.1 (`GenJob`, `jobKey`, `GateCode`, `ProvenanceRecord`, `LikenessSummary`, pure gate cores, `assetTier`), C10 1.0 (compiled soul fields, roster), C04 1.1 (`bay_rig_v1`, 22 `HUMANOID_BONES`).

## Scope in
- **CLI executor** `tools/assets/gen/` over the `GenJobWorkflow` ports (`FalPort` live via M00c's `fal-queue.ts` or mock, `BlobPort`, `RosterPort`, `BudgetPort`, `VisionPort`, `NamePort`, `ClockPort`); work files in git-ignored `.genai/work/character/<slug>/<stage>/<jobKey>/`, mirrored to `PRIVATE work/` when R2 keys exist.
- **`plan --roster <file> --tier standard|lean|all [--slugs a,b]`.**
  - Prints stages, `jobKey`s, registry price × units estimates and gate verdicts for matching `active` entries; zero vendor calls.
  - Refuses a Standard estimate above 3,730,000 micros (DL-172); lists `research: pending`, non-`ok` verdicts or missing souls as `blocked:<reason>` with the estimate reserved; refuses a batch whose ledger plus estimate exceeds 42,000,000 (character line) or 100,000,000 micros (program).
- **`run --slug <s> --until sheet|mesh|rig [--live]`.**
  - No `--live`: prints the dry-run estimate, exits 0. `--live` without `FAL_KEY`: `SKIP … FAL_KEY not set`, exit 0. Refuses whenever `CI` is set. Runs to the next human gate; a cached `result.json` skips the call; concurrency 2 (`genai.falConcurrency`).
- **`gate --run <id> --gate H0…H5 --choose <n> --by <profile>`:** writes `review[]` and resumes.
- **Stages and gates.**
  - Stages per `05-assets-pipeline.md` §1 (rig 422 → second mesh candidate); gates A1–A8 per §2 with a report beside each output. A1/A2 use `VisionPort` (Haiku 5.5); without `ANTHROPIC_API_KEY` it returns `held` and the human gate decides, recorded.
- **`assets:optimize --slug`** (`05-assets-pipeline.md` §3):
  dedup/prune/weld, animations to `anim/<slug>.base`, `bay_rig_v1` bone names, hi/mid/lo with meshopt and KTX2, `extras.assetId`, hashes.
- **`assets:retarget --rig bay_rig_v1 --clips <glb> --to <slug>`:** `SkeletonUtils.retargetClip` in Node, output `anim/<slug>.moves`, clip name = move id, frame count in `extras`. If an earlier milestone already shipped this command, extend it without changing its flags.
- **`assets:verify --slug`, `assets:publish --slug`:** extend M01d with the per-slug path, the provenance chain (generated root, derived children, `likeness` block), the lock PR and `credits`.
- **`ledger [--line characters|cutscenes|spike|buffer]`:** sums the append-only, repo-audited `assets/ledger/fal-spend.jsonl` (ISO-8601 `Z`), seeded from `research/genai-spike/ledger.json` and `--import <file>` rows (e.g. M05c3 spend from the M05d ledger export); prints the 50/80/100 % alarms.
- **Alias table.** If M00c recorded `research/genai-spike/meshy-bones.json`, `packages/shared/src/rig/bay_rig_v1.json` aliases come from it. If the spike was skipped, `assets:verify --probe-bones` writes the aliases from the canary's first rig output in this PR, for review.
- **Roster data:** `pipeline` per DL-OWN-01 and Q-27: Standard only for fighter-slot souls (`canary-mc` meanwhile), Lean for the Q-27 cast, `none` otherwise incl. stand-ins (DL-180); R7 holds.
- **Canary (operator, live):** `canary-mc` Standard and the first Lean Act 1 cast entry by priority, both `fictionalized` originals (Q-19 open). Every A gate and H gate runs, followed by publish and the lock PR.

## Scope out
- The batch of the remaining Standard and Lean slugs, S07 signature clips, and lock of the full set: M10a2.
- Gate hardening drills, the kill purge workflow and the fighter cutscene prewarm: M10b.
- Souls for real-derived slugs (Q-19, Q-25) and voice designs: M10c (voices stay Workers AI t1; no fal voice, DL-OWN-01).
- Player-triggered generation: none in v1 (DL-175).

## Deliverables
- `tools/assets/gen/{cli.ts, plan.ts, run.ts, gate.ts, ledger.ts, executor.ts, ports.ts, stages/{sheet.ts, crops.ts, portrait.ts, mesh.ts, rig.ts}}`. Extend the existing `prewarm` subcommand only to share `ports.ts` and `ledger.ts`.
- `tools/assets/src/{optimize.ts, retarget.ts}`; extend `verify.ts` and `publish.ts` (M01d).
- `services/pipeline/steps/{character.ts, gates.ts}`: the pure stage and gate logic shared by the Workflow and the CLI. Edit `services/pipeline/src/mock-fal.ts` to add character fixtures.
- `packages/shared/src/assets/gates/{a3-mesh.ts, a4-rig.ts, a5-retarget.ts, a6-budget.ts, a7-visual.ts}` (pure).
- `packages/shared/src/rig/bay_rig_v1.json`: the alias table.
- Fixtures: `services/pipeline/test/fixtures/fal/character/*.json` (recorded responses, JSON only), plus a test helper `tools/assets/test/helpers/mannequin.ts` that builds a procedural skinned GLB with the 22 `HUMANOID_BONES`.
- Tests: `tools/assets/test/{plan.spec.ts, run.spec.ts, ledger.spec.ts, optimize.spec.ts, retarget.spec.ts}`, `packages/shared/src/assets/gates/gates.spec.ts` and `services/pipeline/test/character.pipeline.test.ts` (part of `check:pipeline`).
- `assets/ledger/fal-spend.jsonl`, `content/npcs/roster.json` (pipeline fields), `config/guardrails.yaml` (`genai.lines` caps in micros: spike 10,000,000; characters 42,000,000; cutscenes 40,000,000; buffer 8,000,000).
- Root scripts **`assets:gen`** (extended), **`assets:optimize`**, **`assets:retarget`**, all under the `assets:*` family. `.gitignore` adds `.genai/`.
- `docs/runbooks/roster-batch.md`: the `05-assets-pipeline.md` §12 steps as commands.
- About 38 files.

## Interfaces
- C07 1.1: `GenJob`, `jobKey` (seed mandatory), `GateCode`, `ProvenanceRecord`, `assetTier`, the pure gate cores. Keys follow `characters/<slug>/{model,anim,portrait,mouth_atlas}/` and `<root>/<variant>.<sha256[0:12]>.<ext>`.
- C10 1.0: read-only use of compiled souls and the roster.
- C04 1.1: `bay_rig_v1` and `HUMANOID_BONES`. The alias table is data, not a contract shape.
- No contract shape changes.

## Acceptance criteria
- AC-1 Given `FAL_MODE=mock` and no `FAL_KEY` When the plan runs over the roster Then it prints jobs, `jobKey`s, estimates and gate verdicts for every Standard slug, makes zero `FalPort` calls and zero network requests, and exits 0 — proof: `pnpm assets:gen -- plan --roster content/npcs/roster.json --tier standard`
- AC-2 Given fixtures (a Standard estimate of 3,800,000 micros, a slug with `research: pending`, a killed slug, a ledger at 40,000,000 micros on the character line) When `plan` evaluates them Then the first is refused with the DL-172 message, the second and third are listed `blocked:research` and `blocked:KILLED`, and the batch is refused for exceeding the 42,000,000-micro line — proof: `pnpm check:unit -- tools/assets`
- AC-3 Given `run` without `--live`, with `--live` but no `FAL_KEY`, and with `--live` while `CI=true` When each is invoked Then the first prints the estimate and exits 0, the second prints `SKIP … FAL_KEY not set` and exits 0, the third refuses with a non-zero exit, and none calls `FalPort` — proof: `pnpm check:unit -- tools/assets`
- AC-4 Given the mock character fixtures When the pipeline runs a fixture slug from tier check through publish (human gates answered by fixture decisions) Then every stage writes its gate report, provenance records chain to a generated root, the second run makes zero `FalPort` calls, and a 422 on rig falls to the second mesh candidate — proof: `pnpm check:pipeline`
- AC-5 Given bad fixtures for A3 (triangles 1.2 × target, height 2.4 m), A4 (an unmapped bone, weights summing to 0.9), A5 (hip drift 5 %), A6 (texture 4096²) and A7 (SSIM 0.80) When the gates run Then each fails with its gate id and the good fixture passes — proof: `pnpm check:unit -- packages/shared/src/assets/gates`
- AC-6 Given a `parody`-tier fixture job with a `user_upload` input, a prompt containing a registry alias, and a kill flag set between mesh and rig When `assertStageAllowed` runs at each stage Then the results are `FACE_REF_FORBIDDEN`, `NAME_IN_PROMPT` and `KILLED`, and no later stage starts — proof: `pnpm check:unit -- packages/shared/src/assets/gates`
- AC-7 Given the mock rigged mannequin GLB When `assets:optimize` runs Then hi, mid and lo GLBs exist within the Hero row of `config/asset-budgets.json`, animations are moved to `anim/<slug>.base`, bone names equal `bay_rig_v1` canonical names, and the outputs pass the asset gate — proof: `pnpm check:unit -- tools/assets && pnpm check:assets`
- AC-8 Given a mannequin clip GLB and a fixture character with a different height When `assets:retarget` runs Then the output clip names equal the input move ids, hip drift over a looping idle is ≤ 3 % of `heightM`, and the end pose is within 1 cm of the start — proof: `pnpm check:unit -- tools/assets`
- AC-9 Given the seeded ledger (spike rows plus fixture settles) When `assets:gen ledger` runs Then per-line totals equal the fixture sums, and lines at or above 50 %, 80 % and 100 % print their alarm text — proof: `pnpm check:unit -- tools/assets`
- AC-10 Given the operator's `FAL_KEY` (Q-17), a prepaid balance not above the remaining cap, `ANTHROPIC_API_KEY` for vision QA, and R2 keys When the operator runs `plan`, then `run --live` and the human gates for the two canary slugs, then `assets:optimize`, `assets:verify` and `assets:publish` Then both characters are published with three fidelities, `assets:gen ledger --line characters` shows at most 7,300,000 micros added, and the lock PR passes the IP gates — proof: manual: operator workstation, the `docs/runbooks/roster-batch.md` canary steps, then `pnpm provenance:check && pnpm likeness:gate` on the publish PR
- AC-11 Given the CI workflows When they are inspected by the unit suite Then every job sets `FAL_MODE=mock` and no workflow references `FAL_KEY` — proof: `pnpm check:unit -- tools/ci`
- AC-12 Given the branch with shared pipeline steps changed When the Workers suites run and the Preview deploys Then both pass and the app is otherwise unchanged — proof: `pnpm check:workers && pnpm deploy:preview`

## Test plan
- **Unit:** plan, run guards, ledger, optimize, retarget (`pnpm check:unit -- tools/assets`); gate cores A3–A7 and likeness rules (`pnpm check:unit -- packages/shared/src/assets/gates`); CI-workflow guard (`tools/ci`).
- **Integration (Miniflare plus CLI executor on `MockFalPort`):** `pnpm check:pipeline`.
- **Static:** `check:assets`, `provenance:check`, `likeness:gate` on the publish PR.
- **Operator (manual):** the live canary with ledger evidence.

## Demo script
1. `pnpm assets:gen -- plan --roster content/npcs/roster.json --tier all`: the jobs, estimates and blocked slugs print.
2. `pnpm check:pipeline`: the fixture character runs through every stage, and the second run makes zero calls.
3. Operator: `pnpm assets:gen -- run --slug canary-mc --until sheet --live`, then `pnpm assets:gen -- gate --run <id> --gate H1 --choose 2 --by <profile>`, and so on to publish.
4. `pnpm assets:gen -- ledger`: the spike and canary spend against the $42 line.

## Effort
1 Builder session; about 38 files; risk **high**. Live vendor behaviour (rig 422s, bone names, refusal behaviour) is only partly known, and the canary is the first real test.

## Risks & fallbacks
- **Meshy bone names differ from the alias table** (U-AST-1): use M00c's recorded probe. If the spike was skipped, probe the canary's first rig output with `--probe-bones` and review the generated aliases before publish. A4 never passes on a guessed table.
- **`image_urls` order sensitivity** (U-AST-2): send crops front, left, back, right; if H3 rejects both meshes, a reseed comes from the $8 buffer only with owner sign-off (Q-26).
- **Extra-reference cost** (U7, assumed $0.01): the plan uses registry prices. The ledger records actual settles, and the weekly reconcile against the fal dashboard catches drift.
- **No `ANTHROPIC_API_KEY`:** A1 and A2 become human-held checks, and the review record says so.

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §1–§5, §9, §11–§12; `05-assets.md` §4.5–§4.6, §5; `04-npc-contracts.md` §B5; `research/genai-spike-results.md` (M00c).
- Secrets: `FAL_KEY` (operator or art lead only, Q-17; never CI); `ANTHROPIC_API_KEY` (vision QA); `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (publish). Paid account: fal prepaid credit in tranches never above the remaining cap, auto-recharge off. Owner gates: Q-19/Q-25 (real-derived slugs stay `blocked:research`), Q-26 (buffer), Q-27 (Lean list).
- The §12 runbook's "one `parody`, one `fictionalized`" canary needs the private research layer, so the default pair is two originals.
- DL-OWN-01: CI never runs live fal; every paid command prints its estimate first and needs `--live`.

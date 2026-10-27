# M10b — qa-gates-kill-drill

## Goal
After this session the genAI pipeline is hardened and its kill-switch is drilled end to end:
1. **`KillPurgeWorkflow`** (`services/pipeline/kill`), started by route 46 after the `roster_flag` write, runs `05-assets-pipeline.md` §10 steps 1–9 (targets, `killed` records, quarantine, MEDIA delete, prefix purge, next catalog, probes, scope effects, audit row).
2. **The drill** three ways: a local e2e on `npc_test` with a simulated 24 h clock, a Workers-runtime suite, and a staging run (`test:ops -- --suite kill-drill`) measuring live removal within 60 s and the public purge.
3. **Gate hardening:** a negative fixture per `GateCode`, a re-gate before `record` (kill or consent expiry between stages aborts), and a release check that every fighter and story ref has an in-engine fallback.
4. **Prewarm idempotence** for story and fighter refs (second run, zero calls).
5. **Fighter prewarm** of G2 (8 Shutdown, 8 Showstopper) then G3 face-offs in `content/fighter/cutscenes.json` order, capped at what the $38 cutscene line leaves after Act 1 (38,000,000 micros minus the cutscene ledger and the Act 1 estimate still outstanding; at least 22,000,000, ≈ 27,990,000 with M05c3 at its planned $10.01, enough for G2 and the whole G3 list; DL-209, DL-740, DL-741), only through an ADR-GENAI-01 `cleared` provider; otherwise zero spend and every ref plays its fallback.

## Requirements
- R-NPC-04: the live kill-switch removes a character from play within 60 s and from public storage within 24 h, with stand-ins.
- R-IP-02: likeness enforcement is drilled. Consent expiry and kill state are re-checked before anything is recorded.
- R-CUT-01: fighter clips are generated at most once per key through a cleared provider, stored in R2 and labelled AI-generated (C2PA re-sign).
- R-ENG-03: cache-first prewarm, a second run with zero vendor calls, and a hard cap per allocation line.

## Depends on
- **M10a2**: the published roster assets and `asset_index` tags `char:<id>`.
- **M08b2**: `content/fighter/cutscenes.json`, the fighter refs in `assets:cutscene-index`, the kill-switch remap in select and loadouts, `@fighter-kill`.
- **M06a3**: dialogue-side kill handling (`fallback {reason:'killed'}`). The run order also places M06a1 (route 46, `RosterFlags`, `EncounterDO.kill`) and M05b1/M05c3 (`GenJobWorkflow`, `assets:gen prewarm`, `check:c2pa`) before this milestone.
- **M05c4** (offedge-finish): `prewarm --live`, the `handed_off` state, `--finish` and the Worker publish phase, without which no live prewarm runs on Workers Free (DL-750).
- Contracts: C07 1.1 (`GateCode`, `ProvenanceRecord` status, `asset_index`), C09 1.0 (`CutsceneRef`, `cutsceneKey`, `CutsceneManifest`, fallback), C12 1.1 (route 46 starts the workflow, route 30 `RosterFlags`, route 49 `_test/*` on staging only).

## Scope in
- **`KillPurgeWorkflow`.** Its input is `{npcId, scope[], reason, ticketId}`. Every step is idempotent and the workflow can resume.
  - Targets: `asset_index` rows tagged `char:<npcId>`, `cutscenes.char_ids` and `bark_index`.
  - Quarantine copies go to `PRIVATE quarantine/<ticketId>/` before any delete.
  - Prefix purge is sent in groups of ≤ 100 prefixes per request using `CF_API_TOKEN_CACHE`. When the token is absent the step logs `SKIP … CF_API_TOKEN_CACHE not set` and is marked `skipped` in the audit row.
  - The next catalog is a normal release PR, kept off the 60 s path.
  - Probes expect 404 and `CF-Cache-Status ≠ HIT`.
  - The scope effects are `voice`, `cutscene`, `marketing` and `ugc` (the last two record a pending action for their later owners).
  - The ticket closes with timestamps.
  - A restore runs only through a reviewed PR (`assets:kill --restore`).
- **Route 46 wiring.** After the flag write and the `EncounterDO` broadcast, route 46 starts the workflow. The route shape does not change.
- **`assets:kill --npc <id> --scope all --ticket <id> --stage`.** This is the staging drill CLI. It never runs against production without `--env production` and an explicit confirmation flag.
- **`test:ops` runner** with suite `kill-drill`, run against staging:
  1. kill `npc_test` through route 46 with `OPS_TOKEN`;
  2. poll a QA client's `RosterFlags` refresh and assert the NPC is absent from spawn tables, the roster and the cutscene index within 60 s;
  3. wait for the workflow;
  4. probe the purged prefixes;
  5. restore through the quarantine and confirm the NPC is back.
  - The report goes to `tests/reports/ops/kill-drill.json` and carries at least `env` (`'staging'`), `ranAt` (epoch ms), `removalMs` (measured live removal), `boundMs` (analytic bound, DL-557), the probe results and the restore result; M14b3's `kill-drill` gate reads these fields (DL-480).
  - Workers Previews have no own Workflows, so this suite targets the staging Worker only.
- **Gate hardening** (`packages/shared/src/assets/gates`, `services/pipeline/steps`):
  - one fixture per `GateCode` (13);
  - `assertStageAllowed` at stage entry and again before `record`;
  - a killed scope between stages moves the job to `aborted_killed` with nothing published;
  - a `term_end` passing between stages gives `CONSENT_EXPIRED`;
  - `ks:genai:all`, `ks:fal` and `gov:level` refuse new submits while a cache hit is still served.
- **Release check.** `check:assets` fails a release whose fighter or story refs lack an in-engine fallback (FX6.6).
- **Fighter prewarm.**
  - `assets:gen prewarm --release <tag> --priority 2 --cap-micros <n> [--live]`, where the operator sets `n` = 38,000,000 − the `assets:gen ledger --line cutscenes` total − the estimate that `prewarm --priority 1` (dry run) still lists for Act 1. Act 1's reserve stays whole, and nothing of the $38 line is stranded.
  - Walk G2 then G3 and stop before the running estimate (shots × seconds × $/s × 1.5, plus keyframes for recipe K) would pass the cap.
  - The provider is the first `cleared` one by the A-08 selection rule. With none cleared the run prints `refused: ENDPOINT_NOT_CLEARED`, spends zero, and every ref keeps its fallback.
  - Outputs are re-signed (C2PA) and pass `check:c2pa`.
- **Idempotence suite.** A mock prewarm of the story and fighter refs, run twice, makes zero `FalPort` calls the second time. A roster `run` after M10a2 also makes zero calls.
- **Act 1 prewarm re-run (operator step, DL-232).** Once M10a2's Act 1 Lean sheets are approved, the operator re-runs M05c3's `pnpm assets:gen prewarm --release <tag> --live`, then M05c4's `--finish`, under the same gate (a `cleared` provider) with `--cap-micros` = 16,000,000 minus the Act 1 spend already in the ledger; ready keys are skipped. The result goes into the drill report; no AC asserts live spend.

## Scope out
- Production rails, alerting and guardrail suites T1–T9: M14b1–M14b3.
- Quarterly drill scheduling: M14b2 (`quarterly.yml` runs this `kill-drill` suite on staging). The release gate on the drill's age and removal time: M14b3 (`kill-drill`, DL-480).
- The restore drill for databases: M14b2 (`restore-drill`).
- Generating walk-ins, specials, endings or L2 supers: not funded in v1 (DL-173). They play in-engine.
- Raising the cap: closed (Q-14).

## Deliverables
- `services/pipeline/kill/{KillPurgeWorkflow.ts, targets.ts, purge.ts, probe.ts}`. Edit `services/edge/wrangler.jsonc` to add the Workflow binding, under `previews` too where allowed.
- `services/edge/src/routes/admin/roster-kill.ts`: edit to start the workflow.
- `services/edge/test/kill-purge.test.ts` (suite `kill-purge`) and `services/pipeline/test/{prewarm.idempotence.test.ts, regate.test.ts}`.
- `packages/shared/src/assets/gates/{regate.ts, gates.codes.spec.ts}` and the fixtures `packages/shared/src/assets/gates/__fixtures__/*.json` (13).
- `tools/assets/gen/prewarm.ts`: edit to add `--priority` grouping and `--cap-micros`.
- `tools/assets/src/kill.ts` and the root script **`assets:kill`**.
- `tools/ops/{run.ts, suites/kill-drill.ts}` and the root script **`test:ops`** (`tsx tools/ci/run.ts ops`; `-- --suite <name>`).
- `tools/ci/check-assets.ts`: the fallback rule for every ref in `content/fighter/cutscenes.json` and the story index.
- `tests/e2e/ops/kill-drill.spec.ts` (`@kill-drill`).
- `tests/reports/ops/.gitkeep`.
- `docs/runbooks/kill-switch.md`: drill and restore steps, the quarterly cadence and the 60 s and 24 h targets.
- About 30 files.

## Interfaces
- C12 1.1 route 46: the request and response shapes are unchanged; the workflow instance id is written to the `audit_log` row and the Worker log, not to the response. Route 49 `_test/*` drives the simulated clock in staging and Preview only (`check:prod-routes`).
- C07 1.1 `GateCode` (all 13), `ProvenanceRecord.status: 'killed'`.
- C09 1.0: cutscene keys and manifests are unchanged. A killed character's cutscene keys swap to the DirectorScript fallback.
- No contract shape changes.

## Acceptance criteria
- AC-1 Given a QA build with `npc_test` spawned, its cutscene ref indexed and its prefix served When the drill kills `npc_test` with scope `all` Then within two `RosterFlags` refreshes it is absent from spawn tables, the roster and the cutscene index, its stand-in spawns in its place, an in-progress talk ends with `fallback killed`, and after a simulated 24 h every purged prefix answers 404 — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @kill-drill`
- AC-2 Given Miniflare with fixture rows When route 46 is called Then the workflow starts, copies each target to `quarantine/<ticketId>/` before deleting it from MEDIA, sends purge requests of at most 100 prefixes, writes an `audit_log` row with timestamps, and a re-run of the same ticket changes nothing — proof: `pnpm check:workers -- kill-purge`
- AC-3 Given staging with `OPS_TOKEN` and `CF_API_TOKEN_CACHE` When the staging drill runs Then live removal is measured at 60 s or less (one location suffices because KV is off the live path, DL-557; the report also states the analytic bound `boundMs` = 10 s server cache + 30 s client poll + one request), every probe shows 404 with `CF-Cache-Status` not `HIT`, the restore brings `npc_test` back, and `tests/reports/ops/kill-drill.json` is written with `env`, `ranAt`, `removalMs` and `boundMs`; without the cache token the purge step is reported `skipped` and the suite exits 0 — proof: `pnpm test:ops -- --suite kill-drill`
- AC-4 Given one fixture per `GateCode` When the gate suite runs Then each fixture yields exactly its code; a kill set between `mesh` and `rig` gives `aborted_killed` with nothing recorded; a consent `term_end` passing between stages gives `CONSENT_EXPIRED`; with `ks:fal` on, a new submit is refused while a cached result is still served — proof: `pnpm check:unit -- packages/shared/src/assets/gates && pnpm check:pipeline`
- AC-5 Given mock providers and the story and fighter refs When the prewarm runs twice Then the first run submits only misses and the second makes zero `FalPort` calls; a roster `run` after the M10a2 batch also makes zero calls — proof: `pnpm check:pipeline`
- AC-6 Given a registry where no video provider is `cleared` When the fighter prewarm runs with `--live` Then it prints `refused: ENDPOINT_NOT_CLEARED`, spends zero micros and leaves every ref on its fallback; given a mock `cleared` provider and `--cap-micros 27990000` (38,000,000 minus a fixture ledger holding G1's $10.01), it walks G2 then all 21 G3 face-offs on `h3.partner` prices; with `--cap-micros 22000000` it stops inside G3 before the running estimate passes the cap — proof: `pnpm check:pipeline`
- AC-7 Given a release fixture whose fighter ref has no DirectorScript fallback When the asset gate runs Then it fails naming the ref; the real index passes — proof: `pnpm check:assets`
- AC-8 Given mock prewarm outputs and a fixture rendition without re-sign When the C2PA gate runs Then the re-signed outputs pass and the fixture fails — proof: `pnpm check:c2pa`
- AC-9 Given ADR-GENAI-01 `cleared` for a provider, the operator's `FAL_KEY` and a prepaid balance not above the remaining cap When the operator runs the dry run and then `pnpm assets:gen -- prewarm --release <tag> --priority 2 --cap-micros <n> --live` with `n` computed as in Scope in Then the cutscene line in the ledger after this run plus the Act 1 estimate still outstanding is at most 38,000,000 micros, every generated manifest is written last with `aiGenerated: true`, and a second run makes zero calls; if no provider is cleared, the run records the refusal and zero spend — proof: manual: operator workstation, attach the dry-run output, `pnpm assets:gen -- ledger --line cutscenes` and the second-run log to the PR
- AC-10 Given the branch When the Workers suites and the production-route check run and the Preview deploys Then all pass and no `_test` route exists in the production build — proof: `pnpm check:workers && pnpm check:prod-routes && pnpm deploy:preview`

## Test plan
- **Unit:** gate codes, re-gate (`pnpm check:unit -- packages/shared/src/assets/gates`).
- **Workers and pipeline:** `pnpm check:workers -- kill-purge`; `pnpm check:pipeline` (idempotence, cap, provider refusal, re-gate).
- **E2E:** `@kill-drill` on `chromium-webgl2`; `@fighter-kill` (M08b2) stays green.
- **Static:** `check:assets` fallback rule, `check:c2pa`, `check:prod-routes`.
- **Ops (staging):** `pnpm test:ops -- --suite kill-drill`. It is the first quarterly drill.

## Demo script
1. `pnpm check:e2e -- --project=chromium-webgl2 --grep @kill-drill`: watch the trace as `npc_test` disappears and the stand-in spawns.
2. `pnpm check:workers -- kill-purge`: the step log shows quarantine before delete.
3. On staging: `pnpm test:ops -- --suite kill-drill`, then read `tests/reports/ops/kill-drill.json` (removal time, probes, restore).
4. `pnpm assets:gen -- prewarm --release <tag> --priority 2 --cap-micros 27990000`: the dry run lists G2 and G3 and the estimate; with no cleared provider it prints the refusal.

## Effort
1 Builder session; about 30 files; risk **medium**. The staging drill depends on deployed bindings and tokens. Everything else is CI-provable.

## Risks & fallbacks
- **No cleared provider** (ADR-GENAI-01 owner-gated, Q-03): the fighter prewarm spends nothing, and all 116 fighter refs play in-engine (R-CUT-03). The milestone is complete without generated clips.
- **Tag-based purge** is UNVERIFIED (U-BE-10), so only prefix purge is used.
- **Workflow step limits** (F-024): step results carry keys and counts only, never object bodies.
- **Staging tokens missing:** the staging AC prints `SKIP … <VAR> not set` and lists the missing names. The local e2e and Workers suites still prove the logic.

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §6, §10, §12; `05-assets.md` §5.4–§5.5; `07-fighter-content.md` FX4, FX6; `03-story-cutscenes.md` §D9.1; `04-npc.md` §5.10; `09-backend.md` §8 (route 46, `EncounterDO.kill`).
- **Secrets and gates.**
  - `OPS_TOKEN`: staging admin routes.
  - `CF_API_TOKEN_CACHE`: GitHub repository secret (`08-test-and-ci.md` §8 store rule), also used for the staging drill.
  - `FAL_KEY`: operator only; never CI.
  - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`: deploys.
  - Owner gates: ADR-GENAI-01 provider clearance for any paid prewarm; DL-209, DL-740 and DL-741 give this run the rest of the $38 cutscene line after Act 1, and Q-14 keeps the cap final.
- Order of work:
  1. gate fixtures and re-gate;
  2. the workflow and its Workers suite;
  3. route wiring;
  4. the e2e drill;
  5. prewarm grouping and cap;
  6. the `test:ops` runner;
  7. the runbook.
- **Workers Free (DL-OWN-08, DL-746; `09-backend-ops.md` §1.4).** The fighter prewarm runs M05c4's off-edge path (DL-750): the Worker hands each key off after `copy-orig`, and the operator's `pnpm assets:gen prewarm -- --release <tag> --env prod --finish` transcodes, re-signs and publishes (DL-745); no Container. `KillPurgeWorkflow` steps stay I/O-bound (list, copy, delete, purge calls; 10 ms CPU per step on Free) and the drill's step count stays far inside 3,000 steps a day.
- **Workflow binding.** It needs its own deploy, but it is not a Durable Object class, so `check:do-migrations` does not label this PR `do-lifecycle`. Confirm with the check.

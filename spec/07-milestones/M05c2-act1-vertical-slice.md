# M05c2 — act1-vertical-slice

## Goal
After this session Act 1 is complete and hosted: the v1 vertical slice (A-06, VS-Story) and the R-ROLL-01 anchor. Missions `m.a1.07`–`m.a1.12` join 01–06; all nine Act 1 cutscene refs (§B5) have DirectorScript fallbacks, stage plates pinned by hash, and keys in the Act 1 release index; the sensitivity gate (Q-21) blocks a production release until `content/story/sensitivity.json` records a community read for each tagged mission version; the perf scenario `story-chase` runs in CI; save and resume across reloads is proven in WebKit with racing and fighter reachable as `comingSoon` unlocks and tycoon locked; the build is deployed to staging and passes there; iPhone 15 and Mac device runs record Act 1 missions 1–3. Generated clips are not required: until M05c3 runs on a `cleared` provider, every Act 1 beat plays its in-engine fallback.

## Requirements
- R-MODE-01: the full Act 1 campaign (12 missions, 5 districts, heat 1–4) on the mission system.
- R-MODE-05: unlocks persist across reloads and drive the main-menu tile states.
- R-CUT-02: Act 1 story-beat refs exist with keys and fallbacks.
- R-ROLL-01: hosted single-player story deployed and tested on Cloudflare staging before any multiplayer milestone.

## Depends on
- M05c1 (missions 1–6, cast, unlock defs, shops, melee stub, talk panel, econ Act 1 section), M03b2 (pedestrians and transit set dressing for the night market, hearing and plaza scenes).
- Contracts: C09 1.0, C05 1.1 (`story:auto` slot, `StorySlice.act`, `CoreSlice.unlocks`), C13 1.1 (`PerfScenario 'story-chase'`), C07 1.1 (plate provenance origin `derived`).

## Scope in
- Missions `content/missions/m.a1.{07..12}/` per §B4: 07 Hacker House (D4, `sensitivity-read`, talk `patch` with `trust`/`doubt`, stealth budget 3, `unlock.district.d4`); 08 Dead Pixels (marker 21:00–04:00; follow 15–90 m, lose 25 s; photo; chase catch 6 m hold 3 s); 09 Respray (auto after 08; heat 3; C06 `Respray` at the Dogpatch body shop; escape to heat 0 under the freeway viaduct); 10 Public Comment (D4, `sensitivity-read`; three resident talks setting `hearing_support` 0–3; reach City Hall steps before 17:30 from 15:00, × `timerScale`); 11 Night Market (talk `ATH_SHOOTER` in a lawful stage, despawned after; box in three tow trucks within 240 s); 12 Lot Number One (survive 120 s at scripted heat 4; arrival beat; talk `whitney_arlo`; sets `StorySlice.act = 2` and flag `act1_complete`). Gates, bands and rewards exactly as §B4.
- Cast additions in `content/story/cast.json` (same fields as M05c1): `patch`, `imani_hart`, `res_tran`, `res_moss`, `res_kai`, `whitney_arlo`, `sgt_bell`, and slot `ATH_SHOOTER` with its `original` stand-in.
- Remaining refs in `content/story/act1/cutscene-refs.ts`: `cut.story.m.a1.08.scanner`, `.10.steps`, `.12.lot-one`, `.12.arrival`, with DirectorScripts; "LOT 1" is an in-engine overlay in both paths.
- `pnpm assets:plates [-- --refs act1] [--refresh]` (`tools/assets/plates/`, S03 spec, S05 tooling): renders the first shot of each ref's DirectorScript at 1920×1080 in headless `chromium-webgpu` with `?beats=plate` (actors hidden) from the local SF bake; writes PNGs to `.cache/plates/` and their SHA-256 into `content/cutscenes/plates.lock.json`; uploads to PRIVATE `plates/<sha256>.png` with a provenance record (origin `derived`, tool `assets:plates`, `derived_from` = the rendered `world_pack` sha256s) only when `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are set (else `SKIP assets:plates upload: R2_ACCESS_KEY_ID not set`). Plates are rendered once and pinned: the index reads hashes from the lock, never re-renders, so keys stay stable; `--refresh` is a deliberate re-pin.
- Act 1 release index: `pnpm assets:cutscene-index -- --release act1` writes the nine entries (keys from cast facts, registry pins, seeds, plate hashes), the catalog keys and the private requests for release `act1` (the input of M05c3's prewarm); `--check` compares with the committed index.
- Sensitivity gate: `content/story/sensitivity.json` (`{missionId, version, readBy, readAt}` rows; empty now); `missions:build -- --release` fails when a `sensitivity-read` mission's current version has no row, and warns otherwise; `deploy.yml` production job runs `pnpm missions:build -- --release` before `deploy:prod`, so staging deploys proceed and production waits for Q-21.
- `story-chase` perf scenario (`tests/perf/paths/story-chase.ts`, C13 `PerfScenario`): m.a1.12's survive stage under the autoplayer from a fixed checkpoint, 60 s, on `chromium-webgl2` and `webkit-webgl2` at each flat tier; counts, media MB and memory against `config/tier-budgets.json`.
- Save and resume e2e `tests/e2e/story-resume.spec.ts` (`@story`, `webkit-webgl2` and `chromium-webgl2`): checkpoint resume mid-mission; pass m.a1.03 under the autoplayer, reload, continue; Racing tile unlocked-and-`comingSoon`, Fighter locked until m.a1.05, Tycoon locked.
- Econ: Act 1 section covers all 12 missions.
- Device checklists `tools/ci/checklists/M05c2-{iphone15,mac}.json`: missions 1–3 with touch (iPhone, Home Screen, `mobile-low`) and keyboard/pad (Mac, Safari and Chrome); one beat on each path; reload resume.
- Staging: merge triggers `deploy.yml` to `tha-bay-web-staging`; the report records the staging URL and the `check:smoke` result (R-ROLL-01 gate for M12b1).

## Scope out
- Paid prewarm of the nine refs (≤ $16, ADR-GENAI-01 `cleared`, `FAL_KEY`): M05c3. Ink and LLM talk: M06a3, M10c. Act 2: M05e1.
- The sensitivity read itself (owner, Q-21) and the production tag.

## Deliverables
- `content/missions/m.a1.{07..12}/` (mission, lines, director), `content/story/act1/cutscene-refs.ts` (rest), `content/story/sensitivity.json`, `content/cutscenes/{plates.lock.json, places.json, beats.lock.json}` (entries).
- `tools/assets/plates/{cli.ts, render.ts}`, root script `assets:plates`; `assets/src/data/cutscene-index/*` (Act 1); `services/edge/src/generated/cutscene-catalog.json`.
- `packages/modes/story/src/compiler/sensitivity.ts`, `packages/modes/story/test/sensitivity.test.ts`; `.github/workflows/deploy.yml` (production step).
- `tests/perf/paths/story-chase.ts`, `tests/e2e/story-resume.spec.ts`, `tools/ci/checklists/M05c2-{iphone15,mac}.json`, `config/econ-bands.json` (`act1` full).

## Interfaces
- C09 1.0 and C05 1.1 as defined; `story-chase` is the C13 1.1 `PerfScenario.id` registered by S03. No shape change.

## Acceptance criteria
- AC-1 Given a local SF bake When `check:missions` runs Act 1 Then all 12 missions pass on their three seeds twice, inside their bands, with equal end hashes per seed — proof: `pnpm check:missions -- --act 1`
- AC-2 Given a QA build serving the SF bake When the WebKit test resumes `story:auto` mid-mission after a reload, and separately passes m.a1.03 under the autoplayer, reloads and continues Then the mission restarts from its last checkpoint with the same flags and wallet, `CoreSlice.unlocks` contains `unlock.racing`, the Racing tile shows unlocked and `comingSoon`, Fighter and Tycoon are locked, and the unlock toast showed once — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @story`
- AC-3 Given scenario `story-chase` When the perf runner runs it in fail mode Then render objects, triangles, memory and media MB stay within each flat tier's row on `chromium-webgl2` and `webkit-webgl2` — proof: `pnpm check:perf -- --scenario story-chase --fail`
- AC-4 Given `plates.lock.json` with nine hashes When the Act 1 index is built twice and checked Then it has 9 entries with fallbacks and cues, keys are identical across runs and equal the committed index, no input references `previs/`, and the catalog file lists the nine keys — proof: `pnpm assets:cutscene-index -- --release act1 --check && pnpm check:assets`
- AC-5 Given `sensitivity.json` without a row for `m.a1.10` version 1 When `missions:build -- --release` runs in the test harness Then it fails naming `m.a1.10`; with the row present it passes; a plain `missions:build` only warns — proof: `pnpm check:unit -- packages/modes/story`
- AC-6 Given the Act 1 economy section When the economy suite runs Then the 12 missions total exactly 2,570,000 cents (2,670,000 with the m.a1.05 win), Street Cred 200 and Tech Clout 70, and every band passes — proof: `pnpm check:balance -- --suite econ`
- AC-7 Given the merged branch When `deploy.yml` deploys staging Then the version reaches 100 % after the 0 % smoke and the staging URL passes the smoke check; the report records the URL (R-ROLL-01) — proof: manual: desktop browser, GitHub Actions › deploy › latest run on `main`, read the summary; then `pnpm check:smoke -- <staging-url>`
- AC-8 Given an iPhone 15 Home Screen app on the staging URL at `mobile-low` When the operator plays missions 1–3 with touch, reloads during mission 2 and finishes Then each mission passes, the resume lands on the checkpoint, beats play with subtitles, and `perf.json` passes the judge — proof: manual: iPhone 15, steps in `tools/ci/checklists/M05c2-iphone15.json`, commit `docs/device-runs/M05c2/iphone15/`; then `pnpm perf:verify -- docs/device-runs/M05c2/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M05c2-iphone15.json`
- AC-9 Given an Apple Silicon Mac (Safari and Chrome) on the staging URL When the operator plays missions 1–3 with keyboard and a gamepad Then each passes and `notes.json` records the beat paths and any fallback triggers — proof: manual: desktop Mac, steps in `tools/ci/checklists/M05c2-mac.json`, commit `docs/device-runs/M05c2/mac/`; then `pnpm perf:verify -- docs/device-runs/M05c2/mac/perf.json --tier desktop --checklist tools/ci/checklists/M05c2-mac.json`
- AC-10 Given the twelve missions When the name and likeness gates and the build run Then they pass and the preview deploys — proof: `pnpm names:lint && pnpm likeness:gate && pnpm build && pnpm deploy:preview`

## Test plan
- Bot runs: `pnpm check:missions -- --act 1` (local bake; nightly CI), `pnpm check:balance -- --suite econ`.
- Unit: `story/sensitivity`, index carry-over over the Act 1 refs. E2E: `@story` on `webkit-webgl2` (required) and `chromium-webgl2`.
- Perf: `story-chase` (warn on PRs, fail nightly). Deployed: `check:smoke` on staging. Device: `M05c2-iphone15`, `M05c2-mac`.

## Demo script
1. `pnpm check:missions -- --act 1`: 36 green runs.
2. Open the staging URL, New Game, play m.a1.01 to the Yard; Jobs shows 02.
3. Reload mid-02: the checkpoint resumes.
4. Main menu: Racing reads "Unlocked — coming soon" after 03; Tycoon stays locked.
5. `pnpm missions:build -- --release`: fails on the D3/D4 missions until the read is recorded.

## Effort
1 session; ≈ 36 files (18 are mission, lines and director files); risk medium (bot robustness in pursuit stages; plate rendering on SwiftShader).

## Risks & fallbacks
- `assets:plates` cannot render on the runner or locally (no WebGPU adapter): render on the operator's Mac with `chromium-webgpu` settings, commit only `plates.lock.json`; the index and AC-4 use the lock. If no plate exists for a ref, its `inputHashes` omit the plate and the report lists it (the key changes when a plate is added later).
- Heat 4 in m.a1.12 overwhelms the bot: lengthen the survive route along `pursuitBreakers` tags; do not reduce scripted heat.
- The sensitivity read is not done before release: staging and CI proceed; production stays blocked by design (Q-21). Report it under "Blocked on".

## Notes for the Builder
- Read first: `03-story-narrative.md` §B3–§B5, §B7; `03-story.md` §5, §8–§9; `03-story-cutscenes.md` §D5 (plates), §D9.
- Order: missions 07–12 one at a time with `check:missions -- --mission <id>` → refs and director scripts → plates and index → sensitivity gate → resume e2e → `story-chase` → econ totals → staging deploy → device runs.
- Gates: Q-21 blocks the production release only; ADR-GENAI-01 is not needed here (no spend). Secrets: `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for staging (CI), `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` optional for plate upload (SKIP otherwise).
- Branch `m05c2-act1-vertical-slice`.

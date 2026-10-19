# 08 — Test and CI

> v1.0 · S13 · 2026-10-18. How correctness is proven: test pyramid, device matrix, performance budgets as tests, CI workflows with exact commands, preview and production deploy, secrets, and the oracle of every domain. Design and rationale: `spec/domains/13-qa.md`. Inputs: `prompt-pack/06-SHARED-CONTEXT.md` v1.1 §5, CLAUDE.md (command names are fixed; this file extends them and renames nothing), the READY milestone files M00…M01f, `09-backend-ops.md` §1–§2 and §6, `11-platform-perf.md`, `11-platform.md` §4.5, [research/gap-ci-cd-release-assets.md].

## 1. Rules
1. Every CI step calls one root `pnpm` script; no GUI-only step anywhere (R-ENG-01). A script whose milestone has not landed prints `pending: lands in <milestone>` and exits 0.
2. Only the script names of 06 §5 and names a milestone declares in its Deliverables (for example `names:brand`, `verify:dist`, `fighter:replay`) are used.
3. Assertions are on state (backend, counts, hashes, objectives), never on SwiftShader frame times [research/gap-ci-cd-release-assets.md §4.1].
4. A secret-dependent check prints `SKIP … <VAR> not set` and exits 0 locally; CI makes it required only in the workflow that reads the secret.
5. No acceptance criterion depends on an UNVERIFIED fact; a device run records such items in `notes.json` (C15 1.1 `ManualProof.records`).

## 2. Test pyramid

| Level | Commands | Where | Gate |
|---|---|---|---|
| L1 unit, golden, schema, lint | `pnpm lint`, `pnpm typecheck`, `pnpm check:unit [-- <paths>]` | `ci.yml` `static`, `unit` | every PR |
| L2 deterministic sim, bots, replays | `pnpm --filter @dv/engine test:determinism`, `pnpm check:missions`, `pnpm check:balance`, `pnpm check:fighter`, `pnpm map:races par -- --check` | `ci.yml` `content` | every PR (short), nightly (all seeds and det suites in browsers) |
| L3 integration | `pnpm check:workers [-- <suite>]`, `pnpm check:pipeline`, `pnpm check:db`, `pnpm check:db:types` | `ci.yml` `unit`, `db` | every PR (DB path-filtered) |
| L4 end to end | `pnpm check:e2e -- --project=<p> [--grep @tag]`, `pnpm check:e2e:xr` | `ci.yml` `e2e` matrix | every PR |
| L5 perf, CPU-side | `pnpm check:perf [-- --scenario <id>] [-- --fail]` | `ci.yml` `perf` (warn), `nightly.yml` (`--fail`) | nightly |
| L6 deployed | `pnpm check:headers -- <url>`, `pnpm check:coi -- <url>`, `pnpm check:smoke -- <url>`, `pnpm test:staging [-- <suite>]` | `preview.yml`, `deploy.yml` | preview and deploy |
| L7 device | `pnpm perf:checklist -- <checklist.json>`, `pnpm perf:verify -- <perf.json> --tier <id> [--checklist <f>]` | operator plus `ci.yml` `device-runs` | per milestone listed in §3.3 |
| L8 ops, load | `pnpm test:ops -- --suite <name>`, `pnpm load:rooms -- --bots <n> --minutes <m>` | release candidate, nightly staging | M12c2, M14b1–b3 |

## 3. Device matrix

### 3.1 CI projects (one `playwright.config.ts`, Playwright 1.64.1)

| Project | Engine and flags | Proves | Required from |
|---|---|---|---|
| `chromium-webgl2` | Chromium, no GPU flags; WebGPU adapter is null so three falls back | WebGL2 fallback, all state e2e, `check:headers`/`check:coi` against the local server on port 8788 | M00 |
| `webkit-webgl2` | WebKit 27.2 on Linux (no `navigator.gpu`, no `navigator.xr`) | Safari-engine proxy, iPhone viewport 844 × 390 touch tags, cross-browser hashes | M01a2 (WebKit determinism AC) |
| `xr-quest3` | Chromium + IWER 2.6.0 `metaQuest3`, installed before the renderer with `forceInstall: true`; `grep: /@xr/` | `immersive-vr` session, ≥ 10 XR frames, input mapping, comfort | M01b2 (XR smoke AC) |
| `chromium-webgpu` | `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-vulkan=swiftshader` | WGSL/TSL compile, WebGPU backend path | informational until the M00 `gpu-probe.chromium-webgpu.json` artifact shows backend `webgpu` (U-PLT-19); then required from M02b1 |

Facts: F-062, [research/gap-ci-cd-release-assets.md §4.1–§4.2]. Assertions use `window.__dvBridge` (QA builds only, `VITE_DV_QA=1`).

### 3.2 Physical devices (Q-10 floor, Q-13 availability)

| Role | Device and software | Tier | Used by |
|---|---|---|---|
| iPhone floor | iPhone 15, iOS 26.x then 27.x; Home Screen app and Safari tab | `mobile-low` (30 fps) | M01b2, M01c, M04c, M05c2, M08c2, M11a1–a2, M13a4, M14b3 |
| iPhone primary | iPhone 16 or 17 | `mobile` (60 fps) | M01c, M11a1–a2, M14b3 |
| Quest | Quest 3 and 3S, current Quest Browser | `xr-quest` (72, 90 when p90 < 9 ms) | M01b2, M01c, M11b1–b4, M14b3 |
| Vision Pro | visionOS 26.2+ then 27 | `xr-visionpro` (90, 2 view passes) | M01c, M11b1–b4, M14b3 |
| Desktop A | Apple Silicon Mac, Chrome and Safari 26/27 | `desktop` | M01c, M11a2, M14b3 |
| Desktop B / C | Windows integrated GPU / discrete GPU, Chrome | `desktop` (weak) / `desktop-ultra` | M11a2 (optional; without them `desktop-ultra` stays uncalibrated) |
| Desktop webcam | any desktop with a webcam | — | M08c2 (pose) |

Sources: `11-platform-perf.md` §6; [research/stack-rendering-platform.md rec 18].

### 3.3 Scripted checklist inventory (`tools/ci/checklists/<M##>-<device>.json`, C13 `DeviceChecklist`)

| Milestone | Checklists | Expectations judged by `perf:verify` |
|---|---|---|
| M01b2 | AC-11 iPhone, AC-12 Quest (in-file manual steps) | 5 min touch play at `mobile-low`; Quest `immersive-vr` 60 s |
| M01c | `M01c-{iphone15,iphone16,quest3,visionpro,mac}` | 10-min `graybox-walk`, memory bomb, `persist()`, `DeviceSignals` capture (outputs under `docs/device-spike/M01c/`) |
| M02b1 | `M02b1-mac` (`route-ferry-ocean-beach` on the operator's `sf` bake) | frame formula §4.3, cold download |
| M02b2, M03b1 | `M02b2-iphone15` (sky ≤ 0.3 ms at `mobile-low`, `walk-civic-center`; DL-653), `M03b1-iphone15` (`downtown-rush` ≥ 30 fps); both on an operator-built `DV_WORLD=synth` Preview, because Preview builds stay world-less (DL-235) | frame formula §4.3 |
| M04b2 | `M04b2-iphone15` (creator, HUD, touch layouts, coach mark) | frame formula §4.3 |
| M04c | `M04c-{iphone15,quest3}` | gap-cutscene §7.7 matrix: gesture unlock, Low Power Mode, wake lock |
| M05c2 | `M05c2-{iphone15,mac}` | Act 1 missions 1–3 playable; `story-chase` |
| M07b2 | `M07b2-iphone15` | landscape race at 30 fps; photo save path; tilt opt-in |
| M08c2 | `M08c2-{iphone15,webcam}` | 60 s pose run: p50/p95 latency, delegate, FPS, capability level (`unavailable` is a valid outcome) |
| M11a2 | `M11a2-{iphone15,iphone16,mac,desktopB,desktopC}` | `mobile` and `mobile-low` budgets, 30-min soak, offline relaunch, Low Power Mode, thermals |
| M11b1, M11b4 | `M11b1-{quest3,visionpro}`; `M11b4-{quest3,visionpro}` with the per-mode rows and the S10 XR UI rows (DL-229) | enter/exit, refresh, p50/p95, comfort defaults, 15 s cutscene with subtitles, face-button indices |
| M13a4, M13a5 | `M13a4-iphone15` (`mod-script`), `M13a5-{iphone15,quest3}` (`mods-ui`) | flag stays off until the run passes (DL-146, DL-147) |
| M14b3 | `M14b3-<every device in §3.2>` | release pass: all scenarios of §4.1 at each device's tier |

Results go to `docs/device-runs/<M##>/<device>/{perf.json,notes.json}` (M01c keeps `docs/device-spike/M01c/`). Committing them triggers the `device-runs` job (§5.1).

## 4. Performance budgets as tests (R-ENG-02, C13 1.1)

### 4.1 Scenarios (`PerfScenario.id`)

| Scenario | Path owner · lands | CI runs (projects × `?tier=`) | Asserted in CI | Device |
|---|---|---|---|---|
| `graybox-walk` | S01 path, runner M01c | webgl2 × 4 flat tiers | render objects, triangles, texture/GPU MB, accounted heap; sim tick p99 ≤ 4 ms (nightly only) | M01c |
| `walk-civic-center` | S11 · M02b1 | webgl2, webkit × flat tiers | same | M11a |
| `route-ferry-ocean-beach` | S02 · M02b1 | webgl2, webkit, webgpu | ≤ 1 chunk upload per frame, draw distance = tier value, cold download ≤ tier | M11a |
| `downtown-rush` | S02 · M03b1 | webgl2 | agent counts ≤ tier `Traffic / peds` | M03b1, M11a |
| `story-chase` | S03 · M05c2 | webgl2, webkit | counts, media MB | M05c2 |
| `npc-mission-crowd` | S04 · M06c | webgl2 | brain budget per tier (S04 §9) | M11a |
| `race-sprint`, `race-pursuit-heat4` | S06 · M11a1 | webgl2, webkit | counts with the tier's rival cap (`06-racing.md` §6.2; DL-237) | M11a2 |
| `fight-stage` / `fight-stage-pose` | S07 · M08a2 / M08c2 | webgl2, webkit | counts; `fighter:bench` step p99 ≤ 0.10 ms (Node) | M08c2, M11b2 |
| `xr-walk` | S11 · M11b1 | `xr-quest3`; `?tier=xr-visionpro` per pass on webgl2 | counts per view pass | M11b1 |
| `mod-scene-budget`, `mod-hostile` | S12 · M13a3, M13a4 | webgl2 | scene-op caps, worker budgets | M13a4 |

### 4.2 Thresholds per tier (`config/tier-budgets.json`, mirror of `11-platform.md` §4.5)

| Budget | desktop-ultra | desktop | mobile | mobile-low | xr-quest | xr-visionpro (per pass) |
|---|---|---|---|---|---|---|
| frameBudgetMs | 16.7 | 16.7 | 16.7 | 33.3 | 13.9 | 11.1 |
| Render objects | 900† | 600 | 150 | 100 | 150 | 200 |
| GPU draw cmds (WebGL2 projects) | 3,500† | 2,500 | 500 | 300 | 180 | 300 |
| Triangles | 6 M† | 4 M | 1.0 M | 0.6 M | 0.75 M | 1.5 M |
| Texture MB / GPU MB | 1,500† / 3,000† | 1,000 / 2,000 | 350 / 600 | 250 / 400 | 400 / 700 | 800 / 1,500 |
| Accounted JS + wasm MB | 2,000† | 1,500 | 600 | 450 | 700 | 1,000 |
| Media MB | 256† | 128† | 64 | 64 | 64† | 96† |
| Cold download, first district MB | 60 | 60 | 40 | 30 | 40 | 60 |
| Warm boot to playable s (device) | 8 | 8 | 12 | 15 | 12 | 10 |

† S11 extrapolations, calibrated in M11a2 (desktop) and M11b (XR); until calibrated they run in warn mode only.

### 4.3 Modes and the device formula
- **PR** (`ci.yml` `perf`, from M02b1): `pnpm check:perf` runs every registered scenario (`PERF_SCENARIOS`), writes `test-results/perf.<scenario>.<project>.<tier>.json` and warns; a missing report is a miss (M02b1). **Nightly:** `pnpm check:perf -- --fail` fails on any count, memory or cold-download breach (M01c); required from M11a1.
- **Device:** `pnpm perf:verify -- <perf.json> --tier <id> [--checklist <f>]` passes when median frame ≤ 1.05 × `frameBudgetMs`, p95 ≤ 1.5 ×, frames over 50 ms ≤ `durationS / 60` (XR: frames over 2 × budget ≤ `durationS / 60`), `errors.gpuLost == 0`, boot within the tier row, counts and memory within the tier row, and every checklist expectation holds (`11-platform-perf.md` §5).
- **Other CPU budgets:** room tick p99 ≤ 10 ms with 16 bots for 30 min (`pnpm load:rooms -- --bots 16 --minutes 30`, M12c2); release rollout to 100 % of mobile traffic needs the A03 abnormal-exit rate ≤ 1.5 × the previous build over ≥ 500 mobile sessions [research/gap-observability-cost-guardrails.md Rec 4] (M14b2).

## 5. CI workflows (`.github/workflows/`)

Common: `runs-on: ubuntu-24.04`; actions pinned by SHA; `permissions: contents: read` by default; `concurrency` per ref with `cancel-in-progress` on PR workflows; `timeout-minutes` on every job; checkout with `persist-credentials: false`; setup = `pnpm/action-setup` + `actions/setup-node` (`cache: pnpm`, Node 22) + `pnpm install --frozen-lockfile`; browsers via `pnpm exec playwright install --with-deps chromium webkit` (not cached) [research/gap-ci-cd-release-assets.md R3, §5].

### 5.1 `ci.yml` — on `pull_request`, `push: main`

| Job | Steps (exact commands) | Lands / required from |
|---|---|---|
| `static` | `pnpm lint` · `pnpm typecheck` · `pnpm check:secrets` · `pnpm check:do-migrations` · `pnpm check:api` · `pnpm check:telemetry` · `pnpm check:i18n` · `pnpm check:agents` · `pnpm check:skills` · `pnpm check:rollout` | M00 (lint, typecheck); M00a (secrets, do-migrations; widened by M05b1); M00d (agents, telemetry, rollout; DL-297); M05d (api); M04b1 (i18n); M13a6 (skills) (DL-230) |
| `unit` | restore or build the `synth` and `civic-excerpt` bakes (`.cache/map`, `dist/world/`) · `DV_REQUIRE_BAKE=1 pnpm check:unit` · `pnpm check:workers` · `pnpm check:pipeline` | M00; M00a; M02b1 (bakes); M05b1 |
| `content` | `pnpm map:fixture graybox --check` · `pnpm map:build -- --area civic-excerpt --repro` · `pnpm check:missions` · `pnpm check:balance` · `pnpm check:fighter` · `pnpm map:races validate` · `pnpm check:mods` · `pnpm npc:lint` · `pnpm npc:eval -- --replay` | M02a1 (job, fixture check moved from M01f's `unit` step, `civic-excerpt` bake); M05a2; M04d (econ), M09a2 (tycoon); M08b1; M07a1; M13a6; M06a2; M06a4 |
| `build` | `VITE_DV_QA=1 pnpm build` · `DV_REQUIRE_DIST=1 pnpm check:unit -- apps/web` (M01d, DL-344) · `pnpm check:bundle` · `pnpm check:prod-routes` (bundles the production Worker with `wrangler deploy --dry-run`) · `pnpm check:secrets -- apps/web/dist` · upload `apps/web/dist` (3 days) | M00; M00a (prod-routes, secrets) |
| `ip` (needs `build`) | `pnpm provenance:check` · `pnpm ip:signatures` · `pnpm ip:extensions` · `pnpm ip:strings` · `pnpm license:scan` · `pnpm names:lint` · `pnpm likeness:gate` · `pnpm check:assets` · `pnpm check:c2pa` | M00b (required); `check:c2pa` M05b1 |
| `e2e` (matrix, needs `build`) | `DV_SKIP_BUILD=1 pnpm check:e2e -- --project=${{ matrix.project }}`; the `xr-quest3` leg runs `pnpm check:e2e:xr`; the `chromium-webgl2` leg also runs `pnpm check:headers -- http://localhost:8788` and `pnpm check:coi -- http://localhost:8788`; upload `test-results/`; from M02b1 each leg restores or builds the bakes and runs Playwright twice: `DV_SKIP_BUILD=1` with `--grep "$GRAYBOX_GREP"` on the `build` artifact (no world), then `DV_WORLD=synth` with `--grep-invert "$GRAYBOX_GREP"`; `GRAYBOX_GREP` (`@graybox\|@pack-\|@touch\|@vehicle( \|$)\|@boot\|@fp-tp\|@perf-meter\|@ui-hud`) is defined once at workflow level, identical in `nightly.yml` and equal to the committed `tests/e2e/graybox-grep.txt` that AC proofs read (DL-546, DL-656, DL-680) | M00; M02b1 (bakes, split); required per §3.1 |
| `db` (paths `supabase/**`, `packages/shared/src/db*`) | `pnpm check:db` · `pnpm check:db:types` | M05d |
| `perf` | `DV_WORLD=synth pnpm check:perf` (warn); restores or builds the bakes | M02b1 (DL-346) |
| `device-runs` (paths `docs/device-runs/**`, `docs/device-spike/**`) | for each changed `perf.json`: `pnpm perf:verify -- <file> --tier <tier from file> --checklist tools/ci/checklists/<M##>-<device>.json` | M00d |

Bake-dependent unit suites (from M02a1, DL-545 (a); CI `unit` sets `DV_REQUIRE_BAKE=1` from M02b1) go through `tests/support/require-bake.ts`: without a `dist/world/<area>` bake they print `SKIP <suite>: no bake in dist/world` and pass locally; with `DV_REQUIRE_BAKE=1` (CI `unit`) a missing bake fails.

Dist-dependent unit suites (M01d `apps/web/test/precache.test.ts`) follow the same rule: without `apps/web/dist/sw.js` they print `SKIP precache: apps/web/dist absent` and pass, so `pnpm check:unit && pnpm build` on a clean clone and the `unit` job (which never builds) stay green; the `build` job runs them after the build with `DV_REQUIRE_DIST=1`, where a missing `dist` fails (DL-344).

`pnpm --filter @dv/web verify:dist` (M01a2) runs only as that milestone's AC proof (`pnpm build && pnpm --filter @dv/web verify:dist`); no milestone adds a production-build CI job yet (DL-284).

Required for merge: `static`, `unit`, `content`, `build`, `ip`, `e2e` legs per §3.1, `db` when it runs, `device-runs` when it runs. `perf` is informational on PRs.

### 5.2 `preview.yml` — on `pull_request` [opened, synchronize, reopened, closed]; same-repo PRs only
1. `preview` (`permissions: contents: read, pull-requests: write, deployments: write`; environment `preview`): `VITE_DV_QA=1 pnpm build` → `pnpm deploy:preview` (Workers Preview `pr-<N>` of `tha-bay-web-staging`, M00) → `pnpm check:headers -- --from test-results/preview-url.txt` → `pnpm check:coi -- --from test-results/preview-url.txt` → PR comment with the URL (M00). `check:smoke` runs inside `deploy:prod` (M00a), not on Previews. From M12b1 the rooms Worker gets its own Preview when `services/rooms/**` or `packages/net/**` changed.
2. `cleanup` on `closed`: `pnpm exec wrangler preview delete --env staging --name pr-<N> --skip-confirmation`.

### 5.3 `deploy.yml` — `push: main` → staging; tag `v*` or `workflow_dispatch` by an actor in repo variable `DEPLOY_ALLOWED_ACTORS` → production (M00a)
1. `migrate` (from M05d): `pnpm db:push -- --env <env>` (dry run printed to the job summary first; expand-only migrations).
2. `rooms` (from M12b1, only when `services/rooms/**` or `packages/net/**` changed): `pnpm deploy:prod -- --worker rooms --env <env>` (plain `wrangler deploy`); from M12c1 it runs `pnpm rooms:drain -- --env <env>` first, and production deploys only in the 10:00–12:00 UTC weekday drain window.
3. `web`: `pnpm deploy:prod -- --env <env>` (staging) or `pnpm deploy:prod` (production): `versions upload --tag <sha12> --secrets-file $RUNNER_TEMP/secrets.json` → `versions deploy NEW@0% OLD@100%` → `check:smoke` with `Cloudflare-Workers-Version-Overrides` → `NEW@100%`; from M12a1 production uses `-- --gradual` (10 → 50 → 100 with health polling); any failure → `wrangler rollback OLD`. A PR labelled `do-lifecycle` (by `check:do-migrations`) deploys with `wrangler deploy` alone and records a rollback floor [research/gap-ci-cd-release-assets.md §1.4].
4. `post`: `pnpm check:headers -- <env url>`; production also runs `pnpm test:staging -- smoke` against staging hosts first (M05d+).

### 5.4 `assets.yml` — `push: main` with paths `assets/**`, `tools/assets/**`, `content/**/assets/**`, plus `workflow_dispatch` (`env`) (no owning milestone yet; DL-284)
M01d scopes automatic publishing out to M02a1, and M02a1 keeps it an operator step until the measured bake time fits a runner. Until a milestone adopts this workflow, the operator runs `pnpm assets:publish -- --env <env>` and `pnpm map:pack -- --target r2:<env>` locally with the same secrets; the design below applies when it lands.
`build`: install KTX-Software 4.4.2 (`.deb` with SHA-1 check) → `pnpm assets:catalog` → `pnpm assets:verify` (M01d's catalog builder; DL-230). `publish` (environment `<env>`): rclone 1.75.2 configured from `RCLONE_CONFIG_R2_*` env (no file) → `pnpm assets:publish -- --env <env>` (one `rclone copy --ignore-existing --fast-list --transfers 32 --s3-no-check-bucket` per content class with per-class `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`; HEAD-verify; immutable manifest last) → PR that bumps the pointer in the Worker's static assets. `purge` only on overwrite or kill (prefix purge, `CF_API_TOKEN_CACHE`, from M10b). Never `Content-Encoding: gzip` uploads [research/gap-ci-cd-release-assets.md §2].

### 5.5 `nightly.yml` — cron `17 10 * * *` UTC + `workflow_dispatch` (created by M00b, extended by M00d)
From M02b1 (DL-546) the e2e, det and perf steps first restore or build the `synth` and `civic-excerpt` bakes as `ci.yml` does; the e2e matrix runs the same `GRAYBOX_GREP` split as `ci.yml` `e2e`, and the det grep and `check:perf -- --fail` run with `DV_WORLD=synth`.
`pnpm genai:liveness` (M00b) · full e2e matrix including `@quarantine` · det suites in both engines: `pnpm check:e2e -- --project=chromium-webgl2 --grep "@determinism|@racing-det|@fighter-hash|@world-hash|@tycoon-det"` and the same on `webkit-webgl2` · `pnpm check:perf -- --fail` · `pnpm map:verify` (M02a2, full bake gates) · `pnpm check:balance` · staging keep-alive `pnpm test:staging -- keepalive` (M05d) · stale Preview sweep `pnpm deploy:preview -- --sweep-closed` (M00d; names derived from closed PRs through `gh`, deleted with `wrangler preview delete`, no list command, U-QA-9, DL-658) · media header audit `pnpm check:headers -- https://media-staging.<domain>/<sample>` (M01d) · guardrails `pnpm test:ops -- --suite guardrails-nightly` (T4–T6, T9; M14b2) · `macos-probe` on `macos-15`, `continue-on-error: true`, informational (U-QA-7).

### 5.6 `weekly.yml` and `monthly`
Weekly (`23 9 * * 1`): `pnpm genai:terms-watch` (M14b3; a changed snapshot flips the provider to `pending`) · `pnpm npc:eval -- --live` (M06a4; workspace `ci-evals`, cap $50/month per `09-backend-ops.md` §5.3). Monthly (`41 9 1 * *`): `pnpm genai:price` (M00c; keyed, never live generation). Quarterly (`quarterly.yml`, `29 9 2 1,4,7,10 *`, environment `staging`; M14b2, DL-480): `pnpm test:ops -- --suite kill-drill` (M10b), report uploaded as the artifact `kill-drill` for M14b3's `kill-drill` gate.

### 5.7 Release candidate gate (`release.yml`, `workflow_dispatch` with input `tag`; M14b3)
fetch the newest `kill-drill` artifact of `quarterly.yml` · `pnpm check:unit -- tools/ci` (C15 lint, trace report with zero empty rows, launch-gate record including `kill-drill` ≤ 92 days and ≤ 60 s) · `pnpm test:ops -- --suite guardrails` (T1–T3, T7–T9) · `pnpm ip:history` · `pnpm names:lint` (real side) · `pnpm perf:verify` over every `docs/device-runs/M14b3/**/perf.json` · `pnpm check:smoke -- <staging url>`. A green run is the precondition for the production tag.

## 6. Script registry (root `package.json`)

| Script | Does | Lands |
|---|---|---|
| `dev`, `build`, `lint`, `typecheck` | Vite + `wrangler dev` (QA on); tokens → `vite build` → icons check (the Worker dry-run bundle is `check:prod-routes`, M00a); ESLint (C02 bans, no-GLSL); `tsc --noEmit` | M00 |
| `check:unit [-- <paths>]`, `check:e2e [-- …]`, `check:e2e:xr`, `check:bundle`, `check:headers -- <url>`, `check:coi -- <url>` | Vitest; Playwright; XR project; bundle and asset-count budgets; header and isolation checks | M00 |
| `check:workers [-- <suite>]`, `check:secrets [-- <dir>]`, `check:prod-routes`, `check:do-migrations`, `check:smoke -- <url>`, `check:api`, `check:telemetry` | Workers Vitest pool; secret patterns (`cfat_`, `cfut_`, `cfk_`, `sbp_`, `sb_secret_`, `sk-ant-`, fal); no `/_test/` in prod; DO-lifecycle isolation and label; deployed smoke; API schema drift; telemetry privacy and registry | M00a; `check:telemetry` M00d, `check:api` M05d (both scoped out of M00a; DL-230) |
| `provenance:check`, `ip:signatures`, `ip:extensions`, `ip:strings`, `license:scan`, `names:lint`, `names:brand`, `likeness:gate`, `check:assets`, `genai:liveness` | IP and provenance gates (`05-assets-pipeline.md` §9) | M00b |
| `reuse:subset -- [--root <dir>] <entry> <allowedPath> <upstreamFile>` | operator tool: writes a `third_party/<name>/<path>.subset.json` (under `--root`, default the repository) from an allowlisted field list at vendoring, refusing fields that match the register's `excludedFieldPatterns` or fail its value rule (DL-502, DL-648, DL-649); `license:scan` gains the `third_party/` register rules and the Mapbox scan, `build` the licences file and `check:bundle` the module-id rule in the same milestone | M00f (DL-605, DL-616, DL-618) |
| `reuse:clones` | token-level clone check (≥ 50 tokens) between vendored `kind: 'code'` files under `third_party/` and every git-tracked source file outside `third_party/`, `tools/ci/fixtures/**`, `spec/`, `research/`, `prompt-pack/` and `docs/` (at least `apps/`, `packages/`, `services/`, `tools/`, `skills/`; DL-648); fails a match in a file without a resolving "Portions from" header; no-op without `third_party/`; CI `static` | M00f (DL-616) |
| `genai:spike`, `genai:price` | budget-capped spike (≤ $10, DL-OWN-01); price drift | M00c |
| `check:perf [-- --scenario <id>] [-- --fail]`, `perf:verify`, `perf:checklist` | CPU-side budgets; device report judge; checklist printer | M01c (`--scenario`: M02b1, DL-346) |
| `assets:*`, `check:c2pa` | catalog, verify, lock, publish, seed, credits (M01d); `assets:cutscene-index` (M05b2); `assets:gen` with `prewarm` (M05c3), `plan`/`run`/`gate`/`ledger` (M10a1); `assets:optimize`, `assets:retarget` (M10a1); `assets:pose-vendor` (M08c1); `assets:final` placeholder scan (M10d2, DL-390; audio rules 4–5 M10e, DL-500); C2PA on shipped clips (M05b1) | DL-230 |
| `map:fixture`, `map:build`, `map:verify`, `map:landmarks`, `map:races`, `map:fetch`, `map:pack`, `map:pois`, `map:geocode`, `map:resolve`, `map:webtiles` | world fixture, bake, gates, landmark seeds and recipes, race compile/validate/par; bake sub-steps of `02-world-bake.md` §3; geocoder; web tiles | M01f, M02a1 (`map:fetch`, `map:pack`), M02a2 (`map:verify`, `map:pois`, `map:resolve`, `map:landmarks` seeds; recipes M02d1), M02c2 (`map:geocode`), M07a1, M13b2 (`map:webtiles`); `map:diff` of `02-world-bake.md` §3 is post-v1 (DL-230) |
| `check:agents`, `check:rollout [-- --branch <name>]`, `check:skills` | instruction-file sizes; R-ROLL-01 order gate on rooms branches (DL-297); skills mirror equality | M00d; M13a6 (`check:skills`) |
| `check:balance [-- --suite econ\|tycoon]`, `tycoon:sim`, `tycoon:baseline` | Monte-Carlo bands | M04d (econ), M09a2 |
| `missions:build`, `missions:preview`, `check:missions [-- --mission <id> \| --act <n>]` | mission IR compiler, preview, autoplayer gate | M05a1, M05a2 |
| `check:pipeline`, `check:db`, `check:db:types`, `db:push` | pipeline with `MockFalPort`; pgTAP and lint; generated types diff; migrations | M05b1; M05d |
| `npc:*` (`npc:lint`, `npc:eval`, …) | soul lint, compile, evals | M06a2, M06a4 |
| `check:fighter` | kit lint, roster completeness, golden replays, 28 × 100 balance smoke | M08b1 |
| `test:staging [-- <suite>]`, `test:ops -- --suite <name>`, `load:rooms` | staging suites (`keepalive`, `smoke`, `npc-cache`, `rls-thirdparty`); guardrails, kill drill; room load | M05d (grows in M06a3, M12a1); M10b, M14b1; M12c2 |
| `auth:tpa`, `rooms:drain` | Supabase third-party auth registration; drain before rooms deploy | M12a1; M12c1 |
| `check:mods`, `check:i18n` | example mods, `dv --help` smoke, KB check; missing-translation report | M13a6; M04b1 |
| `deploy:preview`, `deploy:prod [-- --env staging] [-- --worker rooms] [-- --gradual]`, `deploy:bootstrap` | deploy modes of `tools/ci/deploy.ts` | M00, M00a, M12b1, M12a1 |
| `ip:history`, `ip:similarity`, `genai:terms-watch` | full-history scan; clean-room clone check (Zone R); terms snapshots | M14b3 |

Package-local `pnpm --filter @dv/<pkg> <script>` is allowed when `check:unit` (or the named `check:*`) also runs it. A package script that takes arguments goes through `tools/ci/run.ts` like a root script (`test` = `tsx <rel>/tools/ci/run.ts vitest run --pkg packages/<pkg>`, which selects the matching specs under `packages/<pkg>/test/` from the repo root; M01a1, corrected by M02b2, DL-674), because a plain `vitest run` ignores the filter after pnpm's `--`.

## 7. Deploy and publish details
- **Workers.** `tha-bay-web` (+ `-staging`) from M00; `tha-bay-rooms` (+ `-staging`) from M12b1. First creation of each Worker is `pnpm deploy:bootstrap` by the operator with an Admin token; `versions upload` cannot create a Worker [research/gap-ci-cd-release-assets.md §1.4].
- **Previews** hang off the staging Worker; bindings are repeated under `previews` (not inherited); queue, cron and Workflow features are exercised through `/api/v1/_test/*` routes, compiled out of production (`check:prod-routes`) [F-061].
- **DO migrations.** A PR that adds or renames a DO class changes nothing else, is labelled `do-lifecycle` by `check:do-migrations`, deploys with `wrangler deploy`, and sets a rollback floor; tags `web-v1` (M05b1), `web-v2` (M06a1), `rooms-v1` (M12b1) (`09-backend-ops.md` §1.2).
- **Version affinity.** The zone Transform Rule that sets `Cloudflare-Workers-Version-Key` from a cookie exists before the first gradual split (M12a1, needs Q-15 domain); `*.workers.dev` cannot carry it.
- **Supabase.** `db:push` = `supabase link` → `db push --dry-run` → `db push`; migrations 0001–0009 land with their milestones (`09-backend-db.md` §2); staging project kept alive nightly.
- **R2.** Buckets from `config/cloudflare.resources.json` (DL-OWN-02): `tha-bay-media-{staging,prod}`, `tha-bay-private-{staging,prod}`; UGC and evidence buckets are created by M06b2/M13a2/M13d1. The world and catalog pointers ship inside the Worker's static assets, so a pointer flip is a versioned deploy; KV is never the switch [research/gap-ci-cd-release-assets.md §2.2].
- **Rollback.** `pnpm exec wrangler rollback <id> --message <reason>` within the last 100 versions, never across a DO lifecycle change.

## 8. Secrets by environment variable name (values never committed)

**Store (U-QA-6 resolved):** every CI secret is a GitHub **repository** secret (as `CLAUDE.md` says). On GitHub Free, environment secrets work only in public repositories, and required reviewers and wait timers only in public repositories on Free, Pro and Team [research/gap-ci-cd-release-assets.md §1 item 9, §6, verified row "Required reviewers … environment secrets public-only on GitHub Free"]; the repository's visibility and plan are open (Q-15). Where staging and production need different values, the repository secret carries a `_STAGING` or `_PRODUCTION` suffix and the workflow maps it onto the plain name per step [same file §1.3]. Jobs keep their `environment:` keys for deployment records. Secrets move into environment scope only after Q-15 confirms a public repository or a Team/Enterprise plan; that move is an Architect DL entry.

| Name | Holder | Purpose | From |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secrets (§8 store rule); shell locally | Workers deploy, previews (Workers Editor scope) | M00 |
| `DV_NAMES_REAL_JSON` | GitHub, CI only | real-side name registry for `names:lint` | M00b |
| `FAL_KEY` | operator / art lead only (Q-17); Worker secret for the production pipeline (M05c3); never CI | spike, live prewarm and paid batches with `--live`; CI runs `FAL_MODE=mock` | M00c, M05c3, M10a1 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | GitHub repository secrets, `_STAGING`/`_PRODUCTION` suffixed (bucket-scoped); Worker secret for presigning from M06b2 | rclone publish, presign | M01d |
| `R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY` | operator shell only (R2 API token scoped to `tha-bay-private-{staging,prod}`; DL-287) | `map:fetch -- --archive` raw snapshot upload | M02a1 |
| `SOCRATA_APP_TOKEN` (optional) | operator shell only | DataSF Socrata requests in `map:fetch`; absent → unauthenticated | M02a1 |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` | GitHub repository secrets, `_STAGING`/`_PRODUCTION` suffixed where they differ | `db:push`, `auth:tpa`, staging tests | M05d |
| `ANTHROPIC_API_KEY` | Worker secret (workspace `npc-runtime`) | dialogue; `test:staging -- npc-cache` | M06a3 |
| `ANTHROPIC_BUILDER_KEY` | Worker secret (workspace `npc-builder`) | builder soul generation and preview (`09-backend-contracts-1.1.md` §3; DL-231) | M06b1 |
| `ANTHROPIC_EVALS_KEY` | GitHub secret (workspace `ci-evals`) | weekly `npc:eval -- --live` (DL-231) | M06a4 |
| `CF_API_TOKEN_CACHE` | GitHub repository secret | prefix purge on kill or overwrite | M10b |
| `ANTHROPIC_ADMIN_KEY`, `FAL_KEY_BILLING`, `ALERT_HMAC`, `ALERT_WEBHOOK_URL` | Worker secrets | recon cron, guardrail config checks, alert sink | M14b1 |
| Worker secrets `PLAY_TOKEN_HMAC` (from M04b3, route 5 mint; DL-231), `QUOTA_NET_SALT_SECRET` · `SUPABASE_SECRET_KEY` · `ID_SIGNING_JWK_CURRENT`, `ID_SIGNING_JWK_NEXT`, `TURNSTILE_SECRET` · `ROOM_TICKET_HMAC`, `ROOM_RESUME_HMAC`, `INTERNAL_HMAC` · `OPENAI_MODERATION_API_KEY` · `ELEVENLABS_API_KEY` · `OPS_TOKEN` · `OPENAI_OIDC_CLIENT_SECRET` · `NCMEC_API_CREDENTIALS`, `PHOTODNA_KEY` | `wrangler versions upload --secrets-file` from GitHub repository secrets (§8 store rule); `.dev.vars` locally | per `09-backend-ops.md` §6 | M06a1 (`QUOTA_NET_SALT_SECRET` optional from M00e) · M00e (optional), M05d · M12a1 · M12b1 · M06b1 · M06a4 (t2 off) · M05b1 (removed M12a1) · M13c1 (flagged) · M13d1 |

Repo variable (not secret): `DEPLOY_ALLOWED_ACTORS` (M00a). Worker vars (not secrets, in `services/edge/wrangler.jsonc`): `AUTH_PASSWORD_SIGNUP` (production `"off"`, staging `"on"`, absent in previews; M00e) and `LEGAL_CONTACT` (operator-supplied contact, never set by a Builder; M00e). Name conflicts resolved here (DN-S13-03): the moderation key is `OPENAI_MODERATION_API_KEY` (CLAUDE.md wins over `09-backend-ops.md` §6), and the deploy token is `CLOUDFLARE_API_TOKEN` (ops' `CF_API_TOKEN_DEPLOY` is that token); `CF_API_TOKEN_CACHE` is the only extra Cloudflare token.

## 9. Oracles per domain

| Domain | Oracle | Command |
|---|---|---|
| S01 engine | detmath vectors; 10,000-tick state-hash traces equal in Node, Chromium, WebKit; scripted lines; save golden files; `save-kill` | `pnpm --filter @dv/engine test:determinism`, `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism`, `pnpm --filter @dv/engine test:save` |
| S02 world | fixture byte-identity; bake gates (baked buildings ≥ 98 % of the locked `ynuv-fyni` row count, DL-288; graph ≥ 98 % connected); teleport and map accuracy; traffic hash cross-browser | `pnpm map:fixture graybox --check`, `pnpm map:verify`, `pnpm check:e2e -- --project=webkit-webgl2 --grep @world-hash` |
| S03 story | mission autoplayer on 3 seeds with equal end hashes; cutscene key vectors; fallback within 2.5 s | `pnpm check:missions`, `pnpm check:e2e -- --project=chromium-webgl2 --grep @cutscene` |
| S04 NPC | soul compile twice → equal sha256; recorded-upstream SSE order; 4 s fallback; quota; replay evals | `pnpm check:workers -- npc`, `pnpm npc:eval -- --replay` |
| S05 assets | provenance join; bad fixtures fail; second pipeline run makes zero `FalPort` calls; kill drill | `pnpm provenance:check`, `pnpm check:pipeline`, `pnpm check:e2e -- --grep @kill-drill` |
| S06 racing | handling oracle lines; exact replay (`finishTick`, `gateTicks`, `endHash`); par within ±15 %; V1–V15 | `pnpm --filter @dv/mode-racing test`, `pnpm map:races par -- --check`, `pnpm map:races validate` |
| S07 fighter | golden `.dvfight` checkpoint hashes; motion-parser fixtures; balance 35–65 %; pose fixtures ≥ 90 %; no image bytes leave | `pnpm --filter @dv/mode-fighter fighter:replay -- golden/vs-001.dvfight`, `pnpm check:fighter`, `pnpm check:e2e -- --grep @pose` |
| S08 tycoon | finance vectors TV-1…TV-11, WF-1…WF-7; `verifyRun` replay; bands B1–B12 with failing self-tests | `pnpm check:unit -- packages/shared/src/tycoon/finance`, `pnpm check:balance` |
| S09 backend | Workers-runtime suites (single-flight, poll fallback, forged id, refresh reuse, NCII clock); pgTAP; codec fuzz; guardrails T1–T9; load | `pnpm check:workers`, `pnpm check:db`, `pnpm test:ops -- --suite guardrails`, `pnpm load:rooms` |
| S10 UI | screen parity; keyboard/gamepad/touch menu flows; axe zero critical/serious | `pnpm check:unit -- packages/ui`, `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y` |
| S11 platform | headers and isolation after SW reload; `gpu-probe.json`; tier ladder; budgets; device reports | `pnpm check:coi -- <url>`, `pnpm check:perf -- --fail`, `pnpm perf:verify` |
| S12 modding | deterministic pack; sandbox security suite; 4007 refusal; skills mirror; `--prove-oracle` | `pnpm check:unit -- packages/shared/src/mod`, `pnpm check:workers -- mods`, `pnpm check:mods` |
| S13 QA | C15 lint; trace report; mutants; verifier lock | `pnpm check:unit -- tools/ci`, `pnpm check:agents` |

## 10. Facts and UNVERIFIED
Facts: F-013, F-016, F-061, F-062; [research/gap-ci-cd-release-assets.md §1.4, §1.5, §2, §4, §5, §6, R3]; `11-platform.md` §4.5 (budgets are engineering targets). UNVERIFIED and recorded, never asserted: U-PLT-19 (SwiftShader on the runner), U-BE-20 (`wrangler deployments status --json` fields), U-QA-3/4 (load bot client and PoPs), U-QA-5 (`ip:similarity` tool), U-QA-7 (macOS Metal), U-QA-8 (`_headers` on Preview URLs).

# M02f1 — stream-measure

## Goal
After this session a world boot can be measured. `FetchRetry` counts requests in flight, and every world boot reports its pack requests, bytes, time from world-boot start to reveal, request waves and peak requests in flight, to the bridge, the perf report and a read-only `data-dv-boot` attribute that production builds also write. A new perf scenario, `boot-cityhall`, records them in CI; a QA-only `?net=<profile>` shaper slows the pack layer on purpose so a test can show what latency does to the boot. A device checklist measures a cold boot of the real `sf` world on staging after M02c2 AC-14 and records U-W8, restated as "per-pack GETs through the Worker media route reach the reveal within the tier's boot budget", so the Architect can decide whether a faster delivery lever is needed (DL-109, DL-713). This re-implements the measurement ideas of study proposal GV-07 in our own design.

## Requirements
- R-ENG-02: boot cost becomes a reported, schema-checked figure with automated invariants in `check:perf`, and a device step that judges it against the tier's boot budget.
- R-PLAT-01: the cold boot of the primary mobile target (iPhone) is measured on the Cloudflare-hosted staging build.
- R-ENG-01: deterministic scripts measure it (`check:perf -- --scenario boot-cityhall`, the `?net=` e2e); only the staging run is manual.

## Depends on
- **M02b1** (streaming-lod): `prepareWorld` and `WorldView` (`packages/world/src/client/{boot-world.ts, world-view.ts}`), `BootReport`, `bytesBeforeReveal`, the reveal on the first L0 upload, `@world-boot-size`, `tests/perf/perf-budget.spec.ts`, `config/perf/scenarios.json`.
- **M01d2** (media-route): staging serves packs from `<staging-url>/media/…`.
- **M02c2** (maps): its AC-14 operator release is what puts the `sf` world on staging (`config/world/release.json` `staging: "sf"`). Only AC-8 waits on it.
- Through those: M01e (`FetchRetry`, `Lanes`, `AssetService.wrapFetch`, the asset RPC) and M01c (`PerfScenarioRunner`, `perf-check.ts`, `perf-verify.ts`, `perf-checklist.ts`, `tools/ci/schemas/perf-report.v1.json`, `parseQaFlags`).
- Contracts: C13 1.1 (`PerfReport`, `QaFlags`), C07 1.1 and C08 1.0, both read only.

## Scope in
- **In-flight counter** (`packages/engine/src/assets/store/fetch-retry.ts`). `FetchStats` gains three fields:
  - `inflight`: network requests whose lane task is running, counted per URL, with backoff waits and Range slices included;
  - `inflightPeak`: the highest `inflight` since construction or since the last `resetPeak()`;
  - `waves`: the number of times `inflight` rose from 0 to 1.

  `resetPeak()` sets `inflightPeak` to the current `inflight`. A joined request never counts twice. `Lanes.peak` is per lane and session-wide, so it cannot give these figures.
- **Asset RPC** (`packages/engine/src/assets/{rpc.ts, service.ts, client.ts, bridge.ts}`). `StatsResult` gains `inflightPeak` and `waves`. The `stats` op takes `{ resetPeak?: boolean }`. `InitParams` gains `net: string | null`.
- **Boot figures** (`boot-world.ts`, `world-view.ts`):
  - At its start, `prepareWorld` takes `performance.now()` as `bootStartMs` and calls `stats({ resetPeak: true })` as the base. Both go to `WorldView`, next to the existing `bytesBase`.
  - At the reveal, `BootReport` gains `bootRevealMs` (reveal minus `bootStartMs`) plus `requests`, `bytes`, `waves` and `inflightPeak`, each the change since the base (the peak is absolute after the reset). Each is `null` until known. `bytes` equals `bytesBeforeReveal`.
  - In every build, `document.documentElement.dataset.dvBoot` is set to the JSON `{tier, requests, bytes, revealMs, waves, inflightPeak}`. It holds no ids and no positions.
- **Perf report** (`packages/shared/src/platform/perf.ts`, `perf-report.v1.json`, `scenario-runner.ts`):
  - `PerfReport.boot` gains the optional fields `requests?`, `bytes?`, `revealMs?`, `waves?` and `inflightPeak?`. The schema adds them as optional, non-negative integers and keeps `additionalProperties: false`.
  - `WorldScenarioDriver.finish()` may also return `boot`; the runner copies it into the report.
- **`boot-cityhall` scenario**:
  - The path file `config/perf/paths/boot-cityhall.json` is a 30 m loop around the `lm.city-hall` arrival area (ENU origin): `speedMps` 1.5, `durationS` 20, `warmupS` 2, `density` `off`, seed `0xB007`. Starting at the spawn means `prepare()` streams nothing new.
  - Register it in `SCENARIO_PATHS` and `SCENARIO_PATH_REFS`, and add it to `config/perf/scenarios.json`.
  - `tools/ci/perf-check.ts` gains `BOOT_SCENARIOS = ['boot-cityhall']` and `verifyBoot(file, tier)`. The checks:
    - all five fields are present;
    - `requests` ≥ 2, `bytes` > 0, `revealMs` > 0 and `waves` ≥ 1;
    - 1 ≤ `inflightPeak` ≤ the lane sum of the report's `device.class` (`laneLimits`: 26 for `desktop`, 18 otherwise; the class, not the forced tier, sets the lanes);
    - `bytes / 1e6`, rounded to two decimals, equals `coldDownloadMB`.

  Network times are recorded and never judged in CI, because `check:perf` judges CPU-side counts only.
- **QA network shaper** (`packages/engine/src/assets/store/net-shaper.ts`, new; profiles in `config/perf/net-profiles.json`, new, `{"schema": "net-profiles/1", "profiles": {…}}`):
  - `createNetShaper(profile, { now, sleep })` returns `wrap(inner: FetchFn): FetchFn`. The wrapped fetch first waits `latencyMs` (abortable), then calls `inner`.
  - When `bytesPerSec` is set and the response is ok, it reads the body, then:
    - takes `start = max(now(), cursor)` from one cursor shared by all of the shaper's requests;
    - sets `cursor = start + ceil(bytes × 1000 / bytesPerSec)`;
    - waits until `cursor`, then returns `new Response(body, {status, statusText, headers})`.
  - Non-ok responses and `bytesPerSec: null` profiles return after the latency only.
  - Every error message it throws contains the marker `dv-net-shaper`.
  - The profile values are our own design values, not claims about real networks:
    - `home` (20 ms, 6,000,000 B/s);
    - `cell` (120 ms, 1,000,000 B/s);
    - `poor` (400 ms, 150,000 B/s);
    - `lag` (400 ms, `null`).
- **Flag plumbing.** `parseQaFlags` reads `?net=<id>`, accepted only when it is one of the profile ids, otherwise `null`; `NO_QA_FLAGS.net` is `null`. `create-platform.ts` passes `net` in `InitParams`, and only when `import.meta.env.VITE_DV_QA === '1'`. `AssetService.init` loads the shaper by dynamic `import()` inside the same compile-time check and applies it with `wrapFetch`, so production bundles never contain it. Only pack fetches are shaped.
- **Bundle gate** (`tools/ci/check-dist.ts`). `NET_SHAPER_IDS = ['dv-net-shaper']`, checked like `QA_HARNESS_IDS`: a production build must hold none, a QA build must hold all.
- **Staging checklist** (`tools/ci/checklists/M02f1-staging.json`, new, valid `DeviceChecklist`). `urlTemplate` is `https://<preview>/`, filled by `--url <staging-url>`, and `upload` is `["notes.json"]`. Steps:
  1. Confirm `docs/bake-runs/M02c2/staging.json` exists and `config/world/release.json` names `staging: "sf"`.
  2. Desktop Chrome on an Apple Silicon Mac, in a new guest profile: start free roam. After the reveal, record `JSON.parse(document.documentElement.dataset.dvBoot)` as `desktop.cold`.
  3. In the `asset.worker` console context, run the step's snippet: count of `/media/` Resource Timing entries, p50 and p95 of `responseStart − requestStart`, the `nextHopProtocol` values, as `desktop.media` (informational).
  4. Reload and record `desktop.warm`.
  5. iPhone 15 Home Screen app via the Mac's Web Inspector: steps 2 and 3 as `iphone.cold` and `iphone.media` (step 3 if a worker context is offered); note the network type.
  6. Write `uw8: {desktop, iphone}`. Each value is `pass` when `revealMs` ≤ 1000 × that tier's `boot.warmBootToPlayableS` (`config/tier-budgets.json`), otherwise `fail`. Save to `docs/device-runs/M02f1/staging/notes.json`.
- **Wording fix.** Step `3-notes` of `tools/ci/checklists/M02b1-mac.json` records render cost under its own name, not under U-W8, and points to this checklist for U-W8.

## Scope out
- The main-menu boot-set prefetch: M02f2 (study proposal GV-04), which may record these figures. The CI `bootset.<mode>.json` emission is retired (DL-726).
- Edge caching (the conditional M01d4), a static boot bundle or a batch route: the lever order of DL-722 applies after AC-8 (DL-109, DL-713, DL-723).
- Offline reload from a cached catalog: M11a2.
- Shaping the shell, the catalog, the boot config or `/api/v1/*`; any server-side pacing or rate limit (DL-713).
- Device frame time and the governor: M11a1–M11a2. Boot figures in telemetry, which would be a C16 change, are not part of this milestone.

## Deliverables
- `packages/engine/src/assets/store/{fetch-retry.ts, net-shaper.ts}`; `packages/engine/src/assets/{rpc.ts, service.ts, client.ts, bridge.ts}`.
- `packages/engine/src/platform/{qa-flags.ts, create-platform.ts, perf/scenario-runner.ts}`; `packages/shared/src/platform/{perf.ts, c13.ts}` (`C13_VERSION` `'1.2.0'`, DL-725); `config/tier-budgets.json` (`c13` `'1.2.0'`).
- `packages/world/src/client/{boot-world.ts, world-view.ts}`.
- `config/perf/{scenarios.json, net-profiles.json, paths/boot-cityhall.json}`; `tools/ci/schemas/perf-report.v1.json`; `tools/ci/{perf-check.ts, check-dist.ts}`; `tools/ci/checklists/{M02f1-staging.json, M02b1-mac.json}`.
- Tests:
  - `packages/engine/test/assets/{fetch-retry.spec.ts, net-shaper.spec.ts}`;
  - `packages/engine/test/platform/config.spec.ts`;
  - `tools/ci/test/{perf-check.spec.ts, check-bundle-harness.test.ts}`;
  - `tests/e2e/world-boot-figures.spec.ts` (tags `@world-boot-figures`, `@net-shaper`).
- BD rows in `spec/11-decision-log-builder.md`.
- About 30 files. No new `pnpm` script.

## Interfaces
- C13 1.1 → **1.2 (additive, accepted by DL-725)**:
  - `PerfReport.boot` adds the optional `requests`, `bytes`, `revealMs`, `waves` and `inflightPeak`;
  - `QaFlags` adds `net: string | null`.

  `C13_VERSION` (`packages/shared/src/platform/c13.ts`) and `config/tier-budgets.json` `c13` both become `'1.2.0'` in this session, because `tiers.ts` checks that they are equal (DL-725).
- C07 1.1, C08 1.0: read only.
- Not contracts: `FetchStats`, the asset RPC (`rpc.ts` says so), `BootReport`, `WorldScenarioDriver`, `data-dv-boot`.

## Acceptance criteria
- AC-1 Given the merged base When the repository checks run Then they pass — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `FetchRetry` with a scripted fetch When its unit cases run Then:
  - two concurrent URLs give `inflightPeak` 2 and `waves` 1;
  - two sequential URLs give `waves` 2 and `inflightPeak` 1;
  - a joined request, a retried request (during its backoff) and a 4-slice Range object each count as one in flight;
  - `resetPeak()` with one request running sets the peak to 1;
  - `inflight` returns to 0 after success, failure and abort

  — proof: `pnpm check:unit -- packages/engine/test/assets/fetch-retry.spec.ts`
- AC-3 Given `createNetShaper` with a fake clock and `{latencyMs: 100, bytesPerSec: 1000000}` When its unit cases run Then:
  - one 100,000-byte response resolves at t = 200;
  - two concurrent ones resolve at 200 and 300 (shared budget);
  - a 404 resolves at 100 and leaves the cursor unchanged;
  - an abort during the latency wait rejects and never calls the inner fetch;
  - the `lag` profile returns the inner `Response` object itself;
  - every profile in `config/perf/net-profiles.json` has `latencyMs` ≥ 0 and `bytesPerSec` > 0 or `null`;
  - `parseQaFlags('?net=cell', true).net` is `'cell'`, `?net=nope` gives `null`, and with `enabled` false the result is `NO_QA_FLAGS`

  — proof: `pnpm check:unit -- packages/engine/test/assets/net-shaper.spec.ts packages/engine/test/platform/config.spec.ts`
- AC-4 Given a `DV_WORLD=synth` QA build When `boot-cityhall` runs on `chromium-webgl2` and `webkit-webgl2` for each flat tier Then every report validates against the schema with all five `boot` fields and passes `verifyBoot`, and `verifyBoot`'s unit cases fail a report missing a field, one with a peak above the lane sum and one with mismatched bytes — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:perf -- --scenario boot-cityhall --fail && pnpm check:unit -- tools/ci/test/perf-check.spec.ts`
- AC-5 Given a `DV_WORLD=synth` QA build and an empty profile When the world boots at tier `mobile` Then:
  - **`@world-boot-figures`** (both projects): `world.boot()` holds `requests` ≥ 2, `bytes` equal to `bytesBeforeReveal`, `bootRevealMs` > 0, `waves` ≥ 1 and 1 ≤ `inflightPeak` ≤ 26 (the desktop lane sum: CI browsers classify as `desktop` whatever `?tier=` forces), and `JSON.parse(dataset.dvBoot)` carries the same figures;
  - **`@net-shaper`** (`chromium-webgl2`): a second cold boot with `?net=lag` reveals with `bootRevealMs` ≥ 800, because the world index and the spawn tile are fetched in sequence at 400 ms each, and later than the unshaped boot of the same test;
  - `@world-boot-size` still passes

  — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-boot-figures|@net-shaper|@world-boot-size" && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-boot-figures`
- AC-6 Given a production build and a QA build When the bundle checks run Then the production chunks hold no `dv-net-shaper` and no `__dvBridge`, the QA build holds the marker, and the harness test covers both cases — proof: `pnpm build && pnpm check:bundle -- --forbid-qa && pnpm check:unit -- tools/ci/test/check-bundle-harness.test.ts`
- AC-7 Given the new and edited checklists When `perf:checklist` prints them Then both are valid `DeviceChecklist`s (exit 0) and the M02f1 one shows the staging URL — proof: `pnpm perf:checklist -- tools/ci/checklists/M02f1-staging.json --url https://tha-bay-web-staging.gratitude-8f4.workers.dev && pnpm perf:checklist -- tools/ci/checklists/M02b1-mac.json`
- AC-8 Given this milestone deployed to staging, and M02c2 AC-14 passed (`config/world/release.json` `staging: "sf"`) When the operator runs the M02f1 staging checklist on the Mac and on the iPhone 15 Then `notes.json` holds both cold and the warm figure sets, and records U-W8 as `uw8` per device against the tier's boot budget — proof: manual: desktop Apple Silicon Mac (Chrome) and iPhone 15 (Home Screen app, Web Inspector), `pnpm perf:checklist -- tools/ci/checklists/M02f1-staging.json --url <staging-url>`, follow the steps, commit `docs/device-runs/M02f1/staging/notes.json`. Before AC-14 has run, the Builder lists AC-8 under "Blocked on".

## Test plan
- **Unit:** `fetch-retry.spec.ts` (in-flight), `net-shaper.spec.ts` (fake-clock pacing, abort, profiles), `config.spec.ts` (`?net=`), `perf-check.spec.ts` (`verifyBoot`), `check-bundle-harness.test.ts` (marker).
- **E2E:** `@world-boot-figures` on `chromium-webgl2` and `webkit-webgl2`; `@net-shaper` on `chromium-webgl2`; regression `@world-boot-size`.
- **Perf:** `check:perf -- --scenario boot-cityhall` (warning on PRs, `--fail` nightly, as for every scenario).
- **Device:** `M02f1-staging` (AC-8).

## Demo script
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, then open `/?play=sandbox&tier=mobile`.
2. After the reveal, in the console run `JSON.parse(document.documentElement.dataset.dvBoot)` and read requests, bytes, revealMs, waves and peak.
3. Open `/?play=sandbox&tier=mobile&net=poor` in a new private window: the veil stays visible noticeably longer, and `revealMs` grows.
4. `DV_WORLD=synth pnpm check:perf -- --scenario boot-cityhall`: open a `test-results/perf.boot-cityhall.*.json` report and read its `boot` block.
5. After AC-14: `pnpm perf:checklist -- tools/ci/checklists/M02f1-staging.json --url <staging-url>` and follow it.

## Effort
0.6 Builder session; about 30 files; risk **low-medium**.

## Risks & fallbacks
- **Sampling skew.** The figures are read when the stats RPC answers, milliseconds after the reveal; every assertion is a bound this skew cannot break.
- **World index already fetched.** If something fetches the world index before `prepareWorld` in a cold session, the shaped boot has only one sequential latency. Then assert `bootRevealMs` ≥ 400 and record a BD row.
- **Perf job time.** If the `perf` job nears its 45-minute timeout, move `boot-cityhall` from `scenarios.json` to `EXTRA_SCENARIOS` (selectable by name) and run it nightly by name; record a BD row.
- **Staging release.** AC-8 waits on the operator's M02c2 AC-14 (`release.json` `staging` is `null` today). Staging is a production build without QA flags, so the run uses `data-dv-boot` and DevTools only.
- **Record-only facts** (UNVERIFIED, recorded, never asserted): Resource Timing in a worker's console context, `nextHopProtocol` on `workers.dev`, the worker console in Safari's Web Inspector, Worker and R2 time to first byte.

## Notes for the Builder
- Read first:
  - `M02b1-streaming-lod.md` (AC-8, AC-11) and `M02c2-maps.md` AC-14;
  - `spec/domains/11-platform-perf.md` §4–§5 and `spec/domains/11-platform-pwa.md` §5 (fetch layer);
  - DL-109 and DL-713;
  - the Deliverables' code files, plus `lanes.ts`, `world-bridge.ts`, `perf-checklist.ts`, `tests/perf/perf-budget.spec.ts` and `tests/e2e/world-stream.spec.ts`.
- Order: counter, RPC and boot figures with the e2e; report, schema and scenario; shaper and bundle gate; checklists.
- `waves` and `inflightPeak` are different figures. `waves` counts busy periods (sequential round trips that nothing overlapped). `inflightPeak` is concurrency. The study draft gave both meanings to one field; we keep both fields.
- `bootRevealMs` starts at `prepareWorld`, before the world index request. The existing `revealMs` of `BootReport` starts at `attach` and stays unchanged, so `@world-route` and M02b1's figures keep their meaning.
- Keep the shaper behind a literal `import.meta.env.VITE_DV_QA === '1'` check around a dynamic `import()`. Vite replaces it in `asset.worker` too, and Rollup then drops the chunk. AC-6 proves it.
- `FetchRetry` keeps `cache: 'no-store'`. The shaper paces only what reaches the network, and a store hit is never shaped.
- IP wall: the shaper, the profile names and values, the attribute and every message are our own. Copy no wording, header names or structure from any external launcher or tool.

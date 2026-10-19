# M02b2 — weather-time

## Goal
After this session the city has a day, a night and weather. The S01 game clock and weather state run in the sim (`WorldClockApi`, integer half-seconds, seeded weather changes, `EnvState` published each tick), and S02 renders them: a keyframe-driven dome sky with sun and moon, the Karl fog bank weighted toward the west, linear or height fog per tier, rain streaks and wet albedo, night windows, street-lamp sprites with pool-of-light decals, stars, and the blackout look. The per-tier feature matrix of `02-world-living.md` §6 is data, the six presets switch without uniform jumps, and the luminance gates run in CI. The desktop-ultra atmosphere adapter is an interface only (ultra uses the desktop sky).

## Requirements
- R-MAP-04: day/night and weather (clear, Karl fog, overcast, rain, smoke, golden) on every tier, plus the blackout look the traffic milestone uses.

## Depends on
- **M02b1:** `@dv/world`, chunk materials with the night-window hook, `ChunkRenderer`, world boot, perf scenarios, `DV_WORLD=synth` CI builds.
- Contracts: C06 1.1 (`WorldClockApi`, `WeatherPreset`, `WorldClockState`, `WeatherState`, `EnvState`, `weekdayOf`, in `01-engine-save-modes.md` "Time-of-day and weather clock" and the 1.1 section), C13 1.1 (tiers, `DynamicQuality`, probe-grid lighting), C02 1.1 (stream `weather`, `stateHash`).

## Scope in
- **`packages/shared/src/contracts/engine-world.ts`:** the clock section's types verbatim plus the 1.1 `weekdayOf`. Other members that C06 places in this file arrive with their milestones (zones in M05a1). No shape change.
- **Clock** (`packages/engine/src/sim/world/clock.ts`, S01 rules): `t` in integer game half-seconds, `rate` 1 per tick (30 game s per real s), 172,800 per day; `setHour`, `pause`, `lock(by, hour?, weather?)` / `unlock(by)` (only the locker releases), `forceWeather(w, blendSec)`; weather drawn from stream `weather` every 20–40 game minutes with per-preset weights (Karl favours mornings and evenings) from `config/clock.json`; `blend` as u16; `night` and `dark` piecewise-linear in hour with exact ops; `fogBankM` and `rain` per preset. The clock is a hashed sim resource and part of `snapshot()`. `EnvState` is published at `SimStage.Publish`. Sandbox "sync to system time" is a main-thread `setHour` call (the sim never reads `Date`).
- **Sky** (`packages/world/src/client/sky/`, main thread, TSL only):
  - `sky-keys.ts`: `SkyKeysFile` loader for `config/world/sky-keys.json` (schema `sky-keys/1`, 6 presets × 8 key hours `[0, 5, 6.5, 9, 13, 17, 19.5, 21.5]`), row interpolation by hour and preset blend → `SkyUniforms`; pure `evaluateSky(file, env)` so tests run in Node.
  - Sun direction `a = π(h − 6.5)/13`, elevation `52°·sin a`, moon opposite at 0.4 (`Math.sin` allowed on the main thread).
  - `dome.ts` (gradient, sun disc, moon, stars `max(0, uNight − 0.3)`), `fog.ts` (bank weight 1 for x < −1,500 m falling linearly to 0.35 at x > 2,500 m, base 60 m; height-fog node on desktop and Vision Pro, linear fog on mobile and Quest), `rain.ts` (streak counts per tier; overlay on mobile; world streaks near the head on XR tiers; `uWet` darkens road and roof albedo, desktop also roughness), `night.ts` (window lit fraction `smoothstep(uNight)` against the per-building threshold from `seed`; lamp sprites; pool-of-light decals capped per tier; `uDark > 0.4` exposes the head- and tail-light uniform for M03b1), blackout (`uBlackout = 1`: windows × 0.15, lamps off).
  - `tiers.ts`: the §6 feature matrix as data, keyed by `QualityTierId`; governor knob `atmosphereLevel` honoured.
  - `atmosphere.ts`: `AtmosphereAdapter` interface only; `desktop-ultra` uses the desktop path until an adapter lands.
  - Probe-grid lighting: one sky-derived probe re-baked only when the sun moves > 0.006 rad or darkness changes > 0.04, at most every 200 ms.
- **Lamps in the bake:** a small S9 addition writes `l0` LAMP records every 30 m on both sides of Arterial and Collector edges (design value, `config/world/density.json` key `lampPitchM`); reproducible.
- **Blackout resource:** a sim-side hashed boolean in `packages/world/src/sim/env/blackout.ts` that `TrafficControl` (M02c1/M03b1) adopts unchanged; until then only the QA bridge and debug panel set it.
- **QA and tools:** `__dvBridge.world.setHour(h)`, `setWeather(w)`, `blackout(on)`, `sky()` (current `SkyUniforms`); sky controls (hour, preset, blackout, rain) in the M01b2 debug panel (`?debug=1`) for device checklists; `BootConfig.flags` `world.rain` and `world.atmosphere` honoured.
- **Package test filter (DL-674; BD-M01b1-13):** on the code branch `@dv/engine` and `@dv/shared` `test` are still plain `vitest run`, which ignores the filter after pnpm's `--`, and the `--dir packages/<pkg>` form hides the root `include`. This milestone (the first block B proof user) changes every package `test` script to `tsx ../../tools/ci/run.ts vitest run --pkg packages/<pkg>` (for `packages/modes/<id>`, `../../../`). `run.ts --pkg <dir>` runs Vitest from the repo root with the root config: with no filter it passes `<dir>/test/`; with filters it lists the spec files under `<dir>/test/` (`*.{test,spec}.{ts,tsx}`) whose path relative to that folder contains any filter and passes exactly those paths, and with no match it exits 1 with `run.ts: no spec under <dir>/test matches <filter>`. `test:*` scripts that name spec paths stay as they are. Packages added later use the same script.
- **Checklist** `tools/ci/checklists/M02b2-iphone15.json` (C13 `DeviceChecklist`): Home Screen app on an operator-built `DV_WORLD=synth` Preview (Preview builds stay world-less, M02b1, and the sky mounts only on the world path; DL-653) at `?perf=1&tier=mobile-low&scenario=walk-civic-center&debug=1`, then rain at 21:30 with Karl fog via the debug panel; upload `perf.json` and `notes.json`.

## Scope out
- takram atmosphere adapter and volumetric clouds for `desktop-ultra` (stub first per `02-world.md` §8): M10d2 (art integration, DL-390); its device calibration rides the M14b3 release pass. Head- and tail-light meshes: M03b1. Mission time locks are exercised from M05a1. Lightning, snow and thunder do not exist.

## Deliverables
- `packages/shared/src/contracts/engine-world.ts` (+ index export).
- `packages/engine/src/sim/world/clock.ts`, `config/clock.json` + `config/schemas/clock.schema.json`, `packages/engine/test/clock.spec.ts`.
- `packages/world/src/client/sky/{types.ts, sky-keys.ts, dome.ts, fog.ts, rain.ts, night.ts, tiers.ts, probe.ts, atmosphere.ts, sky-view.ts}`, `packages/world/src/sim/env/blackout.ts`.
- `config/world/sky-keys.json` + `tools/map/schemas/sky-keys.schema.json`; `config/world/density.json` and `tools/map/schemas/density.schema.json` (adds `lampPitchM` to M02a2's file; profile order unchanged; the hour curves arrive in M03b1; DL-555); `tools/map/src/stages/s9-tags.ts` (lamps).
- `packages/world/test/{sky.keys.spec.ts, sky.continuity.spec.ts, sky.tiers.spec.ts, sky.probe.spec.ts}`, `tests/e2e/world-sky.spec.ts` (`@world-sky`).
- `packages/engine/src/client/debug/sim-panel.ts` (sky controls), `apps/web/src/main.ts` (sky wiring), `tools/ci/checklists/M02b2-iphone15.json`.
- `tools/ci/run.ts` (`--pkg`), `tools/ci/test/run-pkg.test.ts`, the `test` script of every `packages/**/package.json` that has one (DL-674).
- ≈ 26 code files.

## Interfaces
- C06 1.1 clock types created verbatim in `engine-world.ts`; `WorldClockApi` implemented by the engine. C13 1.1 and C02 1.1 used unchanged. `SkyKeysFile`, `SkyUniforms`, `AtmosphereAdapter` are S02 domain types (`02-world-living.md` §6), not numbered contracts.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and `engine-world.ts` matches the contract text — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given a clock at `t = 0` When 60 ticks run Then `t` is 60 (30 game seconds); 172,800 ticks advance exactly one game day and `weekdayOf` steps from 0 to 1; `pause(true)` stops `t`; `lock('m1', 21)` sets hour 21, `unlock('m2')` is ignored and `unlock('m1')` releases; `night` and `dark` are continuous across every key hour — proof: `pnpm --filter @dv/engine test -- clock`
- AC-3 Given seed 0xC0FFEE When the clock runs three game days twice and once from a snapshot taken at day 1.5 Then the weather sequences, change times and state hashes are identical, every interval lies within 20–40 game minutes, and a different seed changes the sequence — proof: `pnpm --filter @dv/engine test -- clock`
- AC-4 Given `config/world/sky-keys.json` When `evaluateSky` is sampled every 60 game seconds over 24 hours for each preset and across a 30 s preset blend Then the file validates, no uniform component changes by more than 0.05 (normalized) between consecutive samples, the sun is below the horizon outside 06:30–19:30, and the fog-bank weight is 1 at x = −2,000 m and 0.35 at x = 3,000 m — proof: `pnpm check:unit -- packages/world`
- AC-5 Given each of the six tiers When the sky configuration is built Then fog kind, rain streak count, wetness, decal cap and atmosphere level equal the `02-world-living.md` §6 matrix, and the probe re-bakes only after a 0.006 rad sun move or a 0.04 darkness change and never twice within 200 ms — proof: `pnpm check:unit -- packages/world`
- AC-6 Given a QA build with the `synth` world on `chromium-webgl2` When the bridge sets 13:00 `clear`, 01:00 `clear`, 13:00 `karl-fog` and blackout at 22:00 Then a 128 px readback gives clear-noon sky luminance within 0.45–0.85, night below 0.12, Karl fog lowering city luminance variance by ≥ 25 % against clear, and blackout reporting `uBlackout` 1 with window factor 0.15 — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-sky`
- AC-7 Given the sky at 21:30 with rain When the walk scenario runs for every flat tier in fail mode Then render objects and triangles stay within budget — proof: `DV_WORLD=synth pnpm check:perf -- --scenario walk-civic-center --fail`
- AC-8 Given the branch When the production build is verified and deployed to a Preview Then it succeeds and the Preview passes its header checks — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-9 Given an operator Preview built with the `synth` world (Notes), opened as an iPhone 15 Home Screen app at `mobile-low` When the `M02b2-iphone15` checklist runs `walk-civic-center` with rain at 21:30 and Karl fog Then `perf:verify` passes at `mobile-low`, and the run records the sky cost (on/off frame median delta, U-W10) in `notes.json` — proof: manual: iPhone 15 (Home Screen app), operator Preview from `pnpm map:build -- --area synth && DV_WORLD=synth VITE_DV_QA=1 pnpm build && pnpm deploy:preview` (URL noted in `notes.json`), `pnpm perf:checklist -- tools/ci/checklists/M02b2-iphone15.json`, follow the steps, upload `perf.json` and `notes.json` to `docs/device-runs/M02b2/iphone15/`, then `pnpm perf:verify -- docs/device-runs/M02b2/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M02b2-iphone15.json`
- AC-10 Given the package `test` scripts routed through `run.ts --pkg` (DL-674) When `pnpm --filter @dv/engine test -- clock` runs Then Vitest runs from the repo root and selects only the engine spec files whose path contains `clock` (here `clock.spec.ts`), with no filter it runs every spec under `packages/engine/test/`, and an unmatched filter exits 1 naming it (`tools/ci/test/run-pkg.test.ts` asserts the selected file lists) — proof: `pnpm check:unit -- tools/ci && pnpm --filter @dv/engine test -- clock`

## Test plan
- **Unit:** `engine/clock` (`pnpm --filter @dv/engine test -- clock`); `world/sky.keys`, `sky.continuity`, `sky.tiers`, `sky.probe` (`pnpm check:unit -- packages/world`); `tools/map/stage.tags` lamp pitch.
- **E2E:** `@world-sky` on `chromium-webgl2` (128 px readbacks with tolerance; state assertions for everything else).
- **Perf:** `walk-civic-center` in fail mode (AC-7). **Device:** `M02b2-iphone15` (AC-9).

## Demo script
1. `DV_WORLD=synth pnpm dev`, open `/?debug=1`; drag the hour slider from 05:00 to 21:00; switch to `karl-fog`: the west side greys out first.
2. Toggle blackout: windows dim, lamps go out.

## Effort
1 Builder session; about 26 code files; risk **medium**. Tuning `sky-keys.json` so the luminance gates pass is the main time sink.

## Risks & fallbacks
- **Readback luminance differs between SwiftShader runs:** compare means over a 128 × 72 target with ±0.03 tolerance; if still flaky, keep the readback gates in `@world-sky` nightly only and assert the analytic luminance of `evaluateSky` in the PR suite (log the decision).
- **Sky too expensive on `mobile-low`:** drop stars and decals on that tier first, then streaks; the matrix is data, so the change is a config edit.

## Notes for the Builder
- Read first: `02-world-living.md` §6; `01-engine-save-modes.md` "Time-of-day and weather clock" and the 1.1 section; `01-engine.md` §2.3 (determinism) and §9 item 17.
- The clock is sim code: no `Date`, no transcendental `Math.*`; hour math with integers and exact ops. The sky is client code: `Math.sin` is fine there.
- Preview builds normally carry no world (M02b1), so the sky never mounts there. For AC-9 the operator builds one Preview with `pnpm map:build -- --area synth`, then `DV_WORLD=synth VITE_DV_QA=1 pnpm build`, then `pnpm deploy:preview`, and notes the URL in `notes.json` (as M03b1 AC-11; DL-653).
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the AC-8 and AC-9 Preview deploys (SKIP locally). Device availability is Q-13. Branch `m02b2-weather-time`.

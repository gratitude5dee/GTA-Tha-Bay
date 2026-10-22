# @dv/mode-tycoon

Business Tycoon (M09a1, M09a2): the founder-versus-VC company simulation. The pure, seeded core lives in `@dv/shared/tycoon` (`packages/shared/src/tycoon`), the random-event engine in `@dv/shared/events`; this package is the thin C06 adapter around them. The descriptor is `available` in QA builds (the tile stays locked until `?unlockAll=1`) and `comingSoon` in every other build; a QA build also starts the mode from a text panel.

## Layout

| Path | Holds | Imports |
|---|---|---|
| `src/descriptor.ts`, `src/index.ts` | `tycoonDescriptor()` (lazy `sim`), `tycoonUnlock` | `@dv/shared` |
| `src/sim/TycoonModeSim.ts` | `GameModeSim` and `TycoonSession`: week pacing (1,200 / 600 / 300 ticks), pause rules, the command queue, `ChoiceRecord` recording, save moments, the view model `mode.tycoon.view` | `@dv/shared`, `@dv/shared/tycoon`. C02 determinism lint applies |
| `src/sim/slice.ts` | `TycoonSlice` schema 1, `restoreRun` (replay, hash compare, snapshot fallback marked `unverifiable`) | same |
| `src/qa/` | `?tycoon=1`: `__dvBridge.tycoon`, the Preact text panel `QaPanel.tsx`, `runDet` for the cross-browser check | DOM; QA builds only |
| `scripts/` | the fixture run and `golden:write` for `packages/engine/src/sim/save/__golden__/tycoon/v1.json` | |
| `test/` | mode conformance (`tycoon.mode.spec.ts`), save and load (`tycoon.save.spec.ts`) | |

Content: `content/tycoon/{sectors,theses,archetypes}.json` (one sector, the 8-card trend deck, the founders, the role wages and the 12 fictional funds), `content/tycoon/events/*.json` (37 events in five families: 30 rolled and enabled, 3 chain-only, 2 disabled until a hardware or mobility sector exists, 2 system), `config/tycoon.balance.json`, `config/tycoon.bands.json`. Both version strings are the first 12 hex characters of the SHA-256 of the canonical JSON.

## See it

In a QA build (`VITE_DV_QA=1`; the PR preview `https://pr-6-tha-bay-web-staging.gratitude-8f4.workers.dev` is one):

| What | URL | Then |
|---|---|---|
| The QA text panel | `/?tycoon=1` (add `&world=walk-drop` for a light scene) | **Start run**, **Allocation 60/25/15**, **Step 5 wk**, **Start SAFE raise ($50k)**, a **meet ...** button, **Accept**, **Step 1 wk** twice. The cap table, the SAFE count and the state hash are in the panel |
| The locked tile | main menu, then **Modes** | the Business Tycoon tile reads "Find this in the story" (a production build reads "Coming soon") |
| The open tile and the event inbox | `/?tycoon=1&unlockAll=1&world=walk-drop`, **Modes**, **Tycoon** | set seed 133, **Start run**, **20 wk**: the clock stops at week 5 for a blackout; **resolve: run_generator** pays $30k and cancels the closure; **20 wk** again. Tick "take default choices at the deadline" before **Start run** to see the default taken instead |

```js
await __dvBridge.tycoon.start(1);                       // seeded run in the sim worker
__dvBridge.tycoon.cmd({ t: 'setAllocation', features: 60, refactor: 25, infra: 15 });
await __dvBridge.tycoon.step(20);
__dvBridge.tycoon.view();                               // week, cash, cap table, hash
__dvBridge.tycoon.runJson();                            // setup and choices: replay them with runDet
```

## Checks

```bash
pnpm check:balance -- --suite tycoon                    # 2,000 runs per bot policy: bands B1 to B12, the baseline guard
pnpm tycoon:sim -- --runs 2000 --policy median --seed-base 1 --sweep finance.dilutionTarget.seed=0.14:0.22:0.02
pnpm tycoon:sim -- --trace run=123                      # one run, week by week
pnpm tycoon:baseline                                    # rewrites tests/tycoon/baseline.json (commit line: balance-rebaseline: <reason>)
pnpm check:unit -- packages/shared/src/events packages/shared/src/tycoon/events tools/ci/tycoon-sim
pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-smoke
```

```bash
pnpm --filter @dv/shared test:tycoon-finance            # TV-1 .. TV-11, WF-1 .. WF-7, properties, envelope
pnpm check:unit -- packages/shared/src/tycoon           # core, replay, lint fixture, golden trace
pnpm check:unit -- packages/modes/tycoon                # mode and save
pnpm check:e2e -- --project=webkit-webgl2 --grep @tycoon-det
pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-qa
```

Goldens (`tests/golden/tycoon/det-001.json`, `step-trace.golden.json`, `__golden__/tycoon/v1.json`) change with the content or balance version and are regenerated in a pull request labelled golden-update: `pnpm --filter @dv/shared tycoon:goldens`, `pnpm --filter @dv/mode-tycoon golden:write`.

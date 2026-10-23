# M02f2 — boot-prefetch

## Goal
After this session the rest of the boot set downloads at idle priority while the player is on Title or the main menu, and the part still queued is promoted when a mode starts. The world already boots behind the Title on `claude/build`: `startEngine()` runs `boot()` at page load in `apps/web/src/main.ts`, `prepareWorld` (`packages/world/src/client/boot-world.ts`) demands the spawn tile and `critical` at `now`, and the engine draws the world as the Title backdrop. So the remaining gains are these:
- The speculative part of `bootSet()` (the `p0` and `l0` rings beyond `critical`, plus `l1`, `l2` and `far`) waits for the backdrop reveal and then runs in the `idle` lane. Today `prepareWorld` sends `l1`, `l2` and `far` at `soon` before the reveal, and nothing prefetches the rings.
- At mode start the queued remainder is promoted.
- A demand request that joins a queued prefetch now raises its priority. Today `PackStore.fetchAndStore` shares the pending promise and never reaches `FetchRetry`'s promotion.
- The speculative part is skipped when the storage pre-check fails, on a quota failure while it runs, on a Save-Data hint, in the memory fallback store, and in a read-only second tab.

This milestone carries proposal GV-04 of the 2026-10-23 streaming study. The design is our own, and no route or contract changes.

## Requirements
- R-PLAT-01 (support): an installed PWA on iPhone downloads speculative world data only when the device has room and the player has not asked to save data.
- R-ENG-02 (support): the M02b1 cold-boot download budget per flat tier (`config/tier-budgets.json` `boot.coldBootDownloadMB`) still holds, because nothing speculative starts before the reveal.

## Depends on
- **M01e** (asset-worker-opfs-store): `FetchRetry` with its in-flight map (`packages/engine/src/assets/store/fetch-retry.ts`), `Lanes` with `promote` and `peak` (`lanes.ts`), `PackStore` (`store.ts`) with `prefetch`, `pin` and `DOWNLOAD_ALL_QUOTA_FACTOR`, the RPC (`rpc.ts`, `service.ts`, `client.ts`), and `__dvBridge.assets` (`bridge.ts`, which includes `lanes()`).
- **M02b1** (streaming-lod): `bootSet`, `spawnPose`, `BootSet` (`packages/world/src/sim/streaming/boot.ts`), `prepareWorld`, the `WorldView` reveal (`world-view.ts`), `__dvBridge.world.boot()` (`world-bridge.ts`), and the `@world-boot-size` and `@world-faults` e2e (`tests/e2e/world-stream.spec.ts`).
- **M04b1** (shell-ui-kit-menus-settings): the Title, the main menu, `ShellHooks` (`packages/ui/src/shell/types.ts`), and `passGates` and `NO_BYPASS` (`tests/e2e/ui/helpers.ts`).
- **M04a2** (saves-gamemode-unlocks): `mode.start` and `ShellCore.startMode` (`packages/ui/src/shell/core.ts`).
- Optional: **M02f1** (stream-measure, written in the same batch). If it has merged when this session starts, the demo also records its `boot.*` fields. No AC needs it.
- Contracts: C13 1.1 (`WorldPackStore` and `QaFlags` stay unchanged) and C06 1.1. No contract change.

## Scope in
- **Promotion in the fetch layer** (`fetch-retry.ts`): add `FetchRetry.promote(url, to)`. If the entry for that URL is still queued, `Lanes.promote` moves it up, and the call returns `true`. It returns `false` when the URL is not in flight or the job is already running.
- **Promotion in the store** (`store.ts`):
  - `PackFetcher` gains an optional `promote?(url, to): boolean`.
  - In `fetchAndStore`, a caller that joins a pending fetch with a priority calls `fetcher.promote`, so a `now` demand (from `prepareWorld`, or a sim request through `packages/world/src/client/jobs.ts` `store.get(ref, { priority: req.priority })`) is never stuck behind an `idle` prefetch.
  - Add the class method `PackStore.promote(refs, to): number`. It promotes pending fetches and raises the priority that any not-yet-started deferred `get` of `prefetch` will use, and returns how many it promoted.
  - `prefetch` now takes the batch as one unit. After a `commit-failed` event with reason `quota` in that batch, the refs of the batch that have not started are dropped, and `stats.prefetchStops` counts it.
  - The C13 `WorldPackStore` interface in `store/types.ts` is not edited.
- **RPC:**
  - `rpc.ts` gains `promote: [{ targets: Target[]; tier: QualityTierId; priority: 'now' | 'soon' }, number]`.
  - `service.ts` resolves the targets and calls `store.promote`.
  - `client.ts` gains `AssetClient.promote(targets, priority)`.
  - `StatsResult` gains `prefetchStops`.
- **Plan and gate** (`packages/world/src/client/boot-prefetch.ts`, new):
  - `planBootPrefetch(set: BootSet): { now: string[]; soon: string[] }` is pure. `now` holds `set.p0` and `set.l0` without `critical`, in `bootSet` order. `soon` holds `l1`, `l2` and `far`. Both lists are de-duplicated, and neither holds a `critical` ref, which `prepareWorld` still demands.
  - `prefetchGate(i): null | 'save-data' | 'quota' | 'memory' | 'read-only'` is pure. Its input is `{ saveData: boolean; estimate: { usage: number; quota: number } | null; needBytes: number; storeKind; mode }`. It returns `'quota'` when an estimate exists and `quota − usage < DOWNLOAD_ALL_QUOTA_FACTOR × needBytes`. Without an estimate it does not skip. `needBytes` is the sum of `PackRef.bytes` over the planned refs that `has()` reports missing.
  - `BootPrefetch` is a controller with `start()`, `promote()`, `markPlay()` and `report()`:
    - `start()` runs once after the reveal, and only while the shell is not in play. It reads the Save-Data hint, `navigator.storage.estimate()`, `assets.storeKind` and `assets.mode` on the page, applies the gate, and then sends `assets.prefetch([...now, ...soon], 'idle')`.
    - `promote()` runs on mode start. It calls `assets.promote(now, 'now')` and `assets.promote(soon, 'soon')` once per page session.
    - `markPlay()` records the first `play(true)`.
- **Save-Data hint:** `(navigator as { connection?: { saveData?: unknown } }).connection?.saveData === true`, feature-detected inside `try`. When the hint is absent, nothing is skipped. No other network or metered signal is read.
- **World boot** (`boot-world.ts`):
  - `PrepareWorldOptions` gains `menu: () => boolean`, which is true while the shell is not in play.
  - The `void assets.prefetch([...set.l1, ...set.l2, ...set.far], 'soon')` line is replaced. When `menu()` is false at the reveal (the QA play bypass, or play started first), the same refs plus the rings go at `soon` once `WorldView` is revealed. Otherwise `BootPrefetch.start()` runs at the reveal.
  - `PreparedWorld` gains `prefetch: BootPrefetch`.
  - `WorldView` gains `whenRevealed(): Promise<void>`, resolved in `reveal()`.
- **Shell:**
  - `ShellHooks` gains an optional `modeStart?(id: GameModeId): void`.
  - `ShellCore.startMode` calls it after the engine-ready check and before `sendUi({ t: 'mode.start', … })`.
  - A refused start does not undo the promotion, which is harmless.
- **App** (`apps/web/src/main.ts`):
  - `menu: () => !want.play`.
  - `hooks.modeStart` calls `prepared?.prefetch.promote()`.
  - `hooks.play(true)` calls `markPlay()`.
  - QA builds parse `?prefetch=0`, the A/B switch for the demo, which turns the menu prefetch off. It is read the same way as `?sky=0` and `?look=0`, behind the `VITE_DV_QA === '1'` literal, so `QaFlags` is not touched.
- **Local measure:** `__dvBridge.world.prefetch()` (`world-bridge.ts`) returns the report:
  - `{ state: 'waiting' | 'running' | 'skipped' | 'direct' | 'off'; skipped: reason | null; planned; missingAtStart; needBytes; startedMs; promoted; promotedMs; startToPlayMs }`;
  - `promoted` is the sum of the counts that the two `assets.promote` calls return;
  - `startToPlayMs` is the time from `modeStart` to the first `play(true)`.

## Scope out
- Prefetching a saved position. No code restores `StorySlice.position`: `storyFreeroamSim` in `packages/engine/src/sim/modes/builtin/story-freeroam.ts` adopts the booted spawn, and `git grep "story.position"` finds no reader. So every mode starts at `spawnPose(index)`. The milestone that restores the position passes its pose to `bootSet` → `planBootPrefetch`.
- The CI headless emission of `bootset.<mode>.json` (`spec/domains/11-platform-pwa.md` §5, `spec/domains/02-world.md` §5.1 step 2). The runtime `planBootPrefetch` covers world packs. DL-726 retires that emission; non-world first-touch assets stay with the service worker's app-shell precache.
- The boot measurement fields, peak-in-flight instrumentation and the `boot-cityhall` perf scenario (all M02f1); the network shaper (M02f1); the offline download rows (M04b4); offline reload from a cached catalog (M11a2).
- Any route, header or `services/*` change; any telemetry name (C16 is closed).

## Deliverables
- Engine:
  - `packages/engine/src/assets/store/{fetch-retry.ts, store.ts}`;
  - `packages/engine/src/assets/{rpc.ts, service.ts, client.ts}`;
  - tests: `packages/engine/test/assets/fetch-retry.spec.ts` (extended), `packages/engine/test/assets/store.promote.spec.ts` (new).
- World:
  - `packages/world/src/client/boot-prefetch.ts` (new);
  - `packages/world/src/client/{boot-world.ts, world-view.ts, world-bridge.ts, index.ts}`;
  - test: `packages/world/test/boot-prefetch.spec.ts` (new).
- UI:
  - `packages/ui/src/shell/{types.ts, core.ts}`;
  - test: `packages/ui/test/ui-shell.spec.ts` (extended).
- App: `apps/web/src/main.ts`.
- E2E: `tests/e2e/world-prefetch.spec.ts` (new; tags `@world-prefetch` and `@world-prefetch-skip`).
- BD rows in `spec/11-decision-log-builder.md`.
- About 18 files.

## Interfaces
- `FetchRetry.promote(url: string, to: Priority): boolean`.
- `PackFetcher.promote?(url: string, to: Priority): boolean`.
- `PackStore.promote(refs: readonly PackRef[], to: 'now' | 'soon'): number`.
- `AssetClient.promote(targets: Target[], priority: 'now' | 'soon'): Promise<number>`.
- `planBootPrefetch(set: BootSet)`, `prefetchGate(input)`, `class BootPrefetch`.
- `ShellHooks.modeStart?(id: GameModeId)`.
- `WorldView.whenRevealed()`.
- `WorldBridge.prefetch(): PrefetchReport`.
- C13 `WorldPackStore` and `QaFlags` are unchanged.

## Acceptance criteria
- AC-1 Given the merged base When the repository checks run Then they pass — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given a `FetchRetry` over fake `Lanes` with the `idle` lane full and two `idle` jobs queued When `promote(url2, 'now')` is called Then:
  - `url2`'s fetch starts before `url1`'s, and the call returns `true`;
  - `promote` on a running URL, or on an unknown one, returns `false` and changes nothing

  — proof: `pnpm check:unit -- packages/engine/test/assets/fetch-retry.spec.ts`
- AC-3 Given a `PackStore` on the memory ports with a fake fetcher that records priorities and `promote` calls When the following runs Then:
  - **join:** a `prefetch([a, b, c], 'idle')` followed by `get(c, { priority: 'now' })` makes exactly one fetch for `c`, and calls `fetcher.promote(c.url, 'now')`;
  - **promote before start:** `promote([b], 'soon')` returns 1 and makes `b`'s deferred get use `soon`;
  - **quota stop:** with the memory ports' free-byte hook set so that `a`'s commit fails with `QuotaExceededError` and nothing can be evicted, `b` and `c` are never fetched once `a` fails, and `stats.prefetchStops` is 1

  — proof: `pnpm check:unit -- packages/engine/test/assets/store.promote.spec.ts`
- AC-4 Given a `BootSet` fixture whose `critical` repeats one `p0` and one `l0` When `planBootPrefetch` and `prefetchGate` run Then:
  - `now` and `soon` hold no `critical` ref and no duplicate, `now` keeps `bootSet` order, and `soon` is `l1`, then `l2`, then `far`;
  - the gate returns `'save-data'`, `'quota'` (quota 100 MB, usage 90 MB, need 10 MB, so 10 < 12), `'memory'`, `'read-only'`, and `null` both without an estimate and with room

  — proof: `pnpm check:unit -- packages/world/test/boot-prefetch.spec.ts`
- AC-5 Given a mounted shell with a spy `modeStart` hook When New Game is pressed with an engine port, and again with none Then the hook is called once with `'story'` before the `mode.start` message, and not at all without an engine (the shell shows the engine-not-ready toast) — proof: `pnpm check:unit -- packages/ui/test/ui-shell.spec.ts`
- AC-6 Given a `DV_WORLD=synth` QA build, an empty profile (`NO_BYPASS`) passed through `passGates`, and every request to `/media-local/` recorded with `page.on('request')` When the main menu stays open until the world is revealed and `__dvBridge.world.prefetch().state` is `running`, then New Game is pressed and the HUD appears Then:
  - no planned ref was requested before `__dvBridge.world.boot().revealed`;
  - `__dvBridge.assets.lanes()` reports `peak.idle` ≥ 1;
  - the report shows `planned` > 0, `promoted` ≥ 0 and a numeric `startToPlayMs`;
  - every planned pack URL was requested at most once from page load to 10 s after the HUD appeared

  — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-prefetch`
- AC-7 Given the same build and flow When three runs are made: one with `navigator.connection` stubbed to `{ saveData: true }` by `page.addInitScript`, one with `navigator.storage.estimate` stubbed to `{ usage: 0, quota: 1 }`, and one at `/?play=sandbox` Then:
  - the first two report `state: 'skipped'` with `'save-data'` and `'quota'`, and no planned ref is requested before New Game;
  - the bypass run reports `state: 'direct'` and its rings, `l1`, `l2` and `far` are requested at `soon` after the reveal

  — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-prefetch-skip`
- AC-8 Given the changes When the M02b1 world e2e and the M01e pack-store e2e run Then they stay green, and `@world-boot-size` still meets each flat tier's `coldBootDownloadMB` — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-boot-size|@world-faults" && pnpm check:e2e -- --project=chromium-webgl2 --grep @pack-`
- AC-9 Given a production build When the dist check runs Then neither `__dvBridge` nor the `?prefetch=0` parse is in the bundle — proof: `pnpm build && pnpm --filter @dv/web verify:dist`

## Test plan
- **Unit:** `fetch-retry.spec.ts`, `store.promote.spec.ts`, `boot-prefetch.spec.ts`, `ui-shell.spec.ts` (`pnpm check:unit -- packages/engine/test/assets packages/world/test/boot-prefetch.spec.ts packages/ui/test/ui-shell.spec.ts`).
- **E2E (world leg):** `@world-prefetch` and `@world-prefetch-skip` on `chromium-webgl2`, plus the M02b1 regressions.
- **E2E (gray-box leg):** `@pack-`.
- **Dist:** `pnpm --filter @dv/web verify:dist` (`apps/web/scripts/verify-dist.mjs`).

## Demo script
1. Run `DV_WORLD=synth pnpm dev` and open `/` in a clean profile. Pass the gates and wait on the main menu. `__dvBridge.world.prefetch()` moves from `waiting` to `running` after the reveal, and `__dvBridge.assets.lanes().peak.idle` is 2.
2. Press New Game, then read `promoted` and `startToPlayMs`.
3. Repeat with `/?prefetch=0` and compare `startToPlayMs`. Record both, plus M02f1's `boot.requests` and `boot.waves` if M02f1 has merged, in the PR description. These numbers are observations, not gates.

## Effort
0.5 Builder session; about 18 files; risk **low**. Most of the change sits in two small classes the unit tests cover with fakes.

## Risks & fallbacks
- **Browser support for the Save-Data hint.** Which browsers expose `navigator.connection.saveData` is UNVERIFIED (not in `spec/03` or `research/INDEX.md`; U-W17 in `spec/99-open-questions-2.md`). The code feature-detects the hint, and AC-7 stubs it. Fallback: an absent hint never skips, so the quota gate and the idle lane are the only protection. The Builder does not add a setting for it.
- **Lane starvation.** Speculative work uses only the `idle` lane (two at a time, `IDLE_LANE`), and demand joins promote. If AC-6 shows a demand request waiting behind the idle lane, check that `fetchAndStore` reaches `fetcher.promote` before blaming `Lanes`.
- **Two-hop race in `prefetch`.** `has()` runs before `get()`, so a `promote` can arrive before the fetch is pending. AC-3 covers this case through the deferred-priority map.
- **Flake from the request log.** Count only planned URLs (resolved through `__dvBridge.assets.resolve`), and never count the catalog or the index.

## Notes for the Builder
- Read first:
  - this file;
  - `spec/domains/11-platform-pwa.md` §5 (the fetch layer and the pack store rules);
  - `spec/domains/02-world.md` §5.1;
  - `M01e-asset-worker-opfs-store.md`, `M02b1-streaming-lod.md`;
  - the code paths named under Depends on.
- **E2E tags:** do not tag with `@boot…`, `@pack-…` or `@story…`. `tests/e2e/graybox-grep.txt` matches `@boot`, `@pack-` and `@story` as substrings, so such a tag would run in the world-less leg and skip the world leg. The `@world-prefetch` tags match none of them.
- **Spec conflict (resolved):** `spec/domains/10-ui.md` §2.7 used to say that no world streams before play, which contradicted the code: M01b2's Title draws over the live world (`apps/web/src/engine.css`, and `boot-engine.ts` "Off, the world runs as a slow-turning backdrop behind the title"). Build against the code; DL-726 corrects the spec line.
- **Promotion levels:** call `promote` once per page session. A return to the menu does not demote anything. Promotion does not change the `priority` hint of a request that is already running.
- **Speculative work stays off the critical path:** never pin or demand a speculative ref outside `prepareWorld`'s existing `pin(all)`. Pins still cover the whole boot set, as today.
- **M02f1 measure:** if M02f1 has merged at the start of the session, read its `boot.*` fields only for the demo, and assert nothing about them.
- **Secrets and services:** no secret is needed, and nothing in `services/*` changes, so `_PLAN.md` §0 rule 7 does not apply.
- **BD rows:** record the store-batch quota stop and the reveal-gated start as BD rows.

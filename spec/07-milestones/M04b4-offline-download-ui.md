# M04b4 — offline-download-ui

## Goal
After this session the two rows of Settings › Install and storage that ship disabled work: "Download the city for offline play" (`settings.storage.offline`, button `offline`) and "Clear downloaded data" (`settings.storage.clear`, button `clear`). Today both carry `disabled: lk('settings.later')` in `installScreen` (`packages/ui/src/pages/settings/privacy-storage.ts`), with no owner (BD-M04b1-08). The engine side exists from M01e: `AssetClient.downloadAll` and `clear` (`packages/engine/src/assets/client.ts`), `PackStore.downloadAll` with the 1.2 × quota rule (`DOWNLOAD_ALL_QUOTA_FACTOR`, `packages/engine/src/assets/store/store.ts`).

The page shows the current tier's download size from the catalog at run time. It refuses to start below 1.2 × the missing bytes of free quota and names the shortfall. A start asks `navigator.storage.persist()` first, then shows progress and offers Stop. Clear asks for confirmation. No text promises permanence: iPhone storage can still be evicted (F-010).

This re-implements proposal GV-06 of the owner's study in our own code and words. An offline **reload** from a cached catalog is M11a2's ("Offline relaunch", `offline-relaunch.spec.ts`); here the download is proved inside the running session with the network failing.

## Requirements
- R-PLAT-01: the installable PWA can hold the whole city for its tier on the device, so play continues with no network after a completed download.
- R-UI-03 (support): the Settings page's storage rows are complete; no row says "Available in a later update" for the pack store.

## Depends on
- **M01e** (asset-worker-opfs-store): `PackStore`, `AssetService` (`packages/engine/src/assets/service.ts`, its per-request `AbortController` in `handle()`), `AssetClient`, `installAssetsBridge` (`bridge.ts`), the `/media-local/` QA mirror, `injectFaults` (`qa-ops.ts`), `tests/e2e/pack-store.spec.ts` (the persistent-context fixture this milestone copies).
- **M04b1** (shell-ui-kit-menus-settings): `installScreen`, `SettingsEnv`, `buildEnv`, `runAction` (`packages/ui/src/pages/settings/index.ts`), `ShellApi.confirm`, the `progress` widget (`packages/ui/src/screen/types.ts`), `PlatformPort` and `StorageInfo` (`packages/ui/src/shell/types.ts`), `createPlatformPort` (`apps/web/src/shell-ports.ts`), `check:i18n`.
- Merged, not dependencies: M01d2 (`/media/<key>`), M02c2 (the `sf` release).
- Contracts: C13 1.1 (`WorldPackStore`, `PackRef`, `StorageUsage`, `PackUnavailable`), read only; C16 1.2 (`storage.persist{granted}`), name only. No contract change.

## Scope in
- **Store** (`packages/engine/src/assets/store/store.ts`):
  - `PackStore.downloadPlan(refs)` returns `{ totalBytes, files, missingBytes, missingFiles, freeBytes, fits, shortfallBytes }`. `freeBytes` is `quota − usage` from the store's `estimate`, or `null` without one. `fits` and `shortfallBytes = max(0, ceil(1.2 × missingBytes) − freeBytes)` come from one exported predicate `quotaFits(freeBytes, missingBytes)` built on `DOWNLOAD_ALL_QUOTA_FACTOR`. A `null` estimate fits, as `downloadAll` already treats it. On `memory-fallback`, `missingBytes > softCapBytes` does not fit.
  - `downloadAll(refs, onProgress, signal?)`: the third parameter is optional on the class only. The C13 `WorldPackStore` interface in `store/types.ts` is not edited, and the class stays assignable to it. The quota check uses `downloadPlan`, so the page and the store never disagree. The missing refs run through a pool of `DOWNLOAD_ALL_CONCURRENCY = 4` gets at priority `soon`, not one `Promise.all` over every ref. The shared fetch in `fetchAndStore` ignores a caller's signal, so the pool is what makes Stop real. After an abort no new get starts, the call rejects with `PackUnavailable('aborted')`, and packs already committed are kept. A later download fetches only what is still missing.
- **RPC and client** (not contracts):
  - `rpc.ts`: `RpcOps.downloadPlan: [{ tier }, DownloadPlan]`.
  - `service.ts`: `downloadPlan` resolves `catalog.resolveAll(tier)`, or throws `AssetNotFound` when the catalog is not `ready`. The `downloadAll` case passes the request's abort signal to the store.
  - `client.ts`: `downloadPlan()` and `downloadAll(onProgress, o?: { signal?: AbortSignal })`. The `t:'abort'` message already exists.
  - `bridge.ts`: `downloadPlan()` for QA.
- **Shell port** (`packages/ui/src/shell/types.ts`): `PlatformPort.offline?: OfflinePort` with:
  - `plan(): Promise<OfflinePlan | null>`: `null` while the catalog is not ready. `OfflinePlan` is `DownloadPlan` plus `store` (`'opfs' | 'memory-fallback'`) and `writable` (false in a read-only second tab).
  - `downloaded(): Promise<{ bytes; files }>`, from `usage().packsMB` and `packs`.
  - `start()`, `cancel()`, `job()`, `onJob(cb)`, where a job is `{ done, total, state: 'running' | 'done' | 'cancelled' | 'failed', reason? }`.
  - `clear()`.
- **App** (`apps/web/src/offline-port.ts`, new; wired in `createPlatformPort` from `platform.assets`). `start()` runs in this order:
  1. When `navigator.storage.persisted()` is not `true`, call `navigator.storage.persist()` and emit `storage.persist{granted}` through `platform.telemetry`. A refusal does not block the download. This is not the once-per-profile marker of `requestPersist` (`store/persist.ts`): the tap is an explicit request.
  2. Take a fresh `plan()`. If it does not fit, end the job `failed` with reason `quota`, and fetch nothing.
  3. Call `downloadAll` with the job's `AbortController`.

  The job lives in the port, not on the page, so leaving Settings neither stops nor loses it. A second `start()` while one runs returns the running job.
- **Page** (`privacy-storage.ts`, `index.ts`). `SettingsEnv` gains `offline: { plan, downloaded, job } | null`. `SettingsPage` loads it with `useAsync` and re-renders on `onJob`. `installScreen` stays a pure function of `env`:
  - **Size row:** total and still-missing size for this quality level, in MB with one decimal.
  - **Offline button:** enabled only when the plan fits, the store is `opfs` and writable, and no job runs. Otherwise its `disabled` reason is the shortfall in MB, "no persistent store in this browser", "open in another tab", or "size not available yet".
  - **While a job runs:** a `progress` widget (`done / total`) and a `offline-cancel` button.
  - **Result line:** done, stopped (files fetched so far are kept) or failed.
  - **Caveat line:** the browser or the phone may still remove downloaded data when space runs low.
  - **Downloaded row:** MB and file count.
  - **Clear:** disabled while a job runs and in a read-only tab. Otherwise `runAction('clear')` calls `shell.confirm({ danger: true, … })` with a body saying saves and settings stay, and calls `offline.clear()` only on confirm, then reloads the rows. A world pack the running session needs later is a normal miss and is fetched again (11-platform-pwa.md §5 rule 4).
- **Strings** (`en.json`): new `settings.storage.offline.*` and `settings.storage.clear.*` keys in our own words; sizes and counts are parameters.

## Scope out
- An offline reload, cached-catalog boot and the Offline chip (M11a2). Background or service-worker downloads; resuming after a reload (a new Download fetches only what is missing).
- Other tiers' variants, so a tier change after a download needs another Download. Cutscene "Keep offline" (11-platform-pwa.md §4). New C16 events.
- A pack count or a priced estimate in any text: sizes come only from the catalog at run time.

## Deliverables
- `packages/engine/src/assets/store/store.ts`, `packages/engine/src/assets/{rpc.ts, service.ts, client.ts, bridge.ts}`.
- `packages/engine/test/assets/offline-download.spec.ts` (new); `packages/engine/test/assets/service.loopback.spec.ts` (extended).
- `packages/ui/src/shell/types.ts`, `packages/ui/src/pages/settings/{privacy-storage.ts, index.ts}`, `packages/ui/test/settings-offline.spec.ts` (new).
- `apps/web/src/offline-port.ts` (new), `apps/web/src/shell-ports.ts`, `apps/web/test/offline-port.test.ts` (new).
- `content/ui/i18n/en.json`.
- `tests/e2e/offline-download.spec.ts` (new, `@offline-download`). It needs the baked world, so it runs in CI's `DV_WORLD=synth` half and does not go in `GRAYBOX_GREP` (`.github/workflows/ci.yml`, `tests/e2e/graybox-grep.txt`).
- BD rows in the current `spec/11-decision-log-builder*.md` part file, including one that closes the pack-store part of BD-M04b1-08.
- 17 files. No new root script.

## Interfaces
- C13 1.1 `WorldPackStore.downloadAll/usage/clear`, `PackRef.bytes`, `PackUnavailable` reasons `quota` and `aborted`: used unchanged.
- C16 1.2 `storage.persist{granted}`: emitted, name only.
- Not contracts: `RpcOps.downloadPlan`, `DownloadPlan`, `PackStore.downloadPlan`, `quotaFits`, `DOWNLOAD_ALL_CONCURRENCY`, `OfflinePort`, `OfflinePlan`, `SettingsEnv.offline`.

## Acceptance criteria
- AC-1 Given the merged base When the repository checks run Then they pass — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given a `PackStore` on the memory ports with a fake fetcher that resolves on demand When `offline-download.spec.ts` runs Then:
  - `downloadPlan` over five refs, two already stored, reports the totals, the missing bytes and files, and `fits`;
  - with free quota of 1.2 × missing − 1 byte, `fits` is false, `shortfallBytes` is 1, and `downloadAll` rejects with `reason: 'quota'` before any fetch;
  - at most 4 fetches are in flight at once;
  - aborting after two commits rejects with `reason: 'aborted'`, starts no further fetch, and keeps the committed packs (`has` is true);
  - a second `downloadAll` fetches only the missing refs;
  - `clear()` leaves `usage().packs` at 0

  — proof: `pnpm check:unit -- packages/engine/test/assets/offline-download.spec.ts`
- AC-3 Given the in-process loopback worker When the client calls `downloadPlan()` and then `downloadAll` with an `AbortSignal` that fires after the first progress event Then the plan equals the sum of `resolve(ref).bytes` over the catalog, and the call rejects with a `PackUnavailable` named error of reason `aborted` while earlier progress events arrived — proof: `pnpm check:unit -- packages/engine/test/assets/service.loopback.spec.ts`
- AC-4 Given `installScreen` and `runAction` with a fake `OfflinePort` and a fake `ShellApi` When `settings-offline.spec.ts` runs Then:
  - neither `offline` nor `clear` carries `settings.later`;
  - a plan that does not fit disables `offline` with the shortfall text, and pressing it calls nothing;
  - a `memory-fallback` store, a read-only tab and a `null` plan each disable `offline` with their own reason;
  - a running job shows `progress` and `offline-cancel` and disables `clear`;
  - `clear` calls `confirm` with `danger: true` and calls `offline.clear()` only when it resolves `true`

  — proof: `pnpm check:unit -- packages/ui/test/settings-offline.spec.ts`
- AC-5 Given `createOfflinePort` with a fake `navigator.storage` and a fake asset client that record call order When `start()` runs Then:
  - with `persisted()` false the order is `persist`, `downloadPlan`, `downloadAll`, and `storage.persist{granted}` is emitted once;
  - with `persist()` resolving `false` the download still runs;
  - with `persisted()` true `persist` is not called;
  - a plan that does not fit ends the job `failed` with reason `quota` and `downloadAll` is never called;
  - `cancel()` aborts the signal passed to `downloadAll` and the job ends `cancelled`

  — proof: `pnpm check:unit -- apps/web/test/offline-port.test.ts`
- AC-6 Given the QA build with the synth world, in a persistent browser context with OPFS, on Settings › Install and storage When the player presses Download and it completes Then:
  - `__dvBridge.assets.downloadPlan()` reported `totalBytes` equal to the sum of `resolve(ref).bytes` over every resolvable entry of the served catalog (read from `/media-local/`);
  - the done text shows and `has(ref)` is true for every such ref;
  - after `injectFaults({ status: 'network', times: 100000 })` in the same session (no reload), `get(ref)` returns the catalog's `sha256` for every world-pack ref and `stats().network` does not increase;
  - the plan holds at least one world-pack ref (the case fails rather than passing with nothing to check);
  - pressing Clear opens the confirm dialog, and `confirm-ok` leaves `usage().packs` at 0 with the downloaded row at 0 MB

  — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @offline-download && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @offline-download`
- AC-7 Given the new and changed strings When the string checks run Then every new key exists in `en.json`, no catalog value names the display name (text uses `{brand}`), and the IP string scan passes — proof: `pnpm check:i18n && pnpm ip:strings && pnpm names:lint`
- AC-8 Given the branch When the production build is checked and previewed Then no secret pattern is in `apps/web/dist`, the bundle limits hold, and the Preview deploys — proof: `pnpm build && pnpm check:bundle && pnpm check:secrets -- apps/web/dist && pnpm deploy:preview`

## Test plan
- **Unit:** the four specs of AC-2…AC-5; the existing `store.rules.spec.ts` rule-5 case stays green unchanged.
- **E2E:** `@offline-download` on `chromium-webgl2` (required) and `webkit-webgl2`, with `pack-store.spec.ts`'s persistent-context fixture, on a `DV_WORLD=synth` build locally and in CI's synth half.
- **Static and deployed:** AC-7, AC-8.

## Demo script
1. `pnpm map:build -- --area synth`, then `DV_WORLD=synth pnpm dev`, Settings › Install and storage: the size row shows the synth city's size; downloaded reads 0 MB.
2. Download: progress runs to done. Clear, then Cancel: nothing changes. Clear and confirm: downloaded reads 0 MB.
3. Download and Stop at once: the stopped line shows; a second Download fetches only the rest.

## Effort
0.3 Builder session; about 17 files; risk **low**.

## Risks & fallbacks
- **`persist()` may prompt or be refused, and on iPhone it may not protect OPFS (F-010).** The download never depends on its answer, and the caveat line stays.
- **Quota estimates differ by engine (F-010).** Page and store share `quotaFits`. Without an estimate the download runs; a `QuotaExceededError` mid-way takes the store's evict-then-`quota` path, the job ends `failed: quota`, and fetched packs stay.
- **WebKit gives an ephemeral context no OPFS**, hence the persistent context. If `webkit-webgl2` fails for an engine reason the store tests do not show, `chromium-webgl2` stays the gate; tag the WebKit case `@quarantine` (owner M04b4) and record a BD row.
- **Cost.** Each downloaded file is one `/media/` Worker request plus one R2 Class B read, and a file above the FetchRetry slicing threshold one per slice (spec/03 §6, "R2 media through a Worker", item 4; F-023). The page quotes no price.

## Notes for the Builder
- Read first:
  - `spec/domains/11-platform-pwa.md` §5 (rules 4 and 5, the `WorldPackStore` block);
  - `spec/domains/10-ui-pages.md` §2.9 (row "Install & storage");
  - BD-M04b1-08; `M01e-asset-worker-opfs-store.md`;
  - `M11a2-iphone-hardening-governor.md` Scope in (what stays out).
- Do not edit `store/types.ts`: C13 changes only through the Architect. The optional `signal` lives on the class method.
- Write every new string yourself; copy none from another game, launcher or trainer.
- Keep the `settings.later` key: account rows and Forget NPC memories still use it.
- The QA build reads `/media-local/` (`catalog-client.ts`), so the e2e needs no deploy and no secret. `deploy:preview` needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Without them, print the SKIP line and list AC-8's preview step under "Blocked on".
- Spec follow-ups done by the Architect (DL-728): `10-ui-pages.md` §2.9 names M04b4 as the owner of the BD-M04b1-08 rows, and `11-platform-pwa.md` §5 rule 5 asks `persist()` when the player starts the city download.

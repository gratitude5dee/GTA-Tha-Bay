# M01e — asset-worker-opfs-store

## Goal
After this session the client loads C07 content the way the shipped game will. A module `asset.worker` owns all world-content IO:
- it reads the `CatalogPointer`, loads and verifies the catalog, and resolves `AssetRef`s to tier variants;
- it fetches through a shared `fetchRetry` with priority lanes and backoff;
- it verifies SHA-256 and stores each pack once in OPFS (`dv/packs/<sha256>.bin`), with its commit row in IndexedDB `dv-packs`;
- it serves later reads from OPFS without network.

The C13 `WorldPackStore` is complete: pinning, LRU eviction under a soft cap, `gc`, `evictByTag` (the kill-switch path), `usage`, `downloadAll` with a quota check, `clear`, a 48 MB memory fallback, and a read-only second tab. QA builds serve the M01d `dir:` mirror same-origin under `/media-local/`, so the loop runs end to end before `media.<domain>` exists (Q-15). If the M01b2 gray-box loader exists, it now gets its packs through this path.

## Requirements
- R-PLAT-01: the world cache lives outside the service worker, survives reloads, is re-downloadable at any time, and works in the iPhone Home Screen app (D-16, F-010).
- R-ENG-02: lanes and a soft cap keep fetch and storage inside the C13 budgets; `usage()` feeds the M04b1 storage UI and the M11a memory work.
- R-NPC-04 / R-IP-02 (client half): `evictByTag('char:<npcId>')` drops a killed character's cached files (DL-023).
- R-MAP-01 (support): world packs from the catalog reach `sim.worker` unchanged, so `p0` stays tier-independent.

## Depends on
- **M01d:** catalog, `/asset-catalog.json` pointer, `resolveVariant`, `assets:publish --target dir:`, seed assets and the M01f packs in the lock.
- **M01c:** `QualityService` (current tier), the telemetry client (`app.start.store`, `storage.persist`), the `dv-platform` store, `createPlatform`.
- **M00a:** `GET /api/v1/boot` (`hosts.media`). **M00:** QA bridge and `verify:dist`. **M01a2:** module-worker bundling pattern.
- Optional **M01b2:** the gray-box loader (`packages/engine/src/client/graybox/load.ts`).
- Contracts: C13 1.1 (`11-platform-pwa.md` §5, §11 `AssetSource`), C07 1.1, C16 1.1.

## Scope in
- **Types** copied verbatim from pwa §5 into `packages/engine/src/assets/store/types.ts`: `PackRef`, `PackFailure`, `PackUnavailable`, `StorageUsage`, `WorldPackStore`. `AssetSource` (pwa §11) is copied too.
- **Store core** over two ports:
  - `FileStore`, with implementations `opfs-files.ts` (`navigator.storage.getDirectory()` → `dv/packs/`; writes through a short-lived `createSyncAccessHandle`; `flush()` then `close()`) and `memory`;
  - `IndexStore`, with implementations `idb-index.ts` (IDB `dv-packs`, store `packs`, row `{sha256, bytes, kind, tags, createdAt, lastUsedAt, pinned}`) and `memory`.
  The core is a plain class with an injected clock, so Node unit tests run on the memory ports.
- **Rules 1–7 of pwa §5:**
  - *Write:* fetch → `crypto.subtle.digest('SHA-256')` → write → `flush` → IDB row (the commit). A file without a row is an orphan; `open()` deletes it.
  - *Read:* row lookup, size check, `lastUsedAt` update. A caller-reported decode failure purges the entry and refetches once.
  - *Eviction:* soft cap `WORLD_CACHE_SOFT_CAP_MB` (600 on mobile tiers, 2,048 otherwise), LRU among unpinned entries, and also on `QuotaExceededError`. `gc(current)` drops packs absent from the current catalog and unused for 14 days.
  - *Persistence:* `requestPersist(reason)` calls `navigator.storage.persist()` once per profile and emits `storage.persist{granted}`. In v1 only the first standalone launch calls it; story start calls it from M05a1 on.
  - `downloadAll` refuses unless free quota is ≥ 1.2 × bytes.
  - *No OPFS:* the store falls back to a 48 MB memory LRU, and `app.start` reports `store: 'memory'`.
  - *Tabs:* `BroadcastChannel('dv-instance')`. A second tab becomes read-only (`mode() === 'read-only'`) and shows a non-blocking notice. Sync-handle opens retry up to 20 times with jitter.
- **`fetchRetry`** (pwa §5 "Fetch layer"):
  - `fetch(url, {cache: 'no-store', priority, mode: 'cors'})`;
  - up to 8 attempts on 5xx, 429 or network error before the body is read, waiting `min(5000, 300 × 2ⁿ) × (0.5 to 1.5)` ms;
  - 4xx other than 429 fails at once as `http`; an error body is never stored;
  - an in-flight map makes a `now` request join a speculative prefetch;
  - objects over 4 MB are fetched as 1 MiB-aligned Range slices;
  - lanes: `now` ≤ 8, `soon` ≤ `LANES` (16 on desktop, 8 on mobile and XR), `idle` ≤ 2.
- **Catalog client** (in the worker):
  - read `/api/v1/boot` → `hosts.media` and `/asset-catalog.json` → fetch `manifests/assets-<sha>.json`;
  - verify the catalog's SHA-256 and `bytes` against the pointer; a mismatch sets `catalogState: 'invalid'`, so the game runs without packs, and nothing is cached;
  - `resolve(ref, tier)` → `resolveVariant` → `PackRef {url, sha256, bytes, kind, tags}`;
  - `AssetSource` hooks are consulted first. None is registered in v1; M13a2 adds the mod source.
  - Media base: `hosts.media` when non-empty. When it is empty (dev, staging and preview vars until Q-15), QA builds use `${location.origin}/media-local` and production builds disable the catalog.
- **Worker and client.**
  - `packages/engine/src/workers/asset.worker.ts` is a module worker with a typed RPC (`rpc.ts`).
  - `AssetClient` on the main thread offers `get(ref | PackRef, {priority, signal})`, which returns a transferred `ArrayBuffer`, plus `prefetch`, `pin`, `usage`, `evictByTag`, `downloadAll`, `clear`, `mode` and `catalogState`.
  - It is started by `createPlatform`, which now waits for `open()` before emitting `app.start`.
- **Telemetry:** `storage.persist{granted}`, and `err.asset{reason, kind}` with at most 5 per reason per session. Add the `err.asset` props schema to `packages/shared/schemas/telemetry/names.schema.json`; the M00a rule lets each emitter milestone add its names' schemas.
- **QA (`VITE_DV_QA=1` only):**
  - `__dvBridge.assets` with `get`, `has`, `usage`, `stats()` (`{network, hits, retries, evictions}`), `configure({softCapBytes})`, `injectFaults({status | 'network', times, match})`, `reopen({force?: 'memory'})`, `writeOrphan(sha)`, `mode()`, `catalogState()`;
  - Vite plugin `apps/web/vite/media-local.ts` copies `apps/web/media-local/` into `dist/media-local/`. The QA build step fills it first with `pnpm assets:publish -- --target dir:apps/web/media-local --pointer-out apps/web/media-local`.
- **Gray-box hook-up** (only if M01b2 landed): `load.ts` fetches `world_pack/p0-64-64` and `world_pack/l0-64-64` through `AssetClient` (`priority: 'now'`, pinned as the boot set) instead of static URLs, then transfers them to `sim.worker` exactly as before.

## Scope out
- Settings › Storage, "Download San Francisco", coach mark: M04b1. Offline-relaunch e2e, soak, lane calibration, `MemoryBudget` hooks: M11a.
- `l0` meshing, `ChunkStore` and streaming priorities: M02b1. Mod installer and the mod `AssetSource`: M13a2. Cutscene offline cache (SW `RangeRequestsPlugin`): M04c/M05b2.
- R2 bucket CORS and the `media.<domain>` custom domain: operator runbook from M01d, after Q-15.

## Deliverables
- `packages/engine/src/assets/store/{types.ts, ports.ts, store.ts, opfs-files.ts, idb-index.ts, memory-ports.ts, fetch-retry.ts, lanes.ts, tab-lock.ts, persist.ts, catalog-client.ts}`.
- `packages/engine/src/assets/{client.ts, rpc.ts, bridge.ts}`, `packages/engine/src/workers/asset.worker.ts`; `packages/engine/src/platform/index.ts` (start the worker, open before `app.start`).
- `packages/engine/test/assets/{store.rules.spec.ts, fetch-retry.spec.ts, catalog-client.spec.ts, lanes.spec.ts}`.
- `packages/shared/schemas/telemetry/names.schema.json` (`err.asset` props).
- `apps/web/vite/media-local.ts`, `apps/web/vite.config.ts` (plugin, QA only), `apps/web/package.json` (QA build step), `.gitignore` (`apps/web/media-local/`), `apps/web/scripts/verify-dist.mjs` (also rejects `media-local` and `__dvBridge.assets`).
- `tests/e2e/pack-store.spec.ts` (tags `@pack-store`, `@pack-faults`, `@pack-evict`, `@pack-tabs`, `@pack-graybox`).
- Optional: `packages/engine/src/client/graybox/load.ts` (switched to `AssetClient`).
- `docs/device-spike/M01e/iphone15/notes.json` (operator).
- ≈ 27 files.

## Interfaces
- C13 1.1: `WorldPackStore`, `PackRef`, `PackFailure`, `PackUnavailable`, `StorageUsage` and `AssetSource` implemented as typed. Storage names `dv/packs/<sha256>.bin` and IDB `dv-packs` (06 §5).
- C07 1.1: catalog and pointer read-only; `resolveVariant` from M01d. C16 1.1: registry names only.
- Not contracts: `AssetClient`, the worker RPC, the bridge.

## Acceptance criteria
- AC-1 Given a clean clone after M01d When the standard gates run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build`
- AC-2 Given the memory ports and an injected clock When the store rules run Then:
  - a crash injected between `flush` and the row write leaves an orphan, which the next `open()` deletes;
  - a hash mismatch leaves neither file nor row;
  - with a 3-pack soft cap, the least recently used unpinned pack is evicted and pinned packs stay;
  - `gc(current)` removes only packs that are absent from `current` and unused for over 14 days;
  - `evictByTag('char:npc_test')` removes only tagged packs;
  - `downloadAll` rejects when free quota is below 1.2 × bytes.
  — proof: `pnpm check:unit -- packages/engine`
- AC-3 Given a fake `fetch` and a seeded jitter source When `fetchRetry` meets 503s Then the delays equal `min(5000, 300 × 2ⁿ) × u` for the injected `u`; it stops after 8 attempts with `http`; a 404 fails after 1 attempt; five concurrent `get`s of one hash make one request; lane occupancy never exceeds 8, `LANES` and 2; a 9 MB object arrives as 9 Range slices of 1 MiB and is reassembled byte-exactly — proof: `pnpm check:unit -- packages/engine`
- AC-4 Given a pointer whose `sha256` does not match the catalog bytes When the catalog client loads Then `catalogState` is `'invalid'`, no pack is fetched, and boot continues. With a valid pointer, `resolve('texture/asset-smoke', 'mobile-low')` gives the `mobile-low` key and `xr-quest` gives the `mobile` key — proof: `pnpm check:unit -- packages/engine`
- AC-5 Given the QA build When `@pack-store` runs on `chromium-webgl2` and `webkit-webgl2` Then `open()` returns `'opfs'`; `get('world_pack/p0-64-64')` returns bytes whose SHA-256 equals the catalog's; after a reload `has()` is true and `stats().network` stays 0 for that pack; a `PackRef` with a wrong hash rejects with `hash-mismatch` and `usage().packs` is unchanged — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pack-store && pnpm check:e2e -- --project=webkit-webgl2 --grep @pack-store`
- AC-6 Given `injectFaults({status: 503, times: 3})` When a pack is fetched Then it resolves with `stats().retries` 3. With `times: 8` it rejects with reason `http`, and an `err.asset` event is queued — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pack-faults`
- AC-7 Given `configure({softCapBytes})` set just above two packs' size When three packs are fetched, the first pinned Then the second is evicted and the first stays. `evictByTag` and `clear()` behave as in AC-2 on real OPFS. `reopen({force: 'memory'})` returns `'memory-fallback'` and `get` still works — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pack-evict`
- AC-8 Given two pages of the app in one browser context When both open Then the second reports `mode() === 'read-only'` and shows the notice, and the first can still write a new pack — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pack-tabs`
- AC-9 Given M01b2's gray-box loader When the home page loads twice Then the first load fetches both fixture packs once, and the second boots the block with `stats().network` 0 and `observe()` showing 4 chunks. If M01b2 has not landed, this AC is skipped, and the report says so — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pack-graybox`
- AC-10 Given a production build When the dist verifier runs Then there is no `media-local/` and no `__dvBridge.assets` — proof: `pnpm build && pnpm --filter @dv/web verify:dist`
- AC-11 Given an iPhone 15 Home Screen app on the preview URL When the operator loads the home page, closes the app from the app switcher and relaunches Then `has()` is true for both fixture packs without network, and `notes.json` records `open()`, `persist()` and `estimate()` for Home Screen and Safari tab — proof: manual: iPhone 15; open `/?perf=1`, use HUD "Export" before and after the relaunch; commit `docs/device-spike/M01e/iphone15/notes.json`
- AC-12 Given the branch When the preview deploys Then isolation holds with the worker running — proof: `pnpm deploy:preview && pnpm check:coi -- <preview-url>`

## Test plan
- **Unit (Node, memory ports):** `store.rules`, `fetch-retry`, `lanes`, `catalog-client`. Run with `pnpm check:unit`.
- **e2e:** `@pack-store` in Chromium and WebKit (OPFS sync handles exist in WebKit's dedicated workers, Safari 15.2+ [research/stack-rendering-platform.md §2]); `@pack-faults`, `@pack-evict`, `@pack-tabs` and `@pack-graybox` in Chromium. M01c and M01b2 tags stay green.
- **Device:** AC-11. It answers part of U-PLT-16 by observation only.

## Demo script
1. `pnpm dev`, open `/?perf=1`, run `await __dvBridge.assets.get('world_pack/p0-64-64')` and see the byte length.
2. Reload, then `__dvBridge.assets.stats()`: `network` is 0 for the pack.
3. `__dvBridge.assets.injectFaults({status: 503, times: 3})`, fetch `texture/asset-smoke`: `retries` is 3.
4. Open a second tab: the read-only notice shows.
5. `__dvBridge.assets.usage()`, then `clear()`, then `usage()` again: 0 packs.

## Effort
1 session; ≈ 27 files; risk **medium**. OPFS sync-handle behaviour in WebKit workers and Playwright's view of worker traffic are the uncertain parts; the bridge counters avoid relying on the latter.

## Risks & fallbacks
- **`createSyncAccessHandle` fails in WebKit under Playwright.** Fall back to async `createWritable()` for writes in that engine only, log a Builder decision, and keep AC-5's assertions.
- **Two-tab sync-handle conflicts (U-PLT-16, UNVERIFIED).** The design avoids concurrent writers through the read-only second tab; the jittered retry covers races.
- **OS eviction of OPFS on iOS (UNVERIFIED).** Nothing assumes persistence; a missing pack is a normal miss. AC-11 records what happens and asserts no durability rule.
- **Cross-origin media later.** Fetches already use CORS mode, so `media.<domain>` only needs the bucket CORS from the M01d runbook (COEP `require-corp` accepts CORS responses [research/stack-cloudflare-backend.md §1.2]).

## Notes for the Builder
- Read first: `11-platform-pwa.md` §1, §5, §6, §11; `11-platform.md` §5.9 (threads); `02-architecture.md` §4.2 (asset streaming); `05-assets.md` §4.1 and §4.4. Facts: F-006, F-010, F-016, F-019 [research/stack-rendering-platform.md §3.2, §6.5; research/repos-webport.md P3–P7].
- Order: types and ports → store core with unit tests → `fetchRetry` and lanes → catalog client → OPFS and IDB ports → worker and RPC → bridge and media-local → e2e → gray-box hook-up → device.
- OPFS access stays inside `asset.worker`. `createSyncAccessHandle` exists only in dedicated workers. Rebuild typed views after every `await`.
- Use the dedicated-worker pattern from M01a2's `sim.worker` (`new Worker(new URL(...), {type: 'module'})`); reuse its bundling.
- Never route packs through the service worker or the Cache API (D-16). Keep `/media-local/` out of the precache manifest (`check:bundle`).
- Secrets: none for code; `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (CI; locally the SKIP line). No paid account. The iPhone comes from Q-13.
- Branch `m01e-asset-worker-opfs-store`.

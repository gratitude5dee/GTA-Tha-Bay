# M13a2 — mod-installer-store-client

## Goal
Mods can be installed, updated, rolled back and uninstalled on a device, atomically, and the catalogue can be read. When this milestone is done the repository has:
- **client side:** the `dv-mods` IndexedDB registry and journal; write-once OPFS blobs named by SHA-256 and written only by `asset.worker`; the six-step install transaction with boot recovery; a byte-equal uninstall; update with a one-version rollback; local import; the `AssetSource` that serves `<kind>/mod.<sha12>` refs; the route 35 store client; the route 53 revocation poll;
- **server side:** migration 0007 and the read-only catalogue routes 35 and 53.

Publishing (route 36) does not exist yet, so CI and staging use fixture rows and fixture archives.

## Requirements
- R-MOD-01: the local install, update and rollback loop that every mod workflow needs.
- R-MOD-04: experiences reach the device through the same catalogue and installer before they can be entered (M13a3).

## Depends on
- **M13a1**: contracts C14/C17, the shared validator, `ModBudgetReport`, `config/mod-limits.json`.
- **M01e**: `asset.worker`, the OPFS store, the C13 `AssetSource`/`WorldPackStore` patterns, the storage-pressure API.
- **M05d**: Supabase, `DataPort` with `InMemoryDataPort`, `pnpm check:db`, `pnpm check:db:types`, `db:push` in `deploy.yml`.
- Contracts: C14 1.0 (install records B§5, DTOs and errors B§7), C12 1.1 (route 35 with `sort`, `tier`, `limit`; route 53 `RevokedRes`; migration 0007 per C12 1.1 §3), C13 1.1 (`AssetSource`, tiers), C16 1.1 (`mod.install`, `mod.uninstall`).

## Scope in
- **Registry** (`packages/engine/src/client/mods/registry.ts`): IndexedDB `dv-mods` v1. Stores: `installed` (key `modId`), `journal` (key `txId`, index `by_state`), `meta` (key `k`: `revokedSince`, `lastUpdateCheck`). Every access is in try/catch; a failure surfaces as `ModErrorCode`.
- **Blob store** (`packages/engine/src/workers/asset-mod-source.ts`, in `asset.worker`, the single OPFS writer):
  - write-once `dv/mods/blobs/<sha256>` (skipped when present) and staging `dv/mods/staging/<txId>/archive`;
  - a `ModBlobPort` interface with an in-memory implementation for Node tests;
  - the `AssetSource` implementation for refs `<kind>/mod.<sha256[0:12]>` (C07 1.1 mod `AssetSource`).
- **Installer** (`installer.ts`, main-thread facade of `ModInstaller`, work in `asset.worker`): the six steps of `12-modding.md` §5.1.
  1. Journal `begun`.
  2. Download to staging and compare SHA-256 with the catalogue `archiveSha256`.
  3. Bounded unzip and the client validator subset from M13a1: envelope, allowlist, schema, closed permissions, `compat.api`, caps, and `ModBudgetReport` against this device's tier.
  4. Write blobs; journal `staged` with the blob list.
  5. One `readwrite` transaction over `installed` and `journal` (pointer swap; `previous` keeps one older version).
  6. GC by reference scan.
  - `recover()` runs at boot: it rolls `staged` transactions forward after re-hashing and aborts `begun` ones; GC is idempotent.
  - Each step emits `InstallStepEvent` with one human line.
- **Uninstall** with optional data deletion: tombstones `mod:<id>` through `SaveService` only when asked. **Rollback** is a pointer swap. **Enable/disable** writes `enabled` plus a journal row.
- **Limits:** ≤ 64 packages and ≤ 512 MiB combined (`config/mod-limits.json` `install`); the storage estimate is checked before download → `install.quota`; storage pressure goes through M01e's API.
- **Local import** (`{kind:'local', blob, name}`): runs the same steps; `installedFrom: 'local'`; needs `allowLocal: true` from the caller (the toggle UI is M13a7). A banned format yields the fixed message "Game files from other titles can't be uploaded".
- **Store client** (`store-client.ts`): route 35 list, detail and version (`q`, `kind`, `sort=new|top|installed`, `tier=<this device's QualityTierId>`, `limit ≤ 50`, cursor). Results are cached in memory for the session; offline → the last result with `offline: true`. The update check runs at store open and once a day (`meta.lastUpdateCheck`).
- **Revocations** (`revocations.ts`): route 53 `GET /api/v1/mods/revoked?since=<ms>&cursor` at launch and every 6 h while online. Matching installs get `revoked {reason, at}`; `canLoad(modId)` returns `install.revoked` for them.
- **Server** (`services/edge/src/mods/`):
  - route 35 handlers (`GET /mods`, `/mods/:id`, `/mods/:id/versions/:ver`) and route 53, on `DataPort.ugc` methods in the Supabase implementation and in `InMemoryDataPort` (store interfaces carry one method per route, `09-backend-contracts.md` §2.6);
  - only `published` versions are visible; DTOs expose `mods.slug` as `ModId` and never a database UUID;
  - `archiveUrl` is built from `BootConfig.hosts.ugc`;
  - `installs30d` reads 0 until the nightly roll-up (M14b).
- **Migration** `supabase/migrations/0007_ugc_forum.sql`:
  - the complete §3.7 file of `09-backend-db.md`: `mods`, `mod_versions`, `experiences`, `forum_boards`, `forum_threads`, `forum_posts`, `forum_votes`, `device_codes`, with checks, indexes (incl. the GIN `tsv` title index of DL-190), RLS, the forum policies (`ft_public_read`, `fp_public_read`, `ft_author_insert`, `fp_author_insert`, `fv_self`), the triggers `forum_votes_apply` (thread and post `score`, `experiences.rating_sum`/`rating_count`) and `forum_posts_count` (`post_count`, `last_post_at`), and the board seed rows of `12-modding-publish.md` C§5;
  - a migration is applied once and never edited, so the whole file lands here; M13b1 and M13c1 add routes only and ship no migration (DL-228);
  - pgTAP tests in `supabase/tests/0007_ugc_forum.test.sql`; `packages/shared/src/db.gen.ts` regenerated.
- **QA bridge** `__dvBridge.mods` (QA builds only): `installFixture(name)`, `uninstall(id, deleteData)`, `registry()`, `opfsSnapshot()`.
- **Telemetry:** `mod.install {result, source, tier}` and `mod.uninstall {deleteData}`, with `mod` = first 8 hex of SHA-256(ModId); schemas in `packages/shared/schemas/telemetry/`.

## Scope out
- Loader, `ModHost`, `modsActive()`, mod saves at run time, route 37: M13a3. Store and installed pages, local-import toggle: M13a7.
- Route 36 publish, server scan, R2 `ugc-staging → ugc-public` flow: M13c2. Forum routes: M13b1. Device codes routes: M13c1.
- `installs30d` roll-up and A-series alerts: M14b. Real archive downloads on staging need published versions (M13c2) and the `ugc.<domain>` host (Q-15).

## Deliverables
- `packages/engine/src/client/mods/{registry.ts, journal.ts, installer.ts, store-client.ts, revocations.ts, gc.ts, snapshot.ts, qa-bridge.ts, index.ts}`.
- `packages/engine/src/workers/{asset-mod-source.ts, mod-blob-port.ts}` and the `asset.worker` message additions.
- Tests:
  - `packages/engine/src/client/mods/test/{install-atomic.spec.ts, uninstall-byte-equal.spec.ts, update-rollback.spec.ts, revoked.spec.ts, limits.spec.ts, local-import.spec.ts, store-client.spec.ts}`;
  - `test/fixtures/build-fixture-archives.ts` (archives built in memory with M13a1's `packMod`).
- `services/edge/src/mods/{routes.ts, revoked.ts, dto.ts}`; the Supabase and in-memory `UgcStore` methods; `services/edge/test/mods.test.ts`.
- `supabase/migrations/0007_ugc_forum.sql`, `supabase/tests/0007_ugc_forum.test.sql`, regenerated `packages/shared/src/db.gen.ts`.
- `tests/e2e/mods-install.spec.ts` (tag `@mods-install`).
- `packages/shared/schemas/telemetry/{mod.install, mod.uninstall}.schema.json`.
- Dev dependency `fake-indexeddb` for Node tests (not in the ledger: take what pnpm resolves, pin, record in `spec/03`).
- Secrets: none new. Supabase secrets come from M05d. **Gate Q-15** (the `ugc.<domain>` host) affects only real staging downloads.

## Interfaces
- C14 1.0: `ModInstaller`, `InstalledMod`, `InstalledVersion`, `JournalEntry`, `InstallSource`, `InstallStepEvent`, `InstallResult`, `ModErrorCode` used verbatim. C12 1.1: routes 35 and 53 and migration 0007 exactly as specified. C13 1.1: `AssetSource` implemented for mod refs.
- No contract change.

## Acceptance criteria
- AC-1 Given a v1 mod installed and a v2 install that is crashed by the test hook after each of the six steps in turn When a fresh installer instance runs `recover()` each time Then `installed[modId].active` is exactly v1 or v2 (v2 only after step 5), every journal row is `committed` or `aborted`, no `staging/` directory remains, and no blob is unreferenced — proof: `pnpm check:unit -- packages/engine/src/client/mods/test/install-atomic`
- AC-2 Given a snapshot of every `dv/mods/` path with its SHA-256 plus every `installed` row When a mod is installed and then uninstalled with `deleteData: true` Then the snapshot is identical (terminal journal rows excluded), and the `mod:<id>` slot is tombstoned — proof: `pnpm check:unit -- packages/engine/src/client/mods/test/uninstall-byte-equal`
- AC-3 Given v1 active When v2 is installed and `rollback` is called Then `active` is v1 and `previous` is v2 with no blob written or deleted during the rollback, and a third version evicts the oldest only after `lastRunOk` names the new one — proof: `pnpm check:unit -- packages/engine/src/client/mods/test/update-rollback`
- AC-4 Given a route 53 fixture listing `(modId, version, 'dmca')` When the poll runs Then that install is marked `revoked` with the reason, `canLoad` returns `install.revoked`, the next poll uses `since` from `meta`, and polls are scheduled at launch and every 6 h — proof: `pnpm check:unit -- packages/engine/src/client/mods/test/revoked`
- AC-5 Given an archive whose SHA-256 differs from the catalogue, a 65th package, a storage estimate below the archive size, a manifest with `compat.api` `^2.0.0`, and a local `.rpf` import When each is installed Then the results are `install.hash_mismatch`, `install.quota`, `install.quota`, `compat.api`, and a `type.banned_format` result whose `fix` text is "Game files from other titles can't be uploaded", each with a journal row `aborted` — proof: `pnpm check:unit -- packages/engine/src/client/mods/test/limits packages/engine/src/client/mods/test/local-import`
- AC-6 Given `InMemoryDataPort` seeded with published, `needs_review` and `removed` versions When routes 35 and 53 are called with `q`, `kind`, `sort`, `tier`, `limit=51` and a cursor Then only published versions are listed, `limit` above 50 is a 400 `ApiError`, items carry `ModId` slugs and no UUID anywhere in the body, and route 53 pages revoked items newer than `since` — proof: `pnpm check:workers -- mods`
- AC-7 Given migration 0007 When the DB tests run Then all eight tables exist with RLS enabled, `anon` cannot select from `mods`, `mod_versions`, `experiences` or `device_codes`, `radius_m` 251 and an unknown `state` are rejected, and the generated types match the schema — proof: `pnpm check:db && pnpm check:db:types`
- AC-8 Given a QA build in Chromium and in WebKit with real OPFS and IndexedDB When `@mods-install` installs a fixture through `__dvBridge.mods`, reloads, reads a mod asset through the `AssetSource`, then uninstalls Then the registry survives the reload, the asset bytes hash to the manifest value, and the OPFS snapshot after uninstall equals the one before install — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-install && pnpm check:e2e -- --project=webkit-webgl2 --grep @mods-install`
- AC-9 Given the new telemetry names When the telemetry gate runs Then `mod.install` and `mod.uninstall` props validate, carry no ids or free text, and only the 8-hex `mod` hash identifies the mod — proof: `pnpm check:telemetry`
- AC-10 Given the changed Worker and web code When the production build is checked Then it has no `/_test/` route and no secret pattern, so the app stays deployable — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`

## Test plan
- **Unit (Node, `fake-indexeddb` plus the in-memory `ModBlobPort`):** the seven specs above. Command: `pnpm check:unit -- packages/engine/src/client/mods`.
- **Workers runtime:** `mods` (routes 35 and 53).
- **DB:** pgTAP for 0007; types diff.
- **E2E:** `@mods-install` on `chromium-webgl2` and `webkit-webgl2` (real OPFS; WebKit is the Safari-engine proxy).
- **Static:** `check:telemetry`, lint, typecheck.

## Demo script
1. `pnpm check:unit -- packages/engine/src/client/mods`; read the six crash points of `install-atomic`.
2. `pnpm dev`; in the console run `await __dvBridge.mods.installFixture('cones')` and watch the six step lines.
3. Reload; `__dvBridge.mods.registry()` still lists it.
4. `await __dvBridge.mods.uninstall('demo.cones', true)`; compare `opfsSnapshot()` with the value printed before install.
5. `curl` the local `/api/v1/mods?limit=5` (empty, or the seeded rows under `wrangler dev` with the in-memory port).

## Effort
1 session; ≈ 36 hand-written files. Risk medium: OPFS behaviour differs in WebKit, and a long migration file.

## Risks & fallbacks
- WebKit OPFS lacks a `createWritable` path that M01e did not already cover: reuse M01e's write path (sync access handle inside `asset.worker`). If WebKit still fails, keep `@mods-install` required on Chromium only, record the WebKit result as an artifact, and report.
- `fake-indexeddb` does not model transaction abort exactly: test the crash points between steps (the AC's unit of atomicity), not inside one IndexedDB transaction.
- Migration 0007 cannot be applied to staging before the forum routes exist: it is expand-only and the tables stay empty, so it ships here. `db:push` runs in `deploy.yml`.
- File budget: merge `gc.ts` and `snapshot.ts` into `journal.ts` first.

## Notes for the Builder
- Read first: `12-modding.md` §4, §5.1, §5.5; `12-modding-contracts.md` B§5, B§7; `12-modding-publish.md` C§6, C§7; `09-backend-contracts-1.1.md` §1, §3; `09-backend-db.md` §3.7; `09-backend-contracts.md` §2.6.
- `asset.worker` is the only OPFS writer [research/repos-webport.md P14]. The main thread never writes `dv/mods/`.
- Never trust the catalogue: re-hash every entry against the manifest.
- Timestamps are epoch ms; `txId` is UUIDv7, minted on device for journal rows only.
- Branch `m13a2-mod-installer-store-client`.

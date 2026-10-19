# M01d — assets-publish

## Goal
After this session the repository has the release half of C07. Asset specs go in; a deterministic, content-addressed catalog comes out (`manifests/assets-<sha256>.json`). Each variant is keyed `<root>/<variant>.<sha256[0:12]>.<ext>`. `resolveVariant` follows C13 `VARIANT_FALLBACK`. The reviewed lock file `assets/assets.lock.json` is the release gate. `check:assets` and `provenance:check` enforce the C07 invariants against the lock. `assets:publish` uploads blobs to R2 bucket `tha-bay-media-<env>` with rclone, verifies them, uploads the immutable catalog last, and writes the `CatalogPointer` that ships with the Worker (`/asset-catalog.json`, `BootConfig.assetCatalog`). A local `dir:` target gives the same tree without Cloudflare, so M01e can serve it same-origin in QA builds. The first catalog holds original smoke assets plus the M01f gray-box world packs. No generated asset exists yet.

## Requirements
- R-IP-01: nothing reaches R2 without a lock entry and an `active`, `production` provenance record; every lock variant joins the `provenance:check` ship set.
- R-PLAT-01: content-hashed immutable keys and an atomic pointer that ships with the Worker version, so a deploy or rollback switches content cleanly [research/gap-ci-cd-release-assets.md §2.2].
- R-ENG-02: tier variants resolve without stepping upward (C13), and per-file size caps are enforced (25 MiB per file, 4 MiB per world pack; D-17, F-018).
- R-ENG-01: one deterministic CLI per step, with no GUI step except the one-time bucket setup in the runbook.

## Depends on
- **M00b:** `c07.ts` (types, `assetRefOf`, `objectKey`), `provenance.ts`, the provenance schema, `config/license-allowlist.json`, `tools/ci/provenance-check.ts`, `tools/assets/provenance-new.ts`, `check:assets` (config schemas).
- **M00a:** `GET /api/v1/boot` with `assetCatalog: ''`; `check:workers`.
- **M01a1:** `canonicalize`, `sha256Hex`.
- **M01f** (soft): `tests/fixtures/world/civic-graybox/{p0-64-64,l0-64-64}.pack` and their provenance records. If absent, the catalog has no `world_pack` entries; note it in the report. M01f then adds the two specs and lock entries when it lands (its Deliverables, AC-11; DL-290).
- Contracts: C07 1.1 (`05-assets.md` §4.1–§4.4, `05-assets-pipeline.md` §3, §9, §14), C13 1.1 (`VARIANT_FALLBACK`), C12 1.1 (`BootConfig.assetCatalog`).

## Scope in
- **`resolveVariant(m, tier)`** in `c07.ts`: return `default` if present, else the first id of `VARIANT_FALLBACK[tier]` present in `m.variants`, else throw `AssetError('NO_VARIANT')`. Add `packages/shared/src/assets/fidelity.ts` (`TIER_FIDELITY`, `FIDELITY_VARIANT`, 05 §4.2) and `contentTypeOf(ext)` for the §4.4 table plus `.png` `image/png` and `.pack` `application/octet-stream`.
- **Asset specs.** One file per asset, `assets/src/<kind>/<id>/asset.json` (`AssetSpec`, tool-internal, not a contract): `{kind, id, variants: {<VariantId>: <repo-relative path>}, deps, tags, extras?, likeness?, status, visibility}`. Seed set, all original:
  - `data/asset-smoke`: a JSON file, variant `default`;
  - `texture/asset-smoke`: deterministic PNG checkerboards of 64, 32 and 16 px as `desktop`, `mobile` and `mobile-low`, written once by `tools/assets/src/seed.ts` with `node:zlib` and committed;
  - `world_pack/p0-64-64` and `world_pack/l0-64-64` pointing at the M01f fixture, variant `default`.
  Records for the seeds come from `pnpm provenance:new` (`origin: authored`, `LicenseRef-DeeVerse-Owned`).
- **`assets:catalog`** builds `dist/assets/<buildId>/` (git-ignored): every blob at its key, `manifests/assets-<sha256>.json`, `pointer.json`.
  - Key: `objectKey(kind, id, variant, sha256, ext)` under root `assets/<kind>/<id>/`.
  - `rev`: the lock's `rev` when every variant hash is unchanged, else `rev + 1`, or `1` for a new asset.
  - `provenance` summary from the variant's root record (walk `derived_from` to a record that has none).
  - Only `active` + `public` entries enter the catalog.
  - `gitSha` and `createdAt` (epoch ms) come from the last commit that touched `assets/assets.lock.json`; `buildId` = the first 16 hex of `sha256Hex(canonicalize(entries))`. Equal inputs therefore give byte-identical output.
- **`assets:lock -- --approved-by <handle>`** rewrites `assets/assets.lock.json` (`asset-lock/1`, 05 §4.3) for changed refs only. `approved_at` is ISO-8601 `Z`: repo-audited files are the DL-059 exception.
- **`assets:verify`** runs the catalog build in memory and every check below, offline.
- **`check:assets` additions** (05 §4.2 rules, pipeline §9):
  - spec hashes equal lock hashes;
  - `rev` never regresses against the lock;
  - every variant hash has a valid record;
  - all six tiers resolve, and tiered kinds (`character`, `vehicle`, `prop`, `texture`, `building`) carry `desktop`, `mobile` and `mobile-low` or a `default`;
  - deps exist, are active and acyclic;
  - no `killed`, `quarantined` or `private` entry in the catalog;
  - files ≤ 25 MiB and `world_pack` ≤ 4 MiB;
  - `config/asset-budgets.json` (pipeline §3 table, with schema) validates; only its file-bytes column is enforced now, stats columns from M03a1/M10a;
  - the two pointer copies are identical.
- **`provenance:check`:** the ship set adds every lock variant (05 §4.3). `asset-catalog.json` is excluded from the static-file walk, because it is metadata validated by `check:assets`.
- **`assets:publish -- --env staging|prod [--target r2|dir:<path>] [--dry-run] [--pointer-out <dir>]`.**
  1. Run `assets:verify`; any finding aborts.
  2. Upload the blobs with one invocation per content class (`.json`, `.png`, `.ktx2`, `.glb`, `.pack`) [research/gap-ci-cd-release-assets.md §2.1]:
     - rclone S3 remote configured only from the environment: `RCLONE_CONFIG_R2_TYPE=s3`, `RCLONE_CONFIG_R2_PROVIDER=Cloudflare`, endpoint `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`, keys from `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, `no_check_bucket`;
     - flags `--include`, `--immutable`, `--ignore-existing`, `--header-upload "Cache-Control: public, max-age=31536000, immutable"`, `--header-upload "Content-Type: <type>"`;
     - never `Content-Encoding`.
  3. Verify every key's size (rclone listing; with `MEDIA_ORIGIN` set, also `HEAD` for `Content-Length`, `Content-Type` and no `Content-Encoding`).
  4. Upload `manifests/assets-<sha>.json`.
  5. Write the pointer to `apps/web/public/asset-catalog.json` and `services/edge/src/generated/asset-catalog.json`, or to `--pointer-out`.
  The `dir:` target copies with the same keys and skips existing files. Missing secrets or a missing `rclone` binary on the `r2` target print `SKIP assets:publish: <reason>` after step 1 and exit 0.
- **Edge:** route 2 returns `assetCatalog` = the generated pointer's `key` (empty when the pointer is absent).
- **Runbook** `docs/runbooks/r2-media.md` (operator, one time):
  - create buckets `tha-bay-media-staging` and `tha-bay-media-prod`;
  - set bucket CORS to `GET, HEAD` from the app origins;
  - keep `r2.dev` off;
  - add an R2 API token scoped to the two media buckets, giving `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`;
  - once Q-15 settles: custom domain `media.<domain>`, a Cache Rule "eligible, respect origin", Smart Tiered Cache [research/gap-ci-cd-release-assets.md §2.3].

## Scope out
- glTF and KTX2 optimization, `assets:gen`, fidelity builds and stats-based budgets: M03a1 and M10a. Garbage collection of old prefixes and kill purges: M10b.
- The `MEDIA` binding on the Worker: M05b1. Cutscene keys and `cutscene-index`: M05b1/M05b2.
- A CI workflow that publishes automatically: M02a1, when real packs exist. Client loading, OPFS and `media-local` serving: M01e.

## Deliverables
- `packages/shared/src/assets/{c07.ts (resolveVariant), fidelity.ts, content-type.ts}`, `packages/shared/test/assets.resolve.spec.ts`.
- `tools/assets/src/{spec.ts, catalog.ts, lock.ts, verify.ts, publish.ts, uploader-rclone.ts, uploader-dir.ts, seed.ts, cli.ts}`, `tools/assets/test/{catalog.spec.ts, lock.spec.ts, publish.spec.ts}`.
- `tools/ci/check-assets.ts` (extended), `tools/ci/provenance-check.ts` (lock variants), `tools/ci/test/assets-gates.spec.ts`.
- `assets/src/data/asset-smoke/{asset.json, smoke.json}`, `assets/src/texture/asset-smoke/{asset.json, d.png, m.png, l.png}`, `assets/src/world_pack/{p0-64-64,l0-64-64}/asset.json`, `assets/assets.lock.json`, the new provenance records, `config/asset-budgets.json` + `tools/ci/schemas/asset-budgets.v1.json`.
- `apps/web/public/asset-catalog.json`, `services/edge/src/generated/asset-catalog.json`, `services/edge/src/routes/boot.ts` (read pointer), `services/edge/test/boot.test.ts` (extended), `apps/web/test/precache.test.ts` (reads `dist/sw.js` and its injected precache manifest; AC-10; without `apps/web/dist/sw.js` it prints `SKIP precache: apps/web/dist absent` and passes, unless `DV_REQUIRE_DIST=1`, DL-344). CI `build` job: add `DV_REQUIRE_DIST=1 pnpm check:unit -- apps/web` after `pnpm build`.
- `docs/runbooks/r2-media.md`; `.gitignore` adds `dist/assets/`.
- Root scripts: **`assets:catalog`**, **`assets:lock`**, **`assets:verify`**, **`assets:publish`**, **`assets:seed`** (re-writes the smoke PNGs; `--check` compares hashes).
- ≈ 30 files.

## Interfaces
- C07 1.1: `resolveVariant` implemented as declared; `AssetManifest`, `AssetCatalog` and `CatalogPointer` emitted exactly as typed; lock shape per 05 §4.3. No shape change.
- C12 1.1: `BootConfig.assetCatalog` populated. C13 1.1: `VARIANT_FALLBACK` read-only.
- Tool-internal (not contracts): `AssetSpec`, the uploader port `{put(classFiles), verify(keys)}`, the gate finding shape from M00b.

## Acceptance criteria
- AC-1 Given a clean clone after M00b When the standard gates run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build`
- AC-2 Given every subset of the seven `VariantId`s as a manifest's variants When `resolveVariant` runs for each of the six tiers Then it returns `default` when present, else the first `VARIANT_FALLBACK` hit, never a variant outside the tier's chain; an empty chain throws `NO_VARIANT` — proof: `pnpm check:unit -- packages/shared`
- AC-3 Given the seed specs When `assets:catalog` runs twice Then both manifests are byte-identical, every key matches `^assets/[a-z_]+/[a-z0-9][a-z0-9._-]{1,62}/(default|desktop-ultra|desktop|mobile|mobile-low|xr-quest|xr-visionpro)\.[0-9a-f]{12}\.[a-z0-9]+$`, `world_pack` entries have only `default`, and every `sha256` equals the file hash — proof: `pnpm check:unit -- tools/assets`
- AC-4 Given temp-copy fixtures (missing record; spec hash ≠ lock hash; `rev` lower than the lock; a 4 MiB + 1 B `world_pack`; a texture without `mobile-low` and without `default`; a dep cycle; a `killed` entry; differing pointer copies) When the asset gate runs on each Then each is reported with its rule name, and the repository passes — proof: `pnpm check:unit -- tools/ci && pnpm check:assets`
- AC-5 Given a temp copy with one lock variant's record removed When `provenance:check` runs Then it fails naming that hash; the repository passes — proof: `pnpm check:unit -- tools/ci && pnpm build && pnpm provenance:check`
- AC-6 Given a fake process runner When `assets:publish --env staging` runs Then the rclone invocations come in order (one per present content class, then the size check, then the manifest), each carries the immutable `Cache-Control`, its `Content-Type`, `--immutable` and `--ignore-existing` and no `Content-Encoding`. The target is `r2:tha-bay-media-staging`. A size mismatch stops before the manifest upload and the pointer write — proof: `pnpm check:unit -- tools/assets`
- AC-7 Given `--target dir:<tmp> --pointer-out <tmp2>` When `assets:publish` runs twice Then the tree holds every catalog key with matching hashes, `manifests/assets-<sha>.json` matches the pointer's `sha256`, `key` and `bytes`, and the second run copies 0 files — proof: `pnpm check:unit -- tools/assets`
- AC-8 Given no R2 secrets When `assets:publish -- --env staging` runs Then it prints `verify ok`, then a SKIP line naming `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `CLOUDFLARE_ACCOUNT_ID`, and exits 0 — proof: `env -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY -u CLOUDFLARE_ACCOUNT_ID pnpm assets:publish -- --env staging`
- AC-9 Given the committed pointer When `GET /api/v1/boot` runs Then `assetCatalog` equals the pointer's `key` and `Cache-Control` is `no-store` — proof: `pnpm check:workers -- boot`
- AC-10 Given a QA build When the precache manifest is read Then `dist/asset-catalog.json` equals the committed pointer and the service worker precaches it (DL-042) — proof: `pnpm build && pnpm check:unit -- apps/web`
- AC-11 Given the runbook done and the secrets and rclone present When the operator runs `assets:publish -- --env staging` twice Then the first run uploads every blob and the manifest with verification passing, and the second reports `uploaded 0` — proof: manual: operator shell with `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID`; run `pnpm assets:publish -- --env staging` twice; paste both summaries into the PR
- AC-12 Given the branch When the preview deploys Then headers and isolation are unchanged — proof: `pnpm deploy:preview && pnpm check:headers -- --from test-results/preview-url.txt`

## Test plan
- **Unit:** `assets.resolve` (exhaustive subsets × tiers), `catalog` (determinism, keys, `rev`, root-record walk), `lock` (approved fields, changed-only rewrite), `publish` (fake runner argv, failure ordering, `dir:` target), `assets-gates` (each negative fixture). Command: `pnpm check:unit`.
- **Workers:** `boot` (`pnpm check:workers -- boot`). **Build:** `apps/web` precache test.
- **Manual:** AC-11 when the operator has the secrets; otherwise listed as "Blocked on R2 secrets" in the report.

## Demo script
1. `pnpm assets:catalog` prints the build id, entry count and the manifest key.
2. Change one byte of `assets/src/data/asset-smoke/smoke.json`: `pnpm check:assets` fails with "spec hash ≠ lock". Revert.
3. `pnpm assets:publish -- --target dir:/tmp/media --pointer-out /tmp/ptr`, then `ls /tmp/media/assets/texture/asset-smoke/` shows three hashed PNGs.
4. `pnpm dev`, then `curl localhost:<port>/api/v1/boot`: `assetCatalog` shows the manifest key.

## Effort
1 session; ≈ 30 files; risk **medium**. The pieces are well specified. The rclone flag spellings and the operator setup are the uncertain part.

## Risks & fallbacks
- **rclone missing in the Builder's environment.** Every AC except AC-11 uses the fake runner or `dir:`. The installed rclone version is not in the INDEX ledger (research names 1.75.2 [research/gap-ci-cd-release-assets.md §2.1]). Record the version you used in `spec/03` §5.
- **The rclone listing subcommand or a flag differs** (only the env-config pattern and the upload flags are in research). Check `rclone help` at the installed version, adapt `uploader-rclone.ts`, log a Builder decision. AC-6 asserts behaviour, not exact spelling of the listing call.
- **Bucket-creation and CORS command syntax is not in the ledger** (UNVERIFIED). The runbook gives the dashboard path and tells the operator to check `wrangler r2 bucket --help`. No AC depends on it.
- **No custom domain before Q-15.** Public reads of R2 wait for it. M01e serves the `dir:` mirror same-origin in QA builds, so development is unblocked.

## Notes for the Builder
- Read first: `05-assets.md` §4.1–§4.4, `05-assets-pipeline.md` §3, §9, §14, `09-backend-db.md` §4 (bucket table), `09-backend-ops.md` §1.2 (`MEDIA` naming), [research/gap-ci-cd-release-assets.md §2.1–§2.3].
- Order: `resolveVariant` → spec loader → catalog → lock → gates → uploaders → publish → pointer and boot → runbook.
- Never gzip anything bound for R2: Cloudflare decompresses `Content-Encoding: gzip` and breaks Range [research/gap-ci-cd-release-assets.md §2.1; F-019].
- Keep `@dv/shared` pure. Hashing in `tools/assets` uses `node:crypto` for speed, and a unit test proves it equals `sha256Hex`.
- Secrets: `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (an R2 API token scoped to the media buckets), `CLOUDFLARE_ACCOUNT_ID` (endpoint host), `CLOUDFLARE_API_TOKEN` (deploy only). Never print them, and never write an rclone config file. `pnpm check:secrets -- apps/web/dist` stays green. Paid account: R2 on Workers Paid (M00 prerequisite). Storage and operations cost about $0 at this size (F-023).
- Branch `m01d-assets-publish`.

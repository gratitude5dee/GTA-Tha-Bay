# Runbook: R2 media buckets (operator, one time)

Owner: the operator with Cloudflare Admin access. Needed before the first live `assets:publish` (M01d AC-11). Nothing here runs in CI. Until it is done, `pnpm assets:publish -- --env staging` prints `SKIP assets:publish: ... not set` and exits 0, and the `dir:` target (`--target dir:<path>`) gives the same key tree on a local disk.

## 1. Create the buckets
Create two R2 buckets on the Workers Paid account: `tha-bay-media-staging` and `tha-bay-media-prod`. Use the dashboard (R2 Object Storage, Create bucket) or `wrangler r2 bucket create <name>`. The command spelling is not in the research ledger (UNVERIFIED); check `pnpm --filter @dv/edge exec wrangler r2 bucket --help` first. Record the names in `config/cloudflare.resources.json` if they are not already there.

## 2. CORS
Set the bucket CORS policy on both buckets to allow `GET` and `HEAD` from the app origins only (the `workers.dev` hostnames of `tha-bay-web` and `tha-bay-web-staging`, plus `http://localhost:5173` for local QA; add the custom domain once Q-15 is answered). Allowed headers: `Range`. Expose: `Content-Length`, `Content-Range`, `ETag`. The policy format is entered in the dashboard (R2, bucket, Settings, CORS policy); its JSON spelling is UNVERIFIED here, so copy it from the dashboard's example.

## 3. Public access: Worker media route (DL-713)
Keep the `r2.dev` public URL **off**. Public reads go through the app Worker: `tha-bay-web` and `tha-bay-web-staging` answer `GET`, `HEAD` and `OPTIONS` on `/media/<key>` from their `MEDIA` binding (M01d2).

- **Everything in a media bucket is public** from M01d2's deploy, for keys of the published grammar (`isMediaKey`). `PRIVATE` is never readable.
- **OSM-derived objects** (any `sf` bake output) are uploaded only by the M02c2 AC-14 sequence, which uploads the ODbL offer in the same run. Never upload one by hand.
- **Steps 2 (bucket CORS) and 5 (custom domain) are not needed** until a domain exists; the route sets `Access-Control-Allow-Origin: *` itself.
- **Three states (M01d3):** the var `MEDIA_ROUTE` in `services/edge/wrangler.jsonc` is `"on"`, `"throttle"` or `"off"`; any other value serves, as `"on"` does.
  - `"on"` (the default in all three blocks): serves. A satisfiable ranged `GET` costs one bucket read; a rejected or unsatisfiable range costs one more `HEAD` for the size in `Content-Range`.
  - `"throttle"`: each `GET` and `HEAD` first calls the `RL_MEDIA` Rate Limiting binding (1000 requests per 10 s) under a key that is the daily-salted hash of the client's /24 or /48 prefix; a denied call answers 429 with `Retry-After: 10`. `OPTIONS` is never counted. A missing binding or a failing limiter serves the request (fail open).
  - `"off"` (kill switch): every `/media/` request answers 503.
- **Switching:** edit the var in all three blocks (top level, `env.staging`, `previews`) and deploy through `deploy.yml`, or roll back to an earlier version, which restores its value. A switch is a version var, never a KV flag: KV takes 60 s or more to converge.
- **When to use `throttle`:** incidents only, for example one network looping on large objects. Carrier-grade NAT puts many players behind one prefix, so a per-network limit is blunt; the counts are also per Cloudflare location and approximate. Move back to `"on"` as soon as the incident ends. The limit is a design value: about 100 requests a second per network key per location, which one client (at most 26 requests in flight) crosses only when small objects return in under 260 ms for 10 s on end.
- **AC-4 checks** after a deploy (upload one non-OSM test object at an `assets/<kind>/<id>/<variant>.<hex12>.<ext>` key to `tha-bay-media-staging`, run these, then delete it; paste the output into `docs/bake-runs/M01d2/staging.txt`):

```
curl -sI https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>
curl -s -o /dev/null -w '%{http_code}\n' -r 0-9 https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>
curl -sI 'https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/..%2Fx'
```

Expected: 200 with `etag`, the stored `cache-control`, `access-control-allow-origin: *` and `cross-origin-resource-policy: cross-origin`; then `206`; then 404.

- **AC-8 checks of M01d3** (same test object; run `pnpm check:smoke -- https://tha-bay-web-staging.gratitude-8f4.workers.dev` first, delete the object afterwards; paste all output into `docs/bake-runs/M01d3/staging.txt`):

```
curl -s -o /dev/null -w '%{http_code}\n' -r 0-9 https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>
curl -sI -r 0-9 https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>
curl -sI -r 999999999- https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>
```

Expected: `206`; then `content-range: bytes 0-9/<size>` with `<size>` equal to the uploaded object's byte count (this shows on the real bucket that one ranged read gives the total); then `416` with `content-range: bytes */<size>`.

## 4. API token for the publisher
Create an R2 API token (R2, Manage API tokens) with Object Read and Write scoped to the two media buckets only. It gives an Access Key ID and a Secret Access Key. Store them as:

| Name | Where |
|---|---|
| `R2_ACCESS_KEY_ID` | GitHub repository secret and your shell when publishing by hand |
| `R2_SECRET_ACCESS_KEY` | same |
| `CLOUDFLARE_ACCOUNT_ID` | already set for deploys; it forms the S3 endpoint `https://<id>.r2.cloudflarestorage.com` |
| `MEDIA_ORIGIN` (optional) | `https://media.<domain>` once step 5 is done; enables the HEAD checks (Content-Length, Content-Type, no Content-Encoding) |

Never commit these values and never write an rclone config file: `assets:publish` configures the `r2` remote from the environment only.

## 5. After Q-15 settles (custom domain)
1. Attach the custom domain `media.<domain>` to each bucket (R2, bucket, Settings, Custom Domains).
2. Add one Cache Rule on hostname `media.<domain>`: Eligible for cache, Edge TTL "respect origin". `.glb`, `.ktx2`, `.json` and `.pack` are not cached by default, and the objects already carry `Cache-Control: public, max-age=31536000, immutable`.
3. Enable Smart Tiered Cache for the zone.
4. Set `MEDIA_ORIGIN` and re-run the publish so the HEAD checks run [research/gap-ci-cd-release-assets.md section 2.3].

## 6. Publish and verify
Install rclone (research names 1.75.2; record the version you use in `spec/03` section 5). Then, from the repository root:

```
pnpm assets:verify
pnpm assets:publish -- --env staging --dry-run
pnpm assets:publish -- --env staging
pnpm assets:publish -- --env staging
```

The first live run uploads every blob and the manifest and reports `uploaded N of N objects`; the second reports `uploaded 0`. Paste both summaries into the milestone PR. The publish step writes the pointer (`apps/web/public/asset-catalog.json` and `services/edge/src/generated/asset-catalog.json`); commit both, and deploy the Worker so `GET /api/v1/boot` returns the new manifest key in `assetCatalog`.

Never upload gzip-encoded objects: Cloudflare decompresses `Content-Encoding: gzip` objects and breaks Range requests, so the publisher never sets that header.

## 7. World release (M02c2; DL-661, DL-662, DL-688, DL-695)

The sf world (map packs, graph, chunks, landmarks) reaches a deployed Worker only through a world pointer. Nothing is public until the ODbL offer exists.

1. Bake: `pnpm map:build -- --area sf` (operator workstation, `.cache/map/raw/sf` from `pnpm map:fetch`), then `pnpm map:pack -- --bake <bakeId> --target dir:<dir>` for a local mirror, or the R2 target of section 6.
2. Offer first: `config/world/sources.json` carries `offerUrl` on the `osm` row (outside the `bakeId` hash). `pnpm assets:publish -- --env <staging|production> --world sf --bake <bakeId>` uploads `odbl/<bakeId>/{bake-scripts.tar.gz, sf.lock.json, index.json}` in the same run as the packs and prints the offer URL. A bake id's first offer is never replaced: a later run for the same bake id reads `odbl/<bakeId>/index.json` and accepts it (nothing uploaded) when it names the same packs or world lock with every listed object present, and fails on another bake, other packs or a partial offer (BD-FIX-ODBL-01). Copy that URL into `offerUrl` of the `osm` row, run `pnpm map:build` again (the pack step copies it into `config/attribution.world.json`), and commit.
3. Pointer: the publish writes `assets/world/pointer.<env>.json` and `pointer.<env>.meta.json` (SHA-256 of both locks and of the world index). Commit both. `<env>` is the release key: `staging` or `production`; an absent `--env` means production.
4. Release: set `config/world/release.json` `staging` (then `production`) to `"sf"` in a PR. `pnpm deploy:prod [-- --env staging]` fails with `world release <env>: pointer built from lock <a>, current lock <b>` when a lock changed after the pointer was published; re-run step 3. `pnpm check:assets` warns when a release names a world without a pointer.
5. Credits: the build writes `dist/credits.json` (`pnpm build` ends with `provenance-check --emit-credits --emit-only`); it carries every `config/attribution.world.json` entry and the ODbL notice. `deploy:prod` runs `tools/ci/odbl-offer.ts` (`odblOffer`) on the attribution file and the built `credits.json` and fails when the offer URL is missing from either.
6. Before each pull request into `main` (staging deploys from `main`; BD-FIX-REL-02): the Architect re-runs step 3 (`assets:publish --world`, R2 keys) and commits the new pointer and meta, or the PR's `static` check `check:assets -- --release-strict` and `deploy:prod -- --env staging` fail on the stale pointer; `claude/build` only warns.

Secrets: `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for the upload; without them the publish prints `SKIP ... R2_ACCESS_KEY_ID not set` and writes nothing.

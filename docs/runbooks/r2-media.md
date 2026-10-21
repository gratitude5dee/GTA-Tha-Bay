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
- **Kill switch:** set the var `MEDIA_ROUTE` to `"off"` in `services/edge/wrangler.jsonc` (all three blocks) and deploy; every `/media/` request then answers 503. Rolling back to an earlier version restores its value.
- **AC-4 checks** after a deploy (upload one non-OSM test object at an `assets/<kind>/<id>/<variant>.<hex12>.<ext>` key to `tha-bay-media-staging`, run these, then delete it; paste the output into `docs/bake-runs/M01d2/staging.txt`):

```
curl -sI https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>
curl -s -o /dev/null -w '%{http_code}\n' -r 0-9 https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>
curl -sI 'https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/..%2Fx'
```

Expected: 200 with `etag`, the stored `cache-control`, `access-control-allow-origin: *` and `cross-origin-resource-policy: cross-origin`; then `206`; then 404.

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

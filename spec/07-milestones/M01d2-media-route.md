# M01d2 — media-route

## Goal
After this session the app Worker serves published R2 media itself. `tha-bay-web` (production, `env.staging` and its previews) answers `GET` and `HEAD /media/<key>` from its existing `MEDIA` binding, with Range and conditional requests, a strict key grammar, CORS for the app's own hosts and the isolation headers. `HOST_MEDIA` points at that route. Deployed builds can then load published world packs, catalog manifests and cutscene manifests without a custom domain (DL-713, the owner's choice of 2026-10-20). Q-15 stays open for the production hostnames, and a later `media.<domain>` replaces these values. Nothing is uploaded and nothing is released here: the `sf` world release stays in M02c2 (DL-670).

## Requirements
- R-PLAT-01 (support): content-hashed immutable objects are served with their stored `Cache-Control`, so a deploy or rollback switches content through the pointer alone.
- R-IP-01 (support): only the `MEDIA` bucket, and only keys of the published grammar, are readable; `PRIVATE` never is.

## Depends on
- **M01d** (assets-publish): the object-key grammar `<root>/<variant>.<sha256[0:12]>.<ext>`, the catalog manifest keys, and the stored HTTP metadata (`Cache-Control: public, max-age=31536000, immutable`, identity encoding); the `MEDIA` binding and bucket names in `services/edge/wrangler.jsonc` and `config/cloudflare.resources.json`.
- **M00e** (owner-account-hardening): `_PLAN.md` §0 rule 7, no `services/edge` milestone before it.
- Through those: M00a (router, `withIsolationHeaders`, `/api/v1/boot`, `check:workers`), M05b1 (`CutsceneJobDO` builds manifest URLs from `HOST_MEDIA`).
- Contracts: C12 1.3 (`BootConfig.hosts.media` is still an absolute URL), C07 1.1 (object keys). No contract change.

## Scope in
- **Route** `services/edge/src/routes/media.ts`, registered in the edge router for `GET` and `HEAD` on `/media/*`, exactly as DL-713 specifies:
  - `GET`: `env.MEDIA.get(key, { onlyIf: request.headers, range: request.headers })`. `null` answers 404. An object without `body` answers 304 when the request carried `If-None-Match`, and 412 for any other failed precondition. A ranged read answers 206 with `Content-Range: bytes <start>-<end>/<size>` and `Content-Length`, an unranged one 200.
  - `HEAD`: `env.MEDIA.head(key)`, the same headers and no body.
  - Headers on every hit: `writeHttpMetadata(headers)`, `etag` = `httpEtag`, `Accept-Ranges: bytes`, and `Cross-Origin-Resource-Policy: cross-origin`; then `withIsolationHeaders`. A missing stored `Content-Type` falls back to the type of the key's extension.
  - Methods other than `GET` and `HEAD` answer 405 with `Allow: GET, HEAD`.
- **Key grammar.** Allowed: the C07 object keys, the catalog manifest keys written by M01d, and `odbl/<bakeId>/<file>` (DL-695). Anything else answers 404 *before* any bucket call: an empty key, `..`, `//`, a backslash, percent-encoded `/` or `.`, a key not matching the grammar, or a trailing `/` (no listings). Use the pure key predicate from `@dv/shared` if M01d placed one there; otherwise add `isMediaKey(key: string): boolean` to `packages/shared/src/assets/` with unit cases (no IO, C02 lint applies). `services/edge` imports only `@dv/shared`.
- **CORS.** The allowed origins are derived from the env's `HOST_MEDIA` origin `https://<host>`: exactly that origin, and `https://<label>-<host>` for its preview hosts (version previews used by the `deploy:prod` 0 % smoke, and `pr-<n>-…` aliases). For an allowed `Origin`: echo it in `Access-Control-Allow-Origin`, add `Vary: Origin` and `Access-Control-Expose-Headers: Content-Length, Content-Range, ETag`. For any other origin, send no CORS headers. An `OPTIONS` preflight from an allowed origin with `Access-Control-Request-Method: GET` or `HEAD` answers 204 with `Access-Control-Allow-Methods: GET, HEAD` and `Access-Control-Allow-Headers: Range, If-None-Match`; any other `OPTIONS` answers 405.
- **Host values** in `services/edge/wrangler.jsonc`:
  - top level: `"HOST_MEDIA": "https://tha-bay-web.gratitude-8f4.workers.dev/media"`;
  - `env.staging` and its `previews` block: `"HOST_MEDIA": "https://tha-bay-web-staging.gratitude-8f4.workers.dev/media"`.

  These are the hosts `.github/workflows/deploy.yml` already smoke-tests (`SMOKE_URL`).
- **Runbook:** a "Worker media route (DL-713)" section in `docs/runbooks/r2-media.md`. It says that, until a custom domain exists, steps 2 (bucket CORS) and 5 (custom domain) are not needed and step 3 is unchanged (`r2.dev` off). It also gives the three `curl` checks of AC-4.

## Scope out
- Edge caching in the Worker (Workers Caching or the Cache API; spec/03 §6, DL-713) and the custom domain (Q-15).
- Any upload, publish or pointer change; the `sf` world release and `release.json` (M02c2).
- Serving `PRIVATE`, signed URLs, UGC hosts (M13).

## Deliverables
- `services/edge/src/routes/media.ts`; the router registration (one line in the existing router file); `services/edge/wrangler.jsonc` (three `HOST_MEDIA` values).
- `services/edge/test/media.test.ts` (Workers runtime, local `MEDIA` bucket from the vitest pool).
- `packages/shared/src/assets/media-key.ts` and `packages/shared/test/media-key.spec.ts`, only if `@dv/shared` has no key predicate yet.
- `docs/runbooks/r2-media.md` (new section); BD rows in `spec/11-decision-log-builder.md`.
- About 7 files.

## Interfaces
- C12 1.3 `BootConfig.hosts.media`: unchanged type; its value is now the route's base URL.
- C07 1.1 object keys: read only.
- `Env.MEDIA: R2Bucket` (existing binding), `Env.HOST_MEDIA: string` (existing).

## Acceptance criteria
- AC-1 Given the merged base When the repository checks run Then they pass — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given a Workers test with a local `MEDIA` bucket holding one object at a valid key with `Content-Type` and `Cache-Control` metadata When the media route is called Then:
  - `GET` answers 200 with the object bytes, `etag`, the stored `Cache-Control`, `Accept-Ranges: bytes` and the isolation headers;
  - `Range: bytes=0-9` answers 206 with `Content-Range: bytes 0-9/<size>` and 10 bytes;
  - `HEAD` answers the same headers with no body;
  - a matching `If-None-Match` answers 304, and a missing key 404;
  - `..`, an empty key, a percent-encoded separator and a key outside the grammar answer 404 without a bucket call (a spy on the binding proves no call);
  - `POST` answers 405 with `Allow: GET, HEAD`;
  - an `Origin` equal to the env's host, or to a preview host of it, gets `Access-Control-Allow-Origin` echoed with `Vary: Origin`, and any other origin gets no CORS header;
  - an allowed preflight answers 204;
  - `GET /api/v1/boot` returns `hosts.media` equal to the configured `HOST_MEDIA`

  — proof: `pnpm check:workers -- media boot`
- AC-3 Given the edited `wrangler.jsonc` When the release checks run Then the Worker dry-run bundle passes, `check:do-migrations` reports no Durable Object lifecycle change, and the existing headers and boot suites pass — proof: `pnpm check:prod-routes && pnpm check:do-migrations && pnpm check:workers -- headers boot`
- AC-4 Given this milestone merged to `main` and `deploy.yml` deployed staging, and an object present in `tha-bay-media-staging` (for example a key from `assets/world/sf.lock.json` written by the M02a1 AC-9 operator run) When the operator runs the runbook's three checks Then:
  - `curl -sI <staging-url>/media/<key>` answers 200 with `etag` and `cache-control: public, max-age=31536000, immutable`;
  - `curl -s -o /dev/null -w '%{http_code}' -r 0-9 <staging-url>/media/<key>` prints 206;
  - `curl -sI <staging-url>/media/..%2Fx` answers 404

  — proof: manual, after deploy: the three commands, with output pasted into `docs/bake-runs/M01d2/staging.txt`. The Builder lists AC-4 under "Blocked on: deploy" when no deploy has happened.

## Test plan
- **Workers:** `services/edge/test/media.test.ts` (`pnpm check:workers -- media`), plus the existing `boot` and `headers` suites.
- **Unit:** `packages/shared/test/media-key.spec.ts` if the predicate is added (`pnpm check:unit -- packages/shared`).
- **Release:** `check:prod-routes`, `check:do-migrations`.
- **Manual:** AC-4 on staging after deploy.

## Demo script
1. `pnpm check:workers -- media`: every case passes.
2. After deploy: `curl -sI https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>` shows 200 with the immutable `cache-control`.

## Effort
0.3 Builder session; about 7 files; risk **low**.

## Risks & fallbacks
- **The local R2 in the vitest pool handles `range` or `onlyIf` headers differently from production.** Parse `Range` and `If-None-Match` in the route (single range `bytes=a-b`, `bytes=a-` and `bytes=-n` only; anything else answers 416 for `Range`, or 200 for an unknown precondition), pass the parsed `{ offset, length }` or `{ suffix }` and `{ etagDoesNotMatch }` objects, and record a BD row.
- **A stored object without `Content-Type`.** Use the extension map (`.json` `application/json`, `.bin`/`.pack` `application/octet-stream`, `.glb` `model/gltf-binary`, `.ktx2` `image/ktx2`, `.tar.gz` `application/gzip`) and never set `Content-Encoding`.

## Notes for the Builder
- Read first: DL-713 (`spec/11-decision-log-8.md`); the "R2 media through a Worker" paragraph in `spec/03-decisions-and-facts.md` §6 (the binding facts and their URLs); `M01d-assets-publish.md` (key grammar, metadata); `services/edge/src/headers.ts`, `services/edge/src/routes/boot.ts` and the router; `docs/runbooks/r2-media.md`.
- Every Worker response goes through `withIsolationHeaders` (COOP/COEP gotcha). Do not enable Workers Caching (`cache.enabled`) or call `caches.default`; DL-713 leaves edge caching to the custom-domain step.
- QA builds keep preferring the same-origin `/media-local` mirror over `hosts.media` (`packages/engine/src/assets/store/catalog-client.ts`, M01e), so PR previews keep serving their synth packs; production builds, staging deploys included, read `hosts.media`, which is now this route.
- Never read the `PRIVATE` binding in this route. Never turn on `r2.dev`.
- Secrets: none for the tests (the vitest pool's bucket is local). Deploys run from `deploy.yml` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (GitHub secrets; not in a Builder container), so AC-4 is the operator's post-deploy check.
- `wrangler.jsonc` changes vars only (no binding or Durable Object class change), so this ships through the normal `deploy.yml` path; `check:do-migrations` proves it.

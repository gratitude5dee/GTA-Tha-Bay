# M01d2 — media-route

## Goal
After this session the app Worker serves published R2 media itself. `tha-bay-web` (production, `env.staging` and its previews) answers `GET`, `HEAD` and CORS preflights on `/media/<key>` from its existing `MEDIA` binding: Range and conditional requests, an explicit key grammar, public CORS, and the isolation headers with a cross-origin resource policy. `HOST_MEDIA` points at that route. Deployed builds can then load published catalogs, assets and cutscene manifests without a custom domain (DL-713, the owner's choice of 2026-10-20). Q-15 stays open for production hostnames, and a later `media.<domain>` replaces these values. Nothing is uploaded and nothing is released here. OSM-derived objects reach a media bucket only inside the M02c2 AC-14 release (DL-713, DL-670, DL-695).

## Requirements
- R-PLAT-01 (support): content-hashed immutable objects are served with their stored `Cache-Control`, so a deploy or rollback switches content through the pointer alone.
- R-IP-01 (support): only the `MEDIA` bucket, and only keys of the published grammar, are readable. `PRIVATE` never is, and OSM-derived objects enter `MEDIA` only with their ODbL offer.

## Depends on
- **M01d** (assets-publish): the key builders (`objectKey` in `packages/shared/src/assets/c07.ts`, the `manifests/assets-<hex64>.json` manifest keys), the stored HTTP metadata (`Cache-Control: public, max-age=31536000, immutable`, identity encoding), `contentTypeOf` (`packages/shared/src/assets/content-type.ts`), and the `MEDIA` binding and bucket names.
- **M00e** (owner-account-hardening): `_PLAN.md` §0 rule 7, no `services/edge` milestone before it.
- Through those: M00a (`route()`, `ROUTES` and `createApp` in `services/edge/src/index.ts`, `withIsolationHeaders` in `headers.ts`, the geo gate in `geo.ts`, `/api/v1/boot`, `check:workers`) and M00e (`config/csp-hosts.ts`, `tools/ci/test/csp-hosts.test.ts`).
- Already merged on `claude/build`, though not a dependency: M05b1 (`CutsceneJobDO` builds manifest URLs from `HOST_MEDIA`; `services/pipeline` writes `cutscenes/<hex64>/…`). The route serves those keys; nothing in M05b1 changes.
- Contracts: C12 1.3 (`BootConfig.hosts.media` is still an absolute URL), C07 1.1 (object keys). No contract change.

## Scope in
- **Dispatch** (`services/edge/src/index.ts`). In `route()`, add a `/media/` branch before the `/api/v1/` guard sends the request to `ASSETS.fetch`, and before the geo gate. Media is geo-exempt, because offline single-player is never geo-blocked (R-ROLL-01, A-10). The branch calls the media handler, which also does its own method handling; the `ROUTES` method filter is not used for it, so `OPTIONS` reaches the handler. In `services/edge/wrangler.jsonc`, add `"/media/*"` to `assets.run_worker_first` at the top level and in `env.staging`. Previews take their assets block from `env.staging`. The array form disables the navigation-prefers-assets default, so a browser navigation to `/media/<key>` reaches the Worker and does not get the SPA `index.html` (spec/03 §6, DL-713).
- **Handler** (`services/edge/src/routes/media.ts`):
  - **`GET`.** When the request carries `Range`, call `env.MEDIA.head(key)` first (404 if `null`) to learn the size. Accept only a single `bytes=a-b`, `bytes=a-` or `bytes=-n`. Multiple ranges, or a range that is malformed or unsatisfiable against that size, answer 416 with `Content-Range: bytes */<size>`. Then call `env.MEDIA.get(key, { onlyIf: request.headers, range })` with the parsed `{ offset, length }` or `{ suffix }`. Without `Range`, call `get` directly.
    - `null` answers 404.
    - An object without `body` answers 304 when the request carried `If-None-Match` or `If-Modified-Since`, otherwise 412.
    - A request that carried `Range` answers 206 with `Content-Range: bytes <start>-<end>/<size>` and `Content-Length`. A suffix range computes `start = size − n`.
    - The handler catches its own errors: an exception from the binding answers 500 with the same CORS and isolation headers, never escaping to `createApp`'s generic error response.
  - **`HEAD`.** `env.MEDIA.get(key, { onlyIf: request.headers })` with the body discarded, so conditional `HEAD` answers 304 the way `GET` does, with no body.
  - **`OPTIONS`.** With `Access-Control-Request-Method: GET` or `HEAD` it answers 204 with `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, `Access-Control-Allow-Headers: Range, If-None-Match, If-Modified-Since` and `Access-Control-Max-Age: 86400`. Any other method answers 405 with `Allow: GET, HEAD, OPTIONS`.
  - **Headers on every `/media/` response, errors included:**
    - `Access-Control-Allow-Origin: *`. The data is public game data and no credentials are used, so there is no allowlist and no `Vary: Origin`.
    - `Access-Control-Expose-Headers: Content-Length, Content-Range, ETag, Accept-Ranges`.
    - `Accept-Ranges: bytes`.
    - On hits, `writeHttpMetadata(headers)` and `etag` = `httpEtag`. When no `Content-Type` was stored, use `contentTypeOf(<extension of the key>)` (it takes an extension, not a key, and throws on an unknown one) inside try/catch, falling back to `application/octet-stream`. Never set `Content-Encoding`.
    - `Cache-Control: no-store` on 404, 412 and 416.
  - **Kill switch.** The var `MEDIA_ROUTE` (`"on"` | `"off"`, default `"on"`) answers 503 to every `/media/` request when `"off"`. It rides with a deployed version, so a rollback or a version with `"off"` stops the route (DL-713).
- **Key grammar.** A pure predicate `isMediaKey(key)` in `packages/shared/src/assets/media-key.ts`, with no IO and the C02 lint applying. Export it, and `contentTypeOf`, from `packages/shared/src/index.ts` (the entry `services/edge` already imports); do not touch the contract file `assets/c07.ts`. It accepts exactly:
  - `assets/<kind>/<id>/<variant>.<hex12>.<ext>`
  - `characters/<slug>/<part>/<variant>.<hex12>.<ext>`
  - `audio/barks/<hex64>.<ext>`
  - `cutscenes/<hex64>/<file>`
  - `manifests/assets-<hex64>.json`
  - `odbl/<hex64>/<file>`

  Each segment is `[a-z0-9][a-z0-9._-]{0,127}` (the `<kind>` and `<id>` alphabets as `objectKey` emits them); `<file>` is the same pattern; `<hex12>` and `<hex64>` are lowercase hex. It rejects any segment equal to `.` or `..`, any `%`, `\`, empty segment or trailing `/`. The route takes the raw path after `/media/` without decoding it. A rejected key answers 404 before any bucket call. Only `MEDIA` is read, never `PRIVATE`.
- **Isolation headers** (`services/edge/src/headers.ts`): derive the CSP media origin with a guard (a missing or malformed `HOST_MEDIA` falls back to the raw value and never throws, because `withIsolationHeaders` runs outside `createApp`'s try). `withIsolationHeaders` keeps COOP and COEP everywhere, but sets `Cross-Origin-Resource-Policy: cross-origin` for paths under `/media/`; every other path keeps `same-origin`. This lets no-cors loads (`<video>` and `<img>` of cutscene media) from version-preview and PR-preview hosts load under COEP `require-corp`.
- **Hosts and CSP:**
  - `services/edge/wrangler.jsonc`: `"HOST_MEDIA": "https://tha-bay-web.gratitude-8f4.workers.dev/media"` at the top level, and `"https://tha-bay-web-staging.gratitude-8f4.workers.dev/media"` in `env.staging` and its `previews` block (the hosts `deploy.yml` smoke-tests). Add `"MEDIA_ROUTE": "on"` in the same three places.
  - The CSP media source is the **origin** of `HOST_MEDIA`: `withIsolationHeaders` passes `new URL(HOST_MEDIA).origin` to `buildCspReportOnly`, and `config/csp-hosts.ts` `STAGING_CSP_HOSTS.media` / `PROD_CSP_HOSTS.media` hold those origins.
  - `tools/ci/test/csp-hosts.test.ts` compares `media` by origin. A CSP host-source with a path and no trailing slash matches only that exact path.
- **Service worker:** add `/^\/media\//` to the denylist of the `NavigationRoute` in `apps/web/src/sw.ts`, so an installed service worker never answers a navigation to `/media/<key>` with the app shell.
- **Stale text:** `config/cloudflare.resources.json` `host_vars_note` and the `tools/ci/deploy.ts` bootstrap message stop calling `HOST_MEDIA` a placeholder.
- **Runbook:** in `docs/runbooks/r2-media.md`, replace step 3's "Public reads wait for the custom domain" with a "Worker media route (DL-713)" section. The section covers:
  - every object in a media bucket is public from M01d2's deploy;
  - OSM-derived objects are uploaded only by the M02c2 AC-14 sequence;
  - steps 2 (bucket CORS) and 5 (custom domain) are not needed until a domain exists;
  - the `MEDIA_ROUTE` kill switch;
  - the AC-4 checks.

## Scope out
- Edge caching in the Worker (Workers Caching or the Cache API) and the custom domain (Q-15); a rate limit or WAF rule (needs a zone; DL-713).
- Any upload, publish or pointer change; the `sf` world release and `release.json` (M02c2).
- Serving `PRIVATE`, signed URLs, UGC hosts (M13).

## Deliverables
- `services/edge/src/routes/media.ts`; `services/edge/src/index.ts` (the `/media/` branch in `route()`); `services/edge/src/headers.ts` (media CORP, CSP media origin); `services/edge/src/env.ts` (`MEDIA_ROUTE`); `services/edge/wrangler.jsonc` (`run_worker_first`, `HOST_MEDIA`, `MEDIA_ROUTE`).
- `packages/shared/src/assets/media-key.ts`, `packages/shared/src/index.ts` (exports `isMediaKey`, `contentTypeOf`), `packages/shared/test/media-key.spec.ts`; `apps/web/src/sw.ts` (navigation denylist).
- `services/edge/test/media.test.ts`; `services/edge/test/headers.test.ts` (extended).
- `config/csp-hosts.ts`, `tools/ci/test/csp-hosts.test.ts`, `config/cloudflare.resources.json` (note), `tools/ci/deploy.ts` (message).
- `docs/runbooks/r2-media.md`; BD rows in `spec/11-decision-log-builder.md`.
- About 17 files.

## Interfaces
- C12 1.3 `BootConfig.hosts.media`: unchanged type; its value is now the route's base URL.
- C07 1.1 object keys: read only.
- `Env.MEDIA: R2Bucket` and `Env.HOST_MEDIA: string` (existing); `Env.MEDIA_ROUTE: 'on' | 'off'` (new var).

## Acceptance criteria
- AC-1 Given the merged base When the repository checks run Then they pass, including `tools/ci/test/csp-hosts.test.ts` with the new hosts — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `isMediaKey` When its unit cases run Then:
  - it accepts one key of each of the six shapes, including `cutscenes/<hex64>/subs.en.vtt` and `odbl/<hex64>/bake-scripts.tar.gz`;
  - it rejects `..`, `.`, an empty segment, `%2F`, `%2e`, a backslash, a trailing `/`, an uppercase hex hash, an unknown root, and a key with too few or too many segments

  — proof: `pnpm check:unit -- packages/shared/test/media-key.spec.ts`
- AC-3 Given a Workers test with a local `MEDIA` bucket holding one object at a valid `assets/…` key with `Content-Type` and `Cache-Control` metadata, and one with neither When the media route is called Then:
  - **`GET`** answers 200 with the object bytes, `etag`, the stored `Cache-Control`, `Accept-Ranges: bytes`, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`, and the COOP and COEP headers. The object without a stored type answers with the type from its extension;
  - **ranges:** `Range: bytes=0-9` answers 206 with `Content-Range: bytes 0-9/<size>` and 10 bytes; `bytes=-5` answers 206 with the last 5 bytes; `bytes=0-1,4-5` and a start past the end answer 416 with `Content-Range: bytes */<size>`;
  - **conditionals:** a matching `If-None-Match` answers 304 on `GET` and on `HEAD`;
  - **`HEAD`** answers with no body;
  - **misses and rejections:** a missing key answers 404 with `Cache-Control: no-store` and the CORS header; `/media/..%2Fx` and an uppercase-hash key answer 404 without a bucket call (a spy proves it);
  - **methods:** `POST` answers 405 with `Allow: GET, HEAD, OPTIONS`, and an `OPTIONS` preflight for `GET` answers 204;
  - **request context:** a request with `Sec-Fetch-Mode: navigate` gets the object, and a request with `cf.country: 'FR'` gets 200;
  - **kill switch:** with `MEDIA_ROUTE: "off"`, `GET` answers 503;
  - **other paths:** `/api/v1/health` still carries `Cross-Origin-Resource-Policy: same-origin`, and `GET /api/v1/boot` returns `hosts.media` equal to the configured `HOST_MEDIA`

  — proof: `pnpm check:workers -- media headers boot`
- AC-4 Given the edited `wrangler.jsonc` When the release checks run Then:
  - the Worker dry-run bundle passes;
  - `check:do-migrations` reports no Durable Object lifecycle change;
  - `assets.run_worker_first` lists `/media/*` at the top level and in `env.staging` (a case in `tools/ci/test/` reading the JSONC)

  — proof: `pnpm check:prod-routes && (pnpm check:do-migrations || pnpm check:do-migrations -- --base origin/claude/build) && pnpm check:unit -- tools/ci`
- AC-5 Given this milestone merged to `main` and `deploy.yml` deployed staging When the operator uploads one non-OSM test object to `tha-bay-media-staging` at a key of the `assets/` shape, runs the runbook's checks, and deletes the object Then:
  - `curl -sI <staging-url>/media/<key>` answers 200 with `etag`, the stored `cache-control`, `access-control-allow-origin: *` and `cross-origin-resource-policy: cross-origin`;
  - `curl -s -o /dev/null -w '%{http_code}' -r 0-9 <staging-url>/media/<key>` prints 206;
  - `curl -sI <staging-url>/media/..%2Fx` answers 404

  — proof: manual: after deploy, the three commands with their output pasted into `docs/bake-runs/M01d2/staging.txt`; without a deploy or the media R2 secrets on the operator workstation, the Builder lists AC-5 under "Blocked on". No OSM-derived object is uploaded for this check (DL-713).

## Test plan
- **Unit:** `packages/shared/test/media-key.spec.ts`; `tools/ci/test/csp-hosts.test.ts` and the `run_worker_first` case (`pnpm check:unit -- packages/shared tools/ci`).
- **Workers:** `media.test.ts`, extended `headers.test.ts`, `boot` (`pnpm check:workers -- media headers boot`).
- **Release:** `check:prod-routes`, `check:do-migrations`.
- **Manual:** AC-5 on staging after deploy.

## Demo script
1. `pnpm check:workers -- media`: every case passes.
2. After deploy: upload a test object, `curl -sI https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>` shows 200 with the immutable `cache-control`, then delete the object.

## Effort
0.4 Builder session; about 17 files; risk **low**.

## Risks & fallbacks
- **The vitest pool's local R2 treats `range` or `onlyIf` differently from production.** The route parses `Range` itself and passes `{ offset, length }` or `{ suffix }`. If `onlyIf` with request headers misbehaves locally, pass `{ etagDoesNotMatch }` parsed from `If-None-Match`, and record a BD row.
- **`run_worker_first` patterns need wrangler 4.20.0 or later** (spec/03 §6). The repository pins a later wrangler; if `check:prod-routes` rejects the array, stop and report.

## Notes for the Builder
- Read first:
  - DL-713 (`spec/11-decision-log-8.md`);
  - the "R2 media through a Worker" paragraph in `spec/03-decisions-and-facts.md` §6 (binding, routing, pricing and cache facts with URLs);
  - `M01d-assets-publish.md`;
  - in `services/edge/src`: `index.ts` (`route()`, `ROUTES`, `createApp`), `headers.ts`, `geo.ts`, `env.ts`, `routes/boot.ts`;
  - `packages/shared/src/assets/{c07.ts, content-type.ts}`, `packages/shared/src/index.ts`, `apps/web/src/sw.ts`;
  - `config/csp-hosts.ts`, `tools/ci/test/csp-hosts.test.ts`;
  - `docs/runbooks/r2-media.md`.
- The WHATWG URL parser collapses `/media/../x` and `%2e%2e` segments before the Worker sees them, so the traversal case must be tested in `isMediaKey` and, through the route, with `..%2Fx`. The binding is bucket-scoped, so traversal cannot reach `PRIVATE` anyway; the grammar is defence in depth.
- QA builds keep preferring the same-origin `/media-local` mirror over `hosts.media` (`packages/engine/src/assets/store/catalog-client.ts`, M01e), so PR previews keep serving their synth packs. Production builds, staging deploys included, read `hosts.media`, which is now this route.
- Do not enable Workers Caching (`cache.enabled`) or call `caches.default`; DL-713 defers edge caching by choice. Never turn on `r2.dev`.
- Secrets: none for the tests (the vitest pool's bucket is local). Deploys run from `deploy.yml` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (GitHub secrets, not in a Builder container), so AC-5 is the operator's post-deploy check.
- `wrangler.jsonc` changes vars and the assets routing only, with no binding or Durable Object class change, so this ships through the normal `deploy.yml` path; `check:do-migrations` proves it.

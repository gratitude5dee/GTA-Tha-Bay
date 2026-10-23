# M01d3 — media-route-tuning

## Goal
After this session a satisfiable ranged `GET` on `/media/<key>` costs one bucket call instead of two, and the operator has an abuse lever between "serve everything" and "serve nothing". Today `services/edge/src/routes/media.ts` calls `env.MEDIA.head(key)` for the size, then `env.MEDIA.get(key, { onlyIf, range })`: two Class B reads (spec/03 §6, row M01d3). The client slices every object over 4 MiB into 1 MiB ranges (`RANGE_THRESHOLD_BYTES`, `RANGE_SLICE_BYTES` in `packages/engine/src/assets/store/fetch-retry.ts`), so a 20 MiB cutscene costs 40 reads today and 20 after this session. The route parses `Range` without a size, makes one `get`, and builds `Content-Range` from the returned object's `size`; `head` runs only on error paths. `MEDIA_ROUTE` gains `throttle`, which applies a new `RL_MEDIA` Rate Limiting binding keyed by the daily-salted network hash and answers 429. Range parsing moves into a pure module with table tests, multi-range rejection included. World packs (at most 1.3 MB, never sliced) are unaffected. Study proposal GV-08, in our own code.

## Requirements
- R-PLAT-01 (support): the Cloudflare-hosted media route reads less from R2 per ranged request, keeps every M01d2 response rule, and gets an incident throttle that a version deploy or rollback switches.
- R-ROLL-01 (support): hosted single-player keeps its media path without a custom domain, with the abuse lever that RISK-30 lacks.

## Depends on
- **M01d2** (media-route, merged at `e72e1fc`): `handleMedia`, `parseRange`, `baseHeaders`, `plain`, `objectHeaders` (`services/edge/src/routes/media.ts`), the `/media/` branch of `route()` (`services/edge/src/index.ts`), `MEDIA_ROUTE`, and `services/edge/test/media.test.ts` with its fixture.
- **M00e** (owner-account-hardening, merged; `_PLAN.md` §0 rule 7 is met): `netHashOf` and `dailySalt` (`services/edge/src/id/nethash.ts`), the fail-open `allowed` (`services/edge/src/ratelimit.ts`), the `RL_AUTH`/`RL_AUTH_USER`/`RL_TALK` blocks of `services/edge/wrangler.jsonc`, and the `env: { RL_AUTH }` stubs of `services/edge/test/auth.test.ts`.
- **Architect, before the session (done):** the spec/03 §6 row M01d3 (recorded 2026-10-23), the DL-713 amendment (DL-724), and the RISK-30 and `spec/10-cost-model.md` wording (see Notes).
- Contracts: C12 1.3 (`BootConfig.hosts.media` unchanged), C07 1.1 (object keys, read only). No contract change.

## Scope in
- **Range module** (new `services/edge/src/routes/media-range.ts`; `parseRange` leaves `media.ts`):
  - `parseRangeHeader(value: string): RangeSpec | null`, with no size. It accepts exactly one `bytes=a-b`, `bytes=a-` or `bytes=-n`. The unit is matched case-insensitively and surrounding whitespace is trimmed.
  - It returns `null` for: a comma (any multi-range); another unit; `bytes=`; `bytes=-`; `bytes=-0`; `b < a`; any non-digit; a number that is not a safe integer.
  - `RangeSpec` is `{ offset: number; length?: number } | { suffix: number }`, the `R2Range` shapes the binding takes.
  - `servedRange(spec: RangeSpec, size: number): { start: number; end: number; length: number } | null`. It clamps `end` to `size − 1` and a suffix to the whole object. It returns `null` when `start ≥ size`, or when `size` is 0. These are the BD-M01d2-01 semantics, now separated from the size lookup.
- **Ranged `GET`** (`handleMedia`):
  1. If `parseRangeHeader` returns `null`, call `head(key)` (an error path): `null` answers 404; otherwise answer 416 with `Content-Range: bytes */<size>`.
  2. Otherwise make **one** call, `get(key, { onlyIf: request.headers, range: spec })`.
     - `null` answers 404. An object without `body` answers 304 or 412, as today.
     - Compute `servedRange(spec, obj.size)`. `null` answers 416 with `bytes */<obj.size>`, with no `head`; drop the body unread (BD-M01d2-01: cancelling logs a workerd error). Otherwise answer 206 with `Content-Range: bytes <start>-<end>/<obj.size>` and `Content-Length: <length>`.
  3. If `get` throws an error whose `message` ends in `(10039)` (InvalidRange, spec/03 §6 row M01d3), call `head(key)` once and answer as in step 1. Any other exception answers 500, as today.
  - `GET` without `Range`, and `HEAD`, keep their single `get`.
- **Throttle state:**
  - `MEDIA_ROUTE` is `"on" | "throttle" | "off"`; any other value serves, as `"on"` does. Order inside `handleMedia`:
    1. `"off"` answers 503, unchanged.
    2. `OPTIONS` is answered as today and is never counted.
    3. Methods other than `GET` and `HEAD` answer 405.
    4. Under `"throttle"`, `GET` and `HEAD` call `env.RL_MEDIA.limit({ key })` before the key grammar and before any bucket call.
  - The key is `netHashOf(request.headers.get('CF-Connecting-IP'), await dailySalt(env.QUOTA_NET_SALT_SECRET, now()))` (`now` from `services/edge/src/clock.ts`): the hash of the /24 or /48 prefix and the UTC day. The raw address is never stored or logged.
  - A denied call answers 429 with `Retry-After: 10`, `Cache-Control: no-store` and the `baseHeaders()` CORS set; the existing wrapper adds the isolation headers.
  - The throttle fails open: an absent `RL_MEDIA`, or a `limit()` that throws, serves the request (the rule of `allowed` in `ratelimit.ts`, which may be exported and reused).
  - Under `"on"`, the limiter is never called.
- **Config** (`services/edge/wrangler.jsonc`):
  - `RL_MEDIA` goes into the top-level, `env.staging` and `previews` `ratelimits` arrays with `namespace_id` `"7304"`, `"7314"` and `"7324"` (unique, and beside the existing 730x, 731x and 732x ids) and `simple { "limit": 1000, "period": 10 }`.
  - The limit is a design value (DL-713 amendment), about 100 requests a second per network key per location. One client has at most 26 requests in flight (`laneLimits` in `packages/engine/src/assets/store/lanes.ts`), so it crosses the limit only when small objects return in under 260 ms for 10 s on end. The 10 s period ends inside FetchRetry's eight attempts (mean cumulative backoff ≈ 19 s), so such a client recovers without a failed load.
  - `MEDIA_ROUTE` stays `"on"` in all three blocks.
- **Types** (`services/edge/src/env.ts`): `RL_MEDIA?: RateLimit | undefined`; the `MEDIA_ROUTE` comment lists the three states.
- **Runbook** (`docs/runbooks/r2-media.md` §3):
  - the three states, and how to switch them: edit the var in all three blocks and deploy through `deploy.yml`, or roll back;
  - why `throttle` is for incidents only: shared carrier NAT makes per-network limits blunt;
  - that a switch is a version var, never a KV flag (KV takes 60 s or more to converge);
  - the AC-8 checks.

## Scope out
- Edge caching (Workers Caching, Cache API) and the custom domain (Q-15). These are a conditional later milestone, created only if a U-W8 measurement fails (DL-713 stays).
- Boot request counting, peak in-flight instrumentation and the QA network shaper belong to M02f1 (study proposal GV-07), not here.
- Any batch or multi-range response. Multi-range stays 416 (DL-109, DL-713).
- Client changes: FetchRetry already retries 429 (`fetch-retry.ts` header comment); honouring `Retry-After` is not added.
- A WAF rule or zone rate limit (needs a zone).

## Deliverables
- `services/edge/src/routes/media-range.ts` (new); `services/edge/src/routes/media.ts`; `services/edge/src/env.ts`; `services/edge/wrangler.jsonc`; `services/edge/src/ratelimit.ts` (export `allowed`, optional).
- `services/edge/test/media-range.test.ts` (new); `services/edge/test/media-throttle.test.ts` (new); `services/edge/test/media.test.ts` (bucket-call cases).
- `tools/ci/test/csp-hosts.test.ts` (an `RL_MEDIA` case reading the JSONC).
- `docs/runbooks/r2-media.md`; BD rows in `spec/11-decision-log-builder.md`; `docs/bake-runs/M01d3/staging.txt` (operator, AC-8).
- About 11 files. No new root script.

## Interfaces
- C12 1.3 and C07 1.1: unchanged.
- `Env.MEDIA_ROUTE: 'on' | 'throttle' | 'off'` (a widened var); `Env.RL_MEDIA?: RateLimit` (new binding).
- `parseRangeHeader`, `servedRange` and `RangeSpec` are internal to `services/edge`, not exported from `@dv/shared`.

## Acceptance criteria
- AC-1 Given the merged base When the repository checks run Then they pass — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the range tables in `services/edge/test/media-range.test.ts` When they run Then:
  - **`parseRangeHeader` accepts** `bytes=0-9` → `{offset:0,length:10}`, `bytes=15-` → `{offset:15}`, `bytes=-5` → `{suffix:5}`, `Bytes=0-0` and `" bytes=3-4 "`;
  - **`parseRangeHeader` returns `null`** for `bytes=0-1,4-5`, `bytes=0-1, 4-5`, `bytes=0-1,`, `items=0-1`, `bytes=`, `bytes=-`, `bytes=-0`, `bytes=5-2`, `bytes=1e3-`, `bytes=0x10-`, `bytes=9007199254740993-` and the empty string;
  - **`servedRange` against size 20** gives `0-9` length 10 for `{offset:0,length:10}`, `15-19` for `{offset:15}`, `15-19` for `{suffix:5}`, `0-19` for `{suffix:50}` and `0-19` for `{offset:0,length:100}`; it gives `null` for `{offset:20}` and `{offset:25,length:2}`, and `null` for `{suffix:5}` against size 0

  — proof: `pnpm check:workers -- media-range.test`
- AC-3 Given the M01d2 fixture `assets/data/media-test/default.0123456789ab.json` (20 bytes `0123456789abcdefghij`) in the local `MEDIA` bucket, behind the `Proxy` spy of `media.test.ts` that records `get` and `head` When ranged `GET`s run Then:
  - `Range: bytes=0-9` answers 206 with `Content-Range: bytes 0-9/20` and 10 bytes, recording exactly `['get']`;
  - `bytes=-5` and `bytes=15-` each answer 206 with `bytes 15-19/20`, recording exactly `['get']`;
  - twenty requests `bytes=i-i` for `i` in 0…19 return the fixture byte by byte, recording 20 `get` and 0 `head`;
  - a matching `If-None-Match` with `Range: bytes=0-9` answers 304, recording `['get']`

  — proof: `pnpm check:workers -- media.test`
- AC-4 Given the same fixture and spy When an unsatisfiable or rejected range arrives Then:
  - `bytes=0-1,4-5` and `bytes=5-2` answer 416 with `Content-Range: bytes */20`, `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`, recording exactly `['head']`;
  - `bytes=999-` answers 416 with `bytes */20`, and the first recorded call is `get` with at most one `head` after it;
  - a stub bucket whose `get` rejects with `new Error('get: Requested byte range is not satisfiable (10039)')` and whose `head` returns `{ size: 20 }` answers 416 with `bytes */20`, recording `['get','head']`;
  - with `Range: bytes=0-9`, a stub whose `get` rejects with `new Error('boom')` answers 500 with the media headers, recording `['get']` and no `head`;
  - every M01d2 case in `media.test.ts` still passes

  — proof: `pnpm check:workers -- media.test`
- AC-5 Given `services/edge/test/media-throttle.test.ts` with `MEDIA_ROUTE: 'throttle'` and a stub `RL_MEDIA` that records keys When requests carry `CF-Connecting-IP` Then:
  - with the stub denying, a `GET` of the fixture answers 429 with `Retry-After: 10`, `Cache-Control: no-store`, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin` and the COOP and COEP headers, with no bucket call (spy);
  - with the stub denying, a key outside the grammar (`/media/private/x`) also answers 429;
  - `203.0.113.7` and `203.0.113.99` give the same key; `198.51.100.7` gives another; every key matches `^[0-9a-f]{64}$` and none contains `203.0.113`;
  - with the stub allowing, the `GET` answers 200 with the fixture bytes;
  - with a `limit()` that throws, and with `RL_MEDIA: undefined`, the `GET` answers 200;
  - an `OPTIONS` preflight answers 204 without a `limit()` call

  — proof: `pnpm check:workers -- media-throttle.test`
- AC-6 Given the same recording stub When `MEDIA_ROUTE` is `'on'`, absent, or `'off'` Then:
  - under `'on'` and absent, `GET`, `HEAD` and ranged `GET` of the fixture never call `limit()`;
  - under `'off'`, the answer is 503 with no `limit()` call

  — proof: `pnpm check:workers -- media-throttle.test`
- AC-7 Given the edited `wrangler.jsonc` When the config checks run Then:
  - the case in `tools/ci/test/csp-hosts.test.ts` finds `RL_MEDIA` with `simple {limit: 1000, period: 10}` in the top-level, `env.staging` and `previews` blocks, with three distinct `namespace_id` values that no other `ratelimits` entry uses;
  - `"MEDIA_ROUTE": "on"` still appears three times;
  - the Worker dry-run bundle passes;
  - there is no Durable Object lifecycle change

  — proof: `pnpm check:unit -- tools/ci/test/csp-hosts.test.ts && pnpm check:prod-routes && (pnpm check:do-migrations || pnpm check:do-migrations -- --base origin/claude/build)`
- AC-8 Given this milestone merged and `deploy.yml` deployed staging When the operator uploads one non-OSM test object to `tha-bay-media-staging` at a key of the `assets/` shape, runs the checks, and deletes the object Then:
  - the smoke test passes;
  - `curl -s -o /dev/null -w '%{http_code}' -r 0-9 <staging>/media/<key>` prints 206;
  - `curl -sI -r 999999999- <staging>/media/<key>` shows 416 with `content-range: bytes */<size>`

  — proof: `pnpm check:smoke -- https://tha-bay-web-staging.gratitude-8f4.workers.dev` on the operator workstation after the staging deploy, then the two `curl` commands, with all output pasted into `docs/bake-runs/M01d3/staging.txt`. Without a deploy or the media R2 secrets, the Builder lists AC-8 under "Blocked on". No OSM-derived object is uploaded (DL-713).

## Test plan
- **Workers:** `media-range.test.ts` (tables, no bindings), `media.test.ts` (call counts, 416 paths, the 10039 stub), `media-throttle.test.ts` (network keys, fail-open, states); `pnpm check:workers -- media`.
- **Unit:** `pnpm check:unit -- tools/ci/test/csp-hosts.test.ts`.
- **Release:** `pnpm check:prod-routes`, `pnpm check:do-migrations`.
- **Manual:** AC-8 on staging.

## Demo script
1. `pnpm check:workers -- media-range.test`: the accept and reject tables pass, including the multi-range rows.
2. `pnpm check:workers -- media.test`: the slice-by-slice case shows 20 `get` and 0 `head`.
3. `pnpm check:workers -- media-throttle.test`: 429 under `throttle` with a denying stub; untouched under `on`.
4. After the deploy: `curl -s -o /dev/null -w '%{http_code}' -r 0-9 https://tha-bay-web-staging.gratitude-8f4.workers.dev/media/<key>` prints 206.

## Effort
0.4 Builder session; about 11 files; risk **low**.

## Risks & fallbacks
- **The vitest pool's local R2 clamps, or throws, for a start past the end.** The route handles both (step 2 and step 3), and AC-4 asserts only the response and that `get` comes first. If the local bucket ignores `range` objects entirely, pass the request's `Range` header itself (`range: request.headers`) after `parseRangeHeader` has validated it, and record a BD row.
- **The 10039 message format differs at runtime or in the pool.** Match `/\(10039\)\s*$/` on `message`; record any other observed form in a BD row and spec/03 §7 and match it too. Until then such answers are 500. The path is rare: the client asks only for slices inside a size it already knows.
- **R2 cannot give the total size in one call** (the spec/03 row is wrong at runtime). Keep `head` plus `get` behind the new parser and ship only the throttle state and the tables (≈ 0.2 session). Report it to the Architect.
- **`RL_MEDIA` misbehaves in `wrangler dev` or the pool.** The tests stub the binding through the `env` override of `call()`, as `auth.test.ts` does, so no real limiter is needed.

## Notes for the Builder
- Read first: `services/edge/src/routes/media.ts` and `services/edge/test/media.test.ts` (its `Proxy` spy and fixtures); BD-M01d2-01 (`spec/11-decision-log-builder.md`); `services/edge/src/{ratelimit.ts, id/nethash.ts, clock.ts}`; the `ratelimits` blocks of `services/edge/wrangler.jsonc`; spec/03 §6 (row M01d3 and the "R2 media through a Worker" paragraph); DL-713 (`spec/11-decision-log-8.md`); `docs/runbooks/r2-media.md` §3.
- Order of work: range module and tables, single-`get` path, throttle, config and runbook.
- Architect spec edits that landed with the DL-713 amendment (DL-724), not Builder work:
  - RISK-30 in `spec/09-risk-register.md` stops saying that no rate limit exists without a zone (the binding runs on `workers.dev`) and names the `throttle` state;
  - the media row of `spec/10-cost-model.md` counts bucket operations per request: one Class B read for a 200 or 206; one more `HEAD` for a rejected or failing range;
  - `09-backend-contracts-1.1.md` lists the `MEDIA_ROUTE` values.
- Requests in a test set `CF-Connecting-IP` through `headers`. Use only the documentation ranges `203.0.113.0/24` and `198.51.100.0/24`. Never log an address or a key.
- The throttle is not a quota. The binding's counts are per location and approximate (spec/03 §6, row M01d3), so the tests assert routing and keys, never exact counts across calls.
- Secrets: none for the tests. Without `QUOTA_NET_SALT_SECRET`, `dailySalt` uses the UTC day alone, as M00e does locally. Deploys run from `deploy.yml` (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), so AC-8 is the operator's step.
- A `ratelimits` binding is not a Durable Object change; it ships through `deploy.yml`, and `check:do-migrations` proves it.
- The 10039 code and the `size` field come from the 2026-10-23 verification; add no other R2 error code from memory.

# M04b3 — local-identity-play-token

## Goal
After this session the game has a P0 identity that needs no account. `packages/identity` (`@dv/identity`) implements the C12 1.1 `IdentityService` with `LocalIdentity`: a UUIDv7 identity profile id minted on the device, a non-extractable ECDSA P-256 device key in IndexedDB `dv-identity` (store `identity`, key `current`, DL-075), its RFC 7638 thumbprint, `attestAge`, and `authHeader()` that obtains a 24 h play token. The web Worker gains route 5 `POST /api/v1/id/play-token` as a stateless mint (DL-182: trust-on-first-use binding and `/me` arrive in M06a1). `packages/net` (`@dv/net`) is created with the `CloudSync` port and `NullCloudSync` (cloud sync is M12a1). Single-player boots, plays and saves with `/boot` and every identity route unreachable.

## Requirements
- R-AUTH-01: v1 runs with no sign-in; the local profile and HMAC play token are the P0 phase.
- R-AUTH-02: every caller sees only `IdentityService`, so P1 (M12a1), P2 (M13c1) and P3 (M14a) are new adapters, not refactors.
- R-ROLL-01: no single-player path depends on the network or an account (`@offline` e2e).

## Depends on
- M00a (Worker script, router, `ApiError`, geo-gate, `check:workers`), M04b1 (shell, age gate, profile chips).
- Contracts: C12 1.1 (`IdentityService` with `attestAge`, `PlayTokenReq`, `PlayTokenRes`, `PlayTokenClaims`, routes table), C05 1.1 (read only: save profiles stay S01's).

## Scope in
- `packages/shared/src/identity.ts`: `ProviderId`, `Tier`, `AgeBracket`, `IdentityState`, `IdentityService` (+ `attestAge`), `PlayTokenClaims`, `AccessClaims`, `StaffScope` copied verbatim from `09-backend-contracts.md` §2.3 and `09-backend-contracts-1.1.md` §2; `PlayTokenReq`/`PlayTokenRes` from §2.5 into `packages/shared/src/api/v1.ts` (extend, do not change existing exports). Pure; no IO.
- `LocalIdentity` (`packages/identity/src/local.ts`):
  - first launch: UUIDv7 (`crypto.getRandomValues` + `Date.now()`, version nibble 7, variant `10`), `crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, false, ['sign','verify'])`, public JWK exported, thumbprint = base64url SHA-256 of `{"crv","kty","x","y"}` in lexical order (RFC 7638); stored in one IndexedDB transaction;
  - `current()` synchronous after an async `LocalIdentity.open()`; `tier: 'local'`, `providers: []`;
  - `attestAge(bracket)` persists the bracket and notifies `onChange`; it makes no network call before M12a1 (route 15);
  - `register`, `link`, `unlink`, `signInOnNewDevice` reject with `Error('not_available: lands in M12a1|M13c1|M14a')`;
  - `forget()` calls `DELETE /api/v1/me` once (route 14, M06a1; a 404 or network error is ignored), then deletes `dv-identity` and emits a fresh identity on next `open()`.
- `PlayTokenClient` (`packages/identity/src/play-token-client.ts`): `authHeader()` returns `null` unless `ageBracket === '18p'` and `BootConfig.region === 'ok'` (when a boot config was obtained); signs `"pt-req|" + pid + "|" + ts` (ECDSA P-256 SHA-256, raw r‖s, base64url), POSTs `PlayTokenReq`, caches the token in memory until `exp − 5 min`; any non-2xx or network error returns `null` and blocks retries for 60 s. Every genAI-backed caller treats `null` as "use the offline path" (C12 §2.2 client rule).
- Route 5 (`services/edge/src/id/playtoken.ts`, `mint` and `verify` only): Ajv body check; `|now − ts| ≤ 120 s`; signature verified with WebCrypto against the posted JWK; `age !== '18p'` → `403 age_blocked`; claims `{v:1, pid, dkt, age:'18p', iat, exp: iat + 86,400,000, kid}`; `tok = "pt1." + b64url(claims) + "." + b64url(HMAC-SHA256)`; player route, so geo-gated (451 outside `GEO_ALLOW`). Secret format (Builder decision, logged): `PLAY_TOKEN_HMAC = "<kid>:<base64url 32 bytes>"`, optional `PLAY_TOKEN_HMAC_PREV` for verification only.
- `packages/net`: `package.json` (`@dv/net`, imports only `@dv/shared`), `src/cloud-sync.ts` with the internal port `CloudSync { readonly kind: 'null' | 'http'; status(): 'off' | 'idle' | 'syncing' | 'error'; syncNow(): Promise<{ pushed: number; pulled: number }>; onStatus(cb): () => void }` and `NullCloudSync` (status `off`, never fetches). Not a contract; M12a1 adds `HttpCloudSync`.
- Wiring: the shell constructs one `LocalIdentity` at boot (before the title screen, never blocking it) and rebinds M04b1's `AgeAttestationPort` to `IdentityService.attestAge` and feeds the profile chip; a bracket M04b1 stored in `UiPrefs.age` is migrated into `dv-identity` once and then read only from there. QA builds expose `window.__dvBridge.identity` = `{ state(), authHeader() }`.

## Scope out
- TOFU key binding, `/me` export and forget server side, per-net 50/day token cap (`PlayerQuotaDO`): M06a1.
- P1 registration, issuer, JWKS, `HttpCloudSync`, route 15: M12a1. Account and saves pages: M12a2.
- Device-code and provider links: M13c1, M14a.

## Deliverables
- `packages/shared/src/identity.ts`, `packages/shared/src/api/v1.ts` (extended), `packages/shared/test/identity.test.ts`.
- `packages/identity/{package.json, tsconfig.json, README.md}`, `src/{index.ts, local.ts, store.ts, uuid7.ts, thumbprint.ts, play-token-client.ts}`, `test/{local.test.ts, play-token-client.test.ts}`.
- `packages/net/{package.json, tsconfig.json, README.md}`, `src/{index.ts, cloud-sync.ts}`, `test/cloud-sync.test.ts`.
- `services/edge/src/id/playtoken.ts`, route registration in the M00a router, `services/edge/test/play-token.test.ts`, `services/edge/.dev.vars.example` (names only), `wrangler.jsonc` `secrets.required` += `PLAY_TOKEN_HMAC` (†).
- `apps/web/src/identity.ts` (boot wiring, QA bridge), M04b1 age-gate and chip call sites updated in `packages/ui`.
- `tests/e2e/offline-boot.spec.ts` (tag `@offline`).
- ESLint `no-restricted-imports`: `@dv/identity` may import only `@dv/shared`; `services/**` may not import `@dv/identity`.
- IndexedDB in Node tests: reuse the shim M04a1 chose; if none, add `fake-indexeddb` (version as pnpm resolves, recorded in `spec/03`).
- `typecheck` chain appends `packages/identity` and `packages/net` tsconfigs.

## Interfaces
- C12 1.1: `IdentityService`, `IdentityState`, `PlayTokenReq/Res/Claims` verbatim; route 5 semantics per `spec/05-api-and-realtime.md` §2–§3 and `09-backend-contracts.md` §2.3. No shape change.
- New internal (not contracts): `CloudSync` port, `PlayTokenClient`, `__dvBridge.identity`.

## Acceptance criteria
- AC-1 Given an empty `dv-identity` When `LocalIdentity.open()` runs twice in the same origin Then the first run mints a profile id matching `^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, the second returns the same `profileId` and `deviceKeyThumbprint`, the stored private key has `extractable === false`, and `tier` is `'local'` with `providers` empty — proof: `pnpm check:unit -- packages/identity`
- AC-2 Given a fixed P-256 public JWK When `thumbprint()` runs Then it equals the base64url SHA-256 of the RFC 7638 member string built independently in the test, and adding `kid` or `use` to the JWK does not change it — proof: `pnpm check:unit -- packages/identity`
- AC-3 Given a fresh identity When `attestAge('16_17')` runs Then `current().ageBracket` is `'16_17'`, `authHeader()` resolves `null` and the mocked `fetch` records zero calls; after `attestAge('18p')` and a reopen the bracket is still `'18p'` — proof: `pnpm check:unit -- packages/identity`
- AC-4 Given an `18p` identity and a mocked route 5 When `authHeader()` is called three times within an hour Then exactly one POST is made, its body signature verifies against the posted JWK over `pt-req|<pid>|<ts>`, and each result is `{ Authorization: 'PlayToken pt1.…' }`; when the route answers 404, 503 or a network error the result is `null` and no second POST happens within 60 s of mocked time — proof: `pnpm check:unit -- packages/identity`
- AC-5 Given the Workers runtime with a test `PLAY_TOKEN_HMAC` When route 5 receives a valid proof, a proof with `ts` 121 s old, a tampered signature, `age: '16_17'`, and a valid proof with `cf.country = 'FR'` Then the answers are 200 with a token that `verify()` accepts (`pid`, `dkt` equal to the thumbprint, `exp − iat = 86,400,000`), 400 `bad_request`, 400 `bad_request`, 403 `age_blocked` and 451 `region_blocked`, each as `ApiError` with `X-Request-Id` — proof: `pnpm check:workers -- play-token`
- AC-6 Given the Workers runtime without `PLAY_TOKEN_HMAC` When route 5 receives a valid proof Then it answers 503 `upstream_unavailable` and logs `SKIP play-token: PLAY_TOKEN_HMAC not set` once — proof: `pnpm check:workers -- play-token`
- AC-7 Given `NullCloudSync` When `syncNow()` runs Then it resolves `{pushed: 0, pulled: 0}`, `status()` is `'off'` and `fetch` is never called — proof: `pnpm check:unit -- packages/net`
- AC-8 Given a QA build in which Playwright aborts every request to `/api/v1/boot` and `/api/v1/id/*` When the title is clicked, the age gate is answered 18+, and New Game starts Then the in-game sim advances at least 120 ticks within 5 s (`__dvBridge.engine.observe().tick`), `__dvBridge.identity.state().tier` is `'local'`, no error dialog shows and no uncaught page error is logged — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @offline`
- AC-9 Given the same build with network allowed When the app boots to the main menu without answering the age gate Then zero requests reach `/api/v1/id/` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @offline`
- AC-10 Given the workspace When lint and typecheck run and the production bundle is scanned Then `@dv/identity` imports only `@dv/shared`, no `services/**` file imports `@dv/identity`, and no secret pattern appears in `apps/web/dist` — proof: `pnpm lint && pnpm typecheck && pnpm build && pnpm check:secrets -- apps/web/dist`
- AC-11 Given the branch When the preview deploy runs Then the app stays deployable (SKIP without Cloudflare secrets, exit 0) — proof: `pnpm build && pnpm deploy:preview`

## Test plan
- Unit: `shared/identity` (type guards, claims shape), `identity/local` (mint, persistence, non-extractable key, thumbprint, attestAge, forget), `identity/play-token-client` (signature, caching, back-off, `null` paths), `net/cloud-sync`. `pnpm check:unit -- packages/identity packages/net packages/shared`.
- Workers: `services/edge/test/play-token.test.ts`. `pnpm check:workers -- play-token`.
- E2E: `tests/e2e/offline-boot.spec.ts` (`@offline`). `pnpm check:e2e -- --project=chromium-webgl2 --grep @offline`; it also runs on `webkit-webgl2` in the CI matrix.
- No device run: WebCrypto and IndexedDB behaviour on iPhone is covered by the M11a soak.

## Demo script
1. `pnpm dev`; open the app; DevTools › Application › IndexedDB › `dv-identity` shows one record with a UUIDv7 and a public JWK only.
2. Answer the age gate 18+; console: `await __dvBridge.identity.authHeader()` → `PlayToken pt1.…` (with `PLAY_TOKEN_HMAC` in `services/edge/.dev.vars`).
3. Remove the secret, restart: the same call returns `null`; the game still plays.
4. DevTools › Network › Offline; reload from the service worker; New Game starts.

## Effort
0.5 session; ≈ 26 files (most are short package scaffolding and tests); risk low.

## Risks & fallbacks
- `fake-indexeddb` cannot store a `CryptoKey` (structured clone in Node): keep the key in a `Map` behind the same `store.ts` interface for Node tests only, and prove persistence of the real key in the `@offline` e2e by reading `__dvBridge.identity.state()` across a reload. Log a Builder decision.
- WebCrypto `sign` output format differs between engines: the client always converts to raw r‖s (64 bytes) before base64url and the Worker verifies raw; the unit test covers a DER-shaped input and rejects it.
- M04b1's `AgeAttestationPort` has a different shape than expected: adapt at the port boundary in `apps/web/src/identity.ts`, never in `IdentityService`; note it in the report.

## Notes for the Builder
- Read first: `09-backend-contracts.md` §2.2–§2.5, `09-backend-contracts-1.1.md` §2, `09-backend.md` §2.4 and §3.5, `spec/05-api-and-realtime.md` §2–§3 (route 5, P0 proof), `10-ui-pages.md` §2 (age gate outcome).
- Order: shared types → `uuid7` and `thumbprint` → store → `LocalIdentity` → client → route 5 → `@dv/net` → shell wiring → e2e.
- Secrets: `PLAY_TOKEN_HMAC` (Worker secret via `wrangler secret` or `versions upload --secrets-file`; local `services/edge/.dev.vars`; Workers tests bind a test value in the pool config). `spec/08-test-and-ci.md` §8 lists it from M06a1; DL-182 puts the stateless mint here, so this milestone introduces it. Absent: route 5 answers 503 and the client plays offline; list it under "Blocked on" if staging lacks it.
- Ids minted on the device are allowed here only (06 §4.3 identity profile id); everything server-side stays Worker-minted.
- Never put the profile id, thumbprint or token into telemetry (C16 privacy). Branch `m04b3-local-identity-play-token`.

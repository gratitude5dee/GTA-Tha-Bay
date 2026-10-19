# M12a1 — p1-identity-cloud-saves

## Goal
Players can move from P0 (local profile and play token) to P1 (`device` tier) and keep their saves in the cloud. When this session ends, `tha-bay-web` runs an ES256 OIDC issuer with discovery and JWKS (route 6), registration with a Turnstile port and per-net caps (route 7), rotating refresh tokens with family revocation (route 8), logout (route 9), the age-bracket route (15), staff scopes checked against `staff_roles` (replacing `OPS_TOKEN`, DL-192), migration `0005_saves.sql`, the save routes 16–19 and 50–51, the client `DeviceIdentity` adapter, `HttpCloudSync`, `pnpm auth:tpa`, and `deploy:prod -- --gradual` with the version-affinity cookie. UI for registering, age POST and conflicts is M12a2.

## Requirements
- R-AUTH-01: delivers P1, the device-registered phase, with cloud sync; single-player still needs no account.
- R-ROLL-02: persistence on Supabase through our issuer and RLS; rooms (M12b1) verify this JWT.
- R-IP-04: only bracket `18p` obtains a token; under-18 brackets are blocked server-side too (DL-139).

## Depends on
- M05d (Supabase projects, migrations 0001–0002, `DataPort`, in-memory port, `check:db`, `check:db:types`, `db:push`, `test:staging`), M04b3 (`IdentityService` local adapter, device key in `dv-identity`, `NullCloudSync`, play-token mint route 5), M06a1 (`PlayerQuotaDO`, the trust-on-first-use key binding, route 14; DL-219).
- Contracts: C12 1.1 (`09-backend-contracts.md` §2.2–§2.6, `09-backend-contracts-1.1.md` §2), C05 1.1 (`01-engine-save-modes.md` rules 6 and 10, `SaveService.changesSince`).

## Scope in
- Issuer (`id.<domain>`; host-routed by `ID_ISSUER`): discovery and JWKS with CORS `*` and `max-age=600`; both `ID_SIGNING_JWK_CURRENT` and `_NEXT` always published; `sign()`/`verify()` with `kid`; verifiers cache JWKS 10 min and refetch on an unknown `kid`; every other path on the issuer host is 404 (DL-185). `run_worker_first: ["/api/*", "/.well-known/*"]`.
- `AccessClaims` exactly as C12 §2.3 (`aud: 'tha-bay'`, `role: 'authenticated'`, `tier`, `prv`, `ab`, `scp?`, `jti`, TTL 1 h). No email, wallet or provider subject.
- Route 7 `register`: PlayToken auth, `RegisterReq`, `TurnstileVerifier` port, 3 registrations per net per day (`PlayerQuotaDO q:n:*`), `profiles.tier` → `device`, returns `TokenRes`.
- Route 8 `token`: `refresh` (32 random bytes stored as SHA-256 with a family id, rotated on every use, reuse revokes the family) and `device_assertion` (signature over `"tok-req|pid|ts"`, ±120 s, bound thumbprint).
- Route 9 `logout` (revokes the family); route 15 `POST /me/age` (`{bracket}` only; `age_assurance` row; non-`18p` sets the block flag and later token or register calls return `age_blocked`).
- Staff: `scp` re-checked against `staff_roles` on every staff route; every admin write appends `audit_log`. The `OPS_TOKEN` path of route 28 is deleted; CI mints a staff JWT with `CI_STAFF_DEVICE_JWK` through route 8 (DL-192).
- Migration `0005_saves.sql` exactly as `09-backend-db.md` §3.5 (tables, checks, RLS policies); Worker caps: ≤ 64 save profiles, ≤ 64 MiB per identity, one write per slot per 5 s.
- Routes 16–19, 50, 51 per spec/05 §3: `If-Match` versions, 409 with `details.server`, inline ≤ 262,144 bytes, presigned blob URL (route 19, purpose `save_blob`, ≤ 2 MiB) into `tha-bay-private-<env>` at `saves/<profile>/<saveProfile>/<slot>/<version>.bin`, tombstones kept 180 d (DL-195), `NEWER_SCHEMA` refusal.
- Client: `packages/identity/src/device` (`DeviceIdentity`: `register`, `authHeader` with refresh 60 s before expiry, `forget`, `onChange`); `packages/net/src/cloud-sync.ts` `HttpCloudSync` (reads `SaveService.changesSince`, pushes records and tombstones, stores a 409 server copy in the `dv-saves` `conflicts` store, backoff 1 s → 60 s, never overwrites silently).
- `pnpm auth:tpa -- --env <env>`: Supabase Management API, list first, then register `{oidc_issuer_url}` only when absent [`09-backend-db.md` §8; F-031].
- `deploy:prod -- --gradual`: 10 → 50 → 100 % with health polling and rollback; the Worker sets the affinity cookie that the zone Transform Rule reads.

## Scope out
- Register page, Turnstile widget, age POST from `attestAge`, cloud chip, conflict dialog, forget UI → M12a2.
- Rooms, tickets → M12b1. Device-code, `/link`, provider links → M13c1. SIWE, merge → M14a.
- Leaderboards and `progress_*` tables → M12c2, M12e.

## Deliverables
- `services/edge/src/id/{issuer.ts, register.ts, token.ts, staff.ts, turnstile.ts, age.ts}`; `services/edge/src/saves/{routes.ts, blob.ts}`; `services/edge/src/affinity.ts`; router entries for routes 6–9, 15–19, 50–51.
- `services/edge/src/data/supabase/{identity.ts, saves.ts}` and the matching additions to the in-memory port M05d created (same location; no `DataPort` shape change).
- `services/edge/wrangler.jsonc`: `run_worker_first` above; vars `ID_ISSUER` (staging: the staging Worker origin until Q-15 names a domain); `secrets.required` adds `ID_SIGNING_JWK_CURRENT`, `ID_SIGNING_JWK_NEXT`; `TURNSTILE_SECRET` optional; repeated under `previews`.
- `supabase/migrations/0005_saves.sql`, `supabase/tests/rls_saves.sql`; regenerated `packages/shared/src/db.gen.ts`.
- `packages/identity/src/device/{device-identity.ts, token-store.ts}`, `packages/identity/test/device.test.ts`.
- `packages/net/src/cloud-sync.ts` (`HttpCloudSync` beside `NullCloudSync`), `packages/net/test/cloud-sync.test.ts`.
- `tools/ops/auth-tpa.ts`, `tools/ops/id-keys.ts` (prints a fresh ES256 JWK pair for `.dev.vars` or a secrets file; writes nothing to the repo), `tools/ops/test/auth-tpa.test.ts`.
- `tools/ci/deploy.ts`: `--gradual`; `.github/workflows/deploy.yml`: production uses `-- --gradual`, CI staff JWT from `CI_STAFF_DEVICE_JWK`.
- `services/edge/test/{issuer-rotation, register, refresh-reuse, age, staff-scope, save-conflict, saves, affinity, password-exchange}.test.ts`; `tests/staging/rls-thirdparty.test.ts`.
- Only if C12 1.3 is accepted (Notes): the 1.3 additions in `packages/shared/src/api/v1.ts` (and a `supabase/migrations/` file if `identities.provider` is constrained to the C12 values); `services/edge/src/routes/auth.ts` (exchange, route behaviour after the link, and the password handler registered with M06a1's forget and export lists).
- Root script **`auth:tpa`** (through `tools/ci/run.ts` `args()`).
- Secrets: `ID_SIGNING_JWK_CURRENT`, `ID_SIGNING_JWK_NEXT` (Worker); `TURNSTILE_SECRET` (Worker, optional); `CI_STAFF_DEVICE_JWK` (GitHub repository secret, `08-test-and-ci.md` §8); `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_SECRET_KEY` (from M05d). Absent: `auth:tpa` prints `SKIP auth:tpa: SUPABASE_ACCESS_TOKEN not set`; the Worker without signing keys answers routes 6–9 with `feature_disabled`; without `TURNSTILE_SECRET` the verifier runs mode `none` and logs `SKIP turnstile: TURNSTILE_SECRET not set` once per isolate.

## Interfaces
- C12 1.1: routes 6–9, 15–19, 50–51, `AccessClaims`, `TokenReq/TokenRes`, `RegisterReq`, `CloudSaveRecord`, `SaveProfileUpsert`, `SaveSyncRes`, `IdentityService` used as frozen. If a route type is missing from `packages/shared/src/api/v1.ts`, copy it verbatim from `09-backend-contracts.md` §2.5.
- C05 1.1: `SlotId`, `SaveRecord`, `Tombstone`, `changesSince`, `conflicts` store used as frozen.
- No contract change.

## Acceptance criteria
- AC-1 Given the Worker with CURRENT and NEXT test keys When the issuer host is asked for `/.well-known/openid-configuration` and `/.well-known/jwks.json` Then `issuer` equals `ID_ISSUER`, the JWKS holds exactly two ES256 keys with distinct `kid`s, both responses carry `Access-Control-Allow-Origin: *` and `max-age=600`, any other issuer-host path is 404, and a token signed before NEXT is promoted still verifies after promotion — proof: `pnpm check:workers -- issuer-rotation`
- AC-2 Given a P0 profile with an `18p` play token and a fake Turnstile verifier When it registers Then it receives a `TokenRes` whose JWT claims are exactly the `AccessClaims` key set with `tier: 'device'`, `role: 'authenticated'`, `aud: 'tha-bay'`; a failing verifier returns `bad_request`; the fourth registration from one net hash in a UTC day returns `rate_limited`; verifier mode `none` accepts and logs the SKIP line — proof: `pnpm check:workers -- register`
- AC-3 Given a registered profile When it refreshes twice with the same refresh token Then the second call is `unauthorized` and every token of that family is revoked; after `logout` a fresh token of a new family is also refused — proof: `pnpm check:workers -- refresh-reuse`
- AC-4 Given route 15 When `{bracket: '16_17'}` is posted Then the response blocks online use and later register and token calls return `age_blocked`; a body carrying a date of birth is `bad_request`; `{bracket: '18p'}` returns an `IdentityStateDTO` — proof: `pnpm check:workers -- age`
- AC-5 Given two devices of one profile When both PUT the same slot with the same `If-Match` Then one receives 200 with `version + 1` and the other 409 whose `details.server` equals the stored record — proof: `pnpm check:workers -- save-conflict`
- AC-6 Given the save routes When a slot is PUT before its save profile (route 50) exists, a 65th save profile is created, a 300 KiB record is PUT inline, a second write to one slot lands within 5 s, and a record with a schema newer than the build is PUT Then the responses are `conflict`, `conflict`, `payload_too_large`, `rate_limited` and `conflict` with `NEWER_SCHEMA`; route 19 returns a presigned PUT for ≤ 2 MiB; route 51 tombstones every slot and `GET /saves/sync` reports them — proof: `pnpm check:workers -- saves`
- AC-7 Given a JWT with `scp: ['ops']` but no `staff_roles` row When it calls route 28 Then it gets `forbidden`; with the row it gets 202 and one `audit_log` row; a request carrying the old `OPS_TOKEN` header is `unauthorized` — proof: `pnpm check:workers -- staff-scope`
- AC-8 Given migration 0005 on the local stack When pgTAP runs Then user A selects none of user B's `save_profiles` or `save_records`, an `unlocks` row with an id not matching `^unlock\.` fails, and the generated types equal the committed `db.gen.ts` — proof: `pnpm check:db && pnpm check:db:types`
- AC-9 Given a fake `SaveService` with 3 dirty records and 1 tombstone and a mocked API that answers one PUT with 409 When `HttpCloudSync` runs one cycle Then 2 records and the tombstone are acknowledged, the 409 server copy is stored in `conflicts` and the local record is unchanged, and a network failure retries with backoff capped at 60 s — proof: `pnpm check:unit -- packages/net`
- AC-10 Given `DeviceIdentity` over a mocked API When it registers, its access token is 59 s from expiry, and `forget()` runs Then the tier moves `local → device`, `authHeader()` refreshes before returning `Bearer …`, and `forget()` calls `DELETE /api/v1/me` before wiping `dv-identity` — proof: `pnpm check:unit -- packages/identity`
- AC-11 Given a mocked Management API that already lists the issuer When `auth:tpa` runs twice Then it posts nothing; with an empty list it posts once with `oidc_issuer_url` = `ID_ISSUER`; without `SUPABASE_ACCESS_TOKEN` it prints the SKIP line and exits 0 — proof: `pnpm check:unit -- tools/ops` and `env -u SUPABASE_ACCESS_TOKEN pnpm auth:tpa -- --env staging`
- AC-12 Given staging with the issuer registered by `auth:tpa` When a supabase-js client holding our JWT for profile A selects `save_records` Then it sees only A's rows and none of profile B's — proof: `pnpm test:staging -- rls-thirdparty`
- AC-13 Given the deploy tool When `--gradual --dry-run` runs Then the printed plan is upload → 0 % smoke → 10 % → 50 % → 100 % with a health poll between steps and a rollback branch, and every Worker response sets the affinity cookie — proof: `pnpm deploy:prod -- --gradual --dry-run && pnpm check:workers -- affinity`
- AC-14 Given the branch When the production bundle and the preview are built Then no `/_test/` route and no signing key or secret pattern reaches `apps/web/dist`, and the Preview deploys — proof: `pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist && pnpm deploy:preview`
- AC-15 Given the base branch's `prompt-pack/06-SHARED-CONTEXT.md` and this branch's `v1.ts` When the `password-exchange` suite runs Then, if 06 lists C12 1.3 (and so `ProviderId` includes `'password'`), a stubbed successful route 59 sign-in answers our `TokenRes` with `sub` = the device `profile_id` and tier `device`, links one `identities` row, and returns no Supabase token in the body; route 58 answers `TokenRes`, route 60 answers 404 `feature_disabled`, routes 61, 62 and 64 succeed with our JWT for the linked profile and answer 401 to an `SB` bearer, `DELETE /me` deletes the linked Supabase user through one stubbed admin call, and `/me/export` lists the username and `acceptedAt`; otherwise routes 58–62 and 64 answer exactly as before this milestone; in both cases an `SB` bearer on every route of this milestone gets the same status and body as no bearer — proof: `pnpm check:workers -- password-exchange`

## Test plan
- Workers runtime (`pnpm check:workers`): the nine suites above; test keys generated in setup with WebCrypto, never committed.
- Unit: `packages/net/test/cloud-sync.test.ts`, `packages/identity/test/device.test.ts`, `tools/ops/test/auth-tpa.test.ts`.
- DB: `supabase/tests/rls_saves.sql` plus the existing `server_only.sql` (`pnpm check:db`).
- Staging: `rls-thirdparty` (needs `staging`, Supabase secrets, signing keys on the staging Worker).

## Demo script
1. `pnpm exec tsx tools/ops/id-keys.ts` twice; paste both into `services/edge/.dev.vars`.
2. `pnpm dev`; register through the QA bridge (Turnstile mode `none`); `curl` the discovery and JWKS.
3. Save in story; watch `PUT /api/v1/saves/...`; save the same slot from a second window to see a 409.

## Effort
1 Builder session; about 40 files; risk **high**. Key handling, Supabase Third-Party Auth on staging and the gradual-deploy path are the risks.

## Risks & fallbacks
- Turnstile verification API is UNVERIFIED (U-BE-2, Q-BE-05). Ship the `TurnstileVerifier` port with mode `none` (per-net cap only) as the default. Implement the Cloudflare verifier only if you can read its current documentation; record the endpoint as a new fact in `spec/03` with URL and date. ACs use a fake verifier.
- Supabase rejects the issuer at registration (F-031 path): fall back per ADR-0009 (anonymous sign-in plus links) only after reporting; AC-12 then stays blocked and is listed under "Blocked on".
- No domain yet (Q-15): `*.workers.dev` cannot carry the version-affinity Transform Rule. `--gradual` reads repo variable `AFFINITY_RULE_READY`; when it is not `1` it prints `SKIP gradual: affinity rule absent (Q-15)` and runs the 0 % → 100 % path.
- File budget: if over 40, move route 19 (blob URLs) to M12a2's session and keep inline saves only; say so in the PR.
- Owner password accounts (ADR-ACCT-01, DL-517): record in the report U-ACCT-2 (does Supabase Auth rotate the refresh token on each use and detect reuse on this project?) and U-ACCT-5 (do Supabase-native password users coexist with our Third-Party Auth issuer, as observed during `rls-thirdparty`?). Neither enters an AC; if U-ACCT-5 fails, password accounts stay standalone and no exchange is written.

## Notes for the Builder
- Read first: `09-backend-contracts.md` §2.3–§2.6; `09-backend-contracts-1.1.md` §2; `09-backend-db.md` §1, §3.5, §7, §8; `09-backend-ops.md` §1.3, §2, §3; `spec/05-api-and-realtime.md` §2–§3; ADR-0009; DL-185, DL-192, DL-195.
- Order: 0005 + pgTAP → issuer and JWKS → register, token, logout, age → staff → save routes → client adapters → `auth:tpa` → gradual deploy.
- Make sure the vitest workspace globs collect `tools/ops/test/**` so `check:unit -- tools/ops` finds the suite.
- e2e web server (M12a2, M12b2) needs signing keys: when `ENVIRONMENT` is `dev` and the keys are absent, the Worker still refuses (no auto-generation); the Playwright setup writes ephemeral keys into the git-ignored `.dev.vars` instead (M12a2).
- Hash refresh secrets with SHA-256 before storage; compare in constant time. Keys are imported once per isolate.
- `routes 6–9, 15–19, 50–51` are delivered here (DL-182). Rooms (M12b1) reuse `verify()` through the JWKS URL, never a binding.
- **Owner password accounts (ADR-ACCT-01, DL-516).** Routes 58–62 and 64 exist since the owner's PR #1 and its follow-ups. The C12 1.3 proposal (`ProviderId` `'password'`, flag `auth.password`) counts as accepted only when `prompt-pack/06-SHARED-CONTEXT.md` on the base branch lists C12 1.3 (an Architect edit; never edit 06 yourself and file no proposal). If it does, this milestone's first step lands exactly the 1.3 additions 06 lists in `packages/shared/src/api/v1.ts` (`ProviderId` `'password'`, `FeatureFlag` `auth.password`) and, if `identities.provider` is constrained to the C12 values, a migration that adds `'password'`; that is applying an accepted contract, not editing one, and nothing else in `v1.ts` changes (DL-524). If accepted, a successful route 59 sign-in is exchanged server-side for `TokenRes` (verify the Supabase token against the project JWKS, link the `identities` row to the device `profile_id`, tier `device`, never `linked`) and the Supabase tokens stay in the Worker. Every route then: 58 creates the user, signs in and answers `TokenRes`; 59 answers `TokenRes`; 60 answers `feature_disabled` (route 8 refreshes); 61, 62 and 64 accept our JWT for a profile with a password `identities` row and no longer accept `SB` (61 clears `dv-rt`, 62 reads the username, 64 deletes the Supabase user and the row); register the password handler with M06a1's forget and export lists so `DELETE /me` deletes the linked Supabase user and `/me/export` includes the username and `acceptedAt`. Otherwise write no exchange code and leave routes 58–62 and 64 untouched. Either way no route of this milestone accepts an `SB` token (AC-15).
- Branch `m12a1-p1-identity-cloud-saves`.

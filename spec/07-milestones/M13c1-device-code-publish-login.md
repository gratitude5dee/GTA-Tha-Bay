# M13c1 — device-code-publish-login

## Goal
A creator's CLI can get a publish token without any browser integration. `dv login` (built in M13c3) calls C12 route 10. The Worker issues an RFC 8628 device code. The player opens `/link` in the game, enters the 8-character code and approves it. The CLI's poll then receives a 1-hour JWT with `aud: 'tha-bay-cli'` and `scp: ['mods:publish']`, plus a 30-day rotating refresh token. Approval works only for a profile of tier `linked`, bracket `18p`, with no publishing ban (ADR-0018). Route 11 (Continue with ChatGPT) is built behind `auth.openaiWeb`, which stays off; with a test OIDC provider it links provider `openai` and raises the profile to `linked`. This session also records the ADR-0018 provider-ladder spike: whether Supabase Auth's GitHub provider can run beside our Third-Party Auth issuer on the staging project.

## Requirements
- R-AUTH-03: ChatGPT linkage exists only to enable publishing and is never needed to play. The shipped path is bring-your-own agent plus device-code login.
- R-MOD-02: the device-code login is the publish login for players using their own agent (`12-modding-publish.md` C§2).

## Depends on
- **M12a1**: ES256 issuer and JWKS, `TokenRes`, refresh rotation and reuse revocation (route 8), staff scopes, `HttpCloudSync`, `DeviceIdentity`, the hourly expiry cron.
- **M04b1**: shell, kit, page registry, Profile page.
- Contracts: C12 1.1.0 (routes 8, 10, 11; `DeviceCodeRes`, `DeviceTokenReq`, `TokenRes`, `IdentityStateDTO`, `AccessClaims`, `ProviderId`, `Tier`; `09-backend-contracts-1.1.md` §1 route 10 amendment; `DataPort.identity.deviceCode`, `.link`), C16 1.1.0.
- Decision records: ADR-0018 (publish identity before M14a), ADR-0019, DL-145, DL-189 (`/link` stays isolated; provider redirects land on `/account/*`), DL-207.

## Scope in
- Migration `supabase/migrations/00072_device_codes.sql`. It creates `device_codes` exactly as `09-backend-db.md` §3.7, server-only with RLS and no policies, but only if M13a2's `0007_ugc_forum.sql` lacks it. Read 0007 first. If 0007 already has the table, ship no migration and say so in the PR.
- `services/edge/src/id/device-code.ts` (route 10):
  - `POST /id/device-code` (pub, `RL_AUTH`) returns `DeviceCodeRes`:
    - `device_code`: 32 random bytes, base64url, stored only as its SHA-256;
    - `user_code`: 8 characters from the RFC 8628 base-20 consonant alphabet, shown `XXXX-XXXX`; input is case-insensitive and ignores the hyphen;
    - `verification_uri` = app origin + `/link`; `expires_in` 600; `interval` 5.
  - `POST /id/device-token` (pub) answers RFC 8628 errors as `{error}` with HTTP 400:
    - `authorization_pending` before approval;
    - `slow_down` when polled faster than the current interval, which then grows by 5 s;
    - `access_denied` when the approver gained a `publish_ban` before the exchange;
    - `expired_token` after 600 s or once the code was used.
    - On success it returns `TokenRes`: the CLI JWT (claims as `AccessClaims` with `aud: 'tha-bay-cli'`, `scp: ['mods:publish']`, `tier: 'linked'`, TTL 1 h, no PII) and a refresh token in a new family marked as a CLI family.
  - `POST /id/device-code/approve` (J1) `{user_code}` → 204. It requires tier `linked` (`tier_required`), bracket `18p` (`age_blocked`), no `publish_ban` (`forbidden`), and a live, unused code (`not_found`). There are at most 3 approvals per profile per hour (`rate_limited` with `retryAfterMs`). The approval is written to `audit_log`.
- Route 8: refreshing a CLI family returns CLI-shaped tokens. Reuse revokes the family (M12a1 logic, unchanged).
- Token typing: `AccessClaims` fixes `aud: 'tha-bay'` and types `scp` as `StaffScope[]`, which does not include `'mods:publish'`. The CLI claims are therefore a local type in `services/edge/src/id/cli-claims.ts`. A proposal for an additive C12 type goes in the PR report. The contract is not edited.
- `services/edge/src/id/openai.ts` (route 11, flag `auth.openaiWeb`, default false):
  - `GET /id/openai/start` (J1) returns `{authorizeUrl}` with PKCE S256, `state` and `nonce`. The state record `{pid, verifier, nonce, exp}` sits in KV `FLAGS` under `oidc:<state>` with a 600 s TTL. This is not an atomic switch, and the provider's one-time code bounds replay.
  - `GET /id/openai/callback` (J1; the `/account/callback` page forwards `code` and `state` with `fetch` and the Bearer token, DL-189) exchanges the code at the discovered token endpoint. It verifies the ID token's `iss`, `aud`, `exp` and `nonce` against the issuer's JWKS, links `identities(provider 'openai', subject)` through `DataPort.identity.link`, raises the tier to `linked`, discards the ID token, and returns `IdentityStateDTO`.
  - A subject already linked to another profile → `conflict` (merges arrive with M14a).
  - Flag off, or vars `OPENAI_OIDC_ISSUER`/`OPENAI_OIDC_CLIENT_ID` empty → `feature_disabled`.
- `packages/ui/src/pages/link/` (`/link`, cross-origin isolated, flat-only):
  - not P1 → "Register this device" CTA (M12a2 page);
  - tier `device` → "Link an account to publish", listing the providers in the client's provider registry. The registry is empty until M13c3 adds `openai` behind its flag, so the page reads "Publishing accounts open later";
  - tier `linked` → code field (auto-uppercase, hyphen optional), Approve, then success "Return to your terminal".
  - Error keys: expired, wrong code, rate limit with countdown, banned.
- The Profile page's Account section gains "Approve a device code" → `/link`.
- Hourly cron: delete `device_codes` rows past `expires_at` (retention table, `09-backend-db.md` §7).
- **Provider-ladder spike** (operator, staging): check through the Supabase Management API whether the GitHub provider can be enabled on the staging project beside the registered Third-Party Auth issuer. Record the result. If it works, the link step still needs a server route that C12 1.1 lacks, so the Builder writes a proposal for an additive route and does not build one.

## Scope out
- `dv login`, `dv logout`, `dv mod publish`, the client `openai` adapter and `/account/callback` → M13c3.
- Accepting the CLI token on route 36 → M13c2.
- The `supabase-oauth` (GitHub) link implementation: blocked on the route proposal above. Until then ADR-0018 step 3 applies: publishing works on staging and stays private-to-owner, and public publishing waits for M14a or the proposal.
- Thirdweb SIWE and merges → M14a.

## Deliverables
- `supabase/migrations/00072_device_codes.sql` (conditional, see above); `supabase/tests/server_only.sql` extended with `device_codes`; `packages/shared/src/db.gen.ts` regenerated.
- `services/edge/src/id/{device-code,cli-claims,openai}.ts`; `services/edge/src/data/supabase/device-codes.ts` and the in-memory `DeviceCodeStore`; router rows 10–11; cron hook.
- `services/edge/test/{device-code,device-code-approve,openai-link}.test.ts`; a fake OIDC provider fixture (local ES256 JWKS) in `services/edge/test/fixtures/oidc/`.
- `packages/ui/src/pages/link/{LinkPage,CodeField,ProviderList}.tsx`, Profile page edit, `en` strings, `tests/e2e/link.spec.ts` (`@link`).
- `services/edge/wrangler.jsonc`: vars `OPENAI_OIDC_ISSUER`, `OPENAI_OIDC_CLIENT_ID` (empty), repeated under `previews`.
- `docs/device-runs/M13c1/operator/notes.json` (spike record).
- Secrets: `OPENAI_OIDC_CLIENT_SECRET` only if OpenAI grants a client (owner action; F-060 trial). Absent → route 11 stays `feature_disabled` and tests use the fake provider. `SUPABASE_ACCESS_TOKEN` (M05d) for the spike; absent → the spike prints `SKIP … SUPABASE_ACCESS_TOKEN not set` and is listed under "Blocked on".

## Interfaces
- C12 1.1: routes 10 and 11 as tabled and amended (approve only for `linked`). `DeviceCodeRes`, `DeviceTokenReq` and `TokenRes` are used as typed. RFC 8628 error bodies on the token endpoint, as the contract comment states.
- Proposals (not implemented): a CLI claims type with `aud: 'tha-bay-cli'` and scope `'mods:publish'`; a server route for linking `supabase-oauth`; a feature flag for that provider (ADR-0018 calls it flag-gated, `FeatureFlag` has no member for it).
- No contract change.

## Acceptance criteria
- AC-1 Given a fresh local database When the pgTAP suites run Then `device_codes` exists with RLS on, returns 0 rows to `anon` and `authenticated`, and the generated types have no diff — proof: `pnpm check:db && pnpm check:db:types`
- AC-2 Given a device code When the CLI polls before approval, a `linked` `18p` profile approves the user code, and the CLI polls again after 5 s Then the first poll is `authorization_pending`, approve is 204, and the second poll returns `TokenRes` whose JWT verifies against the JWKS with `aud = 'tha-bay-cli'`, `scp = ['mods:publish']`, `tier = 'linked'`, `exp − iat = 3600` and no email or provider subject; a third exchange of the same code is `expired_token` — proof: `pnpm check:workers -- device-code`
- AC-3 Given a pending code When the CLI polls 2 s after issue and again 8 s after that Then both polls are `slow_down` and the required interval grows from 5 s to 10 s and then 15 s, and a poll 15 s after the last one is `authorization_pending` — proof: `pnpm check:workers -- device-code`
- AC-4 Given a code issued at t and a mocked clock When it is polled and approved at t + 601 s Then the poll is `expired_token` and approve is `not_found`; the stored row holds only the SHA-256 of `device_code`, and `user_code` matches `^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$` — proof: `pnpm check:workers -- device-code`
- AC-5 Given approvers of tier `device`, of bracket other than `18p`, with a `publish_ban`, and a `linked` profile approving its fourth code within one hour When each approves Then the answers are `tier_required`, `age_blocked`, `forbidden` and `rate_limited` with `retryAfterMs` — proof: `pnpm check:workers -- device-code-approve`
- AC-6 Given a CLI refresh token When it is used once and then reused Then the first call returns a new CLI token with `aud = 'tha-bay-cli'` and the reuse revokes the family — proof: `pnpm check:workers -- device-code`
- AC-7 Given `auth.openaiWeb` false When `/id/openai/start` is called Then it is `feature_disabled`; given the flag on and the fake OIDC provider When start and callback run Then `authorizeUrl` carries `code_challenge_method=S256`, `state` and `nonce`, the callback links provider `openai`, the profile's tier becomes `linked`, and no ID token is stored; a callback whose ID token has a wrong `nonce` is `unauthorized` — proof: `pnpm check:workers -- openai-link`
- AC-8 Given a QA build When a `device`-tier profile opens `/link` Then it sees the link explanation and no code field; when a `linked` profile enters the code in lower case without the hyphen and approves Then the request carries the normalized `XXXX-XXXX` code and the success message shows; `crossOriginIsolated` is true on `/link` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @link`
- AC-9 Given the production build When route and secret checks run Then no `/_test/` handler exists and the client bundle has no secret pattern — proof: `pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`
- AC-10 Given the staging Supabase project and `SUPABASE_ACCESS_TOKEN` When the operator runs the provider-ladder spike Then `docs/device-runs/M13c1/operator/notes.json` records U-ADR-01 as pass or fail with the API responses summarized, and the PR report states which ADR-0018 step applies — proof: manual: operator workstation, run the Management API checks listed in Notes, write `notes.json`, commit it
- AC-11 Given this branch's PR When the Preview deploys Then smoke passes and `POST /api/v1/id/device-code` returns a `DeviceCodeRes` — proof: manual: desktop browser and terminal, `curl -X POST <preview-url>/api/v1/id/device-code`; then `pnpm check:smoke -- <preview-url>`

## Test plan
- DB `server_only.sql`; Workers `device-code`, `device-code-approve`, `openai-link` (mocked clock, InMemoryDataPort, fake OIDC provider, KV stub); E2E `@link` with route fixtures; static `pnpm check:prod-routes`, `pnpm check:secrets -- apps/web/dist`; operator spike (AC-10).

## Demo script
1. `pnpm dev`; `curl -X POST localhost:8788/api/v1/id/device-code`; poll `/api/v1/id/device-token`: `authorization_pending`.
2. With a QA `linked` profile, Profile › Approve a device code; enter the code.
3. Poll again; decode the token's `aud` and `scp`.
4. With a `device` profile the page explains linking instead.

## Effort
0.8 session; ≈ 24 files; risk **medium**. RFC 8628 timing rules and the token typing workaround need care.

## Risks & fallbacks
- **OIDC library choice.** `jose` is named by `12-modding-publish.md` C§2 but not pinned in the ledger. Take the resolved version and record it in `spec/03`. If it fails in the Workers runtime, verify ES256 with WebCrypto directly (the issuer code from M12a1 already does).
- **KV state not yet visible at the callback** (eventual consistency): the callback retries the read once after 1 s. If it is still missing → `bad_request` "start again". Route 11 is dark, so this cannot affect players.
- **Spike shows GitHub cannot coexist with TPA**: ADR-0018 step 3 applies (staging and private-to-owner publishing; public publishing at M14a). Record it, and no code changes follow.
- **The CLI-claims typing proposal is rejected**: the local type stays, and route 36 (M13c2) checks `aud` and `scp` by value.

## Notes for the Builder
- Read first: `12-modding-publish.md` C§2; `09-backend-contracts.md` §2.3–§2.5 (identity, rows 8–11, `DeviceCodeRes`); `09-backend-contracts-1.1.md` §1; `spec/05-api-and-realtime.md` §2; ADR-0018, ADR-0019; RFC 8628 §3.2–§3.5 for the polling rules (standard, no vendor fact).
- Spike checks: (1) list the project's Third-Party Auth entries; (2) read the auth config and whether the GitHub external provider can be set on the same project; (3) record both responses (status and relevant fields, no secrets).
- The token endpoint is the one place that answers RFC 8628 `{error}` bodies. Every other route keeps the `ApiError` envelope.
- Never put a provider subject, email or wallet in a token or a log line.
- Branch `m13c1-device-code-publish-login`.

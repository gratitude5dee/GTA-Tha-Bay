# M14a — thirdweb-siwe-link

## Goal
After this session a player can link a Thirdweb in-app wallet to the profile they already have and become tier `linked` (auth phase P3). That one identity can then sign in on a second device, with a merge flow when both devices already hold profiles, and no save, unlock or NPC memory is lost. Thirdweb is one more `ProviderId` behind the single `IdentityService` interface (R-AUTH-02). The SDK is lazy-loaded only on `/account/*`, and nothing outside the new adapter, the SIWE routes and the account page imports it.

It ships migration 0009, routes 12–13, the `thirdweb` adapter with `/account/link`, and the `auth.thirdweb` flag (off in production until the owner approves the Growth plan and the device check passes).

As the last v1 milestone (R-AUTH-02, DL-211), it re-runs the release-gate subset. Once the gate is green and the flag flips, players without GitHub or ChatGPT can publish (ADR-0018 provider ladder).

## Requirements
- R-AUTH-02: Thirdweb is integrated last, as one adapter behind `IdentityService`, in one milestone; a lint keeps the SDK inside the adapter.
- R-AUTH-01: no one needs a wallet to play. P0 and P1 behave as before, and linking never moves or rewrites local saves.

## Depends on
- **M14b3** (launch gate, `release.yml`, `launch-gates.json` with the `auth.thirdweb` flag row).
- **M12a1** (ES256 issuer, register, refresh rotation, `DeviceIdentity`, staff scopes, migration 0005, `/account/*` non-isolated pages, `/account/callback`).
- Contracts: C12 1.1 (`ProviderId` incl. `thirdweb`, `Tier`, `IdentityService.link` / `unlink` / `signInOnNewDevice`, `DataPort.identity.link` returning `'linked' | { mergeRequestId }`, routes 12–13, `AccessClaims` without PII), C05 1.1 (save profiles are kept per identity).

## Scope in
- **Migration `supabase/migrations/0009_link.sql`**, exactly as `09-backend-db.md` §3.8: `merge_requests`, `siwe_nonces`, both server-only with RLS enabled. Add the hourly expiry sweep for `siwe_nonces` (§7 retention) and pgTAP `supabase/tests/{server_only_0009.sql, merge.sql}`.
- **Route 12** (`services/edge/src/id/siwe/`):
  - `POST /id/siwe/nonce` (J1) issues a 5-minute single-use nonce bound to the caller's `profile_id`.
  - `POST /id/siwe/verify` (J1) takes `{message, signature}`. The verifier parses the SIWE message and checks, in order:
    1. `domain` equals the request host and `uri` equals the app origin;
    2. `chainId` is 1 and `version` is `'1'`;
    3. `issuedAt` is within ±5 minutes;
    4. the nonce exists for this profile and is consumed by `DELETE … RETURNING`;
    5. the signature recovers to the message's address. EOA only: no ERC-1271 contract wallets and no RPC call.
  - The statement reads "Link this wallet to your {shortName} profile", with `BRAND.shortName`.
  - On success `DataPort.identity.link(ctx, 'thirdweb', address)` runs:
    - `linked` → the caller's tier becomes `linked` and the response is the new `IdentityStateDTO` with fresh tokens;
    - if the address already belongs to another profile → `{ mergeRequestId }`.
  - The address is stored only in `identities` (server-only), never in a token, log, telemetry or response.
- **Route 13**:
  - `POST /id/merge` ⓘ `{ mergeRequestId, keep: 'current' | 'linked' }` accepts a merge for a request that the caller's own verified signature opened.
  - `GET /id/merge/:id` returns the status and a conflicts preview (save-profile name collisions, both unlock sets, relationship counts, wallet sums).
  - The merge applies the §3.8 rule in one transaction (`merge_profiles` SQL function):
    - save profiles from both sides are kept, renamed on collision as `<name> (2)`;
    - `unlocks` are unioned;
    - `npc_relationship` keeps the higher `encounters`;
    - `progress_wallet` sums;
    - the losing profile is tombstoned and its device keys move to the survivor.
  - Requests expire after 24 h.
  - Body types `SiweNonceRes`, `SiweVerifyReq`, `SiweVerifyRes`, `MergeReq`, `MergeStatus` go into `v1.ts` (C12 §2.5 "remainder" rule; no existing shape changes; `check:api` regenerates schemas).
  - With flag `auth.thirdweb` off, routes 12–13 answer `feature_disabled` (spec/05 §3).
- **Client adapter** `packages/identity/src/thirdweb/`:
  - `adapter.ts`: `link('thirdweb')` and `signInOnNewDevice('thirdweb')`, through `inAppWallet({auth:{options:['email','passkey','google','apple']}})` with no `guest` and EIP-7702 or plain EOA mode, as in the recipe of [research/auth-ugc-input-maps.md §2.1, §2.4].
  - `siwe-message.ts` builds the message with the SIWE helper named in that recipe.
  - The SDK is a dynamic import, reachable only from the `/account/*` entry.
  - The client id is the public build variable `VITE_THIRDWEB_CLIENT_ID`; when absent the adapter reports `unavailable`.
  - `unlink('thirdweb')` follows C12 (refused only if it would orphan the profile); without another linked provider the tier drops to `device`.
- **QA wallet**: with `VITE_DV_QA=1` and `?wallet=stub` the adapter signs with a deterministic local key, so tests never load Thirdweb or touch the network; production builds drop it.
- **Account page** `/account/link` (S10, flat-only, non-isolated):
  - a "Link a wallet" explainer (no token economy, no purchases; non-goals in 06 §3);
  - method buttons, progress and the result with the new tier chip;
  - the merge dialog showing the conflicts preview and a "keep which profile" choice;
  - before the full-page redirect, the `save.request{reason:'manual'}` rule of `10-ui.md` §2.5 applies.
- **CSP on `/account/*`**: stays Report-Only (M14b2); the Thirdweb origins seen in the device run go into `config/csp-account.json` and the account policy.
- **Isolation lint**: `no-restricted-imports` bans `thirdweb` and `thirdweb/*` everywhere except `packages/identity/src/thirdweb/**` and the account entry. `check:bundle` asserts that no main-app chunk contains the SDK.
- **Release subset re-run**: launch-gate check (`auth.thirdweb` row), `test:ops -- --suite guardrails`, `check:secrets -- apps/web/dist`, `license:scan` (Apache-2.0 SDK).

## Scope out
- Gas sponsorship, smart-account contracts, any token or purchase (non-goals); a passkey-only sign-in without a wallet.
- Supabase `signInWithWeb3` (research fallback, unused).
- Bay expansion → M15a.

## Deliverables
- `supabase/migrations/0009_link.sql`, `supabase/tests/{server_only_0009.sql, merge.sql}`, `packages/shared/src/db.gen.ts` (regenerated).
- `services/edge/src/id/siwe/{nonce.ts, verify.ts, merge.ts, index.ts}`, the router and DataPort edits (`identity.link`, `merge`), `services/edge/test/{siwe-link.test.ts, siwe-merge.test.ts}`.
- `packages/shared/src/api/v1.ts` (new route-12/13 body types only).
- `packages/identity/src/thirdweb/{adapter.ts, siwe-message.ts, stub-wallet.ts, index.ts}`, `packages/identity/test/thirdweb.spec.ts`.
- `packages/ui/src/pages/account/link/{LinkPage.tsx, MergeDialog.tsx}`, `en.json` keys, `tests/e2e/account-link.spec.ts` (`@account-link`).
- `config/csp-account.json`, `apps/web/public/_headers` (account rules), `eslint.config.js` (restricted imports), `tools/ci/check-dist.ts` (bundle rule), `docs/legal/launch-gates.json` (the `auth.thirdweb` row), `tools/ci/checklists/M14a-{iphone15,mac}.json`.
- Dependencies: `thirdweb@5.122.0` (F-059); the SIWE helper package that the research recipe names, at whatever version pnpm resolves, recorded in `spec/03`.
- ≈ 30 files.

## Interfaces
- C12 1.1 as frozen: `ProviderId 'thirdweb'`, `IdentityService`, `DataPort.identity.link`, routes 12–13. The route body types are added under C12 §2.5's "remainder" rule; nothing existing changes.
- C05 1.1: save profiles are untouched by linking. Merge keeps both sides (C05 `ProfileId`, ≤ 64 per identity; over 64 → `conflict`, the player deletes first).
- No contract change.

## Acceptance criteria
- AC-1 Given a P1 profile and the stub wallet When it requests a nonce, signs, and verifies twice with the same nonce Then the first verify returns tier `linked` with `prv` containing `thirdweb`, and the second returns `bad_request` (nonce consumed); a nonce older than 5 minutes, a wrong `domain`, a wrong `chainId` and a signature from another key are each refused — proof: `pnpm check:workers -- siwe-link`
- AC-2 Given a P1 profile with 3 save profiles, 5 unlocks, 2 NPC relationships and a wallet balance When it links Then every one of those rows is unchanged after the link, the access JWT carries no address (decoded claims scanned for `0x` + 40 hex), and no response body or log line in the test contains the address — proof: `pnpm check:workers -- siwe-link`
- AC-3 Given profile A already linked to an address and profile B on a second device When B verifies a signature from that address Then the response is `{ mergeRequestId }`; `GET /id/merge/:id` previews the collisions; `POST /id/merge` with `keep: 'linked'` leaves A with both sides' save profiles (collision renamed), the union of unlocks, the higher `encounters` per NPC and the summed wallet, with B tombstoned and B's device key accepted for A. A replay of the same `Idempotency-Key` returns the same result — proof: `pnpm check:workers -- siwe-merge && pnpm check:db`
- AC-4 Given migration 0009 When the DB checks run Then `merge_requests` and `siwe_nonces` return 0 rows to `anon` and `authenticated`, `merge_profiles` passes the fixture in `merge.sql`, and the generated types match — proof: `pnpm check:db && pnpm check:db:types`
- AC-5 Given flag `auth.thirdweb` false When routes 12 and 13 are called Then they answer `feature_disabled` (404), and `/account/link` shows "not available yet" — proof: `pnpm check:workers -- siwe-link`
- AC-6 Given a QA build with `?wallet=stub` When the player opens `/account/link`, links, then opens a second browser context holding another linked profile and accepts the merge Then the tier chip reads Linked, the merge dialog lists the collisions, and after the merge the second context shows the surviving profile's save list — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @account-link`
- AC-7 Given the repository When lint and the bundle check run Then any import of `thirdweb` outside `packages/identity/src/thirdweb/**` and the account entry is an error (a fixture file proves it), and no chunk loaded by `/` contains the SDK — proof: `pnpm lint && pnpm check:unit -- tools/ci && pnpm check:bundle`
- AC-8 Given the identity package When its unit tests run Then `unlink('thirdweb')` on a profile whose only linked provider is `thirdweb` returns tier `device` (the device key keeps the profile reachable), `link` without `VITE_THIRDWEB_CLIENT_ID` reports `unavailable`, and the stub wallet is absent from a production build (`VITE_DV_QA` unset) — proof: `pnpm check:unit -- packages/identity && pnpm build && pnpm check:secrets -- apps/web/dist`
- AC-9 Given the M14b3 record with the `auth.thirdweb` row When the release subset runs Then the launch-gate completeness check, the guardrails suite (SKIP without staging secrets) and `license:scan` pass — proof: `pnpm check:unit -- tools/ci && pnpm test:ops -- --suite guardrails && pnpm license:scan`
- AC-10 Given the Growth plan approved by the owner, a real client id on staging, an iPhone 15 Home Screen app and Safari on a Mac When the operator links with email and with passkey on each Then the link completes, the tier chip reads Linked, and the run records U-BE-16 (full-page redirect inside the Home Screen app) and the Thirdweb origins seen by the account CSP — proof: manual: iPhone 15 and Mac, run `tools/ci/checklists/M14a-iphone15.json` and `M14a-mac.json`, upload `docs/device-runs/M14a/<device>/notes.json`
- AC-11 Given the branch When unit tests and the preview deploy run Then both pass and the deployed app works without any wallet — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- Workers: `siwe-link`, `siwe-merge` (InMemoryDataPort plus the stub wallet; fake clock for nonce expiry).
- DB: `merge.sql`, `server_only_0009.sql` (`pnpm check:db`), types diff (`pnpm check:db:types`).
- Unit: `packages/identity` (adapter rules), `tools/ci` (lint fixture, launch-gate record).
- E2E: `@account-link` on `chromium-webgl2` with the stub wallet; `@offline` and `@ui-menus` stay green (single-player needs no account).
- Device: AC-10 (records only).

## Demo script
1. `pnpm dev`; open `/account/link?wallet=stub`; link; the chip shows Linked.
2. In a second browser profile, register, link the same stub wallet, accept the merge; both profiles' saves are listed.
3. Add `import 'thirdweb'` in `packages/ui`; `pnpm lint` errors; remove it.

## Effort
1 session; ≈ 30 files; risk **medium** (merge transaction; SDK redirects).

## Risks & fallbacks
- **The SIWE helper's verify needs an RPC client.** Verify EOA signatures with the same library's local signature recovery (read its exports in `node_modules`), and record the function used. Never call an RPC endpoint.
- **Redirect sign-in fails inside the iOS Home Screen app** (U-BE-16). Offer email OTP and passkey first (no redirect), hide the social buttons when `display-mode: standalone`, and record it.
- **The Growth plan is not approved.** Everything except AC-10 runs with the stub. `auth.thirdweb` stays false and `launch-gates.json` shows the row `pending`; report it as "Blocked on: owner Growth plan (F-059)".
- **The SDK pulls in Node built-ins or exceeds the account chunk budget.** Keep it in its own lazy chunk and record the size; the main entry budget is unaffected (AC-7).

## Notes for the Builder
- Earlier deliverables used as they stand: M13c1 (`/link`, the `linked` tier rule, ADR-0018), M05d (`db:push`, `check:db`, `check:db:types`), M14b1 (`test:ops -- --suite guardrails`).
- Read first: `09-backend-contracts.md` §2.3–§2.5 (identity, routes 12–13, `IdentityStateDTO`); `09-backend-db.md` §3.8, §7; `spec/05-api-and-realtime.md` §2 (P3 row, provider redirects via `/account/callback`); `research/auth-ugc-input-maps.md` §2.1–§2.4; ADR-0009, ADR-0018.
- Facts: F-059 (`thirdweb` 5.122.0, Growth $99/month). Recorded only: U-BE-16, Thirdweb origins, a free Starter plan.
- Secrets: none new on the server (SIWE verification is local); public build variable `VITE_THIRDWEB_CLIENT_ID`; `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` for `db:push`. Paid account: Thirdweb Growth (owner approval before AC-10 and the flag flip).
- No wallet address, email or provider subject in any token, telemetry or log (ADR-0009). Branch `m14a-thirdweb-siwe-link`.

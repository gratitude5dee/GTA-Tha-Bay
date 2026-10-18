# ADR-0009 — Identity spine and auth phases

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-03 and D-04; R-AUTH-01, R-AUTH-02; contract C12

## Context
v1 launches with no sign-in (R-AUTH-01), yet quotas, NPC memory, cloud saves, publishing and rooms need an identity that survives across phases and across providers (device, ChatGPT, Thirdweb). Several systems must trust one token: Durable Objects, Supabase and, if ever switched, Convex. Thirdweb must be integrated last and behind one interface (R-AUTH-02).

## Options considered
1. **Supabase anonymous sign-in as the spine** (the backend report's first choice). Anonymous sign-ins are rate-limited to 30 per hour per IP and are never cleaned up; linking an anonymous user to a Web3 identity is unverified [F-030; research/auth-ugc-input-maps.md §1].
2. **Provider-first** (identity is the ChatGPT or wallet account). Breaks "never required to play" (R-AUTH-03) and ties the profile to a vendor.
3. **A Worker-hosted OIDC issuer with a device-minted profile id** (chosen). Supabase accepts third-party OIDC tokens with `kid` and `role` [F-031]; Convex accepts RS256 or ES256 `customJwt` [F-033].

## Decision
- **Issuer.** `https://id.<domain>` on `tha-bay-web` (Q-BE-01) signs ES256 JWTs with `kid`. Claims: `iss`, `sub = profile_id` (UUIDv7 minted on device at first launch, never a provider subject), `aud: 'tha-bay'`, `role: 'authenticated'`, `tier`, `prv[]`, `ab` (age bracket), staff `scp?`, `jti`, TTL 1 h. No email, wallet address or provider subject appears in any token. Two signing keys (`ID_SIGNING_JWK_CURRENT`, `_NEXT`) are always published; promotion waits ≥ 30 min because Supabase refreshes keys on that cadence. Refresh secrets are opaque, hashed, rotated on every use, with the family revoked on reuse.
- **Phases (D-04).**
  - **P0 `local`** (M00–M11): device-bound profile plus an HMAC play token (`Authorization: PlayToken pt1.…`, 24 h) for quota and rate-limit identity only. The client holds a non-extractable ECDSA P-256 key in IndexedDB `dv-identity` and proves possession when asking for a token; the first server write binds the thumbprint (trust on first use).
  - **P1 `device`** (M12a1): registration with Turnstile (verification API UNVERIFIED, U-BE-2; fallback is per-network registration caps), ES256 JWT, cloud saves.
  - **P2 `linked`** (M13c): ChatGPT or OpenAI linkage behind a flag, or a Supabase GitHub OAuth identity, solely to enable publishing (ADR-0018, ADR-0019).
  - **P3 `linked`** (M14a): Thirdweb in-app wallet via SIWE link; no `guest`, no ERC-4337; only after the Growth plan ($99/month) is paid [F-059].
- **One interface.** `IdentityService` (`current`, `authHeader`, `register`, `link`, `unlink`, `signInOnNewDevice`, `forget`, `onChange`) is typed in `packages/shared/src/identity.ts`; `@dv/identity` holds the client adapters `local`, `device`, `openai`, `thirdweb`. Adding Thirdweb is one milestone.
- **Fallback.** Supabase anonymous sign-in remains the documented fallback if the issuer path fails Third-Party Auth registration (`pnpm auth:tpa`, via the Management API; the setting is not in the CLI config [F-031]).
- **Age.** Only bracket `18p` may use online features; the token carries `age: '18p'` (ADR-0014).

## Consequences
- (+) One JWT for DOs, Supabase RLS and any later backend; a provider change never changes `sub`.
- (+) Single-player has no account and no network dependency.
- (−) We run an issuer: key rotation, JWKS caching and clock handling are ours; the M12a1 tests cover refresh reuse, rotation and a Supabase RLS check with our token.
- (−) P0 data is claimable only by the device key; losing the device loses the profile until P1 registration.
- (−) Full-page redirects for provider sign-in inside an iOS Home Screen app are UNVERIFIED (U-BE-16); the device-code flow is first.

## Affected contracts and milestones
C12 (`IdentityService`, `AccessClaims`, `PlayTokenClaims`, identity routes incl. 10 and 11), C05 (`ProfileId` is separate from the identity profile id, DL-044). M04b3 (`LocalIdentity`), M06a1 (play token verify, quotas), M12a1 (issuer, TPA, register), M13c1 (device code), M14a (Thirdweb).

## Links
`research/INDEX.md` §1.3–1.4; `research/auth-ugc-input-maps.md` §1–2; `spec/domains/09-backend-contracts.md` §2.3; `spec/11-decision-log.md` DL-044, DL-055, DL-075; ADR-0008, ADR-0014, ADR-0018, ADR-0019.

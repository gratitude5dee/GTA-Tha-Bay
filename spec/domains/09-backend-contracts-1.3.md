# 09 — Backend contracts, part 1d: C12 1.3 additions (owner password accounts)

> Architect, 2026-10-19 (`spec/11-decision-log-5c.md` DL-604; proposal DL-516 accepted). Part of `spec/domains/09-backend.md`; extends `09-backend-contracts.md` (1.0), `09-backend-contracts-1.1.md` (1.1) and `09-backend-contracts-1.2.md` (1.2), which stay valid as written. Owner of every shape below: **S09**; semantics: ADR-ACCT-01 and `spec/05-api-and-realtime.md` §3 (routes 58–66). Rule (06 §4.1): additive change = minor bump. **C12 → 1.3.0**; C11 and C16 unchanged. Requirements: R-AUTH-01, R-IP-04, R-IP-01.

## 1. C12 1.3 — routes

The route table is now **#1–66**. Routes 58–63 are the owner-merged PR #1 (DL-OWN-04), 64–66 its conformance (M00e); paths stay as merged.

| # | Method & path | Auth | Request → response | Milestone |
|---|---|---|---|---|
| 58 | `POST /api/v1/auth/signup` | pub | `SignupReq` → `PasswordSignInRes` | owner PR #1; M00e; M12a1 (exchange) |
| 59 | `POST /api/v1/auth/login` | pub | `LoginReq` → `PasswordSignInRes`; `forbidden` with `TermsRequiredDetails` | owner PR #1; M00e; M12a1 |
| 60 | `POST /api/v1/auth/refresh` | cookie `dv-rt` | no body → `PasswordSessionRes`; `forbidden` with `TermsRequiredDetails` (record readable and missing or stale) | owner PR #1; M00e |
| 61 | `POST /api/v1/auth/logout` | SB | → `LogoutRes` | owner PR #1; M00e |
| 62 | `GET /api/v1/auth/me` | SB | → `PasswordMeRes` | owner PR #1; M00e |
| 63 | `GET /api/v1/genai/status` | pub | module type of `services/edge` (staging and previews only; `not_found` in production) | owner PR #1; M00e |
| 64 | `DELETE /api/v1/auth/me` | SB, geo-exempt (DL-613) | → 204 | M00e |
| 65 | `GET /api/v1/auth/me/export` | SB, geo-exempt (DL-613) | → `PasswordExportRes`; `forbidden` with `TermsRequiredDetails` without a current `18p` record (DL-639) | M00e |
| 66 | `GET /api/v1/legal/:doc` (`terms`, `privacy`) | pub, geo-exempt | → `LegalDocRes` (module type, `packages/shared/src/api/legal.ts`; not a C12 shape, the DL-241 rule) | M00e |

From M12a1 (exchange, AC-15) routes 61, 62, 64 and 65 accept our JWT for a profile with a password `identities` row instead of `SB`, route 60 answers `feature_disabled` (route 8 refreshes) and routes 58–59 answer `TokenRes`.

## 2. C12 1.3 — types

```ts
// packages/shared/src/identity.ts
export type ProviderId = 'device' | 'openai' | 'thirdweb' | 'supabase-oauth' | 'password';   // 1.3: 'password' (ADR-ACCT-01); never grants 'linked'

// packages/shared/src/api/v1.ts
export type FeatureFlag = /* 1.0 and 1.1 members */ | 'auth.password';
//   1.3: true exactly when route 58 accepts a sign-up (Worker var AUTH_PASSWORD_SIGNUP 'on', LEGAL_CONTACT set, Supabase vars and the admin path present);
//   set by GET /boot whatever FLAGS_JSON says; sign-in does not depend on it (DL-601)

export interface PasswordUser { id: string /* Supabase user id */; username: string /* ^[a-z0-9_]{3,20}$ */ }
export interface PasswordSession { accessToken: string /* SB */; expiresIn: number /* seconds */ }   // the refresh token travels only in the HttpOnly cookie dv-rt
export interface SignupReq { username: string; password: string /* 8–256 chars */; ageBracket: AgeBracket; termsVersion: string }   // route 58
export interface LoginReq { username: string; password: string; ageBracket?: AgeBracket; termsVersion?: string }                 // route 59; the optional pair is the re-acceptance
export interface PasswordSessionRes { user: PasswordUser; session: PasswordSession }                                             // routes 58–60 before M12a1
export type PasswordSignInRes = PasswordSessionRes | TokenRes;                                                                     // routes 58–59; TokenRes from M12a1 (discriminate on 'session' in res)
export interface LogoutRes { ok: true }                                                                                            // route 61
export interface PasswordMeRes { user: PasswordUser }                                                                              // route 62
export interface PasswordExportRes { username: string; ageBracket: '18p'; termsVersion: string; acceptedAt: number; createdAt: number }   // route 65; epoch ms
export interface TermsRequiredDetails { reason: 'terms_required'; termsVersion: string }                                         // ApiError.error.details of a 403 'forbidden' on routes 59, 60 and 65
```

Rules: `ab`, `termsVersion` and `acceptedAt` live only in Supabase app-level metadata written by the Worker's admin path, never in user-writable metadata (U-ACCT-6). No DTO carries a username to anyone but its owner; a public username display is not part of 1.3 and needs its own proposal. `TERMS_VERSION` is a constant in `config/terms.ts` (DL-602), not a C12 member.

## 3. Database
No migration in 1.3. If a migration constrains `identities.provider` to the C12 values, the milestone that links password accounts (M12a1) adds `'password'` in its own migration.

## 4. Version constant
M00e adds the 1.3 members without changing `C12_VERSION`, so the constant never goes down; M12c1, which sets it under `09-backend-contracts-1.2.md` §4, sets `C12_VERSION = '1.3.0'` instead of `'1.2.0'` (the 1.3 members are present by then). Milestones written against 1.1 or 1.2 stay valid (C15 L6, DL-227).

# ADR-ACCT-01 — Owner password accounts (Supabase Auth through the Worker)

**Status:** accepted (owner decision, DL-OWN-04) · **Date:** 2026-10-19 · **Decides:** spec/03 D-32; DL-510…DL-517, DL-600…DL-604, DL-612, DL-613, DL-624, DL-635, DL-636, DL-639, DL-643; amends the timing in D-02 and D-04, not the D-03 spine

## Context
The owner merged PR #1 (merge `d853294` on `claude/build`, Architect observation 2026-10-19): username and password accounts on Supabase Auth, proxied by `tha-bay-web` (routes 58–62, `spec/05-api-and-realtime.md` §3), a fal status route (63) and an `/account` page in the SPA, with the session in `localStorage`. Project `tha-bay` (`us-west-1`) and both Workers are live.

The spec had no password accounts: our OIDC issuer is the spine (D-03) with phases P0 → P3 (D-04); Supabase arrives at M05d (D-02); only `18p` gets a token (D-30); `/account/*` alone is non-isolated (D-01). Supabase Auth users get the Postgres role `authenticated`, and access tokens are verifiable against the project JWKS [research/stack-cloudflare-backend.md §2 "Auth"]; `SUPABASE_ANON_KEY` holds an `sb_publishable_` key [F-032].

## Options considered
1. **Revert the PR.** Not available (owner decision).
2. **Password accounts as the spine.** Breaks D-03: DOs and RLS would trust two issuers, and single-player gains an account dependency (R-AUTH-03).
3. **A new tier.** `Tier` is a frozen C12 shape.
4. **An early credential beside the spine (chosen).** Supabase Auth checks the password; the profile, tier and every game-facing token stay ours.

## Decision
- **What it is.** A *sign-in credential*, not a phase or tier. It never grants `linked` and never replaces the P0 device key.
- **Interim stop, production sign-up only (Q-43, DL-601).** No Supabase var is removed; sign-in, refresh, logout and `me` keep working everywhere. The Worker var `AUTH_PASSWORD_SIGNUP` (M00e) is `off` in production until M00e's checks are live there, `on` in staging; previews get no Supabase vars. No publishable-key rotation (DL-600): the key is public by design.
- **Before M12a1.** The Supabase access token is accepted only by routes 61, 62, 64 and 65 (auth code `SB`); no other route, DO or table treats it as an identity, and no game data is attached.
- **At M12a1.** A password sign-in is exchanged server-side for our `TokenRes` (tier `device`), linking the `identities` row to the device's `profile_id`; `SB` then opens nothing. C12 1.3 (DL-604) lands in M00e, so M12a1 AC-15 has one branch.
- **Age and terms (D-30, DL-602).** `TERMS_VERSION` has one owner, `config/terms.ts` (M00e, with an interim Terms and Privacy document on route 66; M04b1 and M13d2 replace the content). Sign-up requires `18p` and the current `TERMS_VERSION`; the record is app-level metadata written only by the Worker's admin path (U-ACCT-6). Sign-in re-asks whenever the record is missing or stale; an under-18 answer there deletes the account (DL-612).
- **Storage and isolation.** The Supabase refresh token travels only in the `HttpOnly` cookie `dv-rt`; from M12a1 our `TokenRes` refresh token follows the P1 rules (`09-backend-contracts.md` §2.3; M12a1 `token-store.ts`; DL-624). Access token in memory only. The account page is the non-isolated `/account/` island (no game bundle).
- **Deletion and export.** Routes 64 and 65 (geo-exempt) use the Worker's admin path; until it is recorded as verified, the runbook's manual steps, reached through the operator contact in the privacy document, are the paths (DL-613). After the M12a1 link, `DELETE /me` and `/me/export` cover the account. Supabase Auth joins the M13d2 processor list.
- **Keys.** Worker vars only; the browser never calls `*.supabase.co`.
- **Projects.** `tha-bay` serves production and, until M05d, staging (DL-603, RISK-28); M05d moves staging and previews to `tha-bay-staging`.
- **Conformance work:** milestone M00e `owner-account-hardening` (formerly the owner PR #1 follow-up list, DL-605).

## Consequences
- (+) Cross-device sign-in arrives before M14a; spine, RLS model and phase gates unchanged.
- (−) Supabase Auth is live before M05d, and the project hosts two kinds of `authenticated` users. Supabase-native users are denied because their `sub` matches no `profiles` row and `app.tier()` is null (M05d AC-12, DL-515).
- (−) While public sign-up is open, a direct Supabase call skips the Worker's checks (U-ACCT-3). Accepted risk (RISK-27, DL-600): the Worker issues such an account no session until it attests, and its own Supabase token opens only routes 61, 62, 64 and 65, which hold no game data (DL-639); once U-ACCT-3 is recorded in `spec/03` §7, the Worker creates users with `SUPABASE_SECRET_KEY` and the operator turns public sign-up off.
- (−) No email, so no recovery; Supabase sees only Cloudflare addresses (U-ACCT-4), so the Worker's `auth` class is the real limit; usernames are user text and pass the names gate.

## Affected contracts and milestones
C12 1.3 (accepted, DL-604; lands in M00e). M00e (all of it); M06a1 AC-13, M12a1 AC-15 (single branch); M05d AC-12; M04b1 and M13d2 Notes (terms content); others Notes: M12a2, M13b1, M14a (edits logged in DL-518, DL-602, DL-604).

## Links
`spec/05-api-and-realtime.md` §2–§3, §5; `spec/11-decision-log-5b.md` DL-OWN-04, DL-510…DL-524; `spec/11-decision-log-5c.md` DL-600…DL-606, DL-610…DL-626; `spec/99-open-questions-2.md` Q-42, Q-43, U-ACCT-1…U-ACCT-7; ADR-0008, ADR-0009, ADR-0014, ADR-0018, ADR-0020.

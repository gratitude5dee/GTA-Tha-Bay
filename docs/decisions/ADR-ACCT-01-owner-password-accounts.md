# ADR-ACCT-01 — Owner password accounts (Supabase Auth through the Worker)

**Status:** accepted (owner decision, DL-OWN-04) · **Date:** 2026-10-19 · **Decides:** spec/03 D-32; DL-510…DL-517; amends the timing in D-02 and D-04, not the D-03 spine

## Context
The owner merged PR #1 (merge `d853294` on `claude/build`, Architect observation 2026-10-19): username and password sign-up and sign-in on Supabase Auth, proxied by `tha-bay-web` (routes 58–62, `spec/05-api-and-realtime.md` §3), a fal status route (63) and an `/account` page in the SPA. Usernames map to `u_<username>@player.tha-bay.test`; the browser keeps the Supabase session in `localStorage['dv-session']`. Supabase project `tha-bay` (ref `jwvvllhxuvwkrynmnchb`, `us-west-1`) and both Workers are live.

The spec had no password accounts: our OIDC issuer is the spine (D-03) with phases P0 → P3 (D-04); Supabase arrives at M05d (D-02); only `18p` gets a token (D-30); `/account/*` alone is non-isolated (D-01). Supabase Auth users get the Postgres role `authenticated`, and new projects sign access tokens with asymmetric keys a Worker can verify against the project JWKS [research/stack-cloudflare-backend.md §2 "Auth"]. The merged var `SUPABASE_ANON_KEY` holds an `sb_publishable_` key [F-032; research/stack-cloudflare-backend.md §2 "Keys"].

## Options considered
1. **Revert the PR.** Not available (owner decision).
2. **Password accounts as the spine.** Breaks D-03: DOs and RLS would trust two issuers, and single-player gains an account dependency (R-AUTH-03).
3. **A new tier.** `Tier` is a frozen C12 shape.
4. **An early credential beside the spine (chosen).** Supabase Auth checks the password; the profile, tier and every game-facing token stay ours.

## Decision
- **What it is.** A *sign-in credential*, not a phase or tier. It never grants `linked` and never replaces the P0 device key.
- **Interim stop (now; Q-43, default applied).** The merged routes break D-30 and R-IP-04. The operator removes the Supabase vars from prod, staging and previews (routes 58–62 answer `feature_disabled`). Because the publishable key is committed and works without the Worker, the operator also turns off new-user sign-up on `tha-bay` and rotates the publishable key now (UNVERIFIED dashboard actions, U-ACCT-7); until U-ACCT-3 is verified, a recurring purge deletes every user without the Worker-written `ab: '18p'` and `termsVersion` (counts only). The follow-up PR restores production with `AUTH_PASSWORD=off` only with sign-up closed or the purge running; sequence and switch states in DL-514 and `spec/followups/owner-pr1.md`.
- **Before M12a1.** The Supabase access token is accepted only by routes 61, 62 and 64 (auth code `SB`); no other route, DO or table treats it as an identity, and no game data is attached.
- **At M12a1.** A password sign-in is exchanged server-side: the Worker verifies the Supabase token (JWKS, no network), links the `identities` row to the device's `profile_id`, and answers our `TokenRes` (tier `device`); `SB` then opens nothing and Supabase tokens never leave the Worker. This needs C12 1.3 (`ProviderId` `'password'`, flag `auth.password`; DL-516), which M12a1's first step lands in `v1.ts` once 06 lists it (DL-524); until accepted the credential stays standalone (M12a1 Notes).
- **Age and terms (D-30).** Sign-up requires `ageBracket === '18p'` (else `age_blocked`) and `termsVersion === TERMS_VERSION` (missing, empty or stale → `bad_request`), both before any upstream call; until M04b1 provides `TERMS_VERSION`, route 58 answers `feature_disabled` (DL-520). `ab`, `termsVersion` and `acceptedAt` are app-level metadata written only by the Worker's admin call, never user-writable sign-up data (U-ACCT-6); sign-in refuses an account without them (`age_blocked`, no token).
- **Storage and isolation.** Refresh token in the `HttpOnly; Secure; SameSite=Strict` cookie `dv-rt` scoped to `/api/v1/auth`; access token in memory only (DL-514). The account page is a non-isolated island at `/account/` (the M12a2 pattern, no game bundle) and returns to `/` with a full navigation.
- **Deletion and export.** Route 64 `DELETE /auth/me` deletes the Supabase user server-side; while it is `feature_disabled` the operator deletes on request (runbook). Access and export: until `/me/export` covers password accounts, the runbook's manual access step (the operator returns the username, `ab`, `termsVersion` and `acceptedAt` to a verified requester and records counts only; DL-524) is the access path. Only after the M12a1 link do `DELETE /me` and `/me/export` cover the password account. Supabase Auth joins the M13d2 processor list.
- **Keys.** Worker vars only; the browser never calls `*.supabase.co`, and the bundle holds neither the project ref nor a key (M05d AC-10).
- **Projects.** `tha-bay` is production (G1 region); the operator creates `tha-bay-staging` for M05d (DL-512).
- **Conformance work:** `spec/followups/owner-pr1.md` (one Builder session).

## Consequences
- (+) Cross-device sign-in arrives before M14a; spine, RLS model and phase gates unchanged.
- (−) Supabase Auth is live before M05d, and the project hosts two kinds of `authenticated` users. Supabase-native users are denied because their `sub` matches no `profiles` row and `app.tier()` is null (M05d AC-12, DL-515).
- (−) While public sign-up is open, anyone holding a valid publishable key can call Supabase Auth directly and skip the Worker's checks (U-ACCT-3); hence sign-up off, key rotation and the purge.
- (−) No email, so no recovery; Supabase sees only Cloudflare addresses (U-ACCT-4), so the Worker's `auth` class is the real limit; usernames are user text and pass the names gate.

## Affected contracts and milestones
C12 (proposal only, DL-516). M06a1 AC-13, M12a1 AC-15, M04b1 AC-15 (DL-520); M05d AC-12; others Notes: M12a2, M13b1, M13d2, M14a (edits logged in DL-518).

## Links
`spec/05-api-and-realtime.md` §2–§3, §5; `spec/11-decision-log-5.md` DL-OWN-04, DL-510…DL-517; `spec/99-open-questions-2.md` Q-42, Q-43, U-ACCT-1…U-ACCT-7; ADR-0008, ADR-0009, ADR-0014, ADR-0018, ADR-0020.

# Runbook: Supabase Auth for the password accounts (M00e)

Scope: the username and password accounts of routes 58-62, 64 and 65 (ADR-ACCT-01). The Worker `tha-bay-web` talks to the Supabase project `tha-bay` (ref `jwvvllhxuvwkrynmnchb`, `us-west-1`); the browser never does. Nothing here is a Builder action: the owner or the operator runs these steps.

## Names

| Item | Where | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Worker vars in `services/edge/wrangler.jsonc` | Public by design (publishable key). Previews carry neither. |
| `SUPABASE_SECRET_KEY` | Worker secret (`wrangler secret put SUPABASE_SECRET_KEY` or `--secrets-file`) | The admin path. Absent: sign-up, delete and export answer `feature_disabled`; sign-in keeps working. Never in a client bundle. |
| `AUTH_PASSWORD_SIGNUP` | Worker var, `"off"` in production, `"on"` in staging | Only the exact value `on` opens sign-up. Sign-in, refresh, logout and `me` do not depend on it. |
| `LEGAL_CONTACT` | Worker var, operator-supplied, not a secret | Route 58 stays `feature_disabled` without it. Printed in the privacy document. |
| `QUOTA_NET_SALT_SECRET` | Worker secret, optional | Salts the daily hash of the rate-limit keys. |
| `RL_AUTH`, `RL_AUTH_USER` | Rate Limiting bindings | 10 per minute per network, 5 per minute per username on sign-in. |

## 1. Before the first staging deploy of this milestone

1. Create `main` from `claude/build` and make it the default branch (Q-42).
2. Set `LEGAL_CONTACT` in the `env.staging` vars (a contact address or URL for deletion and access requests).
3. Put the secret in place for staging: `wrangler secret put SUPABASE_SECRET_KEY --env staging` (a `sb_secret_...` key from the project's API keys page).

## 2. Check staging, then deploy production

On staging, with `AUTH_PASSWORD_SIGNUP` `on`:

1. Sign-up with `ageBracket` `13_15` answers 403 `age_blocked`; with a stale `termsVersion` answers 400.
2. An adult sign-up on `/account/` creates the user; in the Supabase dashboard the user's app metadata shows `ab`, `termsVersion`, `acceptedAt` and the user metadata shows only the username.
3. An 11th sign-in within a minute from one network answers 429.
4. `Delete account` removes the user; `Show my data` returns the stored record.
5. Check that the admin create call still works with public sign-up switched off (see section 4) before you rely on it.

Then deploy production by tag or `workflow_dispatch` (never from a feature branch).

## 3. Turn production sign-up on

Needs all of: `LEGAL_CONTACT` in the top-level vars, `SUPABASE_SECRET_KEY` as a production secret, the owner's approval of `content/legal/{terms,privacy}.json` at the current `TERMS_VERSION`, and the section 2 checks passing. Change `AUTH_PASSWORD_SIGNUP` to `"on"` in the top-level vars by a one-line PR to `main`; the PR quotes the approval.

## 4. Turn off public sign-up in Supabase

Once the admin create call is confirmed live: Project settings, Authentication, "Allow new users to sign up" off (the setting is described in the Auth general configuration guide). Until then a direct call to the Supabase sign-up endpoint with the publishable key can create an account without the Worker's age and terms checks (RISK-27, accepted). Such an account gets no session from the Worker until it attests at sign-in, and its own Supabase token opens only routes 61, 62, 64 and 65.

## 5. Requests and clean-up (each answered within 30 days)

- **Deletion request** while route 64 is `feature_disabled`: check the requester controls the account (username and password at sign-in on `/account/`, otherwise a manual check through `LEGAL_CONTACT`), then delete the user in the Supabase dashboard (Authentication, Users).
- **Access request** while route 65 is `feature_disabled`: send the username, `ab`, `termsVersion` and `acceptedAt` from the user's app metadata. Log counts only.
- **`age_blocked_pending_delete` log lines**: within 7 days of each line, delete the user whose opaque id it carries. This is mandatory whatever the admin path. Also delete every user whose app metadata `ab` is set and is not `18p`.
- **Optional purge**: users without the Worker-written record (created by a direct call). Count them first; log counts only.

## What the logs may hold

Counts and opaque ids only: `age_blocked_pending_delete user=<supabase id>`, `terms_attested_unstored`, and the `SKIP ...` lines. Never a password, token, username or network address.

# ADR-0018 — Publish identity before Thirdweb (M14a)

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** DL-145 (DN-S12-01); R-AUTH-03, R-MOD-02

## Context
Publishing mods, NPCs and experiences needs identity tier `linked` (P2): a person must be accountable and bannable. Thirdweb (P3) is integrated last, at M14a, and only after the Growth plan is paid [F-059]. The publish pipeline (M13c) and the forum (M13b) ship earlier. Something must provide P2 in between, without making ChatGPT or any wallet a requirement to play (R-AUTH-03).

## Options considered
1. **Block publishing until M14a.** Leaves the UGC pipeline untestable against real accounts for several milestones.
2. **Allow `device` tier (P1) to publish.** P1 is a Turnstile-gated anonymous registration; bans would be trivially evaded.
3. **Provider ladder behind the `linked` tier** (chosen): the first provider that works is used, and the tier check is provider-agnostic.

## Decision
- **Tier rule.** Routes 36 and 37 `POST` (publish) require tier `linked`, age bracket `18p` and no `publish_ban`. The tier is satisfied by any one linked provider in `prv[]`. Forum posting needs only P1 plus the account-age rule (Q-BE-04).
- **Before M14a, in this order.**
  1. `openai` provider: "Continue with ChatGPT" on the site, behind the flag `AUTH_OPENAI_WEB` (default false). It is a limited trial program for websites [F-060], so it ships dark and is enabled only if OpenAI grants access.
  2. `supabase-oauth` provider: GitHub sign-in through the Supabase Auth GitHub provider, linked to our profile through the issuer (flag-gated). Whether Supabase Auth GitHub OAuth can run beside our Third-Party Auth issuer on one project is UNVERIFIED (U-ADR-01 in `spec/99-open-questions.md`; DL-145); M13c1 verifies it.
  3. If neither works at M13c1, publishing stays enabled on staging and private-to-owner only, which `ugc.publish=false` in production already implies until M13d1 (DL-151), and public publishing waits for M14a.
- **Owner question Q-38 (narrowing of R-MOD-02 and R-AUTH-03).** The brief makes ChatGPT linkage the enabler of modding "for players without a local agent". This ladder ships website ChatGPT dark, so the identity that publishes before M14a is most likely GitHub (`supabase-oauth`), which the brief does not name; the no-agent ChatGPT Studio (flow B, `12-modding-publish.md` C§2) has no milestone. Q-38 asks the owner to (a) accept GitHub as the interim publish identity, (b) accept that v1 has no ChatGPT-assisted path for players without a local agent (the in-game creator, M13b3, has no AI), or (c) schedule flow B as a post-M13 milestone. Until the owner answers, R-MOD-02 is `blocked (Q-38)` in the `spec/01-product.md` §13 matrix.
- **The `/link` page** approves a device-code only for a profile that is already `linked`; otherwise it walks the player through linking the first available provider (ADR-0019).
- **Adapters.** `packages/identity` gets `openai.ts` (M13c3, flag) and the supabase-oauth path; both feed the same `IdentityService.link`. The issuer never places a provider subject, email or wallet address in a token (ADR-0009).
- **Merge.** When Thirdweb arrives (M14a), a P3 link attaches to the same `profile_id`; a second-device sign-in may open a merge request, and no data is lost.

## Consequences
- (+) UGC publishing is testable end to end before the Growth plan is paid.
- (+) The provider ladder is data: adding Thirdweb is a provider entry, not a rule change.
- (−) Two provider adapters carry upkeep until M14a; the GitHub path excludes people without GitHub accounts, who wait for M14a.
- (−) Both pre-M14a paths depend on UNVERIFIED vendor behaviour, so the public-publish date can slip behind M14a.
- (−) If both fail, public publishing depends on Thirdweb (M14a), which reverses the P2-before-P3 rollout order; Q-38 records whether the owner accepts that.

## Affected contracts and milestones
C12 (`ProviderId`, `Tier`, routes 10–11, 36–37), C14/C17 (publisher attribution). M13c1 (device code, `/link`), M13c2 (publish server), M13c3 (CLI link, `openai` adapter), M13d1 (publish gate), M14a.

## Links
`spec/domains/12-modding-publish.md` C§2; `09-backend-contracts.md` §2.3; `spec/99-open-questions.md` U-ADR-01, Q-38; `spec/11-decision-log.md` DL-145, DL-151, DL-207; ADR-0009, ADR-0019.

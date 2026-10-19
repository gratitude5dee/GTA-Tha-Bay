# M12a2 — age-register-cloud-save-ui

## Goal
The P1 features of M12a1 become usable from the shell. After this session, `IdentityService.attestAge('18p')` also posts the bracket to route 15 (no date ever leaves the device, and blocked players make no server call); `/account/register` registers the device and returns to the menu as tier `device`; the menu header shows a cloud-save chip; unresolved cloud conflicts show a banner and a three-way choice dialog; and Profile › Account offers "Delete my online data" (route 14 `DELETE /me` through `IdentityService.forget`). Settings › Data & privacy enables "Export my account data" and "Forget me", and the NPC voices and AI dialogue row gains "Forget NPC memories" (route 52), for every profile with a play token (DL-548). No server work: every route already exists from M12a1, M06a1 or M06a4.

## Requirements
- R-AUTH-01: the player can opt into P1 cloud sync from the profile page; play never requires it.
- R-UI-03: profile, saves and account pages gain their M12a states.
- R-UI-02: the data and privacy settings (export, forget, NPC memory deletion; D-22) are reachable from Settings.
- R-IP-04: only `18p` reaches the server; under-18 stays blocked with no network request and no telemetry.

## Depends on
- M12a1 (routes 7–9, 15–19, 50–51, `DeviceIdentity`, `HttpCloudSync`), M04b1 (shell, kit, age gate, saves and profile pages, `@ui-age`, `@ui-saves`, `@ui-a11y` suites, `check:i18n`).
- Present from earlier milestones (run order): M06a1 route 14 `GET /me/export`; M06a4 route 52 `DELETE /me/npc-memory`; M04b1 Settings rows `privacy-storage.ts` and the NPC voices and AI dialogue row. The e2e mocks routes 14 and 52 (DL-548).
- Contracts: C12 1.1 (`IdentityService.attestAge`, `forget`, `TokenRes`, `CloudSaveRecord`; routes 14 and 52), C05 1.1 (`conflicts` store, rule 10; `StorySlice.npcRelations`).

## Scope in
- `attestAge(bracket)` (C12 1.1 §2): persists in `dv-identity`; for `18p` posts route 15 when online, else queues it and posts at the next online boot; failure never blocks play. For any other bracket nothing is sent (`10-ui-pages.md` §2.4 rule 3).
- `/account/register` (non-isolated `/account/*`, plain Preact island, no canvas): explains registration in one paragraph, renders the Turnstile widget only when `VITE_TURNSTILE_SITE_KEY` is set (U-BE-2), posts route 7 through `DeviceIdentity.register`, then returns to `/`. Without the site key, no widget and the token `none` (M12a1 verifier mode `none`). Before navigating there the shell sends `save.request{reason:'manual'}` and waits ≤ 2 s (`10-ui.md` routing rule 4).
- Header chips: identity tier (*This device only* / *Registered* / *Linked*) and cloud chip states `off`, `synced`, `syncing`, `offline`, `conflict`, driven by `HttpCloudSync` events.
- Conflict banner on every menu page while the `conflicts` store is non-empty; dialog per entry with two columns (This device, Cloud: `savedAt`, `playtimeSec`, device suffix, slot) and actions *Keep this device's* (re-PUT with the server version as `If-Match`), *Keep cloud's* (write the cloud record locally), *Keep both* (import the cloud copy as a new save profile "<name> (cloud)"); nothing overwrites silently.
- Saves page: delete warns that cloud copies are tombstoned too (route 51 via sync).
- Profile › Account: tier explanation per `10-ui-pages.md` §2.7; "Register this device" CTA (tier `local`); "Delete my online data" with type-to-confirm → `forget()`; local save profiles stay on the device.
- **Settings › Data & privacy and NPC memories** (`10-ui-pages.md` §2.9 Data & privacy row; DL-548), enabled for any profile with a play token (tier `local` included), otherwise disabled with "Needs a connection once":
  - "Export my account data": route 14 `GET /me/export` with the play token; the row shows the state the route returns, "Your export is being prepared; it is ready within 24 hours" or the download link with its 7-day expiry; it asks again only on a button press or when Settings reopens.
  - "Forget me": the same type-to-confirm `forget()` flow as Profile › Account (one component, used in both places).
  - "Forget NPC memories" on the NPC voices and AI dialogue row: route 52 `DELETE /me/npc-memory` for all NPCs, or with `npcId` for one NPC chosen from the active save's `StorySlice.npcRelations`; confirm dialog; 204 shows a done toast, an error maps through `apiErrorToUi()`.
- `apiErrorToUi()` rows for `age_blocked`, `tier_required`, `conflict` with `NEWER_SCHEMA`; new i18n keys in `en.json`.
- Playwright setup that writes ephemeral ES256 keys into the git-ignored `services/edge/.dev.vars` when absent, and selects the in-memory `DataPort` (M05d) for the e2e web server.

## Scope out
- `/link`, provider link buttons (`auth.openaiWeb`, `auth.thirdweb`) → M13c1, M14a. Online page → M12d.
- OS age signals (`AgeSignalProvider` stays `null`) → M14c; launch gate `age-signals` → M14b3 (DL-285). Teen mode stays off (DL-139).

## Deliverables
- `packages/identity/src/device/attest-age.ts` (queue + POST), `packages/identity/test/attest-age.test.ts`.
- `packages/ui/src/pages/account/{register.tsx, index.ts}`; `apps/web/account/register.html` (non-isolated entry) and its Vite input.
- `packages/ui/src/pages/saves/{conflict-dialog.tsx, conflict-banner.tsx, cloud-chip.tsx}`; edits to `packages/ui/src/pages/saves/saves.tsx` and `packages/ui/src/pages/profile/profile.tsx` (account section, forget flow); `packages/ui/src/pages/account/forget-dialog.tsx` (shared by Profile and Settings); edits to `packages/ui/src/pages/settings/{privacy-storage.ts, audio-access.ts}` and new `packages/ui/src/pages/settings/data-requests.ts` (routes 14 and 52; DL-548).
- `packages/ui/src/shell/api-error.ts` (new rows), `content/ui/i18n/en.json` (new keys).
- `packages/ui/test/{cloud-chip.test.ts, conflict-dialog.test.ts, api-error.test.ts, data-requests.test.ts}`.
- `tests/e2e/{age-gate.spec.ts (extend, @ui-age), saves-ui.spec.ts (extend, @ui-saves), account.spec.ts (@ui-account), privacy.spec.ts (@ui-privacy)}`; `tests/e2e/setup/dev-keys.ts` (Playwright global setup).
- `tools/ci/check-dist.ts`: the header table gains `/account/register` (no COEP) beside `/account/`.
- `.env.example` entry `VITE_TURNSTILE_SITE_KEY=` (empty). No secrets.

## Interfaces
- C12 1.1 `IdentityService` (`attestAge`, `register`, `forget`, `onChange`) and routes 7, 14, 15, 16–19, 51, 52 consumed as frozen.
- C05 1.1 `SaveService` (`importProfile`, `conflicts` store) consumed as frozen. No contract change.

## Acceptance criteria
- AC-1 Given a fresh profile online When the age screen receives an adult date Then exactly one request `POST /api/v1/me/age` is sent with body `{"bracket":"18p"}` and no date field; given a 17-year-old date Then `BlockedPage` shows and the page makes zero requests to `/api/` and emits no telemetry; given an adult date offline Then the bracket is stored and posted once at the next online boot — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-age`
- AC-2 Given a P0 profile When the player opens Profile › Account › Register this device Then the shell saves first, `/account/register` loads with `crossOriginIsolated === false`, submitting returns to `/` with the tier chip "Registered" and `IdentityState.tier === 'device'`; with no site key configured no Turnstile script is requested — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-account`
- AC-3 Given a registered profile and a mocked sync that is slow, then offline, then answers 409 When the menu is open Then the cloud chip moves through `syncing`, `offline` and `conflict`, and a conflict banner links to the dialog from every menu page — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-saves`
- AC-4 Given three seeded conflicts When the player picks Keep this device's, Keep cloud's and Keep both Then the first sends a PUT whose `If-Match` is the server version, the second leaves the local slot equal to the server copy, the third creates a save profile named "<name> (cloud)", and the `conflicts` store is empty — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-saves`
- AC-5 Given a registered profile with two local save profiles When the player types the confirmation and deletes online data Then `DELETE /api/v1/me` is called once, the tier chip returns to "This device only", `dv-identity` holds a new local identity, and both save profiles are still listed — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-account`
- AC-6 Given the UI units When the chip reducer, the conflict dialog model and `apiErrorToUi` run Then every chip state renders a key that exists in `en.json`, `age_blocked` maps to the age explanation (no retry), `tier_required` maps to the register CTA, and no catalog lacks a new key — proof: `pnpm check:unit -- packages/ui packages/identity` and `pnpm check:i18n`
- AC-7 Given the register page and the conflict dialog When the axe scan runs Then there are zero critical or serious findings — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-8 Given a QA build served on port 8788 When headers are checked Then `/` keeps COOP, COEP and CORP and `/account/register` has no COEP — proof: `pnpm check:headers -- --serve http://localhost:8788`
- AC-9 Given the branch When CI builds and previews it Then the build succeeds and the Preview deploys — proof: `pnpm build && pnpm deploy:preview`
- AC-10 Given a P0 profile with a play token and mocked routes 14 and 52 When the player opens Settings › Data & privacy and requests the export twice (the mock answers first "in preparation", then with a link), then uses Forget NPC memories for one NPC and then for all, then Forget me Then the export row shows the preparing state and then the link, route 52 is called once with `npcId` and once without, Forget me calls `DELETE /api/v1/me` once, and a profile without a play token sees all three controls disabled with no request — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-privacy`

## Test plan
- Unit: `packages/ui/test/{cloud-chip, conflict-dialog, api-error, data-requests}.test.ts` (`data-requests`: route paths, `npcId` query, play-token header, error mapping); `packages/identity/test/attest-age.test.ts` (queue, no call for blocked brackets).
- E2E (`chromium-webgl2`): `@ui-age`, `@ui-saves`, `@ui-account`, `@ui-privacy`, `@ui-a11y`; the web server uses ephemeral dev keys and the in-memory port.
- No device test (iOS Home Screen redirects stay U-BE-16, recorded later by M13c1/M14a).

## Demo script
1. `pnpm dev`; pass the age screen with an adult date; watch the single route 15 call.
2. Profile › Account › Register this device; return as "Registered".
3. Save in story; open a second browser profile with the same identity export and save the same slot; see the conflict banner; pick Keep both.
4. Profile › Account › Delete my online data; confirm; tier returns to local.
5. Settings › Data & privacy › Export my account data; see "being prepared"; NPC voices and AI dialogue › Forget NPC memories › all NPCs.

## Effort
0.5 Builder session; about 26 files (the Settings privacy controls added by DL-548); risk **low**. The non-isolated account entry in the Vite build is the only new build wiring.

## Risks & fallbacks
- Turnstile under these headers is UNVERIFIED (U-BE-2): the page works without the widget (M12a1 mode `none`); the widget appears only with a configured site key. Record what the operator sees in `notes.json` when a key is first configured.
- If `importProfile` cannot take a single cloud record for Keep both, build a one-record `.dvsave` in memory and import it `asNew` (C05 export format); log a Builder decision.
- Redirect timing on iOS standalone (U-BE-16) does not affect this page: registration is a same-origin navigation, not a provider redirect.

## Notes for the Builder
- Read first: `10-ui-pages.md` §2.4, §2.7, §2.9 (Data & privacy row), §5; `10-ui.md` routing rules (page table, rule 4); `09-backend-contracts-1.1.md` §2 (`attestAge`); `spec/05-api-and-realtime.md` §2.
- Order: `attestAge` → chips and sync events → conflict dialog → register page → forget → Settings privacy controls → e2e.
- Render user text as text only. `/account/*` must not load the game bundle; keep the island small.
- Branch `m12a2-age-register-cloud-save-ui`.

# M13d2 — legal-forms-ui

## Goal
After this session the legal pages are real. `/legal/<doc>` renders structured, versioned legal text from `content/legal/`, with a "Text pending counsel review" banner until counsel signs a document off (Q-23). Three forms post to route 42: the DMCA notice, the counter-notice and the NCII / TAKE IT DOWN request. They work for anyone, anywhere: before the age screen, from the blocked screen, outside the US, and with no account. The TAKE IT DOWN notice is linked from the title page, the main menu and every UGC surface. The `copyright` report category opens the DMCA form with the target filled in. Nothing a requester types is stored on the device or sent anywhere except route 42. The server side (intake, clocks, evidence, pager) is M13d1's. This milestone is UI only.

## Requirements
- R-IP-03: DMCA notice, counter-notice and NCII intake forms; a report button path to the DMCA form from every UGC surface; the TAKE IT DOWN notice wherever UGC renders.
- R-UI-03: the credits/legal family of pages becomes complete, replacing the M00 stubs.
- R-IP-04 (support): the legal pages stay reachable from `BlockedPage`, so a blocked person can still file an NCII request. They emit no telemetry beyond `ui.page`.

## Depends on
- **M13d1** (legal-trust-safety-backend): route 42 handlers, the request types and schemas it adds for the three bodies, the `legal` rate-limit class, migration 0008.
- **M04b1** (shell-ui-kit-menus-settings): shell, kit, `PageDef` registry, `apiErrorToUi()`, i18n, `@ui-a11y` scan.
- Contracts: C12 1.1 (route 42, `ApiError`, `HTTP_FOR`, `ReportCategory`). C16 1.1 (`ui.page` only).

## Scope in
- **Documents.** `content/legal/<doc>.json` for `terms`, `privacy`, `dmca`, `counter-notice`, `ncii`, `ugc`, `ai-disclosure`, `repeat-infringer`, `contact`. Each file follows a schema `{ doc, version, updated /* YYYY-MM-DD */, counselReviewed: boolean, sections: { heading: LocKey | string, paragraphs: string[] }[] }` in `packages/ui/src/pages/legal/legal-doc.schema.json`. Paragraphs are plain text, rendered as text nodes; there is no markdown and no `innerHTML`.
  - Placeholder text is written from `research/legal-ip-likeness.md` §5.1–§5.3. It carries `counselReviewed: false` until Q-23 is answered.
  - The `dmca` and `contact` documents show the designated-agent block from `config/legal.json` (`agent: { name, address, email, phone } | null`). While the agent designation (Q-16) is pending, the block reads "Designation pending". The DMCA form still works, because route 42 does not depend on it.
- **Page.** `LegalPage` (`/legal/:doc`, `PageDef` kind `document`, gate always `open`, XR `exit`). It provides a table of contents, the version and updated date, the pending-review banner, and a "Print or save" hint. Documents are pre-rendered at build time into the lazy `legal` chunk, so they open offline after the first visit (service worker precache, under the 6 MiB cap).
- **Forms.** One `LegalForm` component renders three field sets from `content/legal/forms.json` (schema `legal-forms.schema.json`). The starting sets are listed below. Counsel replaces the wording (Q-23); the keys match M13d1's body types.
  - **DMCA notice:** the 17 U.S.C. 512(c)(3) elements [research/legal-ip-likeness.md §5.1]:
    - complainant name and contact (address, email, phone);
    - identification of the copyrighted work;
    - identification and location of the material (content references; see the prefill rule below);
    - good-faith statement (checkbox);
    - accuracy statement made under penalty of perjury (checkbox);
    - electronic signature (typed full legal name).
  - **Counter-notice:** removed-material reference, statement under penalty of perjury of a good-faith belief that the removal was a mistake, contact details, consent to jurisdiction and service (checkbox), electronic signature. This starting set follows the counter-notice path of §5.1; counsel confirms it.
  - **NCII request:** location of the depiction (content references or URLs on our hosts), statement that it was shared without consent (checkbox), contact for the outcome notice, electronic signature. **There is no file input of any kind.** The form never asks for the image itself; that is data minimisation, and copies are found server-side by hash (M13d1).
- **Submission.** `POST /api/v1/legal/{dmca|counter-notice|ncii}` with `X-Client-Build`. The play token or JWT is never attached, because the routes are `pub`.
  - 202 shows the case reference that M13d1's response returns, with "keep this reference".
  - `rate_limited` shows a countdown from `retryAfterMs`.
  - `bad_request` maps `details` to field errors.
  - Network failure keeps the typed values in memory and offers Retry.
  - Every other code goes through `apiErrorToUi()`.
  - The submit button stays disabled until every required field is valid and both statements are checked.
- **Privacy rules.**
  - Form values live only in component state. They are never written to IndexedDB, `localStorage`, `sessionStorage`, the URL, a toast, the console or telemetry.
  - Leaving the page discards them after a confirm dialog.
  - The only telemetry is the existing `ui.page {page:'legal'}`.
- **Entry points.**
  - The report dialog with category `copyright` follows route 41's `details.redirect` to `/legal/dmca?ref=<kind>:<id>`; `ref` prefills one location row as a content reference.
  - The `NciiNotice` kit component ("Report intimate images shared without consent") links to `/legal/ncii?ref=…`. It is added to the Title and Main footers and is required inside `UgcSurface` next to `ReportButton`. The TAKE IT DOWN Act asks for a clear notice on the home page and wherever UGC renders [research/legal-ip-likeness.md §5.2; F-066].
  - The `BlockedPage` links to the Legal index, and the forms work from there.
- **i18n.** Every label is a `LocKey` in `en.json`, and the documents' prose is English (v1). `check:i18n` stays green.

## Scope out
- Intake, SLA clocks, NCII copy sweep, evidence, NCMEC records, the pager, hash banks, the staff case console → M13d1 (and the staff tools it names).
- Final counsel wording, the DMCA agent registration and NCMEC/PhotoDNA filings → owner (Q-23, Q-16). The data commit that flips `counselReviewed` is not code.
- The accessibility audit of every page → M14c (this milestone keeps `@ui-a11y` green on its own pages).
- Localized legal text → post-v1.

## Deliverables
- `content/legal/{terms,privacy,dmca,counter-notice,ncii,ugc,ai-disclosure,repeat-infringer,contact}.json`, `content/legal/forms.json`, `config/legal.json`.
- `packages/ui/src/pages/legal/{LegalPage.tsx, LegalForm.tsx, fields.ts, submit.ts, legal-doc.schema.json, legal-forms.schema.json, index.ts}` (replaces the M00 stubs; the route stays `/legal/:doc`).
- `packages/ui/src/kit/NciiNotice.tsx`. Edits to `UgcSurface`, Title and Main footers, `BlockedPage` links, the report dialog redirect handling, the `PageDef` registry entry for `legal`, and `packages/ui/src/i18n/en.json`.
- `packages/ui/test/{legal-docs.spec.ts, legal-form.spec.ts, ncii-notice.spec.ts}`; extend `ugc-surface.spec.ts` (requires `NciiNotice`).
- `tests/e2e/legal.spec.ts` (tag `@ui-legal`), using Playwright `page.route` for route 42 and capturing request bodies.
- No new root script. ≈ 24 files.

## Interfaces
- C12 1.1 consumed as frozen: route 42 (pub, worldwide, geo-exempt), `ApiError`/`HTTP_FOR`, route 41 `copyright` → 409 with `details.redirect`.
- The bodies of route 42 are the types M13d1 declared. `pnpm check:api` generates their JSON Schemas under `packages/shared/schemas/api/`. This milestone imports those types and never redeclares them. If they are missing, see Risks; do not add them to `v1.ts` here.
- No contract change.

## Acceptance criteria
- AC-1 Given a fresh browser context with no age attestation and `BootConfig.region = 'blocked'` When each of the nine `/legal/<doc>` routes opens Then the document renders its sections, version and updated date, every document with `counselReviewed: false` shows the pending-review banner, and no age screen or region notice intercepts it — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-legal`
- AC-2 Given the DMCA form When the required fields are empty, a statement checkbox is unchecked or the signature is blank Then submit stays disabled and each invalid field shows a programmatically associated error. When the form is completed and submitted Then the captured request body validates against the schema `check:api` generated for that route, no `Authorization` header is sent, and the 202 reference is shown — proof: `pnpm check:unit -- packages/ui && pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-legal`
- AC-3 Given a mocked route 42 answering 429 `rate_limited` with `retryAfterMs: 3000` When the requester submits Then a countdown appears, the typed values stay in the form, and submit re-enables after the countdown — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-legal`
- AC-4 Given the NCII form, filled and submitted When the e2e inspects the page and storage Then the form has no `input[type=file]`; after submit and after a reload, IndexedDB, `localStorage`, `sessionStorage` and the URL contain none of the typed values; every captured `/api/v1/t` body contains only `ui.page` events without them — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-legal`
- AC-5 Given a forum post with a report button When the player reports it with category `copyright` and the mocked route 41 returns 409 with `details.redirect: '/legal/dmca'` Then the DMCA form opens with one location row prefilled with that post's reference — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-legal`
- AC-6 Given the kit When the unit suite runs Then every component tagged `UgcSurface` renders both `ReportButton` and `NciiNotice`, Title and Main render `NciiNotice`, every legal document and `forms.json` validate against their schemas, and every form key used by `LegalForm` exists in `en.json` — proof: `pnpm check:unit -- packages/ui`
- AC-7 Given the blocked screen (a 17-year-old date entered) When the person follows Legal → NCII Then the form opens and can be submitted — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-legal`
- AC-8 Given the legal pages and the three forms in their empty, error and success states When the axe scan runs Then it reports zero critical or serious findings — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-9 Given the branch When i18n, lint, unit tests and the preview deploy run Then all pass and the deployed `/legal/dmca` serves the new page — proof: `pnpm check:i18n && pnpm lint && pnpm check:unit && pnpm deploy:preview`

## Test plan
- Unit (`pnpm check:unit -- packages/ui`):
  - `legal-docs.spec.ts`: schema, text nodes only;
  - `legal-form.spec.ts`: validation table per field set, disabled-submit rules, error mapping from `ApiError`, no storage writes (spied);
  - `ncii-notice.spec.ts`;
  - `ugc-surface.spec.ts` (extended).
- E2E `@ui-legal` on `chromium-webgl2`, with route 41 and route 42 mocked through `page.route`; `@ui-a11y` scan extended to the legal pages.
- Deployed: `pnpm deploy:preview` (CI `preview.yml` also runs `check:headers` and `check:coi`; `/legal/*` stays cross-origin isolated).

## Demo script
1. `pnpm dev`; open `/legal/terms` in a fresh profile: the document and the pending-review banner show, with no age screen.
2. Open `/legal/dmca`; try to submit empty (disabled); fill in the form, tick both statements, type a signature, submit; read the reference.
3. On a forum thread, Report → Copyright: the DMCA form opens with the post prefilled.
4. Enter a 17-year-old birth date on a new profile; from the blocked screen open Legal → NCII; note there is no upload field.
5. DevTools → Application: no form values in any storage.

## Effort
0.3–0.5 session; ≈ 24 files (10 of them small JSON documents); risk **low**.

## Risks & fallbacks
- **M13d1 did not export route 42 body types, or `check:api` emits no schema for them.** Read `services/edge/src/legal` and match its accepted fields. Keep the field keys in `forms.json` only, and replace AC-2's schema check with a unit test that compares the form keys with the handler's Ajv schema file. Report the gap to the Architect as a C12 proposal; do not edit `v1.ts`.
- **Counsel text arrives mid-session.** It is a data commit to `content/legal/*.json`. Only the `counselReviewed` flag and `version` change.
- **`termsVersion` (M04b1) lives elsewhere.** Read it from where M04b1 put it. The Terms card re-show rule is unchanged; `content/legal/terms.json` `version` must equal it, and a unit test asserts that.

## Notes for the Builder
- Earlier deliverables used as they stand (transitive, already done): M00 `/legal/*` stubs; `ReportButton` and `UgcSurface` (M04b2, M13b4); the route 41 report flow (M06b2).
- Read first: `10-ui-pages.md` §2.4 (blocked screen links), §2.14 (legal), §5 (`apiErrorToUi`); `10-ui-hud-xr.md` §2.10 (report button) and §2.13 (accessibility rules 7, 10, 11); `09-backend-contracts.md` §2.4 rows 41–42 and §2.5 (`ReportReq`); `spec/05-api-and-realtime.md` §1.4 (geo exemption), §5.1 (`legal` 5/60 s); `research/legal-ip-likeness.md` §5.1–§5.3.
- Order: schemas and documents → `LegalPage` → `LegalForm` and submit → entry points (`NciiNotice`, report redirect, blocked links) → tests.
- Never render legal or user text with `innerHTML` (lint rule `no-inner-html` from M13b4 covers `packages/ui`).
- Do not put the display name literal in any `content/legal` file. Use `{brand}` and format it with `BRAND.displayName`; `names:lint` and `check:i18n` enforce this.
- Secrets: none. Owner gates: Q-23 (final text), Q-16 (DMCA agent details). Both are data and leave the UI working with placeholders. Branch `m13d2-legal-forms-ui`.

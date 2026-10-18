# M14c — a11y-audit-i18n-gate

## Goal
After this session the accessibility baseline (R-ENG-04) is audited across the whole shell, not page by page. One registry-driven axe audit visits every flat page and its key states with zero critical or serious findings. The audit fails when a registered page is missing from it. The token palette has deterministic checks for contrast and colour-vision separation, covering both the DOM and the XR canvas panels, which share the tokens. `check:i18n` turns from a report into a gate. The troubleshooting guide is final, and every error screen deep-links to an existing topic. The OS age-signal hook (`AgeSignalProvider`) is wired with its v1 null provider. Fixes land in `packages/ui` where the audit finds problems. No new feature ships.

## Requirements
- R-ENG-04: audit of keyboard and focus, contrast, colour-blind-safe HUD palettes, reduced motion, text scale, targets and announcements on every page.
- R-UI-02: the settings pages, including accessibility, XR comfort, language and privacy, pass the same audit; the language page states that v1 dialogue stays English.

## Depends on
- **M13d2** (legal pages), **M13b4** (forum), **M12d** (online page), **M06b3** (NPC builder), **M11b3** (XR panels and comfort). With these, every page in the `PageDef` registry exists.
- Contracts consumed as frozen: C05 1.1 (`ProfileSettings.accessibility`), C13 1.1 (`XrComfortSettings`, `PlatformSettings`), C12 1.1 (`AgeBracket`, `IdentityService.attestAge`). No contract is owned here.

## Scope in
- **Registry-driven audit.** `tests/e2e/a11y/pages.ts` builds the audit list from the `PageDef` registry (`packages/ui/src/shell/registry.ts`), plus a hand-kept list of states for each page.
  - The states: age, blocked, terms card; main menu; load; saves with the conflict dialog open; profile; every settings category; creator; modes with a locked tile; garage; NPC builder steps 1 and 9 and My NPCs; community board, thread and composer; experiences and mods (Explore, Installed, install log); online with an invite; credits; the nine legal documents and three forms; help with one topic open; `/link`; `/account/*` landing; pause and phone overlays; loading and error overlays; the report dialog; toasts.
  - Data and flags come from route mocks (`page.route` for `/api/v1/boot` with every `FeatureFlag` on, and fixture JSON for list routes) and from the identity and e2e fixtures that M12a2, M13b4, M06b3 and M12d already use. Reuse them; do not add bridge APIs.
  - The test fails when the registry holds a `PageId` with `kind` `menu` or `document` that the list does not cover.
  - `@axe-core/playwright` 4.14.0 runs with the WCAG 2.2 A/AA rule tags. Zero `critical` or `serious` findings is required; `moderate` and `minor` findings are written to `test-results/a11y-report.json`.
  - The audit runs on `chromium-webgl2` (desktop viewport). A second pass on `webkit-webgl2` at 360 × 780 with `uiScale` 150 % runs the existing `a11y-scale` checks over the same list: no horizontal scroll and no clipped controls.
- **Keyboard walk.** Each page's primary action is reachable by `Tab` alone, focus is always visible, and Esc/`UiBack` closes every modal. The check asserts the focused element after each step and does not compare pixels.
- **Token checks.**
  - `packages/ui/test/contrast.spec.ts` computes WCAG contrast for every text/background token pair declared in `config/ui/tokens.json` (and the `highContrast` theme). It enforces text ≥ 4.5:1, large text ≥ 3:1, component boundaries and states ≥ 3:1, and `highContrast` text ≥ 7:1 (design value).
  - The existing CVD separation check (`hud-status.spec.ts`, algorithm recorded at M04b2) runs over all four HUD palettes.
  - The flash-limit check covers every motion token.
  - XR canvas panels draw from the same tokens, so these checks cover them. The missing accessibility tree in XR is a stated limitation (`10-ui-hud-xr.md` §2.13 rule 11), shown in Settings › Accessibility.
- **i18n gate.** `check:i18n` exits non-zero on any of the following:
  - a `t()` key used in code but absent from `en.json`;
  - a key in `en.json` used nowhere;
  - the display-name literal in any catalog or `content/ui` file;
  - a translated key whose stored source hash differs from the current English text (a stale translation; the runtime still falls back to English);
  - a `LocKey` field in `content/**` JSON (hints, help, legal labels) that does not resolve.
  It still prints the full missing-translation report. CI's `static` job already runs it.
- **Troubleshooting final.** `content/ui/help/troubleshooting.json` (schema `10-ui-pages.md` §4.4):
  - all eight groups are present, each with at least one topic, and `updated` is set;
  - every `ErrorPage` kind and every `apiErrorToUi()` outcome that offers Help maps to an existing topic id;
  - every `sources[].url` appears in `research/INDEX.md` §2 (checked by test);
  - topic steps are `LocKey`s.
- **Age signals.** `AgeSignalProvider` (`packages/ui/src/pages/age/age-signal.ts`) gets the v1 `NullAgeSignalProvider`, which returns `null`. `AgeGate` consults the provider before rendering: a non-null bracket under 18 shows `BlockedPage` without the date screen. A unit test uses a fake provider; there is no real OS integration (`10-ui-pages.md` §2.4 rule 5; the API shape is unverified).
- **Fixes.** Whatever the audit finds, fixed in `packages/ui` with the smallest change: labels, roles, focus order, token values, target sizes.

## Scope out
- XR panel legibility and comfort on devices → M11b3 already recorded them; the release device pass is M14b3.
- New languages or translated legal text → post-v1. Real OS age-signal integration → after the API exists (2027).
- Final launch DoD audit → M14b3.

## Deliverables
- `tests/e2e/a11y/{pages.ts, audit.spec.ts, keyboard.spec.ts}` (tags `@ui-a11y`, `@ui-keys`); the existing `a11y-scale` spec reads `pages.ts`.
- `tools/ci/a11y-coverage.ts` and `tools/ci/test/{a11y-coverage.test.ts, check-i18n.test.ts}` with fixture registries and catalogs.
- `packages/ui/test/{contrast.spec.ts, help-final.spec.ts, age-signal.spec.ts}`; `hud-status.spec.ts` and `flash-limit.spec.ts` extended to every palette and motion token.
- `tools/ci/check-i18n.ts` (gate rules; the root script name `check:i18n` is unchanged).
- `content/ui/help/troubleshooting.json` (final), `config/ui/tokens.json` and `config/ui/palettes.json` (only if a check fails), `packages/ui/src/pages/age/age-signal.ts`.
- Fixes under `packages/ui/src/**` (budget ≤ 18 files; if more are needed, see Risks).
- ≈ 30 files.

## Interfaces
- No contract touched. C12 1.1 `AgeBracket` and `IdentityService.attestAge` are used as frozen; the provider only selects which page shows.
- Internal: `AgeSignalProvider { bracket(): Promise<AgeBracket | null> }` in `packages/ui`.

## Acceptance criteria
- AC-1 Given every page and state in `pages.ts`, with all feature flags on and fixture data When the axe audit runs on `chromium-webgl2` Then each page reports zero critical or serious findings, and `test-results/a11y-report.json` lists every page with its counts — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-2 Given the `PageDef` registry with a page added only to a test fixture registry When the audit's coverage check runs Then it fails and names the uncovered `PageId`; with the real registry it passes — proof: `pnpm check:unit -- tools/ci`
- AC-3 Given `webkit-webgl2` at 360 × 780 with `uiScale` 1.5 When every page in `pages.ts` loads Then none scrolls horizontally and no focusable control is clipped or overlapped — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-a11y`
- AC-4 Given keyboard-only input When the walk visits each page Then the primary action receives focus by `Tab` alone, the focused element always has a visible ring of at least 2 px (computed outline), and Esc closes every open modal and returns focus to its opener — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-keys`
- AC-5 Given `tokens.json` and `palettes.json` When the token checks run Then every declared text pair is ≥ 4.5:1 (≥ 3:1 for large text), boundaries are ≥ 3:1, `highContrast` text is ≥ 7:1, all four HUD palettes pass the CVD separation check, and every motion token declares ≤ 3 flashes per second. A fixture pair at 4.4:1 fails — proof: `pnpm check:unit -- packages/ui`
- AC-6 Given the repository When `check:i18n` runs Then it exits 0 and prints the report. Given fixture catalogs with a missing key, an unused key, a stale translation hash and the display-name literal, each makes it exit non-zero and name the key and file — proof: `pnpm check:i18n && pnpm check:unit -- tools/ci`
- AC-7 Given the final troubleshooting guide When the help tests run Then the eight groups exist, every `ErrorPage` kind and help-linked API outcome maps to an existing topic, and every source URL appears in `research/INDEX.md` §2 — proof: `pnpm check:unit -- packages/ui`
- AC-8 Given a fake `AgeSignalProvider` that returns `'16_17'` When a new profile reaches the age step Then `BlockedPage` shows without the date fields and no `attestAge` call is made. With `NullAgeSignalProvider` the date screen shows as before — proof: `pnpm check:unit -- packages/ui`
- AC-9 Given the branch When lint, the unit suite and the preview deploy run Then all pass and the deployed app is unchanged apart from the fixes — proof: `pnpm lint && pnpm check:unit && pnpm deploy:preview`

## Test plan
- E2E: `@ui-a11y` (axe, registry-driven) on `chromium-webgl2`; `a11y-scale` on `webkit-webgl2`; `@ui-keys` keyboard walk. The existing `@ui-motion`, `@ui-touch`, `@ui-menus` stay green.
- Unit: `contrast`, `hud-status` (CVD), `flash-limit`, `help-final`, `age-signal`, `check-i18n` fixtures (`pnpm check:unit -- packages/ui tools/ci`); the coverage check (`tools/ci/a11y-coverage.ts` exports the pure `uncovered(registry, list)` that `pages.ts` also calls; its test is `tools/ci/test/a11y-coverage.test.ts`, because `vitest.config.ts` excludes `tests/e2e/**` since M00).
- XR: `pnpm check:e2e:xr` stays green (panel text height rule from M11b3).

## Demo script
1. `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`; open `test-results/a11y-report.json`.
2. Add a fake page id to the fixture registry of `a11y-coverage.test.ts` without listing it; `pnpm check:unit -- tools/ci` fails; revert.
3. `pnpm check:i18n`; add an unused key to `en.json` and see it fail; revert.
4. In `pnpm dev`, switch Settings › Accessibility to the `tritan` palette and `uiScale` 150 % and walk the menus by keyboard.

## Effort
0.5 session; ≈ 30 files, most of them small fixes; risk **low**.

## Risks & fallbacks
- **The audit finds more than ≈ 18 files of fixes.** Fix every `critical` and `serious` finding on the main path first: title, age, main, settings, saves, legal and help. For other pages, file each remaining finding in `spec/11-decision-log.md` "Builder decisions" with its page. Report the milestone as partially done and do not mark AC-1 passed. Never downgrade a rule or exclude a page to get green.
- **A page cannot be reached under mocks**, for example because it needs a live room. Render it through its component test harness in the e2e page (`/__qa/page/<id>`, QA builds only; dropped from production by the same `VITE_DV_QA` guard as `__dvBridge`) and note it.
- **An axe rule misfires on a canvas element** (the HUD minimap or the XR preview). Give the canvas an accessible name and a text twin, as the `table` widget already does for charts. Do not disable the rule.

## Notes for the Builder
- Earlier deliverables used as they stand: M04b1 (`@ui-a11y` in `tests/e2e/ui/a11y.spec.ts`, `check:i18n` report, `registry.ts`) and M04b2 (palettes, CVD check, help page). Extend their files; do not fork them.
- Read first: `10-ui.md` §2.6, §3.1, §9; `10-ui-hud-xr.md` §2.13–§2.14, §9; `10-ui-pages.md` §2.4, §2.14, §4.4, §9.
- Facts: WCAG 2.2 SC 1.4.3, 1.4.11, 2.3.1, 2.5.8 and `@axe-core/playwright` 4.14.0 (MPL-2.0), as cited in `10-ui-hud-xr.md` §7. The colour-vision algorithm is the one M04b2 recorded. Do not switch it.
- Order: coverage list → axe run → fixes → token checks → i18n gate → help → age provider.
- Secrets: none. No paid account. Branch `m14c-a11y-audit-i18n-gate`.

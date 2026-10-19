# M04b1 — shell-ui-kit-menus-settings

## Goal
After this session the game has its menus. The S10 shell runs the state machine `Booting → Title → AgeGate → Terms → Menu → Loading → InMode` with `Blocked`, `Recovering` and error states. A typed page registry carries gates, a router that reflects top-level menu pages, banners and toasts. The Preact kit has focus navigation that works the same on keyboard and mouse, gamepad and touch. XR-capable pages are authored once as `ScreenDef`s and rendered by `DomScreen`; `CanvasScreen` exists for parity. All copy goes through the i18n layer (English catalog, `{brand}` placeholder, `check:i18n` report).

The player can:
- pass the neutral age screen (every under-18 bracket is blocked, DL-139) and accept the Terms card with the telemetry toggles (default on, DL-140);
- use the main menu and Continue/Load;
- see mode tiles with `ready`, `locked` and `comingSoon` states and the unlock toast;
- manage profiles and saves (New Game = new save profile, DL-141; export, import and undo);
- change settings in every v1 category, each row with its scope badge.

## Requirements
- R-UI-03: main menu and its implied pages: continue/new game, mode select with lock states, profile and save slots, credits and legal stubs.
- R-UI-02: settings for graphics tier, controls remap, audio, accessibility, camera, language, data and privacy, and XR comfort (collapsed note on non-XR devices).
- R-ENG-04: remappable controls, subtitle settings, colorblind palette choice, reduced motion and full keyboard and gamepad operation of every page.
- R-MODE-05: mode tiles reflect the unlock registry, show NEW after an unlock toast, and keep `comingSoon` stubs (A-06).
- R-IP-04: 18+ terms; the age screen blocks every under-18 bracket with no server call and no telemetry.

## Depends on
- **M04a2** (ModeHost, unlock registry, `UiBridge`, `ViewModelSource`, `UiCommand` channel, remap persistence).
- **M00e** (`config/terms.ts` with `TERMS_VERSION`, `content/legal/{terms,privacy}.json`, route 66, the `/account/` island; DL-602).
- Through earlier milestones: M04a1 (`SaveService`, `readLastSave`), M01b2 (`AudioService.unlock()`, DL-663), M01c (`QualityService`, `PlatformSettings` in `dv-platform`, `Benchmark`, telemetry client), M01e (`WorldPackStore` usage), M01b1 (`InputRouter`, `rebindCapture`), M00 (`packages/ui` scaffold, tokens, `BootScreen`, credits and legal stubs, the `en` catalog at `packages/ui/src/i18n/en.json`, `check:bundle`).
- Contracts: C06 1.1.0 (`UiBridge`, `ViewModelSource`, `UiCommand`, `GameModeDescriptor`), C05 1.1.0 (`ProfileSettings`, `ProfileMeta`, `SaveErrorCode`), C13 1.1.0 (`PlatformSettings`, `XrComfortSettings`), C03 1.1.0 (`ClientAction`, `ControlsSettings`), C16 1.1.0 (`ui.page`, `ui.onboard`).

## Scope in
- **Shell** (`packages/ui/src/shell/`): `PageDef`, `GateCtx`, `GateResult`, `ShellApi` (`10-ui.md` §3.1). The §2.4 state machine. Page registry with the §2.5 table rows for this milestone; later pages are registered with a "Coming soon" screen. History routing rules 1–4. Banners: offline, other tab, "Progress cannot be saved", not isolated. Safe points through `PwaUpdateController.markSafePoint`. `apiErrorToUi()` table (`10-ui-pages.md` §5.3).
- **Kit**: focus groups with roving tabindex and spatial navigation from `ClientAction` `UiUp/Down/Left/Right/Accept/Back/TabPrev/TabNext`, pointer targets ≥ 44 px on touch, toasts (queue 3, `unlock` and `error` persist up to 8 s, polite live region), dialogs, confirm, the `OnScreenKeyboard` for gamepad text entry.
- **ScreenDef**: types (§3.2), `DomScreen` (semantic HTML), `CanvasScreen` (Canvas 2D draw plus `pick`), and the parity test over every registered `ScreenDef`.
- **i18n**: `t()`, plural and number helpers through `Intl`, the fallback chain `lang → base → en`. The catalog moves from M00's `packages/ui/src/i18n/en.json` (with the keys M02c1 added) to `content/ui/i18n/en.json`, the `10-ui.md` §2.2 location later milestones write to; M00's `src/index.tsx` components are split into the shell and pages. Root script `check:i18n` is created here (M00 declared none; DL-230): missing keys, unused keys, stale-hash report, and a display-name literal check.
- **Pages:**
  - Title: the gesture calls `unlock()` of the M01b2 `AudioService` (`packages/engine/src/client/audio/audio-service.ts`), handed to the shell by the app entry; `FirstGestureUnlock` does not exist yet, and M04c wraps this call in it together with the video pool (DL-663).
  - Age and Blocked (§2.4 rules 1–4 and 7). The `AgeAttestationPort` stores the bracket in `UiPrefs.age`; M04b3 rebinds it to `IdentityService.attestAge`.
  - Terms card (rule 6): writes `PlatformSettings.telemetryConsent`; no telemetry before acceptance.
  - Main menu (items from `config/ui/nav.json`).
  - Continue and Load (slots, `NEWER_SCHEMA` read-only).
  - Mode select (§2.6 states and rules 1–5).
  - Profile (character section placeholder until M04b2).
  - Saves (every `SaveErrorCode` with message and action; export, import, undo; delete with type-to-confirm; usage bar).
  - Loading, Error (kinds of §2.3).
  - "Coming soon" for Garage, Help, NPC Builder, Community, Experiences, Online.
- **New Game** (DN-S10-03): name entry → `SaveService.createProfile` (reusing the active profile if it has no story data) → the creator placeholder step, which M04b2 replaces → `mode.start story`.
- **Settings** (§2.9): every row in the categories Graphics, Controls (kbm and gamepad tabs; touch and VR read-only notes until M04b2/M11b2), Audio, Subtitles, NPC voices and AI dialogue, Cutscenes, Accessibility (reduced motion initialised from `prefers-reduced-motion` at profile creation), XR comfort (collapsed note unless XR-capable), Camera, Language, Data and privacy (Forget me and Export my account data are disabled with "Available in a later update"; M12a2 enables them for every profile with a play token, together with Forget NPC memories on the NPC voices and AI dialogue row, DL-548), Install and storage, About.
  - Profile scope: debounced 500 ms into `save.settings`.
  - Device scope: into `PlatformSettings` or `UiPrefs`.
  - Every row has a scope badge.
- `UiPrefs` store (IndexedDB `dv-ui`, try/catch with in-memory fallback, plus the mirrored `localStorage` block key).
- Telemetry `ui.page` and `ui.onboard` (registry props) after consent only.
- **QA play bypass** (DL-650; QA builds only, `VITE_DV_QA=1`): the S11 `QaFlags` parser (`packages/engine/src/platform/qa-flags.ts`) gains `play: 'sandbox' | 'story' | 'off' | null` from `?play=`; with no `?play=`, the QA-only `localStorage` key `dv-qa-play` supplies it, and `?scenario=<id>` implies `sandbox` (so the device checklist URLs `?perf=1&tier=…&scenario=…` of M02b2 and M03b1 still reach play). With `sandbox` or `story` the shell records an in-memory 18+ attestation and Terms acceptance (nothing persisted to `UiPrefs` or `PlatformSettings`, telemetry consent left at its default), creates a throwaway in-memory profile, calls `AudioService.unlock()` on the first input (M04c moves this to `FirstGestureUnlock`, DL-663) and sends `mode.start` for that id, so the app reaches `InMode` with no gate page; `off` or no value runs the normal flow. Production builds ignore the flag and the key. Playwright: `playwright.config.ts` and `playwright.perf.config.ts` set config-level `use.storageState` to an object whose `origins` entry for the base URL holds `dv-qa-play=sandbox`, so every existing engine spec (`boot`, `fp-tp`, `platform-host`, `perf-budget`, `@graybox`, `@touch`, `@pack-*`, `@world-*`, `@vehicle*`, `@pursuit`, …) keeps loading straight into play with no spec edit; specs that need the gates (`tests/e2e/ui/*`, the title, credits and legal tests of `tests/e2e/shell.spec.ts`) opt out with `test.use({ storageState: { cookies: [], origins: [] } })`. `tests/e2e/engine/modes.spec.ts` (M04a2 `@modes`) already opts out the same way and loads `/?play=off` (both inert before this milestone; M04a2 Notes): it sends its own `mode.start {id: 'sandbox'}` and `mode.quit` and asserts the booted scenario unchanged (M04a2 AC-10, AC-12), so a bypass that had already started `sandbox` would make C06 rule 1 refuse a second top-level mode; with the bypass off the engine still boots behind `Title` (`sim.worker` started, `10-ui.md` §2). If the branch's `modes.spec.ts` lacks the opt-out, add it (the one engine-spec edit AC-15 allows) and record a `BD-NNN` row.

## Scope out
- Character creator, HUD, phone and pause, touch layouts and editor, coach mark, help page, garage frame, `UiSurface`, `GameModeUI` host: M04b2.
- Identity service, play token and identity chips beyond "This device only": M04b3. Account pages, cloud saves and the conflict choice UI: M12a1/M12a2.
- XR panels in a headset: M11b1. Mode settings panels: their mode milestones.
- `AgeSignalProvider` wiring: M14b2 (the v1 provider returns `null`).

## Deliverables
- `packages/ui/src/shell/{types.ts, machine.ts, registry.ts, gates.ts, banners.tsx, prefs.ts}`.
- `packages/ui/src/kit/{focus.ts, overlays.tsx, widgets.tsx}`.
- `packages/ui/src/screen/{types.ts, dom-screen.tsx, canvas-screen.ts}`.
- `packages/ui/src/i18n/index.ts`; `content/ui/i18n/en.json`; `config/ui/nav.json`.
- `packages/ui/src/pages/{gate.tsx, main.tsx, saves.tsx, modes.ts, system.tsx}` (gate = title, age, blocked, terms; saves = load, profile, saves, new game; system = loading, error, coming soon).
- `packages/ui/src/pages/settings/{index.ts, display.ts, controls.tsx, audio-access.ts, privacy-storage.ts}`.
- `packages/ui/test/{ui-shell.spec.ts, ui-screen-parity.spec.ts, modes-tiles.spec.ts, saves-ui.spec.ts, settings-bind.spec.ts}` (`ui-shell.spec.ts` also holds the `10-ui.md` §9 `ui-i18n` cases and the `10-ui-pages.md` §9 `age-gate` unit cases, DL-650).
- `tests/e2e/ui/{menus.spec.ts, age.spec.ts, a11y.spec.ts}` (tags `@ui-menus`, `@ui-age`, `@ui-saves`, `@ui-a11y`).
- `tools/ci/check-i18n.ts` and root script **`check:i18n`** (`tsx tools/ci/run.ts …`; new, DL-230); `apps/web/src/routes.ts`.
- Edited for the QA play bypass (DL-650): `packages/engine/src/platform/qa-flags.ts` (`play`), `playwright.config.ts`, `playwright.perf.config.ts` (`use.storageState`), `tests/e2e/shell.spec.ts` (gate-dependent tests opt out).
- `packages/ui/test/fixtures/iphone-landscape.json`, the iPhone-landscape design fixture of `10-ui-hud-xr.md` §2.9 rule 3, copied exactly (`{viewport, insets}`; data, not counted); `@ui-menus` sets its touch viewport from it and M04b2 AC-3 validates layouts against it.
- `packages/shared/schemas/telemetry/names.schema.json` (`$defs` `ui.onboard {step, outcome}`, both strings ≤ 32 chars from the onboarding step and outcome enums; `ui.page` is M00a's) and `ui.onboard` removed from `pending.json` (DL-693; data, not counted).
- `content/legal/terms.json` (and `privacy.json` if the shell text needs it): replace M00e's interim content with the game's pre-release terms (Terms card text, telemetry consent paragraph), keeping the `LegalDocRes` shape; bump the value of `TERMS_VERSION` in `config/terms.ts` when the text changes (DL-602).
- Dependencies: `preact` and `@axe-core/playwright` (dev), at the versions pnpm resolves, recorded in `spec/03`.
- About 41 files (35 new, `package.json`, five edits; DL-650, DL-602).

## Interfaces
- C06 1.1: `UiBridge`, `ViewModelSource`, `UiCommand` (`mode.start`, `mode.quit`, `save.*`), `GameModeDescriptor.tile`, `status`, `unlock`, `GameModeUI.summary?`. Consumed, no change.
- C05 1.1: `ProfileSettings` fields (incl. 1.1 `npc?` and `cutscenes?`), `SaveErrorCode`, `ProfileMeta.lastSave`.
- C13 1.1: `PlatformSettings` (incl. `telemetryConsent`, `dev?`), `QualityService.setTier` at safe points.
- C16 1.1: `ui.page`, `ui.onboard`. No new names.
- UI-internal (not contracts): `PageDef`, `ScreenDef`, `UiPrefs`, `AgeAttestationPort`.

## Acceptance criteria
- AC-1 Given the gate table fixtures When gates are evaluated Then all of these hold:
  - a false flag gives `hidden`;
  - offline gives `disabled` with the Offline reason;
  - `region: 'blocked'` hides online pages;
  - a tier too low returns a CTA;
  - every registered page of this milestone is reachable from the main menu.
  — proof: `pnpm check:unit -- packages/ui`
- AC-2 Given a fresh device on `en-US` When a birth date 17 years before today is entered Then the fields appear in month/day/year order with no threshold text and no prefill, the Blocked page shows with no back or retry control, and a relaunch shows Blocked again. Neither session sends a request to `/api/v1/*` or a telemetry batch. A date exactly 18 years ago today passes, and an impossible date shows "Enter a valid date" — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-age`
- AC-3 Given the Terms card When it opens Then both telemetry toggles default on and write `PlatformSettings.telemetryConsent`. Declining returns to Title, no `ui.*` event exists before acceptance, and a changed `termsVersion` re-shows only the Terms card — proof: `pnpm check:unit -- packages/ui`
- AC-4 Given an attested profile When the menu flow title → main → settings → controls → back → modes → back runs by keyboard only, then by a simulated standard-mapping gamepad Then every step is reachable, focus is always visible, `UiBack` pops each page, and Pause cannot be rebound to nothing — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-menus`
- AC-5 Given the touch viewport of the design fixture `packages/ui/test/fixtures/iphone-landscape.json` (`10-ui-hud-xr.md` §2.9 rule 3; a design fixture, not a device fact) When the same flow runs by taps Then it completes and every tapped target is at least 44 × 44 CSS px — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-menus`
- AC-6 Given every flat page of this milestone When axe scans each one Then there are zero critical or serious findings — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-7 Given the code and catalogs When the i18n and name gates run Then every `t()` key exists in `en.json`, the report lists zero missing English keys, and no catalog or page contains the display-name literal (only `{brand}`) — proof: `pnpm check:i18n && pnpm names:lint`
- AC-8 Given a fixture registry with `ready`, `locked`, `comingSoon`, `unavailable` and hidden modes When the tiles render Then each matches the §2.6 table. `comingSoon` is focusable but not activatable, one unlock event raises one toast and a NEW badge, and `?unlockAll=1` is ignored when `VITE_DV_QA` is unset — proof: `pnpm check:unit -- packages/ui`
- AC-9 Given profiles When New Game runs Then a new profile is created (or the active one is reused if it has no story data). `NAME_TAKEN` and `PROFILE_LIMIT` show inline, and every `SaveErrorCode` maps to a message key and an action — proof: `pnpm check:unit -- packages/ui`
- AC-10 Given two tabs on one profile When the second tab loads Then it shows the other-tab banner and disables Play and save actions. Export then import-as-new then undo through the Saves page leave the profile list as before — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-saves`
- AC-11 Given each settings row When its control changes Then profile-scoped rows produce one `save.settings` command after 500 ms, device-scoped rows write `PlatformSettings` or `UiPrefs`, each row shows its scope badge, and a profile created under `prefers-reduced-motion: reduce` starts with `reducedMotion: true` — proof: `pnpm check:unit -- packages/ui`
- AC-12 Given every registered `ScreenDef` When it renders through `DomScreen` and `CanvasScreen` Then the flattened focusable lists are identical — proof: `pnpm check:unit -- packages/ui`
- AC-13 Given the production build When bundle budgets run Then the shell entry chunk is ≤ 120 KiB gzip, pages are separate lazy chunks, and no file exceeds the precache cap — proof: `pnpm build && pnpm check:bundle`
- AC-14 Given the branch When the dist verifier and the preview deploy run Then they pass, and the deployed app opens on Title with the age screen on first launch — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-15 Given the QA play bypass (DL-650) When the earlier suites run after the shell lands Then the full `chromium-webgl2` e2e suite passes in both `GRAYBOX_GREP` halves (the string M02b1 commits in `tests/e2e/graybox-grep.txt`, DL-656, DL-680) and `check:perf` passes with no edit to an engine spec (except the `modes.spec.ts` opt-out if M04a2 did not ship it; `@modes` runs with the bypass off); in `ui-shell.spec.ts` a QA build with `?play=sandbox`, with `dv-qa-play=sandbox`, or with `?scenario=<id>` reaches `InMode` with no gate page and persists no attestation, Terms acceptance or profile, `?play=off` shows Title, and a build without `VITE_DV_QA` ignores both the flag and the key — proof: `pnpm check:unit -- packages/ui && pnpm map:build -- --area synth && G=$(cat tests/e2e/graybox-grep.txt) && pnpm check:e2e -- --project=chromium-webgl2 --grep "$G" && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep-invert "$G" && DV_WORLD=synth pnpm check:perf`

## Test plan
- **Unit** (`pnpm check:unit -- packages/ui`): `ui-shell` (with the i18n, age-gate and QA play cases), `ui-screen-parity`, `modes-tiles`, `saves-ui`, `settings-bind`.
- **Regression** (AC-15): the full `chromium-webgl2` e2e suite in both `GRAYBOX_GREP` halves and `check:perf`.
- **E2E:**
  - `@ui-menus` on `chromium-webgl2` and `webkit-webgl2`;
  - `@ui-age`, `@ui-saves` and `@ui-a11y` on `chromium-webgl2`.
- **Static:** `pnpm check:i18n`, `pnpm names:lint`, `pnpm check:bundle`.
- **Device:** none required; M04b2's iPhone checklist covers the menus on hardware.

## Demo script
1. Open the preview URL in a fresh profile: Title, tap, the age screen.
2. Enter an adult date and accept Terms (toggles on): the main menu.
3. New Game: enter a name, then the placeholder creator step: free roam starts.
4. Quit to the menu and open Modes: Story ready; Racing, Fighter and Tycoon "Coming soon".
5. Settings › Controls: rebind Jump; clearing Pause is refused.
6. In a new private window, enter an under-18 date: Blocked; reload: still Blocked.

## Effort
1 Builder session; about 41 files (DL-650, DL-602); risk **medium**. Focus navigation and the settings breadth are the main work; keep settings as data-driven `ScreenDef`s.

## Risks & fallbacks
- **File count.** Settings categories share files by design; add no page files.
- **axe findings in the kit.** Fix in the kit, never by suppressing a rule. A finding that comes from a third-party element is listed in the report.
- **Gamepad simulation in Playwright.** Inject standard-mapping gamepad state through the M01b1 binder's test hook. If the hook is missing, drive `InputRouter.onClientAction` from the bridge and record it.

## Notes for the Builder
- Read first: `10-ui.md` §2–§3 and §5; `10-ui-pages.md` §2.3–§2.9, §4.3, §5, §9; `01-engine-save-modes.md` §C05 (error codes, profiles); DL-139, DL-140, DL-141; `research/legal-ip-likeness.md` §5.3 (neutral age screen) as cited by S10.
- Facts: F-004, F-011 (no install prompt on iPhone; the Install row shows the coach-mark steps text), F-010 (storage usage panel). The age-gate rules are design rules from the cited research, not external API facts.
- Order of work: shell types and machine, kit focus, ScreenDef renderers, i18n, Title/Age/Terms, the QA play bypass (keep the existing e2e suite green from here on), main, saves and New Game, modes, settings, banners, e2e, bundle.
- No telemetry and no API call from a blocked device. The block check runs before any `/boot` fetch on relaunch.
- **Owner PR #1 (DL-650 part 2).** `origin/claude/build` carries the owner-merged password accounts (d853294): routes `/api/v1/auth/{signup,login,refresh,logout,me}` in `services/edge/src/routes/auth.ts`, the `Account` page, the `account` member of `Route`, its `routeFor` branch (`/account`, `/account/signin`) and the Title `Link` in `packages/ui/src/index.tsx`, and `SUPABASE_URL`/`SUPABASE_ANON_KEY` vars in `services/edge/wrangler.jsonc`. Its reconciliation (DL-OWN-04, ADR-ACCT-01, milestone M00e) is in this spec: do not start this milestone until M00e is merged into the code branch. M00e moves the page to the non-isolated `/account/` island (`apps/web/account/index.html`, `apps/web/src/account/*`) and removes the SPA route, so the shell registers no `/account*` page and routing rule 1 never sees it (`10-ui.md` §2.5 rule 2: `/account/*` is a real document). This milestone never deletes or rewrites an owner PR #1 surface: it edits no file under `services/edge/` and not the `/account/` island; when it splits `src/index.tsx`, the Title link to the account page stays a full navigation (`location.assign`) to `/account/`, as M00e leaves it. If M00e has not merged when this session starts, stop and report rather than choosing. Owner-reconciliation ACs keep their numbers after AC-15 (AC-15 is DL-650's QA play bypass).
- **Terms version and password accounts (ADR-ACCT-01, DL-602).** `TERMS_VERSION` has one owner: `config/terms.ts`, created by M00e with interim Terms and Privacy documents in `content/legal/{terms,privacy}.json` that the Worker serves as route 66. The Terms card imports `TERMS_VERSION` from `config/terms.ts` (as `config/brand.ts` is imported for the display name) and records it per `10-ui-pages.md` §2.4 rule 7; this milestone replaces the document content and keeps the same constant, bumping its value when the text changes, which makes route 59 ask password accounts to re-accept at sign-in (M00e item 15). Add no second terms constant and do not touch `services/edge`. Keep `AgeGate` importable from an island entry without the game bundle; this milestone does not edit the `/account/` island (`apps/web/src/account/*`): M12a2 swaps its age screen for `AgeGate` (DL-640). The block lives in IndexedDB database `dv-ui` as key `ageBlocked`, mirrored to `localStorage['dv-ui-ageBlocked']` (each access in try/catch), and both the shell and the `/account/` island read it there.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). No genAI spend, no owner gate (Q-01 display name is applied from `config/brand.ts`).

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
- Through earlier milestones: M04a1 (`SaveService`, `readLastSave`), M01c (`QualityService`, `PlatformSettings` in `dv-platform`, `Benchmark`, telemetry client), M01e (`WorldPackStore` usage), M01b1 (`InputRouter`, `rebindCapture`), M00 (`packages/ui` scaffold, tokens, `BootScreen`, credits and legal stubs, the `en` catalog at `packages/ui/src/i18n/en.json`, `check:bundle`).
- Contracts: C06 1.1.0 (`UiBridge`, `ViewModelSource`, `UiCommand`, `GameModeDescriptor`), C05 1.1.0 (`ProfileSettings`, `ProfileMeta`, `SaveErrorCode`), C13 1.1.0 (`PlatformSettings`, `XrComfortSettings`), C03 1.1.0 (`ClientAction`, `ControlsSettings`), C16 1.1.0 (`ui.page`, `ui.onboard`).

## Scope in
- **Shell** (`packages/ui/src/shell/`): `PageDef`, `GateCtx`, `GateResult`, `ShellApi` (`10-ui.md` §3.1). The §2.4 state machine. Page registry with the §2.5 table rows for this milestone; later pages are registered with a "Coming soon" screen. History routing rules 1–4. Banners: offline, other tab, "Progress cannot be saved", not isolated. Safe points through `PwaUpdateController.markSafePoint`. `apiErrorToUi()` table (`10-ui-pages.md` §5.3).
- **Kit**: focus groups with roving tabindex and spatial navigation from `ClientAction` `UiUp/Down/Left/Right/Accept/Back/TabPrev/TabNext`, pointer targets ≥ 44 px on touch, toasts (queue 3, `unlock` and `error` persist up to 8 s, polite live region), dialogs, confirm, the `OnScreenKeyboard` for gamepad text entry.
- **ScreenDef**: types (§3.2), `DomScreen` (semantic HTML), `CanvasScreen` (Canvas 2D draw plus `pick`), and the parity test over every registered `ScreenDef`.
- **i18n**: `t()`, plural and number helpers through `Intl`, the fallback chain `lang → base → en`. The catalog moves from M00's `packages/ui/src/i18n/en.json` (with the keys M02c1 added) to `content/ui/i18n/en.json`, the `10-ui.md` §2.2 location later milestones write to; M00's `src/index.tsx` components are split into the shell and pages. Root script `check:i18n` is created here (M00 declared none; DL-230): missing keys, unused keys, stale-hash report, and a display-name literal check.
- **Pages:**
  - Title: gesture runs `FirstGestureUnlock` (M04c owns the video pool; here the audio unlock).
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
- **Settings** (§2.9): every row in the categories Graphics, Controls (kbm and gamepad tabs; touch and VR read-only notes until M04b2/M11b2), Audio, Subtitles, NPC voices and AI dialogue, Cutscenes, Accessibility (reduced motion initialised from `prefers-reduced-motion` at profile creation), XR comfort (collapsed note unless XR-capable), Camera, Language, Data and privacy (Forget me and Export my account data are disabled with "Available after you register a device", which lands in M12a1), Install and storage, About.
  - Profile scope: debounced 500 ms into `save.settings`.
  - Device scope: into `PlatformSettings` or `UiPrefs`.
  - Every row has a scope badge.
- `UiPrefs` store (IndexedDB `dv-ui`, try/catch with in-memory fallback, plus the mirrored `localStorage` block key).
- Telemetry `ui.page` and `ui.onboard` (registry props) after consent only.

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
- `packages/ui/test/{ui-shell.spec.ts, ui-screen-parity.spec.ts, ui-i18n.spec.ts, age-gate.spec.ts, modes-tiles.spec.ts, saves-ui.spec.ts, settings-bind.spec.ts}`.
- `tests/e2e/ui/{menus.spec.ts, age.spec.ts, a11y.spec.ts}` (tags `@ui-menus`, `@ui-age`, `@ui-saves`, `@ui-a11y`).
- `tools/ci/check-i18n.ts` and root script **`check:i18n`** (`tsx tools/ci/run.ts …`; new, DL-230); `apps/web/src/routes.ts`.
- Dependencies: `preact` and `@axe-core/playwright` (dev), at the versions pnpm resolves, recorded in `spec/03`.
- About 38 files.

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
- AC-5 Given the iPhone viewport (844 × 390, touch) When the same flow runs by taps Then it completes and every tapped target is at least 44 × 44 CSS px — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-menus`
- AC-6 Given every flat page of this milestone When axe scans each one Then there are zero critical or serious findings — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-7 Given the code and catalogs When the i18n and name gates run Then every `t()` key exists in `en.json`, the report lists zero missing English keys, and no catalog or page contains the display-name literal (only `{brand}`) — proof: `pnpm check:i18n && pnpm names:lint`
- AC-8 Given a fixture registry with `ready`, `locked`, `comingSoon`, `unavailable` and hidden modes When the tiles render Then each matches the §2.6 table. `comingSoon` is focusable but not activatable, one unlock event raises one toast and a NEW badge, and `?unlockAll=1` is ignored when `VITE_DV_QA` is unset — proof: `pnpm check:unit -- packages/ui`
- AC-9 Given profiles When New Game runs Then a new profile is created (or the active one is reused if it has no story data). `NAME_TAKEN` and `PROFILE_LIMIT` show inline, and every `SaveErrorCode` maps to a message key and an action — proof: `pnpm check:unit -- packages/ui`
- AC-10 Given two tabs on one profile When the second tab loads Then it shows the other-tab banner and disables Play and save actions. Export then import-as-new then undo through the Saves page leave the profile list as before — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-saves`
- AC-11 Given each settings row When its control changes Then profile-scoped rows produce one `save.settings` command after 500 ms, device-scoped rows write `PlatformSettings` or `UiPrefs`, each row shows its scope badge, and a profile created under `prefers-reduced-motion: reduce` starts with `reducedMotion: true` — proof: `pnpm check:unit -- packages/ui`
- AC-12 Given every registered `ScreenDef` When it renders through `DomScreen` and `CanvasScreen` Then the flattened focusable lists are identical — proof: `pnpm check:unit -- packages/ui`
- AC-13 Given the production build When bundle budgets run Then the shell entry chunk is ≤ 120 KiB gzip, pages are separate lazy chunks, and no file exceeds the precache cap — proof: `pnpm build && pnpm check:bundle`
- AC-14 Given the branch When the dist verifier and the preview deploy run Then they pass, and the deployed app opens on Title with the age screen on first launch — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm check:unit -- packages/ui`): `ui-shell`, `ui-screen-parity`, `ui-i18n`, `age-gate`, `modes-tiles`, `saves-ui`, `settings-bind`.
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
1 Builder session; about 38 files; risk **medium**. Focus navigation and the settings breadth are the main work; keep settings as data-driven `ScreenDef`s.

## Risks & fallbacks
- **File count.** Settings categories share files by design; add no page files.
- **axe findings in the kit.** Fix in the kit, never by suppressing a rule. A finding that comes from a third-party element is listed in the report.
- **Gamepad simulation in Playwright.** Inject standard-mapping gamepad state through the M01b1 binder's test hook. If the hook is missing, drive `InputRouter.onClientAction` from the bridge and record it.

## Notes for the Builder
- Read first: `10-ui.md` §2–§3 and §5; `10-ui-pages.md` §2.3–§2.9, §4.3, §5, §9; `01-engine-save-modes.md` §C05 (error codes, profiles); DL-139, DL-140, DL-141; `research/legal-ip-likeness.md` §5.3 (neutral age screen) as cited by S10.
- Facts: F-004, F-011 (no install prompt on iPhone; the Install row shows the coach-mark steps text), F-010 (storage usage panel). The age-gate rules are design rules from the cited research, not external API facts.
- Order of work: shell types and machine, kit focus, ScreenDef renderers, i18n, Title/Age/Terms, main, saves and New Game, modes, settings, banners, e2e, bundle.
- No telemetry and no API call from a blocked device. The block check runs before any `/boot` fetch on relaunch.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). No genAI spend, no owner gate (Q-01 display name is applied from `config/brand.ts`).

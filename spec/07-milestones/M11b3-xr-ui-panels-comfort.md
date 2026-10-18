# M11b3 — xr-ui-panels-comfort

## Goal
After this session the game's UI works inside the headset. S10's `UiSurface` draws `ScreenDef` pages with Canvas 2D into S11's `XrPanels`: crisp quad and cylinder layers on Quest, textured planes on Vision Pro. The anchors follow the spec: world-locked for Pause, mode select, settings, load and saves; lazy-follow for subtitles, toasts, tips and the comfort card; the non-dominant wrist for the phone home, the glance panel and Exit VR. A player-facing **Enter VR** button on the main menu and in Settings › Graphics starts the session from its click handler. The first entry shows the comfort card (locomotion, vignette, seated, height calibration). Comfort settings can be edited in XR. NPC dialogue shows as a diegetic bubble above the speaker with intent chips, the AI badge and the safety and likeness cards. Pages that need text entry or the flat screen show an "Exit VR to continue" panel (DL-142). Per-mode XR panels follow in M11b2 and M11b4.

## Requirements
- R-PLAT-02: the XR port gets a usable in-headset UI (menus, phone, settings, comfort) without a screen-space HUD.
- R-UI-02: the XR comfort settings are editable in the headset as well as on the flat Settings page, and persist with the profile.
- R-NPC-05 (XR half): AI dialogue in the headset keeps the persistent AI badge, the safety card and the likeness disclaimer [research/INDEX.md §4 rule 19], and every talk step completes with intents alone (`04-npc.md` §6).
- R-ENG-04: comfort defaults, text of at least 1.5° of visual angle, 64 px targets, no head-locked UI, no hover dependence, and no animated motion when reduced motion is on.

## Depends on
- **M11b1** (`XrSessionController`, the "XR armed" state, `XrPanels` with registration, ray picking, `XrInputRouter`).
- **M06a5** (`DialogueBubble`, `IntentChoices`, `SafetyCard`, `LikenessCard`, the dialogue session and its `hud.subtitle` feed).
- Also used: M04b1 (shell, menus, Settings pages, focus navigation, i18n, `check:i18n`), M04b2 (`UiSurface` skeleton, phone and pause registry, HUD view-model keys, wrist and glance data), M04a1 (C05 `ProfileSettings.xr`).
- Contracts: C13 1.1.0 (`XrPanels`, `XrPanel`, `XrComfortSettings`), C06 1.1.0 (`UiBridge`, `ViewModelSource`, `UiCommand` `save.settings` and `pause`), C05 1.1.0 (`ProfileSettings.xr & {heightCalibM}`).

## Scope in
- **`UiSurface`** (`10-ui.md` §3.4; `10-ui-hud-xr.md` §2.12):
  - `panel(screen, {anchor, pixelsPerMetre: 1024})` returns an `XrPanel` registered through `XrPanels.add`.
  - Redraw happens only when a view-model value or focus changes (dirty flag), at most 30 Hz. At most 4 panels are visible at once, with about 2 MP of panel pixels on Quest; these are starting values, and the run records the device result.
  - Fonts are loaded with `FontFace` before the first draw.
  - Text height ≥ 1.5° of visual angle: 32 px at 1.2 m with 1,024 px/m, scaled with `uiDistanceM`. Targets ≥ 64 px.
  - A 150 ms selection debounce. Hover is drawn for controllers and hands only; Vision Pro selects on pinch with a pressed state and a click sound.
  - Sliders take a ray drag. Choices are segmented controls or lists, never native selects.
- **Anchors:**
  - `world`: placed at `uiDistanceM` in front of the head when opened, yaw-aligned, then fixed; closed explicitly. Used for Pause, mode select, settings, load and save slots.
  - `lazy-follow`: moves only when the gaze leaves a 35° dead zone, easing over 400 ms. Used for subtitles (two lines at about 40 % below the view centre, with speaker names), toasts, tips and the comfort card.
  - `wrist`, on the non-dominant hand (`XrComfortSettings.dominantHand`): the phone home, a glance panel (minimap tile 512 px north-up from `hud.map`, heat, cash, objective) and Exit VR. A raised-wrist glance does not pause; opening an app creates a `world` panel and pauses the single-player sim.
- **Enter VR button.** It appears on the main menu and in Settings › Graphics only while M11b1 reports "XR armed". Its click handler calls `XrSessionController.enter()` synchronously, with nothing awaited before it. A rejection shows a toast. Exit VR is on the wrist panel and in Settings. When the session ends, the flat page the player left is restored.
- **Comfort card** on the first entry of a profile (lazy-follow):
  - Teleport + snap turn (recommended, default) or Smooth locomotion; vignette level; seated toggle.
  - Height calibration: "stand straight, press the trigger / pinch" writes `xr.heightCalibM`.
  - Values are saved through `UiCommand {t:'save.settings'}`.
  - Vision Pro with hand tracking denied shows "Hand tracking is off — gaze and pinch still work".
- **Settings in XR.** Settings › Comfort renders as a world panel that edits every `XrComfortSettings` field within its ranges. Settings › Controls › VR shows the XR bindings read-only; capture-based remap is M11b2's.
- **NPC dialogue in XR** (`10-ui-hud-xr.md` HUD in XR: "NPC dialogue → bubble above the NPC with the AI badge"; `04-npc.md` §6):
  - A `ScreenDef` for M06a5's `DialogueBubble`, drawn through `UiSurface` on a diegetic panel above the speaker's head (yaw-facing the player, world-placed, never head-locked). It reuses M06a5's dialogue session; nothing in the dialogue flow changes.
  - It carries the intent chips as 64 px targets selected by ray or pinch. There is no free text in XR (DL-142). It also carries the persistent AI character badge for the whole exchange, the safety card (M06a5 trigger rules) and the first-meet `LikenessCard`.
  - The streamed line's subtitle goes to the lazy-follow bar through `hud.subtitle`.
- **Flat-only pages (DL-142).** Creator, NPC builder, forum, experiences and mods, legal, help, account, and the age and terms screens are not rendered in XR. Navigating to one shows an exit panel, "This page needs the flat screen. Exit VR?", with Exit and Stay.
- **Motion.** Camera shake, FOV effects and animated panel motion are off in XR. Fades are ≤ 300 ms, and 0 with reduced motion.
- **Device rows (not run here).** Legibility at 1.2 m, ray and pinch selection, wrist glance, the comfort card, the exit panel, Enter VR from a click and the hand-tracking denial card run as rows of M11b4's `M11b4-{quest3,visionpro}` checklists (DL-229).

## Scope out
- Racing, fighter and tycoon XR panels, and the XR remap capture (M11b2, M11b4).
- The XR cutscene skip and subtitle layer under the cinema screen (M11b4, with `XrMediaHost`).
- A system keyboard in XR (flat-only, DL-142).
- Accessibility-tree support for canvas panels: a stated limitation (`10-ui-hud-xr.md` §2.13 item 11).

## Deliverables
- `packages/ui/src/xr/{surface.ts, draw.ts, widgets.ts, anchors.ts, wrist.ts, glance.ts, comfort-card.ts, exit-panel.ts, enter-vr.tsx, routing.ts, dialogue-bubble.ts}` (11 files).
- Edits: main menu and Settings › Graphics (Enter VR), Settings › Comfort and Controls › VR (XR view), the shell router (flat-only guard).
- `content/ui/i18n/en.json` keys.
- `packages/ui/test/{xr-surface.test.ts, xr-anchors.test.ts}`.
- `tests/e2e/xr/{xr-panel.spec.ts, xr-enter.spec.ts, xr-wrist.spec.ts, xr-comfort-card.spec.ts, xr-flat-only.spec.ts, xr-npc.spec.ts}` (all tagged `@xr` plus their own tag).
- About 26 files in all.

## Interfaces
- C13 1.1.0: `XrPanel` (`anchor: 'world' | 'wrist' | 'lazy-follow'`, `draw`, `onRay`), `XrPanels.add/remove/setVisible`, `XrComfortSettings`. The `XrSessionController.enter()` contract (M11b1) is called, not changed.
- C06 1.1.0 `UiBridge` and `ViewModelSource` (`hud.map`, `hud.wallet`, `hud.mission`, `hud.subtitle`) and M06a5's dialogue session (consumed as built); `UiCommand` `save.settings` and `pause`.
- C05 1.1.0 `ProfileSettings.xr`. No contract change.

## Acceptance criteria
- AC-1 Given IWER Quest 3 and a `ScreenDef` panel opened with anchor `world` When a simulated controller ray presses a button on it Then all of these hold:
  - the panel sits at `uiDistanceM` (1.2 m by default) in front of the head at open;
  - the button's action fires once (within the 150 ms debounce);
  - the computed line height is at least 1.5° at 1.2 m;
  - the panel redraws only after a view-model or focus change.
  — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-panel`
- AC-2 Given `chromium-webgl2` without `navigator.xr` and `xr-quest3` with IWER When the main menu loads and the first gesture has run Then the Enter VR button is absent on Chromium, and on `xr-quest3` it is present and clicking it calls `requestSession` during the click's activation, with the state reaching `presenting` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @xr-enter && pnpm check:e2e -- --project=xr-quest3 --grep @xr-enter`
- AC-3 Given a presenting session in free roam When the wrist glance is raised and then the Phone app is opened from the wrist Then the sim tick keeps advancing during the glance. Opening the app creates a `world` panel and pauses the sim. Exit VR on the wrist ends the session and restores the flat page — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-wrist`
- AC-4 Given a new profile When the player enters XR for the first time, picks Smooth, vignette `high` and seated, and calibrates height Then `ProfileSettings.xr` holds those values and `heightCalibM` > 0 after a `save.settings` command. After a reload and a second entry the card does not show and the values persist — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-comfort-card`
- AC-5 Given a presenting session When the router navigates to `/menu/creator` Then the exit panel appears instead of the page; "Stay" keeps the session; "Exit" ends it and the flat creator page renders — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-flat-only`
- AC-6 Given the UI unit tests When they run Then all of these hold:
  - a `head` anchor fails to type-check (an `@ts-expect-error` fixture);
  - the text-size helper yields at least 1.5° for every `uiDistanceM` from 0.8 to 2.0 m;
  - a fifth visible panel hides the oldest lazy-follow panel;
  - reduced motion sets every fade to 0.
  — proof: `pnpm check:unit -- packages/ui`
- AC-7 Given the new strings When the i18n report and the name gate run Then no key is missing and no catalog contains the display-name literal — proof: `pnpm check:i18n && pnpm names:lint`
- AC-8 Given `xr-quest3` with IWER, route 31 intercepted to replay M06a5's `talk-happy.sse`, and Act 1 mission `m.a1.04` at its talk step When the player opens the conversation and picks intent chips only with a controller ray Then all of these hold:
  - the bubble panel sits above the speaker and is not head-locked;
  - the AI character badge is visible for the whole exchange;
  - a `hud.subtitle` cue shows on the lazy-follow bar;
  - no free-text field exists;
  - the talk step completes.
  — proof: `pnpm check:e2e:xr -- --grep @xr-npc`
- AC-9 Given the branch When the production build, dist verification and the preview deploy run Then all pass, and the flat menus' a11y suite stays at zero critical or serious violations — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y && pnpm deploy:preview`

## Test plan
- **Unit:** `xr-surface`, `xr-anchors` (`pnpm check:unit -- packages/ui`).
- **E2E (`xr-quest3`):** `@xr-panel`, `@xr-enter`, `@xr-wrist`, `@xr-comfort-card`, `@xr-flat-only`, `@xr-npc`; M11b1's `@xr-*` specs stay green. `@xr-enter` also runs on `chromium-webgl2`.
- **Flat regressions:** `@ui-menus`, `@ui-a11y`, `@npc`.
- **Device:** none in this milestone (`_PLAN-2.md` row: gate none); the UI rows run in M11b4's device pass (DL-229).

## Demo script
1. `pnpm check:e2e:xr` passes.
2. On a Quest preview: Enter VR from the main menu, complete the comfort card, raise the left wrist, open Phone › Map, then Settings › Comfort, switch to Smooth, and Exit VR from the wrist.
3. Talk to an NPC in free roam: pick an intent chip on the bubble above the speaker and read the subtitle on the lazy-follow bar.
4. Open the creator from the pause panel and see the "needs the flat screen" panel.

## Effort
0.8 Builder session; about 26 files; risk **medium**. Canvas widget drawing and ray interaction are the main work; the anchors are small.

## Risks & fallbacks
- **Text is blurry on Quest scene planes** (when layers are not granted): raise `pixelsPerMetre` for that panel to 1,536 within the 2 MP budget. Record it for the device run.
- **Lazy-follow causes discomfort** in testing: widen the dead zone to 45° (a design value, logged as a Builder decision).
- **Overrun:** the XR Settings › Controls view and the hand-tracking denial card are the cut line; the card text still ships through a toast.

## Notes for the Builder
- Read first: `10-ui-hud-xr.md` §2.12–§2.13, §6, §9; `10-ui.md` §3.2–§3.4; `11-platform-xr.md` §4.2, §4.4, §5.1, §5.5; DL-142.
- **UNVERIFIED (recorded by a later device run, never asserted):** panel pixel and count budgets, a system keyboard in XR, and session `visibilitychange` for the Pause panel on headset removal (U-PLT-13).
- No head-locked UI exists: `XrPanel['anchor']` has no such value, and the type test keeps it so.
- **Secrets.** Only the deploy pair (SKIP and exit 0 when absent). **Gates.** None for CI; Q-13 applies to later device runs. No fal.
- Branch `m11b3-xr-ui-panels-comfort`.

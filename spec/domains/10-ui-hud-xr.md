# S10 — UI/UX Shell, part C: HUD, phone and pause, onboarding, touch layouts, XR panels, accessibility, localization

> Wave 4 · v0.1 · 2026-10-18 · continues `10-ui.md` (technology, `ScreenDef`, view models) and `10-ui-pages.md`. This part carries template §2 (numbered §2.9–2.14, written "C §2.n" elsewhere), §4 data (touch, HUD, phone, hints), §5–§10 for these subjects. R-IDs: R-ENG-04, R-PLAT-01, R-PLAT-02, R-PLAT-04, R-MAP-03, R-CUT-01, R-CUT-03, R-IP-03, R-IP-04, R-UI-03.

## 2. Design

### 2.9 (C) Touch layouts and editor (R-ENG-04; M04b2)

Touch is the iPhone-primary input. iPhone has no Pointer Lock, no haptics and no element fullscreen, so look is a right-half drag, feedback is visual and audible, and the game runs standalone [research/stack-rendering-platform.md §3.4–3.5; F-011]. Numbers follow C03 rule 10: stick radius 58 px, knob 26 px, sprint beyond 1.35 × radius, look gain 3.0, tilt-steer dead zone 10° and full at 45°, minimum hold 120 ms [research/repos-webport.md §3.6].

```ts
// packages/ui/src/hud/touch.ts   (layout files: config/input/touch/<id>.json, JSON Schema validated)
export interface TouchLayout { v: 1; id: string; nameKey: LocKey; context: 'onFoot' | 'vehicle' | 'fighter'; handed: 'right' | 'left'; widgets: TouchWidget[] }
export type Anchor = { corner: 'bl' | 'br' | 'tl' | 'tr'; dx: number; dy: number };   // CSS px from the safe-area corner
export type TouchWidget =
  | { id: string; kind: 'stick'; role: 'move' | 'steer'; zone: Rect }                // floating origin inside zone
  | { id: string; kind: 'lookzone'; zone: Rect }
  | { id: string; kind: 'button'; action: ActionId; at: Anchor; sizePx: number; icon: string; label?: LocKey; toggle?: boolean }
  | { id: string; kind: 'pedal'; axis: 'throttle' | 'brake'; at: Anchor; w: number; h: number }
  | { id: string; kind: 'dpad'; at: Anchor; sizePx: number };
```
**Shipped layouts:** `default-right`, `default-left` (mirror), `compact` (smaller targets for small phones), `one-handed` (accessibility: all actions within one thumb's reach, auto-run toggle, look by a drag zone), and up to four `custom:1…4` stored in `UiPrefs.customTouchLayouts`. **Defaults per context** (from gamedesign §6): on foot — left floating stick (Move; push past 1.35 × radius sprints), right-half look, buttons Jump, Interact/Enter, Attack, Block, Special, Camera, Phone, Pause; vehicle — right pedals (throttle/brake, full value on press), steer on the left stick or tilt (opt-in), buttons Handbrake, Nitro, Horn, Look-behind, Camera; fighter (Simple scheme) — left stick, four buttons Light/Heavy/Special/Assist, a Hype button; Classic is hidden on phones by default [research/gamedesign-decomposition.md §4.10].

**Rules.**
1. One pointer id per widget; `pointercancel`, `blur` and `visibilitychange` release everything (C03 rule 4). Up to five simultaneous contacts are tracked (design value).
2. The touch layer sets `touch-action: none` and disables text selection and the long-press callout so browser gestures never fire during play.
3. Widgets are placed inside `env(safe-area-inset-*)`; each target is at least 44 × 44 CSS px (the 24 px WCAG 2.2 AA floor [w3.org SC 2.5.8] plus margin) and button spacing at least 8 px. Layout validation and the iPhone-landscape tests use one committed **design fixture, not a device fact**: `packages/ui/test/fixtures/iphone-landscape.json` `{ "viewport": { "width": 844, "height": 390 }, "insets": { "top": 0, "right": 48, "bottom": 24, "left": 48 } }` (CSS px; the viewport is the touch viewport the code branch's `tests/e2e/touch.spec.ts` already uses, the insets are deliberately generous design values). No research gives the iPhone 15 landscape CSS viewport or its `env(safe-area-inset-*)` values (U-UI-10); the M04b2 iPhone run records them and the Architect updates the fixture from that run.
4. Tilt steering needs the browser's motion-sensor permission; the permission prompt is shown only after an explainer and only when the player turns tilt on (UNVERIFIED on iOS standalone; the toggle falls back to the stick if denied).
5. Press feedback is visual (scale 0.94 for 80 ms, none under reduced motion) and audible (`ui` bus tick, off by default); there is no vibration on iPhone.
6. **Editor** (Settings › Controls › Touch › Edit layout; landscape only, the rotate overlay shows in portrait): widgets are draggable; size slider 40–96 px; opacity 20–100 %; snap grid 8 px; overlap and safe-area warnings; "Test" mode runs the layout against a dummy pad; Reset; Save as `custom:n`. Each widget also has numeric X/Y/size steppers so the editor is operable by keyboard and screen readers.

### 2.10 (C) HUD framework, per-mode HUDs, overlays, phone and pause (R-UI-03, R-MAP-03, R-CUT-01)

**HUD layer.** One DOM grid with six regions: `tl` (mission, area banner), `tr` (clock/weather, cash, save indicator, heat), `bl` (minimap), `br` (vehicle cluster or ability), `bc` (interaction prompt, subtitles), `c` (crosshair dot in first person, hit markers). Padding is `max(safe-area, hudSafeMarginPct)`; `hudScale` and `hudOpacity` from `UiPrefs`. Z-order: canvas < cutscene video < HUD < prompts/subtitles < phone/pause < modals < toasts < system banners. Entering a cutscene hides the HUD except subtitles, skip hint and the AI chip.

**Shared widgets** (`@dv/ui/hud`): `HeatStars`, `Wallet`, `Minimap`, `ObjectiveTracker`, `InteractionPrompt`, `AreaBanner`, `ClockWeather`, `VehicleCluster`, `HealthBar`, `Subtitles`, `SaveIndicator`, `NetStatus`, `Toasts`, `MeterBar`, `Timer`, `Countdown`, `Banner`. Every status widget pairs color with an icon, shape or text. Data comes from §3.3 view-model keys; high-rate numbers update `textContent` through refs.

| Mode | HUD content (owner of values) | Notes |
|---|---|---|
| **Story / free roam** (S10 builds; M04b2, bound in M05c) | `HealthBar` when damaged or in combat; `Wallet` appears 4 s on change; `ObjectiveTracker` (title, objective, timer already scaled by `timerScale`, assist chip); `HeatStars` 0–5 as five heat bars (no star glyphs, M04e5) plus a distinct scripted-6 icon, phase label *Pursued / Searching / Cooling down* with a ring for cooldown progress (C06 `HeatState`); `Minimap`; `AreaBanner` on neighborhood change; `ClockWeather`; `InteractionPrompt` from the snapshot side block (glyph of the active device, hold ring `progress`, unavailable reason text); `SaveIndicator`; `Subtitles` | Heat and the prompt arrive in the C02 snapshot side block, not as patches [01-engine-contracts.md §C02] |
| **Racing** (S06 builds on the kit; M07a) | speedometer + tach (digital default, analog option), gear, position "3 / 8", lap counter, lap and split timers, delta vs ghost/best with ▲/▼ symbols, nitro meter, route line and checkpoint arrows on the minimap, wrong-way warning (icon + text), 3-2-1-GO countdown, pursuit stars with unit count, results screen (medal, purse, retry/next) | Reduced motion: no zoom or shake on the countdown; photo mode hides the HUD (M07b) [research/gamedesign-decomposition.md §3.8] |
| **Culture Wars** (S07; M08a) | mirrored health bars, round pips, timer, Hype/Composure meters, combo counter, portraits and names, KO/round banners, training overlay (input display, frame meter, hit/hurt boxes), pose mode: camera preview thumbnail with a mandatory "camera active" indicator, calibration steps, "move into frame" prompt | Touch uses the Simple pad (§2.9). No screen flash above the §2.13 limit |
| **Business Tycoon** (S08; M09a) | full-screen mode UI, not an overlay: dashboard (cash/runway, MRR, users, burn), cap-table view, hiring board, roadmap sliders, event inbox, pitch room overlay (subtitles, mood meter, term-sheet card), board meeting, run summary | UI-first; every chart has a table twin (`table` widget); "pause on events" option; XR uses desk panels (§2.12) [research/gamedesign-decomposition.md §5.8] |
| **Sandbox** | persistent chip "Sandbox · progress doesn't count"; no mission widgets | Menu is the Sandbox phone app (below) |
| **Experience (mod)** | host chrome only: title strip with Exit, Report, "Mods active" chip; the mod's own UI mounts in its sandbox | UI-tier mods run in an opaque-origin iframe (C14); their interface is never trusted to cover the chrome |

**Dialogue and cutscene overlays.**
1. `DialogueBubble` (M06a): speaker name, line text shown with the audio (streamed `line.delta` text is revealed progressively but never faster than the audio plays; the full line is always available), intent choices as buttons, a persistent **AI character** badge, a Report button, and for decline cases the fixed out-of-character safety card with a crisis resource (988 in the US) [research/legal-ip-likeness.md §5.2]. A `fallback` event swaps in the offline ink line without any error UI.
2. `LikenessCard` on first sight of a parody or fictionalized NPC (text from `likeness.disclaimer.<tier>`).
3. `CutsceneOverlay` (M04c): skip button (controller button or pinch in XR) → `cutscene.skip`; subtitles from `subs.<lang>.vtt` or the in-engine director's cues; an **AI-generated** chip for the whole clip when the manifest says `provenance.aiGenerated`, absent for in-engine fallback sequences (R-CUT-01, R-CUT-03) [06 §4.4 C09]. Subtitle timing: a cue stays at least `max(1.5 s, 0.06 s × characters)` (design value) and never leaves before its audio ends.

**Map (phone app and full map).** The shell hosts the canvas; drawing is S02's `FullMapView` / `MinimapView` (Canvas 2D from `sf-map.v1.bin`, D-25). S10 supplies layout, controls (pan, pinch, zoom 0.25–8 m/px, search box, waypoint, legend, fast travel where the story allows) and the OSM attribution in the full-map corner that collapses to an "(i)" after 5 s [research/auth-ugc-input-maps.md §5.7]. Blips use distinct shapes as well as colors. East Bay, Marin and the Peninsula appear as labeled silhouettes "Coming later" (R-MAP-02). Published experiences appear as markers (moderated only) with a marker card (name, rating, **Report**, **Play**).

**Phone and pause (U-24).** Two entries share one registry: `client.Pause` opens **Pause**; `client.Phone` opens **Phone**. In single player both pause the sim (C02 rule 3); when `ctx.net` is non-null they become non-pausing overlays. Pause: Resume · Save (enabled at a safehouse, otherwise disabled with "Save at a safehouse"; shows the last save line) · Load · Phone · Settings · Help · Report a problem (copy diagnostics) · Quit to menu (confirm; autosave on mode exit; warns about progress since the last checkpoint). Phone apps are `PhoneAppDef`s:

```ts
export interface PhoneAppDef { id: string; titleKey: LocKey; icon: string;
  gate: (c: GateCtx) => GateResult;                  // flags, unlocks, mode
  screen: () => ScreenDef | Promise<{ default: PageComponent }>;   // ScreenDef = XR-capable
  xr: 'panel' | 'none'; pauses: boolean; milestone: string }
```
Apps: **Map**, **Contacts/Messages** (scripted texts; NPC chat threads from M06), **Jobs** (missions, races, fights; unlocked modes appear here with their start button), **Garage** (call a car), **Ride** (robotaxi fast travel), **Camera** (photo objectives, selfie, photo mode), **Feed** (parody social feed), **Bank** (cash, property income, tycoon dividends), **Sandbox** (visible only in the sandbox), **Settings**, **Help** [research/gamedesign-decomposition.md §2.10]. Apps whose systems are not shipped register as `comingSoon` tiles (A-06 pattern). Camera and Feed stay `comingSoon` in v1 (`01-product.md` §12, DL-292); story photo objectives use the in-world `photo` context.

**Sandbox menu** (our own sandbox feature set, chosen from the `research/repos-grand-v.md` §3 checklist and re-implemented in our words; no trainer wording, no third-party game data; disabled in story missions and refused while `ModeContext.net` is set, M04e0) [research/gamedesign-decomposition.md §7.7; DL-716, DL-718]. The sections, their grouping and their order are our own phone-app layout, not a checklist's menu tree (DL-732). Sections and owners: *Player* (heat 0–5 and heat lock `sandbox.player.neverWanted`, M04b2, worded by M04e5; can't get hurt, big jumps and patch-me-up, M04e4), *Appearance* (the creator, M04b2), *Emotes* (M10f), *Cars* (spawn by handling class, at most 8 session cars `veh:sbx<n>`, M04e3; repair, upright, dismiss and no-damage, M04e4; free tuning, M07b3), *Teleport* (SF landmarks, map pin, previous spot, saved positions ≤ 32) and *Display* (hide HUD, hide minimap) (M04e2), *Weather*, *Time* and *World* (presets `clear, karl-fog, overcast, rain, smoke, golden` held until Natural; hour, pause, wall-clock sync and our San Francisco fog-day shortcuts; world speed, blackout, density) (M04e1), *Create* (prop placer, M13b3). Settings go through `UiCommand sandbox.set` into the `sandbox` slice, one storage place per path: `SandboxSlice.clock` and `SandboxSlice.weather` for time and weather, `toggles` for the rest. One-shot actions go through `mode.cmd {mode:'sandbox'}` to the sandbox sim's `onEvent` table `SANDBOX_ACTIONS` (M04e1). Session cars and the session flags (`sandbox.player.godMode`, `superJump`, `sandbox.vehicle.noDamage`) are never saved (M04e3, M04e4). Refusals and preconditions show translated toasts by key in our own wording (`world.teleport.notLoaded`, `sandbox.refuse.*`, `sandbox.status.*`); the `trainer-*` patterns of `config/ip-denylist.json` keep trainer wording out (M04e5, DL-717). Declined: gravity, weapons (D-30), night and thermal vision (DL-292), endless stamina, no-ragdoll, clean, lock (DL-718, DL-730). In XR the sandbox menu is a `ScreenDef` panel.

**Report button.** `ReportButton` is a kit component required by `UgcSurface`; a lint test fails any component that renders user-generated content without it (§9).

### 2.11 (C) Onboarding and PWA prompts (R-PLAT-01, R-IP-04)

First-run sequence: Title → Age → Terms → profile name → creator → intro mission with contextual tips. Rules:
1. **Tips** (`content/ui/hints.json`, `HintDef { id; trigger: SimEvent type; devices: Record<DeviceKind, LocKey>; maxShows: 1 | 2; dismissOn: ActionId }`): move, look, sprint, camera toggle, interact, enter vehicle, phone, map. Each shows once (twice at most), disappears when the action is performed, uses the active device's glyphs, never overlaps the prompt region, and is off when `UiPrefs.showTips` is false or in XR (XR has the comfort card instead). Dismissals are stored in `UiPrefs.dismissed`.
2. **iOS coach mark** (D-16): a one-time card "Share → Add to Home Screen" on the first main-menu visit in a Safari tab (not standalone, detected with `matchMedia('(display-mode: standalone)')` and `navigator.standalone` when present), dismissible, remembered in `UiPrefs.dismissed` (try/catch). No `beforeinstallprompt` exists on Safari. A permanent entry stays in Settings › Install & storage. Install is a quality tier, never a gate [11-platform-pwa.md §3; research/stack-rendering-platform.md §3.1].
3. **Chromium install**: `beforeinstallprompt` is captured and exposes an Install button in Settings and a small chip on the main menu; after a dismissal the chip does not return for the session. Quest Browser uses the same path.
4. **Rotate overlay**: shown on touch devices in portrait while the input context is `onFoot`, `vehicle` or `fighter`; it covers the HUD, pauses the sim (`paused: true`), and clears on `screen.orientation` change (menus work in portrait) [11-platform-pwa.md §6].
5. **Camera explainer** (pose mode only): shown before the browser's permission prompt — what is processed, that frames stay on the device and are never recorded or uploaded, how to turn it off — with a visible camera-active indicator for as long as the camera runs, and a Settings revoke. Requires `privacy.cameraFeatures`; under a future teen path also `parentalConsent` [research/legal-ip-likeness.md §P1–P3].
6. **Persistence**: `navigator.storage.persist()` is requested by S11 after the story starts; S10 shows nothing unless the player opens Settings › Install & storage.
7. **Update**: `Update ready` toast with Restart at safe points only (§5 of part A).
8. **Welcome-back line** on the main menu: last save status; on `cold_resume` after iOS suspension no message is shown (normal), after `abnormal_exit` a one-time notice offers lower quality (S11 demotion text) [11-platform-pwa.md §9].

### 2.12 (C) XR UI (R-PLAT-02; skeleton M04b2, devices M11b1, per-mode M11b2)

DOM cannot render in `immersive-vr`, so XR UI is Canvas 2D drawn from `ScreenDef`s through `UiSurface` into S11's `XrPanel`s: crisp quad/cylinder layers on Quest (WebGL path) and textured planes on Vision Pro [11-platform-xr.md §5.5; DN-S11-03]. Head-locked UI is forbidden (`XrPanel.anchor` has no such value) [11-platform-xr.md §5.3].

| Anchor | Used for | Behavior |
|---|---|---|
| `world` | Pause, mode select, settings, load, save slots, Tycoon desk | placed at `uiDistanceM` (default 1.2 m) in front of the head at open, yaw-aligned, then fixed; closing is explicit |
| `lazy-follow` | subtitles, toasts, comfort card, tips | follows the head only after the gaze leaves a dead zone (35°, ease 400 ms; starting values †) |
| `wrist` | Phone/Pause home, glance panel (minimap tile, heat, cash, objective), Exit VR | on the non-dominant wrist (`XrComfortSettings.dominantHand`); raised-wrist glance shows a read-only panel and **does not** pause; opening an app creates a `world` panel and pauses (single player) |
| diegetic | cockpit gauges on the vehicle's dash mesh, NPC speech bubbles above the speaker, interaction highlight with a floating label, fighter health bars above the arena, Tycoon desk | mounts provided by the prefab or stage (`dashScreen`, `arenaAnchor`) by S06/S07/S08 |

**Panel spec.** `UiSurface.panel(screen, { anchor, pixelsPerMetre: 1024 })`. Minimum text size is 1.5° of visual angle (S11 starting value): at 1.2 m that is about 31 mm, i.e. a 32 px line at 1,024 px/m, scaled with `uiDistanceM`. Minimum target 64 px (about 3° at 1.2 m, design value †). Panels redraw only when a view-model value or focus changes (dirty flag), at most 30 Hz; at most four visible at once and about 2 million pixels in total on Quest (starting values †, calibrate in M11b1). Fonts are loaded with `FontFace` before the first draw so Canvas text matches the DOM.

**Interaction.** `onRay(hit, pressed, hand)` drives hover (controllers and hands only), press and release. Quest: controller ray + trigger; hands: pinch-ray. Vision Pro: transient pointer, no hover state exists before a pinch, so nothing depends on hover; selection happens on pinch and shows a pressed state and a click sound [research/stack-rendering-platform.md §4.3; 11-platform-xr.md §5.4]. Routing is by `inputSource` identity, handled in S11's `XrInputRouter`; S10 never indexes `inputSources`. A 150 ms selection debounce prevents double activation (design value). Sliders accept ray drag; choice widgets are segmented controls or lists, never native selects.

**Entry and exit.** An **Enter VR** button appears on the main menu and in Settings › Graphics only when S11 reports "XR armed", and its click handler calls `XrSessionController.enter()` synchronously with nothing awaited before it [11-platform-xr.md §5.1]. First entry shows the **comfort card** (lazy-follow): Teleport + snap turn (recommended, default) or Smooth locomotion, vignette level, seated toggle, height calibration ("stand straight, press the trigger / pinch") writing `xr.heightCalibM`. Vision Pro: if hand tracking is denied, a card says "Hand tracking is off — gaze and pinch still work" (DN-S11-07). **Exit VR** exists on the wrist panel and in Settings. When the session ends, the flat page the player left is restored.

**Flat-only pages.** Creator, NPC builder, forum, experiences/mods, legal, help, account and the age/terms screens are not rendered in XR. Navigating to one shows an `exit` panel: "This page needs the flat screen. Exit VR?" with Exit / Stay (DN-S10-04; a system keyboard inside a session is UNVERIFIED).

**HUD in XR.** There is no screen-space HUD. Replacements: interaction → outline plus floating label on the target; heat, cash, objective, minimap → wrist glance panel; speed → cockpit dash; subtitles → lazy-follow bar at about 40 % below the view center, two lines, speaker names; toasts → lazy-follow; NPC dialogue → bubble above the NPC with the AI badge; cutscene skip hint → below the cinema screen (S11 §5.6). Camera shake, FOV effects and animated panel motion are disabled; fades ≤ 300 ms (reduce-motion shortens to 0) [research/stack-rendering-platform.md §4.4].

**Per-mode XR panels (M11b2, with S06–S08).** Racing: dash gauges + wrist glance; results as a `world` panel. Fighter: stage bars above the arena (`tabletop` or `life-size`), Simple pad actions on controllers or hand gestures, Vision Pro hands-only. Tycoon: desk with `world` panels (dashboard, cap table, inbox) and pointer selection. Story: wrist phone, comfort card, teleport target ring.

**Remap in XR.** XR controller and hand bindings appear read-only in Settings › Controls › VR until the Quest face-button indices are captured on device (U-ENG-5); capture-based remap in a panel lands in M11b2.

### 2.13 (C) Accessibility baseline (R-ENG-04) — numbered, testable

Designed now, not deferred. Sources: C03 rule 9, C05 `ProfileSettings`, C13 `XrComfortSettings`, gamedesign §7.6; WCAG 2.2 values fetched 2026-10-18.

1. **Remap everything.** Every `SimButton` and `ClientAction` is remappable on kbm, gamepad, touch and (M11b2) XR, except that `client.Pause` keeps its default in addition to any override. Hold-to-toggle exists for the actions in `holdToToggle` (default list: Sprint, Block, Look-behind); when it is on, hold prompts act instantly.
2. **No gesture-only or timing-only paths.** Every gesture (pinch, pose, tilt, double-tap) has a button, stick or menu alternative; pose mode falls back to pad/touch in one tap.
3. **Subtitles** for every voice line including generated speech, cutscenes (`vtt`) and NPC dialogue; default on; sizes M/L/XL; optional background; speaker names; sound captions (optional) for non-speech cues such as "[siren approaching]".
4. **Colorblind-safe HUD.** `hudPalette` ∈ default, deutan, protan, tritan swaps the semantic color tokens (`friendly`, `danger`, `warning`, `objective`, `neutral`) from `config/ui/palettes.json`; every semantic state also has an icon, shape or text, enforced by a lint (a `StatusChip` without an icon fails). Minimap blips differ by shape. Palettes are validated in CI with a color-vision-deficiency simulation (algorithm chosen and recorded at M04b2) requiring a minimum separation between every semantic pair in each palette.
5. **Reduced motion.** Initial value from `prefers-reduced-motion: reduce` when the profile is created [MDN]. When on: no camera shake and no screen flashes (`camera.shake` forced off), no parallax, no auto-rotating previews, spinners replaced by static pulses, transitions ≤ 150 ms cross-fades, slower director cuts (S03), motion blur off (S11), `XrComfortSettings.reduceMotion` set.
6. **Photosensitivity.** No UI element flashes more than three times in any one second (WCAG 2.2 SC 2.3.1) [w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html, 2026-10-18]; fighter hit sparks and KO flashes obey the same cap (S07 consumes the rule).
7. **Contrast.** Text ≥ 4.5:1 (large text ≥ 3:1, large = 18 pt or 14 pt bold) and UI component boundaries and states ≥ 3:1 (SC 1.4.3, 1.4.11) [w3.org/WAI/WCAG22/Understanding/contrast-minimum.html and /non-text-contrast.html, 2026-10-18]. `highContrast` raises text to ≥ 7:1 (design value) and thickens borders.
8. **Text scale.** `uiScale` 85–150 % scales the root size; at 150 % on a 360 CSS px width no label is clipped or overlaps (layout test with long strings); base body text ≥ 16 CSS px on mobile.
9. **Targets.** ≥ 44 px on touch and ≥ 64 px in XR (design values), never below the 24 px WCAG floor.
10. **Keyboard and focus.** Everything operable by keyboard; focus is always visible (2 px ring, `focusRing: thick` = 4 px); logical order; focus traps only in modals and always closable with Esc/`UiBack`; the page never traps `Tab` in the game canvas.
11. **Screen readers.** DOM pages use native elements and ARIA roles; HUD changes announce through polite live regions when `UiPrefs.announce` is on (objective changes, heat phase, unlocks, save results); decorative art has empty alt text. XR canvas panels have no accessibility tree; this is a stated limitation and the flat pages stay the accessible route for configuration.
12. **Timers and assists.** `timerScale` ×1–×2 shown on every timed objective with an "assist" chip; story-fight auto-block; Tycoon pause-on-event; racing assists (S06); fighter Simple scheme.
13. **Audio parity.** Every alert that is only audible has a visual twin: sirens → heat phase text; incoming hit direction marker; low health indicator; cutscene audio → subtitles.
14. **XR comfort.** Teleport + snap 30° default, vignette only while moving, quantized velocity, seated mode, dominant hand, UI distance, no head-locked UI, no shake [11-platform-xr.md §4.2, §5.3].
15. **Orientation and motion of the device.** Menus work in portrait; the rotate overlay is a helper, not a block on menus; tilt steering is opt-in.
16. **Language.** Plain-language copy, no idiom-only phrases in system messages, errors say what to do next.

### 2.14 (C) Localization readiness and theming (U-30)

1. **String table.** `content/ui/i18n/<lang>.json` is a flat map `LocKey → message`. Keys are area-prefixed (`menu.main.continue`). Messages use named placeholders (`{count}`, `{brand}`), plural forms through `Intl.PluralRules`, numbers, currency (USD) and dates through `Intl`. No string concatenation; no UI text in code; every `GameModeDescriptor.titleKey`, `UnlockDef.titleKey`, `InteractionPrompt.promptKey` and handler reason is a `LocKey` (C06).
2. **Catalog hygiene.** The catalogs never contain the display name (use `{brand}` from `BRAND.displayName`); `names:lint` and `check:i18n` fail on a literal. `check:i18n` also reports keys missing per language and keys unused, and each translated key stores the hash of its source text so a stale translation falls back to English [research/repos-grand-v.md §6 rec 12; §2(e)].
3. **Scope in v1.** English only; the selector, loader and fallback chain (`lang → base language → en`) exist. NPC dialogue, cutscene speech and generated text stay English in v1; the UI language does not change them, and this is stated on the Language settings page.
4. **Layout.** Logical CSS properties, `dir` attribute support, no fixed-width labels, no icons with embedded text; font subsets are per language (OFL-1.1 fonts).
5. **Hooks for third-party UI overlays** (they will exist whether or not we want them; owner M04b5, DL-727): stable element ids and `data-ui-skip` (with `translate="no"`) on regions that must not be rewritten; one read-only shell signal stream instead of DOM scraping: each `ShellSignal` `{v: 1, kind: 'setting' | 'profile' | 'fps' | 'state' | 'page', …}` is a `dv-shell` window event and a post on `BroadcastChannel('dv-shell')`, with `fps` at ≤ 1 Hz (DL-732) [research/repos-grand-v.md §6 rec 13]. `SettingRef` paths are the stable public setting ids, renamed only by a DL or BD row. No `ui.button`-style registration API (DL-727). Mods use the C14 sandbox, not these hooks; the hooks are for translators and accessibility tools.
6. **Theming.** `config/ui/tokens.json` is the single source of colors, type, spacing, motion and z-layers. The game ships one dark UI theme plus `highContrast` and the four HUD palettes. The root attributes `data-contrast`, `data-palette`, `data-reduced-motion` and `data-ui-scale` are set before first paint from `UiPrefs` to avoid a flash.

## 4. Data

`TouchLayout` (§2.9), `PhoneAppDef` and `HintDef` (above) are the data types of this part; `UiPrefs` is in part B §4.3. Config files: `config/input/touch/*.json`, `config/ui/palettes.json`, `config/ui/tokens.json`, `content/ui/hints.json`. All are JSON Schema validated in CI.

## 5. Runtime behavior

1. HUD updates run in the rAF callback after the snapshot read: read dirty view-model keys, write DOM. Layout reads and writes are batched; no forced reflow inside the frame. HUD is not rendered while a cutscene covers the screen or while the page is hidden.
2. Pause/Phone push `phone` (or `xrMenu`) onto the input context stack and set `FrameSignal.paused`; closing pops it. In rooms nothing pauses.
3. On a tier change the HUD does not change; only DOM cost differs (minimap refresh 30 Hz desktop, 20 Hz `mobile-low`: starting values †).
4. Failure cases: a missing view-model key renders the widget in its empty state (never throws); a crashed `GameModeUI.mount` shows the "This screen failed — return to menu" panel and reports `err.js`; a lost touch layout falls back to `default-right`.

## 6. Platform notes

| | Desktop | iPhone PWA | Quest 3 / 3S | Vision Pro |
|---|---|---|---|---|
| HUD | full DOM HUD, pointer-lock safe | DOM HUD inside safe areas, touch layer, rotate overlay | none; wrist, lazy-follow, diegetic | same as Quest; scene planes |
| Minimap refresh | 30 Hz, ≤ 0.6 ms | 20–30 Hz, ≤ 1.0 ms [research/auth-ugc-input-maps.md §5.7] | wrist tile, 512 px, no per-frame re-raster | same |
| Pointer targets | 24 px floor, 32 px default | 44 px | 64 px | 64 px, no hover |
| Install prompt | `beforeinstallprompt` | coach mark | Chromium prompt on flat page | none |
| Haptics on press | gamepad where available | none | controller pulse | none |
| Cutscene UI | DOM overlay | DOM overlay | S11 media layer + S10 skip/subtitle layer | S11 texture + S10 layer |

## 7. Verified facts used

| Fact | Source |
|---|---|
| Touch constants (58 px stick, 26 px knob, 1.35× sprint, gain 3.0, tilt 10°/45°, hold 120 ms) | [research/repos-webport.md §3.6]; C03 rule 10 |
| iPhone: no Pointer Lock, no vibrate, no fullscreen; rotate overlay; safe-area insets | [research/stack-rendering-platform.md §3.4–3.5]; F-011 |
| XR panels: quad/cylinder layers (Quest), scene planes (Vision Pro); head-locked forbidden; 1.5° text and 1.2 m UI distance are S11 starting values | [11-platform-xr.md §5.3, §5.5] |
| Vision Pro transient input empty until a pinch; route by `inputSource` | [research/stack-rendering-platform.md §4.3] |
| Minimap tile cache, zoom by speed, shapes + colors, OSM attribution collapse after 5 s, wrist map 512 px north-up | [research/auth-ugc-input-maps.md §5.7] |
| Safety card (988), persistent AI badge, no companionship mechanics, report buttons | [research/legal-ip-likeness.md §5.2] |
| WCAG 2.2: SC 1.4.3 (4.5:1, 3:1 large), 1.4.11 (3:1), 2.3.1 (three flashes), 2.5.8 (24 px) | w3.org/WAI/WCAG22/Understanding/*, 2026-10-18 |
| `@axe-core/playwright` 4.14.0 (MPL-2.0; axe-core ~4.14.0) | registry.npmjs.org/@axe-core/playwright/latest, 2026-10-18 |
| Phone = pause menu on mobile, quick menu on desktop, wrist panel in XR; app list | [research/gamedesign-decomposition.md §2.10] |
| Sandbox feature list and status strings | [research/gamedesign-decomposition.md §7.7; research/repos-grand-v.md §3] |

## 8. Milestone mapping (HUD, XR, onboarding)

| Piece | Milestone | Stubbed first |
|---|---|---|
| HUD grid, shared widgets, story HUD, toasts | M04b2 | data keys fed by a fixture until M03c/M05c |
| Phone/Pause registry and apps (Map frame, Jobs, Garage, Bank, Settings, Help, Sandbox shell) | M04b2 | Ride bound to the M03b2 Ride path; Messages `comingSoon` until M05c2; Camera and Feed `comingSoon`, post-v1 (`01-product.md` §12; DL-292) |
| Touch layouts, editor, rotate overlay, tips, coach mark | M04b2 | |
| `CutsceneOverlay` | M04c | in-engine fallback only until M05b |
| Dialogue bubble, likeness card, AI badge | M06a | |
| Racing/Fighter/Tycoon HUDs | M07a/M08a/M09a by mode owners on the kit | |
| `UiSurface` skeleton with a test panel (IWER) | M04b2 | |
| Quest/Vision Pro panels, wrist, comfort card, Enter/Exit VR | M11b1 | |
| Per-mode XR panels, XR remap | M11b2 | |
| Chat panel, nameplates | M12b/c | |
| A11y audit, CVD palette validation, i18n report gate | M04b2 (first pass), M14b (audit) | |

## 9. Tests

1. `touch-layout.spec.ts` (unit) — layouts validate against the schema; all targets inside the safe area; sizes ≥ 44 px; widgets map to valid `ActionId`s; `one-handed` reaches every required action. `pnpm check:unit -- packages/ui`
2. `touch.e2e @ui-touch` — iPhone viewport (`webkit-webgl2`): stick, look zone, simultaneous stick + button, `pointercancel` release; rotate overlay appears in portrait during play and not in menus. `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-touch`
3. `hud-status.spec.ts` — every status widget has icon or text; `hudPalette` switch changes tokens; CVD separation check passes for all four palettes. `pnpm check:unit -- packages/ui`
4. `reduced-motion.e2e @ui-motion` — emulate `prefers-reduced-motion: reduce`; new profile starts with `reducedMotion: true`; no running CSS animations or transitions above 150 ms on any page; shake off. `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-motion`
5. `flash-limit.spec.ts` — any animation definition used in UI declares ≤ 3 flashes/s (static check over `tokens.json` motion entries). `pnpm check:unit -- packages/ui`
6. `a11y-scale.e2e` — `uiScale` 150 % at 360 px width: no horizontal scroll, no clipped controls on main, settings, saves, creator. `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-a11y`
7. `hud-perf.spec.ts` — HUD frame cost and DOM node count under the budgets in part A §2.7 during `graybox-walk`. `pnpm check:perf -- --scenario graybox-walk`
8. `coach-mark.e2e` — WebKit with a Safari-tab user agent and `display-mode: browser` shows the card once; standalone emulation does not; dismissal persists; `localStorage` failure does not throw. `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-coach`
9. `xr-panel.spec.ts @xr` — IWER (`xr-quest3`): a `ScreenDef` panel is created at `uiDistanceM`, a simulated ray press activates a button, a panel never uses a head-locked anchor (type test), computed text height ≥ 1.5° at 1.2 m, redraw only on change. `pnpm check:e2e:xr`
10. `ugc-surface.spec.ts` — every component tagged `UgcSurface` contains `ReportButton`. `pnpm check:unit -- packages/ui`
11. Device checklists (manual; rows in `tools/ci/checklists/M11b4-{quest3,visionpro}.json`, the per-mode XR pass after M11b3 exists; DL-229): panels legible at 1.2 m, ray and pinch selection, wrist glance, comfort card, exit prompt, Enter VR from a click, hand-tracking denial card.

## 10. Open questions

DN-S10-01…06 (part A §10). Q-13 (device availability) gates the XR device checklists. UNVERIFIED: tilt-steer permission on iOS standalone; CVD simulation algorithm choice; XR panel pixel and panel-count budgets; session `visibilitychange` behavior (U-PLT-13) for the Pause panel on headset removal.

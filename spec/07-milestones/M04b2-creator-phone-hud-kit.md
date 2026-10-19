# M04b2 — creator-phone-hud-kit

## Goal
After this session a new player can make a character and play with a real HUD on every flat device. The creator (`PlayerAvatar` in `CoreSlice.avatar`, `AppearanceV1` codec) completes New Game. The **`avatar.v1` and wardrobe-item schemas live in `packages/shared/schemas/ui/`** (wave-5 gap 11). The HUD grid and the story HUD read the view-model keys. Pause and Phone share one app registry. iPhone play gets touch layouts, an editor, the rotate overlay, tips and the coach mark. Help, the garage frame, the `GameModeUI` host and a `UiSurface` skeleton (a `ScreenDef` drawn into an XR panel under IWER) complete the set, with a first accessibility pass.

## Requirements
- R-UI-01: character creation with body, face, hair, outfit and voice presets, a name, and save to the profile.
- R-UI-03: pause, phone, garage frame and help pages; the HUD layer for story and sandbox.
- R-ENG-04: touch layouts with a keyboard-operable editor, colorblind-safe HUD states (icon or text plus color), reduced motion, subtitles widget, and no gesture-only paths.
- R-PLAT-01: the iPhone PWA path: coach mark (no install prompt on Safari), safe areas, rotate overlay, landscape touch play.

## Depends on
- **M04b1** (shell, kit, ScreenDef renderers, i18n, settings, New Game placeholder step, `UiPrefs`).
- Through earlier milestones:
  - M04a2: `ViewModelSource`, `UiCommand`, `GameModeUI` type, sandbox mode;
  - M04a1: saves;
  - M03c: heat in the snapshot side block;
  - M01b2: procedural mannequin on `bay_rig_v1`, touch binder;
  - M01c: `RendererHost` menu scene and `XrPanels` facade;
  - M00: IWER `xr-quest3` project.
- Contracts: C05 1.1.0 (`CoreSlice.avatar`, `ControlsSettings.touch.layout`), C06 1.1.0 (`GameModeUI`, `UiBridge`, `VmKey`), C07 1.1.0 (`AssetRef`, `VARIANT_FALLBACK`), C03 1.1.0 (`ActionId`, touch constants of rule 10), C13 1.1.0 (`XrPanels`, menu-scene members; `FirstGestureUnlock` is M04c's, DL-663), C04 1.1.0 (`bay_rig_v1`).

## Scope in
- **Schemas** (`packages/shared/schemas/ui/`): `avatar.v1.schema.json` (`10-ui-pages.md` §4.1), `wardrobe-item.v1.schema.json` (a `CreatorPart` row with slot), `touch-layout.v1.schema.json` (`10-ui-hud-xr.md` §2.9).
- **Creator** (`packages/ui/src/creator/`), per `10-ui-pages.md` §2.8 rules 1–5:
  - catalog loader;
  - `AppearanceV1` encoder and decoder with golden vectors;
  - `CreatorStage` on the shared canvas through the menu scene. Parts without a `model` render as M01b2 mannequin variants (height, build, palette tints), the stub first (the `character/pc-*` parts land in M10d1, DL-390);
  - tabs Body, Face, Hair, Outfit, Voice (id plus pitch; the Preview button stays disabled with a hint until M06a4 adds the creator voice clips, DL-292), Style, Name;
  - Randomize, Reset, Undo/Redo (20 steps), Done → `save.avatar`.

  Content: `content/ui/creator/{catalog.json, defaults.json}` with the §2.8 counts as catalog rows. Card art is an authored SVG sprite (`assets/creator-kit/`) with provenance. **No fal or other genAI:** `customLook` stays reserved (DL-175, DL-OWN-01).
- **New Game:** the M04b1 placeholder step becomes the creator. Flow: name → creator → intro (free roam start).
- **HUD** (`packages/ui/src/hud/`): the six-region grid, safe areas, `hudScale`/`hudOpacity`, z-order and all §2.10 shared widgets (`HeatStars` with the scripted-6 icon, phase text and cooldown ring; `InteractionPrompt` from the snapshot side block). The interim engine overlay of M03a1 (`packages/engine/src/client/hud/prompt.ts`) and its mount are deleted, not kept for QA pages, so the S10 widget is the only interaction prompt (localized, on the HUD palettes and `hudScale`, inside safe areas, reduced-motion aware); any e2e that read the old overlay reads the widget instead (DL-663 part 2). High-rate values update `textContent` through refs. The minimap slot `bl` is an empty frame; M02c2 draws into it.
- **Pause and Phone** (`packages/ui/src/phone/`): `PhoneAppDef` registry and the §2.10 Pause items. Apps:
  - Map (frame only; M02c2 draws);
  - Jobs (unlocked modes with a start button);
  - Garage (call a car): the app and the garage frame send `garage.call` and `garage.favorite` as C06 defines them; until M05c1 lands the garage module, M04a2's dispatcher answers both with the `garage.notYet` toast and nothing spawns (DL-668 part 3);
  - Bank;
  - Settings;
  - Help;
  - Sandbox (shell with the M03c heat toggles and M02b/M02c/M03b sections that exist; only in sandbox);
  - Ride: a destination list from `TeleportApi.candidates('fast-travel')` plus "Call robotaxi"; a pick starts M03b2's Ride path (`packages/world/src/sim/transit/ride.ts`, `TeleportApi.request('fast-travel', …)`), and a refusal shows its `messageKey` with the player unmoved;
  - Messages as `comingSoon` until M05c2 fills it; Camera and Feed as `comingSoon` (post-v1, `01-product.md` §12; DL-292).

  In single player both overlays pause the sim.
- **Touch** (§2.9): four shipped layouts (`config/input/touch/*.json`); the touch layer (rules 1–5); the editor (rule 6, saving `custom:n` into `UiPrefs`); the tilt toggle with explainer, falling back to the stick.
- **Onboarding** (§2.11 rules 1–4 and 8): tips, coach mark, Chromium install chip, rotate overlay, welcome-back line.
- **Help page** (schema §4.4, stale-translation fallback, error-kind deep links) and the **garage frame** (§2.10).
- **`GameModeUI` host:** mount with `{root, vm, send}`, unmount; a crashing mount shows "This screen failed — return to menu" and reports `err.js`.
- **`ReportButton`** kit component (report dialog stub until M13b1; `copyright` opens `/legal/dmca`) and the `ugc-surface` lint test: every component tagged `UgcSurface` renders it (M06a5 relies on both).
- **`UiSurface` skeleton:** `panel(screen, {anchor, pixelsPerMetre: 1024})` for every `XrPanel['anchor']` (tested with `world`) into S11 `XrPanels` with `CanvasScreen`, dirty-flag redraw, ray press. A test panel exists under IWER only.
- **Accessibility first pass:** `config/ui/palettes.json` with four HUD palettes; a CVD separation check (algorithm chosen and recorded as a Builder decision in `spec/11-decision-log-builder.md`); the flash-limit check; reduced-motion rules 5 and 8 on the pages of M04b1 and M04b2.
- Device checklist `tools/ci/checklists/M04b2-iphone15.json`.

## Scope out
- Minimap and full-map drawing, GPS and search: M02c2. Mission content in the HUD: M05c1.
- Dialogue bubble, likeness card and AI badge: M06a5. Cutscene overlay: M04c.
- Racing, fighter and tycoon HUDs: their mode milestones on this kit.
- Quest and Vision Pro panels, wrist, comfort card and Enter/Exit VR: M11b1.
- Mod shop and upgrades in the garage: M07b2. Custom look through the character pipeline: post-v1 (owner-approved queue only).

## Deliverables
- `packages/shared/schemas/ui/{avatar.v1.schema.json, wardrobe-item.v1.schema.json, touch-layout.v1.schema.json}`.
- `packages/ui/src/creator/{catalog.ts, appearance.ts, stage.ts, page.tsx}`; `content/ui/creator/{catalog.json, defaults.json}`; `assets/creator-kit/icons.svg` plus its provenance record.
- `packages/ui/src/hud/{layout.tsx, widgets.tsx, story-hud.tsx, touch.ts, touch-editor.tsx}`; `config/input/touch/{default-right,default-left,compact,one-handed}.json`.
- `packages/ui/src/phone/{registry.ts, pause.tsx, apps.ts}`.
- Deleted: `packages/engine/src/client/hud/prompt.ts` and its mount call (DL-663 part 2).
- `packages/ui/src/onboarding/{tips.ts, coach-mark.tsx, rotate.tsx}`; `content/ui/hints.json`.
- `packages/ui/src/pages/{garage.tsx, help.tsx}`; `content/ui/help/troubleshooting.json`.
- `packages/ui/src/host/mode-ui-host.ts`; `packages/ui/src/screen/xr.ts`; `config/ui/palettes.json`.
- `packages/ui/test/{creator.spec.ts, touch-layout.spec.ts, hud-status.spec.ts, phone.spec.ts, help.spec.ts, host-garage.spec.ts, ugc-surface.spec.ts}`.
- `tests/e2e/ui/{creator.spec.ts, touch.spec.ts, hud.spec.ts}` (tags `@creator`, `@ui-touch`, `@ui-coach`, `@ui-pause`, `@ui-motion`, `@ui-hud`, `@ui-boundary-toast`); `tests/e2e/xr/xr-panel.spec.ts` (`@xr`).
- `tools/ci/checklists/M04b2-iphone15.json`.
- About 38 files (JSON content and layouts are data; +1 for the overlay removal, DL-663 part 2).

## Interfaces
- C05 1.1: `CoreSlice.avatar` validated by `avatar.v1.schema.json` (S10 owns it, as the C05 1.1 note states); `ControlsSettings.touch.layout` may name `custom:<n>`, and a missing layout falls back to `default-right`.
- C06 1.1: `GameModeUI.mount/unmount`, `UiCommand` (`save.avatar`, `garage.*`, `sandbox.*`, `pause`, `mode.quit`), `VmKey` `hud.*`.
- C13 1.1 (`XrPanels`, menu scene) and C07 1.1 (`AssetRef`) consumed as frozen; `PhoneAppDef`, `HintDef`, `TouchLayout`, `UiSurface` are UI-internal. No contract change.

## Acceptance criteria
- AC-1 Given the catalog and the schemas When the creator tests run Then all of these hold:
  - `defaults.json` and every catalog row validate;
  - an avatar with an unknown or retired part loads the slot default;
  - the `AppearanceV1` golden vectors encode and decode exactly;
  - 24 morphs encode to 67 B (≤ 512 B);
  - a wrong length or unknown version returns the catalog default.
  — proof: `pnpm check:unit -- packages/ui`
- AC-2 Given New Game When the player names the profile, changes body, hair, outfit and voice, uses Undo and Redo, and presses Done, then reloads the app Then the stored `CoreSlice.avatar` deep-equals the edited avatar and its `AppearanceV1` bytes are unchanged. A name outside 1–24 allowed characters is refused inline — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @creator`
- AC-3 Given the four shipped layouts at the viewport and safe-area insets of the design fixture `packages/ui/test/fixtures/iphone-landscape.json` (M04b1; `10-ui-hud-xr.md` §2.9 rule 3, a design fixture, not a device fact) When validated Then every widget lies inside the safe area, targets are ≥ 44 px with ≥ 8 px spacing, every `ActionId` exists, and `one-handed` reaches every required on-foot action — proof: `pnpm check:unit -- packages/ui`
- AC-4 Given the fixture viewport with touch in free roam When the stick and the look zone are dragged while a button is pressed, then a `pointercancel` fires Then movement, look and the action register together, and everything is released on cancel. Portrait during play shows the rotate overlay and pauses the sim, but portrait in the menu does not. An edited layout saved as `custom:1` survives a reload — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-touch`
- AC-5 Given every status widget and the four palettes When the HUD tests run Then each state shows an icon, shape or text besides color, switching `hudPalette` changes the semantic tokens, every semantic pair passes the recorded CVD separation threshold, and no motion token flashes more than 3 times per second — proof: `pnpm check:unit -- packages/ui`
- AC-6 Given free roam When `client.Pause` is pressed Then Pause opens and the sim tick stops. Save is disabled away from a safehouse with its reason text. Quit asks for confirmation, writes a `modeExit` save and returns to the main menu. Phone lists Map, Jobs, Garage, Bank, Ride, Settings and Help; Ride lists the fast-travel candidates and, at heat 1, a pick shows the refusal text with the player unmoved; `comingSoon` apps are not activatable, and Sandbox appears only in the sandbox mode. Ride needs the baked world (the world-less stand-in has no teleport candidates, DL-668), so the tag runs on the `synth` world, as CI's world half does — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-pause`
- AC-7 Given `prefers-reduced-motion: reduce` When a new profile is created and the main menu, settings, creator and Pause open Then `reducedMotion` is true, no CSS animation or transition runs longer than 150 ms, and camera shake is off — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-motion`
- AC-8 Given WebKit with a Safari-tab user agent When the main menu opens twice Then the coach mark shows once and stays dismissed after a reload. Standalone emulation never shows it, and a throwing `localStorage` does not break the page — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-coach`
- AC-9 Given free roam on the gray-box block (a QA build without `DV_WORLD`; CI runs `@ui-hud` in the `GRAYBOX_GREP` half of the e2e leg, DL-656) When the HUD runs for 60 s Then the HUD holds ≤ 300 DOM nodes, wallet, heat and prompt values appear from the view model and the snapshot side block, exactly one interaction-prompt element exists while a prompt is live (the bridge spawns `vehicle.sedan` 2 m from the player; no element of the removed engine overlay is present; DL-663 part 2), and a missing key renders the widget's empty state without an error — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-hud`
- AC-10 Given the GameModeUI host, the garage and help When their unit tests run Then all of these hold:
  - a mounting view receives `vm` and `send`;
  - a throwing mount shows the failure panel and one `err.js`;
  - garage cards render from partial `VehicleInstance` objects and the empty state, and Call and Set as favourite each send exactly one `garage.call` or `garage.favorite` with the card's `vehicleKey` (DL-668 part 3);
  - every error-page kind maps to an existing help topic;
  - a stale translation falls back to English;
  - every `UgcSurface` component renders `ReportButton`.
  — proof: `pnpm check:unit -- packages/ui`
- AC-11 Given `xr-quest3` with IWER When a test `ScreenDef` panel is created through `UiSurface` Then it sits at the default 1.2 m distance with a `world` anchor, a simulated ray press activates its button, text height is ≥ 1.5° of visual angle at 1.2 m, and it redraws only after a view-model change — proof: `pnpm check:e2e:xr`
- AC-12 Given an iPhone 15 When the operator follows the checklist (Safari tab coach mark, Add to Home Screen, safe areas, name entry with the OS keyboard, 5 min of touch play at `?perf=1&tier=mobile-low`, rotate overlay) Then `perf.json` and `notes.json` are committed under `docs/device-runs/M04b2/iphone15/` and pass at `mobile-low`, and `notes.json` records, in landscape in both the Safari tab and the Home Screen app, `innerWidth`, `innerHeight` and the four computed `env(safe-area-inset-*)` values (recorded, not asserted; U-UI-10) — proof: manual: iPhone 15, steps of `pnpm perf:checklist -- tools/ci/checklists/M04b2-iphone15.json`, then `pnpm perf:verify -- docs/device-runs/M04b2/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M04b2-iphone15.json`
- AC-13 Given the branch When the standard gates, IP gates, bundle check and preview deploy run Then all pass — proof: `pnpm lint && pnpm typecheck && pnpm check:unit && pnpm provenance:check && pnpm check:i18n && pnpm build && pnpm check:bundle && pnpm deploy:preview`
- AC-14 Given a QA build with the `synth` world in sandbox free roam (`?play=sandbox`) When the bridge teleports the player 100 m inside a county-line edge and bot input walks it outward Then the `world.boundary.countyLine` toast (M02c1 event, M04a2 mapping) is visible once for the approach in the M04b1 toast region with the `en.json` text (DL-681) — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-boundary-toast`

## Test plan
- **Unit** (`pnpm check:unit -- packages/ui`): `creator`, `touch-layout`, `hud-status` (CVD and flash limit), `phone`, `help`, `host-garage`.
- **E2E:**
  - `@creator`, `@ui-motion` and `@ui-hud` on `chromium-webgl2`; `@ui-pause` (AC-6) and `@ui-boundary-toast` (AC-14) on `chromium-webgl2` with `DV_WORLD=synth`;
  - `@ui-touch` and `@ui-coach` on `webkit-webgl2`;
  - `@xr` panel through `pnpm check:e2e:xr`.
- **Device:** `M04b2-iphone15` (AC-12).

## Demo script
1. New Game: name, creator, change body and hair, Undo, Done.
2. Free roam: clock, wallet and prompt on the HUD; heat 2 from the sandbox app shows the stars.
3. Esc opens Pause; Phone lists Jobs, Garage, Bank.
4. iPhone Safari tab: coach mark; Home Screen app: touch play; portrait: rotate overlay.
5. Edit the touch layout, save as custom, reload.

## Effort
1 Builder session; about 38 files; risk **medium** (breadth; keep every piece minimal and data-driven).

## Risks & fallbacks
- **Menu-scene preview cost on iPhone** (≤ 40k triangles is a design value): if it stutters, use a 30 fps turntable and record it.
- **Tilt permission in a Home Screen app is unknown.** The toggle falls back to the stick. The checklist records what happened; no AC asserts tilt.
- **CVD algorithm choice.** Cite the chosen simulation in the decision log; never lower the threshold to pass.

## Notes for the Builder
- Read first: `10-ui-pages.md` §2.8, §2.10 (garage), §2.14 (help), §4.1–§4.2, §4.4; `10-ui-hud-xr.md` §2.9–§2.14, §5, §9; `10-ui.md` §3.3–§3.4; `11-platform-xr.md` §4.4, §5.5 for `XrPanels`.
- Facts: F-004 and F-011 (Home Screen web apps; no fullscreen, orientation lock, vibration or install prompt on iPhone). WCAG 2.2 values are the S10 citations in `10-ui-hud-xr.md` §2.13.
- Order of work: schemas and codec, creator, HUD grid and widgets, pause and phone, touch and editor, onboarding, help and garage, host, `UiSurface`, accessibility checks, e2e, checklist.
- The checklist is `M04b2-iphone15.json` (C15 naming; `10-ui-pages.md` §9 now uses the same name, DL-221).
- Owner gate: Q-13 (an iPhone 15 for AC-12; without it the AC is listed under "Blocked on"). Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). No genAI spend.

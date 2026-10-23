# M04b5 — settings-live-overlay-hooks

## Goal
After this session every Graphics row the player sees does something or says why not. A fixed render scale sizes the canvas through `RendererHost.resize`, inside the tier's pixel budget (`pixelRatioFor`). The frame-cap row is disabled with a reason until M11a1's `FramePacer` exists. "Show frame rate" draws an FPS chip. Desktop browsers that report `document.fullscreenEnabled` get a full-screen button in Pause and on Graphics. The overlay hooks of `10-ui-hud-xr.md` §2.14 rule 5 become real: `data-ui-skip`, the window events `dv-settings` and `dv-save-profile`, and a read-only `BroadcastChannel('dv-ui')` feed. The device-scoped stores keep unknown fields across a round-trip. This is GV-02 of the Grand-V study in our own code and wording; today `claude/build` has no reader of `fpsCap`, `renderScale` or `showFps` outside the settings pages and stores, and no `requestFullscreen` call.

## Requirements
- R-UI-02: the Graphics rows apply or say why they cannot.
- R-PLAT-03: the player's render scale multiplies the tier's resolution caps and never exceeds them.
- R-PLAT-01: desktop browsers get full screen; iPhone and XR never show the control (F-011).
- R-ENG-04 (support): translators and accessibility tools get stable hooks instead of scraping the DOM.

## Depends on
- **M01c** (device-spike-renderer-host): `RendererHost.resize` and `pixelRatioFor` in `packages/engine/src/platform/renderer-host.ts`; `PerfProbe` in `packages/engine/src/platform/perf/probe.ts`; `installPlatformBridge` and `PlatformBridge` in `packages/engine/src/platform/probe.ts` (`window.__dvBridge.platform`); `normalizeSettings` and `DEFAULT_SETTINGS` in `packages/engine/src/platform/platform-store.ts`.
- **M04b1** (shell-ui-kit-menus-settings): `SettingsBinder` (`packages/ui/src/shell/binder.ts`); `normalizePrefs` (`shell/prefs.ts`); `graphicsScreen` (`pages/settings/display.ts`); `ScreenDef` (`screen/types.ts`), `DomScreen`, `CanvasScreen`; `createPlatformPort` (`apps/web/src/shell-ports.ts`); `check:i18n`.
- **M04b2** (creator-phone-hud-kit): `pauseScreen` (`packages/ui/src/phone/pause.tsx`), `HudGrid` (`hud/layout.tsx`), HUD widgets (`hud/widgets.tsx`).
- All three are merged on `claude/build`.
- Contracts: C13 1.1 (`PlatformSettings`, `QualityTier`), read only; C05 1.2 untouched. No contract change.

## Scope in
- **Render scale.**
  - New pure helper `effectiveRenderScale(setting, playing, backdrop)` in `packages/engine/src/platform/render-scale.ts`:
    - `'auto'` gives `playing ? 1 : backdrop`;
    - a fixed value `s` gives `playing ? s : Math.min(s, backdrop)`.
  - `bootEngine` (`packages/engine/src/client/boot/boot-engine.ts`): `applyScale` passes `effectiveRenderScale(userScale, playing, BACKDROP_RENDER_SCALE)` to `hostScene.resize`. `EngineHandle` gains `setRenderScale(s: PlatformSettings['renderScale'])`, which stores the value and calls `applyScale`.
  - `apps/web/src/main.ts` calls it with `platform.settings.renderScale` at boot. `createPlatformPort` gains an optional `onChange(next)` that `update` calls after `putSettings`; `main.ts` forwards `renderScale` from it.
  - `RendererHost` and `pixelRatioFor` are unchanged, so the tier's `dprCap`, `maxPixelsMP` and the 0.25 floor still apply. The setting sizes the flat canvas only. XR framebuffer scale stays with M11b1.
- **QA bridge:** `PlatformBridge` (`packages/engine/src/platform/probe.ts`) gains `resolution()`, returning `{cssW, cssH, dpr, pixelRatio, budgetRatio}`. `pixelRatio` is `host.renderer.getPixelRatio()` and `budgetRatio` is `pixelRatioFor(platform.quality.tier, cssW, cssH, dpr, 1)`. QA builds only.
- **Frame-cap row.** `Widget` `choice` gains `disabled?: LocKey`, rendered like `toggle` (`aria-disabled`, the reason read aloud) by `DomScreen`, `CanvasScreen` and kit `Choice` (`disabledReason`). `PlatformPort` gains `framePacer?: boolean`, and `SettingsEnv` carries it. While it is not `true`, `graphicsScreen` gives the `fps` row `disabled: 'settings.graphics.fps.later'`. The stored `fpsCap` is kept, never reset. M11a1 sets the flag to `true`.
- **FPS feed and chip.**
  - `FpsFeed` (`packages/engine/src/platform/perf/fps-feed.ts`) is fed by a `RendererHost.addFrameListener` `before(time)`. It keeps the frame intervals in a `PerfProbe(120)` and emits `{fps: round(1000 / median)}` at most once per 1000 ms.
  - `PlatformPort` gains `onFrameStats?(cb: (s: {fps: number; tier: string}) => void): () => void`, implemented in `createPlatformPort`.
  - `FpsChip` (`packages/ui/src/hud/fps-chip.tsx`, `data-testid="fps-chip"`, `aria-hidden="true"`, `data-ui-skip`, `translate="no"`) is mounted by `shell/app.tsx` while `UiPrefs.showFps` is on. It shows in menus and in play, top-right inside the safe area, above the HUD layer. It updates by `textContent` with the key `hud.fps.line` ("{fps} fps"). It holds 3 DOM nodes or fewer and uses none of the QA perf panel's names, so `verify-dist` stays green. It is never drawn in XR.
- **Full screen** (`packages/ui/src/shell/fullscreen.ts`):
  - `fullscreenAvailable(doc, deviceClass)` is true only when `doc.fullscreenEnabled === true` and `deviceClass !== 'xr'`.
  - `toggleFullscreen(doc)` runs synchronously inside the press handler. With `doc.fullscreenElement` set it calls `doc.exitFullscreen()`; otherwise it calls `doc.documentElement.requestFullscreen()`. A rejection shows the toast `settings.fullscreen.failed`.
  - Buttons: `pause-fullscreen` in `pauseScreen` (after Settings) and `fullscreen` in `graphicsScreen`, each present only when `fullscreenAvailable`. The label is `settings.fullscreen.enter` or `settings.fullscreen.exit`, refreshed on `fullscreenchange`. Nothing is persisted, since every entry needs a gesture.
  - Both buttons sit in pages where the sim is paused or not running, so the click never reaches the canvas, whose click requests pointer lock (`packages/engine/src/client/input/kbm.ts`).
- **Overlay hooks** (`packages/ui/src/shell/overlay-hooks.ts`, `createOverlayHooks({target, channel, now})`):
  - **`dv-settings`.** A `CustomEvent` on `window` after each `SettingsBinder.set`. The detail is `{v: 1, ref: '<scope>:<path>', value?}`, for example `'device:renderScale'`. `value` is present only for a JSON primitive. There is one event per player write: the `xr.reduceMotion` mirror and `setControls` emit none.
  - **`dv-save-profile`.** Detail `{v: 1, profileId}`, fired when the `sys.profile` view-model id changes (`ShellCore.onVm`), and once per change.
  - **`BroadcastChannel('dv-ui')`** messages:
    - `{v: 1, t: 'fps', fps, tier}` at most once per 1000 ms, from `onFrameStats`, whether or not the chip is shown;
    - `{v: 1, t: 'state', state}` when `ShellCore` changes state;
    - `{v: 1, t: 'page', page}` on `navigate`.
    Where `BroadcastChannel` is missing, the channel is `null` and nothing throws (the guard pattern of `assets/store/tab-lock.ts`).
  - The hooks carry no names, saves or free text, and nothing on the page listens to them. Mods use C14 only.
- **`data-ui-skip` with `translate="no"`** goes on:
  - the `#dv-engine` container (`main.ts`);
  - the HUD values `hud-wallet-value` and `hud-clock`;
  - `kbd.dv-glyph`;
  - the creator inputs `creator-name` and `creator-callsign`;
  - the saves `rename-input` and the name heading of each `profile-card-<name>` card;
  - the `FpsChip`.
  Element ids stay as they are: the kit's `data-fid` and `data-testid` already come from the `ScreenDef` widget ids.
- **Unknown fields survive** (study rec 18):
  - `normalizePrefs` copies top-level keys that `defaultPrefs()` does not have onto its result, ahead of the validated fields, so `set` and `persist` write them back.
  - `normalizeSettings` already spreads the raw record; a test pins that. `createPlatformPort.update` keeps them too, because it spreads `current`.
  - A record whose `v` is not 1 still reads as the defaults (unchanged).
- **`ui.button` registration API: rejected.** The reasons are under Scope out; record them as a BD row.
- **Strings** (`content/ui/i18n/en.json`, our own wording): `settings.graphics.fps.later`, `settings.fullscreen.enter`, `settings.fullscreen.exit`, `settings.fullscreen.failed`, `hud.fps.line`.

## Scope out
- **A `ui.button({id, label, onClick})` style registration API (rejected, not deferred).**
  1. §2.14 rule 5 makes the hooks read-only, for translators and accessibility tools. A page-global registration would let any script in the app origin, such as an extension's main-world script, add controls that run with the app's privileges, outside the C14 permissions, provenance and moderation.
  2. UI mods already render only in the C14 sandbox (`ModUiHost`, M13a5). A launcher entry for them belongs there, as an Architect decision for M13a7.
  3. A callback button cannot be drawn by `CanvasScreen` on the XR panels, where every `ScreenDef` widget must work.
  4. It would be a public API to version with no v1 consumer.
- **The FramePacer and the cap itself:** M11a1, which also flips `framePacer` and owns the governor's pinned-scale rule.
- A corner menu during play; an XR wrist FPS line (M11b1); a "cool and quiet" quick choice (rejected for v1, DL-727: the tier presets already do it); per-knob overrides (DL-144).
- `ProfileSettings` (C05) unknown-field handling: the sim's `applySettings` merges known sections only; C05 migrations own it.
- Help-page render fixes and the runtime stale-translation gate (M14c).

## Deliverables
- Engine: `packages/engine/src/platform/render-scale.ts` (new), `packages/engine/src/platform/perf/fps-feed.ts` (new), `packages/engine/src/platform/probe.ts`, `packages/engine/src/client/boot/boot-engine.ts`; test `packages/engine/test/platform/settings-live.spec.ts` (new).
- App: `apps/web/src/main.ts`, `apps/web/src/shell-ports.ts`.
- UI:
  - `packages/ui/src/shell/{overlay-hooks.ts (new), fullscreen.ts (new), binder.ts, core.ts, prefs.ts, types.ts, app.tsx}`;
  - `packages/ui/src/hud/{fps-chip.tsx (new), widgets.tsx}`;
  - `packages/ui/src/screen/{types.ts, dom-screen.tsx, canvas-screen.ts}`, `packages/ui/src/kit/{widgets.tsx, m04b2-hud.css}`;
  - `packages/ui/src/pages/settings/{display.ts, index.ts}`, `packages/ui/src/phone/pause.tsx`, `packages/ui/src/creator/page.tsx`, `packages/ui/src/pages/saves.tsx`.
- Content: `content/ui/i18n/en.json`.
- Tests: `packages/ui/test/overlay-hooks.spec.ts` (new), `packages/ui/test/settings-live.spec.ts` (new), `packages/ui/test/ui-screen-parity.spec.ts` (extended), `tests/e2e/ui/settings-live.spec.ts` (new; tags `@ui-settings-live`, `@ui-fullscreen`).
- BD rows in `spec/11-decision-log-builder.md`.
- About 32 files.

## Interfaces
- C13 1.1 `PlatformSettings.renderScale`, `.fpsCap`, `QualityTier.budget.render`: read only.
- S10 shell ports (not a contract): `PlatformPort.framePacer?`, `.onFrameStats?`; `EngineHandle.setRenderScale`; `Widget` `choice.disabled?`.
- Public hook shapes (versioned by `v: 1`): `dv-settings` `{v, ref, value?}`, `dv-save-profile` `{v, profileId}`, `dv-ui` `{v, t: 'fps' | 'state' | 'page', …}`.

## Acceptance criteria
- AC-1 Given `effectiveRenderScale` and a `RendererHost` over a fake renderer When the unit cases run Then:
  - `('auto', true, 0.6)` is 1, `('auto', false, 0.6)` is 0.6, `(0.5, true, 0.6)` is 0.5, `(0.8, false, 0.6)` is 0.6;
  - `resize(w, h, 0.5)` sets the pixel ratio to `pixelRatioFor(tier, w, h, dpr, 0.5)` for a tier with `dprCap` and `maxPixelsMP` set;
  - `FpsFeed` fed 16.7 ms frames emits about 60 fps, at most once per 1000 ms of fed time

  — proof: `pnpm check:unit -- packages/engine/test/platform/settings-live.spec.ts`
- AC-2 Given a QA build on `chromium-webgl2` at `/?play=sandbox` When the player opens Pause › Settings › Graphics and picks the 50 % render scale Then `__dvBridge.platform.resolution().pixelRatio` equals `max(0.25, budgetRatio × 0.5)` within 1e-6, and the canvas width is within 1 px of `floor(cssW × pixelRatio)`. After "Auto" and Resume, `pixelRatio` equals `budgetRatio` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-settings-live`
- AC-3 Given `graphicsScreen` When `framePacer` is absent or false Then the `fps` row carries `disabled: 'settings.graphics.fps.later'`, it renders `aria-disabled` with the reason in `DomScreen` and in `CanvasScreen` with the same focus order, a press changes nothing, and the stored `fpsCap` is unchanged. With `framePacer: true` the row is enabled — proof: `pnpm check:unit -- packages/ui/test/settings-live.spec.ts packages/ui/test/ui-screen-parity.spec.ts`
- AC-4 Given the same QA build When "Show frame rate" is switched on in Graphics Then `[data-testid=fps-chip]` shows a whole number within 2 s, both in the menu and after Resume. Switched off, the chip is gone — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-settings-live`
- AC-5 Given a stubbed `Document` (`fullscreenEnabled`, `fullscreenElement`, `requestFullscreen`, `exitFullscreen`) When the full-screen unit cases run Then:
  - `fullscreenAvailable` is false with `fullscreenEnabled: false` and with `deviceClass: 'xr'`;
  - `pauseScreen` and `graphicsScreen` omit the button when it is false;
  - one press calls `requestFullscreen` once on `documentElement`, and a second press, with `fullscreenElement` set, calls `exitFullscreen`;
  - a rejected request shows the `settings.fullscreen.failed` toast

  — proof: `pnpm check:unit -- packages/ui/test/settings-live.spec.ts`
- AC-6 Given an init script that stubs `document.fullscreenEnabled` When Settings › Graphics opens Then:
  - on `webkit-webgl2` with the stub false, `fullscreen` is absent;
  - on `chromium-webgl2` with the stub true and a stubbed `requestFullscreen` that sets `fullscreenElement` and dispatches `fullscreenchange`, a click calls the stub once and the label changes to the `settings.fullscreen.exit` text

  — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-fullscreen && pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-fullscreen`
- AC-7 Given `createOverlayHooks` with a fake `EventTarget`, a fake channel and a fake clock, and a `SettingsBinder` wired to it When the unit cases run Then:
  - one `set({scope:'device', path:'renderScale'}, 0.5)` dispatches exactly one `dv-settings` with detail `{v:1, ref:'device:renderScale', value:0.5}`;
  - `accessibility.reducedMotion` dispatches one event, not two;
  - fps samples fed every 100 ms for 3 s post at most 3 `fps` messages;
  - a `sys.profile` id change posts one `dv-save-profile`, and a repeat of the same id posts none;
  - with `channel: null` nothing throws;
  - each listed creator and saves element carries `data-ui-skip`

  — proof: `pnpm check:unit -- packages/ui/test/overlay-hooks.spec.ts`
- AC-8 Given the QA build in play When the page is inspected Then `#dv-engine`, `[data-testid=hud-wallet-value]` and `[data-testid=hud-clock]` carry `data-ui-skip` and `translate="no"`, and a `BroadcastChannel('dv-ui')` listener opened in the page receives at least one `fps` message and no more than 2 per second over 5 s — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-settings-live`
- AC-9 Given a stored `UiPrefs` with an extra key `futureKey: {a: 1}` and stored `PlatformSettings` with `futureKnob: 3` When each is normalized, changed by one known field and written back Then both extra keys come back unchanged, and a record with `v: 2` still reads as the defaults — proof: `pnpm check:unit -- packages/ui/test/settings-live.spec.ts packages/engine/test/platform/settings-live.spec.ts`
- AC-10 Given the existing UI suites When they run Then menus, the HUD node budget (≤ 300 with the chip off), accessibility and reduced motion stay green — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep "@ui-menus|@ui-hud|@ui-a11y|@ui-motion"`
- AC-11 Given the branch When the standard gates and a preview deploy run Then all pass, and the production `dist` holds no QA bridge code and no secret — proof: `pnpm lint && pnpm typecheck && pnpm check:unit && pnpm check:i18n && pnpm build && pnpm check:bundle && pnpm check:secrets -- apps/web/dist && pnpm deploy:preview`

## Test plan
- **Unit:** `packages/engine/test/platform/settings-live.spec.ts` (scale table, resize spy, `FpsFeed`, settings round-trip); `packages/ui/test/settings-live.spec.ts` (fps row, full screen, prefs round-trip); `packages/ui/test/overlay-hooks.spec.ts`; `ui-screen-parity.spec.ts` (disabled `choice`).
- **E2E:** `tests/e2e/ui/settings-live.spec.ts`: `@ui-settings-live` on `chromium-webgl2`, `@ui-fullscreen` on both WebGL2 projects. Neither needs the baked world; keep them out of `GRAYBOX_GREP` (CI runs them in the synth half).
- **Regression:** `@ui-menus`, `@ui-hud`, `@ui-a11y`, `@ui-motion`; `pnpm build` runs `verify-dist`.

## Demo script
1. `pnpm dev`, then open `/?play=sandbox`.
2. Press P, then Settings › Graphics: the frame-cap row is greyed with its reason.
3. Pick 50 %: the image softens at once; Auto sharpens it.
4. Turn on "Show frame rate": a number appears top-right and stays after Resume.
5. In desktop Chrome, press Full screen in Pause; the label changes, and the button leaves full screen.
6. In the console, `new BroadcastChannel('dv-ui').onmessage = (e) => console.log(e.data)` logs one `fps` line a second.

## Effort
0.8 Builder session; about 32 files; risk **low-medium** (many small seams in shell and engine boot).

## Risks & fallbacks
- **Headless Chromium's real fullscreen behaviour** is not in the ledger, so every test stubs the API. Real behaviour is checked by hand in the demo. Whether Esc reaches the page while full screen or pointer lock is active is UNVERIFIED; the existing P binding for Pause stays.
- **Rebase overlap** with M04e1–M04e3 in `screen/types.ts` and `pause.tsx`. The changes here are additive (a `choice` field and one button), so take both sides.
- **`renderScale` and the M11a1 governor** could fight. Until M11a1 nothing else writes the scale. The pin rule ("a fixed setting pins `DynamicQuality.renderScale`") is recorded by DL-727 and proved by M11a1 AC-11, not coded here.

## Notes for the Builder
- Read first:
  - `spec/domains/10-ui-hud-xr.md` §2.14 (rule 5) and §2.10;
  - `10-ui-pages.md` §2.9 and §4.3;
  - `11-platform.md` §5.4–5.5, and the platform table (fullscreen row, F-011);
  - the files named in Depends on;
  - `apps/web/scripts/verify-dist.mjs` (strings that must not ship).
- Order of work: render scale with its bridge, the `choice.disabled` field, `FpsFeed` and the chip, full screen, hooks, round-trips, then e2e.
- Call `requestFullscreen` before any `await` in the press path. `ScreenHost`'s `run` (`packages/ui/src/screen/dom-screen.tsx`) must stay synchronous for the `call` action.
- IP wall: the study's source names (its channel name, event names, attribute name, button API, CSS) are not ours. Use only the names in this file and in `10-ui-hud-xr.md` §2.14, and write every string fresh.
- No secrets needed. `deploy:preview` prints SKIP without `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; list it under "Blocked on" then.

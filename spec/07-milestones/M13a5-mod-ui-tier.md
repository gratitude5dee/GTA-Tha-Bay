# M13a5 — mod-ui-tier

## Goal
UI-tier mods can show their own panels without reaching the game page.
- A single `ModUiHost` interface hides how a panel is shown. Following DL-146, the **L2 declarative panel** (`dv-panel/1`, rendered by the host) ships first and is the only path in XR.
- The **L0 `srcdoc` iframe** (opaque origin, `sandbox="allow-scripts"`, our CSP `<meta>` first, `MessagePort` only) is built and tested, but runs only when `mods.ui` is true.
- A host-drawn panel frame provides focus trap, Escape, mod name and author, size limits and reduced motion.
- Message limits are enforced, and `ui.hud` widgets are drawn by the host.
- An isolation e2e suite plus device runs on iPhone 15 and Quest 3 record the COEP matrix (U2).

`mods.ui` stays false in staging and production until those recordings are reviewed (DL-146).

## Requirements
- R-MOD-01: personal mods may add their own windows and HUD widgets through a typed, permission-narrowed channel.
- R-PLAT-02 (support): in `immersive-vr`, UI mods use host-rendered XR panels only, never a DOM iframe.

## Depends on
- **M13a3**: `ModHost`, broker, grants, refusal codes, mod `AssetSource`. M13a4 is not required: a UI mod with an `entry` script loads its script only when `mods.script` is also true.
- Contracts: C14 1.0 (`ModUiSpec`, `UiMsg`, `PanelDoc`/`PanelNode`, `ModApiUi`, `ModApiHud`, `ui.panel`/`ui.hud` permissions, limits 4 KiB and 30 msg/s), C13 1.1 (`XrPanels`, tiers), C06 1.1 (`VmKey` `hud.${string}`), C16 1.1 (`mod.fault {reason:'ui'}`).
- Gate: **Q-13**, an iPhone 15 and a Quest 3 for the matrix recordings.

## Scope in
- **`ModUiHost`** (`packages/ui/src/mods/ui-host.ts`):
  - `open(mod, spec) → PanelHandle`, `close(id)`, `post(id, msg)`, `onMessage(id, cb)`.
  - Mode selection, in order:
    1. XR presenting → L2 from `ui.xrPanel`, or the notice "Not available in VR";
    2. `mods.ui` false → L2 from `ui.xrPanel` when present, else the notice "This mod's window is off on this build";
    3. `mods.ui` true → L0.
  - L1 (network origin) is not built (ADR-0030 stays deferred).
- **L2 panel renderer** (`panel-renderer.tsx`):
  - validates `dv-panel/1` with the M13a1 validator (≤ 40 nodes, depth ≤ 3);
  - renders `text`, `button`, `list`, `progress`, `image` with kit components (text through `ctx.str` string ids, images from the mod's texture assets as `blob:` URLs of verified bytes);
  - a button delivers `{t:'ui', msg:{panel:id}}` to the mod's script; `progress` values come from `hud.set`.
- **XR path:** the same `PanelDoc` becomes an S10 `ScreenDef` drawn by `UiSurface` (M04b2/M11b1) on a world-locked `XrPanel`, never head-locked.
- **L0 srcdoc builder** (`srcdoc.ts`, pure). The document is, in order:
  1. `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'">`;
  2. a bootstrap of ≤ 40 lines that waits for one `MessagePort` (the first `message` event, posted with target `"*"` because the origin is opaque) and exposes `dv.post` and `dv.onMessage`;
  3. the mod's `ui.html` body.
  - The iframe gets `sandbox="allow-scripts"` (no `allow-same-origin`), an empty `allow` attribute, `referrerpolicy="no-referrer"`, and `width`/`height` from `widthPct`/`heightPct` (10–40 % of the viewport).
- **Relay:** iframe port ↔ main ↔ `sim.worker` `ModHost` ↔ `mod.worker` (script present and allowed). Every `UiMsg` is `{v:1,…}` and schema-checked at each hop.
- **Limits** (`ui-limits.ts`): a message above 4 KiB is dropped; a 31st message within one second closes the panel. Either way `mod.fault {reason:'ui'}` is emitted and the mod's script keeps running. A `securitypolicyviolation` reported from inside the frame through the bootstrap counts as a violation.
- **Panel frame** (`PanelFrame.tsx`): mod name and author in host chrome outside the iframe, a Close button, focus trap, Escape to close, reduced motion (no transitions), and a `ReportButton` (mod surface, R-IP-03). One panel per mod; at most two panels open.
- **`ui.hud` widgets** (`hud-widgets.tsx`): ≤ 6 host-rendered widgets (`text`, `bar`, `icon`) per mod, under the VmKey `hud.mod.<8-hex>`, text through the string table.
- **Flags:** `ModHost` lifts the `load.flag_off` refusal for tier `ui`, because L2 needs no flag. `mods.ui` gates L0 only. It is false in staging and production `FLAGS_JSON`, and true in the local test environment and the `previews` block (QA Preview builds used for the device runs).
- **Matrix recording:**
  - the e2e suite writes `test-results/mods-ui-matrix.<project>.json` with the observed values inside the L0 frame: `crossOriginIsolated`, `typeof SharedArrayBuffer`, `document.referrer`, and whether the CSP blocked a test `fetch`. These are U2 items, recorded and not asserted.
  - Device checklists `tools/ci/checklists/M13a5-iphone15.json` (Home Screen app and Safari tab) and `M13a5-quest3.json` (Quest Browser flat page) record the same values into `notes.json`.
- **Fixtures:** UI mods `ui-probe` (tries `parent.document`, `top.location`, `localStorage`, `indexedDB`, `fetch`, `new Worker`, `window.open`, and posts each outcome) and `ui-panel` (L2 only, with `xrPanel`).

## Scope out
- L1 network-origin host and any second domain: ADR-0030 (deferred), DN-S12-02.
- UI mods in XR as DOM: never (DOM is not drawn in `immersive-vr`).
- Store pages that show "This mod can show its own windows": M13a7. Agent-kit examples: M13a6.
- Flipping `mods.ui` in production: M14b3 flag checklist.

## Deliverables
- `packages/ui/src/mods/{ui-host.ts, srcdoc.ts, bootstrap.js.txt, panel-renderer.tsx, PanelFrame.tsx, hud-widgets.tsx, ui-limits.ts, xr-panel.ts, index.ts}`.
- `packages/engine/src/sim/mods/ui-relay.ts`, plus the `ui` and `hud` namespaces in the broker.
- Tests:
  - `packages/ui/src/mods/test/{srcdoc.spec.ts, panel-renderer.spec.ts, ui-limits.spec.ts, ui-host-select.spec.ts}`;
  - `tests/e2e/mods-ui.spec.ts` (tags `@mods-ui-isolation`, and `@xr @mods-ui-xr` for the XR test);
  - fixtures `tests/fixtures/mods/{ui-probe,ui-panel}/`.
- `tools/ci/checklists/{M13a5-iphone15.json, M13a5-quest3.json}`.
- i18n keys `mods.ui.*`, `perm.ui.panel`, `perm.ui.hud`.
- No new secrets or scripts.

## Interfaces
- C14 1.0 `UiMsg`, `PanelDoc`, `ModApiUi`, `ModApiHud` and limits are used verbatim. C13 1.1 `XrPanels` through S10's `UiSurface`. The new `hud.mod.<hash>` key fits the C06 1.1 `hud.${string}` template.
- No contract change. `BootConfig.hosts.modsUi` stays absent (DN-S12-02).

## Acceptance criteria
- AC-1 Given a mod `ui.html` that begins with its own `<meta http-equiv="Content-Security-Policy">` and a `<base>` tag When `srcdoc.ts` builds the document Then the output starts with the host CSP `<meta>` exactly as specified, the bootstrap follows, the mod markup comes after both, and the built iframe element has `sandbox="allow-scripts"`, an empty `allow` and `referrerpolicy="no-referrer"` (golden string compare) — proof: `pnpm check:unit -- packages/ui/src/mods/test/srcdoc`
- AC-2 Given `dv-panel/1` fixtures with 41 nodes, depth 4, and an unknown node kind When rendered Then each is refused with `schema.invalid`; a valid panel renders text only through text nodes, and its button posts `{t:'ui', msg:{panel:'<id>'}}` — proof: `pnpm check:unit -- packages/ui/src/mods/test/panel-renderer`
- AC-3 Given an open panel When a 4,097-byte message and then 31 messages within one second are posted Then the first is dropped with a coded log, the burst closes the panel, `mod.fault {reason:'ui'}` is emitted once, and the mod's script still receives ticks — proof: `pnpm check:unit -- packages/ui/src/mods/test/ui-limits`
- AC-4 Given the selection table (XR presenting with and without `xrPanel`, `mods.ui` false with and without `xrPanel`, `mods.ui` true) When `ModUiHost.open` runs Then it chooses L2, the VR notice, L2, the off-notice and L0 respectively — proof: `pnpm check:unit -- packages/ui/src/mods/test/ui-host-select`
- AC-5 Given a QA build with `mods.ui` true and the `ui-probe` mod open in Chromium When the probe tries `parent.document`, `top.location.href`, `localStorage`, `indexedDB.open`, `fetch('/api/v1/boot')`, `new Worker(...)` and `window.open` Then each attempt reports an error or `null` to the host through the port, the page's DOM, storage and URL are unchanged, and no request to `/api/v1/boot` is recorded from the frame — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-ui-isolation`
- AC-6 Given the same suite on WebKit When it runs Then the same attempts are blocked, and `test-results/mods-ui-matrix.webkit-webgl2.json` and `…chromium-webgl2.json` exist, recording U2 values (`crossOriginIsolated`, `SharedArrayBuffer` type, referrer, CSP result) without asserting them — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @mods-ui-isolation`
- AC-7 Given IWER `immersive-vr` and the `ui-panel` mod When the mod opens its panel Then a world-locked `XrPanel` shows the `xrPanel` document, no iframe exists in the DOM, and a simulated ray press on its button reaches the mod as a `ui` event; a UI mod without `xrPanel` shows "Not available in VR" — proof: `pnpm check:e2e:xr`
- AC-8 Given a flat page with an open panel When the a11y scan runs and the keyboard test tabs and presses Escape Then the scan reports zero critical or serious findings, focus stays inside the panel frame until Escape, and Escape returns focus to the opener — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-9 Given an iPhone 15 (Home Screen app and Safari tab) and a Quest 3 (Quest Browser) on a QA Preview URL When the operator runs the `M13a5` checklists Then `notes.json` files committed under `docs/device-runs/M13a5/{iphone15,quest3}/` record, per browser, whether the L0 probe opened, each probe outcome and the U2 values — proof: manual: iPhone 15 and Quest 3, steps of `pnpm perf:checklist -- tools/ci/checklists/M13a5-iphone15.json` and `pnpm perf:checklist -- tools/ci/checklists/M13a5-quest3.json`; the reviewer reads `notes.json` and decides the `mods.ui` flip in M14b3
- AC-10 Given the production build When it is checked Then `mods.ui` is false in production and staging `FLAGS_JSON`, no `/_test/` route ships and no secret pattern is present — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`

## Test plan
- **Unit:** `srcdoc`, `panel-renderer`, `ui-limits`, `ui-host-select`. Command: `pnpm check:unit -- packages/ui/src/mods`.
- **E2E:** `@mods-ui-isolation` on `chromium-webgl2` and `webkit-webgl2`; `@mods-ui-xr` under `xr-quest3` (`pnpm check:e2e:xr`); `@ui-a11y`.
- **Device:** `M13a5-iphone15`, `M13a5-quest3` (U2 recorded). The CI `device-runs` job validates the committed files.
- **Static:** the `no-inner-html` lint covers the panel renderer and frame.

## Demo script
1. `pnpm dev` (local env, `mods.ui` true); sandbox; console: `await __dvBridge.mods.installFixture('ui-probe')`.
2. The panel opens with the mod name in the host frame; each probe row reads "blocked".
3. Press Escape; focus returns to the HUD.
4. Set `mods.ui` false in `.dev.vars`; reload; `ui-panel` now opens as an L2 panel.
5. `pnpm check:e2e:xr`; watch the XR panel test pass.

## Effort
1 session; ≈ 26 hand-written files. Risk high: browser behaviour of opaque-origin frames under COEP differs by engine (U2, U3).

## Risks & fallbacks
- L0 fails AC-5 on a desktop engine (for example the frame is blocked by COEP): ship L2 only (DL-146 already allows it). Keep the L0 code and the recording, and report. ADR-0030 decides L1 later.
- WebKit on Linux does not deliver a transferred `MessagePort` to an opaque-origin frame: record it in the matrix file, keep AC-6's blocking assertions, and report.
- XR panel text is unreadable at 1.2 m: reuse S10's minimum text height (1.5°) from `UiSurface`; no new rule here.

## Notes for the Builder
- Read first: `12-modding.md` §2.5, §5.5, §6; `12-modding-contracts.md` B§4 (panel), B§5 (`UiMsg`); `10-ui-hud-xr.md` §2.12, §2.13; `spec/11-decision-log.md` DL-146; `docs/decisions/ADR-0012-modding-tiers-and-sandboxes.md`, `ADR-0030-ui-mod-l1-host.md`; `spec/99-open-questions.md` U-API-1.
- Facts in use: F-S12-01, F-S12-02, the opaque-origin and CSP facts in [research/repos-modding.md Verified facts]. Anything else about frame behaviour is a recording, never an assertion.
- Never add `allow-same-origin`, never use `innerHTML` for mod content in the host, and never give the frame a URL.
- Branch `m13a5-mod-ui-tier`.

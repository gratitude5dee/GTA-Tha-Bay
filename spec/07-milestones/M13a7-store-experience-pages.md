# M13a7 — store-experience-pages

## Goal
Players can browse, install and manage mods, and find experiences, from the main menu. The **Mods** page (tabs *Explore* and *Installed*) and the **Experiences** page replace the M04b1 "Coming soon" stubs. They sit on the route 35 and 37 clients and the installer (M13a2) and on the experience entry flow (M13a3). Settings gains the local-import toggle and file picker. Every mod and experience surface carries the Report button. Vehicle mods become loadable: a vehicle-mod **envelope check** against S06's `CLASS_ENVELOPE` joins the shared validator, so a vehicle mod outside its class is rejected the same way in `dv mod check`, at install and (from M13c2) on the server.

## Requirements
- R-MOD-01: the store gives search, install, enable, disable, update, rollback and remove for personal mods.
- R-MOD-04: published experiences are listed, shown on the map and entered from a page as well as from the world.
- R-UI-03: the experiences and mods pages implied by the main menu exist and pass the a11y gate.
- R-MODE-02: vehicle mods stay inside the racing class envelopes (D-S06-08).

## Depends on
- **M13a3**: `ModHost` (vehicle refusal to lift), `ExperienceIndex` and its entry flow, the marker card, route 37 GET. Through it, M13a2 (installer, store client, route 35, revocations).
- **M07b2**: final garage and handling data; `CLASS_ENVELOPE` and the vehicle schemas from M03a1/M07a1 in `packages/shared/src/vehicle/`.
- **M04b1**: shell, kit, page registry, settings, `UiPrefs`, toasts.
- Contracts: C14 1.0 (`ModListItem`, `ModDetail`, `ModVersionDetail`, `InstalledMod`, `InstallStepEvent`, `MOD_PERMISSIONS`, `ModCheckCode`), C17 1.0 (`ExperienceCard`, server-owned moderation and visibility), C12 1.1 (routes 35, 37 GET, 41 reports), C06 1.1 (`UiCommand`, `PrefabDef`), C08 1.0 (`MapApi`, `DistrictId` slugs). S06's `HandlingProfile`, `VehicleClass` and `ClassEnvelope` (`06-racing-data.md` §4.1) are mode-owned, not contracts.

## Scope in
- **Vehicle envelope** (`packages/shared/src/mod/vehicle/envelope.ts`, pure):
  - `packages/shared/schemas/mod/vehicle.v1.schema.json` wraps a C06 `PrefabDef` (kind `vehicle`, id `veh.<modId>.<name>`, mesh refs only from the mod's own assets) and an S06 `HandlingProfile` (by `$ref` to S06's schema).
  - `checkVehicleEnvelope(profile)` tests `class` ∈ `VehicleClass`, and `massKg`, `engine.powerKw` and `tire.muLat` inside `CLASS_ENVELOPE[class]`. Top speed and 0–100 are measured values, so they are not checked statically.
  - Any breach is a finding with code `schema.invalid` and message `vehicle.envelope: <field> <value> outside class <C> [<lo>, <hi>]`. No new `ModCheckCode`.
  - It is wired into the M13a1 validator for every file in `data.vehicles`.
  - The same function runs over every first-party `content/vehicles/handling/*.json` as a guard test.
- **Loader:** `ModHost` lifts the M13a3 `load.flag_off` refusal for kind `vehicle`. Vehicle mods register their prefabs through `PrefabService` in `sandbox` sessions, and in `exp:` sessions whose manifest grants `vehicle.register`. Standalone racing still loads no mods (v1).
- **Mods page** (`packages/ui/src/pages/mods/`).
  - **Explore:**
    - search box (route 35 `q`), kind chips (`experience`, `vehicle`, `character`, `rules`), sort (`new`, `top`, `installed`), and the filter "Works on this device" (route 35 `tier` = this device's tier);
    - infinite scroll with a sentinel;
    - cards: name, author, kind, tier chips, version, thread score, evidence level, AI-assisted badge, content warnings, size;
    - a mod whose `tiersOk` lacks this tier shows an explicit "Not supported on this device" state.
  - **Detail:**
    - description, changelog, versions with states, credits and remix parent;
    - permissions in plain sentences from keys `perm.<id>` for all 17 `MOD_PERMISSIONS`; an unknown value shows "Can't install";
    - `tier: 'ui'` adds "This mod can show its own windows";
    - Report, and a discussion link (shown when `thread` is present; forum UI is M13b4).
  - **Install:** one button runs `ModInstaller.install`; each `InstallStepEvent` line appears in a log, and a toast shows the last three lines with a link to the full log. A failure shows the result's `fix` text.
  - **Installed:**
    - Enabled toggle with the line "Mods never run in Story"; Update available; Roll back; Remove with "Also delete my saved data"; load order; last fault;
    - "Installed outside the store" for local or dev installs;
    - experience mods show Play instead of Enabled; revoked mods show the reason and cannot be enabled.
  - **Offline:** cached lists under an "Offline" banner; installed mods still work.
- **Experiences page** (`packages/ui/src/pages/experiences/`):
  - list from route 37 with `bbox` = the city bounds, paged client-side; filters by neighbourhood (`nhood` → `LocKey nhood.<slug>`) and minimum rating; sort by Wilson lower bound;
  - detail: title, author, rating `sum/count`, radius, neighbourhood, warnings, supported tiers;
  - actions: **Show on map** (opens the phone Map app focused on the experience blip), **Play** (the M13a3 entry flow, the same gates as the world marker), **Report**;
  - a one-time notice before the first entry, as in `10-ui-pages.md` §2.12, remembered in `UiPrefs`.
  - Pages are flat-only. XR uses the world marker card.
- **Settings → Mods** (`packages/ui/src/settings/mods.tsx`): "Allow local mods" (device-scoped `UiPrefs.allowLocalMods`, default off). When on, a `.dvmod` file picker runs `install({kind:'local'})`; it is hidden on XR tiers. The Developer section (M13a6) moves here if it lives elsewhere.
- **Report everywhere:** mod cards, mod detail, experience cards, experience detail and the M13a3 marker card are tagged `UgcSurface` and contain `ReportButton`. A `copyright` report redirects to `/legal/dmca`.
- **Telemetry:** `ui.page` for `mods` and `experiences` (existing name).

## Scope out
- Forum threads and ratings links: M13b2 and M13b4. Publishing: M13c2 and M13c3; "My creations" is post-v1 (DL-240). `installs30d` roll-up: post-v1 (DL-420).
- Vehicle mods in standalone racing (`GameModeDescriptor.modSurface`): not v1.
- Measured top-speed and 0–100 checks for vehicle mods, and PI bands: post-v1 (needs a headless oracle run on the server).
- Final a11y audit and translations: M14c.

## Deliverables
- `packages/shared/src/mod/vehicle/{envelope.ts, index.ts}`; `packages/shared/schemas/mod/vehicle.v1.schema.json`; regenerated mod validators (M13a1 generator); `packages/shared/src/mod/test/vehicle-envelope.spec.ts`.
- `packages/engine/src/sim/mods/vehicles.ts` (registration) and the change in `host.ts`.
- `packages/ui/src/pages/mods/{index.tsx, explore.tsx, detail.tsx, installed.tsx, install-log.tsx, permissions.ts}`.
- `packages/ui/src/pages/experiences/{index.tsx, detail.tsx, notice.tsx}`.
- `packages/ui/src/settings/mods.tsx`.
- i18n keys `mods.*`, `perm.<17 ids>`, `exp.page.*`.
- Tests:
  - `packages/ui/src/pages/mods/test/{permissions.spec.ts, installed.spec.ts}`; `packages/ui/src/pages/experiences/test/list.spec.ts`; `packages/ui/src/settings/test/mods-settings.spec.ts`;
  - `tests/e2e/mods-store.spec.ts` (tag `@mods-store`; routes 35 and 37 stubbed with Playwright `page.route` JSON fixtures; installs through the real installer with fixture archives).
- No new secrets or scripts.

## Interfaces
- C14 1.0 DTOs and records, and C17 1.0 cards, are read-only in the UI; moderation and visibility are never written by the client. S06 `CLASS_ENVELOPE` is consumed unchanged.
- Vehicle data outside the class envelope is rejected, never clamped (D-S06-08; `12-modding-contracts.md` B§4 amended, DL-240), because a silent clamp would change the creator's car.
- No contract change.

## Acceptance criteria
- AC-1 Given vehicle fixtures (class C with `massKg` 2,500; class A with `tire.muLat` 1.5; class `X`; a valid class B car) When the shared validator runs Then the first three yield `schema.invalid` with a `vehicle.envelope` message naming the field and range, and the valid car passes; every first-party handling file passes the same check — proof: `pnpm check:unit -- packages/shared/src/mod/test/vehicle-envelope`
- AC-2 Given a sandbox session and the valid vehicle fixture mod installed When it loads Then its prefab registers as `veh.<modId>.<name>` and `PrefabService` spawns it in the headless sim; an out-of-envelope archive is refused at install with the same finding — proof: `pnpm check:unit -- packages/engine/src/sim/mods packages/engine/src/client/mods`
- AC-3 Given the permission sentences When `permissions.spec.ts` walks all 17 `MOD_PERMISSIONS` Then each has an `en.json` sentence, an unknown value renders "Can't install", and a `ui`-tier mod adds "This mod can show its own windows" — proof: `pnpm check:unit -- packages/ui/src/pages/mods`
- AC-4 Given stubbed route 35 results When the player searches "cones", picks kind `experience`, sorts by `top` and turns on "Works on this device" Then the requests carry `q=cones`, `kind=experience`, `sort=top` and `tier=<the device tier>`, scrolling to the sentinel requests the next cursor, and a card without this tier shows "Not supported on this device" — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-store`
- AC-5 Given a stubbed version detail and a fixture archive When the player presses Install Then the log shows the six step lines, the toast shows the last three, the Installed tab lists the mod with "Mods never run in Story", and Remove with "Also delete my saved data" leaves no row — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-store`
- AC-6 Given stubbed route 37 cards in two neighbourhoods When the player filters one neighbourhood and opens a card Then only its cards are listed, Show on map opens the phone Map focused on that blip, the first Play shows the sandbox notice exactly once across reloads, and Play starts the M13a3 entry flow — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-store`
- AC-7 Given every component tagged `UgcSurface` When the UGC surface test runs Then each contains `ReportButton`, and a `copyright` report navigates to `/legal/dmca` — proof: `pnpm check:unit -- packages/ui`
- AC-8 Given "Allow local mods" off When Settings → Mods opens Then no file picker exists; when on, importing a `.rpf` file shows "Game files from other titles can't be uploaded" and installs nothing — proof: `pnpm check:unit -- packages/ui/src/settings`
- AC-9 Given the mods and experiences pages with stubbed data When the a11y scan covers every flat page and the iPhone-viewport touch run opens both pages Then the scan reports zero critical or serious findings and all controls lie inside the safe area — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y && pnpm check:e2e -- --project=webkit-webgl2 --grep @mods-store`
- AC-10 Given the production build When it is checked Then no `/_test/` route and no secret pattern ship, and the bundle budgets hold — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist && pnpm check:bundle`

## Test plan
- **Unit:** vehicle envelope (shared), loader registration (engine), permissions, installed rows, experiences list filters, UGC surfaces (UI). Commands: `pnpm check:unit -- packages/shared/src/mod`, `pnpm check:unit -- packages/ui`.
- **E2E:** `@mods-store` on `chromium-webgl2` and `webkit-webgl2` (iPhone viewport); `@ui-a11y`.
- **Static:** `no-inner-html` lint; `pnpm check:i18n` report reviewed.

## Demo script
1. `pnpm dev`; Main menu → Mods → Explore (local wrangler with seeded rows, or the e2e fixture server).
2. Search "cones"; open the card; read the permission sentences; Install; watch the log.
3. Installed tab: disable, enable, roll back, remove.
4. Main menu → Experiences; filter Embarcadero; Show on map; Play.
5. Settings → Mods → Allow local mods; import a fixture vehicle `.dvmod`; spawn it in the sandbox.

## Effort
0.7 session; ≈ 26 hand-written files. Risk low: UI over shipped clients plus one pure check.

## Risks & fallbacks
- S06's handling schema is not reachable by `$ref` from the mod schema (different `$id` base): inline a copy generated at build by the M13a1 generator, with the drift test covering it.
- The Map app cannot focus a blip by id: set a waypoint at the blip position and open Map (existing `phone.waypoint` command). Record the choice.
- File budget: merge `install-log.tsx` into `detail.tsx` and `notice.tsx` into `detail.tsx`.

## Notes for the Builder
- Read first: `10-ui-pages.md` §2.11 (report rules), §2.12; `12-modding-publish.md` C§4 (markers, entry), C§6 (store), C§7; `12-modding-contracts.md` B§4, B§7; `06-racing-content.md` C.2; `06-racing-data.md` §4.1; `06-racing.md` D-S06-08.
- All mod and experience text is user content: render it as text nodes; thumbnails load only from `BootConfig.hosts.ugc` with `crossorigin="anonymous"` (COEP).
- Mods are disabled while a room is active. The Installed toggles show that state rather than hiding.
- Branch `m13a7-store-experience-pages`.

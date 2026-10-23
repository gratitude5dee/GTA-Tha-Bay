# M04e2 — sandbox-teleport-display

## Goal
After this session the phone's Sandbox app has two more `ScreenDef` sections, so the XR panel (M11b3) gets them too:
- **Teleport:** the 37 landmarks of `content/world/teleports.json`, "jump to my map pin", "back to where I was", and up to 32 remembered spots (`SAVE_LIMITS.sandboxSavedPositions`). All go through `TeleportApi.request('sandbox', …)`, so M02c1's heat refusal, 8 s pre-stream (player unmoved on failure), fade and ground placement apply. Today `sandbox.teleport` bypasses them through `CommandDeps.teleport` (`packages/engine/src/sim/modes/commands.ts`); this milestone reroutes it.
- **Display:** hide the HUD and the minimap. Pause and the phone still open.

Today only the QA world controls (`packages/world/src/client/world-controls.ts`) reach the landmark list, and only the QA save-kill helper writes `SandboxSlice.savedPositions`.

## Requirements
- R-MAP-01 (primary): the player can jump to the city's real landmarks and recognise where they are.
- R-UI-03 (support): the Sandbox app, an implied page, gets its Teleport and Display sections.
- R-ENG-04 (support): with the HUD hidden, subtitles stay on screen, and hiding follows the reduced-motion setting.
- R-IP-01 (support): every new label and status string is our own wording.

## Depends on
- **M04e1** (sandbox-world-controls): the `sandbox-tabs` widget, `sandboxSim(env).onEvent` with `SANDBOX_ACTIONS`, `RigOptions.world` (`packages/engine/test/modes/fixture.ts`) and `PhoneEnv.sandboxWorld`. Same files, so it merges first.
- Through M04e1: **M04e0** (sandbox-rooms-guard): its online refusal stays the first check of every path below.
- Merged on `claude/build`:
  - M02c1 (`TeleportService`, `TELEPORT_MSG`, `PRESTREAM_TICKS`, `ARRIVE_TOLERANCE_M` in `packages/world/src/sim/api/teleport.ts`; the heat policy bound in `packages/world/src/sim/streaming/module.ts`);
  - M02c2 (`phone.waypoint` and `map.waypoint.clear` in `commands.ts`; the Map app);
  - M04b2 (`appScreen`, `placeName` in `packages/ui/src/phone/apps.ts`; `PhonePage`, `usePhoneEnv` in `packages/ui/src/phone/pause.tsx`; `StoryHud`, `HudGrid`);
  - M04a2 (`ModeHost.route`, `makeRig`, `ModeContext.save.request`).
- Contracts: C05 1.2 (`SandboxSlice.savedPositions`, `SAVE_LIMITS`), C06 1.1 (`UiCommand`, `ModeContext.world`), C08 1.0 (`TeleportApi`, `TeleportTarget`, `TeleportResult`). All are read only; no contract change.

## Scope in
- **One teleport path** (new `packages/engine/src/sim/modes/builtin/sandbox-teleport.ts`, in C02 lint scope):
  - `sandboxGo(ctx, to: TeleportTarget, env)`: reads the player pose (`SandboxEnv.playerPose`, the `playerPose` that `modes/index.ts` already passes to `builtinDescriptors`), raises the info toast `sandbox.teleport.wait`, then calls `ctx.world.teleport.request('sandbox', to)`. On `ok`, it stores the pose it read as the session's **previous** pose. On failure, it raises a warning toast whose text is the result's `messageKey`, and nothing else changes.
  - Session state (the previous pose) lives in a `WeakMap<ModeContext, …>`. It is cleared by the sandbox `enter` and `exit`, and is never saved.
  - `createWaypointMemo()` returns `{ set(x, z), clear(), get() }`. In `commands.ts`, `phone.waypoint` calls `set` and `map.waypoint.clear` calls `clear`. `modes/index.ts` binds `SandboxEnv.waypoint` to `get`. C08 `MapApi` has no waypoint getter, so the memo is engine-internal and changes no contract.
- **Actions** (rows added to M04e1's `SANDBOX_ACTIONS`, reached as `mode.cmd {mode:'sandbox', name, args}`):
  - `teleport.landmark {id}`: `id` matches `^lm\.[a-z0-9-]{1,64}$` and is in `ctx.world.teleport.candidates('sandbox')`. Otherwise the toast is `world.teleport.unknownTarget` and nothing is requested. Then `sandboxGo(ctx, {landmark: id})`.
  - `teleport.waypoint`: `sandboxGo(ctx, {x, z})` from the memo, or the toast `sandbox.teleport.noWaypoint`.
  - `teleport.back`: `sandboxGo(ctx, previous)`, or the toast `sandbox.teleport.noPrevious`. A successful jump back makes the spot it left the new previous pose.
  - `position.save`: takes the pose and names the spot `pos-<n>`, with `n` the lowest free number 1–32. A full list raises `sandbox.position.full` (param `max`). With no player, the toast is `sandbox.position.noPlayer`. On success, the toast is `sandbox.position.saved` (param `n`), and `ctx.save.request('manual')` is called once.
  - `position.delete {name}`: removes the spot, toasts `sandbox.position.forgot` and calls `ctx.save.request('manual')`. An unknown name changes nothing.
- **Rerouted commands** (`commands.ts`, after M04e0's refusal and the `sandboxContext()` check):
  - `sandbox.teleport {name}` calls `sandboxGo(ctx, {x, z, yaw})` with the saved spot; a missing name toasts `sandbox.position.missing`. `CommandDeps.teleport` is no longer called on this path. The saved `y` is kept for C05, but the place step finds the ground again.
  - The phone map's `map.travel` keeps its kind and refusals but calls `sandboxGo` too, so "back" also works after a map jump.
- **View model:** `mode.sandbox.teleport` = `{ positions: {name, x, z}[], previous: boolean }`, with x and z rounded to whole metres. It is published on enter and after every change. One worst-case patch (32 names of 80 characters, the schema maximum that old or QA saves may hold) must fit `PATCH_LIMITS.bytesPerTick` (`packages/engine/src/sim/ui/coalesce.ts`).
- **Phone UI:**
  - `apps.ts`: two new `sandbox-tabs` tabs, `teleport` and `display`.
  - **Teleport tab:**
    - The list `sandbox-landmarks` has one row per id of `content/world/teleports.json`, in file order. The UI imports that file, as `creator/catalog.ts` imports its content. Each row's text is `placeName('place.' + id.slice(3), id)`, the bake's `nameKey` rule (`tools/map/src/stages/s10-places.ts`).
    - Buttons: `sandbox-waypoint`, `sandbox-back` (disabled with `phone.sandbox.noPrevious` while `previous` is false), `sandbox-spot-save` (disabled with `phone.sandbox.spotsFull` at 32) and `sandbox-spot-forget` (switches the spot list between going and forgetting).
    - The list `sandbox-spots` shows `pos-<n>` as `t('sandbox.position.name', {n})`; any other stored name shows as plain text.
  - **Display tab:** the buttons `sandbox-hide-hud` and `sandbox-hide-minimap` send `sandbox.set` with the paths `sandbox.display.hideHud` and `sandbox.display.hideMinimap`, which `applyToggle` already stores. There is one source of truth: `SandboxSlice.toggles`.
  - While `sandboxWorld.online` is true (M04e1), every new control carries `disabled: 'sandbox.refuse.online'`.
  - `pause.tsx`:
    - `usePhoneEnv` reads `mode.sandbox.teleport`, and `PhonePage` holds the forget switch.
    - The calls `sandbox.landmark`, `sandbox.waypoint`, `sandbox.back` and `sandbox.spot` send their command and then `ctx.fire('resume')`, the Pause page's Resume path. The phone pauses the sim, and the teleport needs ticks to run.
    - A spot press while forgetting sends `position.delete` and stays on the phone.
- **HUD** (`packages/ui/src/hud/model.ts` gains the pure `hudHidden(mode, toggles)`; `story-hud.tsx` applies it):
  - In sandbox only, `hideHud` hides the `tl`, `tr`, `bl` and `br` regions and the tip bar and interaction prompt of `bc`. Subtitles, region `c` (talk, shop and fail panels) and toasts stay.
  - `hideMinimap` hides `bl` only.
  - Hidden regions get `data-hidden="true"` and `visibility: hidden` (`packages/ui/src/kit/m04b2-hud.css`). The opacity transition is 150 ms, and none under `[data-reduced-motion='true']` or `prefers-reduced-motion`.
  - Any other mode ignores the toggles.
- **Text** (`content/ui/i18n/en.json`, original wording):

  | key | value |
  |---|---|
  | `phone.sandbox.tab.teleport` / `.display` | Go places / Screen |
  | `phone.sandbox.landmarks` | Landmarks |
  | `phone.sandbox.waypoint` | Jump to my map pin |
  | `phone.sandbox.back` | Back to where I was |
  | `phone.sandbox.noPrevious` | No earlier spot this session |
  | `phone.sandbox.spots` / `.spotSave` | My spots / Remember this spot |
  | `phone.sandbox.spotForget` / `.spotForgetDone` | Forget a spot / Done forgetting |
  | `phone.sandbox.spotsFull` / `.spotsEmpty` | All spots are taken / No spots yet. Stand somewhere you like and remember it. |
  | `phone.sandbox.hudShown` / `.hudHidden` | HUD: on screen / HUD: tucked away |
  | `phone.sandbox.mapShown` / `.mapHidden` | Minimap: on screen / Minimap: tucked away |
  | `phone.sandbox.displayNote` | Pause and the phone still open while the HUD is tucked away. |
  | `sandbox.teleport.wait` | Heading there. The streets are filling in. |
  | `sandbox.teleport.noWaypoint` / `.noPrevious` | Drop a pin on the map first. / Nowhere to head back to yet. |
  | `sandbox.position.name` / `.saved` | Spot {n} / Spot {n} remembered. |
  | `sandbox.position.full` | You already keep {max} spots. Forget one first. |
  | `sandbox.position.forgot` / `.missing` / `.noPlayer` | Spot forgotten. / That spot is gone. / Nobody to place yet. Try again once you are on the street. |

  - Add a `place.<slug>` English value for each of the 37 ids. Each value is the readable form of the id, such as "Pyramid Tower" or "Bay Bridge (Yerba Buena Island)". The ids already avoid company, team and sponsor names, and the values must too.
  - `tools/ci/check-i18n.ts` adds `place.`, `sandbox.teleport.` and `sandbox.position.` to `EXTERNAL_PREFIXES`.
- **Builder decisions:** BD rows go in `spec/11-decision-log-builder.md`, under the section M04e2.

## Scope out
- Typed spot names. `ScreenDef` has no text-entry widget (`packages/ui/src/screen/types.ts`), so spots are numbered and no player text is stored. Renaming waits for a text widget.
- The rooms policy of `TeleportApi` and `EV TeleportGrant` (M12b2, M12c1). Here, M04e0's refusal covers every new action.
- Hiding the XR HUD surface (M11b3), the photo mode and the Camera app (post-v1, DL-292), and a temporary "peek" key, which would need a new C03 input action.
- The vehicle spawner, vehicle actions and player toggles (the vehicle-spawner milestones); weather, time and world (M04e1).
- Rewording `world.teleport.*` values (M04e5). This milestone passes `messageKey` through and quotes no value.

## Deliverables
- Engine: `packages/engine/src/sim/modes/builtin/sandbox-teleport.ts` (new), `builtin/sandbox.ts` (actions, enter and exit, `SandboxEnv.playerPose` and `waypoint`), `builtin/index.ts` (exports), `modes/commands.ts` (`CommandDeps.waypoint`, the reroutes), `modes/index.ts` (bindings).
- Engine tests: `packages/engine/test/modes/sandbox-teleport.spec.ts` (new); `packages/engine/test/modes/fixture.ts` (`RigOptions.playerPose`, `waypoint`).
- UI: `packages/ui/src/phone/apps.ts`, `packages/ui/src/phone/pause.tsx`, `packages/ui/src/hud/story-hud.tsx`, `packages/ui/src/hud/model.ts`, `packages/ui/src/kit/m04b2-hud.css`.
- UI tests: `packages/ui/test/sandbox-teleport.spec.ts` (new); `packages/ui/test/ui-screen-parity.spec.ts` (extended).
- `content/ui/i18n/en.json`; `tools/ci/check-i18n.ts`.
- e2e: `tests/e2e/ui/sandbox-teleport.spec.ts` (new, tag `@sandbox-teleport`). It runs in the `DV_WORLD=synth` half, so it does not go in `GRAYBOX_GREP`.
- `spec/11-decision-log-builder.md`.
- About 18 files.

## Interfaces
- C08 1.0 `TeleportApi.request('sandbox', TeleportTarget)` and `candidates('sandbox')`: used as they are.
- C06 1.1 `UiCommand` (`sandbox.teleport`, `sandbox.set`, `mode.cmd`, `phone.waypoint`), `ModeContext.world`, `ModeContext.save.request('manual')`, `UiBridge.toast` and `patch`: used as they are.
- C05 1.2 `SandboxSlice.savedPositions` (≤ 32 entries, name 1–80 characters, `sandbox.v1.schema.json`) and `toggles`: written with their existing types.
- Engine-internal, in no contract: `sandboxGo`, `createWaypointMemo`, the `mode.sandbox.teleport` view-model key and the `pos-<n>` naming rule.

## Acceptance criteria
- AC-1 Given the merged base with this milestone When the repository checks run Then:
  - they pass;
  - `pnpm lint` reports no C02 finding in `packages/engine/src/sim/**`;
  - `check:i18n` reports no missing or unused key

  — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm check:i18n && pnpm build`
- AC-2 Given a rig running sandbox, with a `teleport` stand-in that has `request` and `candidates` spies and a fixed `playerPose` When `teleport.landmark {id:'lm.coit-tower'}` is dispatched Then:
  - `request` is called once with `('sandbox', {landmark:'lm.coit-tower'})`, and `sandbox.teleport.wait` is toasted;
  - **success:** with an `ok` result, `mode.sandbox.teleport.previous` becomes true;
  - **failure:** with a result `{ok:false, reason:'not-loaded', messageKey}` (the stand-in uses the key string of `TELEPORT_MSG.notLoaded`), exactly one warning toast carries that `messageKey`, and `previous` and `slices.sandbox` are unchanged;
  - **unknown id:** `lm.nowhere` toasts `world.teleport.unknownTarget` without a request;
  - **online:** with M04e0's fake net, the action is refused with `sandbox.refuse.online` and `request` is never called

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-teleport.spec.ts`
- AC-3 Given a rig with a saved spot `pos-1` When `sandbox.teleport {name:'pos-1'}` is dispatched Then:
  - `request` receives `('sandbox', {x, z, yaw})` of that spot;
  - the `CommandDeps.teleport` spy is never called;
  - a `{ok:false, reason:'heat', messageKey}` result toasts that `messageKey`;
  - `{name:'pos-9'}`, which is not saved, toasts `sandbox.position.missing`;
  - `map.travel {x:10, z:-20}` reaches `request('sandbox', {x:10, z:-20})` and sets `previous` on success

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-teleport.spec.ts`
- AC-4 Given a rig running sandbox When `position.save` is dispatched 33 times, `position.delete {name:'pos-5'}` once, and `position.save` once more Then:
  - the names are `pos-1`…`pos-32`, each with the pose `playerPose` returned;
  - the 33rd save toasts `sandbox.position.full` with `{max: 32}` and leaves 32 entries;
  - the final save reuses `pos-5`;
  - every successful save and the delete record one `manual` autosave in the rig;
  - the last posted sandbox record passes `validateSchema` with `sandbox.v1.schema.json`, and a new rig started from it publishes the same 32 positions;
  - with `playerPose` returning `null`, `position.save` toasts `sandbox.position.noPlayer` and writes nothing;
  - a `mode.sandbox.teleport` value with 32 names of 80 characters is at most `PATCH_LIMITS.bytesPerTick` bytes

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-teleport.spec.ts`
- AC-5 Given a rig running sandbox When the waypoint and back actions are dispatched Then:
  - `teleport.waypoint` toasts `sandbox.teleport.noWaypoint` before any `phone.waypoint`;
  - after `phone.waypoint {x:120, z:-340}`, it requests `('sandbox', {x:120, z:-340})`;
  - after `map.waypoint.clear`, it refuses again;
  - `teleport.back` toasts `sandbox.teleport.noPrevious` until a jump succeeds, then requests the pose read before that jump;
  - after `mode.quit` and a new `mode.start sandbox`, `previous` is false

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-teleport.spec.ts`
- AC-6 Given a rig running `story` When every new action, `sandbox.teleport` and the display paths are dispatched Then:
  - `slices.sandbox` and `slices.story` are deep-equal to their values before;
  - `request` and the save spy are never called

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-teleport.spec.ts`
- AC-7 Given `appScreen('sandbox', env)` with a teleport env When its tabs are built Then:
  - `teleport` and `display` follow M04e1's tabs;
  - `sandbox-landmarks` has 37 rows in `teleports.json` order, and each row's text is a real `place.*` value, not the key;
  - every `teleports.json` id is a landmark id in `content/world/landmarks.json`;
  - `sandbox-back` and `sandbox-spot-save` are disabled with their keys in the stated cases;
  - the display buttons send the two `sandbox.set` paths with the negated current value;
  - with `online: true`, every new control is disabled with `sandbox.refuse.online`;
  - `DomScreen` and `CanvasScreen` give both tabs the same focus order

  — proof: `pnpm check:unit -- packages/ui/test/sandbox-teleport.spec.ts packages/ui/test/ui-screen-parity.spec.ts`
- AC-8 Given `hudHidden` When it is called with each combination of mode (`sandbox`, `story`) and the two toggles Then:
  - `hideHud` in sandbox hides `tl`, `tr`, `bl`, `br`, the tip bar and the prompt, but never the subtitles or `c`;
  - `hideMinimap` alone hides `bl` only;
  - `story` hides nothing

  — proof: `pnpm check:unit -- packages/ui/test/sandbox-teleport.spec.ts`
- AC-9 Given a QA build on the synth world with sandbox running When the e2e uses Pause → Phone → Sandbox → Go places Then:
  - **landmark:** picking Coit Tower puts the player within `ARRIVE_TOLERANCE_M` (3 m) of its arrival point, as listed by `__dvBridge.world.call('candidates', {kind:'sandbox'})`, and grounded, within 60 s;
  - **spots:** "Remember this spot", a jump to the Ferry Building, then Spot 1 returns within 3 m of the remembered x and z;
  - **back:** "Back to where I was" returns within 3 m of the Ferry Building arrival;
  - **heat:** at heat 1 (`sandbox.set`), a landmark pick shows the toast text `en.json['world.teleport.heat']` and moves the player less than 0.05 m;
  - **display:** with the HUD tucked away, regions `tl`, `tr`, `br` and `hud-minimap` are not visible, their computed `transition-duration` is `0s` under the new profile's reduced motion, and Escape still opens Pause; turning it back on shows them again;
  - **clean run:** no `pageerror` occurs

  — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-teleport && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @sandbox-teleport`
- AC-10 Given the existing phone, world and sandbox suites When they run after this milestone Then they pass unchanged — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@ui-pause|@world-teleport|@world-map|@sandbox-world"`
- AC-11 Given the new strings When the IP and name scans run on the tree and the build Then:
  - they exit 0;
  - no new value contains `DISPLAY_NAME` or `SHORT_NAME` from `config/brand.ts` (a case in `packages/ui/test/sandbox-teleport.spec.ts`)

  — proof: `pnpm build && pnpm ip:strings && pnpm names:lint && pnpm check:unit -- packages/ui/test/sandbox-teleport.spec.ts`

## Test plan
- **Unit:** engine `modes/sandbox-teleport.spec.ts` (AC-2–AC-6) plus the whole `packages/engine/test/modes` suite; UI `sandbox-teleport.spec.ts` and `ui-screen-parity.spec.ts` (AC-7, AC-8, AC-11).
- **e2e:** `@sandbox-teleport` on both WebGL2 projects (AC-9); regression tags (AC-10).
- **Repository and IP:** AC-1, AC-11.

## Demo script
1. `DV_WORLD=synth pnpm dev`, New Game → Sandbox, then Pause → Phone → Sandbox → Go places → Twin Peaks.
2. "Remember this spot", Golden Gate Bridge, Spot 1, then "Back to where I was".
3. Drop a map pin, then "Jump to my map pin".
4. Screen → "HUD: tucked away"; Escape still opens Pause.

## Effort
0.7 Builder session; about 18 files; risk **low**.

## Risks & fallbacks
- **A far landmark on `mobile-low` misses the 8 s pre-stream.** That is the designed refusal (player unmoved, message shown); the e2e retries once. `PRESTREAM_TICKS` counts sim ticks, so a paused phone never uses it up.
- **M04e1's `SANDBOX_ACTIONS` has another shape.** Add the rows in its form, keep the names, record a BD row.
- **No baked world:** `ctx.world` is the stand-in (`packages/engine/src/sim/modes/world-standin.ts`), requests answer `not-loaded`, and the toast says so.

## Notes for the Builder
- **Read first:** `packages/world/src/sim/api/teleport.ts`; in `packages/engine/src/sim/modes/`: `commands.ts`, `builtin/sandbox.ts`, `index.ts` (`playerPose`), `host.ts` (`route`); M04e0 and M04e1; `packages/ui/src/phone/{apps.ts, pause.tsx}`, `packages/ui/src/hud/{story-hud.tsx, model.ts}`; `tests/e2e/ui/hud.spec.ts` (`bootSynth`, the `@ui-pause` flow); `spec/domains/02-world-maps.md` §5.
- **Order:** engine path and reroutes, actions and view model, engine spec, UI and HUD, text, e2e.
- **C02:** `sandbox-teleport.ts`, `sandbox.ts` and `commands.ts` are in lint scope. No `Date`, timers, `**` or `for…in`; `Math.round` is fine. The `request(...).then` continuation is the same pattern `map.travel` uses today.
- **IP wall:** the wording above is original; if one reads badly, pick another phrase of our own and record a BD row. Take no wording, section names or menu structure from other sandbox menus or trainer tools; the research checklist names features only.
- **Spots are local:** numbered, no player text, never published, so no moderation applies (R-IP-03 covers UGC shown to others).
- **Secrets:** none.

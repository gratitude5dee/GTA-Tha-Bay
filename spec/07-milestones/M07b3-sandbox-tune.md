# M07b3 — sandbox-tune

## Goal
After this session the phone's Sandbox app has a **Tune** tab. For each car the player has placed with M04e3, the tab shows the racing garage's upgrade rows from M07b2, with no prices. The player can raise or lower each part a level at a time, put every part at the top level, or take the car back to stock. The change applies to that car at once while it stands still. It costs nothing, and it never reaches the racing purse, `CoreSlice.garage`, `SandboxSlice`, a save or a race.

The guard is the car itself, not the PI band. Tuning accepts only a car whose key is `veh:sbx<n>` and that is still in M04e3's session list. The levels live only in the running sandbox and in the car's runtime handling profile, so they leave the world with the car on exit, on dismissal and on joining an online session. Every tune command is refused online (M04e0).

## Requirements
- R-UI-03 (primary): the Sandbox app, an implied page, gets its tuning section.
- R-MODE-02 (support): the garage's upgrade model (06-racing-content.md C.4) is reused as is, and no session tuning can reach racing progression or a race entry.
- R-ROLL-02 (support): tuning is refused while `ModeContext.net` is set, and tuned cars leave the world when a room is joined (M04e0, M04e3).
- R-PLAT-02 (support): the tab is a `ScreenDef`, so the XR panel (M11b3) shows the same controls in the same focus order.
- R-IP-01 (support): every label is original and passes `ip:strings` and `names:lint`.

## Depends on
- **M07b2** (racing-garage-replay-photo-visuals):
  - the C.4 multiplier code in `packages/modes/racing/src/garage/upgrades.ts`;
  - the per-car upgrade view-model in `packages/modes/racing/src/garage/garage-vm.ts` (slot, level, next-level effect, price);
  - `content/vehicles/pi.lock.json`;
  - its `garage` spec.
- **M04e3** (sandbox-vehicle-spawner): the `owned` list of `{key, prefab, h}` in the `sandboxSim` closure, `SandboxVehiclePort` in `packages/engine/src/sim/modes/sandbox-vehicle-port.ts`, the `vehicles` tab and `mode.sandbox.vehicles`, `RigOptions.sandboxVehicles`, and the `veh:sbx<n>` keys.
- **M04e5** (ip-wall-strings): the `trainer-*` patterns that AC-8's `ip:strings` enforces.
- Through M04e3: **M04e1** (`SANDBOX_ACTIONS`, `sandbox-tabs`) and **M04e0** (`sandboxOnline`, `SANDBOX_REFUSE_ONLINE`, the dispatcher's online refusal).
- Merged on `claude/build`:
  - M03a1: `VehicleStore`, `vehicleResource`, `handlingById`, `UnknownHandlingError` and `HANDLING_PRESETS` in `packages/engine/src/sim/vehicle/{components.ts, presets.ts}`; `createVehicleWorld` and `drive` in `packages/engine/test/vehicle-sim.ts`;
  - M07a1: `raceCar`, `RACE_CARS` and `LOANER_CAR` in `packages/modes/racing/src/cars.ts`; the racing `enter`, which throws on an unknown `params.vehicle`.
- **Merge order.** M04e3 is in the Architect's registration batch with this file. M04e4 edits the same sandbox and phone files, so whichever of the two merges second rebases.
- Contracts: C01 1.0 (`StableKey` `veh:`), C05 1.2 (`VehicleInstance.upgrades`, `UpgradeSlot`; `CoreSlice` and `SandboxSlice` unchanged), C06 1.1 (`UiCommand mode.cmd` ≤ 512 B, `EconomyApi`, `ModeContext.net`). All are read only.

## Scope in
- **Pure upgrade code** (`packages/shared/src/vehicle/upgrades.ts`, exported from `packages/shared/src/vehicle/index.ts`; C02 lint applies):
  - `upgradedProfile(base, upgrades)`: M07b2's multiplier function, moved here unchanged if M07b2 left it in the racing package, which re-exports it. It always starts from the base profile and never mutates its input.
  - `upgradeRows(levels, { free })`: M07b2's per-car row builder, moved the same way; `free: true` sets every price to 0.
  - `UPGRADE_SLOTS`, in the order `engine, tires, brakes, suspension, weight, nitro, armor`. `SANDBOX_TUNE_SLOTS` is the same list without `nitro`: only the race director fires nitro (`packages/modes/racing/src/sim/nitro.ts`), so the row would do nothing in free roam.
  - `tunedHandlingId(baseId, levels)`. It returns `<baseId>~sbx<d1…d7>`, one digit 0–3 per slot in `UPGRADE_SLOTS` order, or `baseId` itself when every level is 0.
  - `parseTunedHandlingId(id)`. It returns `{ base, levels }` or `null`, and accepts only `^(hp\.[a-z0-9-]{1,48})~sbx([0-3]{7})$`.
- **Handling lookup** (`packages/engine/src/sim/vehicle/presets.ts`). `handlingById(id)` keeps its registry lookup first. For an id that is not registered and that `parseTunedHandlingId` accepts, it returns `{ ...upgradedProfile(handlingById(base), levels), id }`. It builds the profile on every call and caches nothing, so no module-level state grows. Any other unknown id still throws `UnknownHandlingError`. A checkpoint (`vehicleResource` save and load) therefore restores a tuned car without a registration step.
- **Profile swap** (`packages/engine/src/sim/vehicle/components.ts`). `VehicleStore.retune(id, handlingId)` replaces only `profile` and keeps every other runtime field: `hs`, `susp`, `driver`, `locked`, `external`, `wet`, `input` and the impact counters. `ensure` is unchanged.
- **Port** (M04e3's `SandboxVehiclePort`) gains:
  - `handlingOf(h): string | null`;
  - `retune(h, handlingId): 'ok' | 'moving' | 'gone'`. It returns `'gone'` when `h` no longer resolves, and `'moving'` when `Vehicle.speed` is above 2 m/s. Otherwise it writes `Vehicle.handling` to `ecs.strings.intern(handlingId)`, so `runtimeOf` in `vehicle-system.ts` keeps the runtime, then calls `VehicleStore.retune`.
  - Like M07b2's race car, a tuned car keeps its prefab's body mass. `weight` acts through the handling model, which reads `massKg` for wheel loads in `wheel-path-castray.ts`.
- **Sandbox side** (new `packages/engine/src/sim/modes/builtin/sandbox-tune.ts`, C02 lint applies, wired into `sandbox.ts`):
  - **Session state** is `tuned: Map<StableKey, Levels>` in the `sandboxSim` closure. It is never written to a slice or a save.
  - **Actions** added to `SANDBOX_ACTIONS`:
    - `vehicle.tune {key, slot, level}`: one slot set to an integer 0–3;
    - `vehicle.tuneTop {key}`: every slot in `SANDBOX_TUNE_SLOTS` set to 3;
    - `vehicle.tuneStock {key}`: every slot set to 0.
  - **Guard.** The action runs only when every one of these holds; otherwise it changes nothing and raises no toast:
    - `sandboxOnline(ctx)` is false;
    - the key matches `^veh:sbx\d+$`;
    - the key is in `owned`;
    - the slot is in `SANDBOX_TUNE_SLOTS`, and the level is an integer from 0 to 3.

    The PI band is not part of the guard.
  - **Results.** `'moving'` raises `sandbox.refuse.tuneRolling` and keeps the old levels. `'gone'` raises `sandbox.refuse.tuneGone` and drops the key. `'ok'` stores the levels.
  - **Lifecycle.** `tuned` is cleared on `enter` and `exit`, and in `tick` when `sandboxOnline(ctx)` turns true. A key leaves `tuned` when M04e3 drops it from `owned`.
  - Never calls `ctx.economy`.
- **View model** `mode.sandbox.tune`:
  - fields `{ cars: { key, nameKey, rows }[], online }`, where `rows` comes from `upgradeRows(levels, { free: true })` restricted to `SANDBOX_TUNE_SLOTS`;
  - published on enter and after every change.
- **Phone UI** (`packages/ui/src/phone/apps.ts`, `pause.tsx`; existing widget kinds only):
  - `sandbox-tabs` gains `tune`, after `vehicles`.
  - For car index `i`, there is a level-2 heading with the car's `nameKey`, then one text row per slot (`phone.sandbox.tune.level {slot, n}`) with the buttons `tune-<i>-<slot>-down` and `tune-<i>-<slot>-up`. Each sends `vehicle.tune` with the level clamped to 0–3; a button whose level would not change carries `disabled`.
  - Then come `tune-<i>-top` and `tune-<i>-stock`, and a text row `phone.sandbox.tune.note`.
  - No price, currency or purse text appears. With no cars, the tab shows `phone.sandbox.tune.none`. While `online`, every button carries `disabled: 'sandbox.refuse.online'`.
  - `PhoneEnv` gains `sandboxTune`, read from `mode.sandbox.tune`.
- **Text** (`content/ui/i18n/en.json`; original wording, design values the owner may tune):

  | key | value |
  |---|---|
  | the `tune` tab label (M04e1's tab-label key pattern) | Tune |
  | `phone.sandbox.tune.level` | {slot}: level {n} of 3 |
  | `phone.sandbox.tune.slot.<slot>` (six) | Engine · Tires · Brakes · Suspension · Weight · Armor |
  | `phone.sandbox.tune.up` / `down` | One step up / One step down |
  | `phone.sandbox.tune.top` | Everything to the top |
  | `phone.sandbox.tune.stock` | Back to stock |
  | `phone.sandbox.tune.note` | Free here. These parts stay with this car and go when it goes. |
  | `phone.sandbox.tune.none` | Put a car out first, then tune it here. |
  | `sandbox.refuse.tuneRolling` | Bring it to a full stop before you change parts. |
  | `sandbox.refuse.tuneGone` | That car isn't around any more. |

  When M07b2 already has slot label keys, the tab uses those and does not add the six slot keys (record a BD row).
- **Test rig:** the fake `SandboxVehiclePort` in `packages/engine/test/modes/fixture.ts` gains `handlingOf` and `retune`.
- **Builder decisions:** rows in `spec/11-decision-log-builder.md`, section M07b3.

## Scope out
- **Paint, livery and colours.** Sandbox cars are drawn by `packages/engine/src/client/vehicle/vehicle-view.ts`, which has no per-car paint input; M07b2's paint path draws race cars only. A per-entity paint channel is client render work; paint, tint and colours on session cars are post-v1 (DL-730), and M10d3 is not widened.
- **Window tint.** Our car materials have no glass parameter to set (C07 material caps).
- **Underglow.** It adds an emissive render object per car against the mobile race budget (06-racing-content.md C.10, about 55 of 150), and it is not one of VR-1…VR-8.
- **Plate text.** Free player text needs a moderation decision first, the same reason M04e3 and M04e4 give.
- **The nitro slot**, for the reason in Scope in.
- **Any write** to `CoreSlice.garage`, `SandboxSlice`, a save or the racing purse. Carrying a tuned car into a race. Any change to M07b2's prices, PI lock or class bands. Mod vehicles (post-v1, DL-730). Any C05 or C06 shape change, and any new widget kind.

## Deliverables
- `packages/shared/src/vehicle/upgrades.ts`, `packages/shared/src/vehicle/index.ts`, `packages/shared/test/vehicle.upgrades.spec.ts` (new).
- `packages/modes/racing/src/garage/upgrades.ts` and `garage-vm.ts` (re-exports); `packages/modes/racing/test/sandbox-tune-guard.spec.ts` (new).
- `packages/engine/src/sim/vehicle/presets.ts`, `packages/engine/src/sim/vehicle/components.ts`; `packages/engine/test/vehicle.retune.spec.ts` (new).
- In `packages/engine/src/sim/modes/`:
  - `builtin/sandbox-tune.ts` (new);
  - `builtin/sandbox.ts`;
  - `sandbox-vehicle-port.ts`.
- `packages/engine/test/modes/sandbox-tune.spec.ts` (new), `packages/engine/test/modes/fixture.ts`.
- `packages/ui/src/phone/apps.ts`, `packages/ui/src/phone/pause.tsx`; `packages/ui/test/phone.spec.ts` and `packages/ui/test/ui-screen-parity.spec.ts` (both extended).
- `content/ui/i18n/en.json`.
- `tests/e2e/ui/sandbox-tune.spec.ts` (new, tag `@sandbox-tune`). It runs in the `DV_WORLD=synth` half, so it does not go in `GRAYBOX_GREP`.
- `spec/11-decision-log-builder.md`.
- About 21 files.

## Interfaces
- C05 1.2, read only: `VehicleInstance.upgrades`, `UpgradeSlot`. `CoreSlice` and `SandboxSlice` are unchanged and unwritten.
- C06 1.1, read only: `UiCommand mode.cmd`, `GameModeSim.onEvent`, `ModeContext.net`. `EconomyApi` is never called.
- C01 1.0: `veh:sbx<n>` keys are session-only and never written to a save.
- `HandlingProfile` (S06, 06-racing-data.md §4.1): the shape is unchanged. The `~sbx` id suffix is a session-only id form, never authored content.
- Engine-internal, in no contract: `VehicleStore.retune`, the `handlingById` fallback, `SandboxVehiclePort.retune` and `handlingOf`, the `mode.sandbox.tune` view-model key.

## Acceptance criteria
- AC-1 Given the merged base with this milestone When the repository checks run Then:
  - they pass;
  - `pnpm lint` reports no C02 finding in `packages/shared/src/**` or `packages/engine/src/sim/**`;
  - `check:i18n` reports no missing or unused key;
  - M07b2's garage spec passes unchanged

  — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm check:i18n && pnpm build && pnpm --filter @dv/mode-racing test -- garage`
- AC-2 Given the shared upgrade code When its spec runs Then:
  - for each slot at level 3, `upgradedProfile` gives the C.4 values: torque × 1.12, `muLong` and `muLat` × 1.09, `maxDecelG` × 1.15, `dampingRatio` + 0.15 capped at 1.0, `massKg` × 0.91, `durability` × 1.40;
  - the base profile is deep-equal to its value before the call;
  - `tunedHandlingId('hp.kestrel-quill', top)` is `hp.kestrel-quill~sbx3333303`, all-zero levels give `hp.kestrel-quill`, and `parseTunedHandlingId` inverts both;
  - `parseTunedHandlingId` rejects a digit 4, six digits, an uppercase base, and a missing base;
  - `upgradeRows(levels, { free: true })` has every price 0

  — proof: `pnpm check:unit -- packages/shared/test/vehicle.upgrades.spec.ts`
- AC-3 Given a real vehicle world (`createVehicleWorld`) When tuned profiles are exercised Then:
  - **lookup:** `handlingById` returns the same object (`toBe`) as before for every entry of `HANDLING_PRESETS`; an unseen tuned id returns `upgradedProfile(base, levels)` with that id; `hp.nope~sbx1000000` throws `UnknownHandlingError`;
  - **swap:** on a seated `vehicle.kestrel-quill` at rest, `retune` keeps `driver`, `locked`, `external` and `hs.gear`, and after 120 ticks the runtime's `profile.id` is still the tuned id;
  - **road:** at full throttle on flat ground for 180 ticks, the car with `engine` 3 is faster than the same car at stock;
  - **checkpoint:** saving `vehicleResource` and loading it into a fresh store restores a profile deep-equal to the tuned one;
  - **regression:** the existing vehicle suites and the synth hash scenario are unchanged

  — proof: `pnpm check:unit -- packages/engine/test/vehicle.retune.spec.ts packages/engine/test/vehicle.prefabs.spec.ts packages/engine/test/interaction.spec.ts && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-hash`
- AC-4 Given a rig (`makeRig({ sandboxVehicles })`) whose sandbox owns `veh:sbx0` (`vehicle.kestrel-quill`) When the tune actions are dispatched as `mode.cmd {mode:'sandbox'}` Then:
  - `vehicle.tune {key:'veh:sbx0', slot:'engine', level:2}` calls `retune` once with `hp.kestrel-quill~sbx2000000`;
  - `vehicle.tuneTop` calls it with `~sbx3333303`, and `vehicle.tuneStock` with `hp.kestrel-quill`;
  - after each, `mode.sandbox.tune.cars[0].rows` shows the new levels with every price 0;
  - a port answer `'moving'` raises `sandbox.refuse.tuneRolling` and keeps the levels;
  - `'gone'` raises `sandbox.refuse.tuneGone` and removes the car from the view model

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-tune.spec.ts`
- AC-5 Given the same rig When the guard cases are sent Then:
  - **foreign or bad input:** these call no port method, raise no toast and leave the view model unchanged:
    - the keys `veh:race0`, `veh:qa0`, a 32-hex garage key, and `veh:sbx9` (not in `owned`);
    - the slot `nitro`;
    - the levels 4 and 1.5;
    - missing arguments;
  - **story:** with `story` running, no tune action reaches the port;
  - **online:** after M04e0's net port switches to a fake net, every tune action is refused with `sandbox.refuse.online`, and `mode.sandbox.tune.online` is true;
  - **no spend:** across the whole session, `economy.ledgerSince(0)` is empty and `economy.balance()` is unchanged;
  - **no saved state:** `JSON.stringify` of `slices.core`, `slices.story` and `slices.sandbox` is byte-equal before and after, and no posted save contains `~sbx`;
  - **reset:** after `mode.quit` and a new sandbox start, `mode.sandbox.tune.cars` is empty

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-tune.spec.ts packages/engine/test/modes/sandbox-guard.spec.ts`
- AC-6 Given the racing package after a tuned id has been resolved in the same process When the racing guard spec runs Then:
  - `raceCar('veh:sbx0')` and `raceCar('hp.kestrel-quill~sbx3333303')` return `null`;
  - the racing `enter` with either value as `params.vehicle` refuses as it does today, and spawns no car;
  - M07b2's garage view-model for a stock `vehicle.kestrel-quill` `VehicleInstance` shows every level 0, with its non-zero C.4 prices

  — proof: `pnpm --filter @dv/mode-racing test -- sandbox-tune-guard`
- AC-7 Given `appScreen('sandbox', env)` with a `sandboxTune` env holding one car When it is built Then:
  - the tabs are M04e1's and M04e3's, followed by `tune`;
  - there are six slot rows with `tune-0-<slot>-down` and `-up`, the end buttons disabled at 0 and at 3, then `tune-0-top` and `tune-0-stock`;
  - each `onPress` is the documented command;
  - no node's text contains a price or a currency sign;
  - with no cars, only `phone.sandbox.tune.none` shows;
  - with `online: true`, every button has `disabled: 'sandbox.refuse.online'`;
  - `DomScreen` and `CanvasScreen` give the same focus order

  — proof: `pnpm check:unit -- packages/ui/test/phone.spec.ts packages/ui/test/ui-screen-parity.spec.ts`
- AC-8 Given the new text When the IP and text gates run Then:
  - no finding is reported;
  - no new value contains `DISPLAY_NAME` or `SHORT_NAME` from `config/brand.ts`

  — proof: `pnpm build && pnpm ip:strings && pnpm names:lint && pnpm check:i18n`
- AC-9 Given a QA build on the synth world with sandbox running When the e2e places a car with M04e3's `car-kestrel-quill-drive`, waits for `vehicleOp('state').vehicle.speed` below 0.5, opens Pause → Phone → Sandbox → Tune, taps `tune-0-top` and closes the phone Then:
  - `__dvBridge.engine.vehicleOp('state')` reports `vehicle.handling` `hp.kestrel-quill~sbx3333303` and `player.driving` true;
  - after `KeyW` is held for 3 s, `vehicle.speed` is above 2;
  - after `mode.quit` and a new sandbox start, `__dvBridge.modes.vm('mode.sandbox.tune')` has no cars;
  - no `pageerror` occurs

  — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-tune`

## Test plan
- **Unit (shared):** `vehicle.upgrades.spec.ts` (AC-2).
- **Unit (engine):** `vehicle.retune.spec.ts` (AC-3); `modes/sandbox-tune.spec.ts` (AC-4, AC-5). Regression: `vehicle.prefabs.spec.ts`, `interaction.spec.ts`, `modes/sandbox-guard.spec.ts`, M04e3's `modes/sandbox-vehicles.spec.ts`, and the whole `packages/engine/test/modes` suite.
- **Unit (racing):** M07b2's `garage` spec (AC-1) and `sandbox-tune-guard.spec.ts` (AC-6).
- **Unit (UI):** `phone.spec.ts`, `ui-screen-parity.spec.ts` (AC-7).
- **Gates:** `check:i18n`, `ip:strings`, `names:lint` (AC-1, AC-8).
- **e2e:** `@sandbox-tune` on `chromium-webgl2`, `DV_WORLD=synth` (AC-9); `@world-hash` regression (AC-3).

## Demo script
1. `pnpm dev` (QA build), then New Game → Sandbox.
2. Pause → Phone → Sandbox → Cars → Lively (class C) → "Put one here and drive" (M04e3). Stop the car.
3. Tune → "Everything to the top". Close the phone and pull away: the car pulls harder and brakes shorter.
4. Open Tune while rolling and tap a button: the stop-first refusal shows.
5. Quit Sandbox and start it again: the Tune tab is empty, and the racing garage shows its own levels and prices unchanged.

## Effort
0.5 Builder session; about 21 files; risk **medium**: a live handling-profile swap and code moved out of M07b2's racing files.

## Risks & fallbacks
- **M07b2's multiplier or row builder reads the purse or does IO.** Move only the pure part to `@dv/shared`, keep the purse-reading wrapper in the racing package, and record a BD row. AC-1 still proves M07b2's `garage` spec unchanged.
- **The profile swap on a seated car causes a suspension jolt.** `retune` keeps `susp`. If a jolt shows in AC-3, the port also zeroes the body's velocity, as the racing port's `place` does, before the swap (the car is already at rest). Record a BD row.
- **Another reader caches `rt.profile` across ticks.** `wheel-path-castray.ts` and `raycast-vehicle.ts` read it each step today. If the Builder finds a cached copy, refresh it in `retune` and record a BD row.
- **A display maps handling ids to names.** It strips the suffix with `parseTunedHandlingId`; today only `packages/engine/src/client/snapshot/reader.ts` carries the id.

## Notes for the Builder
- **Read first:**
  - M04e0's, M04e1's and M04e3's files, and M07b2's file;
  - 06-racing-content.md C.4, and 06-racing-data.md §4.1 and §4.2;
  - `packages/engine/src/sim/vehicle/{components.ts, presets.ts, vehicle-system.ts}` (`runtimeOf` re-creates the runtime when `Vehicle.handling` and `profile.id` differ, which is why the port writes the component first);
  - `packages/modes/racing/src/sim/engine-port.ts` (`spawnCar`, `place`) and `packages/modes/racing/src/cars.ts`;
  - `packages/ui/src/phone/{apps.ts, pause.tsx}`.
- **Order of work:**
  1. move the pure upgrade code and prove M07b2's `garage` spec;
  2. the id grammar and the lookup fallback;
  3. `VehicleStore.retune` and the port;
  4. the actions and the rig spec;
  5. the UI;
  6. the text and the e2e.
- **C02.** `upgrades.ts`, `presets.ts`, `components.ts` and `sandbox-tune.ts` are in lint scope: no `Date`, timers, `**` or `for…in`. Multipliers are plain products; no transcendental call is needed.
- **The guard is the key and the session**, never PI or class. AC-6 proves that a session car or a tuned id cannot enter a race.
- **IP wall.** Every label and status line is original; never copy wording, menu names or structure from sandbox trainers or mod-shop menus (the research checklist names features only). M04e5 is a dependency, so its `ip:strings` patterns already apply, and they do not match the strings above. Player-facing text names no letter class or performance index; it uses M04e3's class words (DL-732). The display name never appears. No firearms (D-30).
- **Secrets:** none.

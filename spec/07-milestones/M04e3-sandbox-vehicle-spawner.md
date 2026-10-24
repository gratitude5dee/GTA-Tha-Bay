# M04e3 — sandbox-vehicle-spawner

## Goal
After this session the phone's Sandbox app has a **Cars** tab. The player picks one of our twelve fictional cars, grouped by our racing classes D, C, B, A, S and R, and either has it placed on the road in front of them or placed and gets straight in. Up to 8 such cars exist at once; a ninth replaces the oldest one the player is not using. All of them leave the world when the sandbox ends or an online session begins. Nothing is saved: the cars never enter `CoreSlice.garage` or `SandboxSlice`.

Today spawning is QA-only: `debug.spawn` in `packages/engine/src/sim/vehicle/debug.ts` (keys `veh:qa<n>`), loaded only behind `VITE_DV_QA`. The cap `sandboxVehicleCap: 8` in `packages/shared/src/contracts/c05-save.ts` has no reader. The garage's `findCallSpot` (`packages/engine/src/sim/garage/garage.ts`) cannot be reused: it searches 120 to 400 m away (`CALL_MIN_DISTANCE_M`, `CALL_SEARCH_RADIUS_M`) and skips every point inside the camera view. This milestone adds its own short-range search, which looks for a free lane point 6 to 12 m away, inside the view.

This is part 1 of the vehicle work; vehicle actions and player toggles follow in the next sandbox milestone.

## Requirements
- R-UI-03 (primary): the phone's Sandbox app, an implied page, gets its vehicle section.
- R-IP-01 (support): only our fictional makes appear. The catalog is schema-checked, and every new string is original and passes `ip:strings` and `names:lint`.
- R-PLAT-02 (support): the tab is a `ScreenDef` tree, so the XR panel (M11b3) shows the same controls in the same focus order.

## Depends on
- **M04e1** (sandbox-world-controls): `sandboxSim(env).onEvent` and the `SANDBOX_ACTIONS` table for `mode.cmd {mode:'sandbox'}`; the `sandbox-tabs` widget in `packages/ui/src/phone/apps.ts`; the `RigOptions` additions in `packages/engine/test/modes/fixture.ts`. It edits the same files, so it merges first.
- **M04e5** (ip-wall-strings): the `trainer-*` patterns that AC-9's `ip:strings` enforces on every string below.
- Through M04e1: **M04e0** (`sandboxOnline`, `SANDBOX_REFUSE_ONLINE`, the online refusal in `createCommandDispatcher`).
- **M03a1** (vehicles-interaction-prefabs): `PrefabRegistry` (`has`, `load`, `def`, `spawn`, `despawn`) and `VEHICLE_PREFABS` in `packages/engine/src/sim/prefabs/registry.ts`; `seatDriver` in `packages/engine/src/sim/vehicle/enter-exit.ts`; `VehicleStore` (`rt.get(id).driver`); `handlingById` in `packages/engine/src/sim/vehicle/presets.ts`; `packages/engine/test/vehicle-sim.ts`.
- **M07a1** (racing-core-director-car): `RACE_CAR_PREFABS` (the C, B, A, S and R cars), which are kept out of non-racing sessions so they do not change the state hash.
- **M05c1** (act1-missions-1-6): `inView` and `VIEW_HALF_ANGLE_DEG` in `garage.ts` (the cone test only, reused as is); `packages/engine/test/garage.test.ts`.
- All but M04e5, M04e0 and M04e1 are merged on `claude/build`.
- Contracts: C01 1.0 (`StableKey` `veh:`), C05 1.2, C06 1.1 (`PrefabService`, `PhysicsQueries`, `ModeContext.assets`, `UiCommand mode.cmd`), C08 1.0 (`nearestEdge`, `laneCentre`). All are read only.

## Scope in
- **Catalog** `content/vehicles/sandbox-catalog.json`: `{ "schema": 1, "rows": [{ "prefab": "vehicle.<slug>", "nameKey": "sandbox.car.<slug>" }] }`.
  - The schema `packages/shared/schemas/sandbox-catalog-1.schema.json` sets `additionalProperties: false`, requires `prefab` to match `^vehicle\.[a-z0-9-]{1,48}$`, requires `nameKey` to match `^sandbox\.car\.[a-z0-9-]{1,48}$`, and allows 1 to 32 rows. The `vehicle.` prefix already keeps out `police.*` and `robotaxi.default`.
  - `tools/ci/check-assets.ts` adds the pair `['content/vehicles/sandbox-catalog.json', 'sandbox-catalog-1']` to `CONFIG_SCHEMAS`.
  - There are twelve rows: `compact`, `sedan`, `rideshare`, `van`, `truck`, `pickup`, `ondine-pico`, `kestrel-quill`, `brackenridge-rasp`, `aurelian-sorrel`, `solenne-skip` and `halcyon-cormorant`. `vehicle.bus` and `vehicle.cablecar` are kinematic transit props, so they are left out.
  - The class is never stored in the catalog. It is read from the prefab's handling preset (`handlingById(def.vehicle.handling).class`), so the racing data stays the only source of truth.
- **Near search** (new `packages/engine/src/sim/modes/builtin/sandbox-spot.ts`, in the C02 lint scope):
  - `findNearSpot(graph, physics, p, blocked): { x; y; z; yaw } | null`, where `p` is `{x, y, z, camYaw}` and `blocked(x, z)` reports whether something occupies that point.
  - It tries a fixed pattern: distances `[8, 10, 6, 12]` m, each at bearings `0, +15°, −15°, +30°, −30°` from the camera's forward direction (`−sin camYaw, −cos camYaw`, as in `inView`), using `dsin` and `dcos`.
  - For each target point it calls `graph.nearestEdge(tx, tz, p.y, 6)`, then `graph.laneCentre({edge, s, lane: 0}, out)` with one reused `out = new Float64Array(4)`. C08 `RoadGraphQuery.laneCentre(e: EdgePos, out: Float64Array): void` returns nothing and writes x, y, z and yaw into `out` (`packages/shared/src/world/c08-api.ts` l.12), as `findCallSpot` uses it (`garage.ts` l.149). A candidate is accepted only when all of these hold:
    - its distance from the player is 5 to 13 m;
    - `inView` holds;
    - `physics.groundY(x, z)` is non-null and within 1.5 m of the lane's `y`;
    - `blocked(x, z)` is false.
  - It returns the first accepted point, with `y = groundY` and the lane's yaw. It uses no randomness and no wall time.
  - `findCallSpot` is not changed.
- **Engine port** (new `packages/engine/src/sim/modes/sandbox-vehicle-port.ts`, engine-internal):
  - `SandboxVehiclePort { prepare(prefab): void; spot(): NearSpot | null; spawn(prefab, at, key): EntityHandle; seat(h): boolean; inUse(h): boolean; alive(h): boolean; playerDriving(): boolean; retire(h): void }`.
  - `prepare` calls `reg.load(RACE_CAR_PREFABS)` once, the first time a prefab that is in that set but not yet in the registry is asked for. Building the port loads nothing.
  - `spot` binds `findNearSpot` to `services.world.api.graph`, the mode's `physics`, the player pose and `camYaw` (as the garage port does), and `blocked` = any `Vehicle` entity within 4 m, or the player within 4 m.
  - `seat` calls `seatDriver(…, player:0, h, tick)`.
  - `inUse(h)` is true when `rt.driver !== 0`, or when the player's `Control.target` is the car (it is being entered).
  - `retire(h)` despawns an empty car at once. For a car the player drives, it requests the exit the way the racing port's `release` does (`packPending(Active, OnFoot)`) and queues the car. A new system, `engine.modes.sandbox-retire` (`SimStage.Script`, order 2, in `createModesModule`), despawns each queued car on the first tick it has no driver, or after 600 ticks. With an empty queue the system does nothing.
- **Sandbox side** (new `packages/engine/src/sim/modes/builtin/sandbox-vehicles.ts`, in the C02 lint scope):
  - `SandboxEnv` gains `vehicles?(): SandboxVehiclePort | null`, bound in `packages/engine/src/sim/modes/index.ts`.
  - Session state lives in the `sandboxSim` closure and is never saved: `owned: {key, prefab, h}[]` in spawn order, `pending: {prefab, seat, sinceTick} | null`, and a counter `n` that never resets within a sim session.
  - Two actions are added to `SANDBOX_ACTIONS`.
  - `vehicle.spawn {prefab, seat: 'none' | 'driver'}` runs these steps in order:
    1. A prefab that is not in the catalog, or a malformed argument, is ignored without a toast.
    2. `seat: 'driver'` while `playerDriving()` raises `sandbox.refuse.onFoot`.
    3. It calls `prepare`, then `ctx.assets.request([def.render.asset], 'now')`.
    4. When `ctx.assets.ready` is false, the request becomes `pending`, the toast `sandbox.status.preparing` is raised once, and `tick` retries. After 600 ticks without the asset, it raises `sandbox.refuse.notReady` and clears `pending`. A new request replaces an older pending one.
    5. Once the asset is ready, `spot()` returning null raises `sandbox.refuse.noSpot`.
    6. **Cap.** When `owned.length` is 8, the oldest car with `!inUse` is retired and `sandbox.status.towed` is raised. Keys whose `alive` is false are dropped first.
    7. It spawns under `veh:sbx<n>`. With `seat: 'driver'`, the car is seated on the next tick, the same two-step pattern as the racing port's `spawnCar`.
  - `vehicle.clear` retires every owned car.
  - `exit` retires every owned car.
  - `tick` retires every owned car when `sandboxOnline(ctx)` turns true.
  - Every port call sits in the existing `try/catch` pattern; a missing port means no world, and raises `sandbox.refuse.noSpot`.
- **View model** `mode.sandbox.vehicles`: `{ catalog: {prefab, cls, nameKey}[], owned: {key, nameKey}[], cap: 8, pending: string | null, online: boolean }`. It is sent on enter and after each change; the catalog part is under 1 KiB.
- **Phone UI** (`packages/ui/src/phone/apps.ts`, `pause.tsx`):
  - `sandbox-tabs` gains the tab `vehicles`. Its label key follows M04e1's tab keys.
  - For each class in `D, C, B, A, S, R` there is a level-2 heading `phone.sandbox.class.<cls>`. For each car there is a level-3 heading with its `nameKey`, then two buttons:
    - `car-<slug>`, labelled `phone.sandbox.car.place`, sends `mode.cmd {mode:'sandbox', name:'vehicle.spawn', args:{prefab, seat:'none'}}`;
    - `car-<slug>-drive`, labelled `phone.sandbox.car.placeDrive`, sends the same with `seat:'driver'`.
  - Below the cars come a text row `phone.sandbox.car.count {n, cap}` and the button `car-clear` (`phone.sandbox.car.clear`).
  - While `online`, every button carries `disabled: 'sandbox.refuse.online'`. Only existing widget kinds are used.
  - `PhoneEnv` gains `sandboxVehicles`, which `usePhoneEnv` reads from `mode.sandbox.vehicles`.
- **Text** (`content/ui/i18n/en.json`, original wording; design values the owner may tune):
  - the twelve `sandbox.car.<slug>` names, built from each preset's `fictionalMake`, for example "Kestrel Quill", "Ondine Pico" and "Brackenridge Box Truck";
  - `phone.sandbox.class.D`…`R`, in our own player-facing words rather than letter grades: "Everyday" (D), "Lively" (C), "Quick" (B), "Fast" (A), "Top shelf" (S), "Robotaxi" (R). The keys keep the internal class letters;
  - `phone.sandbox.car.place` "Put one here";
  - `phone.sandbox.car.placeDrive` "Put one here and drive";
  - `phone.sandbox.car.count` "{n} of {cap} cars out";
  - `phone.sandbox.car.clear` "Send my cars away";
  - `sandbox.status.preparing` "Getting that car ready…";
  - `sandbox.status.towed` "Your oldest car was towed to make room.";
  - `sandbox.refuse.noSpot` "No clear road in front of you. Face a street and try again.";
  - `sandbox.refuse.notReady` "That car isn't ready yet. Try again in a moment.";
  - `sandbox.refuse.onFoot` "Step out of this car first.".

  `tools/ci/check-i18n.ts` adds `'sandbox.car.'` and `'sandbox.status.'` to `EXTERNAL_PREFIXES`, because the sim raises those keys. It adds `'phone.sandbox.class.'` only if `check:i18n` reports those template-built keys as unused.
- **Test rig:** `RigOptions` gains `sandboxVehicles?: SandboxVehiclePort` and `assetsReady?: (refs) => boolean` (the default keeps `() => true`).
- **Builder decisions** go in `spec/11-decision-log-builder.md`, under the section M04e3.

## Scope out
- Vehicle actions (repair, upright, dismiss) and the player toggles: M04e4, which also rejects lock and no-ragdoll with reasons (DL-718, DL-721).
- Free tuning on session cars: M07b3, after M07b2. That work keeps the `veh:sbx` key and session-only state introduced here as its guard.
- Mod vehicles in the spawner (M13a3 sandbox-only content): post-v1 (DL-730). The catalog schema already allows up to 32 rows.
- Other features on the research checklist, each left out for a stated reason:
  - spawning by typed model name: the catalog is the only list;
  - licence plate text: free player text needs a moderation decision first;
  - tint and paint: post-v1, no per-car paint channel (DL-730);
  - vehicle invincibility: M04e4 decides, on `veh:sbx` cars only, which the M03a2 oracle runs never use; seatbelt and speed boost: rejected by M04e4 (DL-730);
  - refreshing what can be spawned: the catalog is static content.
- `police.*`, `robotaxi.default`, transit props, aircraft and boats: kept out by the schema and the AC-2 checks, so the pursuit director and the robotaxi fleet stay unambiguous.
- Any write to `CoreSlice.garage`, `SandboxSlice` or saves. Any new widget kind, any C06 change, and any use of `findCallSpot`.

## Deliverables
- `content/vehicles/sandbox-catalog.json`; `packages/shared/schemas/sandbox-catalog-1.schema.json`; `tools/ci/check-assets.ts`.
- In `packages/engine/src/sim/modes/`:
  - `builtin/sandbox-spot.ts` and `builtin/sandbox-vehicles.ts` (new);
  - `builtin/sandbox.ts` (actions, enter, exit, tick);
  - `builtin/index.ts` (`SandboxEnv.vehicles`);
  - `sandbox-vehicle-port.ts` (new);
  - `index.ts` (port binding, the `engine.modes.sandbox-retire` system).
- Engine tests:
  - `packages/engine/test/sandbox-spot.spec.ts`, `sandbox-catalog.spec.ts` and `sandbox-retire.spec.ts` (new);
  - `packages/engine/test/modes/sandbox-vehicles.spec.ts` (new);
  - `packages/engine/test/modes/fixture.ts`.
- `tools/ci/test/sandbox-catalog-schema.test.ts` (new).
- `packages/ui/src/phone/apps.ts`, `packages/ui/src/phone/pause.tsx`; `packages/ui/test/phone.spec.ts` and `packages/ui/test/ui-screen-parity.spec.ts` (both extended).
- `content/ui/i18n/en.json`; `tools/ci/check-i18n.ts`.
- `tests/e2e/ui/sandbox-vehicles.spec.ts` (new, tag `@sandbox-vehicles`). It runs in the `DV_WORLD=synth` half, so it does not go in `GRAYBOX_GREP`.
- `spec/11-decision-log-builder.md`.
- About 23 files.

## Interfaces
- C06 1.1, read only: `UiCommand mode.cmd` (≤ 512 B of arguments), `GameModeSim.onEvent`, `PrefabService`, `PhysicsQueries.groundY`, `ModeContext.assets`, `ModeContext.net` (through M04e0).
- C08 1.0 `RoadGraphQuery.nearestEdge` and `laneCentre`: used as they are.
- C01 1.0: the keys `veh:sbx<n>` are session-only and never written to a save.
- C05 1.2: `sandboxVehicleCap` is read; `SandboxSlice` and `CoreSlice` are unchanged.
- Engine-internal, in no contract: `findNearSpot`, `SandboxVehiclePort`, `SandboxEnv.vehicles`, the `engine.modes.sandbox-retire` system, and the `mode.sandbox.vehicles` view-model key.

## Acceptance criteria
- AC-1 Given the merged base with this milestone When the repository checks run Then:
  - they pass;
  - `pnpm lint` reports no C02 finding in `packages/engine/src/sim/**`;
  - `check:assets` validates `content/vehicles/sandbox-catalog.json` against `sandbox-catalog-1`;
  - `check:i18n` reports no missing or unused key

  — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm check:i18n && pnpm check:assets && pnpm build`
- AC-2 Given the catalog When the catalog specs run Then:
  - it has 12 rows with unique prefabs;
  - every prefab is in `VEHICLE_PREFABS` or `RACE_CAR_PREFABS` with `kind: 'vehicle'` and a handling preset;
  - no preset id starts with `hp.police-` or equals `hp.robotaxi-ambient`;
  - every class D, C, B, A, S and R has at least one row;
  - every `nameKey` exists in `en.json`;
  - the schema rejects a row with `police.cruiser`, one with `robotaxi.default`, an extra field, and 33 rows

  — proof: `pnpm check:unit -- packages/engine/test/sandbox-catalog.spec.ts tools/ci/test/sandbox-catalog-schema.test.ts`
- AC-3 Given a stub graph with one straight two-way road and a stub `groundY` When `findNearSpot` runs Then:
  - with the camera facing the road it returns a point 5 to 13 m from the player, inside `inView`, with the lane's yaw;
  - with the camera facing away from the road it returns null;
  - with `blocked` true everywhere it returns null;
  - with `groundY` null, or more than 1.5 m off the lane, it returns null;
  - two runs on the same inputs return identical results;
  - the existing garage search is unchanged

  — proof: `pnpm check:unit -- packages/engine/test/sandbox-spot.spec.ts packages/engine/test/garage.test.ts`
- AC-4 Given a rig with a running sandbox and a fake `SandboxVehiclePort` When `vehicle.spawn` is dispatched as `mode.cmd {mode:'sandbox'}` Then:
  - `{prefab:'vehicle.kestrel-quill', seat:'driver'}` calls `prepare`, then `spawn` once with key `veh:sbx0` at the port's spot, and `seat` on the next tick;
  - `seat:'none'` never calls `seat`;
  - `police.cruiser` and malformed arguments call nothing and raise no toast;
  - a null spot raises `sandbox.refuse.noSpot` and spawns nothing;
  - `seat:'driver'` while `playerDriving()` raises `sandbox.refuse.onFoot`;
  - with `assetsReady` false, `sandbox.status.preparing` is raised once. The car spawns on the first tick after `assetsReady` turns true at tick 30; when it stays false for 600 ticks, `sandbox.refuse.notReady` is raised and nothing spawns;
  - `mode.sandbox.vehicles.owned` lists `veh:sbx0`

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-vehicles.spec.ts`
- AC-5 Given the same rig When nine cars are spawned while the player drives `veh:sbx0` Then:
  - keys `veh:sbx0`…`veh:sbx8` are used in order;
  - the ninth spawn retires `veh:sbx1` (the oldest car not in use) and raises `sandbox.status.towed`;
  - `owned` has 8 entries;
  - a key whose `alive` turns false is dropped before the cap is counted;
  - `vehicle.clear` retires all 8 and empties `owned`

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-vehicles.spec.ts`
- AC-6 Given the same rig When a session spawns cars, clears them, spawns again and quits, and a second rig runs `story` Then:
  - `mode.quit` retires every owned car;
  - switching M04e0's net port to a fake net retires every owned car at the next tick, and a later `vehicle.spawn` is refused with `sandbox.refuse.online`;
  - `JSON.stringify(slices.core)` and `JSON.stringify(slices.sandbox)` are byte-equal to their values before the session;
  - under `story`, `vehicle.spawn` reaches no port call

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-vehicles.spec.ts packages/engine/test/modes/sandbox-guard.spec.ts`
- AC-7 Given a real vehicle world (`createVehicleWorld`) with the port When the port is exercised Then:
  - an empty car passed to `retire` stops resolving on the same tick;
  - a car the player was seated in with `seat` leaves the player on foot within 600 ticks, after which its key stops resolving;
  - building the port without calling `prepare` gives the same state hash at tick 600 as a world without the port;
  - `prepare('vehicle.halcyon-cormorant')` loads `RACE_CAR_PREFABS` exactly once

  — proof: `pnpm check:unit -- packages/engine/test/sandbox-retire.spec.ts packages/engine/test/vehicle.prefabs.spec.ts`
- AC-8 Given `appScreen('sandbox', env)` with a `sandboxVehicles` env When it is built Then:
  - the tabs include `vehicles`, with the six class headings in the order D, C, B, A, S, R;
  - each car has `car-<slug>` and `car-<slug>-drive` with the documented `onPress`;
  - `car-clear` and the count row are present;
  - with `online: true` every button has `disabled: 'sandbox.refuse.online'`;
  - `DomScreen` and `CanvasScreen` give the same focus order

  — proof: `pnpm check:unit -- packages/ui/test/phone.spec.ts packages/ui/test/ui-screen-parity.spec.ts`
- AC-9 Given the new text When the IP and text gates run Then:
  - no finding is reported;
  - no new value contains `DISPLAY_NAME` or `SHORT_NAME` from `config/brand.ts`

  — proof: `pnpm build && pnpm ip:strings && pnpm names:lint && pnpm check:i18n`
- AC-10 Given a QA build on the synth world with sandbox running When the e2e opens Pause, then the phone, then Sandbox → Cars, taps `car-kestrel-quill-drive`, and closes the phone Then:
  - within 5 s `__dvBridge.engine.vehicleOp('state')` reports `player.driving` true and `vehicle.handling` `hp.kestrel-quill`, with `vehicle.pos` within 13 m of the player's position before the tap;
  - after `KeyW` is held for 3 s, `vehicle.speed` is above 2;
  - after `mode.quit`, `vehicleOp('state', <that handle>)` reports `vehicle: null`;
  - no `pageerror` occurs

  — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-vehicles`

## Test plan
- **Unit (engine):**
  - `sandbox-catalog.spec.ts` (AC-2), `sandbox-spot.spec.ts` (AC-3), `modes/sandbox-vehicles.spec.ts` (AC-4 to AC-6), `sandbox-retire.spec.ts` (AC-7);
  - regression: `garage.test.ts`, `vehicle.prefabs.spec.ts`, `modes/sandbox-guard.spec.ts`, and the whole `packages/engine/test/modes` suite, including M04e1's `sandbox-world.spec.ts`.
- **Unit (tools and UI):** `tools/ci/test/sandbox-catalog-schema.test.ts` (AC-2); `phone.spec.ts` and `ui-screen-parity.spec.ts` (AC-8).
- **Gates:** `check:assets`, `check:i18n`, `ip:strings`, `names:lint` (AC-1, AC-9).
- **e2e:** `@sandbox-vehicles` on `chromium-webgl2`, `DV_WORLD=synth` (AC-10).
- **Perf regression (not an AC):** `pnpm check:perf -- --scenario downtown-rush`.

## Demo script
1. `pnpm dev` (QA build), then New Game → Sandbox.
2. Face a street. Pause → Phone → Sandbox → Cars → Robotaxi → "Put one here and drive". Close the phone: you are at the wheel a few metres up the road.
3. Put eight more cars out; the toast says the oldest was towed, and the count reads "8 of 8 cars out".
4. "Send my cars away": the parked ones vanish, and the one you drive leaves once you are out.
5. Quit Sandbox: no session car is left in the world.

## Effort
0.8 Builder session; about 23 files; risk **medium** (new sim-side spawning and the deferred despawn).

## Risks & fallbacks
- **The near search finds nothing on steep or narrow SF streets.** This is the designed refusal (`sandbox.refuse.noSpot`). If the synth e2e start pose has no lane in view, the e2e first turns the camera toward the nearest road through the QA bridge. If refusals are common in play, add lane 1 as a second pass and record a BD row; never widen the search past 13 m or out of view.
- **Despawning a car while the player gets in breaks the ownership machine.** `inUse` counts the entering phase, and `retire` never despawns a car with a driver. If a Builder finds another path, the retire system waits for `CONTROL_OWNER.OnFoot` instead, and records a BD row.
- **Loading the race prefabs mid-session changes the hash of a session that already ran one.** This only happens in sandbox, which is not a hashed determinism suite. AC-7 proves that a session that never asks for a race car keeps the old hash.
- **Eight cars plus traffic strain `mobile-low`.** If the downtown-rush perf check regresses with session cars present, lower the cap on `mobile-low` through a BD row (C05 keeps 8 as the maximum) and report it to the Architect.

## Notes for the Builder
- **Read first:**
  - `packages/engine/src/sim/garage/garage.ts` (`findCallSpot`, `inView`, `createGarageService`, which shows the port pattern);
  - `packages/engine/src/sim/vehicle/{debug.ts, enter-exit.ts, presets.ts}` and `packages/engine/src/sim/prefabs/registry.ts`;
  - `packages/modes/racing/src/sim/engine-port.ts` (`spawnCar`, `release`);
  - `packages/engine/src/sim/modes/index.ts` (`withStoryPrefabs`, the garage binding, `systems`);
  - M04e0's and M04e1's files;
  - `packages/ui/src/phone/{apps.ts, pause.tsx}` and `packages/ui/src/screen/types.ts`.
- **Order of work:**
  1. the catalog, schema and catalog specs;
  2. `findNearSpot` and its spec;
  3. the port and the retire system;
  4. the actions and the rig spec;
  5. the UI;
  6. the text and the e2e.
- **C02.** `sandbox-spot.ts`, `sandbox-vehicles.ts` and `sandbox.ts` are in lint scope: `dsin`, `dcos` and `dsqrt` only, with no `Date`, timers, `**` or `for…in`. Production code never imports `vehicle/debug.ts`, which stays QA-only.
- **IP wall:** every label, key and status line here is original. Do not copy wording or menu structure from sandbox trainers. The research checklist names features only. M04e5 is a dependency, so `ip:strings` already enforces its trainer patterns; none of the strings above matches them. The Cars tab's grouping by handling class is our own layout (DL-732). Car names use only our fictional makes. The display name never appears.
- **Secrets:** none.

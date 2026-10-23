# M04e4 — sandbox-vehicle-player-actions

## Goal
After this session the phone's Sandbox app can act on the player and on the player's own sandbox cars:
- **Player tab:** "Can't get hurt" (`sandbox.player.godMode`), "Big jumps" (`sandbox.player.superJump`) and a one-shot "Patch me up" that refills health and clears a knockout.
- **Cars tab:** for the session car the player drives or stands beside, "Fix it up" (repair), "Back on its wheels" (upright), "Send this one away" (dismiss), plus a "Dent-proof cars" toggle (`sandbox.vehicle.noDamage`).

Every effect is sandbox-only and session-only. The three toggles live in an engine-internal flags object, never in `SandboxSlice` or `CoreSlice`. They start off at every sandbox enter and are cleared on exit and on joining an online session. Car actions reach only cars keyed `veh:sbx<n>` (M04e3), so a garage car, a traffic car or a police unit is never repaired, moved or removed. This is part 2 of the vehicle work; part 1 (M04e3) places the cars.

## Requirements
- R-UI-03 (primary): the Sandbox app, an implied page, gets its Player and car-action controls.
- R-PLAT-02 (support): the controls are `ScreenDef` widgets, so the XR panel (M11b3) shows them in the same focus order.
- R-ROLL-02 (support): the flags are cleared when `ModeContext.net` turns non-null, and every action is refused online (M04e0).
- R-IP-01 (support): every label and status line is original and passes `ip:strings` and `names:lint`.

## Depends on
- **M04e3** (sandbox-vehicle-spawner): the `owned` list of `{key, prefab, h}` in the `sandboxSim` closure, `SandboxVehiclePort.retire` and `alive`, the `vehicles` tab of `sandbox-tabs`, `mode.sandbox.vehicles`, `RigOptions.sandboxVehicles`. Same files, so it merges first.
- Through M04e3: **M04e1** (`sandboxSim(env).onEvent`, `SANDBOX_ACTIONS`, the `applyToggle` hand-off pattern, `CommandDeps.sandboxWorld`, the `player` tab) and **M04e0** (`sandboxOnline`, `SANDBOX_REFUSE_ONLINE`, the dispatcher refusals).
- Merged on `claude/build`:
  - **M05c1**: `CombatImpl` and `CombatPorts` in `packages/engine/src/sim/combat/combat.ts`;
  - **M01b1** and **M01b2**: `onFootSystem`, `OnFootOptions` and `jumpV0` in `packages/engine/src/sim/control/onfoot.ts`; `packages/engine/test/walk-sim.ts`;
  - **M03a1**: `createVehicleSystems` and its `hurt` in `packages/engine/src/sim/vehicle/vehicle-system.ts`; `VehicleDamage`, `Health`, `Vehicle` and `LocalPlayer` in `packages/engine/src/sim/ecs/components.ts`; `VehicleStore` (`rt.wet`); `VehiclePhysics.setBodyPose` and `setBodyVelocity` in `packages/engine/src/sim/physics/backend.ts`; `packages/engine/test/vehicle-sim.ts`;
  - **M03a2**: `applyImpact` in `packages/shared/src/vehicle/damage.ts`.
- M04e0, M04e1 and M04e3 are in the Architect's registration batch with this file.
- Contracts: C01 1.0 (`StableKey` `veh:`), C05 1.2, C06 1.1 (`UiCommand`, `GameModeSim.onEvent`, `PhysicsQueries.groundY`, `ModeContext.net`). All are read only.

## Scope in
- **Flags** (new `packages/engine/src/sim/sandbox-flags.ts`, in the C02 lint scope):
  - `SandboxFlags { godMode: boolean; superJump: boolean; carNoDamage: boolean }`, `noFlags()`, `SUPER_JUMP_APEX_M = 4` (a design value the owner may tune), and `isSessionCar(key: StableKey | null)`, which is true only for `^veh:sbx\d+$`.
  - `EngineServices` (`packages/engine/src/sim/services.ts`) gains `sandboxFlags: SandboxFlags`, set to `noFlags()` by `createSimServices`.
  - A hashed `SimResource` named `sandbox-flags` (three bytes) is added through `core.addResource` the first time a flag is set. A session that never sets one has no new resource, so its hash is unchanged.
- **Readers.** Each reader checks a flag only, so with every flag off behaviour is byte-identical:
  - **Combat:** `CombatPorts` gains `immune?(victim: EntityHandle): boolean`. In `hurt`, an immune victim keeps `hp`, `ko`, `koUntilTick` and its position; the `combat.hit` event and `HitEvent` still fire with damage 0. `modes/index.ts` binds `immune` to `services.sandboxFlags.godMode && ecs.has(h, LocalPlayer)`.
  - **Jump:** `onFootSystem` uses `dsqrt(2 * g * SUPER_JUMP_APEX_M)` instead of `jumpV0` while `services.sandboxFlags.superJump` is true. The vault rule still wins when a vault applies. `OnFootOptions.services` adds `sandboxFlags` to its `Pick` as an optional field.
  - **Car damage:** `hurt` in `createVehicleSystems` returns early when `services.sandboxFlags.carNoDamage` is true and `isSessionCar(ecs.keyOf(ecs.handle(id)))`. Spike strips write tires through `EcsPursuitHost.setTireHealth` and are not covered; "Fix it up" clears them.
- **Body port** (new `packages/engine/src/sim/modes/sandbox-body-port.ts`, engine-internal), bound in `modes/index.ts` to `s.ecs`, `services.vehicleCtx` (`backend`, `store`) and the mode's `physics`:
  - `target(owned: readonly EntityHandle[]): EntityHandle | null`. It returns the owned car the local player drives (`Control.owner === CONTROL_OWNER.Vehicle`, `Control.target`). Otherwise it returns the nearest owned car whose centre is within 6 m of the player; ties go to the lower handle. It never returns a handle outside `owned`.
  - `repair(h)`: sets `VehicleDamage.body`, `engine` and all four `tires` to 1, and `rt.wet` to `{ wetTicks: 0, stalled: false }`.
  - `upright(h): 'ok' | 'moving' | 'noGround'`:
    - `'moving'` when `Vehicle.speed` is above 2 m/s;
    - `'noGround'` when `physics.groundY(x, z)` is null;
    - otherwise `setBodyPose` at `(x, groundY + UPRIGHT_LIFT_M, z)` with zero roll and pitch, and `setBodyVelocity` zero. The heading is the body's forward axis projected on the ground plane. When that projection is shorter than 0.2 (the car stands on its nose or tail), the up axis's projection is used. `UPRIGHT_LIFT_M = 0.6`.
  - `restorePlayer()`: for the `LocalPlayer`, `Health.hp = max`, `ko = 0`, `koUntilTick = 0`.
  - `setFlags(f)` / `flags()`: write and read `services.sandboxFlags`, registering the resource on the first write.
- **Sandbox side** (new `packages/engine/src/sim/modes/builtin/sandbox-body.ts`, in the C02 lint scope; `SandboxEnv.body?()` and `CommandDeps.body?()` added beside M04e1's `world`):
  - **Toggles.** `applyToggle` hands `sandbox.player.godMode`, `sandbox.player.superJump` and `sandbox.vehicle.noDamage` (boolean only) to `applyBodySetting`. It calls `setFlags` and returns `true`. It never writes `SandboxSlice.toggles`, so these paths reach no autosave. A non-boolean value writes nothing.
  - **Actions** added to `SANDBOX_ACTIONS`:
    - `player.restore` calls `restorePlayer`;
    - `vehicle.repair` and `vehicle.upright` act on `target(owned handles)`;
    - `vehicle.dismiss` retires that target through M04e3's `retire` and drops it from `owned`. M04e3's `vehicle.clear` remains the all-cars action.
  - **Refusals:** no target raises `sandbox.refuse.needCar`; `'moving'` raises `sandbox.refuse.carMoving`; `'noGround'` raises `sandbox.refuse.noGround`. Unknown names and malformed arguments change nothing and throw nothing.
  - **Lifecycle:**
    - `enter` calls `setFlags(noFlags())` only when some flag is set, then publishes;
    - `exit` does the same;
    - `tick` clears the flags at the first tick where `sandboxOnline(ctx)` is true.
  - Every port call sits in the existing `try/catch`. A missing port raises `sandbox.refuse.needCar` for car actions and keeps toggles off.
- **View model** `mode.sandbox.player`: `{ godMode, superJump, carNoDamage, car: 'none' | 'near' | 'driving', online }`. `tick` recomputes `car` from `target` and patches only on a change.
- **Phone UI** (`packages/ui/src/phone/apps.ts`, `pause.tsx`; existing widget kinds only):
  - In the `player` tab, after M04e1's heat rows: the buttons `sandbox-godmode` and `sandbox-superjump`, each sending `sandbox.set` with the negated value and styled `primary` while on; then `sandbox-restore` (`mode.cmd player.restore`).
  - In M04e3's `vehicles` tab, before the class list: a level-2 heading `phone.sandbox.car.mine`, then `car-repair`, `car-upright` and `car-dismiss` (`mode.cmd vehicle.*`), and the toggle `car-nodamage`.
  - While `car` is `'none'`, the three car buttons carry `disabled: 'sandbox.refuse.needCar'`. While `online`, every new button carries `disabled: 'sandbox.refuse.online'`.
  - `PhoneEnv` gains `sandboxPlayer`, read from `mode.sandbox.player`.
- **Text** (`content/ui/i18n/en.json`, original wording; design values the owner may tune):

  | key | value |
  |---|---|
  | `phone.sandbox.player.godOn` / `godOff` | Can't get hurt: on / off |
  | `phone.sandbox.player.jumpOn` / `jumpOff` | Big jumps: on / off |
  | `phone.sandbox.player.restore` | Patch me up |
  | `phone.sandbox.car.mine` | The car you're in or beside |
  | `phone.sandbox.car.repair` | Fix it up |
  | `phone.sandbox.car.upright` | Back on its wheels |
  | `phone.sandbox.car.dismiss` | Send this one away |
  | `phone.sandbox.car.noDentOn` / `noDentOff` | Dent-proof cars: on / off |
  | `sandbox.refuse.needCar` | Get in one of your sandbox cars, or stand right beside one. |
  | `sandbox.refuse.carMoving` | Let it stop rolling first. |
  | `sandbox.refuse.noGround` | There's no solid ground under it here. |

  M04e0 and M04e3 already cover the `sandbox.refuse.` and `sandbox.status.` prefixes in `tools/ci/check-i18n.ts`.
- **Builder decisions:** rows in `spec/11-decision-log-builder.md`, section M04e4.

## Scope out
- **Placing and clearing cars, the cap, despawn on exit and on room join:** M04e3.
- **Free tuning on session cars:** M07b3, after M07b2; paint and tint are post-v1 (DL-730). M07b3 reuses the `veh:sbx` guard and session-only state from M04e3 and this file.
- **Checklist rows rejected here** (research/repos-grand-v.md §3 is a feature checklist only):
  - *Infinite stamina:* no stamina exists. Sprint never runs out (`sprintMps` in `config/physics.json`; no drain in `onfoot.ts`), so the toggle would do nothing. A future stamina system reads `SandboxFlags` and adds a flag.
  - *No ragdoll:* the player never ragdolls. `vehiclePedHitSystem` queries `Ped`, and `assets/prefabs/player.default.json` has no `Ped`.
  - *Clean:* no dirt or wear state exists. `VehicleDamage` holds `body`, `engine` and `tires` only, and no material reads dirt. "Fix it up" restores everything there is.
  - *Lock:* nobody else enters cars in single player, so a lock has no effect the player can see.
  - *Invisibility and player opacity:* the gameplay effect, police not reacting, is already the heat toggles (M04b2/M04e5). Hiding the body conflicts with the camera rig's `playerHidden` rule and the XR self-view. A render-only opacity has no use while the Camera app is a v1 non-goal (DL-292).
  - *Run and swim multipliers:* the speeds are fixed per profile and proved by `control.onfoot.spec.ts`. Faster travel than the profiles allow would outrun streaming, and M04e1's world speed covers the fantasy.
  - *Seatbelt:* no ejection mechanic exists, so there is nothing to fasten against.
  - *Forward speed boost:* the racing nitro model (`06-racing-content.md` C.2, `nitro.*`) is the game's only boost. A free impulse would bypass the handling model of the same cars.
  - *Licence plate text:* free player text carries a real-name and moderation risk with no decision yet. Session cars are discarded, and plates belong to the racing garage (M07b2, ≤ 7 chars).
- **Vehicle invincibility is included** as `sandbox.vehicle.noDamage`, limited to `veh:sbx` cars. It never touches the M03a2 oracle lines, which use no session key.
- Weapons and firearms (D-30). Any C05 or C06 shape change, any new widget kind, any write to `SandboxSlice` or `CoreSlice`.

## Deliverables
- Engine, `packages/engine/src/sim/`:
  - `sandbox-flags.ts` (new) and `services.ts`;
  - `combat/combat.ts`, `control/onfoot.ts` and `vehicle/vehicle-system.ts`;
  - `modes/sandbox-body-port.ts` (new), `modes/builtin/sandbox-body.ts` (new), `modes/builtin/sandbox.ts`, `modes/builtin/index.ts`, `modes/commands.ts` and `modes/index.ts`.
- Engine tests, `packages/engine/test/`:
  - `sandbox-flags.spec.ts` and `sandbox-body.spec.ts` (new);
  - `modes/sandbox-player.spec.ts` (new);
  - `modes/fixture.ts` (`RigOptions.sandboxBody`).
- UI: `packages/ui/src/phone/apps.ts` and `packages/ui/src/phone/pause.tsx`; `packages/ui/test/phone.spec.ts` and `packages/ui/test/ui-screen-parity.spec.ts` (both extended).
- `content/ui/i18n/en.json`.
- `tests/e2e/ui/sandbox-actions.spec.ts` (new, tag `@sandbox-actions`). It runs in the `DV_WORLD=synth` half, so it does not go in `GRAYBOX_GREP`.
- `spec/11-decision-log-builder.md`.
- About 22 files.

## Interfaces
- C06 1.1, read only: `UiCommand` (`sandbox.set`, `mode.cmd` ≤ 512 B), `GameModeSim.onEvent`, `PhysicsQueries.groundY`, `ModeContext.net`.
- C05 1.2: `SandboxSlice` and `CoreSlice` are unchanged and unwritten. The example path `sandbox.player.godMode` in `01-engine-save-modes.md` becomes session-only. DL-718 records that spec edit; the type does not change.
- C01 1.0: `veh:sbx<n>` keys are read through `EcsApi.keyOf`.
- Engine-internal, in no contract: `SandboxFlags`, `EngineServices.sandboxFlags`, the `sandbox-flags` resource, `CombatPorts.immune`, `SandboxBodyPort`, and the `mode.sandbox.player` view-model key.

## Acceptance criteria
- AC-1 Given the merged base with this milestone When the repository checks run Then:
  - they pass;
  - `pnpm lint` reports no C02 finding in `packages/engine/src/sim/**`;
  - `check:i18n` reports no missing or unused key

  — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm check:i18n && pnpm build`
- AC-2 Given flags that are never set When the hash runs are repeated Then:
  - a walk sim (`createWalkSim`) that sprints and jumps for 600 ticks hashes equal to `NO_FLAGS_HASH`, a constant the Builder records in `sandbox-flags.spec.ts` from the merged base before editing;
  - the existing combat, on-foot and vehicle suites pass unchanged;
  - the synth-world hash scenario still matches

  — proof: `pnpm check:unit -- packages/engine/test/sandbox-flags.spec.ts packages/engine/test/combat.test.ts packages/engine/test/control.onfoot.spec.ts packages/engine/test/vehicle.water.spec.ts && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-hash`
- AC-3 Given the flags spec When each reader is exercised Then:
  - **combat:** with `immune` true for the local player, an NPC `jab` leaves its `hp`, `ko` and position unchanged and emits one `HitEvent` with damage 0; with `immune` false the existing damage applies;
  - **jump:** with `superJump`, a standing jump on flat ground peaks at 4.0 ± 0.15 m above the start, and without it at the existing apex;
  - **car damage:** with `carNoDamage`, two sedans dropped from 6 m, keyed `veh:sbx0` and `veh:test0`, land; `veh:sbx0` keeps `body` 1, and `veh:test0` loses body;
  - **resource:** the `sandbox-flags` resource exists only after the first `setFlags`

  — proof: `pnpm check:unit -- packages/engine/test/sandbox-flags.spec.ts`
- AC-4 Given a real vehicle world (`createVehicleWorld`) with the body port When the port is exercised Then:
  - **repair:** after a 6 m drop, `repair` restores `body`, `engine` and the four tires to 1 and clears `wet`;
  - **upright:** a car posed upside down at rest, after `upright` and 120 ticks, has its up axis `y > 0.95`, speed below 0.5 m/s and a heading within 5° of its original;
  - **refusals:** at 10 m/s `upright` returns `'moving'`, and with `groundY` null it returns `'noGround'`, neither changing the pose;
  - **restore:** a player at `hp` 10 with `ko` 1 gets `hp = max` and `ko = 0`;
  - **target:** returns the driven owned car first, then the nearest owned car within 6 m, and null for a car outside `owned`, even one at 1 m

  — proof: `pnpm check:unit -- packages/engine/test/sandbox-body.spec.ts`
- AC-5 Given a rig (`makeRig({ sandboxBody, sandboxVehicles })`) with spies and a running sandbox When the three toggle paths are sent through `sandbox.set` and the four actions through `mode.cmd {mode:'sandbox'}` Then:
  - each valid toggle calls `setFlags` with only its flag changed, and `slices.sandbox.toggles` gains no key;
  - a numeric value calls nothing;
  - `vehicle.repair`, `vehicle.upright` and `vehicle.dismiss` act on the port's target. `dismiss` calls M04e3's `retire` once and removes the key from `mode.sandbox.vehicles.owned`;
  - with no target, each car action raises `sandbox.refuse.needCar`; `'moving'` and `'noGround'` raise their keys;
  - `mode.sandbox.player` reflects every change

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-player.spec.ts`
- AC-6 Given the same rig When a session sets all three flags, quits and starts sandbox again, and separately switches M04e0's net port to a fake net Then:
  - after `mode.quit` and after the re-enter, `flags()` deep-equals `noFlags()`;
  - after the net switch, the flags are cleared at the next tick, `online` is true, and every action is refused with `sandbox.refuse.online`;
  - `JSON.stringify(slices.core)` and `JSON.stringify(slices.sandbox)` are byte-equal to their values before the session;
  - no posted save carries any of the three paths;
  - under `story`, every path and action reaches no port call

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-player.spec.ts packages/engine/test/modes/sandbox-guard.spec.ts`
- AC-7 Given `appScreen('sandbox', env)` with `sandboxPlayer` and `sandboxVehicles` envs When it is built Then:
  - the `player` tab holds `sandbox-godmode`, `sandbox-superjump` and `sandbox-restore` after M04e1's ids, which are unchanged;
  - the `vehicles` tab holds the `phone.sandbox.car.mine` heading, `car-repair`, `car-upright`, `car-dismiss` and `car-nodamage` before M04e3's class list;
  - each `onPress` is the documented command;
  - with `car: 'none'` the three car buttons carry `disabled: 'sandbox.refuse.needCar'`, and with `online: true` every new button carries `disabled: 'sandbox.refuse.online'`;
  - `DomScreen` and `CanvasScreen` give the same focus order

  — proof: `pnpm check:unit -- packages/ui/test/phone.spec.ts packages/ui/test/ui-screen-parity.spec.ts`
- AC-8 Given the new text When the IP and text gates run Then:
  - no finding is reported;
  - no new value contains `DISPLAY_NAME` or `SHORT_NAME` from `config/brand.ts`

  — proof: `pnpm build && pnpm ip:strings && pnpm names:lint && pnpm check:i18n`
- AC-9 Given a QA build on the synth world with sandbox running When the e2e drives the phone Then:
  - **big jumps:** after Player → `sandbox-superjump` and closing the phone, one `Space` press makes `__dvBridge.engine.observe().player.pos[1]` peak at least 3.0 m above its start within 2 s; after turning it off, the next jump peaks below 1.5 m;
  - **car actions:** after M04e3's `car-kestrel-quill-drive`, `car-repair` and `car-upright` (car at rest) raise no refusal toast, and `vehicleOp('state')` reports `body` 1;
  - **dismiss:** after `vehicleOp('exit')` and `car-dismiss`, `vehicleOp('state', <that handle>)` reports `vehicle: null` within 2 s;
  - **reset:** after `mode.quit` and a new sandbox start, `modes.vm('mode.sandbox.player')` reports all three flags false;
  - **clean run:** no `pageerror` occurs

  — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-actions`

## Test plan
- **Unit (engine):**
  - `sandbox-flags.spec.ts` (AC-2, AC-3);
  - `sandbox-body.spec.ts` (AC-4);
  - `modes/sandbox-player.spec.ts` (AC-5, AC-6);
  - regression: `combat.test.ts`, `control.onfoot.spec.ts`, `vehicle.water.spec.ts`, M04e3's `modes/sandbox-vehicles.spec.ts`, `modes/sandbox-guard.spec.ts`, and the whole `packages/engine/test/modes` suite.
- **Unit (UI):** `phone.spec.ts` and `ui-screen-parity.spec.ts` (AC-7).
- **Gates:** `check:i18n`, `ip:strings`, `names:lint` (AC-1, AC-8).
- **e2e:** `@sandbox-actions` on `chromium-webgl2`, `DV_WORLD=synth` (AC-9); `@world-hash` regression (AC-2).

## Demo script
1. `pnpm dev` (QA build), then New Game → Sandbox.
2. Pause → Phone → Sandbox → Player → "Big jumps: on". Close the phone and jump onto a low roof.
3. Player → "Can't get hurt: on", then "Patch me up".
4. Cars → Class C → "Put one here and drive" (M04e3), then roll it on a steep street and stop.
5. Cars → "Back on its wheels": the car settles upright on the road. Then "Fix it up".
6. Step out, Cars → "Send this one away": it leaves.
7. Quit Sandbox and start it again: the Player toggles read "off".

## Effort
0.6 Builder session; about 22 files; risk **medium** (three hashed sim paths gain a flag check).

## Risks & fallbacks
- **A flag check changes a golden even while off.** Each reader branches on a boolean that is false by default, and AC-2 proves the never-set hash. If a golden still moves, the Builder finds the reader that runs work while its flag is off, makes it skip that work, and records a BD row.
- **`setBodyPose` on a seated car desyncs the seat.** If the driver capsule lags, `upright` first requests the exit, as M04e3's `retire` does, and refuses with `sandbox.refuse.carMoving` until the player is on foot. Record a BD row.
- **A 4 m jump is uncomfortable in XR.** If the M11b3 comfort review flags it, the XR panel hides `sandbox-superjump` through a BD row. The flag stays sim-side.
- **The resource stays registered after a sandbox session** in the same sim, so a later story session in that sim hashes differently from a fresh boot. Hashed story suites always start fresh. If one does not, the resource's `hash` and `save` write zero bytes while every flag is off; the Builder confirms that the core adds no per-resource framing, and records a BD row.

## Notes for the Builder
- **Read first:**
  - M04e0, M04e1 and M04e3's files;
  - `packages/engine/src/sim/combat/combat.ts` (`hurt`, `CombatPorts`);
  - `packages/engine/src/sim/control/onfoot.ts` (`jumpV0`, the vault branch);
  - `packages/engine/src/sim/vehicle/{vehicle-system.ts, components.ts, debug.ts}` (`nearestVehicle` shows the distance loop; never import `debug.ts`);
  - `packages/engine/src/sim/ragdoll/ragdoll-lite.ts` (the forward axis from the quaternion);
  - `packages/engine/src/sim/modes/index.ts` (the `CombatImpl` binding);
  - `packages/engine/test/{walk-sim.ts, vehicle-sim.ts}`.
- **Order of work:**
  1. record `NO_FLAGS_HASH`;
  2. the flags and the three readers;
  3. the body port and its spec;
  4. the toggles, the actions and the rig spec;
  5. the UI;
  6. the text and the e2e.
- **C02:** `sandbox-flags.ts`, `sandbox-body.ts`, `sandbox-body-port.ts` and the readers are in lint scope. Use `dsqrt`, `datan2`, `dsin` and `dcos` only, with no `Date`, timers, `**` or `for…in`.
- **Frames:** `Transform` and `PhysicsQueries.groundY` use the same rebased sim frame that M04e3's spot search uses. Never add the world origin.
- **IP wall:** every label, key and status line is original. Do not copy wording, menu names or section order from sandbox trainers. After M04e5, `ip:strings` enforces its trainer patterns, and none of the strings above matches them. The display name never appears.
- **Rebase note:** M04e5 changes English values under `phone.sandbox.*`; key names do not collide.
- **Secrets:** none.

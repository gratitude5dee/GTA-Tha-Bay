# M01b1 — controller-cameras-touch

## Goal
After this session a player capsule walks, runs, sprints and jumps through the M01a2 fixture world on desktop (keyboard and mouse, or a standard gamepad). A behind-the-shoulder third-person camera follows it without clipping and switches to first person at any time unless locked. New: the C03 input pipeline (binders → `InputRouter` → `InputFrame`), the C04 types, `player.default`, the on-foot controller, the ownership machine, sim-side camera collision, and a `canonical` hash test with a walking player in Node, Chromium and WebKit.

**Split boundary (`spec/domains/01-engine.md` §8, row M01b, plus the kbm/gamepad binders moved out of M01a):** M01b1 takes everything provable on desktop in the fixture world: binders, router, KCC on-foot states, the ownership machine with a ragdoll stub, the prefab registry, CameraRig fp/tp with collision, and the 100-pose sweep. M01b2 takes touch, the S02 gray-box Civic Center block, camera polish, the anim graph, the audio skeleton, the debug panel and free cam, the iPhone and Quest checks, and vault.

## Requirements
- R-PLAT-04: fp and tp cameras, switchable at any time outside cutscenes. The lock is exercised through `CameraDirective.lockPlayerToggle`.
- R-PLAT-03: the Rapier `KinematicCharacterController` runs inside the WASM physics backend from M01a2.
- R-ENG-04: every action is resolved through rebindable `Binding`s; `client.Pause` keeps its default binding in addition to any override. Persisting remaps is M04a.
- R-ROLL-02 (support): movement uses only collision queries and quantized input, so M12b can replay it.

## Depends on
- **M01a2** (physics backend, `sim.worker`, transports, snapshot reader, `__dvBridge.engine`, `physics-drop`, determinism e2e). Through it: M01a1 and M00.
- Contracts: C01 1.0.0, C02 1.1.0, C03 1.1.0 (binders, router, `ControlsSettings` shape), **C04 1.1.0** (created here).

## Scope in
- **C04 files**, verbatim: `c04-camera.ts` (1.0 + 1.1) and `contracts/anim-states.ts` (`SkeletonId`, `HUMANOID_BONES`, `AnimStateId`).
- **Binders and router** (`packages/engine/src/client/input/`):
  - `RawInputState`;
  - kbm binder: `KeyboardEvent.code`, mouse buttons and wheel normalized by `deltaMode`, Pointer Lock requested with `unadjustedMovement: true` on canvas click, release-all on `blur` and `visibilitychange`, suspended while a text field has focus;
  - gamepad binder: W3C `standard` mapping only; a non-standard pad gets a one-time console warning and is ignored; disconnect releases everything;
  - `InputRouter`: context stack, gestures (press, hold 300 ms, double-tap 450 ms, release), chords, hold-to-toggle, `setOverrides`, `onClientAction`, `rebindCapture`, quantization to `InputFrame` (i8 axes `Math.round(v × 127)`, u16 yaw, i16 pitch), last-active device.
  The main thread writes each frame into the M01a2 input block.
- **Default maps** `config/input/defaults.kbm.json` and `defaults.gamepad.json`, from the `research/gamedesign-decomposition.md` §6 matrix, `onFoot` and `menu` contexts:
  kbm WASD, mouse look, Space, Shift, E, F, V camera, C shoulder, Esc/P pause; pad axes 0–3, b0 jump, b10 sprint, b3 interact, b11 camera, b9 pause, b8 map. JSON Schema validated.
- **Look** on the main thread every frame (C03 rule 1): mouse 0.0022 rad/px × sensitivity, pad 3.0 rad/s at full deflection (design values), pitch clamped to [−70°, 70°].
- **Physics additions to `rapier-backend.ts`:** `character.move` on Rapier `KinematicCharacterController` (autostep 0.4 m, snap-to-ground 0.5 m, max climb 45°, sliding on [research/stack-rendering-platform.md §5.1]), `castRay` and `castSphere`. Collision groups come from `config/physics.json`.
- **On-foot controller** (`packages/engine/src/sim/control/onfoot.ts`, stage `PhysicsPre`):
  - movement is camera-relative and rotated by `camYaw` with `dsin`/`dcos`;
  - stick magnitude ≤ 0.5 walks at 1.6 m/s, otherwise runs at 4.2 m/s; `Sprint` gives 6.8 m/s;
  - hill factor: uphill × max(0.35, 1 − g × 1.7), downhill × min(1.25, 1 + |g| × 0.35), with grade g from `groundNormalY` via `dsqrt` [research/repos-world.md §1.7];
  - gravity from config; jump apex 1.0 m (v₀ = `dsqrt(2·g·h)`);
  - capsule radius 0.35 m, height 1.8 m;
  - states 100 idle, 101 walk, 102 run, 103 sprint, 110 jump, 111 fall, 112 land (6 ticks);
  - writes `Anim{state: AnimStateId 0–6, p0: speed}`.
- **Ownership machine** (`ownership.ts`, stage `Control`): `Ready → Waiting → Entering → Active → Leaving / Delegated` per `01-engine.md` §2.5, with owners `OnFoot` and a `Ragdoll` stub (300 → 301 → 100 over 3 s, triggered by `debug.ragdoll`). Teleport goes 700 → 701 and waits up to 300 ticks for a static collider under the target. On timeout it returns to `Ready` with reason key `engine.control.groundNotLoaded` (English default "Ground not loaded; player was not moved") and leaves the position unchanged. Transitions go to the event ring.
- **Prefab registry:**
  - `PrefabDef` and `PrefabService` (`01-engine-save-modes.md` "Entity prefabs");
  - `assets/prefabs/player.default.json` with `render.asset` `prop/graybox.capsule`. It is a procedural placeholder: no file ships, so no provenance record is needed;
  - spawn adds the C01 engine components a player needs (Transform through CameraAnchor with head 1.7 m, chest 1.35 m), `Key player:0` and the `LocalPlayer` tag.
- **Camera collision** (sim, stage `Publish`):
  - every tick, sphere-cast with radius 0.25 m from the chest anchor toward the tp desired position (offset [0.6, 0.35, 2.8], shoulder side, `camYaw`/`camPitch`) against statics;
  - `allowedDistance = hit ? max(0.2, toi − 0.05) : desired`;
  - publish a `CameraDirective` (`mode 'tp'`, `follow`, `allowedDistance`, `lockPlayerToggle`, `reason`) in the snapshot side block;
  - `debug.camera.lock {on}` sets the lock with reason `'debug'`.
- **`CameraRig`** (`packages/engine/src/client/camera/rig.ts`):
  - tp/fp modes with FOV 65/75 and near planes 0.1/0.05 m;
  - lag smoothing k = 1 − e^(−dt·g) with g 9 (position) and 12 (rotation);
  - pulls in to `allowedDistance` immediately and eases back out over 0.3 s;
  - `toggleFpTp()` returns `false` under lock;
  - `swapShoulder()`, `apply()`, `update()`, `onModeChange()`.
  In fp the player capsule is hidden.
- **Scenario `walk-drop`:** `physics-drop` plus the player on a seeded `BotInput` (walk, run, sprint, jumps, the ramp).
- **Bridge:** `observe()` adds `player {pos, vel, control, grounded}` and `camera {mode, allowedDistance, lastToggleRefused}`; `act()` adds `debug.teleport`, `debug.ragdoll`, `debug.camera.lock`.

## Scope out
- Touch binder and overlay, the gray-box Civic Center block (M01f fixture), player-mesh fade within 0.6 m, depth-policy near-plane raise, reduced motion, free cam, debug sim panel, anim graph runtime, audio skeleton, vault, iPhone and Quest checks: **M01b2**.
- Swim state (800) and shore respawn, vehicle views, auto-recentre: M03a1 (first water chunks and vehicles). Cinematic shots: M05a2. XR rig: M11b1.
- Remap persistence and the settings UI: M04a and M04b1. Glyphs: S10.

## Deliverables
- `packages/shared/src/contracts/{c04-camera.ts, anim-states.ts}`; extend `contracts/index.ts`.
- `packages/engine/src/client/input/{raw-state.ts, kbm.ts, gamepad.ts, gestures.ts, quantize.ts, router.ts, defaults.ts}`, `packages/engine/src/client/camera/rig.ts`; wire input and camera in `client/boot/boot-engine.ts`.
- `packages/engine/src/sim/control/{states.ts, ownership.ts, onfoot.ts}`, `packages/engine/src/sim/camera/collision.ts`, `packages/engine/src/sim/prefabs/{registry.ts, schema/prefab.schema.json}`; extend `sim/physics/rapier-backend.ts`.
- `assets/prefabs/player.default.json`.
- `config/input/defaults.kbm.json`, `config/input/defaults.gamepad.json`, `config/schemas/input-map.schema.json`; extend `config/physics.json` (character constants: speeds, hill factors, jump, capsule).
- `packages/engine/test/{input.router.spec.ts, input.kbm.spec.ts, input.gamepad.spec.ts, control.onfoot.spec.ts, control.ownership.spec.ts, camera.sweep.spec.ts, camera.rig.spec.ts, prefab.spec.ts}`, `test/scenarios/walk-drop.ts`, `test/golden/determinism.walk-drop.json`. Extend `test/fixtures/world-boxes.ts` with a 0.35 m step, a 0.5 m step, a 10 % grade strip and a 50° bank in the heightfield.
- Extend `apps/web/src/qa/determinism.ts` to run `walk-drop` after `physics-drop`.
- `tests/e2e/fp-tp.spec.ts` (tag `@fp-tp`).

## Interfaces
- **Created:** C04 1.1.0 (`c04-camera.ts`, `anim-states.ts`), verbatim.
- **Implemented:** C03 `Binder`, `InputRouter` and `RawInputState`; `PrefabDef`/`PrefabService`; the `PhysicsBackend` `character`, `castRay` and `castSphere` members.
- No contract shape changes; if `RawInputState` (a `Map`) is slow, optimize inside the router, not the type.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0, and the input-map and prefab JSON files validate against their schemas — proof: `pnpm typecheck && pnpm lint && pnpm build && pnpm --filter @dv/engine test -- prefab`
- AC-2 Given the router with kbm defaults, tested with synthetic `Event` objects (no DOM library), the following hold — proof: `pnpm --filter @dv/engine test -- input`:
  - a keydown and keyup between two `sample()` calls set `pressed` on exactly one frame;
  - a 300 ms hold fires `hold`, and two taps 400 ms apart fire `doubleTap`;
  - a chord fires only while its modifiers are held;
  - `sim.Sprint` in `holdToToggle` latches on a tap;
  - pushing the `menu` context drops `onFoot` bits;
  - an override that removes Esc still pauses on Esc;
  - `blur` and `visibilitychange` clear every held bit;
  - input is ignored while the injected focus predicate reports a text field.
- AC-3 Given a fake standard-mapping gamepad When axes read [0.6, −1, 0, 0] and b0 is down Then `moveX` = 76, `moveY` = −127 and `Jump` is held. A pad with `mapping: ''` produces no input and one warning; disconnect clears all bits — proof: `pnpm --filter @dv/engine test -- input.gamepad`
- AC-4 Given the headless fixture world and full-run input on flat ground When the controller runs under each profile Then the distance between ticks 60 and 660 is 42.0 ± 0.5 m (run), 68.0 ± 0.7 m with `Sprint`, and 16.0 ± 0.3 m at stick 0.4 (walk). On the 10 % grade, uphill speed is 3.49 ± 0.17 m/s — proof: `pnpm --filter @dv/engine test -- control.onfoot`
- AC-5 Given the same world When the player walks into the 0.35 m step, the 0.5 m step and the 50° bank, then jumps on flat ground Then it climbs the first, is blocked by the second and the third, and the jump apex is 1.00 ± 0.05 m with states 110 → 111 → 112 → 100 — proof: `pnpm --filter @dv/engine test -- control.onfoot`
- AC-6 Given the player on the ground When `debug.teleport` targets a point with no statics Then `Control.state` goes 700 → 701, returns to `Ready` after 300 ticks with reason `engine.control.groundNotLoaded`, and the position is unchanged; `debug.ragdoll` passes 300 → 301 → 100 within 180 ticks plus the get-up time — proof: `pnpm --filter @dv/engine test -- control.ownership`
- AC-7 Given 100 seeded poses (walkable position, yaw, pitch in [−70°, 70°], both shoulders) in the fixture world When the camera position is computed from the published `allowedDistance` Then no camera point lies inside any static box or below the heightfield, each inflated by 0.1 m; unobstructed poses get the full desired distance — proof: `pnpm --filter @dv/engine test -- camera.sweep`
- AC-8 Given the rig When `allowedDistance` drops from 2.8 to 1.0 m Then the next `update()` places the camera at ≤ 1.0 m; when it returns to 2.8 m, distance reaches 2.8 m at 0.3 s ± one frame and not before 0.25 s. Under `lockPlayerToggle`, `toggleFpTp()` returns `false` and the mode is unchanged. Near planes are 0.05 m (fp) and 0.1 m (tp) — proof: `pnpm --filter @dv/engine test -- camera.rig`
- AC-9 Given scenario `walk-drop` under `canonical` When it runs 10,000 ticks twice in Node Then every checkpoint equals `determinism.walk-drop.json` — proof: `pnpm --filter @dv/engine test:determinism`
- AC-10 Given the QA determinism page When it runs `walk-drop` in Chromium and in WebKit Then every checkpoint equals the Node golden in both — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @determinism && pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism`
- AC-11 Given the QA build in Chromium When the test holds W + Shift Then the player covers ≥ 50 m within 12 s. Pressing V gives `camera.mode` `'fp'` and pressing it again `'tp'`. After `debug.camera.lock {on: true}`, V leaves the mode unchanged and sets `lastToggleRefused: true` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @fp-tp`
- AC-12 Given a production build When the dist verifier and the preview deploy run Then both pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit (Node):** `input.*`, `camera.rig`, `prefab`. **Integration (headless Rapier):** `control.onfoot`, `control.ownership`, `camera.sweep`, `determinism.node` (`walk-drop`). **e2e:** `@determinism` (Chromium, WebKit), `@fp-tp` (Chromium). All run inside `pnpm check:unit` or `pnpm check:e2e`.

## Demo script
1. `pnpm dev`; open the local URL with `?debug=1`; click the canvas to take Pointer Lock and look around.
2. WASD, Shift, Space: climb the small step, fail on the tall one.
3. V toggles fp/tp; C swaps shoulders; back into a box and watch the camera pull in and ease out.
4. A gamepad works the same (left stick, b11).
5. `__dvBridge.engine.act({ t: 'debug.camera.lock', on: true })`, then V: nothing changes.
6. `__dvBridge.engine.act({ t: 'debug.teleport', pos: [5000, 0, 0] })`: the ground-not-loaded reason is logged and the player stays put.

## Effort
1 Builder session; about 38 files; risk **medium-high**. The KCC API details and keeping the controller deterministic under `canonical` are the main risks.

## Risks & fallbacks
- **Rapier KCC call names.** The ledger confirms `KinematicCharacterController`, `enableAutostep`, `enableSnapToGround`, `setMaxSlopeClimbAngle`, `setSlideEnabled` [research/stack-rendering-platform.md §5.1]; `computeColliderMovement`, `computedMovement`, `computedGrounded` are UNVERIFIED, so confirm them in the 0.21.0 typings. Fallback: a cast-and-slide loop over `castSphere` with the same constants.
- **WebKit hash drift.** Bisect per tick as in M01a2; keep trig on `detmath`; widen f32 reads with `Math.fround`.
- **Pointer Lock** is not used in e2e (keys only). Esc under Pointer Lock exits the lock (not in the ledger), so a `pointerlockchange` to unlocked during play also raises `client.Pause`.

## Notes for the Builder
- Read first: `01-engine-contracts.md` §C03, §C04, service interfaces; `01-engine.md` §2.4–§2.7; `01-engine-save-modes.md` "Entity prefabs"; `research/gamedesign-decomposition.md` §6.
- Facts: iPhone lacks Pointer Lock (F-011), so touch lands in M01b2; `unadjustedMovement` and release-on-blur follow [research/repos-webport.md §2.7]; W3C standard mapping per [research/gamedesign-decomposition.md §6].
- Sim code may not call `Math.sin` (M01a1 lint); main-thread rig and look code may. The sim always computes the tp collision; the fp/tp choice is presentation (C02 determinism rule 7) and never reaches the sim.
- Order of work: C04 types → backend casts and KCC → on-foot plus headless tests → ownership → collision plus sweep → binders and router → rig → wiring → `walk-drop` goldens → e2e.
- Secrets: none for code. `pnpm deploy:preview` needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in CI (M00). Locally without them, stop at `verify:dist`.
